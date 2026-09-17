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

## Why there's a fetch script at all (a CORS note)

`data.sec.gov`'s XBRL API (company facts — the actual financial figures) is
built for exactly this kind of direct browser use and sends the right CORS
headers. SEC's ticker→CIK→name list, though, is served from `www.sec.gov` — a
plain content server, not the API domain — with no CORS header, so browsers
block cross-origin JS from reading it. Since it's small (~1MB), public,
rarely-changing reference data (not user data), the pragmatic fix is to fetch
it server-side (where CORS doesn't apply) at deploy/dev time and serve it
same-origin as a static file — see `scripts/fetch-tickers.sh`, the deploy
workflow, and the comment at the top of `js/sec.js`. Every other figure in
the app still comes from a genuine live, on-the-fly, client-side fetch.

## How the data flows

1. `js/sec.js` reads the same-origin `data/company_tickers.json` (refreshed
   from SEC on every deploy — see above) for ticker search, and fetches a
   company's full XBRL "company facts" JSON live from `data.sec.gov` on
   each search.
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
