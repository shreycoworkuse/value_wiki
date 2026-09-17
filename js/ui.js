import { formatMoney, formatMoneyShort, formatPercent, renderLineChart } from "./charts.js";
import { cagr, lastValid } from "./kpis.js";
import { detectRedFlags, trendVerdict } from "./redflags.js";
import { buildChecklist } from "./verdict.js";
import { computeValuation } from "./valuation.js";
import { term } from "./glossary.js";
import { filingIndexUrl } from "./sec.js";

const KPI_LIST = [
  { key: "revenue", label: "Revenue", raw: true, currency: true },
  { key: "netIncome", label: "Net income", raw: true, currency: true },
  { key: "operatingMargin", label: "Operating margin", raw: false, currency: false },
  { key: "netMargin", label: "Net margin", raw: false, currency: false },
  { key: "roe", label: "Return on equity (ROE)", raw: false, currency: false },
  { key: "roa", label: "Return on assets (ROA)", raw: false, currency: false },
  { key: "debtToEquity", label: "Debt-to-equity", raw: false, currency: false },
  { key: "freeCashFlow", label: "Free cash flow", raw: false, currency: true },
];

const KPI_TERM_KEY = {
  "Operating margin": "operating margin",
  "Net margin": "net margin",
  "Return on equity (ROE)": "roe",
  "Return on assets (ROA)": "roa",
  "Debt-to-equity": "debt-to-equity",
  "Free cash flow": "free cash flow",
};

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function headlineSentence(label, arr, years, currency) {
  const last = lastValid(arr);
  if (!last) return `${label}: no data reported.`;
  const val = currency ? formatMoneyShort(last.value) : formatPercent(last.value);
  const g = cagr(arr, years);
  const growthTxt = g !== null ? `, ${g >= 0 ? "up" : "down"} about ${Math.abs(g * 100).toFixed(1)}%/yr over the covered period` : "";
  return `Most recently (FY${years[last.index]}): ${val}${growthTxt}.`;
}

export function renderCoverStory(container, { company, base, derived, redFlags, checklist }) {
  const years = base.years;
  const lastRevenue = lastValid(base.series.revenue);
  const lastNI = lastValid(base.series.netIncome);
  const revCagr = cagr(base.series.revenue, years);
  const span = years.length ? `FY${years[0]}–FY${years[years.length - 1]}` : "—";

  container.innerHTML = "";
  container.append(el(`
    <div>
      <div class="headline-facts">
        <div class="fact-card"><div class="fact-label">Filing history</div><div class="fact-value">${span}</div><div class="fact-sub">${years.length} annual reports on file</div></div>
        <div class="fact-card"><div class="fact-label">Latest revenue</div><div class="fact-value">${lastRevenue ? formatMoneyShort(lastRevenue.value) : "—"}</div><div class="fact-sub">${lastRevenue ? "FY" + years[lastRevenue.index] : ""}</div></div>
        <div class="fact-card"><div class="fact-label">Latest net income</div><div class="fact-value">${lastNI ? formatMoneyShort(lastNI.value) : "—"}</div><div class="fact-sub">${lastNI ? "FY" + years[lastNI.index] : ""}</div></div>
        <div class="fact-card"><div class="fact-label">Revenue CAGR</div><div class="fact-value">${revCagr !== null ? formatPercent(revCagr) : "—"}</div><div class="fact-sub">over covered period</div></div>
        <div class="fact-card"><div class="fact-label">Owner's checklist</div><div class="fact-value">${checklist.total}/${checklist.max}</div><div class="fact-sub">${checklist.band}</div></div>
      </div>
      <div class="summary-block">
        <p><strong>${company.name}</strong> (${company.ticker}) has filed ${years.length} annual report${years.length === 1 ? "" : "s"} with the SEC, covering ${span}. Over that span, ${term("revenue", "revenue")} moved from ${formatMoneyShort(base.series.revenue[0])} to ${formatMoneyShort(lastRevenue?.value ?? null)}${revCagr !== null ? `, a compound rate of about ${formatPercent(revCagr)} a year` : ""}.</p>
        ${redFlags.length ? `<p><strong>${redFlags.length} thing${redFlags.length === 1 ? "" : "s"} worth watching</strong> turned up in the filed numbers — see the KPI chapters and red-flag notes below for specifics.</p>` : `<p>No rule-based red flags triggered on the checks this tool runs — that doesn't mean the business is risk-free, only that these specific automated checks didn't fire.</p>`}
        <p class="data-gap-note">This summary is generated mechanically from SEC XBRL figures — it is a starting point for research, not a research report.</p>
      </div>
    </div>
  `));
}

export function renderKpiGrid(container, { base, derived }) {
  container.innerHTML = "";
  const grid = el(`<div class="kpi-grid"></div>`);
  container.append(grid);

  for (const kpi of KPI_LIST) {
    const arr = kpi.raw ? base.series[kpi.key] : derived[kpi.key];
    const verdict = trendVerdict(arr);
    const last = lastValid(arr);
    const termKey = KPI_TERM_KEY[kpi.label];
    const card = el(`
      <div class="kpi-card">
        <div class="kpi-card-head">
          <h3>${termKey ? term(kpi.label, termKey) : kpi.label}</h3>
          <span class="trend-chip trend-${verdict.cls}">${verdict.label}</span>
        </div>
        <div class="kpi-headline">${headlineSentence(kpi.label, arr, base.years, kpi.currency)}</div>
        <div class="kpi-chart-wrap"><canvas></canvas></div>
      </div>
    `);
    grid.append(card);
    const canvas = card.querySelector("canvas");
    requestAnimationFrame(() => renderLineChart(canvas, base.years, arr, { currency: kpi.currency }));
  }
}

export function renderFollowTheMoney(container, { base, derived }) {
  container.innerHTML = "";
  const wrap = el(`
    <div>
      <div class="kpi-card">
        <h3>Cash from operations vs. ${term("capital expenditures", "capital expenditures")}</h3>
        <div class="kpi-headline">${term("free cash flow", "free cash flow")} is operating cash flow minus capex — the cash actually left over for owners after keeping the business running.</div>
        <div class="kpi-chart-wrap"><canvas id="fcf-canvas"></canvas></div>
      </div>
      <div class="kpi-card" style="margin-top:18px;">
        <h3>Full annual table</h3>
        <div style="overflow-x:auto;">
          <table class="money-table" id="money-table"></table>
        </div>
      </div>
    </div>
  `);
  container.append(wrap);
  const canvas = wrap.querySelector("#fcf-canvas");
  requestAnimationFrame(() => renderLineChart(canvas, base.years, derived.freeCashFlow, { currency: true }));

  const rows = [
    ["Revenue", base.series.revenue, true],
    ["Net income", base.series.netIncome, true],
    ["Operating cash flow", base.series.operatingCashFlow, true],
    ["Capital expenditures", base.series.capex, true],
    ["Free cash flow", derived.freeCashFlow, true],
    ["Total assets", base.series.assets, true],
    ["Total liabilities", base.series.liabilities, true],
    ["Stockholders' equity", base.series.equity, true],
    ["Long-term debt", base.series.longTermDebt, true],
  ];
  const table = wrap.querySelector("#money-table");
  table.innerHTML = `<thead><tr><th>Fiscal year</th>${base.years.map((y) => `<th>${y}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(([label, arr]) => `<tr><td>${label}</td>${arr.map((v) => `<td>${formatMoney(v)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

export function renderVerdict(container, { checklist, redFlags }) {
  container.innerHTML = "";
  const pct = checklist.total / checklist.max;
  const cls = pct >= 0.7 ? "good" : pct >= 0.4 ? "watch" : "flag";
  container.append(el(`
    <div>
      <div class="verdict-score">
        <span class="score-num">${checklist.total}/${checklist.max}</span>
        <span class="verdict-band" style="color:var(--${cls})">${checklist.band}</span>
      </div>
      <div class="checklist">
        ${checklist.items.map((item) => `
          <div class="checklist-item">
            <div>
              <div class="checklist-q">${item.q}</div>
              <div class="checklist-why">${item.why}</div>
            </div>
            <div class="checklist-score score-${item.score}">${item.score}</div>
          </div>
        `).join("")}
      </div>
      ${redFlags.length ? `
        <div class="kpi-card" style="margin-top:20px;">
          <h3>Automated red-flag checks that fired</h3>
          <ul class="redflag-list">${redFlags.map((f) => `<li>${f.text}</li>`).join("")}</ul>
        </div>
      ` : `<p class="no-flags" style="margin-top:20px;">No automated red-flag checks fired on this filing history.</p>`}
      <div class="disclaimer-box">
        This checklist and score are mechanically generated from public SEC filings using fixed, published rules — there is no analyst judgment, no AI opinion, and no price target behind it. It is <strong>not</strong> a recommendation to buy, hold or sell anything. Nothing here is personalized financial advice; verify anything important against the original filings linked in the Sources tab.
      </div>
    </div>
  `));
}

export function renderValuation(container, { base, derived, price }) {
  container.innerHTML = "";
  const v = computeValuation(base, derived, price);
  const mosPct = v.marginOfSafety;
  let mosColor = "var(--text-muted)";
  if (mosPct !== null) mosColor = mosPct > 0.2 ? "var(--good)" : mosPct > 0 ? "var(--watch)" : "var(--flag)";

  container.append(el(`
    <div>
      <div class="val-grid">
        <div class="val-card"><div class="val-label">${term("book value", "book value")} / share</div><div class="val-value">${v.bookValuePerShare !== null ? "$" + v.bookValuePerShare.toFixed(2) : "—"}</div></div>
        <div class="val-card"><div class="val-label">${term("owner earnings", "owner earnings")} / share (5yr avg)</div><div class="val-value">${v.ownerEarningsPerShare !== null ? "$" + v.ownerEarningsPerShare.toFixed(2) : "—"}</div></div>
        <div class="val-card"><div class="val-label">Estimated ${term("intrinsic value", "intrinsic value")} range</div><div class="val-value">${v.intrinsicLow !== null ? `$${v.intrinsicLow.toFixed(0)}–$${v.intrinsicHigh.toFixed(0)}` : "—"}</div></div>
        <div class="val-card"><div class="val-label">${term("p/e ratio", "p/e ratio")}</div><div class="val-value">${v.pe !== null ? v.pe.toFixed(1) + "x" : "enter a price →"}</div></div>
        <div class="val-card"><div class="val-label">${term("p/b ratio", "p/b ratio")}</div><div class="val-value">${v.pb !== null ? v.pb.toFixed(2) + "x" : "enter a price →"}</div></div>
      </div>

      <div class="kpi-card">
        <h3>${term("margin of safety", "margin of safety")} gauge</h3>
        ${price ? `
          <div class="mos-gauge">
            <div class="mos-bar"><div class="mos-fill" style="width:${Math.min(100, Math.max(0, (mosPct + 0.5) * 100))}%; background:${mosColor};"></div></div>
            <div class="mos-label">At $${price.toFixed(2)}/share vs. an estimated intrinsic mid-point of ${v.intrinsicMid !== null ? "$" + v.intrinsicMid.toFixed(2) : "—"}: ${mosPct !== null ? formatPercent(mosPct) : "—"} margin of safety.</div>
          </div>
        ` : `<p class="data-gap-note">Type a current share price above (in the dossier header) to see how it compares with the estimated intrinsic value range.</p>`}
      </div>

      <details class="how-we-got-this">
        <summary>How we got this</summary>
        <p>Owner earnings ≈ average free cash flow per share over the last 5 reported years.</p>
        <div class="formula">intrinsic value range = owner earnings/share × [10x, 20x]</div>
        <p>Book value per share = latest stockholders' equity ÷ latest diluted shares outstanding.</p>
        <p>Margin of safety = (intrinsic mid-point − price) ÷ intrinsic mid-point.</p>
        <p style="margin-top:10px;">These are deliberately simple, conservative approximations meant for learning — not a substitute for a full valuation model. A wide multiple range (10x–20x) is used on purpose instead of a single price target.</p>
      </details>
    </div>
  `));
}

export function renderSources(container, { company }) {
  container.innerHTML = "";
  container.append(el(`
    <div>
      <p>Every figure in this dossier was read directly from ${company.name}'s own filings with the U.S. Securities and Exchange Commission, fetched live from SEC EDGAR's free public API — nothing here is estimated, scraped from a paid data vendor, or cached on a server.</p>
      <div class="sources-list">
        <a href="${filingIndexUrl(company.cik)}" target="_blank" rel="noopener">→ Browse all 10-K annual filings for ${company.ticker} on SEC EDGAR</a>
        <a href="https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json" target="_blank" rel="noopener">→ Raw XBRL company-facts JSON this dossier was built from</a>
        <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${parseInt(company.cik, 10)}&type=10-K" target="_blank" rel="noopener">→ SEC EDGAR company filing browser</a>
      </div>
    </div>
  `));
}
