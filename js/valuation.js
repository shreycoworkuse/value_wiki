// No live price feed is used anywhere — that would mean a paid licensed
// market-data API. Instead the user can optionally type in a price they see
// anywhere, and everything here recomputes instantly, client-side, from that
// plus the free filed fundamentals. All formulas are shown in a
// "How we got this" drawer, never presented as user-facing math by default.

import { lastValid, cagr } from "./kpis.js";

// --- Method 4: 3-scenario discounted cash flow -----------------------------
// Growth assumptions are *derived from the company's own filed history*
// (historical revenue CAGR), never hand-picked per company, and are then
// clamped to conservative ceilings so a recent growth spurt can't produce an
// absurd projection. Like the multiple-based range above, this always
// produces a bear/base/bull band, never a single "fair value" number.
const DCF_DISCOUNT_RATE = 0.10; // fixed, conservative — not fitted per company
const DCF_TERMINAL_MULTIPLE = 12; // conservative terminal multiple on year-10 FCF
const DCF_YEARS = 10;

export function computeDcf(base, ownerEarningsPerShare, shares) {
  const historicalRevenueCagr = cagr(base.series.revenue, base.years);

  // If we can't derive a growth assumption from filed history, we refuse to
  // invent one — the whole point is these numbers come from the filings.
  if (historicalRevenueCagr === null || ownerEarningsPerShare === null || !shares) {
    return { available: false, historicalRevenueCagr };
  }

  const bearGrowth = Math.min(0, historicalRevenueCagr / 2);
  const baseGrowth = Math.min(0.08, historicalRevenueCagr);
  const bullGrowth = Math.min(0.15, historicalRevenueCagr * 1.5);

  function presentValuePerShare(growth) {
    let fcf = ownerEarningsPerShare;
    let pv = 0;
    for (let year = 1; year <= DCF_YEARS; year++) {
      fcf = fcf * (1 + growth);
      pv += fcf / Math.pow(1 + DCF_DISCOUNT_RATE, year);
    }
    const terminalValue = fcf * DCF_TERMINAL_MULTIPLE;
    pv += terminalValue / Math.pow(1 + DCF_DISCOUNT_RATE, DCF_YEARS);
    return pv;
  }

  return {
    available: true,
    historicalRevenueCagr,
    discountRate: DCF_DISCOUNT_RATE,
    terminalMultiple: DCF_TERMINAL_MULTIPLE,
    projectionYears: DCF_YEARS,
    bearGrowth,
    baseGrowth,
    bullGrowth,
    perShareLow: presentValuePerShare(bearGrowth),
    perShareMid: presentValuePerShare(baseGrowth),
    perShareHigh: presentValuePerShare(bullGrowth),
  };
}

// --- Method 5: book-value compounding projection ----------------------------
// This is explicitly NOT a discounted-to-today intrinsic value — it's a
// forward projection of book value/share if the business keeps compounding
// at roughly its own historical rate. Growth rate = historical average ROE ×
// retention ratio (1 − dividend payout ratio), the standard "sustainable
// growth rate" identity. Clamped to a sane band so a single distorted-ROE
// year can't produce a runaway multi-hundred-x projection.
const BVPS_GROWTH_CLAMP = 0.30;

export function computeBookValueCompounding(derived, bookValuePerShare) {
  if (bookValuePerShare === null) return { available: false };

  // Same "last 5 reported years" window as owner-earnings/FCF above, so the
  // assumption stays anchored to recent, not decades-old, performance.
  const roeVals = derived.roe.filter((v) => v !== null).slice(-5);
  if (!roeVals.length) return { available: false };
  const avgRoe = roeVals.reduce((a, b) => a + b, 0) / roeVals.length;

  // Full retention (payout = 0) is the honest default when no dividend data
  // is filed at all — we never assume a payout that isn't in the filings.
  const payoutRatio = lastValid(derived.dividendPayoutRatio)?.value ?? null;
  const assumedFullRetention = payoutRatio === null;
  const retentionRatio = assumedFullRetention ? 1 : Math.max(0, Math.min(1, 1 - payoutRatio));

  const rawGrowthRate = avgRoe * retentionRatio;
  const growthRate = Math.max(-BVPS_GROWTH_CLAMP, Math.min(BVPS_GROWTH_CLAMP, rawGrowthRate));

  return {
    available: true,
    avgRoe,
    retentionRatio,
    assumedFullRetention,
    growthRate,
    clamped: growthRate !== rawGrowthRate,
    projected5yr: bookValuePerShare * Math.pow(1 + growthRate, 5),
    projected10yr: bookValuePerShare * Math.pow(1 + growthRate, 10),
  };
}

// --- Sum-of-parts / NAV: investigated, deliberately NOT implemented --------
// SEC XBRL segment reporting (us-gaap:SegmentReportingDisclosureTextBlock and
// the dimensional Revenues/Assets facts broken out by each company's own,
// entity-custom StatementBusinessSegmentsAxis members) is not a flat,
// standardized concept the way Revenues or NetIncomeLoss is. Each filer
// invents its own segment member names and axis usage, segment counts change
// year to year as businesses reorganize, and a meaningful fraction of filers
// don't tag segment assets/capital at all (only segment revenue/operating
// income, no segment balance sheet). Reading that reliably would require
// per-company custom mapping — which is exactly the kind of hand-curated,
// per-ticker special-casing this project avoids everywhere else. Building it
// anyway would mean silently falling back to fabricated/guessed segment
// splits for a large share of tickers, which is worse than not offering it.
// So sum-of-parts/NAV is ruled out rather than shipped in a misleading form.

export function computeValuation(base, derived, price) {
  const equity = lastValid(base.series.equity)?.value ?? null;
  const shares = lastValid(base.series.dilutedShares)?.value ?? null;
  const bookValuePerShare = equity !== null && shares ? equity / shares : null;

  const fcfVals = derived.freeCashFlow.filter((v) => v !== null).slice(-5);
  const avgFcf = fcfVals.length ? fcfVals.reduce((a, b) => a + b, 0) / fcfVals.length : null;
  const ownerEarningsPerShare = avgFcf !== null && shares ? avgFcf / shares : null;

  // A deliberately wide, conservative multiple band (10x-20x owner earnings)
  // rather than a single point estimate — the PRD explicitly forbids
  // presenting a single price target as advice.
  const intrinsicLow = ownerEarningsPerShare !== null ? ownerEarningsPerShare * 10 : null;
  const intrinsicHigh = ownerEarningsPerShare !== null ? ownerEarningsPerShare * 20 : null;
  const intrinsicMid = intrinsicLow !== null && intrinsicHigh !== null ? (intrinsicLow + intrinsicHigh) / 2 : null;

  const eps = lastValid(base.series.dilutedEps)?.value ?? null;

  let pe = null, pb = null, marketCap = null, marginOfSafety = null;
  if (price && price > 0) {
    if (eps && eps > 0) pe = price / eps;
    if (bookValuePerShare && bookValuePerShare > 0) pb = price / bookValuePerShare;
    if (shares) marketCap = price * shares;
    if (intrinsicMid) marginOfSafety = (intrinsicMid - price) / intrinsicMid;
  }

  const dcf = computeDcf(base, ownerEarningsPerShare, shares);
  const bookValueCompounding = computeBookValueCompounding(derived, bookValuePerShare);

  return {
    bookValuePerShare,
    ownerEarningsPerShare,
    intrinsicLow,
    intrinsicMid,
    intrinsicHigh,
    pe,
    pb,
    marketCap,
    marginOfSafety,
    avgFcf,
    dcf,
    bookValueCompounding,
  };
}
