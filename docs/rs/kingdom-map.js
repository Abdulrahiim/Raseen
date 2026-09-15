/* The Kingdom map: every renewable plant and the transmission backbone over a dark basemap,
   with a SVG fallback when tiles or WebGL are unavailable. */
import { TECH_COLOUR, STATUS_COLOUR, cssVar } from "./colour.js";
import { fmt } from "./format.js";

const DARK_TILES = window.RASEEN_TILES_DARK || "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const LABEL_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const ATTRIBUTION = "Basemap &copy; Esri, HERE, Garmin · plants and grid indicative";
export const KINGDOM_BOUNDS = [[34.4, 16.0], [55.8, 32.3]];

function tileUrls(template) {
  const m = template.match(/\{([a-z])-([a-z])\}/);
  if (!m) return [template];
  const from = m[1].charCodeAt(0), to = m[2].charCodeAt(0);
  return Array.from({ length: to - from + 1 }, (_, i) => template.replace(m[0], String.fromCharCode(from + i)));
}

/* ── marker geometry ───────────────────────────────────────────────────────────
   A plant is a crisp pin, not a blob: a small solid dot in the technology colour with a
   light stroke so it reads on the dark basemap, sitting inside a thin capacity ring in
   the status colour. The ring's radius and thickness carry capacity; nothing is filled
   translucently, so overlapping plants in the Riyadh and west-coast clusters stay
   countable instead of merging into one wash.

   Scale: sqrt of capacity (area-like perception), clamped at both ends so the smallest
   plant in the registry (43 MW) is still a legible ring and the 3,000 MW reference does
   not swallow its neighbours. Ring radii below are pixels at zoom 7; the MapLibre path
   interpolates them 0.85x at Kingdom zoom → 1.18x when zoomed in, while the pin dot keeps
   a constant size so it is always crisp. */
const REFERENCE_ID = "najm-3000";
const MW_FLOOR = 40, MW_CEIL = 3000;          // clamp: ends of the capacity scale
const RING_MIN = 7, RING_MAX = 17;            // capacity ring radius, px
const RING_W_MIN = 1.1, RING_W_MAX = 2.2;     // capacity ring thickness, px
const CORE_R = 3.2, CORE_R_REF = 4.4;         // the solid pin dot (constant, always crisp)
const CORE_W = 1.2, CORE_W_REF = 1.6;         // light stroke around the pin dot
const REF_GAP = 5, REF_W = 2.2;               // purple ring that marks the modelled plant
const HIT_MIN = 8, HIT_PAD = 0;               // invisible click/hover target

/** Position of a capacity on the clamped sqrt scale, 0 (smallest) .. 1 (3,000 MW). */
function capacityT(mw) {
  const lo = Math.sqrt(MW_FLOOR), hi = Math.sqrt(MW_CEIL);
  const v = Math.sqrt(Math.min(Math.max(Number(mw) || 0, MW_FLOOR), MW_CEIL));
  return (v - lo) / (hi - lo);
}
const ringRadius = (mw) => RING_MIN + (RING_MAX - RING_MIN) * capacityT(mw);
const ringWidth = (mw) => RING_W_MIN + (RING_W_MAX - RING_W_MIN) * capacityT(mw);
/** Click/hover target: the visible marker, never below HIT_MIN so a small pin stays grabbable.
    Deliberately NOT padded beyond the ring — a padded disc on a small plant reaches over a
    larger neighbour's pin, and whichever one then wins the hit reports the wrong plant. */
const hitRadius = (mw, reference = false) => Math.max(ringRadius(mw) + (reference ? REF_GAP + HIT_PAD : HIT_PAD), HIT_MIN);
/** Distance from the plant to the top of its label, so the text clears the whole marker. */
const labelGap = (p) => ringRadius(p.capacity_mw) + (p.id === REFERENCE_ID ? REF_GAP + REF_W : 0) + 5;

/** Marker colours live in kingdom.css so the dark-basemap palette stays in one place. */
const token = (name, fallback) => cssVar(name) || fallback;
const pinStroke = () => token("--rs-map-pin-stroke", "#f2f6fb");
const refPurple = () => token("--rs-map-ref", "#b98ce8");
const nodeFill = () => token("--rs-map-node", "#dfe7f2");
const mapInk = () => token("--rs-map-ink", "#0b0e13");

/** Biggest first, so small plants draw last and stay on top of their large neighbours —
    this is what keeps the Riyadh and west-coast clusters pickable. */
const bySizeDesc = (plants) => [...plants].sort((a, b) => b.capacity_mw - a.capacity_mw);

function plantsGeoJSON(plants) {
  return {
    type: "FeatureCollection",
    features: bySizeDesc(plants).map((p) => {
      const reference = p.id === REFERENCE_ID;
      const r = ringRadius(p.capacity_mw);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: {
          id: p.id, name: p.name_en, tech: p.technology, status: p.status, mw: p.capacity_mw,
          colour: TECH_COLOUR[p.technology],   // technology → pin dot fill
          ring: STATUS_COLOUR[p.status],       // status → capacity ring stroke
          reference,
          r,                                   // capacity ring radius
          rw: ringWidth(p.capacity_mw),        // capacity ring thickness
          cr: reference ? CORE_R_REF : CORE_R, // pin dot radius
          refr: r + REF_GAP,                   // purple reference ring radius
          hit: hitRadius(p.capacity_mw, reference), // click/hover target radius
        },
      };
    }),
  };
}

/** Radius that eases with zoom: tighter over the whole Kingdom, roomier once zoomed in.
    Written as a top-level zoom interpolation — MapLibre rejects ["zoom"] nested deeper. */
const byZoom = (prop) => ["interpolate", ["linear"], ["zoom"],
  4, ["*", ["get", prop], 0.85],
  7, ["get", prop],
  11, ["*", ["get", prop], 1.18]];

const PLANT_LAYERS = ["plants-ring", "plants-ref", "plants", "plants-hit"];

/* Where hit targets overlap, MapLibre hands back the last feature drawn — here the smallest
   plant, because we draw biggest-first so small pins stay visible. Pointing at a 2 GW pin and
   being told it is its 600 MW neighbour is a wrong readout, so resolve by distance instead. */
function nearestOf(map, features, point) {
  if (!features || !features.length) return null;
  if (features.length === 1) return features[0];
  let best = null, bestD = Infinity;
  for (const f of features) {
    const c = f.geometry?.coordinates;
    if (!c) continue;
    const q = map.project(c);
    const d = (q.x - point.x) ** 2 + (q.y - point.y) ** 2;
    if (d < bestD) { bestD = d; best = f; }
  }
  return best || features[0];
}
const REF_ONLY = ["==", ["get", "reference"], true];

export class KingdomMap {
  nearestFeature(e) { return nearestOf(this.map, e.features, e.point); }

  constructor(container, plants, grid, { onSelect, onHover, onLeave } = {}) {
    Object.assign(this, { container, plants, grid, onSelect, onHover, onLeave });
    this.map = null; this.markers = []; this.ready = false;
  }
  static available() {
    return typeof maplibregl !== "undefined" && (typeof maplibregl.supported !== "function" || maplibregl.supported());
  }
  async init() {
    if (!KingdomMap.available()) return false;
    this.map = new maplibregl.Map({
      container: this.container,
      style: {
        version: 8,
        sources: {
          base: { type: "raster", tiles: tileUrls(DARK_TILES), tileSize: 256, attribution: ATTRIBUTION, maxzoom: 16 },
          ref: { type: "raster", tiles: tileUrls(LABEL_TILES), tileSize: 256, maxzoom: 16 },
        },
        layers: [
          { id: "base", type: "raster", source: "base" },
          { id: "ref", type: "raster", source: "ref", paint: { "raster-opacity": 0.9 } },
        ],
      },
      bounds: KINGDOM_BOUNDS, fitBoundsOptions: { padding: 24 }, attributionControl: { compact: false },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    await new Promise((resolve) => { if (this.map.isStyleLoaded()) resolve(); else this.map.once("style.load", resolve); setTimeout(resolve, 8000); });
    if (!this.map.getStyle()) return false;

    this.map.addSource("grid", { type: "geojson", data: this.grid });
    this.map.addLayer({ id: "grid-glow", type: "line", source: "grid", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#6aa8ee", "line-width": ["match", ["get", "voltage_kv"], 380, 6, 2.5], "line-blur": 6, "line-opacity": 0.35 } });
    this.map.addLayer({ id: "grid-lines", type: "line", source: "grid", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": ["match", ["get", "voltage_kv"], 380, "#9fc3ee", "#f2a33a"], "line-width": ["match", ["get", "voltage_kv"], 380, 1.8, 1.2], "line-dasharray": [3, 2], "line-opacity": 0.9 } });
    this.map.addLayer({ id: "grid-nodes", type: "circle", source: "grid", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 2.8, "circle-color": nodeFill(), "circle-stroke-color": mapInk(), "circle-stroke-width": 1, "circle-opacity": 0.95 } });

    // Plants: capacity ring (status colour) → purple reference ring → pin dot (technology
    // colour) → an invisible, slightly larger circle that carries click and hover.
    this.map.addSource("plants", { type: "geojson", data: plantsGeoJSON(this.plants) });
    this.map.addLayer({ id: "plants-ring", type: "circle", source: "plants", paint: { "circle-radius": byZoom("r"), "circle-color": "#000", "circle-opacity": 0, "circle-stroke-color": ["get", "ring"], "circle-stroke-width": ["get", "rw"], "circle-stroke-opacity": 0.95 } });
    this.map.addLayer({ id: "plants-ref", type: "circle", source: "plants", filter: REF_ONLY, paint: { "circle-radius": byZoom("refr"), "circle-color": "#000", "circle-opacity": 0, "circle-stroke-color": refPurple(), "circle-stroke-width": REF_W, "circle-stroke-opacity": 0.95 } });
    this.map.addLayer({ id: "plants", type: "circle", source: "plants", paint: { "circle-radius": ["get", "cr"], "circle-color": ["get", "colour"], "circle-opacity": 1, "circle-stroke-color": pinStroke(), "circle-stroke-width": ["case", ["get", "reference"], CORE_W_REF, CORE_W], "circle-stroke-opacity": 0.92 } });
    this.map.addLayer({ id: "plants-hit", type: "circle", source: "plants", paint: { "circle-radius": ["get", "hit"], "circle-color": "#000", "circle-opacity": 0 } });

    for (const f of this.grid.features.filter((x) => x.geometry.type === "Point")) {
      const e = document.createElement("div"); e.className = "node-label"; e.textContent = f.properties.name;
      this.markers.push(new maplibregl.Marker({ element: e, anchor: "left", offset: [6, 0] }).setLngLat(f.geometry.coordinates).addTo(this.map));
    }
    for (const p of this.plants) {
      const e = document.createElement("div"); e.className = `plant-label ${p.id === REFERENCE_ID ? "is-ref" : ""}`;
      e.textContent = p.name_en.replace(/ (PV|Wind|BESS|ISCC).*$/, ""); e.dataset.tech = p.technology; e.dataset.status = p.status;
      this.markers.push(new maplibregl.Marker({ element: e, anchor: "top", offset: [0, labelGap(p)] }).setLngLat([p.lon, p.lat]).addTo(this.map));
    }
    // The hit layer is transparent but still queried, so a small pin stays easy to click.
    this.map.on("click", "plants-hit", (e) => { const f = this.nearestFeature(e); if (f) this.onSelect?.(f.properties.id); });
    this.map.on("mousemove", "plants-hit", (e) => { this.map.getCanvas().style.cursor = "pointer"; const f = this.nearestFeature(e); if (f) this.onHover?.(e.originalEvent, f.properties.id); });
    this.map.on("mouseleave", "plants-hit", (e) => { this.map.getCanvas().style.cursor = ""; this.onLeave?.(e.originalEvent); });
    this.ready = true;
    return true;
  }
  setLayers({ plants = true, grid = true, labels = true }) {
    if (!this.ready) return;
    for (const id of PLANT_LAYERS) this.map.setLayoutProperty(id, "visibility", plants ? "visible" : "none");
    for (const id of ["grid-lines", "grid-glow", "grid-nodes"]) this.map.setLayoutProperty(id, "visibility", grid ? "visible" : "none");
    this.container.classList.toggle("hide-labels", !labels);
    this.container.classList.toggle("hide-plants", !plants);
    this.container.classList.toggle("hide-grid", !grid);
  }
  setFilter({ tech, status }) {
    if (!this.ready) return;
    const expr = ["all", ["in", ["get", "tech"], ["literal", [...tech]]], ["in", ["get", "status"], ["literal", [...status]]]];
    for (const id of PLANT_LAYERS) this.map.setFilter(id, id === "plants-ref" ? ["all", expr, REF_ONLY] : expr);
    for (const el of this.container.querySelectorAll(".plant-label")) el.hidden = !(tech.has(el.dataset.tech) && status.has(el.dataset.status));
  }
  flyTo(plant) { if (this.ready) this.map.flyTo({ center: [plant.lon, plant.lat], zoom: 8.5, duration: 1400, essential: true }); }
  fitKingdom() { if (this.ready) this.map.fitBounds(KINGDOM_BOUNDS, { padding: 24, duration: 800 }); }
  resize() { this.map?.resize(); }
  destroy() { for (const m of this.markers) m.remove(); this.markers = []; this.map?.remove(); this.map = null; this.ready = false; }
}

/** SVG fallback: equirectangular projection of the Kingdom's bounding box. */
export class KingdomPlan {
  constructor(container, plants, grid, hooks = {}) {
    Object.assign(this, { container, plants, grid, ...hooks });
    this.layers = { plants: true, grid: true, labels: true };
    this.filter = { tech: new Set(Object.keys(TECH_COLOUR)), status: new Set(Object.keys(STATUS_COLOUR)) };
  }
  static available() { return true; }
  async init() { this.draw(); return true; }
  draw() {
    const NS = "http://www.w3.org/2000/svg";
    const el = (n, a = {}) => { const e = document.createElementNS(NS, n); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
    const [[w0, s0], [e0, n0]] = KINGDOM_BOUNDS;
    const W = 1000, H = Math.round((W * (n0 - s0)) / (e0 - w0));
    const X = (lon) => ((lon - w0) / (e0 - w0)) * W, Y = (lat) => ((n0 - lat) / (n0 - s0)) * H;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Kingdom renewables schematic" });
    svg.append(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#0f1216" }));
    if (this.layers.grid) for (const f of this.grid.features) {
      if (f.geometry.type === "LineString") svg.append(el("polyline", { points: f.geometry.coordinates.map(([lon, lat]) => `${X(lon)},${Y(lat)}`).join(" "), fill: "none", stroke: f.properties.voltage_kv === 380 ? "#9fc3ee" : "#f2a33a", "stroke-width": 2, "stroke-dasharray": "6 4" }));
      else { const [lon, lat] = f.geometry.coordinates; svg.append(el("circle", { cx: X(lon), cy: Y(lat), r: 3, fill: nodeFill(), stroke: mapInk(), "stroke-width": 1 })); if (this.layers.labels) { const t = el("text", { x: X(lon) + 7, y: Y(lat) + 4, fill: "#b8bcc6", "font-size": 12 }); t.textContent = f.properties.name; svg.append(t); } }
    }
    // Same marker as the GL path: capacity ring (status colour) + optional purple reference
    // ring + a small technology-coloured pin dot, with an invisible circle carrying events.
    if (this.layers.plants) for (const p of bySizeDesc(this.plants)) {
      if (!this.filter.tech.has(p.technology) || !this.filter.status.has(p.status)) continue;
      const cx = X(p.lon), cy = Y(p.lat), isRef = p.id === REFERENCE_ID;
      const r = ringRadius(p.capacity_mw);
      const g = el("g", { class: `kp-plant${isRef ? " is-ref" : ""}` });
      g.append(el("circle", { class: "kp-ring", cx, cy, r, fill: "none", stroke: STATUS_COLOUR[p.status], "stroke-width": ringWidth(p.capacity_mw), "stroke-opacity": 0.95, "pointer-events": "none" }));
      if (isRef) g.append(el("circle", { class: "kp-ref", cx, cy, r: r + REF_GAP, fill: "none", stroke: refPurple(), "stroke-width": REF_W, "stroke-opacity": 0.95, "pointer-events": "none" }));
      g.append(el("circle", { class: "kp-core", cx, cy, r: isRef ? CORE_R_REF : CORE_R, fill: TECH_COLOUR[p.technology], stroke: pinStroke(), "stroke-width": isRef ? CORE_W_REF : CORE_W, "stroke-opacity": 0.92, "pointer-events": "none" }));
      const hit = el("circle", { class: "kp-hit", cx, cy, r: hitRadius(p.capacity_mw, isRef), fill: "none", "pointer-events": "all", style: "cursor:pointer" });
      hit.addEventListener("click", () => this.onSelect?.(p.id));
      hit.addEventListener("mousemove", (e) => this.onHover?.(e, p.id));
      hit.addEventListener("mouseleave", (e) => this.onLeave?.(e));
      g.append(hit);
      svg.append(g);
      if (this.layers.labels) { const t = el("text", { class: `kp-label${isRef ? " is-ref" : ""}`, x: cx, y: cy + labelGap(p) + 9, fill: isRef ? refPurple() : "#f2f3f5", "font-size": 11, "text-anchor": "middle", "pointer-events": "none" }); t.textContent = p.name_en.replace(/ (PV|Wind|BESS|ISCC).*$/, ""); svg.append(t); }
    }
    const wrap = document.createElement("div"); wrap.className = "map-fallback"; wrap.append(svg);
    this.container.replaceChildren(wrap);
  }
  setLayers(l) { this.layers = { ...this.layers, ...l }; this.draw(); }
  setFilter(f) { this.filter = f; this.draw(); }
  flyTo() {} fitKingdom() {} resize() {} destroy() { this.container.replaceChildren(); }
}

export function plantTooltipRows(p) {
  return [
    { name: "Technology", value: p.technology.toUpperCase() },
    { name: "Capacity", value: `${fmt(p.capacity_mw, 0)} MW` },
    { name: "Status", value: p.status.replace("_", " ") },
    { name: "Developer", value: p.developer ?? "—" },
    { name: "Position", value: `${p.coordinate_quality}-level` },
  ];
}
