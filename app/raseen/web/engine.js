/* The cloud-crossing simulation, in the browser.

   A line-for-line port of raseen/shadow/fields.py, raseen/control/{planner,allocate,simulate}.py,
   raseen/scenario/{runner,economics}.py. The Python is the reference and stays the code the
   live server runs; this file exists so the published build, which has no server, can still
   re-run the whole plant when a slider moves instead of stepping between files rendered in
   advance. tests/test_engine_js.py runs both on the same cases and holds them to each other,
   so a change to one without the other fails a test rather than quietly drifting.

   It takes the site payload the page already has (/api/rs/site or data/site.json) and the
   same parameter object the API takes, and returns the same scenario shape the API returns,
   minus the two fields the static build always dropped (per-frame `firm`, `P_base`) because
   the page derives them. Everything computed here is simulated, and labelled so in the
   payload it returns. No dependencies: it must load in node for the test as well as in the
   page. */

export const PLANT_MW = 3000.0;
export const T_START = -40.0;
export const T_END = 100.0;
export const DT_MIN = 1.0 / 6.0;
export const DETECT_DELAY_MIN = 2.0;
export const ENGINE_REVISION = "r3";

const CLASSIFICATION = "SIMULATION (RASEEN PROTOTYPE)";
const DISCLAIMER =
  "SIMULATED — NOT MEASURED DATA. Plant geometry is as-designed, not as-built. " +
  "The controller is real code; telemetry, forecast and grid interfaces are simulated. " +
  "NOT CALIBRATED — NOT VALIDATED.";
const PROVENANCE = {
  geometry: "as-designed CAD/KML (NAJM-3000), not as-built",
  irradiance: "representative clear-day available power × geometric shadow field",
  controller: "real code (raseen.control, ported to the browser), executed on simulated inputs",
  telemetry: "simulated from the shadow field; no SCADA connected",
  nowcast: "ground-truth arrival times from the shadow generator, not an estimate",
};

/* ── parameters (raseen/scenario/params.py) ─────────────────────────────── */
export const PARAM_DEFAULTS = {
  event: "solid", heading_deg: 90.0, speed_kmh: 48.0, depth: 0.6, g_mw_min: 90.0,
  confidence: 0.7, reserve_mw: null, flat: false, sigma_min: 3.0, slew_pct_min: 10.0,
  horizon_min: 5.0, plateau_min: 40.0, ppc_delay_steps: 1, stall_at_min: null,
  deepen_at_min: null, deepen_factor: 1.2, kappa: 0.25, seed: 1, cover_frac: 1.0,
  cover_offset: 0.0, softness: 0.0,
};
const RANGES = {
  heading_deg: [0, 359.999], speed_kmh: [10, 120], depth: [0.2, 0.8], g_mw_min: [30, 300],
  confidence: [0.1, 1], reserve_mw: [0, 600], sigma_min: [1e-9, 15], slew_pct_min: [1e-9, 100],
  horizon_min: [1e-9, 30], plateau_min: [0, 90], ppc_delay_steps: [0, 6], stall_at_min: [-40, 100],
  deepen_at_min: [-40, 100], deepen_factor: [1, 1.5], kappa: [0, 1], cover_frac: [0.1, 1],
  cover_offset: [-1, 1], softness: [0, 1],
};

/** The same clamping the API's validation would refuse; here a slider is simply held to its range. */
export function normaliseParams(raw = {}) {
  const p = { ...PARAM_DEFAULTS };
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in PARAM_DEFAULTS) || v === undefined) continue;
    p[k] = v;
  }
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    if (p[k] === null || p[k] === undefined) continue;
    p[k] = Math.min(hi, Math.max(lo, Number(p[k])));
  }
  p.ppc_delay_steps = Math.round(p.ppc_delay_steps);
  p.seed = Math.max(0, Math.round(Number(p.seed) || 0));
  p.flat = Boolean(p.flat);
  if (!["solid", "thin", "scattered"].includes(p.event)) p.event = "solid";
  return p;
}

/* ── geometry (raseen/geometry/projection.py, site.py) ──────────────────── */
const rad = (d) => (d * Math.PI) / 180;
const headingVector = (deg) => [Math.sin(rad(deg)), Math.cos(rad(deg))];
const project = (xy, deg) => { const [ux, uy] = headingVector(deg); return xy.map(([x, y]) => x * ux + y * uy); };
const perpendicular = (xy, deg) => { const [ux, uy] = headingVector(deg); return xy.map(([x, y]) => -x * uy + y * ux); };
const spToXy = (s, p, deg) => { const [ux, uy] = headingVector(deg); return [s * ux - p * uy, s * uy + p * ux]; };
const min = (a) => a.reduce((m, v) => (v < m ? v : m), Infinity);
const max = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity);
const sum = (a) => { let s = 0; for (const v of a) s += v; return s; };

/** Local metres about the site centre and the block membership, from the site payload. */
export function prepareSite(site) {
  const b = site.bounds;
  const lat0 = (b.south + b.north) / 2, lon0 = (b.west + b.east) / 2;
  const mlat = 111320.0, mlon = 111320.0 * Math.cos(rad(lat0));
  const xy = site.mvps.map((p) => [(p.lon - lon0) * mlon, (p.lat - lat0) * mlat]);
  const toLonLat = (x, y) => [lon0 + x / mlon, lat0 + y / mlat];
  const nBlocks = site.blocks.length;
  const members = Array.from({ length: nBlocks }, () => []);
  site.mvps_block_index.forEach((bi, m) => { if (bi >= 0) members[bi].push(m); });
  // Every station carries an equal share of the plant, exactly as the geometry module does;
  // the payload's capacity_mw is that product rounded, so it is recomputed rather than read.
  const mvpsMW = PLANT_MW / site.mvps.length;
  const caps = members.map((idx) => idx.length * mvpsMW);
  return { xy, toLonLat, members, caps, mvpsMW, blocks: site.blocks, nStations: site.mvps.length };
}

/* ── shadow fields (raseen/shadow/fields.py) ────────────────────────────── */
const EDGE_M = 150.0;
const THIN_BAND_M = 1600.0;
const DRAW_MARGIN_M = 600.0;
const SCATTERED_CLOUDS = 12;
const SOFT_EDGE_GAIN = 3.0;
const SOFT_PEAK_DROP = 0.6;

const smooth01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const softEdgeM = (softness) => EDGE_M * (1 + SOFT_EDGE_GAIN * softness);
const softPeak = (softness) => 1 - SOFT_PEAK_DROP * softness;

class FrontField {
  constructor(o) {
    Object.assign(this, o);
    this.sMin = min(this.s); this.pMin = min(this.p); this.pMax = max(this.p);
    const margin = Math.max(DRAW_MARGIN_M, softEdgeM(this.softness));
    const lo = this.pLo === null ? this.pMin - margin : this.pLo;
    const hi = this.pHi === null ? this.pMax + margin : this.pHi;
    this.bandLo = Math.min(lo, hi); this.bandHi = Math.max(lo, hi);
    this.edge = softEdgeM(this.softness); this.peak = softPeak(this.softness);
  }
  lead(t, planned) {
    const tt = planned || this.stallAt === null ? t : Math.min(t, this.stallAt);
    return this.sMin + this.v * tt;
  }
  across(pi) { return smooth01((pi - this.bandLo) / this.edge) * smooth01((this.bandHi - pi) / this.edge); }
  depthAt(t) { return this.deepenAt !== null && t >= this.deepenAt ? this.depth * this.deepenFactor : this.depth; }
  coverage(t) {
    const lead = this.lead(t, false), trail = lead - this.bandLen, e = this.edge, out = new Array(this.s.length);
    for (let i = 0; i < this.s.length; i += 1) {
      const si = this.s[i];
      out[i] = this.peak * smooth01((lead - si) / e) * smooth01((si - trail) / e) * this.across(this.p[i]);
    }
    return out;
  }
  etaPlanned(t) {
    const lead = this.lead(t, true), out = new Array(this.s.length);
    for (let i = 0; i < this.s.length; i += 1) out[i] = this.across(this.p[i]) > 0 ? (this.s[i] - lead) / this.v : Infinity;
    return out;
  }
  polygonsSP(t) {
    const lead = this.lead(t, false), trail = lead - this.bandLen, lo = this.bandLo, hi = this.bandHi;
    return [[[trail, lo], [lead, lo], [lead, hi], [trail, hi]]];
  }
}

class ScatteredField {
  constructor(o) {
    Object.assign(this, o);
    this.sMin = min(this.s); this.pMin = min(this.p); this.pMax = max(this.p);
    this.edge = softEdgeM(this.softness); this.peak = softPeak(this.softness);
  }
  centre(c0, t, planned) {
    const tt = planned || this.stallAt === null ? t : Math.min(t, this.stallAt);
    return c0 + this.v * tt;
  }
  depthAt(t) { return this.deepenAt !== null && t >= this.deepenAt ? this.depth * this.deepenFactor : this.depth; }
  coverage(t) {
    const out = new Array(this.s.length);
    for (let i = 0; i < this.s.length; i += 1) {
      const si = this.s[i], pi = this.p[i];
      let best = 0;
      for (const [c0, pc, a, b] of this.clouds) {
        const c = this.centre(c0, t, false);
        const r = Math.hypot((si - c) / a, (pi - pc) / b);
        best = Math.max(best, smooth01(((1 - r) * a) / this.edge));
      }
      out[i] = this.peak * best;
    }
    return out;
  }
  etaPlanned(t) {
    const out = new Array(this.s.length);
    for (let i = 0; i < this.s.length; i += 1) {
      const si = this.s[i], pi = this.p[i];
      let best = Infinity, covered = false;
      for (const [c0, pc, a, b] of this.clouds) {
        const dp = pi - pc;
        if (Math.abs(dp) >= b) continue;
        const half = a * Math.sqrt(1 - (dp / b) ** 2);
        const c = this.centre(c0, t, true);
        const lead = c + half, trail = c - half;
        if (trail <= si && si <= lead) { covered = true; break; }
        if (si > lead) best = Math.min(best, (si - lead) / this.v);
      }
      out[i] = covered ? 0 : best;
    }
    return out;
  }
  polygonsSP(t) {
    return this.clouds.map(([c0, pc, a, b]) => {
      const c = this.centre(c0, t, false);
      return Array.from({ length: 24 }, (_, k) => [c + a * Math.cos((k * Math.PI) / 12), pc + b * Math.sin((k * Math.PI) / 12)]);
    });
  }
}

/* The first 48 values of Python's random.Random(1).random(): four draws for each of the
   twelve scattered clouds, in the order fields.py draws them (a, b, lead time, across).
   Carried so the browser seeds the same sky the server does for seed 1; any other seed falls
   back to a small generator of its own and is not expected to match. */
const SEED1_DRAWS = [
  0.13436424411240122, 0.8474337369372327, 0.763774618976614, 0.2550690257394217,
  0.49543508709194095, 0.4494910647887381, 0.651592972722763, 0.7887233511355132,
  0.0938595867742349, 0.02834747652200631, 0.8357651039198697, 0.43276706790505337,
  0.762280082457942, 0.00210605335111069, 0.4453871940548014, 0.7215400323407826,
  0.22876222127045265, 0.9452706955539223, 0.9014274576114836, 0.03058998303355354,
  0.0254458609934608, 0.5414124727934966, 0.9391491627785106, 0.38120423768821243,
  0.21659939713061338, 0.4221165755827173, 0.02904078757486794, 0.22169166627303505,
  0.43788759365057206, 0.49581224138185065, 0.23308445025757263, 0.2308665415409843,
  0.2187810373376886, 0.4596034657377336, 0.28978161459048557, 0.02148970526590888,
  0.8375779756625729, 0.5564543226524334, 0.6422943629324456, 0.1859062658947177,
  0.9925434121760651, 0.8599465287952899, 0.12088995980580641, 0.3326951853601291,
  0.7214844075832684, 0.7111917696952796, 0.9364405867994596, 0.4221069999614152,
];
function drawsFor(seed) {
  if (seed === 1) return SEED1_DRAWS.slice();
  let a = (seed >>> 0) || 0x9e3779b9;   // mulberry32, for seeds the server never uses here
  return Array.from({ length: 4 * SCATTERED_CLOUDS }, () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

function buildField(site, o) {
  const { event, heading_deg, speed_kmh, depth, plateau_min = 40, seed = 1, stall_at = null, deepen_at = null,
    deepen_factor = 1, cover_frac = 1, cover_offset = 0, softness = 0 } = o;
  const s = project(site.xy, heading_deg), p = perpendicular(site.xy, heading_deg);
  const v = (speed_kmh * 1000) / 60;
  const tau = (max(s) - min(s)) / v;
  const common = { heading: heading_deg, s, p, v, depth, tau, stallAt: stall_at, deepenAt: deepen_at, deepenFactor: deepen_factor, softness };
  let pLo = null, pHi = null;
  if (cover_frac < 1) {
    const loP = min(p), hiP = max(p), span = hiP - loP, core = span * cover_frac;
    const centre = 0.5 * (loP + hiP) + cover_offset * 0.5 * (span - core);
    const ramp = softEdgeM(softness);
    pLo = centre - 0.5 * core - ramp; pHi = centre + 0.5 * core + ramp;
  }
  if (event === "solid") return new FrontField({ ...common, bandLen: (tau + plateau_min) * v, pLo, pHi });
  if (event === "thin") return new FrontField({ ...common, bandLen: THIN_BAND_M, pLo, pHi });
  if (event === "scattered") {
    const draws = drawsFor(seed);
    const sMin = min(s), pMin = min(p), pMax = max(p);
    const [loC, hiC] = pLo === null ? [pMin, pMax] : [pLo, pHi];
    const clouds = [];
    for (let k = 0; k < SCATTERED_CLOUDS; k += 1) {
      const u = draws.slice(4 * k, 4 * k + 4);
      const a = 400 + 800 * u[0], b = 300 + 600 * u[1];
      const c0 = sMin - (3 + 32 * u[2]) * v;
      const pc = loC + (hiC - loC) * u[3];
      clouds.push([c0, pc, a, b]);
    }
    return new ScatteredField({ ...common, clouds });
  }
  throw new Error(`unknown event ${event}; choose solid, thin or scattered`);
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;
function cloudPolygons(field, site, t) {
  return field.polygonsSP(t).map((poly) => poly.map(([s_, p_]) => {
    const [x, y] = spToXy(s_, p_, field.heading);
    const [lon, lat] = site.toLonLat(x, y);
    return [round6(lon), round6(lat)];
  }));
}

/* ── planner (raseen/control/planner.py) ────────────────────────────────── */
export function planTrajectory(times, A_tot, plant, o) {
  const { g, flat = false, confidence = 0.7, kappa = 0.25, reserve_override = null, horizon = 5, hold_margin = 0 } = o;
  const g_up = o.g_up === undefined || o.g_up === null ? g : o.g_up;
  const n = times.length;
  let k_min = 0;
  for (let k = 1; k < n; k += 1) if (A_tot[k] < A_tot[k_min]) k_min = k;
  const A_min = A_tot[k_min], t_min = times[k_min];
  const D = plant - A_min;
  const P_star = new Array(n);
  let t_desc_start, t_rise, hold;
  if (flat) {
    const shaded = [];
    for (let k = 0; k < n; k += 1) if (A_tot[k] < plant - 1e-6) shaded.push(k);
    const k_first = shaded.length ? shaded[0] : k_min, k_last = shaded.length ? shaded[shaded.length - 1] : k_min;
    const t_first = times[k_first], t_last = times[k_last];
    hold = Math.max(0, A_min - hold_margin);
    const L_pre = (plant - hold) / g;
    t_desc_start = t_first - L_pre;
    t_rise = t_last;
    for (let k = 0; k < n; k += 1) {
      const tt = times[k];
      let p;
      if (tt < t_desc_start) p = plant;
      else if (tt < t_first) p = plant - g * (tt - t_desc_start);
      else if (tt <= t_last) p = hold;
      else p = Math.min(plant, hold + g_up * (tt - t_last));
      P_star[k] = Math.min(p, A_tot[k]);
    }
  } else {
    hold = A_min;
    const shaded_desc = [];
    for (let k = 0; k <= k_min; k += 1) if (A_tot[k] < plant - 1e-6) shaded_desc.push(times[k] - (plant - A_tot[k]) / g);
    t_desc_start = shaded_desc.length ? min(shaded_desc) : t_min - D / g;
    let k_rise = n - 1;
    for (let k = k_min; k < n; k += 1) if (A_tot[k] > A_min + 1e-6) { k_rise = k; break; }
    t_rise = times[k_rise];
    for (let k = 0; k < n; k += 1) {
      const tt = times[k];
      let p;
      if (tt < t_desc_start) p = plant;
      else if (tt <= t_rise) p = Math.max(A_min, plant - g * (tt - t_desc_start));
      else p = Math.min(plant, A_min + g_up * (tt - t_rise));
      P_star[k] = Math.min(p, A_tot[k]);
    }
  }
  let first_shaded = 0;
  for (let k = 0; k < n; k += 1) if (A_tot[k] < plant - 1e-6) { first_shaded = times[k]; break; }
  const L = Math.max(0, first_shaded - t_desc_start);
  const lead_shortfall = Math.max(0, times[0] - t_desc_start);
  const delta = reserve_override !== null && reserve_override !== undefined ? Number(reserve_override) : Math.min(D * (1 - confidence) * kappa, 0.1 * plant);
  return { P_star, t_desc_start, t_min, k_min, t_rise, A_min, D, L, g, g_up, delta, horizon, lead_shortfall, flat, hold_mw: hold };
}

export function applyRelease(P_star, A_tot, times, k_detect, g_up) {
  const out = P_star.slice();
  for (let k = Math.max(1, k_detect); k < out.length; k += 1) {
    const dt = times[k] - times[k - 1];
    out[k] = Math.min(A_tot[k], out[k - 1] + g_up * dt);
  }
  return out;
}

/* ── allocation (raseen/control/allocate.py) ────────────────────────────── */
const FAR_ETA_MIN = 60.0;
const EPS = 1e-9;

function waterFill(rem, room, w) {
  const take = new Map();
  for (const i of room.keys()) take.set(i, 0);
  const active = new Set();
  for (const i of room.keys()) if (room.get(i) > EPS && (w.get(i) ?? 0) > 0) active.add(i);
  let guard = 0;
  while (rem > 1e-6 && active.size && guard < 300) {
    guard += 1;
    let wsum = 0;
    for (const i of active) wsum += w.get(i);
    if (wsum <= 0) break;
    let spill = 0;
    for (const i of [...active]) {
      const share = (rem * w.get(i)) / wsum;
      const t = Math.min(share, room.get(i) - take.get(i));
      take.set(i, take.get(i) + t);
      if (t < share - EPS) active.delete(i);
      spill += share - t;
    }
    rem = spill;
  }
  return [take, rem];
}
const ones = (room) => { const w = new Map(); for (const i of room.keys()) w.set(i, 1); return w; };

function etaWeights(finite, cands, sigma, farthestFirst) {
  const w = new Map();
  if (farthestFirst) {
    let emax = 0;
    for (const i of cands) if (finite[i] > emax) emax = finite[i];
    if (!cands.length) emax = 0;
    for (const i of cands) w.set(i, Math.exp(-Math.max(emax - finite[i], 0) / sigma));
  } else {
    for (const i of cands) w.set(i, Math.exp(-Math.max(finite[i], 0) / sigma));
  }
  return w;
}

function desiredLevels(A, floor, eta, finite, cap, target, { delta, horizon, sigma, release }) {
  const n = A.length;
  const C = Math.max(0, sum(A) - target);
  const cur = new Array(n).fill(0);
  if (delta > 0 && !release) {
    const far = [];
    for (let i = 0; i < n; i += 1) if (eta[i] > horizon && A[i] > floor[i] + EPS) far.push(i);
    if (far.length) {
      const per = delta / far.length;
      for (const i of far) cur[i] = Math.min(per, 0.3 * cap[i], A[i] - floor[i]);
    }
  }
  let rem = Math.max(0, C - sum(cur));
  const cands = [];
  for (let i = 0; i < n; i += 1) if (A[i] - floor[i] - cur[i] > EPS) cands.push(i);
  const room = new Map();
  for (const i of cands) room.set(i, A[i] - floor[i] - cur[i]);
  const [take, left] = waterFill(rem, room, etaWeights(finite, cands, sigma, !release));
  for (const [i, t] of take) cur[i] += t;
  rem = left;
  if (rem > 1e-6) {
    const room_l = A.map((a, i) => a - cur[i]);
    const tot = sum(room_l);
    if (tot > 0) for (let i = 0; i < n; i += 1) cur[i] += (rem * room_l[i]) / tot;
  }
  return A.map((a, i) => a - cur[i]);
}

export function allocateBgc(A, floor, eta, cap, target, o) {
  const { delta, horizon, sigma, slew_lim, prev, release = false, targets_ahead = null, A_ahead = null } = o;
  const n = A.length;
  const finite = eta.map((e) => (Number.isFinite(e) ? e : FAR_ETA_MIN));
  const desired = desiredLevels(A, floor, eta, finite, cap, target, { delta, horizon, sigma, release });
  const lo = new Array(n), hi = new Array(n);
  for (let i = 0; i < n; i += 1) {
    lo[i] = Math.max(0, prev[i] - slew_lim[i]);
    hi[i] = Math.min(A[i], prev[i] + slew_lim[i]);
    if (A[i] < lo[i]) lo[i] = A[i];
    if (hi[i] < lo[i]) hi[i] = lo[i];
  }
  let p = prev.map((v, i) => Math.min(Math.max(v, lo[i]), hi[i]));
  const ub = hi.slice();
  const pinned = new Set();

  if (targets_ahead && A_ahead) {
    const m = Math.min(targets_ahead.length, A_ahead.length);
    for (let j = 1; j <= m; j += 1) {
      if (j < 2) continue;
      const tgt = targets_ahead[j - 1], Aj = A_ahead[j - 1];
      const s = j - 1;
      let reach = 0;
      const room = new Map();
      for (let i = 0; i < n; i += 1) {
        const fl = Math.min(floor[i], p[i]);
        const base = Math.max(fl, p[i] - s * slew_lim[i]);
        reach += Math.min(Aj[i], base);
        if (base < Aj[i] - EPS) {
          const r_i = Math.min(p[i] - lo[i], p[i] - s * slew_lim[i] - fl);
          if (r_i > EPS) room.set(i, r_i);
        }
      }
      if (!room.size) continue;
      const excess = reach - tgt;
      if (excess > 1e-6) {
        const [take] = waterFill(excess, room, ones(room));
        for (const [i, t] of take) if (t > 0) p[i] -= t;
        for (const i of room.keys()) pinned.add(i);
      } else if (excess > -sum([...room.values()])) {
        for (const i of room.keys()) pinned.add(i);
      }
    }
    for (const i of pinned) ub[i] = Math.min(hi[i], p[i]);
  }

  p = desired.map((d, i) => Math.min(Math.max(d, lo[i]), ub[i]));

  let r = sum(p) - target;
  if (r > EPS) {
    let cands = [];
    for (let i = 0; i < n; i += 1) if (p[i] - Math.max(lo[i], floor[i]) > EPS) cands.push(i);
    let room = new Map();
    for (const i of cands) room.set(i, p[i] - Math.max(lo[i], floor[i]));
    let [take, left] = waterFill(r, room, etaWeights(finite, cands, sigma, !release));
    for (const [i, t] of take) p[i] -= t;
    r = left;
    if (r > 1e-6) {
      room = new Map();
      for (let i = 0; i < n; i += 1) if (p[i] - lo[i] > EPS) room.set(i, p[i] - lo[i]);
      [take, left] = waterFill(r, room, ones(room));
      for (const [i, t] of take) p[i] -= t;
      r = left;
    }
    if (r > 1e-6) {
      const tot = sum(p);
      if (tot > 0) p = p.map((pi) => pi - (r * pi) / tot);
    }
  } else if (r < -EPS) {
    let need = -r;
    const cands = [];
    for (let i = 0; i < n; i += 1) if (!pinned.has(i) && hi[i] - p[i] > EPS) cands.push(i);
    let room = new Map();
    for (const i of cands) room.set(i, hi[i] - p[i]);
    let [take, left] = waterFill(need, room, etaWeights(finite, cands, sigma, true));
    for (const [i, t] of take) p[i] += t;
    need = left;
    if (need > 1e-6) {
      room = new Map();
      for (const i of pinned) if (hi[i] - p[i] > EPS) room.set(i, hi[i] - p[i]);
      [take, left] = waterFill(need, room, ones(room));
      for (const [i, t] of take) p[i] += t;
      need = left;
    }
    if (need > 1e-6) {
      const room_l = A.map((a, i) => a - p[i]);
      const tot = sum(room_l);
      if (tot > 0) p = p.map((pi, i) => pi + (need * room_l[i]) / tot);
    }
  }
  return p.map((pi, i) => Math.min(A[i], Math.max(0, pi)));
}

export function allocateHold(A, cap, target, { slew_lim, prev, shaded }) {
  const n = A.length;
  const lo = new Array(n), hi = new Array(n);
  for (let i = 0; i < n; i += 1) {
    lo[i] = Math.max(0, prev[i] - slew_lim[i]);
    hi[i] = Math.min(A[i], prev[i] + slew_lim[i]);
    if (A[i] < lo[i]) lo[i] = A[i];
    if (hi[i] < lo[i]) hi[i] = lo[i];
  }
  let p = prev.map((v, i) => Math.min(Math.max(v, lo[i]), hi[i]));
  const inSun = [], inShade = [];
  for (let i = 0; i < n; i += 1) (shaded[i] ? inShade : inSun).push(i);
  let r = sum(p) - target;
  if (r > EPS) {
    for (const group of [inSun, inShade]) {
      const room = new Map();
      for (const i of group) if (p[i] - lo[i] > EPS) room.set(i, p[i] - lo[i]);
      const w = new Map();
      for (const i of room.keys()) w.set(i, p[i]);
      const [take, left] = waterFill(r, room, w);
      for (const [i, t] of take) p[i] -= t;
      r = left;
      if (r <= 1e-6) break;
    }
    if (r > 1e-6) {
      const tot = sum(p);
      if (tot > 0) p = p.map((pi) => pi - (r * pi) / tot);
    }
  } else if (r < -EPS) {
    let need = -r;
    for (const group of [inSun, inShade]) {
      const room = new Map();
      for (const i of group) if (hi[i] - p[i] > EPS) room.set(i, hi[i] - p[i]);
      const [take, left] = waterFill(need, room, new Map(room));
      for (const [i, t] of take) p[i] += t;
      need = left;
      if (need <= 1e-6) break;
    }
  }
  return p.map((pi, i) => Math.min(A[i], Math.max(0, pi)));
}

export function allocateUniform(A, frac) {
  const f = Math.min(1, Math.max(0, frac));
  return A.map((a) => a * f);
}

/* ── simulation and scoring (raseen/control/simulate.py) ────────────────── */
const STEP_THRESHOLD = 0.05;
const SHADED_COVERAGE = 0.95;
const HOLD_SHADED_COVERAGE = 0.02;

function firmReserve(A, P, eta, horizon) {
  let r = 0;
  for (let i = 0; i < A.length; i += 1) if (eta[i] > horizon) r += Math.max(0, A[i] - P[i]);
  return r;
}

export function simulateScheme(scheme, o) {
  const { times, A, A_tot, floors, etas, caps, P_star, sigma, delta, horizon, slew_pct_min,
    ppc_delay_steps = 1, release_from = null, A_nowcast = null, coverage = null } = o;
  const dt = times[1] - times[0];
  const slew_lim = caps.map((c) => (c * slew_pct_min) / 100 * dt);
  const ahead = Math.max(1, Math.round(horizon / dt));
  const believed = A_nowcast === null ? A : A_nowcast;
  const P = [];
  let prev = A[0].slice();
  for (let k = 0; k < times.length; k += 1) {
    let p;
    if (scheme === "base") p = A[k].slice();
    else if (scheme === "uni") {
      const kk = Math.max(0, k - ppc_delay_steps);
      const frac = A_tot[kk] > 0 ? P_star[kk] / A_tot[kk] : 0;
      p = allocateUniform(A[k], frac);
    } else if (scheme === "bgc") {
      const release = release_from !== null && k >= release_from;
      p = allocateBgc(A[k], floors[k], etas[k], caps, P_star[k], {
        delta, horizon, sigma, slew_lim, prev, release,
        targets_ahead: P_star.slice(k + 1, k + 1 + ahead), A_ahead: believed.slice(k + 1, k + 1 + ahead),
      });
    } else if (scheme === "hold") {
      const shaded = caps.map((_, i) => etas[k][i] <= 0 || (coverage !== null && coverage[k][i] > HOLD_SHADED_COVERAGE));
      p = allocateHold(A[k], caps, P_star[k], { slew_lim, prev, shaded });
    } else throw new Error(`unknown scheme ${scheme}`);
    P.push(p);
    prev = p;
  }
  const POI = P.map((p) => sum(p));
  const R = times.map((_, k) => firmReserve(A[k], P[k], etas[k], horizon));
  return { P, POI, R };
}

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

export function metrics(o) {
  const { times, A_tot, POI, P, A, etas, caps, coverage, plant_mw, horizon, g_declared, P_star } = o;
  const n_steps = times.length, dt = times[1] - times[0];
  let k_min = 0;
  for (let k = 1; k < n_steps; k += 1) if (A_tot[k] < A_tot[k_min]) k_min = k;
  let spill_down = 0, spill_up = 0, spill_before = 0;
  for (let k = 0; k < n_steps; k += 1) {
    const s = ((A_tot[k] - POI[k]) * dt) / 60;
    if (s > 0) {
      if (k < k_min) spill_down += s; else spill_up += s;
      if (times[k] < 0) spill_before += s;
    }
  }
  const steps10 = Math.round(10 / dt);
  let max_drop10 = 0;
  for (let k = steps10; k < n_steps; k += 1) max_drop10 = Math.max(max_drop10, POI[k - steps10] - POI[k]);
  let max_grad = 0, max_up = 0;
  for (let k = 1; k < n_steps; k += 1) {
    max_grad = Math.max(max_grad, (POI[k - 1] - POI[k]) / dt);
    max_up = Math.max(max_up, (POI[k] - POI[k - 1]) / dt);
  }
  let lead = 0;
  for (let k = 0; k < n_steps; k += 1) if (A_tot[k] - POI[k] > 1e-3) { lead = times[k] < 0 ? -times[k] : 0; break; }
  let k0 = 0;
  for (let k = 1; k < n_steps; k += 1) if (Math.abs(times[k]) < Math.abs(times[k0])) k0 = k;
  const firm_at_contact = firmReserve(A[k0], P[k0], etas[k0], horizon);
  let shaded_curtailment = 0;
  for (let k = 0; k < n_steps; k += 1) for (let i = 0; i < caps.length; i += 1) {
    if (coverage[k][i] > SHADED_COVERAGE) shaded_curtailment += (Math.max(0, A[k][i] - P[k][i]) * dt) / 60;
  }
  let stepped = 0;
  for (let i = 0; i < caps.length; i += 1) {
    for (let k = 1; k < n_steps; k += 1) {
      if (A[k][i] < A[k - 1][i] - 0.05) continue;
      if (P[k - 1][i] - P[k][i] > STEP_THRESHOLD * caps[i] && P[k][i] < A[k][i] - 0.5) { stepped += 1; break; }
    }
  }
  let tracking = 0;
  for (let k = 0; k < n_steps; k += 1) if (P_star[k] < plant_mw - 1) tracking = Math.max(tracking, (Math.abs(POI[k] - P_star[k]) / plant_mw) * 100);
  return {
    spill_mwh: r1(spill_down + spill_up), spill_down_mwh: r1(spill_down), spill_up_mwh: r1(spill_up),
    spill_before_contact_mwh: r1(spill_before), max_drop10_mw: r1(max_drop10), max_grad_mw_min: r1(max_grad),
    max_up_mw_min: r1(max_up), grad_ratio: g_declared ? r3(max_grad / g_declared) : 0, lead_min: r1(lead),
    firm_at_contact_mw: r1(firm_at_contact), shaded_curtailment_mwh: r1(shaded_curtailment),
    blocks_stepped: stepped, tracking_error_pct: r2(tracking),
  };
}

/* ── economics (raseen/scenario/economics.py) ───────────────────────────── */
const SAR_PER_MWH = 50.0, CLEAR_DAY_MWH = 25000.0, ANNUAL_ENERGY_MWH = 7.36e6;
const BATTERY_BLOCK_CAPEX_SAR = 1.09e9, BATTERY_BLOCK_ANNUAL_SAR = 120e6;
const ANCHORS = [[2.0, 4.37], [3.0, 2.0], [5.0, 1.38]];

function annualSpillPct(g_pct_min) {
  const x = Math.log(Math.max(1e-6, g_pct_min));
  const pts = ANCHORS.map(([g, pct]) => [Math.log(g), pct]);
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (x0 <= x && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

export function economics(spill_mwh, g_mw_min, plant_mw) {
  const g_pct = (g_mw_min / plant_mw) * 100;
  const pct = annualSpillPct(g_pct);
  const annual_mwh = (ANNUAL_ENERGY_MWH * pct) / 100;
  const annual_sar = annual_mwh * SAR_PER_MWH;
  return {
    spill_mwh: r1(spill_mwh), spill_sar: Math.round(spill_mwh * SAR_PER_MWH),
    spill_share_of_day_pct: r2((spill_mwh / CLEAR_DAY_MWH) * 100), g_pct_min: r2(g_pct),
    annual_spill_pct: r2(pct), annual_spill_mwh: Math.round(annual_mwh), annual_spill_sar: Math.round(annual_sar),
    battery_block_capex_sar: BATTERY_BLOCK_CAPEX_SAR, battery_block_annual_sar: BATTERY_BLOCK_ANNUAL_SAR,
    battery_to_spill_ratio: annual_sar > 0 ? r1(BATTERY_BLOCK_ANNUAL_SAR / annual_sar) : null,
    sar_per_mwh: SAR_PER_MWH,
    assumptions: "SAR 50/MWh energy value; clear day ≈ 25 GWh; annual energy ≈ 7.36 TWh; " +
      "battery block 500 MW/2,000 MWh ≈ SAR 1.09 bn, ≈ SAR 120 m/yr; annual spill from Marcos et al. field anchors.",
  };
}

/* ── the run (raseen/scenario/runner.py) ────────────────────────────────── */
const REACHED_COVERAGE = 0.5;

function scenarioId(params) {
  // A stable tag for the parameter set; not the server's SHA-256, which nothing on the page reads.
  const s = JSON.stringify(Object.fromEntries(Object.keys(params).sort().map((k) => [k, params[k]])));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `browser-${h.toString(16).padStart(8, "0")}`;
}

/** Run a scenario on the site payload. `rawParams` is the same object the API accepts. */
export function runScenario(rawParams, sitePayload) {
  const params = normaliseParams(rawParams);
  const site = prepareSite(sitePayload);
  const { members, caps, mvpsMW } = site;
  const n = caps.length;
  const horizon = params.horizon_min;
  const common = {
    event: params.event, heading_deg: params.heading_deg, speed_kmh: params.speed_kmh, depth: params.depth,
    plateau_min: params.plateau_min, seed: params.seed, cover_frac: params.cover_frac,
    cover_offset: params.cover_offset, softness: params.softness,
  };
  const actual = buildField(site, { ...common, stall_at: params.stall_at_min, deepen_at: params.deepen_at_min, deepen_factor: params.deepen_factor });
  const planned = buildField(site, common);

  const nSteps = Math.round((T_END - T_START) / DT_MIN) + 1;
  const times = Array.from({ length: nSteps }, (_, k) => round6(T_START + k * DT_MIN));
  const A = [], A_nowcast = [], cov = [], floors = [], etas = [], A_tot_planned = [], clouds = [];
  const reachBlock = new Array(n).fill(0), reachStation = new Array(site.nStations).fill(0);
  for (const t of times) {
    const cov_m = actual.coverage(t), d_t = actual.depthAt(t);
    const cov_p = planned.coverage(t);
    const eta_m = planned.etaPlanned(t);
    const rowA = new Array(n), rowN = new Array(n), rowC = new Array(n), rowE = new Array(n);
    let totPlanned = 0;
    for (let m = 0; m < cov_p.length; m += 1) {
      totPlanned += mvpsMW * (1 - params.depth * cov_p[m]);
      if (cov_p[m] > reachStation[m]) reachStation[m] = cov_p[m];
    }
    for (let i = 0; i < n; i += 1) {
      const idx = members[i];
      let a = 0, an = 0, c = 0, cp = 0, e = Infinity;
      for (const m of idx) {
        a += mvpsMW * (1 - d_t * cov_m[m]);
        an += mvpsMW * (1 - params.depth * cov_p[m]);
        c += cov_m[m]; cp += cov_p[m];
        if (eta_m[m] < e) e = eta_m[m];
      }
      rowA[i] = a; rowN[i] = an; rowC[i] = c / idx.length; rowE[i] = e;
      const cpm = cp / idx.length;
      if (cpm > reachBlock[i]) reachBlock[i] = cpm;
    }
    A.push(rowA); A_nowcast.push(rowN); A_tot_planned.push(totPlanned); cov.push(rowC);
    floors.push(caps.map((c) => c * (1 - d_t))); etas.push(rowE);
    clouds.push(cloudPolygons(actual, site, t));
  }
  const A_tot = A.map((row) => sum(row));

  const planOpts = { g: params.g_mw_min, confidence: params.confidence, kappa: params.kappa, reserve_override: params.reserve_mw, horizon };
  const plan = planTrajectory(times, A_tot_planned, PLANT_MW, { ...planOpts, flat: params.flat });
  const plan_h = planTrajectory(times, A_tot_planned, PLANT_MW, { ...planOpts, flat: true, hold_margin: plan.delta });
  let P_star = plan.P_star.slice(), P_star_hold = plan_h.P_star.slice();
  let release_from = null, detect_at = null, etas_now = etas;
  if (params.stall_at_min !== null) {
    detect_at = params.stall_at_min + DETECT_DELAY_MIN;
    release_from = times.findIndex((t) => t >= detect_at - 1e-9);
    if (release_from < 0) release_from = times.length - 1;
    P_star = applyRelease(P_star, A_tot, times, release_from, plan.g_up);
    P_star_hold = applyRelease(P_star_hold, A_tot, times, release_from, plan_h.g_up);
    const inf = new Array(n).fill(Infinity);
    etas_now = etas.map((row, k) => (k < release_from ? row : inf));
  }
  P_star = P_star.map((v, k) => Math.min(v, A_tot[k]));
  P_star_hold = P_star_hold.map((v, k) => Math.min(v, A_tot[k]));

  const kw = {
    times, A, A_tot, floors, etas: etas_now, caps, P_star, sigma: params.sigma_min, delta: plan.delta, horizon,
    slew_pct_min: params.slew_pct_min, ppc_delay_steps: params.ppc_delay_steps, release_from, A_nowcast,
  };
  const results = {};
  for (const s of ["base", "uni", "bgc"]) results[s] = simulateScheme(s, kw);
  results.hold = simulateScheme("hold", { ...kw, P_star: P_star_hold, coverage: cov });
  const declared = { base: P_star, uni: P_star, bgc: P_star, hold: P_star_hold };
  const kpis = {};
  for (const [s, r] of Object.entries(results)) {
    kpis[s] = metrics({ times, A_tot, POI: r.POI, P: r.P, A, etas: etas_now, caps, coverage: cov, plant_mw: PLANT_MW, horizon, g_declared: params.g_mw_min, P_star: declared[s] });
  }

  const k_min = plan.k_min;
  const frames = times.map((t, k) => {
    let phase;
    if (release_from !== null && k >= release_from) phase = "released";
    else if (t < 0) phase = "before";
    else if (A_tot[k] > plan.A_min + 1 && k < k_min) phase = "transit";
    else if (A_tot[k] <= plan.A_min + 1) phase = "cover";
    else if (A_tot[k] < PLANT_MW - 1) phase = "exit";
    else phase = "after";
    const eta_row = etas_now[k];
    return {
      t: Math.round(t * 1e4) / 1e4, phase,
      A: A[k].map(r1), P_bgc: results.bgc.P[k].map(r1), P_hold: results.hold.P[k].map(r1), P_uni: results.uni.P[k].map(r1),
      eta: eta_row.map((e) => (Number.isFinite(e) ? r2(e) : null)),
      coverage: cov[k].map(r2),
      cloud: clouds[k],
      agg: {
        A: r1(A_tot[k]), P_uni: r1(results.uni.POI[k]), P_bgc: r1(results.bgc.POI[k]), P_hold: r1(results.hold.POI[k]),
        P_star: r1(P_star[k]), P_star_hold: r1(P_star_hold[k]), R: r1(results.bgc.R[k]), R_hold: r1(results.hold.R[k]),
      },
    };
  });

  const shadedPlanned = [];
  for (let k = 0; k < times.length; k += 1) if (A_tot_planned[k] < PLANT_MW - 1e-6) shadedPlanned.push(k);
  const k_first = shadedPlanned.length ? shadedPlanned[0] : plan_h.k_min;
  const k_last = shadedPlanned.length ? shadedPlanned[shadedPlanned.length - 1] : plan_h.k_min;
  const reached = [];
  for (let i = 0; i < n; i += 1) if (reachBlock[i] > REACHED_COVERAGE) reached.push(i);
  const byArrival = reached.slice().sort((a, b) => etas[0][a] - etas[0][b] || a - b);
  let stationsReached = 0;
  for (const c of reachStation) if (c > REACHED_COVERAGE) stationsReached += 1;

  const front = {
    event: params.event, heading_deg: params.heading_deg, speed_kmh: params.speed_kmh,
    tau_min: r2(actual.tau), depth: params.depth, D_mw: r1(plan.D), L_min: r2(plan.L), g_mw_min: params.g_mw_min,
    g_up_mw_min: plan.g_up, delta_mw: r1(plan.delta), horizon_min: horizon, confidence: params.confidence,
    plateau_min: params.plateau_min, t_desc_start_min: r2(plan.t_desc_start), t_min_min: r2(plan.t_min),
    t_rise_min: r2(plan.t_rise), lead_shortfall_min: r2(plan.lead_shortfall), stall_at_min: params.stall_at_min,
    deepen_at_min: params.deepen_at_min, detect_at_min: detect_at, A_min_mw: r1(plan.A_min),
    hold_mw: r1(plan_h.hold_mw), hold_margin_mw: r1(plan.delta), t_hold_start_min: r2(plan_h.t_desc_start),
    t_first_min: r2(times[k_first]), t_last_min: r2(times[k_last]),
    blocks_reached: reached.length, stations_reached: stationsReached,
    first_block: byArrival.length ? site.blocks[byArrival[0]].id : null,
    last_block: byArrival.length ? site.blocks[byArrival[byArrival.length - 1]].id : null,
  };
  return {
    scenario_id: scenarioId(params), params,
    geometry: { blocks: site.blocks, mvps_block_index: sitePayload.mvps_block_index },
    front, times_min: times.map((t) => Math.round(t * 1e4) / 1e4), frames, kpis,
    economics: economics(kpis.bgc.spill_mwh, params.g_mw_min, PLANT_MW),
    provenance: PROVENANCE, classification: CLASSIFICATION, disclaimer: DISCLAIMER, is_live: false,
    computed_in: "browser", engine_revision: ENGINE_REVISION,
  };
}
