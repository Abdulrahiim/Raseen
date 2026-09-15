/* Static API shim for the Plant page on GitHub Pages.

   The NAJM-3000 dashboard was written to talk to a FastAPI backend. On GitHub Pages there is
   none, so this script intercepts window.fetch and answers every /api/* request from a
   pre-rendered day bundle (data/plant/bundle.json). It reproduces the response shapes the
   dashboard expects for a healthy simulated day, and it keeps an in-memory fault registry so
   a presenter can inject a demonstration fault exactly as on the live server: the fault is
   presentation state only, it is labelled as injected wherever it appears, and it is gone
   when the page is reloaded. Non-/api requests (tiles, models, site.json) pass through to the
   real network. */
(function () {
  "use strict";
  const REAL_FETCH = window.fetch.bind(window);
  let bundlePromise = null;

  function loadBundle() {
    if (!bundlePromise) bundlePromise = REAL_FETCH("data/plant/bundle.json").then((r) => r.json());
    return bundlePromise;
  }

  function envelope(b) {
    return { classification: b.classification, disclaimer: b.disclaimer, is_live: false };
  }

  // A refusal the page can read the way it reads the server's: a real Response with the
  // right status and the reason under `detail`, so fetch().ok is false and the banner shows
  // the reason instead of nothing.
  class ApiError extends Error {
    constructor(status, detail) {
      super(detail);
      this.status = status;
    }
  }

  const reply = (body, status) =>
    new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });

  function nearestIndex(times, t) {
    if (!t) return Math.floor(times.length / 2);
    const exact = times.indexOf(t);
    if (exact >= 0) return exact;
    const target = Date.parse(t);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < times.length; i += 1) {
      const d = Math.abs(Date.parse(times[i]) - target);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  const dev = (measured, expected) => (expected === 0 ? null : (measured - expected) / expected * 100);

  /* ---- Fault registry ----------------------------------------------------------------
     Mirrors najm3000/dashboard/faults.py: the same label prefix, the same severity ranking,
     the same refusals and the same record shape, so the page cannot tell the shim from the
     server. Severity comes from the catalogue in the bundle, never from the caller. */

  const INJECTED_LABEL = "INJECTED — DEMONSTRATION";
  const SEVERITY_ORDER = ["warning", "serious", "critical"];
  const registry = new Map();   // `${block_id}|${asset}` -> { seq, fault }
  let sequence = 0;

  const catalogueOf = (b) => (b.status && b.status.fault_catalogue) || [];

  function findBlock(b, id) {
    const blk = b.blocks.find((x) => x.block_id === id);
    if (!blk) throw new ApiError(404, `unknown block '${id}'`);
    return blk;
  }

  function injectFault(b, blockId, asset, faultType) {
    findBlock(b, blockId);
    const catalogue = catalogueOf(b);
    const definition = catalogue.find((f) => f.key === faultType);
    if (!definition) {
      const keys = catalogue.map((f) => f.key).sort().join(", ");
      throw new ApiError(400, `unknown fault type '${faultType}'; choose from ${keys}`);
    }
    if (!definition.asset_kinds.includes(asset)) {
      throw new ApiError(
        400,
        `'${definition.label}' cannot apply to '${asset}'; it applies to ${definition.asset_kinds.join(", ")}`,
      );
    }
    const fault = {
      block_id: blockId,
      asset,
      fault_type: faultType,
      label: `${INJECTED_LABEL}: ${definition.label}`,
      severity: definition.severity,
      description: definition.description,
      // The server stamps UTC to the second ("2026-09-15T10:22:33+00:00"); the page reads the
      // clock out of characters 11 to 19, so the shape must match.
      injected_at: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
      origin: "injected",
    };
    sequence += 1;
    registry.set(`${blockId}|${asset}`, { seq: sequence, fault });
    return fault;
  }

  function clearFaults(blockId, asset) {
    let cleared = 0;
    for (const [key, entry] of Array.from(registry)) {
      const f = entry.fault;
      if ((blockId == null || f.block_id === blockId) && (asset == null || f.asset === asset)) {
        registry.delete(key);
        cleared += 1;
      }
    }
    return cleared;
  }

  const entriesOf = (blockId) => Array.from(registry.values()).filter((e) => e.fault.block_id === blockId);
  const faultsOf = (blockId) => entriesOf(blockId).map((e) => e.fault);
  const allFaults = () => Array.from(registry.values()).map((e) => e.fault);

  // Newest first, as the live server serves the alarm log.
  const newestFirst = () =>
    Array.from(registry.values()).sort((a, b) => b.seq - a.seq).map((e) => e.fault);

  function worstSeverity(blockId) {
    const ranks = faultsOf(blockId).map((f) => SEVERITY_ORDER.indexOf(f.severity));
    return ranks.length ? SEVERITY_ORDER[Math.max.apply(null, ranks)] : null;
  }

  /* ---- Diagnostics -------------------------------------------------------------------
     The live server's engine reads only signals and infers a cause from their shape. This
     build has no engine, so the finding is read straight from the injected fault and says so
     in its basis. The one number it carries, the deviation, is not invented either: api.py
     shapes the simulated measurement with a fixed overlay per faulted asset before the engine
     sees it, and the same overlay is applied here to the bundled day, so the deficit shown is
     the one the live server would have put in front of its engine. Where the server shapes
     nothing for a fault, no deviation is claimed. */

  const DIAG_BASIS = "Static build: read from the injected demonstration fault, not inferred from signals.";
  const DARK_W_M2 = 20;
  const HOT_MODULE_C = 60;

  function overlayDeviation(b, blockId, active) {
    const trends = configOf(b, blockId).trends;
    const expected = trends.ac_power_w || [];
    const measuredBase = trends.measured_ac_power_w || expected;
    const poa = trends.poa_w_m2 || [];
    const temp = trends.temp_module_c || [];

    let shaped = false;
    let factor = 1;
    for (const asset of ["inverter_01", "inverter_02"]) {
      if (active[asset] && active[asset].fault_type === "inverter_trip") { factor *= 0.5; shaped = true; }
    }
    if (active.skid) { factor *= 0.88; shaped = true; }
    const hotFactor = active.idt_01 ? 0.86 : 1;
    const dropouts = Boolean(active.rmu);
    if (active.idt_01 || dropouts) shaped = true;
    if (!shaped) return null;

    let sumExpected = 0, sumMeasured = 0;
    for (let i = 0; i < expected.length; i += 1) {
      if (!((poa[i] || 0) > DARK_W_M2)) continue;   // night: deviation there means nothing
      let m = Math.max(0, measuredBase[i] || 0) * factor;
      if ((temp[i] || 0) > HOT_MODULE_C) m *= hotFactor;
      if (dropouts && i % 4 === 0) m = 0;
      sumExpected += Math.max(0, expected[i] || 0);
      sumMeasured += m;
    }
    return dev(sumMeasured, sumExpected);
  }

  function diagnosticsOf(b, blockId) {
    const entries = entriesOf(blockId);
    if (!entries.length) return { block_id: blockId, finding: null, healthy: true };

    // Several faults on one station: report the most serious, the newest among equals.
    entries.sort((x, y) =>
      SEVERITY_ORDER.indexOf(y.fault.severity) - SEVERITY_ORDER.indexOf(x.fault.severity) || y.seq - x.seq,
    );
    const fault = entries[0].fault;
    const active = {};
    for (const f of faultsOf(blockId)) active[f.asset] = f;
    const part = (b.model.parts || []).find((p) => p.asset === fault.asset);
    const assetLabel = part ? part.label : fault.asset;
    const title = fault.label.slice(INJECTED_LABEL.length + 2);
    const deviation = overlayDeviation(b, blockId, active);
    const evidence = [
      `Injected at ${fault.injected_at.slice(11, 19)} UTC on ${assetLabel}`,
      `Severity ${fault.severity}, from the fault catalogue`,
      fault.description,
      deviation === null
        ? "The live server shapes no signal for this fault, so no deviation is claimed"
        : `Overlay deficit over the bundled day: ${deviation.toFixed(1)} % of expected output`,
    ];
    return {
      block_id: blockId,
      finding: {
        block_id: blockId,
        cause: fault.fault_type,
        title,
        severity: fault.severity,
        confidence: "demonstration",
        explanation:
          `${title} was injected on ${assetLabel} as a demonstration. On the live server the ` +
          "deviation engine sees only the resulting signals and infers a cause from their shape; " +
          "this static build has no engine, so the finding restates the injected fault.",
        evidence,
        deviation_percent: deviation,
        basis: DIAG_BASIS,
      },
      healthy: false,
    };
  }

  /* ---- Day bundle views ------------------------------------------------------------ */

  function plantAt(b, idx, t) {
    const ac = b.series.ac[idx], measured = b.series.measured[idx];
    const blocks = b.blocks.map((blk, i) => ({
      block_id: blk.block_id, config_name: blk.config_name, row: blk.row, column: blk.column,
      ac_power_w: ac[i], measured_w: measured[i], deviation_percent: dev(measured[i], ac[i]),
      fault_severity: worstSeverity(blk.block_id),
    }));
    const sumAc = ac.reduce((s, v) => s + v, 0), sumM = measured.reduce((s, v) => s + v, 0);
    return {
      ...envelope(b), timestamp: t, block_count: b.plant.block_count,
      plant_ac_power_w: sumAc, plant_measured_w: sumM, plant_deviation_percent: dev(sumM, sumAc),
      measurement_label: b.plant.measurement_label, grid_rows: b.plant.grid_rows,
      grid_columns: b.plant.grid_columns, spread_assumption_id: b.plant.spread_assumption_id,
      spread_fraction: b.plant.spread_fraction, scaling_label: b.plant.scaling_label, blocks,
    };
  }

  function weatherAt(b, idx, t) {
    return {
      ...envelope(b), timestamp: t, ghi_w_m2: b.weather.ghi[idx], poa_w_m2: b.weather.poa[idx],
      temp_ambient_c: b.weather.tamb[idx], wind_speed_m_s: b.weather.wind[idx],
    };
  }

  function blockDetail(b, id, idx, t) {
    const blk = b.blocks.find((x) => x.block_id === id) || b.blocks[0];
    const cfg = b.configs[blk.config_name];
    const d = cfg.detail;
    const scale = blk.variation / cfg.variation_ref;
    return {
      ...envelope(b), timestamp: t, block_id: blk.block_id, config_name: blk.config_name,
      variation_factor: blk.variation,
      ghi_w_m2: d.ghi_w_m2[idx], poa_irradiance_w_m2: d.poa_irradiance_w_m2[idx],
      temp_ambient_c: d.temp_ambient_c[idx], temp_module_c: d.temp_module_c[idx],
      tracker_angle_deg: d.tracker_angle_deg[idx], dc_power_w: d.dc_power_w[idx],
      ac_power_w: d.ac_power_w[idx], idt_out_power_w: d.idt_out_power_w[idx],
      block_ac_power_w: d.block_ac_power_w[idx] * scale,
    };
  }

  function configOf(b, id) {
    const blk = b.blocks.find((x) => x.block_id === id) || b.blocks[0];
    return b.configs[blk.config_name];
  }

  function blockModel(b, id) {
    const active = {};
    for (const f of faultsOf(id)) active[f.asset] = f;
    return {
      ...envelope(b), ...b.model, block_id: id,
      parts: (b.model.parts || []).map((part) => ({ ...part, fault: active[part.asset] || null })),
      faults: faultsOf(id),
    };
  }

  function parseBody(init) {
    const raw = init && init.body;
    if (!raw) throw new ApiError(422, "a JSON body with block_id, asset and fault_type is required");
    try {
      return JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch (e) {
      throw new ApiError(422, "the request body is not valid JSON");
    }
  }

  async function handle(u, init) {
    const b = await loadBundle();
    const p = u.pathname;
    const path = p.slice(p.indexOf("/api/"));   // tolerate a sub-path prefix
    const t = u.searchParams.get("t");
    const method = (init && init.method ? init.method : "GET").toUpperCase();
    const when = t || b.times[nearestIndex(b.times, t)];

    if (path === "/api/status") return { ...b.status, injected_faults: registry.size };
    if (path === "/api/plant") return plantAt(b, nearestIndex(b.times, t), when);
    if (path === "/api/weather") return weatherAt(b, nearestIndex(b.times, t), when);
    if (path === "/api/alarms") {
      const alarms = newestFirst();
      return { ...envelope(b), count: alarms.length, alarms };
    }
    if (path === "/api/faults") return { ...envelope(b), faults: allFaults() };

    if (path === "/api/fault" && method === "POST") {
      const body = parseBody(init);
      for (const field of ["block_id", "asset", "fault_type"]) {
        if (typeof body[field] !== "string" || !body[field]) throw new ApiError(422, `${field} is required`);
      }
      return { ...envelope(b), fault: injectFault(b, body.block_id, body.asset, body.fault_type) };
    }
    if (path === "/api/fault" && method === "DELETE") {
      return { ...envelope(b), cleared: clearFaults(u.searchParams.get("block_id"), u.searchParams.get("asset")) };
    }

    let m = path.match(/^\/api\/block\/([^/]+)\/model$/);
    if (m) return blockModel(b, decodeURIComponent(m[1]));
    m = path.match(/^\/api\/block\/([^/]+)$/);
    if (m) return blockDetail(b, decodeURIComponent(m[1]), nearestIndex(b.times, t), when);
    m = path.match(/^\/api\/trends\/([^/]+)$/);
    if (m) return { ...envelope(b), ...configOf(b, decodeURIComponent(m[1])).trends, block_id: decodeURIComponent(m[1]) };
    m = path.match(/^\/api\/performance\/([^/]+)$/);
    if (m) return { ...envelope(b), ...configOf(b, decodeURIComponent(m[1])).performance, block_id: decodeURIComponent(m[1]) };
    m = path.match(/^\/api\/diagnostics\/([^/]+)$/);
    if (m) return { ...envelope(b), ...diagnosticsOf(b, decodeURIComponent(m[1])) };

    if (path === "/api/scenario-mode") {
      // The scripted scenario needs the live clock; the static demo has only the presenter.
      return { ...envelope(b), scenario_enabled: false };
    }
    if (method === "DELETE") return { ...envelope(b), cleared: 0 };
    return { ...envelope(b) };
  }

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    let u;
    try { u = new URL(url, location.href); } catch (e) { return REAL_FETCH(input, init); }
    if (!u.pathname.includes("/api/")) return REAL_FETCH(input, init);
    return handle(u, init).then(
      (body) => reply(body),
      // A refusal keeps its status; anything else is the shim's own fault and is reported as
      // a server would report it, so the page banner shows the reason.
      (error) => reply({ detail: error.message }, error instanceof ApiError ? error.status : 500),
    );
  };
})();
