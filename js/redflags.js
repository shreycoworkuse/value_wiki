// Simple, transparent, rule-based checks — no AI, no hidden model. Every rule
// here is a plain comparison over the filed figures, spelled out in "why".

function trailing(arr, count) {
  return arr.slice(Math.max(0, arr.length - count));
}

function isMonotonic(arr, direction) {
  const vals = arr.filter((v) => v !== null && v !== undefined);
  if (vals.length < 2) return false;
  for (let i = 1; i < vals.length; i++) {
    if (direction === "down" && vals[i] >= vals[i - 1]) return false;
    if (direction === "up" && vals[i] <= vals[i - 1]) return false;
  }
  return true;
}

export function detectRedFlags(base, derived) {
  const flags = [];
  const years = base.years;

  // Profit without cash: net income positive but free cash flow negative,
  // in the two most recent reported years.
  const recentNI = trailing(base.series.netIncome, 2);
  const recentFCF = trailing(derived.freeCashFlow, 2);
  if (recentNI.length === 2 && recentFCF.length === 2 &&
      recentNI.every((v) => v !== null && v > 0) &&
      recentFCF.every((v) => v !== null && v < 0)) {
    flags.push({
      id: "profit-no-cash",
      text: "Reports profit but is burning cash — net income was positive the last two years while free cash flow was negative both years.",
    });
  }

  // Rising leverage: debt/equity climbed for the last 3 reported years.
  const recentDE = trailing(derived.debtToEquity, 3);
  if (recentDE.length === 3 && isMonotonic(recentDE, "up")) {
    flags.push({
      id: "rising-leverage",
      text: `Debt-to-equity has risen for three straight years, reaching ${(recentDE[2] * 100).toFixed(0)}%.`,
    });
  }

  // Margin erosion: net margin fell for the last 3 reported years.
  const recentMargin = trailing(derived.netMargin, 3);
  if (recentMargin.length === 3 && isMonotonic(recentMargin, "down")) {
    flags.push({
      id: "margin-erosion",
      text: "Net margin has shrunk for three straight years — the business is keeping less of every dollar it sells.",
    });
  }

  // Shrinking sales: revenue fell in each of the last 2 reported years.
  const recentGrowth = trailing(derived.revenueGrowth, 2);
  if (recentGrowth.length === 2 && recentGrowth.every((v) => v !== null && v < 0)) {
    flags.push({
      id: "shrinking-sales",
      text: "Revenue has declined in each of the last two reported fiscal years.",
    });
  }

  // Dilution: diluted share count grew more than 15% over the last 5 years
  // while diluted EPS did not grow.
  const shares = base.series.dilutedShares;
  const eps = base.series.dilutedEps;
  const s5 = trailing(shares, 5);
  const e5 = trailing(eps, 5);
  if (s5.length === 5 && s5[0] && s5[4] && (s5[4] / s5[0] - 1) > 0.15 && e5[0] !== null && e5[4] !== null && e5[4] <= e5[0]) {
    flags.push({
      id: "dilution",
      text: `Shares outstanding grew ${(((s5[4] / s5[0]) - 1) * 100).toFixed(0)}% over five years while diluted EPS did not improve — owners' slice of the pie shrank.`,
    });
  }

  return flags;
}

export function trendVerdict(arr) {
  const vals = arr.filter((v) => v !== null && v !== undefined);
  if (vals.length < 2) return { label: "Not enough data", cls: "watch" };
  const recent = trailing(vals, Math.min(5, vals.length));
  const up = recent[recent.length - 1] > recent[0];
  const volatility = Math.max(...recent) - Math.min(...recent);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const relVol = avg !== 0 ? Math.abs(volatility / avg) : 0;
  if (up && relVol < 1.2) return { label: "Improving", cls: "good" };
  if (up) return { label: "Improving, volatile", cls: "watch" };
  if (!up && relVol > 1.5) return { label: "Deteriorating", cls: "flag" };
  return { label: "Weakening", cls: "watch" };
}
