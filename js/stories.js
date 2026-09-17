// "Stories" tab — combined-KPI overlay charts. Each card puts two related
// series on one timeline (via renderOverlayChart) and writes a short note
// underneath. Exactly like redflags.js and verdict.js, there is no AI/LLM
// anywhere here: every sentence is produced by plain JS comparison logic
// (CAGR, first-vs-last ratios, spreads, correlation) run on the company's
// own filed/derived numbers. A pairing is only rendered when there's enough
// overlapping annual history to say something real about it — see the
// `overlapCount` guards below, one per story.

import { renderOverlayChart, formatMoneyShort, formatPercent, formatRatio } from "./charts.js";
import { cagr, lastValid } from "./kpis.js";

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

// --- small helpers shared across the story builders below ---

function firstValid(arr) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== null && arr[i] !== undefined && !Number.isNaN(arr[i])) return { value: arr[i], index: i };
  }
  return null;
}

function overlapCount(a, b) {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== null && a[i] !== undefined && b[i] !== null && b[i] !== undefined) n++;
  }
  return n;
}

function spreadOf(a, b) {
  return a.map((v, i) => (v !== null && v !== undefined && b[i] !== null && b[i] !== undefined ? v - b[i] : null));
}

function scaleArr(arr, factor) {
  return arr.map((v) => (v === null || v === undefined ? null : v / factor));
}

// Pearson correlation over the overlapping non-null pairs of two arrays.
// Returns null when there isn't enough overlap to say anything meaningful.
function correlation(a, b) {
  const pairs = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== null && a[i] !== undefined && b[i] !== null && b[i] !== undefined) pairs.push([a[i], b[i]]);
  }
  if (pairs.length < 4) return null;
  const n = pairs.length;
  const meanA = pairs.reduce((s, p) => s + p[0], 0) / n;
  const meanB = pairs.reduce((s, p) => s + p[1], 0) / n;
  let cov = 0, varA = 0, varB = 0;
  for (const [a1, b1] of pairs) {
    cov += (a1 - meanA) * (b1 - meanB);
    varA += (a1 - meanA) ** 2;
    varB += (b1 - meanB) ** 2;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

function buildStory(title, seriesA, seriesB, kindA, kindB, colorVarA, colorVarB, narrative) {
  return { title, seriesA, seriesB, kindA, kindB, colorVarA, colorVarB, narrative };
}

// --- the 12 story builders. Each takes (base, derived) and returns either a
// story object or null when the filed data doesn't support the pairing. ---

function storyRevenueVsNetIncome(base, derived) {
  const years = base.years;
  const revenue = base.series.revenue;
  const ni = base.series.netIncome;
  if (overlapCount(revenue, ni) < 3) return null;

  const revCagr = cagr(revenue, years);
  const niCagr = cagr(ni, years);
  let narrative;
  if (revCagr !== null && niCagr !== null) {
    const diff = niCagr - revCagr;
    if (diff > 0.02) {
      narrative = `Net income grew faster than revenue over the covered period (${formatPercent(niCagr)}/yr vs. ${formatPercent(revCagr)}/yr) — profit is outrunning sales, which points to expanding margins rather than growth alone.`;
    } else if (diff < -0.02) {
      narrative = `Revenue outgrew net income over the covered period (${formatPercent(revCagr)}/yr vs. ${formatPercent(niCagr)}/yr) — sales are growing faster than the bottom line, which points to margin compression somewhere in the income statement.`;
    } else {
      narrative = `Revenue and net income have grown at roughly the same clip over the covered period (${formatPercent(revCagr)}/yr vs. ${formatPercent(niCagr)}/yr), so overall profitability has stayed roughly stable.`;
    }
  } else {
    narrative = "Not enough consecutive years of revenue and net income to compute comparable growth rates.";
  }
  const marginLast = lastValid(derived.netMargin);
  if (marginLast) narrative += ` Most recently (FY${years[marginLast.index]}), net income was ${formatPercent(marginLast.value)} of revenue.`;

  return buildStory(
    "Revenue vs. net income",
    { label: "Revenue", values: revenue },
    { label: "Net income", values: ni },
    "currency", "currency", "--accent", "--flag",
    narrative
  );
}

function storyGrowthVsMargin(base, derived) {
  const years = base.years;
  const growth = derived.revenueGrowth;
  const margin = derived.netMargin;
  if (overlapCount(growth, margin) < 4) return null;

  const corr = correlation(growth, margin);
  let narrative;
  if (corr !== null) {
    if (corr > 0.5) {
      narrative = `Revenue growth and net margin have moved together (correlation ${corr.toFixed(2)}) — years of faster sales growth have tended to come with fatter margins, consistent with operating leverage kicking in as the business scales.`;
    } else if (corr < -0.5) {
      narrative = `Revenue growth and net margin have moved in opposite directions (correlation ${corr.toFixed(2)}) — faster sales growth has tended to coincide with thinner margins, suggesting growth here has come at a profitability cost.`;
    } else {
      narrative = `Revenue growth and net margin show little consistent relationship (correlation ${corr.toFixed(2)}) — margin swings look driven by something other than the sales growth rate alone.`;
    }
  } else {
    narrative = "Not enough overlapping years of growth and margin data to test whether they move together.";
  }
  const lastG = lastValid(growth);
  const lastM = lastValid(margin);
  if (lastG && lastM) narrative += ` Most recently (FY${years[lastM.index]}): revenue growth was ${formatPercent(lastG.value)} and net margin was ${formatPercent(lastM.value)}.`;

  return buildStory(
    "Revenue growth vs. net margin",
    { label: "Revenue growth", values: growth },
    { label: "Net margin", values: margin },
    "percent", "percent", "--accent", "--watch",
    narrative
  );
}

function storyLeverage(base, derived) {
  const years = base.years;
  const debt = base.series.longTermDebt;
  const equity = base.series.equity;
  if (overlapCount(debt, equity) < 3) return null;

  const debtCagr = cagr(debt, years);
  const equityCagr = cagr(equity, years);
  const firstDE = firstValid(derived.debtToEquity);
  const lastDE = lastValid(derived.debtToEquity);
  let narrative;
  if (firstDE && lastDE && lastDE.index > firstDE.index) {
    const delta = lastDE.value - firstDE.value;
    if (delta > 0.1) {
      narrative = `Debt-to-equity climbed from ${formatRatio(firstDE.value)} in FY${years[firstDE.index]} to ${formatRatio(lastDE.value)} in FY${years[lastDE.index]} — long-term debt has grown faster than the equity base beneath it.`;
    } else if (delta < -0.1) {
      narrative = `Debt-to-equity fell from ${formatRatio(firstDE.value)} in FY${years[firstDE.index]} to ${formatRatio(lastDE.value)} in FY${years[lastDE.index]} — the balance sheet has delevered as equity built up faster than debt.`;
    } else {
      narrative = `Debt-to-equity has stayed close to ${formatRatio(lastDE.value)} across the covered period — leverage hasn't meaningfully shifted either way.`;
    }
  } else {
    narrative = "Not enough long-term-debt history on file to track how leverage has trended.";
  }
  if (debtCagr !== null && equityCagr !== null) {
    narrative += ` Long-term debt grew ${formatPercent(debtCagr)}/yr versus ${formatPercent(equityCagr)}/yr for stockholders' equity.`;
  }

  return buildStory(
    "Long-term debt vs. stockholders' equity",
    { label: "Long-term debt", values: debt },
    { label: "Stockholders' equity", values: equity },
    "currency", "currency", "--flag", "--accent",
    narrative
  );
}

function storyCashConversion(base) {
  const years = base.years;
  const ocf = base.series.operatingCashFlow;
  const ni = base.series.netIncome;
  if (overlapCount(ocf, ni) < 3) return null;

  const recent = [];
  for (let i = years.length - 1; i >= 0 && recent.length < 5; i--) {
    if (ocf[i] !== null && ni[i] !== null) recent.unshift([ocf[i], ni[i]]);
  }
  const sumOcf = recent.reduce((s, p) => s + p[0], 0);
  const sumNi = recent.reduce((s, p) => s + p[1], 0);
  let narrative;
  if (recent.length && sumNi > 0) {
    const ratio = sumOcf / sumNi;
    if (ratio > 1.1) {
      narrative = `Over the last ${recent.length} reported years, operating cash flow totaled ${formatRatio(ratio)} reported net income — cash generation has outpaced accounting profit, often a sign of conservative earnings.`;
    } else if (ratio > 0.8) {
      narrative = `Over the last ${recent.length} reported years, operating cash flow tracked net income closely (${formatRatio(ratio)} conversion) — reported profit is converting into real cash at a healthy rate.`;
    } else {
      narrative = `Over the last ${recent.length} reported years, operating cash flow covered only ${formatRatio(ratio)} of net income — profit isn't fully showing up as cash, which is worth checking against working-capital or accrual items in the filings.`;
    }
  } else {
    narrative = "Reported profit over the recent period is roughly break-even or negative, so a cash-conversion ratio isn't meaningful here.";
  }
  const lastOcf = lastValid(ocf);
  const lastNi = lastValid(ni);
  if (lastOcf && lastNi) narrative += ` Most recently: operating cash flow was ${formatMoneyShort(lastOcf.value)} vs. net income of ${formatMoneyShort(lastNi.value)}.`;

  return buildStory(
    "Operating cash flow vs. net income",
    { label: "Operating cash flow", values: ocf },
    { label: "Net income", values: ni },
    "currency", "currency", "--accent", "--watch",
    narrative
  );
}

function storyMarginStructure(base, derived) {
  const years = base.years;
  const gm = derived.grossMargin;
  const om = derived.operatingMargin;
  if (overlapCount(gm, om) < 3) return null;

  const spread = spreadOf(gm, om);
  const firstS = firstValid(spread);
  const lastS = lastValid(spread);
  let narrative;
  if (firstS && lastS && lastS.index > firstS.index) {
    const delta = lastS.value - firstS.value;
    if (delta > 0.02) {
      narrative = `The gap between gross margin and operating margin widened from ${formatPercent(firstS.value)} in FY${years[firstS.index]} to ${formatPercent(lastS.value)} in FY${years[lastS.index]} — operating expenses (SG&A, R&D and the like) are eating a growing share of gross profit.`;
    } else if (delta < -0.02) {
      narrative = `The gap between gross margin and operating margin narrowed from ${formatPercent(firstS.value)} in FY${years[firstS.index]} to ${formatPercent(lastS.value)} in FY${years[lastS.index]} — operating expenses have grown slower than gross profit, improving cost discipline below the gross-margin line.`;
    } else {
      narrative = `The gap between gross margin and operating margin has held near ${formatPercent(lastS.value)} across the covered period — operating expenses have scaled roughly in line with gross profit.`;
    }
  } else {
    narrative = "Not enough overlapping gross-margin and operating-margin history to judge the cost structure trend.";
  }
  const lastGm = lastValid(gm);
  const lastOm = lastValid(om);
  if (lastGm && lastOm) narrative += ` Most recently: gross margin ${formatPercent(lastGm.value)}, operating margin ${formatPercent(lastOm.value)}.`;

  return buildStory(
    "Gross margin vs. operating margin",
    { label: "Gross margin", values: gm },
    { label: "Operating margin", values: om },
    "percent", "percent", "--accent", "--watch",
    narrative
  );
}

function storyRoeVsRoa(base, derived) {
  const years = base.years;
  const roe = derived.roe;
  const roa = derived.roa;
  if (overlapCount(roe, roa) < 3) return null;

  const gap = spreadOf(roe, roa);
  const firstG = firstValid(gap);
  const lastG = lastValid(gap);
  let narrative;
  if (firstG && lastG && lastG.index > firstG.index) {
    const delta = lastG.value - firstG.value;
    if (delta > 0.03) {
      narrative = `The gap between ROE and ROA widened from ${formatPercent(firstG.value)} in FY${years[firstG.index]} to ${formatPercent(lastG.value)} in FY${years[lastG.index]} — a growing share of the return to shareholders is being generated with leverage rather than with the asset base itself.`;
    } else if (delta < -0.03) {
      narrative = `The gap between ROE and ROA narrowed from ${formatPercent(firstG.value)} in FY${years[firstG.index]} to ${formatPercent(lastG.value)} in FY${years[lastG.index]} — returns to shareholders are relying less on leverage and more on the underlying assets earning their keep.`;
    } else {
      narrative = `ROE has stayed roughly ${formatPercent(lastG.value)} above ROA throughout the covered period — the leverage effect on returns hasn't changed much.`;
    }
  } else {
    narrative = "Not enough overlapping ROE and ROA history to judge how leverage's effect on returns has trended.";
  }
  const lastRoe = lastValid(roe);
  const lastRoa = lastValid(roa);
  if (lastRoe && lastRoa) narrative += ` Most recently: ROE ${formatPercent(lastRoe.value)} vs. ROA ${formatPercent(lastRoa.value)}.`;

  return buildStory(
    "Return on equity vs. return on assets",
    { label: "ROE", values: roe },
    { label: "ROA", values: roa },
    "percent", "percent", "--accent", "--watch",
    narrative
  );
}

function storyAssetsVsLiabilities(base) {
  const years = base.years;
  const assets = base.series.assets;
  const liab = base.series.liabilities;
  if (overlapCount(assets, liab) < 3) return null;

  const assetsCagr = cagr(assets, years);
  const liabCagr = cagr(liab, years);
  const cushion = years.map((_, i) => (assets[i] !== null && liab[i] !== null && assets[i] !== 0 ? (assets[i] - liab[i]) / assets[i] : null));
  const firstC = firstValid(cushion);
  const lastC = lastValid(cushion);
  let narrative;
  if (assetsCagr !== null && liabCagr !== null) {
    if (liabCagr > assetsCagr + 0.02) {
      narrative = `Total liabilities grew faster than total assets over the covered period (${formatPercent(liabCagr)}/yr vs. ${formatPercent(assetsCagr)}/yr) — the balance sheet's equity cushion has been shrinking as a share of the whole.`;
    } else if (assetsCagr > liabCagr + 0.02) {
      narrative = `Total assets grew faster than total liabilities over the covered period (${formatPercent(assetsCagr)}/yr vs. ${formatPercent(liabCagr)}/yr) — the equity cushion has been building as a share of the balance sheet.`;
    } else {
      narrative = `Total assets and total liabilities have grown at similar rates over the covered period (${formatPercent(assetsCagr)}/yr vs. ${formatPercent(liabCagr)}/yr) — the balance sheet's overall shape hasn't shifted much.`;
    }
  } else {
    narrative = "Not enough consecutive years of assets and liabilities to compute comparable growth rates.";
  }
  if (firstC && lastC && lastC.index > firstC.index) {
    narrative += ` Equity as a share of assets moved from ${formatPercent(firstC.value)} in FY${years[firstC.index]} to ${formatPercent(lastC.value)} in FY${years[lastC.index]}.`;
  }

  return buildStory(
    "Total assets vs. total liabilities",
    { label: "Total assets", values: assets },
    { label: "Total liabilities", values: liab },
    "currency", "currency", "--accent", "--flag",
    narrative
  );
}

function storyDilution(base) {
  const years = base.years;
  const shares = base.series.dilutedShares;
  const eps = base.series.dilutedEps;
  if (overlapCount(shares, eps) < 3) return null;

  const firstSh = firstValid(shares);
  const lastSh = lastValid(shares);
  const firstE = firstValid(eps);
  const lastE = lastValid(eps);
  const sharesChange = firstSh && lastSh && lastSh.index > firstSh.index && firstSh.value !== 0 ? lastSh.value / firstSh.value - 1 : null;
  const epsChange = firstE && lastE && lastE.index > firstE.index && firstE.value !== 0 ? lastE.value / firstE.value - 1 : null;

  let narrative;
  if (sharesChange !== null) {
    if (sharesChange > 0.1) {
      narrative = `Diluted shares outstanding grew ${formatPercent(sharesChange)} over the covered period`;
      if (epsChange !== null) {
        narrative += epsChange > sharesChange
          ? `, yet diluted EPS still grew ${formatPercent(epsChange)} — earnings growth outran the dilution.`
          : `, while diluted EPS ${epsChange >= 0 ? "grew only" : "fell"} ${formatPercent(Math.abs(epsChange))} — owners' per-share slice of profit shrank as the share count expanded.`;
      } else {
        narrative += ".";
      }
    } else if (sharesChange < -0.05) {
      narrative = `Diluted shares outstanding fell ${formatPercent(Math.abs(sharesChange))} over the covered period (buybacks outpacing issuance)`;
      narrative += epsChange !== null
        ? `, which by itself boosts diluted EPS (${epsChange >= 0 ? "up" : "down"} ${formatPercent(Math.abs(epsChange))} over the same span) independent of any change in total profit.`
        : ".";
    } else {
      narrative = "Diluted shares outstanding have stayed roughly flat over the covered period";
      narrative += epsChange !== null
        ? `, so the ${formatPercent(epsChange)} move in diluted EPS mostly reflects changes in net income itself, not share-count effects.`
        : ".";
    }
  } else {
    narrative = "Not enough diluted-share history on file to judge dilution's effect on EPS.";
  }

  return buildStory(
    "Diluted shares outstanding vs. diluted EPS",
    { label: "Diluted shares (millions)", values: scaleArr(shares, 1e6) },
    { label: "Diluted EPS", values: eps },
    "percent", "currency", "--watch", "--accent",
    narrative
  );
}

function storyReinvestment(base) {
  const years = base.years;
  const capex = base.series.capex;
  const ocf = base.series.operatingCashFlow;
  if (overlapCount(capex, ocf) < 3) return null;

  const intensity = years.map((_, i) => (capex[i] !== null && ocf[i] !== null && ocf[i] > 0 ? capex[i] / ocf[i] : null));
  const firstI = firstValid(intensity);
  const lastI = lastValid(intensity);
  let narrative;
  if (lastI) {
    const level = lastI.value > 0.5 ? "capital-intensive — it plows back over half of operating cash flow into capex"
      : lastI.value > 0.15 ? "moderately capital-intensive"
      : "capital-light — most of operating cash flow is left over after capex";
    narrative = `Most recently (FY${years[lastI.index]}), capital expenditures absorbed ${formatPercent(lastI.value)} of operating cash flow — the business currently looks ${level}.`;
    if (firstI && lastI.index > firstI.index) {
      const delta = lastI.value - firstI.value;
      if (delta > 0.05) narrative += ` That's up from ${formatPercent(firstI.value)} in FY${years[firstI.index]} — reinvestment needs have grown.`;
      else if (delta < -0.05) narrative += ` That's down from ${formatPercent(firstI.value)} in FY${years[firstI.index]} — the business is keeping more of its operating cash after funding capex than it used to.`;
      else narrative += ` That's little changed from ${formatPercent(firstI.value)} in FY${years[firstI.index]}.`;
    }
  } else {
    narrative = "Not enough consistent capex and operating-cash-flow data to gauge reinvestment intensity.";
  }

  return buildStory(
    "Capital expenditures vs. operating cash flow",
    { label: "Capital expenditures", values: capex },
    { label: "Operating cash flow", values: ocf },
    "currency", "currency", "--flag", "--accent",
    narrative
  );
}

function storyLiquidity(base, derived) {
  const years = base.years;
  const ca = base.series.assetsCurrent;
  const cl = base.series.liabilitiesCurrent;
  if (overlapCount(ca, cl) < 3) return null;

  const cr = derived.currentRatio;
  const firstCR = firstValid(cr);
  const lastCR = lastValid(cr);
  let narrative;
  if (lastCR) {
    const level = lastCR.value >= 1.5 ? "a comfortable cushion of current assets over current liabilities"
      : lastCR.value >= 1 ? "current assets just covering current liabilities, without much cushion"
      : "current liabilities exceeding current assets — a working-capital gap worth checking closely";
    narrative = `As of FY${years[lastCR.index]}, the current ratio was ${formatRatio(lastCR.value)} — ${level}.`;
    if (firstCR && lastCR.index > firstCR.index) {
      const delta = lastCR.value - firstCR.value;
      if (delta > 0.15) narrative += ` Liquidity has improved from ${formatRatio(firstCR.value)} in FY${years[firstCR.index]}.`;
      else if (delta < -0.15) narrative += ` Liquidity has weakened from ${formatRatio(firstCR.value)} in FY${years[firstCR.index]}.`;
      else narrative += ` That's little changed from ${formatRatio(firstCR.value)} in FY${years[firstCR.index]}.`;
    }
  } else {
    narrative = "Not enough current-asset and current-liability history to judge short-term liquidity.";
  }

  return buildStory(
    "Current assets vs. current liabilities",
    { label: "Current assets", values: ca },
    { label: "Current liabilities", values: cl },
    "currency", "currency", "--accent", "--flag",
    narrative
  );
}

function storyFcfVsNi(base, derived) {
  const years = base.years;
  const fcf = derived.freeCashFlow;
  const ni = base.series.netIncome;
  if (overlapCount(fcf, ni) < 3) return null;

  const fcfCagr = cagr(fcf, years);
  const niCagr = cagr(ni, years);
  const lastFcf = lastValid(fcf);
  const lastNi = lastValid(ni);
  let narrative;
  if (fcfCagr !== null && niCagr !== null) {
    const diff = fcfCagr - niCagr;
    if (diff > 0.03) {
      narrative = `Free cash flow grew faster than net income over the covered period (${formatPercent(fcfCagr)}/yr vs. ${formatPercent(niCagr)}/yr) — after capex, cash profit is compounding faster than accounting profit.`;
    } else if (diff < -0.03) {
      narrative = `Net income grew faster than free cash flow over the covered period (${formatPercent(niCagr)}/yr vs. ${formatPercent(fcfCagr)}/yr) — reported profit is outrunning the cash actually left over after capex, worth watching for a widening profit-to-cash gap.`;
    } else {
      narrative = `Free cash flow and net income have grown at a similar pace over the covered period (${formatPercent(fcfCagr)}/yr vs. ${formatPercent(niCagr)}/yr).`;
    }
  } else {
    narrative = "Not enough consecutive years of free cash flow and net income to compute comparable growth rates.";
  }
  if (lastFcf && lastNi && lastNi.value > 0) {
    const ratio = lastFcf.value / lastNi.value;
    narrative += ` In the most recent reported year, free cash flow equaled ${formatRatio(ratio)} net income (${formatMoneyShort(lastFcf.value)} vs. ${formatMoneyShort(lastNi.value)}).`;
  }

  return buildStory(
    "Free cash flow vs. net income",
    { label: "Free cash flow", values: fcf },
    { label: "Net income", values: ni },
    "currency", "currency", "--good", "--accent",
    narrative
  );
}

function storyNetDebtVsFcf(base, derived) {
  const years = base.years;
  const netDebt = derived.netDebt;
  const fcf = derived.freeCashFlow;
  if (overlapCount(netDebt, fcf) < 3) return null;

  const lastND = lastValid(netDebt);
  const lastFcf = lastValid(fcf);
  const firstND = firstValid(netDebt);
  let narrative;
  if (lastND && lastND.value <= 0) {
    narrative = `Net debt was negative as of FY${years[lastND.index]} (more cash than long-term debt) — the company holds a net cash position and isn't relying on free cash flow to delever.`;
  } else if (lastND && lastFcf && lastFcf.value > 0) {
    const yearsToPayoff = lastND.value / lastFcf.value;
    narrative = `At the FY${years[lastFcf.index]} free-cash-flow run-rate (${formatMoneyShort(lastFcf.value)}/yr), it would take roughly ${yearsToPayoff.toFixed(1)} years to pay off net debt of ${formatMoneyShort(lastND.value)}, if every dollar of free cash flow went to debt paydown.`;
  } else if (lastND) {
    narrative = `Net debt stands at ${formatMoneyShort(lastND.value)} as of FY${years[lastND.index]}, but free cash flow is currently zero or negative — there's no cash cushion right now to pay it down from.`;
  } else {
    narrative = "Not enough net-debt and free-cash-flow history to judge deleveraging capacity.";
  }
  if (firstND && lastND && lastND.index > firstND.index) {
    const delta = lastND.value - firstND.value;
    if (delta < 0) narrative += ` Net debt has fallen from ${formatMoneyShort(firstND.value)} in FY${years[firstND.index]}.`;
    else if (delta > 0) narrative += ` Net debt has risen from ${formatMoneyShort(firstND.value)} in FY${years[firstND.index]}.`;
  }

  return buildStory(
    "Net debt vs. free cash flow",
    { label: "Net debt", values: netDebt },
    { label: "Free cash flow", values: fcf },
    "currency", "currency", "--flag", "--good",
    narrative
  );
}

const STORY_BUILDERS = [
  storyRevenueVsNetIncome,
  storyGrowthVsMargin,
  storyLeverage,
  storyCashConversion,
  storyMarginStructure,
  storyRoeVsRoa,
  storyAssetsVsLiabilities,
  storyDilution,
  storyReinvestment,
  storyLiquidity,
  storyFcfVsNi,
  storyNetDebtVsFcf,
];

export function renderStories(container, { company, base, derived }) {
  container.innerHTML = "";
  const years = base.years;

  const stories = STORY_BUILDERS
    .map((build) => build(base, derived))
    .filter(Boolean);

  if (!stories.length) {
    container.append(el(`<p class="data-gap-note">Not enough overlapping annual data was filed for ${company.name} to build any combined-KPI stories.</p>`));
    return;
  }

  container.append(el(`
    <p class="data-gap-note" style="margin-bottom:16px;">
      ${stories.length} combined-KPI ${stories.length === 1 ? "story" : "stories"} below. Each chart overlays two related figures on one timeline, and the note underneath is written by plain comparison logic (compound growth rates, first-vs-last ratios, spreads and correlation) run directly on ${company.name}'s filed and derived numbers — not by an AI reading the chart.
    </p>
  `));

  const grid = el(`<div class="kpi-grid"></div>`);
  container.append(grid);

  for (const story of stories) {
    const card = el(`
      <div class="kpi-card">
        <h3>${story.title}</h3>
        <div class="kpi-headline">${story.narrative}</div>
        <div class="kpi-chart-wrap"><canvas></canvas></div>
      </div>
    `);
    grid.append(card);
    const canvas = card.querySelector("canvas");
    requestAnimationFrame(() => renderOverlayChart(canvas, years, story.seriesA, story.seriesB, {
      kindA: story.kindA,
      kindB: story.kindB,
      colorVarA: story.colorVarA,
      colorVarB: story.colorVarB,
    }));
  }
}
