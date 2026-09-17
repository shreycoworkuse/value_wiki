import { parseIxbrlDocument, buildAnnualSeriesFromFilings } from "./ixbrl.js";

// UK / LSE support. There is no free equivalent to SEC's ticker->CIK file
// for LSE-listed companies, so this is a hand-curated (not comprehensive)
// list of major FTSE constituents, mapping each ticker to its official
// registered company name — never to a hardcoded Companies House company
// number. Numbers are resolved live via Companies House's own search API
// every time, specifically to avoid the correctness risk of silently
// showing the wrong company's real financials from a wrong or stale
// hand-typed number. If a search returns no confident match, the lookup
// fails cleanly rather than guessing.
//
// This whole pipeline (this file + js/ixbrl.js) has NOT been exercised
// against the real Companies House API or a real filed document — this
// sandbox cannot reach it. It's built carefully from the documented API
// shape and the Inline XBRL 1.1 spec, but treat it as unverified until
// tested live. See README's "UK / LSE support" section.

export const UK_TICKERS = [
  { ticker: "VOD", name: "Vodafone Group Public Limited Company" },
  { ticker: "ULVR", name: "Unilever PLC" },
  { ticker: "SHEL", name: "Shell plc" },
  { ticker: "BP", name: "BP p.l.c." },
  { ticker: "GSK", name: "GSK plc" },
  { ticker: "AZN", name: "AstraZeneca PLC" },
  { ticker: "HSBA", name: "HSBC Holdings plc" },
  { ticker: "DGE", name: "Diageo plc" },
  { ticker: "RIO", name: "Rio Tinto plc" },
  { ticker: "BATS", name: "British American Tobacco p.l.c." },
  { ticker: "BARC", name: "Barclays PLC" },
  { ticker: "LLOY", name: "Lloyds Banking Group plc" },
  { ticker: "NG", name: "National Grid plc" },
  { ticker: "BT.A", name: "BT Group plc" },
  { ticker: "RR", name: "Rolls-Royce Holdings plc" },
  { ticker: "RKT", name: "Reckitt Benckiser Group plc" },
  { ticker: "AV", name: "Aviva plc" },
  { ticker: "LGEN", name: "Legal & General Group Plc" },
  { ticker: "PRU", name: "Prudential plc" },
  { ticker: "STAN", name: "Standard Chartered PLC" },
  { ticker: "NXT", name: "Next plc" },
  { ticker: "ABF", name: "Associated British Foods plc" },
  { ticker: "CPG", name: "Compass Group PLC" },
  { ticker: "REL", name: "RELX PLC" },
  { ticker: "EXPN", name: "Experian plc" },
  { ticker: "LSEG", name: "London Stock Exchange Group plc" },
  { ticker: "PSON", name: "Pearson plc" },
  { ticker: "AAL", name: "Anglo American plc" },
  { ticker: "GLEN", name: "Glencore plc" },
  { ticker: "SN", name: "Smith & Nephew plc" },
  { ticker: "CRDA", name: "Croda International Plc" },
  { ticker: "HLMA", name: "Halma plc" },
  { ticker: "AHT", name: "Ashtead Group plc" },
  { ticker: "BNZL", name: "Bunzl plc" },
  { ticker: "MRO", name: "Melrose Industries PLC" },
  { ticker: "PSN", name: "Persimmon Plc" },
  { ticker: "BDEV", name: "Barratt Redrow plc" },
  { ticker: "LAND", name: "Land Securities Group PLC" },
  { ticker: "BLND", name: "British Land Company PLC" },
  { ticker: "SGRO", name: "SEGRO plc" },
  { ticker: "TSCO", name: "Tesco PLC" },
  { ticker: "SBRY", name: "J Sainsbury plc" },
  { ticker: "WTB", name: "Whitbread PLC" },
];

// Builds the Worker query URL for a given Companies House operation.
function chUrl(proxyBaseUrl, op, extraParams) {
  const url = new URL(proxyBaseUrl);
  url.searchParams.set("service", "ch");
  url.searchParams.set("op", op);
  for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
  return url.toString();
}

// Resolves a curated official company name to its live Companies House
// company number via a name search — never a hardcoded number. Picks the
// first result whose title matches case-insensitively (Companies House
// search ranks best-matches first, so if no exact match appears, this
// fails closed rather than guessing at a loosely-related company).
export async function resolveCompanyNumber(officialName, proxyBaseUrl) {
  const res = await fetch(chUrl(proxyBaseUrl, "search", { q: officialName }));
  if (!res.ok) {
    throw Object.assign(new Error(`Companies House search failed (HTTP ${res.status}).`), { httpStatus: res.status });
  }
  const data = await res.json();
  const items = data.items || [];
  const normalizedTarget = officialName.trim().toLowerCase();
  const exact = items.find((it) => (it.title || "").trim().toLowerCase() === normalizedTarget);
  const best = exact || items[0];
  if (!best) return null;
  return { companyNumber: best.company_number, title: best.title };
}

// Fetches this company's filed annual-accounts history and returns the
// list of { periodEnd, documentId } needed to build a multi-year series —
// one entry per filed AA (annual accounts) document, newest first from the
// API, returned here oldest-first to match js/kpis.js's year ordering.
export async function fetchAccountsFilings(companyNumber, proxyBaseUrl) {
  const res = await fetch(chUrl(proxyBaseUrl, "filings", { company_number: companyNumber }));
  if (!res.ok) {
    throw Object.assign(new Error(`Companies House filing history request failed (HTTP ${res.status}).`), { httpStatus: res.status });
  }
  const data = await res.json();
  const items = (data.items || []).filter((it) => it.category === "accounts" && it?.links?.document_metadata);

  const filings = items
    .map((it) => {
      const documentId = it.links.document_metadata.split("/").filter(Boolean).pop();
      // Companies House filing-history items for accounts commonly carry the
      // accounts' own period-end date under description_values.made_up_date;
      // fall back to the filing's own date if that's ever absent — unverified
      // against a real response, see module header.
      const periodEnd = it.description_values?.made_up_date || it.date;
      if (!documentId || !periodEnd) return null;
      return { periodEnd, documentId };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.periodEnd) - new Date(b.periodEnd));

  return filings;
}

// Fetches one filing's iXBRL document content (raw XHTML text).
export async function fetchFilingDocument(documentId, proxyBaseUrl) {
  const res = await fetch(chUrl(proxyBaseUrl, "document", { document_id: documentId }));
  if (!res.ok) {
    throw Object.assign(new Error(`Companies House document request failed (HTTP ${res.status}).`), { httpStatus: res.status });
  }
  return res.text();
}

export function findUkTicker(query) {
  const q = query.trim().toLowerCase();
  return UK_TICKERS.find((t) => t.ticker.toLowerCase() === q) || null;
}

// Full pipeline for one UK ticker: resolve -> fetch filing list -> fetch +
// parse each filing's iXBRL -> assemble into the same { years, series }
// shape js/kpis.js's buildAnnualSeries() produces for a US company, so
// every other tab in this app works unchanged. Caps at the most recent 15
// filed annual-accounts documents (each is its own network fetch through
// the Worker) rather than a company's full multi-decade history.
export async function fetchUkCompanySeries(ticker, proxyBaseUrl, onProgress) {
  const entry = findUkTicker(ticker);
  if (!entry) return null;

  onProgress?.(`Looking up ${entry.name} at Companies House…`);
  const resolved = await resolveCompanyNumber(entry.name, proxyBaseUrl);
  if (!resolved) {
    throw new Error(`Companies House search found no match for "${entry.name}".`);
  }

  onProgress?.(`Fetching filed annual accounts for company number ${resolved.companyNumber}…`);
  const allFilings = await fetchAccountsFilings(resolved.companyNumber, proxyBaseUrl);
  const filings = allFilings.slice(-15);
  if (!filings.length) {
    throw new Error(`No filed annual accounts documents found for ${entry.name} at Companies House.`);
  }

  const parsedFilings = [];
  for (const f of filings) {
    onProgress?.(`Parsing accounts filed for period ending ${f.periodEnd}…`);
    try {
      const html = await fetchFilingDocument(f.documentId, proxyBaseUrl);
      const parsed = parseIxbrlDocument(html);
      parsedFilings.push({ periodEnd: f.periodEnd, parsed });
    } catch (err) {
      // One bad/unparseable filing shouldn't take down the whole series —
      // skip it and carry on, the same "never fabricate, just leave a gap"
      // principle as the rest of this app.
      console.warn(`Skipping unparseable filing for ${entry.name} (${f.periodEnd}):`, err);
    }
  }
  if (!parsedFilings.length) {
    throw new Error(`Found filed accounts for ${entry.name}, but none could be parsed into structured figures.`);
  }

  return {
    company: { name: entry.name, ticker: entry.ticker, cik: null, companyNumber: resolved.companyNumber, market: "LSE" },
    base: buildAnnualSeriesFromFilings(parsedFilings),
  };
}
