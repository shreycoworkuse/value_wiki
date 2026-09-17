// First-run guided tour: a small dismissible banner shown once on the
// landing page to help new visitors find the search box, the example
// chips, and the hoverable glossary terms. Gated on a localStorage flag
// so it never shows again once dismissed (or once auto-dismissed by a
// ticker load). localStorage access is wrapped in try/catch to match the
// theme-preference pattern in main.js, since it can throw in some
// browser contexts (private mode, disabled storage, sandboxed iframes).

const TOUR_SEEN_KEY = "vw_tour_seen";

function hasSeenTour() {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function markTourSeen() {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch (_) {
    /* per-viewer convenience only */
  }
}

export function initTour() {
  if (hasSeenTour()) return;

  const landing = document.getElementById("view-landing");
  if (!landing) return;

  const banner = document.createElement("div");
  banner.className = "tour-banner";
  banner.setAttribute("role", "note");
  banner.innerHTML = `
    <button type="button" class="tour-dismiss" aria-label="Dismiss tour">&times;</button>
    <p><strong>New here?</strong> Type any US ticker in the search box above to build its dossier.</p>
    <p>Or try one of the example chips below to see one right away.</p>
    <p>Terms with a <span class="tour-sample-term">dotted underline</span> are hoverable (or tappable on mobile) — plain-language definitions, no jargon.</p>
  `;

  banner.querySelector(".tour-dismiss").addEventListener("click", () => {
    banner.remove();
    markTourSeen();
  });

  landing.prepend(banner);
}
