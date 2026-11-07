// PaisaTrail core: pure, dependency-free statement analysis.
// Everything here runs in the browser (and in Node for tests). No network calls.

// ---------- CSV ----------
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(v => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v.trim() !== "")) rows.push(row);
  return rows;
}

// ---------- Values ----------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** Parses Indian bank date formats. Day-first is assumed for ambiguous dates. Returns "YYYY-MM-DD" or null. */
export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i, "");
  let y, m, d, match;
  if ((match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) [, y, m, d] = match.map(Number), m--;
  else if ((match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    [, d, m, y] = match.map(Number); m--;
    if (y < 100) y += 2000;
  } else if ((match = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]*(\d{2,4})$/))) {
    const mn = match[2].toLowerCase();
    d = Number(match[1]); m = MONTHS[mn] ?? MONTHS[mn.slice(0, 3)]; y = Number(match[3]);
    if (y < 100) y += 2000;
  } else return null;
  if (m === undefined || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** "₹1,23,456.50" → 123456.5 ; "(500)" → -500 ; "500 Dr" → -500 ; "" → null */
export function parseAmount(raw) {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (!s || s === "-") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\bdr\.?$/i.test(s)) { sign = -1; s = s.replace(/\bdr\.?$/i, ""); }
  s = s.replace(/\bcr\.?$/i, "");
  s = s.replace(/[₹,\s]|INR|Rs\.?/gi, "");
  if (s.startsWith("-")) { sign *= -1; s = s.slice(1); }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  return sign * Number(s);
}

// ---------- Column detection ----------
const COLS = {
  date: /^(txn |transaction |value |posting )?date|^date$/i,
  desc: /narration|description|particulars|remarks|details|transaction details/i,
  debit: /withdrawal|debit|dr\b|paid out|money out/i,
  credit: /deposit|credit|cr\b|paid in|money in/i,
  amount: /^amount|amt\b|transaction amount/i,
  type: /^(type|dr\s*\/\s*cr|cr\s*\/\s*dr|txn type)$/i,
};

/** Finds the header row (banks often prepend account info) and maps columns. */
export function detectColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const header = rows[r].map(h => h.trim());
    const find = (re, exclude = []) => header.findIndex((h, i) => re.test(h) && !exclude.includes(i));
    const date = find(COLS.date);
    const desc = find(COLS.desc);
    if (date < 0 || desc < 0) continue;
    const type = find(COLS.type, [date, desc]); // "Dr/Cr" must not be mistaken for a debit column
    const debit = find(COLS.debit, [date, desc, type]);
    const credit = find(COLS.credit, [date, desc, type, debit]);
    const amount = find(COLS.amount, [date, desc, type, debit, credit]);
    if ((debit >= 0 && credit >= 0) || amount >= 0) return { headerRow: r, date, desc, debit, credit, amount, type };
  }
  return null;
}

// ---------- Merchant normalisation ----------
const UPI_HANDLE = /@[a-z0-9.]+/i;
const DOMAIN_SUFFIXES = [".com", ".in", ".co"];
/** "NETFLIX.COM" → "NETFLIX" (a suffix check, not a regex replacement). */
function stripDomain(word) {
  const lower = word.toLowerCase();
  const suffix = DOMAIN_SUFFIXES.find(t => lower.endsWith(t) && lower.length > t.length);
  return suffix ? word.slice(0, -suffix.length) : word;
}

/** Extracts a readable merchant from UPI/NEFT/IMPS/POS narrations. */
export function normalizeMerchant(narration) {
  let s = String(narration || "").trim();
  const upi = s.match(/^UPI[-/](?:DR[-/]|CR[-/])?(?:\d{6,}[-/])?([^/]+?)(?:[-/]|$)/i);
  if (upi && !/^\d+$/.test(upi[1])) s = upi[1];
  else if (/^(NEFT|IMPS|RTGS)/i.test(s)) {
    const parts = s.split(/[-/:]/).map(p => p.trim()).filter(p => p && !/^\d+$/.test(p) && !/^((NEFT|IMPS|RTGS)( (CR|DR))?|CR|DR|[A-Z]{4}0[A-Z0-9]{6}|N\d+|P2A|P2P)$/i.test(p));
    if (parts.length) s = parts[0];
  } else if (/^(POS|PCD|ECOM|VIN|ATW|NWD|ACH|NACH|BBPS|BIL|INT\.?PD)\b/i.test(s)) {
    s = s.replace(/^(POS|PCD|ECOM|VIN|ATW|NWD|ACH|NACH|BBPS|BIL|INT\.?PD)[\s/:-]*([DC]-\s*)?(\d{4,}X*\d*[\s/:-]*)?/i, "");
  }
  s = s.replace(UPI_HANDLE, "").replace(/\b\d{5,}\b/g, "").replace(/[*_#/]+/g, " ");
  s = s.split(/\s+/).map(stripDomain).join(" ")
    .replace(/\b(pvt|private|ltd|limited|india|technologies|payments?|online|services)\b\.?/gi, "")
    // Allowlist: merchant names are display text only, never markup.
    .replace(/[^\p{L}\p{N} &'+.-]/gu, " ")
    .replace(/[-/.]+$/g, "").replace(/\s+/g, " ").trim();
  if (!s) return "Unknown";
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).slice(0, 40);
}

// ---------- Categorisation ----------
export const CATEGORIES = {
  "Food & Dining": ["swiggy", "zomato", "dominos", "domino", "mcdonald", "kfc", "pizza", "starbucks", "cafe", "restaurant", "eatclub", "dunzo daily", "chaayos", "haldiram", "burger"],
  Groceries: ["bigbasket", "blinkit", "zepto", "dmart", "grofers", "jiomart", "more retail", "reliance fresh", "instamart", "nature basket", "supermarket", "kirana"],
  Shopping: ["amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "tata cliq", "croma", "reliance digital", "decathlon", "ikea", "lenskart"],
  Transport: ["uber", "ola", "rapido", "metro", "irctc", "redbus", "fastag", "namma yatri", "blusmart", "parking"],
  Fuel: ["petrol", "fuel", "hpcl", "bpcl", "indian oil", "iocl", "shell", "nayara"],
  Travel: ["makemytrip", "goibibo", "indigo", "air india", "vistara", "akasa", "cleartrip", "oyo", "airbnb", "booking.com", "ixigo"],
  "Bills & Utilities": ["electricity", "bescom", "msedcl", "tata power", "adani", "airtel", "jio", "vodafone", "vi", "bsnl", "act fibernet", "broadband", "gas", "water bill", "bbps", "recharge", "mahanagar"],
  Subscriptions: ["netflix", "spotify", "hotstar", "prime video", "amazon prime", "youtube", "google one", "icloud", "apple", "sonyliv", "zee5", "jiocinema", "audible", "chatgpt", "openai", "notion", "linkedin", "github", "adobe", "canva"],
  "Rent & Housing": ["rent", "nobroker", "maintenance", "society", "housing"],
  "EMI & Loans": ["emi", "loan", "bajaj fin", "home credit", "hdfc ltd", "lic housing", "credit card payment", "cc payment", "cred", "slice", "lazypay", "simpl"],
  Investments: ["zerodha", "groww", "upstox", "indmoney", "kuvera", "coin", "mutual fund", "sip", "ppf", "nps", "angel one", "smallcase", "bse star", "mf utilities", "fd booking"],
  Insurance: ["insurance", "lic", "policybazaar", "acko", "hdfc ergo", "icici lombard", "star health", "digit", "max life", "tata aia"],
  Health: ["pharmacy", "apollo", "1mg", "pharmeasy", "netmeds", "hospital", "clinic", "practo", "diagnostic", "medplus", "cult.fit", "cultfit", "gym"],
  Education: ["school", "college", "university", "udemy", "coursera", "byju", "unacademy", "fees", "tuition", "exam"],
  Entertainment: ["bookmyshow", "pvr", "inox", "steam", "playstation", "district", "paytm insider"],
  Cash: ["atm", "cash withdrawal", "atw", "nwd"],
  Income: ["salary", "sal", "payroll", "interest", "int.pd", "dividend", "refund", "cashback", "reversal"],
};

/** Returns a category for a transaction. User overrides (by merchant) win. */
const escapeRe = w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole-word matching, so "cred" never matches "credit" and "ola" never matches "coca-cola".
const MATCHERS = Object.entries(CATEGORIES).map(([cat, words]) =>
  [cat, new RegExp(`(?:^|[^a-z0-9])(?:${words.map(w => escapeRe(w.trim())).join("|")})(?![a-z0-9])`, "i")]);
const INCOME_RE = MATCHERS.find(([c]) => c === "Income")[1];

export function categorize(txn, overrides = {}) {
  if (overrides[txn.merchant]) return overrides[txn.merchant];
  const hay = `${txn.description} ${txn.merchant}`.toLowerCase();
  if (txn.amount > 0 && INCOME_RE.test(hay) && !/refund|reversal|cashback/.test(hay)) return "Income";
  for (const [cat, re] of MATCHERS) {
    if (cat === "Income") continue;
    if (re.test(hay)) return cat;
  }
  if (txn.amount > 0) return "Income";
  if (/^(upi|imps|neft)/i.test(txn.description)) return "Transfers";
  return "Other";
}

// ---------- Statement → transactions ----------
export function buildTransactions(text, overrides = {}) {
  const rows = parseCSV(text);
  const cols = detectColumns(rows);
  if (!cols) throw new Error("Could not find Date and Narration/Description columns. Export your statement as CSV with headers.");
  const txns = [];
  const skipped = [];
  for (let r = cols.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const date = parseDate(row[cols.date]);
    const description = (row[cols.desc] || "").replace(/\s+/g, " ").trim();
    let amount = null;
    if (cols.debit >= 0 && cols.credit >= 0) {
      const dr = parseAmount(row[cols.debit]), cr = parseAmount(row[cols.credit]);
      if (dr) amount = -Math.abs(dr);
      else if (cr) amount = Math.abs(cr);
    } else {
      amount = parseAmount(row[cols.amount]);
      if (amount !== null && cols.type >= 0) {
        const t = String(row[cols.type] || "").toLowerCase();
        if (/^d/.test(t)) amount = -Math.abs(amount);
        else if (/^c/.test(t)) amount = Math.abs(amount);
      }
    }
    if (!date || amount === null || amount === 0 || !description) {
      if (row.some(v => v.trim())) skipped.push(r + 1);
      continue;
    }
    const merchant = normalizeMerchant(description);
    const t = { id: txns.length, date, description, merchant, amount };
    t.category = categorize(t, overrides);
    txns.push(t);
  }
  txns.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return { txns, skipped, columns: cols };
}

// ---------- Insights ----------
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const median = xs => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
const NON_SPEND = new Set(["Income", "Investments", "Transfers"]);

/**
 * Recurring debits: same merchant, ≥3 occurrences (≥2 for yearly), stable cadence and
 * amounts within ±15% of the median. Returns cadence, typical amount, annualised cost, next date.
 */
export function detectRecurring(txns) {
  const groups = new Map();
  for (const t of txns) if (t.amount < 0) (groups.get(t.merchant) || groups.set(t.merchant, []).get(t.merchant)).push(t);
  const cadences = [
    { name: "Weekly", days: 7, tol: 2, perYear: 52, min: 4 },
    { name: "Monthly", days: 30, tol: 5, perYear: 12, min: 3 },
    { name: "Quarterly", days: 91, tol: 10, perYear: 4, min: 2 },
    { name: "Yearly", days: 365, tol: 20, perYear: 1, min: 2 },
  ];
  const out = [];
  for (const [merchant, list] of groups) {
    if (list.length < 2) continue;
    const gaps = list.slice(1).map((t, i) => daysBetween(list[i].date, t.date));
    const g = median(gaps);
    const cad = cadences.find(c => Math.abs(g - c.days) <= c.tol && list.length >= c.min);
    if (!cad) continue;
    const regular = gaps.filter(x => Math.abs(x - cad.days) <= cad.tol * 2).length / gaps.length;
    const amts = list.map(t => -t.amount);
    const typical = median(amts);
    const stable = amts.filter(a => Math.abs(a - typical) <= typical * 0.2).length / amts.length;
    if (regular < 0.7 || stable < 0.6) continue;
    const last = list[list.length - 1];
    const change = priceChange(amts);
    const current = change ? amts.at(-1) : typical; // project cost at the latest price
    out.push({
      merchant, category: last.category, cadence: cad.name, count: list.length,
      typicalAmount: round2(current), annualCost: round2(current * cad.perYear),
      lastDate: last.date, nextDate: addDays(last.date, Math.round(g)),
      priceChange: change,
    });
  }
  return out.sort((a, b) => b.annualCost - a.annualCost);
}

/** A settled new price: the last two charges match each other but differ (>2%) from the earlier norm. */
function priceChange(amts) {
  if (amts.length < 3) return 0;
  const [a, b] = amts.slice(-2);
  const before = median(amts.slice(0, -2));
  return a === b && Math.abs(b - before) > before * 0.02 ? round2(b - before) : 0;
}

/** Same merchant + same amount within `windowDays` → possible double charge. */
export function detectDuplicates(txns, windowDays = 2) {
  const out = [];
  const debits = txns.filter(t => t.amount < 0);
  for (let i = 0; i < debits.length; i++) {
    for (let j = i + 1; j < debits.length; j++) {
      const a = debits[i], b = debits[j];
      if (daysBetween(a.date, b.date) > windowDays) break;
      if (a.merchant === b.merchant && a.amount === b.amount && a.category !== "Transfers" && a.category !== "Cash")
        out.push({ first: a, second: b, amount: -a.amount, merchant: a.merchant });
    }
  }
  return out;
}

/** Spends far above the merchant/category norm (robust: median absolute deviation). */
export function detectAnomalies(txns, { minAmount = 2000, factor = 3.5 } = {}) {
  const spends = txns.filter(t => t.amount < 0 && !NON_SPEND.has(t.category));
  const group = key => {
    const g = new Map();
    for (const t of spends) (g.get(key(t)) || g.set(key(t), []).get(key(t))).push(-t.amount);
    return new Map([...g].filter(([, xs]) => xs.length >= 4).map(([k, xs]) => {
      const m = median(xs);
      return [k, { m, mad: median(xs.map(x => Math.abs(x - m))) || m * 0.5 }];
    }));
  };
  // Compare with the merchant's own history when there is enough of it, else the category.
  const byMerchant = group(t => t.merchant), byCategory = group(t => t.category);
  const out = [];
  for (const t of spends) {
    const s = byMerchant.get(t.merchant) || byCategory.get(t.category);
    if (-t.amount >= minAmount && s && -t.amount >= s.m * 2.5 && (-t.amount - s.m) / s.mad > factor)
      out.push({ ...t, typical: round2(s.m), basis: byMerchant.has(t.merchant) ? "merchant" : "category" });
  }
  return out;
}

export function summarize(txns) {
  const months = new Map();
  const cats = new Map();
  const merchants = new Map();
  let income = 0, spend = 0, invested = 0;
  for (const t of txns) {
    const k = t.date.slice(0, 7);
    const m = months.get(k) || months.set(k, { month: k, income: 0, spend: 0, invested: 0 }).get(k);
    if (t.amount > 0) {
      if (t.category === "Income") { m.income += t.amount; income += t.amount; }
      else if (!NON_SPEND.has(t.category)) { // refund / reversal back into a spend category
        m.spend -= t.amount; spend -= t.amount;
        cats.set(t.category, (cats.get(t.category) || 0) - t.amount);
      }
    } else if (t.category === "Investments") { m.invested -= t.amount; invested -= t.amount; }
    else if (t.category !== "Transfers") {
      m.spend -= t.amount; spend -= t.amount;
      cats.set(t.category, (cats.get(t.category) || 0) - t.amount);
      merchants.set(t.merchant, (merchants.get(t.merchant) || 0) - t.amount);
    }
  }
  const monthly = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map(m => ({ ...m, income: round2(m.income), spend: round2(m.spend), invested: round2(m.invested) }));
  return {
    income: round2(income), spend: round2(spend), invested: round2(invested),
    savingsRate: income > 0 ? round2(((income - spend) / income) * 100) : null,
    monthly,
    avgMonthlySpend: monthly.length ? round2(spend / monthly.length) : 0,
    categories: [...cats].map(([name, total]) => ({ name, total: round2(total) })).sort((a, b) => b.total - a.total),
    topMerchants: [...merchants].map(([name, total]) => ({ name, total: round2(total) })).sort((a, b) => b.total - a.total).slice(0, 8),
    range: txns.length ? { from: txns[0].date, to: txns.at(-1).date } : null,
  };
}

export function analyze(text, overrides = {}) {
  const { txns, skipped, columns } = buildTransactions(text, overrides);
  return { txns, skipped, columns, summary: summarize(txns), recurring: detectRecurring(txns), duplicates: detectDuplicates(txns), anomalies: detectAnomalies(txns) };
}

export function toCSV(txns) {
  const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return ["Date,Merchant,Category,Amount,Description", ...txns.map(t => [t.date, t.merchant, t.category, t.amount, t.description].map(esc).join(","))].join("\n");
}

function round2(x) { return Math.round(x * 100) / 100; }
