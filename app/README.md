# Raseen (رَصين) — dashboard

Block Gradient Control for gigawatt solar, built on the NAJM-3000 pre-commissioning twin.

Everything served is **simulated and labelled so**: the plant geometry is as-designed (not
as-built), the controller is real code, and telemetry, forecast and grid interfaces are
simulated. The model is **not calibrated and not validated**.

## The pages

| Tab | What it shows |
|---|---|
| **Kingdom** | Every Saudi utility-scale renewable project (indicative registry) and the 380 kV transmission backbone (schematic) on a dark map, with layer, technology and status filters. |
| **Plant** | The reference plant in two views. **Supervisory** is the vendored dashboard reused whole: the 363-station plant on satellite imagery, the real block layout, 3D station drill-down, expected-vs-measured trends, fault injection. **Gradient Control** runs a cloud front across the plant block by block while Raseen holds export on one of two strategies — a declared ramp, or a flat pre-hold that the blocks still in sun back-fill; the map, the generation chart and the station/block set-point bars update as you play (at a chosen replay speed, with a forecast briefing and notices) or scrub through the event. The sidebar has an entry for each view, so Gradient Control is reachable directly. Every page has a guided tour (*Explain this page*) and a light/dark theme switch in the top bar. |

## Architecture

Raseen reuses the NAJM-3000 dashboard rather than reimplementing it. The `najm3000`
package (physics engine + SCADA-style dashboard) is vendored under `app/najm3000`; the
`raseen` package adds the block-gradient simulation and the two new pages. One FastAPI app
(`raseen.webapp`) keeps every NAJM-3000 route and serves Raseen's assets at `/rs` and its
API under `/api/rs`.

```
app/
├── najm3000/            vendored: physics engine + the dashboard reused as the Plant page
├── config/              plant configuration (project, equipment, blocks, data sources)
└── raseen/
    ├── geometry/        site.json → 30 control blocks; heading projection
    ├── shadow/          cloud shadow fields (front, thin band, scattered), per-MVPS coverage
    ├── control/         trajectory planner, block allocation (BGC), plant-level scheme, metrics
    ├── scenario/        params → 10-second frames, KPIs, economics; cache; /api/rs/scenario
    ├── registry/        Kingdom plants and grid schematic; /api/rs/plants, /api/rs/grid
    ├── webapp.py        the combined FastAPI app
    └── web/             the sidebar, the Kingdom and Gradient Control pages, charts, maps
```

The physics behind the Gradient Control page lives in `raseen/control`. The trajectory planner
declares a point-of-interconnection line that descends at the declared gradient `g`, reaching
the transit minimum exactly when available power does — so the required lead time is
`L = D/g − τ` for a deficit `D` over a transit `τ`, and the descent starts at the
feasibility-binding point, which is what lets Raseen hold its gradient on a real, concave
front. The block allocator then places the required curtailment by cloud-arrival time, within
each block's slew band. `tests/test_control.py` pins this against the analytic reference case:
the closed-form descent spill `E_down = (r − g)·τ·(D/g)/2`, the tracking error, the gradient
and ten-minute-drop limits, and the rule that no block is ever asked for more than it has.

## Run it

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e ".[dev]"
.venv\Scripts\python.exe -m raseen            # http://127.0.0.1:8000
```

The first request builds the NAJM-3000 simulated adapter (~20 s); after that it is quick.
Open `http://127.0.0.1:8000` — it lands on the Kingdom page; the sidebar switches pages.

## Test

```powershell
.venv\Scripts\python.exe -m pytest        # geometry, shadow, controller, scenario, web app
.venv\Scripts\python.exe -m ruff check raseen tests
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `RASEEN_SITE_MODE` | `real` | `representative` offsets the layout and relabels zones |
| `RASEEN_CACHE_DIR` | `app/.cache` | where computed scenarios are cached |
| `RASEEN_DAY` | `2025-06-21` | the simulated day the Plant page replays |
| `PORT` | `8000` | listening port |

The Kingdom basemap and the Plant satellite view use Esri's keyless tile services and need
internet; both fall back to a drawn plan if tiles or WebGL are unavailable.

## Static build for GitHub Pages

GitHub Pages serves static files only, so `tools/build_static.py` pre-renders the whole
dashboard into `../docs/` — the pages, their assets (with paths rewritten for a project
sub-path), the registry and geometry as JSON, and a "day bundle"
for the Plant page. A small fetch shim (`tools/rs-static-api.js`) answers the reused
NAJM-3000 dashboard's `/api/*` calls from that bundle, so the Plant page runs with no backend
(fault injection is answered from an in-memory registry that lives for the browser session).
The Gradient Control page needs no shim: `raseen/web/engine.js` is a port of the simulation
that runs in the browser, and `tests/test_engine_js.py` holds it to the Python on seven cases
(it needs `node` on the path and is skipped otherwise).

```powershell
.venv\Scripts\python.exe tools\build_static.py          # regenerate ../docs
.venv\Scripts\python.exe -m http.server -d ..\docs      # preview at http://localhost:8000
```

The repository serves `docs/` on the `main` branch as GitHub Pages, so committing a rebuilt
`docs/` and pushing publishes the site. The maps need internet (Esri keyless tiles) and fall
back to a drawn plan otherwise.

## Full live app (optional, later)

For unlimited interactivity (free sliders, live fault injection, the real physics engine) the
app is also a single container (`Dockerfile`) that runs `uvicorn raseen.webapp:app`, ready for
any Python host — Azure Web App for Containers, Render, Railway. Nothing needs a database.
