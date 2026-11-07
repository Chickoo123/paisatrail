import { auditStatement, disputeLetter } from "./charges.js";
import { sampleStatement } from "./sample.js";
import { RULES } from "./rules.js";

const $ = s => document.querySelector(s);
const h = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n, d = 2) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const dt = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

let text = null, name = "";

// ---------- Input ----------
const drop = $("#drop"), file = $("#file");
drop.addEventListener("click", () => file.click());
drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]));
file.addEventListener("change", () => file.files[0] && readFile(file.files[0]));
$("#sample").addEventListener("click", () => { text = sampleStatement(); name = "Sample statement (synthetic)"; run(); });
$("#account").addEventListener("change", () => text && run());
$("#theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
});

function readFile(f) {
  if (f.size > 20 * 1024 * 1024) return showError("That file is over 20 MB. Export a shorter date range.");
  const r = new FileReader();
  r.onload = () => { text = String(r.result); name = f.name; run(); };
  r.onerror = () => showError("Couldn't read that file.");
  r.readAsText(f);
}
function showError(msg) { const e = $("#errors"); e.hidden = false; e.textContent = msg; $("#jump").hidden = true; }

// ---------- Render ----------
const LABEL = { issue: "Ask to reverse", check: "Confirm", info: "Good to know", ok: "Looks fine" };
const ICON = { issue: "!", check: "?", info: "i", ok: "✓" };
let fid = 0;

function run() {
  let r;
  try { r = auditStatement(text, { accountType: $("#account").value }); $("#errors").hidden = true; }
  catch (e) { return showError(e.message); }
  const s = r.summary;
  const jump = $("#jump");
  jump.hidden = false;
  jump.innerHTML = `<span>${s.disputable > 0 ? `${inr(s.disputable)} you can ask to reverse` : "No reversible charges found"}</span><span aria-hidden="true">View ↓</span>`;

  if (!r.charges.length) {
    $("#results").innerHTML = `<article class="card verdict clean"><p class="headline">No bank charges found in ${r.rows} transactions</p><p>${h(name)}${r.range ? ` · ${dt(r.range.from)} – ${dt(r.range.to)}` : ""}. If you expected some, check that the narration column was exported.</p></article>`;
    return;
  }
  const headline = s.disputable > 0
    ? `You can ask your bank to reverse about ${inr(s.disputable)}`
    : s.toVerify > 0 ? `No clear rule breaks, but ${inr(s.toVerify)} of charges is worth confirming` : "These charges look consistent with RBI rules";

  $("#results").innerHTML = `
    <article class="card verdict ${s.disputable > 0 ? "" : "clean"}">
      <p class="headline">${h(headline)}</p>
      <p>${h(name)} · ${r.range ? `${dt(r.range.from)} – ${dt(r.range.to)}` : ""} · ${r.rows} transactions read${r.skipped.length ? ` (${r.skipped.length} non-transaction rows skipped)` : ""}${r.hasBalance ? "" : " · <b>No balance column found</b>, so negative-balance checks were skipped"}.</p>
      <dl class="figures">
        <div><dt>Charges in this statement</dt><dd>${inr(s.totalCharges)}<small>incl. GST, ${r.charges.length} entries</small></dd></div>
        <div><dt>At this rate, per year</dt><dd>${inr(s.perYear, 0)}<small>over ${r.months} month${r.months > 1 ? "s" : ""} of data</small></dd></div>
        <div><dt>You can ask to reverse</dt><dd class="${s.disputable > 0 ? "bad" : ""}">${inr(s.disputable)}<small>${s.issues} finding${s.issues === 1 ? "" : "s"}</small></dd></div>
        <div><dt>Worth confirming</dt><dd>${inr(s.toVerify)}<small>depends on facts not in the statement</small></dd></div>
      </dl>
    </article>

    <article class="card">
      <h2>Findings</h2>
      <p class="muted small">Each finding lists the statement lines behind it. Amounts include the GST charged on them.</p>
      <ul class="findings">${r.findings.map(renderFinding).join("")}</ul>
    </article>

    <article class="card">
      <details>
        <summary><h2>Every charge found</h2></summary>
        <p class="muted small">Check these against your statement. If a charge is missing or misread, its narration wasn't recognised.</p>
        <div class="table-x"><table class="evidence">
          <thead><tr><th>Date</th><th>Narration</th><th>Type</th><th class="num">Charge</th><th class="num">GST</th><th class="num">Balance after</th></tr></thead>
          <tbody>${r.charges.map(c => `<tr><td>${dt(c.date)}</td><td class="narr">${h(c.description)}</td><td>${h(c.label)}</td><td class="num">${inr(c.base)}</td><td class="num">${c.gst ? inr(c.gst) : "—"}</td><td class="num">${c.balance === null ? "—" : inr(c.balance)}</td></tr>`).join("")}</tbody>
        </table></div>
        <h3>By type</h3>
        <div class="table-x"><table class="evidence"><thead><tr><th>Type</th><th class="num">Entries</th><th class="num">Total incl. GST</th></tr></thead>
          <tbody>${s.byType.map(t => `<tr><td>${h(t.label)}</td><td class="num">${t.count}</td><td class="num">${inr(t.total)}</td></tr>`).join("")}</tbody></table></div>
      </details>
    </article>

    ${s.disputable > 0 ? `<article class="card letter">
      <h2>Draft the request to your bank</h2>
      <p class="muted small">It lists each charge, the RBI rule, and the amount to reverse. Edit it freely, then send it from your own email or the bank's complaint form. Nothing is sent from this page.</p>
      <div class="row">
        <label>Bank<input id="l-bank" placeholder="e.g. Sample Bank"></label>
        <label>Account (last 4 digits)<input id="l-acct" inputmode="numeric" maxlength="4"></label>
        <label>Your name<input id="l-name"></label>
      </div>
      <textarea id="letter" aria-label="Draft dispute letter"></textarea>
      <div class="actions"><button type="button" class="btn" id="copy">Copy letter</button><span class="muted small" id="copied" role="status"></span></div>
      <p class="small muted">If the bank doesn't resolve it within 30 days, you can complain to the <a href="${RULES.ombudsman.url}" rel="noopener">RBI Ombudsman</a> online, free of charge.</p>
    </article>` : ""}`;

  $("#results").querySelectorAll(".finding > button").forEach(b => b.addEventListener("click", () => {
    const open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open));
    b.nextElementSibling.hidden = open;
  }));
  if (s.disputable > 0) {
    const update = () => { $("#letter").value = disputeLetter(r, { bank: $("#l-bank").value, account: $("#l-acct").value ? "XXXX" + $("#l-acct").value : "", name: $("#l-name").value }); };
    ["#l-bank", "#l-acct", "#l-name"].forEach(id => $(id).addEventListener("input", update));
    update();
    $("#copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("#letter").value); $("#copied").textContent = "Copied."; }
      catch { $("#letter").select(); $("#copied").textContent = "Press Ctrl+C to copy."; }
    });
  }
}

function renderFinding(f) {
  const id = "f" + (++fid);
  const open = f.status === "issue";
  return `<li class="finding ${f.status}">
    <button type="button" aria-expanded="${open}" aria-controls="${id}">
      <span class="badge"><span aria-hidden="true">${ICON[f.status]}</span>${LABEL[f.status]}</span>
      <span class="title">${h(f.title)}</span>
      <span class="excess">${f.amount > 0 ? inr(f.amount) : ""}</span>
    </button>
    <div class="body" id="${id}" ${open ? "" : "hidden"}>
      <span class="label">Why</span><p>${h(f.detail)}</p>
      ${f.action ? `<span class="label">What to do</span><p>${h(f.action)}</p>` : ""}
      <span class="label">Evidence from your statement</span>
      <div class="table-x"><table class="evidence">
        <thead><tr><th>Date</th><th>Narration</th><th class="num">Charge + GST</th><th class="num">${f.refundable ? "Claim" : "Amount"}</th></tr></thead>
        <tbody>${f.evidence.map(e => `<tr><td>${dt(e.date)}</td><td class="narr">${h(e.description)}${e.note ? `<div class="note">${h(e.note)}</div>` : ""}</td><td class="num">${inr(e.base)}${e.gst ? ` + ${inr(e.gst)}` : ""}</td><td class="num">${e.disputed ? inr(e.disputed) : "—"}</td></tr>`).join("")}</tbody>
      </table></div>
      ${f.rule ? `<div class="rule"><span class="muted small">Rule: </span><a href="${h(f.rule.url)}" target="_blank" rel="noopener">${h(f.rule.name)} ↗</a>
        <div class="meta">${h(f.rule.ref)}${f.rule.date ? " · " + h(f.rule.date) : ""}</div>
        <details><summary>What the rule says</summary><p>${h(f.rule.summary)}</p></details></div>` : ""}
    </div>
  </li>`;
}

$("#source-list").innerHTML = Object.values(RULES).map(r => `<li><a href="${h(r.url)}" target="_blank" rel="noopener">${h(r.name)}</a>
  <div class="meta">${h(r.ref)}${r.date ? " · " + h(r.date) : ""} · summary last checked ${h(r.verified)}</div></li>`).join("");

if (new URLSearchParams(location.search).has("demo")) { text = sampleStatement(); name = "Sample statement (synthetic)"; run(); }
