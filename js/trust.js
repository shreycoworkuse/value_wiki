// A lightweight, entirely honest "trust layer" for Value Wiki.
//
// No backend, no accounts, no fabricated verification — just:
//   1. A plain two-tier confidence label ("Directly reported" vs. "Computed
//      estimate") so readers know which numbers came straight off a filing
//      and which ones this tool calculated.
//   2. A link to open a GitHub issue when something looks wrong.
//   3. A link to the GitHub issues list itself, labeled as what it actually
//      is: a public, free, always-current corrections log — nothing custom
//      built or maintained here.
//
// "Directly reported"  = base.series.* in js/kpis.js — raw figures read
//                         as-filed from SEC XBRL data, not touched.
// "Computed estimate"  = derived.* from computeDerived() in js/kpis.js, and
//                         everything in js/valuation.js — ratios and
//                         valuation output calculated from those raw
//                         figures, carrying this tool's own assumptions.

const ISSUES_NEW_URL = "https://github.com/shreycoworkuse/value_wiki/issues/new";
const ISSUES_LIST_URL = "https://github.com/shreycoworkuse/value_wiki/issues";

/**
 * A single-line legend distinguishing directly-reported figures from
 * computed/estimated ones. Meant to sit once near the top of a tab, not on
 * every number.
 *
 * @param {{ context?: "default" | "valuation" }} [opts]
 *   context: "default" (KPI/money/verdict tabs — figures below are as-filed,
 *   ratios are computed) or "valuation" (the "What is it worth" tab, where
 *   nearly everything shown is a computed estimate).
 * @returns {string} HTML string — a single <div class="confidence-legend">.
 */
export function confidenceLegend({ context = "default" } = {}) {
  const text =
    context === "valuation"
      ? `<strong>Confidence key:</strong> every figure on this tab is a <strong>computed estimate</strong> — derived from filed SEC figures using the simple, fixed formulas in “How we got this” below, not itself reported by the company. Figures marked <span class="confidence-badge" aria-hidden="true">est.</span> carry this tool's own assumptions (e.g. the 10x–20x multiple range) and should be treated as a starting point, not a price target.`
      : `<strong>Confidence key:</strong> chart and table values are <strong>directly reported</strong> — read as-filed from SEC filings, untouched. Ratios and valuation figures elsewhere in this dossier are <strong>computed estimates</strong>, calculated from those filings.`;
  return `<div class="confidence-legend">${text}</div>`;
}

/**
 * A small inline marker ("est.") to tag one specific computed/estimated
 * figure — for spots (like individual valuation numbers) that carry enough
 * assumption-risk to call out directly, in addition to the tab-level legend.
 * Renders as a superscript so it doesn't visually compete with the figure.
 *
 * @param {{ label?: string }} [opts] label: the title/aria-label shown on
 *   hover/to screen readers. Defaults to a plain explanation.
 * @returns {string} HTML string — an inline <sup class="confidence-badge">.
 */
export function estimateMark({
  label = "Computed estimate — derived from filed figures using this tool's own formulas, not itself reported by the company",
} = {}) {
  return `<sup class="confidence-badge" title="${label}" aria-label="${label}">est.</sup>`;
}

/**
 * "Report an error" link (opens a new GitHub issue) plus a link to the
 * public corrections log (the GitHub issues list itself — no custom
 * logging system, because the issue tracker already is one).
 *
 * @param {{ compact?: boolean }} [opts]
 *   compact: false (default) — a two-line block of full-width links, sized
 *     for a tab body (e.g. the Sources tab).
 *   compact: true — a single inline line of text with two short links,
 *     sized for a footer.
 * @returns {string} HTML string.
 */
export function reportErrorLink({ compact = false } = {}) {
  if (compact) {
    return `<span class="trust-links-inline">See something wrong? <a href="${ISSUES_NEW_URL}" target="_blank" rel="noopener">Report an error</a> · <a href="${ISSUES_LIST_URL}" target="_blank" rel="noopener">public corrections log</a></span>`;
  }
  return `
    <div class="trust-links-block">
      <a class="trust-link" href="${ISSUES_NEW_URL}" target="_blank" rel="noopener">→ Report an error in this dossier (opens a new GitHub issue)</a>
      <a class="trust-link" href="${ISSUES_LIST_URL}" target="_blank" rel="noopener">→ Public corrections log — every reported error and its status, on GitHub Issues</a>
    </div>
  `;
}
