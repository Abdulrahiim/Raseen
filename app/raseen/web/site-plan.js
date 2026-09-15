import { outputColour, headroomColour, etaColour, cssVar } from "/rs/colour.js";
import { fmt } from "/rs/format.js";

/** Colour of block i for the chosen map mode. `frame` may be null (clear day: all at capacity). */
export function blockColour(mode, frame, i, controller, cap) {
  if (!frame) return mode === "output" ? outputColour(1) : cssVar("--surface-3");
  const P = frame[`P_${controller}`] ?? frame.P_bgc;
  if (mode === "headroom") return headroomColour(Math.max(0, frame.A[i] - P[i]) / cap, Boolean(frame.firm?.[i]));
  if (mode === "eta") return etaColour(frame.eta?.[i] ?? null);
  return outputColour(Math.max(0, P[i]) / cap);
}

/** Tooltip / inspector rows for block i. All values are simulated; without a frame only the capacity is known. */
export function blockRows(frame, i, controller, cap, label) {
  if (!frame) return [{ name: "Capacity", value: `${fmt(cap, 0)} MW` }, { name: "State", value: "clear day (no scenario)" }];
  const P = frame[`P_${controller}`] ?? frame.P_bgc;
  const eta = frame.eta?.[i] ?? null;
  return [
    { name: "Available", value: `${fmt(frame.A[i], 0)} MW` },
    { name: "Set-point", value: `${fmt(P[i], 0)} MW` },
    { name: "Headroom", value: `${fmt(Math.max(0, frame.A[i] - P[i]), 0)} MW${frame.firm?.[i] ? " · firm" : ""}` },
    { name: "Cloud ETA", value: eta === null ? "none" : eta <= 0 ? "reached" : `+${fmt(eta, 1)} min` },
    { name: "Coverage", value: `${fmt((frame.coverage?.[i] ?? 0) * 100, 0)} %` },
  ];
}

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}) => { const n = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const HULL_STROKE = "#8fbaea", HULL_STROKE_SELECTED = "#ffffff";

/** Same geometry as the satellite map, drawn as SVG in local metres. Works offline. */
export class SitePlan {
  constructor(container, site, { onSelect, onHover, onLeave } = {}) {
    this.container = container; this.site = site; this.onSelect = onSelect; this.onHover = onHover; this.onLeave = onLeave;
    this.mode = "output"; this.controller = "bgc"; this.frame = null; this.polys = []; this.cloudGroup = null; this.labels = []; this.selected = null;
    const lat0 = (site.bounds.south + site.bounds.north) / 2, lon0 = (site.bounds.west + site.bounds.east) / 2;
    const mlat = 111320, mlon = 111320 * Math.cos((lat0 * Math.PI) / 180);
    this.xy = (lon, lat) => [(lon - lon0) * mlon, -(lat - lat0) * mlat];   // y down for SVG
  }
  static available() { return true; }
  async init() {
    const pts = this.site.mvps.map((p) => this.xy(p.lon, p.lat));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const pad = 400;
    const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad, w = Math.max(...xs) - minX + pad, h = Math.max(...ys) - minY + pad;
    const svg = el("svg", { viewBox: `${minX} ${minY} ${w} ${h}`, role: "img", "aria-label": "Plant plan, as-designed" });
    svg.append(el("rect", { x: minX, y: minY, width: w, height: h, fill: "#0f1216" }));
    for (const line of this.site.lines) {
      const d = line.pts.map(([lat, lon], i) => `${i ? "L" : "M"}${this.xy(lon, lat).join(",")}`).join("");
      svg.append(el("path", { d, fill: "none", stroke: "#3a404b", "stroke-width": 6 }));
    }
    const hulls = el("g");
    this.site.blocks.forEach((b, i) => {
      const poly = el("polygon", { points: b.hull.map(([lon, lat]) => this.xy(lon, lat).join(",")).join(" "), fill: "#2c3a4d", "fill-opacity": 0.75, stroke: HULL_STROKE, "stroke-width": 12, "data-block": b.id, tabindex: 0, role: "button", "aria-label": `Block ${b.id}` });
      poly.addEventListener("click", () => this.onSelect?.(b.id));
      poly.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.onSelect?.(b.id); } });
      poly.addEventListener("mousemove", (e) => this.onHover?.(e, i));
      poly.addEventListener("mouseleave", (e) => this.onLeave?.(e));
      hulls.append(poly); this.polys.push(poly);
      const [cx, cy] = this.xy(b.centroid[0], b.centroid[1]);
      const t = el("text", { x: cx, y: cy, "text-anchor": "middle", fill: "#fff", "font-size": 140, "font-family": "monospace", "font-weight": 600, "pointer-events": "none" });
      t.textContent = b.id; hulls.append(t); this.labels.push(t);
    });
    svg.append(hulls);
    this.cloudGroup = el("g", { fill: "rgba(200,205,215,0.35)", stroke: "rgba(220,225,235,0.8)", "stroke-width": 10 });
    svg.append(this.cloudGroup);
    for (const p of this.site.mvps) { const [x, y] = this.xy(p.lon, p.lat); svg.append(el("circle", { cx: x, cy: y, r: 22, fill: "#cfe3fb", "pointer-events": "none" })); }
    for (const z of this.site.zones) { const [x, y] = this.xy(z.lon, z.lat); const t = el("text", { x, y, fill: "#dfe6f0", "font-size": 170, "font-family": "monospace", "pointer-events": "none" }); t.textContent = z.name; svg.append(t); }
    const wrap = document.createElement("div"); wrap.className = "map-fallback"; wrap.append(svg);
    // Fit the plan inside the map box (the site is taller than wide); preserveAspectRatio keeps it centred.
    wrap.style.height = "100%"; wrap.style.boxSizing = "border-box";
    svg.style.width = "100%"; svg.style.height = "100%";
    this.container.replaceChildren(wrap); this.svg = svg;
    this.paint();
    return true;
  }
  setMode(mode) { this.mode = mode; this.paint(); }
  setFrame(frame, controller) { this.frame = frame; this.controller = controller ?? this.controller; this.paint(); }
  clear() { this.frame = null; this.paint(); }
  select(id) { this.selected = id ?? null; this.paintSelection(); }
  paintSelection() {
    for (const poly of this.polys) {
      const on = poly.dataset.block === this.selected;
      poly.setAttribute("stroke", on ? HULL_STROKE_SELECTED : HULL_STROKE);
      poly.setAttribute("stroke-width", on ? 26 : 12);
    }
  }
  paint() {
    if (!this.polys.length) return;
    this.site.blocks.forEach((b, i) => {
      this.polys[i].setAttribute("fill", blockColour(this.mode, this.frame, i, this.controller, b.capacity_mw));
      const P = this.frame ? (this.frame[`P_${this.controller}`] ?? this.frame.P_bgc)[i] : b.capacity_mw;
      this.labels[i].textContent = `${b.id} ${fmt(P, 0)}`;
    });
    this.cloudGroup.replaceChildren();
    for (const poly of this.frame?.cloud ?? []) {
      this.cloudGroup.append(el("polygon", { points: poly.map(([lon, lat]) => this.xy(lon, lat).join(",")).join(" ") }));
    }
  }
  flyToBlock(id) { const poly = this.polys.find((p) => p.dataset.block === id); poly?.focus?.(); }
  fitPlant() {}
  resize() {}
  destroy() { this.container.replaceChildren(); this.polys = []; this.labels = []; this.cloudGroup = null; this.svg = null; }
}
