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

**Included** — 10 tabs, all computed live client-side from SEC filings:
- **Cover story** — headline facts + a mechanically generated summary
- **KPI chapters** — 30 KPI cards across all 8 of the PRD's categories
  (growth, profitability, returns, cash, balance sheet, efficiency, owner
  returns, and a deliberately thin "valuation context" — see `js/kpi-library.js`
  for why), each with a chart, trend verdict, and progressive depth
  (Headline → collapsed "Explain" → collapsed "CFA detail"), plus a
  Story-mode/Analyst-mode reading toggle and a per-chart PNG download
- **Stories** — 12 combined two-KPI overlay charts with a rule-based
  (not AI-written) narrative sentence per pairing
- **Follow the money** — cash-flow chart + full annual figures table
- **Timeline** — an auto-generated, rule-based chronological narrative built
  only from filing data (see below for why it's not a price chart)
- **Track Record** — filing consistency, growth/margin volatility and
  loss-year history (a deliberately honest stand-in for "future plans
  vs. delivered" — see below)
- **Verdict** — an 8-question owner's checklist (explicitly *not* a buy/sell
  signal) plus any automated red flags
- **What is it worth** — owner-earnings-multiple range, a 3-scenario DCF, and
  a book-value-compounding projection (3 of the PRD's 5 valuation methods;
  sum-of-parts/NAV were investigated and ruled out — see `js/valuation.js`),
  a margin-of-safety gauge against a price you type in, and full-dossier PDF
  export (browser print) alongside the KPI-table CSV export
- **Compare** — manual two-ticker side-by-side (not auto peer-ranking — see
  below)
- **Sources** — direct links to the primary filings, a confidence legend
  distinguishing directly-reported figures from computed estimates, and a
  "report an error" link to this repo's GitHub issues (which doubles as a
  free, honest public corrections log)

Plus: 140+ glossary terms with hover/tap/keyboard-focusable definitions, a
dismissible first-run tour, WCAG AA-audited color contrast and keyboard
navigation (tabs, glossary tooltips), and richer live progress messages
while a dossier loads.

**Deliberately scoped down rather than faked**, each investigated on its own
merits rather than assumed impossible:
- **Competitors → Compare tab.** SEC's per-company `submissions.json` does
  carry an industry code, but finding *other* companies sharing it needs a
  bulk SIC index SEC doesn't expose for free in one file. Auto peer-ranking
  was ruled out; the Compare tab lets you pick the second company yourself.
- **Timeline → narrative timeline, not a price chart.** No free, keyless,
  CORS-friendly historical price API exists (we already had to build our own
  CORS proxy just for SEC's own data), and macro data needs a keyed API like
  FRED. The Timeline tab tells the story from filing data alone instead.
- **Future plans → Track Record tab.** Forward guidance is free-text
  MD&A/earnings-call prose, never a structured XBRL tag — there's no free,
  comparable source for it. The Track Record tab reports filing/growth/margin
  *consistency* instead, and says explicitly that it isn't guidance-tracking.
- **Sum-of-parts / NAV valuation.** SEC XBRL segment reporting uses each
  filer's own custom, non-standardized tags — reliably reading it would mean
  per-company hand-curated mappings, which this project avoids everywhere
  else. Ruled out rather than shipped with fabricated segment splits.
- **Sector packs** (bank/REIT/insurer-specific KPIs). Investigated and found
  feasible for exactly one sector (banks — `us-gaap:InterestIncomeExpenseNet`
  etc. are standardized; REIT FFO and insurer combined-ratio figures are not).
  Built in `js/sector-packs.js` but **not yet wired in** — it needs the
  Cloudflare Worker's allow-list extended to SEC's `submissions.json`
  endpoint and a redeploy first; see the file's own integration notes.

**Still genuinely out of scope** (would need a paid data source, a login
system, or persistent server-side storage — a real product decision, not
derivable from "make it free and run on the fly"): lawsuits/regulatory/court
records, management/people profiles, live price ticking, saved notebooks and
alerts, non-US companies (SEC EDGAR is US-only), and the "point-in-time /
time travel" mode (it needs figures stored with historical publication
dates, i.e. a database).

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

### The CORS proxy is deployed

The Worker is live at `https://value-wiki-sec-proxy.shrey-cowork-use.workers.dev`
and wired into `PROXY_URL` in `js/sec.js`. It redeploys itself via
`.github/workflows/deploy-worker.yml` on every push that touches
`cloudflare-worker/`, using two repo-level GitHub Actions secrets
(`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) already configured against
a free Cloudflare account (Workers' free tier — 100,000 requests/day, no
paid plan needed).

If you ever need to redo this setup (e.g. forking this repo into a fresh
Cloudflare account): create the account, grab the Account ID from the
dashboard sidebar, create an API token at
https://dash.cloudflare.com/profile/api-tokens using the "Edit Cloudflare
Workers" template, add both as **repository-level** secrets under Settings →
Secrets and variables → Actions (not an "Environment" — the workflow doesn't
target one, so environment-scoped secrets aren't visible to it), register a
workers.dev subdomain the first time at
https://dash.cloudflare.com/*/workers/onboarding if your account doesn't
have one yet, then re-run the "Deploy SEC CORS proxy" workflow and copy the
URL its logs print into `PROXY_URL`.

Even if this ever breaks, the app still works wherever `data.sec.gov`'s
direct fetch isn't blocked — the proxy is a fallback, not a requirement to
run.

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
5. `js/ui.js` and `js/charts.js` render the core tabs; `js/stories.js`,
   `js/timeline.js`, `js/execution.js`, `js/compare.js` and
   `js/valuation-extra.js` render the rest — all following the same
   fixed-rule, no-AI, no-fabricated-data approach, using the vendored
   Chart.js.

Everything above runs client-side, in the visitor's own browser.
