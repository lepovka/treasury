const $ = (id) => document.getElementById(id);
const fmtUsd = (n) => n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtNum = (n) => n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 4 });
const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PAGE = 25;
let D, shown = PAGE;

fetch("data.json?_=" + Date.now()).then((r) => r.json()).then((d) => { D = d; init(); })
  .catch(() => { document.body.insertAdjacentHTML("afterbegin", "<p style='padding:16px'>Could not load data.json</p>"); });

const chainOf = (id) => D.chains.find((c) => c.id === id);
const label = (a) => D.labels[a?.toLowerCase()] ?? D.labels[a] ?? short(a);
const addrLink = (c, a) => `<a href="${esc(c.explorer)}/address/${esc(a)}" target="_blank" rel="noopener" title="${esc(a)}">${esc(label(a))}</a>`;

function init() {
  document.title = D.title; $("title").textContent = D.title;
  $("safe").textContent = D.safe;
  $("updated").textContent = new Date(D.updatedAt).toLocaleString();

  $("cards").innerHTML =
    `<div class="card total"><div class="lbl">Total treasury value</div><div class="val">${fmtUsd(D.totalUsd)}</div></div>` +
    D.chains.map((c) => `<div class="card"><div class="lbl">${esc(c.name)}</div><div class="val">${fmtUsd(c.totalUsd)}</div></div>`).join("");

  const rows = D.chains.flatMap((c) => c.holdings.map((h) => ({ c, h }))).sort((a, b) => (b.h.usd ?? -1) - (a.h.usd ?? -1));
  $("holdings").tBodies[0].innerHTML = rows.length ? rows.map(({ c, h }) =>
    `<tr><td>${esc(c.name)}</td><td>${esc(h.symbol)}${h.token ? ` <span class="badge mono">${esc(short(h.token))}</span>` : ""}</td>` +
    `<td class="r">${fmtNum(h.amount)}</td><td class="r">${fmtUsd(h.price)}</td><td class="r">${fmtUsd(h.usd)}</td></tr>`).join("")
    : `<tr><td colspan="5" class="muted">No assets</td></tr>`;

  $("pending").innerHTML = D.pending.length ? `<table><thead><tr><th>Chain</th><th>Nonce</th><th>To</th><th>Signatures</th></tr></thead><tbody>` +
    D.pending.map((p) => { const c = chainOf(p.chain); return `<tr><td>${esc(c.name)}</td><td>${p.nonce}</td><td>${addrLink(c, p.to)}</td><td>${p.confirmations}/${p.required}</td></tr>`; }).join("") + `</tbody></table>`
    : "None.";

  $("signers").innerHTML = D.chains.map((c) =>
    `<p><strong>${esc(c.name)}</strong> — ${c.threshold} of ${c.owners.length} required<br>` +
    c.owners.map((o) => addrLink(c, o)).join(" · ") + `</p>`).join("");

  for (const c of D.chains) $("fChain").insertAdjacentHTML("beforeend", `<option value="${esc(c.id)}">${esc(c.name)}</option>`);
  for (const id of ["fChain", "fDir", "fUnv"]) $(id).onchange = () => { shown = PAGE; renderTxs(); };
  $("more").onclick = () => { shown += PAGE; renderTxs(); };
  renderTxs();
}

function renderTxs() {
  const fc = $("fChain").value, fd = $("fDir").value;
  const showUnv = $("fUnv").checked;
  const list = D.transactions.filter((t) => (!fc || t.chain === fc) && (!fd || t.direction === fd) && (showUnv || !t.unverified));
  $("txs").tBodies[0].innerHTML = list.slice(0, shown).map((t) => {
    const c = chainOf(t.chain);
    const dirTxt = t.direction === "in" ? "In" : t.direction === "out" ? "Out" : "Contract call";
    const sign = t.direction === "in" ? "+" : t.direction === "out" ? "−" : "";
    return `<tr><td>${new Date(t.date).toISOString().replace("T", " ").slice(0, 16)}</td><td>${esc(c.name)}</td>` +
      `<td class="${esc(t.direction)}">${dirTxt}${t.failed ? " <span class='badge'>failed</span>" : ""}</td>` +
      `<td>${t.counterparty ? addrLink(c, t.counterparty) : ""}</td>` +
      `<td class="r ${esc(t.direction)}">${t.direction === "call" ? "" : sign + fmtNum(t.amount) + " " + esc(t.symbol)}${t.unverified ? ` <span class="badge" title="${esc(t.token)}">unverified token ${esc(short(t.token))}</span>` : ""}</td>` +
      `<td><a href="${esc(c.explorer)}/tx/${esc(t.txHash)}" target="_blank" rel="noopener">${esc(short(t.txHash))}</a></td></tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">No transactions</td></tr>`;
  $("more").hidden = list.length <= shown;
}
