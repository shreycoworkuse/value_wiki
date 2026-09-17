// A minimal, stateless CORS passthrough for two free public filing APIs
// this app reads live: SEC EDGAR (US) and Companies House (UK). Same
// reasoning for both — see the per-service sections below — and the same
// non-goal: no caching layer of its own beyond what Cloudflare's edge does
// for any HTTP response, no logging, no storage, no account system.
//
// Deployed by .github/workflows/deploy-worker.yml on every push to main.

function withCors(headers) {
  const h = new Headers(headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Accept");
  return h;
}

function badRequest(message) {
  return new Response(message, { status: 400, headers: withCors({}) });
}

// --- SEC EDGAR (US) ---------------------------------------------------
// data.sec.gov doesn't send an Access-Control-Allow-Origin header, so
// browsers block direct cross-origin fetches to it from any site other
// than sec.gov itself. Forwards the exact same GET request server-side
// (where CORS doesn't apply). Scoped to only the company-facts endpoint,
// so it can't be used as a general-purpose open proxy for arbitrary URLs.
const SEC_ALLOWED_PREFIX = "https://data.sec.gov/api/xbrl/companyfacts/CIK";

function isAllowedSecTarget(url) {
  return url.startsWith(SEC_ALLOWED_PREFIX) && url.endsWith(".json") && !url.includes("..");
}

async function handleSec(target) {
  if (!isAllowedSecTarget(target)) {
    return badRequest("This proxy only forwards SEC XBRL company-facts requests.");
  }
  const upstream = await fetch(target, {
    headers: {
      Accept: "application/json",
      // SEC asks automated clients to identify themselves with a contact.
      "User-Agent": "value-wiki CORS proxy (contact: shrey.cowork.use@gmail.com)",
    },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: withCors({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "public, max-age=300",
    }),
  });
}

// --- Companies House (UK) ----------------------------------------------
// Two reasons this can't be a direct browser fetch like SEC's data.sec.gov
// sometimes is: (1) Companies House's REST API is unlikely to send CORS
// headers for third-party origins either — same class of API as SEC's, and
// we already learned not to assume otherwise without a proxy in place —
// and (2) it authenticates with an API key sent as HTTP Basic Auth, which
// must never be embedded in client-side JS (anyone viewing the page source
// could read and reuse it). So Companies House calls are proxy-only, not
// direct-then-fallback like SEC's. The key lives only as this Worker's
// COMPANIES_HOUSE_API_KEY secret (set via `wrangler secret put` or the
// Cloudflare dashboard — see README) and is never returned to the browser.
//
// Scoped to exactly three read-only operations, each building its own
// upstream URL server-side from validated inputs — the browser never sends
// a raw target URL for this service, unlike the SEC passthrough above, so
// there's no way to redirect this proxy at an arbitrary Companies House (or
// other) endpoint.
const CH_API_BASE = "https://api.company-information.service.gov.uk";
const CH_DOCUMENT_BASE = "https://document-api.company-information.service.gov.uk";
const COMPANY_NUMBER_RE = /^[A-Z0-9]{6,10}$/i;
const DOCUMENT_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function chAuthHeader(env) {
  const key = env.COMPANIES_HOUSE_API_KEY;
  if (!key) return null;
  // Companies House uses HTTP Basic Auth with the API key as the username
  // and an empty password.
  return "Basic " + btoa(`${key}:`);
}

async function handleCompaniesHouse(op, params, env) {
  const auth = chAuthHeader(env);
  if (!auth) {
    return new Response(
      "Companies House proxy isn't configured yet: this Worker's COMPANIES_HOUSE_API_KEY secret hasn't been set. See README's UK/LSE support section.",
      { status: 503, headers: withCors({}) }
    );
  }

  let upstreamUrl;
  if (op === "search") {
    const q = params.get("q");
    if (!q) return badRequest("Missing required 'q' parameter for search.");
    upstreamUrl = `${CH_API_BASE}/search/companies?q=${encodeURIComponent(q)}&items_per_page=10`;
  } else if (op === "filings") {
    const companyNumber = params.get("company_number");
    if (!companyNumber || !COMPANY_NUMBER_RE.test(companyNumber)) {
      return badRequest("Missing or invalid 'company_number' parameter for filings.");
    }
    upstreamUrl = `${CH_API_BASE}/company/${encodeURIComponent(companyNumber)}/filing-history?category=accounts&items_per_page=40`;
  } else if (op === "document") {
    const documentId = params.get("document_id");
    if (!documentId || !DOCUMENT_ID_RE.test(documentId)) {
      return badRequest("Missing or invalid 'document_id' parameter for document.");
    }
    upstreamUrl = `${CH_DOCUMENT_BASE}/document/${encodeURIComponent(documentId)}/content`;
  } else {
    return badRequest("Unknown Companies House operation. Expected op=search|filings|document.");
  }

  const upstream = await fetch(upstreamUrl, {
    headers: {
      Authorization: auth,
      // The document endpoint serves iXBRL as XHTML; the JSON endpoints
      // ignore this Accept value and return JSON regardless.
      Accept: op === "document" ? "application/xhtml+xml" : "application/json",
    },
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: withCors({
      "Content-Type": upstream.headers.get("Content-Type") || (op === "document" ? "application/xhtml+xml" : "application/json"),
      "Cache-Control": "public, max-age=300",
    }),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: withCors({}) });
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: withCors({}) });
    }

    const params = new URL(request.url).searchParams;
    const service = params.get("service") || "sec"; // default keeps existing callers working unchanged

    if (service === "sec") {
      const target = params.get("url");
      if (!target) return badRequest("Missing required 'url' parameter for the SEC service.");
      return handleSec(target);
    }
    if (service === "ch") {
      return handleCompaniesHouse(params.get("op"), params, env);
    }
    return badRequest("Unknown service. Expected service=sec|ch.");
  },
};
