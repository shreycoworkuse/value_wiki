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

  // Added for the money-flow ("Stories") tab: balance-sheet reservoirs,
  // income-statement allocation buckets, and cash-flow-statement buckets.
  // Every one of these is a standard us-gaap tag that shows up across most
  // large filers — not a bespoke per-company breakdown.
  inventory: { taxonomy: "us-gaap", tags: ["InventoryNet"], kind: "instant" },
  accountsReceivable: { taxonomy: "us-gaap", tags: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], kind: "instant" },
  accountsPayable: { taxonomy: "us-gaap", tags: ["AccountsPayableCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent"], kind: "instant" },
  ppe: { taxonomy: "us-gaap", tags: ["PropertyPlantAndEquipmentNet"], kind: "instant" },
  goodwill: { taxonomy: "us-gaap", tags: ["Goodwill"], kind: "instant" },
  retainedEarnings: { taxonomy: "us-gaap", tags: ["RetainedEarningsAccumulatedDeficit"], kind: "instant" },
  additionalPaidInCapital: { taxonomy: "us-gaap", tags: ["AdditionalPaidInCapital", "AdditionalPaidInCapitalCommonStock"], kind: "instant" },
  treasuryStockValue: { taxonomy: "us-gaap", tags: ["TreasuryStockValue", "TreasuryStockCommonValue"], kind: "instant" },
  debtCurrent: { taxonomy: "us-gaap", tags: ["LongTermDebtCurrent", "DebtCurrent"], kind: "instant" },
  sharesOutstanding: { taxonomy: "us-gaap", tags: ["CommonStockSharesOutstanding"], kind: "instant" },

  costOfRevenue: { taxonomy: "us-gaap", tags: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsAndServicesSoldExcludingDepreciationDepletionAndAmortization"], kind: "flow" },
  sgaExpense: { taxonomy: "us-gaap", tags: ["SellingGeneralAndAdministrativeExpense"], kind: "flow" },
  rdExpense: { taxonomy: "us-gaap", tags: ["ResearchAndDevelopmentExpense"], kind: "flow" },
  interestExpense: { taxonomy: "us-gaap", tags: ["InterestExpense", "InterestExpenseDebt"], kind: "flow" },

  investingCashFlow: { taxonomy: "us-gaap", tags: ["NetCashProvidedByUsedInInvestingActivities"], kind: "flow" },
  financingCashFlow: { taxonomy: "us-gaap", tags: ["NetCashProvidedByUsedInFinancingActivities"], kind: "flow" },
  changeInCash: { taxonomy: "us-gaap", tags: ["CashAndCashEquivalentsPeriodIncreaseDecrease", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect"], kind: "flow" },
  debtIssuance: { taxonomy: "us-gaap", tags: ["ProceedsFromIssuanceOfLongTermDebt"], kind: "flow" },
  debtRepayment: { taxonomy: "us-gaap", tags: ["RepaymentsOfLongTermDebt"], kind: "flow" },
  stockIssuance: { taxonomy: "us-gaap", tags: ["ProceedsFromIssuanceOfCommonStock"], kind: "flow" },
  stockRepurchase: { taxonomy: "us-gaap", tags: ["PaymentsForRepurchaseOfCommonStock"], kind: "flow" },
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

// ---------------------------------------------------------------------------
// Quarterly extraction, for the money-flow ("Stories") tab's time slider.
//
// SEC's company-facts payload already contains every filed fact (10-Q and
// 10-K alike) in the same JSON buildAnnualSeries() reads — this needs no new
// network request, just a different way of slicing the same data.
//
// For "instant" (balance-sheet) items, a quarter's value is just whatever
// was reported as of that quarter's end date — 10-Qs report Q1-Q3 directly,
// 10-Ks report Q4 (fiscal year end) directly. No derivation needed.
//
// For "flow" (income-statement / cash-flow) items, a 10-Q filing reports
// BOTH the standalone quarter ("three months ended") and the year-to-date
// cumulative figure ("six/nine months ended") as separate fact entries with
// different start/end dates — filtering to ~80-100 day durations isolates
// the standalone quarter and excludes the cumulative one. Q4 is never
// reported standalone (only the full fiscal year is, in the 10-K), so it's
// derived as FY − (Q1 + Q2 + Q3) — a standard, well-understood technique,
// not a guess. If any of Q1-Q3 is missing for a fiscal year, Q4 is left as
// a gap for that year rather than derived from an incomplete sum.
function quarterDurationDays(entry) {
  const d = durationDays(entry);
  return d === null ? null : d;
}

function isQuarterFlow(entry) {
  const d = quarterDurationDays(entry);
  return d !== null && d >= 80 && d <= 100;
}

function isAnnualFlow(entry) {
  const d = quarterDurationDays(entry);
  return d !== null && d >= 300 && d <= 380;
}

function latestByEnd(entries, predicate) {
  const byEnd = new Map();
  for (const entry of entries || []) {
    if (!predicate(entry)) continue;
    const existing = byEnd.get(entry.end);
    if (!existing || new Date(entry.filed) >= new Date(existing.filed)) {
      byEnd.set(entry.end, entry);
    }
  }
  return byEnd;
}

function quarterLabel(endDate) {
  const d = new Date(endDate);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
}

// Extracts one metric's quarterly values (a Map of end-date -> number),
// combining directly-reported quarters with derived Q4s.
function extractQuarterly(units, kind) {
  if (kind === "instant") {
    // Any form, any filer — a balance-sheet snapshot as of that end date.
    const byEnd = new Map();
    for (const entry of units || []) {
      if (!entry.form || !(entry.form.startsWith("10-K") || entry.form.startsWith("10-Q"))) continue;
      const existing = byEnd.get(entry.end);
      if (!existing || new Date(entry.filed) >= new Date(existing.filed)) {
        byEnd.set(entry.end, entry);
      }
    }
    const result = new Map();
    for (const [end, entry] of byEnd) result.set(end, entry.val);
    return result;
  }

  // Flow: gather directly-reported quarters and fiscal-year totals.
  const directQuarters = latestByEnd(units, isQuarterFlow);
  const fiscalYears = latestByEnd(units, isAnnualFlow);

  const result = new Map();
  for (const [end, entry] of directQuarters) result.set(end, entry.val);

  // Derive Q4 for each fiscal year where all three prior quarters were found.
  for (const [fyEnd, fyEntry] of fiscalYears) {
    const fyEndDate = new Date(fyEnd);
    const priorBound = new Date(fyEndDate);
    priorBound.setUTCDate(priorBound.getUTCDate() - 370);
    const quartersInYear = [...directQuarters.values()].filter((q) => {
      const qEnd = new Date(q.end);
      return qEnd > priorBound && qEnd < fyEndDate;
    });
    if (quartersInYear.length !== 3) continue; // incomplete — don't guess Q4
    const sumFirstThree = quartersInYear.reduce((acc, q) => acc + q.val, 0);
    result.set(fyEnd, fyEntry.val - sumFirstThree);
  }

  return result;
}

// Builds { periods: [{end, label, fiscalYearEnd}], series: { revenue: [...], ... } },
// one entry per fiscal quarter, sorted chronologically. Metrics not available
// at quarterly resolution for a given period are left as null, same
// convention as buildAnnualSeries.
export function buildQuarterlySeries(companyFacts) {
  const usGaap = companyFacts?.facts?.["us-gaap"] || {};
  const byMetric = {};
  const allEnds = new Set();

  for (const [metric, def] of Object.entries(RAW_TAGS)) {
    let map = new Map();
    for (const tag of def.tags) {
      const node = usGaap[tag];
      const units = node?.units?.USD || node?.units?.["USD/shares"] || node?.units?.shares;
      if (units && units.length) {
        map = extractQuarterly(units, def.kind);
        if (map.size) break;
      }
    }
    byMetric[metric] = map;
    for (const end of map.keys()) allEnds.add(end);
  }

  const ends = [...allEnds].sort();
  const periods = ends.map((end) => ({ end, label: quarterLabel(end) }));
  const series = {};
  for (const metric of Object.keys(RAW_TAGS)) {
    series[metric] = ends.map((end) => (byMetric[metric].has(end) ? byMetric[metric].get(end) : null));
  }

  return { periods, series };
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
