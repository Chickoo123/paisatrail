// Deterministic synthetic savings-account statement (HDFC-style columns) used by the
// demo and the tests. All names, references and amounts are fictional. The charges
// are modelled on narrations commonly seen in Indian bank statements.

export function sampleStatement() {
  const rows = [];
  let bal = 18450.25;
  let ref = 400100200300;
  const fmt = iso => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y.slice(2)}`; };
  const add = (date, narration, amount) => {
    bal = Math.round((bal + amount) * 100) / 100;
    rows.push([fmt(date), narration, String(ref++), fmt(date), amount < 0 ? (-amount).toFixed(2) : "", amount > 0 ? amount.toFixed(2) : "", bal.toFixed(2)]);
  };
  const charge = (date, narration, base) => { add(date, narration, -base); add(date, `IGST @18% ON ${narration.split(" ")[0]} CHGS`, -Math.round(base * 18) / 100); };

  // May 2026: normal month, balance healthy.
  add("2026-05-01", "NEFT CR-HDFC0000001-ACME SOFTWARE PVT LTD-SALARY MAY", 42000);
  add("2026-05-03", "UPI/612300001111/NOBROKER RENT/rent@ybl/Rent", -18000);
  add("2026-05-06", "ATW-4111XXXXXX1111-S1ANAM12-PUNE", -5000);
  add("2026-05-09", "UPI/612300002222/BIGBASKET/bigbasket@okhdfc/Groceries", -3400);
  add("2026-05-14", "ATW-4111XXXXXX1111-S1ANAM12-PUNE", -3000);
  charge("2026-05-31", "ATM CHGS 2 TXNS MAY26", 25); // over the ₹23 cap, and only 2 withdrawals that month
  add("2026-05-20", "NEFT DR-ICIC0000002-MOTHER-NETBANKING", -6000);
  charge("2026-05-20", "NEFT CHGS INB 0520", 2.5); // online NEFT from savings: free since 2020
  add("2026-05-25", "UPI/612300003333/SWIGGY/swiggy@icici/Payment", -640);

  // June 2026: spending runs the balance down; quarterly SMS charge; debit card fee.
  add("2026-06-01", "NEFT CR-HDFC0000001-ACME SOFTWARE PVT LTD-SALARY JUN", 42000);
  add("2026-06-02", "UPI/612300004444/NOBROKER RENT/rent@ybl/Rent", -18000);
  add("2026-06-05", "UPI/612300005555/AMAZON PAY/amazon@apl/Payment", -24999);
  add("2026-06-10", "UPI/612300006666/ZOMATO/zomato@hdfcbank/Food", -820);
  charge("2026-06-15", "SMS CHGS QTR APR-JUN26", 15);
  charge("2026-06-15", "SMS CHGS QTR APR-JUN26", 15); // levied twice
  charge("2026-06-18", "DEBIT CARD ANNUAL FEE 4111XX1111", 500);
  add("2026-06-20", "PMSBY RENEWAL PREMIUM", -20);
  add("2026-06-22", "UPI/612300007777/AIRTEL/airtel@ybl/Recharge", -3999);
  add("2026-06-26", "UPI/612300008888/MYNTRA/myntra@ybl/Shopping", -3500);

  // July 2026: average balance short → minimum-balance penalty, one pushing balance negative.
  add("2026-07-01", "NEFT CR-HDFC0000001-ACME SOFTWARE PVT LTD-SALARY JUL", 42000);
  add("2026-07-02", "UPI/612300009999/NOBROKER RENT/rent@ybl/Rent", -18000);
  add("2026-07-04", "NEFT DR-SBIN0000003-CARD PAYMENT-BRANCH", -24000);
  charge("2026-07-04", "NEFT CHGS 0704", 5); // channel unknown → verify
  add("2026-07-07", "ATW-4111XXXXXX1111-S1ANAM12-PUNE", -2000);
  charge("2026-07-08", "NON MAINTENANCE OF AMB CHGS JUN26", 600);
  add("2026-07-12", "UPI/612300010000/BLINKIT/blinkit@ybl/Groceries", -620);
  add("2026-07-30", "UPI/612300011111/LIC PREMIUM/lic@sbi/Policy", -1500);
  add("2026-07-21", "UPI/612300011122/CROMA/croma@hdfcbank/Electronics", -8100);

  // August 2026: salary late; balance near zero when the next penalty hits.
  add("2026-08-03", "UPI/612300012222/BESCOM/bescom@ybl/Electricity", -1300);
  charge("2026-08-06", "NON MAINTENANCE OF AMB CHGS JUL26", 600); // this one takes the balance below zero
  add("2026-08-12", "NEFT CR-HDFC0000001-ACME SOFTWARE PVT LTD-SALARY AUG", 42000);
  add("2026-08-13", "UPI/612300013333/NOBROKER RENT/rent@ybl/Rent", -18000);
  add("2026-08-20", "NACH DR-BAJAJ FINANCE-EMI", -7850);
  add("2026-08-28", "UPI/612300014444/SWIGGY/swiggy@icici/Payment", -410);

  rows.sort((a, b) => a[0].split("/").reverse().join("").localeCompare(b[0].split("/").reverse().join("")));
  // Recompute running balance after sorting so the Balance column is consistent.
  let run = 18450.25;
  for (const r of rows) { run = Math.round((run - (Number(r[4]) || 0) + (Number(r[5]) || 0)) * 100) / 100; r[6] = run.toFixed(2); }
  const header = ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"];
  const q = v => (/[",]/.test(v) ? `"${v}"` : v);
  return ["SAMPLE BANK - STATEMENT OF ACCOUNT (synthetic demo data)", "Account: Regular Savings XXXXXXXX1234", "", header.join(","), ...rows.map(r => r.map(q).join(","))].join("\n");
}
