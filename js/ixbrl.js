// Parses UK "Inline XBRL" (iXBRL) company accounts — the format every UK
// company's statutory accounts are filed in with Companies House, and the
// FCA's mandated format for UK-listed groups' annual reports since 2021.
//
// Unlike SEC's XBRL API, which hands back clean parsed JSON facts, iXBRL is
// XBRL tags embedded inline inside the filed HTML/XHTML document itself —
// so this module has to parse the actual filed document, not just read a
// field off a response. This is standardized by XBRL International's
// Inline XBRL 1.1 recommendation, so the mechanics below (contexts, scale,
// sign, decimals) are spec-driven, not guessed — but this parser has NOT
// been run against a real filed document in this environment (this sandbox
// cannot reach Companies House to fetch one), only against a hand-built,
// spec-compliant synthetic fixture. Treat it as unverified against the real
// thing until tested live. See README's "UK / LSE support" section.
//
// Design goal: produce the exact same { years, series } shape js/kpis.js's
// buildAnnualSeries() produces for US companies, using the same internal
// key names (revenue, netIncome, assets, ...), so every other module in
// this app (KPI grid, stories, timeline, verdict, valuation) works for a
// UK company completely unchanged — this module is the only UK-specific
// data-shaping code that needs to exist.

// Maps our internal keys to the IFRS / UK-GAAP concept names that carry
// them, mirroring js/kpis.js's RAW_TAGS. Most large UK-listed groups report
// under full IFRS (ifrs-full: prefix); smaller/older filings may use the
// UK GAAP FRS 101/102 taxonomy instead — both are tried, in order.
const IFRS_TAGS = {
  revenue: { tags: ["ifrs-full:Revenue", "ifrs-full:RevenueFromContractsWithCustomers"], kind: "duration" },
  netIncome: { tags: ["ifrs-full:ProfitLoss", "ifrs-full:ProfitLossAttributableToOwnersOfParent"], kind: "duration" },
  operatingIncome: { tags: ["ifrs-full:ProfitLossFromOperatingActivities"], kind: "duration" },
  assets: { tags: ["ifrs-full:Assets"], kind: "instant" },
  liabilities: { tags: ["ifrs-full:Liabilities"], kind: "instant" },
  equity: { tags: ["ifrs-full:Equity", "ifrs-full:EquityAttributableToOwnersOfParent"], kind: "instant" },
  cash: { tags: ["ifrs-full:CashAndCashEquivalents"], kind: "instant" },
  longTermDebt: { tags: ["ifrs-full:NoncurrentBorrowings", "ifrs-full:NoncurrentLoansAndBorrowings"], kind: "instant" },
  operatingCashFlow: { tags: ["ifrs-full:CashFlowsFromUsedInOperatingActivities"], kind: "duration" },
  capex: { tags: ["ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", "ifrs-full:PaymentsToAcquirePropertyPlantAndEquipment"], kind: "duration" },
  dilutedEps: { tags: ["ifrs-full:DilutedEarningsLossPerShare"], kind: "duration" },
  dilutedShares: { tags: ["ifrs-full:DilutedWeightedAverageShares", "ifrs-full:WeightedAverageNumberOfDilutedSharesOutstanding"], kind: "duration" },
  grossProfit: { tags: ["ifrs-full:GrossProfit"], kind: "duration" },
  assetsCurrent: { tags: ["ifrs-full:CurrentAssets"], kind: "instant" },
  liabilitiesCurrent: { tags: ["ifrs-full:CurrentLiabilities"], kind: "instant" },
  dividendsPaid: { tags: ["ifrs-full:DividendsPaidClassifiedAsFinancingActivities", "ifrs-full:DividendsPaid"], kind: "duration" },
  incomeTaxExpense: { tags: ["ifrs-full:IncomeTaxExpenseContinuingOperations"], kind: "duration" },
};

const IX_LOCAL_NAMES = ["nonFraction", "nonNumeric"];
const XBRLI_CONTEXT_NS_HINTS = ["xbrl.org/2003/instance"];

function localName(el) {
  return el.localName || el.tagName.split(":").pop();
}

function findAllByLocalName(root, name) {
  return Array.from(root.getElementsByTagName("*")).filter((el) => localName(el) === name);
}

function textContent(el) {
  return (el.textContent || "").replace(/[\s ]+/g, " ").trim();
}

// Parses a filed iXBRL document (the raw XHTML string) into a flat list of
// facts with their resolved period, ready to be matched against IFRS_TAGS.
// Never throws on malformed input — returns as much as it could parse, so
// one broken filing doesn't take down the whole pipeline.
export function parseIxbrlDocument(html) {
  // Inline XBRL requires the host document to be well-formed XHTML (that's
  // part of what makes a filing validate), so we parse it as XML rather
  // than HTML — HTML parsing mode doesn't resolve namespace prefixes like
  // `xbrli:context`, which breaks every lookup below. If a real filing ever
  // turns out not to be strictly well-formed, this falls back to HTML
  // parsing so we still extract what we can rather than returning nothing.
  let doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
  if (doc.querySelector("parsererror")) {
    doc = new DOMParser().parseFromString(html, "text/html");
  }

  // --- Contexts: map contextRef -> resolved period, skipping any context
  // that carries a dimensional qualifier (segment/scenario) — those are
  // sub-breakdowns (e.g. by business segment, or a restated prior-year
  // scenario), not the primary consolidated whole-company figure we want.
  const contexts = new Map();
  const contextEls = findAllByLocalName(doc, "context").filter((el) =>
    (el.namespaceURI || "").includes("xbrl.org/2003/instance") || XBRLI_CONTEXT_NS_HINTS.some((h) => (el.namespaceURI || "").includes(h)) || true
  );
  for (const ctx of contextEls) {
    const id = ctx.getAttribute("id");
    if (!id) continue;
    const hasSegment = findAllByLocalName(ctx, "segment").length > 0 || findAllByLocalName(ctx, "scenario").length > 0;
    const instantEl = findAllByLocalName(ctx, "instant")[0];
    const startEl = findAllByLocalName(ctx, "startDate")[0];
    const endEl = findAllByLocalName(ctx, "endDate")[0];
    if (instantEl) {
      contexts.set(id, { kind: "instant", end: textContent(instantEl), hasSegment });
    } else if (startEl && endEl) {
      contexts.set(id, { kind: "duration", start: textContent(startEl), end: textContent(endEl), hasSegment });
    }
  }

  // --- Facts: every ix:nonFraction in the document, with its numeric value
  // cleaned up per the Inline XBRL 1.1 spec (strip formatting, apply
  // scale as a power-of-10 multiplier, apply the sign flag).
  const facts = [];
  for (const localNameWanted of IX_LOCAL_NAMES) {
    if (localNameWanted !== "nonFraction") continue; // only numeric facts matter for KPIs
    for (const el of findAllByLocalName(doc, localNameWanted)) {
      const name = el.getAttribute("name");
      const contextRef = el.getAttribute("contextref") || el.getAttribute("contextRef");
      if (!name || !contextRef) continue;
      const ctx = contexts.get(contextRef);
      if (!ctx || ctx.hasSegment) continue;

      const raw = textContent(el).replace(/[,\s ]/g, "");
      if (raw === "" || raw === "-") continue;
      let value = parseFloat(raw);
      if (Number.isNaN(value)) continue;

      const scaleAttr = el.getAttribute("scale");
      if (scaleAttr !== null) {
        const scale = parseInt(scaleAttr, 10);
        if (!Number.isNaN(scale)) value *= Math.pow(10, scale);
      }
      const sign = el.getAttribute("sign");
      if (sign === "-") value = -value;

      facts.push({ name: name.trim(), contextRef, value, period: ctx });
    }
  }

  return { contexts, facts };
}

// Picks, for one internal key, the single fact from one filing's parsed
// document that represents this filing's own reporting period — never a
// prior-year comparative figure embedded in the same document (those get
// picked up naturally when we parse *that* year's own filing instead, the
// same "one filing = one year" discipline js/kpis.js uses for 10-Ks).
function pickFactForFiling(parsed, tagList, kind, periodEnd) {
  for (const tagName of tagList) {
    const candidates = parsed.facts.filter((f) => f.name === tagName && f.period.kind === kind);
    if (!candidates.length) continue;
    // Prefer the fact whose context end date matches this filing's own
    // period end (the primary, current-year figure); fall back to the
    // fact with the latest end date the document carries for this concept.
    const exact = candidates.find((f) => f.period.end === periodEnd);
    if (exact) return exact.value;
    candidates.sort((a, b) => new Date(b.period.end) - new Date(a.period.end));
    return candidates[0].value;
  }
  return null;
}

// filings: [{ periodEnd: "YYYY-MM-DD", parsed: <parseIxbrlDocument() result> }, ...]
// sorted ascending by period end — one entry per filed annual accounts
// document, exactly mirroring js/kpis.js's one-10-K-per-year discipline.
// Returns the same { years, series } shape buildAnnualSeries() does.
export function buildAnnualSeriesFromFilings(filings) {
  const years = filings.map((f) => f.periodEnd.slice(0, 4));
  const series = {};
  for (const [key, def] of Object.entries(IFRS_TAGS)) {
    series[key] = filings.map((f) => pickFactForFiling(f.parsed, def.tags, def.kind, f.periodEnd));
  }
  return { years, series };
}
