// The full KPI card library for the dossier's KPI grid — a superset of the
// original 8-entry KPI_LIST, organized into the PRD's category buckets.
//
// Shape (superset of the old KPI_LIST): { key, label, category, kind, raw, termKey? }
//   - key:      property name on base.series (raw: true) or the derived
//               object from computeDerived() (raw: false)
//   - label:    display heading for the KPI card
//   - category: one of the PRD's 8 groupings (see CATEGORIES below)
//   - kind:     "currency" | "percent" | "ratio" — passed straight through
//               to renderLineChart's opts.kind / headline formatting
//   - raw:      true if `key` lives on base.series, false if on derived
//   - termKey:  optional glossary.js key to hyperlink the label to a
//               plain-English definition; omitted where no glossary entry
//               exists yet rather than pointing at a mismatched one
//
// Every entry here is computed entirely from the RAW_TAGS already fetched
// in js/kpis.js — no new SEC XBRL tags, no fabricated figures, no live
// price data. Where the PRD's ~40-KPI, 8-category ambition runs into what
// free SEC filing data can actually support, we leave the category thin
// rather than inventing a number. See the "Valuation context" category
// below for the clearest example of that tradeoff.

export const CATEGORIES = [
  "Growth & scale",
  "Profitability",
  "Returns",
  "Cash",
  "Balance sheet & debt",
  "Efficiency & quality of earnings",
  "Owner returns & capital allocation",
  "Valuation context",
];

export const KPI_DEFINITIONS = [
  // ---- Growth & scale ----------------------------------------------------
  { key: "revenue", label: "Revenue", category: "Growth & scale", kind: "currency", raw: true, termKey: "revenue" },
  { key: "netIncome", label: "Net income", category: "Growth & scale", kind: "currency", raw: true, termKey: "net income" },
  { key: "revenueGrowth", label: "Revenue growth (YoY)", category: "Growth & scale", kind: "percent", raw: false },
  { key: "netIncomeGrowth", label: "Net income growth (YoY)", category: "Growth & scale", kind: "percent", raw: false },

  // ---- Profitability ------------------------------------------------------
  { key: "grossMargin", label: "Gross margin", category: "Profitability", kind: "percent", raw: false },
  { key: "operatingMargin", label: "Operating margin", category: "Profitability", kind: "percent", raw: false, termKey: "operating margin" },
  { key: "netMargin", label: "Net margin", category: "Profitability", kind: "percent", raw: false, termKey: "net margin" },

  // ---- Returns --------------------------------------------------------
  { key: "roe", label: "Return on equity (ROE)", category: "Returns", kind: "percent", raw: false, termKey: "roe" },
  { key: "roa", label: "Return on assets (ROA)", category: "Returns", kind: "percent", raw: false, termKey: "roa" },
  { key: "roic", label: "Return on invested capital (ROIC)", category: "Returns", kind: "percent", raw: false },
  { key: "roce", label: "Return on capital employed (ROCE)", category: "Returns", kind: "percent", raw: false },

  // ---- Cash -----------------------------------------------------------
  { key: "operatingCashFlow", label: "Operating cash flow", category: "Cash", kind: "currency", raw: true },
  { key: "freeCashFlow", label: "Free cash flow", category: "Cash", kind: "currency", raw: false, termKey: "free cash flow" },
  { key: "fcfMargin", label: "Free cash flow margin", category: "Cash", kind: "percent", raw: false },
  { key: "fcfPerShare", label: "Free cash flow per share", category: "Cash", kind: "currency", raw: false },
  { key: "cashConversion", label: "Cash conversion (OCF ÷ net income)", category: "Cash", kind: "ratio", raw: false, termKey: "cash conversion" },

  // ---- Balance sheet & debt --------------------------------------------
  { key: "debtToEquity", label: "Debt-to-equity", category: "Balance sheet & debt", kind: "ratio", raw: false, termKey: "debt-to-equity" },
  { key: "currentRatio", label: "Current ratio", category: "Balance sheet & debt", kind: "ratio", raw: false },
  { key: "netDebt", label: "Net debt", category: "Balance sheet & debt", kind: "currency", raw: false },
  { key: "debtToAssets", label: "Debt-to-assets", category: "Balance sheet & debt", kind: "percent", raw: false },

  // ---- Efficiency & quality of earnings ---------------------------------
  { key: "assetTurnover", label: "Asset turnover", category: "Efficiency & quality of earnings", kind: "ratio", raw: false },
  { key: "capexToRevenue", label: "Capital intensity (capex ÷ revenue)", category: "Efficiency & quality of earnings", kind: "percent", raw: false, termKey: "capital expenditures" },
  { key: "effectiveTaxRate", label: "Effective tax rate", category: "Efficiency & quality of earnings", kind: "percent", raw: false },

  // ---- Owner returns & capital allocation --------------------------------
  { key: "dividendPayoutRatio", label: "Dividend payout ratio (of net income)", category: "Owner returns & capital allocation", kind: "percent", raw: false },
  { key: "fcfPayoutRatio", label: "Dividend payout ratio (of free cash flow)", category: "Owner returns & capital allocation", kind: "percent", raw: false },
  { key: "bookValuePerShare", label: "Book value per share", category: "Owner returns & capital allocation", kind: "currency", raw: false, termKey: "book value" },
  { key: "equityGrowth", label: "Book value growth (YoY)", category: "Owner returns & capital allocation", kind: "percent", raw: false, termKey: "stockholders' equity" },
  { key: "shareCountGrowth", label: "Share count growth (dilution vs. buybacks)", category: "Owner returns & capital allocation", kind: "percent", raw: false, termKey: "dilution" },

  // ---- Valuation context --------------------------------------------------
  // Deliberately thin: without a live price feed of our own (the site has
  // no server beyond a CORS proxy for SEC data), the only price we ever see
  // is what a reader types into the separate Valuation tab, which already
  // covers P/E, P/B, intrinsic value range and margin of safety from that
  // typed price. The two entries below are the price-independent inputs
  // to those calculations — EPS and its growth — trended on their own.
  // We do NOT fabricate a P/E, dividend yield, EV/EBITDA or market-cap
  // trend here, since none of those exist without a price series we don't
  // have and won't pretend to have.
  { key: "dilutedEps", label: "Diluted EPS", category: "Valuation context", kind: "currency", raw: true, termKey: "eps" },
  { key: "epsGrowth", label: "Diluted EPS growth (YoY)", category: "Valuation context", kind: "percent", raw: false, termKey: "eps" },
];
