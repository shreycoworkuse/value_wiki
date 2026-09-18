// Historical daily close prices from Stooq (stooq.com/q/d/l/) — a free,
// no-login, no-API-key CSV export, proxied through the same Cloudflare
// Worker as the SEC/Companies House data (stooq.com doesn't send a CORS
// header either). This is an unofficial, best-effort source: gaps,
// occasional rate-limiting, or a temporary outage are all possible, so a
// failure here degrades gracefully — the rest of the dossier never depends
// on it, and callers should treat a null return as "no price data
// available" rather than an error to surface loudly.

function parseStooqCsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const dateIdx = header.indexOf("Date");
  const closeIdx = header.indexOf("Close");
  if (dateIdx === -1 || closeIdx === -1) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const date = cols[dateIdx];
    const close = parseFloat(cols[closeIdx]);
    if (!date || !Number.isFinite(close)) continue;
    rows.push({ date, close });
  }
  return rows; // Stooq returns these in ascending date order already
}

// Approximates a fiscal year's end date for annual-only (UK) periods, which
// only carry a bare year string (e.g. "2023"), not an exact end date —
// buildAnnualSeries() collapses that detail away. Good enough for "find the
// closest trading day," which is all this is used for.
function periodEndDate(period) {
  return /^\d{4}$/.test(String(period.key)) ? `${period.key}-12-31` : period.key;
}

// Returns the closing price on the closest trading day on/before each
// period's end date, or null for a period with no earlier trading data.
function alignToPeriods(rows, periods) {
  if (!rows.length) return periods.map(() => null);
  let cursor = 0;
  return periods.map((period) => {
    const targetEnd = periodEndDate(period);
    while (cursor + 1 < rows.length && rows[cursor + 1].date <= targetEnd) cursor++;
    return rows[cursor].date <= targetEnd ? rows[cursor].close : null;
  });
}

export async function fetchStockPriceSeries(ticker, market, periods, proxyUrl) {
  const suffix = market === "LSE" ? "uk" : "us";
  const symbol = `${ticker.toLowerCase()}.${suffix}`;
  try {
    const res = await fetch(`${proxyUrl}?service=stooq&symbol=${encodeURIComponent(symbol)}`, {
      headers: { Accept: "text/csv" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const rows = parseStooqCsv(text);
    if (!rows.length) return null;
    return alignToPeriods(rows, periods);
  } catch {
    return null;
  }
}
