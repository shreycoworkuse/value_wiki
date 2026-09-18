// One plain-English line per period, always — for the Money flow tab's
// vertical timeline. Same rule-based, no-AI house style as redflags.js:
// every line is built from a real computed delta, never invented. When no
// threshold-crossing rule fires, falls back to a plain revenue-growth
// readout rather than a generic filler sentence.
import { formatPercent } from "./charts.js";

function at(series, key, i) {
  const arr = series[key];
  if (!arr) return null;
  const v = arr[i];
  return v === undefined ? null : v;
}

function growth(curr, prev) {
  if (curr === null || prev === null || prev === 0) return null;
  return (curr - prev) / Math.abs(prev);
}

function div(a, b) {
  if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
  return a / b;
}

function grossMarginAt(series, i) {
  const gp = at(series, "grossProfit", i);
  const rev = at(series, "revenue", i);
  if (gp !== null) return div(gp, rev);
  const cor = at(series, "costOfRevenue", i);
  if (cor !== null && rev !== null && rev !== 0) return 1 - cor / rev;
  return null;
}

function factsFor(series, i) {
  const revenue = at(series, "revenue", i);
  const revenuePrev = at(series, "revenue", i - 1);
  const revGrowth = growth(revenue, revenuePrev);

  const marginCurr = grossMarginAt(series, i);
  const marginPrev = grossMarginAt(series, i - 1);
  const marginChange = marginCurr !== null && marginPrev !== null ? marginCurr - marginPrev : null;

  const inventory = at(series, "inventory", i);
  const inventoryPrev = at(series, "inventory", i - 1);
  const invGrowth = growth(inventory, inventoryPrev);

  const receivables = at(series, "accountsReceivable", i);
  const receivablesPrev = at(series, "accountsReceivable", i - 1);
  const recvGrowth = growth(receivables, receivablesPrev);

  const ltd = at(series, "longTermDebt", i);
  const debtCurrentNow = at(series, "debtCurrent", i);
  const totalDebt = ltd !== null || debtCurrentNow !== null ? (ltd ?? 0) + (debtCurrentNow ?? 0) : null;
  const ltdPrev = at(series, "longTermDebt", i - 1);
  const debtCurrentPrev = at(series, "debtCurrent", i - 1);
  const totalDebtPrev = ltdPrev !== null || debtCurrentPrev !== null ? (ltdPrev ?? 0) + (debtCurrentPrev ?? 0) : null;
  const debtGrowth = growth(totalDebt, totalDebtPrev);

  const ocf = at(series, "operatingCashFlow", i);
  const capex = at(series, "capex", i);
  const fcf = ocf !== null ? ocf - (capex ?? 0) : null;
  const ocfPrev = at(series, "operatingCashFlow", i - 1);
  const capexPrev = at(series, "capex", i - 1);
  const fcfPrev = ocfPrev !== null ? ocfPrev - (capexPrev ?? 0) : null;

  return { revGrowth, marginChange, invGrowth, recvGrowth, debtGrowth, fcf, fcfPrev };
}

export function narrativeLineFor(unified, i) {
  if (i === 0) return "First period on file — nothing to compare it against yet.";
  const f = factsFor(unified.series, i);
  const candidates = [];

  if (f.fcf !== null && f.fcfPrev !== null && f.fcfPrev >= 0 && f.fcf < 0) {
    candidates.push({ priority: 0, text: "Free cash flow turned negative this period." });
  }
  if (f.fcf !== null && f.fcfPrev !== null && f.fcfPrev < 0 && f.fcf >= 0) {
    candidates.push({ priority: 1, text: "Free cash flow turned positive this period." });
  }
  if (f.debtGrowth !== null && f.debtGrowth > 0.2) {
    candidates.push({ priority: 1, text: `Total debt jumped ${formatPercent(f.debtGrowth)} versus the prior period.` });
  }
  if (f.marginChange !== null && f.marginChange <= -0.03) {
    candidates.push({ priority: 1, text: `Gross margin compressed ${formatPercent(Math.abs(f.marginChange))}.` });
  }
  if (f.invGrowth !== null && f.revGrowth !== null && f.invGrowth > 1.5 * f.revGrowth && f.invGrowth > 0.15) {
    candidates.push({ priority: 2, text: "Inventory built up faster than sales this period." });
  }
  if (f.recvGrowth !== null && f.revGrowth !== null && f.recvGrowth > 1.5 * f.revGrowth && f.recvGrowth > 0.15) {
    candidates.push({ priority: 2, text: "Receivables grew faster than sales this period." });
  }
  if (f.marginChange !== null && f.marginChange >= 0.03) {
    candidates.push({ priority: 2, text: `Gross margin expanded ${formatPercent(f.marginChange)}.` });
  }
  if (f.revGrowth !== null && Math.abs(f.revGrowth) >= 0.1) {
    candidates.push({ priority: 3, text: `Revenue ${f.revGrowth >= 0 ? "grew" : "fell"} ${formatPercent(Math.abs(f.revGrowth))} versus the prior period.` });
  }

  candidates.sort((a, b) => a.priority - b.priority);
  if (candidates.length) return candidates[0].text;
  if (f.revGrowth !== null) {
    return `Revenue ${f.revGrowth >= 0 ? "up" : "down"} ${formatPercent(Math.abs(f.revGrowth))} — no other outsized moves this period.`;
  }
  return "No comparable figures reported for this period.";
}
