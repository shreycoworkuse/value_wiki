// Placeholder — replaced by rule-based narrative/event detection currently
// being built. Kept here so js/money-flow.js's import graph stays valid
// while that work lands.
export function detectNarrativeEvents() {
  return [];
}

export function renderNarrative(container, events) {
  container.innerHTML = events.length ? "" : "";
}
