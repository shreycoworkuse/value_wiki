// Company-facts figures come live from SEC EDGAR's free, public, no-key XBRL
// API — the browser talks to data.sec.gov directly, on the fly, per request.
// Nothing is fetched through or stored on any server we control.
//
// The ticker -> CIK lookup list is the one exception: SEC publishes it from
// www.sec.gov (a plain content server, not the data.sec.gov API domain) with
// no CORS header, so browsers refuse to read it cross-origin from any other
// site. It's small (~1MB) and public reference data that changes rarely, so
// the free deploy pipeline (see .github/workflows/deploy-pages.yml) fetches
// a fresh copy server-side on every deploy and publishes it same-origin
// alongside the site — no CORS problem, no database, still refreshed
// automatically on every deploy rather than hand-maintained.
const TICKERS_URL = "data/company_tickers.json";
const FACTS_URL = (cik10) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`;

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
  const res = await fetch(FACTS_URL(cik10), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "This company has no structured XBRL filings on file with the SEC (common for very small or recently-listed companies)."
        : `SEC company-facts request failed (HTTP ${res.status}).`
    );
  }
  onProgress?.("Parsing filed figures…");
  return res.json();
}

export function filingIndexUrl(cik10) {
  const cikNum = String(parseInt(cik10, 10));
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNum}&type=10-K&dateb=&owner=include&count=40`;
}
