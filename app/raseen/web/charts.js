/* Inline-SVG charts for the Gradient Control page: a time series with shaded bands and a
   cursor, and the 30-block gradient bars. No dependencies. */
import { cssVar } from "/rs/colour.js";
import { fmt } from "/rs/format.js";

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const rough = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) || magnitude;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

/** Line chart with optional shaded bands, event markers and a movable cursor. */
export function lineChart(mount, opts) {
  const { x, series, bands = [], markers = [], cursorIndex = null, onHover, onLeave, onClick } = opts;
  const width = Math.max(mount.clientWidth || 720, 320);
  const height = opts.height ?? 230;
  const pad = { top: 10, right: 14, bottom: 24, left: 50 };
  const n = x.length;
  const values = series.flatMap((s) => s.values).concat(bands.flatMap((b) => b.upper)).filter(Number.isFinite);
  let lo = opts.yMin ?? Math.min(0, ...values);
  let hi = opts.yMax ?? Math.max(...values);
  if (lo === hi) hi = lo + 1;
  hi *= 1.03;
  const X = (i) => pad.left + (i / Math.max(1, n - 1)) * (width - pad.left - pad.right);
  const Y = (v) => height - pad.bottom - ((v - lo) / (hi - lo)) * (height - pad.top - pad.bottom);
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "generation over the event" });

  for (const tick of niceTicks(lo, hi)) {
    svg.append(el("line", { class: "rs-grid-line", x1: pad.left, x2: width - pad.right, y1: Y(tick), y2: Y(tick) }));
    const label = el("text", { class: "rs-axis-text", x: pad.left - 6, y: Y(tick) + 3, "text-anchor": "end" });
    label.textContent = fmt(tick, 0);
    svg.append(label);
  }
  for (const i of [...new Set([0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n - 1])]) {
    const label = el("text", { class: "rs-axis-text", x: X(i), y: height - 7, "text-anchor": "middle" });
    label.textContent = `${x[i] >= 0 ? "+" : "−"}${fmt(Math.abs(x[i]), 0)}′`;
    svg.append(label);
  }
  for (const b of bands) {
    const up = b.upper.map((v, i) => `${X(i)},${Y(v)}`);
    const down = b.lower.map((v, i) => `${X(i)},${Y(v)}`).reverse();
    svg.append(el("polygon", { points: [...up, ...down].join(" "), fill: b.color, opacity: b.opacity ?? 0.22 }));
  }
  for (const m of markers) {
    const i = x.findIndex((t) => t >= m.x);
    if (i < 0) continue;
    svg.append(el("line", { class: "rs-marker-line", x1: X(i), x2: X(i), y1: pad.top, y2: height - pad.bottom }));
    const label = el("text", { class: "rs-marker-text", x: X(i) + 3, y: pad.top + 10 });
    label.textContent = m.label;
    svg.append(label);
  }
  for (const s of series) {
    const points = s.values.map((v, i) => (Number.isFinite(v) ? `${X(i)},${Y(v)}` : null)).filter(Boolean).join(" ");
    svg.append(el("polyline", { class: "rs-series-line", points, stroke: s.color, "stroke-width": s.width ?? 2, "stroke-dasharray": s.dashed ? "5 4" : "none" }));
  }
  const cursor = el("line", { class: "rs-cursor-line", x1: 0, x2: 0, y1: pad.top, y2: height - pad.bottom, opacity: cursorIndex === null ? 0 : 1 });
  if (cursorIndex !== null) {
    cursor.setAttribute("x1", X(cursorIndex));
    cursor.setAttribute("x2", X(cursorIndex));
  }
  svg.append(cursor);
  const hit = el("rect", { x: pad.left, y: pad.top, width: Math.max(1, width - pad.left - pad.right), height: Math.max(1, height - pad.top - pad.bottom), fill: "transparent", style: "cursor:crosshair" });
  const indexAt = (event) => {
    const box = svg.getBoundingClientRect();
    const ratio = (event.clientX - box.left - (pad.left / width) * box.width) / (box.width * (width - pad.left - pad.right) / width);
    return Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
  };
  hit.addEventListener("mousemove", (e) => onHover?.(indexAt(e), e));
  hit.addEventListener("mouseleave", () => onLeave?.());
  hit.addEventListener("click", (e) => onClick?.(indexAt(e)));
  svg.append(hit);
  mount.replaceChildren(svg);
}

/** 30 bars: fill = set-point, outline = available, headroom violet (firm) / dim (expiring),
    cloud hatch on covered blocks. Ordered by cloud arrival by default. */
export function blockGradient(mount, blocks, frame, opts = {}) {
  const { controller = "bgc", order = "eta", selected = null, onSelect, onHover, onLeave } = opts;
  const width = Math.max(mount.clientWidth || 720, 320);
  const height = 210;
  const pad = { top: 20, bottom: 24, left: 8, right: 8 };
  const P = frame ? frame[`P_${controller}`] ?? frame.P_bgc : null;
  const idx = blocks.map((_, i) => i);
  if (frame && order === "eta") idx.sort((a, b) => (frame.eta[a] ?? 1e9) - (frame.eta[b] ?? 1e9) || a - b);
  const capMax = Math.max(...blocks.map((b) => b.capacity_mw));
  const slot = (width - pad.left - pad.right) / blocks.length;
  const bw = slot * 0.78;
  const H = height - pad.top - pad.bottom;
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "set-point per control block ordered by cloud arrival" });
  const violet = cssVar("--violet"), violetDim = cssVar("--violet-dim") || "#5a5570", accent = cssVar("--accent"), amber = cssVar("--amber");
  idx.forEach((i, slotIndex) => {
    const b = blocks[i];
    const x = pad.left + slotIndex * slot + (slot - bw) / 2;
    const base = height - pad.bottom;
    const hCap = (b.capacity_mw / capMax) * H;
    const A = frame ? frame.A[i] : b.capacity_mw;
    const p = frame ? Math.min(A, P[i]) : b.capacity_mw;
    const hA = (A / capMax) * H, hP = (Math.max(0, p) / capMax) * H;
    const g = el("g", { class: "rs-bar", "data-block": b.id, style: "cursor:pointer" });
    g.append(el("rect", { x, y: base - hCap, width: bw, height: hCap, class: "rs-bar-cap" }));
    if (frame && A - p > 0.5) g.append(el("rect", { x, y: base - hA, width: bw, height: hA - hP, fill: frame.firm[i] ? violet : violetDim, opacity: 0.9 }));
    g.append(el("rect", { x, y: base - hP, width: bw, height: hP, fill: accent }));
    g.append(el("line", { x1: x, x2: x + bw, y1: base - hA, y2: base - hA, stroke: amber, "stroke-width": 2 }));
    if (frame && frame.coverage[i] > 0.05) g.append(el("rect", { x, y: base - hCap, width: bw * frame.coverage[i], height: hCap, fill: "#d0d5de", opacity: 0.35 }));
    if (selected === b.id) g.append(el("rect", { x: x - 2, y: base - hCap - 2, width: bw + 4, height: hCap + 4, fill: "none", stroke: "#fff", "stroke-width": 1.5 }));
    const id = el("text", { x: x + bw / 2, y: height - 9, "text-anchor": "middle", class: "rs-bar-id" });
    id.textContent = b.id.replace("B", "");
    g.append(id);
    if (frame) {
      const e = frame.eta[i];
      const top = el("text", { x: x + bw / 2, y: pad.top - 7, "text-anchor": "middle", class: `rs-bar-eta ${e !== null && e <= 0 ? "is-here" : ""}` });
      top.textContent = e === null ? "·" : e <= 0 ? "●" : `${fmt(e, 0)}′`;
      g.append(top);
    }
    g.addEventListener("click", () => onSelect?.(b.id));
    g.addEventListener("mousemove", (ev) => onHover?.(i, ev));
    g.addEventListener("mouseleave", () => onLeave?.());
    svg.append(g);
  });
  const cap = el("text", { x: pad.left, y: 10, class: "rs-axis-text" });
  cap.textContent = frame && order === "eta" ? "← cloud reaches first · ordered by arrival · minutes above" : "control blocks west → east";
  svg.append(cap);
  mount.replaceChildren(svg);
}
