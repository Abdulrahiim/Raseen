/* Gradient control: a cloud crosses Humaij, and Raseen holds the plant's export to a
   declared ramp by holding power back on the blocks that are still in sun and letting it go
   as the cloud lands on the others.

   Nothing here is stored — there is no battery. A block held below the power it could make
   can be let back up later, and that is the whole mechanism; the page's job is to make it
   legible minute by minute. Everything shown is simulated and labelled so.

   Raseen has two ways of using that mechanism, and both are computed for every cloud: the
   declared ramp (export comes down at the declared gradient, headroom kept on the blocks the
   cloud reaches last) and pre-hold and backfill (every block held down evenly ahead of the
   front, the blocks still in sun raising their output when it lands so export stays flat).
   The page shows one at a time; the strategy segment in The response panel chooses. */
import { SiteMap } from "./site-map.js";
import { SitePlan, blockRows, setReserveHorizon } from "./site-plan.js";
import { lineChart, blockGradient } from "./charts.js";
import { fmt, clockLabel } from "./format.js";
import { cssVar } from "./colour.js";

const $ = (id) => document.getElementById(id);
const PLANT_MW = 3000;

/* Replay speed, in simulated seconds per real second. Real time is what an operator would
   sit through; ×10 is the default, so a two-hour event plays in minutes and a ten-minute
   lead still takes a minute to watch. The old fixed rate of 100 played the whole event in
   under a minute and a half, which is why the cloud looked like it was doing 500 km/h. The
   timer runs at a fixed tick and accumulates simulated seconds, so the published build's
   twenty-second frames and the live server's ten-second frames play at the same pace. */
const SPEEDS = [
  { v: 1, label: "Real time" }, { v: 5, label: "×5" }, { v: 10, label: "×10" },
  { v: 30, label: "×30" }, { v: 60, label: "×60" },
];
const SPEED_DEFAULT = 10;
const TICK_MS = 100;
function loadSpeed() {
  try {
    const v = Number(localStorage.getItem("rs-speed"));
    return SPEEDS.some((s) => s.v === v) ? v : SPEED_DEFAULT;
  } catch (e) { return SPEED_DEFAULT; }
}
function saveSpeed(v) { try { localStorage.setItem("rs-speed", String(v)); } catch (e) { /* private mode */ } }

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
   forecast that turns out to be wrong, a different declared gradient. A situation may also
   choose the strategy it is best watched with (`view`); the sliders never do. */
const SITUATIONS = [
  { key: "d1-default", label: "Design case: a solid front at 48 km/h", params: {} },
  { key: "band-middle", label: "A band over the middle of the plant", params: { cover_frac: 0.4 }, view: { controller: "hold" } },
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

/* `controller` is what the page shows: "uni" (one plant-level set-point), "bgc" (Raseen,
   declared ramp) or "hold" (Raseen, pre-hold and backfill). `strategy` remembers which of
   the two Raseen ways was last chosen, so switching from Plant-level back to Raseen returns
   to it. `grain` is the block chart's resolution: the 363 stations, or the 30 blocks. */
const state = {
  site: null, scenario: null, frameIndex: 0, controller: "bgc", strategy: "bgc", mode: "output",
  order: "eta", grain: "stations", playing: false, selected: null, params: { ...DEFAULTS },
  situation: "d1-default", view: null, timer: null, speed: loadSpeed(), acc: 0,
  events: [], eventCursor: -1, noticeTimer: null,
};

const frameAt = (k) => (state.scenario ? state.scenario.frames[Math.max(0, Math.min(k, state.scenario.frames.length - 1))] : null);
const frame = () => frameAt(state.frameIndex);

/* Every reader of a controller's numbers goes through these, because a scenario file may
   predate the second strategy: the published build and any cached run from before it carry
   no P_hold, and the page must draw the ramp rather than nothing. */
const isRaseen = (ctl) => ctl !== "uni";
const P_OF = (f, ctl) => f[`P_${ctl}`] ?? f.P_bgc;
const aggP = (agg, ctl) => agg[`P_${ctl}`] ?? agg.P_bgc;
const declaredOf = (agg, ctl) => (ctl === "hold" ? agg.P_star_hold ?? agg.P_star : agg.P_star);
const reserveOf = (agg, ctl) => (ctl === "hold" ? agg.R_hold ?? agg.R : agg.R);
const kpiOf = (scn, ctl) => scn.kpis[ctl] ?? scn.kpis.bgc;
/* The comparison every summary tile makes: Raseen's two strategies against each other, and
   the plant-level rule against Raseen's ramp. */
const otherOf = (ctl) => (ctl === "uni" ? "bgc" : ctl === "bgc" ? "hold" : "bgc");
const CTL_LABEL = { uni: "one plant-level set-point", bgc: "Raseen, declared ramp", hold: "Raseen, pre-hold and backfill" };

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
    setPlaying(false);
    closeBriefing();
    state.scenario = scn;
    setReserveHorizon(scn.front.horizon_min);
    state.frameIndex = keepT === undefined ? scn.times_min.findIndex((t) => t >= 0) : Math.max(0, scn.times_min.findIndex((t) => t >= keepT));
    if (state.frameIndex < 0) state.frameIndex = 0;
    banner(null);
    rebuildEvents();
    render(true);
  } catch (e) {
    if (token === runToken) banner(`That scenario could not be loaded: ${e.message}`);
  } finally {
    if (token === runToken) root.classList.remove("rs-busy");
  }
}

/* Playback. A fixed tick accumulates simulated seconds at the chosen speed and advances a
   frame each time it passes the scenario's own step, so any speed works and the frame rate
   follows the file rather than the other way round. Reduced motion keeps the coarser three-
   frame stepping the page always had. */
function setPlaying(on) {
  clearInterval(state.timer); state.timer = null; state.playing = on;
  const btn = $("rs-play");
  if (btn) btn.textContent = on ? "Pause" : "Play";
  if (!on) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const chunk = reduced ? 3 : 1;
  state.acc = 0;
  state.timer = setInterval(() => {
    if (!state.scenario) return;
    state.acc += state.speed * (TICK_MS / 1000);
    const stepS = stepMinutes() * 60 * chunk;
    let moved = 0;
    while (state.acc >= stepS) { state.acc -= stepS; moved += chunk; }
    if (!moved) return;
    const next = state.frameIndex + moved;
    if (next >= state.scenario.frames.length) { state.frameIndex = state.scenario.frames.length - 1; render(false); setPlaying(false); return; }
    state.frameIndex = next; render(false);
  }, TICK_MS);
}

/* autocomplete="off" on every slider: the browser restores form values on a reload, and it
   does so after the page has synced them to the loaded scenario — leaving a slider that
   disagrees with the data it is supposed to describe. */
const slider = (id, label, attrs, value) =>
  `<div class="rs-ctl"><label class="rs-ctl-label" for="${id}">${label}<b id="v-${id.slice(2)}">${value}</b></label>` +
  `<input id="${id}" class="rs-range" type="range" autocomplete="off" ${attrs}></div>`;

/* The exact words for each strategy, under the segment that chooses it. */
const STRATEGY_NOTE = {
  bgc: "Export comes down at the declared gradient and climbs back at the same rate. Headroom is held on the blocks the cloud reaches last, where it can still be spent.",
  hold: "Ahead of the cloud every block is held down evenly by the forecast loss plus a margin. When the cloud lands, the blocks still in sun raise their output and export stays flat through the crossing. Nothing is stored — the blocks in sun give back what they were holding.",
};

function layout() {
  $("rs-root").innerHTML = `
  <section class="rs-panel rs-hero">
    <div class="rs-panel-head">
      <h2>Power at the connection point</h2>
      <div class="rs-seg" role="group" aria-label="Controller" id="rs-ctl">
        <button type="button" data-ctl="uni">Plant-level</button>
        <button type="button" data-ctl="bgc" class="is-on">Raseen</button>
      </div>
    </div>
    <div id="rs-gen" class="rs-chart"></div>
    <div class="rs-transport" id="rs-transport">
      <button id="rs-replay" class="rs-btn primary" type="button" title="Jump to the forecast, read the briefing, then watch the response run">Replay the event</button>
      <button id="rs-play" class="rs-btn" type="button">Play</button>
      <button id="rs-back" class="rs-btn" type="button">−1 min</button>
      <button id="rs-fwd" class="rs-btn" type="button">+1 min</button>
      <input id="rs-scrub" class="rs-range" type="range" min="0" max="840" value="0" autocomplete="off" aria-label="Time through the event">
      <label class="rs-speed"><span>Speed</span>
        <select id="rs-speed" autocomplete="off" aria-label="Replay speed, simulated seconds per real second">
          ${SPEEDS.map((s) => `<option value="${s.v}"${s.v === state.speed ? " selected" : ""}>${s.label}</option>`).join("")}
        </select></label>
      <span class="rs-marks" id="rs-marks"></span>
    </div>
    <ol class="rs-events" id="rs-events" aria-label="What happens through the event"></ol>
  </section>

  <section class="rs-panel rs-brief" id="rs-brief" hidden aria-live="polite">
    <div class="rs-panel-head">
      <h2>Forecast received</h2>
      <span class="rs-brief-when" id="rs-brief-when"></span>
    </div>
    <p class="rs-brief-say" id="rs-brief-forecast"></p>
    <p class="rs-brief-say"><span class="rs-brief-k">Suggested response</span> <span id="rs-brief-response"></span></p>
    <div class="rs-btn-row rs-brief-actions">
      <button id="rs-brief-run" class="rs-btn primary" type="button">Run the response</button>
      <button id="rs-brief-dismiss" class="rs-btn" type="button">Dismiss</button>
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
        <div class="rs-seg" role="group" aria-label="Colour the blocks by" id="rs-map-modes">
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
      <div class="rs-panel" id="rs-cloud">
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

      <div class="rs-panel" id="rs-response">
        <div class="rs-panel-head"><h2>The response</h2></div>
        <div class="rs-group">
          <h3>Strategy</h3>
          <div class="rs-seg" role="group" aria-label="Raseen strategy" id="rs-strategy">
            <button type="button" data-strategy="bgc" class="is-on">Declared ramp</button>
            <button type="button" data-strategy="hold">Pre-hold and backfill</button>
          </div>
          <p class="rs-note rs-strategy-note" id="rs-strategy-note">${STRATEGY_NOTE.bgc}</p>
        </div>
        <div class="rs-group">
          ${slider("p-g", "Declared down-gradient", 'min="30" max="180" step="5" value="90"', "90 MW/min")}
          ${slider("p-conf", "Confidence in the forecast", 'min="0.3" max="0.9" step="0.1" value="0.7"', "0.7")}
          <label class="rs-check"><input id="p-flat" type="checkbox" autocomplete="off"> Hold the plant flat right through the event instead of ramping down</label>
          <div class="rs-btn-row">
            <button id="rs-stall" class="rs-btn warn" type="button">Stall the front now</button>
            <button id="rs-deepen" class="rs-btn warn" type="button">Deepen it 20 % now</button>
          </div>
          <p class="rs-note" id="rs-perturb"></p>
          <dl class="rs-dl" id="rs-intel"></dl>
        </div>
      </div>

      <div class="rs-panel" id="rs-situation-panel">
        <div class="rs-panel-head"><h2>Situation</h2></div>
        <div class="rs-ctl"><label class="rs-ctl-label" for="p-situation">Load a prepared case</label>
          <select id="p-situation" autocomplete="off">${SITUATIONS.map((p) => `<option value="${p.key}">${p.label}</option>`).join("")}</select></div>
      </div>
    </div>
  </section>

  <section class="rs-panel">
    <div class="rs-panel-head"><h2 id="rs-blocks-title">Set-point of every station</h2>
      <div class="rs-seg-row">
        <div class="rs-seg" role="group" aria-label="Order the blocks by">
          <button type="button" data-order="eta" class="is-on">By arrival</button>
          <button type="button" data-order="id">West to east</button>
        </div>
        <div class="rs-seg" role="group" aria-label="Show every station or every block" id="rs-grain">
          <button type="button" data-grain="stations" class="is-on">Stations</button>
          <button type="button" data-grain="blocks">Blocks</button>
        </div>
      </div></div>
    <div id="rs-blocks" class="rs-chart"></div>
    <div class="rs-legend">
      <span><i class="rs-sw" style="background:var(--accent)"></i>set-point</span>
      <span><i class="rs-sw" style="background:var(--amber);height:3px"></i>available</span>
      <span><i class="rs-sw" style="background:var(--violet)"></i>headroom that can still be spent</span>
      <span><i class="rs-sw" style="background:var(--violet-dim)"></i>headroom that expires under the cloud</span>
      <span><i class="rs-sw" style="background:var(--violet);clip-path:polygon(50% 0,100% 100%,0 100%)"></i>raising output right now</span>
    </div>
    <p class="rs-note" id="rs-blocks-note">363 MV power stations in 30 control blocks. The controller dispatches blocks; the stations in a block share its set-point.</p>
  </section>

  <section class="rs-split">
    <div class="rs-panel">
      <div class="rs-panel-head"><h2>How the event ends</h2></div>
      <div class="rs-tiles" id="rs-kpis"></div>
      <p class="rs-honesty" id="rs-honesty"></p>
    </div>
    <div class="rs-panel" id="rs-ramp">
      <div class="rs-panel-head"><h2>Steepest fall at the connection point</h2></div>
      <div class="rs-ramp-big"><span class="from" id="rs-ramp-from">—</span><span class="arrow">→</span><span class="to" id="rs-ramp-to">—</span><span class="u">MW/min</span></div>
      <p class="rs-note" id="rs-ramp-note"></p>
    </div>
  </section>

  <div class="rs-notice" id="rs-notice" hidden role="status">
    <div class="rs-notice-head"><span class="rs-notice-when" id="rs-notice-when"></span><b id="rs-notice-title"></b><button type="button" class="rs-notice-x" id="rs-notice-x" aria-label="Close">×</button></div>
    <p id="rs-notice-text"></p>
  </div>`;
}

function loadSituation(key) {
  const s = SITUATIONS.find((p) => p.key === key) || SITUATIONS[0];
  state.situation = s.key;
  state.params = { ...DEFAULTS, ...s.params };
  if (s.view?.controller) setController(s.view.controller, false);
  syncInputs();
  runScenario();
}

/* Plain-language readouts. A slider value is a fraction of the plant's across-heading width,
   which is not a phrase anyone wants to read off a dashboard. */
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const coverLabel = (v) => (v >= 0.999 ? "the whole plant" : `${Math.round(v * 100)} % of the width`);
const offsetLabel = (v) => (Math.abs(v) < 0.03 ? "centred" : `${Math.round(Math.abs(v) * 100)} % toward the ${v < 0 ? "near" : "far"} edge`);
const softLabel = (v) => (v < 0.03 ? "hard-edged" : v > 0.95 ? "thin haze" : `${Math.round(v * 100)} % soft`);
const headingWords = (deg) => {
  const from = COMPASS[Math.round(((deg + 180) % 360) / 45) % 8];
  const to = COMPASS[Math.round(deg / 45) % 8];
  return `${from} to ${to}`;
};
const headingLabel = (deg) => `${String(Math.round(deg)).padStart(3, "0")}° ${headingWords(deg)}`;
const KIND = { solid: "solid front", thin: "thin band", scattered: "scattered cumulus" };

/** Paint the filled portion of a slider track to match its value. */
function paintRange(input) {
  const min = Number(input.min), max = Number(input.max);
  const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
  input.style.setProperty("--rs-fill", `${pct}%`);
}

/* The controller and the strategy are one choice seen from two places: the hero segment says
   Plant-level or Raseen, the response panel says which Raseen. Choosing a strategy while
   Plant-level is showing is a request to see Raseen, so it switches. */
function setController(ctl, rerender = true) {
  state.controller = ctl;
  if (isRaseen(ctl)) state.strategy = ctl;
  const root = $("rs-root");
  for (const b of root.querySelectorAll("[data-ctl]")) b.classList.toggle("is-on", (b.dataset.ctl === "uni") === (ctl === "uni"));
  for (const b of root.querySelectorAll("[data-strategy]")) b.classList.toggle("is-on", b.dataset.strategy === state.strategy);
  const note = $("rs-strategy-note");
  if (note) note.textContent = STRATEGY_NOTE[state.strategy];
  if (rerender && state.scenario) { rebuildEvents(); render(true); }
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
  segment("ctl", (v) => setController(v === "uni" ? "uni" : state.strategy));
  segment("strategy", (v) => setController(v));
  segment("order", (v) => { state.order = v; renderBlocks(); });
  segment("grain", (v) => {
    state.grain = v;
    $("rs-blocks-title").textContent = v === "stations" ? "Set-point of every station" : "Set-point of every control block";
    renderBlocks();
  });
  segment("event", (v) => runScenario({ event: v }));

  on("rs-play", "click", () => setPlaying(!state.playing));
  on("rs-replay", "click", openBriefing);
  on("rs-brief-run", "click", () => { closeBriefing(); setPlaying(true); });
  on("rs-brief-dismiss", "click", closeBriefing);
  on("rs-notice-x", "click", hideNotice);
  on("rs-back", "click", () => seek(state.frameIndex - rateWindow()));
  on("rs-fwd", "click", () => seek(state.frameIndex + rateWindow()));
  on("rs-scrub", "input", (e) => seek(Number(e.target.value)));
  on("rs-speed", "change", (e) => { state.speed = Number(e.target.value) || SPEED_DEFAULT; saveSpeed(state.speed); });
  document.addEventListener("keydown", (e) => {
    if (!state.scenario || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    const step = e.shiftKey ? rateWindow() : 1;
    if (e.key === "ArrowLeft") { seek(state.frameIndex - step); e.preventDefault(); }
    if (e.key === "ArrowRight") { seek(state.frameIndex + step); e.preventDefault(); }
    if (e.key === " ") { setPlaying(!state.playing); e.preventDefault(); }
  });
  /* The theme switch in the top bar: every colour on this page is read from the stylesheet
     at draw time, so a redraw is all it takes, and the map's own paint reads them too. */
  addEventListener("rs-theme", () => {
    if (!state.scenario) return;
    renderGen(); renderBlocks(); paintMapLegend();
    state.view?.setFrame(frame(), state.controller);
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
/** The frame nearest a moment, in minutes from contact. */
const frameIndexAt = (t) => {
  const x = state.scenario.times_min;
  let k = x.findIndex((v) => v >= t - 1e-9);
  if (k < 0) k = x.length - 1;
  return k;
};

/** How much of the plant is still in sun, and how much headroom is standing on it. */
function renderClear(f, ctl) {
  const cov = f.coverage || [];
  const n = cov.length;
  const P = P_OF(f, ctl);
  let clear = 0, head = 0;
  for (let i = 0; i < n; i += 1) {
    if (cov[i] > CLEAR_COV) continue;
    clear += 1;
    head += Math.max(0, (f.A?.[i] ?? 0) - (P?.[i] ?? 0));
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
  const P = P_OF(f, ctl), P0 = P_OF(prev, ctl);
  let lost = 0, given = 0;
  for (let i = 0; i < f.A.length; i += 1) {
    lost += Math.max(0, prev.A[i] - f.A[i]);
    // Only blocks the readout above calls clear, so the sentence and the cell agree.
    if ((f.coverage[i] ?? 0) <= CLEAR_COV) given += Math.max(0, P[i] - P0[i]);
  }
  lost /= dt; given /= dt;
  const fell = (aggP(prev.agg, ctl) - aggP(f.agg, ctl)) / dt;
  const held = Math.max(0, f.agg.A - aggP(f.agg, ctl));
  const say = $("rs-say"), split = $("rs-balance-split");
  const who = ctl === "uni" ? "The plant-level set-point" : "Raseen";

  if (lost < 1) {
    split.hidden = true;
    say.innerHTML = CLIMBING.has(f.phase)
      ? `${f.phase === "exit" ? "The cloud is thinning" : "The cloud has gone"}. Export is climbing back toward the <b class="lost">${fmt(f.agg.A, 0)} MW</b> the sun is offering, at the declared up-gradient rather than all at once.`
      : fell > 1
        ? `Nothing is shaded yet, and export is already coming down <b class="meter">${fmt(fell, 0)} MW</b> a minute. That is the point: the plant descends ahead of the front, and the gap it opens — <b class="back">${fmt(held, 0)} MW</b> so far — is what it will spend when the cloud lands.`
        : held > 1
          ? `The cloud has not reached a block yet. ${who} is holding <b class="back">${fmt(held, 0)} MW</b> back across the plant, ready to spend the moment it does.`
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
      `<b class="meter">${fmt(fell, 0)} MW</b> — faster than the cloud, on purpose. ${who} is still descending ` +
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
  const P = aggP(f.agg, ctl);
  $("rs-avail").textContent = fmt(f.agg.A, 0);
  $("rs-export").textContent = fmt(P, 0);
  $("rs-export-u").textContent = `MW under ${CTL_LABEL[ctl]}`;
  $("rs-declared").textContent = fmt(declaredOf(f.agg, ctl), 0);
  // Below available power is only "held" while the plant is on its way down or under cover.
  // On the way back out the same gap is the declared up-gradient, and calling that a reserve
  // would claim a choice nobody made. The reserve is also only worth the part that outlives
  // the next few minutes, so say which part that is instead of printing a bare zero.
  const held = Math.max(0, f.agg.A - P);
  const climbing = CLIMBING.has(f.phase);
  const R = reserveOf(f.agg, ctl);
  $("rs-reserve").textContent = fmt(held, 0);
  $("rs-reserve-k").textContent = climbing ? "Below available" : "Held headroom";
  $("rs-reserve-u").textContent = !isRaseen(ctl)
    ? "MW, none of it declarable block by block"
    : held < 0.5
      ? "MW — nothing is being held back"
      : climbing
        ? "MW, closing at the declared up-gradient"
        : R > 0.5
          ? `MW, of which ${fmt(R, 0)} MW can still be spent`
          : "MW, none of it far enough from the cloud to be spent";
  renderClear(f, ctl);
  renderBalance(f, ctl);
  state.view?.setFrame(f, ctl);
  renderGen();
  renderBlocks();
  renderEvents(full);
  if (full) {
    const fr = scn.front, k = kpiOf(scn, ctl);
    $("rs-ramp-from").textContent = `−${fmt(scn.kpis.base.max_grad_mw_min, 0)}`;
    $("rs-ramp-to").textContent = `−${fmt(k.max_grad_mw_min, 0)}`;
    // g is the gradient the plant declares; the lead L is what that choice costs, not an
    // input. On a concave front the descent starts earlier than D / g would suggest, so the
    // three numbers are stated as they are rather than as an identity they do not satisfy.
    const holdStart = fr.t_hold_start_min ?? fr.t_desc_start_min;
    $("rs-ramp-note").textContent = ctl === "hold"
      ? `Left uncontrolled the plant follows the sun down. Pre-hold brings every block down evenly at ${fmt(fr.g_mw_min, 0)} MW/min ` +
        `to ${fmt(fr.hold_mw ?? fr.A_min_mw, 0)} MW — the ${fmt(fr.D_mw, 0)} MW the cloud takes at full cover plus ${fmt(fr.hold_margin_mw ?? fr.delta_mw, 0)} MW of margin — ` +
        `starting ${fmt(Math.max(0, -holdStart), 1)} min before the cloud arrives, and holds there until it has passed.`
      : `Left uncontrolled the plant follows the sun down. Raseen declares ${fmt(fr.g_mw_min, 0)} MW/min, ` +
        `or ${fmt(fr.g_mw_min / 30, 1)} % of the plant a minute. Holding that through a ${fmt(fr.D_mw, 0)} MW loss ` +
        `over a ${fmt(fr.tau_min, 1)} min crossing means starting the descent ${fmt(fr.L_min, 1)} min before the ` +
        `cloud arrives.` +
        (fr.lead_shortfall_min > 0 ? ` That is ${fmt(fr.lead_shortfall_min, 1)} min more lead than the forecast window allows.` : "");
    $("rs-intel").innerHTML = [
      ["Crossing time", `${fmt(fr.tau_min, 1)} min`],
      ["Lead before contact", `${fmt(ctl === "hold" ? Math.max(0, -holdStart) : fr.L_min, 1)} min`],
      ["Power lost at full cover", `${fmt(fr.D_mw, 0)} MW`],
      ctl === "hold"
        ? ["Margin held in hand", `${fmt(fr.hold_margin_mw ?? fr.delta_mw, 0)} MW`]
        : ["Reserve this confidence buys", `${fmt(fr.delta_mw, 0)} MW`],
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
  const raseen = isRaseen(ctl) ? ctl : state.strategy;
  // "Uncontrolled" is not drawn as its own line: with no control the export IS the available
  // power, so the amber line is already both. Saying it twice invented a distinction. Only
  // one Raseen line is drawn — the strategy chosen — and the dashed line is its own promise.
  const series = [
    { name: "available", values: agg.map((a) => a.A), color: cssVar("--amber") },
    { name: "plant-level", values: agg.map((a) => a.P_uni), color: cssVar("--muted") || "#7c9088", width: ctl === "uni" ? 2.6 : 1.3, fade: ctl !== "uni" },
    { name: "Raseen", values: agg.map((a) => aggP(a, raseen)), color: cssVar("--accent"), width: isRaseen(ctl) ? 2.6 : 1.3, fade: !isRaseen(ctl) },
    { name: "declared", values: agg.map((a) => declaredOf(a, ctl)), color: cssVar("--rs-text"), dashed: true, width: 1 },
  ];
  const fr = scn.front;
  const tResp = responseStart(fr, ctl);
  lineChart($("rs-gen"), {
    x, series, height: 268, yLabel: "MW",
    label: "Available power and export at the connection point through the cloud event",
    bands: [{ name: "headroom", upper: agg.map((a) => a.A), lower: agg.map((a) => aggP(a, ctl)), color: cssVar("--violet"), opacity: 0.22 }],
    markers: [{ x: tResp, label: ctl === "hold" ? "hold starts" : "ramp starts" }, { x: 0, label: "cloud arrives" }, { x: fr.t_rise_min, label: "clearing" }],
    cursorIndex: state.frameIndex,
    onHover: (i, e) => {
      const a = agg[i];
      showTip(e, clockLabel(x[i]), [
        { name: "Available", value: `${fmt(a.A, 0)} MW` },
        { name: "Raseen", value: `${fmt(aggP(a, raseen), 0)} MW` },
        { name: "Plant-level", value: `${fmt(a.P_uni, 0)} MW` },
        { name: "Declared", value: `${fmt(declaredOf(a, ctl), 0)} MW` },
      ]);
    },
    onLeave: hideTip,
    onSeek: (i) => seek(i),
  });
}

function renderBlocks() {
  const scn = state.scenario, f = frame();
  if (!scn) return;
  const site = state.site;
  const head = (i, n) => `${site.blocks[i].id} — ${site.blocks[i].label}`;
  blockGradient($("rs-blocks"), site.blocks, f, {
    controller: state.controller, order: state.order, selected: state.selected,
    horizon: scn.front.horizon_min, prev: frameAt(state.frameIndex - 1),
    grain: state.grain,
    stations: site.mvps_block_index ? { mvps: site.mvps, index: site.mvps_block_index, mw: site.mvps_mw || PLANT_MW / site.mvps.length } : null,
    onSelect: (id) => { state.selected = id; state.view?.select?.(id); renderBlocks(); },
    onHover: (i, e, n) => showTip(
      e,
      n === undefined ? head(i) : `MVPS ${String(n).padStart(4, "0")} — ${site.blocks[i].id} · ${site.blocks[i].label}`,
      blockRows(f, i, state.controller, site.blocks[i].capacity_mw),
    ),
    onLeave: hideTip,
  });
}

/* The economics block is priced off the declared ramp's spill; the two other rules spill a
   different amount, and both prices are linear in it, so they are rescaled here rather than
   quoted from the wrong controller. The clear-day size is the one economics.py uses. */
const CLEAR_DAY_MWH = 25000;
function daySharePct(scn, mwh) {
  const e = scn.economics;
  return e.spill_mwh > 0 ? (e.spill_share_of_day_pct * mwh) / e.spill_mwh : (mwh / CLEAR_DAY_MWH) * 100;
}

function renderKpis() {
  const scn = state.scenario, ctl = state.controller, other = otherOf(ctl);
  const k = kpiOf(scn, ctl), b = scn.kpis.base, o = scn.kpis[other] ?? scn.kpis.uni, e = scn.economics;
  const otherLabel = ctl === "uni" ? "under Raseen" : ctl === "bgc" ? "with pre-hold" : "with the declared ramp";
  $("rs-kpis").innerHTML = [
    tile("", "Steepest 10-minute drop", fmt(k.max_drop10_mw, 0), `MW, against ${fmt(b.max_drop10_mw, 0)} uncontrolled`),
    tile("", "Steepest fall", fmt(k.max_grad_mw_min, 0), `MW/min, against ${fmt(b.max_grad_mw_min, 0)} uncontrolled`),
    tile("reserve", "Reserve at contact", fmt(k.firm_at_contact_mw, 0), isRaseen(ctl) ? "MW held where it could still be spent" : "MW, not declarable plant-wide"),
    tile("", "Energy not exported", fmt(k.spill_mwh, 0), `MWh, ${fmt(daySharePct(scn, k.spill_mwh), 1)} % of a clear day`),
    tile("", "Curtailed while already shaded", fmt(k.shaded_curtailment_mwh ?? 0, 1), `MWh, against ${fmt(o.shaded_curtailment_mwh ?? 0, 1)} ${otherLabel}`),
    tile("", "Value of the energy not exported", fmt(k.spill_mwh * (e.sar_per_mwh ?? 50), 0), `SAR for this event`),
  ].join("");
  $("rs-honesty").textContent = ctl === "hold"
    ? "Holding the plant flat costs more sunshine than the declared ramp: the hold sits below what the sun offers from before the cloud arrives until it has gone, and that energy is spilled. " +
      "What it buys is an export that does not move through the crossing, covered by the blocks still in sun giving back what they were holding — and nothing taken from blocks the cloud has already covered."
    : "Both controllers give up the same energy for a front this well forecast — what is spilled is set by the declared gradient, not by which blocks are asked to back off. " +
      "What placing it block by block adds is a reserve that can be declared and spent, no step changes on individual blocks, and nothing taken from blocks the cloud has already covered.";
}

function renderMarks() {
  const fr = state.scenario.front, ctl = state.controller;
  $("rs-marks").innerHTML = [
    [ctl === "hold" ? "hold starts" : "ramp starts", `${fmt(responseStart(fr, ctl), 1)} min`],
    ["crossing", `${fmt(fr.tau_min, 1)} min`],
    ["clears", `${fmt(fr.t_rise_min, 1)} min`],
  ].map(([a, b]) => `<span>${a} <b>${b}</b></span>`).join("");
}

/* ── the guided replay ──────────────────────────────────────────────────────
   The event is told as it happens: a forecast, a response, contact, full cover, clearing and
   the end, each at the moment the scenario says it happens, in the scenario's own numbers.
   Nothing here is invented — every figure is read from the front and the frames, and the
   text only puts words round it. */

/** When the response has to start, for the strategy on screen. */
const responseStart = (fr, ctl) => (ctl === "hold" ? fr.t_hold_start_min ?? fr.t_desc_start_min : fr.t_desc_start_min);

/** What the forecast says the front will reach, with fallbacks for files that predate the count. */
function reach(scn) {
  const fr = scn.front, f0 = scn.frames[0];
  const finite = f0.eta.map((e, i) => [e, i]).filter(([e]) => e !== null && Number.isFinite(e));
  const byEta = finite.sort((a, b) => a[0] - b[0]);
  return {
    blocks: fr.blocks_reached ?? finite.length,
    stations: fr.stations_reached ?? null,
    first: fr.first_block ?? (byEta.length ? state.site.blocks[byEta[0][1]].id : null),
    last: fr.last_block ?? (byEta.length ? state.site.blocks[byEta[byEta.length - 1][1]].id : null),
  };
}

/** The suggested response, in words, for the strategy on screen. */
function responseSentence(scn, ctl) {
  const fr = scn.front;
  const tResp = responseStart(fr, ctl);
  const at = tResp < 0 ? `${fmt(-tResp, 1)} min before the cloud arrives` : `${fmt(tResp, 1)} min after the cloud arrives`;
  if (ctl === "hold") {
    const hold = fr.hold_mw ?? fr.A_min_mw;
    const pct = (1 - hold / PLANT_MW) * 100;
    return `hold every block down evenly by ${fmt(pct, 0)} %, to ${fmt(hold, 0)} MW, starting ${at} — ` +
      `${fmt(fr.hold_margin_mw ?? fr.delta_mw, 0)} MW of that is margin for a deeper cloud. When the cloud lands, the blocks still in sun raise their output and export stays flat.`;
  }
  if (ctl === "uni") {
    return `bring the plant down at the declared ${fmt(fr.g_mw_min, 0)} MW/min from ${at}, with one set-point spread over every block in proportion.`;
  }
  return `bring export down at the declared ${fmt(fr.g_mw_min, 0)} MW/min from ${at}, holding the headroom on the blocks the cloud reaches last, where it can still be spent when the shaded blocks drop out.`;
}

function buildEvents(scn, ctl) {
  const fr = scn.front, k = kpiOf(scn, ctl), frames = scn.frames, times = scn.times_min;
  const r = reach(scn);
  const tResp = responseStart(fr, ctl);
  const tForecast = Math.max(times[0], tResp - 3);
  const kind = KIND[fr.event] ?? "cloud";
  const fence = -tForecast > 0.05 ? `reaches the fence in ${fmt(-tForecast, 1)} min` : "is already at the fence";
  const stations = r.stations !== null ? ` (${r.stations} of ${state.site.mvps.length} stations)` : "";
  const events = [
    { key: "forecast", t: tForecast, title: "Forecast received",
      text: `A ${kind} moving ${headingWords(fr.heading_deg)} at ${fmt(fr.speed_kmh, 0)} km/h ${fence}. ` +
        `It will reach ${r.blocks} of ${state.site.blocks.length} blocks${stations}${r.first ? `, ${r.first} first` : ""}, and take up to ${fmt(fr.D_mw, 0)} MW at full cover. ` +
        `Suggested response: ${responseSentence(scn, ctl)}` },
    { key: "response", t: tResp, title: "Response running",
      text: ctl === "hold"
        ? `Every block is being held down evenly toward ${fmt(fr.hold_mw ?? fr.A_min_mw, 0)} MW, ${fmt(fr.hold_margin_mw ?? fr.delta_mw, 0)} MW of it margin for a deeper cloud.`
        : ctl === "uni"
          ? `One plant-level set-point is bringing export down at ${fmt(fr.g_mw_min, 0)} MW/min, spread over every block in proportion.`
          : `Export is descending at ${fmt(fr.g_mw_min, 0)} MW/min, with the headroom held on the blocks the cloud reaches last.` },
    { key: "contact", t: 0, title: "Cloud at the fence",
      text: `${r.first ?? "The first block"} is losing sun. The blocks still in sun are raising their output to cover it.` },
  ];
  const kMin = frameIndexAt(fr.t_min_min);
  const fm = frames[kMin];
  if (fm) {
    const P = aggP(fm.agg, ctl);
    events.push({ key: "cover", t: times[kMin], title: "Full cover",
      text: `Export ${fmt(P, 0)} MW against ${fmt(fm.agg.A, 0)} MW available; the plant is holding ${fmt(Math.max(0, fm.agg.A - P), 0)} MW back.` });
  }
  if (fr.detect_at_min !== null && fr.detect_at_min !== undefined) {
    events.push({ key: "stalled", t: fr.detect_at_min, title: "Front stalled",
      text: "The front stalled and the forecast was wrong. Curtailment is being released nearest-first; the energy spilled while waiting is logged as the cost of the false alarm." });
  }
  if (fr.deepen_at_min !== null && fr.deepen_at_min !== undefined) {
    events.push({ key: "deeper", t: fr.deepen_at_min, title: "Deeper than forecast",
      text: "The front is deeper than forecast. The margin absorbs the extra loss if it can; if it cannot, export leaves the declared line." });
  }
  events.push({ key: "clearing", t: fr.t_rise_min, title: "Clearing",
    text: `Returning to full output at ${fmt(fr.g_up_mw_min, 0)} MW/min.` });
  const kRise = frameIndexAt(fr.t_rise_min);
  let kOver = frames.findIndex((f, i) => i > kRise && f.agg.A >= PLANT_MW - 1);
  if (kOver < 0) kOver = frames.length - 1;
  events.push({ key: "over", t: times[kOver], title: "Event over",
    text: `Energy not exported: ${fmt(k.spill_mwh, 0)} MWh, ${fmt(daySharePct(scn, k.spill_mwh), 1)} % of a clear day.` });
  return events.sort((a, b) => a.t - b.t);
}

/* Rebuilt on every scenario load and strategy change. The cursor is parked on the current
   frame without a notice: opening the page must not pop one up. */
function rebuildEvents() {
  state.events = buildEvents(state.scenario, state.controller);
  state.eventCursor = eventIndexAt(frame().t);
  hideNotice();
}
const eventIndexAt = (t) => {
  let idx = -1;
  state.events.forEach((e, i) => { if (e.t <= t + 1e-9) idx = i; });
  return idx;
};

function renderEvents(full) {
  const f = frame();
  const idx = eventIndexAt(f.t);
  const log = $("rs-events");
  if (full || log.childElementCount !== state.events.length) {
    log.innerHTML = state.events.map((e, i) =>
      `<li data-i="${i}"><span class="t">${clockLabel(e.t)}</span><span class="s"><b>${e.title}.</b> ${e.text}</span></li>`).join("");
  }
  [...log.children].forEach((li, i) => {
    li.className = i < idx ? "is-past" : i === idx ? "is-now" : "is-future";
  });
  if (idx !== state.eventCursor) {
    // Crossed forward into a new event: say so. Scrubbed back: just move the cursor.
    if (idx > state.eventCursor) showNotice(state.events[idx]);
    else hideNotice();
    state.eventCursor = idx;
  }
}

function showNotice(e) {
  const box = $("rs-notice");
  if (!box || !e) return;
  $("rs-notice-when").textContent = clockLabel(e.t);
  $("rs-notice-title").textContent = e.title;
  $("rs-notice-text").textContent = e.text;
  box.hidden = false;
  box.classList.remove("is-in");
  void box.offsetWidth;
  box.classList.add("is-in");
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(hideNotice, 12000);
}
function hideNotice() {
  clearTimeout(state.noticeTimer); state.noticeTimer = null;
  const box = $("rs-notice");
  if (box) { box.hidden = true; box.classList.remove("is-in"); }
}

/* Replay the event: jump to the forecast, lay the briefing on the desk, and wait. Play runs
   from there once Run the response is pressed. The briefing is Raseen's suggestion, so a
   replay started with Plant-level showing switches to the Raseen strategy last chosen. */
function openBriefing() {
  if (!state.scenario) return;
  if (!isRaseen(state.controller)) setController(state.strategy, false);
  rebuildEvents();
  const forecast = state.events.find((e) => e.key === "forecast");
  seek(frameIndexAt(forecast.t));
  render(true);
  $("rs-brief-when").textContent = `t ${clockLabel(forecast.t)}`;
  $("rs-brief-forecast").textContent = forecast.text.replace(/ Suggested response:.*$/, "");
  $("rs-brief-response").textContent = responseSentence(state.scenario, state.controller).replace(/^./, (c) => c.toUpperCase());
  $("rs-brief").hidden = false;
  state.eventCursor = eventIndexAt(forecast.t);
  hideNotice();
  $("rs-brief-run")?.focus({ preventScroll: true });
  $("rs-brief").scrollIntoView({ block: "nearest" });
}
function closeBriefing() {
  const b = $("rs-brief");
  if (b) b.hidden = true;
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
    // Both strategies are in every file, so the strategy segment stays free.
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
  pause: () => { setPlaying(false); hideNotice(); },
};

// The standalone /control page mounts immediately; a host page sets this flag and calls
// window.RaseenGC.mount() when it is ready.
if (!window.RASEEN_GC_MANUAL) mountGradientControl();
