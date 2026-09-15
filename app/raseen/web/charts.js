/* Inline-SVG charts for the Gradient Control page. No dependencies.

   Two drawings carry the whole argument, so both are built to be read rather than admired:
   a time series of the connection point with the held headroom shaded between available and
   export, and the 30 block set-points with the headroom stacked on top of each bar. The time
   series is also the transport control — you drag on the plot itself — because the cursor and
   the scrubber were always the same idea wearing two hats. */
import { cssVar } from "/rs/colour.js";
import { fmt } from "/rs/format.js";

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const text = (s, attrs) => {
  const n = el("text", attrs);
  n.textContent = s;
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

/* Dragging outlives any one render. Each seek redraws the plot, which replaces the very rect
   the pointer went down on, so drag state cannot live in that render's closure — it used to,
   and the drag died on the first frame while a per-render mouseup listener piled up unfired.
   The geometry of the live chart is held here instead, and the window carries the pointer. */
let drag = null;
const indexOf = ({ mount, pad, width, n }, event) => {
  const box = mount.getBoundingClientRect();
  if (!box.width) return 0;
  const plot = box.width * ((width - pad.left - pad.right) / width);
  const ratio = (event.clientX - box.left - (pad.left / width) * box.width) / plot;
  return Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
};
addEventListener("mousemove", (e) => { if (drag) drag.onSeek(indexOf(drag, e)); });
addEventListener("mouseup", () => { drag = null; });

/** Time series with shaded bands, event markers, and a cursor you can drag.
 *
 *  `onSeek(i)` is called on click and throughout a drag; the caller pauses playback and
 *  re-renders, which is what makes the plot itself the timeline.
 */
export function lineChart(mount, opts) {
  const { x, series, bands = [], markers = [], cursorIndex = null, onHover, onLeave, onSeek } = opts;
  const width = Math.max(mount.clientWidth || 860, 320);
  const height = opts.height ?? 250;
  // The top band is a lane for the event markers, so their labels never sit on the data.
  const pad = { top: 42, right: 16, bottom: 26, left: 56 };
  const n = x.length;
  const values = series.flatMap((s) => s.values).concat(bands.flatMap((b) => b.upper)).filter(Number.isFinite);
  let lo = opts.yMin ?? Math.min(0, ...values);
  let hi = opts.yMax ?? Math.max(...values);
  if (lo === hi) hi = lo + 1;
  hi *= 1.04;
  const X = (i) => pad.left + (i / Math.max(1, n - 1)) * (width - pad.left - pad.right);
  const Y = (v) => height - pad.bottom - ((v - lo) / (hi - lo)) * (height - pad.top - pad.bottom);
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": opts.label || "power over the event" });

  for (const tick of niceTicks(lo, hi)) {
    svg.append(el("line", { class: "rs-grid-line", x1: pad.left, x2: width - pad.right, y1: Y(tick), y2: Y(tick) }));
    svg.append(text(fmt(tick, 0), { class: "rs-axis-text", x: pad.left - 8, y: Y(tick) + 3.5, "text-anchor": "end" }));
  }
  if (opts.yLabel) svg.append(text(opts.yLabel, { class: "rs-axis-text", x: pad.left - 8, y: pad.top - 6, "text-anchor": "end" }));

  // The end labels anchor inward: centred on the last tick, the text hangs off the plot and is
  // clipped by the viewBox at narrow widths.
  const ticks = [...new Set([0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n - 1])];
  for (const i of ticks) {
    const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
    svg.append(text(`${x[i] >= 0 ? "+" : "−"}${fmt(Math.abs(x[i]), 0)} min`, { class: "rs-axis-text", x: X(i), y: height - 8, "text-anchor": anchor }));
  }
  for (const b of bands) {
    const up = b.upper.map((v, i) => `${X(i)},${Y(v)}`);
    const down = b.lower.map((v, i) => `${X(i)},${Y(v)}`).reverse();
    svg.append(el("polygon", { points: [...up, ...down].join(" "), fill: b.color, opacity: b.opacity ?? 0.22 }));
  }
  // Markers share a two-row lane: on a narrow chart two events can land within a few pixels
  // of each other, and one label printed over another is worse than no label at all.
  const rowRight = [-Infinity, -Infinity];
  for (const m of [...markers].sort((a, b) => a.x - b.x)) {
    const i = x.findIndex((t) => t >= m.x);
    if (i < 0) continue;
    const mx = X(i);
    svg.append(el("line", { class: "rs-marker-line", x1: mx, x2: mx, y1: pad.top - 16, y2: height - pad.bottom }));
    // Anchor away from whichever edge is closer, so a label at either end stays on the page.
    const w = m.label.length * 5.4;
    const near = mx > width - pad.right - w ? "end" : mx < pad.left + w ? "start" : "middle";
    const left = near === "end" ? mx - w : near === "start" ? mx : mx - w / 2;
    const row = left > rowRight[0] + 8 ? 0 : 1;
    rowRight[row] = left + w;
    const dx = near === "end" ? -4 : near === "start" ? 4 : 0;
    svg.append(text(m.label, { class: "rs-marker-text", x: mx + dx, y: pad.top - (row ? 15 : 27), "text-anchor": near }));
  }
  for (const s of series) {
    const points = s.values.map((v, i) => (Number.isFinite(v) ? `${X(i)},${Y(v)}` : null)).filter(Boolean).join(" ");
    svg.append(el("polyline", {
      class: "rs-series-line", points, stroke: s.color,
      "stroke-width": s.width ?? 2, "stroke-dasharray": s.dashed ? "5 4" : "none",
      opacity: s.fade ? 0.55 : 1,
    }));
  }

  // The cursor: a rule, a handle in the gutter, and a dot on every series at that instant,
  // so the readout strip and the plot always agree about which moment is on screen.
  if (cursorIndex !== null) {
    const cx = X(cursorIndex);
    svg.append(el("line", { class: "rs-cursor-line", x1: cx, x2: cx, y1: pad.top - 4, y2: height - pad.bottom }));
    for (const s of series) {
      const v = s.values[cursorIndex];
      if (!Number.isFinite(v) || s.dashed) continue;
      svg.append(el("circle", { cx, cy: Y(v), r: 3.2, fill: s.color, stroke: "#fff", "stroke-width": 1.4 }));
    }
    svg.append(el("path", { class: "rs-cursor-knob", d: `M ${cx - 5} ${pad.top - 11} h 10 l -5 8 Z` }));
  }

  const hit = el("rect", {
    x: pad.left, y: pad.top - 11, width: Math.max(1, width - pad.left - pad.right),
    height: Math.max(1, height - pad.top - pad.bottom + 11), fill: "transparent",
    style: onSeek ? "cursor:ew-resize" : "cursor:crosshair",
  });
  // Measured against the mount, never the SVG: seeking rebuilds the SVG on every frame, and a
  // detached element reports a zero-sized box.
  const geom = { mount, pad, width, n, onSeek };
  const indexAt = (event) => indexOf(geom, event);
  hit.addEventListener("mousemove", (e) => { if (!drag) onHover?.(indexAt(e), e); });
  hit.addEventListener("mouseleave", () => onLeave?.());
  if (onSeek) hit.addEventListener("mousedown", (e) => { drag = geom; onSeek(indexAt(e)); e.preventDefault(); });
  svg.append(hit);
  mount.replaceChildren(svg);
}

/** 30 bars, one per control block: teal fill is the set-point, the amber cap is the power
 *  the sun is offering, and the slate stack between them is headroom being held — solid
 *  where the cloud is still more than the reserve horizon away (so it can still be spent),
 *  pale where it will expire under the cloud before anyone can use it.
 *
 *  A block whose set-point rose since the previous frame is marked: that is the mechanism
 *  happening, one block at a time.
 */
export function blockGradient(mount, blocks, frame, opts = {}) {
  const { controller = "bgc", order = "eta", selected = null, horizon = 5, prev = null, onSelect, onHover, onLeave } = opts;
  const width = Math.max(mount.clientWidth || 860, 320);
  const height = 224;
  const pad = { top: 26, bottom: 26, left: 8, right: 8 };
  const P = frame ? frame[`P_${controller}`] ?? frame.P_bgc : null;
  const prevP = prev ? prev[`P_${controller}`] ?? prev.P_bgc : null;
  const idx = blocks.map((_, i) => i);
  if (frame && order === "eta") idx.sort((a, b) => (frame.eta[a] ?? 1e9) - (frame.eta[b] ?? 1e9) || a - b);
  const capMax = Math.max(...blocks.map((b) => b.capacity_mw));
  const slot = (width - pad.left - pad.right) / blocks.length;
  const bw = slot * 0.76;
  const H = height - pad.top - pad.bottom;
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "set-point per control block ordered by cloud arrival" });
  const violet = cssVar("--violet"), violetDim = cssVar("--violet-dim") || "#b3c6d4";
  const accent = cssVar("--accent"), amber = cssVar("--amber"), deep = cssVar("--pb-deep") || "#3f6354";

  idx.forEach((i, slotIndex) => {
    const b = blocks[i];
    const x = pad.left + slotIndex * slot + (slot - bw) / 2;
    const base = height - pad.bottom;
    const hCap = (b.capacity_mw / capMax) * H;
    const A = frame ? frame.A[i] : b.capacity_mw;
    const p = frame ? Math.min(A, P[i]) : b.capacity_mw;
    const hA = (A / capMax) * H, hP = (Math.max(0, p) / capMax) * H;
    const e = frame ? frame.eta[i] : null;
    const firm = e === null || e > horizon;      // derived, so the payload need not carry it
    const g = el("g", { class: "rs-bar", "data-block": b.id, style: "cursor:pointer" });
    g.append(el("rect", { x, y: base - hCap, width: bw, height: hCap, class: "rs-bar-cap" }));
    if (frame && A - p > 0.5) {
      g.append(el("rect", { x, y: base - hA, width: bw, height: hA - hP, fill: firm ? violet : violetDim, opacity: 0.92 }));
    }
    g.append(el("rect", { x, y: base - hP, width: bw, height: hP, fill: accent }));
    g.append(el("line", { x1: x, x2: x + bw, y1: base - hA, y2: base - hA, stroke: amber, "stroke-width": 2 }));
    if (frame && frame.coverage[i] > 0.05) {
      g.append(el("rect", { x, y: base - hCap, width: bw * frame.coverage[i], height: hCap, class: "rs-bar-cloud" }));
    }
    // Giving back: this block is covering someone else's loss right now.
    if (prevP && p > prevP[i] + 0.25) {
      g.append(el("path", { class: "rs-bar-rise", d: `M ${x + bw / 2} ${base - hP - 9} l 4 6 h -8 Z` }));
    }
    if (selected === b.id) {
      g.append(el("rect", { x: x - 2.5, y: base - hCap - 3, width: bw + 5, height: hCap + 6, fill: "none", stroke: deep, "stroke-width": 1.5, rx: 2 }));
    }
    g.append(text(b.id.replace("B", ""), { x: x + bw / 2, y: height - 10, "text-anchor": "middle", class: "rs-bar-id" }));
    if (frame) {
      g.append(text(e === null ? "—" : e <= 0 ? "●" : `${fmt(e, 0)}`, {
        x: x + bw / 2, y: pad.top - 9, "text-anchor": "middle",
        class: `rs-bar-eta ${e !== null && e <= 0 ? "is-here" : ""}`,
      }));
    }
    g.addEventListener("click", () => onSelect?.(b.id));
    g.addEventListener("mousemove", (ev) => onHover?.(i, ev));
    g.addEventListener("mouseleave", () => onLeave?.());
    svg.append(g);
  });
  svg.append(text(
    frame && order === "eta" ? "minutes until the cloud arrives, soonest on the left" : "control blocks, west to east",
    { x: pad.left, y: 11, class: "rs-axis-text" }
  ));
  mount.replaceChildren(svg);
}
