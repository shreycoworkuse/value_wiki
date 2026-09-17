// Turns raw SEC XBRL "company facts" into a clean year-by-year table.
// We only trust figures reported on an annual report (10-K / 10-K/A), and for
// flow items (revenue, income, cash flow) only entries covering a full ~year,
// so quarterly and stub-period figures never sneak into an "annual" trend.

const RAW_TAGS = {
  revenue: { taxonomy: "us-gaap", tags: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"], kind: "flow" },
  netIncome: { taxonomy: "us-gaap", tags: ["NetIncomeLoss", "ProfitLoss"], kind: "flow" },
  operatingIncome: { taxonomy: "us-gaap", tags: ["OperatingIncomeLoss"], kind: "flow" },
  assets: { taxonomy: "us-gaap", tags: ["Assets"], kind: "instant" },
  liabilities: { taxonomy: "us-gaap", tags: ["Liabilities"], kind: "instant" },
  equity: { taxonomy: "us-gaap", tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], kind: "instant" },
  cash: { taxonomy: "us-gaap", tags: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], kind: "instant" },
  longTermDebt: { taxonomy: "us-gaap", tags: ["LongTermDebtNoncurrent", "LongTermDebt"], kind: "instant" },
  operatingCashFlow: { taxonomy: "us-gaap", tags: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], kind: "flow" },
  capex: { taxonomy: "us-gaap", tags: ["PaymentsToAcquirePropertyPlantAndEquipment"], kind: "flow" },
  dilutedEps: { taxonomy: "us-gaap", tags: ["EarningsPerShareDiluted"], kind: "flow" },
  dilutedShares: { taxonomy: "us-gaap", tags: ["WeightedAverageNumberOfDilutedSharesOutstanding"], kind: "flow" },
};

function durationDays(entry) {
  if (!entry.start || !entry.end) return null;
  return (new Date(entry.end) - new Date(entry.start)) / 86400000;
}

// Collapses SEC's raw (often duplicated across filings) fact array into one
// value per fiscal-year end date, preferring the most recently filed report
// for that period (later filings carry restated/audited comparative figures).
function annualize(unitArray, kind) {
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
    const units = node?.units?.USD || node?.units?.["USD/shares"] || node?.units?.shares;
    if (units && units.length) {
      return annualize(units, kind);
    }
  }
  return new Map();
}

// Builds { years: [...], series: { revenue: [{year, value}], ... } }
export function buildAnnualSeries(companyFacts) {
  const usGaap = companyFacts?.facts?.["us-gaap"] || {};
  const byMetric = {};
  const allYears = new Set();

  for (const [metric, def] of Object.entries(RAW_TAGS)) {
    const map = pickTag(usGaap, def.tags, def.kind);
    byMetric[metric] = map;
    for (const end of map.keys()) allYears.add(end.slice(0, 4));
  }

  const years = [...allYears].sort();
  const series = {};
  for (const metric of Object.keys(RAW_TAGS)) {
    series[metric] = years.map((y) => {
      const entry = [...byMetric[metric].entries()].find(([end]) => end.startsWith(y));
      return entry ? entry[1].val : null;
    });
  }

  return { years, series };
}

function div(a, b) {
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

// Derived ratios computed client-side, on the fly, from the raw filed figures.
export function computeDerived({ years, series }) {
  const n = years.length;
  const freeCashFlow = years.map((_, i) => {
    const ocf = series.operatingCashFlow[i];
    const capex = series.capex[i];
    if (ocf === null) return null;
    return ocf - (capex ?? 0);
  });
  const netMargin = years.map((_, i) => div(series.netIncome[i], series.revenue[i]));
  const operatingMargin = years.map((_, i) => div(series.operatingIncome[i], series.revenue[i]));
  const roe = years.map((_, i) => div(series.netIncome[i], series.equity[i]));
  const roa = years.map((_, i) => div(series.netIncome[i], series.assets[i]));
  const debtToEquity = years.map((_, i) => div(series.longTermDebt[i], series.equity[i]));
  const fcfMargin = years.map((_, i) => div(freeCashFlow[i], series.revenue[i]));
  const bookValuePerShare = years.map((_, i) => div(series.equity[i], series.dilutedShares[i]));
  const revenueGrowth = years.map((_, i) => (i === 0 ? null : div(series.revenue[i] - series.revenue[i - 1], series.revenue[i - 1])));

  return {
    years,
    n,
    freeCashFlow,
    netMargin,
    operatingMargin,
    roe,
    roa,
    debtToEquity,
    fcfMargin,
    bookValuePerShare,
    revenueGrowth,
  };
}

export function lastValid(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined && !Number.isNaN(arr[i])) return { value: arr[i], index: i };
  }
  return null;
}

export function cagr(arr, years) {
  const first = arr.findIndex((v) => v !== null && v > 0);
  const lastEntry = lastValid(arr);
  if (first === -1 || !lastEntry || lastEntry.index <= first) return null;
  const span = Number(years[lastEntry.index]) - Number(years[first]);
  if (span <= 0) return null;
  const ratio = lastEntry.value / arr[first];
  if (ratio <= 0) return null;
  return Math.pow(ratio, 1 / span) - 1;
}
