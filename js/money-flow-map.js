// Money flow map: renders one period's financial graph as a hand-rolled SVG
// sankey-ish diagram (sources -> flow chain -> uses) plus a balance-sheet
// reservoir panel, with click-to-trace drill-down into any node's history.
import { formatMoneyShort, formatPercent, renderLineChart } from "./charts.js";

const NS = "http://www.w3.org/2000/svg";

const IN_CATEGORIES = new Set(["source", "financing-source"]);
const MID_CATEGORIES = new Set(["flow-result", "bridge", "stock-delta"]);
const OUT_CATEGORIES = new Set(["operating-use", "investing-use", "financing-use"]);
const ASSET_CATEGORIES = new Set(["asset-stock"]);
const LIABEQ_CATEGORIES = new Set(["liability-stock", "equity-stock"]);

export function renderBusinessMap(container, ctx) {
  container.innerHTML = "";
  container.classList.add("money-flow-map");

  const graph = ctx.graph;
  if (!graph) {
    const p = document.createElement("p");
    p.className = "mfm-empty";
    p.textContent = "No data for this period.";
    container.appendChild(p);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "mfm-wrap";
  container.appendChild(wrap);

  const periodLabel = document.createElement("div");
  periodLabel.className = "mfm-period-label";
  periodLabel.textContent = graph.period ? graph.period.label : "";
  wrap.appendChild(periodLabel);

  const legend = document.createElement("div");
  legend.className = "mfm-legend";
  legend.innerHTML = `
    <span class="mfm-legend-item"><span class="mfm-swatch mfm-swatch-in"></span>Money in</span>
    <span class="mfm-legend-item"><span class="mfm-swatch mfm-swatch-mid"></span>Bridge / result</span>
    <span class="mfm-legend-item"><span class="mfm-swatch mfm-swatch-out"></span>Money out</span>
    <span class="mfm-legend-item"><span class="mfm-swatch mfm-swatch-neg"></span>Negative flow</span>
  `;
  wrap.appendChild(legend);

  const svgHost = document.createElement("div");
  svgHost.className = "mfm-flow-host";
  wrap.appendChild(svgHost);
  renderFlowDiagram(svgHost, graph);

  const reservoirHost = document.createElement("div");
  reservoirHost.className = "mfm-reservoirs";
  wrap.appendChild(reservoirHost);
  renderReservoirs(reservoirHost, graph);

  const drillHost = document.createElement("div");
  drillHost.className = "mfm-drilldown hidden";
  wrap.appendChild(drillHost);

  wrap.addEventListener("click", (e) => {
    const nodeEl = e.target.closest("[data-node-id]");
    if (!nodeEl) return;
    e.preventDefault();
    openDrilldown(drillHost, nodeEl.dataset.nodeId, nodeEl.dataset.nodeLabel, ctx);
  });
  wrap.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    const nodeEl = e.target.closest("[data-node-id]");
    if (!nodeEl) return;
    e.preventDefault();
    openDrilldown(drillHost, nodeEl.dataset.nodeId, nodeEl.dataset.nodeLabel, ctx);
  });
}

function computeColumnLayout(nodes, x, width) {
  const padTop = 16, gap = 12, minH = 26, maxH = 68;
  const items = nodes.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const maxAbs = Math.max(1, ...items.map((n) => Math.abs(n.value)));
  let y = padTop;
  const positions = {};
  items.forEach((n) => {
    const h = minH + (maxH - minH) * Math.sqrt(Math.abs(n.value) / maxAbs);
    positions[n.id] = {
      x, y, w: width, h,
      cx: x + width / 2, cy: y + h / 2,
      left: x, right: x + width, top: y, bottom: y + h,
      node: n,
    };
    y += h + gap;
  });
  return { positions, bottom: items.length ? y - gap + padTop : padTop + 40 };
}

function edgePath(a, b) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const startX = dx >= 0 ? a.right : a.left;
    const endX = dx >= 0 ? b.left : b.right;
    const startY = a.cy, endY = b.cy;
    const c = (endX - startX) / 2;
    return `M ${startX} ${startY} C ${startX + c} ${startY}, ${endX - c} ${endY}, ${endX} ${endY}`;
  }
  const startY = dy >= 0 ? a.bottom : a.top;
  const endY = dy >= 0 ? b.top : b.bottom;
  const startX = a.cx, endX = b.cx;
  const c = (endY - startY) / 2;
  return `M ${startX} ${startY} C ${startX} ${startY + c}, ${endX} ${endY - c}, ${endX} ${endY}`;
}

function edgeWidth(amount, maxAbsAmount) {
  const a = Math.abs(amount);
  if (maxAbsAmount <= 0) return 2;
  const t = Math.sqrt(a) / Math.sqrt(maxAbsAmount);
  return Math.max(1.5, Math.min(22, 1.5 + t * 20));
}

function edgeVar(fromCategory, toCategory) {
  if (IN_CATEGORIES.has(fromCategory)) return "--good";
  if (OUT_CATEGORIES.has(toCategory)) return "--flag";
  return "--watch";
}

function truncateLabel(label, w) {
  const maxChars = Math.max(6, Math.floor(w / 6.3));
  if (label.length <= maxChars) return label;
  return `${label.slice(0, maxChars - 1)}…`;
}

function renderNodeGroup(svgGroup, pos) {
  const g = document.createElementNS(NS, "g");
  g.setAttribute("class", "mfm-node");
  g.setAttribute("tabindex", "0");
  g.setAttribute("role", "button");
  g.setAttribute("data-node-id", pos.node.id);
  g.setAttribute("data-node-label", pos.node.label);
  g.setAttribute("aria-label", `${pos.node.label}: ${formatMoneyShort(pos.node.value)}. Show history.`);

  const rect = document.createElementNS(NS, "rect");
  rect.setAttribute("x", pos.x);
  rect.setAttribute("y", pos.y);
  rect.setAttribute("width", pos.w);
  rect.setAttribute("height", pos.h);
  rect.setAttribute("rx", 6);
  rect.setAttribute("class", `mfm-node-rect mfm-cat-${pos.node.category}`);
  g.appendChild(rect);

  const title = document.createElementNS(NS, "title");
  title.textContent = `${pos.node.label}: ${formatMoneyShort(pos.node.value)}`;
  g.appendChild(title);

  const labelText = document.createElementNS(NS, "text");
  labelText.setAttribute("x", pos.cx);
  labelText.setAttribute("y", pos.h > 34 ? pos.cy - 4 : pos.cy - 1);
  labelText.setAttribute("text-anchor", "middle");
  labelText.setAttribute("class", "mfm-node-label");
  labelText.textContent = truncateLabel(pos.node.label, pos.w);
  g.appendChild(labelText);

  if (pos.h > 34) {
    const valueText = document.createElementNS(NS, "text");
    valueText.setAttribute("x", pos.cx);
    valueText.setAttribute("y", pos.cy + 13);
    valueText.setAttribute("text-anchor", "middle");
    valueText.setAttribute("class", "mfm-node-value");
    valueText.textContent = formatMoneyShort(pos.node.value);
    g.appendChild(valueText);
  }

  svgGroup.appendChild(g);
}

function renderFlowDiagram(host, graph) {
  host.innerHTML = "";
  const nodes = graph.nodes.filter(
    (n) => !ASSET_CATEGORIES.has(n.category) && !LIABEQ_CATEGORIES.has(n.category)
  );
  if (!nodes.length) {
    const p = document.createElement("p");
    p.className = "mfm-empty";
    p.textContent = "No flow data for this period.";
    host.appendChild(p);
    return;
  }

  const inNodes = nodes.filter((n) => IN_CATEGORIES.has(n.category));
  const midNodes = nodes.filter((n) => MID_CATEGORIES.has(n.category));
  const outNodes = nodes.filter((n) => OUT_CATEGORIES.has(n.category));

  const colWidth = 168;
  const gapX = 40;
  const svgWidth = colWidth * 3 + gapX * 2 + 24;
  const colInX = 12;
  const colMidX = colInX + colWidth + gapX;
  const colOutX = colMidX + colWidth + gapX;

  const layIn = computeColumnLayout(inNodes, colInX, colWidth);
  const layMid = computeColumnLayout(midNodes, colMidX, colWidth);
  const layOut = computeColumnLayout(outNodes, colOutX, colWidth);

  const svgHeight = Math.max(layIn.bottom, layMid.bottom, layOut.bottom, 200) + 20;
  const positions = { ...layIn.positions, ...layMid.positions, ...layOut.positions };

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
  svg.setAttribute("class", "mfm-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Money flow diagram for ${graph.period ? graph.period.label : "this period"}`);

  const edgesGroup = document.createElementNS(NS, "g");
  edgesGroup.setAttribute("class", "mfm-edges");
  svg.appendChild(edgesGroup);

  const validEdges = (graph.edges || []).filter(
    (e) => positions[e.from] && positions[e.to] && e.from !== e.to
  );
  const maxAbsAmount = validEdges.reduce((m, e) => Math.max(m, Math.abs(e.amount)), 0);

  validEdges.forEach((e) => {
    const a = positions[e.from];
    const b = positions[e.to];
    const isNeg = e.amount < 0;
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", edgePath(a, b));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-width", String(edgeWidth(e.amount, maxAbsAmount)));
    path.setAttribute("class", `mfm-edge${isNeg ? " mfm-edge-negative" : ""}`);
    path.style.stroke = `var(${isNeg ? "--flag" : edgeVar(a.node.category, b.node.category)})`;
    const title = document.createElementNS(NS, "title");
    title.textContent = `${a.node.label} → ${b.node.label}: ${formatMoneyShort(e.amount)}`;
    path.appendChild(title);
    edgesGroup.appendChild(path);
  });

  const nodesGroup = document.createElementNS(NS, "g");
  nodesGroup.setAttribute("class", "mfm-nodes");
  svg.appendChild(nodesGroup);
  Object.values(positions).forEach((pos) => renderNodeGroup(nodesGroup, pos));

  host.appendChild(svg);
}

function renderReservoirRow(title, nodes) {
  const row = document.createElement("div");
  row.className = "mfm-reservoir-row";

  const label = document.createElement("div");
  label.className = "mfm-reservoir-row-title";
  label.textContent = title;
  row.appendChild(label);

  const bar = document.createElement("div");
  bar.className = "mfm-reservoir-bar";
  if (!nodes.length) {
    const empty = document.createElement("div");
    empty.className = "mfm-reservoir-empty";
    empty.textContent = "No data reported this period.";
    bar.appendChild(empty);
  } else {
    nodes
      .slice()
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .forEach((n) => {
        const seg = document.createElement("button");
        seg.type = "button";
        seg.className = `mfm-reservoir-seg mfm-cat-${n.category}`;
        seg.style.flexGrow = String(Math.max(Math.abs(n.value), 1));
        seg.dataset.nodeId = n.id;
        seg.dataset.nodeLabel = n.label;
        seg.title = `${n.label}: ${formatMoneyShort(n.value)}`;
        seg.setAttribute("aria-label", `${n.label}: ${formatMoneyShort(n.value)}. Show history.`);
        seg.innerHTML = `<span class="mfm-reservoir-seg-label">${n.label}</span><span class="mfm-reservoir-seg-value">${formatMoneyShort(n.value)}</span>`;
        bar.appendChild(seg);
      });
  }
  row.appendChild(bar);
  return row;
}

function renderReservoirs(host, graph) {
  host.innerHTML = "";
  const assets = graph.nodes.filter((n) => ASSET_CATEGORIES.has(n.category));
  const liabEq = graph.nodes.filter((n) => LIABEQ_CATEGORIES.has(n.category));
  if (!assets.length && !liabEq.length) return;

  const heading = document.createElement("div");
  heading.className = "mfm-reservoirs-heading";
  heading.textContent = "Balance sheet, period-end";
  host.appendChild(heading);

  host.appendChild(renderReservoirRow("What it owns", assets));
  host.appendChild(renderReservoirRow("What it owes + owners’ stake", liabEq));
}

function lastNonNull(arr) {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return arr[i];
  }
  return null;
}

function openDrilldown(host, nodeId, nodeLabel, ctx) {
  const history = ctx.getNodeHistory(nodeId);
  host.classList.remove("hidden");
  host.innerHTML = "";

  const head = document.createElement("div");
  head.className = "mfm-drilldown-head";
  const h = document.createElement("h4");
  h.textContent = (history && history.label) || nodeLabel || nodeId;
  head.appendChild(h);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "mfm-drilldown-close";
  closeBtn.setAttribute("aria-label", "Close history panel");
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => {
    host.classList.add("hidden");
    host.innerHTML = "";
  });
  head.appendChild(closeBtn);
  host.appendChild(head);

  if (!history || !history.values || !history.values.length) {
    const p = document.createElement("p");
    p.className = "mfm-drilldown-empty";
    p.textContent = "No history available for this item.";
    host.appendChild(p);
    return;
  }

  const lastGrowth = lastNonNull(history.growth);
  const lastRatio = lastNonNull(history.ratioToRevenue);
  const stat = document.createElement("div");
  stat.className = "mfm-drilldown-stat";
  stat.textContent = `Latest growth: ${lastGrowth == null ? "—" : formatPercent(lastGrowth)} · Latest vs. revenue: ${lastRatio == null ? "—" : formatPercent(lastRatio)}`;
  host.appendChild(stat);

  const chartWrap = document.createElement("div");
  chartWrap.className = "mfm-drilldown-chart";
  const canvas = document.createElement("canvas");
  chartWrap.appendChild(canvas);
  host.appendChild(chartWrap);

  const labels = ctx.unified.periods.map((p) => p.label);
  const values = history.values.map((v) => v.value);
  renderLineChart(canvas, labels, values, { kind: "currency", colorVar: "--accent" });

  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
