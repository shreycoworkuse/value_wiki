import { searchTickers, findTickerExact, fetchCompanyFacts, filingIndexUrl, PROXY_URL } from "./sec.js";
import { UK_TICKERS, findUkTicker, fetchUkCompanySeries } from "./uk-companies.js";
import { buildAnnualSeries, buildQuarterlySeries, computeDerived } from "./kpis.js";
import { detectRedFlags } from "./redflags.js";
import { buildChecklist } from "./verdict.js";
import { initGlossary } from "./glossary.js";
import { renderCoverStory, renderKpiGrid, renderVerdict, renderValuation, renderSources } from "./ui.js";
import { renderStories } from "./stories.js";
import { renderMoneyFlow } from "./money-flow.js";
import { renderTimeline } from "./timeline.js";
import { renderExecutionConsistency } from "./execution.js";
import { renderValuationExtra } from "./valuation-extra.js";
import { renderCompare } from "./compare.js";
import { initTour } from "./tour.js";

// Resolves one ticker into a fully-computed { company, base, derived,
// checklist } state, trying the US/SEC pipeline first (the larger, more
// battle-tested one) and only trying the curated UK/LSE pipeline if SEC has
// no match for that exact ticker — so a ticker that happens to exist in
// both never gets silently routed away from the bigger, better-covered
// dataset. Shared by both the main dossier loader and the Compare tab.
async function resolveCompanyState(tickerQuery, onProgress) {
  const secMatch = await findTickerExact(tickerQuery);
  if (secMatch) {
    onProgress?.(`Requesting SEC XBRL company facts for CIK ${secMatch.cik}…`);
    const facts = await fetchCompanyFacts(secMatch.cik, onProgress);
    const base = buildAnnualSeries(facts);
    if (!base.years.length) {
      throw new Error(`SEC has a record for ${secMatch.name}, but no usable annual (10-K) XBRL figures were found.`);
    }
    onProgress?.(`Found ${base.years.length} years of annual filings (FY${base.years[0]}–FY${base.years[base.years.length - 1]})`);
    const derived = computeDerived(base);
    const checklist = buildChecklist(base, derived);
    // Quarterly resolution (for the Money flow tab's time slider) comes free
    // from the same already-fetched company-facts payload — no new request.
    // Only US/SEC filers get it: UK Companies House files annual accounts
    // only, so quarterly stays null there and that tab falls back to annual.
    const quarterly = buildQuarterlySeries(facts);
    return {
      company: { name: secMatch.name, ticker: secMatch.ticker, cik: secMatch.cik, market: "US" },
      base,
      derived,
      checklist,
      quarterly,
    };
  }

  const ukMatch = findUkTicker(tickerQuery);
  if (ukMatch) {
    const result = await fetchUkCompanySeries(tickerQuery, PROXY_URL, onProgress);
    if (!result) throw new Error(`Couldn't find a ticker matching "${tickerQuery}".`);
    const derived = computeDerived(result.base);
    const checklist = buildChecklist(result.base, derived);
    return { company: result.company, base: result.base, derived, checklist, quarterly: null };
  }

  return null;
}

// Reused by the Compare tab to fetch and compute a second company's full
// dossier state via the exact same live pipeline as the main dossier.
async function fetchCompanyState(tickerQuery) {
  const result = await resolveCompanyState(tickerQuery);
  if (!result) {
    throw new Error(`Couldn't find a ticker matching "${tickerQuery}" on SEC EDGAR or in our curated LSE list.`);
  }
  return result;
}

const TABS = [
  { id: "cover", label: "Cover story", render: renderCoverStory },
  { id: "kpis", label: "KPI chapters", render: renderKpiGrid },
  { id: "stories", label: "Stories", render: renderStories },
  { id: "money", label: "Money flow", render: renderMoneyFlow },
  { id: "timeline", label: "Timeline", render: renderTimeline },
  { id: "execution", label: "Track Record", render: renderExecutionConsistency },
  { id: "verdict", label: "Verdict", render: renderVerdict },
  { id: "worth", label: "What is it worth", render: (panel, args) => { renderValuation(panel, args); renderValuationExtra(panel, args); } },
  { id: "compare", label: "Compare", render: (panel, args) => renderCompare(panel, args, fetchCompanyState) },
  { id: "sources", label: "Sources", render: renderSources },
];

const state = {
  company: null,
  base: null,
  derived: null,
  redFlags: null,
  checklist: null,
  price: null,
  quarterly: null,
  activeTab: "cover",
};

const el = {
  landing: document.getElementById("view-landing"),
  dossierView: document.getElementById("view-dossier"),
  status: document.getElementById("dossier-status"),
  content: document.getElementById("dossier-content"),
  name: document.getElementById("dossier-name"),
  meta: document.getElementById("dossier-meta"),
  tabs: document.getElementById("tabs"),
  panels: document.getElementById("tab-panels"),
  searchForm: document.getElementById("search-form"),
  searchInput: document.getElementById("search-input"),
  searchResults: document.getElementById("search-results"),
  priceInput: document.getElementById("price-input"),
  exportBtn: document.getElementById("export-csv"),
  exportPdfBtn: document.getElementById("export-pdf"),
  themeToggle: document.getElementById("theme-toggle"),
};

function setStatus(html, isError = false) {
  el.status.innerHTML = html;
  el.status.classList.toggle("error", isError);
  el.status.classList.remove("hidden");
}

function showLanding() {
  el.landing.classList.remove("hidden");
  el.dossierView.classList.add("hidden");
}

function showDossierShell() {
  el.landing.classList.add("hidden");
  el.dossierView.classList.remove("hidden");
  el.content.classList.add("hidden");
  el.status.classList.remove("hidden", "error");
}

async function loadDossier(tickerQuery) {
  showDossierShell();
  setStatus(`<div class="spinner"></div><div>Looking up ${tickerQuery.toUpperCase()}…</div>`);

  try {
    const progressLines = [];
    const onProgress = (msg) => {
      progressLines.push(msg);
      setStatus(`<div class="spinner"></div><div>${msg}</div><div class="progress-log">${progressLines.map((l) => `<div>✓ ${l}</div>`).join("")}</div>`);
    };

    const result = await resolveCompanyState(tickerQuery, onProgress);
    if (!result) {
      setStatus(`Couldn't find a ticker matching "${tickerQuery}". This tool covers any US company that files with the SEC, plus a curated list of major LSE-listed companies (not every LSE ticker).`, true);
      return;
    }
    const { company, base, derived, checklist, quarterly } = result;
    onProgress("Computing KPIs, red flags and the owner's checklist, locally in your browser…");
    if (company.market !== "LSE" && base.series.dividendsPaid.every((v) => v === null)) {
      onProgress("No dividend data found — this company may not pay a dividend.");
    }
    const redFlags = detectRedFlags(base, derived);

    state.company = company;
    state.base = base;
    state.derived = derived;
    state.redFlags = redFlags;
    state.checklist = checklist;
    state.quarterly = quarterly;
    state.price = null;
    el.priceInput.value = "";

    el.name.textContent = `${company.name} (${company.ticker})`;
    el.meta.innerHTML = company.market === "LSE"
      ? `<span>Companies House #${company.companyNumber}</span><span>FY${base.years[0]}–FY${base.years[base.years.length - 1]}</span><span><a href="https://find-and-update.company-information.service.gov.uk/company/${company.companyNumber}" target="_blank" rel="noopener">View on Companies House ↗</a></span>`
      : `<span>CIK ${company.cik}</span><span>FY${base.years[0]}–FY${base.years[base.years.length - 1]}</span><span><a href="${filingIndexUrl(company.cik)}" target="_blank" rel="noopener">View filings on SEC EDGAR ↗</a></span>`;

    setUrlTicker(company.ticker);
    el.status.classList.add("hidden");
    el.content.classList.remove("hidden");
    buildTabs();
    setActiveTab(state.activeTab);
  } catch (err) {
    console.error(err);
    const isNetworky = err instanceof TypeError;
    const hint = isNetworky
      ? "This usually means the request never reached the source at all — a browser extension (ad/tracker blocker), offline network, or a temporary outage. Check your browser's console/network tab for the blocked request, then try again."
      : "This can happen if the data source is rate-limiting or temporarily unreachable — try again in a moment.";
    setStatus(`Something went wrong fetching live data: ${err.message || err}. ${hint}`, true);
  }
}

function buildTabs() {
  el.tabs.innerHTML = "";
  el.panels.innerHTML = "";
  for (const tab of TABS) {
    const btn = document.createElement("button");
    btn.textContent = tab.label;
    btn.dataset.tab = tab.id;
    btn.id = `tab-btn-${tab.id}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    btn.setAttribute("aria-controls", `tab-panel-${tab.id}`);
    btn.setAttribute("tabindex", "-1");
    btn.addEventListener("click", () => setActiveTab(tab.id));
    el.tabs.append(btn);

    const panel = document.createElement("div");
    panel.className = "tab-panel hidden";
    panel.dataset.panel = tab.id;
    panel.id = `tab-panel-${tab.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-btn-${tab.id}`);
    panel.setAttribute("tabindex", "0");
    el.panels.append(panel);
  }
}

// Roving-tabindex tab list needs Left/Right/Home/End to stay keyboard-operable,
// since only the active tab button sits in the normal Tab order (per WAI-ARIA
// Authoring Practices for the tabs pattern).
el.tabs.addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const buttons = Array.from(el.tabs.querySelectorAll("button"));
  const currentIndex = buttons.findIndex((b) => b.dataset.tab === state.activeTab);
  if (currentIndex === -1) return;
  let nextIndex = currentIndex;
  if (e.key === "ArrowLeft") nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
  else if (e.key === "ArrowRight") nextIndex = (currentIndex + 1) % buttons.length;
  else if (e.key === "Home") nextIndex = 0;
  else if (e.key === "End") nextIndex = buttons.length - 1;
  e.preventDefault();
  setActiveTab(buttons[nextIndex].dataset.tab);
  buttons[nextIndex].focus();
});

function setActiveTab(tabId) {
  state.activeTab = tabId;
  for (const btn of el.tabs.querySelectorAll("button")) {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
    btn.setAttribute("tabindex", isActive ? "0" : "-1");
  }
  for (const panel of el.panels.querySelectorAll(".tab-panel")) {
    panel.classList.toggle("hidden", panel.dataset.panel !== tabId);
  }
  const tabDef = TABS.find((t) => t.id === tabId);
  const panel = el.panels.querySelector(`[data-panel="${tabId}"]`);
  tabDef.render(panel, { company: state.company, base: state.base, derived: state.derived, redFlags: state.redFlags, checklist: state.checklist, price: state.price, quarterly: state.quarterly });
}

function setUrlTicker(ticker) {
  const url = new URL(window.location.href);
  url.searchParams.set("ticker", ticker);
  window.history.replaceState({}, "", url);
}

// --- Search box ---
let searchDebounce = null;
el.searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  const q = el.searchInput.value;
  if (!q.trim()) {
    el.searchResults.classList.add("hidden");
    return;
  }
  searchDebounce = setTimeout(async () => {
    try {
      const [secResults, ukResults] = await Promise.all([
        searchTickers(q),
        Promise.resolve(searchUkTickers(q)),
      ]);
      renderSearchResults([...secResults, ...ukResults]);
    } catch (e) {
      console.error(e);
    }
  }, 180);
});

function searchUkTickers(query, limit = 4) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return UK_TICKERS
    .filter((t) => t.ticker.toLowerCase().startsWith(q) || t.name.toLowerCase().includes(q))
    .slice(0, limit)
    .map((t) => ({ ticker: t.ticker, name: t.name, market: "LSE" }));
}

function renderSearchResults(results) {
  if (!results.length) {
    el.searchResults.classList.add("hidden");
    return;
  }
  el.searchResults.innerHTML = results
    .map((r) => `<div class="result-item" data-ticker="${r.ticker}"><span class="result-ticker">${r.ticker}${r.market === "LSE" ? ` <span class="result-market">LSE</span>` : ""}</span><span class="result-name">${r.name}</span></div>`)
    .join("");
  el.searchResults.classList.remove("hidden");
}

el.searchResults.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".result-item");
  if (!item) return;
  el.searchInput.value = item.dataset.ticker;
  el.searchResults.classList.add("hidden");
  loadDossier(item.dataset.ticker);
});

el.searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = el.searchInput.value.trim();
  if (!q) return;
  el.searchResults.classList.add("hidden");
  loadDossier(q);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-form")) el.searchResults.classList.add("hidden");
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    el.searchInput.value = chip.dataset.ticker;
    loadDossier(chip.dataset.ticker);
  });
});

// --- Price input (valuation tab) ---
el.priceInput.addEventListener("input", () => {
  const val = parseFloat(el.priceInput.value);
  state.price = Number.isFinite(val) && val > 0 ? val : null;
  if (state.activeTab === "worth") setActiveTab("worth");
});

// --- CSV export (client-side only, no server round trip) ---
el.exportBtn.addEventListener("click", () => {
  if (!state.base) return;
  const rows = [
    ["Fiscal Year", ...state.base.years],
    ["Revenue", ...state.base.series.revenue],
    ["Net Income", ...state.base.series.netIncome],
    ["Operating Cash Flow", ...state.base.series.operatingCashFlow],
    ["Capital Expenditures", ...state.base.series.capex],
    ["Free Cash Flow", ...state.derived.freeCashFlow],
    ["Total Assets", ...state.base.series.assets],
    ["Total Liabilities", ...state.base.series.liabilities],
    ["Stockholders Equity", ...state.base.series.equity],
    ["Net Margin", ...state.derived.netMargin],
    ["ROE", ...state.derived.roe],
    ["Debt to Equity", ...state.derived.debtToEquity],
  ];
  const csv = rows.map((r) => r.map((v) => (v === null || v === undefined ? "" : v)).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.company.ticker}-dossier.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// --- Full-dossier PDF export (browser print-to-PDF; see css/print.css) ---
el.exportPdfBtn.addEventListener("click", () => window.print());

// --- Theme toggle ---
el.themeToggle.addEventListener("click", () => {
  const root = document.documentElement;
  const current = root.getAttribute("data-theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (_) { /* per-viewer convenience only */ }
});

try {
  const saved = localStorage.getItem("theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
} catch (_) { /* ignore */ }

// --- Boot ---
initGlossary();
showLanding();
initTour();

const initialTicker = new URL(window.location.href).searchParams.get("ticker");
if (initialTicker) {
  el.searchInput.value = initialTicker;
  loadDossier(initialTicker);
}
