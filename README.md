# Treasury Dashboard

Public, read-only dashboard for a Safe multisig on Ethereum, BNB Chain and Polygon.

- `config.json` – Safe address, chains, optional address `labels` (`{"0xabc…": "Payroll"}`)
- `scripts/fetch-data.mjs` – pulls data from the Safe Transaction Service + CoinGecko, writes `site/data.json`
- `site/` – static frontend (no build step)
- `.github/workflows/update.yml` – refreshes data every 15 min and deploys to GitHub Pages

## Local
```
node scripts/fetch-data.mjs
npx serve site     # or: python3 -m http.server -d site
```

## Deploy
1. Push to a GitHub repo (`main` branch).
2. Settings → Pages → Source: **GitHub Actions**.
3. Optional: add repo secret `SAFE_API_KEY` if Safe starts requiring one.
