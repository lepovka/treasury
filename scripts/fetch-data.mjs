// Fetches balances, transactions and signer info for the Safe on each chain
// and writes site/data.json. Zero dependencies (Node 18+).
import { readFile, writeFile } from "node:fs/promises";

const cfg = JSON.parse(await readFile(new URL("../config.json", import.meta.url)));
const SAFE_KEY = process.env.SAFE_API_KEY; // optional
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, headers = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    throw new Error(`${res.status} ${url}`);
  }
  throw new Error(`Gave up: ${url}`);
}
const safeGet = (chain, path) =>
  getJson(`https://api.safe.global/tx-service/${chain}/api/v1/${path}`,
    SAFE_KEY ? { Authorization: `Bearer ${SAFE_KEY}` } : {});

async function paginate(chain, path, max) {
  let url = `https://api.safe.global/tx-service/${chain}/api/v1/${path}`;
  const out = [];
  while (url && out.length < max) {
    const page = await getJson(url, SAFE_KEY ? { Authorization: `Bearer ${SAFE_KEY}` } : {});
    out.push(...page.results);
    url = page.next;
  }
  return out.slice(0, max);
}

// Prices: Binance public market data first (free, no key). data-api.binance.vision
// is used because api.binance.com refuses US IPs (GitHub runners). CoinGecko is only
// a fallback for tokens Binance has no USDT pair for.
let binance = null;
async function binancePrices() {
  if (binance) return binance;
  binance = {};
  try {
    const all = await getJson("https://data-api.binance.vision/api/v3/ticker/price");
    for (const t of all) if (t.symbol.endsWith("USDT")) binance[t.symbol.slice(0, -4)] = Number(t.price);
  } catch (e) { console.warn("binance prices:", e.message); }
  return binance;
}
// Dollar stablecoins and their bridged variants: treated as $1 (peg assumption, not a market quote).
const PEGGED = new Set(["USDT", "USDT0", "BSC-USD", "USDC", "USDC.E", "USDBC", "BUSD", "FDUSD", "DAI"]);

async function prices(c, tokens) {
  const b = await binancePrices();
  const p = { native: b[c.native] ?? null, tokens: {}, source: {} };
  const missing = [];
  for (const t of tokens) {
    const sym = t.symbol.toUpperCase();
    if (b[sym] != null) { p.tokens[t.addr] = b[sym]; p.source[t.addr] = "binance"; }
    else if (PEGGED.has(sym)) { p.tokens[t.addr] = b[sym.replace(/\.E$|0$/, "")] ?? 1; p.source[t.addr] = "peg"; }
    else missing.push(t.addr);
  }
  if (p.native == null) {
    try { p.native = (await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${c.coingeckoId}&vs_currencies=usd`))[c.coingeckoId]?.usd ?? null; }
    catch (e) { console.warn(`native price ${c.id}:`, e.message); }
  }
  if (missing.length) {
    try {
      const t = await getJson(`https://api.coingecko.com/api/v3/simple/token_price/${c.platform}?contract_addresses=${missing.join(",")}&vs_currencies=usd`);
      for (const [a, v] of Object.entries(t)) { p.tokens[a.toLowerCase()] = v.usd; p.source[a.toLowerCase()] = "coingecko"; }
    } catch (e) { console.warn(`token prices ${c.id}:`, e.message); }
  }
  return p;
}

const SAFE = cfg.safe.toLowerCase();
// Token symbols are attacker-controlled: strip anything outside printable ASCII
// (zero-width chars, lookalike glyphs) and report whether we had to.
const cleanSym = (s) => { const c = String(s ?? "?").replace(/[^\x21-\x7e]/g, "").slice(0, 12); return { symbol: c || "?", odd: c !== s }; };
const human = (raw, dec) => Number(BigInt(raw)) / 10 ** dec; // fine for display

function flatten(tx, c) {
  const base = {
    chain: c.id, txHash: tx.txHash ?? tx.transactionHash, date: tx.executionDate ?? tx.submissionDate,
    type: tx.txType, failed: tx.isSuccessful === false, nonce: tx.nonce ?? null, safeTxHash: tx.safeTxHash ?? null,
  };
  const rows = [];
  for (const t of tx.transfers ?? []) {
    const isIn = t.to?.toLowerCase() === SAFE;
    const isNative = t.type === "ETHER_TRANSFER";
    const info = t.tokenInfo;
    const sym = isNative ? { symbol: c.native, odd: false } : cleanSym(info?.symbol);
    const unverified = !isNative && (info?.trusted !== true || sym.odd);
    if (!isNative && t.type === "ERC721_TRANSFER") {
      rows.push({ ...base, direction: isIn ? "in" : "out", counterparty: isIn ? t.from : t.to, symbol: cleanSym(info?.symbol).symbol, amount: 1, token: t.tokenAddress, nft: true, unverified: true });
      continue;
    }
    const dec = isNative ? 18 : info?.decimals ?? 18;
    rows.push({
      ...base, direction: isIn ? "in" : "out", counterparty: isIn ? t.from : t.to,
      symbol: sym.symbol, amount: human(t.value ?? "0", dec),
      token: isNative ? null : t.tokenAddress, unverified,
    });
  }
  if (!rows.length) {
    // contract call / zero-value tx, still worth showing
    rows.push({ ...base, direction: "call", counterparty: tx.to, symbol: "", amount: 0, token: null });
  }
  return rows;
}

const out = { title: cfg.title, safe: cfg.safe, updatedAt: new Date().toISOString(), labels: cfg.labels, chains: [], transactions: [], pending: [] };

for (const c of cfg.chains) {
  console.log("Fetching", c.name);
  // Skip chains where this Safe has not been deployed (API answers 404).
  try { await safeGet(c.id, `safes/${cfg.safe}/`); }
  catch (e) { if (String(e.message).startsWith("404")) { console.log(`  not deployed on ${c.name}, skipping`); continue; } throw e; }
  const [info, bal, txs] = await Promise.all([
    safeGet(c.id, `safes/${cfg.safe}/`),
    safeGet(c.id, `safes/${cfg.safe}/balances/?trusted=false&exclude_spam=true`),
    paginate(c.id, `safes/${cfg.safe}/all-transactions/?executed=true&limit=100`, cfg.maxTxPerChain),
  ]);
  let pending = [];
  try {
    pending = (await safeGet(c.id, `safes/${cfg.safe}/multisig-transactions/?executed=false&nonce__gte=${info.nonce}&limit=50`)).results;
  } catch (e) { console.warn("pending:", e.message); }

  const px = await prices(c, bal.filter((b) => b.tokenAddress).map((b) => ({ addr: b.tokenAddress.toLowerCase(), symbol: cleanSym(b.token?.symbol).symbol })));

  const holdings = bal.map((b) => {
    const native = !b.tokenAddress;
    const dec = native ? 18 : b.token?.decimals ?? 18;
    const amount = human(b.balance, dec);
    const price = native ? px.native : px.tokens[b.tokenAddress.toLowerCase()] ?? null;
    return { symbol: native ? c.native : cleanSym(b.token?.symbol).symbol, name: native ? c.name + " native" : b.token?.name ?? "", token: b.tokenAddress, amount, price, usd: price != null ? amount * price : null };
  }).filter((h) => h.amount > 0);

  out.chains.push({
    id: c.id, name: c.name, explorer: c.explorer, owners: info.owners, threshold: info.threshold, nonce: Number(info.nonce),
    holdings, totalUsd: holdings.reduce((s, h) => s + (h.usd ?? 0), 0),
  });
  out.transactions.push(...txs.flatMap((t) => flatten(t, c)));
  out.pending.push(...pending.map((p) => ({
    chain: c.id, safeTxHash: p.safeTxHash, nonce: p.nonce, to: p.to, date: p.submissionDate,
    confirmations: p.confirmations?.length ?? 0, required: p.confirmationsRequired,
  })));
  await sleep(500);
}

out.transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
out.totalUsd = out.chains.reduce((s, c) => s + c.totalUsd, 0);
await writeFile(new URL("../site/data.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(`Done: $${out.totalUsd.toFixed(2)}, ${out.transactions.length} rows, ${out.pending.length} pending`);
