// A minimal, stateless CORS passthrough for SEC's XBRL company-facts API.
//
// Why this exists: data.sec.gov doesn't send an Access-Control-Allow-Origin
// header, so browsers block direct cross-origin fetches to it from any site
// other than sec.gov itself. This Worker does nothing but forward the exact
// same GET request server-side (where CORS doesn't apply) and copy the
// response back with the header added — no caching layer of its own beyond
// what Cloudflare's edge does for any HTTP response, no logging, no storage,
// no account system. It only ever talks to data.sec.gov, and only to the
// company-facts endpoint — see isAllowedTarget below — so it can't be used
// as a general-purpose open proxy for arbitrary URLs.
//
// Deployed by .github/workflows/deploy-worker.yml on every push to main.

const ALLOWED_PREFIX = "https://data.sec.gov/api/xbrl/companyfacts/CIK";

function isAllowedTarget(url) {
  return url.startsWith(ALLOWED_PREFIX) && url.endsWith(".json") && !url.includes("..");
}

function withCors(headers) {
  const h = new Headers(headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Accept");
  return h;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: withCors({}) });
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: withCors({}) });
    }

    const target = new URL(request.url).searchParams.get("url");
    if (!target || !isAllowedTarget(target)) {
      return new Response("This proxy only forwards SEC XBRL company-facts requests.", {
        status: 400,
        headers: withCors({}),
      });
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
  },
};
