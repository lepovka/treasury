const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (n, d = 2) => n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });
const num = (n) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 4 : 6 });
const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
const COLORS = { ETH: "var(--eth)", BNB: "var(--bnb)", POL: "var(--pol)", USDT: "var(--usdt)", USDT0: "var(--usdt)" };
const CHAIN_COLORS = { eth: "var(--eth)", bnb: "var(--bnb)", pol: "var(--pol)" };
const PAGE = 20;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let D, shown = PAGE, fChain = "", fDir = "";

fetch("data.json?_=" + Date.now()).then((r) => r.json()).then((d) => { D = d; init(); })
  .catch(() => { document.querySelector("main").innerHTML = '<p class="err">couldn\'t load the data 😵 — try refreshing</p>'; });

const chainOf = (id) => D.chains.find((c) => c.id === id);
const label = (a) => D.labels?.[a?.toLowerCase()] ?? D.labels?.[a] ?? short(a);
const addr = (c, a) => `<a class="addr" href="${esc(c.explorer)}/address/${esc(a)}" target="_blank" rel="noopener" title="${esc(a)}">${esc(label(a))}</a>`;
const coin = (sym) => `<span class="coin" style="--c:${COLORS[sym] ?? "var(--mute)"}" aria-hidden="true">${esc(sym.slice(0, 4))}</span>`;

function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function countUp(el, to) {
  if (reduce) { el.textContent = usd(to); return; }
  const t0 = performance.now(), dur = 1100;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
    el.textContent = usd(to * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// QR of the bare address: works for every EVM network, the sender's wallet picks the chain.
function drawQr(text) {
  $("qrAddr").textContent = text;
  $("qrCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(text); const i = $("qrCopyIc"); i.textContent = "✓ copied"; setTimeout(() => (i.textContent = "⧉ copy"), 1500); } catch {}
  };
  if (typeof qrcode !== "function") { $("qr").textContent = "QR unavailable — copy the address below."; return; }
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 1; // light border; the white tile around it supplies the quiet zone
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  $("qr").innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

function init() {
  document.title = D.title;
  $("updated").textContent = "updated " + ago(D.updatedAt);
  $("updated").title = new Date(D.updatedAt).toUTCString();
  $("safe").textContent = D.safe;
  $("safeBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(D.safe); const i = document.querySelector(".copy-ic"); i.textContent = "✓ copied"; setTimeout(() => (i.textContent = "⧉ copy"), 1500); } catch {}
  };
  countUp($("total"), D.totalUsd);
  drawQr(D.safe);

  // ticker: live prices from the data itself
  const px = new Map();
  for (const c of D.chains) for (const h of c.holdings) if (h.price != null) px.set(h.symbol === "USDT0" ? "USDT" : h.symbol, h.price);
  const items = [...px].map(([s, p]) => `<span>${esc(s)} <b>${usd(p, p < 1 ? 4 : 2)}</b></span>`).join("");
  $("ticker").innerHTML = (items + items).repeat(4);

  // allocation by asset
  const byAsset = {};
  for (const c of D.chains) for (const h of c.holdings) {
    const k = h.symbol === "USDT0" ? "USDT" : h.symbol;
    byAsset[k] = (byAsset[k] ?? 0) + (h.usd ?? 0);
  }
  const mix = Object.entries(byAsset).sort((a, b) => b[1] - a[1]);
  $("mix").innerHTML = D.totalUsd > 0 ? mix.map(([k, v]) => `<span style="flex-grow:${v};background:${COLORS[k]}" title="${esc(k)}"></span>`).join("") : "";
  $("legend").innerHTML = mix.map(([k, v]) => `<li><i style="background:${COLORS[k]}"></i>${esc(k)} <b>${usd(v)}</b> · ${D.totalUsd ? Math.round((v / D.totalUsd) * 100) : 0}%</li>`).join("");

  // chain cards
  $("chains").innerHTML = D.chains.map((c) => `
    <article class="card" style="--accent:${CHAIN_COLORS[c.id]}">
      <div class="card-top">
        <div class="chain-name"><span class="coin" style="--c:${CHAIN_COLORS[c.id]}" aria-hidden="true">${esc(c.native)}</span>${esc(c.name)}</div>
        <span class="sig" title="Signatures needed to move funds">${c.threshold}/${c.owners.length} sigs</span>
      </div>
      <div class="card-total">${usd(c.totalUsd)}</div>
      ${c.holdings.length ? c.holdings.map((h) => `
        <div class="asset">
          <div class="asset-l">${coin(h.symbol)}<div><b>${esc(h.symbol)}</b><small>${h.price != null ? usd(h.price, h.price < 1 ? 4 : 2) : ""}</small></div></div>
          <div class="asset-r"><b>${num(h.amount)}</b><small>${usd(h.usd)}</small></div>
        </div>`).join("") : '<div class="empty">nothing here yet 🫥</div>'}
    </article>`).join("");

  // pending
  if (D.pending.length) {
    $("pendingSec").hidden = false;
    $("pending").innerHTML = D.pending.map((p) => { const c = chainOf(p.chain); return `<div class="pend"><span class="chip" style="--c:${CHAIN_COLORS[c.id]}">${esc(c.name)}</span> nonce ${p.nonce} → ${addr(c, p.to)} · <b>${p.confirmations}/${p.required}</b> signed</div>`; }).join("");
  }

  // signers
  $("signers").innerHTML = D.chains.map((c) =>
    `<div class="sg"><span class="chip" style="--c:${CHAIN_COLORS[c.id]}">${esc(c.name)}</span><span class="sig">${c.threshold} of ${c.owners.length} to sign</span>${c.owners.map((o) => addr(c, o)).join("")}</div>`).join("");

  // filters
  const mk = (id, opts, get, set) => {
    const el = $(id);
    el.innerHTML = opts.map(([v, t]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${get() === v}">${esc(t)}</button>`).join("");
    el.onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      set(b.dataset.v); shown = PAGE;
      el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      renderFeed();
    };
  };
  mk("fChain", [["", "all chains"], ...D.chains.map((c) => [c.id, c.name])], () => fChain, (v) => (fChain = v));
  mk("fDir", [["", "all"], ["in", "in ↙"], ["out", "out ↗"]], () => fDir, (v) => (fDir = v));
  $("more").onclick = () => { shown += PAGE; renderFeed(); };
  renderFeed();
}

function renderFeed() {
  const list = D.transactions.filter((t) => (!fChain || t.chain === fChain) && (!fDir || t.direction === fDir));
  $("feed").innerHTML = list.slice(0, shown).map((t, i) => {
    const c = chainOf(t.chain);
    const ic = t.direction === "in" ? "↙" : t.direction === "out" ? "↗" : "⚙";
    const title = t.direction === "call" ? "contract call" : `${t.direction === "in" ? "+" : "−"}${num(t.amount)} ${esc(t.symbol)}`;
    const who = t.direction === "in" ? "from" : t.direction === "out" ? "to" : "to";
    return `<li class="tx ${esc(t.direction)}" style="animation-delay:${Math.min(i, 12) * 40}ms">
      <div class="tx-ic" aria-hidden="true">${ic}</div>
      <div><div class="tx-t">${title}${t.failed ? ' <span class="failed">failed</span>' : ""}</div>
        <div class="tx-s">${who} ${t.counterparty ? addr(c, t.counterparty) : ""}</div></div>
      <div class="tx-r"><span class="chip" style="--c:${CHAIN_COLORS[c.id]}">${esc(c.name)}</span>
        <span title="${esc(new Date(t.date).toUTCString())}">${ago(t.date)}</span>
        <a href="${esc(c.explorer)}/tx/${esc(t.txHash)}" target="_blank" rel="noopener">receipt ↗</a></div>
    </li>`;
  }).join("") || '<li class="empty">no transactions match 🫥</li>';
  $("more").hidden = list.length <= shown;
}
