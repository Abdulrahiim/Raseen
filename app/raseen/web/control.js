/* Gradient control: a cloud crosses Humaij, and Raseen holds the plant's export to a
   declared ramp by holding power back on the blocks that are still in sun and letting it go
   as the cloud lands on the others.

   Nothing here is stored — there is no battery. A block held below the power it could make
   can be let back up later, and that is the whole mechanism; the page's job is to make it
   legible minute by minute. Everything shown is simulated and labelled so. */
import { SiteMap } from "/rs/site-map.js";
import { SitePlan, blockRows, setReserveHorizon } from "/rs/site-plan.js";
import { lineChart, blockGradient } from "/rs/charts.js";
import { fmt, clockLabel } from "/rs/format.js";
import { cssVar } from "/rs/colour.js";

const $ = (id) => document.getElementById(id);
//: Replay speed, in simulated seconds per real second. The published build stores every
//  second frame to keep the download small, so the frame rate is derived from the scenario's
//  own time step rather than fixed — otherwise the same event would play twice as fast there.
const REPLAY_RATE = 100;
const DEFAULTS = {
  event: "solid", heading_deg: 90, speed_kmh: 48, depth: 0.6, g_mw_min: 90,
  confidence: 0.7, flat: false, reserve_mw: null, stall_at_min: null,
  deepen_at_min: null, deepen_factor: 1.2,
  cover_frac: 1.0, cover_offset: 0.0, softness: 0.0,
};

/* The four properties of the cloud the page lets you move continuously. On the live server
   every value in the range is computed on demand. On the static build there is no server, so
   each axis is pre-rendered at the values below and the slider snaps to the nearest one —
   which is why the axes and their slugs must stay in step with SCENARIO_AXES in
   tools/build_static.py. */
const AXES = [
  { param: "speed_kmh", key: "speed", values: [16, 24, 48, 72, 96, 120] },
  { param: "cover_frac", key: "size", values: [0.2, 0.4, 0.6, 0.8, 1.0] },
  { param: "cover_offset", key: "pos", values: [-1, -0.5, 0, 0.5, 1] },
  { param: "heading_deg", key: "angle", values: [0, 45, 90, 135, 180, 225, 270, 315], wrap: 360 },
];
export const axisSlug = (key, v) =>
  key === "size" ? String(Math.round(v * 100))
    : key === "pos" ? (v < 0 ? "m" : "") + String(Math.round(Math.abs(v) * 100))
      : String(Math.round(v));

/* Named situations: the things a slider cannot express — a different kind of cloud, a
   forecast that turns out to be wrong, a different declared gradient. */
const SITUATIONS = [
  { key: "d1-default", label: "Design case: a solid front at 48 km/h", params: {} },
  { key: "d1-g60", label: "Gentler declared ramp, 60 MW/min", params: { g_mw_min: 60 } },
  { key: "d1-g120", label: "Steeper declared ramp, 120 MW/min", params: { g_mw_min: 120 } },
  { key: "thin-dsh", label: "Thin band, held flat right through", params: { event: "thin", flat: true, g_mw_min: 60 } },
  { key: "scattered", label: "Scattered cumulus", params: { event: "scattered" } },
  { key: "partial-soft", label: "Soft-edged band over part of the plant", params: { cover_frac: 0.6, softness: 0.8 } },
  { key: "haze", label: "Thin haze over the whole plant", params: { softness: 1.0 } },
  { key: "stall", label: "The front stalls: the forecast was wrong", params: { stall_at_min: -3 } },
  { key: "deepen", label: "The front is 20 % deeper than forecast", params: { deepen_at_min: 2, deepen_factor: 1.2 } },
  { key: "high-conf", label: "High forecast confidence, small reserve", params: { confidence: 0.9 } },
  { key: "low-conf", label: "Low forecast confidence, large reserve", params: { confidence: 0.3 } },
];
const STATIC = () => window.RASEEN?.data;

const state = {
  site: null, scenario: null, frameIndex: 0, controller: "bgc", mode: "output",
  order: "eta", playing: false, selected: null, params: { ...DEFAULTS },
  situation: "d1-default", view: null, timer: null,
};

const frameAt = (k) => (state.scenario ? state.scenario.frames[Math.max(0, Math.min(k, state.scenario.frames.length - 1))] : null);
const frame = () => frameAt(state.frameIndex);

/* `kind` is "error" by default. Not everything that needs saying is a failure: falling back
   from satellite tiles to the drawn plan is a notice about what you are looking at, and
   painting it red would make a working page look broken. */
function banner(msg, kind = "error") {
  const el = $("rs-banner");
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ""; return; }
  el.textContent = msg;
  el.classList.toggle("is-note", kind === "note");
  el.hidden = false;
}

function showTip(event, head, rows) {
  const t = $("rs-tooltip");
  t.innerHTML = `<div class="rs-tt-head">${head}</div>` + rows.map((r) => `<div class="rs-tt-row"><span>${r.name}</span><span class="val">${r.value}</span></div>`).join("");
  t.style.left = `${event.clientX}px`; t.style.top = `${event.clientY}px`; t.classList.add("on");
}
const hideTip = () => $("rs-tooltip")?.classList.remove("on");

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail ? JSON.stringify(body.detail) : `${r.status} ${r.statusText}`);
  return body;
}

/* On the static build the sliders move one axis at a time: only that axis has pre-rendered
   scenarios, so the other three go back to their defaults and the note under the sliders
   says so. `axis` is the axis the user just touched, or null for a named situation. */
function staticKey(axis) {
  if (!axis) return state.situation;
  const v = nearest(axis.values, state.params[axis.param], axis.wrap);
  // The whole scenario goes back to the default cloud, not just the other three axes: the
  // pre-rendered axis files are default in every other respect, so leaving a situation's
  // event type or gradient set would leave the controls describing a case that is not loaded.
  state.params = { ...DEFAULTS, [axis.param]: v };
  state.situation = "d1-default";
  return v === DEFAULTS[axis.param] ? "d1-default" : `axis-${axis.key}-${axisSlug(axis.key, v)}`;
}
/* Distance along an axis. A heading is circular, so 359° is one degree from 0 and not 359:
   without `wrap` the top of the direction slider snapped backwards to 315. */
const gap = (a, b, wrap) => (wrap ? Math.min(Math.abs(a - b), wrap - Math.abs(a - b)) : Math.abs(a - b));
const nearest = (values, v, wrap) => values.reduce((a, b) => (gap(b, v, wrap) < gap(a, v, wrap) ? b : a));

/* Each run is tagged, and a result is thrown away if a newer run has started since. Without
   it two overlapping loads race and whichever fetch finishes last wins, which is not
   necessarily the one the controls now describe. */
let runToken = 0;

async function runScenario(patch = {}, axis = null) {
  const token = ++runToken;
  Object.assign(state.params, patch);
  const root = $("rs-root");
  root.classList.add("rs-busy");
  try {
    const keepT = frame()?.t;
    let scn;
    if (STATIC()) {
      scn = await fetchJSON(`${STATIC()}/scenarios/${staticKey(axis)}.json`);
      syncInputs();
    } else {
      const body = {};
      for (const [k, v] of Object.entries(state.params)) if (v !== null && v !== undefined) body[k] = v;
      scn = await fetchJSON("/api/rs/scenario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    if (token !== runToken) return;          // a newer run has already started
    state.scenario = scn;
    setReserveHorizon(scn.front.horizon_min);
    state.frameIndex = keepT === undefined ? scn.times_min.findIndex((t) => t >= 0) : Math.max(0, scn.times_min.findIndex((t) => t >= keepT));
    if (state.frameIndex < 0) state.frameIndex = 0;
    banner(null);
    render(true);
  } catch (e) {
    if (token === runToken) banner(`That scenario could not be loaded: ${e.message}`);
  } finally {
    if (token === runToken) root.classList.remove("rs-busy");
  }
}

function setPlaying(on) {
  clearInterval(state.timer); state.timer = null; state.playing = on;
  const btn = $("rs-play");
  if (btn) btn.textContent = on ? "Pause" : "Play";
  if (!on) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const step = reduced ? 3 : 1;
  const fps = Math.max(2, Math.min(20, REPLAY_RATE / (stepMinutes() * 60)));
  state.timer = setInterval(() => {
    if (!state.scenario) return;
    const next = state.frameIndex + step;
    if (next >= state.scenario.frames.length) { setPlaying(false); return; }
    state.frameIndex = next; render(false);
  }, 1000 / fps);
}

const slider = (id, label, attrs, value) =>
  `<div class="rs-ctl"><label class="rs-ctl-label" for="${id}">${label}<b id="v-${id.slice(2)}">${value}</b></label>` +
  `<input id="${id}" class="rs-range" type="range" ${attrs}></div>`;

function layout() {
  $("rs-root").innerHTML = `
  <section class="rs-panel rs-hero">
    <div class="rs-panel-head">
      <h2>Power at the connection point</h2>
      <div class="rs-seg" role="group" aria-label="Controller">
        <button type="button" data-ctl="uni">Plant-level</button>
        <button type="button" data-ctl="bgc" class="is-on">Raseen</button>
      </div>
    </div>
    <div id="rs-gen" class="rs-chart"></div>
    <div class="rs-transport">
      <button id="rs-play" class="rs-btn primary" type="button">Play</button>
      <button id="rs-back" class="rs-btn" type="button">−1 min</button>
      <button id="rs-fwd" class="rs-btn" type="button">+1 min</button>
      <input id="rs-scrub" class="rs-range" type="range" min="0" max="840" value="0" aria-label="Time through the event">
      <span class="rs-marks" id="rs-marks"></span>
    </div>
  </section>

  <section class="rs-panel rs-readout" id="rs-readout" aria-label="Plant power right now">
    <div class="rs-cell amber"><span class="k"><i></i>Available</span><span class="v" id="rs-avail">—</span><span class="u">what the sun is offering</span></div>
    <div class="rs-cell accent lead"><span class="k"><i></i>Export</span><span class="v" id="rs-export">—</span><span class="u" id="rs-export-u">MW</span></div>
    <div class="rs-cell reserve"><span class="k"><i></i><span id="rs-reserve-k">Held headroom</span></span><span class="v" id="rs-reserve">—</span><span class="u" id="rs-reserve-u">MW</span></div>
    <div class="rs-cell"><span class="k"><i></i>Blocks in full sun</span><span class="v" id="rs-clear">—</span><span class="u" id="rs-clear-u">—</span></div>
    <div class="rs-cell"><span class="k"><i></i>Declared line</span><span class="v" id="rs-declared">—</span><span class="u">MW the plant promised</span></div>
  </section>

  <section class="rs-panel rs-balance">
    <p class="rs-balance-say" id="rs-say">—</p>
    <div id="rs-balance-split" hidden>
      <div class="rs-balance-bar" aria-hidden="true"><span class="covered" id="rs-bar-covered" style="width:0%"></span><span class="through" id="rs-bar-through" style="width:0%"></span></div>
      <div class="rs-balance-key">
        <span><i class="rs-sw" style="background:var(--violet)"></i>absorbed inside the plant</span>
        <span><i class="rs-sw" style="background:var(--amber)"></i>seen at the connection point</span>
      </div>
    </div>
  </section>

  <section class="rs-control-grid">
    <div class="rs-panel">
      <div class="rs-panel-head">
        <h2>The plant, block by block</h2>
        <div class="rs-seg" role="group" aria-label="Colour the blocks by">
          <button type="button" data-mode="output" class="is-on">Output</button>
          <button type="button" data-mode="headroom">Headroom</button>
          <button type="button" data-mode="eta">Cloud arrival</button>
        </div>
      </div>
      <div id="rs-map" class="rs-map-box"></div>
      <div class="rs-legend" id="rs-map-legend"></div>
      <p class="rs-note">Geometry is as-designed. Every value on it is simulated.</p>
    </div>

    <div class="rs-side">
      <div class="rs-panel">
        <div class="rs-panel-head"><h2>The cloud</h2><button id="rs-reset" class="rs-btn" type="button">Reset</button></div>
        <div class="rs-group">
          ${slider("p-speed", "Speed", 'min="10" max="120" step="1" value="48"', "48 km/h")}
          ${slider("p-cover", "Size", 'min="0.1" max="1" step="0.05" value="1"', "the whole plant")}
          ${slider("p-offset", "Position", 'min="-1" max="1" step="0.05" value="0"', "centred")}
          ${slider("p-heading", "Direction of travel", 'min="0" max="359" step="1" value="90"', "090° west to east")}
        </div>
        <div class="rs-group">
          <h3>What kind of cloud</h3>
          <div class="rs-seg" role="group" aria-label="Cloud type" style="margin-bottom:12px">
            <button type="button" data-event="solid" class="is-on">Solid front</button>
            <button type="button" data-event="thin">Thin band</button>
            <button type="button" data-event="scattered">Scattered</button>
          </div>
          ${slider("p-depth", "Power lost under full cover", 'min="0.2" max="0.8" step="0.05" value="0.6"', "60 %")}
          ${slider("p-soft", "Edge softness", 'min="0" max="1" step="0.05" value="0"', "hard-edged")}
        </div>
        <p class="rs-note" id="rs-static-note" hidden></p>
      </div>

      <div class="rs-panel">
        <div class="rs-panel-head"><h2>The response</h2></div>
        ${slider("p-g", "Declared down-gradient", 'min="30" max="180" step="5" value="90"', "90 MW/min")}
        ${slider("p-conf", "Confidence in the forecast", 'min="0.3" max="0.9" step="0.1" value="0.7"', "0.7")}
        <label class="rs-check"><input id="p-flat" type="checkbox"> Hold the plant flat right through the event instead of ramping down</label>
        <div class="rs-btn-row">
          <button id="rs-stall" class="rs-btn warn" type="button">Stall the front now</button>
          <button id="rs-deepen" class="rs-btn warn" type="button">Deepen it 20 % now</button>
        </div>
        <p class="rs-note" id="rs-perturb"></p>
        <dl class="rs-dl" id="rs-intel"></dl>
      </div>

      <div class="rs-panel">
        <div class="rs-panel-head"><h2>Situation</h2></div>
        <div class="rs-ctl"><label class="rs-ctl-label" for="p-situation">Load a prepared case</label>
          <select id="p-situation">${SITUATIONS.map((p) => `<option value="${p.key}">${p.label}</option>`).join("")}</select></div>
      </div>
    </div>
  </section>

  <section class="rs-panel">
    <div class="rs-panel-head"><h2>Set-point of every control block</h2>
      <div class="rs-seg" role="group" aria-label="Order the blocks by">
        <button type="button" data-order="eta" class="is-on">By arrival</button>
        <button type="button" data-order="id">West to east</button>
      </div></div>
    <div id="rs-blocks" class="rs-chart"></div>
    <div class="rs-legend">
      <span><i class="rs-sw" style="background:var(--accent)"></i>set-point</span>
      <span><i class="rs-sw" style="background:var(--amber);height:3px"></i>available</span>
      <span><i class="rs-sw" style="background:var(--violet)"></i>headroom that can still be spent</span>
      <span><i class="rs-sw" style="background:var(--violet-dim)"></i>headroom that expires under the cloud</span>
      <span><i class="rs-sw" style="background:var(--violet);clip-path:polygon(50% 0,100% 100%,0 100%)"></i>raising output right now</span>
    </div>
  </section>

  <section class="rs-split">
    <div class="rs-panel">
      <div class="rs-panel-head"><h2>How the event ends</h2></div>
      <div class="rs-tiles" id="rs-kpis"></div>
      <p class="rs-honesty" id="rs-honesty"></p>
    </div>
    <div class="rs-panel">
      <div class="rs-panel-head"><h2>Steepest fall at the connection point</h2></div>
      <div class="rs-ramp-big"><span class="from" id="rs-ramp-from">—</span><span class="arrow">→</span><span class="to" id="rs-ramp-to">—</span><span class="u">MW/min</span></div>
      <p class="rs-note" id="rs-ramp-note"></p>
    </div>
  </section>`;
}

function loadSituation(key) {
  const s = SITUATIONS.find((p) => p.key === key) || SITUATIONS[0];
  state.situation = s.key;
  state.params = { ...DEFAULTS, ...s.params };
  syncInputs();
  runScenario();
}

/* Plain-language readouts. A slider value is a fraction of the plant's across-heading width,
   which is not a phrase anyone wants to read off a dashboard. */
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const coverLabel = (v) => (v >= 0.999 ? "the whole plant" : `${Math.round(v * 100)} % of the width`);
const offsetLabel = (v) => (Math.abs(v) < 0.03 ? "centred" : `${Math.round(Math.abs(v) * 100)} % toward the ${v < 0 ? "near" : "far"} edge`);
const softLabel = (v) => (v < 0.03 ? "hard-edged" : v > 0.95 ? "thin haze" : `${Math.round(v * 100)} % soft`);
const headingLabel = (deg) => {
  const from = COMPASS[Math.round(((deg + 180) % 360) / 45) % 8];
  const to = COMPASS[Math.round(deg / 45) % 8];
  return `${String(Math.round(deg)).padStart(3, "0")}° ${from} to ${to}`;
};

/** Paint the filled portion of a slider track to match its value. */
function paintRange(input) {
  const min = Number(input.min), max = Number(input.max);
  const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
  input.style.setProperty("--rs-fill", `${pct}%`);
}

function bindControls() {
  const on = (id, ev, fn) => $(id)?.addEventListener(ev, fn);
  /* A slider reports live while it is dragged and only re-runs the scenario on release:
     each run is a full plant simulation, so firing one per pixel would make it unusable. */
  const bindSlider = (id, labelFn, param, axisKey) => {
    const input = $(id), out = $(`v-${id.slice(2)}`);
    const axis = AXES.find((a) => a.key === axisKey) || null;
    if (!input) return;
    paintRange(input);
    input.addEventListener("input", () => { out.textContent = labelFn(Number(input.value)); paintRange(input); });
    input.addEventListener("change", () => runScenario({ [param]: Number(input.value) }, axis));
  };
  bindSlider("p-speed", (v) => `${v} km/h`, "speed_kmh", "speed");
  bindSlider("p-cover", coverLabel, "cover_frac", "size");
  bindSlider("p-offset", offsetLabel, "cover_offset", "pos");
  bindSlider("p-heading", headingLabel, "heading_deg", "angle");
  bindSlider("p-depth", (v) => `${Math.round(v * 100)} %`, "depth");
  bindSlider("p-soft", softLabel, "softness");
  bindSlider("p-g", (v) => `${v} MW/min`, "g_mw_min");
  bindSlider("p-conf", (v) => String(v), "confidence");

  on("p-situation", "change", (e) => loadSituation(e.target.value));
  on("p-flat", "change", (e) => runScenario({ flat: e.target.checked }));
  on("rs-stall", "click", () => runScenario({ stall_at_min: Math.round((frame()?.t ?? -3) * 6) / 6, deepen_at_min: null }));
  on("rs-deepen", "click", () => runScenario({ deepen_at_min: Math.round((frame()?.t ?? 2) * 6) / 6, deepen_factor: 1.2, stall_at_min: null }));
  on("rs-reset", "click", () => { state.params = { ...DEFAULTS }; state.situation = "d1-default"; syncInputs(); runScenario(); });

  /* Scoped to our own root, never the document: the Plant page hosts this view alongside its
     supervisory dashboard, which has its own [data-mode] segmented control. A document-wide
     selector bound this handler to those buttons too and left them with no active state. */
  const root = $("rs-root");
  const segment = (attr, fn) => {
    const buttons = [...root.querySelectorAll(`[data-${attr}]`)];
    for (const b of buttons) {
      b.addEventListener("click", () => {
        buttons.forEach((x) => x.classList.toggle("is-on", x === b));
        fn(b.dataset[attr]);
      });
    }
  };
  segment("mode", (v) => { state.mode = v; state.view?.setMode(v); paintMapLegend(); });
  segment("ctl", (v) => { state.controller = v; render(true); });
  segment("order", (v) => { state.order = v; renderBlocks(); });
  segment("event", (v) => runScenario({ event: v }));

  on("rs-play", "click", () => setPlaying(!state.playing));
  on("rs-back", "click", () => seek(state.frameIndex - rateWindow()));
  on("rs-fwd", "click", () => seek(state.frameIndex + rateWindow()));
  on("rs-scrub", "input", (e) => seek(Number(e.target.value)));
  document.addEventListener("keydown", (e) => {
    if (!state.scenario || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    const step = e.shiftKey ? rateWindow() : 1;
    if (e.key === "ArrowLeft") { seek(state.frameIndex - step); e.preventDefault(); }
    if (e.key === "ArrowRight") { seek(state.frameIndex + step); e.preventDefault(); }
    if (e.key === " ") { setPlaying(!state.playing); e.preventDefault(); }
  });
}

function seek(index) {
  if (!state.scenario) return;
  setPlaying(false);
  state.frameIndex = Math.max(0, Math.min(state.scenario.frames.length - 1, index));
  render(false);
}

function syncInputs() {
  const p = state.params;
  const set = (id, value, label) => {
    const input = $(id);
    if (!input) return;
    input.value = value;
    paintRange(input);
    const out = $(`v-${id.slice(2)}`);
    if (out) out.textContent = label;
  };
  if ($("p-situation")) $("p-situation").value = state.situation;
  set("p-speed", p.speed_kmh, `${p.speed_kmh} km/h`);
  set("p-cover", p.cover_frac, coverLabel(p.cover_frac));
  set("p-offset", p.cover_offset, offsetLabel(p.cover_offset));
  set("p-heading", p.heading_deg, headingLabel(p.heading_deg));
  set("p-depth", p.depth, `${Math.round(p.depth * 100)} %`);
  set("p-soft", p.softness, softLabel(p.softness));
  set("p-g", p.g_mw_min, `${p.g_mw_min} MW/min`);
  set("p-conf", p.confidence, String(p.confidence));
  $("p-flat").checked = p.flat;
  for (const b of $("rs-root").querySelectorAll("[data-event]")) b.classList.toggle("is-on", b.dataset.event === p.event);
}

async function makeView() {
  state.view?.destroy();
  const box = $("rs-map"); box.replaceChildren();
  const hooks = {
    onSelect: (id) => { state.selected = id; state.view?.select?.(id); renderBlocks(); },
    onHover: (e, i) => showTip(e, `${state.site.blocks[i].id} — ${state.site.blocks[i].label}`, blockRows(frame(), i, state.controller, state.site.blocks[i].capacity_mw)),
    onLeave: hideTip,
  };
  let v = new (SiteMap.available() ? SiteMap : SitePlan)(box, state.site, hooks);
  const ok = await v.init();
  if (!ok && v instanceof SiteMap) {
    v.destroy();
    v = new SitePlan(box, state.site, hooks);
    await v.init();
    banner("Satellite tiles are unavailable, so the map is showing the as-designed plan instead.", "note");
  }
  state.view = v;
  v.setMode(state.mode);
  v.setFrame(frame(), state.controller);
}

function paintMapLegend() {
  const m = state.mode;
  $("rs-map-legend").innerHTML =
    m === "output" ? '<span>set-point as a share of block capacity</span><span><i class="rs-sw" style="background:linear-gradient(90deg,var(--ramp-0),var(--ramp-3),var(--ramp-5))"></i>0 to 100 %</span>'
      : m === "headroom" ? '<span>held headroom</span><span><i class="rs-sw" style="background:var(--violet)"></i>can still be spent</span><span><i class="rs-sw" style="background:var(--violet-dim)"></i>expires under the cloud</span>'
        : '<span>minutes until the cloud arrives</span><span><i class="rs-sw" style="background:var(--cyan)"></i>now to 15+</span><span><i class="rs-sw" style="background:var(--surface-3)"></i>passed, or never reached</span>';
}

const tile = (cls, k, v, u) => `<div class="rs-tile ${cls}"><span class="k">${k}</span><span class="v">${v}</span><span class="u">${u}</span></div>`;

//: A block counts as "in full sun" below this coverage — a soft cloud never reaches 1.0, so
//  testing for exactly zero would call a hazed block clear.
const CLEAR_COV = 0.02;

/** Minutes between two frames of the loaded scenario. */
function stepMinutes() {
  const t = state.scenario?.times_min;
  return t && t.length > 1 ? Math.abs(t[1] - t[0]) : 1 / 6;
}
/** How many frames back one minute is — the window the balance panel reads its rates over. */
const rateWindow = () => Math.max(1, Math.round(1 / stepMinutes()));

/** How much of the plant is still in sun, and how much headroom is standing on it. */
function renderClear(f, ctl) {
  const cov = f.coverage || [];
  const n = cov.length;
  let clear = 0, head = 0;
  for (let i = 0; i < n; i += 1) {
    if (cov[i] > CLEAR_COV) continue;
    clear += 1;
    head += Math.max(0, (f.A?.[i] ?? 0) - (f[`P_${ctl}`]?.[i] ?? 0));
  }
  $("rs-clear").textContent = n ? `${clear} / ${n}` : "—";
  $("rs-clear-u").textContent = !clear
    ? "the cloud is over every block"
    : head > 0.5
      ? `holding ${fmt(head, 0)} MW between them`
      : "in sun, but nothing held back on them";
}

/* The mechanism, measured over the last minute.

   Three separate measurements: what the sun took off the blocks it reached, what the blocks
   still in full sun put back, and how far export actually moved. They are reported as three
   facts and never combined into one, because they do not add up — curtailment already
   standing on a block that then goes under the cloud is spent quietly too, and is in none of
   the three.

   The panel has three states, because the plant is doing three different things over an
   event and one sentence cannot describe them all honestly:
     · the cloud has taken nothing this minute — before it arrives, or after it has gone;
     · export is coming down FASTER than the sun is — the declared descent, running ahead of
       the front to open the gap it will spend. Nothing to split here: the fall is the
       controller's own, not the cloud's, and a bar reading "100 % reached the grid" would say
       the exact opposite of what is happening;
     · the sun is falling faster than export is — the absorbing state, and the only one where
       the bar means anything. There the split IS exact: whatever the meter did not see was
       held somewhere in the plant. */
function renderBalance(f, ctl) {
  const k0 = Math.max(0, state.frameIndex - rateWindow());
  const prev = frameAt(k0);
  const dt = Math.max(1e-6, f.t - prev.t);
  const P = `P_${ctl}`;
  let lost = 0, given = 0;
  for (let i = 0; i < f.A.length; i += 1) {
    lost += Math.max(0, prev.A[i] - f.A[i]);
    // Only blocks the readout above calls clear, so the sentence and the cell agree.
    if ((f.coverage[i] ?? 0) <= CLEAR_COV) given += Math.max(0, f[P][i] - prev[P][i]);
  }
  lost /= dt; given /= dt;
  const fell = (prev.agg[P] - f.agg[P]) / dt;
  const held = Math.max(0, f.agg.A - f.agg[P]);
  const say = $("rs-say"), split = $("rs-balance-split");

  if (lost < 1) {
    split.hidden = true;
    say.innerHTML = CLIMBING.has(f.phase)
      ? `${f.phase === "exit" ? "The cloud is thinning" : "The cloud has gone"}. Export is climbing back toward the <b class="lost">${fmt(f.agg.A, 0)} MW</b> the sun is offering, at the declared up-gradient rather than all at once.`
      : fell > 1
        ? `Nothing is shaded yet, and export is already coming down <b class="meter">${fmt(fell, 0)} MW</b> a minute. That is the point: the plant descends ahead of the front, and the gap it opens — <b class="back">${fmt(held, 0)} MW</b> so far — is what it will spend when the cloud lands.`
        : held > 1
          ? `The cloud has not reached a block yet. Raseen is holding <b class="back">${fmt(held, 0)} MW</b> back across the plant, ready to spend the moment it does.`
          : f.coverage.some((c) => c > CLEAR_COV)
            // Under cover there is nothing left to hold: every block is already at its floor,
            // and saying "nothing is shaded" here would contradict the cell beside it.
            ? `The cloud is over the plant and has taken all it is going to. Export is the <b class="lost">${fmt(f.agg.A, 0)} MW</b> the sun still offers, with nothing held back.`
            : "Every block is exporting all the power the sun is offering, and nothing is shaded.";
    return;
  }

  if (fell >= lost) {
    // Descending faster than the sun: the fall is the declared ramp, not the cloud.
    split.hidden = true;
    say.innerHTML =
      `The cloud has taken <b class="lost">${fmt(lost, 0)} MW</b> in the last minute and export came down ` +
      `<b class="meter">${fmt(fell, 0)} MW</b> — faster than the cloud, on purpose. Raseen is still descending ` +
      `ahead of the front, and is holding <b class="back">${fmt(held, 0)} MW</b> in hand.`;
    return;
  }

  split.hidden = false;
  const seen = Math.max(0, Math.min(lost, fell));
  say.innerHTML =
    `In the last minute the cloud took <b class="lost">${fmt(lost, 0)} MW</b> off the blocks it reached. ` +
    (given > 1 ? `Blocks still in full sun raised their output by <b class="back">${fmt(given, 0)} MW</b>. ` : "") +
    `Export fell <b class="meter">${fmt(Math.max(0, fell), 0)} MW</b>.`;
  const pct = (v) => `${(v / lost) * 100}%`;
  $("rs-bar-covered").style.width = pct(lost - seen);
  $("rs-bar-through").style.width = pct(seen);
}

function render(full) {
  const scn = state.scenario, f = frame();
  if (!scn || !f) return;
  const ctl = state.controller;
  $("rs-scrub").max = String(scn.frames.length - 1);
  $("rs-scrub").value = String(state.frameIndex);
  paintRange($("rs-scrub"));
  // The host page owns the clock and the phase chip: the standalone page puts them in its
  // topbar, the Plant page in its own head. Either way they are optional.
  const clock = $("rs-clock");
  if (clock) clock.textContent = `t ${clockLabel(f.t)}`;
  const phase = $("rs-phase");
  if (phase) { phase.textContent = PHASE_LABEL[f.phase] ?? f.phase; phase.dataset.phase = f.phase; }
  $("rs-avail").textContent = fmt(f.agg.A, 0);
  $("rs-export").textContent = fmt(f.agg[`P_${ctl}`], 0);
  $("rs-export-u").textContent = `MW under ${ctl === "bgc" ? "Raseen" : "one plant-level set-point"}`;
  $("rs-declared").textContent = fmt(f.agg.P_star, 0);
  // Below available power is only "held" while the plant is on its way down or under cover.
  // On the way back out the same gap is the declared up-gradient, and calling that a reserve
  // would claim a choice nobody made. The reserve is also only worth the part that outlives
  // the next few minutes, so say which part that is instead of printing a bare zero.
  const held = Math.max(0, f.agg.A - f.agg[`P_${ctl}`]);
  const climbing = CLIMBING.has(f.phase);
  $("rs-reserve").textContent = fmt(held, 0);
  $("rs-reserve-k").textContent = climbing ? "Below available" : "Held headroom";
  $("rs-reserve-u").textContent = ctl !== "bgc"
    ? "MW, none of it declarable block by block"
    : held < 0.5
      ? "MW — nothing is being held back"
      : climbing
        ? "MW, closing at the declared up-gradient"
        : f.agg.R > 0.5
          ? `MW, of which ${fmt(f.agg.R, 0)} MW can still be spent`
          : "MW, none of it far enough from the cloud to be spent";
  renderClear(f, ctl);
  renderBalance(f, ctl);
  state.view?.setFrame(f, ctl);
  renderGen();
  renderBlocks();
  if (full) {
    const fr = scn.front, k = scn.kpis;
    $("rs-ramp-from").textContent = `−${fmt(k.base.max_grad_mw_min, 0)}`;
    $("rs-ramp-to").textContent = `−${fmt(k[ctl].max_grad_mw_min, 0)}`;
    // g is the gradient the plant declares; the lead L is what that choice costs, not an
    // input. On a concave front the descent starts earlier than D / g would suggest, so the
    // three numbers are stated as they are rather than as an identity they do not satisfy.
    $("rs-ramp-note").textContent =
      `Left uncontrolled the plant follows the sun down. Raseen declares ${fmt(fr.g_mw_min, 0)} MW/min, ` +
      `or ${fmt(fr.g_mw_min / 30, 1)} % of the plant a minute. Holding that through a ${fmt(fr.D_mw, 0)} MW loss ` +
      `over a ${fmt(fr.tau_min, 1)} min crossing means starting the descent ${fmt(fr.L_min, 1)} min before the ` +
      `cloud arrives.` +
      (fr.lead_shortfall_min > 0 ? ` That is ${fmt(fr.lead_shortfall_min, 1)} min more lead than the forecast window allows.` : "");
    $("rs-intel").innerHTML = [
      ["Crossing time", `${fmt(fr.tau_min, 1)} min`],
      ["Lead before contact", `${fmt(fr.L_min, 1)} min`],
      ["Power lost at full cover", `${fmt(fr.D_mw, 0)} MW`],
      ["Reserve this confidence buys", `${fmt(fr.delta_mw, 0)} MW`],
    ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("");
    const perturb = $("rs-perturb");
    if (perturb) perturb.textContent = fr.stall_at_min !== null
      ? "The front stalled. Curtailment is released nearest-first after a two-minute confirmation, and the energy spilled while waiting is logged as the cost of the false alarm."
      : fr.deepen_at_min !== null
        ? "The front is deeper than forecast. The reserve absorbs the extra loss if it can; if it cannot, export leaves the declared line."
        : "";
    renderKpis();
    renderMarks();
  }
}

//: The two phases where the plant is on its way back up. Anything below available power is
//  then the declared up-gradient, not headroom anyone chose to hold — the copy must not call
//  it a reserve.
const CLIMBING = new Set(["exit", "after"]);

const PHASE_LABEL = {
  before: "Before contact", transit: "Cloud crossing", cover: "Full cover",
  exit: "Clearing", after: "Clear", released: "Released",
};

function renderGen() {
  const scn = state.scenario, ctl = state.controller;
  const x = scn.times_min, agg = scn.frames.map((fr) => fr.agg);
  // "Uncontrolled" is not drawn as its own line: with no control the export IS the available
  // power, so the amber line is already both. Saying it twice invented a distinction.
  const series = [
    { name: "available", values: agg.map((a) => a.A), color: cssVar("--amber") },
    { name: "plant-level", values: agg.map((a) => a.P_uni), color: cssVar("--muted") || "#7c9088", width: ctl === "uni" ? 2.6 : 1.3, fade: ctl !== "uni" },
    { name: "Raseen", values: agg.map((a) => a.P_bgc), color: cssVar("--accent"), width: ctl === "bgc" ? 2.6 : 1.3, fade: ctl !== "bgc" },
    { name: "declared", values: agg.map((a) => a.P_star), color: cssVar("--rs-text"), dashed: true, width: 1 },
  ];
  const fr = scn.front;
  lineChart($("rs-gen"), {
    x, series, height: 268, yLabel: "MW",
    label: "Available power and export at the connection point through the cloud event",
    bands: [{ name: "headroom", upper: agg.map((a) => a.A), lower: agg.map((a) => a[`P_${ctl}`]), color: cssVar("--violet"), opacity: 0.22 }],
    markers: [{ x: fr.t_desc_start_min, label: "ramp starts" }, { x: 0, label: "cloud arrives" }, { x: fr.t_rise_min, label: "clearing" }],
    cursorIndex: state.frameIndex,
    onHover: (i, e) => {
      const a = agg[i];
      showTip(e, clockLabel(x[i]), [
        { name: "Available", value: `${fmt(a.A, 0)} MW` },
        { name: "Raseen", value: `${fmt(a.P_bgc, 0)} MW` },
        { name: "Plant-level", value: `${fmt(a.P_uni, 0)} MW` },
        { name: "Declared", value: `${fmt(a.P_star, 0)} MW` },
      ]);
    },
    onLeave: hideTip,
    onSeek: (i) => seek(i),
  });
}

function renderBlocks() {
  const scn = state.scenario, f = frame();
  if (!scn) return;
  blockGradient($("rs-blocks"), state.site.blocks, f, {
    controller: state.controller, order: state.order, selected: state.selected,
    horizon: scn.front.horizon_min, prev: frameAt(state.frameIndex - 1),
    onSelect: (id) => { state.selected = id; state.view?.select?.(id); renderBlocks(); },
    onHover: (i, e) => showTip(e, `${state.site.blocks[i].id} — ${state.site.blocks[i].label}`, blockRows(f, i, state.controller, state.site.blocks[i].capacity_mw)),
    onLeave: hideTip,
  });
}

function renderKpis() {
  const scn = state.scenario, ctl = state.controller, other = ctl === "bgc" ? "uni" : "bgc";
  const k = scn.kpis[ctl], b = scn.kpis.base, o = scn.kpis[other], e = scn.economics;
  $("rs-kpis").innerHTML = [
    tile("", "Steepest 10-minute drop", fmt(k.max_drop10_mw, 0), `MW, against ${fmt(b.max_drop10_mw, 0)} uncontrolled`),
    tile("", "Steepest fall", fmt(k.max_grad_mw_min, 0), `MW/min, against ${fmt(b.max_grad_mw_min, 0)} uncontrolled`),
    tile("reserve", "Reserve at contact", fmt(k.firm_at_contact_mw, 0), ctl === "bgc" ? "MW held where it could still be spent" : "MW, not declarable plant-wide"),
    tile("", "Energy not exported", fmt(k.spill_mwh, 0), `MWh, ${fmt(e.spill_share_of_day_pct, 1)} % of a clear day`),
    tile("", "Curtailed while already shaded", fmt(k.shaded_curtailment_mwh ?? 0, 1), `MWh, against ${fmt(o.shaded_curtailment_mwh ?? 0, 1)} the other way`),
    tile("", "Value of the energy not exported", fmt(e.spill_sar, 0), `SAR for this event`),
  ].join("");
  $("rs-honesty").textContent =
    "Both controllers give up the same energy for a front this well forecast — what is spilled is set by the declared gradient, not by which blocks are asked to back off. " +
    "What placing it block by block adds is a reserve that can be declared and spent, no step changes on individual blocks, and nothing taken from blocks the cloud has already covered.";
}

function renderMarks() {
  const fr = state.scenario.front, x = state.scenario.times_min, n = x.length - 1;
  $("rs-marks").innerHTML = [
    ["ramp starts", `${fmt(fr.t_desc_start_min, 1)} min`],
    ["crossing", `${fmt(fr.tau_min, 1)} min`],
    ["clears", `${fmt(fr.t_rise_min, 1)} min`],
  ].map(([a, b]) => `<span>${a} <b>${b}</b></span>`).join("");
}

/* Build the UI inside #rs-root. Safe to call more than once: the second call just resizes,
   so the Plant page can mount it lazily the first time its gradient-control view is shown
   without paying for the map and the scenario on page load. */
let mounted = false;
export async function mountGradientControl() {
  if (mounted) { state.view?.resize?.(); return; }
  if (!$("rs-root")) return;
  mounted = true;
  layout();
  bindControls();
  if (STATIC()) {
    // No server to compute a scenario, so each slider axis is pre-rendered on its own and
    // the others return to their defaults when you move one. Say so rather than hiding it.
    const note = $("rs-static-note");
    note.hidden = false;
    note.textContent = "This is the published build, so the sliders step between pre-computed clouds and move one at a time — the other three return to their defaults. Run the app locally for free movement.";
    for (const id of ["p-depth", "p-soft", "p-g", "p-conf", "p-flat", "rs-stall", "rs-deepen"]) {
      const el = $(id);
      if (!el) continue;
      el.disabled = true;
      (el.closest(".rs-ctl, .rs-check, .rs-btn-row") ?? el).hidden = true;
    }
    $("rs-reset").hidden = true;
    for (const b of $("rs-root").querySelectorAll("[data-event]")) b.disabled = true;
  }
  paintMapLegend();
  try {
    state.site = await fetchJSON(STATIC() ? `${STATIC()}/site.json` : "/api/rs/site");
  } catch (e) {
    banner(`The plant could not be loaded: ${e.message}`);
    return;
  }
  await makeView();
  await runScenario();
  let resizeTimer = null;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.scenario) { renderGen(); renderBlocks(); } }, 120);
  }, { passive: true });
}

/* Exposed on window so a host page can mount us from a plain (non-module) script — the
   static build only rewrites src= and href= paths, not bare imports inside inline scripts. */
window.RaseenGC = {
  mount: mountGradientControl,
  resize: () => state.view?.resize?.(),
  pause: () => setPlaying(false),
};

// The standalone /control page mounts immediately; a host page sets this flag and calls
// window.RaseenGC.mount() when it is ready.
if (!window.RASEEN_GC_MANUAL) mountGradientControl();
