# Value Wiki

A search-engine-style dashboard for learning value investing. Type a US
ticker and get a live "dossier": up to ~15-20 years of KPI charts, cash-flow
history, an automated red-flag scan, a Buffett/Li Lu-style owner's checklist
verdict, and a rough intrinsic-value estimate — built on the fly, in your
browser, straight from the company's own SEC filings.

**Try it:** open `index.html` (or run the local server below) and search
`AAPL`, `KO`, `MSFT`, `JNJ` or `WMT`, or any other US-listed ticker.

## Why it's free, with no login, and no database

- **No backend, no server-side storage.** This is a static site: HTML, CSS
  and vanilla JS modules, plus one vendored library (Chart.js, copied into
  `vendor/` so there's zero CDN dependency at runtime). It can be hosted for
  free on GitHub Pages, or literally any static file host, or opened locally.
- **No accounts, no login.** Nothing is personalized and nothing needs to be
  remembered across visits. Close the tab and there's nothing left behind
  except an optional light/dark theme preference in your own browser's
  `localStorage`.
- **All data is fetched live, on the fly, straight from the source.** Every
  number comes from the U.S. SEC's free, public, no-API-key EDGAR endpoints —
  the company ticker list (`www.sec.gov/files/company_tickers.json`) and each
  company's structured XBRL filings (`data.sec.gov/api/xbrl/companyfacts/...`).
  There's no multi-GB database anywhere: your browser asks the SEC for one
  company's numbers, computes everything client-side, and throws it away when
  you navigate away.
- **No paid market-data feed.** Instead of a licensed real-time price API,
  the valuation tab lets you optionally type in a price you see anywhere, and
  recomputes P/E, P/B and a margin-of-safety gauge instantly from that.

## Scope: this is a deliberately smaller build than the linked PRD

The product spec this was based on ("Business Dossier: 20-Year Investigative
Analysis of Any Company") describes a full commercial SaaS product — licensed
real-time exchange data, licensed news/court archives, user accounts with
saved notes and alerts, a persistent database for point-in-time correctness,
and an LLM extraction pipeline. That's the opposite of "free, no login,
run-on-the-fly," so this build intentionally implements a lighter concept
that stays true to the free/no-login/no-storage brief instead:

**Included:** ticker search, a cover-story summary, 8 core KPI charts
(revenue, net income, margins, ROE/ROA, debt-to-equity, free cash flow),
a "follow the money" cash-flow table, automated rule-based red-flag checks,
an 8-question owner's checklist verdict (explicitly *not* a buy/sell signal),
a simple owner-earnings-based valuation range with a margin-of-safety gauge,
dotted-underline glossary tooltips for ~25 financial terms, direct links to
the primary SEC filings behind every number, and CSV export of the KPI table.

**Left out** (all of it would require a paid data source, a login system, or
persistent server-side storage — a real product decision, not derivable from
"make it free and run on the fly"): lawsuits/regulatory/court records,
management/people profiles, competitor comparison grids, live price ticking,
saved notebooks and alerts, PDF export, non-US companies (SEC EDGAR is
US-only), and the "point-in-time / time travel" mode (it needs figures stored
with historical publication dates, i.e. a database).

## Running it locally

No build step and no dependencies to install — it's plain HTML/CSS/JS.

```bash
./scripts/fetch-tickers.sh   # one-time: fetches data/company_tickers.json
python3 -m http.server 8080
# then open http://localhost:8080
```

Any other static file server works too (`npx serve`, VS Code's Live Server,
etc.). Deploying it for free means pushing these files to GitHub Pages,
Netlify, Vercel, Cloudflare Pages, or any static host — no server-side
runtime or database required. The GitHub Pages workflow in this repo
(`.github/workflows/deploy-pages.yml`) runs the same fetch script on every
deploy automatically.

## Why the app fights CORS in two different ways

Neither of SEC's public JSON sources sends a CORS header for third-party
origins, so a plain browser `fetch()` to either one gets blocked from
anywhere other than sec.gov itself. The two are handled differently because
they have different shapes:

- **Ticker → CIK → name list** (`www.sec.gov/files/company_tickers.json`):
  small (~1MB), public, rarely-changing reference data — not user data, and
  the same for every visitor. Fetched once server-side (where CORS doesn't
  apply) at deploy/dev time and published same-origin as a static file — see
  `scripts/fetch-tickers.sh` and the deploy workflow. No proxy needed.

- **Company facts** (`data.sec.gov/api/xbrl/companyfacts/...`): the actual
  live financial data, fetched fresh per search for whatever ticker a
  visitor types. It can't be pre-fetched the same way — bundling every
  covered company's data at deploy time would mean exactly the kind of
  multi-GB database this project is deliberately avoiding. Instead,
  `fetchCompanyFacts()` tries the direct request first and, only if that's
  blocked, falls back to a small Cloudflare Worker (`cloudflare-worker/`)
  that we control: it forwards the same GET request and adds the missing
  CORS header, nothing else — no logging, no storage, no account system, and
  it only ever proxies SEC's company-facts endpoint (see the allow-list in
  `sec-proxy.js`), so it can't be used as a general-purpose open proxy. A
  public third-party CORS relay (corsproxy.io, allorigins.win, etc.) was
  deliberately ruled out for this — it would see every ticker a visitor
  looks up, and we can't vouch for a stranger's service.

### Setting up the CORS proxy (one-time, free)

The Worker deploys itself via `.github/workflows/deploy-worker.yml` on every
push that touches `cloudflare-worker/`, but it needs two GitHub Actions
secrets pointing at a free Cloudflare account:

1. Create a free account at https://dash.cloudflare.com/sign-up (Workers'
   free tier — 100,000 requests/day — doesn't require a paid plan).
2. Get your **Account ID** from the right sidebar of the Cloudflare
   dashboard.
3. Create an **API token** at
   https://dash.cloudflare.com/profile/api-tokens → "Create Token" → use the
   "Edit Cloudflare Workers" template.
4. In this repo, go to Settings → Secrets and variables → Actions, and add:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
5. Push (or manually re-run the "Deploy SEC CORS proxy" workflow). Its logs
   will print the Worker's URL (`https://value-wiki-sec-proxy.<your
   subdomain>.workers.dev`) — paste that into `PROXY_URL` at the top of
   `js/sec.js` and push again.

Until that's done, the app still works wherever `data.sec.gov`'s direct
fetch isn't blocked — the proxy is a fallback, not a requirement to run.

## How the data flows

1. `js/sec.js` reads the same-origin `data/company_tickers.json` (refreshed
   from SEC on every deploy — see above) for ticker search, and fetches a
   company's full XBRL "company facts" JSON live from `data.sec.gov` (or,
   as a fallback, the Cloudflare Worker proxy) on each search.
2. `js/kpis.js` collapses the raw, sometimes-duplicated XBRL facts into one
   clean annual figure per fiscal year (preferring the most recently filed,
   audited value for each period), and derives ratios like margins, ROE and
   free cash flow.
3. `js/redflags.js` and `js/verdict.js` run fixed, published rules over that
   table — no AI, no hidden model, no price target.
4. `js/valuation.js` computes book value and a wide owner-earnings-based
   intrinsic value range, optionally compared against a price you type in.
5. `js/ui.js` and `js/charts.js` render all of the above into the dossier's
   tabs using the vendored Chart.js.

Everything above runs client-side, in the visitor's own browser.
