/* Kingdom page: the Saudi renewable fleet and the transmission backbone.

   The page leads with the size of the fleet and how it splits — operational against under
   construction, and PV against everything else — because that is the one thing a national
   view should say before anything is clicked. The map is what the rest of the page is for.
   Capacities are nameplate as announced; the sources sit at the foot of the page. */
import { fmt } from "./format.js";
import { TECH_COLOUR, STATUS_COLOUR, TECH_LABEL, STATUS_LABEL } from "./colour.js";
import { KingdomMap, KingdomPlan, REFERENCE_ID, plantTooltipRows } from "./kingdom-map.js";

const $ = (id) => document.getElementById(id);
const gw = (mw) => fmt((Number(mw) || 0) / 1000, 2);
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

/** The reference plant is the only marker that leaves this page; everything else pans to. */
function openPlant(id) {
  if (id === REFERENCE_ID) { location.href = window.RASEEN?.static ? "plant.html" : "/plant"; return; }
  const p = state.plants.find((x) => x.id === id);
  if (p) state.view?.flyTo?.(p);
}

/** A readout cell. The one cell with no colour key is the total, and it leads the bar. */
function cell(key, value, unit, colour) {
  const swatch = colour ? `<i style="background:${colour}"></i>` : "";
  return `<div class="rs-cell${colour ? "" : " lead"}"><span class="k">${swatch}${key}</span><span class="v">${value}</span><span class="u">${unit}</span></div>`;
}

function renderList() {
  const q = ($("rs-search")?.value ?? "").toLowerCase();
  const rows = state.plants
    .filter((p) => filter.tech.has(p.technology) && filter.status.has(p.status) && (!q || p.name_en.toLowerCase().includes(q) || (p.region ?? "").toLowerCase().includes(q)))
    // Humaij first, then by size: the plant this dashboard is about should not have to be
    // hunted for among the others it happens to tie with.
    .sort((a, b) => (b.id === REFERENCE_ID) - (a.id === REFERENCE_ID) || b.capacity_mw - a.capacity_mw);
  $("rs-list").innerHTML = rows.map((p) =>
    `<button type="button" class="rs-prow${p.id === REFERENCE_ID ? " is-ref" : ""}" data-id="${p.id}">` +
    `<i class="rs-dot" style="background:${TECH_COLOUR[p.technology]};border-color:${STATUS_COLOUR[p.status]}"></i>` +
    `<span class="nm">${p.name_en}</span><span class="mw">${fmt(p.capacity_mw, 0)} MW</span></button>`
  ).join("") || '<p class="rs-empty">Nothing matches those filters.</p>';
  for (const btn of $("rs-list").querySelectorAll(".rs-prow")) {
    const p = state.plants.find((x) => x.id === btn.dataset.id);
    btn.addEventListener("click", () => (p.id === REFERENCE_ID ? openPlant(p.id) : state.view?.flyTo?.(p)));
    btn.addEventListener("mousemove", (e) => showTip(e, p.name_en, plantTooltipRows(p)));
    btn.addEventListener("mouseleave", hideTip);
  }
  $("rs-count").textContent = `${rows.length} of ${state.plants.length}`;
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
  const announced = s.operational_mw + s.pipeline_mw;

  // Biggest technology first: the bar is read as a proportion, so the order is the reading.
  const techs = Object.keys(TECH_COLOUR).filter((t) => (s.by_technology_mw[t] ?? 0) > 0)
    .sort((a, b) => s.by_technology_mw[b] - s.by_technology_mw[a]);
  const techTotal = techs.reduce((sum, t) => sum + s.by_technology_mw[t], 0) || 1;
  const mixText = techs.map((t) => `${TECH_LABEL[t]} ${gw(s.by_technology_mw[t])} GW`).join(", ");

  $("rs-root").innerHTML = `
  <section class="rs-panel rs-registry">
    <div class="rs-readout">
      ${cell("In this registry", gw(announced), `GW announced, ${s.count} projects`)}
      ${Object.keys(STATUS_COLOUR).map((st) => cell(STATUS_LABEL[st], gw(s.by_status_mw[st]), "GW", STATUS_COLOUR[st])).join("")}
    </div>
    <div class="rs-mix">
      <span class="k">Technology mix</span>
      <div class="rs-mixbar" role="img" aria-label="${mixText}">
        ${techs.map((t) => `<span style="width:${((s.by_technology_mw[t] / techTotal) * 100).toFixed(2)}%;background:${TECH_COLOUR[t]}"></span>`).join("")}
      </div>
      <div class="rs-mixkey">
        ${techs.map((t) => `<span><i style="background:${TECH_COLOUR[t]}"></i>${TECH_LABEL[t]} <b>${gw(s.by_technology_mw[t])}</b> GW</span>`).join("")}
      </div>
    </div>
    <div class="rs-filters">
      <div class="fl-set"><span class="fl-k">Technology</span>
        ${techs.map((t) => `<label class="rs-check"><input type="checkbox" data-tech="${t}" checked><i class="rs-dot" style="background:${TECH_COLOUR[t]}"></i>${TECH_LABEL[t]}</label>`).join("")}
      </div>
      <div class="fl-set"><span class="fl-k">Status</span>
        ${Object.keys(STATUS_COLOUR).map((st) => `<label class="rs-check"><input type="checkbox" data-status="${st}" checked><i class="rs-ring" style="border-color:${STATUS_COLOUR[st]}"></i>${STATUS_LABEL[st]}</label>`).join("")}
      </div>
    </div>
  </section>

  <div class="rs-kingdom">
    <aside class="rs-panel rs-fleet">
      <div class="rs-panel-head"><h2>Plants</h2><span class="rs-count" id="rs-count"></span></div>
      <input id="rs-search" class="rs-search" type="search" placeholder="Search name or region" aria-label="Search plants by name or region">
      <div id="rs-list" class="rs-list"></div>
    </aside>
    <section class="rs-panel rs-map-panel">
      <div class="rs-panel-head">
        <h2>Where they are</h2>
        <div class="rs-map-tools">
          <label class="rs-check"><input type="checkbox" data-layer="plants" checked>Plants</label>
          <label class="rs-check"><input type="checkbox" data-layer="grid" checked>Grid schematic</label>
          <label class="rs-check"><input type="checkbox" data-layer="labels" checked>Labels</label>
          <button id="rs-fit" class="rs-btn" type="button">Fit Kingdom</button>
        </div>
      </div>
      <div class="rs-map-screen">
        <div class="rs-map-box" id="rs-kmap"></div>
        <div class="rs-map-key">
          <span><i class="k-pin"></i>Fill is the technology, ring is the status</span>
          <span><i class="k-ref"></i>Humaij, the modelled plant</span>
          <span><i class="k-line"></i>380 kV backbone</span>
          <span><i class="k-line is-evac"></i>Humaij's 110 kV evacuation</span>
        </div>
      </div>
    </section>
  </div>

  <section class="rs-panel rs-foot">
    <div class="rs-panel-head"><h2>Scale and sources</h2></div>
    <p class="rs-scale">For scale, the Kingdom's record peak load was <b>${fmt(f.peak_load_gw, 1)} GW</b> in ${f.peak_load_year}, when
      <b>${fmt(f.renewables_operational_gw_2024, 2)} GW</b> of renewables were operational across ${f.renewables_projects_2024} projects;
      <b>${fmt(f.pv_installed_gw_2025, 1)} GW</b> of PV was installed by the end of 2025. The 2030 target is ${f.target_2030}.
      Humaij on its own, once built, would be about <b>${fmt(f.plant_share_of_peak_pct, 1)} %</b> of that peak.</p>
    <p class="rs-source"><b>National figures</b> — ${f.source}.</p>
    <p class="rs-source"><b>Plant registry</b> — ${plantsBody.note}</p>
    <p class="rs-source"><b>Transmission</b> — ${gridBody.note}</p>
  </section>`;

  const hooks = {
    onSelect: (id) => openPlant(id),
    onHover: (e, id) => { const p = state.plants.find((x) => x.id === id); showTip(e, p.name_en, plantTooltipRows(p)); },
    onLeave: hideTip,
  };
  // The list and its switches are the page's own controls and must not wait on the map. A
  // browser without WebGL sits inside the map's init for the full eight-second style
  // timeout before falling back to the plan, and an empty Plants panel for eight seconds
  // reads as a broken page. So wire and render first; every map call no-ops until the view
  // exists, and the view is caught up with the switches once it does.
  // Scope to the panel checkboxes only: the map markers also carry data-tech/data-status.
  for (const cb of document.querySelectorAll("input[data-layer]")) cb.addEventListener("change", () => { layers[cb.dataset.layer] = cb.checked; state.view?.setLayers(layers); });
  for (const cb of document.querySelectorAll("input[data-tech]")) cb.addEventListener("change", () => { cb.checked ? filter.tech.add(cb.dataset.tech) : filter.tech.delete(cb.dataset.tech); state.view?.setFilter(filter); renderList(); });
  for (const cb of document.querySelectorAll("input[data-status]")) cb.addEventListener("change", () => { cb.checked ? filter.status.add(cb.dataset.status) : filter.status.delete(cb.dataset.status); state.view?.setFilter(filter); renderList(); });
  $("rs-fit").addEventListener("click", () => state.view?.fitKingdom());
  $("rs-search").addEventListener("input", renderList);
  renderList();

  const box = $("rs-kmap");
  state.view = new (KingdomMap.available() ? KingdomMap : KingdomPlan)(box, state.plants, gridBody.geojson, hooks);
  if (!(await state.view.init())) { state.view.destroy(); state.view = new KingdomPlan(box, state.plants, gridBody.geojson, hooks); await state.view.init(); }
  state.view.setLayers(layers); state.view.setFilter(filter);
  // Fit only means something to a view with a camera; on the drawn plan the whole Kingdom is
  // already on screen, and a button that does nothing is worse than no button.
  $("rs-fit").hidden = !state.view.constructor.hasCamera;
}

boot();
