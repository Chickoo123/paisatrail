import { analyze, toCSV, CATEGORIES } from "./core.js";
import { sampleStatement } from "./sample.js";

const $ = s => document.querySelector(s);
const h = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n, d = 0) => "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
const compact = n => { const a = Math.abs(n); return a >= 1e7 ? "₹" + (a / 1e7).toFixed(2) + " Cr" : a >= 1e5 ? "₹" + (a / 1e5).toFixed(2) + " L" : a >= 1e3 ? "₹" + (a / 1e3).toFixed(1) + "k" : "₹" + Math.round(a); };
const fmtDate = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const monthLabel = ym => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

const CAT_LIST = [...Object.keys(CATEGORIES).filter(c => c !== "Income"), "Transfers", "Other", "Income"];
const PALETTE = ["#10b981", "#22d3ee", "#818cf8", "#f472b6", "#f59e0b", "#a3e635", "#fb7185", "#38bdf8", "#c084fc", "#fbbf24", "#34d399", "#94a3b8"];

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = { raw: null, result: null, overrides: store.get("pt-overrides", {}), cancelled: new Set(), q: "", cat: "" };

// ---------- Theme ----------
const theme = store.get("pt-theme", null);
if (theme) document.documentElement.dataset.theme = theme;
$("#theme").addEventListener("click", () => {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const cur = document.documentElement.dataset.theme || (dark ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set("pt-theme", next);
});

// ---------- Input ----------
const drop = $("#drop"), file = $("#file");
drop.addEventListener("click", () => file.click());
drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]));
file.addEventListener("change", () => file.files[0] && readFile(file.files[0]));
$("#sample").addEventListener("click", () => load(sampleStatement(), "Sample statement (synthetic)"));
$("#reset").addEventListener("click", () => { state.raw = null; file.value = ""; $("#dash").hidden = true; $("#landing").hidden = false; scrollTo({ top: 0 }); });
$("#export").addEventListener("click", () => {
  const blob = new Blob([toCSV(state.result.txns)], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "paisatrail-categorised.csv" });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

function readFile(f) {
  if (f.size > 20 * 1024 * 1024) return alert("That file is larger than 20 MB. Export a shorter date range.");
  const reader = new FileReader();
  reader.onload = () => load(String(reader.result), f.name);
  reader.readAsText(f);
}

function load(text, name) {
  try {
    state.raw = text; state.name = name; state.cancelled.clear();
    run();
    $("#landing").hidden = true; $("#dash").hidden = false; scrollTo({ top: 0 });
  } catch (err) {
    alert(err.message);
  }
}

function run() {
  state.result = analyze(state.raw, state.overrides);
  render();
}

// ---------- Render ----------
function render() {
  const { summary: s, recurring, duplicates, anomalies, txns, skipped } = state.result;
  $("#range").textContent = s.range ? `${state.name} · ${fmtDate(s.range.from)} – ${fmtDate(s.range.to)} · ${txns.length} transactions` : state.name;
  const notice = $("#notice");
  notice.hidden = !skipped.length;
  if (skipped.length) notice.textContent = `${skipped.length} row(s) without a valid date or amount were skipped (e.g. totals or opening balance): row ${skipped.slice(0, 6).join(", ")}${skipped.length > 6 ? "…" : ""}.`;

  const recurringYear = recurring.reduce((a, r) => a + r.annualCost, 0);
  const subsYear = recurring.filter(r => ["Subscriptions", "Bills & Utilities", "Health", "Entertainment"].includes(r.category)).reduce((a, r) => a + r.annualCost, 0);
  const alertCount = duplicates.length + anomalies.length + recurring.filter(r => r.priceChange > 0).length;
  const rate = s.savingsRate;
  $("#kpis").innerHTML = [
    kpi("Monthly spend", inr(s.avgMonthlySpend), `${inr(s.spend)} over ${s.monthly.length} months`, ""),
    kpi("Monthly income", inr(s.monthly.length ? s.income / s.monthly.length : 0), `${inr(s.invested)} invested in total`, "good"),
    kpi("Savings rate", rate === null ? "—" : rate.toFixed(1) + "%", rate === null ? "No income found" : rate >= 30 ? "Healthy: 30%+ saved" : rate >= 15 ? "OK: aim for 30%" : "Below 15%: review spends", rate === null ? "" : rate >= 30 ? "good" : rate >= 15 ? "warn" : "bad"),
    kpi("Recurring / year", compact(recurringYear), `${recurring.length} commitments · ${compact(subsYear)} subscriptions & bills`, "warn"),
    kpi("Alerts", String(alertCount), `${duplicates.length} double charge · ${anomalies.length} spike · ${recurring.filter(r => r.priceChange > 0).length} price hike`, alertCount ? "bad" : "good"),
  ].join("");

  renderFlow(s.monthly);
  renderDonut(s.categories);
  renderRecurring(recurring);
  renderAlerts(duplicates, anomalies, recurring);
  renderMerchants(s.topMerchants);
  renderFilters();
  renderTxns();
}

const kpi = (label, value, sub, tone) => `<div class="kpi ${tone}"><div class="label">${h(label)}</div><div class="value">${h(value)}</div><div class="sub">${h(sub)}</div></div>`;

function renderFlow(monthly) {
  const W = 640, H = 260, pad = { l: 46, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...monthly.flatMap(m => [m.income, m.spend, m.invested])) * 1.08;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const gw = iw / Math.max(monthly.length, 1), bw = Math.min(22, gw / 4.2);
  const y = v => pad.t + ih - (v / max) * ih;
  const ticks = 4;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly income, spend and investments">`;
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    svg += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  monthly.forEach((m, i) => {
    const cx = pad.l + gw * i + gw / 2;
    const bars = [["income", "var(--inc)"], ["spend", "var(--spd)"], ["invested", "var(--inv)"]];
    svg += `<g class="month"><title>${monthLabel(m.month)}: income ${inr(m.income)}, spend ${inr(m.spend)}, invested ${inr(m.invested)}</title>`;
    bars.forEach(([k, c], j) => {
      const x = cx + (j - 1.5) * (bw + 3);
      svg += `<rect x="${x}" y="${y(m[k])}" width="${bw}" height="${Math.max(0, pad.t + ih - y(m[k]))}" rx="4" fill="${c}"/>`;
    });
    svg += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${monthLabel(m.month)} ’${m.month.slice(2, 4)}</text></g>`;
  });
  $("#flow").innerHTML = svg + "</svg>";
}

function renderDonut(categories) {
  const total = categories.reduce((a, c) => a + c.total, 0) || 1;
  const top = categories.slice(0, 8);
  const rest = categories.slice(8).reduce((a, c) => a + c.total, 0);
  const items = rest > 0 ? [...top, { name: "Everything else", total: rest }] : top;
  const R = 42, C = 2 * Math.PI * R;
  let offset = 0, arcs = "";
  items.forEach((c, i) => {
    const len = (c.total / total) * C;
    arcs += `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="16" stroke-dasharray="${Math.max(0, len - 1.2)} ${C}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"><title>${h(c.name)}: ${inr(c.total)}</title></circle>`;
    offset += len;
  });
  $("#donut").innerHTML = `<svg viewBox="0 0 120 120" role="img" aria-label="Spending by category">${arcs}<text x="60" y="58" text-anchor="middle" font-size="13" font-weight="800">${compact(total)}</text><text class="donut-sub" x="60" y="72" text-anchor="middle">total spend</text></svg>`;
  const legend = $("#cat-legend");
  legend.innerHTML = items.map(c => `<li><i></i><span>${h(c.name)}</span><b>${((c.total / total) * 100).toFixed(1)}%</b></li>`).join("");
  [...legend.children].forEach((li, i) => li.style.setProperty("--c", PALETTE[i % PALETTE.length]));
}

function renderRecurring(recurring) {
  const t = $("#recurring");
  if (!recurring.length) { t.innerHTML = `<tr><td class="empty">No recurring payments detected yet. Upload at least 3 months for reliable detection.</td></tr>`; updateSaving(); return; }
  t.innerHTML = `<thead><tr><th>Cancel?</th><th>Merchant</th><th>Category</th><th>Cadence</th><th class="num">Amount</th><th class="num">Per year</th><th>Next expected</th></tr></thead><tbody>` +
    recurring.map((r, i) => `<tr data-i="${i}" class="${state.cancelled.has(r.merchant) ? "cancelled" : ""}">
      <td><input type="checkbox" aria-label="Mark ${h(r.merchant)} as cancelled" ${state.cancelled.has(r.merchant) ? "checked" : ""}></td>
      <td class="merchant">${h(r.merchant)} ${r.priceChange > 0 ? `<span class="chip hike" title="Price went up">▲ ${inr(r.priceChange)}</span>` : ""}</td>
      <td><span class="chip">${h(r.category)}</span></td>
      <td>${h(r.cadence)} <span class="muted small">×${r.count}</span></td>
      <td class="num">${inr(r.typicalAmount)}</td>
      <td class="num"><b>${inr(r.annualCost)}</b></td>
      <td>${fmtDate(r.nextDate)}</td></tr>`).join("") + "</tbody>";
  t.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", e => {
    const tr = e.target.closest("tr"), r = recurring[Number(tr.dataset.i)];
    e.target.checked ? state.cancelled.add(r.merchant) : state.cancelled.delete(r.merchant);
    tr.classList.toggle("cancelled", e.target.checked);
    updateSaving();
  }));
  updateSaving();
}

function updateSaving() {
  const total = state.result.recurring.filter(r => state.cancelled.has(r.merchant)).reduce((a, r) => a + r.annualCost, 0);
  $("#saving").textContent = inr(total) + "/yr";
}

function renderAlerts(duplicates, anomalies, recurring) {
  const items = [
    ...duplicates.map(d => ({ cls: "dup", ic: "2×", title: `Possible double charge at ${d.merchant}`, sub: `${fmtDate(d.first.date)} and ${fmtDate(d.second.date)}: same amount twice. Check with your bank or the merchant.`, amt: inr(d.amount) })),
    ...recurring.filter(r => r.priceChange > 0).map(r => ({ cls: "hike", ic: "▲", title: `${r.merchant} raised its price`, sub: `Now ${inr(r.typicalAmount)} per charge (+${inr(r.priceChange)}). Adds ${inr(r.priceChange * (r.cadence === "Monthly" ? 12 : r.cadence === "Weekly" ? 52 : r.cadence === "Quarterly" ? 4 : 1))}/yr.`, amt: "+" + inr(r.priceChange) })),
    ...anomalies.map(a => ({ cls: "spike", ic: "!", title: `Unusual spend at ${a.merchant}`, sub: `${fmtDate(a.date)}: about ${Math.round(-a.amount / a.typical)}× your typical ${a.basis === "merchant" ? "spend here" : a.category.toLowerCase() + " spend"} (${inr(a.typical)}).`, amt: inr(a.amount) })),
  ];
  $("#alert-count").textContent = items.length ? `${items.length} found` : "All clear";
  $("#alerts").innerHTML = items.length
    ? items.map(a => `<li class="${a.cls}"><span class="ic">${a.ic}</span><div><b>${h(a.title)}</b><p>${h(a.sub)}</p></div><span class="amt">${a.amt}</span></li>`).join("")
    : `<li class="empty">No double charges, price hikes or unusual spikes detected. 🎉</li>`;
}

function renderMerchants(top) {
  const max = top[0]?.total || 1;
  const ul = $("#merchants");
  ul.innerHTML = top.map(m => `<li><span class="name" title="${h(m.name)}">${h(m.name)}</span><span class="track"><span class="fill"></span></span><span class="v">${compact(m.total)}</span></li>`).join("");
  requestAnimationFrame(() => [...ul.querySelectorAll(".fill")].forEach((f, i) => f.style.setProperty("--w", ((top[i].total / max) * 100).toFixed(1) + "%")));
}

function renderFilters() {
  const present = [...new Set(state.result.txns.map(t => t.category))].sort();
  const sel = $("#cat-filter");
  sel.innerHTML = `<option value="">All categories</option>` + present.map(c => `<option ${c === state.cat ? "selected" : ""}>${h(c)}</option>`).join("");
}

const TX_LIMIT = 400;
function renderTxns() {
  const q = state.q.toLowerCase();
  const rows = state.result.txns.filter(t => (!state.cat || t.category === state.cat) && (!q || t.merchant.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))).reverse();
  const opts = c => CAT_LIST.map(x => `<option ${x === c ? "selected" : ""}>${h(x)}</option>`).join("");
  $("#txns").innerHTML = `<thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>` +
    rows.slice(0, TX_LIMIT).map(t => `<tr><td class="small">${fmtDate(t.date)}</td><td><div class="merchant">${h(t.merchant)}</div><div class="narr" title="${h(t.description)}">${h(t.description)}</div></td><td><select data-m="${h(t.merchant)}" aria-label="Category for ${h(t.merchant)}">${opts(t.category)}</select></td><td class="num ${t.amount > 0 ? "pos" : "neg"}">${t.amount > 0 ? "+" : "−"}${inr(t.amount, 2)}</td></tr>`).join("") + "</tbody>";
  $("#tx-more").textContent = rows.length > TX_LIMIT ? `Showing latest ${TX_LIMIT} of ${rows.length}. Search or filter to narrow down.` : `${rows.length} transaction${rows.length === 1 ? "" : "s"}`;
}

$("#txns").addEventListener("change", e => {
  if (e.target.tagName !== "SELECT") return;
  state.overrides[e.target.dataset.m] = e.target.value;
  store.set("pt-overrides", state.overrides);
  run();
});
let timer;
$("#q").addEventListener("input", e => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value; renderTxns(); }, 120); });
$("#cat-filter").addEventListener("change", e => { state.cat = e.target.value; renderTxns(); });

// Deep link for demos: ?demo opens the sample immediately.
if (new URLSearchParams(location.search).has("demo")) load(sampleStatement(), "Sample statement (synthetic)");
