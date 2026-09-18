// "Business Health" screen (annual cadence only — deliberately ignores the
// unified/quarterly time-slider series, see the module doc for why). Two
// parts: a grid of trend cards (reusing charts.js's line-chart renderer) and
// a growth/returns "bubble" scatter, one bubble per year, sized by a
// user-selected metric. Chart.js's vendored UMD bundle ships its bubble
// controller, so we use `type: "bubble"` directly; a hand-rolled inline-SVG
// scatter is kept as a fallback in case that ever stops being true.

import { renderLineChart, formatMoneyShort, formatPercent } from "./charts.js";

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function isAllNull(arr) {
  return !arr || arr.length === 0 || arr.every((v) => v === null || v === undefined || Number.isNaN(v));
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// --- Trend cards -----------------------------------------------------------

function buildTrendCards(derived) {
  const cards = [];
  if (!isAllNull(derived.revenueGrowth)) {
    cards.push({ title: "Revenue growth", values: derived.revenueGrowth, kind: "percent", colorVar: "--accent" });
  }
  if (!isAllNull(derived.grossMargin)) {
    cards.push({ title: "Gross margin", values: derived.grossMargin, kind: "percent", colorVar: "--accent" });
  }
  if (!isAllNull(derived.fcfMargin)) {
    cards.push({ title: "Free cash flow margin", values: derived.fcfMargin, kind: "percent", colorVar: "--good" });
  }
  // ROIC is the preferred capital-returns metric; ROCE (pre-tax, no assumed
  // tax rate) stands in when a company's filings don't support a ROIC read.
  if (!isAllNull(derived.roic)) {
    cards.push({ title: "Return on invested capital (ROIC)", values: derived.roic, kind: "percent", colorVar: "--good" });
  } else if (!isAllNull(derived.roce)) {
    cards.push({ title: "Return on capital employed (ROCE)", values: derived.roce, kind: "percent", colorVar: "--good" });
  }
  if (!isAllNull(derived.debtToEquity)) {
    cards.push({ title: "Debt / equity", values: derived.debtToEquity, kind: "ratio", colorVar: "--watch" });
  }
  return cards;
}

function renderTrendCards(container, years, derived) {
  const cards = buildTrendCards(derived);
  if (!cards.length) {
    container.append(el(`<p class="data-gap-note">Not enough filed annual data to chart any business-health trends.</p>`));
    return;
  }
  const grid = el(`<div class="kpi-grid"></div>`);
  container.append(grid);
  for (const card of cards) {
    const node = el(`
      <div class="kpi-card">
        <h3>${card.title}</h3>
        <div class="kpi-chart-wrap"><canvas></canvas></div>
      </div>
    `);
    grid.append(node);
    const canvas = node.querySelector("canvas");
    requestAnimationFrame(() => renderLineChart(canvas, years, card.values, { kind: card.kind, colorVar: card.colorVar }));
  }
}

// --- Business Health Bubble -------------------------------------------------

const SIZE_METRICS = [
  { key: "revenue", label: "Revenue", get: (base, derived) => base.series.revenue },
  { key: "fcf", label: "Free cash flow", get: (base, derived) => derived.freeCashFlow },
  { key: "assets", label: "Assets", get: (base, derived) => base.series.assets },
];

// Zero-anchored, sqrt (area-proportional) radius scale: value 0 (or missing)
// maps to the floor radius, the largest |value| in the set maps to the
// ceiling — never a domain-relative scale, so a flat trend doesn't get
// visually exaggerated into big swings.
function makeRadiusScale(values, { minR = 6, maxR = 30 } = {}) {
  const max = values.reduce((m, v) => (v === null || v === undefined ? m : Math.max(m, Math.abs(v))), 0);
  if (max <= 0) return () => minR;
  return (v) => {
    if (v === null || v === undefined) return minR;
    return minR + Math.sqrt(Math.abs(v) / max) * (maxR - minR);
  };
}

function buildBubblePoints(years, xSeries, ySeries, sizeSeries) {
  const points = [];
  for (let i = 0; i < years.length; i++) {
    const x = xSeries[i];
    const y = ySeries[i];
    if (x === null || x === undefined || y === null || y === undefined) continue;
    const size = sizeSeries[i];
    points.push({ year: years[i], index: i, x, y, size: size === null || size === undefined ? null : size });
  }
  return points;
}

function renderBubbleChartJS(canvas, points, radiusOf, labels) {
  const accent = cssVar("--accent", "#1f5f4f");
  const flag = cssVar("--flag", "#b03a2e");
  const border = cssVar("--border", "#e4ddd2");
  const text = cssVar("--text", "#1c1a17");

  const history = points.slice(0, -1);
  const latest = points.slice(-1);
  const toPoint = (p) => ({ x: p.x, y: p.y, r: radiusOf(p.size) });

  return new Chart(canvas, {
    type: "bubble",
    data: {
      datasets: [
        {
          label: "Earlier years",
          data: history.map(toPoint),
          backgroundColor: accent + "55",
          borderColor: accent,
          borderWidth: 1,
        },
        {
          label: `Latest year (FY${latest[0]?.year ?? ""})`,
          data: latest.map(toPoint),
          backgroundColor: flag + "aa",
          borderColor: flag,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "top", labels: { boxWidth: 10, usePointStyle: true, color: text } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = (ctx.datasetIndex === 0 ? history : latest)[ctx.dataIndex];
              const sizeText = p.size === null ? "no data" : formatMoneyShort(p.size);
              return `FY${p.year}: growth ${formatPercent(p.x)}, ${labels.yShort} ${formatPercent(p.y)}, ${labels.sizeLabel} ${sizeText}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Revenue growth (YoY)", color: text },
          ticks: { callback: (v) => formatPercent(v), color: text },
          grid: { color: border },
        },
        y: {
          title: { display: true, text: labels.yShort, color: text },
          ticks: { callback: (v) => formatPercent(v), color: text },
          grid: { color: border },
        },
      },
    },
  });
}

// Fallback scatter for if the vendored bundle's bubble controller ever isn't
// available — plain inline SVG, positioned/scaled by hand, themed with the
// same CSS custom properties (via `style="...var(--x)..."`, so it repaints
// itself automatically on a light/dark toggle without any re-render).
function renderBubbleSVG(wrap, points, radiusOf, labels) {
  const width = 640, height = 320;
  const pad = { l: 52, r: 16, t: 16, b: 40 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(0, ...xs), xMax = Math.max(0, ...xs);
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
  const xPad = (xMax - xMin || 0.1) * 0.12;
  const yPad = (yMax - yMin || 0.1) * 0.12;
  const x0 = xMin - xPad, x1 = xMax + xPad, y0 = yMin - yPad, y1 = yMax + yPad;
  const sx = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (width - pad.l - pad.r);
  const sy = (v) => height - pad.b - ((v - y0) / (y1 - y0 || 1)) * (height - pad.t - pad.b);

  const zeroX = x0 <= 0 && x1 >= 0 ? sx(0) : null;
  const zeroY = y0 <= 0 && y1 >= 0 ? sy(0) : null;

  const circles = points.map((p, i) => {
    const isLatest = i === points.length - 1;
    const r = radiusOf(p.size);
    const sizeText = p.size === null ? "no data" : formatMoneyShort(p.size);
    const title = `FY${p.year}: growth ${formatPercent(p.x)}, ${labels.yShort} ${formatPercent(p.y)}, ${labels.sizeLabel} ${sizeText}`;
    return `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${r.toFixed(1)}"
      style="fill:var(${isLatest ? "--flag" : "--accent"});fill-opacity:${isLatest ? 0.7 : 0.35};stroke:var(${isLatest ? "--flag" : "--accent"});stroke-width:${isLatest ? 2 : 1}">
      <title>${title}</title>
    </circle>`;
  }).join("");

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img" aria-label="Revenue growth vs. ${labels.yShort}, one bubble per year">
      <line x1="${pad.l}" y1="${height - pad.b}" x2="${width - pad.r}" y2="${height - pad.b}" style="stroke:var(--border)" />
      <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${height - pad.b}" style="stroke:var(--border)" />
      ${zeroX !== null ? `<line x1="${zeroX.toFixed(1)}" y1="${pad.t}" x2="${zeroX.toFixed(1)}" y2="${height - pad.b}" style="stroke:var(--border)" stroke-dasharray="3,3" />` : ""}
      ${zeroY !== null ? `<line x1="${pad.l}" y1="${zeroY.toFixed(1)}" x2="${width - pad.r}" y2="${zeroY.toFixed(1)}" style="stroke:var(--border)" stroke-dasharray="3,3" />` : ""}
      <text x="${pad.l}" y="${height - 10}" style="fill:var(--text-muted);font-size:11px">Revenue growth (YoY) →</text>
      <text x="14" y="${pad.t + 10}" style="fill:var(--text-muted);font-size:11px" transform="rotate(-90 14 ${pad.t + 10})">${labels.yShort} →</text>
      ${circles}
    </svg>
  `;
  wrap.innerHTML = svg;
}

function bubbleYSeries(derived) {
  if (!isAllNull(derived.roic)) return { series: derived.roic, label: "Return on invested capital (ROIC)", short: "ROIC" };
  if (!isAllNull(derived.roce)) return { series: derived.roce, label: "Return on capital employed (ROCE)", short: "ROCE" };
  return null;
}

let currentBubbleChart = null;

function renderBubble(section, base, derived) {
  const y = bubbleYSeries(derived);
  if (!y || isAllNull(derived.revenueGrowth)) {
    section.append(el(`<p class="data-gap-note">Not enough filed data (revenue growth and either ROIC or ROCE) to plot the Business Health Bubble.</p>`));
    return;
  }

  const card = el(`
    <div class="kpi-card bh-bubble-card">
      <div class="bh-bubble-head">
        <h3>Business Health Bubble</h3>
        <label class="bh-select-label">Bubble size
          <select class="bh-size-select"></select>
        </label>
      </div>
      <p class="kpi-headline">One bubble per fiscal year: revenue growth (x) vs. ${y.label} (y). The latest year is highlighted so you can see where the company sits today, and its trajectory through prior years.</p>
      <div class="bh-bubble-wrap"><canvas></canvas></div>
    </div>
  `);
  section.append(card);

  const select = card.querySelector(".bh-size-select");
  for (const m of SIZE_METRICS) select.append(el(`<option value="${m.key}">${m.label}</option>`));
  select.value = "revenue";

  const wrap = card.querySelector(".bh-bubble-wrap");
  const canvas = wrap.querySelector("canvas");

  function draw() {
    const metric = SIZE_METRICS.find((m) => m.key === select.value) || SIZE_METRICS[0];
    const sizeSeries = metric.get(base, derived) || [];
    const points = buildBubblePoints(base.years, derived.revenueGrowth, y.series, sizeSeries);

    if (currentBubbleChart) {
      try { currentBubbleChart.destroy(); } catch { /* already gone */ }
      currentBubbleChart = null;
    }

    if (!points.length) {
      wrap.innerHTML = `<p class="data-gap-note">No year has both revenue growth and ${y.short} on file at the same time.</p>`;
      return;
    }

    const radiusOf = makeRadiusScale(points.map((p) => p.size));
    const labels = { yShort: y.short, sizeLabel: metric.label };

    if (!wrap.querySelector("canvas")) {
      wrap.innerHTML = "";
      wrap.append(canvas);
    }

    try {
      if (typeof window.Chart !== "function") throw new Error("Chart.js not loaded");
      currentBubbleChart = renderBubbleChartJS(canvas, points, radiusOf, labels);
    } catch {
      renderBubbleSVG(wrap, points, radiusOf, labels);
    }
  }

  select.addEventListener("change", draw);
  requestAnimationFrame(draw);
}

export function renderBusinessHealth(container, ctx) {
  container.innerHTML = "";
  if (currentBubbleChart) {
    try { currentBubbleChart.destroy(); } catch { /* already gone */ }
    currentBubbleChart = null;
  }

  const { base, derived, company } = ctx || {};
  if (!base || !derived || !base.years || !base.years.length) {
    container.append(el(`<p class="data-gap-note">No annual data available to assess business health.</p>`));
    return;
  }

  container.append(el(`
    <p class="data-gap-note">
      Business Health looks at ${company?.name || "this company"}'s trajectory year over year: growth, margins and capital
      returns from its own annual (10-K) filings. It intentionally leaves out customer count, units sold and market
      share — there's no standardized XBRL tag for those across arbitrary filers, so showing them here would mean
      guessing or hand-curating per company, which this project avoids (see the README's Scope section).
    </p>
  `));

  const trendSection = el(`<div class="bh-section"></div>`);
  container.append(trendSection);
  renderTrendCards(trendSection, base.years, derived);

  const bubbleSection = el(`<div class="bh-section"></div>`);
  container.append(bubbleSection);
  renderBubble(bubbleSection, base, derived);
}
