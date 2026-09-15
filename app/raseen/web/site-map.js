import { blockColour } from "/rs/site-plan.js";
import { fmt } from "/rs/format.js";

export const IMAGERY = window.RASEEN_TILES_SAT || "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ATTRIBUTION = "Imagery &copy; Esri, Maxar, Earthstar Geographics · Layout as-designed · Values simulated";
const IMAGERY_SOURCE = "esri";
//: How long init() waits for the first imagery tile before deciding the tiles are reachable.
const IMAGERY_PROBE_MS = 6000;

/** The real plant on satellite imagery: MVPS, block linework, 30 control-block hulls, cloud overlay. */
export class SiteMap {
  constructor(container, site, { onSelect, onHover, onLeave } = {}) {
    this.container = container; this.site = site; this.onSelect = onSelect; this.onHover = onHover; this.onLeave = onLeave;
    this.mode = "output"; this.controller = "bgc"; this.frame = null; this.map = null; this.markers = []; this.labelEls = []; this.ready = false;
    this.imagery = null;   // null = undecided, true = a tile arrived, false = the first tile failed
  }
  static available() {
    return typeof maplibregl !== "undefined" && (typeof maplibregl.supported !== "function" || maplibregl.supported());
  }
  /** Resolves false when MapLibre cannot start, the style never loads, or the imagery tiles are unreachable. */
  async init() {
    if (!SiteMap.available()) return false;
    const s = this.site;
    const centre = [(s.bounds.west + s.bounds.east) / 2, (s.bounds.south + s.bounds.north) / 2];
    try {
      this.map = new maplibregl.Map({
        container: this.container,
        style: { version: 8, sources: { [IMAGERY_SOURCE]: { type: "raster", tiles: [IMAGERY], tileSize: 256, attribution: ATTRIBUTION, maxzoom: 18 } }, layers: [{ id: "imagery", type: "raster", source: IMAGERY_SOURCE }] },
        center: centre, zoom: 12, maxPitch: 60, attributionControl: { compact: false },
      });
    } catch (error) {
      console.warn("SiteMap: MapLibre could not start", error);
      this.map = null;
      return false;
    }
    this.map.on("error", (e) => { if (e?.sourceId === IMAGERY_SOURCE && this.imagery === null) this.imagery = false; });
    this.map.on("sourcedata", (e) => { if (e?.sourceId === IMAGERY_SOURCE && e.tile && this.imagery === null) this.imagery = true; });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
    await new Promise((resolve) => { if (this.map.isStyleLoaded()) resolve(); else this.map.once("style.load", resolve); setTimeout(resolve, 8000); });
    if (!this.map || !this.map.getStyle()) return false;

    this.map.addSource("hulls", { type: "geojson", promoteId: "i", data: { type: "FeatureCollection", features: s.blocks.map((b, i) => ({ type: "Feature", id: i, geometry: { type: "Polygon", coordinates: [[...b.hull, b.hull[0]]] }, properties: { i, id: b.id, label: b.label, cap: b.capacity_mw } })) } });
    this.map.addLayer({ id: "hull-fill", type: "fill", source: "hulls", paint: { "fill-color": ["coalesce", ["feature-state", "colour"], "#2c3a4d"], "fill-opacity": 0.55 } });
    this.map.addLayer({ id: "hull-line", type: "line", source: "hulls", paint: { "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#ffffff", "#9fc3ee"], "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 1.2], "line-opacity": 0.9 } });

    this.map.addSource("outline", { type: "geojson", data: { type: "FeatureCollection", features: s.lines.map((l) => ({ type: "Feature", geometry: { type: "LineString", coordinates: l.pts.map(([lat, lon]) => [lon, lat]) }, properties: {} })) } });
    this.map.addLayer({ id: "outline-lines", type: "line", source: "outline", minzoom: 13, paint: { "line-color": "#ffffff", "line-opacity": 0.45, "line-width": 0.8 } });

    this.map.addSource("mvps", { type: "geojson", data: { type: "FeatureCollection", features: s.mvps.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { n: p.n } })) } });
    this.map.addLayer({ id: "mvps-circles", type: "circle", source: "mvps", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2, 15, 5], "circle-color": "#cfe3fb", "circle-stroke-color": "#10131a", "circle-stroke-width": 1 } });

    this.map.addSource("cloud", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    this.map.addLayer({ id: "cloud-fill", type: "fill", source: "cloud", paint: { "fill-color": "#d0d5de", "fill-opacity": 0.35 } });
    this.map.addLayer({ id: "cloud-line", type: "line", source: "cloud", paint: { "line-color": "#e6eaf0", "line-width": 1.5, "line-dasharray": [2, 2] } });

    for (const z of s.zones) { const e = document.createElement("div"); e.className = "zone-label"; e.textContent = z.name; this.markers.push(new maplibregl.Marker({ element: e }).setLngLat([z.lon, z.lat]).addTo(this.map)); }
    for (const b of s.blocks) { const e = document.createElement("div"); e.className = "block-label"; e.innerHTML = `${b.id}<small>—</small>`; this.labelEls.push(e); this.markers.push(new maplibregl.Marker({ element: e }).setLngLat(b.centroid).addTo(this.map)); }

    this.map.on("click", "hull-fill", (e) => { const f = e.features?.[0]; if (f) this.onSelect?.(f.properties.id); });
    this.map.on("mousemove", "hull-fill", (e) => { this.map.getCanvas().style.cursor = "pointer"; const f = e.features?.[0]; if (f) this.onHover?.(e.originalEvent, f.properties.i); });
    this.map.on("mouseleave", "hull-fill", (e) => { this.map.getCanvas().style.cursor = ""; this.onLeave?.(e.originalEvent); });

    this.ready = true;
    this.fitPlant();
    this.paint();
    return this.probeImagery();
  }
  /** True once a tile has arrived (or the probe times out on a slow link); false if the first tile request failed. */
  probeImagery() {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (!this.map) return resolve(false);
        if (this.imagery !== null) return resolve(this.imagery);
        if (Date.now() - started > IMAGERY_PROBE_MS) return resolve(true);
        setTimeout(tick, 100);
      };
      tick();
    });
  }
  setMode(mode) { this.mode = mode; this.paint(); }
  setFrame(frame, controller) { this.frame = frame; this.controller = controller ?? this.controller; this.paint(); }
  clear() { this.frame = null; this.paint(); }
  select(id) {
    if (!this.ready) return;
    this.site.blocks.forEach((b, i) => this.map.setFeatureState({ source: "hulls", id: i }, { selected: b.id === id }));
  }
  paint() {
    if (!this.ready) return;
    this.site.blocks.forEach((b, i) => {
      this.map.setFeatureState({ source: "hulls", id: i }, { colour: blockColour(this.mode, this.frame, i, this.controller, b.capacity_mw) });
      const P = this.frame ? (this.frame[`P_${this.controller}`] ?? this.frame.P_bgc)[i] : b.capacity_mw;
      const eta = this.frame?.eta?.[i] ?? null;
      const extra = this.mode === "eta" && this.frame ? (eta === null ? "—" : eta <= 0 ? "here" : `+${fmt(eta, 1)}′`) : `${fmt(P, 0)} MW`;
      this.labelEls[i].innerHTML = `${b.id}<small>${extra}</small>`;
    });
    const polys = this.frame?.cloud ?? [];
    this.map.getSource("cloud").setData({ type: "FeatureCollection", features: polys.map((poly) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...poly, poly[0]]] }, properties: {} })) });
  }
  flyToBlock(id) {
    const b = this.site.blocks.find((x) => x.id === id); if (!b || !this.ready) return;
    this.map.flyTo({ center: b.centroid, zoom: Math.max(this.map.getZoom(), 14.5), duration: 1400, essential: true });
  }
  fitPlant() { if (!this.ready) return; const b = this.site.bounds; this.map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 30, duration: 0 }); }
  resize() { this.map?.resize(); }
  destroy() { for (const m of this.markers) m.remove(); this.markers = []; this.labelEls = []; this.map?.remove(); this.map = null; this.ready = false; }
}
