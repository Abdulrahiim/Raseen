# Raseen (رَصين) — dashboard

Block Gradient Control for gigawatt solar, built on the NAJM-3000 pre-commissioning twin.

Everything served is **simulated and labelled so**: the plant geometry is as-designed (not
as-built), the controller is real code, and telemetry, forecast and grid interfaces are
simulated. The model is **not calibrated and not validated**.

## The three pages

| Tab | What it shows |
|---|---|
| **Kingdom** | Every Saudi utility-scale renewable project (indicative registry) and the 380 kV transmission backbone (schematic) on a dark map, with layer, technology and status filters. |
| **Plant** | The NAJM-3000 dashboard, reused whole: the 365-station plant on satellite imagery, the real block layout, 3D station drill-down, expected-vs-measured trends, fault injection. |
| **Gradient Control** | A cloud front crosses the plant, block by block. Raseen holds the plant's export to a declared ramp; the map, the generation chart and the 30-block gradient bars update as you play or scrub through the event. |

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

The physics behind the Gradient Control page is the same model as the v4 team document:
`raseen/control` reproduces the abstract design-case D1 numbers exactly (checked in
`tests/test_control.py`), and the trajectory planner starts its descent at the
feasibility-binding point so Raseen holds its declared gradient on the real, concave front.

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

## Deploy (later)

The app is a single container (`Dockerfile`) that runs `uvicorn raseen.webapp:app`. It is
ready to push to any container host — Azure Web App for Containers, or a Vercel/Render-style
service — when you choose to. Nothing here needs a build step or a database.
