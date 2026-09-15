/* The Kingdom map: every renewable plant and the transmission backbone over a dark basemap,
   with a SVG fallback when tiles or WebGL are unavailable. */
import { TECH_COLOUR, STATUS_COLOUR } from "/rs/colour.js";
import { fmt } from "/rs/format.js";

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

function plantsGeoJSON(plants) {
  return {
    type: "FeatureCollection",
    features: plants.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: {
        id: p.id, name: p.name_en, tech: p.technology, status: p.status, mw: p.capacity_mw,
        colour: TECH_COLOUR[p.technology], ring: STATUS_COLOUR[p.status],
        r: 4 + Math.sqrt(p.capacity_mw) / 4, reference: p.id === "najm-3000",
      },
    })),
  };
}

export class KingdomMap {
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
    this.map.addLayer({ id: "grid-nodes", type: "circle", source: "grid", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 3.5, "circle-color": "#e8eef7", "circle-stroke-color": "#10131a", "circle-stroke-width": 1 } });

    this.map.addSource("plants", { type: "geojson", data: plantsGeoJSON(this.plants) });
    this.map.addLayer({ id: "plants-halo", type: "circle", source: "plants", paint: { "circle-radius": ["*", ["get", "r"], 1.9], "circle-color": ["get", "colour"], "circle-opacity": 0.12 } });
    this.map.addLayer({ id: "plants", type: "circle", source: "plants", paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "colour"], "circle-opacity": 0.85, "circle-stroke-color": ["get", "ring"], "circle-stroke-width": ["case", ["get", "reference"], 3, 1.5] } });

    for (const f of this.grid.features.filter((x) => x.geometry.type === "Point")) {
      const e = document.createElement("div"); e.className = "node-label"; e.textContent = f.properties.name;
      this.markers.push(new maplibregl.Marker({ element: e, anchor: "left", offset: [6, 0] }).setLngLat(f.geometry.coordinates).addTo(this.map));
    }
    for (const p of this.plants) {
      const e = document.createElement("div"); e.className = `plant-label ${p.id === "najm-3000" ? "is-ref" : ""}`;
      e.textContent = p.name_en.replace(/ (PV|Wind|BESS|ISCC).*$/, ""); e.dataset.tech = p.technology; e.dataset.status = p.status;
      this.markers.push(new maplibregl.Marker({ element: e, anchor: "top", offset: [0, 4 + Math.sqrt(p.capacity_mw) / 4] }).setLngLat([p.lon, p.lat]).addTo(this.map));
    }
    this.map.on("click", "plants", (e) => { const f = e.features?.[0]; if (f) this.onSelect?.(f.properties.id); });
    this.map.on("mousemove", "plants", (e) => { this.map.getCanvas().style.cursor = "pointer"; const f = e.features?.[0]; if (f) this.onHover?.(e.originalEvent, f.properties.id); });
    this.map.on("mouseleave", "plants", (e) => { this.map.getCanvas().style.cursor = ""; this.onLeave?.(e.originalEvent); });
    this.ready = true;
    return true;
  }
  setLayers({ plants = true, grid = true, labels = true }) {
    if (!this.ready) return;
    for (const id of ["plants", "plants-halo"]) this.map.setLayoutProperty(id, "visibility", plants ? "visible" : "none");
    for (const id of ["grid-lines", "grid-glow", "grid-nodes"]) this.map.setLayoutProperty(id, "visibility", grid ? "visible" : "none");
    this.container.classList.toggle("hide-labels", !labels);
    this.container.classList.toggle("hide-plants", !plants);
    this.container.classList.toggle("hide-grid", !grid);
  }
  setFilter({ tech, status }) {
    if (!this.ready) return;
    const expr = ["all", ["in", ["get", "tech"], ["literal", [...tech]]], ["in", ["get", "status"], ["literal", [...status]]]];
    this.map.setFilter("plants", expr); this.map.setFilter("plants-halo", expr);
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
      else { const [lon, lat] = f.geometry.coordinates; svg.append(el("circle", { cx: X(lon), cy: Y(lat), r: 4, fill: "#e8eef7" })); if (this.layers.labels) { const t = el("text", { x: X(lon) + 7, y: Y(lat) + 4, fill: "#b8bcc6", "font-size": 12 }); t.textContent = f.properties.name; svg.append(t); } }
    }
    if (this.layers.plants) for (const p of this.plants) {
      if (!this.filter.tech.has(p.technology) || !this.filter.status.has(p.status)) continue;
      const c = el("circle", { cx: X(p.lon), cy: Y(p.lat), r: 4 + Math.sqrt(p.capacity_mw) / 4, fill: TECH_COLOUR[p.technology], "fill-opacity": 0.85, stroke: STATUS_COLOUR[p.status], "stroke-width": p.id === "najm-3000" ? 3 : 1.5, style: "cursor:pointer" });
      c.addEventListener("click", () => this.onSelect?.(p.id));
      c.addEventListener("mousemove", (e) => this.onHover?.(e, p.id));
      c.addEventListener("mouseleave", (e) => this.onLeave?.(e));
      svg.append(c);
      if (this.layers.labels) { const t = el("text", { x: X(p.lon), y: Y(p.lat) + 8 + Math.sqrt(p.capacity_mw) / 4 + 10, fill: "#f2f3f5", "font-size": 11, "text-anchor": "middle" }); t.textContent = p.name_en.replace(/ (PV|Wind|BESS|ISCC).*$/, ""); svg.append(t); }
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
