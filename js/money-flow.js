// Orchestrates the "Money flow" tab: a time-sliced view of the whole
// business built from the financial graph (js/financial-graph.js), with
// four sub-screens (Business Map, Business Health, Market vs Business, plus
// a narrative event feed) sharing one time slider.
//
// SCOPE: quarterly resolution is only available for US/SEC companies
// (buildQuarterlySeries reads 10-Q filings, which UK Companies House
// doesn't have an equivalent of) — UK companies fall back to annual
// resolution here, clearly labeled, rather than silently only working for
// one market.
import { annualToPeriods, quarterlyToPeriods, buildGraphSeries, getNodeHistory } from "./financial-graph.js";
import { renderBusinessMap } from "./money-flow-map.js";
import { renderBusinessHealth } from "./business-health.js";
import { renderMarketVsBusiness } from "./market-vs-business.js";
import { detectNarrativeEvents, renderNarrative } from "./story-narrative.js";

const SCREENS = [
  { id: "map", label: "Business map", render: renderBusinessMap },
  { id: "health", label: "Business health", render: renderBusinessHealth },
  { id: "market", label: "Market vs business", render: renderMarketVsBusiness },
];

export function renderMoneyFlow(container, args) {
  const { company, base, derived, price, quarterly } = args;

  const usingQuarterly = Boolean(quarterly && quarterly.periods && quarterly.periods.length);
  const unified = usingQuarterly ? quarterlyToPeriods(quarterly) : annualToPeriods(base);
  const graphSeries = buildGraphSeries(unified);
  const events = detectNarrativeEvents(unified);

  const state = {
    index: unified.periods.length - 1,
    screen: "map",
  };

  container.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "money-flow-shell";
  shell.innerHTML = `
    <div class="money-flow-header">
      <p class="money-flow-note">
        ${usingQuarterly
          ? "Quarterly resolution, built from this company's own filed 10-Q/10-K figures — Q4 each year is derived as the fiscal year total minus Q1+Q2+Q3, since companies never file a standalone Q4 report."
          : "Annual resolution — quarterly filings aren't available for this company (UK Companies House files annual accounts only, or SEC 10-Q data wasn't found)."}
        Bucket granularity matches what's actually broken out in standardized filings (revenue, cost of revenue, SG&A, R&D, interest, tax, capex, debt/equity moves, dividends, buybacks) — not a line-item guess at things like "employees" or "marketing" spend, which aren't structured data anywhere free.
      </p>
      <div class="money-flow-tabs" role="tablist"></div>
    </div>
    <div class="money-flow-slider-row">
      <button class="money-flow-step" data-dir="-1" aria-label="Previous period">◀</button>
      <input type="range" class="money-flow-slider" min="0" max="${unified.periods.length - 1}" value="${state.index}" />
      <button class="money-flow-step" data-dir="1" aria-label="Next period">▶</button>
      <span class="money-flow-period-label"></span>
    </div>
    <div class="money-flow-screen"></div>
    <div class="money-flow-narrative"></div>
  `;
  container.append(shell);

  const tabsEl = shell.querySelector(".money-flow-tabs");
  const screenEl = shell.querySelector(".money-flow-screen");
  const narrativeEl = shell.querySelector(".money-flow-narrative");
  const sliderEl = shell.querySelector(".money-flow-slider");
  const periodLabelEl = shell.querySelector(".money-flow-period-label");

  for (const s of SCREENS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "money-flow-tab";
    btn.textContent = s.label;
    btn.setAttribute("role", "tab");
    btn.dataset.screen = s.id;
    btn.addEventListener("click", () => {
      state.screen = s.id;
      renderScreen();
    });
    tabsEl.append(btn);
  }

  function ctx() {
    return {
      unified,
      graphSeries,
      index: state.index,
      graph: graphSeries[state.index],
      period: unified.periods[state.index],
      getNodeHistory: (nodeId) => getNodeHistory(unified, nodeId),
      company,
      base,
      derived,
      price,
      usingQuarterly,
      onJumpToPeriod: (i) => {
        state.index = Math.max(0, Math.min(unified.periods.length - 1, i));
        sliderEl.value = String(state.index);
        renderScreen();
      },
    };
  }

  function renderScreen() {
    for (const btn of tabsEl.querySelectorAll(".money-flow-tab")) {
      const active = btn.dataset.screen === state.screen;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    }
    periodLabelEl.textContent = unified.periods[state.index].label;
    const screenDef = SCREENS.find((s) => s.id === state.screen);
    screenDef.render(screenEl, ctx());
    renderNarrative(narrativeEl, events, ctx());
  }

  sliderEl.addEventListener("input", () => {
    state.index = Number(sliderEl.value);
    renderScreen();
  });
  shell.querySelectorAll(".money-flow-step").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.index = Math.max(0, Math.min(unified.periods.length - 1, state.index + Number(btn.dataset.dir)));
      sliderEl.value = String(state.index);
      renderScreen();
    });
  });

  renderScreen();
}
