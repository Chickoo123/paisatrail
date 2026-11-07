// Deterministic synthetic statement (HDFC-style columns) for the demo and tests.
// All names, references and amounts are fictional.

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function sampleStatement(months = 6, start = "2026-05-01") {
  const r = rng(42);
  const rows = [];
  const base = Date.parse(start);
  const day = n => new Date(base + n * 86400000);
  const fmt = d => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
  const ref = () => String(Math.floor(r() * 9e11) + 1e11);
  const push = (d, narr, debit, credit) => rows.push([fmt(d), narr, ref(), fmt(d), debit ? debit.toFixed(2) : "", credit ? credit.toFixed(2) : ""]);
  const s0 = new Date(base);
  const md = (m, k) => new Date(Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth() + m, 1 + k));
  const total = Math.round((md(months, 0) - base) / 86400000);
  const mon = d => d.toLocaleString("en", { month: "short", timeZone: "UTC" }).toUpperCase();

  for (let m = 0; m < months; m++) {
    push(md(m, 0), `NEFT CR-HDFC0000001-ACME SOFTWARE PVT LTD-SALARY ${mon(md(m, 0))}`, 0, 118500);
    push(md(m, 2), `UPI/${ref()}/NOBROKER RENT/rent@ybl/Rent`, 26000);
    push(md(m, 4), `ACH D- BAJAJ FINANCE LTD EMI-${ref()}`, 7850);
    push(md(m, 5), `UPI/${ref()}/ZERODHA COIN SIP/zerodha@hdfcbank/SIP`, 15000);
    push(md(m, 7), `POS 4111XXXXXX1111 NETFLIX.COM`, 649);
    push(md(m, 9), `UPI/${ref()}/SPOTIFY INDIA/spotify@icici/Sub`, 119);
    push(md(m, 11), `UPI/${ref()}/AIRTEL POSTPAID/airtel@ybl/Bill`, m >= 4 ? 699 : 599);
    push(md(m, 13), `BBPS/${ref()}/BESCOM ELECTRICITY`, Math.round(1400 + r() * 900));
    push(md(m, 15), `UPI/${ref()}/CULT FIT/cultfit@axl/Membership`, 1499);
    if (m % 3 === 1) push(md(m, 20), `POS 4111XXXXXX1111 GOOGLE ONE`, 650);
    push(md(m, 18), `UPI/${ref()}/LINKEDIN PREMIUM/linkedin@hdfc/Sub`, 1567);
  }
  const everyday = [
    ["SWIGGY", "swiggy@icici", 180, 650, 14], ["ZOMATO", "zomato@hdfcbank", 200, 750, 9],
    ["BLINKIT", "blinkit@ybl", 250, 1400, 10], ["BIGBASKET", "bigbasket@okhdfc", 900, 2600, 3],
    ["UBER INDIA", "uber@axis", 120, 520, 10], ["RAPIDO", "rapido@ybl", 45, 160, 6],
    ["AMAZON PAY", "amazon@apl", 300, 3200, 4], ["MYNTRA", "myntra@ybl", 700, 2800, 1],
    ["APOLLO PHARMACY", "apollo@icici", 150, 900, 1], ["HPCL PETROL PUMP", "hpcl@sbi", 500, 1500, 3],
    ["BOOKMYSHOW", "bms@icici", 300, 900, 1], ["RAMESH KUMAR", "9876543210@paytm", 100, 1500, 4],
  ];
  for (const [name, handle, lo, hi, perMonth] of everyday) {
    const n = Math.round(perMonth * months * (0.8 + r() * 0.4));
    for (let i = 0; i < n; i++) push(day(Math.floor(r() * total)), `UPI/${ref()}/${name}/${handle}/Payment`, Math.round(lo + r() * (hi - lo)));
  }
  // Teaching moments: a double charge, a one-off spike, a refund and interest.
  push(day(47), `UPI/${ref()}/SWIGGY/swiggy@icici/Payment`, 487);
  push(day(47), `UPI/${ref()}/SWIGGY/swiggy@icici/Payment`, 487);
  push(day(101), `UPI/${ref()}/AMAZON PAY/amazon@apl/Payment`, 18999);
  push(day(110), `UPI/${ref()}/AMAZON REFUND/amazon@apl/Refund`, 0, 1299);
  push(day(150), `ATW-4111XXXXXX1111-ATM CASH WITHDRAWAL`, 5000);
  push(day(89), `INT.PD:SAVINGS INTEREST CREDIT`, 0, 842);

  rows.sort((a, b) => { const p = s => s.split("/").reverse().join(""); return p(a[0]).localeCompare(p(b[0])); });
  const header = ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt."];
  const q = v => /[",]/.test(v) ? `"${v}"` : v;
  return ["SAMPLE BANK - STATEMENT OF ACCOUNT (synthetic demo data)", "Account No: XXXXXXXX1234", "", header.join(","), ...rows.map(x => x.map(q).join(","))].join("\n");
}
