// "Market vs business" screen for the Money flow tab.
//
// SCOPING NOTE: this screen is annual-only and ignores the shared quarterly
// time slider on purpose. There is no free, keyless, CORS-friendly historical
// stock-price API anywhere (same investigation/reasoning as js/timeline.js —
// read that file for the full explanation). The only market price this app
// ever has is ctx.price, a single value the user optionally types in at the
// top of the page, and it only ever applies to the latest reported period —
// so it's compared against the latest year's own numbers, never plotted
// alongside a fabricated price history.

import { renderOverlayChart, formatMoney, formatMoneyShort, formatPercent } from "./charts.js";
import { computeValuation } from "./valuation.js";
import { lastValid } from "./kpis.js";

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function money(v) {
  return v !== null && v !== undefined && Number.isFinite(v) ? formatMoney(v) : "—";
}

export function renderMarketVsBusiness(container, ctx) {
  container.innerHTML = "";
  const { base, derived, price, company } = ctx;
  const years = base.years;

  const bvps = derived.bookValuePerShare;
  const fcfps = derived.fcfPerShare;
  const haveTrend = years.length >= 2 && (bvps.some((v) => v !== null) || fcfps.some((v) => v !== null));

  const wrap = el(`
    <div class="mvb">
      <p class="data-gap-note">
        Annual view only — there is no free, no-key historical stock-price data available anywhere for this tool
        (same reasoning as the Timeline tab), so this screen doesn't try to plot a market-cap history. It compares
        the business's own multi-year numbers against the one current price you can optionally type in above.
      </p>
      <div class="kpi-card">
        <h3>Book value / share vs. free cash flow / share, by year</h3>
        ${haveTrend
          ? `<div class="kpi-chart-wrap mvb-chart-wrap"><canvas></canvas></div>`
          : `<p class="data-gap-note">Not enough filed annual history to chart a trend yet.</p>`}
      </div>
      <div class="mvb-snapshot"></div>
    </div>
  `);
  container.append(wrap);

  if (haveTrend) {
    const canvas = wrap.querySelector("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Book value per share and free cash flow per share for ${company?.name ?? "this company"}, ${years[0]} to ${years[years.length - 1]}.`);
    requestAnimationFrame(() => renderOverlayChart(canvas, years, {
      label: "Book value / share",
      values: bvps,
    }, {
      label: "FCF / share",
      values: fcfps,
    }, { kindA: "currency", kindB: "currency", colorVarA: "--accent", colorVarB: "--watch" }));
  }

  const snapshotEl = wrap.querySelector(".mvb-snapshot");
  const latestYear = years[years.length - 1];
  const latestBvps = lastValid(bvps);
  const latestFcfps = lastValid(fcfps);
  const latestShares = lastValid(base.series.dilutedShares);
  const latestDebt = lastValid(base.series.longTermDebt);
  const latestCash = lastValid(base.series.cash);

  if (!price) {
    snapshotEl.append(el(`
      <div class="kpi-card">
        <h3>Current snapshot — FY${latestYear ?? "—"}</h3>
        <p class="data-gap-note">Enter a share price at the top of the page to compare it against the business's own numbers.</p>
        <div class="val-grid">
          <div class="val-card"><div class="val-label">Book value / share</div><div class="val-value">${latestBvps ? money(latestBvps.value) : "—"}</div></div>
          <div class="val-card"><div class="val-label">Free cash flow / share</div><div class="val-value">${latestFcfps ? money(latestFcfps.value) : "—"}</div></div>
        </div>
      </div>
    `));
    return;
  }

  const shares = latestShares ? latestShares.value : null;
  const debt = latestDebt ? latestDebt.value : null;
  const cash = latestCash ? latestCash.value : null;
  const marketCap = shares ? price * shares : null;
  const enterpriseValue = marketCap !== null ? marketCap + (debt ?? 0) - (cash ?? 0) : null;

  const v = computeValuation(base, derived, price);

  snapshotEl.append(el(`
    <div class="kpi-card">
      <h3>Market vs. business — FY${latestYear ?? "—"}</h3>
      <p class="data-gap-note">What the market currently pays, at $${price.toFixed(2)}/share, next to what the business's own filed numbers say for the latest reported year.</p>
      <div class="val-grid">
        <div class="val-card"><div class="val-label">Market price</div><div class="val-value">$${price.toFixed(2)}</div></div>
        <div class="val-card"><div class="val-label">Market cap</div><div class="val-value">${marketCap !== null ? formatMoneyShort(marketCap) : "—"}</div></div>
        <div class="val-card"><div class="val-label">Enterprise value</div><div class="val-value">${enterpriseValue !== null ? formatMoneyShort(enterpriseValue) : "—"}</div></div>
        <div class="val-card"><div class="val-label">Book value / share</div><div class="val-value">${latestBvps ? money(latestBvps.value) : "—"}</div></div>
        <div class="val-card"><div class="val-label">Free cash flow / share</div><div class="val-value">${latestFcfps ? money(latestFcfps.value) : "—"}</div></div>
        <div class="val-card"><div class="val-label">Estimated intrinsic value range</div><div class="val-value">${v.intrinsicLow !== null ? `${money(v.intrinsicLow)}–${money(v.intrinsicHigh)}` : "—"}</div></div>
      </div>
      <p class="data-gap-note">
        Enterprise value = market cap + latest long-term debt (${money(debt)}) − latest cash (${money(cash)}).
        Intrinsic value range and margin-of-safety math live in the "What is it worth" tab — this screen only lines
        the market's current price up against the business's own multi-year trend, it doesn't repeat that detail.
      </p>
    </div>
  `));
}
