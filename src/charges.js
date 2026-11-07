// PaisaTrail charges engine. Finds bank charges in a statement and checks them
// against specific RBI rules. Pure functions, no DOM, no network.

import { readStatement } from "./statement.js";
import { RULES } from "./rules.js";

export const ATM_CAP = 23;            // ₹ per transaction, excluding GST, from 1 May 2025
export const ATM_CAP_FROM = "2025-05-01";
export const NEFT_FREE_FROM = "2020-01-01";
const GST = 0.18;
const round2 = x => Math.round(x * 100) / 100;

// Order matters: the first matching type wins. GST lines are handled separately.
export const CHARGE_TYPES = [
  { type: "min_balance", label: "Minimum-balance penalty", re: /min(imum)?\.?\s*(avg\.?\s*)?bal|non[\s.-]*maint|\b(amb|mab|aqb|qab)\b|avg\.?\s*bal(ance)?\s*(chg|charge|fee)|bal(ance)?\s*shortfall/i },
  { type: "debit_card", label: "Debit card fee", re: /(debit|atm|dc)\s*card.*(annual|issu|renew|amc|fee|chg)|\bdc\s*(amc|annual|fee)\b|card\s*(amc|annual\s*fee)/i },
  { type: "atm", label: "ATM transaction charge", re: /\batm\b.*\b(chgs?|chrgs?|charges?|fee)\b|\b(chgs?|chrgs?|charges?|fee)\b.*\batm\b|\b(atw|nfs|nwd)\b.*\b(chg|fee)\b|excess\s*(atm|txn|withdrawal)/i },
  { type: "sms", label: "SMS alert charge", re: /\bsms\b/i },
  { type: "neft", label: "NEFT / RTGS / IMPS charge", re: /\b(neft|rtgs|imps)\b.*\b(chgs?|chrgs?|charges?|comm|fee)\b|\b(chgs?|chrgs?|charges?|fee)\b.*\b(neft|rtgs|imps)\b/i },
  { type: "return", label: "Return / bounce charge", re: /\b(ecs|nach|ach|si|che?q(ue)?|mandate)\b.*\b(rtn|return|bounce|dishono?u?r)|insuff(icient)?\s*(bal|fund)s?.*\b(chg|charge|fee)\b/i },
  { type: "cheque_book", label: "Cheque book charge", re: /che?q(ue)?\s*b(oo)?k/i },
  { type: "cash", label: "Cash handling charge", re: /cash\s*(handling|dep(osit)?|tran(saction)?).*\b(chg|charges?|fee)\b/i },
  { type: "service", label: "Account / service charge", re: /folio|ledger\s*fee|acc?(ou)?n?t\.?\s*maint|service\s*(chgs?|charges?)|consolidated\s*(chgs?|charges?)|annual\s*maint/i },
  { type: "insurance_scheme", label: "Govt. insurance / pension scheme", re: /\b(pmsby|pmjjby|apy)\b|jeevan\s*jyoti|suraksha\s*bima|atal\s*pension/i },
  { type: "other", label: "Other bank charge", re: /\b(chg|chgs|chrg|charges?|fee|penalty|penal)\b/i },
];
const GST_RE = /\b(gst|igst|cgst|sgst|utgst|service\s*tax)\b/i;
const ATM_WITHDRAWAL_RE = /\b(atm|atw|nwd|nfs)\b|cash\s*w(ith)?d(raw)?a?l/i;
const NOT_A_CHARGE_RE = /^(upi|neft\s*cr|imps\s*cr|rtgs\s*cr)\b|salary|refund|reversal|cashback/i;
const ONLINE_RE = /\b(inb|net\s*banking|netbanking|ib|mb|mob(ile)?|online|internet)\b/i;

/** Classifies one debit row. Returns { kind: "charge"|"gst"|"atm_withdrawal"|null, type, label } */
export function classify(row) {
  if (row.amount >= 0) return { kind: null };
  const d = row.description;
  if (GST_RE.test(d) && !/\b(paid|payment|challan)\b/i.test(d)) return { kind: "gst", type: "gst", label: "GST on charges" };
  if (!NOT_A_CHARGE_RE.test(d)) {
    for (const c of CHARGE_TYPES) if (c.re.test(d)) return { kind: "charge", type: c.type, label: c.label };
  }
  if (ATM_WITHDRAWAL_RE.test(d)) return { kind: "atm_withdrawal" };
  return { kind: null };
}

/**
 * Pairs each GST line with the charge it was levied on: same date (or the next day),
 * amount ≈ 18% of the charge. Returns Map(chargeLine → gstRow).
 */
function pairGst(charges, gstRows) {
  const pairs = new Map(), used = new Set();
  for (const c of charges) {
    const expected = -c.amount * GST;
    const g = gstRows.find(g => !used.has(g.line) && Math.abs(Date.parse(g.date) - Date.parse(c.date)) <= 86400000 && Math.abs(-g.amount - expected) <= Math.max(0.6, expected * 0.03));
    if (g) { pairs.set(c.line, g); used.add(g.line); }
  }
  return { pairs, unpaired: gstRows.filter(g => !used.has(g.line)) };
}

/**
 * @param {string} text  statement CSV
 * @param {{accountType?: "regular"|"bsbda"|"zero_balance"}} opts
 */
export function auditStatement(text, opts = {}) {
  const accountType = opts.accountType || "regular";
  const { rows, skipped, hasBalance } = readStatement(text);
  const charges = [], gstRows = [], atmByMonth = new Map();
  for (const r of rows) {
    const c = classify(r);
    if (c.kind === "charge") charges.push({ ...r, type: c.type, label: c.label });
    else if (c.kind === "gst") gstRows.push(r);
    else if (c.kind === "atm_withdrawal") { const m = r.date.slice(0, 7); atmByMonth.set(m, (atmByMonth.get(m) || 0) + 1); }
  }
  const { pairs, unpaired } = pairGst(charges, gstRows);
  for (const c of charges) {
    const g = pairs.get(c.line);
    c.gst = g ? -g.amount : 0;
    c.gstLine = g ? g.line : null;
    c.base = -c.amount;
    c.total = c.base + c.gst;
  }
  const separateGst = pairs.size > 0;

  const findings = [];
  const add = (status, id, title, detail, rule, action, evidence, refundable) =>
    findings.push({ status, id, title, detail, rule: RULES[rule], action, evidence, amount: round2(evidence.reduce((a, e) => a + e.disputed, 0)), refundable });
  const ev = (c, disputed = c.total, note = "") => ({ line: c.line, date: c.date, description: c.description, base: c.base, gst: c.gst, disputed: round2(disputed), note });
  const fmt = n => (n < 0 ? "−" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const minBal = charges.filter(c => c.type === "min_balance");
  // 1. Minimum-balance charge on an account that shouldn't have one.
  if (accountType !== "regular" && minBal.length) {
    add("issue", "minbal_not_applicable", `${minBal.length} minimum-balance charge${minBal.length > 1 ? "s" : ""} on a ${accountType === "bsbda" ? "BSBD" : "zero-balance"} account`,
      accountType === "bsbda" ? "A Basic Savings Bank Deposit account has no minimum-balance requirement, so no penalty should apply."
        : "You said this is a zero-balance account (for example a salary account). If it still qualifies as zero-balance, a minimum-balance penalty shouldn't apply. Check whether the bank converted it to a regular account.",
      accountType === "bsbda" ? "bsbda" : "minBalance", "Ask the bank to reverse these charges and the GST on them.", minBal.map(c => ev(c)), true);
  } else if (minBal.length) {
    // 2. Penalty that pushed the balance below zero.
    const negative = hasBalance ? minBal.filter(c => c.balance !== null && c.balance < 0) : [];
    if (negative.length) {
      add("issue", "minbal_negative", `Minimum-balance penalty pushed your balance below zero ${negative.length} time${negative.length > 1 ? "s" : ""}`,
        "RBI says a savings account balance must not turn negative solely because of minimum-balance charges. The amount that took the balance below zero shouldn't have been charged.",
        "minBalance", "Ask the bank to reverse the part of each charge that made the balance negative, plus the GST on it.",
        negative.map(c => ev(c, Math.min(c.base, -c.balance) * (1 + (c.gst ? GST : 0)), `balance after: ${fmt(c.balance)}`)), true);
    }
    // 3. Proportionality and notice can't be verified from a statement alone.
    const rest = minBal.filter(c => !negative.includes(c));
    if (rest.length) {
      add("check", "minbal_verify", `${rest.length} minimum-balance charge${rest.length > 1 ? "s" : ""} to verify (${fmt(rest.reduce((a, c) => a + c.total, 0))})`,
        "These are allowed only if the bank notified you first and gave you a month to restore the balance, and if the amount is proportionate to the shortfall. A flat penalty regardless of shortfall isn't proportionate.",
        "minBalance", "Ask the bank for the notice it sent and how each charge was calculated from your shortfall.", rest.map(c => ev(c)), false);
    }
  }

  // 4. ATM charges.
  const atm = charges.filter(c => c.type === "atm");
  if (atm.length) {
    const lowUse = atm.filter(c => (atmByMonth.get(c.date.slice(0, 7)) || 0) <= 3);
    if (lowUse.length) {
      add("issue", "atm_within_free", `ATM charged in a month with ${Math.max(...lowUse.map(c => atmByMonth.get(c.date.slice(0, 7)) || 0))} or fewer ATM withdrawals`,
        "Every customer gets at least 3 free ATM transactions a month (5 at your own bank's ATMs, 3–5 at other banks'). These charges came in months where the statement shows 3 or fewer ATM withdrawals.",
        "atm", "Ask the bank which transactions exceeded your free limit. Balance enquiries also count, so it may list some.",
        lowUse.map(c => ev(c, c.total, `${atmByMonth.get(c.date.slice(0, 7)) || 0} ATM withdrawal(s) that month`)), true);
    }
    const overCap = atm.filter(c => !lowUse.includes(c) && c.date >= ATM_CAP_FROM && (separateGst ? c.base > ATM_CAP + 0.01 : c.base > ATM_CAP * (1 + GST) + 0.01));
    if (overCap.length) {
      add("issue", "atm_over_cap", `${overCap.length} ATM charge${overCap.length > 1 ? "s" : ""} above the ₹${ATM_CAP} cap`,
        `From 1 May 2025, banks may charge at most ₹${ATM_CAP} per ATM transaction beyond the free limit (plus GST).`,
        "atm", "Ask the bank to refund the amount above the cap.",
        overCap.map(c => { const capBase = separateGst ? ATM_CAP : ATM_CAP * (1 + GST); const over = c.base - capBase; return ev(c, over * (c.gst ? 1 + GST : 1), `cap ${fmt(capBase)}`); }), true);
    }
    const restAtm = atm.filter(c => !overCap.includes(c) && !lowUse.includes(c));
    if (restAtm.length && accountType === "bsbda") {
      const within4 = restAtm.filter(c => (atmByMonth.get(c.date.slice(0, 7)) || 0) <= 4);
      if (within4.length) add("issue", "bsbda_withdrawals", "ATM charge within a BSBD account's four free withdrawals",
        "BSBD accounts get at least four free withdrawals a month, including ATM withdrawals.", "bsbda", "Ask the bank to reverse these charges.", within4.map(c => ev(c)), true);
    }
  }

  // 5. NEFT charges on a savings account.
  const neft = charges.filter(c => c.type === "neft" && /neft/i.test(c.description) && c.date >= NEFT_FREE_FROM);
  if (neft.length) {
    const online = neft.filter(c => ONLINE_RE.test(c.description));
    const unknown = neft.filter(c => !online.includes(c));
    if (online.length) add("issue", "neft_online", `${online.length} charge${online.length > 1 ? "s" : ""} for online NEFT transfers`,
      "Since 1 Jan 2020, banks may not charge savings account holders for NEFT transfers made through internet or mobile banking. The narration marks these as online.",
      "neft", "Ask the bank to reverse them.", online.map(c => ev(c)), true);
    if (unknown.length) add("check", "neft_verify", `${unknown.length} NEFT charge${unknown.length > 1 ? "s" : ""}: free if you sent the transfer online`,
      "Online NEFT from a savings account is free. Branch-initiated NEFT can be charged.", "neft",
      "If you made these transfers through net banking or the app, ask for a reversal.", unknown.map(c => ev(c)), false);
  }

  // 6. BSBDA: card and cheque book must be free.
  if (accountType === "bsbda") {
    const free = charges.filter(c => c.type === "debit_card" || c.type === "cheque_book");
    if (free.length) add("issue", "bsbda_free_services", "Fees for services that are free on a BSBD account",
      "BSBD accounts must get a free ATM-cum-debit card and a free cheque book (at least 25 leaves a year).", "bsbda",
      "Ask the bank to reverse these fees.", free.map(c => ev(c)), true);
  }

  // 7. The same charge twice in one month (skip charges already disputed above).
  const alreadyDisputed = new Set(findings.filter(f => f.refundable).flatMap(f => f.evidence.map(e => e.line)));
  const seen = new Map(), dupes = [];
  for (const c of charges) {
    if (!["min_balance", "sms", "debit_card", "service"].includes(c.type)) continue;
    if (alreadyDisputed.has(c.line)) continue;
    const key = `${c.type}|${c.date.slice(0, 7)}|${c.base}`;
    if (seen.has(key)) dupes.push(c); else seen.set(key, c);
  }
  if (dupes.length) add("issue", "duplicate", `${dupes.length} charge${dupes.length > 1 ? "s" : ""} levied twice in the same month`,
    "The same periodic charge, for the same amount, appears twice in one month. That's usually a processing error.", null,
    "Ask the bank to reverse the duplicate.", dupes.map(c => ev(c)), true);

  // 8. Government schemes: legitimate if you enrolled.
  const schemes = charges.filter(c => c.type === "insurance_scheme");
  if (schemes.length) add("info", "schemes", "Government insurance or pension premiums were auto-debited",
    "PMSBY, PMJJBY and APY premiums are auto-debited once you enrol. If you never enrolled, ask the bank for the enrolment form.", null,
    "Confirm you opted in. If not, ask for the enrolment record and a refund.", schemes.map(c => ev(c, 0)), false);

  const order = { issue: 0, check: 1, info: 2, ok: 3 };
  findings.sort((a, b) => order[a.status] - order[b.status] || b.amount - a.amount);

  const totalCharges = charges.filter(c => c.type !== "insurance_scheme").reduce((a, c) => a + c.total, 0) + unpaired.reduce((a, g) => a - g.amount, 0);
  const months = new Set(rows.map(r => r.date.slice(0, 7))).size || 1;
  const disputable = findings.filter(f => f.refundable).reduce((a, f) => a + f.amount, 0);
  const toVerify = findings.filter(f => f.status === "check").reduce((a, f) => a + f.amount, 0);
  const byType = {};
  for (const c of charges) (byType[c.label] ??= { count: 0, total: 0 }), byType[c.label].count++, byType[c.label].total += c.total;

  return {
    accountType, rows: rows.length, skipped, hasBalance, months,
    range: rows.length ? { from: rows[0].date, to: rows.at(-1).date } : null,
    charges, unpairedGst: unpaired, findings,
    summary: {
      totalCharges: round2(totalCharges), perYear: round2(totalCharges / months * 12),
      disputable: round2(disputable), toVerify: round2(toVerify),
      issues: findings.filter(f => f.status === "issue").length,
      byType: Object.entries(byType).map(([label, v]) => ({ label, count: v.count, total: round2(v.total) })).sort((a, b) => b.total - a.total),
    },
  };
}

/** Plain-text dispute letter to the bank. Nothing is sent from the page. */
export function disputeLetter(result, meta = {}) {
  const issues = result.findings.filter(f => f.refundable);
  const fmt = n => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines = [
    `To: The Branch Manager / Grievance Redressal Officer, ${meta.bank || "[Bank name]"}`,
    `Subject: Request to reverse charges – savings account ${meta.account || "[account number, last 4 digits]"}`,
    "",
    "Dear Sir/Madam,",
    "",
    `I have reviewed my account statement for ${result.range ? `${result.range.from} to ${result.range.to}` : "the recent period"} and request a reversal of the following charges, which appear inconsistent with RBI instructions:`,
    "",
  ];
  issues.forEach((f, i) => {
    lines.push(`${i + 1}. ${f.title}. ${f.detail}`);
    if (f.rule) lines.push(`   Reference: ${f.rule.name} (${f.rule.ref}).`);
    for (const e of f.evidence) lines.push(`   - ${e.date}  ${e.description}  ${fmt(e.base)}${e.gst ? ` + GST ${fmt(e.gst)}` : ""}  → reversal requested: ${fmt(e.disputed)}`);
    lines.push("");
  });
  lines.push(`Total reversal requested: ${fmt(issues.reduce((a, f) => a + f.amount, 0))}.`, "",
    "Please reverse these amounts, including the GST charged on them, and confirm in writing. If this is not resolved within 30 days, I may approach the RBI Ombudsman under the Integrated Ombudsman Scheme, 2021 (cms.rbi.org.in).",
    "", "Regards,", meta.name || "[Your name]");
  return lines.join("\n");
}
