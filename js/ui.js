import { formatMoney, formatMoneyShort, formatPercent, formatRatio, renderLineChart, downloadChartPNG } from "./charts.js";
import { cagr, lastValid } from "./kpis.js";
import { KPI_DEFINITIONS, CATEGORIES } from "./kpi-library.js";
import { detectRedFlags, trendVerdict } from "./redflags.js";
import { buildChecklist } from "./verdict.js";
import { computeValuation } from "./valuation.js";
import { term } from "./glossary.js";
import { filingIndexUrl } from "./sec.js";
import { confidenceLegend, estimateMark, reportErrorLink } from "./trust.js";

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function headlineValue(kind, v) {
  if (kind === "currency") return formatMoneyShort(v);
  if (kind === "ratio") return formatRatio(v);
  return formatPercent(v);
}

function chartAriaLabel(label, years, arr, kind) {
  if (!years.length) return `Line chart of ${label}, no data reported.`;
  const last = lastValid(arr);
  const span = `${years[0]} to ${years[years.length - 1]}`;
  const valueTxt = last ? headlineValue(kind, last.value) : "no data reported";
  return `Line chart of ${label} from ${span}, latest value ${valueTxt}.`;
}

function setChartA11y(canvas, label, years, arr, kind) {
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", chartAriaLabel(label, years, arr, kind));
}

function headlineSentence(label, arr, years, kind) {
  const last = lastValid(arr);
  if (!last) return `${label}: no data reported.`;
  const val = headlineValue(kind, last.value);
  const g = cagr(arr, years);
  const growthTxt = g !== null ? `, ${g >= 0 ? "up" : "down"} about ${Math.abs(g * 100).toFixed(1)}%/yr over the covered period` : "";
  return `Most recently (FY${years[last.index]}): ${val}${growthTxt}.`;
}

// --- Progressive depth content (level 2 "Explain" + level 3 "CFA detail") ---
// Plain-language, metric-specific context built from this company's own
// trend verdict and latest value — not generic boilerplate. The 8 original
// KPIs get a hand-written branch; the rest fall through to a still-specific
// (not generic-filler) sentence built from the metric's own label/category.
function explainText(kpi, verdict, last, companyName) {
  const name = companyName || "this company";
  const val = last ? headlineValue(kpi.kind, last.value) : null;
  const trend = verdict.label.toLowerCase();
  switch (kpi.key) {
    case "revenue":
      return `Revenue is the total sales ${name} booked in a fiscal year, before any costs, interest or taxes are subtracted. At ${val ?? "an unreported level"}, the multi-year trend is ${trend} — that tells you whether the underlying business is getting bigger or smaller in the eyes of its customers.`;
    case "netIncome":
      return `Net income is what's left for shareholders after every expense, interest payment and tax bill is paid. ${name} reported ${val ?? "no usable figure"} most recently, and the trend across the covered years is ${trend} — that matters more than any single year, since one-off gains or charges can make a single year misleading.`;
    case "operatingMargin":
      return `Operating margin shows how much of every sales dollar ${name} keeps as profit before interest and taxes. The trend is ${trend}, so ${verdict.cls === "flag" ? "the business is keeping a shrinking slice of each sale — costs or discounting are eating into profitability" : verdict.cls === "good" ? "the business is keeping a growing slice of each sale" : "the picture is mixed, worth watching rather than acting on"}.`;
    case "netMargin":
      return `Net margin is the share of every sales dollar ${name} keeps as final profit, after interest and taxes. It's ${trend} — ${verdict.cls === "flag" ? "a shrinking share, which usually means costs, competition or interest expense are growing faster than sales" : "worth tracking alongside operating margin to see if a squeeze (or improvement) is coming from the core business or from financing/tax items"}.`;
    case "roe":
      return `Return on equity shows how much profit ${name} generates for every dollar shareholders have invested in the business.${val ? ` At ${val},` : ""} the trend is ${trend} — a rising ROE can come from genuinely better performance, but it can also come from taking on more debt, so it's worth reading alongside debt-to-equity.`;
    case "roa":
      return `Return on assets shows how efficiently ${name} turns everything it owns — cash, inventory, equipment, everything on the balance sheet — into profit. Unlike ROE, it isn't inflated by leverage, so it's a cleaner read on operating efficiency. The trend here is ${trend}.`;
    case "debtToEquity":
      return `Debt-to-equity compares what ${name} owes in long-term debt against what shareholders have invested.${val ? ` At ${val},` : ""} leverage here is ${trend} — more debt magnifies both gains and losses for equity holders, and raises the risk if earnings dip.`;
    case "freeCashFlow":
      return `Free cash flow is the cash ${name} has left over after running the business and paying for the equipment/property it needs to keep running it — the pool of real cash available to pay down debt, buy back stock, pay dividends, or reinvest. The trend is ${trend}.`;
    default: {
      const cat = (kpi.category || "").toLowerCase();
      return `${kpi.label} is one of ${name}'s ${cat || "filed"} figures.${val ? ` Most recently: ${val}.` : ""} The multi-year trend here is ${trend} — read it alongside the other cards in this category rather than on its own, since any single ratio can look fine (or alarming) in isolation.`;
    }
  }
}

const KPI_CFA_DETAIL = {
  revenue: { note: "Revenue is taken directly from the company's reported US-GAAP revenue tag (ASC 606) in its 10-K XBRL — no adjustments are made here." },
  netIncome: { note: "Net income is the as-reported GAAP bottom line — no adjustment for one-time items, discontinued operations, or non-GAAP add-backs the company itself might report separately." },
  operatingMargin: { formula: "operating margin = operating income ÷ revenue", note: "Operating income excludes interest and taxes but includes all operating costs; depreciation/amortization policy differences between companies are not normalized here." },
  netMargin: { formula: "net margin = net income ÷ revenue", note: "Includes the effects of interest expense, taxes and any one-off gains or charges embedded in reported net income — not adjusted for non-recurring items." },
  roe: { formula: "ROE = net income ÷ stockholders' equity (period-end)", note: "Uses period-end equity rather than an average of beginning and ending equity, so a large buyback, share issuance, or write-down late in the year can distort a single year's figure." },
  roa: { formula: "ROA = net income ÷ total assets (period-end)", note: "Like ROE here, this uses a point-in-time asset balance rather than an average — a large acquisition or disposal near year-end can skew it." },
  roic: { formula: "ROIC ≈ NOPAT ÷ (equity + long-term debt − cash)", note: "NOPAT is approximated from operating income and an implied effective tax rate — a simplification, not a precise capital-structure-adjusted calculation." },
  roce: { formula: "ROCE = operating income ÷ (assets − current liabilities)", note: "A pre-tax, leverage-aware cousin of ROIC that avoids estimating a tax rate." },
  debtToEquity: { formula: "debt-to-equity = long-term debt ÷ stockholders' equity", note: "Uses long-term debt only, not total liabilities or short-term borrowings, so it can understate leverage for companies that rely heavily on short-term or off-balance-sheet financing." },
  freeCashFlow: { formula: "free cash flow = operating cash flow − capital expenditures", note: "This is the standard simple definition. It doesn't add back stock-based compensation or subtract lease payments the way some analysts' \"adjusted FCF\" does." },
  currentRatio: { formula: "current ratio = current assets ÷ current liabilities", note: "A ratio above 1 suggests near-term bills are covered by near-term resources; it doesn't check how liquid those current assets actually are (e.g. slow-moving inventory)." },
  netDebt: { formula: "net debt = long-term debt − cash and equivalents", note: "Excludes short-term/current debt, since that tag isn't collected by this tool; can understate total leverage for companies with heavy short-term borrowing." },
  cashConversion: { formula: "cash conversion = operating cash flow ÷ net income", note: "Left blank in loss years, since the ratio stops being meaningful when net income is zero or negative." },
};
const DEFAULT_CFA_NOTE = "Computed on the fly from this company's raw filed XBRL figures using a fixed, published formula — the same calculation is applied to every company, with no per-ticker adjustments.";

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
        <p><strong>${company.name}</strong> (${company.ticker}) has filed ${years.length} annual report${years.length === 1 ? "" : "s"} with ${company.market === "LSE" ? "UK Companies House" : "the SEC"}, covering ${span}. Over that span, ${term("revenue", "revenue")} moved from ${formatMoneyShort(base.series.revenue[0])} to ${formatMoneyShort(lastRevenue?.value ?? null)}${revCagr !== null ? `, a compound rate of about ${formatPercent(revCagr)} a year` : ""}.</p>
        ${redFlags.length ? `<p><strong>${redFlags.length} thing${redFlags.length === 1 ? "" : "s"} worth watching</strong> turned up in the filed numbers — see the KPI chapters and red-flag notes below for specifics.</p>` : `<p>No rule-based red flags triggered on the checks this tool runs — that doesn't mean the business is risk-free, only that these specific automated checks didn't fire.</p>`}
        <p class="data-gap-note">This summary is generated mechanically from filed XBRL figures — it is a starting point for research, not a research report.</p>
      </div>
    </div>
  `));
}

export function renderKpiGrid(container, { company, base, derived }) {
  container.innerHTML = "";
  container.append(el(confidenceLegend()));

  // Story mode (narrative, one column) vs Analyst mode (dense grid, default).
  // Layout lives entirely in css/reading-mode.css; here we only toggle a
  // class and remember the choice.
  let mode = "analyst";
  try { mode = localStorage.getItem("kpiReadingMode") === "story" ? "story" : "analyst"; } catch (_) { /* per-viewer convenience only */ }
  const modeToggle = el(`
    <div class="reading-mode-toggle" role="group" aria-label="Reading mode">
      <button type="button" class="mode-btn" data-mode="analyst">Analyst mode</button>
      <button type="button" class="mode-btn" data-mode="story">Story mode</button>
    </div>
  `);
  container.append(modeToggle);

  const grid = el(`<div class="kpi-grid"></div>`);
  container.append(grid);

  function applyMode(m) {
    grid.classList.toggle("story-mode", m === "story");
    modeToggle.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  }
  applyMode(mode);
  modeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".mode-btn");
    if (!btn) return;
    applyMode(btn.dataset.mode);
    try { localStorage.setItem("kpiReadingMode", btn.dataset.mode); } catch (_) { /* per-viewer convenience only */ }
  });

  const ticker = company?.ticker || "company";
  for (const category of CATEGORIES) {
    const kpisInCategory = KPI_DEFINITIONS.filter((k) => k.category === category);
    if (!kpisInCategory.length) continue;
    grid.append(el(`<h3 class="kpi-category-heading" style="grid-column:1/-1; margin:28px 0 4px; font-size:1.05rem;">${category}</h3>`));

    for (const kpi of kpisInCategory) {
      const arr = kpi.raw ? base.series[kpi.key] : derived[kpi.key];
      const verdict = trendVerdict(arr);
      const last = lastValid(arr);
      const card = el(`
        <div class="kpi-card">
          <div class="kpi-card-head">
            <h3>${kpi.termKey ? term(kpi.label, kpi.termKey) : kpi.label}</h3>
            <div class="kpi-card-head-right" style="display:flex; align-items:center; gap:6px;">
              <span class="trend-chip trend-${verdict.cls}">${verdict.label}</span>
              <button type="button" class="icon-btn kpi-download-btn" style="padding:3px 7px; font-size:0.78rem; line-height:1;" title="Download this chart as PNG" aria-label="Download ${kpi.label} chart as PNG">⬇</button>
            </div>
          </div>
          <div class="kpi-headline">${headlineSentence(kpi.label, arr, base.years, kpi.kind)}</div>
          <div class="kpi-chart-wrap"><canvas></canvas></div>
        </div>
      `);
      grid.append(card);
      const canvas = card.querySelector("canvas");
      setChartA11y(canvas, kpi.label, base.years, arr, kpi.kind);
      requestAnimationFrame(() => renderLineChart(canvas, base.years, arr, { kind: kpi.kind }));

      const slug = kpi.label.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
      card.querySelector(".kpi-download-btn").addEventListener("click", () => downloadChartPNG(canvas, `${ticker}-${slug}.png`));

      const cfa = KPI_CFA_DETAIL[kpi.key] || {};
      card.append(el(`
        <details class="how-we-got-this kpi-explain">
          <summary>Explain</summary>
          <p>${explainText(kpi, verdict, last, company?.name)}</p>
        </details>
      `));
      card.append(el(`
        <details class="how-we-got-this kpi-cfa-detail">
          <summary>CFA detail</summary>
          ${cfa.formula ? `<div class="formula">${cfa.formula}</div>` : ""}
          <p>${cfa.note || DEFAULT_CFA_NOTE}</p>
        </details>
      `));
    }
  }
}


export function renderVerdict(container, { company, checklist, redFlags }) {
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
        This checklist and score are mechanically generated from ${company?.market === "LSE" ? "public Companies House filings" : "public SEC filings"} using fixed, published rules — there is no analyst judgment, no AI opinion, and no price target behind it. It is <strong>not</strong> a recommendation to buy, hold or sell anything. Nothing here is personalized financial advice; verify anything important against the original filings linked in the Sources tab.
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
      ${confidenceLegend({ context: "valuation" })}
      <div class="val-grid">
        <div class="val-card"><div class="val-label">${term("book value", "book value")} / share</div><div class="val-value">${v.bookValuePerShare !== null ? "$" + v.bookValuePerShare.toFixed(2) : "—"}${estimateMark()}</div></div>
        <div class="val-card"><div class="val-label">${term("owner earnings", "owner earnings")} / share (5yr avg)</div><div class="val-value">${v.ownerEarningsPerShare !== null ? "$" + v.ownerEarningsPerShare.toFixed(2) : "—"}${estimateMark()}</div></div>
        <div class="val-card"><div class="val-label">Estimated ${term("intrinsic value", "intrinsic value")} range</div><div class="val-value">${v.intrinsicLow !== null ? `$${v.intrinsicLow.toFixed(0)}–$${v.intrinsicHigh.toFixed(0)}` : "—"}${estimateMark()}</div></div>
        <div class="val-card"><div class="val-label">${term("p/e ratio", "p/e ratio")}</div><div class="val-value">${v.pe !== null ? v.pe.toFixed(1) + "x" : "enter a price →"}${v.pe !== null ? estimateMark({ label: "Computed from your entered price — not itself reported by the company" }) : ""}</div></div>
        <div class="val-card"><div class="val-label">${term("p/b ratio", "p/b ratio")}</div><div class="val-value">${v.pb !== null ? v.pb.toFixed(2) + "x" : "enter a price →"}${v.pb !== null ? estimateMark({ label: "Computed from your entered price — not itself reported by the company" }) : ""}</div></div>
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
  const isUk = company.market === "LSE";
  container.append(el(`
    <div>
      ${confidenceLegend()}
      ${isUk ? `
        <p>Every figure in this dossier was read directly from ${company.name}'s own annual accounts filed with UK Companies House, fetched live from its free public API and parsed from the filed Inline XBRL (iXBRL) document — nothing here is estimated, scraped from a paid data vendor, or cached on a server.</p>
        <p class="data-gap-note">UK support is newer and narrower than the US pipeline: it covers a hand-curated list of major LSE-listed companies (not every LSE ticker), and — unlike SEC's clean structured API — parses the actual filed accounts document. If a figure here looks off, please check it against the primary filing below and use "Report an error" if something's wrong.</p>
        <div class="sources-list">
          <a href="https://find-and-update.company-information.service.gov.uk/company/${company.companyNumber}/filing-history?category=accounts" target="_blank" rel="noopener">→ Browse all filed annual accounts for ${company.name} on Companies House</a>
          <a href="https://find-and-update.company-information.service.gov.uk/company/${company.companyNumber}" target="_blank" rel="noopener">→ Companies House company overview (number ${company.companyNumber})</a>
        </div>
      ` : `
        <p>Every figure in this dossier was read directly from ${company.name}'s own filings with the U.S. Securities and Exchange Commission, fetched live from SEC EDGAR's free public API — nothing here is estimated, scraped from a paid data vendor, or cached on a server.</p>
        <div class="sources-list">
          <a href="${filingIndexUrl(company.cik)}" target="_blank" rel="noopener">→ Browse all 10-K annual filings for ${company.ticker} on SEC EDGAR</a>
          <a href="https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json" target="_blank" rel="noopener">→ Raw XBRL company-facts JSON this dossier was built from</a>
          <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${parseInt(company.cik, 10)}&type=10-K" target="_blank" rel="noopener">→ SEC EDGAR company filing browser</a>
        </div>
      `}
      ${reportErrorLink()}
    </div>
  `));
}
