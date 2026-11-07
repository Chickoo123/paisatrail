import { auditStatement, disputeLetter } from "./charges.js";
import { sampleStatement } from "./sample.js";
import { RULES } from "./rules.js";

const $ = s => document.querySelector(s);
const h = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n, d = 2) => (n < 0 ? "−" : "") + "₹" + Math.abs(Number(n)).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const dt = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const TODAY = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const STATUS = {
  issue: { chip: "Ask to reverse", conf: "Proven by your statement" },
  check: { chip: "Confirm", conf: "Needs facts outside the statement" },
  info: { chip: "Context", conf: "Informational" },
  ok: { chip: "Passes", conf: "Checked" },
};
const CHECKS = [
  ["Minimum-balance penalty that pushed the balance below zero", "RBI 2014"],
  ["Minimum-balance penalty on a BSBD or zero-balance account", "BSBDA"],
  ["ATM charge in a month within the free limit", "ATM circular"],
  ["ATM charge above the ₹23 cap (from May 2025)", "ATM circular"],
  ["Charge for an online NEFT transfer", "NEFT waiver 2019"],
  ["Card or cheque-book fee on a BSBD account", "BSBDA"],
  ["The same periodic charge twice in a month", "Arithmetic"],
  ["Minimum-balance notice and proportionality", "RBI 2014"],
  ["Insurance or pension auto-debits", "Enrolment"],
];

let text = null, name = "";

// ---------- Input ----------
const drop = $("#drop"), file = $("#file");
drop.addEventListener("click", () => file.click());
drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]));
file.addEventListener("change", () => file.files[0] && readFile(file.files[0]));
const loadSample = () => { text = sampleStatement(); name = "Sample statement (synthetic)"; run(); };
$("#sample").addEventListener("click", loadSample);
document.addEventListener("click", e => { if (e.target.closest("[data-sample]")) loadSample(); });
$("#account").addEventListener("change", () => text && run());
$("#theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
});

function readFile(f) {
  if (f.size > 20 * 1024 * 1024) return showError("That file is over 20 MB. Export a shorter date range.");
  $("#results").innerHTML = `<div class="sheet"><div class="sec-title"><h3>Reading ${h(f.name)}…</h3><span>in this tab</span></div><div class="skeleton" aria-hidden="true"><i></i><i></i><i></i></div></div>`;
  const r = new FileReader();
  r.onload = () => { text = String(r.result); name = f.name; run(); };
  r.onerror = () => showError("Couldn't read that file.");
  r.readAsText(f);
}
function showError(msg) {
  const e = $("#errors"); e.hidden = false; e.textContent = msg; $("#jump").hidden = true;
  renderEmpty();
}

// ---------- Empty state: what will be checked ----------
function renderEmpty() {
  $("#results").innerHTML = `<article class="sheet">
    <header class="rep-head clean"><p class="hd-eyebrow">Audit report</p><h3 class="verdict-title">Your report will appear here</h3>
      <p class="verdict-sub">Add a statement, or try the sample, to run these checks on every charge.</p></header>
    <ol class="checks-list">${CHECKS.map(([t, r], i) => `<li><span class="fid">${String(i + 1).padStart(2, "0")}</span><b>${h(t)}</b><small>${h(r)}</small></li>`).join("")}</ol>
  </article>`;
}

// ---------- Specimen (hero): the engine run on the sample ----------
function renderSpecimen() {
  const r = auditStatement(sampleStatement());
  const s = r.summary;
  const top = r.findings.filter(f => f.status === "issue").slice(0, 3);
  const max = s.totalCharges;
  $("#specimen").innerHTML = `
    <div class="spec-top"><span>Sample audit</span><span>4 months · ${r.rows} transactions</span></div>
    <div class="spec-body">
      <p class="spec-title">${inr(s.disputable)} of ${inr(s.totalCharges)} in charges can be challenged.</p>
      <div class="compare" role="img" aria-label="Charges ${inr(s.totalCharges)}, reversible ${inr(s.disputable)}">
        <div class="cmp-row"><span>All charges</span><span class="bar"><i data-w="100"></i></span><b>${inr(s.totalCharges, 0)}</b></div>
        <div class="cmp-row"><span>Reversible</span><span class="bar true"><i data-w="${(s.disputable / max) * 100}"></i></span><b>${inr(s.disputable, 0)}</b></div>
      </div>
      <ul class="spec-list">${top.map((f, i) => `<li><span class="sev issue" aria-hidden="true"></span><span>${h(f.title)}</span><span class="n">F${i + 1}</span></li>`).join("")}</ul>
    </div>
    <div class="spec-foot"><span>${s.issues} proven findings · every line cited</span><a href="#audit" data-sample>Open full report →</a></div>`;
  $("#specimen").querySelectorAll(".bar i").forEach(i => i.style.setProperty("--w", i.dataset.w + "%"));
}

// ---------- Report ----------
let fid = 0, firstCite = new Map();
function run() {
  let r;
  try { r = auditStatement(text, { accountType: $("#account").value }); $("#errors").hidden = true; }
  catch (e) { return showError(e.message); }
  const s = r.summary;
  const jump = $("#jump");
  jump.hidden = false;
  jump.innerHTML = `<span>${s.disputable > 0 ? `<i class="sev" aria-hidden="true"></i>${inr(s.disputable)} reversible` : "No reversible charges"}</span><span aria-hidden="true">Report ↓</span>`;
  const rulesCited = new Set(r.findings.filter(f => f.rule).map(f => f.rule.ref)).size;
  const meta = `<div class="rep-meta">
      <span>Statement <b>${h(name)}</b></span>
      ${r.range ? `<span>Period <b>${dt(r.range.from)} – ${dt(r.range.to)}</b></span>` : ""}
      <span>Read <b>${r.rows} transactions</b></span>
      <span>Circulars cited <b>${rulesCited}</b></span>
      <span>Prepared <b>${TODAY}, in your browser</b></span>
    </div>`;

  if (!r.charges.length) {
    $("#results").innerHTML = `<article class="sheet"><header class="rep-head clean"><p class="hd-eyebrow">Audit report</p><h3 class="verdict-title">No bank charges found</h3><p class="verdict-sub">If you expected some, check that the narration column was exported.</p>${meta}</header></article>`;
    return;
  }
  const title = s.disputable > 0 ? `You can ask your bank to reverse ${inr(s.disputable)}`
    : s.toVerify > 0 ? `No proven breaches. ${inr(s.toVerify)} is worth confirming` : "These charges look consistent with RBI rules";
  const sub = s.disputable > 0
    ? `${s.issues} finding${s.issues === 1 ? "" : "s"}, each proven by entries in your statement. GST charged on them is included.`
    : "Every charge was tested against the rules listed below.";

  firstCite = new Map();
  $("#results").innerHTML = `
    <article class="sheet">
      <header class="rep-head ${s.disputable > 0 ? "" : "clean"}">
        <p class="hd-eyebrow">Audit report</p>
        <h3 class="verdict-title">${h(title)}</h3>
        <p class="verdict-sub">${h(sub)}${r.hasBalance ? "" : " No balance column was found, so negative-balance checks were skipped."}</p>
        ${meta}
      </header>
      <div class="apr-block">
        <div><span class="apr-k">Bank charges in this statement</span><span class="apr-v">${inr(s.totalCharges)}</span></div>
        <div><span class="apr-k">Proven reversible</span><span class="apr-v ${s.disputable > 0 ? "bad" : "muted"}">${inr(s.disputable)}</span></div>
        <div class="delta">${s.totalCharges ? `<span class="hd-chip ${s.disputable > 0 ? "issue" : "ok"}"><span class="dot"></span>${Math.round((s.disputable / s.totalCharges) * 100)}% of charges</span>` : ""}</div>
      </div>
      <dl class="figs">
        <div><dt>Charge entries</dt><dd>${r.charges.length}<small>GST lines matched to each</small></dd></div>
        <div><dt>At this rate, per year</dt><dd>${inr(s.perYear, 0)}<small>over ${r.months} month${r.months > 1 ? "s" : ""} of data</small></dd></div>
        <div><dt>Worth confirming</dt><dd>${inr(s.toVerify)}<small>needs outside facts</small></dd></div>
        <div><dt>Account type</dt><dd>${{ regular: "Regular", bsbda: "BSBD", zero_balance: "Zero-balance" }[r.accountType]}<small>change it on the left</small></dd></div>
      </dl>
    </article>

    <article class="sheet">
      <div class="sec-title"><h3>Findings</h3><span>${r.findings.length} results · ordered by severity</span></div>
      <div class="legend-row"><span><b>Proven</b>: established by your statement alone</span><span><b>Confirm</b>: depends on facts outside it</span></div>
      <ol class="findings">${r.findings.map(renderFinding).join("")}</ol>
    </article>

    <details class="sheet working-toggle">
      <summary><h3>Every charge found</h3><small>${r.charges.length} entries · check against your statement</small></summary>
      <div class="working-body">
        <div class="ev-wrap"><table class="ev">
          <thead><tr><th>Date</th><th>Narration</th><th>Type</th><th class="num">Charge</th><th class="num">GST</th><th class="num">Balance after</th></tr></thead>
          <tbody>${r.charges.map(c => `<tr><td>${dt(c.date)}</td><td class="narr">${h(c.description)}</td><td>${h(c.label)}</td><td class="num">${inr(c.base)}</td><td class="num">${c.gst ? inr(c.gst) : "—"}</td><td class="num">${c.balance === null ? "—" : inr(c.balance)}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>
    </details>

    ${s.disputable > 0 ? `<article class="sheet letter sheet-pad">
      <p class="hd-eyebrow">Next step</p>
      <h3 class="verdict-title">Send this to your bank</h3>
      <p class="verdict-sub">Every charge itemised with its RBI reference and the amount to reverse. Edit freely, then send it from your own email or the bank's complaint form.</p>
      <div class="letter-row">
        <label>Bank<input id="l-bank" placeholder="Sample Bank"></label>
        <label>Account (last 4)<input id="l-acct" inputmode="numeric" maxlength="4"></label>
        <label>Your name<input id="l-name"></label>
      </div>
      <textarea id="letter" aria-label="Draft dispute letter"></textarea>
      <div class="actions"><button type="button" class="btn primary small" id="copy">Copy letter</button><button type="button" class="btn quiet small" id="print">Print report</button><span class="muted small" id="copied" role="status"></span></div>
      <p class="small muted">No resolution in 30 days? File free with the <a href="${RULES.ombudsman.url}" rel="noopener">RBI Ombudsman</a>.</p>
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
    $("#print").addEventListener("click", () => window.print());
  }
}

function citeHtml(rule, i) {
  const first = firstCite.get(rule.ref);
  if (first === undefined) firstCite.set(rule.ref, i);
  const same = first !== undefined && first !== i;
  return `<li class="c-rule"><span class="k">Rule</span><a class="cite ${same ? "same" : ""}" href="${h(rule.url)}" target="_blank" rel="noopener"><b>${h(rule.name)} ↗</b><small>${h(rule.ref)}${rule.date ? " · " + h(rule.date) : ""}</small><em>${h(rule.summary)}</em>${same ? `<span class="same-note">Same rule as F${first + 1}</span>` : ""}</a></li>`;
}

function renderFinding(f, i) {
  const id = "f" + (++fid);
  const st = STATUS[f.status];
  const open = f.status === "issue" && i < 3;
  return `<li class="finding">
    <button type="button" aria-expanded="${open}" aria-controls="${id}">
      <span class="fid">F${i + 1}</span>
      <span class="f-main">
        <span class="f-title">${h(f.title)}</span>
        <span class="f-tags"><span class="hd-chip ${f.status}"><span class="dot"></span>${st.chip}</span><span class="conf">${st.conf}</span></span>
      </span>
      <span class="f-amt">${f.amount > 0 ? inr(f.amount) : ""}<span class="chev" aria-hidden="true"></span></span>
    </button>
    <ol class="chain" id="${id}" ${open ? "" : "hidden"}>
      <li><span class="k">Evidence · ${f.evidence.length} statement line${f.evidence.length > 1 ? "s" : ""}</span>
        <div class="ev-wrap"><table class="ev">
          <thead><tr><th>Date</th><th>Narration</th><th class="num">Charge + GST</th><th class="num">${f.refundable ? "Claim" : "Amount"}</th></tr></thead>
          <tbody>${f.evidence.map(e => `<tr><td>${dt(e.date)}</td><td class="narr">${h(e.description)}${e.note ? `<span class="note">${h(e.note)}</span>` : ""}</td><td class="num">${inr(e.base)}${e.gst ? ` + ${inr(e.gst)}` : ""}</td><td class="num">${e.disputed ? inr(e.disputed) : "—"}</td></tr>`).join("")}</tbody>
        </table></div></li>
      <li><span class="k">Why</span><p>${h(f.detail)}</p></li>
      ${f.rule ? citeHtml(f.rule, i) : ""}
      ${f.action ? `<li class="c-act"><span class="k">What to do</span><p>${h(f.action)}</p></li>` : ""}
    </ol>
  </li>`;
}

$("#source-list").innerHTML = Object.values(RULES).map(r => `<li><a href="${h(r.url)}" target="_blank" rel="noopener">${h(r.name)} ↗</a>
  <div class="meta">${h(r.ref)}${r.date ? " · " + h(r.date) : ""} · checked ${h(r.verified)}</div></li>`).join("");

renderSpecimen();
if (new URLSearchParams(location.search).has("demo")) loadSample(); else renderEmpty();
