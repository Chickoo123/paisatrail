// PaisaTrail statement reader: parses Indian bank CSV exports. Pure, no network.

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
  balance: /balance|closing/i,
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
    const balance = find(COLS.balance, [date, desc, type, debit, credit, amount]);
    if ((debit >= 0 && credit >= 0) || amount >= 0) return { headerRow: r, date, desc, debit, credit, amount, type, balance };
  }
  return null;
}

// ---------- Statement → rows ----------
/**
 * Reads a bank statement CSV into rows: { line, date, description, amount, balance }.
 * amount < 0 is money out. balance is the running balance after the row (null if absent).
 */
export function readStatement(text) {
  const rows = parseCSV(text);
  const cols = detectColumns(rows);
  if (!cols) throw new Error("Couldn't find Date and Narration/Description columns. Export the statement as CSV with its header row.");
  const out = [], skipped = [];
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
    const balance = cols.balance >= 0 ? parseAmount(row[cols.balance]) : null;
    out.push({ line: r + 1, date, description, amount, balance });
  }
  return { rows: out, skipped, hasBalance: cols.balance >= 0 && out.some(r => r.balance !== null) };
}
