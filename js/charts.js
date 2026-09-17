// Thin wrapper around the vendored Chart.js (loaded globally, no CDN).
// Missing years are left as real gaps (Chart.js `spanGaps: false`), never
// interpolated, per the "don't fabricate data" principle.

const chartInstances = new Map();

function formatByKind(v, kind) {
  if (v === null || v === undefined) return "—";
  if (kind === "currency") return formatMoney(v);
  if (kind === "ratio") return formatRatio(v);
  return formatPercentOrNum(v);
}

function formatByKindShort(v, kind) {
  if (v === null || v === undefined) return "—";
  if (kind === "currency") return formatMoneyShort(v);
  if (kind === "ratio") return formatRatio(v);
  return formatPercentOrNum(v);
}

function baseOptions(kind) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const v = ctx.parsed.y;
            if (v === null || v === undefined) return `${ctx.dataset.label || ""}: no data reported`.trim();
            const label = ctx.dataset.label ? `${ctx.dataset.label}: ` : "";
            return label + formatByKind(v, kind);
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        ticks: {
          callback: (v) => formatByKindShort(v, kind),
        },
      },
    },
  };
}

export function formatMoney(v) {
  if (v === null || v === undefined) return "—";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function formatMoneyShort(v) {
  if (v === null || v === undefined) return "—";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatPercent(v) {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export function formatRatio(v) {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(2)}x`;
}

function formatPercentOrNum(v) {
  if (v === null || v === undefined) return "—";
  return Math.abs(v) < 5 ? formatPercent(v) : v.toFixed(2);
}

// kind: "currency" | "percent" | "ratio". `currency` boolean is still
// accepted for older call sites and maps to kind "currency"/"percent".
function resolveKind(opts) {
  if (opts.kind) return opts.kind;
  return opts.currency === false ? "percent" : "currency";
}

export function renderLineChart(canvas, years, values, opts = {}) {
  const existing = chartInstances.get(canvas);
  if (existing) existing.destroy();

  const kind = resolveKind(opts);
  const colorVar = opts.colorVar || "--accent";
  const style = getComputedStyle(document.documentElement);
  const color = style.getPropertyValue(colorVar).trim() || "#1f5f4f";

  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: years,
      datasets: [
        {
          data: values,
          borderColor: color,
          backgroundColor: color + "22",
          fill: true,
          tension: 0.15,
          spanGaps: false,
          pointRadius: values.length > 20 ? 0 : 3,
        },
      ],
    },
    options: baseOptions(kind),
  });
  chartInstances.set(canvas, chart);
  return chart;
}

export function renderBarChart(canvas, years, values, opts = {}) {
  const existing = chartInstances.get(canvas);
  if (existing) existing.destroy();
  const kind = opts.kind || (opts.currency ? "currency" : "percent");
  const colorVar = opts.colorVar || "--accent";
  const style = getComputedStyle(document.documentElement);
  const color = style.getPropertyValue(colorVar).trim() || "#1f5f4f";

  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: years,
      datasets: [{ data: values, backgroundColor: color }],
    },
    options: baseOptions(kind),
  });
  chartInstances.set(canvas, chart);
  return chart;
}

// Two-line overlay chart for the "combined stories" tab — e.g. revenue vs.
// net income on the same timeline, so a reader can see them diverge.
export function renderOverlayChart(canvas, years, seriesA, seriesB, { kindA = "currency", kindB = "currency", colorVarA = "--accent", colorVarB = "--flag" } = {}) {
  const existing = chartInstances.get(canvas);
  if (existing) existing.destroy();
  const style = getComputedStyle(document.documentElement);
  const colorA = style.getPropertyValue(colorVarA).trim() || "#1f5f4f";
  const colorB = style.getPropertyValue(colorVarB).trim() || "#b03a2e";

  const sameKind = kindA === kindB;
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: years,
      datasets: [
        {
          label: seriesA.label,
          data: seriesA.values,
          borderColor: colorA,
          backgroundColor: "transparent",
          tension: 0.15,
          spanGaps: false,
          pointRadius: 0,
          yAxisID: "y",
        },
        {
          label: seriesB.label,
          data: seriesB.values,
          borderColor: colorB,
          backgroundColor: "transparent",
          tension: 0.15,
          spanGaps: false,
          pointRadius: 0,
          yAxisID: sameKind ? "y" : "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "top", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              const kind = ctx.datasetIndex === 0 ? kindA : kindB;
              if (v === null || v === undefined) return `${ctx.dataset.label}: no data reported`;
              return `${ctx.dataset.label}: ${formatByKind(v, kind)}`;
            },
          },
        },
      },
      scales: sameKind
        ? { x: { grid: { display: false } }, y: { ticks: { callback: (v) => formatByKindShort(v, kindA) } } }
        : {
            x: { grid: { display: false } },
            y: { position: "left", ticks: { callback: (v) => formatByKindShort(v, kindA) } },
            y1: { position: "right", grid: { display: false }, ticks: { callback: (v) => formatByKindShort(v, kindB) } },
          },
    },
  });
  chartInstances.set(canvas, chart);
  return chart;
}

// Triggers a PNG download of a rendered chart's canvas.
export function downloadChartPNG(canvas, filename) {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}
