# Raseen dashboard — design

**Date:** 14 September 2026 · **Status:** draft for approval · **Target:** jury pitch 9 October 2026 (build deadline 7 October)

Raseen (رَصين) is the product: a no-storage Block Gradient Control (BGC) system for gigawatt solar. NAJM-3000 is the 3,000 MWac reference plant inside its twin. This document specifies the Raseen web dashboard: what it shows, how it is built, how it is tested, and how it is deployed to Azure.

It replaces the single-screen, no-sidebar recommendation in `NAJM-3000/Claude outputs/raseen-dashboard-plan.md` (14 Sep) on the project lead's instruction: the dashboard has a left sidebar with tabs, a Kingdom map of all renewables with the transmission grid, and a per-plant satellite view with the real block layout. The ten dashboard ideas in that plan (twin run, headroom layer, ETA isochrones, headroom drawn inside the block, confidence slider, stall/deepen buttons, live Ramp Event Notice, the one big ramp number, economics strip, honest labelling) are all kept and land on the Gradient Control page.

---

## 1. Goals

1. Give the jury one application that shows, in this order: the Kingdom's renewable fleet and grid; one plant modelled to the block; a cloud crossing that plant handled by two controllers side by side; the Grid Code declaration the controller generates.
2. Reuse what NAJM-3000 already has: the real site geometry (363 MVPS, 15 zones, block linework from the project KML), the MapLibre satellite map, the SCADA-style chrome, and the classification/disclaimer discipline.
3. Port `raseen_bgc_sim.py` from the abstract 10 × 3 block grid to the real plant geometry, so the map, the controller and the numbers are the same object.
4. Run anywhere: locally with one command, and on Azure from a GitHub Actions workflow, using the GitHub Student Developer Pack credit. Weight is not a constraint.

### Non-goals (for this spec)

- Live PPC or TSP connections, real forecast-provider ingestion, or a nowcast estimator. ETAs are ground truth from the shadow generator (dissent item F9). The nowcast module is a labelled stub.
- Weather forecasting of any kind. The kill sentences in the v4 document apply to every label in the UI.
- The 22 MB 3D station model on any main page. It may be added later to the block inspector.
- Full Arabic UI. Brand, tagline and page titles are bilingual; body copy is English.
- Authentication. The deployed site is a public demonstration.

---

## 2. Decisions taken

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Where the code lives | `C:\Users\msms-\Raseen\app\`, with `C:\Users\msms-\Raseen` as the git repository root | Raseen is the product and will be pushed to GitHub for Azure. NAJM-3000 stays a local, no-remote repository under its own confidentiality policy. The app copies what it needs from NAJM-3000 (site geometry, vendored map libraries) and never imports the `najm3000` package. |
| D2 | Stack | FastAPI backend (Python 3.11) + static front-end in vanilla ES modules, MapLibre GL JS for maps, inline SVG for charts. No front-end build step. One container. | Same stack as the NAJM-3000 dashboard, so `sitemap.js`, the styles and the API patterns port directly. No npm pipeline to break on Azure. The BGC simulation is already Python. |
| D3 | Pages | Five sidebar tabs: **Kingdom · Plant · Gradient Control · Declarations · About** | Matches the requested sidebar navigation. Economics is a strip on Gradient Control, not a page. |
| D4 | Maps | Kingdom: CARTO dark raster basemap. Plant and Gradient Control: Esri World Imagery raster tiles (as NAJM-3000 does today). Both without API keys. | No key management, no vendor account. Tiles need internet; §8 defines the offline fallback. |
| D5 | Block model | 363 MVPS clustered into 30 control blocks by deterministic k-means on local metric coordinates; each block's capacity is its MVPS count × 3,000/363 MW; block labelled by its dominant zone | The v4 document's "30 × 100 MW" becomes 30 real, unequal blocks on the real layout. Zone names stay visible. |
| D6 | Cloud model | A front is a moving band with heading θ, speed v, depth d and length. Coverage is evaluated per MVPS, so a block's available power falls gradually as the edge crosses it. τ becomes heading-dependent (9.2 min E–W, 13.2 min N–S at 48 km/h). | The plan's key finding: the real geometry is a live demonstration of g = D/(τ + L). |
| D7 | Scenario computation | Computed on demand by the backend, cached by parameter hash, returned as one JSON of 10-second frames for baseline, plant-level and BGC together | No live failure mode beyond one request; the demo can also be served from a pre-warmed cache file. |
| D8 | Theme | Dark control-room default with a light toggle; presentation mode lifts the base colours for projectors | Both reference screenshots covered; projector risk from the plan §5 handled. |
| D9 | Geometry exposure | Real coordinates and zone names by default (`RASEEN_SITE_MODE=real`). A `representative` mode applies a fixed offset and generic zone labels. | The project lead asked for the satellite view of the real blocks. The mode switch exists so the public deployment can be changed with one environment variable if the confidentiality position changes. **Open decision for the lead: see §11.** |

---

## 3. Architecture

```
 Raseen/app/
 ├── raseen/                      Python package (backend)
 │   ├── geometry/   site.json → 30 control blocks, hulls, centroids, projection along a heading
 │   ├── shadow/     front / thin band / scattered-cumulus shadow fields; per-MVPS coverage; ETA
 │   ├── control/    trajectory planner (g, L, Δ, R) and the BGC allocator; plant-level scheme; baseline
 │   ├── scenario/   runs a scenario → frames, KPIs, notice fields; parameter model; cache
 │   ├── registry/   plants.json (Kingdom renewables) and grid.json (indicative transmission backbone)
 │   ├── api.py      FastAPI: /api/status /api/plants /api/grid /api/site /api/scenario /api/notice
 │   └── static/     index.html, app.js (router + store), pages/*.js, maps/*.js, charts.js, styles.css, vendor/, data/
 ├── tests/          pytest (backend) and one Playwright smoke test (front-end)
 ├── Dockerfile      python:3.11-slim, uvicorn
 ├── pyproject.toml
 └── README.md       run locally, run tests, deploy
 .github/workflows/deploy-azure.yml   at the repository root
```

**Data flow.** The browser loads `/api/status` (classification, disclaimer, version), then per page: Kingdom fetches `/api/plants` and `/api/grid`; Plant fetches `/api/site` (geometry + block mapping) and the current scenario frames; Gradient Control posts scenario parameters to `/api/scenario` and replays the frames locally at 10-second resolution with a scrubber; Declarations reads the notice fields from the same frames. A single client-side store holds the active scenario so every page shows the same event at the same instant.

**The contract that matters** is the scenario JSON (§6). It is the agreed interface between the control team (WP3) and the dashboard (WP5). The dashboard renders whatever satisfies it, whether produced live by `raseen.scenario` or dropped in as a file.

**What is reused from NAJM-3000, and how.** `site.json` is copied verbatim into `static/data/` with its provenance note. `sitemap.js` is ported (MapLibre map, MVPS circles, block outlines with feature-state colouring, zone labels, glow, fly-to) with the three.js tracker-field layer removed from the default page and kept as an optional layer. `styles.css` tokens are the starting palette. The API envelope (`classification`, `disclaimer`, `is_live`) is kept on every response.

---

## 4. Pages

### 4.1 Shell

Left sidebar, 220 px, collapsible to 56 px icons (and collapsed by default under 900 px). Items: Kingdom, Plant, Gradient Control, Declarations, About; bottom: theme toggle, presentation mode, version. Top bar: Raseen wordmark with رَصين, the active page title, the permanent `SIM` chip (from the API, never hard-coded), and the scenario clock when a scenario is loaded. Routing is hash-based (`#/kingdom`, `#/plant/najm-3000`, `#/control`, `#/declarations`, `#/about`); the store keeps the active plant and scenario across tabs.

### 4.2 Kingdom

A full-height MapLibre map of Saudi Arabia (dark basemap) with:

- **Plants layer.** Every entry in `plants.json`: circle sized by capacity, coloured by technology (PV, wind, CSP, BESS), ring by status (operational, under construction, awarded). Hover: name, MW, developer, status. Click: opens the Plant page for that plant. NAJM-3000 is marked as the reference plant.
- **Grid layer.** `grid.json`: the 380 kV backbone corridors and the main substations/operating areas as an indicative schematic, plus the plant's 110 kV evacuation to the nearest backbone node. Labelled on the legend as "schematic, not a survey".
- **Layer options panel** (top-right, like the reference screenshot's legend card): toggles for Plants / Grid / Labels, a technology filter, a status filter, and a capacity gradient scale.
- **KPI strip** (top-left cards): renewables operational (GW), PV pipeline (GW), 2030 target (50 %), record peak load (72.9 GW), "a 3 GW plant ≈ 4 % of peak". Values come from `project-notes/hackathon-key-facts.md` and carry their year.
- **Plant list** (left drawer, searchable) mirroring the markers.

### 4.3 Plant

For **NAJM-3000** (the modelled plant):

- Satellite map (Esri imagery) with the 363 MVPS, real block outlines, zone labels; fly-in from the Kingdom map. `Satellite | Plan` toggle, where Plan is the same geometry rendered as SVG without a basemap (the offline fallback).
- **Colour mode**: `Output | Headroom | ETA`, driven by the active scenario frame (or a clear-day frame when no scenario is loaded). Output = set-point / capacity; Headroom = A − P (violet scale); ETA = minutes to arrival (cyan scale, with isochrone labels per block).
- **Cloud overlay**: the front polygon for the current frame.
- Facts panel: capacity, MVPS count, PSS, lines, zones, coordinates, the "as-designed, not as-built" note.
- **Block inspector** (click a block or an MVPS): block id and zone, MVPS count and capacity, available, set-point (both controllers), headroom and firm flag, ETA, coverage; a small trend of A and P for the block over the event.
- Grid view (`Grid` toggle): the NAJM-style cell grid of the 30 control blocks ordered by ETA along the current heading, each cell filled to its set-point with the available power outlined (idea 4). This is the same component the Gradient Control page uses.

For any **other plant** in the registry: satellite map centred on the plant, a footprint circle scaled from capacity, the facts panel, and the line "Block geometry not modelled. Raseen's twin currently models NAJM-3000." No scenario controls.

### 4.4 Gradient Control (the spine)

Layout (desktop): map left (55 %), controls and readouts right; charts below; timeline at the bottom.

- **Scenario controls**: controller view (`Plant-level | Raseen | Compare`), event (`Solid front D1 | Thin band D2 | Scattered cumulus D3`), heading (0–360°, direction of motion, default 90° = west to east), speed (24/48/72 km/h), depth (20–80 %), declared gradient g (60–180 MW/min, with the implied lead L shown), confidence (0.3–0.9, drives Δ = D·(1−c)·κ), reserve override, Dynamic Solar Headroom (hold flat) checkbox.
- **Two buttons for the two hostile questions**: `Stall the front` (release mode from the current instant, nearest blocks first, spill logged) and `Deepen the front 20 %` (reserve slice absorbs it or the line is missed, and the notice says which).
- **Map**: as on the Plant page. In `Compare`, the map splits into two panes (plant-level left, Raseen right) showing the same instant.
- **Plant power**: available, export, declared, firm reserve R(t, 5 min) as the four largest numbers on the screen.
- **Ramp event**: `−180 MW/min → −60 MW/min` with a two-slope inset (idea 8).
- **Cloud intelligence**: heading, speed, depth, τ for this heading, L, confidence, phase chip (before contact / transit / full cover / exit).
- **Generation chart**: available, uncontrolled, plant-level export, Raseen export, declared line, shaded headroom band; cursor tied to the timeline.
- **Block gradient panel**: 30 blocks ordered by ETA, fill = set-point, outline = available, violet = firm headroom, grey = expiring headroom, cloud hatch on covered blocks.
- **KPI tiles**: max 10-min drop, max down-gradient, energy not exported (with the honesty line "identical for both controllers on a perfectly forecast front"), lead before contact, spilled before contact (false-alarm exposure), firm reserve at contact, blocks stepped at arrival (0 for Raseen), tracking error vs declared line.
- **Economics strip**: spilled MWh → SAR at SAR 50/MWh, beside the annualised battery block cost, and the annual estimate at the chosen gradient (from the v4 §5.3 table).
- **Timeline**: play/pause, scrubber from T−40 to T+100 min with markers at T−L, T0, T0+τ, exit; keyboard left/right steps 10 s, shift+arrow 1 min.

### 4.5 Declarations

The Ramp Event Notice rendered as a live document from the active scenario at the current instant: plant and connection point, notice number, issue time (T−L), valid-from, confidence; event (expected onset, cause, expected minimum available power, duration, recovery); declared trajectory (10-second table and a sparkline), declared gradient and lead; firm reserve R(t, Hʳ) and its horizon; residual under full cover to be covered by other plant; compliance ledger with the clause anchors from v4 §9 (5.3.8.1(iii), 4.46.3.2, 2.11.13.11, 5.4.2.3, Delta Regulation, 2.11.13.10, 4.50.8.7, 2.14.1). Each ledger row shows pass/fail from the frames (POI within ±2 % of set-point, gradient within ±10 % of g, R declared ≤ deliverable, blocks stepped = 0). A `Copy as JSON` button exports the notice.

### 4.6 About / What's real

The labelling page (idea 10): a two-column table of what is measured, designed, real code, and simulated (irradiance driver, geometry, controller, telemetry, forecast, PPC, TSP); the version history in five rows; the kill sentences; sources; and the standing disclaimer from the API. A `What's real` toggle in the top bar annotates every page with the same labels.

---

## 5. Backend modules

### 5.1 `raseen.geometry`

- Loads `site.json` (363 MVPS points, 363 block hulls, 17 zone labels, 5,000 line segments, bounds).
- Projects to local metres (equirectangular about the site centre).
- `control_blocks(k=30, seed=7)`: k-means with deterministic initialisation (farthest-point seeding from the western-most MVPS) → 30 blocks, each with `id`, `label` (dominant zone + ordinal), `mvps` (list of n), `capacity_mw` (n × 3000/363), `centroid`, `hull` (convex hull of member MVPS points, lon/lat), `extent_m`.
- `projection(heading_deg)`: unit vector along the heading; per-MVPS and per-block scalar position `s`; plant extent along the heading; τ for a speed.
- Representative mode: fixed offset applied at load; zone labels replaced by `Zone 1..n`.

### 5.2 `raseen.shadow`

Shadow fields return per-MVPS coverage in [0, 1] at time t (minutes from fence contact) and the leading/trailing edge positions:

- `solid_front(heading, speed, depth, plateau_min)`: band length = (τ + plateau) × v; edge transition width 150 m so coverage rises smoothly across a block.
- `thin_band(heading, speed, depth, width_m=1600)`.
- `scattered_cumulus(heading, speed, depth, n=12, seed)`: n ellipses (600–1,800 m) drifting with the wind; ETA per MVPS is the time until any ellipse's leading edge reaches it (∞ if none).
- Perturbations: `stall_at(t)` freezes the field from t; `deepen_at(t, factor)` scales depth from t.
- `eta(t)` per MVPS and per block. Block ETA is the **minimum** member ETA (first arrival), because descend-first must finish before the first station in the block is shaded. Block coverage is the capacity-weighted mean of member coverage.
- Heading convention everywhere (API, UI, tests): **direction of motion, degrees clockwise from north**. A front entering from the west and moving east has heading 90°, which is the default.

### 5.3 `raseen.control`

Port of `raseen_bgc_sim.py` generalised to N blocks of unequal capacity:

- `available(block, t)` = capacity × (1 − depth × coverage).
- `trajectory_planner(A_tot, τ, L_avail, confidence, g_declared, κ=0.25, Hʳ=5)`: feasible g, descent start, plateau, up-gradient, Δ = D·(1−c)·κ capped at 10 % of plant, `P*(t)`, `R(t, Hʳ)`.
- `allocate_bgc(A, A_floor, ETA, P_target, Δ, Hʳ, σ, slew, P_prev)`: exactly the six-step allocation of v4 §7.3 (reserve slice, descend-first water-filling, floor spill, slew clamp, aggregate rebalance, reactive duty ∝ √(S² − P²)).
- `allocate_uniform(A, P_target)`: proportional plant-level rule with a configurable PPC feedback delay (default 1 step) so the comparison is fair to the state of the art.
- `baseline(A)`.
- Release mode after a stall: C → 0 along the registered up-gradient, nearest blocks first.
- The abstract 10 × 3 plant of the v4 document remains available as a fixture so the D1 table (65/155/305/605 MWh) is reproduced by test.

### 5.4 `raseen.scenario`

`ScenarioParams` (pydantic): `event`, `heading_deg`, `speed_kmh`, `depth`, `g_mw_min`, `confidence`, `reserve_mw` (optional override), `flat` (DSH), `sigma_min`, `slew_pct_min`, `horizon_min`, `plateau_min`, `stall_at_min`, `deepen_at_min`, `deepen_factor`, `seed`. Validation ranges match the UI controls.

`run(params) → Scenario`: frames every 10 s from T−40 to T+100 min for all three schemes; aggregates; KPIs (the list in §4.4); notice fields; economics; a `provenance` block naming what is real and what is simulated. Results are cached by a SHA-256 of the canonical parameter JSON, in memory and on disk under `app/.cache/` so a rehearsed scenario loads instantly.

### 5.5 `raseen.registry`

- `plants.json`: compiled from public announcements (SPPC/NREP rounds, developer press releases, GASTAT). Fields: `id`, `name_en`, `name_ar`, `technology` (pv | wind | csp | bess), `capacity_mw`, `status` (operational | under_construction | awarded | planned), `developer`, `region`, `lat`, `lon`, `coordinate_quality` (site | town | approximate), `cod_year`, `source`, `note`. Target: 35–45 entries covering NREP rounds 1–5, the PIF/ACWA programme plants, the wind farms, the Bisha BESS, and NAJM-3000. Every entry keeps its source URL; coordinates are town-level unless a site coordinate is public.
- `grid.json`: GeoJSON FeatureCollection. Lines: 380 kV backbone corridors between the main load centres and interconnections (Eastern–Central, Central–Western, Western–Southern, Central–Northern, Qassim–Hail–Tabuk, the GCC interconnection at Al Fadhili) with `voltage_kv`, `indicative: true`; points: the operating areas' main substations. It is a schematic and is labelled as one everywhere it appears.

### 5.6 `raseen.api`

| Endpoint | Returns |
|---|---|
| `GET /api/status` | envelope + version, site mode, plant, block count, cache size, `what_is_real` table |
| `GET /api/plants` | envelope + plants list + summary (GW by technology and status) |
| `GET /api/grid` | envelope + GeoJSON |
| `GET /api/site` | envelope + geometry note, bounds, mvps, blocks (30), zones, lines |
| `POST /api/scenario` | envelope + `scenario_id` + the scenario JSON (§6); 400 on invalid parameters |
| `GET /api/scenario/{id}` | the cached scenario, 404 if unknown |
| `GET /api/notice/{id}?t=` | the Ramp Event Notice at instant t, with the compliance ledger |
| `GET /` and `/static/*` | the front-end |

Every JSON response carries `classification: "SIMULATION (RASEEN PROTOTYPE)"`, `disclaimer` (irradiance driver representative, geometry as-designed, telemetry simulated, not measured, not calibrated, not validated) and `is_live: false`. A test asserts the API module never imports `najm3000`.

---

## 6. Scenario JSON (the contract)

```json
{
  "scenario_id": "sha256…",
  "params": { "...as submitted, with defaults filled..." },
  "geometry": { "blocks": [ { "id": "B07", "label": "Z-5 · 2", "capacity_mw": 91.7, "centroid": [41.11, 25.05], "hull": [[lon, lat], "..."], "mvps": [101, 102, "..."] } ] },
  "front": { "heading_deg": 90, "speed_kmh": 48, "tau_min": 9.2, "depth": 0.6, "D_mw": 1800, "L_min": 10.0, "g_mw_min": 90, "delta_mw": 135, "horizon_min": 5, "confidence": 0.7 },
  "times_min": [-40.0, -39.83, "..."],
  "frames": [
    { "t": -10.0, "phase": "before",
      "A": [91.7, "..."], "P_bgc": [45.0, "..."], "P_uni": [73.4, "..."], "eta": [2.1, "..."], "coverage": [0.0, "..."],
      "firm": [false, "..."], "q_share": [0.02, "..."],
      "edge": { "lead": [[lon, lat], [lon, lat]], "trail": [[lon, lat], [lon, lat]] },
      "agg": { "A": 3000, "P_base": 3000, "P_uni": 2412, "P_bgc": 2412, "P_star": 2412, "R": 438, "residual": 0 } }
  ],
  "kpis": { "bgc": { "max_drop10_mw": 900, "max_grad_mw_min": 90, "spill_mwh": 305, "spill_before_contact_mwh": 74, "lead_min": 10, "firm_at_contact_mw": 438, "blocks_stepped": 0, "tracking_error_pct": 0.4 }, "uni": { "...": "..." }, "base": { "...": "..." } },
  "notice": { "issued_at_min": -10.0, "valid_from_min": -10.0, "declared": [[t, mw], "..."], "R_declared_mw": 438, "residual_full_cover_mw": 1800, "clauses": ["5.3.8.1(iii)", "4.46.3.2", "2.11.13.11", "5.4.2.3"] },
  "economics": { "spill_sar": 15250, "battery_block_sar_per_year": 120000000, "annual_spill_estimate_mwh": 150000 },
  "classification": "SIMULATION (RASEEN PROTOTYPE)", "disclaimer": "…", "is_live": false
}
```

Sizes: 30 blocks × 841 frames × 7 arrays ≈ 1.2 MB uncompressed; served gzip. Acceptable.

---

## 7. Front-end modules

| Module | Responsibility |
|---|---|
| `app.js` | boot: status, router, sidebar, top bar, theme, presentation mode, banner |
| `store.js` | active plant, active scenario, current frame index, view mode, layer state; pub/sub |
| `api.js` | fetch wrappers with the envelope check (a response without `classification` is an error) |
| `pages/kingdom.js` | Kingdom map, layer panel, KPI strip, plant list |
| `pages/plant.js` | plant facts, satellite/plan/grid toggles, inspector |
| `pages/control.js` | scenario controls, readouts, charts, block gradient, timeline, compare split |
| `pages/declarations.js` | the notice document and ledger |
| `pages/about.js` | what's real table, history, sources |
| `maps/kingdom-map.js` | MapLibre: basemap, plants source/layers, grid source/layers, hover/click |
| `maps/site-map.js` | ported `sitemap.js`: imagery, MVPS, outlines, zones, block hulls coloured by mode, cloud polygon, fly-to, compare pane |
| `maps/site-plan.js` | the SVG fallback: same geometry, same colouring, no tiles |
| `charts.js` | SVG line chart with bands and cursor (from NAJM `drawChart`), block-gradient bars, ramp inset, sparkline |
| `format.js` | numbers with units, clock labels, Arabic/English brand strings |
| `styles.css` | tokens (surfaces, text, series blue/orange, headroom violet, ETA cyan, cloud grey, status amber/red), layout, components, presentation mode |

No framework, no bundler. Modules are ES modules served as-is. MapLibre GL JS is vendored (copied from NAJM-3000). three.js is vendored but loaded only when the optional 3D layer is switched on.

---

## 8. Error handling and fallbacks

- **Tiles or MapLibre unavailable** (offline, WebGL missing): the Plant and Gradient Control pages switch to `site-plan.js` (SVG) automatically and say so in the panel note; the Kingdom page shows the plants and grid over an SVG outline of the Kingdom's bounding region with the same interactions.
- **Scenario request fails**: banner with the API message; the last good scenario stays on screen; controls stay enabled.
- **Invalid parameters**: the API returns 400 with the field and range; the UI clamps sliders to the same ranges so this is unreachable from the controls.
- **Cache miss on the demo machine**: `python -m raseen.scenario --warm` precomputes the rehearsed scenarios (D1 at four gradients, D2, D3, stall, deepen) into `app/.cache/`.
- **No scenario loaded** (Plant page opened first): the map colours from a clear-day frame (all blocks at capacity) and the inspector shows availability only.
- **Reduced motion**: replay and glow honour `prefers-reduced-motion`.

---

## 9. Testing

Backend (`pytest`, coverage target 85 % on `raseen/`):

- geometry: 30 blocks, every MVPS assigned once, deterministic across runs, capacities sum to 3,000 MW, hulls non-degenerate; τ at 48 km/h between 9 and 14 min for headings 0–359°.
- shadow: coverage in [0, 1] and monotone as the edge passes; ETA decreases by exactly Δt between frames; stall freezes the field; deepen scales the floor.
- control: Σ P = P* within 1e-3 MW when feasible; P ≤ A always; per-block slew never exceeded; no block steps at arrival (change ≤ 5 % of block at ETA = 0) for the solid front; the abstract 10 × 3 fixture reproduces the v4 D1 table (65/155/305/605 MWh within ±5 %) and the analytic spill (r − g)·τ·(D/g)/2; plant-level and BGC spill are equal within 1 % for the solid front with the PPC delay set to zero (the concession is a test), and the difference with the default one-step delay is reported, not asserted; reactive shares sum to the Q order and never exceed √(S² − P²).
- scenario: cache hit returns the identical object; parameters outside range raise; every KPI has a unit in its key; the notice carries the clause list and R_declared ≤ min R over the horizon.
- api: envelope on every route; `raseen.api` has no `najm3000` import; unknown plant and scenario give 404; static files served; `/` serves the page with the SIM chip in the HTML.

Front-end (`playwright`, one smoke test, headless Chromium): the page loads; five sidebar tabs switch routes; the Kingdom map container mounts with the plants source; opening NAJM-3000 renders 30 block hulls; posting the default scenario renders the four plant-power numbers with units; scrubbing changes the clock.

---

## 10. Deployment

- `Dockerfile`: `python:3.11-slim`, `pip install .`, `uvicorn raseen.api:app --host 0.0.0.0 --port 8000`, healthcheck on `/api/status`.
- `.github/workflows/deploy-azure.yml`: on push to `main`, build the image, push to GitHub Container Registry, deploy to **Azure Web App for Containers** (Linux, B1) using an Azure publish profile stored as a repository secret. Azure Container Apps is the alternative if B1 proves too small; the workflow change is one job.
- Student pack: Azure for Students credit funds the App Service plan; GitHub Actions minutes are free for public repositories.
- Environment: `RASEEN_SITE_MODE` (real | representative), `RASEEN_CACHE_DIR`, `RASEEN_TILES_SAT` and `RASEEN_TILES_DARK` (tile URL templates, defaulting to Esri imagery and CARTO dark).
- `README.md` in `app/`: local run (`pip install -e .[dev]`, `python -m raseen`), tests, warm cache, deploy.

Repository hygiene: `.gitignore` excludes PDFs, DOCX, `.venv`, caches and `raseen_sim.json`. The full Grid Code reference texts under `references/` stay out of the public repository (they are large conversions of public documents and are not needed at runtime); the first commit contains the spec, the app and the notes.

---

## 11. Open decisions for the project lead

1. **Public exposure of the real geometry.** The Azure deployment will serve the as-designed layout and the site coordinates of a real plant under NDA-derived documents, which the NAJM-3000 policy says must be re-read before publishing. Default here is `real`, as requested, with `representative` one variable away. Decide before the first public deploy.
2. **Plant registry accuracy.** The Kingdom map is compiled from public announcements with town-level coordinates. It is labelled indicative. If the team has a better source (SPPC, K.A.CARE), swap `plants.json`.
3. **Scattered cumulus (D3).** Included as a scenario type because the dissent pass says it is the case that recovers the headline claim. If the shadow generator slips, D1 and D2 ship first and D3 follows.

---

## 12. Delivery order (for the implementation plan)

1. Repository, app skeleton, API envelope, status, tests running, Dockerfile.
2. Geometry and block mapping; `/api/site`; Plant page with satellite map, plan fallback, facts, inspector (no scenario).
3. Shadow fields, controller port, scenario runner, cache, v4 fixture tests; `/api/scenario`.
4. Gradient Control page: controls, map colouring, generation chart, block gradient, KPIs, timeline; then Compare, stall/deepen, economics strip.
5. Declarations page and `/api/notice`.
6. Kingdom page: registry and grid data, map, layer panel, KPIs, list, fly-to plant.
7. About page, what's-real toggle, presentation mode, Playwright smoke test.
8. GitHub Actions and Azure deployment; warm cache; rehearsal checklist.

Steps 2 and 3 are independent and can proceed in parallel.
