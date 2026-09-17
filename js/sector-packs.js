// Sector packs: optional, low-priority per the original PRD. The idea is
// that a handful of industries have standard metrics (gross margin, debt-to-
// equity as computed elsewhere in this app, etc.) that are misleading or
// meaningless for them, and would benefit from a small swap-in of
// industry-specific KPIs computed from XBRL tags that industry actually uses
// consistently.
//
// Investigated: banks, insurers, REITs, miners. Only BANKS turned out to be
// genuinely tractable with reliable, consistently-tagged XBRL data — see the
// "Why only banks" note near the bottom of this file for what was checked and
// ruled out for the other three, and js/main.js's caller (once wired up, see
// "INTEGRATION" below) is expected to treat every other sector as "no pack
// available" and just show the standard KPIs.
//
// This file is intentionally self-contained: it does not fetch anything and
// does not import from or modify any other file in this app. It takes
// already-fetched data as plain arguments (SEC "submissions" JSON for
// detection, SEC "company facts" JSON + the core dossier's `years` array for
// the KPI numbers) and returns plain data for the caller to render.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE NEEDS THAT ISN'T WIRED UP YET
// ---------------------------------------------------------------------------
// Sector detection (detectSector, below) reads the `sic` field from SEC's
// company SUBMISSIONS endpoint:
//
//   https://data.sec.gov/submissions/CIK##########.json
//
// That is a DIFFERENT endpoint from the company-facts one this app already
// fetches in js/sec.js (fetchCompanyFacts -> .../api/xbrl/companyfacts/...).
// Nothing in this codebase fetches the submissions endpoint today, and this
// file does not fetch it either by design (see function docs below).
//
// data.sec.gov sends no Access-Control-Allow-Origin header on ANY of its
// endpoints -- confirmed the same way the existing company-facts CORS wall
// was found, since it's the same host with the same lack of a CORS header on
// every path. So a direct browser fetch of the submissions endpoint will be
// blocked for this site's origin exactly like company-facts was, and would
// need the same Cloudflare Worker fallback this app already uses
// (cloudflare-worker/sec-proxy.js). That Worker currently allow-lists ONLY
// the company-facts URL prefix (see ALLOWED_PREFIX / isAllowedTarget in that
// file). To support the submissions endpoint too, it needs ONE more allowed
// prefix, mirroring the existing check exactly:
//
//   const ALLOWED_PREFIXES = [
//     "https://data.sec.gov/api/xbrl/companyfacts/CIK",
//     "https://data.sec.gov/submissions/CIK",
//   ];
//   function isAllowedTarget(url) {
//     return ALLOWED_PREFIXES.some((p) => url.startsWith(p)) && url.endsWith(".json") && !url.includes("..");
//   }
//
// This file deliberately does NOT modify the Worker -- that change has to be
// applied and redeployed by whoever has Cloudflare access. Nothing below
// depends on the Worker change to load correctly; it just won't have real
// sector data to work with until (a) that Worker change ships and (b) the
// caller actually fetches the submissions JSON (see INTEGRATION below).
// ---------------------------------------------------------------------------
// INTEGRATION (none of this is done for you -- see report for why)
// ---------------------------------------------------------------------------
// 1. cloudflare-worker/sec-proxy.js: apply the ALLOWED_PREFIX change above
//    and redeploy (human step, see PR/report).
// 2. js/sec.js: add a fetchCompanySubmissions(cik10, onProgress) function
//    that mirrors fetchCompanyFacts() exactly, but targets
//    `https://data.sec.gov/submissions/CIK${cik10}.json` instead of the
//    companyfacts URL. It can reuse the existing fetchFactsJson() helper
//    unchanged (that helper already takes an arbitrary target URL).
// 3. js/main.js (loadDossier): after `const facts = await fetchCompanyFacts(...)`,
//    also call `const submissions = await fetchCompanySubmissions(match.cik, onProgress)`
//    (wrap in try/catch and treat failure as "no sector detected" --
//    sector packs are a bonus, never a hard requirement to render a dossier),
//    then:
//      import { detectSector, buildBankSeries, computeBankDerived } from "./sector-packs.js";
//      const sector = detectSector(submissions);
//      let sectorData = null;
//      if (sector?.id === "bank") {
//        const bankSeries = buildBankSeries(facts, base.years);
//        sectorData = { sector, ...computeBankDerived(bankSeries, base.years, base.series.assets) };
//      }
//    and stash `sectorData` on `state` alongside the other dossier state.
// 4. js/ui.js (renderKpiGrid): after the existing KPI_LIST loop, if
//    `sectorData` was passed in, render one additional card per entry in
//    BANK_KPI_CARDS using `sectorData[card.key]` the same way the existing
//    loop renders `derived[kpi.key]` -- same card markup, same
//    renderLineChart call, just a different backing array. A one-line
//    sector banner ("Sector pack: Bank / depository institution -- showing
//    bank-specific KPIs in addition to the standard ones") is worth adding
//    above the grid so it's clear these are supplemental, not a data error
//    where other cards look sparse.
// ---------------------------------------------------------------------------

// SIC codes SEC files banks and bank holding companies under. Sourced from
// SEC's own SIC code classification (sec.gov/cgi-bin/browse-edgar?action=getcompany&SIC=####):
//   6020/6021/6022/6029 - national/state commercial banks
//   6035/6036           - savings institutions (thrifts/savings & loans)
//   6712                - "Offices of Bank Holding Companies" -- where most
//                          large, publicly-traded bank holding companies
//                          (e.g. the parent entities that file 10-Ks for
//                          major consumer/commercial banks) are actually
//                          classified in EDGAR, rather than under 6020-6022.
// Deliberately NOT included: 6199 (finance services, too broad/mixed), 6211
// (security brokers/dealers -- investment banks like Goldman Sachs/Morgan
// Stanley have a materially different income-statement shape and would need
// their own pack, not this one), 6798 (REITs -- see "Why only banks" below).
const BANK_SIC_CODES = new Set(["6020", "6021", "6022", "6029", "6035", "6036", "6712"]);

// detectSector(submissions)
//   submissions: the already-fetched, already-parsed JSON from
//     https://data.sec.gov/submissions/CIK##########.json
//     (an object with, among others, top-level `sic` and `sicDescription`
//     string fields -- this function does not fetch it, see notes above).
// Returns { id, label, sic, sicDescription } for a recognized sector, or
// null if this company doesn't match any pack this file implements (which,
// right now, is every non-bank company -- returning null is the normal,
// expected result for most tickers and should be treated by the caller as
// "no sector pack, show the standard KPIs only").
export function detectSector(submissions) {
  if (!submissions || typeof submissions !== "object") return null;
  const sic = String(submissions.sic ?? "").trim();
  if (!sic) return null;
  if (BANK_SIC_CODES.has(sic)) {
    return {
      id: "bank",
      label: "Bank / depository institution",
      sic,
      sicDescription: submissions.sicDescription || null,
    };
  }
  return null;
}

// --- Bank sector pack -------------------------------------------------

// XBRL tags used, and why each was picked:
//
// us-gaap:InterestIncomeExpenseNet ("net interest income before provision
// for loan losses") -- the single most standard, widely-used tag banks use
// for their core spread business. Verified in real 10-K filings from
// multiple bank holding companies. This is THE headline number banks report
// themselves and analysts track; it has no equivalent among this app's core
// KPIs because non-bank companies don't have it at all.
//
// us-gaap:NoninterestIncome / us-gaap:NoninterestExpense -- standard,
// commonly-used tags for a bank's fee income and operating overhead. Used
// together with net interest income to compute the industry-standard
// "efficiency ratio" (see computeBankDerived), a metric universally reported
// by banks and bank analysts that has no equivalent in this app's core KPIs.
//
// Deliberately NOT included as a KPI here: a true net interest margin (NII
// / average earning assets). "Average earning assets" is not a single
// standardized XBRL tag -- what counts as an "earning asset" varies by bank
// and is usually only disclosed in an MD&A table, tagged inconsistently (or
// not at all) across filers. Rather than fabricate a pseudo-standard tag
// list, this pack computes NII as a share of TOTAL assets instead (which
// case IS a reliable, always-present tag: us-gaap:Assets, already fetched by
// this app's core KPI set) and labels it plainly as an approximation, not as
// "NIM" -- see the label text in BANK_KPI_CARDS.
const BANK_TAGS = {
  netInterestIncome: { tags: ["InterestIncomeExpenseNet"], kind: "flow" },
  noninterestIncome: { tags: ["NoninterestIncome"], kind: "flow" },
  noninterestExpense: { tags: ["NoninterestExpense"], kind: "flow" },
};

// Mirrors js/kpis.js's annualize()/pickTag() logic exactly (10-K/10-K/A
// filings only; for flow items, only entries covering a full ~year so
// quarterly/stub periods don't sneak in; when a fiscal-year-end date has
// more than one reported entry, the most recently filed one wins, since
// later filings carry restated/audited comparative figures). Duplicated
// here rather than imported so this file has zero coupling to kpis.js and
// can be dropped in or removed without touching it -- see INTEGRATION step 3
// for the (very small) alternative of importing kpis.js's helpers instead,
// if the duplication ever drifts.
function durationDays(entry) {
  if (!entry.start || !entry.end) return null;
  return (new Date(entry.end) - new Date(entry.start)) / 86400000;
}

function annualizeTag(unitArray, kind) {
  const byEnd = new Map();
  for (const entry of unitArray || []) {
    if (!entry.form || !entry.form.startsWith("10-K")) continue;
    if (kind === "flow") {
      const days = durationDays(entry);
      if (days === null || days < 300 || days > 380) continue;
    }
    const key = entry.end;
    const existing = byEnd.get(key);
    if (!existing || new Date(entry.filed) >= new Date(existing.filed)) {
      byEnd.set(key, entry);
    }
  }
  return byEnd;
}

function pickTag(usGaap, tagList, kind) {
  for (const tag of tagList) {
    const node = usGaap[tag];
    const units = node?.units?.USD;
    if (units && units.length) return annualizeTag(units, kind);
  }
  return new Map();
}

// buildBankSeries(companyFacts, years)
//   companyFacts: the raw JSON this app already fetches from SEC via
//     fetchCompanyFacts() in js/sec.js (NOT re-fetched here).
//   years: the `years` array from this app's core buildAnnualSeries() output
//     (js/kpis.js), i.e. base.years -- reused so the sector series lines up
//     with the same fiscal years as the rest of the dossier.
// Returns { netInterestIncome, noninterestIncome, noninterestExpense }, each
// an array aligned 1:1 with `years` (null where that year has no tagged
// value for that item -- most non-banks will simply have all-null arrays
// here, which is correct: they don't file these tags at all).
export function buildBankSeries(companyFacts, years) {
  const usGaap = companyFacts?.facts?.["us-gaap"] || {};
  const byMetric = {};
  for (const [metric, def] of Object.entries(BANK_TAGS)) {
    byMetric[metric] = pickTag(usGaap, def.tags, def.kind);
  }
  const series = {};
  for (const metric of Object.keys(BANK_TAGS)) {
    series[metric] = years.map((y) => {
      const entry = [...byMetric[metric].entries()].find(([end]) => end.startsWith(y));
      return entry ? entry[1].val : null;
    });
  }
  return series;
}

function div(a, b) {
  if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
  return a / b;
}

// computeBankDerived(bankSeries, years, assetsSeries)
//   bankSeries: the output of buildBankSeries() above.
//   years: same `years` array passed into buildBankSeries().
//   assetsSeries: base.series.assets from this app's core dossier data
//     (js/kpis.js buildAnnualSeries) -- passed in rather than re-fetched,
//     since it's already computed from us-gaap:Assets by the core pipeline.
// Returns { netInterestIncome, efficiencyRatio, netInterestIncomeToAssets },
// each an array aligned with `years`.
export function computeBankDerived(bankSeries, years, assetsSeries) {
  const efficiencyRatio = years.map((_, i) => {
    const expense = bankSeries.noninterestExpense[i];
    if (expense === null || expense === undefined) return null;
    const nii = bankSeries.netInterestIncome[i] ?? 0;
    const nonii = bankSeries.noninterestIncome[i] ?? 0;
    const revenueBase = nii + nonii;
    if (revenueBase <= 0) return null;
    return expense / revenueBase;
  });

  const netInterestIncomeToAssets = years.map((_, i) => div(bankSeries.netInterestIncome[i], assetsSeries?.[i]));

  return {
    netInterestIncome: bankSeries.netInterestIncome,
    efficiencyRatio,
    netInterestIncomeToAssets,
  };
}

// Card metadata for js/ui.js's renderKpiGrid to append to its existing
// KPI_LIST loop (see INTEGRATION step 4). `lowerIsBetter` is informational
// for whoever wires up the trend-chip coloring (trendVerdict in
// js/redflags.js currently assumes higher-is-better for every KPI, which is
// wrong for efficiencyRatio -- flag this if/when it's wired in).
export const BANK_KPI_CARDS = [
  { key: "netInterestIncome", label: "Net interest income", raw: false, currency: true },
  { key: "netInterestIncomeToAssets", label: "Net interest income / total assets (NIM approximation)", raw: false, currency: false },
  { key: "efficiencyRatio", label: "Efficiency ratio (noninterest expense / revenue; lower is better)", raw: false, currency: false, lowerIsBetter: true },
];

// ---------------------------------------------------------------------------
// Why only banks (insurers, REITs and miners were investigated and dropped)
// ---------------------------------------------------------------------------
// REITs: the natural metric is Funds From Operations (FFO). FFO is a
// NAREIT-defined non-GAAP measure, not a line item in the us-gaap XBRL
// taxonomy itself. In practice REITs report it using their OWN
// company-specific custom extension tags (e.g. "abc:FundsFromOperations...",
// with the "abc:" prefix meaning it's that filer's own private tag, not a
// shared standard one) rather than one common us-gaap:* element -- so there
// is no single reliable tag name to query across different REITs the way
// InterestIncomeExpenseNet works across banks. Building this properly would
// mean either (a) maintaining a per-filer or per-family list of known custom
// tag names, which drifts and breaks silently as filers rename their
// extensions, or (b) attempting to parse it out of financial-statement
// presentation data instead of facts, which is a much larger undertaking.
// Neither is proportionate to an optional, low-priority feature.
//
// Insurers: the standard "combined ratio" (losses + expenses, as a share of
// premiums earned) needs consistently-tagged premiums-earned and
// losses-incurred figures, but insurers split into meaningfully different
// businesses (life, property & casualty, health, reinsurance) with different
// statement shapes and tag usage, and combined ratio itself isn't a single
// standardized tag -- it's computed from multiple tags whose exact
// combination and naming varies more across insurers than the bank tags
// used here vary across banks. Plausibly tractable with more research, but
// not to the same confidence level as banks without a deeper per-subsector
// investigation, which isn't proportionate here either.
//
// Miners: no single "misleading standard metric" problem as clean as banks'
// gross-margin issue, and no one dominant, consistently-tagged replacement
// metric identified (candidates like all-in sustaining cost per ounce are
// operational disclosures, not XBRL facts at all -- they live in prose/MD&A
// tables, not tagged data). Not investigated further than this.
