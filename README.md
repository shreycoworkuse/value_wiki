# Value Wiki

A search-engine-style dashboard for learning value investing. Type a US
ticker (or one of a curated list of major London Stock Exchange names) and
get a live "dossier": up to ~15-20 years of KPI charts, cash-flow history, an
automated red-flag scan, a Buffett/Li Lu-style owner's checklist verdict, and
a rough intrinsic-value estimate — built on the fly, in your browser,
straight from the company's own regulatory filings.

**Try it:** open `index.html` (or run the local server below) and search
`AAPL`, `KO`, `MSFT`, `JNJ` or `WMT`, or `VOD` for a London Stock Exchange
example.

## Why it's free, with no login, and no database

- **No backend, no server-side storage.** This is a static site: HTML, CSS
  and vanilla JS modules, plus one vendored library (Chart.js, copied into
  `vendor/` so there's zero CDN dependency at runtime). It can be hosted for
  free on GitHub Pages, or literally any static file host, or opened locally.
- **No accounts, no login.** Nothing is personalized and nothing needs to be
  remembered across visits. Close the tab and there's nothing left behind
  except an optional light/dark theme preference in your own browser's
  `localStorage`.
- **All data is fetched live, on the fly, straight from the source.** For US
  companies, every number comes from the SEC's free, public, no-API-key
  EDGAR endpoints — the company ticker list
  (`www.sec.gov/files/company_tickers.json`) and each company's structured
  XBRL filings (`data.sec.gov/api/xbrl/companyfacts/...`). For a curated list
  of LSE names, numbers are parsed live from Inline XBRL (iXBRL) inside
  annual report documents filed with UK Companies House — see
  "UK / LSE support" below. There's no multi-GB database anywhere: your
  browser asks the filing regulator for one company's numbers, computes
  everything client-side, and throws it away when you navigate away.
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

## UK / LSE support

A curated list of ~40 major London Stock Exchange names (`UK_TICKERS` in
`js/uk-companies.js`) is searchable alongside US tickers — e.g. `VOD`
(Vodafone), `ULVR` (Unilever), `HSBA` (HSBC). Search and the resolver
(`resolveCompanyState()` in `js/main.js`) try SEC first, then fall back to
this UK list, so US and UK companies share one search box.

**Why this is a curated list, not open ticker search:** the UK has no free
equivalent of SEC's ticker-to-CIK JSON file. Resolving an LSE ticker to a UK
Companies House company number requires a Companies House company-search
API call per lookup, so — to keep this free and without hardcoding real
company data at build time — only tickers a person actually deploying this
app has chosen to list are searchable. Adding a company means adding one
line to `UK_TICKERS`, not touching a database.

**Why the numbers come from a hand-written iXBRL parser, not a clean JSON
API:** unlike SEC's XBRL, UK Companies House does not expose structured
financial figures as JSON. Its API (`api.company-information.service.gov.uk`)
only returns filing *metadata* (dates, categories, document links); the
actual numbers live inside the filed annual report itself, as Inline XBRL
(iXBRL) — financial facts tagged in-place inside an XHTML document using the
`ifrs-full:`/`uk-gaap:` taxonomies. `js/ixbrl.js` is a from-scratch parser
for that format: it walks `<ix:nonFraction>`/`<ix:nonNumeric>` tags, resolves
each fact's `<xbrli:context>` to a period, applies `scale` and `sign`, and
picks the non-dimensional (consolidated, whole-company) figure for each
concept and period.

**Honest limitation — this has not been tested against a real, live
Companies House filing.** The sandbox this app was built in cannot reach
`api.company-information.service.gov.uk` or the Companies House document
API, so the iXBRL parser and the UK resolution pipeline were validated
end-to-end against a hand-built, spec-compliant *synthetic* iXBRL fixture
(`test_ixbrl.js`, `test_uk_pipeline.js` in the dev scratchpad — not part of
the deployed site), not a real filing. Real annual reports vary in how they
lay out dimensional data, rounding, and negative-value conventions far more
than a single synthetic fixture can cover, so treat any UK company's numbers
as unverified until you've checked them against the linked Companies House
filing yourself (the Sources tab links directly to it). If a UK filing
doesn't parse cleanly, that's a real, expected possibility — please open an
issue with the company and filing so the parser can be improved against it.

**Setup required for UK support to work live:** register a free API key at
https://developer.company-information.service.gov.uk (Companies House's own
free, no-cost developer program — no credit card, no paid tier) and add it
as a repository-level GitHub Actions secret named `COMPANIES_HOUSE_API_KEY`,
the same way as the Cloudflare secrets above. The Worker forwards it as HTTP
Basic Auth to Companies House (`chAuthHeader()` in `sec-proxy.js`). Without
this secret set, UK lookups fail gracefully with a clear "Companies House
API key not configured" message rather than a silent or confusing error —
the rest of the site (all US/SEC functionality) is unaffected either way.

## The "Money flow" tab

One unified, timeline-driven screen (`js/money-flow.js`) showing the whole
business over time, built almost entirely from data the app is already
fetching. A single time slider (drag it, click a period in the timeline, or
use the step buttons) drives every panel at once:

- **Left — balance-sheet bars.** Every asset/liability/equity line the
  company's filings break out (`js/financial-graph.js`'s stock-layer nodes:
  cash, receivables, inventory, PP&E, goodwill, debt, payables, etc.), each
  as a horizontal bar whose length is proportional to the largest balance
  shown that period, smoothly animating in place as the timeline moves.
  Click any bar to plot it.
- **Center — the selected item's full history.** A line chart of whatever
  bar (or "Total assets", the default) you last clicked, across every
  period on file, with the currently-scrubbed period marked and its latest
  growth rate shown.
- **Right, top — a vertical, quarter-by-quarter timeline.** Every real
  period the company has filed, each with a one-line, rule-derived summary
  of what happened (`js/narrative-line.js`) — the period's single most
  notable real change (a debt spike, a margin move, inventory outpacing
  sales, free cash flow flipping sign, ...), or a plain revenue-growth
  readout when nothing crosses a threshold. Same house style as the
  Verdict tab's red-flag checks: fixed, published thresholds, no AI,
  nothing invented.
- **Right, bottom — price vs. book value per share.** A chart with three
  lines: the stock price up to the current scrub position (solid, bold),
  the stock price beyond it (faint, dashed — it's real historical data, not
  a forecast, just not "reached" yet on the timeline), and book value per
  share across the company's full history (grey, dashed). See below for
  where the price data comes from.

**The data engine underneath (`js/financial-graph.js`):** normalizes one
period's figures into a fixed set of nodes (dollar buckets), plus a
cash-flow reconciliation check (opening cash + operating + investing +
financing cash flow should equal closing cash) that flags — rather than
silently hides — a real inconsistency in what was filed.

**Bucket granularity is honest, not aspirational.** The node set matches
exactly what standardized XBRL actually breaks a filing into — cash,
receivables, inventory, PP&E, goodwill, debt, payables, and the core
balance-sheet lines. It is *not* a line-item breakdown into things like
"Employees" or "Marketing" spend — that granularity isn't tagged as
structured, free data anywhere, for arbitrary companies, so this tool
doesn't pretend to have it.

**Quarterly resolution is US/SEC-only.** `js/kpis.js`'s `buildQuarterlySeries()`
extracts per-quarter figures from the same already-fetched company-facts
payload (10-Q "three months ended" contexts), deriving each year's Q4 as
the fiscal-year total minus Q1+Q2+Q3 — a standard technique, and only ever
applied when all three quarters were actually filed, never guessed from an
incomplete set. (One tag needs different handling here: a weighted-average
diluted share count isn't additive the way revenue is, so its Q4 uses the
reported full-year figure directly rather than being derived by
subtraction — see the `kind: "average"` case in `extractQuarterly()`.) UK
companies (Companies House files annual accounts only, no quarterly
equivalent) fall back to annual resolution here, clearly labeled in the
tab itself rather than silently only working for one market.

**Why some figures used to have gaps, and don't anymore.** Every metric
here is read from a small fallback list of XBRL tag names (e.g. cost of
revenue can be tagged `CostOfRevenue` or `CostOfGoodsAndServicesSold`), because
a company can switch which tag it uses for the same concept partway through
its filing history (a common, real pattern — many filers moved to newer
ASC 606 revenue tags around 2018). `pickTag()`/`buildQuarterlySeries()`
used to commit to the *first* tag variant that had any data at all,
silently dropping every period reported under the other tag — which showed
up as a gap in a company's history even though it really had reported that
figure, just under a different tag name. Both now merge every tag
variant's data on a period-by-period basis instead.

**Where the price data comes from.** There is no *official* free,
no-key stock-price API. This tab uses Stooq's free daily-close CSV export
(`stooq.com/q/d/l/`) instead — no login, no API key, the same free-tier
source a number of small/hobby finance tools rely on for exactly this,
proxied through the same Cloudflare Worker as the SEC/Companies House data
(`service=stooq` in `cloudflare-worker/sec-proxy.js`, ticker mapped to
`<ticker>.us` or `<ticker>.uk`). It's an unofficial, best-effort source —
gaps, an occasional rate limit, or a temporary outage are all possible — so
a failed or missing price fetch degrades gracefully: the rest of the
screen (bars, drill-down, timeline, book value/share) stays fully
functional, with a plain "price data unavailable" note instead of a
fabricated or interpolated price.

## How the data flows

1. `js/sec.js` reads the same-origin `data/company_tickers.json` (refreshed
   from SEC on every deploy — see above) for ticker search, and fetches a
   company's full XBRL "company facts" JSON live from `data.sec.gov` (or,
   as a fallback, the Cloudflare Worker proxy) on each search. For a UK
   ticker, `js/uk-companies.js` and `js/ixbrl.js` do the equivalent job
   through the same Worker (`service=ch` routing) against Companies House
   and its filed iXBRL documents — see "UK / LSE support" above.
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
6. `js/money-flow.js` renders the "Money flow" tab, reading through
   `js/financial-graph.js` for the balance-sheet bars, `js/narrative-line.js`
   for the timeline's one-liners, and `js/stock-price.js` (via the same
   Cloudflare Worker, now also proxying Stooq) for the price chart — see
   "The Money flow tab" above.

Everything above runs client-side, in the visitor's own browser.
