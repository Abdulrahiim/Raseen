/* Gradient Control page: a cloud crosses NAJM-3000, block by block, and Raseen holds the
   plant's export to a declared ramp. Self-contained; reuses the satellite map, the charts and
   the scenario engine (/api/rs/scenario). Everything shown is simulated and labelled so. */
import { SiteMap } from "/rs/site-map.js";
import { SitePlan, blockRows } from "/rs/site-plan.js";
import { lineChart, blockGradient } from "/rs/charts.js";
import { fmt, clockLabel } from "/rs/format.js";
import { cssVar } from "/rs/colour.js";

const $ = (id) => document.getElementById(id);
const PLAY_FPS = 10;
const DEFAULTS = {
  event: "solid", heading_deg: 90, speed_kmh: 48, depth: 0.6, g_mw_min: 90,
  confidence: 0.7, flat: false, reserve_mw: null, stall_at_min: null,
  deepen_at_min: null, deepen_factor: 1.2,
};

/* On GitHub Pages there is no server to compute scenarios, so the build pre-renders this
   curated set. The keys name the files under data/scenarios/. The same list drives the
   preset dropdown in both live and static modes. */
const PRESETS = [
  { key: "d1-default", label: "Solid front · 90 MW/min (headline)", params: {} },
  { key: "d1-g60", label: "Solid front · 60 MW/min (gentler, more lead)", params: { g_mw_min: 60 } },
  { key: "d1-g120", label: "Solid front · 120 MW/min (steeper, less lead)", params: { g_mw_min: 120 } },
  { key: "d1-ns", label: "Solid front · south→north (longer crossing)", params: { heading_deg: 0 } },
  { key: "d1-fast", label: "Solid front · fast cloud (72 km/h)", params: { speed_kmh: 72 } },
  { key: "d1-slow", label: "Solid front · slow cloud (24 km/h)", params: { speed_kmh: 24 } },
  { key: "thin-dsh", label: "Thin band · Dynamic Solar Headroom (held flat)", params: { event: "thin", flat: true, g_mw_min: 60 } },
  { key: "scattered", label: "Scattered cumulus", params: { event: "scattered" } },
  { key: "stall", label: "Front stalls (false alarm)", params: { stall_at_min: -3 } },
  { key: "deepen", label: "Front 20 % deeper than forecast", params: { deepen_at_min: 2, deepen_factor: 1.2 } },
  { key: "high-conf", label: "High forecast confidence (small reserve)", params: { confidence: 0.9 } },
  { key: "low-conf", label: "Low forecast confidence (large reserve)", params: { confidence: 0.3 } },
];
const STATIC = () => window.RASEEN?.data;

const state = {
  site: null, scenario: null, frameIndex: 0, controller: "bgc", mode: "output",
  order: "eta", playing: false, selected: null, params: { ...DEFAULTS },
  preset: "d1-default", view: null, timer: null,
};

const frame = () => (state.scenario ? state.scenario.frames[Math.min(state.frameIndex, state.scenario.frames.length - 1)] : null);

function banner(msg) {
  const el = $("rs-banner");
  if (!msg) { el.hidden = true; el.textContent = ""; return; }
  el.textContent = msg; el.hidden = false;
}

function showTip(event, head, rows) {
  const t = $("rs-tooltip");
  t.innerHTML = `<div class="rs-tt-head">${head}</div>` + rows.map((r) => `<div class="rs-tt-row"><span>${r.name}</span><span class="val">${r.value}</span></div>`).join("");
  t.style.left = `${event.clientX}px`; t.style.top = `${event.clientY}px`; t.classList.add("on");
}
const hideTip = () => $("rs-tooltip").classList.remove("on");

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail ? JSON.stringify(body.detail) : `${r.status} ${r.statusText}`);
  return body;
}

async function runScenario(patch = {}) {
  Object.assign(state.params, patch);
  const root = $("rs-root");
  root.classList.add("rs-busy");
  try {
    const keepT = frame()?.t;
    let scn;
    if (STATIC()) {
      // Static build: load the pre-rendered scenario for the chosen preset.
      scn = await fetchJSON(`${STATIC()}/scenarios/${state.preset}.json`);
    } else {
      const body = {};
      for (const [k, v] of Object.entries(state.params)) if (v !== null && v !== undefined) body[k] = v;
      scn = await fetchJSON("/api/rs/scenario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    state.scenario = scn;
    state.frameIndex = keepT === undefined ? scn.times_min.findIndex((t) => t >= 0) : Math.max(0, scn.times_min.findIndex((t) => t >= keepT));
    if (state.frameIndex < 0) state.frameIndex = 0;
    banner(null);
    render(true);
  } catch (e) {
    banner(`Scenario failed: ${e.message}`);
  } finally {
    root.classList.remove("rs-busy");
  }
}

function setPlaying(on) {
  clearInterval(state.timer); state.timer = null; state.playing = on;
  const btn = $("rs-play"); if (btn) btn.textContent = on ? "Pause" : "Play";
  if (!on) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const step = reduced ? 3 : 1;
  state.timer = setInterval(() => {
    if (!state.scenario) return;
    const next = state.frameIndex + step;
    if (next >= state.scenario.frames.length) { setPlaying(false); return; }
    state.frameIndex = next; render(false);
  }, 1000 / PLAY_FPS);
}

function layout() {
  $("rs-root").innerHTML = `
  <section class="rs-control-grid">
    <div class="rs-panel">
      <div class="rs-panel-head">
        <h2>Spatial digital twin <span class="rs-note" style="display:inline">geometry as-designed · values simulated</span></h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div class="rs-seg" role="group" aria-label="Colour"><button data-mode="output" class="is-on">Output</button><button data-mode="headroom">Headroom</button><button data-mode="eta">Cloud ETA</button></div>
          <div class="rs-seg" role="group" aria-label="Controller"><button data-ctl="uni">Plant-level</button><button data-ctl="bgc" class="is-on">Raseen</button></div>
        </div>
      </div>
      <div id="rs-map" class="rs-map-box"></div>
      <div class="rs-legend" id="rs-map-legend"></div>
    </div>
    <div class="rs-side">
      <div class="rs-panel">
        <div class="rs-panel-head"><h2>Plant power</h2><span class="rs-phase" id="rs-phase">—</span></div>
        <div class="rs-tiles">
          <div class="rs-tile amber"><span class="k">Available</span><span class="v big" id="rs-avail">—</span><span class="u">MW · simulated</span></div>
          <div class="rs-tile accent"><span class="k">Export</span><span class="v big" id="rs-export">—</span><span class="u" id="rs-export-u">MW</span></div>
          <div class="rs-tile"><span class="k">Declared line</span><span class="v" id="rs-declared">—</span><span class="u">MW</span></div>
          <div class="rs-tile violet"><span class="k">Firm reserve R(5 min)</span><span class="v" id="rs-reserve">—</span><span class="u">MW headroom</span></div>
        </div>
      </div>
      <div class="rs-panel">
        <div class="rs-panel-head"><h2>Ramp at the connection point</h2></div>
        <div class="rs-ramp-big"><span class="from" id="rs-ramp-from">—</span><span class="arrow">→</span><span class="to" id="rs-ramp-to">—</span><span class="u">MW/min</span></div>
        <p class="rs-note" id="rs-ramp-note"></p>
      </div>
      <div class="rs-panel">
        <div class="rs-panel-head"><h2>Cloud intelligence <span class="rs-note" style="display:inline">nowcast: ground truth</span></h2></div>
        <dl class="rs-dl" id="rs-intel"></dl>
      </div>
    </div>
  </section>

  <section class="rs-panel">
    <div class="rs-panel-head"><h2>Scenario</h2><button id="rs-reset" class="rs-btn">Reset</button></div>
    <div class="rs-ctl" id="rs-preset-row"><label class="rs-ctl-label" for="p-preset">Preset scenario</label>
      <select id="p-preset">${PRESETS.map((p) => `<option value="${p.key}">${p.label}</option>`).join("")}</select></div>
    <div id="rs-advanced">
    <div class="rs-row2">
      <div class="rs-ctl"><label class="rs-ctl-label" for="p-event">Cloud event</label>
        <select id="p-event"><option value="solid">Solid front (design case D1)</option><option value="thin">Thin band (D2)</option><option value="scattered">Scattered cumulus (D3)</option></select></div>
      <div class="rs-ctl"><label class="rs-ctl-label" for="p-speed">Cloud speed</label>
        <select id="p-speed"><option value="24">24 km/h</option><option value="48" selected>48 km/h</option><option value="72">72 km/h</option></select></div>
    </div>
    <div class="rs-row2">
      <div class="rs-ctl"><label class="rs-ctl-label" for="p-heading">Heading <b id="v-heading">90°</b></label><input id="p-heading" type="range" min="0" max="359" step="1" value="90"></div>
      <div class="rs-ctl"><label class="rs-ctl-label" for="p-depth">Depth <b id="v-depth">60 %</b></label><input id="p-depth" type="range" min="0.2" max="0.8" step="0.05" value="0.6"></div>
    </div>
    <div class="rs-row2">
      <div class="rs-ctl"><label class="rs-ctl-label" for="p-g">Declared gradient g <b id="v-g">90 MW/min</b></label><input id="p-g" type="range" min="30" max="180" step="15" value="90"></div>
      <div class="rs-ctl"><label class="rs-ctl-label" for="p-conf">Forecast confidence <b id="v-conf">0.7</b></label><input id="p-conf" type="range" min="0.3" max="0.9" step="0.1" value="0.7"></div>
    </div>
    <label class="rs-check"><input id="p-flat" type="checkbox"> Dynamic Solar Headroom — hold the plant flat through the event</label>
    <div class="rs-row2">
      <button id="rs-stall" class="rs-btn warn" title="What if the forecast is wrong?">Stall the front now</button>
      <button id="rs-deepen" class="rs-btn warn" title="What if it is deeper than forecast?">Deepen the front 20 % now</button>
    </div>
    </div>
    <p class="rs-note" id="rs-perturb"></p>
  </section>

  <section class="rs-split">
    <div class="rs-panel">
      <div class="rs-panel-head"><h2>Generation — available, uncontrolled, plant-level, Raseen, declared</h2></div>
      <div id="rs-gen" class="rs-chart"></div>
      <div class="rs-legend" id="rs-gen-legend"></div>
    </div>
    <div class="rs-panel">
      <div class="rs-panel-head"><h2>Event summary</h2></div>
      <div class="rs-tiles" id="rs-kpis"></div>
      <p class="rs-honesty" id="rs-honesty"></p>
    </div>
  </section>

  <section class="rs-panel">
    <div class="rs-panel-head"><h2>Block gradient — 30 set-points</h2>
      <div class="rs-seg" role="group" aria-label="Order"><button data-order="eta" class="is-on">By arrival</button><button data-order="id">West → east</button></div></div>
    <div id="rs-blocks" class="rs-chart"></div>
    <div class="rs-legend">
      <span><i class="rs-sw" style="background:var(--accent)"></i>set-point</span>
      <span><i class="rs-sw" style="background:var(--amber);height:3px"></i>available</span>
      <span><i class="rs-sw" style="background:var(--violet)"></i>firm headroom (arrives after 5 min)</span>
      <span><i class="rs-sw" style="background:var(--violet-dim)"></i>expiring headroom</span>
      <span><i class="rs-sw" style="background:#d0d5de;opacity:.5"></i>cloud</span>
    </div>
  </section>

  <section class="rs-panel">
    <div class="rs-timeline">
      <button id="rs-play" class="rs-btn primary">Play</button>
      <button id="rs-back" class="rs-btn" title="Back one minute">−1′</button>
      <button id="rs-fwd" class="rs-btn" title="Forward one minute">+1′</button>
      <input id="rs-scrub" type="range" min="0" max="840" value="0">
    </div>
    <div class="rs-marks" id="rs-marks"></div>
  </section>`;
}

function loadPreset(key) {
  const preset = PRESETS.find((p) => p.key === key) || PRESETS[0];
  state.preset = preset.key;
  state.params = { ...DEFAULTS, ...preset.params };
  syncInputs();
  runScenario();
}

function bindControls() {
  const on = (id, ev, fn) => $(id)?.addEventListener(ev, fn);
  on("p-preset", "change", (e) => loadPreset(e.target.value));
  on("p-event", "change", (e) => runScenario({ event: e.target.value }));
  on("p-speed", "change", (e) => runScenario({ speed_kmh: Number(e.target.value) }));
  on("p-heading", "input", (e) => ($("v-heading").textContent = `${e.target.value}°`));
  on("p-heading", "change", (e) => runScenario({ heading_deg: Number(e.target.value) }));
  on("p-depth", "input", (e) => ($("v-depth").textContent = `${Math.round(e.target.value * 100)} %`));
  on("p-depth", "change", (e) => runScenario({ depth: Number(e.target.value) }));
  on("p-g", "input", (e) => ($("v-g").textContent = `${e.target.value} MW/min`));
  on("p-g", "change", (e) => runScenario({ g_mw_min: Number(e.target.value) }));
  on("p-conf", "input", (e) => ($("v-conf").textContent = e.target.value));
  on("p-conf", "change", (e) => runScenario({ confidence: Number(e.target.value) }));
  on("p-flat", "change", (e) => runScenario({ flat: e.target.checked }));
  on("rs-stall", "click", () => runScenario({ stall_at_min: Math.round((frame()?.t ?? -3) * 6) / 6, deepen_at_min: null }));
  on("rs-deepen", "click", () => runScenario({ deepen_at_min: Math.round((frame()?.t ?? 2) * 6) / 6, deepen_factor: 1.2, stall_at_min: null }));
  on("rs-reset", "click", () => { state.params = { ...DEFAULTS }; syncInputs(); runScenario(); });
  for (const b of document.querySelectorAll("[data-mode]")) b.addEventListener("click", () => { document.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("is-on", x === b)); state.mode = b.dataset.mode; state.view?.setMode(state.mode); paintMapLegend(); });
  for (const b of document.querySelectorAll("[data-ctl]")) b.addEventListener("click", () => { document.querySelectorAll("[data-ctl]").forEach((x) => x.classList.toggle("is-on", x === b)); state.controller = b.dataset.ctl; render(true); });
  for (const b of document.querySelectorAll("[data-order]")) b.addEventListener("click", () => { document.querySelectorAll("[data-order]").forEach((x) => x.classList.toggle("is-on", x === b)); state.order = b.dataset.order; renderBlocks(); });
  on("rs-play", "click", () => setPlaying(!state.playing));
  on("rs-back", "click", () => { setPlaying(false); state.frameIndex = Math.max(0, state.frameIndex - 6); render(false); });
  on("rs-fwd", "click", () => { setPlaying(false); state.frameIndex = Math.min((state.scenario?.frames.length ?? 1) - 1, state.frameIndex + 6); render(false); });
  on("rs-scrub", "input", (e) => { setPlaying(false); state.frameIndex = Number(e.target.value); render(false); });
  document.addEventListener("keydown", (e) => {
    if (!state.scenario || ["INPUT", "SELECT"].includes(document.activeElement?.tagName)) return;
    const step = e.shiftKey ? 6 : 1;
    if (e.key === "ArrowLeft") { setPlaying(false); state.frameIndex = Math.max(0, state.frameIndex - step); render(false); e.preventDefault(); }
    if (e.key === "ArrowRight") { setPlaying(false); state.frameIndex = Math.min(state.scenario.frames.length - 1, state.frameIndex + step); render(false); e.preventDefault(); }
    if (e.key === " ") { setPlaying(!state.playing); e.preventDefault(); }
  });
}

function syncInputs() {
  const p = state.params;
  if ($("p-preset")) $("p-preset").value = state.preset;
  $("p-event").value = p.event; $("p-speed").value = String(p.speed_kmh);
  $("p-heading").value = p.heading_deg; $("v-heading").textContent = `${p.heading_deg}°`;
  $("p-depth").value = p.depth; $("v-depth").textContent = `${Math.round(p.depth * 100)} %`;
  $("p-g").value = p.g_mw_min; $("v-g").textContent = `${p.g_mw_min} MW/min`;
  $("p-conf").value = p.confidence; $("v-conf").textContent = String(p.confidence);
  $("p-flat").checked = p.flat;
}

async function makeView() {
  state.view?.destroy();
  const box = $("rs-map"); box.replaceChildren();
  const hooks = {
    onSelect: (id) => { state.selected = id; state.view?.select?.(id); renderBlocks(); },
    onHover: (e, i) => showTip(e, `${state.site.blocks[i].id} · ${state.site.blocks[i].label}`, blockRows(frame(), i, state.controller, state.site.blocks[i].capacity_mw)),
    onLeave: hideTip,
  };
  let v = new (SiteMap.available() ? SiteMap : SitePlan)(box, state.site, hooks);
  const ok = await v.init();
  if (!ok && v instanceof SiteMap) { v.destroy(); v = new SitePlan(box, state.site, hooks); await v.init(); banner("Satellite tiles unavailable; showing the as-designed plan."); }
  state.view = v;
  v.setMode(state.mode);
  v.setFrame(frame(), state.controller);
}

function paintMapLegend() {
  const m = state.mode;
  $("rs-map-legend").innerHTML =
    m === "output" ? '<span>set-point / capacity</span><span><i class="rs-sw" style="background:linear-gradient(90deg,var(--ramp-0),var(--ramp-3),var(--ramp-5))"></i>0 → 100 %</span>'
    : m === "headroom" ? '<span>headroom (available − export)</span><span><i class="rs-sw" style="background:var(--violet)"></i>violet firm · dim expiring</span>'
    : '<span>minutes to cloud arrival</span><span><i class="rs-sw" style="background:var(--cyan)"></i>now → 15+ · grey passed/none</span>';
}

function tile(cls, k, v, u) { return `<div class="rs-tile ${cls}"><span class="k">${k}</span><span class="v">${v}</span><span class="u">${u}</span></div>`; }

function render(full) {
  const scn = state.scenario, f = frame();
  if (!scn || !f) return;
  const ctl = state.controller;
  $("rs-scrub").max = String(scn.frames.length - 1);
  $("rs-scrub").value = String(state.frameIndex);
  $("rs-clock").textContent = `t ${clockLabel(f.t)}`;
  $("rs-phase").textContent = f.phase; $("rs-phase").dataset.phase = f.phase;
  $("rs-avail").textContent = fmt(f.agg.A, 0);
  $("rs-export").textContent = fmt(f.agg[`P_${ctl}`], 0);
  $("rs-export-u").textContent = `MW · ${ctl === "bgc" ? "Raseen" : "plant-level"} · other ${fmt(f.agg[ctl === "bgc" ? "P_uni" : "P_bgc"], 0)}`;
  $("rs-declared").textContent = fmt(f.agg.P_star, 0);
  $("rs-reserve").textContent = fmt(ctl === "bgc" ? f.agg.R : 0, 0);
  state.view?.setFrame(f, ctl);
  renderGen();
  renderBlocks();
  if (full) {
    const fr = scn.front, k = scn.kpis;
    $("rs-ramp-from").textContent = `−${fmt(k.base.max_grad_mw_min, 0)}`;
    $("rs-ramp-to").textContent = `−${fmt(k[ctl].max_grad_mw_min, 0)}`;
    $("rs-ramp-note").textContent = `g = D / (τ + L): ${fmt(fr.D_mw, 0)} MW over ${fmt(fr.tau_min, 1)} min crossing + ${fmt(fr.L_min, 1)} min lead ≈ ${fmt(fr.g_mw_min, 0)} MW/min (${fmt(fr.g_mw_min / 30, 1)} %/min).` + (fr.lead_shortfall_min > 0 ? ` This gradient needs ${fmt(fr.lead_shortfall_min, 1)} min more lead than the window allows.` : "");
    const intel = [
      ["Heading", `${fr.heading_deg}°${fr.heading_deg === 90 ? " (west → east)" : ""}`],
      ["Speed", `${fr.speed_kmh} km/h`],
      ["Depth", `${Math.round(fr.depth * 100)} % → D = ${fmt(fr.D_mw, 0)} MW`],
      ["Crossing time τ", `${fmt(fr.tau_min, 1)} min for this heading`],
      ["Lead L", `${fmt(fr.L_min, 1)} min`],
      ["Confidence", `${fr.confidence} → reserve ${fmt(fr.delta_mw, 0)} MW`],
    ];
    $("rs-intel").innerHTML = intel.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("");
    $("rs-perturb").textContent = fr.stall_at_min !== null
      ? "Front stalled: curtailment released nearest-first after a 2-minute confirmation; spilled energy logged as false-alarm exposure."
      : fr.deepen_at_min !== null ? "Front 20 % deeper than forecast: the reserve slice absorbs it if it can, otherwise export leaves the declared line." : "";
    renderKpis();
    renderMarks();
  }
}

function renderGen() {
  const scn = state.scenario, ctl = state.controller;
  const x = scn.times_min, agg = scn.frames.map((fr) => fr.agg);
  const series = [
    { name: "available", values: agg.map((a) => a.A), color: cssVar("--amber") },
    { name: "uncontrolled", values: agg.map((a) => a.P_base), color: "#ec835a", dashed: true, width: 1.2 },
    { name: "plant-level", values: agg.map((a) => a.P_uni), color: cssVar("--muted") || "#7f8592", width: ctl === "uni" ? 2.5 : 1.2 },
    { name: "Raseen", values: agg.map((a) => a.P_bgc), color: cssVar("--accent"), width: ctl === "bgc" ? 2.5 : 1.2 },
    { name: "declared", values: agg.map((a) => a.P_star), color: cssVar("--rs-text") || "#f2f3f5", dashed: true, width: 1 },
  ];
  const fr = scn.front;
  lineChart($("rs-gen"), {
    x, series,
    bands: [{ name: "headroom", upper: agg.map((a) => a.A), lower: agg.map((a) => a[`P_${ctl}`]), color: cssVar("--violet"), opacity: 0.2 }],
    markers: [{ x: fr.t_desc_start_min, label: "T−L" }, { x: 0, label: "T0" }, { x: fr.tau_min, label: "τ" }, { x: fr.t_rise_min, label: "exit" }],
    cursorIndex: state.frameIndex,
    onHover: (i, e) => { const a = agg[i]; showTip(e, clockLabel(x[i]), [{ name: "available", value: `${fmt(a.A, 0)} MW` }, { name: "plant-level", value: `${fmt(a.P_uni, 0)} MW` }, { name: "Raseen", value: `${fmt(a.P_bgc, 0)} MW` }, { name: "declared", value: `${fmt(a.P_star, 0)} MW` }]); },
    onLeave: hideTip,
    onClick: (i) => { setPlaying(false); state.frameIndex = i; render(false); },
  });
  $("rs-gen-legend").innerHTML = series.map((s) => `<span><i class="rs-sw" style="background:${s.color};height:3px"></i>${s.name}</span>`).join("");
}

function renderBlocks() {
  const scn = state.scenario, f = frame();
  if (!scn) return;
  blockGradient($("rs-blocks"), state.site.blocks, f, {
    controller: state.controller, order: state.order, selected: state.selected,
    onSelect: (id) => { state.selected = id; state.view?.select?.(id); renderBlocks(); },
    onHover: (i, e) => showTip(e, `${state.site.blocks[i].id} · ${state.site.blocks[i].label}`, blockRows(f, i, state.controller, state.site.blocks[i].capacity_mw)),
    onLeave: hideTip,
  });
}

function renderKpis() {
  const scn = state.scenario, ctl = state.controller, other = ctl === "bgc" ? "uni" : "bgc";
  const k = scn.kpis[ctl], b = scn.kpis.base, o = scn.kpis[other], e = scn.economics;
  $("rs-kpis").innerHTML = [
    tile("", "Max 10-min drop", fmt(k.max_drop10_mw, 0), `MW · uncontrolled ${fmt(b.max_drop10_mw, 0)}`),
    tile("", "Max down-gradient", fmt(k.max_grad_mw_min, 0), `MW/min · uncontrolled ${fmt(b.max_grad_mw_min, 0)}`),
    tile("", "Energy not exported", fmt(k.spill_mwh, 0), `MWh · ${fmt(e.spill_share_of_day_pct, 1)} % of a clear day`),
    tile("violet", "Firm reserve at contact", fmt(k.firm_at_contact_mw, 0), ctl === "bgc" ? "MW · declared R(0, 5 min)" : "MW · not declarable plant-wide"),
    tile("", "Curtailed while shaded", fmt(k.shaded_curtailment_mwh ?? 0, 1), `MWh · plant-level ${fmt((ctl === "bgc" ? o : k).shaded_curtailment_mwh ?? 0, 1)}`),
    tile("", "This event", fmt(e.spill_sar, 0), `SAR · battery block ≈ ${fmt(e.battery_block_annual_sar / 1e6, 0)} SAR m/yr`),
  ].join("");
  $("rs-honesty").textContent = "Both controllers spill the same energy for a perfectly forecast front — spill is fixed by the gradient, not the allocation. What Raseen adds: a firm, declarable reserve, no block steps, and it leaves the already-shaded blocks alone.";
}

function renderMarks() {
  const fr = state.scenario.front, x = state.scenario.times_min, n = x.length - 1;
  $("rs-marks").innerHTML = `<span>${fmt(x[0], 0)}′</span><span>T−L ${fmt(fr.t_desc_start_min, 1)}′ · T0 · τ ${fmt(fr.tau_min, 1)}′ · exit ${fmt(fr.t_rise_min, 1)}′</span><span>+${fmt(x[n], 0)}′</span>`;
}

async function boot() {
  layout();
  bindControls();
  if (STATIC()) {
    // Static build: only the pre-rendered presets are available, so hide the free sliders.
    for (const id of ["rs-advanced", "rs-reset"]) $(id)?.setAttribute("hidden", "");
  }
  paintMapLegend();
  try {
    state.site = await fetchJSON(STATIC() ? `${STATIC()}/site.json` : "/api/rs/site");
  } catch (e) {
    banner(`Could not load the plant: ${e.message}`);
    return;
  }
  await makeView();
  await runScenario();
}

boot();
