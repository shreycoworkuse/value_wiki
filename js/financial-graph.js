// Normalizes an already-computed { years, series } (annual) or
// { periods, series } (quarterly, from kpis.js's buildQuarterlySeries) table
// into a "financial graph": a fixed topology of nodes (flow sources, uses,
// and balance-sheet stocks) and edges (dollar amounts moving between them)
// for one period at a time. This is the data model behind the Stories tab's
// money-flow visualization — every consumer (the business-map diagram, the
// business-health screen, the market-vs-business screen, narrative
// detection) reads from this module rather than touching raw series
// directly, so they all agree on the same numbers and the same caveats.
//
// SCOPE, STATED UP FRONT: the bucket granularity here is whatever
// standardized XBRL actually breaks out for most large filers — revenue,
// cost of revenue, SG&A, R&D, interest, tax, capex, debt/equity issuance
// and repayment, dividends, buybacks. It is NOT a line-item breakdown into
// "Employees", "Marketing", "Logistics" etc. — that granularity isn't
// tagged as structured data anywhere free, for arbitrary companies. Where a
// bucket can't be filled from what a company actually filed, it's left out
// of that period's graph rather than guessed at.

// ---- Adapters: turn either shape into one uniform { periods, series } ----

// periods: [{ key, label, isAnnual }], series: same series object as input,
// values arrays parallel to periods, in chronological order.
export function annualToPeriods(base) {
  const periods = base.years.map((y) => ({ key: y, label: y, isAnnual: true }));
  return { periods, series: base.series };
}

export function quarterlyToPeriods(quarterly) {
  const periods = quarterly.periods.map((p) => ({ key: p.end, label: p.label, isAnnual: false }));
  return { periods, series: quarterly.series };
}

function at(series, metric, i) {
  const arr = series[metric];
  if (!arr) return null;
  const v = arr[i];
  return v === undefined ? null : v;
}

// ---- Node/edge construction for a single period index ----

const NODE_LABELS = {
  revenue: "Revenue",
  costOfRevenue: "Cost of revenue",
  sgaExpense: "SG&A",
  rdExpense: "R&D",
  interestExpense: "Interest",
  incomeTaxExpense: "Taxes",
  netIncome: "Net income",
  otherIncomeStatement: "Other items",
  operatingCashFlow: "Operating cash flow",
  accrualToCashAdjustments: "Non-cash & working-capital changes",
  capex: "Capex",
  otherInvesting: "Other investing",
  debtIssuance: "New debt",
  debtRepayment: "Debt repayment",
  stockIssuance: "New equity",
  stockRepurchase: "Buybacks",
  dividendsPaid: "Dividends",
  otherFinancing: "Other financing",
  cashChange: "Change in cash",
  cash: "Cash",
  inventory: "Inventory",
  accountsReceivable: "Receivables",
  ppe: "PP&E",
  goodwill: "Goodwill",
  otherAssets: "Other assets",
  debt: "Debt",
  accountsPayable: "Payables",
  otherLiabilities: "Other liabilities",
  equity: "Equity",
};

function node(id, category, value) {
  return { id, label: NODE_LABELS[id] || id, category, value };
}

function edge(from, to, amount) {
  return { from, to, amount };
}

// Builds the income-statement "allocation" layer: where each dollar of
// revenue this period was spent, ending in net income. This is an accrual
// view — see the cash-flow layer below for what actually moved as cash.
function buildIncomeStatementLayer(series, i, nodes, edges) {
  const revenue = at(series, "revenue", i);
  if (revenue === null) return;
  nodes.push(node("revenue", "source", revenue));

  const deductions = [
    ["costOfRevenue", at(series, "costOfRevenue", i)],
    ["sgaExpense", at(series, "sgaExpense", i)],
    ["rdExpense", at(series, "rdExpense", i)],
    ["interestExpense", at(series, "interestExpense", i)],
    ["incomeTaxExpense", at(series, "incomeTaxExpense", i)],
  ];
  let knownSum = 0;
  for (const [id, val] of deductions) {
    if (val === null) continue;
    nodes.push(node(id, "operating-use", val));
    edges.push(edge("revenue", id, val));
    knownSum += val;
  }

  const netIncome = at(series, "netIncome", i);
  if (netIncome !== null) {
    nodes.push(node("netIncome", "flow-result", netIncome));
    edges.push(edge("revenue", "netIncome", netIncome));
    // Plug so every revenue dollar has a visible destination — real filings
    // have items (D&A already inside COGS/SG&A variously, other income,
    // minority interest, etc.) this fixed set of tags doesn't isolate.
    const plug = revenue - knownSum - netIncome;
    if (Math.abs(plug) > Math.abs(revenue) * 0.01) {
      nodes.push(node("otherIncomeStatement", "operating-use", plug));
      edges.push(edge("revenue", "otherIncomeStatement", plug));
    }
  }
}

// Builds the cash-flow layer: the accrual-to-cash bridge from net income,
// then where actual cash went (investing, financing), ending in the
// period's change in cash. This is the layer that answers "revenue ≠ cash
// generation" — operatingCashFlow is the real, audited cash figure, not a
// derived one.
function buildCashFlowLayer(series, i, nodes, edges) {
  const netIncome = at(series, "netIncome", i);
  const ocf = at(series, "operatingCashFlow", i);
  if (ocf !== null) {
    nodes.push(node("operatingCashFlow", "flow-result", ocf));
    if (netIncome !== null) {
      edges.push(edge("netIncome", "operatingCashFlow", netIncome));
      const bridge = ocf - netIncome;
      if (Math.abs(bridge) > Math.abs(ocf || netIncome || 1) * 0.01) {
        nodes.push(node("accrualToCashAdjustments", "bridge", bridge));
        edges.push(edge("accrualToCashAdjustments", "operatingCashFlow", bridge));
      }
    }
  }

  const capex = at(series, "capex", i);
  if (capex !== null && ocf !== null) {
    nodes.push(node("capex", "investing-use", capex));
    edges.push(edge("operatingCashFlow", "capex", capex));
  }
  const investingCF = at(series, "investingCashFlow", i);
  // capex is a spend (positive = cash out); investingCF is signed (outflow
  // negative), so -investingCF is the total investing outflow to compare it to.
  let otherInvesting = null;
  if (investingCF !== null && capex !== null) {
    otherInvesting = -investingCF - capex;
    if (Math.abs(otherInvesting) > Math.abs(investingCF || capex || 1) * 0.03) {
      nodes.push(node("otherInvesting", "investing-use", otherInvesting));
      edges.push(edge("operatingCashFlow", "otherInvesting", otherInvesting));
    } else {
      otherInvesting = 0;
    }
  }

  const debtIssuance = at(series, "debtIssuance", i);
  if (debtIssuance !== null && debtIssuance !== 0) {
    nodes.push(node("debtIssuance", "financing-source", debtIssuance));
  }
  const stockIssuance = at(series, "stockIssuance", i);
  if (stockIssuance !== null && stockIssuance !== 0) {
    nodes.push(node("stockIssuance", "financing-source", stockIssuance));
  }
  const debtRepayment = at(series, "debtRepayment", i);
  if (debtRepayment !== null && debtRepayment !== 0) {
    nodes.push(node("debtRepayment", "financing-use", debtRepayment));
    edges.push(edge("operatingCashFlow", "debtRepayment", debtRepayment));
  }
  const stockRepurchase = at(series, "stockRepurchase", i);
  if (stockRepurchase !== null && stockRepurchase !== 0) {
    nodes.push(node("stockRepurchase", "financing-use", stockRepurchase));
    edges.push(edge("operatingCashFlow", "stockRepurchase", stockRepurchase));
  }
  const dividendsPaid = at(series, "dividendsPaid", i);
  if (dividendsPaid !== null && dividendsPaid !== 0) {
    nodes.push(node("dividendsPaid", "financing-use", Math.abs(dividendsPaid)));
    edges.push(edge("operatingCashFlow", "dividendsPaid", Math.abs(dividendsPaid)));
  }

  // changeInCash: use the directly-filed tag when present, else compute it
  // from whatever cash-flow-statement pieces we do have (never both — a
  // computed fallback only fills a genuine gap, it doesn't override a filed
  // figure). The cashChange node is created whenever ANY financing source
  // exists, since those edges target it below.
  let changeInCash = at(series, "changeInCash", i);
  if (changeInCash === null) {
    const financingCF = at(series, "financingCashFlow", i);
    if (ocf !== null && investingCF !== null && financingCF !== null) {
      changeInCash = ocf + investingCF + financingCF;
    }
  }
  const needsCashChangeNode = changeInCash !== null || debtIssuance || stockIssuance;
  if (needsCashChangeNode) {
    nodes.push(node("cashChange", "stock-delta", changeInCash ?? 0));
    if (debtIssuance) edges.push(edge("debtIssuance", "cashChange", debtIssuance));
    if (stockIssuance) edges.push(edge("stockIssuance", "cashChange", stockIssuance));
  }
}

// Builds the balance-sheet "reservoirs" layer: what's accumulated as of
// this period's end, on both sides (assets a company holds, and who has a
// claim on them — liabilities and equity).
function buildStockLayer(series, i, nodes, edges) {
  const assetItems = [
    ["cash", at(series, "cash", i)],
    ["accountsReceivable", at(series, "accountsReceivable", i)],
    ["inventory", at(series, "inventory", i)],
    ["ppe", at(series, "ppe", i)],
    ["goodwill", at(series, "goodwill", i)],
  ];
  const totalAssets = at(series, "assets", i);
  let knownAssetSum = 0;
  for (const [id, val] of assetItems) {
    if (val === null) continue;
    nodes.push(node(id, "asset-stock", val));
    knownAssetSum += val;
  }
  if (totalAssets !== null) {
    const otherAssets = totalAssets - knownAssetSum;
    if (otherAssets > Math.abs(totalAssets) * 0.005) {
      nodes.push(node("otherAssets", "asset-stock", otherAssets));
    }
  }

  const longTermDebt = at(series, "longTermDebt", i);
  const debtCurrent = at(series, "debtCurrent", i);
  const totalDebt = (longTermDebt ?? 0) + (debtCurrent ?? 0);
  if (longTermDebt !== null || debtCurrent !== null) {
    nodes.push(node("debt", "liability-stock", totalDebt));
  }
  const accountsPayable = at(series, "accountsPayable", i);
  if (accountsPayable !== null) {
    nodes.push(node("accountsPayable", "liability-stock", accountsPayable));
  }
  const totalLiabilities = at(series, "liabilities", i);
  if (totalLiabilities !== null) {
    const knownLiabSum = totalDebt + (accountsPayable ?? 0);
    const otherLiabilities = totalLiabilities - knownLiabSum;
    if (otherLiabilities > Math.abs(totalLiabilities) * 0.005) {
      nodes.push(node("otherLiabilities", "liability-stock", otherLiabilities));
    }
  }

  const equity = at(series, "equity", i);
  if (equity !== null) {
    nodes.push(node("equity", "equity-stock", equity));
  }
}

// Reconciles this period's cash-flow statement: opening cash + OCF + ICF +
// financing CF should equal closing cash. Flags a mismatch rather than
// hiding it — a real discrepancy usually just means one of the underlying
// tags wasn't filed this period (e.g. a company that doesn't break out
// financingCashFlow the standard way), not that the numbers are wrong.
function reconcile(series, i) {
  const cashNow = at(series, "cash", i);
  const cashPrev = i > 0 ? at(series, "cash", i - 1) : null;
  const ocf = at(series, "operatingCashFlow", i);
  const icf = at(series, "investingCashFlow", i);
  const fcf = at(series, "financingCashFlow", i);
  if (cashNow === null || cashPrev === null || ocf === null || icf === null || fcf === null) {
    return { checked: false };
  }
  const predicted = cashPrev + ocf + icf + fcf;
  const actualChange = cashNow - cashPrev;
  const predictedChange = ocf + icf + fcf;
  const diff = actualChange - predictedChange;
  const tolerance = Math.max(Math.abs(cashNow) * 0.02, 1e6);
  return {
    checked: true,
    predicted,
    actual: cashNow,
    diff,
    ok: Math.abs(diff) <= tolerance,
  };
}

// Builds the full graph for one period index of a unified { periods, series }
// dataset (see the adapters above).
export function buildFinancialGraph(unified, i) {
  const { periods, series } = unified;
  const nodes = [];
  const edges = [];
  buildIncomeStatementLayer(series, i, nodes, edges);
  buildCashFlowLayer(series, i, nodes, edges);
  buildStockLayer(series, i, nodes, edges);
  return {
    period: periods[i],
    nodes,
    edges,
    reconciliation: reconcile(series, i),
  };
}

// Builds one graph per period, in chronological order — what the time
// slider pages through.
export function buildGraphSeries(unified) {
  return unified.periods.map((_, i) => buildFinancialGraph(unified, i));
}

// ---- Drill-down: click-to-trace a single bucket across time ----

// Returns { id, label, values: [{period, value}], growth, ratioToRevenue }
// for one node id, across every period in the dataset — the data behind
// "click a bucket, see its history."
export function getNodeHistory(unified, nodeId) {
  const { periods, series } = unified;
  const arr = series[nodeId];
  if (!arr) return null;
  const values = periods.map((p, i) => ({ period: p, value: arr[i] ?? null }));
  const revenueArr = series.revenue || [];
  const ratioToRevenue = periods.map((p, i) => {
    const v = arr[i];
    const rev = revenueArr[i];
    if (v === null || v === undefined || rev === null || rev === undefined || rev === 0) return null;
    return v / rev;
  });
  const growth = periods.map((p, i) => {
    if (i === 0) return null;
    const prev = arr[i - 1];
    const cur = arr[i];
    if (prev === null || prev === undefined || cur === null || cur === undefined || prev === 0) return null;
    return (cur - prev) / Math.abs(prev);
  });
  return { id: nodeId, label: NODE_LABELS[nodeId] || nodeId, values, ratioToRevenue, growth };
}
