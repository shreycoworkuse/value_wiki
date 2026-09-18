// The "Money flow" tab: one unified, timeline-driven screen showing the
// whole business over time — built entirely from data already fetched for
// this dossier (financial-graph.js's balance-sheet nodes, plus a free
// historical price series from Stooq for context). Nothing here is
// editable or interactive beyond scrubbing time and picking what to plot;
// every number traces back to a real filed figure.
//
// Layout: left = balance-sheet "reservoir" bars (click one to plot it
// center), center = that item's full history, right = a vertical
// quarter-by-quarter timeline (with a real, rule-derived one-liner per
// period) over a price-vs-book-value chart. One scrub position drives all
// four panels.
import { annualToPeriods, quarterlyToPeriods, buildGraphSeries, getNodeHistory } from "./financial-graph.js";
import { narrativeLineFor } from "./narrative-line.js";
import { fetchStockPriceSeries } from "./stock-price.js";
import { formatMoneyShort, formatPercent, formatRatio } from "./charts.js";
import { PROXY_URL } from "./sec.js";

const ASSET_CATEGORIES = new Set(["asset-stock"]);
const LIABEQ_CATEGORIES = new Set(["liability-stock", "equity-stock"]);

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function div(a, b) {
  if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
  return a / b;
}

function lastNonNull(arr, upTo) {
  for (let i = Math.min(upTo, arr.length - 1); i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return { value: arr[i], index: i };
  }
  return null;
}

// Collects the union of stock-layer nodes across every period, in a stable
// left-to-right/top-to-bottom order — a company's balance-sheet composition
// barely changes period to period, but this handles the rare cases (a new
// goodwill balance after an acquisition, etc.) without the bar list
// reshuffling or nodes popping in/out of existence.
function collectStockNodeRegistry(graphSeries) {
  const assets = new Map();
  const liabEq = new Map();
  for (const g of graphSeries) {
    for (const n of g.nodes) {
      if (ASSET_CATEGORIES.has(n.category) && !assets.has(n.id)) assets.set(n.id, n.label);
      if (LIABEQ_CATEGORIES.has(n.category) && !liabEq.has(n.id)) liabEq.set(n.id, n.label);
    }
  }
  return { assets, liabEq };
}

export function renderMoneyFlow(container, args) {
  const { company, base, derived, quarterly } = args;

  const usingQuarterly = Boolean(quarterly && quarterly.periods && quarterly.periods.length);
  const unified = usingQuarterly ? quarterlyToPeriods(quarterly) : annualToPeriods(base);
  const graphSeries = buildGraphSeries(unified);
  const registry = collectStockNodeRegistry(graphSeries);

  const state = {
    index: unified.periods.length - 1,
    selectedKey: "assets",
    selectedLabel: "Total assets",
    prices: null, // filled in async once Stooq responds
  };

  container.innerHTML = "";
  const shell = el(`
    <div class="mf-screen">
      <div class="mf-note">
        ${usingQuarterly
          ? "Quarterly resolution, built from this company's own filed 10-Q/10-K figures — Q4 each year is derived as the fiscal year total minus Q1+Q2+Q3."
          : "Annual resolution — quarterly filings aren't available for this company (UK Companies House files annual accounts only)."}
      </div>
      <div class="mf-grid">
        <div class="mf-left">
          <h3>Where the capital sits</h3>
          <p class="mf-hint">Select a bar to plot it center. Length ∝ largest balance shown.</p>
          <div class="mf-bars"></div>
        </div>
        <div class="mf-center">
          <div class="mf-center-head">
            <div>
              <h3 class="mf-center-title"></h3>
              <div class="mf-center-sub"></div>
            </div>
            <div class="mf-center-value"></div>
          </div>
          <div class="mf-center-chart-wrap"><canvas class="mf-center-canvas"></canvas></div>
        </div>
        <div class="mf-right">
          <div class="mf-timeline">
            <div class="mf-timeline-head">
              <span class="mf-timeline-range"></span>
            </div>
            <div class="mf-timeline-scroll"></div>
          </div>
          <div class="mf-price">
            <div class="mf-price-head">
              <h3>Price vs. book value / share</h3>
              <span class="mf-price-range"></span>
            </div>
            <div class="mf-price-legend"></div>
            <div class="mf-price-chart-wrap">
              <canvas class="mf-price-canvas"></canvas>
              <div class="mf-price-marker"></div>
            </div>
            <div class="mf-price-foot">
              <span class="mf-price-pb"></span>
              <span class="mf-price-progress"></span>
            </div>
            <div class="mf-scrub-label">
              <span>Timeline scrubber</span>
              <span class="mf-scrub-badge"></span>
            </div>
            <div class="mf-scrub-row">
              <button type="button" class="mf-scrub-step" data-dir="-1" aria-label="Previous period">◀ Prev</button>
              <input type="range" class="mf-scrub-slider" min="0" max="${unified.periods.length - 1}" value="${state.index}" />
              <button type="button" class="mf-scrub-step" data-dir="1" aria-label="Next period">Next ▶</button>
              <button type="button" class="mf-scrub-today">Today</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
  container.append(shell);

  const barsHost = shell.querySelector(".mf-bars");
  const centerTitle = shell.querySelector(".mf-center-title");
  const centerSub = shell.querySelector(".mf-center-sub");
  const centerValue = shell.querySelector(".mf-center-value");
  const centerCanvas = shell.querySelector(".mf-center-canvas");
  const timelineScroll = shell.querySelector(".mf-timeline-scroll");
  const timelineRange = shell.querySelector(".mf-timeline-range");
  const priceRange = shell.querySelector(".mf-price-range");
  const priceLegend = shell.querySelector(".mf-price-legend");
  const priceChartWrap = shell.querySelector(".mf-price-chart-wrap");
  const priceCanvas = shell.querySelector(".mf-price-canvas");
  const priceMarker = shell.querySelector(".mf-price-marker");
  const pricePb = shell.querySelector(".mf-price-pb");
  const priceProgress = shell.querySelector(".mf-price-progress");
  const scrubBadge = shell.querySelector(".mf-scrub-badge");
  const scrubSlider = shell.querySelector(".mf-scrub-slider");

  const rangeLabel = unified.periods.length
    ? `${unified.periods[0].label} – ${unified.periods[unified.periods.length - 1].label}`
    : "";
  timelineRange.textContent = rangeLabel;
  priceRange.textContent = rangeLabel;

  // --- Left panel: balance-sheet bars, built once, updated in place -------
  function buildBarRow(key, label, isTotal) {
    const row = el(`
      <button type="button" class="mf-bar-row${isTotal ? " mf-bar-total" : ""}" data-key="${key}">
        <div class="mf-bar-labels"><span class="mf-bar-label">${label}</span><span class="mf-bar-value"></span></div>
        <div class="mf-bar-track"><div class="mf-bar-fill"></div></div>
      </button>
    `);
    barsHost.append(row);
    return row;
  }

  const barRows = [];
  barRows.push({ key: "assets", label: "Total assets", row: buildBarRow("assets", "Total assets", true) });
  for (const [id, label] of registry.assets) barRows.push({ key: id, label, row: buildBarRow(id, label, false) });
  barRows.push({ key: "liabilities", label: "Total liabilities", row: buildBarRow("liabilities", "Total liabilities", true) });
  for (const [id, label] of registry.liabEq) barRows.push({ key: id, label, row: buildBarRow(id, label, false) });
  barRows.push({ key: "equity", label: "Net book capital (equity)", row: buildBarRow("equity", "Net book capital (equity)", true) });

  barsHost.addEventListener("click", (e) => {
    const row = e.target.closest(".mf-bar-row");
    if (!row) return;
    const entry = barRows.find((b) => b.key === row.dataset.key);
    if (!entry) return;
    state.selectedKey = entry.key;
    state.selectedLabel = entry.label;
    renderAll();
  });

  function updateBars(i) {
    const totalAssets = Math.abs(unified.series.assets?.[i] ?? 0);
    const totalLiabEq = Math.abs(unified.series.liabilities?.[i] ?? 0) + Math.abs(unified.series.equity?.[i] ?? 0);
    const maxScale = Math.max(totalAssets, totalLiabEq, 1);
    for (const { key, row } of barRows) {
      const val = unified.series[key]?.[i];
      const fill = row.querySelector(".mf-bar-fill");
      const valueEl = row.querySelector(".mf-bar-value");
      row.classList.toggle("active", key === state.selectedKey);
      if (val === null || val === undefined) {
        fill.style.width = "0%";
        valueEl.textContent = "—";
        row.classList.add("mf-bar-empty");
      } else {
        fill.style.width = `${Math.min(100, (Math.abs(val) / maxScale) * 100)}%`;
        valueEl.textContent = formatMoneyShort(val);
        row.classList.remove("mf-bar-empty");
      }
    }
  }

  // --- Center panel: selected item's full history --------------------------
  let centerChart = null;
  function renderCenter(i) {
    const history = getNodeHistory(unified, state.selectedKey);
    centerTitle.textContent = state.selectedLabel;
    const latest = lastNonNull(unified.series[state.selectedKey] || [], i);
    centerValue.textContent = latest ? formatMoneyShort(latest.value) : "—";
    const g = history?.growth?.[i];
    centerSub.textContent = g !== null && g !== undefined ? `${g >= 0 ? "↑" : "↓"} ${formatPercent(Math.abs(g))} vs. prior period` : "";

    const labels = unified.periods.map((p) => p.label);
    const values = (unified.series[state.selectedKey] || []).slice();
    const text = cssVar("--text", "#1c1a17");
    const border = cssVar("--border", "#e4ddd2");
    const accent = cssVar("--accent", "#1f5f4f");

    const pointRadius = values.map((_, idx) => (idx === i ? 6 : 0));
    const pointBg = values.map((_, idx) => (idx === i ? cssVar("--flag", "#b03a2e") : accent));

    if (!centerChart) {
      centerChart = new Chart(centerCanvas, {
        type: "line",
        data: {
          labels,
          datasets: [{
            data: values,
            borderColor: accent,
            backgroundColor: accent + "18",
            fill: true,
            tension: 0.2,
            spanGaps: false,
            pointRadius,
            pointBackgroundColor: pointBg,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => formatMoneyShort(ctx.parsed.y) } },
          },
          scales: {
            x: { ticks: { color: text, maxRotation: 0, autoSkip: true }, grid: { display: false } },
            y: { ticks: { color: text, callback: (v) => formatMoneyShort(v) }, grid: { color: border } },
          },
        },
      });
    } else {
      centerChart.data.labels = labels;
      centerChart.data.datasets[0].data = values;
      centerChart.data.datasets[0].pointRadius = pointRadius;
      centerChart.data.datasets[0].pointBackgroundColor = pointBg;
      centerChart.update();
    }
  }

  // --- Right-top: vertical timeline, built once ----------------------------
  const timelineRows = unified.periods.map((period, i) => {
    const row = el(`
      <button type="button" class="mf-timeline-row" data-index="${i}">
        <span class="mf-timeline-dot"></span>
        <span class="mf-timeline-text">
          <span class="mf-timeline-period">${period.label}</span>
          <span class="mf-timeline-line">${narrativeLineFor(unified, i)}</span>
        </span>
      </button>
    `);
    timelineScroll.append(row);
    return row;
  });

  timelineScroll.addEventListener("click", (e) => {
    const row = e.target.closest(".mf-timeline-row");
    if (!row) return;
    setIndex(Number(row.dataset.index));
  });

  function updateTimeline(i) {
    timelineRows.forEach((row, idx) => row.classList.toggle("current", idx === i));
    const current = timelineRows[i];
    if (!current) return;
    // Scrolls only this internal list, never the page — scrollIntoView()
    // walks every scrollable ancestor (including the page itself), which
    // is exactly the "page jumps around while scrubbing" bug this avoids.
    const relativeTop = current.getBoundingClientRect().top - timelineScroll.getBoundingClientRect().top + timelineScroll.scrollTop;
    const target = relativeTop - timelineScroll.clientHeight / 2 + current.clientHeight / 2;
    timelineScroll.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }

  // --- Right-bottom: price vs. book value / share --------------------------
  let priceChart = null;
  function bookValuePerShareSeries() {
    const equity = unified.series.equity || [];
    const shares = unified.series.dilutedShares || [];
    return unified.periods.map((_, idx) => div(equity[idx], shares[idx]));
  }
  const bvpsSeries = bookValuePerShareSeries();

  function renderPrice(i) {
    const labels = unified.periods.map((p) => p.label);
    const prices = state.prices;
    const good = cssVar("--good", "#1f7a4c");
    const goodSoft = cssVar("--good-soft", "#e3f4e9");
    const textMuted = cssVar("--text-muted", "#5c5650");
    const text = cssVar("--text", "#1c1a17");
    const border = cssVar("--border", "#e4ddd2");

    const datasets = [];
    if (prices) {
      datasets.push({
        label: "Price travelled",
        data: prices.map((v, idx) => (idx <= i ? v : null)),
        borderColor: good,
        backgroundColor: goodSoft,
        borderWidth: 2.5,
        pointRadius: 0,
        spanGaps: false,
        fill: false,
      });
      datasets.push({
        label: "Price ahead",
        data: prices.map((v, idx) => (idx >= i ? v : null)),
        borderColor: good + "55",
        borderDash: [4, 3],
        pointRadius: 0,
        spanGaps: false,
        fill: false,
      });
    }
    datasets.push({
      label: "Book value / share",
      data: bvpsSeries,
      borderColor: textMuted,
      borderDash: [3, 3],
      pointRadius: 0,
      spanGaps: false,
      fill: false,
    });

    const chartOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y === null ? "—" : "$" + ctx.parsed.y.toFixed(2)}` } },
      },
      scales: {
        x: { ticks: { color: text, maxRotation: 0, autoSkip: true, font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { color: text, font: { size: 9 }, callback: (v) => "$" + v }, grid: { color: border } },
      },
    };

    if (!priceChart) {
      priceChart = new Chart(priceCanvas, { type: "line", data: { labels, datasets }, options: chartOpts });
    } else {
      priceChart.data.labels = labels;
      priceChart.data.datasets = datasets;
      priceChart.update();
    }

    // Vertical "you are here" marker, positioned at the current index's
    // real pixel X — Chart.js's free bundle has no annotation plugin, so
    // this is a plain absolutely-positioned div read off the chart's own
    // scale after each render/resize.
    const xPixel = priceChart.scales?.x?.getPixelForValue(i);
    if (Number.isFinite(xPixel)) {
      priceMarker.style.left = `${xPixel}px`;
      priceMarker.style.display = "block";
    } else {
      priceMarker.style.display = "none";
    }

    const priceNow = prices ? lastNonNull(prices, i) : null;
    const bvpsNow = lastNonNull(bvpsSeries, i);
    const pb = priceNow && bvpsNow ? div(priceNow.value, bvpsNow.value) : null;

    priceLegend.innerHTML = `
      <span class="mf-legend-item"><span class="mf-legend-dot" style="background:${good}"></span>Stock: ${priceNow ? "$" + priceNow.value.toFixed(2) : "unavailable"}</span>
      <span class="mf-legend-item"><span class="mf-legend-dot mf-legend-dash"></span>Book val: ${bvpsNow ? "$" + bvpsNow.value.toFixed(2) : "—"}</span>
    `;
    pricePb.textContent = pb !== null ? `P/B ${formatRatio(pb)}` : "";
    priceProgress.textContent = `Period ${i + 1} of ${unified.periods.length}`;
    scrubBadge.textContent = `${unified.periods[i].label}${priceNow ? " · $" + priceNow.value.toFixed(2) : ""}`;
  }

  // --- Wiring ---------------------------------------------------------------
  function renderAll() {
    updateBars(state.index);
    renderCenter(state.index);
    updateTimeline(state.index);
    renderPrice(state.index);
  }

  function setIndex(i) {
    state.index = Math.max(0, Math.min(unified.periods.length - 1, i));
    scrubSlider.value = String(state.index);
    renderAll();
  }

  scrubSlider.addEventListener("input", () => setIndex(Number(scrubSlider.value)));
  shell.querySelectorAll(".mf-scrub-step").forEach((btn) => {
    btn.addEventListener("click", () => setIndex(state.index + Number(btn.dataset.dir)));
  });
  shell.querySelector(".mf-scrub-today").addEventListener("click", () => setIndex(unified.periods.length - 1));

  // The screen's own height is fixed by CSS (viewport-relative, so the tab
  // never requires scrolling the page itself — only the bounded panels
  // inside it scroll). This just keeps the "you are here" marker aligned
  // to the price chart's actual pixel position after a resize.
  function repositionMarker() {
    const xPixel = priceChart?.scales?.x?.getPixelForValue(state.index);
    if (Number.isFinite(xPixel)) priceMarker.style.left = `${xPixel}px`;
  }
  window.addEventListener("resize", repositionMarker);

  renderAll();

  // Historical prices load async (a network round trip through the Worker) —
  // the rest of the screen is fully usable before/without it, and a failure
  // here never blocks anything else.
  fetchStockPriceSeries(company.ticker, company.market, unified.periods, PROXY_URL).then((prices) => {
    state.prices = prices;
    renderPrice(state.index);
  });
}
