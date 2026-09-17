// Company-facts figures come live from SEC EDGAR's free, public, no-key XBRL
// API, fetched fresh on every search — nothing is pre-fetched or stored on
// any server we control.
//
// data.sec.gov doesn't send a CORS header for third-party origins, so a
// direct browser fetch from anywhere but sec.gov itself is blocked. Unlike
// the ticker list below, this data is per-company and fetched live for
// whatever ticker a visitor types, so it can't be pre-fetched and bundled at
// deploy time the same way — that would mean building exactly the kind of
// multi-GB database this project is deliberately avoiding.
//
// Instead, fetchCompanyFacts() tries the direct request first and, only if
// that's blocked, falls back to a small Cloudflare Worker we control
// (cloudflare-worker/sec-proxy.js) that does nothing but forward the same
// GET request and add the missing CORS header — still no database, still
// stateless, still a live fetch per request, just relayed through
// infrastructure we own instead of a third party. See that file and the
// README for the setup this needs (a free Cloudflare account) and why a
// public third-party CORS relay was deliberately ruled out instead.
const TICKERS_URL = "data/company_tickers.json";
const FACTS_URL = (cik10) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`;

// Filled in after the Worker's first deploy (its URL depends on your
// Cloudflare account's workers.dev subdomain, so it can't be known ahead of
// time) — see README "Setting up the CORS proxy". Left blank, the app still
// works everywhere data.sec.gov's direct fetch isn't blocked.
const PROXY_URL = "";

async function fetchFactsJson(target, onProgress) {
  try {
    const res = await fetch(target, { headers: { Accept: "application/json" } });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
    return await res.json();
  } catch (err) {
    if (err.httpStatus) throw err; // SEC itself answered — that's authoritative, don't fall back
    if (!PROXY_URL) throw err;
    onProgress?.("Direct request was blocked — retrying through the CORS proxy…");
    const res = await fetch(`${PROXY_URL}?url=${encodeURIComponent(target)}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
    return res.json();
  }
}

let tickerIndexPromise = null;

function padCik(cik) {
  return String(cik).padStart(10, "0");
}

// Fetches (once per page load) the SEC's full ticker -> CIK -> name map.
export function loadTickerIndex() {
  if (!tickerIndexPromise) {
    tickerIndexPromise = fetch(TICKERS_URL, { headers: { Accept: "application/json" } })
      .then((res) => {
        if (!res.ok) throw new Error(`Ticker list request failed (${res.status}). Run scripts/fetch-tickers.sh once if you're testing locally.`);
        return res.json();
      })
      .then((raw) => {
        // raw shape: { "0": {cik_str, ticker, title}, "1": {...}, ... }
        return Object.values(raw).map((row) => ({
          cik: padCik(row.cik_str),
          ticker: row.ticker,
          name: row.title,
        }));
      });
  }
  return tickerIndexPromise;
}

export async function searchTickers(query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const index = await loadTickerIndex();
  const starts = [];
  const contains = [];
  for (const row of index) {
    const tickerL = row.ticker.toLowerCase();
    const nameL = row.name.toLowerCase();
    if (tickerL === q) {
      starts.unshift(row); // exact ticker match first
    } else if (tickerL.startsWith(q) || nameL.startsWith(q)) {
      starts.push(row);
    } else if (tickerL.includes(q) || nameL.includes(q)) {
      contains.push(row);
    }
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

export async function findTickerExact(query) {
  const index = await loadTickerIndex();
  const q = query.trim().toLowerCase();
  return index.find((row) => row.ticker.toLowerCase() === q) || null;
}

// Fetches the company's full XBRL fact set: every figure it has ever tagged
// in a filing, with the source form, fiscal year and filing date attached.
export async function fetchCompanyFacts(cik10, onProgress) {
  onProgress?.(`Requesting SEC XBRL company facts for CIK ${cik10}…`);
  try {
    const json = await fetchFactsJson(FACTS_URL(cik10), onProgress);
    onProgress?.("Parsing filed figures…");
    return json;
  } catch (err) {
    if (err.httpStatus === 404) {
      throw new Error("This company has no structured XBRL filings on file with the SEC (common for very small or recently-listed companies).");
    }
    if (err.httpStatus) {
      throw new Error(`SEC company-facts request failed (HTTP ${err.httpStatus}).`);
    }
    throw err;
  }
}

export function filingIndexUrl(cik10) {
  const cikNum = String(parseInt(cik10, 10));
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNum}&type=10-K&dateb=&owner=include&count=40`;
}
