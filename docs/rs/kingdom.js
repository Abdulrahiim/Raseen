/* Kingdom page: the Saudi renewable fleet and the transmission backbone. Click NAJM-3000 to
   open its Plant dashboard; every figure is indicative and labelled so. */
import { fmt, fmtGW } from "./format.js";
import { TECH_COLOUR, STATUS_COLOUR, TECH_LABEL, STATUS_LABEL } from "./colour.js";
import { KingdomMap, KingdomPlan, plantTooltipRows } from "./kingdom-map.js";

const $ = (id) => document.getElementById(id);
const state = { plants: [], view: null };
const layers = { plants: true, grid: true, labels: true };
const filter = { tech: new Set(Object.keys(TECH_COLOUR)), status: new Set(Object.keys(STATUS_COLOUR)) };

function banner(msg) { const el = $("rs-banner"); if (!msg) { el.hidden = true; return; } el.textContent = msg; el.hidden = false; }
function showTip(event, head, rows) {
  const t = $("rs-tooltip");
  t.innerHTML = `<div class="rs-tt-head">${head}</div>` + rows.map((r) => `<div class="rs-tt-row"><span>${r.name}</span><span class="val">${r.value}</span></div>`).join("");
  t.style.left = `${event.clientX}px`; t.style.top = `${event.clientY}px`; t.classList.add("on");
}
const hideTip = () => $("rs-tooltip").classList.remove("on");

function openPlant(id) {
  if (id === "najm-3000") { location.href = "/plant"; return; }
  const p = state.plants.find((x) => x.id === id);
  if (p) state.view?.flyTo?.(p);
}

function kpi(k, v, u, sub) { return `<div class="rs-ktile"><span class="k">${k}</span><span class="v">${v}</span><span class="u">${u}</span><span class="sub">${sub}</span></div>`; }

function renderList() {
  const q = ($("rs-search")?.value ?? "").toLowerCase();
  const rows = state.plants
    .filter((p) => filter.tech.has(p.technology) && filter.status.has(p.status) && (!q || p.name_en.toLowerCase().includes(q) || (p.region ?? "").toLowerCase().includes(q)))
    .sort((a, b) => b.capacity_mw - a.capacity_mw);
  $("rs-list").innerHTML = rows.map((p) =>
    `<button type="button" class="rs-prow" data-id="${p.id}"><i class="rs-dot" style="background:${TECH_COLOUR[p.technology]};border:2px solid ${STATUS_COLOUR[p.status]}"></i><span class="nm">${p.name_en}${p.id === "najm-3000" ? ' <span class="twin">twin</span>' : ""}</span><span class="mw">${fmt(p.capacity_mw, 0)} MW</span></button>`
  ).join("") || '<p class="rs-note">No plants match.</p>';
  for (const btn of $("rs-list").querySelectorAll(".rs-prow")) {
    const p = state.plants.find((x) => x.id === btn.dataset.id);
    btn.addEventListener("click", () => { state.view?.flyTo?.(p); setTimeout(() => openPlant(p.id), p.id === "najm-3000" ? 0 : 600); });
    btn.addEventListener("mousemove", (e) => showTip(e, p.name_en, plantTooltipRows(p)));
    btn.addEventListener("mouseleave", hideTip);
  }
  $("rs-count").textContent = `${rows.length} / ${state.plants.length}`;
}

async function boot() {
  // Live: read from the API. Static (GitHub Pages): read pre-rendered JSON files.
  const D = window.RASEEN?.data;
  let plantsBody, gridBody;
  try {
    [plantsBody, gridBody] = await Promise.all([
      fetch(D ? `${D}/plants.json` : "/api/rs/plants").then((r) => r.json()),
      fetch(D ? `${D}/grid.json` : "/api/rs/grid").then((r) => r.json()),
    ]);
  } catch (e) { banner(`Registry failed: ${e.message}`); return; }
  state.plants = plantsBody.plants;
  const f = plantsBody.facts, s = plantsBody.summary;
  $("rs-root").innerHTML = `
  <div class="rs-kingdom">
    <aside class="rs-list-panel">
      <div class="rs-list-head"><h2>Plants <span class="rs-count" id="rs-count"></span></h2></div>
      <input id="rs-search" class="rs-search" type="search" placeholder="Search name or region">
      <div id="rs-list" class="rs-list"></div>
    </aside>
    <div class="rs-map-panel">
      <div class="rs-map-box" id="rs-kmap"></div>
      <div class="rs-kpi-strip">
        ${kpi("Renewables operational", fmt(f.renewables_operational_gw_2024, 2), "GW", `${f.renewables_projects_2024} projects, end-${f.peak_load_year}`)}
        ${kpi("PV installed", fmt(f.pv_installed_gw_2025, 1), "GW", "end-2025")}
        ${kpi("In this registry", fmtGW(s.operational_mw), "operational", `${fmtGW(s.pipeline_mw)} pipeline`)}
        ${kpi("Record peak load", fmt(f.peak_load_gw, 1), "GW", `${f.peak_load_year} · 3 GW ≈ ${f.plant_share_of_peak_pct} %`)}
        ${kpi("Target", "50 %", "by 2030", "renewables share")}
      </div>
      <div class="rs-layer-panel">
        <div class="lp-title">Layers</div>
        <label class="rs-check2"><input type="checkbox" data-layer="plants" checked> Plants</label>
        <label class="rs-check2"><input type="checkbox" data-layer="grid" checked> Grid <span class="sub">schematic</span></label>
        <label class="rs-check2"><input type="checkbox" data-layer="labels" checked> Labels</label>
        <div class="lp-title">Technology</div>
        ${Object.keys(TECH_COLOUR).map((t) => `<label class="rs-check2"><input type="checkbox" data-tech="${t}" checked> <i class="rs-dot" style="background:${TECH_COLOUR[t]}"></i> ${TECH_LABEL[t]} <span class="sub">${fmtGW(s.by_technology_mw[t] ?? 0)}</span></label>`).join("")}
        <div class="lp-title">Status</div>
        ${Object.keys(STATUS_COLOUR).map((st) => `<label class="rs-check2"><input type="checkbox" data-status="${st}" checked> <i class="rs-ring" style="border-color:${STATUS_COLOUR[st]}"></i> ${STATUS_LABEL[st]}</label>`).join("")}
        <button id="rs-fit" class="rs-fitbtn" type="button">Fit Kingdom</button>
      </div>
      <div class="rs-map-note">${plantsBody.note}</div>
    </div>
  </div>`;

  const hooks = {
    onSelect: (id) => openPlant(id),
    onHover: (e, id) => { const p = state.plants.find((x) => x.id === id); showTip(e, p.name_en, plantTooltipRows(p)); },
    onLeave: hideTip,
  };
  const box = $("rs-kmap");
  state.view = new (KingdomMap.available() ? KingdomMap : KingdomPlan)(box, state.plants, gridBody.geojson, hooks);
  if (!(await state.view.init())) { state.view.destroy(); state.view = new KingdomPlan(box, state.plants, gridBody.geojson, hooks); await state.view.init(); }

  // Scope to the panel checkboxes only: the map markers also carry data-tech/data-status.
  for (const cb of document.querySelectorAll("input[data-layer]")) cb.addEventListener("change", () => { layers[cb.dataset.layer] = cb.checked; state.view.setLayers(layers); });
  for (const cb of document.querySelectorAll("input[data-tech]")) cb.addEventListener("change", () => { cb.checked ? filter.tech.add(cb.dataset.tech) : filter.tech.delete(cb.dataset.tech); state.view.setFilter(filter); renderList(); });
  for (const cb of document.querySelectorAll("input[data-status]")) cb.addEventListener("change", () => { cb.checked ? filter.status.add(cb.dataset.status) : filter.status.delete(cb.dataset.status); state.view.setFilter(filter); renderList(); });
  $("rs-fit").addEventListener("click", () => state.view.fitKingdom());
  $("rs-search").addEventListener("input", renderList);
  renderList();
}

boot();
