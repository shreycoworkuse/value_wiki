import { searchTickers, findTickerExact, fetchCompanyFacts, filingIndexUrl } from "./sec.js";
import { buildAnnualSeries, computeDerived } from "./kpis.js";
import { detectRedFlags } from "./redflags.js";
import { buildChecklist } from "./verdict.js";
import { initGlossary } from "./glossary.js";
import { renderCoverStory, renderKpiGrid, renderFollowTheMoney, renderVerdict, renderValuation, renderSources } from "./ui.js";

const TABS = [
  { id: "cover", label: "Cover story", render: renderCoverStory },
  { id: "kpis", label: "KPI chapters", render: renderKpiGrid },
  { id: "money", label: "Follow the money", render: renderFollowTheMoney },
  { id: "verdict", label: "Verdict", render: renderVerdict },
  { id: "worth", label: "What is it worth", render: renderValuation },
  { id: "sources", label: "Sources", render: renderSources },
];

const state = {
  company: null,
  base: null,
  derived: null,
  redFlags: null,
  checklist: null,
  price: null,
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
  setStatus(`<div class="spinner"></div><div>Looking up ${tickerQuery.toUpperCase()} in SEC EDGAR's ticker index…</div>`);

  try {
    const match = await findTickerExact(tickerQuery);
    if (!match) {
      setStatus(`Couldn't find a US-listed ticker matching "${tickerQuery}". This tool only covers companies that file with the U.S. SEC.`, true);
      return;
    }

    const progressLines = [];
    const onProgress = (msg) => {
      progressLines.push(msg);
      setStatus(`<div class="spinner"></div><div>${msg}</div><div class="progress-log">${progressLines.map((l) => `<div>✓ ${l}</div>`).join("")}</div>`);
    };

    const facts = await fetchCompanyFacts(match.cik, onProgress);
    onProgress("Computing KPIs, red flags and the owner's checklist, locally in your browser…");

    const base = buildAnnualSeries(facts);
    if (!base.years.length) {
      setStatus(`SEC has a record for ${match.name}, but no usable annual (10-K) XBRL figures were found to build a dossier from.`, true);
      return;
    }
    const derived = computeDerived(base);
    const redFlags = detectRedFlags(base, derived);
    const checklist = buildChecklist(base, derived);

    state.company = { name: match.name, ticker: match.ticker, cik: match.cik };
    state.base = base;
    state.derived = derived;
    state.redFlags = redFlags;
    state.checklist = checklist;
    state.price = null;
    el.priceInput.value = "";

    el.name.textContent = `${match.name} (${match.ticker})`;
    el.meta.innerHTML = `<span>CIK ${match.cik}</span><span>FY${base.years[0]}–FY${base.years[base.years.length - 1]}</span><span><a href="${filingIndexUrl(match.cik)}" target="_blank" rel="noopener">View filings on SEC EDGAR ↗</a></span>`;

    setUrlTicker(match.ticker);
    el.status.classList.add("hidden");
    el.content.classList.remove("hidden");
    buildTabs();
    setActiveTab(state.activeTab);
  } catch (err) {
    console.error(err);
    setStatus(`Something went wrong fetching live data from SEC EDGAR: ${err.message || err}. This can happen if SEC's public API is rate-limiting or temporarily unreachable — try again in a moment.`, true);
  }
}

function buildTabs() {
  el.tabs.innerHTML = "";
  el.panels.innerHTML = "";
  for (const tab of TABS) {
    const btn = document.createElement("button");
    btn.textContent = tab.label;
    btn.dataset.tab = tab.id;
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => setActiveTab(tab.id));
    el.tabs.append(btn);

    const panel = document.createElement("div");
    panel.className = "tab-panel hidden";
    panel.dataset.panel = tab.id;
    el.panels.append(panel);
  }
}

function setActiveTab(tabId) {
  state.activeTab = tabId;
  for (const btn of el.tabs.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  }
  for (const panel of el.panels.querySelectorAll(".tab-panel")) {
    panel.classList.toggle("hidden", panel.dataset.panel !== tabId);
  }
  const tabDef = TABS.find((t) => t.id === tabId);
  const panel = el.panels.querySelector(`[data-panel="${tabId}"]`);
  tabDef.render(panel, { company: state.company, base: state.base, derived: state.derived, redFlags: state.redFlags, checklist: state.checklist, price: state.price });
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
      const results = await searchTickers(q);
      renderSearchResults(results);
    } catch (e) {
      console.error(e);
    }
  }, 180);
});

function renderSearchResults(results) {
  if (!results.length) {
    el.searchResults.classList.add("hidden");
    return;
  }
  el.searchResults.innerHTML = results
    .map((r) => `<div class="result-item" data-ticker="${r.ticker}"><span class="result-ticker">${r.ticker}</span><span class="result-name">${r.name}</span></div>`)
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

const initialTicker = new URL(window.location.href).searchParams.get("ticker");
if (initialTicker) {
  el.searchInput.value = initialTicker;
  loadDossier(initialTicker);
}
