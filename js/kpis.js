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
  grossProfit: { taxonomy: "us-gaap", tags: ["GrossProfit"], kind: "flow" },
  assetsCurrent: { taxonomy: "us-gaap", tags: ["AssetsCurrent"], kind: "instant" },
  liabilitiesCurrent: { taxonomy: "us-gaap", tags: ["LiabilitiesCurrent"], kind: "instant" },
  dividendsPaid: { taxonomy: "us-gaap", tags: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"], kind: "flow" },
  incomeTaxExpense: { taxonomy: "us-gaap", tags: ["IncomeTaxExpenseBenefit"], kind: "flow" },
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

// Simple year-over-year growth rate for a raw series, e.g. [null, 0.12, -0.03, ...].
// First year is always null (nothing to compare it to) — never fabricated.
function growthOf(arr) {
  return arr.map((_, i) => (i === 0 ? null : div(arr[i] - arr[i - 1], arr[i - 1])));
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

  const grossMargin = years.map((_, i) => div(series.grossProfit[i], series.revenue[i]));
  const currentRatio = years.map((_, i) => div(series.assetsCurrent[i], series.liabilitiesCurrent[i]));
  const netDebt = years.map((_, i) => {
    const debt = series.longTermDebt[i];
    if (debt === null) return null;
    return debt - (series.cash[i] ?? 0);
  });
  const assetTurnover = years.map((_, i) => div(series.revenue[i], series.assets[i]));
  const dividendPayoutRatio = years.map((_, i) => {
    const dividends = series.dividendsPaid[i];
    const ni = series.netIncome[i];
    if (dividends === null || ni === null || ni <= 0) return null;
    return Math.abs(dividends) / ni;
  });
  // NOPAT and invested capital are both approximations widely used for a
  // rough ROIC when a company doesn't break out segment-level capital —
  // effective tax rate is backed out from reported tax expense vs. income,
  // clamped to a sane range so a one-off tax credit/charge doesn't produce
  // a nonsense ratio.
  const roic = years.map((_, i) => {
    const opInc = series.operatingIncome[i];
    const ni = series.netIncome[i];
    const tax = series.incomeTaxExpense[i];
    const equity_ = series.equity[i];
    const debt = series.longTermDebt[i];
    const cash_ = series.cash[i];
    if (opInc === null || ni === null || tax === null || equity_ === null) return null;
    const pretax = ni + tax;
    if (pretax === 0) return null;
    let effectiveTaxRate = tax / pretax;
    effectiveTaxRate = Math.max(0, Math.min(0.5, effectiveTaxRate));
    const nopat = opInc * (1 - effectiveTaxRate);
    const investedCapital = equity_ + (debt ?? 0) - (cash_ ?? 0);
    return div(nopat, investedCapital);
  });

  // Return on Capital Employed: operating income over (assets minus current
  // liabilities) — a pre-tax, leverage-aware cousin of ROIC that doesn't
  // require guessing a tax rate.
  const roce = years.map((_, i) => {
    const opInc = series.operatingIncome[i];
    const assets_ = series.assets[i];
    const liabCurrent = series.liabilitiesCurrent[i];
    if (opInc === null || assets_ === null || liabCurrent === null) return null;
    return div(opInc, assets_ - liabCurrent);
  });

  // Straightforward YoY growth rates for a few more series worth trending.
  const netIncomeGrowth = growthOf(series.netIncome);
  const epsGrowth = growthOf(series.dilutedEps);
  // Book value (equity) growth — how fast the owners' stake is compounding.
  const equityGrowth = growthOf(series.equity);
  // Diluted share count growth: positive = dilution (more shares issued),
  // negative = net buybacks — a cheap, honest read on capital allocation.
  const shareCountGrowth = growthOf(series.dilutedShares);

  const fcfPerShare = years.map((_, i) => div(freeCashFlow[i], series.dilutedShares[i]));

  // Cash conversion: operating cash flow vs. net income — a classic
  // "quality of earnings" check. Only meaningful when earnings are positive,
  // so a loss year is left as a gap rather than a sign-flipped ratio.
  const cashConversion = years.map((_, i) => {
    const ni = series.netIncome[i];
    const ocf = series.operatingCashFlow[i];
    if (ni === null || ni <= 0 || ocf === null) return null;
    return div(ocf, ni);
  });

  const debtToAssets = years.map((_, i) => div(series.longTermDebt[i], series.assets[i]));

  // Capital intensity: how much of every revenue dollar gets plowed back
  // into property, plant & equipment.
  const capexToRevenue = years.map((_, i) => div(series.capex[i], series.revenue[i]));

  // Effective tax rate, backed out from reported tax expense vs. pretax
  // income (net income + tax expense). Left as a gap when pretax income
  // isn't positive, since the ratio stops meaning anything sensible there.
  const effectiveTaxRate = years.map((_, i) => {
    const ni = series.netIncome[i];
    const tax = series.incomeTaxExpense[i];
    if (ni === null || tax === null) return null;
    const pretax = ni + tax;
    if (pretax <= 0) return null;
    return div(tax, pretax);
  });

  // What share of free cash flow (rather than GAAP net income) gets paid
  // out as dividends — a stricter affordability check than the payout
  // ratio above, since FCF is what's actually left to distribute.
  const fcfPayoutRatio = years.map((_, i) => {
    const dividends = series.dividendsPaid[i];
    const fcf = freeCashFlow[i];
    if (dividends === null || fcf === null || fcf <= 0) return null;
    return Math.abs(dividends) / fcf;
  });

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
    grossMargin,
    currentRatio,
    netDebt,
    assetTurnover,
    dividendPayoutRatio,
    roic,
    roce,
    netIncomeGrowth,
    epsGrowth,
    equityGrowth,
    shareCountGrowth,
    fcfPerShare,
    cashConversion,
    debtToAssets,
    capexToRevenue,
    effectiveTaxRate,
    fcfPayoutRatio,
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
