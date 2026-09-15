import { initSiteMap, updateSiteMap, focusSiteBlock, invalidateMapSize, isMapReady }
  from '/static/sitemap.js';
import { initModelViewer, loadModel, applyFaults, focusGroup, frameAll, isReady, refreshTheme }
  from '/static/model.js';

const $ = (id) => document.getElementById(id);

const stationLabel = (id) => (id ? String(id).replace("BLK_", "MVPS ") : "—");

// Every injected fault carries the "INJECTED — DEMONSTRATION:" prefix so that no screen can
// pass it off as a real alarm. Where the page has already said so in the panel title, the
// bare catalogue label reads better.
const plainLabel = (label) => String(label ?? "").replace(/^INJECTED[^:]*:\s*/, "");

const state = {
  status: null,
  plant: null,
  trends: null,
  times: [],
  index: 0,
  selectedBlock: null,
  modelParts: [],
  modelFile: "",
  // The one 3D load in flight (or finished) per model file, so a second caller waits for it
  // instead of starting another download of the same 22 MB file.
  modelLoad: null,
  gridMode: "output",
  overviewStyle: "grid",
  playing: false,
  timer: null,
};

const REPLAY_MS = 120000;

const fmt = (value, digits = 1) =>
  value === null || value === undefined || Number.isNaN(value)
    ? "—"
    : value.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

// fetch() resolves on a 400 as happily as on a 200, which is how a failed fault injection
// went unreported: every call goes through here so a refused request becomes an Error that
// carries the API's own reason. FastAPI's validation errors put a list under `detail`;
// everything else a string.
async function readJSON(response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = Array.isArray(body.detail)
      ? body.detail.map((item) => item.msg ?? JSON.stringify(item)).join("; ")
      : body.detail;
    throw new Error(detail || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getJSON(url) {
  return readJSON(await fetch(url));
}

async function postJSON(url, body) {
  return readJSON(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function deleteJSON(url) {
  return readJSON(await fetch(url, { method: "DELETE" }));
}

async function loadStatus() {
  const status = await getJSON("/api/status");
  state.status = status;

  $("data-source-label").textContent = status.is_live ? "LIVE" : "SIM";
  $("data-source-chip").title = status.disclaimer;
  $("status-calibration").textContent = status.calibration_status.replace("not-", "un");
  $("sb-blocks").textContent = status.block_count.toLocaleString();
  $("clock-date").textContent = `${status.simulated_day}, simulated`;

  $("kpi-blocks").textContent = status.block_count.toLocaleString();
  $("kpi-blocks-note").textContent = status.scaling_label;
  $("grid-note").textContent =
    `Each cell is one MV block. Shade shows AC output. ${status.block_count} blocks. ${status.layout_note}`;
  $("spread-note").textContent =
    `Per-block spread is illustrative (${status.spread_assumption_id})`;
  $("provenance-note").textContent = `${status.disclaimer} ${status.block_count_note}`;

  
  if (status.is_live) {
    $("data-source-chip").classList.remove("chip-sim");
  }
  return status;
}

function buildTimeline(trends) {
  state.times = trends.timestamps;
  const scrubber = $("scrubber");
  scrubber.max = String(Math.max(0, state.times.length - 1));
  scrubber.value = String(Math.min(state.index, state.times.length - 1));
}

function currentTime() {
  return state.times[state.index];
}

function clockLabel(iso) {
  return iso ? iso.slice(11, 16) : "——:——";
}

function deviationColour(deviation) {
  if (deviation === null || deviation === undefined) return "var(--surface-2)";
  if (deviation <= -5) return "var(--critical)";
  if (deviation <= -3) return "var(--serious)";
  if (deviation <= -1.5) return "var(--warning)";
  return "var(--good)";
}

function rampStep(fraction) {
  const steps = ["--ramp-0", "--ramp-1", "--ramp-2", "--ramp-3", "--ramp-4", "--ramp-5"];
  const index = Math.min(steps.length - 1, Math.max(0, Math.round(fraction * (steps.length - 1))));
  return `var(${steps[index]})`;
}

function renderPlant(plant) {
  const grid = $("plant-grid");
  grid.style.gridTemplateColumns = `repeat(${plant.grid_columns}, 1fr)`;

  const powers = plant.blocks.map((b) => b.ac_power_w);
  const peak = Math.max(...powers, 1);

  if (grid.childElementCount !== plant.blocks.length) {
    grid.replaceChildren(
      ...plant.blocks.map((block) => {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "plant-cell";
        cell.setAttribute("role", "listitem");
        cell.dataset.blockId = block.block_id;
        cell.addEventListener("click", () => selectBlock(block.block_id));
        cell.addEventListener("mouseenter", (event) =>
          showTooltip(event, stationLabel(block.block_id), [
            { name: "Expected", value: `${fmt(block.ac_power_w / 1e6, 2)} MW` },
            { name: "Measured (sim)", value: `${fmt((block.measured_w ?? 0) / 1e6, 2)} MW` },
            {
              name: "Deviation",
              value:
                block.deviation_percent === null || block.deviation_percent === undefined
                  ? "—"
                  : `${block.deviation_percent.toFixed(2)} %`,
            },
          ]),
        );
        cell.addEventListener("mouseleave", hideTooltip);
        return cell;
      }),
    );
  }

  plant.blocks.forEach((block, i) => {
    const cell = grid.children[i];
    const fraction = Math.max(0, block.ac_power_w) / peak;
    cell.style.background =
      state.gridMode === "deviation"
        ? deviationColour(block.deviation_percent)
        : rampStep(fraction);
    cell.setAttribute(
      "aria-label",
      `${stationLabel(block.block_id)}, ${fmt(block.ac_power_w / 1e6, 2)} megawatts, simulated`,
    );
    cell.setAttribute("aria-selected", String(block.block_id === state.selectedBlock));
    cell.dataset.severity = block.fault_severity ?? "";
  });

  $("kpi-plant-power").textContent = fmt(plant.plant_ac_power_w / 1e6, 1);
  if (isMapReady()) updateSiteMap(plant.blocks, state.gridMode);
  $("sb-power").textContent = `${fmt(plant.plant_ac_power_w / 1e6, 1)} MW`;
  const dev = plant.plant_deviation_percent;
  $("kpi-deviation").textContent = dev === null || dev === undefined ? "—" : dev.toFixed(2);
  $("kpi-deviation").className = dev !== null && dev < 0 ? "tile-value is-below" : "tile-value";
  const alarms = plant.blocks.filter((b) => b.fault_severity).length;
  $("sb-alarms").textContent = String(alarms);
  $("sb-alarms").className = alarms ? "stat-v is-alarm" : "stat-v";
}

function cellPower(block) {
  return block.ac_power_w;
}

const DETAIL_ROWS = [
  ["Configuration", (d) => d.config_name],
  ["GHI", (d) => `${fmt(d.ghi_w_m2, 0)} W/m²`],
  ["POA irradiance", (d) => `${fmt(d.poa_irradiance_w_m2, 0)} W/m²`],
  ["Ambient temperature", (d) => `${fmt(d.temp_ambient_c)} °C`],
  ["Module temperature", (d) => `${fmt(d.temp_module_c)} °C`],
  ["Tracker angle", (d) => `${fmt(d.tracker_angle_deg)}°`],
  ["Inverter DC input", (d) => `${fmt(d.dc_power_w / 1e6, 2)} MW`],
  ["Inverter AC output", (d) => `${fmt(d.ac_power_w / 1e6, 2)} MW`],
  ["IDT output", (d) => `${fmt(d.idt_out_power_w / 1e6, 2)} MW`],
  ["Block AC output", (d) => `${fmt(d.block_ac_power_w / 1e6, 2)} MW`],
  ["Illustrative spread", (d) => `×${d.variation_factor.toFixed(3)}`],
];

async function refreshBlockDetail() {
  if (!state.selectedBlock) return;
  const detail = await getJSON(
    `/api/block/${state.selectedBlock}?t=${encodeURIComponent(currentTime())}`,
  );
  $("block-note").textContent = `${stationLabel(detail.block_id)}, simulated values`;
  const list = $("block-detail");
  list.replaceChildren();
  for (const [label, read] of DETAIL_ROWS) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = read(detail);
    list.append(dt, dd);
  }
}

function setModelStatus(kind, message) {
  const el = $("model-status");
  if (!el) return;
  el.textContent = message;
  el.className = message ? `model-status is-${kind}` : "model-status";
}

// The fault panel (the two selects and the list) and the 3D view used to be filled by one
// function that waited for the WebGL renderer and then for the 22 MB model file. Until both
// were there the selects stayed empty and Inject fault posted empty strings. The panel now
// needs only the station's small model JSON; the 3D load is a separate, background concern.
async function refreshFaultPanel() {
  if (!state.selectedBlock) return;
  const model = await getJSON(`/api/block/${state.selectedBlock}/model`);
  state.modelParts = model.parts;
  state.modelFile = model.file;
  $("model-block-name").textContent = stationLabel(model.block_id);
  $("model-note").textContent = model.note;
  populateAssetSelect(model.parts);
  renderFaultList(model.faults);
}

// Paint the station in 3D with the parts refreshFaultPanel() last fetched. loadModel() caches
// by file once a load has finished, but not while one is still in flight, and the first
// selectBlock() and the first refreshAtCurrentTime() arrive within the same second; so one
// load is kept per file and later callers wait for it, then apply the current faults.
async function refreshModel3D() {
  if (!isReady() || !state.modelFile) return;
  if (state.modelLoad && state.modelLoad.file === state.modelFile) {
    await state.modelLoad.promise;
    applyFaults(state.modelParts);
    return;
  }
  state.modelLoad = {
    file: state.modelFile,
    promise: loadModel(state.modelFile, state.modelParts),
  };
  await state.modelLoad.promise;
}

function populateAssetSelect(parts) {
  const select = $("fault-asset");
  const catalogue = state.status?.fault_catalogue ?? [];
  // Only assets the catalogue can fault are offered. The pooling substation has no
  // demonstrable failure mode, and choosing it would leave the Fault select empty.
  const faultable = parts.filter((part) =>
    catalogue.some((f) => f.asset_kinds.includes(part.asset)),
  );
  const signature = faultable.map((part) => part.asset).join();
  if (select.dataset.filled !== signature) {
    const previous = select.value;
    select.replaceChildren(
      ...faultable.map((part) => {
        const option = document.createElement("option");
        option.value = part.asset;
        option.textContent = part.label;
        return option;
      }),
    );
    select.dataset.filled = signature;
    // The panel is refreshed on every clock tick; a choice the presenter made must survive it.
    if (faultable.some((part) => part.asset === previous)) select.value = previous;
  }
  syncFaultTypes();
}

function syncFaultTypes() {
  const asset = $("fault-asset").value;
  const select = $("fault-type");
  if (select.dataset.asset !== asset) {
    const allowed = (state.status?.fault_catalogue ?? []).filter((f) =>
      f.asset_kinds.includes(asset),
    );
    select.replaceChildren(
      ...allowed.map((f) => {
        const option = document.createElement("option");
        option.value = f.key;
        option.textContent = f.label;
        return option;
      }),
    );
    select.dataset.asset = asset;
  }
  // Injecting needs a chosen fault and nothing else. A browser without WebGL can still
  // inject; it only cannot watch the part light up.
  $("inject-fault").disabled = !select.value;
}

function renderFaultList(faults) {
  const list = $("fault-list");
  if (!faults.length) {
    list.replaceChildren(
      Object.assign(document.createElement("li"), {
        className: "fault-empty",
        textContent: "No faults injected.",
      }),
    );
    return;
  }
  list.replaceChildren(
    ...faults.map((fault) => {
      const item = document.createElement("li");
      item.className = `fault-item sev-${fault.severity}`;
      const head = document.createElement("div");
      head.className = "fault-head";
      head.textContent = fault.label;
      const body = document.createElement("div");
      body.className = "fault-body";
      body.textContent = `${fault.asset} — ${fault.description}`;
      item.append(head, body);
      item.addEventListener("click", () => {
        const part = state.modelParts.find((p) => p.asset === fault.asset);
        if (part) focusGroup(part.key);
      });
      return item;
    }),
  );
}

async function selectBlock(blockId) {
  state.selectedBlock = blockId;
  if (isMapReady() && state.overviewStyle === "map") focusSiteBlock(blockId);
  $("trend-block-name").textContent = stationLabel(blockId);
  state.trends = await getJSON(`/api/trends/${blockId}`);
  buildTimeline(state.trends);
  renderTrends();
  await refreshBlockDetail();
  await refreshFaultPanel();
  // Load the 3D station model in the background: it can be a large download and must not
  // block the grid, trends and KPIs from rendering (Raseen static build / slow networks).
  // A failure there belongs on the model's own status line, not in the page banner.
  refreshModel3D().catch((error) => setModelStatus("error", `3D unavailable: ${error.message}`));
  await refreshPerformance();
  await refreshAlarms();
  await refreshDiagnostics();
  renderPlant(state.plant);
}

async function refreshAlarms() {
  try {
    const body = await getJSON("/api/alarms");
    const badge = $("alarm-count");
    badge.textContent = String(body.count);
    badge.className = body.count ? "count-badge is-active" : "count-badge";
    $("sb-alarms").textContent = String(body.count);
    $("sb-alarms").className = body.count ? "stat-v is-alarm" : "stat-v";

    const log = $("alarm-log");
    if (!body.count) {
      log.replaceChildren(
        Object.assign(document.createElement("li"), {
          className: "alarm-empty",
          textContent: "No active events.",
        }),
      );
      return;
    }
    log.replaceChildren(
      ...body.alarms.map((a) => {
        const row = document.createElement("li");
        row.className = `alarm-row sev-${a.severity}`;
        const block = document.createElement("span");
        block.className = "alarm-block";
        block.textContent = stationLabel(a.block_id);
        const what = document.createElement("span");
        what.className = "alarm-what";
        what.textContent = `${plainLabel(a.label)} — ${a.asset}`;
        const when = document.createElement("span");
        when.className = "alarm-when";
        when.textContent = (a.injected_at || "").slice(11, 19);
        row.append(block, what, when);
        row.addEventListener("click", () => selectBlock(a.block_id));
        log.append(row);
        return row;
      }),
    );
  } catch (error) {
    /* the alarm log is not worth breaking the page for */
  }
}

async function refreshDiagnostics() {
  if (!state.selectedBlock) return;
  const body = await getJSON(`/api/diagnostics/${state.selectedBlock}`);
  $("diag-block").textContent = stationLabel(body.block_id);
  $("diag-basis").textContent = body.finding
    ? body.finding.basis
    : "Rule-based attribution over simulated signals.";
  const panel = $("diag-body");

  if (!body.finding) {
    $("diag-confidence").textContent = "Nominal";
    panel.replaceChildren(
      Object.assign(document.createElement("p"), {
        className: "diag-healthy",
        textContent: "Measured output matches expectation. No cause to attribute.",
      }),
    );
    return;
  }

  const f = body.finding;
  // The static build has no engine to infer anything: its finding restates the injected
  // fault and says so, and it carries no confidence grade to speak of.
  $("diag-confidence").textContent =
    f.confidence === "demonstration" ? "Demonstration" : `${f.confidence} confidence`;
  const title = document.createElement("p");
  title.className = "diag-title";
  title.textContent =
    f.deviation_percent === null || f.deviation_percent === undefined
      ? f.title
      : `${f.title}, ${fmt(f.deviation_percent, 1)} %`;
  const text = document.createElement("p");
  text.className = "diag-text";
  text.textContent = f.explanation;
  const list = document.createElement("ul");
  list.className = "diag-evidence";
  for (const item of f.evidence) {
    list.append(
      Object.assign(document.createElement("li"), { textContent: item }),
    );
  }
  panel.replaceChildren(title, text, list);
}

async function refreshPerformance() {
  if (!state.selectedBlock) return;
  try {
    const p = await getJSON(`/api/performance/${state.selectedBlock}`);
    $("kpi-pr").textContent =
      p.measured_pr === null ? "—" : p.measured_pr.toFixed(3);
    $("kpi-pr-note").textContent =
      p.expected_pr === null
        ? "measured / expected"
        : `expected ${p.expected_pr.toFixed(3)}, simulated measurement`;
  } catch (error) {
    $("kpi-pr").textContent = "—";
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const span = max - min;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) || magnitude;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

function drawChart(mountId, legendId, series, unit, digits, zeroBaseline = true) {
  const mount = $(mountId);
  const width = Math.max(mount.clientWidth || 640, 320);
  const height = 150;
  const pad = { top: 8, right: 12, bottom: 22, left: 46 };

  const values = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  if (!values.length) return;
  let lo = zeroBaseline ? Math.min(...values, 0) : Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) hi = lo + 1;
  if (!zeroBaseline) {
    const headroom = (hi - lo) * 0.1;
    lo -= headroom;
    hi += headroom;
  }

  const n = series[0].values.length;
  const x = (i) => pad.left + (i / Math.max(1, n - 1)) * (width - pad.left - pad.right);
  const y = (v) => height - pad.bottom - ((v - lo) / (hi - lo)) * (height - pad.top - pad.bottom);

  const svg = el("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${mountId.replace("chart-", "")} over the simulated day`,
  });

  for (const tick of niceTicks(lo, hi)) {
    svg.append(
      el("line", {
        class: "grid-line", x1: pad.left, x2: width - pad.right,
        y1: y(tick), y2: y(tick),
      }),
    );
    const label = el("text", {
      class: "axis-text", x: pad.left - 6, y: y(tick) + 3, "text-anchor": "end",
    });
    label.textContent = fmt(tick, digits);
    svg.append(label);
  }

  svg.append(
    el("line", {
      class: "axis-line", x1: pad.left, x2: width - pad.right,
      y1: height - pad.bottom, y2: height - pad.bottom,
    }),
  );

  
  const tickCount = Math.min(6, n);
  const ticks = Array.from({ length: tickCount }, (_, k) =>
    Math.round((k / Math.max(1, tickCount - 1)) * (n - 1)),
  );
  for (const i of [...new Set(ticks)]) {
    const label = el("text", {
      class: "axis-text", x: x(i), y: height - 7, "text-anchor": "middle",
    });
    label.textContent = clockLabel(state.times[i]);
    svg.append(label);
  }

  for (const s of series) {
    const points = s.values
      .map((v, i) => (Number.isFinite(v) ? `${x(i)},${y(v)}` : null))
      .filter(Boolean)
      .join(" ");
    svg.append(
      el("polyline", {
        class: s.dashed ? "series-line series-measured" : "series-line",
        points,
        stroke: s.color,
      }),
    );
  }

  const crosshair = el("line", {
    class: "crosshair", y1: pad.top, y2: height - pad.bottom, x1: 0, x2: 0, opacity: "0",
  });
  svg.append(crosshair);

  const hit = el("rect", {
    x: pad.left, y: pad.top,
    width: Math.max(1, width - pad.left - pad.right),
    height: Math.max(1, height - pad.top - pad.bottom),
    fill: "transparent",
  });
  hit.addEventListener("mousemove", (event) => {
    const box = svg.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    const i = Math.round(ratio * (n - 1));
    if (i < 0 || i >= n) return;
    crosshair.setAttribute("x1", x(i));
    crosshair.setAttribute("x2", x(i));
    crosshair.setAttribute("opacity", "1");
    showTooltip(
      event,
      clockLabel(state.times[i]),
      series.map((s) => ({
        name: s.name,
        color: s.color,
        value: `${fmt(s.values[i], digits)} ${unit}`,
      })),
    );
  });
  hit.addEventListener("mouseleave", () => {
    crosshair.setAttribute("opacity", "0");
    hideTooltip();
  });
  svg.append(hit);

  mount.replaceChildren(svg);

  const legend = $(legendId);
  legend.replaceChildren(
    ...series.map((s) => {
      const key = document.createElement("span");
      key.className = "legend-key";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = s.dashed
        ? `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)`
        : s.color;
      const name = document.createElement("span");
      name.textContent = s.name;
      key.append(swatch, name);
      return key;
    }),
  );
}

function seriesColor(slot) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--series-${slot}`)
    .trim();
}

function renderTrends() {
  if (!state.trends) return;
  const t = state.trends;
  const c1 = seriesColor(1);
  const c2 = seriesColor(2);

  drawChart(
    "chart-irradiance", "legend-irradiance",
    [{ name: "POA effective", values: t.poa_w_m2, color: c1 }],
    "W/m²", 0,
  );
  drawChart(
    "chart-temperature", "legend-temperature",
    [{ name: "Module temperature", values: t.temp_module_c, color: c2 }],
    "°C", 1, false,
  );
  drawChart(
    "chart-power", "legend-power",
    [
      { name: "Expected AC", values: t.ac_power_w.map((v) => v / 1e6), color: c1 },
      {
        name: "Measured AC (simulated)",
        values: (t.measured_ac_power_w ?? []).map((v) => v / 1e6),
        color: c2,
        dashed: true,
      },
    ],
    "MW", 2,
  );
}

function showTooltip(event, heading, rows) {
  const tip = $("tooltip");
  tip.replaceChildren();

  const head = document.createElement("div");
  head.className = "tooltip-head";
  head.textContent = heading;
  tip.append(head);

  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "tooltip-row";
    const name = document.createElement("span");
    name.className = "tooltip-name";
    if (row.color) {
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = row.color;
      name.append(swatch);
    }
    name.append(document.createTextNode(row.name));
    const value = document.createElement("span");
    value.className = "tooltip-value";
    value.textContent = row.value;
    line.append(name, value);
    tip.append(line);
  }

  tip.style.left = `${event.clientX}px`;
  tip.style.top = `${event.clientY}px`;
  tip.classList.add("is-visible");
}

function hideTooltip() {
  $("tooltip").classList.remove("is-visible");
}

async function refreshAtCurrentTime() {
  const when = currentTime();
  if (!when) return;
  $("clock-time").textContent = clockLabel(when);

  const [plant, weather] = await Promise.all([
    getJSON(`/api/plant?t=${encodeURIComponent(when)}`),
    getJSON(`/api/weather?t=${encodeURIComponent(when)}`),
  ]);

  state.plant = plant;
  renderPlant(plant);

  $("wx-ghi").textContent = fmt(weather.ghi_w_m2, 0);
  $("wx-poa").textContent = fmt(weather.poa_w_m2, 0);
  $("wx-tamb").textContent = fmt(weather.temp_ambient_c);
  $("wx-wind").textContent = fmt(weather.wind_speed_m_s);
  $("weather-source").textContent =
    `Source classification: ${weather.classification}. ${weather.disclaimer}`;

  $("kpi-poa").textContent = fmt(weather.poa_w_m2, 0);
  if (state.trends) {
    $("kpi-tmod").textContent = fmt(state.trends.temp_module_c[state.index]);
  }

  await refreshBlockDetail();
  await refreshAlarms();
  await refreshDiagnostics();
  // The scripted scenario raises faults as the clock passes them, so the panel is refreshed
  // on every tick. It is one small JSON fetch; the 3D load is cached by file and only
  // repaints the parts.
  await refreshFaultPanel();
  refreshModel3D().catch((error) => setModelStatus("error", `3D unavailable: ${error.message}`));
}

function setPlaying(playing) {
  state.playing = playing;
  $("play").textContent = playing ? "Pause" : "Go live";
  clearInterval(state.timer);
  if (!playing) return;
  const tick = Math.max(120, REPLAY_MS / Math.max(1, state.times.length));
  state.timer = setInterval(() => {
    state.index = (state.index + 1) % state.times.length;
    $("scrubber").value = String(state.index);
    refreshAtCurrentTime().catch(reportError);
  }, tick);
}

function reportError(error) {
  $("banner").textContent = `Dashboard error: ${error.message}`;
}

async function main() {
  $("fault-asset").addEventListener("change", syncFaultTypes);

  $("inject-fault").addEventListener("click", async () => {
    const asset = $("fault-asset");
    const type = $("fault-type");
    if (!state.selectedBlock || !type.value) return;
    try {
      const body = await postJSON("/api/fault", {
        block_id: state.selectedBlock,
        asset: asset.value,
        fault_type: type.value,
      });
      const assetLabel = asset.selectedOptions[0]?.textContent || asset.value;
      setModelStatus(
        "ok",
        `Injected: ${plainLabel(body.fault?.label) || type.value} on ${assetLabel}. See the alarm log.`,
      );
      // The panel first, so the new fault is listed even if the page-wide refresh fails.
      await refreshFaultPanel();
      await refreshAtCurrentTime();
    } catch (error) {
      reportError(error);
    }
  });

  $("fit-all").addEventListener("click", () => frameAll());

  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener("click", async () => {
      state.overviewStyle = button.dataset.view;
      for (const other of document.querySelectorAll("[data-view]")) {
        other.classList.toggle("is-on", other === button);
      }
      const wantMap = state.overviewStyle === "map";
      $("plant-grid").hidden = wantMap;
      $("site-map").hidden = !wantMap;
      const ramp = document.querySelector(".legend-ramp");
      if (ramp) ramp.dataset.hidden = String(wantMap);
      if (wantMap) {
        const ok = await initSiteMap("site-map", selectBlock);
        if (!ok) {
          $("grid-note").textContent =
            "Satellite view unavailable (map library or site data missing).";
          return;
        }
        invalidateMapSize();
        if (state.plant) updateSiteMap(state.plant.blocks, state.gridMode);
        $("grid-note").textContent =
          "As-designed layout over satellite imagery. Marker colours are simulated values.";
      } else {
        $("grid-note").textContent =
          `Each cell is one MV block. Shade shows AC output. ${state.status.block_count} blocks.`;
      }
    });
  }

  for (const button of document.querySelectorAll(".seg-btn[data-mode]")) {
    button.addEventListener("click", () => {
      state.gridMode = button.dataset.mode;
      for (const other of document.querySelectorAll(".seg-btn[data-mode]")) {
        other.classList.toggle("is-on", other === button);
      }
      $("grid-note").textContent =
        state.gridMode === "deviation"
          ? "Shade shows measured against expected. Simulated measurement."
          : `Each cell is one MV block. Shade shows AC output. ${state.status.block_count} blocks.`;
      if (state.plant) renderPlant(state.plant);
    });
  }

  $("clear-faults").addEventListener("click", async () => {
    try {
      const body = await deleteJSON("/api/fault");
      const n = body.cleared ?? 0;
      setModelStatus(
        "ok",
        n === 0 ? "No injected faults to clear." : `Cleared ${n} injected ${n === 1 ? "fault" : "faults"}.`,
      );
      await refreshFaultPanel();
      await refreshAtCurrentTime();
    } catch (error) {
      reportError(error);
    }
  });

  $("play").addEventListener("click", () => setPlaying(!state.playing));
  $("step-back").addEventListener("click", () => {
    setPlaying(false);
    state.index = Math.max(0, state.index - 1);
    $("scrubber").value = String(state.index);
    refreshAtCurrentTime().catch(reportError);
  });
  $("step-fwd").addEventListener("click", () => {
    setPlaying(false);
    state.index = Math.min(state.times.length - 1, state.index + 1);
    $("scrubber").value = String(state.index);
    refreshAtCurrentTime().catch(reportError);
  });
  $("scrubber").addEventListener("input", (event) => {
    setPlaying(false);
    state.index = Number(event.target.value);
    refreshAtCurrentTime().catch(reportError);
  });
  addEventListener("resize", () => renderTrends());
  // The theme switch lives in the shell's top bar. The trend charts read their colours when
  // drawn and the 3D ground reads the canvas token, so both are redrawn on the event.
  addEventListener("rs-theme", () => { renderTrends(); refreshTheme(); });

  // The 3D viewer is a way of seeing the station, not the way of faulting it. When WebGL is
  // missing the message goes on the model's status line and the fault panel carries on.
  try {
    initModelViewer(
      $("model-viewer"),
      (partKey) => {
        const part = state.modelParts.find((p) => p.key === partKey);
        if (part) {
          $("fault-asset").value = part.asset;
          focusGroup(part.key);
        }
        syncFaultTypes();
      },
      setModelStatus,
    );
  } catch (error) {
    setModelStatus("error", `3D unavailable: ${error.message}`);
  }

  await loadStatus();
  const firstPlant = await getJSON(`/api/plant?t=${state.status.simulated_day}T12:00`);
  state.plant = firstPlant;
  await selectBlock(firstPlant.blocks[0].block_id);

  
  const noon = state.times.findIndex((t) => t.slice(11, 13) === "12");
  state.index = noon >= 0 ? noon : 0;
  $("scrubber").value = String(state.index);
  await refreshAtCurrentTime();
  if (state.status?.scenario_enabled) setPlaying(true);
}

main().catch(reportError);
