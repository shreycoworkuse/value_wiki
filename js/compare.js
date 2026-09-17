// Manual "Compare" tab.
//
// The source PRD calls for an automatic "Competitors" tab with peer
// discovery and rankings across up to 8 companies. There is no free,
// practical way to do that honestly here: SEC's per-company
// submissions.json does carry a SIC industry code, but (a) fetching it
// per-company hits the same CORS wall company-facts does, requiring another
// proxy allow-list change, and (b) even with a target's own SIC code,
// finding OTHER companies sharing it would require a bulk SIC index SEC
// doesn't expose for free in one small file. Auto-discovery/ranking would
// mean either fabricating a peer set or building real infrastructure this
// project deliberately avoids.
//
// So this is a manual, one-peer-at-a-time compare: the visitor types a
// second ticker themselves, we fetch it live through the same pipeline as
// the primary dossier, and we show it side by side. Same "no accounts, no
// server-side storage, live from SEC EDGAR" principle as everything else.

import { renderOverlayChart, formatMoneyShort, formatPercent } from "./charts.js";
import { lastValid } from "./kpis.js";

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

// Per-container state (the tab panel DOM node is created once and reused
// across tab switches, so this survives navigating away and back without
// re-fetching or losing what the user typed).
const stateByContainer = new WeakMap();

function getState(container) {
  let s = stateByContainer.get(container);
  if (!s) {
    s = { ticker: "", status: "idle", error: null, companyB: null };
    stateByContainer.set(container, s);
  }
  return s;
}

// Small, self-contained stylesheet (injected once) so this file doesn't
// require touching the shared css/style.css. Reuses the app's existing CSS
// custom properties (with fallbacks) so it still themes correctly.
function ensureStyles() {
  if (document.getElementById("compare-tab-styles")) return;
  const style = document.createElement("style");
  style.id = "compare-tab-styles";
  style.textContent = `
    .compare-form { display: flex; gap: 8px; margin: 14px 0 8px; flex-wrap: wrap; }
    .compare-form input {
      flex: 1; min-width: 140px; padding: 10px 14px; border-radius: var(--radius, 8px);
      border: 1px solid var(--border, #ccc); background: var(--bg, #fff); color: var(--text, #111); font-size: 0.95rem;
    }
    .compare-form button {
      padding: 10px 16px; border-radius: var(--radius, 8px); border: none;
      background: var(--accent, #1f5f4f); color: #fff; font-weight: 600; cursor: pointer;
    }
    .compare-status { min-height: 1.4em; margin-top: 6px; font-size: 0.88rem; }
    .compare-status.error { color: var(--flag, #b03a2e); }
    .cmp-spinner {
      display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border, #ccc);
      border-top-color: var(--accent, #1f5f4f); border-radius: 50%; animation: cmp-spin 0.8s linear infinite;
      margin-right: 6px; vertical-align: -2px;
    }
    @keyframes cmp-spin { to { transform: rotate(360deg); } }
    .cmp-year { font-size: 0.78rem; color: var(--text-muted, #777); }
    .cmp-align-note { font-size: 0.88rem; }
  `;
  document.head.append(style);
}

const METRICS = [
  { label: "Revenue", get: (base, derived) => base.series.revenue, fmt: formatMoneyShort },
  { label: "Net margin", get: (base, derived) => derived.netMargin, fmt: formatPercent },
  { label: "Return on equity (ROE)", get: (base, derived) => derived.roe, fmt: formatPercent },
  { label: "Debt-to-equity", get: (base, derived) => derived.debtToEquity, fmt: formatPercent },
  { label: "Free cash flow margin", get: (base, derived) => derived.fcfMargin, fmt: formatPercent },
];

function fmtLastWithYear(arr, years, fmt) {
  const last = lastValid(arr);
  if (!last) return "—";
  return `${fmt(last.value)} <span class="cmp-year">(FY${years[last.index]})</span>`;
}

// Maps two independent (years, values) series onto one shared, sorted year
// axis so a two-line overlay chart can plot them together even when the
// companies' filing histories don't line up. Years only one side has are
// left as real gaps (spanGaps: false in charts.js), never interpolated.
function alignToUnionYears(yearsA, valuesA, yearsB, valuesB) {
  const union = [...new Set([...yearsA, ...yearsB])].sort();
  const mapA = new Map(yearsA.map((y, i) => [y, valuesA[i]]));
  const mapB = new Map(yearsB.map((y, i) => [y, valuesB[i]]));
  return {
    years: union,
    a: union.map((y) => (mapA.has(y) ? mapA.get(y) : null)),
    b: union.map((y) => (mapB.has(y) ? mapB.get(y) : null)),
  };
}

function yearSpan(years) {
  if (!years.length) return "—";
  return `FY${years[0]}–FY${years[years.length - 1]} (${years.length} yr${years.length === 1 ? "" : "s"})`;
}

// renderCompare(container, {company, base, derived, checklist}, fetchCompanyState)
//
// `company`/`base`/`derived`/`checklist` are company A (the current
// dossier, already computed by the orchestrator). `fetchCompanyState` is an
// async (ticker: string) => Promise<{company, base, derived, checklist}>
// that the orchestrator wires up, reusing its existing fetch pipeline — see
// the integration notes handed back alongside this file.
export function renderCompare(container, { company, base, derived, checklist }, fetchCompanyState) {
  ensureStyles();
  const state = getState(container);

  container.innerHTML = "";
  const wrap = el(`
    <div class="compare-tab">
      <div class="kpi-card">
        <h3>Compare ${company.name} (${company.ticker}) against another company</h3>
        <div class="kpi-headline">
          There's no free, reliable way to auto-discover "competitors" from SEC's public data alone (see the code comments in this file for why), so this is a manual, one-at-a-time compare — type any US-listed ticker to size it up against ${company.ticker}.
        </div>
        <form class="compare-form">
          <input type="text" placeholder="e.g. MSFT" maxlength="10" autocomplete="off" aria-label="Second ticker to compare" />
          <button type="submit">Compare</button>
        </form>
        <div class="compare-status"></div>
      </div>
      <div class="compare-results hidden"></div>
    </div>
  `);
  container.append(wrap);

  const form = wrap.querySelector(".compare-form");
  const input = wrap.querySelector("input");
  const statusEl = wrap.querySelector(".compare-status");
  const resultsEl = wrap.querySelector(".compare-results");

  input.value = state.ticker;

  function setStatus(html, isError = false) {
    statusEl.innerHTML = html;
    statusEl.classList.toggle("error", isError);
  }

  function renderResults() {
    const b = state.companyB;
    if (!b) {
      resultsEl.classList.add("hidden");
      resultsEl.innerHTML = "";
      return;
    }
    resultsEl.classList.remove("hidden");
    resultsEl.innerHTML = "";

    const aSpan = yearSpan(base.years);
    const bSpan = yearSpan(b.base.years);
    const misaligned = base.years.length !== b.base.years.length
      || base.years[0] !== b.base.years[0]
      || base.years[base.years.length - 1] !== b.base.years[b.base.years.length - 1];

    resultsEl.append(el(`
      <div>
        <div class="kpi-card cmp-align-note">
          <strong>${company.ticker}</strong>: ${aSpan} on file with the SEC. <strong>${b.company.ticker}</strong>: ${bSpan} on file with the SEC.
          ${misaligned ? `<div class="data-gap-note">Filing histories don't fully line up — the chart and table below show whatever each company has actually reported, with real gaps (not filled-in guesses) where only one of them has data.</div>` : ""}
        </div>

        <div class="kpi-card" style="margin-top:16px;">
          <h3>Revenue, side by side</h3>
          <div class="kpi-chart-wrap"><canvas></canvas></div>
        </div>

        <div class="kpi-card" style="margin-top:16px;">
          <h3>Key metrics (most recent reported year for each)</h3>
          <div style="overflow-x:auto;">
            <table class="money-table">
              <thead><tr><th>Metric</th><th>${company.ticker}</th><th>${b.company.ticker}</th></tr></thead>
              <tbody>
                ${METRICS.map((m) => `
                  <tr>
                    <td>${m.label}</td>
                    <td>${fmtLastWithYear(m.get(base, derived), base.years, m.fmt)}</td>
                    <td>${fmtLastWithYear(m.get(b.base, b.derived), b.base.years, m.fmt)}</td>
                  </tr>
                `).join("")}
                <tr>
                  <td>Owner's checklist score</td>
                  <td>${checklist.total}/${checklist.max}</td>
                  <td>${b.checklist.total}/${b.checklist.max}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="disclaimer-box">
            Same mechanical, no-opinion checklist as the Verdict tab, run separately on each company's own filings. Not a recommendation to buy, hold or sell either one — a starting point for research, not a ranking.
          </div>
        </div>
      </div>
    `));

    const canvas = resultsEl.querySelector("canvas");
    const { years, a: revA, b: revB } = alignToUnionYears(base.years, base.series.revenue, b.base.years, b.base.series.revenue);
    requestAnimationFrame(() => renderOverlayChart(
      canvas,
      years,
      { label: `${company.ticker} revenue`, values: revA },
      { label: `${b.company.ticker} revenue`, values: revB },
      { kindA: "currency", kindB: "currency" },
    ));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ticker = input.value.trim().toUpperCase();
    if (!ticker) return;
    if (ticker === company.ticker.toUpperCase()) {
      setStatus(`Pick a different ticker than ${company.ticker} to compare against.`, true);
      return;
    }

    state.ticker = ticker;
    state.status = "loading";
    state.error = null;
    resultsEl.classList.add("hidden");
    setStatus(`<span class="cmp-spinner"></span>Fetching live SEC data for ${ticker}…`);

    try {
      const result = await fetchCompanyState(ticker);
      state.companyB = result;
      state.status = "done";
      setStatus("");
      renderResults();
    } catch (err) {
      console.error(err);
      state.companyB = null;
      state.status = "error";
      state.error = err;
      setStatus(`Couldn't load ${ticker}: ${(err && err.message) || err}`, true);
    }
  });

  // Re-render whatever we already have (no re-fetch) when this tab is
  // re-activated after switching away.
  if (state.companyB) {
    setStatus("");
    renderResults();
  } else if (state.status === "error" && state.error) {
    setStatus(`Couldn't load ${state.ticker}: ${state.error.message || state.error}`, true);
  }
}
