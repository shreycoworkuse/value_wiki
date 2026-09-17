// An "owner's checklist" in the Buffett / Li Lu tradition: plain questions a
// long-term owner would ask, each scored 0-2 from the filed figures. This is
// explicitly NOT a buy/sell signal or a price target — see the disclaimer
// rendered alongside it.

import { cagr, lastValid } from "./kpis.js";

function scoreRevenueGrowth(base, derived) {
  const g = cagr(base.series.revenue, base.years);
  if (g === null) return { score: 1, why: "Not enough years of revenue data to judge a trend." };
  if (g > 0.06) return { score: 2, why: `Revenue grew at roughly ${(g * 100).toFixed(1)}%/yr over the covered period.` };
  if (g > 0) return { score: 1, why: `Revenue grew slowly, around ${(g * 100).toFixed(1)}%/yr.` };
  return { score: 0, why: `Revenue shrank over the covered period (${(g * 100).toFixed(1)}%/yr).` };
}

function scoreMargins(derived) {
  const last = lastValid(derived.netMargin);
  const recent = derived.netMargin.filter((v) => v !== null).slice(-5);
  if (!last) return { score: 1, why: "Net margin could not be computed from available data." };
  const trendUp = recent.length >= 2 && recent[recent.length - 1] >= recent[0];
  if (last.value > 0.1 && trendUp) return { score: 2, why: `Net margin is healthy (${(last.value * 100).toFixed(1)}%) and holding up or improving.` };
  if (last.value > 0) return { score: 1, why: `Net margin is positive (${(last.value * 100).toFixed(1)}%) but not clearly improving.` };
  return { score: 0, why: "Net margin is negative in the most recent reported year." };
}

function scoreReturnsOnEquity(derived) {
  const last = lastValid(derived.roe);
  if (!last) return { score: 1, why: "Return on equity could not be computed." };
  if (last.value > 0.15) return { score: 2, why: `Return on equity is strong at ${(last.value * 100).toFixed(1)}%.` };
  if (last.value > 0.07) return { score: 1, why: `Return on equity is moderate at ${(last.value * 100).toFixed(1)}%.` };
  return { score: 0, why: `Return on equity is weak or negative (${(last.value * 100).toFixed(1)}%).` };
}

function scoreLeverage(derived) {
  const last = lastValid(derived.debtToEquity);
  if (!last) return { score: 1, why: "Long-term debt data was not reported, so leverage cannot be fully judged." };
  if (last.value < 0.5) return { score: 2, why: `Debt-to-equity is conservative at ${(last.value * 100).toFixed(0)}%.` };
  if (last.value < 1.5) return { score: 1, why: `Debt-to-equity is moderate at ${(last.value * 100).toFixed(0)}%.` };
  return { score: 0, why: `Debt-to-equity is high at ${(last.value * 100).toFixed(0)}%.` };
}

function scoreCashQuality(base, derived) {
  const niVals = base.series.netIncome.filter((v) => v !== null).slice(-5);
  const fcfVals = derived.freeCashFlow.filter((v) => v !== null).slice(-5);
  if (!niVals.length || !fcfVals.length) return { score: 1, why: "Not enough cash-flow history to compare against reported profit." };
  const niSum = niVals.reduce((a, b) => a + b, 0);
  const fcfSum = fcfVals.reduce((a, b) => a + b, 0);
  if (niSum <= 0) return { score: 1, why: "Reported profit over the recent period is roughly break-even or negative." };
  const ratio = fcfSum / niSum;
  if (ratio > 0.8) return { score: 2, why: `Free cash flow tracked reported profit closely (${(ratio * 100).toFixed(0)}% conversion) over the recent period.` };
  if (ratio > 0.3) return { score: 1, why: `Free cash flow covered about ${(ratio * 100).toFixed(0)}% of reported profit over the recent period.` };
  return { score: 0, why: `Free cash flow badly lagged reported profit (${(ratio * 100).toFixed(0)}% conversion) — profits aren't turning into cash.` };
}

function scoreDilution(base) {
  const shares = base.series.dilutedShares.filter((v) => v !== null);
  if (shares.length < 2) return { score: 1, why: "Not enough share-count history to judge dilution." };
  const first = shares[0], last = shares[shares.length - 1];
  const change = (last / first) - 1;
  if (change < 0) return { score: 2, why: `Diluted shares outstanding fell ${Math.abs(change * 100).toFixed(0)}% over the covered period (buybacks outpacing issuance).` };
  if (change < 0.2) return { score: 1, why: `Diluted shares outstanding grew modestly (${(change * 100).toFixed(0)}%) over the covered period.` };
  return { score: 0, why: `Diluted shares outstanding grew ${(change * 100).toFixed(0)}% over the covered period — meaningful dilution.` };
}

function scoreResilience(base) {
  const ni = base.series.netIncome.filter((v) => v !== null);
  if (ni.length < 3) return { score: 1, why: "Not enough history to judge resilience through a downturn." };
  const dips = ni.filter((v) => v < 0).length;
  const worstDropRatio = ni.reduce((worst, v, i) => {
    if (i === 0 || ni[i - 1] <= 0) return worst;
    const drop = (ni[i - 1] - v) / Math.abs(ni[i - 1]);
    return Math.max(worst, drop);
  }, 0);
  if (dips === 0 && worstDropRatio < 0.5) return { score: 2, why: "No loss-making year on record, and no severe single-year profit collapse." };
  if (dips <= 1) return { score: 1, why: `${dips} loss-making year on record over the covered period.` };
  return { score: 0, why: `${dips} loss-making years on record over the covered period.` };
}

function scoreDataQuality(base) {
  const years = base.years.length;
  if (years >= 15) return { score: 2, why: `${years} years of annual filings are available — a long, comparable record.` };
  if (years >= 7) return { score: 1, why: `${years} years of annual filings are available — a decent but not full 20-year record.` };
  return { score: 0, why: `Only ${years} years of structured filings are available (SEC's structured XBRL data generally starts around 2009).` };
}

export function buildChecklist(base, derived) {
  const items = [
    { q: "Has revenue grown over the covered period?", ...scoreRevenueGrowth(base, derived) },
    { q: "Are profit margins healthy and holding up?", ...scoreMargins(derived) },
    { q: "Is the business earning a strong return on shareholders' equity?", ...scoreReturnsOnEquity(derived) },
    { q: "Is debt kept at a conservative level?", ...scoreLeverage(derived) },
    { q: "Does reported profit show up as real cash?", ...scoreCashQuality(base, derived) },
    { q: "Are owners' shares being protected from dilution?", ...scoreDilution(base) },
    { q: "Has the business avoided severe profit collapses?", ...scoreResilience(base) },
    { q: "Is there a long, comparable filing history to judge from?", ...scoreDataQuality(base) },
  ];
  const total = items.reduce((sum, i) => sum + i.score, 0);
  const max = items.length * 2;
  let band;
  if (total / max >= 0.8) band = "Looks like a strong, durable business on these fundamentals";
  else if (total / max >= 0.55) band = "Solid business with some things to watch";
  else if (total / max >= 0.3) band = "Several fundamental concerns worth digging into";
  else band = "Many fundamental red flags in this record";
  return { items, total, max, band };
}
