import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCSV, parseDate, parseAmount, detectColumns, normalizeMerchant, categorize,
  buildTransactions, detectRecurring, detectDuplicates, detectAnomalies, summarize, analyze, toCSV,
} from "../src/core.js";
import { sampleStatement } from "../src/sample.js";

test("parseCSV handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
  const rows = parseCSV('﻿a,"b, c","say ""hi"""\r\n\r\n1,2,3\n');
  assert.deepEqual(rows, [["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
});

test("parseDate understands Indian bank formats and rejects impossible dates", () => {
  assert.equal(parseDate("05/11/26"), "2026-11-05");
  assert.equal(parseDate("05-11-2026"), "2026-11-05");
  assert.equal(parseDate("2026-11-05"), "2026-11-05");
  assert.equal(parseDate("5 Nov 2026"), "2026-11-05");
  assert.equal(parseDate("05-June-2026"), "2026-06-05");
  assert.equal(parseDate("05 Sept 2026"), "2026-09-05");
  assert.equal(parseDate("05/11/2026 10:42 AM"), "2026-11-05");
  assert.equal(parseDate("31/02/2026"), null);
  assert.equal(parseDate("hello"), null);
});

test("parseAmount handles rupee symbols, lakhs grouping, Dr/Cr and brackets", () => {
  assert.equal(parseAmount("₹1,23,456.50"), 123456.5);
  assert.equal(parseAmount("Rs. 500"), 500);
  assert.equal(parseAmount("(500)"), -500);
  assert.equal(parseAmount("500 Dr"), -500);
  assert.equal(parseAmount("500 Cr"), 500);
  assert.equal(parseAmount("-42"), -42);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("abc"), null);
});

test("detectColumns skips preamble rows and finds debit/credit or amount+type layouts", () => {
  const a = detectColumns([["Bank statement"], ["Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"]]);
  assert.equal(a.headerRow, 1);
  assert.deepEqual([a.date, a.desc, a.debit, a.credit], [0, 1, 2, 3]);
  const b = detectColumns([["Txn Date", "Description", "Amount", "Dr/Cr"]]);
  assert.deepEqual([b.amount, b.type], [2, 3]);
  assert.equal(detectColumns([["foo", "bar"]]), null);
});

test("normalizeMerchant extracts payees from UPI, NEFT, ACH, POS and BBPS narrations", () => {
  assert.equal(normalizeMerchant("UPI/612345678901/SWIGGY/swiggy@icici/Payment"), "Swiggy");
  assert.equal(normalizeMerchant("UPI-ZOMATO LTD-zomato@hdfcbank-HDFC0000001-123456789012-Food"), "Zomato");
  assert.equal(normalizeMerchant("NEFT CR-HDFC0000001-ACME SOFTWARE PVT LTD-SALARY"), "Acme Software");
  assert.equal(normalizeMerchant("ACH D- BAJAJ FINANCE LTD EMI-998877665544"), "Bajaj Finance Emi");
  assert.equal(normalizeMerchant("POS 4111XXXXXX1111 NETFLIX.COM"), "Netflix");
  assert.equal(normalizeMerchant("BBPS/123456789012/BESCOM ELECTRICITY"), "Bescom Electricity");
  assert.equal(normalizeMerchant(""), "Unknown");
});

test("categorize uses whole words, so 'credit' is not CRED and refunds are not income", () => {
  const c = (description, amount) => categorize({ description, merchant: normalizeMerchant(description), amount });
  assert.equal(c("INT.PD:SAVINGS INTEREST CREDIT", 842), "Income");
  assert.equal(c("UPI/1/CRED CLUB/cred@axis/Bill", -5000), "EMI & Loans");
  assert.equal(c("UPI/1/AMAZON REFUND/amazon@apl/Refund", 1299), "Shopping");
  assert.equal(c("UPI/1/COCA COLA STORE/x@ybl/Pay", -50), "Transfers");
  assert.equal(c("UPI/1/OLA CABS/ola@ybl/Ride", -220), "Transport");
  assert.equal(c("UPI/1/RAMESH/9876543210@paytm/Pay", -500), "Transfers");
});

test("user overrides by merchant beat the rules", () => {
  assert.equal(categorize({ description: "UPI/1/RAMESH/x@y", merchant: "Ramesh", amount: -500 }, { Ramesh: "Rent & Housing" }), "Rent & Housing");
});

test("buildTransactions converts withdrawals to negatives and reports unparseable rows", () => {
  const csv = "Date,Narration,Withdrawal Amt.,Deposit Amt.\n01/05/26,UPI/1/SWIGGY/s@icici/P,250.00,\n02/05/26,SALARY ACME,,50000\nTOTAL,,250,50000\n";
  const { txns, skipped } = buildTransactions(csv);
  assert.deepEqual(txns.map(t => t.amount), [-250, 50000]);
  assert.deepEqual(skipped, [4]);
  assert.throws(() => buildTransactions("a,b\n1,2"), /Could not find/);
});

const mk = (date, merchant, amount, category = "Subscriptions") => ({ date, merchant, amount, category, description: merchant });

test("detectRecurring finds monthly subscriptions and projects next date and annual cost", () => {
  const txns = ["2026-01-07", "2026-02-07", "2026-03-07", "2026-04-07"].map(d => mk(d, "Netflix", -649));
  const [r] = detectRecurring(txns);
  assert.equal(r.cadence, "Monthly");
  assert.equal(r.annualCost, 649 * 12);
  assert.equal(r.nextDate, "2026-05-08");
});

test("detectRecurring flags a settled price increase and costs it at the new price", () => {
  const amts = [599, 599, 599, 699, 699];
  const txns = amts.map((a, i) => mk(`2026-0${i + 1}-11`, "Airtel", -a, "Bills & Utilities"));
  const [r] = detectRecurring(txns);
  assert.equal(r.priceChange, 100);
  assert.equal(r.annualCost, 699 * 12);
});

test("detectRecurring ignores irregular spending", () => {
  const txns = ["2026-01-01", "2026-01-04", "2026-02-20", "2026-02-21"].map((d, i) => mk(d, "Swiggy", -(200 + i * 150), "Food & Dining"));
  assert.equal(detectRecurring(txns).length, 0);
});

test("detectDuplicates catches same merchant+amount within the window only", () => {
  const txns = [mk("2026-01-01", "Swiggy", -487), mk("2026-01-01", "Swiggy", -487), mk("2026-01-10", "Swiggy", -487)];
  const d = detectDuplicates(txns);
  assert.equal(d.length, 1);
  assert.equal(d[0].amount, 487);
});

test("detectAnomalies flags a spike against the merchant's own history", () => {
  const txns = [800, 1200, 950, 1100, 1300, 900, 18999].map((a, i) => mk(`2026-01-${String(i + 1).padStart(2, "0")}`, "Amazon", -a, "Shopping"));
  const a = detectAnomalies(txns);
  assert.equal(a.length, 1);
  assert.equal(a[0].amount, -18999);
  assert.equal(a[0].basis, "merchant");
});

test("summarize excludes transfers and investments from spend; refunds reduce spend", () => {
  const s = summarize([
    mk("2026-01-01", "Acme", 100000, "Income"), mk("2026-01-02", "Shop", -5000, "Shopping"),
    mk("2026-01-03", "Shop", 1000, "Shopping"), mk("2026-01-04", "Zerodha", -20000, "Investments"),
    mk("2026-01-05", "Friend", -3000, "Transfers"),
  ]);
  assert.equal(s.spend, 4000);
  assert.equal(s.invested, 20000);
  assert.equal(s.savingsRate, 96);
});

test("end to end on the synthetic statement finds the planted insights", () => {
  const a = analyze(sampleStatement());
  assert.ok(a.txns.length > 300);
  assert.deepEqual(a.skipped, []);
  const names = a.recurring.map(r => r.merchant);
  for (const m of ["Netflix", "Spotify", "Nobroker Rent", "Google One", "Airtel Postpaid"]) assert.ok(names.includes(m), m);
  assert.equal(a.recurring.find(r => r.merchant === "Google One").cadence, "Quarterly");
  assert.equal(a.recurring.find(r => r.merchant === "Airtel Postpaid").priceChange, 100);
  assert.ok(a.duplicates.some(d => d.merchant === "Swiggy" && d.amount === 487));
  assert.ok(a.anomalies.some(t => t.amount === -18999));
  assert.equal(a.summary.monthly.length, 6);
  assert.ok(a.summary.monthly.every(m => m.income >= 118500));
});

test("toCSV escapes commas and quotes", () => {
  const out = toCSV([{ date: "2026-01-01", merchant: 'A "B"', category: "Other", amount: -1, description: "x,y" }]);
  assert.equal(out.split("\n")[1], '2026-01-01,"A ""B""",Other,-1,"x,y"');
});
