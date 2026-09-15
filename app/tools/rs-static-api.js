/* Static API shim for the Plant page on GitHub Pages.

   The NAJM-3000 dashboard was written to talk to a FastAPI backend. On GitHub Pages there is
   none, so this script intercepts window.fetch and answers every /api/* request from a
   pre-rendered day bundle (data/plant/bundle.json). It reproduces the response shapes the
   dashboard expects for a healthy simulated day. Fault injection is not part of the static
   demo, so those calls return benign no-ops. Non-/api requests (tiles, models, site.json)
   pass through to the real network. */
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

  function plantAt(b, idx, t) {
    const ac = b.series.ac[idx], measured = b.series.measured[idx];
    const blocks = b.blocks.map((blk, i) => ({
      block_id: blk.block_id, config_name: blk.config_name, row: blk.row, column: blk.column,
      ac_power_w: ac[i], measured_w: measured[i], deviation_percent: dev(measured[i], ac[i]),
      fault_severity: null,
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

  async function handle(u, init) {
    const b = await loadBundle();
    const p = u.pathname;
    const path = p.slice(p.indexOf("/api/"));   // tolerate a sub-path prefix
    const t = u.searchParams.get("t");
    const method = (init && init.method ? init.method : "GET").toUpperCase();

    if (path === "/api/status") return b.status;
    if (path === "/api/plant") return plantAt(b, nearestIndex(b.times, t), t || b.times[nearestIndex(b.times, t)]);
    if (path === "/api/weather") return weatherAt(b, nearestIndex(b.times, t), t || b.times[nearestIndex(b.times, t)]);
    if (path === "/api/alarms") return { ...envelope(b), count: 0, alarms: [] };

    let m = path.match(/^\/api\/block\/([^/]+)\/model$/);
    if (m) return { ...envelope(b), ...b.model, block_id: decodeURIComponent(m[1]), faults: [], parts: (b.model.parts || []).map((part) => ({ ...part, fault: null })) };
    m = path.match(/^\/api\/block\/([^/]+)$/);
    if (m) return blockDetail(b, decodeURIComponent(m[1]), nearestIndex(b.times, t), t || b.times[nearestIndex(b.times, t)]);
    m = path.match(/^\/api\/trends\/([^/]+)$/);
    if (m) return { ...envelope(b), ...configOf(b, decodeURIComponent(m[1])).trends, block_id: decodeURIComponent(m[1]) };
    m = path.match(/^\/api\/performance\/([^/]+)$/);
    if (m) return { ...envelope(b), ...configOf(b, decodeURIComponent(m[1])).performance, block_id: decodeURIComponent(m[1]) };
    m = path.match(/^\/api\/diagnostics\/([^/]+)$/);
    if (m) return { ...envelope(b), block_id: decodeURIComponent(m[1]), finding: null, healthy: true };

    if (path === "/api/fault" || path === "/api/scenario-mode") {
      // Fault injection is not part of the static demo.
      return { ...envelope(b), fault: null, cleared: 0, scenario_enabled: false, faults: [] };
    }
    if (method === "DELETE") return { ...envelope(b), cleared: 0 };
    return { ...envelope(b) };
  }

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    let u;
    try { u = new URL(url, location.href); } catch (e) { return REAL_FETCH(input, init); }
    if (!u.pathname.includes("/api/")) return REAL_FETCH(input, init);
    return handle(u, init).then((body) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  };
})();
