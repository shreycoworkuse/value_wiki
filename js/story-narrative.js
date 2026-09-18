// Rule-based "narrative events" feed shared across the Money flow tab's
// screens. Same house style as js/redflags.js: plain numeric thresholds over
// real reported/derived figures, turned into plain-English sentences that
// quote the actual numbers — no AI, no hidden model, nothing invented.

import { formatPercent } from "./charts.js";

function div(a, b) {
  if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
  return a / b;
}

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

function pp(v) {
  if (v === null || v === undefined) return "—";
  const p = v * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}pp`;
}

function grossMarginAt(series, i) {
  const gp = at(series, "grossProfit", i);
  const rev = at(series, "revenue", i);
  if (gp !== null) return div(gp, rev);
  const cor = at(series, "costOfRevenue", i);
  if (cor !== null && rev !== null && rev !== 0) return 1 - cor / rev;
  return null;
}

// Computes the facts for one period-over-period transition (index i vs i-1).
// Kept separate from event construction so it's easy to see every input is a
// real, guarded, computed number — nothing is invented.
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

  return {
    revenue, revGrowth,
    marginCurr, marginPrev, marginChange,
    invGrowth, recvGrowth,
    totalDebt, totalDebtPrev, debtGrowth,
    fcf, fcfPrev,
  };
}

const INVENTORY_MULTIPLE = 1.5;
const INVENTORY_FLOOR = 0.15;
const RECEIVABLES_MULTIPLE = 1.5;
const RECEIVABLES_FLOOR = 0.15;
const DEBT_SPIKE_THRESHOLD = 0.20;
const MARGIN_MOVE_THRESHOLD = 0.03; // 3 percentage points

export function detectNarrativeEvents(unified) {
  const { periods, series } = unified;
  const events = [];

  for (let i = 1; i < periods.length; i++) {
    const period = periods[i];
    const f = factsFor(series, i);

    const marginCompression = f.marginChange !== null && f.marginChange <= -MARGIN_MOVE_THRESHOLD;
    const marginExpansion = f.marginChange !== null && f.marginChange >= MARGIN_MOVE_THRESHOLD;
    const debtSpike = f.debtGrowth !== null && f.debtGrowth > DEBT_SPIKE_THRESHOLD;
    const fcfTurnedNegative = f.fcf !== null && f.fcfPrev !== null && f.fcfPrev >= 0 && f.fcf < 0;
    const fcfTurnedPositive = f.fcf !== null && f.fcfPrev !== null && f.fcfPrev < 0 && f.fcf >= 0;
    const revGrowthTxt = f.revGrowth !== null ? formatPercent(f.revGrowth) : "an unreported amount";

    const invBuildup = f.invGrowth !== null && f.revGrowth !== null &&
      f.invGrowth > INVENTORY_MULTIPLE * f.revGrowth && f.invGrowth > INVENTORY_FLOOR;
    if (invBuildup) {
      events.push({
        period,
        headline: "Inventory is building up faster than sales",
        detail: `Inventory grew ${formatPercent(f.invGrowth)} while revenue grew ${revGrowthTxt} — cash is increasingly tied up before it's sold.`,
        severity: marginCompression ? "flag" : "watch",
      });
    }

    const recvBuildup = f.recvGrowth !== null && f.revGrowth !== null &&
      f.recvGrowth > RECEIVABLES_MULTIPLE * f.revGrowth && f.recvGrowth > RECEIVABLES_FLOOR;
    if (recvBuildup) {
      events.push({
        period,
        headline: "Receivables are outpacing revenue",
        detail: `Accounts receivable grew ${formatPercent(f.recvGrowth)} while revenue grew ${revGrowthTxt} — customers are taking longer to pay, or revenue is being booked ahead of cash collection.`,
        severity: marginCompression ? "flag" : "watch",
      });
    }

    if (debtSpike) {
      events.push({
        period,
        headline: "Total debt jumped",
        detail: `Total debt (long-term + current) rose ${formatPercent(f.debtGrowth)} versus the prior period${marginCompression ? ", at the same time gross margin compressed" : ""}.`,
        severity: marginCompression ? "flag" : "watch",
      });
    }

    if (fcfTurnedNegative) {
      events.push({
        period,
        headline: "Free cash flow turned negative",
        detail: "Free cash flow (operating cash flow minus capex) flipped from positive to negative versus the prior period.",
        severity: "flag",
      });
    }
    if (fcfTurnedPositive) {
      events.push({
        period,
        headline: "Free cash flow turned positive",
        detail: "Free cash flow (operating cash flow minus capex) flipped from negative to positive versus the prior period.",
        severity: "info",
      });
    }

    if (marginCompression) {
      events.push({
        period,
        headline: "Gross margin compressed",
        detail: `Gross margin moved from ${formatPercent(f.marginPrev)} to ${formatPercent(f.marginCurr)} (${pp(f.marginChange)}).`,
        severity: debtSpike ? "flag" : "watch",
      });
    } else if (marginExpansion) {
      events.push({
        period,
        headline: "Gross margin expanded",
        detail: `Gross margin moved from ${formatPercent(f.marginPrev)} to ${formatPercent(f.marginCurr)} (${pp(f.marginChange)}).`,
        severity: "info",
      });
    }
  }

  return events;
}

const SEVERITY_RANK = { flag: 0, watch: 1, info: 2 };
const MAX_EVENTS = 15;

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

export function renderNarrative(container, events, ctx) {
  container.innerHTML = "";
  const { unified } = ctx;

  const wrap = el(`
    <div class="narrative-feed">
      <h3 class="narrative-feed-title">Narrative events</h3>
      <div class="narrative-list"></div>
    </div>
  `);
  container.append(wrap);
  const listEl = wrap.querySelector(".narrative-list");

  if (!events || !events.length) {
    listEl.append(el(`<p class="data-gap-note">No rule-based narrative events detected in this company's filed history.</p>`));
    return;
  }

  const sorted = [...events].sort((a, b) => {
    const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return unified.periods.indexOf(b.period) - unified.periods.indexOf(a.period);
  });

  for (const event of sorted.slice(0, MAX_EVENTS)) {
    const item = el(`
      <button type="button" class="narrative-item severity-${event.severity}">
        <span class="narrative-item-period">${event.period.label}</span>
        <span class="narrative-item-headline">${event.headline}</span>
        <span class="narrative-item-detail">${event.detail}</span>
      </button>
    `);
    item.addEventListener("click", () => {
      ctx.onJumpToPeriod(unified.periods.indexOf(event.period));
    });
    listEl.append(item);
  }
}
