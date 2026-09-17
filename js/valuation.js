// No live price feed is used anywhere — that would mean a paid licensed
// market-data API. Instead the user can optionally type in a price they see
// anywhere, and everything here recomputes instantly, client-side, from that
// plus the free filed fundamentals. All formulas are shown in a
// "How we got this" drawer, never presented as user-facing math by default.

import { lastValid } from "./kpis.js";

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
  };
}
