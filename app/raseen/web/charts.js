/* Inline-SVG charts for the Gradient Control page. No dependencies.

   Two drawings carry the whole argument, so both are built to be read rather than admired:
   a time series of the connection point with the held headroom shaded between available and
   export, and the set-points of the plant — the 363 MV power stations grouped under the 30
   control blocks the controller dispatches, or the 30 blocks alone — with the headroom stacked
   on top of each bar. The time series is also the transport control — you drag on the plot
   itself — because the cursor and the scrubber were always the same idea wearing two hats. */
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
  // so the readout strip and the plot always agree about which moment is on screen. The
  // dot's halo is the panel colour, so it reads on either theme.
  if (cursorIndex !== null) {
    const cx = X(cursorIndex);
    const halo = cssVar("--pb-card") || "#fff";
    svg.append(el("line", { class: "rs-cursor-line", x1: cx, x2: cx, y1: pad.top - 4, y2: height - pad.bottom }));
    for (const s of series) {
      const v = s.values[cursorIndex];
      if (!Number.isFinite(v) || s.dashed) continue;
      svg.append(el("circle", { cx, cy: Y(v), r: 3.2, fill: s.color, stroke: halo, "stroke-width": 1.4 }));
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

/** One bar per control block, or one thin bar per station grouped under its block: teal fill
 *  is the set-point, the amber cap is the power the sun is offering, and the slate stack
 *  between them is headroom being held — solid where the cloud is still more than the
 *  reserve horizon away (so it can still be spent), pale where it will expire under the
 *  cloud before anyone can use it.
 *
 *  A block whose set-point rose since the previous frame is marked: that is the mechanism
 *  happening, one block at a time.
 *
 *  `opts.grain` is "blocks" or "stations"; the stations view needs `opts.stations`, the
 *  site's `{ mvps, index, mw }` (the stations, which block each is in, and the rating of
 *  one). A station is drawn at its block's share: the controller dispatches blocks, so the
 *  stations in a block share its set-point, and the per-station cover is not carried in the
 *  frames — the block's is.
 */
export function blockGradient(mount, blocks, frame, opts = {}) {
  const { controller = "bgc", order = "eta", selected = null, horizon = 5, prev = null, grain = "blocks", stations = null, onSelect, onHover, onLeave } = opts;
  const width = Math.max(mount.clientWidth || 860, 320);
  const height = 224;
  const pad = { top: 26, bottom: 26, left: 8, right: 8 };
  const P = frame ? frame[`P_${controller}`] ?? frame.P_bgc : null;
  const prevP = prev ? prev[`P_${controller}`] ?? prev.P_bgc : null;
  const idx = blocks.map((_, i) => i);
  if (frame && order === "eta") idx.sort((a, b) => (frame.eta[a] ?? 1e9) - (frame.eta[b] ?? 1e9) || a - b);
  const H = height - pad.top - pad.bottom;
  const violet = cssVar("--violet"), violetDim = cssVar("--violet-dim") || "#b3c6d4";
  const accent = cssVar("--accent"), amber = cssVar("--amber"), deep = cssVar("--pb-deep-text") || "#3f6354";
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `set-point per ${grain === "stations" ? "station" : "control block"} ordered by ${order === "eta" ? "cloud arrival" : "position"}` });

  if (grain === "stations" && stations && stations.index) {
    drawStations(svg, { blocks, frame, P, prevP, idx, width, height, pad, H, horizon, selected, stations, colours: { violet, violetDim, accent, amber, deep }, onSelect, onHover, onLeave });
  } else {
    drawBlocks(svg, { blocks, frame, P, prevP, idx, width, height, pad, H, horizon, selected, colours: { violet, violetDim, accent, amber, deep }, onSelect, onHover, onLeave });
  }
  svg.append(text(
    frame && order === "eta" ? "minutes until the cloud arrives, soonest on the left" : (grain === "stations" ? "stations by control block, west to east" : "control blocks, west to east"),
    { x: pad.left, y: 11, class: "rs-axis-text" }
  ));
  mount.replaceChildren(svg);
}

/* The 30 blocks, one bar each. Unchanged from the page's first version. */
function drawBlocks(svg, g) {
  const { blocks, frame, P, prevP, idx, height, pad, H, horizon, selected, colours, onSelect, onHover, onLeave } = g;
  const { violet, violetDim, accent, amber, deep } = colours;
  const capMax = Math.max(...blocks.map((b) => b.capacity_mw));
  const slot = (g.width - pad.left - pad.right) / blocks.length;
  const bw = slot * 0.76;
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
    const grp = el("g", { class: "rs-bar", "data-block": b.id, style: "cursor:pointer" });
    grp.append(el("rect", { x, y: base - hCap, width: bw, height: hCap, class: "rs-bar-cap" }));
    if (frame && A - p > 0.5) {
      grp.append(el("rect", { x, y: base - hA, width: bw, height: hA - hP, fill: firm ? violet : violetDim, opacity: 0.92 }));
    }
    grp.append(el("rect", { x, y: base - hP, width: bw, height: hP, fill: accent }));
    grp.append(el("line", { x1: x, x2: x + bw, y1: base - hA, y2: base - hA, stroke: amber, "stroke-width": 2 }));
    if (frame && frame.coverage[i] > 0.05) {
      grp.append(el("rect", { x, y: base - hCap, width: bw * frame.coverage[i], height: hCap, class: "rs-bar-cloud" }));
    }
    // Giving back: this block is covering someone else's loss right now.
    if (prevP && p > prevP[i] + 0.25) {
      grp.append(el("path", { class: "rs-bar-rise", d: `M ${x + bw / 2} ${base - hP - 9} l 4 6 h -8 Z` }));
    }
    if (selected === b.id) {
      grp.append(el("rect", { x: x - 2.5, y: base - hCap - 3, width: bw + 5, height: hCap + 6, fill: "none", stroke: deep, "stroke-width": 1.5, rx: 2 }));
    }
    grp.append(text(b.id.replace("B", ""), { x: x + bw / 2, y: height - 10, "text-anchor": "middle", class: "rs-bar-id" }));
    if (frame) {
      grp.append(text(e === null ? "—" : e <= 0 ? "●" : `${fmt(e, 0)}`, {
        x: x + bw / 2, y: pad.top - 9, "text-anchor": "middle",
        class: `rs-bar-eta ${e !== null && e <= 0 ? "is-here" : ""}`,
      }));
    }
    grp.addEventListener("click", () => onSelect?.(b.id));
    grp.addEventListener("mousemove", (ev) => onHover?.(i, ev));
    grp.addEventListener("mouseleave", () => onLeave?.());
    svg.append(grp);
  });
}

//: Gap between one block's stations and the next, so the grouping reads without lines.
const GROUP_GAP = 4;

/* The 363 stations, drawn as a skyline. There are too many bars for one element each at
   replay speed, so every quantity is one path — all the caps, all the firm headroom, all the
   expiring headroom, all the set-points, all the amber tops — and the pointer is resolved by
   geometry: the x position under it names the station and the block. Labels, cover and the
   rise mark are per block, once. */
function drawStations(svg, g) {
  const { blocks, frame, P, prevP, idx, width, height, pad, H, horizon, selected, stations, colours, onSelect, onHover, onLeave } = g;
  const { violet, violetDim, accent, amber, deep } = colours;
  const members = blocks.map(() => []);
  stations.index.forEach((b, m) => { if (b >= 0 && members[b]) members[b].push(m); });
  for (const list of members) list.sort((a, b) => stations.mvps[a].n - stations.mvps[b].n);
  const total = stations.index.length;
  const usable = width - pad.left - pad.right - GROUP_GAP * (blocks.length - 1);
  const slot = usable / Math.max(1, total);
  const bw = Math.max(1, slot - Math.min(0.8, slot * 0.22));
  const base = height - pad.bottom;
  const mw = stations.mw;

  const caps = [], firmHead = [], dimHead = [], sets = [], tops = [];
  const groups = [];      // [x0, x1, blockIndex] for hit-testing and labels
  const cells = [];       // [x0, x1, blockIndex, stationNumber]
  let x = pad.left;
  for (const i of idx) {
    const b = blocks[i];
    const list = members[i];
    const x0 = x;
    const cap = b.capacity_mw;
    const A = frame ? frame.A[i] : cap;
    const p = frame ? Math.min(A, P[i]) : cap;
    // The block's share, per station: the controller dispatches blocks.
    const hA = (A / cap) * H, hP = (Math.max(0, p) / cap) * H;
    const e = frame ? frame.eta[i] : null;
    const firm = e === null || e > horizon;
    for (const m of list) {
      const bx = x + (slot - bw) / 2;
      caps.push(`M${bx.toFixed(2)} ${(base - H).toFixed(2)}h${bw.toFixed(2)}v${H.toFixed(2)}h-${bw.toFixed(2)}Z`);
      if (frame && A - p > 0.5) {
        (firm ? firmHead : dimHead).push(`M${bx.toFixed(2)} ${(base - hA).toFixed(2)}h${bw.toFixed(2)}v${(hA - hP).toFixed(2)}h-${bw.toFixed(2)}Z`);
      }
      sets.push(`M${bx.toFixed(2)} ${(base - hP).toFixed(2)}h${bw.toFixed(2)}v${hP.toFixed(2)}h-${bw.toFixed(2)}Z`);
      tops.push(`M${bx.toFixed(2)} ${(base - hA).toFixed(2)}h${bw.toFixed(2)}`);
      cells.push([x, x + slot, i, stations.mvps[m].n]);
      x += slot;
    }
    const x1 = x;
    groups.push([x0, x1, i, { A, p, hP, e, list: list.length, mwEach: mw }]);
    x += GROUP_GAP;
  }
  svg.append(el("path", { d: caps.join(""), class: "rs-bar-cap" }));
  if (firmHead.length) svg.append(el("path", { d: firmHead.join(""), fill: violet, opacity: 0.92 }));
  if (dimHead.length) svg.append(el("path", { d: dimHead.join(""), fill: violetDim, opacity: 0.92 }));
  svg.append(el("path", { d: sets.join(""), fill: accent }));
  svg.append(el("path", { d: tops.join(""), stroke: amber, "stroke-width": 2, fill: "none" }));

  for (const [x0, x1, i, info] of groups) {
    const b = blocks[i];
    const w = x1 - x0;
    if (frame && frame.coverage[i] > 0.05) {
      svg.append(el("rect", { x: x0, y: base - H, width: w * frame.coverage[i], height: H, class: "rs-bar-cloud" }));
    }
    if (prevP && info.p > prevP[i] + 0.25) {
      svg.append(el("path", { class: "rs-bar-rise", d: `M ${x0 + w / 2} ${base - info.hP - 9} l 4 6 h -8 Z` }));
    }
    if (selected === b.id) {
      svg.append(el("rect", { x: x0 - 2, y: base - H - 3, width: w + 4, height: H + 6, fill: "none", stroke: deep, "stroke-width": 1.5, rx: 2 }));
    }
    // A group narrower than its label goes unlabelled rather than overprinted.
    if (w >= 16) svg.append(text(b.id.replace("B", ""), { x: x0 + w / 2, y: height - 10, "text-anchor": "middle", class: "rs-bar-id" }));
    if (frame && w >= 16) {
      const e = info.e;
      svg.append(text(e === null ? "—" : e <= 0 ? "●" : `${fmt(e, 0)}`, {
        x: x0 + w / 2, y: pad.top - 9, "text-anchor": "middle",
        class: `rs-bar-eta ${e !== null && e <= 0 ? "is-here" : ""}`,
      }));
    }
  }

  // One transparent plate takes the pointer; the station under it is found from x.
  const hit = el("rect", { x: pad.left, y: pad.top - 14, width: Math.max(1, width - pad.left - pad.right), height: Math.max(1, height - pad.top - pad.bottom + 14), fill: "transparent", style: "cursor:pointer" });
  const cellAt = (event) => {
    const box = svg.getBoundingClientRect();
    if (!box.width) return null;
    const vx = ((event.clientX - box.left) / box.width) * width;
    return cells.find(([a, c]) => vx >= a && vx < c) || null;
  };
  hit.addEventListener("mousemove", (ev) => { const c = cellAt(ev); if (c) onHover?.(c[2], ev, c[3]); else onLeave?.(); });
  hit.addEventListener("mouseleave", () => onLeave?.());
  hit.addEventListener("click", (ev) => { const c = cellAt(ev); if (c) onSelect?.(blocks[c[2]].id); });
  svg.append(hit);
}
