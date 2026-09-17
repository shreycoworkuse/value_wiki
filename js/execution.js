// "Execution Consistency" panel.
//
// IMPORTANT SCOPE NOTE: this is deliberately NOT a "future plans" or
// guidance-tracking feature. Forward-looking guidance (revenue targets,
// management projections, "we expect to deliver X by 20YY") is disclosed by
// companies as free-text prose in MD&A sections and on earnings calls — it is
// never filed as a standardized XBRL fact, so there is no free, structured,
// cross-company source for it. Nothing in this file reads, infers or scores
// anything against what a company SAID it would do. Every number here comes
// straight from base.years / base.series / derived, i.e. only from what was
// actually reported. See the on-page copy below, which repeats this
// distinction for the reader.
//
// Same house style as redflags.js / verdict.js: plain, transparent,
// threshold-based checks over the filed figures, no hidden model.

import { renderLineChart } from "./charts.js";

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function stdDev(values) {
  const vals = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (vals.length < 2) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return Math.sqrt(variance);
}

// Counts how many times a series flips from growing to shrinking (or back)
// between consecutive reported years — a plain-language stand-in for "growth
// reversed direction."
function countSignFlips(values) {
  const vals = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  let flips = 0;
  for (let i = 1; i < vals.length; i++) {
    if ((vals[i - 1] >= 0) !== (vals[i] >= 0)) flips++;
  }
  return flips;
}

// Missing calendar years between the first and last reported fiscal year.
// base.years is the union of years across every XBRL tag this tool reads, so
// a gap here means no metric at all was found for that year — a plausible
// sign of a late filing, an acquisition/going-private gap, or a fiscal-year
// change, not proof of any specific cause.
function findFilingGaps(years) {
  const nums = years.map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  if (nums.length < 2) return [];
  const present = new Set(nums);
  const gaps = [];
  for (let y = nums[0]; y < nums[nums.length - 1]; y++) {
    if (!present.has(y)) gaps.push(y);
  }
  return gaps;
}

function lossYears(base) {
  return base.years
    .map((y, i) => ({ year: y, netIncome: base.series.netIncome[i] }))
    .filter((d) => d.netIncome !== null && d.netIncome !== undefined && d.netIncome < 0);
}

// Thresholds below are picked the same way the rest of the house style picks
// them (redflags.js, verdict.js): round, defensible, plainly-stated numbers,
// not fit to any particular company.
function volatilityVerdict(sd, { steady, moderate }) {
  if (sd === null) return { label: "Not enough data", cls: "watch" };
  if (sd < steady) return { label: "Steady", cls: "good" };
  if (sd < moderate) return { label: "Somewhat variable", cls: "watch" };
  return { label: "Volatile", cls: "flag" };
}

function pct(v) {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)} pts`;
}

export function renderExecutionConsistency(container, { company, base, derived }) {
  container.innerHTML = "";
  const years = base.years;

  // 1. Filing consistency
  const gaps = findFilingGaps(years);
  const filingVerdict = gaps.length === 0
    ? { label: "No gaps", cls: "good" }
    : { label: `${gaps.length} missing year${gaps.length === 1 ? "" : "s"}`, cls: "flag" };

  // 2. Growth consistency
  const growthSd = stdDev(derived.revenueGrowth);
  const growthFlips = countSignFlips(derived.revenueGrowth);
  const growthVerdict = volatilityVerdict(growthSd, { steady: 0.08, moderate: 0.20 });

  // 3. Margin consistency (net margin — the bottom-line number readers know)
  const marginSd = stdDev(derived.netMargin);
  const marginFlips = countSignFlips(
    derived.netMargin.map((v, i) => (i === 0 || v === null || derived.netMargin[i - 1] === null ? null : v - derived.netMargin[i - 1]))
  );
  const marginVerdict = volatilityVerdict(marginSd, { steady: 0.03, moderate: 0.08 });

  // 4. Loss years
  const losses = lossYears(base);
  const lossVerdict = losses.length === 0
    ? { label: "None on record", cls: "good" }
    : losses.length <= 2
      ? { label: `${losses.length} year${losses.length === 1 ? "" : "s"}`, cls: "watch" }
      : { label: `${losses.length} years`, cls: "flag" };

  container.append(el(`
    <div>
      <div class="summary-block">
        <p><strong>This is not a "future plans" or guidance tab.</strong> Value Wiki has no access to what ${company.name}'s management has promised, forecast or targeted — those numbers live in earnings-call transcripts and free-text MD&amp;A prose, not in the structured SEC XBRL data this whole site is built from, and there is no free structured source for them. What follows instead is honest and narrower: a look at how consistently ${company.ticker} has actually <em>reported</em> and <em>executed</em> year to year, judged only against its own filing history — never against anything the company said it would do.</p>
      </div>

      <div class="headline-facts">
        <div class="fact-card">
          <div class="fact-label">Filing record</div>
          <div class="fact-value"><span class="trend-chip trend-${filingVerdict.cls}">${filingVerdict.label}</span></div>
          <div class="fact-sub">${years.length ? `FY${years[0]}–FY${years[years.length - 1]}` : "—"}</div>
        </div>
        <div class="fact-card">
          <div class="fact-label">Revenue growth</div>
          <div class="fact-value"><span class="trend-chip trend-${growthVerdict.cls}">${growthVerdict.label}</span></div>
          <div class="fact-sub">${growthSd !== null ? `year-to-year swing of ~${pct(growthSd)}` : "not enough years"}</div>
        </div>
        <div class="fact-card">
          <div class="fact-label">Net margin</div>
          <div class="fact-value"><span class="trend-chip trend-${marginVerdict.cls}">${marginVerdict.label}</span></div>
          <div class="fact-sub">${marginSd !== null ? `year-to-year swing of ~${pct(marginSd)}` : "not enough years"}</div>
        </div>
        <div class="fact-card">
          <div class="fact-label">Loss-making years</div>
          <div class="fact-value"><span class="trend-chip trend-${lossVerdict.cls}">${lossVerdict.label}</span></div>
          <div class="fact-sub">out of ${years.length} reported years</div>
        </div>
      </div>

      <div class="kpi-card" style="margin-top:18px;">
        <h3>Filing timeline</h3>
        <div class="kpi-headline">Every year from the first to the last reported fiscal year, in order. A gap means no XBRL figures were found for that calendar year in this company's record — possibly a late filing, a merger/going-private period, or a fiscal-year change; a red dot marks a year that closed with a net loss.</div>
        <div id="exec-timeline" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;"></div>
      </div>

      <div class="kpi-card" style="margin-top:18px;">
        <h3>Revenue growth, year to year</h3>
        <div class="kpi-headline">${growthFlips === 0 && growthSd !== null ? "Growth never reversed direction over the covered period — every year built on the last." : `Growth reversed direction (grew one year, shrank the next, or vice versa) ${growthFlips} time${growthFlips === 1 ? "" : "s"} over the covered period.`} A choppier line here means the business is inherently harder to forecast a year ahead, independent of anything management may or may not have said about it.</div>
        <div class="kpi-chart-wrap"><canvas id="exec-growth-canvas"></canvas></div>
      </div>

      <div class="kpi-card" style="margin-top:18px;">
        <h3>Net margin, year to year</h3>
        <div class="kpi-headline">${marginFlips === 0 && marginSd !== null ? "Net margin moved in one direction only, without reversing, over the covered period." : `Net margin reversed direction ${marginFlips} time${marginFlips === 1 ? "" : "s"} over the covered period.`} Steadier margins suggest a more predictable cost structure and pricing power; swings suggest the opposite.</div>
        <div class="kpi-chart-wrap"><canvas id="exec-margin-canvas"></canvas></div>
      </div>

      ${losses.length ? `
        <div class="kpi-card" style="margin-top:18px;">
          <h3>Loss-making years on record</h3>
          <ul class="redflag-list">${losses.map((l) => `<li>FY${l.year}: net loss</li>`).join("")}</ul>
        </div>
      ` : `<p class="no-flags" style="margin-top:18px;">No loss-making year appears in this company's reported filing history.</p>`}

      <div class="disclaimer-box">
        "Execution Consistency" measures only how steady and gap-free ${company.name}'s <strong>own past filings</strong> have been — it is not a scorecard against management guidance, analyst estimates, or any stated corporate targets, because no free, structured, cross-company data source for that exists. A "volatile" or "gap" reading here says something about predictability and reporting continuity, not about whether the company kept a promise.
      </div>
    </div>
  `));

  const timelineWrap = container.querySelector("#exec-timeline");
  if (timelineWrap && years.length) {
    const gapSet = new Set(gaps.map(String));
    const lossSet = new Set(losses.map((l) => l.year));
    const nums = years.map(Number).sort((a, b) => a - b);
    const allYears = [];
    for (let y = nums[0]; y <= nums[nums.length - 1]; y++) allYears.push(String(y));
    for (const y of allYears) {
      const isGap = gapSet.has(y);
      const isLoss = lossSet.has(y);
      let bg = "var(--bg)";
      let border = "var(--border)";
      let color = "var(--text-muted)";
      let title = `FY${y}: no data`;
      if (!isGap) {
        bg = isLoss ? "var(--flag-soft)" : "var(--good-soft)";
        border = isLoss ? "var(--flag)" : "var(--good)";
        color = isLoss ? "var(--flag)" : "var(--good)";
        title = isLoss ? `FY${y}: filed, net loss` : `FY${y}: filed`;
      } else {
        border = "var(--flag)";
        color = "var(--flag)";
      }
      const chip = el(`<div title="${title}" style="min-width:52px;text-align:center;padding:6px 4px;border-radius:8px;border:1px dashed ${isGap ? border : "transparent"};background:${bg};color:${color};font-size:0.75rem;font-weight:700;${isGap ? "" : `border:1px solid ${border};`}">${y}${isGap ? "<br><span style=\"font-weight:400;\">gap</span>" : ""}</div>`);
      timelineWrap.append(chip);
    }
  }

  const growthCanvas = container.querySelector("#exec-growth-canvas");
  const marginCanvas = container.querySelector("#exec-margin-canvas");
  requestAnimationFrame(() => {
    if (growthCanvas) renderLineChart(growthCanvas, years, derived.revenueGrowth, { currency: false });
    if (marginCanvas) renderLineChart(marginCanvas, years, derived.netMargin, { currency: false });
  });
}
