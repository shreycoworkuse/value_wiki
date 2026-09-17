// Thin wrapper around the vendored Chart.js (loaded globally, no CDN).
// Missing years are left as real gaps (Chart.js `spanGaps: false`), never
// interpolated, per the "don't fabricate data" principle.

const chartInstances = new Map();

function baseOptions(currency) {
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
            if (v === null || v === undefined) return "No data reported";
            return currency ? formatMoney(v) : formatPercentOrNum(v);
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        ticks: {
          callback: (v) => (currency ? formatMoneyShort(v) : formatPercentOrNum(v)),
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

function formatPercentOrNum(v) {
  if (v === null || v === undefined) return "—";
  return Math.abs(v) < 5 ? formatPercent(v) : v.toFixed(2);
}

export function renderLineChart(canvas, years, values, { currency = true, colorVar = "--accent" } = {}) {
  const existing = chartInstances.get(canvas);
  if (existing) existing.destroy();

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
    options: baseOptions(currency),
  });
  chartInstances.set(canvas, chart);
  return chart;
}

export function renderBarChart(canvas, years, values, { currency = false, colorVar = "--accent" } = {}) {
  const existing = chartInstances.get(canvas);
  if (existing) existing.destroy();
  const style = getComputedStyle(document.documentElement);
  const color = style.getPropertyValue(colorVar).trim() || "#1f5f4f";

  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: years,
      datasets: [{ data: values, backgroundColor: color }],
    },
    options: baseOptions(currency),
  });
  chartInstances.set(canvas, chart);
  return chart;
}
