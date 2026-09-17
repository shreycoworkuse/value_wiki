// "Timeline" tab: a rule-based, auto-generated narrative built only from
// filed SEC figures (base.series / derived — see js/kpis.js). No price data,
// no macro overlay — see the note rendered at the top of the tab and the
// project README/PR notes for why (no free, keyless, CORS-friendly
// historical price or macro API exists that a static site can call
// directly; data.sec.gov itself needed a Cloudflare Worker proxy to get
// past a CORS wall — see js/sec.js — and a price/macro source would face
// the same or a worse problem, plus macro data needs a keyed API like FRED).
//
// Every caption below is a plain threshold comparison on real reported
// numbers — no AI, no hidden model — in the same house style as
// js/redflags.js.

import { formatMoneyShort, formatPercent } from "./charts.js";

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function pct(v) {
  if (v === null || v === undefined) return null;
  return v * 100;
}

function fmtSignedPct(v) {
  if (v === null || v === undefined) return "—";
  const p = pct(v);
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

// Max/min of arr over indices [1, uptoIndex] inclusive, ignoring nulls.
function extremeSoFar(arr, uptoIndex, mode) {
  let best = null;
  for (let i = 1; i <= uptoIndex; i++) {
    const v = arr[i];
    if (v === null || v === undefined) continue;
    if (best === null) best = v;
    else if (mode === "max" && v > best) best = v;
    else if (mode === "min" && v < best) best = v;
  }
  return best;
}

// Returns up to `max` { text, tone } captions for fiscal-year index `i`
// (i >= 1), evaluated in priority order — most newsworthy first.
function buildCaptions(i, base, derived, max = 2) {
  const out = [];
  const push = (text, tone) => out.push({ text, tone });

  const ni = base.series.netIncome[i];
  const prevNi = base.series.netIncome[i - 1];
  const revGrowth = derived.revenueGrowth[i];
  const prevRevGrowth = i >= 2 ? derived.revenueGrowth[i - 1] : null;
  const netMargin = derived.netMargin[i];
  const prevNetMargin = derived.netMargin[i - 1];
  const prevPrevNetMargin = i >= 2 ? derived.netMargin[i - 2] : null;
  const fcf = derived.freeCashFlow[i];
  const ltd = base.series.longTermDebt[i];
  const prevLtd = base.series.longTermDebt[i - 1];
  const shares = base.series.dilutedShares[i];
  const prevShares = base.series.dilutedShares[i - 1];
  const roe = derived.roe[i];
  const prevRoe = derived.roe[i - 1];
  const de = derived.debtToEquity[i];
  const prevDe = derived.debtToEquity[i - 1];
  const prevPrevDe = i >= 2 ? derived.debtToEquity[i - 2] : null;
  const dividends = base.series.dividendsPaid[i];
  const prevDividends = base.series.dividendsPaid[i - 1];

  // 1. First loss-making year on record (checked against every prior year,
  // not just the one before).
  if (ni !== null && ni < 0) {
    const hadEarlierLoss = base.series.netIncome.slice(0, i).some((v) => v !== null && v < 0);
    if (!hadEarlierLoss) push("First loss-making year on record.", "flag");
  }

  // 2. Returned to profitability after a loss.
  if (out.length < max && ni !== null && ni > 0 && prevNi !== null && prevNi < 0) {
    push("Returned to profitability after a loss the prior year.", "good");
  }

  // 3. Profit but negative free cash flow.
  if (out.length < max && ni !== null && ni > 0 && fcf !== null && fcf < 0) {
    push("Free cash flow turned negative despite reported profit.", "watch");
  }

  // 4. Revenue growth — fastest pace so far in this period.
  if (out.length < max && revGrowth !== null && revGrowth > 0.15) {
    const maxSoFar = extremeSoFar(derived.revenueGrowth, i, "max");
    if (maxSoFar !== null && revGrowth >= maxSoFar) {
      push(`Revenue grew ${formatPercent(revGrowth)} — the fastest pace in this period.`, "good");
    } else if (revGrowth > 0.2) {
      push(`Revenue grew ${formatPercent(revGrowth)}.`, "good");
    }
  }

  // 5. Revenue decline — sharpest pull-back so far, else just notable.
  if (out.length < max && revGrowth !== null && revGrowth < -0.05) {
    const minSoFar = extremeSoFar(derived.revenueGrowth, i, "min");
    if (minSoFar !== null && revGrowth <= minSoFar) {
      push(`Revenue fell ${formatPercent(Math.abs(revGrowth))} — the sharpest pull-back in this period.`, "flag");
    } else {
      push(`Revenue fell ${formatPercent(Math.abs(revGrowth))}.`, "flag");
    }
  }

  // 6. Revenue declined for a second straight year.
  if (out.length < max && revGrowth !== null && revGrowth < 0 && prevRevGrowth !== null && prevRevGrowth < 0) {
    push("Revenue declined for a second straight year.", "flag");
  }

  // 7. Net margin fell for a second straight year.
  if (out.length < max && netMargin !== null && prevNetMargin !== null && prevPrevNetMargin !== null &&
      netMargin < prevNetMargin && prevNetMargin < prevPrevNetMargin) {
    push("Net margin fell for a second straight year.", "watch");
  }

  // 8. Net margin improved meaningfully (3+ percentage points).
  if (out.length < max && netMargin !== null && prevNetMargin !== null && netMargin - prevNetMargin > 0.03) {
    push(`Net margin improved to ${formatPercent(netMargin)}, from ${formatPercent(prevNetMargin)} the year before.`, "good");
  }

  // 9. Long-term debt roughly doubled (or more).
  if (out.length < max && ltd !== null && prevLtd !== null && prevLtd > 0 && ltd / prevLtd >= 1.8) {
    push(`Long-term debt roughly doubled, to ${formatMoneyShort(ltd)}.`, "flag");
  }

  // 10. Long-term debt cut by more than half.
  if (out.length < max && ltd !== null && prevLtd !== null && prevLtd > 0 && ltd / prevLtd <= 0.55) {
    push(`Long-term debt fell by more than half, to ${formatMoneyShort(ltd)}.`, "good");
  }

  // 11. Diluted share count fell notably (buybacks shrinking the share count).
  if (out.length < max && shares !== null && prevShares !== null && prevShares > 0) {
    const shareChange = shares / prevShares - 1;
    if (shareChange <= -0.03) {
      push(`Diluted shares outstanding fell ${formatPercent(Math.abs(shareChange))} — likely buybacks.`, "good");
    } else if (shareChange >= 0.1) {
      push(`Diluted shares outstanding grew ${formatPercent(shareChange)}, diluting existing owners.`, "watch");
    }
  }

  // 12. Debt-to-equity climbing for three straight years.
  if (out.length < max && de !== null && prevDe !== null && prevPrevDe !== null && de > prevDe && prevDe > prevPrevDe) {
    push("Debt-to-equity has climbed for three straight years.", "watch");
  }

  // 13. Began / stopped paying dividends.
  if (out.length < max && dividends && (prevDividends === null || prevDividends === 0)) {
    push("Began paying a dividend.", "good");
  } else if (out.length < max && prevDividends && (dividends === null || dividends === 0)) {
    push("Dividend payments stopped.", "watch");
  }

  // 14. Return on equity topped 25% for the first time in this period.
  if (out.length < max && roe !== null && roe > 0.25 && (prevRoe === null || prevRoe <= 0.25)) {
    push(`Return on equity topped 25% (${formatPercent(roe)}) for the first time in this period.`, "good");
  }

  return out.slice(0, max);
}

function headlineLine(i, base, derived) {
  const revenue = base.series.revenue[i];
  const growth = derived.revenueGrowth[i];
  if (revenue === null) return "Revenue: not reported this year.";
  const growthTxt = growth !== null ? ` (${fmtSignedPct(growth)} vs. the prior year)` : "";
  return `Revenue: ${formatMoneyShort(revenue)}${growthTxt}`;
}

export function renderTimeline(container, { company, base, derived }) {
  container.innerHTML = "";
  const years = base.years;

  const wrap = el(`
    <div>
      <p class="data-gap-note">
        An auto-generated, rule-based timeline built only from ${company?.name ?? "this company"}'s own SEC filing
        history — plain threshold comparisons on reported figures, in chronological order. There is no historical
        stock-price chart or macro-data overlay here: no free, keyless, CORS-friendly historical price API exists
        that a static site like this one can call directly (we already had to route SEC's own XBRL data through a
        small Cloudflare Worker proxy to get past a CORS wall — see the Sources tab — and a price feed would hit
        the same or a worse wall), and macro data such as interest rates or GDP requires a keyed API (e.g. FRED)
        that would break the "no accounts, no keys" design of this tool.
      </p>
      <div class="timeline" id="timeline-track"></div>
    </div>
  `);
  container.append(wrap);

  const track = wrap.querySelector("#timeline-track");

  if (years.length < 2) {
    track.append(el(`<p class="data-gap-note">Not enough annual filing history to build a year-over-year timeline yet.</p>`));
    return;
  }

  for (let i = 1; i < years.length; i++) {
    const captions = buildCaptions(i, base, derived, 2);
    const isNeutral = captions.length === 0;
    const captionsHtml = isNeutral
      ? `<div class="timeline-caption tone-neutral">A quiet year for this company's headline numbers — no threshold-based note triggered.</div>`
      : captions.map((c) => `<div class="timeline-caption tone-${c.tone}">${c.text}</div>`).join("");

    track.append(el(`
      <div class="timeline-item">
        <div class="timeline-dot${isNeutral ? " neutral" : ""}"></div>
        <div class="timeline-year">FY${years[i]}</div>
        <div class="timeline-headline">${headlineLine(i, base, derived)}</div>
        <div class="timeline-captions">${captionsHtml}</div>
      </div>
    `));
  }
}
