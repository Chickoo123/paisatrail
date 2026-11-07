import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSV, parseDate, parseAmount, detectColumns, readStatement } from "../src/statement.js";
import { classify, auditStatement, disputeLetter } from "../src/charges.js";
import { sampleStatement } from "../src/sample.js";
import { RULES } from "../src/rules.js";

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const find = (r, id) => r.findings.find(f => f.id === id);
const csv = rows => ["Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance", ...rows].join("\n");

// ---------- Parser (carried over from v1, still the hardest part of real statements) ----------
test("parseCSV handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
  assert.deepEqual(parseCSV('﻿a,"b, c","say ""hi"""\r\n\r\n1,2,3\n'), [["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
});

test("parseDate and parseAmount understand Indian bank formats", () => {
  assert.equal(parseDate("05/11/26"), "2026-11-05");
  assert.equal(parseDate("5 Nov 2026"), "2026-11-05");
  assert.equal(parseDate("05 Sept 2026"), "2026-09-05");
  assert.equal(parseDate("31/02/2026"), null);
  assert.equal(parseAmount("₹1,23,456.50"), 123456.5);
  assert.equal(parseAmount("500 Dr"), -500);
  assert.equal(parseAmount("(500)"), -500);
  assert.equal(parseAmount("abc"), null);
});

test("detectColumns skips bank preambles and finds the balance column", () => {
  const c = detectColumns([["Bank statement"], ["Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"]]);
  assert.deepEqual([c.headerRow, c.date, c.desc, c.debit, c.credit, c.balance], [1, 0, 1, 2, 3, 4]);
  const d = detectColumns([["Txn Date", "Description", "Amount", "Dr/Cr", "Balance"]]);
  assert.deepEqual([d.amount, d.type, d.balance], [2, 3, 4]);
});

test("readStatement reports skipped rows and whether balances are present", () => {
  const r = readStatement(csv(["01/05/26,ATM CHGS,25.00,,100.00", "TOTAL,,,,"]));
  assert.equal(r.rows[0].amount, -25);
  assert.equal(r.rows[0].balance, 100);
  assert.equal(r.hasBalance, true);
  assert.deepEqual(r.skipped, [3]);
  assert.throws(() => readStatement("a,b\n1,2"), /Couldn't find/);
});

// ---------- Classification ----------
test("classify recognises common Indian charge narrations, GST lines and ATM withdrawals", () => {
  const c = d => classify({ description: d, amount: -10 });
  assert.equal(c("NON MAINTENANCE OF AMB CHGS JUN26").type, "min_balance");
  assert.equal(c("MIN BAL CHG").type, "min_balance");
  assert.equal(c("ATM CHGS 2 TXNS MAY26").type, "atm");
  assert.equal(c("ATM CARD ANNUAL FEE").type, "debit_card"); // not an ATM transaction charge
  assert.equal(c("SMS CHGS QTR").type, "sms");
  assert.equal(c("NEFT CHGS INB 0520").type, "neft");
  assert.equal(c("ECS RTN CHGS").type, "return");
  assert.equal(c("PMSBY RENEWAL PREMIUM").type, "insurance_scheme");
  assert.equal(c("IGST @18% ON ATM CHGS").kind, "gst");
  assert.equal(c("ATW-4111XXXXXX1111-S1ANAM12-PUNE").kind, "atm_withdrawal");
  assert.equal(c("UPI/6123/COFFEE DAY/cafe@ybl/Payment").kind, null); // "fee" inside a word is not a charge
  assert.equal(c("UPI/6123/RAMESH/ramesh@ybl/charges for repair").kind, null); // UPI payments are never bank charges
  assert.equal(classify({ description: "ATM CHGS REVERSAL", amount: 25 }).kind, null); // credits are ignored
});

// ---------- Rules ----------
test("minimum-balance penalty that takes the balance negative: the negative part (+GST) is refundable", () => {
  const r = auditStatement(csv([
    "05/08/26,UPI/1/SHOP/x@ybl/Pay,1000.00,,200.00",
    "06/08/26,NON MAINTENANCE OF AMB CHGS,600.00,,-400.00",
    "06/08/26,IGST @18% ON NON CHGS,108.00,,-508.00",
  ]));
  const f = find(r, "minbal_negative");
  assert.equal(f.status, "issue");
  near(f.amount, 400 * 1.18 + 0); // the ₹400 that went below zero, with its GST
});

test("minimum-balance penalties on BSBD or zero-balance accounts are fully disputable", () => {
  const text = csv(["06/08/26,MIN BAL CHG,300.00,,5000.00"]);
  assert.equal(find(auditStatement(text, { accountType: "bsbda" }), "minbal_not_applicable").amount, 300);
  assert.equal(find(auditStatement(text, { accountType: "zero_balance" }), "minbal_not_applicable").rule, RULES.minBalance);
  assert.equal(find(auditStatement(text), "minbal_verify").status, "check"); // regular account: verify notice & proportionality
});

test("ATM: a charge in a month with ≤3 withdrawals is wholly disputable; otherwise only the amount above ₹23", () => {
  const low = auditStatement(csv(["06/06/26,ATW-4111-PUNE,2000.00,,9000.00", "30/06/26,ATM CHGS,21.00,,8979.00"]));
  assert.equal(find(low, "atm_within_free").amount, 21);
  const many = ["01", "03", "05", "07"].map(d => `${d}/06/26,ATW-4111-PUNE,500.00,,9000.00`);
  const over = auditStatement(csv([...many, "30/06/26,ATM CHGS,25.00,,8975.00", "30/06/26,IGST ON ATM CHGS,4.50,,8970.50"]));
  near(find(over, "atm_over_cap").amount, 2 * 1.18);
  // Before 1 May 2025 the ₹23 cap did not apply.
  const old = auditStatement(csv(["01/03/25,ATW-1,1,,1", "02/03/25,ATW-1,1,,1", "03/03/25,ATW-1,1,,1", "04/03/25,ATW-1,1,,1", "30/03/25,ATM CHGS,25.00,,1"]));
  assert.equal(find(old, "atm_over_cap"), undefined);
});

test("NEFT charges: online ones are issues, unknown channel is a check, pre-2020 ignored", () => {
  const r = auditStatement(csv(["20/05/26,NEFT CHGS INB,2.50,,100", "21/05/26,NEFT CHGS 0521,5.00,,95", "21/05/19,NEFT CHGS INB,2.50,,95"]));
  assert.equal(find(r, "neft_online").evidence.length, 1);
  assert.equal(find(r, "neft_verify").status, "check");
});

test("duplicates are caught once, and never double-counted with another finding", () => {
  const text = csv(["15/06/26,SMS CHGS QTR,15.00,,100", "15/06/26,SMS CHGS QTR,15.00,,85"]);
  assert.equal(find(auditStatement(text), "duplicate").amount, 15);
  const bsbda = auditStatement(csv(["01/07/26,MIN BAL CHG,300,,100", "09/07/26,MIN BAL CHG,300,,100"]), { accountType: "bsbda" });
  assert.equal(find(bsbda, "duplicate"), undefined);
  assert.equal(bsbda.summary.disputable, 600);
});

test("end to end on the synthetic statement", () => {
  const r = auditStatement(sampleStatement());
  assert.deepEqual(r.skipped, []);
  assert.equal(r.unpairedGst.length, 0); // every GST line was matched to its charge
  for (const id of ["minbal_negative", "atm_within_free", "neft_online", "duplicate"]) assert.equal(find(r, id)?.status, "issue", id);
  assert.equal(find(r, "neft_verify").status, "check");
  assert.ok(r.summary.disputable > 500 && r.summary.disputable < r.summary.totalCharges);
  const b = auditStatement(sampleStatement(), { accountType: "bsbda" });
  assert.ok(b.summary.disputable > r.summary.disputable);
  assert.equal(find(b, "bsbda_free_services").status, "issue");
});

test("every finding cites a real RBI source (or none, for arithmetic-only findings)", () => {
  const r = auditStatement(sampleStatement(), { accountType: "bsbda" });
  for (const f of r.findings) if (f.rule) assert.ok(Object.values(RULES).includes(f.rule), f.id);
  for (const rule of Object.values(RULES)) assert.match(rule.url, /^https:\/\/(www\.|website\.)?(rbi\.org\.in|cms\.rbi\.org\.in)/);
});

test("dispute letter itemises each charge, cites the rule and gives the Ombudsman route", () => {
  const letter = disputeLetter(auditStatement(sampleStatement()), { bank: "Sample Bank" });
  assert.match(letter, /Sample Bank/);
  assert.match(letter, /RBI\/2014-15\/308/);
  assert.match(letter, /NON MAINTENANCE OF AMB CHGS JUL26/);
  assert.match(letter, /Total reversal requested: ₹/);
  assert.match(letter, /cms\.rbi\.org\.in/);
});
