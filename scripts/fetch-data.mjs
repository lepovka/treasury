// Fetches balances, transactions and signer info for the Safe on each chain
// and writes site/data.json. Zero dependencies (Node 18+).
// ONLY the native coin and the tokens allowlisted in config.json are ever published;
// everything else (airdropped spam, spoofed tokens) is dropped here, never reaches the site.
import { readFile, writeFile } from "node:fs/promises";

const cfg = JSON.parse(await readFile(new URL("../config.json", import.meta.url)));
const SAFE_KEY = process.env.SAFE_API_KEY; // optional
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const authHeaders = SAFE_KEY ? { Authorization: `Bearer ${SAFE_KEY}` } : {};

async function getJson(url, headers = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    throw new Error(`${res.status} ${url}`);
  }
  throw new Error(`Gave up: ${url}`);
}
const safeUrl = (chain, path) => `https://api.safe.global/tx-service/${chain}/api/v1/${path}`;
const safeGet = (chain, path) => getJson(safeUrl(chain, path), authHeaders);

async function paginate(chain, path, max) {
  let url = safeUrl(chain, path);
  const out = [];
  while (url && out.length < max) {
    const page = await getJson(url, authHeaders);
    out.push(...page.results);
    url = page.next;
  }
  return out.slice(0, max);
}

// Prices: Binance public market data (free, no key). data-api.binance.vision is used
// because api.binance.com refuses US IPs (GitHub runners). CoinGecko only as a fallback
// for the native coin. Allowlisted USDT variants are treated as $1 (peg assumption).
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
async function nativePrice(c) {
  const b = await binancePrices();
  if (b[c.native] != null) return b[c.native];
  try { return (await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${c.coingeckoId}&vs_currencies=usd`))[c.coingeckoId]?.usd ?? null; }
  catch (e) { console.warn(`native price ${c.id}:`, e.message); return null; }
}

const SAFE = cfg.safe.toLowerCase();
const human = (raw, dec) => Number(BigInt(raw)) / 10 ** dec;

// Returns { symbol, decimals, native } for an allowed asset, or null for anything else.
function allowedAsset(c, tokenAddress) {
  if (!tokenAddress) return { symbol: c.native, decimals: 18, native: true };
  const t = c.tokens.find((x) => x.address.toLowerCase() === tokenAddress.toLowerCase());
  return t ? { symbol: t.symbol, decimals: null, native: false } : null;
}

function flatten(tx, c) {
  const base = {
    chain: c.id, txHash: tx.txHash ?? tx.transactionHash, date: tx.executionDate ?? tx.submissionDate,
    failed: tx.isSuccessful === false,
  };
  const rows = [];
  for (const t of tx.transfers ?? []) {
    if (t.type === "ERC721_TRANSFER") continue;
    const a = allowedAsset(c, t.type === "ETHER_TRANSFER" ? null : t.tokenAddress);
    if (!a) continue;
    const dec = a.native ? 18 : t.tokenInfo?.decimals ?? 6;
    const isIn = t.to?.toLowerCase() === SAFE;
    rows.push({ ...base, direction: isIn ? "in" : "out", counterparty: isIn ? t.from : t.to, symbol: a.symbol, amount: human(t.value ?? "0", dec) });
  }
  // Safe-initiated calls without a transfer (owner changes, etc.) stay visible for transparency.
  // Plain incoming ETHEREUM_TRANSACTIONs without allowed transfers are noise/spam: dropped.
  if (!rows.length && tx.txType === "MULTISIG_TRANSACTION") {
    rows.push({ ...base, direction: "call", counterparty: tx.to, symbol: "", amount: 0 });
  }
  return rows;
}

const out = {
  title: cfg.title, safe: cfg.safe, updatedAt: new Date().toISOString(), labels: cfg.labels,
  chains: [], transactions: [], pending: [],
};

for (const c of cfg.chains) {
  console.log("Fetching", c.name);
  // Skip chains where this Safe has not been deployed (API answers 404).
  let info;
  try { info = await safeGet(c.id, `safes/${cfg.safe}/`); }
  catch (e) { if (String(e.message).startsWith("404")) { console.log(`  not deployed on ${c.name}, skipping`); continue; } throw e; }

  const [bal, txs] = await Promise.all([
    safeGet(c.id, `safes/${cfg.safe}/balances/?trusted=false&exclude_spam=false`),
    paginate(c.id, `safes/${cfg.safe}/all-transactions/?executed=true&limit=100`, cfg.maxTxPerChain),
  ]);
  let pending = [];
  try { pending = (await safeGet(c.id, `safes/${cfg.safe}/multisig-transactions/?executed=false&nonce__gte=${info.nonce}&limit=50`)).results; }
  catch (e) { console.warn("pending:", e.message); }

  const nPrice = await nativePrice(c);
  const holdings = [];
  for (const b of bal) {
    const a = allowedAsset(c, b.tokenAddress);
    if (!a) continue; // not on the allowlist: never published
    const amount = human(b.balance, a.native ? 18 : b.token?.decimals ?? 6);
    const price = a.native ? nPrice : 1;
    if (amount > 0) holdings.push({ symbol: a.symbol, native: a.native, amount, price, usd: price != null ? amount * price : null });
  }
  holdings.sort((x, y) => (y.usd ?? 0) - (x.usd ?? 0));

  out.chains.push({
    id: c.id, name: c.name, native: c.native, explorer: c.explorer, owners: info.owners, threshold: info.threshold,
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
