// Renders the two additional valuation methods (3-scenario DCF, book-value
// compounding projection) added on top of js/valuation.js's computeValuation.
// Kept in its own file/module rather than folded into js/ui.js's
// renderValuation so this can be developed without touching a file other
// agents may be editing in parallel. See the integration instructions at the
// bottom of this file's accompanying report for how to wire it in.
//
// Follows the exact same markup/CSS conventions as renderValuation in
// js/ui.js: .val-grid / .val-card / .val-label / .val-value for the headline
// numbers, and a <details class="how-we-got-this"> drawer (closed by
// default) that only shows the formulas/assumptions to someone who opens it.

import { computeValuation } from "./valuation.js";
import { term } from "./glossary.js";

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function money(v) {
  return v !== null && v !== undefined && Number.isFinite(v) ? "$" + v.toFixed(2) : "—";
}

function pct(v) {
  return v !== null && v !== undefined && Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "—";
}

// Appends the DCF and book-value-compounding sections into `container`,
// AFTER whatever renderValuation already put there — this function never
// clears the container, so it's safe to call right after renderValuation
// without clobbering it.
export function renderValuationExtra(container, { base, derived, price }) {
  const v = computeValuation(base, derived, price);
  const dcf = v.dcf;
  const bvc = v.bookValueCompounding;

  container.append(el(`
    <div>
      <div class="val-grid">
        <div class="val-card">
          <div class="val-label">${term("dcf", "dcf")} (3-scenario) — bear / base / bull</div>
          <div class="val-value">${dcf.available
            ? `${money(dcf.perShareLow)} / ${money(dcf.perShareMid)} / ${money(dcf.perShareHigh)}`
            : "—"}</div>
        </div>
        <div class="val-card">
          <div class="val-label">Book value/share compounding at historical rate</div>
          <div class="val-value">${bvc.available
            ? `${money(bvc.projected5yr)} in 5yr / ${money(bvc.projected10yr)} in 10yr`
            : "—"}</div>
        </div>
      </div>

      ${!dcf.available ? `<p class="data-gap-note">Not enough filed history (need at least two annual revenue figures and a positive owner-earnings estimate) to derive DCF growth scenarios for this company.</p>` : ""}
      ${!bvc.available ? `<p class="data-gap-note">Not enough filed history (need book value per share and at least one annual ROE figure) to project book-value compounding for this company.</p>` : ""}

      <details class="how-we-got-this">
        <summary>How we got the DCF and book-value projection</summary>
        <p><strong>3-scenario DCF.</strong> Growth assumptions come from this company's own historical revenue CAGR${dcf.available ? ` (${pct(dcf.historicalRevenueCagr)}/yr over its filed history)` : ""} — never a hand-picked number:</p>
        <div class="formula">bear growth  = min(0%, historical CAGR ÷ 2)
base growth  = min(8%, historical CAGR)
bull growth  = min(15%, historical CAGR × 1.5)</div>
        <p>Owner earnings/share (the same 5-year-average FCF/share used above) is grown at each scenario's rate for 10 years, discounted back at a fixed, conservative 10% discount rate, plus a terminal value of 12× year-10 free cash flow, also discounted back to today.</p>
        ${dcf.available ? `<p>For this company: bear ${pct(dcf.bearGrowth)}/yr, base ${pct(dcf.baseGrowth)}/yr, bull ${pct(dcf.bullGrowth)}/yr.</p>` : ""}
        <p style="margin-top:10px;">This produces a bear/base/bull band, on purpose — never a single "fair value" number. The 10% discount rate and 12× terminal multiple are fixed and deliberately conservative, not fitted to make any particular company look cheap or expensive.</p>

        <p style="margin-top:14px;"><strong>Book-value compounding projection.</strong> This is a forward projection, not a discounted-to-today intrinsic value:</p>
        <div class="formula">growth rate = average historical ROE × retention ratio
retention ratio = 1 − dividend payout ratio (0% payout assumed if no dividend data is filed)
projected book value/share = current book value/share × (1 + growth rate) ^ years</div>
        ${bvc.available ? `<p>For this company: average ROE ${pct(bvc.avgRoe)}, retention ratio ${pct(bvc.retentionRatio)}${bvc.assumedFullRetention ? " (assumed — no dividend data filed)" : ""}, implied growth rate ${pct(bvc.growthRate)}${bvc.clamped ? " (clamped to ±30%/yr to avoid a runaway projection from a single distorted year)" : ""}.</p>` : ""}
        <p style="margin-top:10px;">In plain terms: if this business keeps compounding book value at roughly its own historical rate, book value/share could reach about ${bvc.available ? money(bvc.projected5yr) : "—"} in 5 years and about ${bvc.available ? money(bvc.projected10yr) : "—"} in 10 years. That is not a price target — it says nothing about what the market will pay for that book value, only how the accounting book value itself might grow if history repeats.</p>

        <p style="margin-top:14px;"><strong>Why no sum-of-parts / NAV.</strong> We looked into building a sum-of-parts or net-asset-value method from SEC XBRL segment-reporting tags and ruled it out: segment revenue/assets are reported under each filer's own custom dimensional tags (a "StatementBusinessSegmentsAxis" with company-invented segment names), not a standardized flat concept like revenue or net income, many filers don't tag segment-level balance-sheet data at all, and segment structure changes year to year. Doing this reliably would mean per-company hand-curation — the opposite of how every other number in this dossier is computed — so rather than fabricate or guess at segment splits, we're leaving this method out.</p>
      </details>
    </div>
  `));
}
