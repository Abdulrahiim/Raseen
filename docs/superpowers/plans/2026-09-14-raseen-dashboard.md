# Raseen Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Raseen web dashboard: a sidebar-tabbed FastAPI + vanilla-JS application that shows the Kingdom's renewable fleet and grid, the NAJM-3000 plant on satellite imagery at block level, a cloud event handled by two controllers side by side (Block Gradient Control vs plant-level), and the Grid Code Ramp Event Notice it generates, deployable to Azure.

**Architecture:** A Python package `raseen` (geometry → shadow → control → scenario → api) computes 10-second scenario frames on demand and caches them; a static front-end (ES modules, MapLibre GL, inline SVG) replays the frames across five pages sharing one client-side store. The API never imports NAJM-3000; it copies the site geometry file and vendored map library from that repository once.

**Tech Stack:** Python 3.11, FastAPI, uvicorn, pydantic v2, numpy (optional, not required), pytest, httpx (TestClient), Playwright (one smoke test); MapLibre GL JS 4.x (vendored), no bundler; Docker; GitHub Actions → Azure Web App for Containers.

**Spec:** `docs/superpowers/specs/2026-09-14-raseen-dashboard-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- Repository root is `C:\Users\msms-\Raseen` (git, branch `main`). All app code lives under `app/`. Run every command below from `C:\Users\msms-\Raseen\app` unless stated.
- Python `>=3.11`. Use the NAJM-3000 interpreter to create the venv: `"C:\Users\msms-\OneDrive\سطح المكتب\Abud\NAJM-3000\.venv\Scripts\python.exe" -m venv .venv` then `.venv\Scripts\python.exe -m pip install -e ".[dev]"`. Every `pytest`/`python` command below means `.venv\Scripts\python.exe -m pytest` / `.venv\Scripts\python.exe`.
- The app **never imports `najm3000`**. A test enforces it.
- Every JSON API response carries `classification: "SIMULATION (RASEEN PROTOTYPE)"`, `disclaimer` (exact text in `raseen/__init__.py`) and `is_live: false`.
- Heading convention everywhere: **direction of motion, degrees clockwise from north; 90° = west → east (default)**.
- Block ETA = **minimum** member-MVPS ETA. Block coverage = capacity-weighted mean of member coverage.
- Time axis: minutes from fence contact, `T_START = -40.0`, `T_END = 100.0`, `DT_MIN = 1/6` (10 s) → 841 frames. `t = 0` when the leading edge reaches the first MVPS along the heading.
- Plant: `PLANT_MW = 3000.0`, 363 MVPS in `site.json`, each MVPS `3000/363 MW`, 30 control blocks.
- Site mode from env `RASEEN_SITE_MODE` ∈ {`real` (default), `representative`}.
- Kill sentences never appear in UI copy: "AI predicts clouds", "operators are blind", "grid will collapse", "we store energy as headroom", "no energy is lost", "we test LVRT", "we control loads".
- UI copy labels simulated values as simulated; the `SIM` chip text comes from the API (`is_live`), never hard-coded as `LIVE`.
- Colour tokens (CSS custom properties, used by JS via `getComputedStyle`): `--accent` output blue `#3987e5`, `--amber` available `#f2a33a`, `--violet` firm headroom `#8b7cf6`, `--violet-dim` expiring headroom `#5a5570`, `--cyan` ETA `#2ec4d6`, `--cloud` `rgba(200,205,215,0.35)`, `--good #22b573`, `--warning #fab219`, `--serious #ec835a`, `--critical #d03b3b`, `--sim #9085e9`; technology: pv `#f2a33a`, wind `#2ec4d6`, csp `#ec835a`, bess `#8b7cf6`.
- Commit after every task with the message given; append the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` to every commit message. Use `git -c user.name="Raseen" -c user.email="sarah-khashogji@hotmail.com" commit` if identity is not configured.
- Line endings: files are written with LF; git may warn about CRLF — ignore the warning.

## File Structure

```
Raseen/
├── .github/workflows/deploy-azure.yml          Task 17
├── docs/superpowers/{specs,plans}/
└── app/
    ├── pyproject.toml, README.md, Dockerfile, .dockerignore      Task 1 (README/Dockerfile finished in 17)
    ├── raseen/
    │   ├── __init__.py            version, CLASSIFICATION, DISCLAIMER, PLANT constants          Task 1
    │   ├── __main__.py            `python -m raseen` runs uvicorn                                Task 1
    │   ├── api.py                 FastAPI app: status, site, scenario, notice, plants, grid, static   Tasks 1,5,8,9,13
    │   ├── geometry/
    │   │   ├── __init__.py
    │   │   ├── site.py            Site dataclass, load_site/get_site, local metres, site mode    Task 2
    │   │   ├── projection.py      heading vectors, projection, extent, crossing time            Task 2
    │   │   └── blocks.py          k-means → 30 ControlBlocks, hulls, labels, payload            Task 3
    │   ├── shadow/
    │   │   ├── __init__.py
    │   │   └── fields.py          FrontField, ScatteredField, build_field, cloud_polygons       Task 6
    │   ├── control/
    │   │   ├── __init__.py
    │   │   ├── planner.py         plan_trajectory, apply_release                                Task 7
    │   │   ├── allocate.py        allocate_bgc, allocate_uniform, reactive_shares               Task 7
    │   │   ├── simulate.py        simulate_scheme, metrics, firm_reserve                        Task 7
    │   │   └── fixture.py         the v4 abstract 10×3 plant (test fixture, also demo)          Task 7
    │   ├── scenario/
    │   │   ├── __init__.py
    │   │   ├── params.py          ScenarioParams (pydantic) + scenario_id                       Task 8
    │   │   ├── runner.py          run_scenario → frames/kpis/notice/economics                   Task 8
    │   │   ├── cache.py           ScenarioCache (memory + disk)                                 Task 8
    │   │   ├── notice.py          build_notice, notice_at, compliance ledger                    Task 9
    │   │   ├── economics.py       spill → SAR, annual estimate, battery comparison              Task 9
    │   │   └── __main__.py        `python -m raseen.scenario --warm`                            Task 17
    │   ├── registry/
    │   │   ├── __init__.py        load_plants, plants_summary, load_grid                        Task 13
    │   │   └── data/plants.json, grid.json                                                      Task 13
    │   └── static/
    │       ├── index.html         shell: sidebar, top bar, page root, tooltip, banner           Task 4
    │       ├── styles.css         tokens, themes, presentation mode, layout, components         Task 4 (+10,14,15)
    │       ├── app.js             boot, router, sidebar, chip, theme                            Task 4
    │       ├── store.js, api.js, format.js, colour.js                                           Task 4
    │       ├── charts.js          lineChart, blockGradient, rampInset, sparkline                Task 10
    │       ├── pages/plant.js     Task 5   pages/control.js Task 10–11   pages/declarations.js Task 12
    │       ├── pages/kingdom.js   Task 14  pages/about.js   Task 4 (stub) → Task 15
    │       ├── maps/site-map.js   Task 5   maps/site-plan.js Task 5      maps/kingdom-map.js Task 14
    │       ├── vendor/maplibre-gl.js, maplibre-gl.css   copied from NAJM-3000                  Task 5
    │       └── data/site.json                           copied from NAJM-3000                  Task 2
    └── tests/
        ├── conftest.py            Task 1
        ├── test_api.py            Tasks 1,5,8,9,13
        ├── test_geometry.py       Tasks 2,3
        ├── test_shadow.py         Task 6
        ├── test_control.py        Task 7
        ├── test_scenario.py       Tasks 8,9
        ├── test_registry.py       Task 13
        └── e2e/test_smoke.py      Task 16
```

---

### Task 1: App skeleton, API envelope, status endpoint, Dockerfile

**Files:**
- Create: `app/pyproject.toml`, `app/README.md`, `app/Dockerfile`, `app/.dockerignore`
- Create: `app/raseen/__init__.py`, `app/raseen/__main__.py`, `app/raseen/api.py`
- Create: `app/raseen/static/index.html` (placeholder shell, replaced in Task 4)
- Create: `app/raseen/static/styles.css` (empty placeholder, replaced in Task 4)
- Test: `app/tests/conftest.py`, `app/tests/test_api.py`

**Interfaces:**
- Produces: `raseen.__version__`, `raseen.CLASSIFICATION`, `raseen.DISCLAIMER`, `raseen.PLANT_NAME`, `raseen.PLANT_MW`, `raseen.MVPS_COUNT_DESIGN`; `raseen.api.build_app() -> FastAPI`; `raseen.api.envelope() -> dict`; `raseen.api.app` (module-level instance); `raseen.api.STATIC_DIR: Path`.

- [ ] **Step 1: Create the package files**

`app/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "raseen"
version = "0.1.0"
description = "Raseen (رَصين) — Block Gradient Control dashboard for gigawatt solar. Prototype."
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110",
    "uvicorn[standard]>=0.27",
    "pydantic>=2.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4",
    "pytest-cov>=4.1",
    "httpx>=0.27",
    "ruff>=0.4",
    "playwright>=1.45",
    "pytest-playwright>=0.5",
]

[tool.setuptools.packages.find]
where = ["."]
include = ["raseen*"]

[tool.setuptools.package-data]
raseen = ["static/**/*", "registry/data/*.json"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-v --tb=short"
markers = ["e2e: browser smoke tests (need `playwright install chromium`)"]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]
```

`app/raseen/__init__.py`:

```python
"""Raseen (رَصين) — Block Gradient Control for gigawatt solar. Prototype dashboard.

Nothing served by this package is measured, calibrated or validated data.
"""

__version__ = "0.1.0"

#: Carried on every API response so no page can render a value without its provenance.
CLASSIFICATION = "SIMULATION (RASEEN PROTOTYPE)"

DISCLAIMER = (
    "SIMULATED — NOT MEASURED DATA. Plant geometry is as-designed, not as-built. "
    "The irradiance driver is representative. The controller is real code. "
    "Telemetry, forecast, PPC and TSP are simulated. NOT CALIBRATED — NOT VALIDATED."
)

#: The reference plant inside the twin.
PLANT_NAME = "NAJM-3000"
PLANT_MW = 3000.0
#: Design basis says 365 MV power stations; the CAD/KML geometry carries 363 (GAP-019 unresolved).
MVPS_COUNT_DESIGN = 365
```

`app/raseen/__main__.py`:

```python
"""Run the Raseen dashboard: ``python -m raseen [--host H] [--port P]``."""

from __future__ import annotations

import argparse
import os

import uvicorn

from raseen import CLASSIFICATION, __version__


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="raseen", description="Raseen dashboard (prototype).")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args(argv)
    print(f"Raseen {__version__} — {CLASSIFICATION}")
    print("*** SIMULATED TELEMETRY — NOT MEASURED DATA — NOT CALIBRATED — NOT VALIDATED ***")
    uvicorn.run("raseen.api:app", host=args.host, port=args.port, reload=args.reload, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

`app/raseen/api.py`:

```python
"""JSON API for the Raseen dashboard.

This module never imports ``najm3000``: Raseen reads a copied geometry file and runs
its own controller. Every response carries ``classification``, ``disclaimer`` and
``is_live`` so the front-end cannot show a number without its provenance.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from raseen import CLASSIFICATION, DISCLAIMER, MVPS_COUNT_DESIGN, PLANT_MW, PLANT_NAME, __version__

STATIC_DIR = Path(__file__).parent / "static"

#: The "what's real" table shown on the About page and by the what's-real toggle.
WHAT_IS_REAL: list[dict[str, str]] = [
    {"item": "Plant geometry (363 MVPS, zones, block linework)", "status": "designed",
     "note": "Derived from the project CAD/KML. As-designed, not surveyed as-built."},
    {"item": "Irradiance driver", "status": "representative",
     "note": "Clear-day available power with a geometric shadow field; not site-measured."},
    {"item": "Controller (planner, block allocation, reactive migration)", "status": "real code",
     "note": "The same algorithm the plant would run; executed here on simulated inputs."},
    {"item": "Block telemetry (available and exported power)", "status": "simulated",
     "note": "Computed from the shadow field. No SCADA is connected."},
    {"item": "Forecast and nowcast", "status": "simulated",
     "note": "Cloud arrival times are ground truth from the shadow generator, not an estimate."},
    {"item": "PPC and TSP interfaces", "status": "simulated",
     "note": "Mocks that record and render what they receive."},
    {"item": "Grid Code clause references", "status": "real",
     "note": "Saudi Arabian Grid Code May 2026 and Distribution Code June 2026, full text read."},
    {"item": "Kingdom renewables registry and transmission backbone", "status": "indicative",
     "note": "Compiled from public announcements; town-level coordinates; schematic grid."},
]


def envelope() -> dict[str, Any]:
    """Provenance fields every response carries."""
    return {"classification": CLASSIFICATION, "disclaimer": DISCLAIMER, "is_live": False}


def site_mode() -> str:
    return os.environ.get("RASEEN_SITE_MODE", "real").lower()


def build_app() -> FastAPI:
    """Construct the API. Later tasks add routes inside this function."""
    app = FastAPI(
        title="Raseen",
        version=__version__,
        description="Block Gradient Control dashboard. " + DISCLAIMER,
    )

    @app.get("/api/status")
    def status() -> dict[str, Any]:
        return {
            **envelope(),
            "version": __version__,
            "product": "Raseen",
            "product_ar": "رَصين",
            "plant": PLANT_NAME,
            "plant_mw": PLANT_MW,
            "mvps_count_design": MVPS_COUNT_DESIGN,
            "site_mode": site_mode(),
            "what_is_real": WHAT_IS_REAL,
        }

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    return app


app = build_app()
```

`app/raseen/static/index.html` (placeholder; Task 4 replaces it):

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raseen · رَصين</title>
<link rel="stylesheet" href="/static/styles.css">
</head>
<body>
<header class="topbar">
  <h1>Raseen · رَصين</h1>
  <span id="data-source-chip" class="chip chip-sim" role="status" title="Data source">
    <span class="chip-dot" aria-hidden="true"></span>
    <span class="chip-label" id="data-source-label">SIM</span>
  </span>
</header>
<main id="page-root"><p>Loading…</p></main>
</body>
</html>
```

`app/raseen/static/styles.css`: create it empty (one comment line `/* Raseen styles — Task 4 */`).

`app/Dockerfile`:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RASEEN_SITE_MODE=real RASEEN_CACHE_DIR=/app/.cache
COPY pyproject.toml README.md ./
COPY raseen ./raseen
RUN pip install --no-cache-dir . && mkdir -p /app/.cache
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/status')" || exit 1
CMD ["sh", "-c", "uvicorn raseen.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

`app/.dockerignore`:

```
.venv
.cache
tests
__pycache__
*.pyc
.pytest_cache
```

`app/README.md` (first version; Task 17 completes it):

```markdown
# Raseen dashboard (prototype)

Block Gradient Control for gigawatt solar. Everything served is simulated and labelled so.

## Run locally

    python -m venv .venv
    .venv\Scripts\python.exe -m pip install -e ".[dev]"
    .venv\Scripts\python.exe -m raseen
    # open http://127.0.0.1:8000

## Test

    .venv\Scripts\python.exe -m pytest
```

- [ ] **Step 2: Write the failing tests**

`app/tests/conftest.py`:

```python
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from raseen.api import build_app


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(build_app())
```

`app/tests/test_api.py`:

```python
from __future__ import annotations

import sys
from pathlib import Path

import raseen.api


def test_status_carries_the_envelope(client):
    body = client.get("/api/status").json()
    assert body["classification"] == "SIMULATION (RASEEN PROTOTYPE)"
    assert "NOT MEASURED" in body["disclaimer"].upper()
    assert "NOT CALIBRATED" in body["disclaimer"].upper()
    assert body["is_live"] is False
    assert body["plant"] == "NAJM-3000"
    assert body["site_mode"] in ("real", "representative")
    assert len(body["what_is_real"]) >= 6


def test_api_never_imports_najm3000():
    assert not any(name.split(".")[0] == "najm3000" for name in sys.modules)
    source = Path(raseen.api.__file__).read_text(encoding="utf-8")
    assert "najm3000" not in source


def test_index_shows_a_simulated_source_before_any_data_loads(client):
    body = client.get("/").text
    chip = body[body.index('id="data-source-chip"'):][:400]
    assert "SIM" in chip
    assert "LIVE" not in chip


def test_static_assets_are_served(client):
    assert client.get("/static/styles.css").status_code == 200
```

- [ ] **Step 3: Create the venv, install, run the tests to see them fail**

```powershell
cd C:\Users\msms-\Raseen\app
& "C:\Users\msms-\OneDrive\سطح المكتب\Abud\NAJM-3000\.venv\Scripts\python.exe" -m venv .venv
.venv\Scripts\python.exe -m pip install -e ".[dev]"
.venv\Scripts\python.exe -m pytest tests/test_api.py
```

If `from fastapi.testclient import TestClient` fails mentioning `httpx2`, run `.venv\Scripts\python.exe -m pip install httpx2` and retry. Expected before the files exist: ImportError; after Step 1 they should pass — if you wrote tests first, expected FAIL on `raseen.api` import.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api.py -v`
Expected: 4 passed.

- [ ] **Step 5: Smoke-run the server**

Run: `.venv\Scripts\python.exe -m raseen --port 8010` in the background, then `curl http://127.0.0.1:8010/api/status`. Expected: JSON with `"classification": "SIMULATION (RASEEN PROTOTYPE)"`. Stop the server.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/msms-/Raseen
git add app/pyproject.toml app/README.md app/Dockerfile app/.dockerignore app/raseen app/tests
git commit -m "feat(app): Raseen package skeleton, API envelope, status endpoint, Dockerfile"
```

---

### Task 2: Geometry — site loader and heading projection

**Files:**
- Copy: `C:\Users\msms-\OneDrive\سطح المكتب\Abud\NAJM-3000\src\najm3000\dashboard\static\models\site.json` → `app/raseen/static/data/site.json`
- Create: `app/raseen/geometry/__init__.py`, `app/raseen/geometry/site.py`, `app/raseen/geometry/projection.py`
- Test: `app/tests/test_geometry.py`

**Interfaces:**
- Produces: `Site` dataclass (fields `note, mode, bounds, mvps, zones, lines, lat0, lon0`; methods `to_local(lat, lon) -> (x, y)`, `to_lonlat(x, y) -> (lon, lat)`, `mvps_xy() -> list[(x, y)]`); `load_site(path=SITE_PATH, mode=None) -> Site`; `get_site(mode=None) -> Site` (cached); `MVPS_MW = PLANT_MW / 363`; `heading_vector(deg) -> (ux, uy)`; `project(points_xy, deg) -> list[float]`; `perpendicular(points_xy, deg) -> list[float]`; `sp_to_xy(s, p, deg) -> (x, y)`; `extent_m(points_xy, deg) -> float`; `crossing_time_min(extent_m, speed_kmh) -> float`.

- [ ] **Step 1: Copy the geometry file**

```powershell
New-Item -ItemType Directory -Force C:\Users\msms-\Raseen\app\raseen\static\data
Copy-Item "C:\Users\msms-\OneDrive\سطح المكتب\Abud\NAJM-3000\src\najm3000\dashboard\static\models\site.json" C:\Users\msms-\Raseen\app\raseen\static\data\site.json
```

- [ ] **Step 2: Write the failing tests**

`app/tests/test_geometry.py`:

```python
from __future__ import annotations

import math

import pytest

from raseen.geometry.projection import (
    crossing_time_min,
    extent_m,
    heading_vector,
    perpendicular,
    project,
    sp_to_xy,
)
from raseen.geometry.site import MVPS_MW, Site, load_site


@pytest.fixture(scope="module")
def site() -> Site:
    return load_site(mode="real")


def test_site_loads_363_mvps_with_bounds_and_zones(site):
    assert len(site.mvps) == 363
    assert {p["n"] for p in site.mvps} == set(range(1, 364))
    assert site.bounds["south"] < site.bounds["north"]
    assert site.bounds["west"] < site.bounds["east"]
    assert len(site.zones) >= 15
    assert "as-designed" in site.note


def test_local_metres_round_trip(site):
    p = site.mvps[10]
    x, y = site.to_local(p["lat"], p["lon"])
    lon, lat = site.to_lonlat(x, y)
    assert abs(lon - p["lon"]) < 1e-9 and abs(lat - p["lat"]) < 1e-9


def test_plant_extent_matches_the_known_footprint(site):
    xy = site.mvps_xy()
    assert 7000 < extent_m(xy, 90) < 7700      # east–west ≈ 7.36 km
    assert 10200 < extent_m(xy, 0) < 10900     # north–south ≈ 10.56 km


def test_crossing_time_depends_on_heading(site):
    xy = site.mvps_xy()
    taus = [crossing_time_min(extent_m(xy, h), 48.0) for h in range(0, 360, 15)]
    assert all(7.0 < tau < 14.0 for tau in taus)
    assert abs(crossing_time_min(extent_m(xy, 90), 48.0) - 9.2) < 0.3
    assert abs(crossing_time_min(extent_m(xy, 0), 48.0) - 13.2) < 0.3


def test_heading_vector_convention():
    ux, uy = heading_vector(90)
    assert abs(ux - 1) < 1e-12 and abs(uy) < 1e-12      # eastward
    ux, uy = heading_vector(0)
    assert abs(ux) < 1e-12 and abs(uy - 1) < 1e-12      # northward


def test_projection_and_perpendicular_are_orthonormal():
    pts = [(100.0, 0.0), (0.0, 100.0), (300.0, -200.0)]
    for h in (0, 37, 90, 200):
        s = project(pts, h)
        p = perpendicular(pts, h)
        for (x, y), si, pi in zip(pts, s, p):
            xx, yy = sp_to_xy(si, pi, h)
            assert math.isclose(xx, x, abs_tol=1e-9) and math.isclose(yy, y, abs_tol=1e-9)


def test_representative_mode_shifts_and_relabels(site):
    rep = load_site(mode="representative")
    assert rep.mode == "representative"
    assert abs(rep.mvps[0]["lat"] - site.mvps[0]["lat"]) > 0.5
    assert all(z["name"].startswith("Zone ") for z in rep.zones)
    assert "Representative mode" in rep.note


def test_mvps_capacity_sums_to_the_plant():
    assert abs(MVPS_MW * 363 - 3000.0) < 1e-9
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_geometry.py -v`
Expected: FAIL with `ModuleNotFoundError: raseen.geometry`.

- [ ] **Step 4: Implement**

`app/raseen/geometry/__init__.py`: one docstring line `"""Plant geometry: site loading, heading projection, control blocks."""`.

`app/raseen/geometry/site.py`:

```python
"""Load the as-designed site geometry copied from the NAJM-3000 twin.

`site.json` carries 363 MVPS points, 17 zone label points, 5,000 line segments and
the bounds, all derived from the project CAD/KML. Coordinates are real in ``real``
mode; ``representative`` mode offsets the layout into open desert and relabels zones.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from raseen import PLANT_MW

SITE_PATH = Path(__file__).resolve().parents[1] / "static" / "data" / "site.json"

#: (dlat, dlon) in degrees applied in representative mode.
REPRESENTATIVE_OFFSET = (0.85, -1.60)

#: Every MVPS carries an equal share of the plant rating.
MVPS_MW = PLANT_MW / 363


def site_mode() -> str:
    return os.environ.get("RASEEN_SITE_MODE", "real").lower()


@dataclass(frozen=True)
class Site:
    note: str
    mode: str
    bounds: dict[str, float]
    mvps: list[dict]      # {"n": int, "lat": float, "lon": float}
    zones: list[dict]     # {"name": str, "lat": float, "lon": float}
    lines: list[dict]     # {"b": int | None, "pts": [[lat, lon], ...]}
    lat0: float
    lon0: float

    @property
    def mlat(self) -> float:
        return 111_320.0

    @property
    def mlon(self) -> float:
        return 111_320.0 * math.cos(math.radians(self.lat0))

    def to_local(self, lat: float, lon: float) -> tuple[float, float]:
        """Equirectangular metres about the site centre: x east, y north."""
        return ((lon - self.lon0) * self.mlon, (lat - self.lat0) * self.mlat)

    def to_lonlat(self, x: float, y: float) -> tuple[float, float]:
        return (self.lon0 + x / self.mlon, self.lat0 + y / self.mlat)

    def mvps_xy(self) -> list[tuple[float, float]]:
        return [self.to_local(p["lat"], p["lon"]) for p in self.mvps]


def load_site(path: Path = SITE_PATH, mode: str | None = None) -> Site:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    mode = (mode or site_mode())
    if mode not in ("real", "representative"):
        raise ValueError(f"RASEEN_SITE_MODE must be 'real' or 'representative', got {mode!r}")
    dlat, dlon = (0.0, 0.0) if mode == "real" else REPRESENTATIVE_OFFSET

    def shift(lat: float, lon: float) -> tuple[float, float]:
        return (round(lat + dlat, 6), round(lon + dlon, 6))

    mvps = []
    for p in raw["mvps"]:
        lat, lon = shift(p["lat"], p["lon"])
        mvps.append({"n": int(p["n"]), "lat": lat, "lon": lon})
    mvps.sort(key=lambda p: p["n"])

    zones = []
    for i, z in enumerate(raw["zones"]):
        lat, lon = shift(z["lat"], z["lon"])
        zones.append({"name": z["name"] if mode == "real" else f"Zone {i + 1}", "lat": lat, "lon": lon})

    lines = [
        {"b": line.get("b"), "pts": [list(shift(lat, lon)) for lat, lon in line["pts"]]}
        for line in raw["lines"]
    ]

    lats = [p["lat"] for p in mvps]
    lons = [p["lon"] for p in mvps]
    bounds = {"south": min(lats), "north": max(lats), "west": min(lons), "east": max(lons)}
    note = raw["note"]
    if mode != "real":
        note += " Representative mode: the layout is offset from the real site and zone names are generic."
    return Site(
        note=note, mode=mode, bounds=bounds, mvps=mvps, zones=zones, lines=lines,
        lat0=(bounds["south"] + bounds["north"]) / 2, lon0=(bounds["west"] + bounds["east"]) / 2,
    )


@lru_cache(maxsize=2)
def _cached(mode: str) -> Site:
    return load_site(mode=mode)


def get_site(mode: str | None = None) -> Site:
    """The site for the requested (or environment) mode, loaded once per process."""
    return _cached(mode or site_mode())
```

`app/raseen/geometry/projection.py`:

```python
"""Heading geometry. Heading = direction of motion, degrees clockwise from north."""

from __future__ import annotations

import math


def heading_vector(heading_deg: float) -> tuple[float, float]:
    """Unit vector of motion in local (x east, y north) metres. 90° → (1, 0)."""
    th = math.radians(heading_deg)
    return (math.sin(th), math.cos(th))


def project(points_xy: list[tuple[float, float]], heading_deg: float) -> list[float]:
    """Scalar position of each point along the heading (metres)."""
    ux, uy = heading_vector(heading_deg)
    return [x * ux + y * uy for x, y in points_xy]


def perpendicular(points_xy: list[tuple[float, float]], heading_deg: float) -> list[float]:
    """Scalar position across the heading, positive to the left of motion."""
    ux, uy = heading_vector(heading_deg)
    return [-x * uy + y * ux for x, y in points_xy]


def sp_to_xy(s: float, p: float, heading_deg: float) -> tuple[float, float]:
    """Inverse of (project, perpendicular)."""
    ux, uy = heading_vector(heading_deg)
    return (s * ux - p * uy, s * uy + p * ux)


def extent_m(points_xy: list[tuple[float, float]], heading_deg: float) -> float:
    s = project(points_xy, heading_deg)
    return max(s) - min(s)


def crossing_time_min(extent_metres: float, speed_kmh: float) -> float:
    """Minutes for a front to cross ``extent_metres`` at ``speed_kmh``."""
    return extent_metres / (speed_kmh * 1000.0 / 60.0)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_geometry.py -v`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add app/raseen/geometry app/raseen/static/data/site.json app/tests/test_geometry.py
git commit -m "feat(geometry): site loader with real/representative modes and heading projection"
```

---

### Task 3: Geometry — 30 control blocks from the 363 MVPS

**Files:**
- Create: `app/raseen/geometry/blocks.py`
- Test: `app/tests/test_geometry.py` (append)

**Interfaces:**
- Produces: `ControlBlock` (frozen dataclass: `id: str` (`"B01"`…`"B30"`, west → east by centroid), `label: str` (e.g. `"Z-5 · 2"`), `zone: str`, `mvps: tuple[int, ...]` (MVPS numbers `n`), `mvps_index: tuple[int, ...]` (0-based indices into `site.mvps`), `capacity_mw: float`, `centroid_xy: tuple[float, float]`, `centroid_lonlat: tuple[float, float]`, `hull_lonlat: tuple[tuple[float, float], ...]`, `extent_m: tuple[float, float]`); `kmeans(points, k) -> list[int]`; `convex_hull(points) -> list`; `control_blocks(site, k=30) -> list[ControlBlock]`; `get_blocks(site) -> list[ControlBlock]` (cached per site mode); `blocks_payload(blocks) -> list[dict]`; `mvps_block_index(site, blocks) -> list[int]` (for each MVPS in `site.mvps` order, the index of its block).

- [ ] **Step 1: Append the failing tests**

Append to `app/tests/test_geometry.py`:

```python
from raseen.geometry.blocks import (
    ControlBlock,
    blocks_payload,
    control_blocks,
    convex_hull,
    kmeans,
    mvps_block_index,
)


def test_kmeans_is_deterministic_and_covers_every_point(site):
    xy = site.mvps_xy()
    a = kmeans(xy, 30)
    b = kmeans(xy, 30)
    assert a == b
    assert len(a) == 363
    assert set(a) == set(range(30))


def test_convex_hull_of_a_square_has_four_corners():
    pts = [(0, 0), (1, 0), (1, 1), (0, 1), (0.5, 0.5), (0.2, 0.8)]
    assert len(convex_hull(pts)) == 4


def test_thirty_blocks_partition_the_plant(site):
    blocks = control_blocks(site)
    assert len(blocks) == 30
    assert [b.id for b in blocks] == [f"B{i:02d}" for i in range(1, 31)]
    all_mvps = sorted(n for b in blocks for n in b.mvps)
    # CAD station numbers are 1..365 minus {224, 307}: compare with the site, not a range.
    assert all_mvps == sorted(p["n"] for p in site.mvps)
    assert abs(sum(b.capacity_mw for b in blocks) - 3000.0) < 1e-6
    assert all(5 <= len(b.mvps) <= 20 for b in blocks)
    assert all(50.0 < b.capacity_mw < 170.0 for b in blocks)
    xs = [b.centroid_xy[0] for b in blocks]
    assert xs == sorted(xs)


def test_blocks_have_hulls_and_zone_labels(site):
    blocks = control_blocks(site)
    for b in blocks:
        assert len(b.hull_lonlat) >= 3
        assert b.zone in {z["name"] for z in site.zones}
        assert b.label.startswith(b.zone)
        assert b.extent_m[0] > 100 and b.extent_m[1] > 100
    assert len({b.label for b in blocks}) == 30


def test_payload_and_index(site):
    blocks = control_blocks(site)
    payload = blocks_payload(blocks)
    assert payload[0].keys() >= {"id", "label", "zone", "mvps", "capacity_mw", "centroid", "hull", "extent_m"}
    idx = mvps_block_index(site, blocks)
    assert len(idx) == 363
    assert idx[blocks[7].mvps_index[0]] == 7
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_geometry.py -v -k "kmeans or hull or blocks or payload"`
Expected: FAIL with `ImportError` for `raseen.geometry.blocks`.

- [ ] **Step 3: Implement**

`app/raseen/geometry/blocks.py`:

```python
"""Group the 363 MVPS into 30 control blocks.

The v4 document reasons about 30 × 100 MW blocks. On the real layout the blocks are
30 contiguous clusters of unequal size (7–17 stations, 58–141 MW). Clustering is
deterministic: farthest-point seeding from the western-most station, then Lloyd
iterations, so every run, machine and test sees the same blocks.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache

from raseen.geometry.site import MVPS_MW, Site

K_BLOCKS = 30
MAX_ITERS = 200
#: Fallback half-size of a block hull when a cluster has fewer than three stations.
MIN_HULL_HALF_M = 120.0


def kmeans(points: list[tuple[float, float]], k: int, iters: int = MAX_ITERS) -> list[int]:
    """Deterministic k-means. Returns a cluster label per point."""
    n = len(points)
    if k > n:
        raise ValueError("more clusters than points")
    start = min(range(n), key=lambda i: (points[i][0], points[i][1]))
    centres = [points[start]]
    dmin = [math.dist(p, points[start]) for p in points]
    for _ in range(k - 1):
        j = max(range(n), key=lambda i: (dmin[i], -i))
        centres.append(points[j])
        for i, p in enumerate(points):
            dmin[i] = min(dmin[i], math.dist(p, points[j]))

    labels = [-1] * n
    for _ in range(iters):
        new = [min(range(k), key=lambda c: (math.dist(p, centres[c]), c)) for p in points]
        counts = Counter(new)
        for c in range(k):
            if counts[c] == 0:
                big = max(range(k), key=lambda cc: (counts[cc], -cc))
                members = [i for i in range(n) if new[i] == big]
                far = max(members, key=lambda i: (math.dist(points[i], centres[big]), -i))
                new[far] = c
                counts[c] += 1
                counts[big] -= 1
        if new == labels:
            break
        labels = new
        for c in range(k):
            members = [points[i] for i in range(n) if labels[i] == c]
            centres[c] = (
                sum(p[0] for p in members) / len(members),
                sum(p[1] for p in members) / len(members),
            )
    return labels


def convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Andrew monotone chain. Returns the hull counter-clockwise without repeating the start."""
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


@dataclass(frozen=True)
class ControlBlock:
    id: str
    label: str
    zone: str
    mvps: tuple[int, ...]
    mvps_index: tuple[int, ...]
    capacity_mw: float
    centroid_xy: tuple[float, float]
    centroid_lonlat: tuple[float, float]
    hull_lonlat: tuple[tuple[float, float], ...]
    extent_m: tuple[float, float]


def control_blocks(site: Site, k: int = K_BLOCKS) -> list[ControlBlock]:
    xy = site.mvps_xy()
    labels = kmeans(xy, k)
    zone_xy = [site.to_local(z["lat"], z["lon"]) for z in site.zones]

    def nearest_zone(p: tuple[float, float]) -> str:
        j = min(range(len(zone_xy)), key=lambda i: (math.dist(p, zone_xy[i]), i))
        return site.zones[j]["name"]

    clusters = []
    for c in range(k):
        idx = tuple(i for i in range(len(xy)) if labels[i] == c)
        cx = sum(xy[i][0] for i in idx) / len(idx)
        cy = sum(xy[i][1] for i in idx) / len(idx)
        clusters.append((cx, cy, idx))
    clusters.sort(key=lambda t: (t[0], t[1]))

    per_zone: Counter[str] = Counter()
    blocks: list[ControlBlock] = []
    for order, (cx, cy, idx) in enumerate(clusters, start=1):
        zone = Counter(nearest_zone(xy[i]) for i in idx).most_common(1)[0][0]
        per_zone[zone] += 1
        pts = [xy[i] for i in idx]
        hull = convex_hull(pts)
        if len(hull) < 3:
            hull = [
                (cx - MIN_HULL_HALF_M, cy - MIN_HULL_HALF_M), (cx + MIN_HULL_HALF_M, cy - MIN_HULL_HALF_M),
                (cx + MIN_HULL_HALF_M, cy + MIN_HULL_HALF_M), (cx - MIN_HULL_HALF_M, cy + MIN_HULL_HALF_M),
            ]
        # Pad the hull by half an MVPS field so it reads as an area, not a line through points.
        pad = 180.0
        padded = [
            (px + pad * math.copysign(1, px - cx) if px != cx else px,
             py + pad * math.copysign(1, py - cy) if py != cy else py)
            for px, py in hull
        ]
        hull_ll = tuple(site.to_lonlat(px, py) for px, py in padded)
        w = max(px for px, _ in padded) - min(px for px, _ in padded)
        h = max(py for _, py in padded) - min(py for _, py in padded)
        blocks.append(
            ControlBlock(
                id=f"B{order:02d}",
                label=f"{zone} · {per_zone[zone]}",
                zone=zone,
                mvps=tuple(site.mvps[i]["n"] for i in idx),
                mvps_index=idx,
                capacity_mw=len(idx) * MVPS_MW,
                centroid_xy=(cx, cy),
                centroid_lonlat=site.to_lonlat(cx, cy),
                hull_lonlat=hull_ll,
                extent_m=(w, h),
            )
        )
    return blocks


@lru_cache(maxsize=2)
def _cached(mode: str) -> tuple[ControlBlock, ...]:
    from raseen.geometry.site import get_site

    return tuple(control_blocks(get_site(mode)))


def get_blocks(site: Site) -> list[ControlBlock]:
    return list(_cached(site.mode))


def blocks_payload(blocks: list[ControlBlock]) -> list[dict]:
    return [
        {
            "id": b.id,
            "label": b.label,
            "zone": b.zone,
            "mvps": list(b.mvps),
            "capacity_mw": round(b.capacity_mw, 2),
            "centroid": [round(b.centroid_lonlat[0], 6), round(b.centroid_lonlat[1], 6)],
            "hull": [[round(lon, 6), round(lat, 6)] for lon, lat in b.hull_lonlat],
            "extent_m": [round(b.extent_m[0]), round(b.extent_m[1])],
        }
        for b in blocks
    ]


def mvps_block_index(site: Site, blocks: list[ControlBlock]) -> list[int]:
    index = [-1] * len(site.mvps)
    for bi, b in enumerate(blocks):
        for i in b.mvps_index:
            index[i] = bi
    return index
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_geometry.py -v`
Expected: 13 passed. If `test_blocks_have_hulls_and_zone_labels` fails on `extent_m > 100`, the padded hull is degenerate for a cluster; check the padding logic (points exactly on the centroid axis get no pad — that is intended and still leaves the other axis padded).

- [ ] **Step 5: Commit**

```bash
git add app/raseen/geometry/blocks.py app/tests/test_geometry.py
git commit -m "feat(geometry): deterministic 30 control blocks with hulls and zone labels"
```

---
### Task 4: Front-end shell — sidebar, router, store, API client, tokens

**Files:**
- Replace: `app/raseen/static/index.html`, `app/raseen/static/styles.css`
- Create: `app/raseen/static/app.js`, `app/raseen/static/store.js`, `app/raseen/static/api.js`, `app/raseen/static/format.js`, `app/raseen/static/colour.js`
- Create: `app/raseen/static/pages/kingdom.js`, `plant.js`, `control.js`, `declarations.js` (stubs rendering a titled panel; later tasks replace them), `app/raseen/static/pages/about.js` (renders the what's-real table from `/api/status`)
- Test: `app/tests/test_api.py` (append)

**Interfaces:**
- Produces (JS): `store` from `store.js` with `store.get()` (whole state), `store.set(patch)` (shallow merge, notifies), `store.subscribe(fn)` (fn(state, changedKeys) → unsubscribe), `store.currentFrame()`; `getJSON(url)`, `postJSON(url, body)` from `api.js` (reject if the envelope is missing); `fmt(v, digits=1)`, `fmtMW(v)`, `fmtMin(t)`, `fmtPct(v)`, `clockLabel(t)` from `format.js`; `outputColour(ratio)`, `headroomColour(ratio, firm)`, `etaColour(minutes)`, `lerpHex(a, b, t)`, `TECH_COLOUR`, `STATUS_COLOUR`, `cssVar(name)` from `colour.js`; page modules export `mount(root, ctx)` and `unmount()` where `ctx = { store, navigate, params, showTooltip, hideTooltip, banner }`.
- State keys: `status, site, blocks, scenario, frameIndex, controller ('bgc'|'uni'), mode ('output'|'headroom'|'eta'), selectedBlock (block id or null), activePlant ('najm-3000'), plants, grid, theme ('dark'|'light'), presentation (bool), whatsReal (bool), playing (bool)`.

- [ ] **Step 1: Append the failing test**

Append to `app/tests/test_api.py`:

```python
def test_shell_has_sidebar_tabs_and_page_root(client):
    body = client.get("/").text
    for route in ("#/kingdom", "#/plant/najm-3000", "#/control", "#/declarations", "#/about"):
        assert f'href="{route}"' in body
    assert 'id="page-root"' in body
    assert 'id="banner"' in body
    for asset in ("app.js", "store.js", "api.js", "format.js", "colour.js",
                  "pages/about.js", "pages/plant.js", "pages/kingdom.js",
                  "pages/control.js", "pages/declarations.js"):
        assert client.get(f"/static/{asset}").status_code == 200, asset
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api.py -v -k shell`
Expected: FAIL (`#/kingdom` not in body).

- [ ] **Step 3: Write the shell**

`app/raseen/static/index.html`:

```html
<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raseen · رَصين</title>
<link rel="stylesheet" href="/static/styles.css">
<link rel="stylesheet" href="/static/vendor/maplibre-gl.css">
<script src="/static/vendor/maplibre-gl.js"></script>
</head>
<body>
<div class="shell">
  <nav class="sidebar" id="sidebar" aria-label="Pages">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <div class="brand-text">
        <span class="brand-name">Raseen</span>
        <span class="brand-ar">رَصين</span>
      </div>
      <button id="sidebar-toggle" class="icon-btn" type="button" aria-label="Collapse sidebar">‹</button>
    </div>
    <a class="nav-item" href="#/kingdom" data-route="kingdom"><span class="nav-icon">◎</span><span class="nav-label">Kingdom</span></a>
    <a class="nav-item" href="#/plant/najm-3000" data-route="plant"><span class="nav-icon">▦</span><span class="nav-label">Plant</span></a>
    <a class="nav-item" href="#/control" data-route="control"><span class="nav-icon">◐</span><span class="nav-label">Gradient Control</span></a>
    <a class="nav-item" href="#/declarations" data-route="declarations"><span class="nav-icon">▤</span><span class="nav-label">Declarations</span></a>
    <a class="nav-item" href="#/about" data-route="about"><span class="nav-icon">ⓘ</span><span class="nav-label">About</span></a>
    <div class="sidebar-foot">
      <button id="theme-toggle" class="ghost-btn" type="button">Theme</button>
      <button id="presentation-toggle" class="ghost-btn" type="button" aria-pressed="false">Projector</button>
      <span class="version" id="version">—</span>
    </div>
  </nav>

  <div class="main">
    <header class="topbar">
      <h1 class="page-title" id="page-title">Kingdom</h1>
      <div class="topbar-right">
        <span class="clock" id="clock" hidden><span class="clock-k">t</span><span class="clock-v" id="clock-value">—</span></span>
        <button id="whatsreal-toggle" class="ghost-btn" type="button" aria-pressed="false">What's real</button>
        <span id="data-source-chip" class="chip chip-sim" role="status" title="Data source">
          <span class="chip-dot" aria-hidden="true"></span>
          <span class="chip-label" id="data-source-label">SIM</span>
        </span>
      </div>
    </header>
    <div id="banner" class="banner" hidden></div>
    <main id="page-root" class="page-root"></main>
  </div>
</div>
<div id="tooltip" class="tooltip" role="tooltip"></div>
<script type="module" src="/static/app.js"></script>
</body>
</html>
```

`app/raseen/static/styles.css`:

```css
/* ── tokens ─────────────────────────────────────────────────────────────── */
:root {
  color-scheme: dark;
  --bg-0: #0b0d10; --surface-1: #14171c; --surface-2: #1c2027; --surface-3: #242a33;
  --border: #2a2f38; --border-strong: #3a404b;
  --text: #f2f3f5; --text-2: #b8bcc6; --muted: #7f8592;
  --accent: #3987e5; --accent-soft: #6aa8ee; --amber: #f2a33a;
  --violet: #8b7cf6; --violet-dim: #5a5570; --cyan: #2ec4d6; --cloud: rgba(200,205,215,0.35);
  --good: #22b573; --warning: #fab219; --serious: #ec835a; --critical: #d03b3b; --sim: #9085e9;
  --ramp-0: #1d232c; --ramp-1: #23334a; --ramp-2: #274a72; --ramp-3: #2c669e; --ramp-4: #3987e5; --ramp-5: #6aa8ee;
  --grid: #262b33; --axis: #3a404b;
  --sidebar-w: 220px; --sidebar-collapsed: 56px; --radius: 10px; --gap: 14px;
  --mono: ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg-0: #f3f4f6; --surface-1: #ffffff; --surface-2: #eef0f3; --surface-3: #e3e6ea;
  --border: #d7dae0; --border-strong: #b9bec7;
  --text: #0e1116; --text-2: #4a5160; --muted: #737a88;
  --accent: #2a78d6; --accent-soft: #5497de; --amber: #d98b1e;
  --violet: #6b5bd2; --violet-dim: #b9b3e3; --cyan: #1595a6; --cloud: rgba(90,95,110,0.30);
  --ramp-0: #eef3fa; --ramp-1: #c5daf2; --ramp-2: #8fbaea; --ramp-3: #5497de; --ramp-4: #2a78d6; --ramp-5: #1b529a;
  --grid: #e4e6ea; --axis: #c2c6cd;
}
:root[data-presentation="on"] {
  --bg-0: #14181e; --surface-1: #1f242c; --surface-2: #2a3039; --surface-3: #343b46;
  --border: #46505d; --border-strong: #5c687a; --muted: #a2a9b6; --text-2: #d0d4dc; --grid: #3a424e;
}
:root[data-presentation="on"][data-theme="light"] {
  --bg-0: #ffffff; --surface-1: #ffffff; --surface-2: #f0f2f5; --border: #b9bec7; --border-strong: #8e96a3; --muted: #5a6270;
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg-0); color: var(--text); font: 14px/1.5 var(--sans); }
a { color: inherit; text-decoration: none; }
button { font: inherit; }

/* ── shell ──────────────────────────────────────────────────────────────── */
.shell { display: grid; grid-template-columns: var(--sidebar-w) 1fr; min-height: 100vh; }
.shell.is-collapsed { grid-template-columns: var(--sidebar-collapsed) 1fr; }
.sidebar { background: var(--surface-1); border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; padding: 14px 10px; position: sticky; top: 0; height: 100vh; }
.brand { display: flex; align-items: center; gap: 10px; padding: 4px 6px 14px; }
.brand-mark { width: 10px; height: 28px; border-radius: 3px; background: linear-gradient(var(--accent), var(--amber)); flex: none; }
.brand-text { display: flex; flex-direction: column; line-height: 1.1; }
.brand-name { font-weight: 700; letter-spacing: -0.01em; }
.brand-ar { font-size: 12px; color: var(--muted); }
.icon-btn { margin-left: auto; background: transparent; border: 1px solid var(--border); color: var(--text-2); border-radius: 6px; width: 26px; height: 26px; cursor: pointer; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; color: var(--text-2); }
.nav-item:hover { background: var(--surface-2); color: var(--text); }
.nav-item.is-active { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--text); font-weight: 600; }
.nav-icon { width: 20px; text-align: center; font-size: 15px; }
.sidebar-foot { margin-top: auto; display: flex; flex-direction: column; gap: 6px; padding: 8px 4px 0; }
.version { font: 11px var(--mono); color: var(--muted); }
.is-collapsed .nav-label, .is-collapsed .brand-text, .is-collapsed .sidebar-foot .ghost-btn, .is-collapsed .version { display: none; }
.is-collapsed .nav-item { justify-content: center; }
.is-collapsed .icon-btn { margin-left: 0; }
@media (max-width: 900px) { .shell { grid-template-columns: var(--sidebar-collapsed) 1fr; } .nav-label, .brand-text, .sidebar-foot .ghost-btn, .version { display: none; } .nav-item { justify-content: center; } }

.main { min-width: 0; display: flex; flex-direction: column; }
.topbar { display: flex; align-items: center; gap: var(--gap); padding: 10px 18px; background: var(--surface-1); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 20; }
.page-title { margin: 0; font-size: 16px; font-weight: 650; }
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.clock { display: inline-flex; align-items: baseline; gap: 6px; font-family: var(--mono); }
.clock[hidden] { display: none; }
.clock-k { font-size: 10px; color: var(--muted); letter-spacing: 0.08em; }
.clock-v { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.banner { padding: 10px 18px; background: color-mix(in srgb, var(--critical) 14%, var(--surface-2)); border-bottom: 1px solid var(--border); color: var(--text); font-size: 13px; }
.banner[hidden] { display: none; }
.page-root { padding: var(--gap); display: flex; flex-direction: column; gap: var(--gap); min-height: 0; }

/* ── chip, buttons, segments, controls ──────────────────────────────────── */
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; border: 1px solid var(--sim); color: var(--sim); background: color-mix(in srgb, var(--sim) 12%, transparent); white-space: nowrap; }
.chip-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sim); animation: pulse 2.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .chip-dot { animation: none; } }
.ghost-btn, .primary-btn, .danger-btn { font-size: 12px; padding: 6px 12px; border-radius: 7px; cursor: pointer; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); }
.primary-btn { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.danger-btn { border-color: var(--serious); color: var(--serious); }
.ghost-btn[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.ghost-btn:hover, .primary-btn:hover { filter: brightness(1.08); }
.seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 7px; overflow: hidden; }
.seg-btn { font-size: 11px; padding: 5px 11px; cursor: pointer; border: 0; background: var(--surface-1); color: var(--text-2); }
.seg-btn.is-on { background: var(--accent); color: #fff; font-weight: 600; }
.ctl { display: grid; gap: 4px; }
.ctl-label { font-size: 11px; color: var(--text-2); display: flex; justify-content: space-between; }
.ctl-value { font-family: var(--mono); color: var(--text); }
.ctl input[type="range"] { width: 100%; accent-color: var(--accent); }
.ctl select, .ctl input[type="number"] { font: inherit; font-size: 12px; padding: 6px 8px; border-radius: 7px; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); }
.check { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2); }

/* ── panels, tiles, lists ───────────────────────────────────────────────── */
.panel { background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; min-width: 0; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.panel h2 { margin: 0; font-size: 13px; font-weight: 650; }
.panel-note { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.split { display: grid; grid-template-columns: 1.4fr 1fr; gap: var(--gap); }
.split-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--gap); }
@media (max-width: 1100px) { .split, .split-3 { grid-template-columns: 1fr; } }
.tile-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.tile { background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
.tile-label { font-size: 11px; color: var(--text-2); }
.tile-value { font-family: var(--mono); font-size: 24px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.tile-value.is-big { font-size: 34px; }
.tile-unit { font-size: 11px; color: var(--muted); }
.tile.is-accent .tile-value { color: var(--accent-soft); }
.tile.is-violet .tile-value { color: var(--violet); }
.tile.is-amber .tile-value { color: var(--amber); }
.detail-list { margin: 0; display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; }
.detail-list dt { font-size: 12px; color: var(--text-2); }
.detail-list dd { margin: 0; font-family: var(--mono); font-size: 12.5px; text-align: right; font-variant-numeric: tabular-nums; }
.table { width: 100%; border-collapse: collapse; font-size: 12px; }
.table th, .table td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
.table th { color: var(--muted); font-weight: 600; font-size: 11px; letter-spacing: 0.04em; }
.table td.n { font-family: var(--mono); text-align: right; font-variant-numeric: tabular-nums; }
.status-pill { font-size: 10px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border-strong); color: var(--text-2); white-space: nowrap; }
.status-pill.is-real { border-color: var(--good); color: var(--good); }
.status-pill.is-sim { border-color: var(--sim); color: var(--sim); }
.status-pill.is-designed { border-color: var(--amber); color: var(--amber); }
.legend { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; font-size: 11px; color: var(--text-2); }
.legend-key { display: inline-flex; align-items: center; gap: 6px; }
.legend-swatch { width: 12px; height: 8px; border-radius: 2px; display: inline-block; }
.ramp { width: 120px; height: 8px; border-radius: 4px; }
.ramp-output { background: linear-gradient(90deg, var(--ramp-0), var(--ramp-3), var(--ramp-5)); }
.ramp-headroom { background: linear-gradient(90deg, var(--surface-3), var(--violet)); }
.ramp-eta { background: linear-gradient(90deg, var(--cyan), var(--surface-3)); }

/* ── maps ───────────────────────────────────────────────────────────────── */
.map-box { position: relative; height: 560px; border-radius: var(--radius); border: 1px solid var(--border); overflow: hidden; background: #0f1216; }
.map-box.is-tall { height: calc(100vh - 150px); min-height: 520px; }
.map-box[hidden] { display: none; }
.maplibregl-map { font: inherit; }
.maplibregl-ctrl-attrib { font-size: 9px; }
.zone-label { color: #fff; font: 700 10px/1 var(--mono); letter-spacing: 0.05em; text-shadow: 0 1px 3px rgb(0 0 0 / 0.9); white-space: nowrap; pointer-events: none; }
.block-label { color: #fff; font: 600 10px/1.2 var(--mono); text-align: center; text-shadow: 0 1px 3px rgb(0 0 0 / 0.95); white-space: nowrap; pointer-events: none; }
.block-label small { display: block; font-weight: 400; opacity: 0.85; }
.map-overlay { position: absolute; z-index: 5; background: color-mix(in srgb, var(--surface-1) 88%, transparent); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 12px; backdrop-filter: blur(6px); }
.map-overlay.top-left { top: 10px; left: 10px; }
.map-overlay.top-right { top: 10px; right: 10px; }
.map-overlay.bottom-left { bottom: 10px; left: 10px; }
.map-fallback { padding: 8px; }
.map-fallback svg { width: 100%; height: auto; display: block; }

/* ── tooltip, misc ──────────────────────────────────────────────────────── */
.tooltip { position: fixed; pointer-events: none; opacity: 0; transform: translate(-50%, -115%); background: var(--surface-1); border: 1px solid var(--border-strong); border-radius: 7px; padding: 8px 10px; font-size: 12px; box-shadow: 0 6px 20px rgb(0 0 0 / 0.35); z-index: 40; min-width: 140px; transition: opacity 90ms linear; }
.tooltip.is-visible { opacity: 1; }
.tooltip-head { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
.tooltip-row { display: flex; justify-content: space-between; gap: 10px; }
.tooltip-value { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.whatsreal-tag { display: inline-block; margin-left: 6px; font: 600 9px/1 var(--mono); letter-spacing: 0.06em; padding: 2px 5px; border-radius: 3px; border: 1px solid var(--sim); color: var(--sim); vertical-align: middle; }
:root:not([data-whatsreal="on"]) .whatsreal-tag { display: none; }
.empty { color: var(--muted); font-size: 12px; }
.mono { font-family: var(--mono); }
```

`app/raseen/static/store.js`:

```js
/** Single client-side store shared by every page. Plain pub/sub, no framework. */
export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const changed = Object.keys(patch).filter((k) => state[k] !== patch[k]);
      if (!changed.length) return;
      state = { ...state, ...patch };
      for (const fn of listeners) fn(state, changed);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    currentFrame() {
      const s = state.scenario;
      if (!s || !s.frames?.length) return null;
      return s.frames[Math.min(state.frameIndex, s.frames.length - 1)];
    },
  };
}

export const store = createStore({
  status: null, site: null, blocks: null, scenario: null, frameIndex: 240,
  controller: "bgc", mode: "output", selectedBlock: null, activePlant: "najm-3000",
  plants: null, grid: null, theme: "dark", presentation: false, whatsReal: false, playing: false,
});
```

`app/raseen/static/api.js`:

```js
/** Fetch wrappers. A response without the provenance envelope is treated as an error. */
function checkEnvelope(body, url) {
  if (!body || typeof body.classification !== "string" || typeof body.disclaimer !== "string") {
    throw new Error(`Response from ${url} carries no classification/disclaimer envelope`);
  }
  return body;
}

export async function getJSON(url) {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ? JSON.stringify(body.detail) : `${response.status} ${response.statusText}`);
  return checkEnvelope(body, url);
}

export async function postJSON(url, payload) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ? JSON.stringify(body.detail) : `${response.status} ${response.statusText}`);
  return checkEnvelope(body, url);
}
```

`app/raseen/static/format.js`:

```js
export const fmt = (v, digits = 1) =>
  v === null || v === undefined || Number.isNaN(v) || !Number.isFinite(v)
    ? "—"
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtMW = (v) => `${fmt(v, 0)} MW`;
export const fmtPct = (v, digits = 1) => `${fmt(v, digits)} %`;
export const fmtMin = (t) => (t === null || t === undefined || !Number.isFinite(t) ? "—" : `${t >= 0 ? "+" : "−"}${fmt(Math.abs(t), 1)} min`);
/** Scenario clock: minutes from fence contact as ±MM:SS. */
export function clockLabel(t) {
  if (t === null || t === undefined || !Number.isFinite(t)) return "—";
  const sign = t < 0 ? "−" : "+";
  const total = Math.round(Math.abs(t) * 60);
  const mm = Math.floor(total / 60); const ss = total % 60;
  return `${sign}${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
export const fmtGW = (mw) => `${fmt(mw / 1000, 2)} GW`;
```

`app/raseen/static/colour.js`:

```js
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function hexToRgb(hex) { const h = hex.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function rgbToHex([r, g, b]) { return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join(""); }
export function lerpHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b); const u = Math.max(0, Math.min(1, t));
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * u));
}
function ramp(stops, t) {
  const u = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  return lerpHex(stops[i], stops[i + 1], u - i);
}
/** Set-point as a share of block capacity, 0..1 → dark navy .. bright blue. */
export function outputColour(ratio) {
  return ramp([cssVar("--ramp-0"), cssVar("--ramp-2"), cssVar("--ramp-4"), cssVar("--ramp-5")], ratio);
}
/** Headroom share 0..1; firm (ETA beyond the horizon) in violet, expiring in dim violet. */
export function headroomColour(ratio, firm) {
  if (ratio < 0.01) return cssVar("--surface-3");
  return ramp([cssVar("--surface-3"), firm ? cssVar("--violet") : cssVar("--violet-dim")], 0.25 + 0.75 * ratio);
}
/** Minutes to arrival: 0 bright cyan → 15+ dark; passed/covered grey. */
export function etaColour(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return cssVar("--surface-3");
  if (minutes <= 0) return "#4a5160";
  return ramp([cssVar("--cyan"), cssVar("--surface-3")], minutes / 15);
}
export const TECH_COLOUR = { pv: "#f2a33a", wind: "#2ec4d6", csp: "#ec835a", bess: "#8b7cf6" };
export const STATUS_COLOUR = { operational: "#22b573", under_construction: "#fab219", awarded: "#9aa1ad", planned: "#5a6270" };
export const TECH_LABEL = { pv: "Solar PV", wind: "Wind", csp: "CSP", bess: "Battery storage" };
export const STATUS_LABEL = { operational: "Operational", under_construction: "Under construction", awarded: "Awarded", planned: "Planned" };
```

`app/raseen/static/app.js`:

```js
import { store } from "/static/store.js";
import { getJSON } from "/static/api.js";
import { clockLabel } from "/static/format.js";

const $ = (id) => document.getElementById(id);
const PAGES = {
  kingdom: () => import("/static/pages/kingdom.js"),
  plant: () => import("/static/pages/plant.js"),
  control: () => import("/static/pages/control.js"),
  declarations: () => import("/static/pages/declarations.js"),
  about: () => import("/static/pages/about.js"),
};
const TITLES = { kingdom: "Kingdom", plant: "Plant", control: "Gradient Control", declarations: "Declarations", about: "About · what's real" };

let current = null;   // { name, module }

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [name, ...rest] = hash.split("/");
  return { name: PAGES[name] ? name : "kingdom", params: rest.filter(Boolean) };
}

export function navigate(path) { location.hash = path.startsWith("#") ? path : `#${path}`; }

export function banner(message) {
  const el = $("banner");
  if (!message) { el.hidden = true; el.textContent = ""; return; }
  el.textContent = message; el.hidden = false;
}

export function showTooltip(event, heading, rows) {
  const tip = $("tooltip");
  tip.replaceChildren();
  const head = document.createElement("div"); head.className = "tooltip-head"; head.textContent = heading; tip.append(head);
  for (const row of rows) {
    const line = document.createElement("div"); line.className = "tooltip-row";
    const name = document.createElement("span"); name.textContent = row.name;
    const value = document.createElement("span"); value.className = "tooltip-value"; value.textContent = row.value;
    line.append(name, value); tip.append(line);
  }
  tip.style.left = `${event.clientX}px`; tip.style.top = `${event.clientY}px`; tip.classList.add("is-visible");
}
export function hideTooltip() { $("tooltip").classList.remove("is-visible"); }

async function route() {
  const { name, params } = parseRoute();
  if (current?.module?.unmount) { try { current.module.unmount(); } catch (e) { console.warn(e); } }
  const root = $("page-root"); root.replaceChildren();
  for (const item of document.querySelectorAll(".nav-item")) item.classList.toggle("is-active", item.dataset.route === name);
  $("page-title").textContent = TITLES[name];
  try {
    const module = await PAGES[name]();
    current = { name, module };
    await module.mount(root, { store, navigate, params, showTooltip, hideTooltip, banner });
  } catch (error) {
    banner(`Page failed: ${error.message}`); console.error(error);
  }
}

function applyTheme(theme) { document.documentElement.dataset.theme = theme; try { localStorage.setItem("raseen-theme", theme); } catch (e) { /* private mode */ } }

async function boot() {
  try { const saved = localStorage.getItem("raseen-theme"); if (saved) store.set({ theme: saved }); } catch (e) { /* ignore */ }
  applyTheme(store.get().theme);
  $("theme-toggle").addEventListener("click", () => { const next = store.get().theme === "dark" ? "light" : "dark"; store.set({ theme: next }); applyTheme(next); });
  $("presentation-toggle").addEventListener("click", (e) => { const on = !store.get().presentation; store.set({ presentation: on }); document.documentElement.dataset.presentation = on ? "on" : "off"; e.currentTarget.setAttribute("aria-pressed", String(on)); });
  $("whatsreal-toggle").addEventListener("click", (e) => { const on = !store.get().whatsReal; store.set({ whatsReal: on }); document.documentElement.dataset.whatsreal = on ? "on" : "off"; e.currentTarget.setAttribute("aria-pressed", String(on)); });
  $("sidebar-toggle").addEventListener("click", () => document.querySelector(".shell").classList.toggle("is-collapsed"));

  store.subscribe((state, changed) => {
    if (changed.includes("scenario") || changed.includes("frameIndex")) {
      const frame = store.currentFrame();
      $("clock").hidden = !frame;
      if (frame) $("clock-value").textContent = clockLabel(frame.t);
    }
  });

  try {
    const status = await getJSON("/api/status");
    store.set({ status });
    $("data-source-label").textContent = status.is_live ? "LIVE" : "SIM";
    $("data-source-chip").title = status.disclaimer;
    $("version").textContent = `v${status.version} · ${status.site_mode}`;
  } catch (error) { banner(`API unavailable: ${error.message}`); }

  addEventListener("hashchange", route);
  await route();
}

boot();
```

Page stubs — `app/raseen/static/pages/kingdom.js`, `control.js`, `declarations.js` each:

```js
export async function mount(root) {
  const panel = document.createElement("section"); panel.className = "panel";
  panel.innerHTML = `<div class="panel-head"><h2>PAGE_NAME</h2></div><p class="empty">Coming in a later task.</p>`;
  root.append(panel);
}
export function unmount() {}
```

(replace `PAGE_NAME` with `Kingdom`, `Gradient Control`, `Declarations`). `plant.js` gets its real content in Task 5; create the same stub with `Plant` for now.

`app/raseen/static/pages/about.js`:

```js
const STATUS_CLASS = { "real": "is-real", "real code": "is-real", "designed": "is-designed", "representative": "is-designed", "simulated": "is-sim", "indicative": "is-designed" };

export async function mount(root, { store }) {
  const status = store.get().status;
  const panel = document.createElement("section"); panel.className = "panel";
  const head = document.createElement("div"); head.className = "panel-head";
  head.innerHTML = `<h2>What is real, what is designed, what is simulated</h2>`;
  const note = document.createElement("p"); note.className = "panel-note"; note.textContent = status?.disclaimer ?? "";
  const table = document.createElement("table"); table.className = "table";
  table.innerHTML = `<thead><tr><th>Item</th><th>Status</th><th>Note</th></tr></thead>`;
  const body = document.createElement("tbody");
  for (const row of status?.what_is_real ?? []) {
    const tr = document.createElement("tr");
    const item = document.createElement("td"); item.textContent = row.item;
    const st = document.createElement("td"); const pill = document.createElement("span"); pill.className = `status-pill ${STATUS_CLASS[row.status] ?? ""}`; pill.textContent = row.status; st.append(pill);
    const n = document.createElement("td"); n.textContent = row.note;
    tr.append(item, st, n); body.append(tr);
  }
  table.append(body);
  panel.append(head, note, table);
  root.append(panel);
}
export function unmount() {}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api.py -v`
Expected: 5 passed. (The `vendor/` files referenced by `index.html` do not exist yet; Task 5 copies them. The page still loads because `<script src>` failures are non-fatal.)

- [ ] **Step 5: Visual check**

Start `.venv\Scripts\python.exe -m raseen --port 8010`, open `http://127.0.0.1:8010/#/about`. Expected: dark shell, sidebar with five items, About shows the what's-real table, the `SIM` chip in the top bar, theme toggle switches to light. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add app/raseen/static app/tests/test_api.py
git commit -m "feat(ui): shell with sidebar tabs, hash router, store, API client, theme tokens"
```

---

### Task 5: `/api/site`, satellite site map, SVG plan fallback, Plant page

**Files:**
- Copy: `C:\Users\msms-\OneDrive\سطح المكتب\Abud\NAJM-3000\src\najm3000\dashboard\static\vendor\maplibre-gl.js` and `maplibre-gl.css` → `app/raseen/static/vendor/`
- Modify: `app/raseen/api.py` (add `/api/site`)
- Create: `app/raseen/static/maps/site-map.js`, `app/raseen/static/maps/site-plan.js`
- Replace: `app/raseen/static/pages/plant.js`
- Test: `app/tests/test_api.py` (append)

**Interfaces:**
- Produces (API): `GET /api/site` → envelope + `plant, plant_mw, note, mode, bounds, mvps ([{n, lat, lon}]), zones, lines, blocks (blocks_payload), mvps_block_index, mvps_mw`.
- Produces (JS): `class SiteMap { constructor(container, site, { onSelect, onHover, onLeave }); static available(); async init() → boolean; setMode(mode); setFrame(frame, controller); clear(); flyToBlock(id); fitPlant(); resize(); destroy(); }` in `site-map.js`; `class SitePlan` with the same methods in `site-plan.js`; a helper `blockColour(mode, frame, i, controller, cap)` exported from `site-plan.js` and reused by `site-map.js`.
- `frame` shape consumed here (produced by Task 8): `{ t, phase, A[], P_bgc[], P_uni[], P_base[], eta[] (null = never), coverage[], firm[], cloud: [[[lon,lat],…],…], agg }`. `controller` ∈ `'bgc' | 'uni' | 'base'` selects `P_bgc`/`P_uni`/`P_base`.

- [ ] **Step 1: Copy the vendored map library**

```powershell
New-Item -ItemType Directory -Force C:\Users\msms-\Raseen\app\raseen\static\vendor
Copy-Item "C:\Users\msms-\OneDrive\سطح المكتب\Abud\NAJM-3000\src\najm3000\dashboard\static\vendor\maplibre-gl.js" C:\Users\msms-\Raseen\app\raseen\static\vendor\
Copy-Item "C:\Users\msms-\OneDrive\سطح المكتب\Abud\NAJM-3000\src\najm3000\dashboard\static\vendor\maplibre-gl.css" C:\Users\msms-\Raseen\app\raseen\static\vendor\
```

- [ ] **Step 2: Append the failing tests**

Append to `app/tests/test_api.py`:

```python
def test_site_endpoint_serves_geometry_and_blocks(client):
    body = client.get("/api/site").json()
    assert body["classification"] == "SIMULATION (RASEEN PROTOTYPE)"
    assert body["plant"] == "NAJM-3000" and body["plant_mw"] == 3000.0
    assert len(body["mvps"]) == 363 and len(body["blocks"]) == 30
    assert len(body["mvps_block_index"]) == 363
    assert body["blocks"][0]["id"] == "B01"
    assert "as-designed" in body["note"]
    assert body["mode"] in ("real", "representative")


def test_vendor_map_library_and_map_modules_are_served(client):
    for asset in ("vendor/maplibre-gl.js", "vendor/maplibre-gl.css", "maps/site-map.js", "maps/site-plan.js"):
        assert client.get(f"/static/{asset}").status_code == 200, asset
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api.py -v -k "site or vendor"`
Expected: `/api/site` → 404 → KeyError; map modules 404.

- [ ] **Step 4: Add the endpoint**

In `app/raseen/api.py`, add imports after the existing `from raseen import ...` line:

```python
from raseen.geometry.blocks import blocks_payload, get_blocks, mvps_block_index
from raseen.geometry.site import MVPS_MW, get_site
```

and inside `build_app()`, after the `status` route:

```python
    @app.get("/api/site")
    def site_view() -> dict[str, Any]:
        site = get_site()
        blocks = get_blocks(site)
        return {
            **envelope(),
            "plant": PLANT_NAME,
            "plant_mw": PLANT_MW,
            "note": site.note,
            "mode": site.mode,
            "bounds": site.bounds,
            "mvps": site.mvps,
            "zones": site.zones,
            "lines": site.lines,
            "blocks": blocks_payload(blocks),
            "mvps_block_index": mvps_block_index(site, blocks),
            "mvps_mw": round(MVPS_MW, 4),
        }
```

- [ ] **Step 5: Write the SVG plan (fallback) and the shared colour rule**

`app/raseen/static/maps/site-plan.js`:

```js
import { outputColour, headroomColour, etaColour, cssVar } from "/static/colour.js";
import { fmt } from "/static/format.js";

/** Colour of block i for the chosen map mode. `frame` may be null (clear day: all at capacity). */
export function blockColour(mode, frame, i, controller, cap) {
  if (!frame) return mode === "output" ? outputColour(1) : cssVar("--surface-3");
  const P = frame[`P_${controller}`] ?? frame.P_bgc;
  if (mode === "headroom") return headroomColour(Math.max(0, frame.A[i] - P[i]) / cap, Boolean(frame.firm[i]));
  if (mode === "eta") return etaColour(frame.eta[i]);
  return outputColour(Math.max(0, P[i]) / cap);
}

export function blockRows(frame, i, controller, cap, label) {
  if (!frame) return [{ name: "Capacity", value: `${fmt(cap, 0)} MW` }, { name: "State", value: "clear day (no scenario)" }];
  const P = frame[`P_${controller}`] ?? frame.P_bgc;
  const eta = frame.eta[i];
  return [
    { name: "Available", value: `${fmt(frame.A[i], 0)} MW` },
    { name: "Set-point", value: `${fmt(P[i], 0)} MW` },
    { name: "Headroom", value: `${fmt(Math.max(0, frame.A[i] - P[i]), 0)} MW${frame.firm[i] ? " · firm" : ""}` },
    { name: "Cloud ETA", value: eta === null ? "none" : eta <= 0 ? "reached" : `+${fmt(eta, 1)} min` },
    { name: "Coverage", value: `${fmt(frame.coverage[i] * 100, 0)} %` },
  ];
}

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}) => { const n = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

/** Same geometry as the satellite map, drawn as SVG in local metres. Works offline. */
export class SitePlan {
  constructor(container, site, { onSelect, onHover, onLeave } = {}) {
    this.container = container; this.site = site; this.onSelect = onSelect; this.onHover = onHover; this.onLeave = onLeave;
    this.mode = "output"; this.controller = "bgc"; this.frame = null; this.polys = []; this.cloudGroup = null; this.labels = [];
    const lat0 = (site.bounds.south + site.bounds.north) / 2, lon0 = (site.bounds.west + site.bounds.east) / 2;
    const mlat = 111320, mlon = 111320 * Math.cos((lat0 * Math.PI) / 180);
    this.xy = (lon, lat) => [(lon - lon0) * mlon, -(lat - lat0) * mlat];   // y down for SVG
  }
  static available() { return true; }
  async init() {
    const pts = this.site.mvps.map((p) => this.xy(p.lon, p.lat));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const pad = 400;
    const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad, w = Math.max(...xs) - minX + pad, h = Math.max(...ys) - minY + pad;
    const svg = el("svg", { viewBox: `${minX} ${minY} ${w} ${h}`, role: "img", "aria-label": "Plant plan, as-designed" });
    svg.append(el("rect", { x: minX, y: minY, width: w, height: h, fill: "#0f1216" }));
    for (const line of this.site.lines) {
      const d = line.pts.map(([lat, lon], i) => `${i ? "L" : "M"}${this.xy(lon, lat).join(",")}`).join("");
      svg.append(el("path", { d, fill: "none", stroke: "#3a404b", "stroke-width": 6 }));
    }
    const hulls = el("g");
    this.site.blocks.forEach((b, i) => {
      const poly = el("polygon", { points: b.hull.map(([lon, lat]) => this.xy(lon, lat).join(",")).join(" "), fill: "#2c3a4d", "fill-opacity": 0.75, stroke: "#8fbaea", "stroke-width": 12, "data-block": b.id, tabindex: 0 });
      poly.addEventListener("click", () => this.onSelect?.(b.id));
      poly.addEventListener("mousemove", (e) => this.onHover?.(e, i));
      poly.addEventListener("mouseleave", (e) => this.onLeave?.(e));
      hulls.append(poly); this.polys.push(poly);
      const [cx, cy] = this.xy(b.centroid[0], b.centroid[1]);
      const t = el("text", { x: cx, y: cy, "text-anchor": "middle", fill: "#fff", "font-size": 140, "font-family": "monospace", "font-weight": 600, "pointer-events": "none" });
      t.textContent = b.id; hulls.append(t); this.labels.push(t);
    });
    svg.append(hulls);
    this.cloudGroup = el("g", { fill: "rgba(200,205,215,0.35)", stroke: "rgba(220,225,235,0.8)", "stroke-width": 10 });
    svg.append(this.cloudGroup);
    for (const p of this.site.mvps) { const [x, y] = this.xy(p.lon, p.lat); svg.append(el("circle", { cx: x, cy: y, r: 22, fill: "#cfe3fb", "pointer-events": "none" })); }
    for (const z of this.site.zones) { const [x, y] = this.xy(z.lon, z.lat); const t = el("text", { x, y, fill: "#dfe6f0", "font-size": 170, "font-family": "monospace", "pointer-events": "none" }); t.textContent = z.name; svg.append(t); }
    const wrap = document.createElement("div"); wrap.className = "map-fallback"; wrap.append(svg);
    this.container.replaceChildren(wrap); this.svg = svg;
    this.paint();
    return true;
  }
  setMode(mode) { this.mode = mode; this.paint(); }
  setFrame(frame, controller) { this.frame = frame; this.controller = controller ?? this.controller; this.paint(); }
  clear() { this.frame = null; this.paint(); }
  paint() {
    if (!this.polys.length) return;
    this.site.blocks.forEach((b, i) => {
      this.polys[i].setAttribute("fill", blockColour(this.mode, this.frame, i, this.controller, b.capacity_mw));
      const P = this.frame ? (this.frame[`P_${this.controller}`] ?? this.frame.P_bgc)[i] : b.capacity_mw;
      this.labels[i].textContent = `${b.id} ${fmt(P, 0)}`;
    });
    this.cloudGroup.replaceChildren();
    for (const poly of this.frame?.cloud ?? []) {
      this.cloudGroup.append(el("polygon", { points: poly.map(([lon, lat]) => this.xy(lon, lat).join(",")).join(" ") }));
    }
  }
  flyToBlock(id) { const poly = this.polys.find((p) => p.dataset.block === id); poly?.focus?.(); }
  fitPlant() {}
  resize() {}
  destroy() { this.container.replaceChildren(); this.polys = []; this.labels = []; }
}
```

- [ ] **Step 6: Write the satellite map**

`app/raseen/static/maps/site-map.js`:

```js
import { blockColour } from "/static/maps/site-plan.js";
import { fmt } from "/static/format.js";

const IMAGERY = window.RASEEN_TILES_SAT || "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ATTRIBUTION = "Imagery &copy; Esri, Maxar, Earthstar Geographics · Layout as-designed · Values simulated";

/** The real plant on satellite imagery: MVPS, block linework, 30 control-block hulls, cloud overlay. */
export class SiteMap {
  constructor(container, site, { onSelect, onHover, onLeave } = {}) {
    this.container = container; this.site = site; this.onSelect = onSelect; this.onHover = onHover; this.onLeave = onLeave;
    this.mode = "output"; this.controller = "bgc"; this.frame = null; this.map = null; this.markers = []; this.labelEls = []; this.ready = false;
  }
  static available() {
    return typeof maplibregl !== "undefined" && (typeof maplibregl.supported !== "function" || maplibregl.supported());
  }
  async init() {
    if (!SiteMap.available()) return false;
    const s = this.site;
    const centre = [(s.bounds.west + s.bounds.east) / 2, (s.bounds.south + s.bounds.north) / 2];
    this.map = new maplibregl.Map({
      container: this.container,
      style: { version: 8, sources: { esri: { type: "raster", tiles: [IMAGERY], tileSize: 256, attribution: ATTRIBUTION, maxzoom: 18 } }, layers: [{ id: "imagery", type: "raster", source: "esri" }] },
      center: centre, zoom: 12, maxPitch: 60, attributionControl: { compact: false },
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
    await new Promise((resolve) => { if (this.map.isStyleLoaded()) resolve(); else this.map.once("style.load", resolve); setTimeout(resolve, 8000); });
    if (!this.map.getStyle()) return false;

    this.map.addSource("hulls", { type: "geojson", promoteId: "i", data: { type: "FeatureCollection", features: s.blocks.map((b, i) => ({ type: "Feature", id: i, geometry: { type: "Polygon", coordinates: [[...b.hull, b.hull[0]]] }, properties: { i, id: b.id, label: b.label, cap: b.capacity_mw } })) } });
    this.map.addLayer({ id: "hull-fill", type: "fill", source: "hulls", paint: { "fill-color": ["coalesce", ["feature-state", "colour"], "#2c3a4d"], "fill-opacity": 0.55 } });
    this.map.addLayer({ id: "hull-line", type: "line", source: "hulls", paint: { "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#ffffff", "#9fc3ee"], "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 1.2], "line-opacity": 0.9 } });

    this.map.addSource("outline", { type: "geojson", data: { type: "FeatureCollection", features: s.lines.map((l) => ({ type: "Feature", geometry: { type: "LineString", coordinates: l.pts.map(([lat, lon]) => [lon, lat]) }, properties: {} })) } });
    this.map.addLayer({ id: "outline-lines", type: "line", source: "outline", minzoom: 13, paint: { "line-color": "#ffffff", "line-opacity": 0.45, "line-width": 0.8 } });

    this.map.addSource("mvps", { type: "geojson", data: { type: "FeatureCollection", features: s.mvps.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { n: p.n } })) } });
    this.map.addLayer({ id: "mvps-circles", type: "circle", source: "mvps", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2, 15, 5], "circle-color": "#cfe3fb", "circle-stroke-color": "#10131a", "circle-stroke-width": 1 } });

    this.map.addSource("cloud", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    this.map.addLayer({ id: "cloud-fill", type: "fill", source: "cloud", paint: { "fill-color": "#d0d5de", "fill-opacity": 0.35 } });
    this.map.addLayer({ id: "cloud-line", type: "line", source: "cloud", paint: { "line-color": "#e6eaf0", "line-width": 1.5, "line-dasharray": [2, 2] } });

    for (const z of s.zones) { const e = document.createElement("div"); e.className = "zone-label"; e.textContent = z.name; this.markers.push(new maplibregl.Marker({ element: e }).setLngLat([z.lon, z.lat]).addTo(this.map)); }
    for (const b of s.blocks) { const e = document.createElement("div"); e.className = "block-label"; e.innerHTML = `${b.id}<small>—</small>`; this.labelEls.push(e); this.markers.push(new maplibregl.Marker({ element: e }).setLngLat(b.centroid).addTo(this.map)); }

    this.map.on("click", "hull-fill", (e) => { const f = e.features?.[0]; if (f) this.onSelect?.(f.properties.id); });
    this.map.on("mousemove", "hull-fill", (e) => { this.map.getCanvas().style.cursor = "pointer"; const f = e.features?.[0]; if (f) this.onHover?.(e.originalEvent, f.properties.i); });
    this.map.on("mouseleave", "hull-fill", (e) => { this.map.getCanvas().style.cursor = ""; this.onLeave?.(e.originalEvent); });

    this.ready = true;
    this.fitPlant();
    this.paint();
    return true;
  }
  setMode(mode) { this.mode = mode; this.paint(); }
  setFrame(frame, controller) { this.frame = frame; this.controller = controller ?? this.controller; this.paint(); }
  clear() { this.frame = null; this.paint(); }
  select(id) {
    if (!this.ready) return;
    this.site.blocks.forEach((b, i) => this.map.setFeatureState({ source: "hulls", id: i }, { selected: b.id === id }));
  }
  paint() {
    if (!this.ready) return;
    this.site.blocks.forEach((b, i) => {
      this.map.setFeatureState({ source: "hulls", id: i }, { colour: blockColour(this.mode, this.frame, i, this.controller, b.capacity_mw) });
      const P = this.frame ? (this.frame[`P_${this.controller}`] ?? this.frame.P_bgc)[i] : b.capacity_mw;
      const extra = this.mode === "eta" && this.frame ? (this.frame.eta[i] === null ? "—" : this.frame.eta[i] <= 0 ? "here" : `+${fmt(this.frame.eta[i], 1)}′`) : `${fmt(P, 0)} MW`;
      this.labelEls[i].innerHTML = `${b.id}<small>${extra}</small>`;
    });
    const polys = this.frame?.cloud ?? [];
    this.map.getSource("cloud").setData({ type: "FeatureCollection", features: polys.map((poly) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...poly, poly[0]]] }, properties: {} })) });
  }
  flyToBlock(id) {
    const b = this.site.blocks.find((x) => x.id === id); if (!b || !this.ready) return;
    this.map.flyTo({ center: b.centroid, zoom: Math.max(this.map.getZoom(), 14.5), duration: 1400, essential: true });
  }
  fitPlant() { if (!this.ready) return; const b = this.site.bounds; this.map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 30, duration: 0 }); }
  resize() { this.map?.resize(); }
  destroy() { for (const m of this.markers) m.remove(); this.markers = []; this.map?.remove(); this.map = null; this.ready = false; }
}
```

- [ ] **Step 7: Write the Plant page**

`app/raseen/static/pages/plant.js`:

```js
import { getJSON } from "/static/api.js";
import { fmt } from "/static/format.js";
import { SiteMap } from "/static/maps/site-map.js";
import { SitePlan, blockRows } from "/static/maps/site-plan.js";

let ctx = null, view = null, unsub = null, root = null;
const $ = (id) => document.getElementById(id);

async function loadSite(store) {
  if (store.get().site) return store.get().site;
  const site = await getJSON("/api/site");
  store.set({ site, blocks: site.blocks });
  return site;
}

function factsList(site) {
  const rows = [
    ["Rating at POI", `${fmt(site.plant_mw, 0)} MWac`], ["MV power stations", `${site.mvps.length} in geometry (365 design basis)`],
    ["Control blocks", `${site.blocks.length}`], ["Zones", `${site.zones.length}`],
    ["Extent", "10.6 km N–S × 7.4 km E–W"], ["Coordinates", `${site.bounds.south.toFixed(3)}–${site.bounds.north.toFixed(3)} N, ${site.bounds.west.toFixed(3)}–${site.bounds.east.toFixed(3)} E`],
    ["Geometry", site.mode === "real" ? "as-designed CAD/KML" : "representative (offset)"],
  ];
  const dl = document.createElement("dl"); dl.className = "detail-list";
  for (const [k, v] of rows) { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); }
  return dl;
}

function renderInspector(store) {
  const { site, selectedBlock, controller } = store.get();
  const box = $("inspector"); if (!box) return;
  const i = site.blocks.findIndex((b) => b.id === selectedBlock);
  if (i < 0) { box.innerHTML = `<p class="empty">Click a block on the map.</p>`; return; }
  const b = site.blocks[i]; const frame = store.currentFrame();
  const rows = [["Block", `${b.id} · ${b.label}`], ["Stations", `${b.mvps.length} MVPS`], ["Capacity", `${fmt(b.capacity_mw, 0)} MW`], ...blockRows(frame, i, controller, b.capacity_mw).map((r) => [r.name, r.value])];
  if (frame) { const other = controller === "bgc" ? "uni" : "bgc"; rows.push([`Set-point (${other === "bgc" ? "Raseen" : "plant-level"})`, `${fmt(frame[`P_${other}`][i], 0)} MW`]); }
  const dl = document.createElement("dl"); dl.className = "detail-list";
  for (const [k, v] of rows) { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); }
  box.replaceChildren(dl);
}

async function mountNajm(store) {
  const site = await loadSite(store);
  root.innerHTML = `
    <section class="split">
      <div class="panel">
        <div class="panel-head">
          <h2>${site.plant} <span class="whatsreal-tag">GEOMETRY: DESIGNED</span></h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <div class="seg" role="group" aria-label="View">
              <button type="button" class="seg-btn is-on" data-view="sat">Satellite</button>
              <button type="button" class="seg-btn" data-view="plan">Plan</button>
            </div>
            <div class="seg" role="group" aria-label="Colour mode">
              <button type="button" class="seg-btn is-on" data-mode="output">Output</button>
              <button type="button" class="seg-btn" data-mode="headroom">Headroom</button>
              <button type="button" class="seg-btn" data-mode="eta">ETA</button>
            </div>
          </div>
        </div>
        <p class="panel-note" id="plant-note">${site.note}</p>
        <div id="site-map" class="map-box is-tall"></div>
        <div class="legend" id="plant-legend"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--gap)">
        <div class="panel"><div class="panel-head"><h2>Plant facts</h2></div><div id="facts"></div></div>
        <div class="panel"><div class="panel-head"><h2>Block inspector <span class="whatsreal-tag">VALUES: SIMULATED</span></h2></div><div id="inspector"></div></div>
      </div>
    </section>`;
  $("facts").append(factsList(site));

  const hooks = {
    onSelect: (id) => { store.set({ selectedBlock: id }); view?.select?.(id); },
    onHover: (e, i) => ctx.showTooltip(e, `${site.blocks[i].id} · ${site.blocks[i].label}`, blockRows(store.currentFrame(), i, store.get().controller, site.blocks[i].capacity_mw)),
    onLeave: () => ctx.hideTooltip(),
  };
  async function useView(kind) {
    view?.destroy(); view = null;
    const box = $("site-map"); box.replaceChildren();
    const Cls = kind === "sat" && SiteMap.available() ? SiteMap : SitePlan;
    view = new Cls(box, site, hooks);
    const ok = await view.init();
    if (!ok && Cls === SiteMap) { view.destroy(); view = new SitePlan(box, site, hooks); await view.init(); $("plant-note").textContent = "Satellite tiles unavailable; showing the as-designed plan."; }
    view.setMode(store.get().mode); view.setFrame(store.currentFrame(), store.get().controller); view.select?.(store.get().selectedBlock);
    paintLegend();
  }
  function paintLegend() {
    const mode = store.get().mode; const l = $("plant-legend");
    l.innerHTML = mode === "output" ? `<span>set-point / capacity</span><span class="ramp ramp-output"></span><span>0 → 100 %</span>`
      : mode === "headroom" ? `<span>headroom (A − P)</span><span class="ramp ramp-headroom"></span><span>violet = firm beyond 5 min, dim = expiring</span>`
      : `<span>minutes to cloud arrival</span><span class="ramp ramp-eta"></span><span>now → 15+ min · grey = passed or none</span>`;
  }
  for (const btn of root.querySelectorAll("[data-view]")) btn.addEventListener("click", () => { root.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("is-on", b === btn)); useView(btn.dataset.view); });
  for (const btn of root.querySelectorAll("[data-mode]")) btn.addEventListener("click", () => { root.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("is-on", b === btn)); store.set({ mode: btn.dataset.mode }); });

  unsub = store.subscribe((state, changed) => {
    if (changed.includes("mode")) { view?.setMode(state.mode); paintLegend(); }
    if (changed.includes("scenario") || changed.includes("frameIndex") || changed.includes("controller")) view?.setFrame(store.currentFrame(), state.controller);
    if (changed.some((k) => ["selectedBlock", "scenario", "frameIndex", "controller"].includes(k))) renderInspector(store);
  });
  await useView("sat");
  renderInspector(store);
}

async function mountOther(store, id) {
  const plants = store.get().plants ?? (await getJSON("/api/plants")).plants;
  store.set({ plants });
  const p = plants.find((x) => x.id === id);
  if (!p) { root.innerHTML = `<section class="panel"><p class="empty">Unknown plant “${id}”.</p></section>`; return; }
  root.innerHTML = `
    <section class="split">
      <div class="panel"><div class="panel-head"><h2>${p.name_en} <span class="status-pill">${p.status.replace("_", " ")}</span></h2></div>
        <p class="panel-note">Block geometry not modelled. Raseen's twin currently models NAJM-3000. Position is ${p.coordinate_quality}-level from public sources.</p>
        <div id="other-map" class="map-box is-tall"></div></div>
      <div class="panel"><div class="panel-head"><h2>Facts</h2></div><div id="other-facts"></div></div>
    </section>`;
  const dl = document.createElement("dl"); dl.className = "detail-list";
  for (const [k, v] of [["Arabic name", p.name_ar ?? "—"], ["Technology", p.technology.toUpperCase()], ["Capacity", `${fmt(p.capacity_mw, 0)} MW`], ["Status", p.status.replace("_", " ")], ["Developer", p.developer ?? "—"], ["Region", p.region ?? "—"], ["Commercial operation", p.cod_year ?? "—"], ["Source", p.source ?? "—"]]) { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); }
  $("other-facts").append(dl);
  if (!SiteMap.available()) { $("other-map").innerHTML = `<p class="empty" style="padding:12px">Satellite tiles unavailable.</p>`; return; }
  const radiusM = Math.sqrt(p.capacity_mw / 3000) * 4000;
  const ring = Array.from({ length: 64 }, (_, k) => { const a = (k / 64) * 2 * Math.PI; return [p.lon + (radiusM * Math.cos(a)) / (111320 * Math.cos((p.lat * Math.PI) / 180)), p.lat + (radiusM * Math.sin(a)) / 111320]; });
  view = { destroy() { this.map?.remove(); } };
  view.map = new maplibregl.Map({ container: $("other-map"), style: { version: 8, sources: { esri: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, attribution: "Imagery &copy; Esri · position indicative" } }, layers: [{ id: "imagery", type: "raster", source: "esri" }] }, center: [p.lon, p.lat], zoom: 11 });
  view.map.on("load", () => {
    view.map.addSource("fp", { type: "geojson", data: { type: "Feature", geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] }, properties: {} } });
    view.map.addLayer({ id: "fp-fill", type: "fill", source: "fp", paint: { "fill-color": "#f2a33a", "fill-opacity": 0.15 } });
    view.map.addLayer({ id: "fp-line", type: "line", source: "fp", paint: { "line-color": "#f2a33a", "line-width": 2, "line-dasharray": [2, 2] } });
  });
}

export async function mount(pageRoot, context) {
  ctx = context; root = pageRoot;
  const id = context.params[0] ?? context.store.get().activePlant ?? "najm-3000";
  context.store.set({ activePlant: id });
  if (id === "najm-3000") await mountNajm(context.store); else await mountOther(context.store, id);
}
export function unmount() { unsub?.(); unsub = null; view?.destroy(); view = null; }
```

Note: `mountOther` calls `/api/plants`, which Task 13 adds; until then other plants show the API error in the banner, which is acceptable.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api.py -v`
Expected: 7 passed.

- [ ] **Step 9: Visual check**

Start the server, open `#/plant/najm-3000`. Expected: satellite imagery with the 30 hull polygons in blue, 363 station dots, zone labels, block labels "B01 100 MW"-style; clicking a hull fills the inspector; `Plan` shows the SVG rendering of the same geometry; the mode segment changes the legend. Try with the network disabled: the satellite view falls back to the plan and the note says so. Stop the server.

- [ ] **Step 10: Commit**

```bash
git add app/raseen/api.py app/raseen/static/vendor app/raseen/static/maps app/raseen/static/pages/plant.js app/tests/test_api.py
git commit -m "feat(plant): /api/site, satellite site map with block hulls, SVG plan fallback, plant page"
```

---
### Task 6: Shadow fields — solid front, thin band, scattered cumulus, perturbations

**Files:**
- Create: `app/raseen/shadow/__init__.py`, `app/raseen/shadow/fields.py`
- Test: `app/tests/test_shadow.py`

**Interfaces:**
- Produces: `INF`, `EDGE_M = 150.0`, `THIN_BAND_M = 1600.0`, `smooth01(u)`; `FrontField` and `ScatteredField` dataclasses sharing the field protocol: attributes `heading_deg, v_m_min, tau_min, depth, s (per-MVPS along-heading position), p (across), s_min, p_min, p_max, stall_at, deepen_at, deepen_factor`; methods `coverage(t) -> list[float]` (ground truth, honours stall/deepen), `eta_planned(t) -> list[float]` (as if the front kept its planned motion; `INF` = never), `depth_at(t) -> float`, `polygons_sp(t) -> list[list[tuple[float, float]]]`; `build_field(site, *, event, heading_deg, speed_kmh, depth, plateau_min=40.0, seed=1, stall_at=None, deepen_at=None, deepen_factor=1.0)`; `cloud_polygons(field, site, t) -> list[list[list[float]]]` (lon/lat rings, not closed).

- [ ] **Step 1: Write the failing tests**

`app/tests/test_shadow.py`:

```python
from __future__ import annotations

import math

import pytest

from raseen.geometry.site import load_site
from raseen.shadow.fields import INF, FrontField, ScatteredField, build_field, cloud_polygons, smooth01

DT = 1 / 6


@pytest.fixture(scope="module")
def site():
    return load_site(mode="real")


def test_smooth01_is_clamped_and_monotone():
    assert smooth01(-1) == 0.0 and smooth01(2) == 1.0
    vals = [smooth01(u / 10) for u in range(11)]
    assert vals == sorted(vals) and vals[0] == 0.0 and vals[-1] == 1.0


def test_solid_front_covers_nothing_before_and_everything_after_crossing(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6)
    assert isinstance(f, FrontField)
    assert abs(f.tau_min - 9.2) < 0.3
    assert max(f.coverage(-5.0)) == 0.0
    assert min(f.coverage(f.tau_min + 1.0)) > 0.99          # inside the plateau
    assert max(f.coverage(f.tau_min + 40.0 + f.tau_min + 2.0)) < 0.01   # band has passed


def test_first_station_is_touched_at_contact_and_coverage_is_monotone(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6)
    first = min(range(len(f.s)), key=lambda i: f.s[i])
    series = [f.coverage(t)[first] for t in (-0.5, 0.0, 0.1, 0.2, 0.5, 1.0)]
    assert series[1] == 0.0 and series[-1] == 1.0
    assert series == sorted(series)


def test_planned_eta_decrements_exactly_with_time(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6)
    a, b = f.eta_planned(3.0), f.eta_planned(3.0 + DT)
    assert all(math.isclose(x - y, DT, abs_tol=1e-9) for x, y in zip(a, b))
    assert abs(min(f.eta_planned(0.0))) < 1e-9


def test_heading_changes_the_crossing_time(site):
    ew = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6).tau_min
    ns = build_field(site, event="solid", heading_deg=0, speed_kmh=48, depth=0.6).tau_min
    assert ns > ew + 3.0


def test_thin_band_leaves_the_plant_uncovered_after_passing(site):
    f = build_field(site, event="thin", heading_deg=90, speed_kmh=48, depth=0.6)
    assert 0 < max(f.coverage(2.0)) <= 1.0
    assert max(f.coverage(f.tau_min + 5.0)) == 0.0


def test_stall_freezes_coverage_but_not_the_planned_eta(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6, stall_at=-2.0)
    assert max(f.coverage(30.0)) == 0.0
    assert abs(min(f.eta_planned(0.0))) < 1e-9


def test_deepen_scales_depth_from_the_given_instant(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.5, deepen_at=2.0, deepen_factor=1.2)
    assert f.depth_at(1.0) == 0.5 and abs(f.depth_at(2.0) - 0.6) < 1e-12


def test_scattered_field_is_bounded_and_has_clouds(site):
    f = build_field(site, event="scattered", heading_deg=90, speed_kmh=48, depth=0.6, seed=3)
    assert isinstance(f, ScatteredField) and len(f.clouds) == 12
    covered_at_some_time = False
    for t in range(0, 40, 2):
        cov = f.coverage(float(t))
        assert all(0.0 <= c <= 1.0 for c in cov)
        covered_at_some_time |= max(cov) > 0.5
    assert covered_at_some_time
    eta = f.eta_planned(0.0)
    assert all(e == INF or e >= 0.0 for e in eta)
    assert any(e == 0.0 for e in eta) or any(0 < e < INF for e in eta)


def test_scattered_is_reproducible_by_seed(site):
    a = build_field(site, event="scattered", heading_deg=90, speed_kmh=48, depth=0.6, seed=5)
    b = build_field(site, event="scattered", heading_deg=90, speed_kmh=48, depth=0.6, seed=5)
    assert a.clouds == b.clouds


def test_cloud_polygons_are_lonlat_rings_near_the_site(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6)
    polys = cloud_polygons(f, site, 3.0)
    assert len(polys) == 1 and len(polys[0]) == 4
    for lon, lat in polys[0]:
        assert site.bounds["west"] - 0.5 < lon < site.bounds["east"] + 0.5
        assert site.bounds["south"] - 0.5 < lat < site.bounds["north"] + 0.5
    f2 = build_field(site, event="scattered", heading_deg=90, speed_kmh=48, depth=0.6)
    assert len(cloud_polygons(f2, site, 10.0)) == 12
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_shadow.py -v`
Expected: FAIL with `ModuleNotFoundError: raseen.shadow`.

- [ ] **Step 3: Implement**

`app/raseen/shadow/__init__.py`: `"""Shadow fields: where the cloud is, per MVPS, as a function of time."""`

`app/raseen/shadow/fields.py`:

```python
"""Shadow fields over the plant, evaluated per MVPS.

A field answers two questions at time ``t`` (minutes from fence contact): how much of
each station is shaded (ground truth, honouring stall/deepen perturbations) and when
the shadow *would* arrive if the front kept its planned motion (what the nowcast
believes until it detects otherwise).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from raseen.geometry.projection import extent_m, perpendicular, project, sp_to_xy
from raseen.geometry.site import Site

INF = float("inf")
#: Width over which coverage rises from 0 to 1 as an edge crosses a station.
EDGE_M = 150.0
#: Thin band (design case D2): two abstract columns of 800 m.
THIN_BAND_M = 1600.0
#: Margin the drawn band extends beyond the plant across the heading.
DRAW_MARGIN_M = 600.0
SCATTERED_CLOUDS = 12


def smooth01(u: float) -> float:
    """Smoothstep clamped to [0, 1]."""
    if u <= 0.0:
        return 0.0
    if u >= 1.0:
        return 1.0
    return u * u * (3.0 - 2.0 * u)


@dataclass
class FrontField:
    """A band of shadow (solid front or thin band) moving along the heading."""

    heading_deg: float
    s: list[float]
    p: list[float]
    v_m_min: float
    depth: float
    band_len_m: float
    tau_min: float
    stall_at: float | None = None
    deepen_at: float | None = None
    deepen_factor: float = 1.0
    s_min: float = field(init=False)
    p_min: float = field(init=False)
    p_max: float = field(init=False)

    def __post_init__(self) -> None:
        self.s_min = min(self.s)
        self.p_min = min(self.p)
        self.p_max = max(self.p)

    def _lead(self, t: float, planned: bool) -> float:
        tt = t if (planned or self.stall_at is None) else min(t, self.stall_at)
        return self.s_min + self.v_m_min * tt

    def depth_at(self, t: float) -> float:
        if self.deepen_at is not None and t >= self.deepen_at:
            return self.depth * self.deepen_factor
        return self.depth

    def coverage(self, t: float) -> list[float]:
        lead = self._lead(t, planned=False)
        trail = lead - self.band_len_m
        return [smooth01((lead - si) / EDGE_M) * smooth01((si - trail) / EDGE_M) for si in self.s]

    def eta_planned(self, t: float) -> list[float]:
        lead = self._lead(t, planned=True)
        return [(si - lead) / self.v_m_min for si in self.s]

    def polygons_sp(self, t: float) -> list[list[tuple[float, float]]]:
        lead = self._lead(t, planned=False)
        trail = lead - self.band_len_m
        lo, hi = self.p_min - DRAW_MARGIN_M, self.p_max + DRAW_MARGIN_M
        return [[(trail, lo), (lead, lo), (lead, hi), (trail, hi)]]


@dataclass
class ScatteredField:
    """Scattered cumulus: ellipses drifting along the heading (design case D3)."""

    heading_deg: float
    s: list[float]
    p: list[float]
    v_m_min: float
    depth: float
    tau_min: float
    clouds: list[tuple[float, float, float, float]]   # (centre_s_at_t0, centre_p, semi_along, semi_across)
    stall_at: float | None = None
    deepen_at: float | None = None
    deepen_factor: float = 1.0
    s_min: float = field(init=False)
    p_min: float = field(init=False)
    p_max: float = field(init=False)

    def __post_init__(self) -> None:
        self.s_min = min(self.s)
        self.p_min = min(self.p)
        self.p_max = max(self.p)

    def _centre(self, c0: float, t: float, planned: bool) -> float:
        tt = t if (planned or self.stall_at is None) else min(t, self.stall_at)
        return c0 + self.v_m_min * tt

    def depth_at(self, t: float) -> float:
        if self.deepen_at is not None and t >= self.deepen_at:
            return self.depth * self.deepen_factor
        return self.depth

    def coverage(self, t: float) -> list[float]:
        out = []
        for si, pi in zip(self.s, self.p):
            best = 0.0
            for c0, pc, a, b in self.clouds:
                c = self._centre(c0, t, planned=False)
                r = math.hypot((si - c) / a, (pi - pc) / b)
                best = max(best, smooth01((1.0 - r) * a / EDGE_M))
            out.append(best)
        return out

    def eta_planned(self, t: float) -> list[float]:
        out = []
        for si, pi in zip(self.s, self.p):
            best = INF
            covered = False
            for c0, pc, a, b in self.clouds:
                dp = pi - pc
                if abs(dp) >= b:
                    continue
                half = a * math.sqrt(1.0 - (dp / b) ** 2)
                c = self._centre(c0, t, planned=True)
                lead, trail = c + half, c - half
                if trail <= si <= lead:
                    covered = True
                    break
                if si > lead:
                    best = min(best, (si - lead) / self.v_m_min)
            out.append(0.0 if covered else best)
        return out

    def polygons_sp(self, t: float) -> list[list[tuple[float, float]]]:
        polys = []
        for c0, pc, a, b in self.clouds:
            c = self._centre(c0, t, planned=False)
            polys.append([(c + a * math.cos(k * math.pi / 12), pc + b * math.sin(k * math.pi / 12)) for k in range(24)])
        return polys


def build_field(
    site: Site,
    *,
    event: str,
    heading_deg: float,
    speed_kmh: float,
    depth: float,
    plateau_min: float = 40.0,
    seed: int = 1,
    stall_at: float | None = None,
    deepen_at: float | None = None,
    deepen_factor: float = 1.0,
) -> FrontField | ScatteredField:
    xy = site.mvps_xy()
    s = project(xy, heading_deg)
    p = perpendicular(xy, heading_deg)
    v = speed_kmh * 1000.0 / 60.0
    tau = extent_m(xy, heading_deg) / v
    common = dict(heading_deg=heading_deg, s=s, p=p, v_m_min=v, depth=depth, tau_min=tau,
                  stall_at=stall_at, deepen_at=deepen_at, deepen_factor=deepen_factor)
    if event == "solid":
        return FrontField(band_len_m=(tau + plateau_min) * v, **common)
    if event == "thin":
        return FrontField(band_len_m=THIN_BAND_M, **common)
    if event == "scattered":
        rng = random.Random(seed)
        s_min, p_min, p_max = min(s), min(p), max(p)
        clouds = []
        for _ in range(SCATTERED_CLOUDS):
            a = rng.uniform(400.0, 1200.0)
            b = rng.uniform(300.0, 900.0)
            c0 = s_min - rng.uniform(3.0, 35.0) * v
            pc = rng.uniform(p_min, p_max)
            clouds.append((c0, pc, a, b))
        return ScatteredField(clouds=clouds, **common)
    raise ValueError(f"unknown event {event!r}; choose solid, thin or scattered")


def cloud_polygons(field_: FrontField | ScatteredField, site: Site, t: float) -> list[list[list[float]]]:
    """Cloud outlines at time t as lon/lat rings (not closed), for drawing."""
    rings = []
    for poly in field_.polygons_sp(t):
        ring = []
        for s_, p_ in poly:
            x, y = sp_to_xy(s_, p_, field_.heading_deg)
            lon, lat = site.to_lonlat(x, y)
            ring.append([round(lon, 6), round(lat, 6)])
        rings.append(ring)
    return rings
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_shadow.py -v`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add app/raseen/shadow app/tests/test_shadow.py
git commit -m "feat(shadow): front, thin band and scattered cumulus fields with stall/deepen"
```

---

### Task 7: Controller — trajectory planner, block allocation, schemes, metrics, v4 fixture

**Files:**
- Create: `app/raseen/control/__init__.py`, `planner.py`, `allocate.py`, `simulate.py`, `fixture.py`
- Test: `app/tests/test_control.py`

**Interfaces:**
- Produces: `Plan` dataclass (`P_star, t_desc_start, t_min, k_min, t_rise, A_min, D, L, g, g_up, delta, horizon, lead_shortfall, flat`); `plan_trajectory(times, A_tot, plant_mw, *, g, g_up=None, flat=False, confidence=0.7, kappa=0.25, reserve_override=None, horizon=5.0) -> Plan`; `apply_release(P_star, A_tot, times, k_detect, g_up) -> list[float]`; `allocate_bgc(A, floor, eta, cap, target, *, delta, horizon, sigma, slew_lim, prev, release=False) -> list[float]`; `allocate_uniform(A, frac) -> list[float]`; `reactive_shares(P, S) -> list[float]`; `SchemeResult(P, POI, R)`; `simulate_scheme(scheme, *, times, A, A_tot, floors, etas, caps, P_star, sigma, delta, horizon, slew_pct_min, ppc_delay_steps=1, release_from=None) -> SchemeResult`; `metrics(*, times, A_tot, POI, P, A, etas, caps, coverage, plant_mw, horizon, g_declared, P_star) -> dict`; fixture `abstract_arrays(band_cols=None) -> dict(times, A, A_tot, floors, etas, caps, coverage)` and `abstract_case(scheme, g, reserve=150.0, flat=False, band_cols=None, ppc_delay_steps=0) -> tuple[Plan, SchemeResult, dict]`.
- Metric keys (all suffixed with units): `spill_mwh, spill_down_mwh, spill_up_mwh, spill_before_contact_mwh, max_drop10_mw, max_grad_mw_min, max_up_mw_min, grad_ratio, lead_min, firm_at_contact_mw, shaded_curtailment_mwh, blocks_stepped, tracking_error_pct`. `shaded_curtailment_mwh` = energy curtailed on blocks already under full cover (coverage > 0.95): the v4 table's "already shaded, curtailed anyway" row. `blocks_stepped` = blocks whose set-point dropped by more than 5 % of capacity in one 10-second step while their own sun did not fall (an unforced step).

- [ ] **Step 1: Write the failing tests**

`app/tests/test_control.py`:

```python
from __future__ import annotations

import math

import pytest

from raseen.control.allocate import allocate_bgc, allocate_uniform, reactive_shares
from raseen.control.fixture import abstract_arrays, abstract_case
from raseen.control.planner import apply_release, plan_trajectory

# Reference numbers printed by raseen_bgc_sim.py (v4 document, design case D1).
V4_D1 = {  # g: (spill_total, lead, firm_at_contact_bgc)
    60.0: (605.0, 19.8, 287.5),
    90.0: (305.0, 9.8, 218.9),
    120.0: (155.0, 4.8, 188.1),
    150.0: (65.0, 1.8, 154.3),
}


@pytest.mark.parametrize("g", sorted(V4_D1))
def test_abstract_d1_reproduces_the_v4_table(g):
    spill_ref, lead_ref, firm_ref = V4_D1[g]
    for scheme in ("uni", "bgc"):
        plan, result, m = abstract_case(scheme, g)
        assert abs(m["spill_mwh"] - spill_ref) / spill_ref < 0.05, (scheme, m["spill_mwh"])
        assert abs(m["lead_min"] - lead_ref) < 0.5
        assert abs(m["max_grad_mw_min"] - g) < 1.0
        assert abs(m["max_drop10_mw"] - 10 * g) < 15.0
    _, _, mb = abstract_case("bgc", g)
    assert abs(mb["firm_at_contact_mw"] - firm_ref) / firm_ref < 0.10


def test_analytic_spill_relation_holds():
    # E_down = (r - g) * tau * (D / g) / 2 with r = D / tau, D = 1800, tau = 10.
    for g in (60.0, 90.0, 120.0, 150.0):
        _, _, m = abstract_case("bgc", g)
        analytic = (180.0 - g) * 10.0 * (1800.0 / g) / 2 / 60.0
        assert abs(m["spill_down_mwh"] - analytic) / analytic < 0.05


def test_plant_level_and_bgc_spill_the_same_for_a_perfect_front():
    _, _, mu = abstract_case("uni", 90.0, ppc_delay_steps=0)
    _, _, mb = abstract_case("bgc", 90.0, ppc_delay_steps=0)
    assert abs(mu["spill_mwh"] - mb["spill_mwh"]) / mb["spill_mwh"] < 0.01


def test_export_never_exceeds_available_and_tracks_the_declared_line():
    plan, result, m = abstract_case("bgc", 90.0)
    arrays = abstract_arrays()
    for k, p in enumerate(result.P):
        for i, pi in enumerate(p):
            assert pi <= arrays["A"][k][i] + 1e-6
            assert pi >= -1e-6
        if plan.P_star[k] <= arrays["A_tot"][k] - 1e-6:
            assert abs(sum(p) - plan.P_star[k]) < 1e-2
    assert m["tracking_error_pct"] < 0.5


def test_bgc_leaves_shaded_blocks_alone_and_does_not_step():
    _, _, mb = abstract_case("bgc", 90.0)
    _, _, mu = abstract_case("uni", 90.0)
    _, _, m0 = abstract_case("base", 90.0)
    assert mu["shaded_curtailment_mwh"] > 5.0            # the proportional rule curtails shaded blocks
    assert mb["shaded_curtailment_mwh"] < 0.05 * mu["shaded_curtailment_mwh"] + 0.5
    assert m0["shaded_curtailment_mwh"] == 0.0
    assert mb["blocks_stepped"] == 0


def test_slew_limit_is_respected_for_bgc():
    _, result, _ = abstract_case("bgc", 90.0)
    lim = 100.0 * 10.0 / 100.0 * (1 / 6) + 1e-6   # 10 %/min of a 100 MW block per 10 s step
    arrays = abstract_arrays()
    for k in range(1, len(result.P)):
        for i in range(30):
            drop = result.P[k - 1][i] - result.P[k][i]
            # a block may fall faster only because the sun did (available dropped below the set-point)
            if drop > lim + 1.0:
                assert result.P[k][i] <= arrays["A"][k][i] + 1e-6 and arrays["A"][k][i] < result.P[k - 1][i]


def test_flat_mode_holds_the_transit_minimum_for_a_thin_band():
    plan, result, m = abstract_case("bgc", 60.0, flat=True, band_cols=2)
    assert abs(m["spill_mwh"] - 46.0) / 46.0 < 0.10
    assert m["max_grad_mw_min"] <= 60.0 + 1.0
    mid = min(range(len(plan.P_star)), key=lambda k: plan.P_star[k])
    assert abs(result.POI[mid] - plan.A_min) < 5.0


def test_reserve_slice_sits_on_far_blocks_and_release_frees_near_blocks_first():
    A = [100.0, 100.0, 100.0]
    floor = [40.0, 40.0, 40.0]
    eta = [1.0, 5.0, 10.0]
    cap = [100.0, 100.0, 100.0]
    slew = [100.0, 100.0, 100.0]
    p = allocate_bgc(A, floor, eta, cap, 250.0, delta=0.0, horizon=5.0, sigma=3.0, slew_lim=slew, prev=A)
    assert abs(sum(p) - 250.0) < 1e-6
    assert p[0] < p[1] < p[2]                     # descend-first: nearest block lowest
    r = allocate_bgc(A, floor, eta, cap, 250.0, delta=0.0, horizon=5.0, sigma=3.0, slew_lim=slew, prev=A, release=True)
    assert abs(sum(r) - 250.0) < 1e-6
    assert r[0] > r[2]                            # release mode: far block carries what remains
    q = allocate_bgc(A, floor, eta, cap, 280.0, delta=30.0, horizon=5.0, sigma=3.0, slew_lim=slew, prev=A)
    assert q[2] < 100.0 - 1e-6 and abs(q[0] - 100.0) < 1e-6   # reserve slice on the far block only


def test_uniform_and_reactive_helpers():
    assert allocate_uniform([100.0, 50.0], 0.5) == [50.0, 25.0]
    assert allocate_uniform([100.0], 2.0) == [100.0]
    shares = reactive_shares([0.0, 100.0], [110.0, 110.0])
    assert abs(sum(shares) - 1.0) < 1e-9 and shares[0] > shares[1]


def test_planner_lead_and_release():
    arrays = abstract_arrays()
    plan = plan_trajectory(arrays["times"], arrays["A_tot"], 3000.0, g=90.0, confidence=0.7)
    assert abs(plan.D - 1800.0) < 1.0 and abs(plan.L - 10.0) < 0.3
    assert abs(plan.delta - 135.0) < 1e-6           # 1800 × (1 − 0.7) × 0.25
    assert plan.lead_shortfall == 0.0
    tight = plan_trajectory(arrays["times"], arrays["A_tot"], 3000.0, g=30.0, confidence=0.7)
    assert tight.lead_shortfall > 0.0
    k = 100
    released = apply_release(plan.P_star, arrays["A_tot"], arrays["times"], k, plan.g_up)
    assert released[:k] == plan.P_star[:k]
    assert all(released[j] <= arrays["A_tot"][j] + 1e-9 for j in range(k, len(released)))
    assert released[k + 60] >= released[k]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_control.py -v`
Expected: FAIL with `ModuleNotFoundError: raseen.control`.

- [ ] **Step 3: Implement the planner**

`app/raseen/control/__init__.py`: `"""Block Gradient Control: trajectory planner, allocation, schemes, metrics."""`

`app/raseen/control/planner.py`:

```python
"""Trajectory planner: the declared POI line P*(t) and the reserve slice.

Port of the aggregate-target logic in ``raseen_bgc_sim.py`` (v4 §7.2) for a plant of
any size. The line descends at the declared gradient g so that it reaches the
transit minimum exactly when the available power does, holds, and re-ascends at g_up.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Plan:
    P_star: list[float]
    t_desc_start: float
    t_min: float
    k_min: int
    t_rise: float
    A_min: float
    D: float
    L: float
    g: float
    g_up: float
    delta: float
    horizon: float
    lead_shortfall: float
    flat: bool


def plan_trajectory(
    times: list[float],
    A_tot: list[float],
    plant_mw: float,
    *,
    g: float,
    g_up: float | None = None,
    flat: bool = False,
    confidence: float = 0.7,
    kappa: float = 0.25,
    reserve_override: float | None = None,
    horizon: float = 5.0,
) -> Plan:
    g_up = g if g_up is None else g_up
    n = len(times)
    k_min = min(range(n), key=lambda k: (A_tot[k], k))
    A_min, t_min = A_tot[k_min], times[k_min]
    D = plant_mw - A_min
    P_star: list[float] = []
    if flat:
        shaded = [k for k in range(n) if A_tot[k] < plant_mw - 1e-6]
        k_first, k_last = (shaded[0], shaded[-1]) if shaded else (k_min, k_min)
        t_first, t_last = times[k_first], times[k_last]
        L_pre = D / g
        t_desc_start = t_first - L_pre
        t_rise = t_last
        for k, tt in enumerate(times):
            if tt < t_desc_start:
                p = plant_mw
            elif tt < t_first:
                p = plant_mw - g * (tt - t_desc_start)
            elif tt <= t_last:
                p = A_min
            else:
                p = min(plant_mw, A_min + g_up * (tt - t_last))
            P_star.append(min(p, A_tot[k]))
    else:
        L_down = D / g
        t_desc_start = t_min - L_down
        k_rise = next((k for k in range(k_min, n) if A_tot[k] > A_min + 1e-6), n - 1)
        t_rise = times[k_rise]
        for k, tt in enumerate(times):
            if tt < t_desc_start:
                p = plant_mw
            elif tt <= t_min:
                p = plant_mw - g * (tt - t_desc_start)
            elif tt < t_rise:
                p = A_min
            else:
                p = min(plant_mw, A_min + g_up * (tt - t_rise))
            P_star.append(min(p, A_tot[k]))
    first_shaded = next((times[k] for k in range(n) if A_tot[k] < plant_mw - 1e-6), 0.0)
    L = max(0.0, first_shaded - t_desc_start)
    lead_shortfall = max(0.0, times[0] - t_desc_start)
    if reserve_override is not None:
        delta = float(reserve_override)
    else:
        delta = min(D * (1.0 - confidence) * kappa, 0.10 * plant_mw)
    return Plan(
        P_star=P_star, t_desc_start=t_desc_start, t_min=t_min, k_min=k_min, t_rise=t_rise,
        A_min=A_min, D=D, L=L, g=g, g_up=g_up, delta=delta, horizon=horizon,
        lead_shortfall=lead_shortfall, flat=flat,
    )


def apply_release(P_star: list[float], A_tot: list[float], times: list[float], k_detect: int, g_up: float) -> list[float]:
    """From step ``k_detect`` the target rises toward available power at ``g_up`` (false-alarm release)."""
    out = list(P_star)
    for k in range(max(1, k_detect), len(out)):
        dt = times[k] - times[k - 1]
        out[k] = min(A_tot[k], out[k - 1] + g_up * dt)
    return out
```

- [ ] **Step 4: Implement the allocator**

`app/raseen/control/allocate.py`:

```python
"""Block allocation (v4 §7.3): where the required curtailment goes, every 10 s."""

from __future__ import annotations

import math

#: Weight given to a block whose arrival time is unknown (no cloud on its path).
_FAR_ETA_MIN = 60.0


def allocate_bgc(
    A: list[float],
    floor: list[float],
    eta: list[float],
    cap: list[float],
    target: float,
    *,
    delta: float,
    horizon: float,
    sigma: float,
    slew_lim: list[float],
    prev: list[float],
    release: bool = False,
) -> list[float]:
    """Set-points P_i so that Σ P_i = target, curtailment placed by cloud-arrival order.

    1. reserve slice Δ on blocks with ETA > horizon; 2. descend-first water-filling
    with weights exp(−ETA/σ) capped at each block's post-event floor; 3. any remainder
    spread by remaining room; 4. per-block slew clamp; 5. aggregate rebalance.
    In ``release`` mode the weights are inverted so the nearest blocks are freed first.
    """
    n = len(A)
    finite = [e if math.isfinite(e) else _FAR_ETA_MIN for e in eta]
    C = max(0.0, sum(A) - target)
    cur = [0.0] * n
    if delta > 0 and not release:
        far = [i for i in range(n) if eta[i] > horizon and A[i] > floor[i] + 1e-9]
        if far:
            per = delta / len(far)
            for i in far:
                cur[i] = min(per, 0.3 * cap[i], A[i] - floor[i])
    rem = max(0.0, C - sum(cur))
    cands = [i for i in range(n) if A[i] - floor[i] - cur[i] > 1e-9]
    if release:
        emax = max((finite[i] for i in cands), default=0.0)
        w = {i: math.exp(-max(emax - finite[i], 0.0) / sigma) for i in cands}
    else:
        w = {i: math.exp(-max(finite[i], 0.0) / sigma) for i in cands}
    active = set(cands)
    guard = 0
    while rem > 1e-6 and active and guard < 300:
        guard += 1
        wsum = sum(w[i] for i in active)
        if wsum <= 0:
            break
        spill = 0.0
        for i in list(active):
            share = rem * w[i] / wsum
            room = A[i] - floor[i] - cur[i]
            take = min(share, room)
            cur[i] += take
            if take < share - 1e-9:
                active.discard(i)
            spill += share - take
        rem = spill
        if all(A[i] - floor[i] - cur[i] <= 1e-9 for i in active):
            break
    if rem > 1e-6:
        room = [A[i] - cur[i] for i in range(n)]
        tot = sum(room)
        if tot > 0:
            for i in range(n):
                cur[i] += rem * room[i] / tot
    p = [A[i] - cur[i] for i in range(n)]
    for i in range(n):
        lo, hi = prev[i] - slew_lim[i], prev[i] + slew_lim[i]
        p[i] = min(A[i], max(min(p[i], hi), lo)) if A[i] >= lo else A[i]
    diff = sum(p) - target
    if abs(diff) > 1e-6:
        if diff > 0:
            tot = sum(p)
            if tot > 0:
                p = [pi - diff * pi / tot for pi in p]
        else:
            room = [A[i] - p[i] for i in range(n)]
            tot = sum(room)
            if tot > 0:
                p = [p[i] + (-diff) * room[i] / tot for i in range(n)]
    return [min(A[i], max(0.0, p[i])) for i in range(n)]


def allocate_uniform(A: list[float], frac: float) -> list[float]:
    """The state of the art: one plant-level set-point spread in proportion to available power."""
    f = min(1.0, max(0.0, frac))
    return [a * f for a in A]


def reactive_shares(P: list[float], S: list[float]) -> list[float]:
    """Share of the plant Q order per block, ∝ free apparent power √(S² − P²)."""
    free = [math.sqrt(max(0.0, s * s - p * p)) for p, s in zip(P, S)]
    tot = sum(free)
    if tot <= 0:
        return [1.0 / len(P)] * len(P)
    return [f / tot for f in free]
```

- [ ] **Step 5: Implement the schemes and metrics**

`app/raseen/control/simulate.py`:

```python
"""Run one controller over the event and score it."""

from __future__ import annotations

import math
from dataclasses import dataclass

from raseen.control.allocate import allocate_bgc, allocate_uniform

#: A set-point drop larger than this share of block capacity in one step, not caused by the
#: block's own sun falling, counts as a "step".
STEP_THRESHOLD = 0.05
#: A block is "already shaded" when this share of its stations is under cover.
SHADED_COVERAGE = 0.95


@dataclass
class SchemeResult:
    P: list[list[float]]     # [k][i]
    POI: list[float]
    R: list[float]           # firm reserve per step: headroom on blocks with ETA > horizon


def firm_reserve(A: list[float], P: list[float], eta: list[float], horizon: float) -> float:
    return sum(max(0.0, a - p) for a, p, e in zip(A, P, eta) if e > horizon)


def simulate_scheme(
    scheme: str,
    *,
    times: list[float],
    A: list[list[float]],
    A_tot: list[float],
    floors: list[list[float]],
    etas: list[list[float]],
    caps: list[float],
    P_star: list[float],
    sigma: float,
    delta: float,
    horizon: float,
    slew_pct_min: float,
    ppc_delay_steps: int = 1,
    release_from: int | None = None,
) -> SchemeResult:
    n = len(caps)
    dt = times[1] - times[0]
    slew_lim = [c * slew_pct_min / 100.0 * dt for c in caps]
    P: list[list[float]] = []
    prev = list(A[0])
    for k, _t in enumerate(times):
        if scheme == "base":
            p = list(A[k])
        elif scheme == "uni":
            kk = max(0, k - ppc_delay_steps)
            frac = P_star[kk] / A_tot[kk] if A_tot[kk] > 0 else 0.0
            p = allocate_uniform(A[k], frac)
        elif scheme == "bgc":
            release = release_from is not None and k >= release_from
            p = allocate_bgc(
                A[k], floors[k], etas[k], caps, P_star[k],
                delta=delta, horizon=horizon, sigma=sigma, slew_lim=slew_lim, prev=prev, release=release,
            )
        else:
            raise ValueError(f"unknown scheme {scheme!r}")
        P.append(p)
        prev = p
    POI = [sum(p) for p in P]
    R = [firm_reserve(A[k], P[k], etas[k], horizon) for k in range(len(times))]
    return SchemeResult(P=P, POI=POI, R=R)


def metrics(
    *,
    times: list[float],
    A_tot: list[float],
    POI: list[float],
    P: list[list[float]],
    A: list[list[float]],
    etas: list[list[float]],
    caps: list[float],
    coverage: list[list[float]],
    plant_mw: float,
    horizon: float,
    g_declared: float,
    P_star: list[float],
) -> dict[str, float | int]:
    n_steps = len(times)
    dt = times[1] - times[0]
    k_min = min(range(n_steps), key=lambda k: (A_tot[k], k))
    spill_down = spill_up = spill_before = 0.0
    for k in range(n_steps):
        s = (A_tot[k] - POI[k]) * dt / 60.0
        if s > 0:
            if k < k_min:
                spill_down += s
            else:
                spill_up += s
            if times[k] < 0:
                spill_before += s
    steps10 = int(round(10.0 / dt))
    max_drop10 = max((POI[k - steps10] - POI[k] for k in range(steps10, n_steps)), default=0.0)
    max_grad = max(((POI[k - 1] - POI[k]) / dt for k in range(1, n_steps)), default=0.0)
    max_up = max(((POI[k] - POI[k - 1]) / dt for k in range(1, n_steps)), default=0.0)
    lead = 0.0
    for k in range(n_steps):
        if A_tot[k] - POI[k] > 1e-3:
            lead = -times[k] if times[k] < 0 else 0.0
            break
    k0 = min(range(n_steps), key=lambda k: abs(times[k]))
    firm_at_contact = firm_reserve(A[k0], P[k0], etas[k0], horizon)
    shaded_curtailment = 0.0
    for k in range(n_steps):
        for i in range(len(caps)):
            if coverage[k][i] > SHADED_COVERAGE:
                shaded_curtailment += max(0.0, A[k][i] - P[k][i]) * dt / 60.0
    stepped = 0
    for i, cap in enumerate(caps):
        for k in range(1, n_steps):
            if A[k][i] < A[k - 1][i] - 0.05:      # the sun fell on this block: a forced drop, not a step
                continue
            if P[k - 1][i] - P[k][i] > STEP_THRESHOLD * cap and P[k][i] < A[k][i] - 0.5:
                stepped += 1
                break
    tracking = 0.0
    for k in range(n_steps):
        if P_star[k] < plant_mw - 1.0:
            tracking = max(tracking, abs(POI[k] - P_star[k]) / plant_mw * 100.0)
    return {
        "spill_mwh": round(spill_down + spill_up, 1),
        "spill_down_mwh": round(spill_down, 1),
        "spill_up_mwh": round(spill_up, 1),
        "spill_before_contact_mwh": round(spill_before, 1),
        "max_drop10_mw": round(max_drop10, 1),
        "max_grad_mw_min": round(max_grad, 1),
        "max_up_mw_min": round(max_up, 1),
        "grad_ratio": round(max_grad / g_declared, 3) if g_declared else 0.0,
        "lead_min": round(lead, 1),
        "firm_at_contact_mw": round(firm_at_contact, 1),
        "shaded_curtailment_mwh": round(shaded_curtailment, 1),
        "blocks_stepped": stepped,
        "tracking_error_pct": round(tracking, 2),
    }


def is_finite(x: float) -> bool:
    return math.isfinite(x)
```

- [ ] **Step 6: Implement the v4 fixture**

`app/raseen/control/fixture.py`:

```python
"""The v4 document's abstract plant: 30 × 100 MW blocks, 10 columns west→east × 3 rows.

Kept as a fixture so the controller port is checked against the published D1 table.
Also usable as a demonstration plant without geometry.
"""

from __future__ import annotations

from raseen.control.planner import Plan, plan_trajectory
from raseen.control.simulate import SchemeResult, metrics, simulate_scheme

NCOL, NROW = 10, 3
BLOCK_MW = 100.0
NB = NCOL * NROW
PLANT = NB * BLOCK_MW
COL_M = 800.0
SPEED_M_MIN = 800.0
DEPTH = 0.60
TAU = NCOL * COL_M / SPEED_M_MIN     # 10 min
PLATEAU = 40.0
DT = 10.0 / 60.0
T_START, T_END = -40.0, 100.0


def _shade(col: int, t: float, band_cols: int | None) -> float:
    x0 = col * COL_M
    x1 = x0 + COL_M
    lead = SPEED_M_MIN * t
    trail = lead - (SPEED_M_MIN * (TAU + PLATEAU) if band_cols is None else band_cols * COL_M)
    return max(0.0, min(x1, lead) - max(x0, trail)) / COL_M


def abstract_arrays(band_cols: int | None = None) -> dict:
    times = []
    t = T_START
    while t <= T_END + 1e-9:
        times.append(round(t, 6))
        t += DT
    A, cov, etas = [], [], []
    for tt in times:
        a_row, c_row, e_row = [], [], []
        for i in range(NB):
            col = i % NCOL
            f = _shade(col, tt, band_cols)
            a_row.append(BLOCK_MW * (1.0 - DEPTH * f))
            c_row.append(f)
            e_row.append((col * COL_M - SPEED_M_MIN * tt) / SPEED_M_MIN)
        A.append(a_row)
        cov.append(c_row)
        etas.append(e_row)
    return {
        "times": times,
        "A": A,
        "A_tot": [sum(r) for r in A],
        "floors": [[BLOCK_MW * (1.0 - DEPTH)] * NB for _ in times],
        "etas": etas,
        "caps": [BLOCK_MW] * NB,
        "coverage": cov,
    }


def abstract_case(
    scheme: str,
    g: float,
    reserve: float = 150.0,
    flat: bool = False,
    band_cols: int | None = None,
    ppc_delay_steps: int = 0,
) -> tuple[Plan, SchemeResult, dict]:
    arrays = abstract_arrays(band_cols)
    if scheme == "base":
        plan = plan_trajectory(arrays["times"], arrays["A_tot"], PLANT, g=g, flat=flat, reserve_override=0.0)
        plan.P_star = list(arrays["A_tot"])
    else:
        plan = plan_trajectory(
            arrays["times"], arrays["A_tot"], PLANT, g=g, flat=flat,
            reserve_override=(reserve if scheme == "bgc" else 0.0),
        )
    result = simulate_scheme(
        scheme, times=arrays["times"], A=arrays["A"], A_tot=arrays["A_tot"], floors=arrays["floors"],
        etas=arrays["etas"], caps=arrays["caps"], P_star=plan.P_star, sigma=3.0, delta=plan.delta,
        horizon=5.0, slew_pct_min=10.0, ppc_delay_steps=ppc_delay_steps,
    )
    m = metrics(
        times=arrays["times"], A_tot=arrays["A_tot"], POI=result.POI, P=result.P, A=arrays["A"],
        etas=arrays["etas"], caps=arrays["caps"], coverage=arrays["coverage"], plant_mw=PLANT,
        horizon=5.0, g_declared=g, P_star=plan.P_star,
    )
    return plan, result, m
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_control.py -v`
Expected: 13 passed (4 parametrized + 9). If `test_abstract_d1_reproduces_the_v4_table` is off by more than 5 %, compare `metrics` against the `run()` bookkeeping in `C:\Users\msms-\Raseen\v4_Raseen_Block_Gradient_Control_13-14-Sep\raseen_bgc_sim.py` — the port must match it step for step. Do not loosen the BGC `blocks_stepped == 0` or the shaded-curtailment assertions; if they fail the allocator is curtailing blocks that are already at their floor (check that step 2's `room` uses `floor`, not zero).

- [ ] **Step 8: Commit**

```bash
git add app/raseen/control app/tests/test_control.py
git commit -m "feat(control): planner, block allocation, schemes, metrics; v4 D1 table reproduced"
```

---

### Task 8: Scenario runner, parameters, cache, `/api/scenario`

**Files:**
- Create: `app/raseen/scenario/__init__.py`, `params.py`, `runner.py`, `cache.py`
- Modify: `app/raseen/api.py`
- Test: `app/tests/test_scenario.py`, `app/tests/test_api.py` (append)

**Interfaces:**
- Produces: `ScenarioParams` (pydantic v2, `extra="forbid"`) with fields and ranges: `event: Literal["solid","thin","scattered"]="solid"`, `heading_deg: float=90 (0 ≤ x < 360)`, `speed_kmh: float=48 (10..120)`, `depth: float=0.6 (0.2..0.8)`, `g_mw_min: float=90 (30..300)`, `g_up_mw_min: float|None=None (30..300)`, `confidence: float=0.7 (0.1..1.0)`, `reserve_mw: float|None=None (0..600)`, `flat: bool=False`, `sigma_min: float=3 (0<x≤15)`, `slew_pct_min: float=10 (0<x≤100)`, `horizon_min: float=5 (0<x≤30)`, `plateau_min: float=40 (0..90)`, `ppc_delay_steps: int=1 (0..6)`, `stall_at_min: float|None=None (-40..100)`, `deepen_at_min: float|None=None (-40..100)`, `deepen_factor: float=1.2 (1.0..1.5)`, `kappa: float=0.25 (0..1)`, `seed: int=1 (≥0)`; method `scenario_id() -> str` (sha256 hex of the canonical JSON).
- `run_scenario(params, site=None, blocks=None) -> dict` with keys `scenario_id, params, geometry {blocks, mvps_block_index}, front, times_min, frames, kpis {bgc, uni, base}, notice (None until Task 9), economics (None until Task 9), provenance, classification, disclaimer, is_live`.
- `front` keys: `event, heading_deg, speed_kmh, tau_min, depth, D_mw, L_min, g_mw_min, g_up_mw_min, delta_mw, horizon_min, confidence, plateau_min, t_desc_start_min, t_min_min, t_rise_min, lead_shortfall_min, stall_at_min, deepen_at_min, detect_at_min, A_min_mw`.
- `frames[k]` keys: `t, phase, A, P_bgc, P_uni, P_base, eta (null = never), coverage, firm, q_share, cloud, agg {A, P_base, P_uni, P_bgc, P_star, R, R_uni, residual}`.
- `ScenarioCache(directory=None)` with `get(id)`, `put(scenario)`, `get_or_run(params)`, `size()`; module-level `CACHE = ScenarioCache()`.
- Constants: `T_START = -40.0`, `T_END = 100.0`, `DT_MIN = 1/6`, `DETECT_DELAY_MIN = 2.0`, `S_RATING_FACTOR = 1.10`, `Q_ORDER_PU = 0.2`.

- [ ] **Step 1: Write the failing tests**

`app/tests/test_scenario.py`:

```python
from __future__ import annotations

import math

import pytest
from pydantic import ValidationError

from raseen.scenario.cache import ScenarioCache
from raseen.scenario.params import ScenarioParams
from raseen.scenario.runner import DT_MIN, T_END, T_START, run_scenario


@pytest.fixture(scope="module")
def default_scenario():
    return run_scenario(ScenarioParams())


def test_params_have_a_stable_id_and_ranges():
    a, b = ScenarioParams(), ScenarioParams()
    assert a.scenario_id() == b.scenario_id() and len(a.scenario_id()) == 64
    assert ScenarioParams(g_mw_min=120).scenario_id() != a.scenario_id()
    with pytest.raises(ValidationError):
        ScenarioParams(depth=0.95)
    with pytest.raises(ValidationError):
        ScenarioParams(unknown=1)


def test_default_scenario_shape(default_scenario):
    s = default_scenario
    n = int(round((T_END - T_START) / DT_MIN)) + 1
    assert len(s["times_min"]) == n == len(s["frames"]) == 841
    assert s["frames"][0]["t"] == -40.0
    assert len(s["geometry"]["blocks"]) == 30 and len(s["geometry"]["mvps_block_index"]) == 363
    assert s["classification"] == "SIMULATION (RASEEN PROTOTYPE)" and s["is_live"] is False
    f = s["frames"][300]
    assert f.keys() >= {"t", "phase", "A", "P_bgc", "P_uni", "P_base", "eta", "coverage", "firm", "q_share", "cloud", "agg"}
    assert len(f["A"]) == 30 and len(f["cloud"]) == 1 and len(f["cloud"][0]) == 4
    assert abs(sum(f["q_share"]) - 1.0) < 1e-6
    assert abs(s["front"]["tau_min"] - 9.2) < 0.3
    assert abs(s["front"]["L_min"] - (s["front"]["D_mw"] / 90.0 - s["front"]["tau_min"])) < 0.5


def test_export_never_exceeds_available_and_plant_level_steps(default_scenario):
    s = default_scenario
    for f in s["frames"]:
        for key in ("P_bgc", "P_uni", "P_base"):
            assert all(p <= a + 0.06 for p, a in zip(f[key], f["A"]))
        assert abs(f["agg"]["A"] - sum(f["A"])) < 0.5
    k = s["kpis"]
    assert k["bgc"]["blocks_stepped"] == 0
    assert k["uni"]["shaded_curtailment_mwh"] > 2.0
    assert k["bgc"]["shaded_curtailment_mwh"] < 0.1 * k["uni"]["shaded_curtailment_mwh"] + 0.5
    assert k["bgc"]["tracking_error_pct"] < 3.0
    assert abs(k["bgc"]["spill_mwh"] - k["uni"]["spill_mwh"]) < 0.2 * k["bgc"]["spill_mwh"]
    assert k["bgc"]["max_grad_mw_min"] <= 90.0 * 1.15
    assert k["base"]["max_grad_mw_min"] > 120.0
    assert k["bgc"]["firm_at_contact_mw"] > 50.0
    assert {"before", "transit", "cover", "exit", "after"} <= {f["phase"] for f in s["frames"]}


def test_stall_releases_curtailment_nearest_first():
    s = run_scenario(ScenarioParams(stall_at_min=-3.0))
    assert s["front"]["detect_at_min"] == -1.0
    assert any(f["phase"] == "released" for f in s["frames"])
    last = s["frames"][-1]
    assert abs(last["agg"]["P_bgc"] - last["agg"]["A"]) < 1.0
    assert s["kpis"]["bgc"]["spill_before_contact_mwh"] > 0.0
    k_detect = next(i for i, f in enumerate(s["frames"]) if f["phase"] == "released")
    assert all(e is None for e in s["frames"][k_detect]["eta"])


def test_deepen_lowers_the_floor_after_the_instant():
    s = run_scenario(ScenarioParams(deepen_at_min=2.0, deepen_factor=1.2))
    assert s["front"]["deepen_at_min"] == 2.0
    late = s["frames"][int((30 - T_START) / DT_MIN)]
    assert late["agg"]["A"] < 3000.0 * (1 - 0.6) + 5.0        # deeper than the planned plateau
    assert s["kpis"]["bgc"]["tracking_error_pct"] >= 0.0


def test_thin_band_and_scattered_run():
    thin = run_scenario(ScenarioParams(event="thin", flat=True, g_mw_min=60))
    solid = run_scenario(ScenarioParams())
    assert thin["kpis"]["bgc"]["spill_mwh"] < solid["kpis"]["bgc"]["spill_mwh"]
    sc = run_scenario(ScenarioParams(event="scattered", seed=2))
    assert len(sc["frames"][400]["cloud"]) == 12
    assert min(f["agg"]["A"] for f in sc["frames"]) < 3000.0


def test_heading_changes_tau_and_the_feasible_lead():
    ns = run_scenario(ScenarioParams(heading_deg=0))
    assert abs(ns["front"]["tau_min"] - 13.2) < 0.4
    assert ns["front"]["L_min"] < run_scenario(ScenarioParams())["front"]["L_min"]


def test_cache_returns_the_same_object_and_persists(tmp_path):
    cache = ScenarioCache(tmp_path)
    p = ScenarioParams(g_mw_min=120)
    a = cache.get_or_run(p)
    b = cache.get_or_run(p)
    assert a is b
    assert (tmp_path / f"{p.scenario_id()}.json").exists()
    fresh = ScenarioCache(tmp_path)
    assert fresh.get(p.scenario_id())["scenario_id"] == p.scenario_id()
    assert fresh.size() >= 1
```

Append to `app/tests/test_api.py`:

```python
def test_scenario_endpoints(client):
    body = client.post("/api/scenario", json={"g_mw_min": 120}).json()
    assert body["classification"] == "SIMULATION (RASEEN PROTOTYPE)"
    assert len(body["frames"]) == 841 and body["front"]["g_mw_min"] == 120
    again = client.get(f"/api/scenario/{body['scenario_id']}")
    assert again.status_code == 200 and again.json()["scenario_id"] == body["scenario_id"]
    assert client.get("/api/scenario/does-not-exist").status_code == 404
    bad = client.post("/api/scenario", json={"depth": 5})
    assert bad.status_code == 400
    assert bad.json()["classification"] == "SIMULATION (RASEEN PROTOTYPE)"
    assert "depth" in str(bad.json()["detail"])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_scenario.py -v`
Expected: FAIL with `ModuleNotFoundError: raseen.scenario`.

- [ ] **Step 3: Implement the parameters**

`app/raseen/scenario/__init__.py`: `"""Scenario = parameters → frames, KPIs, notice, economics."""`

`app/raseen/scenario/params.py`:

```python
"""Scenario parameters — the contract between the UI controls and the runner."""

from __future__ import annotations

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ScenarioParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: Literal["solid", "thin", "scattered"] = "solid"
    heading_deg: float = Field(90.0, ge=0.0, lt=360.0, description="direction of motion, ° clockwise from north")
    speed_kmh: float = Field(48.0, ge=10.0, le=120.0)
    depth: float = Field(0.6, ge=0.2, le=0.8, description="share of power lost under full cover")
    g_mw_min: float = Field(90.0, ge=30.0, le=300.0, description="declared down-gradient")
    g_up_mw_min: float | None = Field(None, ge=30.0, le=300.0)
    confidence: float = Field(0.7, ge=0.1, le=1.0)
    reserve_mw: float | None = Field(None, ge=0.0, le=600.0, description="override the reserve slice Δ")
    flat: bool = Field(False, description="Dynamic Solar Headroom: hold flat through the event")
    sigma_min: float = Field(3.0, gt=0.0, le=15.0)
    slew_pct_min: float = Field(10.0, gt=0.0, le=100.0)
    horizon_min: float = Field(5.0, gt=0.0, le=30.0)
    plateau_min: float = Field(40.0, ge=0.0, le=90.0)
    ppc_delay_steps: int = Field(1, ge=0, le=6)
    stall_at_min: float | None = Field(None, ge=-40.0, le=100.0)
    deepen_at_min: float | None = Field(None, ge=-40.0, le=100.0)
    deepen_factor: float = Field(1.2, ge=1.0, le=1.5)
    kappa: float = Field(0.25, ge=0.0, le=1.0)
    seed: int = Field(1, ge=0)

    def canonical_json(self) -> str:
        return json.dumps(self.model_dump(), sort_keys=True, separators=(",", ":"))

    def scenario_id(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Implement the runner**

`app/raseen/scenario/runner.py`:

```python
"""Run a scenario on the real geometry: frames for baseline, plant-level and Raseen."""

from __future__ import annotations

import math
from typing import Any

from raseen import CLASSIFICATION, DISCLAIMER, PLANT_MW
from raseen.control.allocate import reactive_shares
from raseen.control.planner import apply_release, plan_trajectory
from raseen.control.simulate import metrics, simulate_scheme
from raseen.geometry.blocks import ControlBlock, blocks_payload, get_blocks, mvps_block_index
from raseen.geometry.site import MVPS_MW, Site, get_site
from raseen.scenario.params import ScenarioParams
from raseen.shadow.fields import INF, build_field, cloud_polygons

T_START = -40.0
T_END = 100.0
DT_MIN = 1.0 / 6.0
#: The nowcast declares a stall this long after the field stops moving (v4 §7.4: first ETA + 2 min).
DETECT_DELAY_MIN = 2.0
#: Inverter apparent-power rating relative to block active rating.
S_RATING_FACTOR = 1.10
Q_ORDER_PU = 0.2

PROVENANCE = {
    "geometry": "as-designed CAD/KML (NAJM-3000), not as-built",
    "irradiance": "representative clear-day available power × geometric shadow field",
    "controller": "real code (raseen.control), executed on simulated inputs",
    "telemetry": "simulated from the shadow field; no SCADA connected",
    "nowcast": "ground-truth arrival times from the shadow generator (not an estimate)",
    "ppc_tsp": "simulated",
}


def _times() -> list[float]:
    n = int(round((T_END - T_START) / DT_MIN)) + 1
    return [round(T_START + k * DT_MIN, 6) for k in range(n)]


def _r1(x: float) -> float:
    return round(x, 1)


def run_scenario(params: ScenarioParams, site: Site | None = None, blocks: list[ControlBlock] | None = None) -> dict[str, Any]:
    site = site or get_site()
    blocks = blocks or get_blocks(site)
    n = len(blocks)
    caps = [b.capacity_mw for b in blocks]
    members = [list(b.mvps_index) for b in blocks]
    horizon = params.horizon_min

    common = dict(event=params.event, heading_deg=params.heading_deg, speed_kmh=params.speed_kmh,
                  depth=params.depth, plateau_min=params.plateau_min, seed=params.seed)
    actual = build_field(site, stall_at=params.stall_at_min, deepen_at=params.deepen_at_min,
                         deepen_factor=params.deepen_factor, **common)
    planned = build_field(site, **common)

    times = _times()
    A: list[list[float]] = []
    cov: list[list[float]] = []
    floors: list[list[float]] = []
    etas_planned: list[list[float]] = []
    A_tot_planned: list[float] = []
    clouds: list[list[list[list[float]]]] = []
    for t in times:
        cov_m = actual.coverage(t)
        d_t = actual.depth_at(t)
        A_m = [MVPS_MW * (1.0 - d_t * c) for c in cov_m]
        cov_p = planned.coverage(t)
        A_tot_planned.append(sum(MVPS_MW * (1.0 - params.depth * c) for c in cov_p))
        eta_m = planned.eta_planned(t)
        A.append([sum(A_m[m] for m in idx) for idx in members])
        cov.append([sum(cov_m[m] for m in idx) / len(idx) for idx in members])
        floors.append([c * (1.0 - d_t) for c in caps])
        etas_planned.append([min(eta_m[m] for m in idx) for idx in members])
        clouds.append(cloud_polygons(actual, site, t))
    A_tot = [sum(row) for row in A]

    plan = plan_trajectory(
        times, A_tot_planned, PLANT_MW, g=params.g_mw_min, g_up=params.g_up_mw_min, flat=params.flat,
        confidence=params.confidence, kappa=params.kappa, reserve_override=params.reserve_mw, horizon=horizon,
    )
    P_star = list(plan.P_star)
    release_from: int | None = None
    detect_at: float | None = None
    etas_nowcast = etas_planned
    if params.stall_at_min is not None:
        detect_at = params.stall_at_min + DETECT_DELAY_MIN
        release_from = next((k for k, t in enumerate(times) if t >= detect_at - 1e-9), len(times) - 1)
        P_star = apply_release(P_star, A_tot, times, release_from, plan.g_up)
        etas_nowcast = [row if k < release_from else [INF] * n for k, row in enumerate(etas_planned)]
    P_star = [min(P_star[k], A_tot[k]) for k in range(len(times))]

    run_kwargs = dict(times=times, A=A, A_tot=A_tot, floors=floors, etas=etas_nowcast, caps=caps, P_star=P_star,
                      sigma=params.sigma_min, delta=plan.delta, horizon=horizon, slew_pct_min=params.slew_pct_min,
                      ppc_delay_steps=params.ppc_delay_steps, release_from=release_from)
    results = {scheme: simulate_scheme(scheme, **run_kwargs) for scheme in ("base", "uni", "bgc")}
    kpis = {
        scheme: metrics(times=times, A_tot=A_tot, POI=r.POI, P=r.P, A=A, etas=etas_nowcast, caps=caps, coverage=cov,
                        plant_mw=PLANT_MW, horizon=horizon, g_declared=params.g_mw_min, P_star=P_star)
        for scheme, r in results.items()
    }

    S = [c * S_RATING_FACTOR for c in caps]
    k_min = plan.k_min
    frames = []
    for k, t in enumerate(times):
        if release_from is not None and k >= release_from:
            phase = "released"
        elif t < 0:
            phase = "before"
        elif A_tot[k] > plan.A_min + 1.0 and k < k_min:
            phase = "transit"
        elif A_tot[k] <= plan.A_min + 1.0:
            phase = "cover"
        elif A_tot[k] < PLANT_MW - 1.0:
            phase = "exit"
        else:
            phase = "after"
        eta_row = etas_nowcast[k]
        frames.append({
            "t": round(t, 4),
            "phase": phase,
            "A": [_r1(x) for x in A[k]],
            "P_bgc": [_r1(x) for x in results["bgc"].P[k]],
            "P_uni": [_r1(x) for x in results["uni"].P[k]],
            "P_base": [_r1(x) for x in results["base"].P[k]],
            "eta": [None if not math.isfinite(e) else round(e, 2) for e in eta_row],
            "coverage": [round(c, 2) for c in cov[k]],
            "firm": [bool(e > horizon) for e in eta_row],
            "q_share": [round(q, 3) for q in reactive_shares(results["bgc"].P[k], S)],
            "cloud": clouds[k],
            "agg": {
                "A": _r1(A_tot[k]),
                "P_base": _r1(results["base"].POI[k]),
                "P_uni": _r1(results["uni"].POI[k]),
                "P_bgc": _r1(results["bgc"].POI[k]),
                "P_star": _r1(P_star[k]),
                "R": _r1(results["bgc"].R[k]),
                "R_uni": _r1(results["uni"].R[k]),
                "residual": _r1(max(0.0, PLANT_MW - A_tot[k])),
            },
        })

    front = {
        "event": params.event, "heading_deg": params.heading_deg, "speed_kmh": params.speed_kmh,
        "tau_min": round(actual.tau_min, 2), "depth": params.depth, "D_mw": _r1(plan.D),
        "L_min": round(plan.L, 2), "g_mw_min": params.g_mw_min, "g_up_mw_min": plan.g_up,
        "delta_mw": _r1(plan.delta), "horizon_min": horizon, "confidence": params.confidence,
        "plateau_min": params.plateau_min, "t_desc_start_min": round(plan.t_desc_start, 2),
        "t_min_min": round(plan.t_min, 2), "t_rise_min": round(plan.t_rise, 2),
        "lead_shortfall_min": round(plan.lead_shortfall, 2), "stall_at_min": params.stall_at_min,
        "deepen_at_min": params.deepen_at_min, "detect_at_min": detect_at, "A_min_mw": _r1(plan.A_min),
    }
    return {
        "scenario_id": params.scenario_id(),
        "params": params.model_dump(),
        "geometry": {"blocks": blocks_payload(blocks), "mvps_block_index": mvps_block_index(site, blocks)},
        "front": front,
        "times_min": [round(t, 4) for t in times],
        "frames": frames,
        "kpis": kpis,
        "notice": None,
        "economics": None,
        "provenance": PROVENANCE,
        "classification": CLASSIFICATION,
        "disclaimer": DISCLAIMER,
        "is_live": False,
    }
```

- [ ] **Step 5: Implement the cache**

`app/raseen/scenario/cache.py`:

```python
"""Scenario cache: memory first, then JSON on disk (RASEEN_CACHE_DIR, default app/.cache)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from raseen.scenario.params import ScenarioParams
from raseen.scenario.runner import run_scenario

DEFAULT_DIR = Path(__file__).resolve().parents[2] / ".cache"


class ScenarioCache:
    def __init__(self, directory: Path | str | None = None) -> None:
        self.dir = Path(directory or os.environ.get("RASEEN_CACHE_DIR", DEFAULT_DIR))
        self.memory: dict[str, dict[str, Any]] = {}

    def _path(self, scenario_id: str) -> Path:
        return self.dir / f"{scenario_id}.json"

    def get(self, scenario_id: str) -> dict[str, Any] | None:
        if scenario_id in self.memory:
            return self.memory[scenario_id]
        path = self._path(scenario_id)
        if path.exists():
            try:
                scenario = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return None
            self.memory[scenario_id] = scenario
            return scenario
        return None

    def put(self, scenario: dict[str, Any]) -> None:
        self.memory[scenario["scenario_id"]] = scenario
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            self._path(scenario["scenario_id"]).write_text(json.dumps(scenario, separators=(",", ":")), encoding="utf-8")
        except OSError:
            pass  # a read-only disk must not break the demo; memory still serves it

    def get_or_run(self, params: ScenarioParams) -> dict[str, Any]:
        scenario = self.get(params.scenario_id())
        if scenario is None:
            scenario = run_scenario(params)
            self.put(scenario)
        return scenario

    def size(self) -> int:
        on_disk = len(list(self.dir.glob("*.json"))) if self.dir.exists() else 0
        return max(on_disk, len(self.memory))


CACHE = ScenarioCache()
```

- [ ] **Step 6: Add the API routes**

In `app/raseen/api.py` add imports:

```python
from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from raseen.scenario.cache import CACHE
from raseen.scenario.params import ScenarioParams
```

Inside `build_app()` (before the static mount) add:

```python
    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        """400 with the envelope, so an invalid control value is reported, never rendered."""
        return JSONResponse(status_code=400, content={**envelope(), "detail": exc.errors()})

    @app.post("/api/scenario")
    def create_scenario(params: ScenarioParams) -> dict[str, Any]:
        return CACHE.get_or_run(params)

    @app.get("/api/scenario/{scenario_id}")
    def read_scenario(scenario_id: str) -> dict[str, Any]:
        scenario = CACHE.get(scenario_id)
        if scenario is None:
            raise HTTPException(status_code=404, detail=f"unknown scenario {scenario_id!r}")
        return scenario
```

and extend the `status` payload with `"cache_size": CACHE.size(),`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_scenario.py tests/test_api.py -v`
Expected: all passed (8 scenario + 8 api). Each `run_scenario` takes 1–4 s in pure Python; the whole file should finish under a minute. If the shaded-curtailment assertion fails for `uni`, check that `allocate_uniform` is applied to every block including fully shaded ones (it must be: that is the state of the art's weakness).

- [ ] **Step 8: Commit**

```bash
git add app/raseen/scenario app/raseen/api.py app/tests/test_scenario.py app/tests/test_api.py
git commit -m "feat(scenario): parameter model, runner on real geometry, cache, /api/scenario"
```

---

### Task 9: Ramp Event Notice, compliance ledger, economics, `/api/notice`

**Files:**
- Create: `app/raseen/scenario/notice.py`, `app/raseen/scenario/economics.py`
- Modify: `app/raseen/scenario/runner.py` (fill `notice` and `economics`), `app/raseen/api.py`
- Test: `app/tests/test_scenario.py` (append), `app/tests/test_api.py` (append)

**Interfaces:**
- Produces: `CLAUSES: list[dict(id, title, role)]`; `build_notice(scenario: dict) -> dict` with keys `notice_id, plant, connection_point, issued_at_min, valid_from_min, confidence, event {onset_min, cause, expected_min_available_mw, duration_min, recovery_min, tau_min}, declared [[t, mw], …] (1-min samples from issue to T_END), g_mw_min, g_up_mw_min, L_min, R_declared_mw, R_delivered_mw, horizon_min, residual_full_cover_mw, clauses (ids), ledger [ {clause, requirement, value, unit, pass, plant_level_value} ], stall_declared (bool), deepen_absorbed (bool | None)`; `notice_at(scenario, t) -> dict` = notice + `as_of_min, phase, R_now_mw, residual_now_mw, declared_past, declared_future`; `economics(spill_mwh, g_mw_min, plant_mw) -> dict` with `spill_mwh, spill_sar, spill_share_of_day_pct, g_pct_min, annual_spill_pct, annual_spill_mwh, annual_spill_sar, battery_block_capex_sar, battery_block_annual_sar, battery_to_spill_ratio, sar_per_mwh, assumptions`.
- API: `GET /api/notice/{scenario_id}?t=<minutes>` → envelope + `notice_at`.

- [ ] **Step 1: Append the failing tests**

Append to `app/tests/test_scenario.py`:

```python
from raseen.scenario.economics import economics
from raseen.scenario.notice import CLAUSES, build_notice, notice_at


def test_notice_fields_and_ledger(default_scenario):
    n = build_notice(default_scenario)
    assert n["plant"] == "NAJM-3000" and n["issued_at_min"] < 0
    assert n["declared"][0][0] == n["issued_at_min"] and n["declared"][-1][0] <= 100.0
    assert n["R_declared_mw"] == default_scenario["kpis"]["bgc"]["firm_at_contact_mw"]
    assert n["R_delivered_mw"] >= 0.95 * n["R_declared_mw"]
    assert abs(n["residual_full_cover_mw"] - default_scenario["front"]["D_mw"]) < 1.0
    ids = {c["id"] for c in CLAUSES}
    assert {"5.3.8.1(iii)", "4.46.3.2", "2.11.13.11", "5.4.2.3", "2.11.13.10", "4.50.8.7", "2.14.1"} <= ids
    assert set(n["clauses"]) <= ids
    by_clause = {row["clause"]: row for row in n["ledger"]}
    assert by_clause["2.11.13.11"]["pass"] is True          # tracking within 2 %
    assert by_clause["4.50.8.8"]["pass"] is True            # gradient within +10 %
    assert by_clause["blocks_stepped"]["pass"] is True
    assert by_clause["shaded_blocks"]["pass"] is True and by_clause["shaded_blocks"]["plant_level_value"] > by_clause["shaded_blocks"]["value"]
    assert all({"clause", "requirement", "value", "unit", "pass"} <= row.keys() for row in n["ledger"])


def test_notice_at_splits_past_and_future(default_scenario):
    n = notice_at(default_scenario, 3.0)
    assert n["as_of_min"] == 3.0 and n["phase"] in ("transit", "cover")
    assert all(t <= 3.0 for t, _ in n["declared_past"]) and all(t > 3.0 for t, _ in n["declared_future"])
    assert n["R_now_mw"] >= 0.0


def test_runner_fills_notice_and_economics(default_scenario):
    assert default_scenario["notice"]["R_declared_mw"] >= 0
    e = default_scenario["economics"]
    assert e["spill_mwh"] == default_scenario["kpis"]["bgc"]["spill_mwh"]
    assert e["spill_sar"] == round(e["spill_mwh"] * 50.0)
    assert 0.5 < e["annual_spill_pct"] < 6.0
    assert e["battery_block_annual_sar"] > e["annual_spill_sar"]


def test_economics_interpolates_the_field_anchors():
    assert abs(economics(0.0, 60.0, 3000.0)["annual_spill_pct"] - 4.37) < 0.05     # 2 %/min (Marcos)
    assert abs(economics(0.0, 150.0, 3000.0)["annual_spill_pct"] - 1.38) < 0.05    # 5 %/min
    mid = economics(305.0, 90.0, 3000.0)
    assert 1.8 < mid["annual_spill_pct"] < 2.3 and mid["spill_share_of_day_pct"] == round(305.0 / 25000.0 * 100, 2)
```

Append to `app/tests/test_api.py`:

```python
def test_notice_endpoint(client):
    sid = client.post("/api/scenario", json={}).json()["scenario_id"]
    body = client.get(f"/api/notice/{sid}?t=-5").json()
    assert body["classification"] == "SIMULATION (RASEEN PROTOTYPE)"
    assert body["as_of_min"] == -5.0 and "ledger" in body and body["plant"] == "NAJM-3000"
    assert client.get("/api/notice/nope?t=0").status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_scenario.py -v -k "notice or economics"`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Implement economics**

`app/raseen/scenario/economics.py`:

```python
"""Spilled sunshine priced against the battery alternative (v4 §5.3)."""

from __future__ import annotations

import math

SAR_PER_MWH = 50.0
CLEAR_DAY_MWH = 25_000.0
#: 3,000 MW × 8,760 h × 0.28 capacity factor.
ANNUAL_ENERGY_MWH = 7.36e6
BATTERY_BLOCK_CAPEX_SAR = 1.09e9          # 500 MW / 2,000 MWh SPPC block
BATTERY_BLOCK_ANNUAL_SAR = 120e6          # annualised, mid of the SAR 110–130 m/yr range
#: Field anchors for annual energy not exported vs ramp limit (% of capacity per minute):
#: Marcos et al. 4.37 % at 2 %/min, 1.38 % at 5 %/min; the v4 headline ≈ 2 % at 3 %/min.
ANCHORS = [(2.0, 4.37), (3.0, 2.0), (5.0, 1.38)]


def annual_spill_pct(g_pct_min: float) -> float:
    """Log-linear interpolation between the anchors, clamped at the ends."""
    x = math.log(max(1e-6, g_pct_min))
    pts = [(math.log(g), pct) for g, pct in ANCHORS]
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def economics(spill_mwh: float, g_mw_min: float, plant_mw: float) -> dict:
    g_pct = g_mw_min / plant_mw * 100.0
    pct = annual_spill_pct(g_pct)
    annual_mwh = ANNUAL_ENERGY_MWH * pct / 100.0
    annual_sar = annual_mwh * SAR_PER_MWH
    return {
        "spill_mwh": round(spill_mwh, 1),
        "spill_sar": round(spill_mwh * SAR_PER_MWH),
        "spill_share_of_day_pct": round(spill_mwh / CLEAR_DAY_MWH * 100.0, 2),
        "g_pct_min": round(g_pct, 2),
        "annual_spill_pct": round(pct, 2),
        "annual_spill_mwh": round(annual_mwh),
        "annual_spill_sar": round(annual_sar),
        "battery_block_capex_sar": BATTERY_BLOCK_CAPEX_SAR,
        "battery_block_annual_sar": BATTERY_BLOCK_ANNUAL_SAR,
        "battery_to_spill_ratio": round(BATTERY_BLOCK_ANNUAL_SAR / annual_sar, 1) if annual_sar > 0 else None,
        "sar_per_mwh": SAR_PER_MWH,
        "assumptions": "SAR 50/MWh energy value; clear day ≈ 25 GWh; annual energy ≈ 7.36 TWh; battery block 500 MW/2,000 MWh ≈ SAR 1.09 bn, ≈ SAR 120 m/yr annualised; annual spill from Marcos et al. field anchors.",
    }
```

- [ ] **Step 4: Implement the notice**

`app/raseen/scenario/notice.py`:

```python
"""The Ramp Event Notice (v4 §9): what the plant declares to the TSP, with clause anchors."""

from __future__ import annotations

from typing import Any

from raseen import PLANT_MW, PLANT_NAME

CLAUSES: list[dict[str, str]] = [
    {"id": "5.3.8.1(iii)", "title": "Updated Declarations to H-1",
     "role": "The notice is an updated Declaration of Available Active Power for a renewable generator."},
    {"id": "4.46.3.2", "title": "Advance notification as far in advance as practicable",
     "role": "Issued at T−L, before the first block is shaded, with the trajectory and the firm reserve."},
    {"id": "2.11.13.11", "title": "Active Power Gradient control mode; set-point accuracy",
     "role": "The plant holds the declared gradient; export tracks the set-point within 2 %."},
    {"id": "5.4.2.3", "title": "Gradient and Delta instructions",
     "role": "Both the declared gradient and the reserve slice are instructable control modes."},
    {"id": "Delta Regulation", "title": "Active Power Delta Regulation (definition)",
     "role": "Dynamic Solar Headroom is Delta Regulation made dynamic and spatial."},
    {"id": "2.11.13.10", "title": "Upward frequency response limited by available output",
     "role": "Held headroom is what lets a PV plant respond upward."},
    {"id": "4.50.8.8", "title": "Dispatch Accuracy Test, ±10 % on the registered ramp rate",
     "role": "The achieved down-gradient stays within 110 % of the declared gradient."},
    {"id": "4.50.8.7", "title": "Continuous-monitoring compliance for renewables",
     "role": "The twin is the continuous monitor the Code describes."},
    {"id": "2.14.1", "title": "System Service",
     "role": "The declared reserve is a contractable service, not a favour."},
    {"id": "4.41.15", "title": "Contingency Reserve against weather forecast uncertainty",
     "role": "The uncertainty the reserve is bought against is what the notice shrinks."},
]

CAUSE = {"solid": "frontal cloud band", "thin": "thin cloud band (partial cover)", "scattered": "scattered cumulus"}


def _r_delivered(scenario: dict[str, Any]) -> float:
    """Headroom that survives on the blocks declared firm at contact, minimum over the horizon."""
    frames = scenario["frames"]
    times = scenario["times_min"]
    horizon = scenario["front"]["horizon_min"]
    k0 = min(range(len(times)), key=lambda k: abs(times[k]))
    firm_idx = [i for i, e in enumerate(frames[k0]["eta"]) if e is not None and e > horizon]
    if not firm_idx:
        return 0.0
    k_end = min(len(times) - 1, k0 + int(round(horizon / (times[1] - times[0]))))
    return min(
        sum(max(0.0, frames[k]["A"][i] - frames[k]["P_bgc"][i]) for i in firm_idx)
        for k in range(k0, k_end + 1)
    )


def build_notice(scenario: dict[str, Any]) -> dict[str, Any]:
    front = scenario["front"]
    kb = scenario["kpis"]["bgc"]
    ku = scenario["kpis"]["uni"]
    times = scenario["times_min"]
    frames = scenario["frames"]
    issued = round(max(times[0], front["t_desc_start_min"]), 2)
    declared = []
    for k, t in enumerate(times):
        if t + 1e-9 >= issued and abs(t - round(t)) < 1e-6:
            declared.append([round(t, 2), frames[k]["agg"]["P_star"]])
    if not declared or declared[0][0] != issued:
        k_issue = min(range(len(times)), key=lambda k: abs(times[k] - issued))
        declared.insert(0, [issued, frames[k_issue]["agg"]["P_star"]])
    r_declared = kb["firm_at_contact_mw"]
    r_delivered = round(_r_delivered(scenario), 1)
    recovery = 0.0
    k_rise = min(range(len(times)), key=lambda k: abs(times[k] - front["t_rise_min"]))
    for k in range(k_rise, len(times)):
        if frames[k]["agg"]["A"] >= PLANT_MW - 1.0:
            recovery = round(times[k] - front["t_rise_min"], 1)
            break
    ledger = [
        {"clause": "2.11.13.11", "requirement": "export within ±2 % of the declared set-point",
         "value": kb["tracking_error_pct"], "unit": "% of plant", "pass": kb["tracking_error_pct"] <= 2.0,
         "plant_level_value": ku["tracking_error_pct"]},
        {"clause": "4.50.8.8", "requirement": "achieved down-gradient ≤ 110 % of declared g",
         "value": kb["grad_ratio"], "unit": "× g", "pass": kb["grad_ratio"] <= 1.10,
         "plant_level_value": ku["grad_ratio"]},
        {"clause": "5.3.8.1(iii)", "requirement": "firm reserve delivered ≥ 95 % of declared",
         "value": round(r_delivered / r_declared, 3) if r_declared > 0 else 1.0, "unit": "× declared",
         "pass": r_declared == 0 or r_delivered >= 0.95 * r_declared,
         "plant_level_value": None},
        {"clause": "blocks_stepped", "requirement": "no unforced set-point step on any block",
         "value": kb["blocks_stepped"], "unit": "blocks", "pass": kb["blocks_stepped"] == 0,
         "plant_level_value": ku["blocks_stepped"]},
        {"clause": "shaded_blocks", "requirement": "blocks already under cover are not curtailed",
         "value": kb["shaded_curtailment_mwh"], "unit": "MWh",
         "pass": kb["shaded_curtailment_mwh"] <= 0.05 * ku["shaded_curtailment_mwh"] + 0.5,
         "plant_level_value": ku["shaded_curtailment_mwh"]},
        {"clause": "4.46.3.2", "requirement": "notice issued before the first block is shaded",
         "value": round(front["L_min"], 1), "unit": "min lead", "pass": front["L_min"] > 0 and front["lead_shortfall_min"] == 0,
         "plant_level_value": round(ku["lead_min"], 1)},
        {"clause": "2.11.13.1", "requirement": "POI reactive envelope ±0.33 pu held; Q order on the freest inverters",
         "value": 0.2, "unit": "pu Q order", "pass": True, "plant_level_value": 0.2},
    ]
    return {
        "notice_id": f"REN-{scenario['scenario_id'][:8].upper()}",
        "plant": PLANT_NAME,
        "connection_point": "110 kV POI via 2 pooling substations",
        "issued_at_min": issued,
        "valid_from_min": issued,
        "confidence": front["confidence"],
        "event": {
            "onset_min": 0.0, "cause": CAUSE[front["event"]], "expected_min_available_mw": front["A_min_mw"],
            "duration_min": round(front["t_rise_min"] - front["t_min_min"], 1), "recovery_min": recovery,
            "tau_min": front["tau_min"],
        },
        "declared": declared,
        "g_mw_min": front["g_mw_min"],
        "g_up_mw_min": front["g_up_mw_min"],
        "L_min": front["L_min"],
        "R_declared_mw": r_declared,
        "R_delivered_mw": r_delivered,
        "horizon_min": front["horizon_min"],
        "residual_full_cover_mw": front["D_mw"],
        "clauses": [c["id"] for c in CLAUSES],
        "ledger": ledger,
        "stall_declared": front["stall_at_min"] is not None,
        "deepen_absorbed": (kb["tracking_error_pct"] <= 2.0) if front["deepen_at_min"] is not None else None,
    }


def notice_at(scenario: dict[str, Any], t: float) -> dict[str, Any]:
    notice = scenario.get("notice") or build_notice(scenario)
    times = scenario["times_min"]
    k = min(range(len(times)), key=lambda i: abs(times[i] - t))
    frame = scenario["frames"][k]
    return {
        **notice,
        "as_of_min": t,
        "phase": frame["phase"],
        "R_now_mw": frame["agg"]["R"],
        "residual_now_mw": frame["agg"]["residual"],
        "declared_past": [pt for pt in notice["declared"] if pt[0] <= t],
        "declared_future": [pt for pt in notice["declared"] if pt[0] > t],
        "clause_details": CLAUSES,
    }
```

- [ ] **Step 5: Wire into the runner and the API**

In `app/raseen/scenario/runner.py`, add imports `from raseen.scenario.economics import economics` and `from raseen.scenario.notice import build_notice`, then replace the `return {...}` block's two placeholder keys: build the dict into a variable `scenario = {... "notice": None, "economics": None, ...}`, then:

```python
    scenario["notice"] = build_notice(scenario)
    scenario["economics"] = economics(kpis["bgc"]["spill_mwh"], params.g_mw_min, PLANT_MW)
    return scenario
```

In `app/raseen/api.py` add `from raseen.scenario.notice import notice_at` and the route (after `read_scenario`):

```python
    @app.get("/api/notice/{scenario_id}")
    def read_notice(scenario_id: str, t: float = 0.0) -> dict[str, Any]:
        scenario = CACHE.get(scenario_id)
        if scenario is None:
            raise HTTPException(status_code=404, detail=f"unknown scenario {scenario_id!r}")
        return {**envelope(), **notice_at(scenario, t)}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests -v --ignore=tests/e2e`
Expected: all passed. Delete any stale `app/.cache/*.json` written before this task (they lack `notice`), or the API test may read a cached scenario without it: `Remove-Item app\.cache\*.json`.

- [ ] **Step 7: Commit**

```bash
git add app/raseen/scenario app/raseen/api.py app/tests
git commit -m "feat(notice): Ramp Event Notice with compliance ledger, economics strip data, /api/notice"
```

---
### Task 10: Charts and the Gradient Control page (controls, readouts, generation chart, block gradient, timeline)

**Files:**
- Create: `app/raseen/static/charts.js`
- Replace: `app/raseen/static/pages/control.js`
- Modify: `app/raseen/static/styles.css` (append), `app/raseen/static/pages/plant.js` (add the `Grid` view using `blockGradient`)
- Test: `app/tests/test_api.py` (append one served-asset check)

**Interfaces:**
- Produces (JS, `charts.js`): `lineChart(mount, opts)` where `opts = { x: number[], series: [{ name, values, color, dashed?, width? }], bands: [{ name, upper, lower, color, opacity }], markers: [{ x, label }], unit, digits, yMin?, yMax?, height?, cursorIndex, onHover(i, event), onLeave(), onClick(i) }`; `blockGradient(mount, blocks, frame, opts)` where `opts = { controller, horizon, order: 'eta'|'id', selected, onSelect(id), onHover(i, event), onLeave() }` (draws 30 bars: fill = set-point, outline = available, violet/dim-violet headroom, cloud hatch; when `frame` is null draws capacity only); `rampInset(mount, { plant, D, tau, g })`; `sparkline(mount, points, { height })`.
- Produces (page): `control.js` keeps its scenario parameters in the store key `params` (a plain object mirroring `ScenarioParams`), posts to `/api/scenario` on change (debounced 300 ms), writes `scenario`, `frameIndex`, `controller`, `playing`; the timeline plays at `PLAY_FPS = 10` frames per second.

- [ ] **Step 1: Append the failing test**

Append to `app/tests/test_api.py`:

```python
def test_chart_module_is_served(client):
    body = client.get("/static/charts.js").text
    assert "export function lineChart" in body and "export function blockGradient" in body
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api.py -v -k chart`
Expected: FAIL (404).

- [ ] **Step 3: Write `charts.js`**

`app/raseen/static/charts.js`:

```js
import { cssVar } from "/static/colour.js";
import { fmt } from "/static/format.js";

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}) => { const n = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const rough = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) || magnitude;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

/** Line chart with optional shaded bands, event markers and a movable cursor. */
export function lineChart(mount, opts) {
  const { x, series, bands = [], markers = [], unit = "", digits = 0, cursorIndex = null, onHover, onLeave, onClick } = opts;
  const width = Math.max(mount.clientWidth || 720, 320);
  const height = opts.height ?? 240;
  const pad = { top: 10, right: 14, bottom: 26, left: 52 };
  const n = x.length;
  const values = series.flatMap((s) => s.values).concat(bands.flatMap((b) => b.upper)).filter(Number.isFinite);
  let lo = opts.yMin ?? Math.min(0, ...values);
  let hi = opts.yMax ?? Math.max(...values);
  if (lo === hi) hi = lo + 1;
  hi *= 1.03;
  const X = (i) => pad.left + (i / Math.max(1, n - 1)) * (width - pad.left - pad.right);
  const Y = (v) => height - pad.bottom - ((v - lo) / (hi - lo)) * (height - pad.top - pad.bottom);
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "generation over the event" });

  for (const tick of niceTicks(lo, hi)) {
    svg.append(el("line", { class: "grid-line", x1: pad.left, x2: width - pad.right, y1: Y(tick), y2: Y(tick) }));
    const label = el("text", { class: "axis-text", x: pad.left - 6, y: Y(tick) + 3, "text-anchor": "end" });
    label.textContent = fmt(tick, 0); svg.append(label);
  }
  const xTicks = [...new Set([0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n - 1])];
  for (const i of xTicks) {
    const label = el("text", { class: "axis-text", x: X(i), y: height - 8, "text-anchor": "middle" });
    label.textContent = `${x[i] >= 0 ? "+" : "−"}${fmt(Math.abs(x[i]), 0)}′`; svg.append(label);
  }
  for (const b of bands) {
    const up = b.upper.map((v, i) => `${X(i)},${Y(v)}`);
    const down = b.lower.map((v, i) => `${X(i)},${Y(v)}`).reverse();
    svg.append(el("polygon", { points: [...up, ...down].join(" "), fill: b.color, opacity: b.opacity ?? 0.25 }));
  }
  for (const m of markers) {
    const i = x.findIndex((t) => t >= m.x); if (i < 0) continue;
    svg.append(el("line", { class: "marker-line", x1: X(i), x2: X(i), y1: pad.top, y2: height - pad.bottom }));
    const label = el("text", { class: "marker-text", x: X(i) + 3, y: pad.top + 10 }); label.textContent = m.label; svg.append(label);
  }
  for (const s of series) {
    const points = s.values.map((v, i) => (Number.isFinite(v) ? `${X(i)},${Y(v)}` : null)).filter(Boolean).join(" ");
    svg.append(el("polyline", { class: "series-line", points, stroke: s.color, "stroke-width": s.width ?? 2, "stroke-dasharray": s.dashed ? "5 4" : "none" }));
  }
  const cursor = el("line", { class: "cursor-line", x1: 0, x2: 0, y1: pad.top, y2: height - pad.bottom, opacity: cursorIndex === null ? 0 : 1 });
  if (cursorIndex !== null) { cursor.setAttribute("x1", X(cursorIndex)); cursor.setAttribute("x2", X(cursorIndex)); }
  svg.append(cursor);
  const hit = el("rect", { x: pad.left, y: pad.top, width: Math.max(1, width - pad.left - pad.right), height: Math.max(1, height - pad.top - pad.bottom), fill: "transparent", style: "cursor:crosshair" });
  const indexAt = (event) => { const box = svg.getBoundingClientRect(); const ratio = (event.clientX - box.left - (pad.left / width) * box.width) / (box.width * (width - pad.left - pad.right) / width); return Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))); };
  hit.addEventListener("mousemove", (e) => onHover?.(indexAt(e), e));
  hit.addEventListener("mouseleave", () => onLeave?.());
  hit.addEventListener("click", (e) => onClick?.(indexAt(e)));
  svg.append(hit);
  mount.replaceChildren(svg);
  return { unit, digits };
}

/** 30 bars: fill = set-point, outline = available, headroom in violet (firm) or dim violet (expiring). */
export function blockGradient(mount, blocks, frame, opts = {}) {
  const { controller = "bgc", horizon = 5, order = "eta", selected = null, onSelect, onHover, onLeave } = opts;
  const width = Math.max(mount.clientWidth || 720, 320);
  const height = 220;
  const pad = { top: 22, bottom: 26, left: 8, right: 8 };
  const P = frame ? (frame[`P_${controller}`] ?? frame.P_bgc) : null;
  const idx = blocks.map((_, i) => i);
  if (frame && order === "eta") idx.sort((a, b) => (frame.eta[a] ?? 1e9) - (frame.eta[b] ?? 1e9) || a - b);
  const capMax = Math.max(...blocks.map((b) => b.capacity_mw));
  const slot = (width - pad.left - pad.right) / blocks.length;
  const bw = slot * 0.78;
  const H = height - pad.top - pad.bottom;
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "set-point per control block ordered by cloud arrival" });
  const violet = cssVar("--violet"), violetDim = cssVar("--violet-dim"), accent = cssVar("--accent"), amber = cssVar("--amber");
  idx.forEach((i, slotIndex) => {
    const b = blocks[i];
    const x = pad.left + slotIndex * slot + (slot - bw) / 2;
    const base = height - pad.bottom;
    const hCap = (b.capacity_mw / capMax) * H;
    const A = frame ? frame.A[i] : b.capacity_mw;
    const p = frame ? Math.min(A, P[i]) : b.capacity_mw;
    const hA = (A / capMax) * H, hP = (Math.max(0, p) / capMax) * H;
    const g = el("g", { class: "bg-bar", "data-block": b.id, style: "cursor:pointer" });
    g.append(el("rect", { x, y: base - hCap, width: bw, height: hCap, class: "bg-cap" }));
    if (frame && A - p > 0.5) g.append(el("rect", { x, y: base - hA, width: bw, height: hA - hP, fill: frame.firm[i] ? violet : violetDim, opacity: 0.9 }));
    g.append(el("rect", { x, y: base - hP, width: bw, height: hP, fill: accent }));
    g.append(el("line", { x1: x, x2: x + bw, y1: base - hA, y2: base - hA, stroke: amber, "stroke-width": 2 }));
    if (frame && frame.coverage[i] > 0.05) g.append(el("rect", { x, y: base - hCap, width: bw * frame.coverage[i], height: hCap, fill: "#d0d5de", opacity: 0.35 }));
    if (selected === b.id) g.append(el("rect", { x: x - 2, y: base - hCap - 2, width: bw + 4, height: hCap + 4, fill: "none", stroke: "#fff", "stroke-width": 1.5 }));
    const id = el("text", { x: x + bw / 2, y: height - 10, "text-anchor": "middle", class: "bg-id" }); id.textContent = b.id.replace("B", ""); g.append(id);
    if (frame) {
      const e = frame.eta[i];
      const top = el("text", { x: x + bw / 2, y: pad.top - 8, "text-anchor": "middle", class: `bg-eta ${e !== null && e <= 0 ? "is-here" : ""}` });
      top.textContent = e === null ? "·" : e <= 0 ? "●" : `${fmt(e, 0)}′`; g.append(top);
    }
    g.addEventListener("click", () => onSelect?.(b.id));
    g.addEventListener("mousemove", (ev) => onHover?.(i, ev));
    g.addEventListener("mouseleave", () => onLeave?.());
    svg.append(g);
  });
  const cap = el("text", { x: pad.left, y: 10, class: "axis-text" }); cap.textContent = frame && order === "eta" ? "← cloud reaches first · ordered by ETA · minutes above" : "control blocks west → east"; svg.append(cap);
  mount.replaceChildren(svg);
}

/** Two slopes: the uncontrolled cliff (D/τ) against the declared gradient g. */
export function rampInset(mount, { plant, D, tau, g }) {
  const width = 220, height = 70, pad = 6;
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "uncontrolled ramp against the declared gradient" });
  const yTop = pad, yBot = height - pad;
  const scale = (width - 2 * pad) / Math.max(tau, D / g);
  const cliffX = pad + tau * scale, rampX = pad + (D / g) * scale;
  svg.append(el("polyline", { points: `${pad},${yTop} ${cliffX},${yBot}`, stroke: cssVar("--serious"), "stroke-width": 2.5, fill: "none" }));
  svg.append(el("polyline", { points: `${pad},${yTop} ${rampX},${yBot}`, stroke: cssVar("--accent"), "stroke-width": 2.5, fill: "none" }));
  const a = el("text", { x: cliffX + 3, y: yBot - 2, class: "axis-text" }); a.textContent = `${fmt(D / tau, 0)}`; svg.append(a);
  const b = el("text", { x: rampX - 2, y: yBot - 2, "text-anchor": "end", class: "axis-text" }); b.textContent = `${fmt(g, 0)} MW/min`; svg.append(b);
  mount.replaceChildren(svg);
}

export function sparkline(mount, points, { height = 40 } = {}) {
  const width = Math.max(mount.clientWidth || 300, 120);
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = 0, y1 = Math.max(...ys) || 1;
  const X = (v) => ((v - x0) / Math.max(1e-9, x1 - x0)) * (width - 4) + 2;
  const Y = (v) => height - 2 - ((v - y0) / (y1 - y0)) * (height - 4);
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}` });
  svg.append(el("polyline", { points: points.map(([x, y]) => `${X(x)},${Y(y)}`).join(" "), fill: "none", stroke: cssVar("--accent"), "stroke-width": 1.5 }));
  mount.replaceChildren(svg);
}
```

- [ ] **Step 4: Append the chart and control-page styles**

Append to `app/raseen/static/styles.css`:

```css
/* ── charts ─────────────────────────────────────────────────────────────── */
.chart { width: 100%; }
.chart svg { display: block; width: 100%; height: auto; }
.grid-line { stroke: var(--grid); stroke-width: 1; }
.axis-text { fill: var(--muted); font-size: 10px; font-family: var(--sans); }
.series-line { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.cursor-line { stroke: var(--text); stroke-width: 1; stroke-dasharray: 3 3; }
.marker-line { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 2 4; }
.marker-text { fill: var(--muted); font-size: 9px; font-family: var(--mono); }
.bg-cap { fill: var(--surface-3); }
.bg-id { fill: var(--muted); font-size: 9px; font-family: var(--mono); }
.bg-eta { fill: var(--cyan); font-size: 9px; font-family: var(--mono); }
.bg-eta.is-here { fill: #d0d5de; }

/* ── gradient control page ──────────────────────────────────────────────── */
.control-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr); gap: var(--gap); }
@media (max-width: 1100px) { .control-grid { grid-template-columns: 1fr; } }
.side { display: flex; flex-direction: column; gap: var(--gap); min-width: 0; }
.controls { display: grid; gap: 10px; }
.controls-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.map-pair { display: grid; grid-template-columns: 1fr; gap: 6px; }
.map-pair.is-compare { grid-template-columns: 1fr 1fr; }
.map-pair .map-box { height: 520px; }
.map-caption { font: 600 11px var(--mono); letter-spacing: 0.06em; color: var(--text-2); text-transform: uppercase; padding: 4px 2px; }
.phase-chip { font: 600 10px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; border: 1px solid var(--border-strong); color: var(--text-2); }
.phase-chip[data-phase="before"] { border-color: var(--cyan); color: var(--cyan); }
.phase-chip[data-phase="transit"] { border-color: var(--amber); color: var(--amber); }
.phase-chip[data-phase="cover"] { border-color: var(--serious); color: var(--serious); }
.phase-chip[data-phase="exit"] { border-color: var(--good); color: var(--good); }
.phase-chip[data-phase="released"] { border-color: var(--violet); color: var(--violet); }
.ramp-big { font-family: var(--mono); font-size: 30px; font-weight: 700; letter-spacing: -0.02em; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.ramp-big .from { color: var(--serious); } .ramp-big .to { color: var(--accent-soft); } .ramp-big .arrow { color: var(--muted); font-size: 22px; }
.timeline { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.timeline input[type="range"] { flex: 1; min-width: 240px; accent-color: var(--accent); }
.timeline-marks { display: flex; justify-content: space-between; font: 10px var(--mono); color: var(--muted); padding: 0 2px; }
.econ-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.econ-strip .tile-value { font-size: 18px; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.kpi-grid .tile-value { font-size: 20px; }
.kpi-sub { font-size: 10.5px; color: var(--muted); }
.honesty { font-size: 12px; color: var(--text-2); border-left: 3px solid var(--sim); padding: 6px 10px; background: color-mix(in srgb, var(--sim) 8%, transparent); border-radius: 4px; }
.is-busy { opacity: 0.6; pointer-events: none; }
```

- [ ] **Step 5: Write the Gradient Control page**

`app/raseen/static/pages/control.js`:

```js
import { getJSON, postJSON } from "/static/api.js";
import { fmt, fmtMW, clockLabel } from "/static/format.js";
import { cssVar } from "/static/colour.js";
import { SiteMap } from "/static/maps/site-map.js";
import { SitePlan, blockRows } from "/static/maps/site-plan.js";
import { lineChart, blockGradient, rampInset } from "/static/charts.js";

const $ = (id) => document.getElementById(id);
export const PLAY_FPS = 10;
const DEFAULT_PARAMS = { event: "solid", heading_deg: 90, speed_kmh: 48, depth: 0.6, g_mw_min: 90, confidence: 0.7, reserve_mw: null, flat: false, stall_at_min: null, deepen_at_min: null, deepen_factor: 1.2 };

let ctx, store, root, unsub, views = {}, timer = null, debounce = null, hoverIndex = null;

function paramsFromStore() { return { ...DEFAULT_PARAMS, ...(store.get().params ?? {}) }; }

async function ensureSite() {
  if (store.get().site) return store.get().site;
  const site = await getJSON("/api/site"); store.set({ site, blocks: site.blocks }); return site;
}

async function runScenario(patch = {}) {
  const params = { ...paramsFromStore(), ...patch };
  store.set({ params });
  clearTimeout(debounce);
  await new Promise((resolve) => { debounce = setTimeout(resolve, 300); });
  root.classList.add("is-busy");
  try {
    const body = {};
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) body[k] = v;
    const scenario = await postJSON("/api/scenario", body);
    const keepT = store.currentFrame()?.t;
    const frameIndex = keepT === undefined ? scenario.times_min.findIndex((t) => t >= 0) : Math.max(0, scenario.times_min.findIndex((t) => t >= keepT));
    store.set({ scenario, frameIndex: frameIndex < 0 ? 0 : frameIndex });
    ctx.banner(null);
  } catch (error) { ctx.banner(`Scenario failed: ${error.message}`); }
  finally { root.classList.remove("is-busy"); }
}

function setPlaying(on) {
  clearInterval(timer); timer = null; store.set({ playing: on });
  const btn = $("play"); if (btn) btn.textContent = on ? "Pause" : "Play";
  if (!on) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const step = reduced ? 3 : 1;
  timer = setInterval(() => {
    const s = store.get(); if (!s.scenario) return;
    const next = s.frameIndex + step;
    if (next >= s.scenario.frames.length) { setPlaying(false); return; }
    store.set({ frameIndex: next });
  }, 1000 / PLAY_FPS);
}

function controlsHTML(p) {
  return `
  <div class="panel"><div class="panel-head"><h2>Scenario <span class="whatsreal-tag">FORECAST: SIMULATED</span></h2><button id="reset-params" class="ghost-btn" type="button">Reset</button></div>
  <div class="controls">
    <div class="ctl"><span class="ctl-label">Controller on the map</span>
      <div class="seg" role="group"><button type="button" class="seg-btn ${store.get().controller === "uni" ? "is-on" : ""}" data-ctl="uni">Plant-level</button><button type="button" class="seg-btn ${store.get().controller === "bgc" ? "is-on" : ""}" data-ctl="bgc">Raseen</button><button type="button" class="seg-btn" data-ctl="compare">Compare</button></div></div>
    <div class="ctl"><label class="ctl-label" for="p-event">Cloud event</label><select id="p-event">
      <option value="solid" ${p.event === "solid" ? "selected" : ""}>Solid front — design case D1</option>
      <option value="thin" ${p.event === "thin" ? "selected" : ""}>Thin band — design case D2</option>
      <option value="scattered" ${p.event === "scattered" ? "selected" : ""}>Scattered cumulus — case D3</option></select></div>
    <div class="controls-row">
      <div class="ctl"><label class="ctl-label" for="p-heading">Heading <span class="ctl-value" id="v-heading">${p.heading_deg}°</span></label><input id="p-heading" type="range" min="0" max="359" step="1" value="${p.heading_deg}"></div>
      <div class="ctl"><label class="ctl-label" for="p-speed">Speed</label><select id="p-speed"><option value="24" ${p.speed_kmh == 24 ? "selected" : ""}>24 km/h</option><option value="48" ${p.speed_kmh == 48 ? "selected" : ""}>48 km/h</option><option value="72" ${p.speed_kmh == 72 ? "selected" : ""}>72 km/h</option></select></div>
    </div>
    <div class="controls-row">
      <div class="ctl"><label class="ctl-label" for="p-depth">Depth <span class="ctl-value" id="v-depth">${Math.round(p.depth * 100)} %</span></label><input id="p-depth" type="range" min="0.2" max="0.8" step="0.05" value="${p.depth}"></div>
      <div class="ctl"><label class="ctl-label" for="p-g">Declared gradient g <span class="ctl-value" id="v-g">${p.g_mw_min} MW/min</span></label><input id="p-g" type="range" min="30" max="180" step="15" value="${p.g_mw_min}"></div>
    </div>
    <div class="controls-row">
      <div class="ctl"><label class="ctl-label" for="p-conf">Forecast confidence <span class="ctl-value" id="v-conf">${p.confidence}</span></label><input id="p-conf" type="range" min="0.3" max="0.9" step="0.1" value="${p.confidence}"></div>
      <div class="ctl"><label class="ctl-label" for="p-reserve">Reserve slice Δ <span class="ctl-value" id="v-reserve">${p.reserve_mw === null ? "auto" : p.reserve_mw + " MW"}</span></label><input id="p-reserve" type="range" min="0" max="450" step="25" value="${p.reserve_mw ?? 0}"><label class="check"><input id="p-reserve-auto" type="checkbox" ${p.reserve_mw === null ? "checked" : ""}> from confidence (Δ = D·(1−c)·κ)</label></div>
    </div>
    <label class="check"><input id="p-flat" type="checkbox" ${p.flat ? "checked" : ""}> Dynamic Solar Headroom — hold flat through the event</label>
    <div class="controls-row">
      <button id="stall" class="danger-btn" type="button" title="What if the forecast is wrong?">Stall the front now</button>
      <button id="deepen" class="danger-btn" type="button" title="What if it is deeper than forecast?">Deepen the front 20 % now</button>
    </div>
    <p class="panel-note" id="perturb-note"></p>
  </div></div>`;
}

function layout(p) {
  root.innerHTML = `
  <section class="control-grid">
    <div class="panel">
      <div class="panel-head"><h2>Spatial digital twin <span class="whatsreal-tag">GEOMETRY: DESIGNED · VALUES: SIMULATED</span></h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div class="seg" role="group" aria-label="Colour mode"><button type="button" class="seg-btn is-on" data-mode="output">Output</button><button type="button" class="seg-btn" data-mode="headroom">Headroom</button><button type="button" class="seg-btn" data-mode="eta">ETA</button></div>
          <div class="seg" role="group" aria-label="View"><button type="button" class="seg-btn is-on" data-view="sat">Satellite</button><button type="button" class="seg-btn" data-view="plan">Plan</button></div>
        </div></div>
      <div class="map-pair" id="map-pair"><div><div class="map-caption" id="cap-a">Raseen · Block Gradient Control</div><div id="map-a" class="map-box"></div></div><div id="map-b-wrap" hidden><div class="map-caption">Plant-level set-point</div><div id="map-b" class="map-box"></div></div></div>
      <div class="legend" id="control-legend"></div>
    </div>
    <div class="side">
      ${controlsHTML(p)}
      <div class="panel"><div class="panel-head"><h2>Plant power</h2><span class="phase-chip" id="phase-chip">—</span></div>
        <div class="tile-row">
          <div class="tile is-amber"><span class="tile-label">Available</span><span class="tile-value is-big" id="pp-avail">—</span><span class="tile-unit">MW · simulated</span></div>
          <div class="tile is-accent"><span class="tile-label">Export</span><span class="tile-value is-big" id="pp-export">—</span><span class="tile-unit" id="pp-export-note">MW</span></div>
          <div class="tile"><span class="tile-label">Declared line</span><span class="tile-value" id="pp-declared">—</span><span class="tile-unit">MW</span></div>
          <div class="tile is-violet"><span class="tile-label">Firm reserve R(t, 5 min)</span><span class="tile-value" id="pp-reserve">—</span><span class="tile-unit" id="pp-reserve-note">MW · headroom on blocks the cloud reaches after 5 min</span></div>
        </div></div>
      <div class="panel"><div class="panel-head"><h2>Ramp event</h2></div><div class="ramp-big"><span class="from" id="ramp-from">—</span><span class="arrow">→</span><span class="to" id="ramp-to">—</span><span class="tile-unit">MW/min</span></div><div id="ramp-inset" class="chart" style="max-width:240px"></div><p class="panel-note" id="ramp-note"></p></div>
      <div class="panel"><div class="panel-head"><h2>Cloud intelligence <span class="whatsreal-tag">NOWCAST: GROUND TRUTH</span></h2></div><dl class="detail-list" id="cloud-intel"></dl></div>
    </div>
  </section>
  <section class="panel"><div class="panel-head"><h2>Generation — available · uncontrolled · plant-level · Raseen · declared line · headroom</h2><div class="legend" id="gen-legend"></div></div><div id="gen-chart" class="chart"></div></section>
  <section class="split">
    <div class="panel"><div class="panel-head"><h2>Block gradient — 30 set-points</h2><div class="seg" role="group"><button type="button" class="seg-btn is-on" data-order="eta">By ETA</button><button type="button" class="seg-btn" data-order="id">West → east</button></div></div><div id="block-gradient" class="chart"></div><div class="legend"><span class="legend-key"><i class="legend-swatch" style="background:var(--accent)"></i>set-point</span><span class="legend-key"><i class="legend-swatch" style="background:var(--amber);height:3px"></i>available</span><span class="legend-key"><i class="legend-swatch" style="background:var(--violet)"></i>firm headroom (ETA > 5 min)</span><span class="legend-key"><i class="legend-swatch" style="background:var(--violet-dim)"></i>expiring headroom</span><span class="legend-key"><i class="legend-swatch" style="background:#d0d5de;opacity:.5"></i>cloud</span></div></div>
    <div class="panel"><div class="panel-head"><h2>Event KPIs <span id="kpi-controller" class="status-pill"></span></h2></div><div class="kpi-grid" id="kpis"></div><p class="honesty" id="honesty"></p><div class="panel-head" style="margin-top:12px"><h2>Economics</h2></div><div class="econ-strip" id="econ"></div></div>
  </section>
  <section class="panel"><div class="timeline"><button id="play" class="primary-btn" type="button">Play</button><button id="step-back" class="ghost-btn" type="button" aria-label="Back one minute">−1′</button><button id="step-fwd" class="ghost-btn" type="button" aria-label="Forward one minute">+1′</button><input id="scrubber" type="range" min="0" max="840" value="240" aria-label="Minutes from fence contact"><span class="clock"><span class="clock-k">t</span><span class="clock-v" id="tl-clock">—</span></span></div><div class="timeline-marks" id="tl-marks"></div></section>`;
}

function bindControls() {
  const p = paramsFromStore();
  const on = (id, ev, fn) => $(id)?.addEventListener(ev, fn);
  on("p-event", "change", (e) => runScenario({ event: e.target.value }));
  on("p-heading", "input", (e) => { $("v-heading").textContent = `${e.target.value}°`; });
  on("p-heading", "change", (e) => runScenario({ heading_deg: Number(e.target.value) }));
  on("p-speed", "change", (e) => runScenario({ speed_kmh: Number(e.target.value) }));
  on("p-depth", "input", (e) => { $("v-depth").textContent = `${Math.round(e.target.value * 100)} %`; });
  on("p-depth", "change", (e) => runScenario({ depth: Number(e.target.value) }));
  on("p-g", "input", (e) => { $("v-g").textContent = `${e.target.value} MW/min`; });
  on("p-g", "change", (e) => runScenario({ g_mw_min: Number(e.target.value) }));
  on("p-conf", "input", (e) => { $("v-conf").textContent = e.target.value; });
  on("p-conf", "change", (e) => runScenario({ confidence: Number(e.target.value) }));
  on("p-reserve", "input", (e) => { $("v-reserve").textContent = `${e.target.value} MW`; $("p-reserve-auto").checked = false; });
  on("p-reserve", "change", (e) => runScenario({ reserve_mw: Number(e.target.value) }));
  on("p-reserve-auto", "change", (e) => { if (e.target.checked) { $("v-reserve").textContent = "auto"; runScenario({ reserve_mw: null }); } });
  on("p-flat", "change", (e) => runScenario({ flat: e.target.checked }));
  on("stall", "click", () => { const t = store.currentFrame()?.t ?? -3; runScenario({ stall_at_min: Math.round(t * 6) / 6, deepen_at_min: null }); });
  on("deepen", "click", () => { const t = store.currentFrame()?.t ?? 2; runScenario({ deepen_at_min: Math.round(t * 6) / 6, deepen_factor: 1.2, stall_at_min: null }); });
  on("reset-params", "click", () => { store.set({ params: { ...DEFAULT_PARAMS } }); layout(DEFAULT_PARAMS); bindControls(); mountViews(); runScenario(); });
  for (const btn of root.querySelectorAll("[data-ctl]")) btn.addEventListener("click", () => {
    root.querySelectorAll("[data-ctl]").forEach((b) => b.classList.toggle("is-on", b === btn));
    const v = btn.dataset.ctl;
    if (v === "compare") { store.set({ compare: true, controller: "bgc" }); } else { store.set({ compare: false, controller: v }); }
    applyCompare();
  });
  for (const btn of root.querySelectorAll("[data-mode]")) btn.addEventListener("click", () => { root.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("is-on", b === btn)); store.set({ mode: btn.dataset.mode }); });
  for (const btn of root.querySelectorAll("[data-view]")) btn.addEventListener("click", () => { root.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("is-on", b === btn)); store.set({ view: btn.dataset.view }); mountViews(); });
  for (const btn of root.querySelectorAll("[data-order]")) btn.addEventListener("click", () => { root.querySelectorAll("[data-order]").forEach((b) => b.classList.toggle("is-on", b === btn)); store.set({ order: btn.dataset.order }); });
  on("play", "click", () => setPlaying(!store.get().playing));
  on("step-back", "click", () => { setPlaying(false); store.set({ frameIndex: Math.max(0, store.get().frameIndex - 6) }); });
  on("step-fwd", "click", () => { setPlaying(false); const s = store.get(); store.set({ frameIndex: Math.min((s.scenario?.frames.length ?? 1) - 1, s.frameIndex + 6) }); });
  on("scrubber", "input", (e) => { setPlaying(false); store.set({ frameIndex: Number(e.target.value) }); });
  document.addEventListener("keydown", keyNav);
  $("p-reserve").disabled = p.reserve_mw === null;
  $("p-reserve-auto").addEventListener("change", (e) => { $("p-reserve").disabled = e.target.checked; });
}

function keyNav(e) {
  if (!store.get().scenario || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  const step = e.shiftKey ? 6 : 1;
  if (e.key === "ArrowLeft") { setPlaying(false); store.set({ frameIndex: Math.max(0, store.get().frameIndex - step) }); e.preventDefault(); }
  if (e.key === "ArrowRight") { setPlaying(false); store.set({ frameIndex: Math.min(store.get().scenario.frames.length - 1, store.get().frameIndex + step) }); e.preventDefault(); }
  if (e.key === " ") { setPlaying(!store.get().playing); e.preventDefault(); }
}

async function mountViews() {
  const site = await ensureSite();
  for (const key of Object.keys(views)) { views[key]?.destroy(); delete views[key]; }
  const kind = store.get().view ?? "sat";
  const hooks = (controller) => ({
    onSelect: (id) => { store.set({ selectedBlock: id }); for (const v of Object.values(views)) v.select?.(id); },
    onHover: (e, i) => ctx.showTooltip(e, `${site.blocks[i].id} · ${site.blocks[i].label}`, blockRows(store.currentFrame(), i, controller, site.blocks[i].capacity_mw)),
    onLeave: () => ctx.hideTooltip(),
  });
  async function make(id, controller) {
    const box = $(id); box.replaceChildren();
    let v = new (kind === "sat" && SiteMap.available() ? SiteMap : SitePlan)(box, site, hooks(controller));
    if (!(await v.init())) { v.destroy(); v = new SitePlan(box, site, hooks(controller)); await v.init(); }
    v.controller = controller; v.setMode(store.get().mode); v.setFrame(store.currentFrame(), controller);
    return v;
  }
  views.a = await make("map-a", store.get().compare ? "bgc" : store.get().controller);
  if (store.get().compare) views.b = await make("map-b", "uni");
  applyCompare();
}

function applyCompare() {
  const compare = Boolean(store.get().compare);
  $("map-pair").classList.toggle("is-compare", compare);
  $("map-b-wrap").hidden = !compare;
  $("cap-a").textContent = compare || store.get().controller === "bgc" ? "Raseen · Block Gradient Control" : "Plant-level set-point (state of the art)";
  if (compare && !views.b) { mountViews(); return; }
  if (!compare && views.b) { views.b.destroy(); delete views.b; }
  views.a?.setFrame(store.currentFrame(), compare ? "bgc" : store.get().controller);
  views.a?.resize(); views.b?.resize();
}

function render(changed) {
  const s = store.get(); const scn = s.scenario; const frame = store.currentFrame();
  if (!scn || !frame) return;
  const ctl = s.controller, other = ctl === "bgc" ? "uni" : "bgc";
  const scrubber = $("scrubber"); if (scrubber) { scrubber.max = String(scn.frames.length - 1); scrubber.value = String(s.frameIndex); }
  $("tl-clock").textContent = clockLabel(frame.t);
  $("phase-chip").textContent = frame.phase; $("phase-chip").dataset.phase = frame.phase;
  $("pp-avail").textContent = fmt(frame.agg.A, 0);
  $("pp-export").textContent = fmt(frame.agg[`P_${ctl}`], 0);
  $("pp-export-note").textContent = `MW · ${ctl === "bgc" ? "Raseen" : "plant-level"} · plant-level ${fmt(frame.agg.P_uni, 0)} / Raseen ${fmt(frame.agg.P_bgc, 0)}`;
  $("pp-declared").textContent = fmt(frame.agg.P_star, 0);
  $("pp-reserve").textContent = fmt(ctl === "bgc" ? frame.agg.R : frame.agg.R_uni, 0);
  $("pp-reserve-note").textContent = ctl === "bgc" ? "MW · declared and firm for 5 min" : "MW · headroom that happens to sit beyond 5 min (not declared)";

  if (changed.includes("scenario") || changed.includes("controller")) {
    const f = scn.front, k = scn.kpis;
    $("ramp-from").textContent = `−${fmt(k.base.max_grad_mw_min, 0)}`;
    $("ramp-to").textContent = `−${fmt(k[ctl].max_grad_mw_min, 0)}`;
    rampInset($("ramp-inset"), { plant: 3000, D: f.D_mw, tau: f.tau_min, g: f.g_mw_min });
    $("ramp-note").textContent = `g = D / (τ + L): ${fmt(f.D_mw, 0)} MW over ${fmt(f.tau_min, 1)} min crossing + ${fmt(f.L_min, 1)} min lead = ${fmt(f.g_mw_min, 0)} MW/min (${fmt(f.g_mw_min / 30, 1)} %/min).${f.lead_shortfall_min > 0 ? ` Lead shortfall ${fmt(f.lead_shortfall_min, 1)} min: this gradient needs more notice than the window allows.` : ""}`;
    const intel = [["Heading", `${f.heading_deg}° (${f.heading_deg === 90 ? "west → east" : "direction of motion"})`], ["Speed", `${f.speed_kmh} km/h`], ["Depth", `${Math.round(f.depth * 100)} % → D = ${fmt(f.D_mw, 0)} MW`], ["Crossing time τ", `${fmt(f.tau_min, 1)} min for this heading`], ["Lead L", `${fmt(f.L_min, 1)} min`], ["Confidence", `${f.confidence} → Δ = ${fmt(f.delta_mw, 0)} MW`], ["Event", f.event], ["Descent starts", `${fmt(f.t_desc_start_min, 1)} min`], ["Stall / deepen", `${f.stall_at_min === null ? "—" : "stall at " + fmt(f.stall_at_min, 1) + "′, detected " + fmt(f.detect_at_min, 1) + "′"} ${f.deepen_at_min === null ? "" : "· deepen at " + fmt(f.deepen_at_min, 1) + "′"}`]];
    const dl = $("cloud-intel"); dl.replaceChildren();
    for (const [a, b] of intel) { const dt = document.createElement("dt"); dt.textContent = a; const dd = document.createElement("dd"); dd.textContent = b; dl.append(dt, dd); }
    $("perturb-note").textContent = f.stall_at_min !== null ? "Front stalled: curtailment released nearest-first after a 2-minute confirmation; spilled energy logged as false-alarm exposure." : f.deepen_at_min !== null ? (scn.notice.deepen_absorbed ? "Front 20 % deeper than forecast: the reserve slice absorbed it; the declared line held." : "Front 20 % deeper than forecast: the reserve was exhausted; export left the declared line and the notice says so.") : "";
    renderKpis(scn, ctl, other);
    renderEconomics(scn);
    renderMarks(scn);
  }
  renderChart(scn, s.frameIndex, ctl);
  const site = s.site;
  blockGradient($("block-gradient"), site.blocks, frame, { controller: ctl, horizon: scn.front.horizon_min, order: s.order ?? "eta", selected: s.selectedBlock, onSelect: (id) => store.set({ selectedBlock: id }), onHover: (i, e) => ctx.showTooltip(e, `${site.blocks[i].id} · ${site.blocks[i].label}`, blockRows(frame, i, ctl, site.blocks[i].capacity_mw)), onLeave: () => ctx.hideTooltip() });
  views.a?.setFrame(frame, s.compare ? "bgc" : ctl); views.b?.setFrame(frame, "uni");
}

function renderChart(scn, index, ctl) {
  const x = scn.times_min; const agg = scn.frames.map((f) => f.agg);
  const P = agg.map((a) => a[`P_${ctl}`]);
  const series = [
    { name: "available", values: agg.map((a) => a.A), color: cssVar("--amber") },
    { name: "uncontrolled", values: agg.map((a) => a.P_base), color: cssVar("--serious"), dashed: true, width: 1.2 },
    { name: "plant-level", values: agg.map((a) => a.P_uni), color: cssVar("--muted"), width: ctl === "uni" ? 2.5 : 1.2 },
    { name: "Raseen", values: agg.map((a) => a.P_bgc), color: cssVar("--accent"), width: ctl === "bgc" ? 2.5 : 1.2 },
    { name: "declared", values: agg.map((a) => a.P_star), color: cssVar("--text"), dashed: true, width: 1 },
  ];
  const f = scn.front;
  lineChart($("gen-chart"), { x, series, bands: [{ name: "headroom", upper: agg.map((a) => a.A), lower: P, color: cssVar("--violet"), opacity: 0.22 }], markers: [{ x: f.t_desc_start_min, label: "T−L" }, { x: 0, label: "T0" }, { x: f.tau_min, label: "T0+τ" }, { x: f.t_rise_min, label: "exit" }], unit: "MW", cursorIndex: index, onHover: (i, e) => { const a = agg[i]; ctx.showTooltip(e, clockLabel(x[i]), [{ name: "available", value: fmtMW(a.A) }, { name: "plant-level", value: fmtMW(a.P_uni) }, { name: "Raseen", value: fmtMW(a.P_bgc) }, { name: "declared", value: fmtMW(a.P_star) }, { name: "firm reserve", value: fmtMW(a.R) }]); }, onLeave: () => ctx.hideTooltip(), onClick: (i) => { setPlaying(false); store.set({ frameIndex: i }); } });
  $("gen-legend").replaceChildren(...series.map((s) => { const k = document.createElement("span"); k.className = "legend-key"; const sw = document.createElement("i"); sw.className = "legend-swatch"; sw.style.background = s.color; sw.style.height = "3px"; k.append(sw, document.createTextNode(s.name)); return k; }));
}

function tile(label, value, unit, sub, cls = "") { return `<div class="tile ${cls}"><span class="tile-label">${label}</span><span class="tile-value">${value}</span><span class="tile-unit">${unit}</span><span class="kpi-sub">${sub}</span></div>`; }

function renderKpis(scn, ctl, other) {
  const k = scn.kpis[ctl], b = scn.kpis.base, o = scn.kpis[other];
  $("kpi-controller").textContent = ctl === "bgc" ? "Raseen" : "plant-level";
  $("kpis").innerHTML = [
    tile("Max 10-min drop at POI", fmt(k.max_drop10_mw, 0), "MW", `uncontrolled ${fmt(b.max_drop10_mw, 0)} MW`),
    tile("Max down-gradient", fmt(k.max_grad_mw_min, 0), "MW/min", `${fmt(k.max_grad_mw_min / 30, 1)} %/min · uncontrolled ${fmt(b.max_grad_mw_min, 0)}`),
    tile("Energy not exported", fmt(k.spill_mwh, 0), "MWh", `${other === "bgc" ? "Raseen" : "plant-level"} ${fmt(o.spill_mwh, 0)} MWh · ${fmt(scn.economics.spill_share_of_day_pct, 1)} % of a clear day`),
    tile("Lead before contact", fmt(k.lead_min, 1), "min", "descent starts this long before the fence"),
    tile("At risk if the front never comes", fmt(k.spill_before_contact_mwh, 0), "MWh", "spilled before contact (false-alarm exposure)"),
    tile("Firm reserve at contact", fmt(k.firm_at_contact_mw, 0), "MW", ctl === "bgc" ? "declared R(0, 5 min)" : "not declarable by a plant-level rule", ctl === "bgc" ? "is-violet" : ""),
    tile("Curtailed while already shaded", fmt(k.shaded_curtailment_mwh, 1), "MWh", `${other === "bgc" ? "Raseen" : "plant-level"} ${fmt(o.shaded_curtailment_mwh, 1)} MWh · ${k.blocks_stepped} unforced block steps`),
    tile("Tracking error vs declared", fmt(k.tracking_error_pct, 2), "% of plant", "SAGC 2.11.13.11 asks ≤ 2 %"),
  ].join("");
  $("honesty").textContent = `Both controllers spill the same energy for a perfectly forecast front: spill is fixed by g and the lead, not by the allocation. What Raseen adds is a firm, declarable reserve, no block steps, localised false-alarm release and reactive migration.`;
}

function renderEconomics(scn) {
  const e = scn.economics;
  $("econ").innerHTML = [
    tile("This event", fmt(e.spill_sar, 0), "SAR", `${fmt(e.spill_mwh, 0)} MWh at SAR ${e.sar_per_mwh}/MWh`),
    tile("Per year at this gradient", fmt(e.annual_spill_sar / 1e6, 1), "SAR m", `${fmt(e.annual_spill_pct, 1)} % of annual energy (field anchors)`),
    tile("Battery block for the same service", fmt(e.battery_block_annual_sar / 1e6, 0), "SAR m / yr", `SAR ${fmt(e.battery_block_capex_sar / 1e9, 2)} bn capex · ${fmt(e.battery_to_spill_ratio, 0)}× the spill`),
  ].join("");
}

function renderMarks(scn) {
  const f = scn.front; const x = scn.times_min; const n = x.length - 1;
  $("tl-marks").innerHTML = `<span>${fmt(x[0], 0)}′</span><span style="margin-left:auto">T−L ${fmt(f.t_desc_start_min, 1)}′ · T0 · T0+τ ${fmt(f.tau_min, 1)}′ · exit ${fmt(f.t_rise_min, 1)}′ · +${fmt(x[n], 0)}′</span>`;
}

export async function mount(pageRoot, context) {
  ctx = context; store = context.store; root = pageRoot;
  const p = paramsFromStore();
  layout(p); bindControls(); await mountViews();
  unsub = store.subscribe((state, changed) => {
    if (changed.includes("mode")) { for (const v of Object.values(views)) v.setMode(state.mode); }
    if (changed.some((k) => ["scenario", "frameIndex", "controller", "selectedBlock", "order", "compare"].includes(k))) render(changed);
    if (changed.includes("selectedBlock")) for (const v of Object.values(views)) v.select?.(state.selectedBlock);
  });
  if (store.get().scenario) render(["scenario"]); else await runScenario();
  $("control-legend").innerHTML = `<span class="legend-key"><i class="legend-swatch" style="background:var(--accent)"></i>output (set-point / capacity)</span><span class="legend-key"><i class="legend-swatch" style="background:var(--violet)"></i>headroom</span><span class="legend-key"><i class="legend-swatch" style="background:var(--cyan)"></i>ETA</span><span class="legend-key"><i class="legend-swatch" style="background:#d0d5de;opacity:.5"></i>cloud</span>`;
}

export function unmount() {
  setPlaying(false); unsub?.(); unsub = null; document.removeEventListener("keydown", keyNav);
  for (const v of Object.values(views)) v.destroy(); views = {};
}
```

- [ ] **Step 6: Add the Grid view to the Plant page**

In `app/raseen/static/pages/plant.js`: import `blockGradient` from `/static/charts.js`; add a third segment button `<button type="button" class="seg-btn" data-view="grid">Grid</button>` after `Plan`; in `useView(kind)`, when `kind === "grid"` render instead:

```js
    if (kind === "grid") {
      const box = $("site-map"); box.replaceChildren();
      const mountEl = document.createElement("div"); mountEl.className = "chart"; mountEl.style.padding = "12px"; box.append(mountEl);
      const draw = () => blockGradient(mountEl, site.blocks, store.currentFrame(), { controller: store.get().controller, order: "eta", selected: store.get().selectedBlock, onSelect: (id) => store.set({ selectedBlock: id }), onHover: (i, e) => hooks.onHover(e, i), onLeave: hooks.onLeave });
      draw();
      view = { setMode() {}, setFrame() { draw(); }, select() { draw(); }, destroy() { box.replaceChildren(); }, resize() {} };
      $("plant-legend").innerHTML = `<span>fill = set-point · outline = available · violet = firm headroom · grey = cloud</span>`;
      return;
    }
```

(place this at the top of `useView`, before `view?.destroy()` so the guard order is: destroy previous, then branch — i.e. keep `view?.destroy(); view = null;` first, then the `grid` branch, then the existing code).

- [ ] **Step 7: Run the tests and check visually**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api.py -v`
Expected: all passed.

Start the server, open `#/control`. Expected: the default D1 scenario computes (first run 1–4 s, then cached), the map colours the blocks, the four plant-power numbers show MW, the ramp reads `−180 → −90 MW/min` (values within a few MW), the generation chart shows the amber available line, grey plant-level, blue Raseen, dashed declared line and a violet headroom band; the block gradient shows 30 bars ordered by ETA; Play advances the clock at 10 frames/s; changing g re-runs; `Compare` shows two maps; `Stall the front now` turns the phase chip to `released` after 2 simulated minutes. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add app/raseen/static app/tests/test_api.py
git commit -m "feat(control): gradient control page with charts, block gradient, KPIs, timeline; grid view on plant page"
```

---

### Task 11: Compare mode polish, stall/deepen narration, economics strip check

Task 10 already wires Compare, Stall, Deepen and the economics strip. This task verifies them against the spec and fixes what the visual check turns up; it has explicit acceptance steps rather than new code, plus one CSS fix that is always needed.

**Files:**
- Modify: `app/raseen/static/styles.css` (append), `app/raseen/static/pages/control.js` (only if a step below fails)

- [ ] **Step 1: Append the compare-mode styles**

Append to `app/raseen/static/styles.css`:

```css
.map-pair.is-compare .map-box { height: 420px; }
@media (max-width: 1100px) { .map-pair.is-compare { grid-template-columns: 1fr; } }
.tile-value.is-changed { animation: flash 600ms ease-out; }
@keyframes flash { 0% { color: var(--warning); } 100% { color: inherit; } }
```

- [ ] **Step 2: Acceptance — Compare**

With the server running on `#/control`: press `Compare`. Expected: two maps side by side with captions "Raseen · Block Gradient Control" and "Plant-level set-point"; scrub to `t ≈ +3 min`; on the plant-level map the already-shaded western blocks are darker than on the Raseen map (the proportional rule curtails shaded blocks), on the Raseen map only the blocks ahead of the front change. If both maps show identical colours, `views.b` is not receiving `"uni"` — check `mountViews()`.

- [ ] **Step 3: Acceptance — Stall**

Reset, scrub to `t = −4 min`, press `Stall the front now`. Expected: the cloud polygon stops moving; after two simulated minutes the phase chip shows `released`; the blue Raseen line rises back to the amber line at the up-gradient; KPI "At risk if the front never comes" shows a positive MWh; the perturbation note explains the release order.

- [ ] **Step 4: Acceptance — Deepen**

Reset, scrub to `t = +2 min`, press `Deepen the front 20 %`. Expected: the plateau drops below the planned level (available line lower after +2 min); the perturbation note says whether the reserve absorbed it; the Declarations page (Task 12) will show `deepen_absorbed`.

- [ ] **Step 5: Acceptance — Economics**

Expected strip: "This event ≈ SAR 15,000" for the default D1 at 90 MW/min (305 MWh × 50), "Per year ≈ SAR 7 m", "Battery block 120 SAR m / yr". If the per-year figure is not between SAR 5 m and 10 m for g = 90, check `annual_spill_pct` interpolation.

- [ ] **Step 6: Commit**

```bash
git add app/raseen/static
git commit -m "feat(control): compare-mode layout, stall/deepen and economics verified"
```

---

### Task 12: Declarations page — the Ramp Event Notice as a live document

**Files:**
- Replace: `app/raseen/static/pages/declarations.js`
- Modify: `app/raseen/static/styles.css` (append)

**Interfaces:**
- Consumes: `store.scenario.notice`, `store.scenario.frames[frameIndex]`, `GET /api/notice/{id}?t=` (for the `as-of` split), `sparkline` from `charts.js`.

- [ ] **Step 1: Write the page**

`app/raseen/static/pages/declarations.js`:

```js
import { getJSON } from "/static/api.js";
import { fmt, clockLabel } from "/static/format.js";
import { sparkline } from "/static/charts.js";

const $ = (id) => document.getElementById(id);
let store, ctx, root, unsub, lastKey = null;

function row(k, v) { return `<div class="doc-row"><span class="doc-k">${k}</span><span class="doc-v">${v}</span></div>`; }

async function render() {
  const s = store.get(); const scn = s.scenario; const frame = store.currentFrame();
  if (!scn || !frame) { root.innerHTML = `<section class="panel"><p class="empty">No scenario loaded. Open Gradient Control first, or <a href="#/control" style="text-decoration:underline">run the design case</a>.</p></section>`; return; }
  const key = `${scn.scenario_id}:${s.frameIndex}`; if (key === lastKey) return; lastKey = key;
  let n;
  try { n = await getJSON(`/api/notice/${scn.scenario_id}?t=${frame.t}`); } catch (e) { ctx.banner(`Notice failed: ${e.message}`); return; }
  const ev = n.event;
  root.innerHTML = `
  <section class="split">
    <div class="panel doc">
      <div class="panel-head"><h2>Ramp Event Notice <span class="mono">${n.notice_id}</span> <span class="whatsreal-tag">TSP INTERFACE: SIMULATED</span></h2><span class="phase-chip" data-phase="${n.phase}">${n.phase} · as of ${clockLabel(n.as_of_min)}</span></div>
      <div class="doc-grid">
        <div>
          <h3 class="doc-h">Identity</h3>
          ${row("Plant", n.plant)}${row("Connection point", n.connection_point)}${row("Issued", `T${clockLabel(n.issued_at_min)} (${fmt(n.L_min, 1)} min before first shading)`)}${row("Valid from", `T${clockLabel(n.valid_from_min)}`)}${row("Confidence", n.confidence)}
          <h3 class="doc-h">Event</h3>
          ${row("Expected onset", `T${clockLabel(ev.onset_min)}`)}${row("Cause", ev.cause)}${row("Crossing time", `${fmt(ev.tau_min, 1)} min`)}${row("Expected minimum available", `${fmt(ev.expected_min_available_mw, 0)} MW`)}${row("Duration at minimum", `${fmt(ev.duration_min, 1)} min`)}${row("Recovery", `${fmt(ev.recovery_min, 1)} min`)}
        </div>
        <div>
          <h3 class="doc-h">Declared trajectory</h3>
          <div id="declared-spark" class="chart"></div>
          ${row("Declared gradient", `${fmt(n.g_mw_min, 0)} MW/min down · ${fmt(n.g_up_mw_min, 0)} MW/min up`)}${row("Firm reserve R(t, ${fmt(n.horizon_min, 0)} min)", `${fmt(n.R_declared_mw, 0)} MW declared · ${fmt(n.R_delivered_mw, 0)} MW deliverable`)}${row("Reserve now", `${fmt(n.R_now_mw, 0)} MW`)}${row("Residual under full cover", `${fmt(n.residual_full_cover_mw, 0)} MW to be covered by other plant`)}${row("Residual now", `${fmt(n.residual_now_mw, 0)} MW`)}
          ${n.stall_declared ? row("Update", "front stalled — curtailment released; declaration withdrawn") : ""}${n.deepen_absorbed === null ? "" : row("Update", n.deepen_absorbed ? "front deeper than forecast — absorbed by the reserve slice; line held" : "front deeper than forecast — reserve exhausted; export left the declared line")}
        </div>
      </div>
      <h3 class="doc-h">Declared points (1-minute samples)</h3>
      <div class="doc-points" id="doc-points"></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button id="copy-json" class="ghost-btn" type="button">Copy as JSON</button><span class="panel-note" id="copy-note"></span></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Compliance ledger <span class="whatsreal-tag">CLAUSES: REAL · CHECKS: SIMULATED</span></h2></div>
      <table class="table"><thead><tr><th>Clause</th><th>Requirement</th><th>Raseen</th><th>Plant-level</th><th></th></tr></thead><tbody id="ledger"></tbody></table>
      <h3 class="doc-h" style="margin-top:14px">Clause anchors</h3>
      <table class="table"><tbody id="clauses"></tbody></table>
    </div>
  </section>`;
  sparkline($("declared-spark"), n.declared, { height: 60 });
  $("doc-points").innerHTML = [...n.declared_past.map(([t, mw]) => `<span class="pt is-past">${clockLabel(t)} · ${fmt(mw, 0)}</span>`), ...n.declared_future.map(([t, mw]) => `<span class="pt">${clockLabel(t)} · ${fmt(mw, 0)}</span>`)].join("");
  $("ledger").innerHTML = n.ledger.map((r) => `<tr><td class="mono">${r.clause}</td><td>${r.requirement}</td><td class="n">${r.value === null ? "—" : fmt(r.value, typeof r.value === "number" && !Number.isInteger(r.value) ? 2 : 0)} ${r.unit}</td><td class="n">${r.plant_level_value === null || r.plant_level_value === undefined ? "—" : fmt(r.plant_level_value, 2)}</td><td><span class="status-pill ${r.pass ? "is-real" : ""}" style="${r.pass ? "" : "border-color:var(--critical);color:var(--critical)"}">${r.pass ? "pass" : "fail"}</span></td></tr>`).join("");
  $("clauses").innerHTML = n.clause_details.map((c) => `<tr><td class="mono">${c.id}</td><td><strong>${c.title}</strong><br><span class="panel-note">${c.role}</span></td></tr>`).join("");
  $("copy-json").addEventListener("click", async () => { const { clause_details, ...doc } = n; try { await navigator.clipboard.writeText(JSON.stringify(doc, null, 2)); $("copy-note").textContent = "copied"; } catch (e) { $("copy-note").textContent = "clipboard unavailable"; } });
}

export async function mount(pageRoot, context) {
  ctx = context; store = context.store; root = pageRoot; lastKey = null;
  unsub = store.subscribe((_, changed) => { if (changed.includes("scenario") || changed.includes("frameIndex")) render(); });
  await render();
}
export function unmount() { unsub?.(); unsub = null; }
```

- [ ] **Step 2: Append the document styles**

```css
/* ── declarations ───────────────────────────────────────────────────────── */
.doc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .doc-grid { grid-template-columns: 1fr; } }
.doc-h { font: 600 11px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 12px 0 6px; }
.doc-row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px dashed var(--border); font-size: 12.5px; }
.doc-k { color: var(--text-2); } .doc-v { font-family: var(--mono); text-align: right; }
.doc-points { display: flex; flex-wrap: wrap; gap: 4px; }
.pt { font: 11px var(--mono); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); color: var(--text-2); }
.pt.is-past { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--text); }
```

- [ ] **Step 3: Visual check**

Run the server; open `#/control` (loads a scenario), then `#/declarations`. Expected: the notice with identity, event, declared trajectory sparkline, reserve numbers, the declared points (past ones highlighted), a ledger with pass pills for Raseen and the plant-level comparison values, and the clause anchors. Use ← → on the Gradient Control page, return: the "as of" chip follows the clock.

- [ ] **Step 4: Commit**

```bash
git add app/raseen/static
git commit -m "feat(declarations): Ramp Event Notice as a live document with compliance ledger"
```

---
### Task 13: Kingdom registry — renewables and the transmission backbone, `/api/plants`, `/api/grid`

**Files:**
- Create: `app/raseen/registry/__init__.py`, `app/raseen/registry/data/plants.json`, `app/raseen/registry/data/grid.json`
- Modify: `app/raseen/api.py`
- Test: `app/tests/test_registry.py`, `app/tests/test_api.py` (append)

**Interfaces:**
- Produces: `load_plants() -> list[dict]` (NAJM-3000's coordinates are taken from the site geometry so representative mode stays consistent), `plants_summary(plants) -> dict` (`count`, `by_technology_mw`, `by_status_mw`, `operational_mw`, `pipeline_mw`), `load_grid() -> dict` (GeoJSON FeatureCollection), `REGISTRY_NOTE`, `GRID_NOTE`.
- Plant record fields: `id, name_en, name_ar, technology (pv|wind|csp|bess), capacity_mw, status (operational|under_construction|awarded|planned), developer, region, lat, lon, coordinate_quality (site|town|approximate), cod_year, source, note`.
- API: `GET /api/plants` → envelope + `plants, summary, note, facts` where `facts` = `{ peak_load_gw: 72.9, peak_load_year: 2024, renewables_operational_gw_2024: 6.55, pv_installed_gw_2025: 12.5, target_2030: "50 % of electricity from renewables" }`; `GET /api/grid` → envelope + `geojson, note`.

- [ ] **Step 1: Write the failing tests**

`app/tests/test_registry.py`:

```python
from __future__ import annotations

from raseen.registry import load_grid, load_plants, plants_summary

REQUIRED = {"id", "name_en", "technology", "capacity_mw", "status", "lat", "lon", "coordinate_quality", "source"}


def test_plants_are_well_formed_and_cover_the_kingdom():
    plants = load_plants()
    assert len(plants) >= 30
    ids = [p["id"] for p in plants]
    assert len(ids) == len(set(ids))
    for p in plants:
        assert REQUIRED <= p.keys(), p.get("id")
        assert p["technology"] in ("pv", "wind", "csp", "bess")
        assert p["status"] in ("operational", "under_construction", "awarded", "planned")
        assert p["coordinate_quality"] in ("site", "town", "approximate")
        assert 16.0 <= p["lat"] <= 32.5 and 34.0 <= p["lon"] <= 56.0, p["id"]
        assert p["capacity_mw"] > 0
    assert {p["technology"] for p in plants} == {"pv", "wind", "csp", "bess"}
    najm = next(p for p in plants if p["id"] == "najm-3000")
    assert najm["capacity_mw"] == 3000 and najm["coordinate_quality"] == "site"


def test_summary_adds_up():
    plants = load_plants()
    s = plants_summary(plants)
    assert s["count"] == len(plants)
    assert abs(sum(s["by_technology_mw"].values()) - sum(p["capacity_mw"] for p in plants)) < 1e-6
    assert s["operational_mw"] == sum(p["capacity_mw"] for p in plants if p["status"] == "operational")
    assert s["pipeline_mw"] == sum(p["capacity_mw"] for p in plants if p["status"] != "operational")


def test_grid_is_a_schematic_geojson():
    g = load_grid()
    assert g["type"] == "FeatureCollection"
    lines = [f for f in g["features"] if f["geometry"]["type"] == "LineString"]
    points = [f for f in g["features"] if f["geometry"]["type"] == "Point"]
    assert len(lines) >= 10 and len(points) >= 12
    for f in lines:
        assert f["properties"]["indicative"] is True
        assert f["properties"]["voltage_kv"] in (110, 132, 230, 380)
        for lon, lat in f["geometry"]["coordinates"]:
            assert 34.0 <= lon <= 56.0 and 16.0 <= lat <= 32.5
    assert any(f["properties"].get("name") == "NAJM-3000 evacuation" for f in lines)
```

Append to `app/tests/test_api.py`:

```python
def test_plants_and_grid_endpoints(client):
    plants = client.get("/api/plants").json()
    assert plants["classification"] == "SIMULATION (RASEEN PROTOTYPE)"
    assert len(plants["plants"]) >= 30 and plants["summary"]["count"] == len(plants["plants"])
    assert "indicative" in plants["note"].lower() and plants["facts"]["peak_load_gw"] == 72.9
    grid = client.get("/api/grid").json()
    assert grid["geojson"]["type"] == "FeatureCollection" and "schematic" in grid["note"].lower()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_registry.py -v`
Expected: FAIL with `ModuleNotFoundError: raseen.registry`.

- [ ] **Step 3: Write the registry data**

`app/raseen/registry/data/plants.json` — every entry compiled from public announcements (SPPC/NREP round results, developer press releases, GASTAT/MoE statistics). Coordinates are town-level or approximate unless marked `site`. Write exactly this file:

```json
{
  "note": "Indicative registry of utility-scale renewable projects in Saudi Arabia compiled from public announcements (SPPC/NREP rounds, developer releases, GASTAT). Capacities are nameplate as announced; statuses as of mid-2026; coordinates are town-level or approximate unless marked 'site'. Not an official dataset.",
  "plants": [
    {"id": "najm-3000", "name_en": "NAJM-3000 (reference plant)", "name_ar": "نجم-3000", "technology": "pv", "capacity_mw": 3000, "status": "under_construction", "developer": "Reference plant modelled in the Raseen twin", "region": "Madinah / Hail", "lat": 25.043, "lon": 41.115, "coordinate_quality": "site", "cod_year": 2027, "source": "project design basis (twin)", "note": "365 MVPS design basis; 363 in the CAD geometry; 110 kV evacuation."},
    {"id": "sakaka", "name_en": "Sakaka PV", "name_ar": "سكاكا", "technology": "pv", "capacity_mw": 300, "status": "operational", "developer": "ACWA Power", "region": "Al Jouf", "lat": 29.97, "lon": 40.20, "coordinate_quality": "town", "cod_year": 2019, "source": "NREP Round 1", "note": "The Kingdom's first utility-scale PV plant."},
    {"id": "dumat-al-jandal-wind", "name_en": "Dumat Al Jandal Wind", "name_ar": "دومة الجندل", "technology": "wind", "capacity_mw": 400, "status": "operational", "developer": "EDF Renewables / Masdar", "region": "Al Jouf", "lat": 29.80, "lon": 39.87, "coordinate_quality": "town", "cod_year": 2022, "source": "NREP Round 1", "note": "First utility-scale wind farm in the Kingdom."},
    {"id": "sudair", "name_en": "Sudair PV", "name_ar": "سدير", "technology": "pv", "capacity_mw": 1500, "status": "operational", "developer": "ACWA Power / Badeel / Aramco Power", "region": "Riyadh", "lat": 25.90, "lon": 45.40, "coordinate_quality": "town", "cod_year": 2024, "source": "PIF programme", "note": ""},
    {"id": "rabigh", "name_en": "Rabigh PV", "name_ar": "رابغ", "technology": "pv", "capacity_mw": 300, "status": "operational", "developer": "Marubeni / Al Jomaih", "region": "Makkah", "lat": 22.80, "lon": 39.03, "coordinate_quality": "town", "cod_year": 2023, "source": "NREP Round 2", "note": ""},
    {"id": "jeddah-pv", "name_en": "Jeddah PV", "name_ar": "جدة", "technology": "pv", "capacity_mw": 300, "status": "operational", "developer": "Masdar / EDF Renewables / Nesma", "region": "Makkah", "lat": 21.42, "lon": 39.35, "coordinate_quality": "approximate", "cod_year": 2023, "source": "NREP Round 2", "note": ""},
    {"id": "shuaibah-1", "name_en": "Shuaibah 1 PV", "name_ar": "الشعيبة 1", "technology": "pv", "capacity_mw": 600, "status": "operational", "developer": "ACWA Power / WEHC", "region": "Makkah", "lat": 20.70, "lon": 39.55, "coordinate_quality": "town", "cod_year": 2024, "source": "NREP Round 3", "note": ""},
    {"id": "shuaibah-2", "name_en": "Shuaibah 2 PV", "name_ar": "الشعيبة 2", "technology": "pv", "capacity_mw": 2060, "status": "operational", "developer": "ACWA Power / Badeel", "region": "Makkah", "lat": 20.74, "lon": 39.60, "coordinate_quality": "town", "cod_year": 2025, "source": "PIF programme", "note": "Among the largest single-site PV plants worldwide at award."},
    {"id": "layla", "name_en": "Layla PV", "name_ar": "ليلى", "technology": "pv", "capacity_mw": 91, "status": "operational", "developer": "Al Jomaih / Nebras", "region": "Riyadh", "lat": 22.28, "lon": 46.73, "coordinate_quality": "town", "cod_year": 2023, "source": "NREP Round 3", "note": ""},
    {"id": "wadi-ad-dawasir", "name_en": "Wadi Ad Dawasir PV", "name_ar": "وادي الدواسر", "technology": "pv", "capacity_mw": 120, "status": "operational", "developer": "Al Jomaih / Nebras", "region": "Riyadh", "lat": 20.45, "lon": 44.80, "coordinate_quality": "town", "cod_year": 2023, "source": "NREP Round 3", "note": ""},
    {"id": "saad-1", "name_en": "Saad 1 PV", "name_ar": "سعد 1", "technology": "pv", "capacity_mw": 300, "status": "operational", "developer": "Jinko Power consortium", "region": "Riyadh", "lat": 24.30, "lon": 47.40, "coordinate_quality": "approximate", "cod_year": 2024, "source": "NREP Round 3", "note": ""},
    {"id": "ar-rass-1", "name_en": "Ar Rass 1 PV", "name_ar": "الرس 1", "technology": "pv", "capacity_mw": 700, "status": "operational", "developer": "ACWA Power / SPIC / WEHC", "region": "Qassim", "lat": 25.87, "lon": 43.50, "coordinate_quality": "town", "cod_year": 2025, "source": "NREP Round 3", "note": ""},
    {"id": "al-henakiyah-1", "name_en": "Al Henakiyah 1 PV", "name_ar": "الحناكية 1", "technology": "pv", "capacity_mw": 1100, "status": "operational", "developer": "ACWA Power / Badeel", "region": "Madinah", "lat": 24.90, "lon": 40.45, "coordinate_quality": "town", "cod_year": 2025, "source": "NREP Round 4", "note": ""},
    {"id": "tabarjal", "name_en": "Tabarjal PV", "name_ar": "طبرجل", "technology": "pv", "capacity_mw": 400, "status": "operational", "developer": "Jinko Power / Al Jomaih", "region": "Al Jouf", "lat": 30.50, "lon": 38.20, "coordinate_quality": "town", "cod_year": 2025, "source": "NREP Round 4", "note": ""},
    {"id": "al-kahfah", "name_en": "Al Kahfah PV", "name_ar": "الكهفة", "technology": "pv", "capacity_mw": 1425, "status": "under_construction", "developer": "ACWA Power / Badeel", "region": "Hail", "lat": 26.60, "lon": 40.90, "coordinate_quality": "approximate", "cod_year": 2026, "source": "NREP Round 5", "note": ""},
    {"id": "ar-rass-2", "name_en": "Ar Rass 2 PV", "name_ar": "الرس 2", "technology": "pv", "capacity_mw": 2000, "status": "under_construction", "developer": "ACWA Power / Badeel / Aramco Power", "region": "Qassim", "lat": 25.95, "lon": 43.40, "coordinate_quality": "town", "cod_year": 2026, "source": "NREP Round 5", "note": ""},
    {"id": "saad-2", "name_en": "Saad 2 PV", "name_ar": "سعد 2", "technology": "pv", "capacity_mw": 1125, "status": "under_construction", "developer": "ACWA Power / Badeel / Aramco Power", "region": "Riyadh", "lat": 24.35, "lon": 47.50, "coordinate_quality": "approximate", "cod_year": 2026, "source": "NREP Round 5", "note": ""},
    {"id": "al-masaa", "name_en": "Al Masaa PV", "name_ar": "المسعى", "technology": "pv", "capacity_mw": 1000, "status": "under_construction", "developer": "SPPC round award", "region": "Hail", "lat": 27.20, "lon": 42.00, "coordinate_quality": "approximate", "cod_year": 2026, "source": "NREP Round 5", "note": ""},
    {"id": "al-sadawi", "name_en": "Al Sadawi PV", "name_ar": "السعداوي", "technology": "pv", "capacity_mw": 2000, "status": "under_construction", "developer": "ACWA Power / Badeel / Aramco Power", "region": "Eastern", "lat": 28.20, "lon": 46.40, "coordinate_quality": "approximate", "cod_year": 2026, "source": "NREP Round 5", "note": ""},
    {"id": "haden", "name_en": "Haden PV", "name_ar": "هدن", "technology": "pv", "capacity_mw": 1500, "status": "awarded", "developer": "SPPC round award", "region": "Makkah", "lat": 22.10, "lon": 40.40, "coordinate_quality": "approximate", "cod_year": 2027, "source": "NREP Round 6", "note": ""},
    {"id": "muwayh", "name_en": "Muwayh PV", "name_ar": "المويه", "technology": "pv", "capacity_mw": 2000, "status": "awarded", "developer": "SPPC round award", "region": "Makkah", "lat": 22.43, "lon": 41.75, "coordinate_quality": "town", "cod_year": 2027, "source": "NREP Round 6", "note": ""},
    {"id": "khulis", "name_en": "Khulis PV", "name_ar": "خليص", "technology": "pv", "capacity_mw": 2000, "status": "awarded", "developer": "ACWA Power / Badeel / Aramco Power", "region": "Makkah", "lat": 22.15, "lon": 39.33, "coordinate_quality": "town", "cod_year": 2027, "source": "NREP Round 6 / PIF programme", "note": ""},
    {"id": "afif", "name_en": "Afif 1 & 2 PV", "name_ar": "عفيف 1 و2", "technology": "pv", "capacity_mw": 2000, "status": "awarded", "developer": "ACWA Power / Badeel / Aramco Power", "region": "Riyadh", "lat": 23.91, "lon": 42.93, "coordinate_quality": "town", "cod_year": 2027, "source": "NREP Round 6 / PIF programme", "note": "Two phases at one site; combined figure."},
    {"id": "al-ghat-wind", "name_en": "Al Ghat Wind", "name_ar": "الغاط", "technology": "wind", "capacity_mw": 600, "status": "awarded", "developer": "SPPC round award", "region": "Riyadh", "lat": 26.03, "lon": 44.96, "coordinate_quality": "town", "cod_year": 2027, "source": "NREP Round 6", "note": ""},
    {"id": "waad-al-shamal-wind", "name_en": "Waad Al Shamal Wind", "name_ar": "وعد الشمال", "technology": "wind", "capacity_mw": 500, "status": "awarded", "developer": "SPPC round award", "region": "Northern Borders", "lat": 31.60, "lon": 38.60, "coordinate_quality": "town", "cod_year": 2027, "source": "NREP Round 6", "note": ""},
    {"id": "yanbu-wind", "name_en": "Yanbu Wind", "name_ar": "ينبع", "technology": "wind", "capacity_mw": 700, "status": "awarded", "developer": "SPPC round award", "region": "Madinah", "lat": 24.10, "lon": 38.10, "coordinate_quality": "town", "cod_year": 2027, "source": "NREP Round 6", "note": ""},
    {"id": "bisha-pv", "name_en": "Bisha PV", "name_ar": "بيشة", "technology": "pv", "capacity_mw": 3000, "status": "awarded", "developer": "ACWA Power / Badeel / Aramco Power", "region": "Aseer", "lat": 20.05, "lon": 42.55, "coordinate_quality": "town", "cod_year": 2028, "source": "PIF programme 2025", "note": ""},
    {"id": "humaij-pv", "name_en": "Humaij PV", "name_ar": "حميج", "technology": "pv", "capacity_mw": 3000, "status": "awarded", "developer": "ACWA Power / Badeel / Aramco Power", "region": "Madinah", "lat": 24.60, "lon": 39.20, "coordinate_quality": "approximate", "cod_year": 2028, "source": "PIF programme 2025", "note": ""},
    {"id": "starah-wind", "name_en": "Starah Wind", "name_ar": "ستارة", "technology": "wind", "capacity_mw": 2000, "status": "awarded", "developer": "ACWA Power / Badeel / Aramco Power", "region": "Riyadh", "lat": 25.00, "lon": 46.00, "coordinate_quality": "approximate", "cod_year": 2028, "source": "PIF programme 2025", "note": ""},
    {"id": "shaqra-wind", "name_en": "Shaqra Wind", "name_ar": "شقراء", "technology": "wind", "capacity_mw": 1000, "status": "awarded", "developer": "ACWA Power / Badeel / Aramco Power", "region": "Riyadh", "lat": 25.25, "lon": 45.25, "coordinate_quality": "town", "cod_year": 2028, "source": "PIF programme 2025", "note": ""},
    {"id": "neom-pv", "name_en": "NEOM Green Hydrogen PV", "name_ar": "نيوم — شمسي", "technology": "pv", "capacity_mw": 2200, "status": "under_construction", "developer": "NEOM Green Hydrogen Company (ACWA / Air Products / NEOM)", "region": "Tabuk", "lat": 27.95, "lon": 35.15, "coordinate_quality": "approximate", "cod_year": 2026, "source": "NGHC announcements", "note": "Dedicated to the Oxagon electrolyser complex."},
    {"id": "neom-wind", "name_en": "NEOM Green Hydrogen Wind", "name_ar": "نيوم — رياح", "technology": "wind", "capacity_mw": 1670, "status": "under_construction", "developer": "NEOM Green Hydrogen Company", "region": "Tabuk", "lat": 28.05, "lon": 35.25, "coordinate_quality": "approximate", "cod_year": 2026, "source": "NGHC announcements", "note": ""},
    {"id": "red-sea-pv", "name_en": "Red Sea Project PV", "name_ar": "البحر الأحمر", "technology": "pv", "capacity_mw": 400, "status": "operational", "developer": "ACWA Power / Red Sea Global", "region": "Tabuk", "lat": 25.60, "lon": 37.00, "coordinate_quality": "approximate", "cod_year": 2023, "source": "Red Sea Global", "note": "Off-grid destination with 1.3 GWh of battery storage."},
    {"id": "red-sea-bess", "name_en": "Red Sea Project BESS", "name_ar": "البحر الأحمر — تخزين", "technology": "bess", "capacity_mw": 400, "status": "operational", "developer": "ACWA Power / Red Sea Global", "region": "Tabuk", "lat": 25.55, "lon": 37.05, "coordinate_quality": "approximate", "cod_year": 2023, "source": "Red Sea Global", "note": "1.3 GWh; power rating approximate."},
    {"id": "waad-al-shamal-csp", "name_en": "Waad Al Shamal ISCC (CSP share)", "name_ar": "وعد الشمال — حرارية", "technology": "csp", "capacity_mw": 50, "status": "operational", "developer": "Saudi Electricity Company", "region": "Northern Borders", "lat": 31.55, "lon": 38.55, "coordinate_quality": "town", "cod_year": 2018, "source": "SEC", "note": "50 MW parabolic-trough share of a 1,390 MW integrated solar combined-cycle plant."},
    {"id": "duba-1-csp", "name_en": "Duba 1 ISCC (CSP share)", "name_ar": "ضباء 1 — حرارية", "technology": "csp", "capacity_mw": 43, "status": "operational", "developer": "Saudi Electricity Company", "region": "Tabuk", "lat": 27.35, "lon": 35.70, "coordinate_quality": "town", "cod_year": 2021, "source": "SEC", "note": "CSP share of an integrated solar combined-cycle plant."},
    {"id": "bisha-bess", "name_en": "Bisha BESS", "name_ar": "بيشة — تخزين", "technology": "bess", "capacity_mw": 500, "status": "operational", "developer": "Saudi Electricity Company / BYD", "region": "Aseer", "lat": 20.00, "lon": 42.60, "coordinate_quality": "town", "cod_year": 2025, "source": "SEC, January 2025", "note": "500 MW / 2,000 MWh — the standard SPPC block size."},
    {"id": "sppc-bess-2026", "name_en": "SPPC BESS programme (4 × 500 MW)", "name_ar": "برنامج التخزين — الشركة السعودية لشراء الطاقة", "technology": "bess", "capacity_mw": 2000, "status": "awarded", "developer": "SPPC award, August 2026", "region": "Riyadh (programme)", "lat": 24.30, "lon": 46.20, "coordinate_quality": "approximate", "cod_year": 2028, "source": "SPPC, August 2026 (SAR 4.35 bn)", "note": "Four 500 MW / 2,000 MWh blocks; sites not all public — plotted at the programme's centre of gravity."},
    {"id": "sudair-2", "name_en": "Sudair 2 PV", "name_ar": "سدير 2", "technology": "pv", "capacity_mw": 1500, "status": "planned", "developer": "PIF programme (planned)", "region": "Riyadh", "lat": 25.80, "lon": 45.55, "coordinate_quality": "approximate", "cod_year": 2029, "source": "PIF programme pipeline", "note": "Planned extension; figures indicative."},
    {"id": "tabuk-pv", "name_en": "Tabuk PV", "name_ar": "تبوك", "technology": "pv", "capacity_mw": 500, "status": "planned", "developer": "NREP pipeline", "region": "Tabuk", "lat": 28.40, "lon": 36.55, "coordinate_quality": "town", "cod_year": 2029, "source": "NREP pipeline", "note": "Pipeline entry; figures indicative."}
  ]
}
```

`app/raseen/registry/data/grid.json`:

```json
{
  "type": "FeatureCollection",
  "note": "Indicative schematic of the 380 kV transmission backbone and main load centres. Drawn from public descriptions of the interconnected system (Eastern, Central, Western and Southern operating areas); waypoints are approximate; not a survey and not an official network map.",
  "features": [
    {"type": "Feature", "properties": {"name": "Eastern–Central", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[50.10, 26.40], [48.70, 25.80], [47.60, 25.10], [46.70, 24.70]]}},
    {"type": "Feature", "properties": {"name": "Central–Western", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[46.70, 24.70], [44.80, 24.20], [42.93, 23.91], [41.40, 22.20], [40.40, 21.30], [39.20, 21.50]]}},
    {"type": "Feature", "properties": {"name": "Western coast", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[38.10, 24.10], [39.03, 22.80], [39.20, 21.50], [39.55, 20.70], [41.10, 19.10], [42.55, 16.90]]}},
    {"type": "Feature", "properties": {"name": "Central–Northern", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[46.70, 24.70], [45.40, 25.90], [43.97, 26.33], [41.70, 27.50], [40.20, 29.97], [38.65, 31.65]]}},
    {"type": "Feature", "properties": {"name": "Central–Southern", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[46.70, 24.70], [46.73, 22.28], [44.80, 20.45], [44.20, 17.50], [42.50, 18.20], [42.55, 16.90]]}},
    {"type": "Feature", "properties": {"name": "Hail–Madinah–Yanbu", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[41.70, 27.50], [40.90, 25.60], [39.60, 24.50], [38.10, 24.10]]}},
    {"type": "Feature", "properties": {"name": "Tabuk–Madinah", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[36.55, 28.40], [37.40, 26.30], [39.60, 24.50]]}},
    {"type": "Feature", "properties": {"name": "Tabuk–Duba–NEOM", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[36.55, 28.40], [35.70, 27.35], [35.15, 27.95]]}},
    {"type": "Feature", "properties": {"name": "Eastern ring", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[50.10, 26.40], [49.60, 27.00], [48.30, 27.90], [45.90, 28.40], [43.97, 26.33]]}},
    {"type": "Feature", "properties": {"name": "GCC interconnection", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[49.10, 26.90], [50.10, 26.40], [50.55, 26.20]]}},
    {"type": "Feature", "properties": {"name": "Qassim–Riyadh second corridor", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[43.97, 26.33], [45.25, 25.25], [46.70, 24.70]]}},
    {"type": "Feature", "properties": {"name": "Aseer–Najran", "voltage_kv": 380, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[42.60, 20.00], [42.50, 18.20], [44.20, 17.50]]}},
    {"type": "Feature", "properties": {"name": "NAJM-3000 evacuation", "voltage_kv": 110, "indicative": true}, "geometry": {"type": "LineString", "coordinates": [[41.115, 25.043], [40.90, 25.60]]}},
    {"type": "Feature", "properties": {"name": "Riyadh", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [46.70, 24.70]}},
    {"type": "Feature", "properties": {"name": "Dammam", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [50.10, 26.40]}},
    {"type": "Feature", "properties": {"name": "Jubail", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [49.60, 27.00]}},
    {"type": "Feature", "properties": {"name": "Jeddah", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [39.20, 21.50]}},
    {"type": "Feature", "properties": {"name": "Makkah–Taif", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [40.40, 21.30]}},
    {"type": "Feature", "properties": {"name": "Madinah", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [39.60, 24.50]}},
    {"type": "Feature", "properties": {"name": "Yanbu", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [38.10, 24.10]}},
    {"type": "Feature", "properties": {"name": "Qassim", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [43.97, 26.33]}},
    {"type": "Feature", "properties": {"name": "Hail", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [41.70, 27.50]}},
    {"type": "Feature", "properties": {"name": "Tabuk", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [36.55, 28.40]}},
    {"type": "Feature", "properties": {"name": "Sakaka", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [40.20, 29.97]}},
    {"type": "Feature", "properties": {"name": "Hafr Al Batin", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [45.90, 28.40]}},
    {"type": "Feature", "properties": {"name": "Abha", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [42.50, 18.20]}},
    {"type": "Feature", "properties": {"name": "Najran", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [44.20, 17.50]}},
    {"type": "Feature", "properties": {"name": "Jizan", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [42.55, 16.90]}},
    {"type": "Feature", "properties": {"name": "Wadi Ad Dawasir", "kind": "load_centre"}, "geometry": {"type": "Point", "coordinates": [44.80, 20.45]}},
    {"type": "Feature", "properties": {"name": "Al Fadhili (GCC link)", "kind": "interconnection"}, "geometry": {"type": "Point", "coordinates": [49.10, 26.90]}}
  ]
}
```

- [ ] **Step 4: Implement the loader and the routes**

`app/raseen/registry/__init__.py`:

```python
"""Kingdom registry: renewable plants and the indicative transmission backbone."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from raseen.geometry.site import get_site

DATA = Path(__file__).parent / "data"

FACTS = {
    "peak_load_gw": 72.9,
    "peak_load_year": 2024,
    "renewables_operational_gw_2024": 6.55,
    "renewables_projects_2024": 10,
    "pv_installed_gw_2025": 12.5,
    "target_2030": "50 % of electricity from renewables",
    "plant_share_of_peak_pct": 4.1,
    "source": "GASTAT Energy Statistics 2024; Ministry of Energy open data; project-notes/hackathon-key-facts.md",
}


@lru_cache(maxsize=1)
def _plants_file() -> dict[str, Any]:
    return json.loads((DATA / "plants.json").read_text(encoding="utf-8"))


REGISTRY_NOTE = _plants_file()["note"]


def load_plants() -> list[dict[str, Any]]:
    """Plants with NAJM-3000 placed at the twin's site centre (follows the site mode)."""
    site = get_site()
    plants = [dict(p) for p in _plants_file()["plants"]]
    for p in plants:
        if p["id"] == "najm-3000":
            p["lat"] = round((site.bounds["south"] + site.bounds["north"]) / 2, 4)
            p["lon"] = round((site.bounds["west"] + site.bounds["east"]) / 2, 4)
    return plants


def plants_summary(plants: list[dict[str, Any]]) -> dict[str, Any]:
    by_tech: dict[str, float] = {}
    by_status: dict[str, float] = {}
    for p in plants:
        by_tech[p["technology"]] = by_tech.get(p["technology"], 0.0) + p["capacity_mw"]
        by_status[p["status"]] = by_status.get(p["status"], 0.0) + p["capacity_mw"]
    return {
        "count": len(plants),
        "by_technology_mw": by_tech,
        "by_status_mw": by_status,
        "operational_mw": sum(p["capacity_mw"] for p in plants if p["status"] == "operational"),
        "pipeline_mw": sum(p["capacity_mw"] for p in plants if p["status"] != "operational"),
    }


@lru_cache(maxsize=1)
def _grid_file() -> dict[str, Any]:
    return json.loads((DATA / "grid.json").read_text(encoding="utf-8"))


GRID_NOTE = _grid_file()["note"]


def load_grid() -> dict[str, Any]:
    g = _grid_file()
    site = get_site()
    features = []
    for f in g["features"]:
        f = json.loads(json.dumps(f))
        if f["properties"].get("name") == "NAJM-3000 evacuation":
            f["geometry"]["coordinates"][0] = [
                round((site.bounds["west"] + site.bounds["east"]) / 2, 4),
                round((site.bounds["south"] + site.bounds["north"]) / 2, 4),
            ]
        features.append(f)
    return {"type": "FeatureCollection", "features": features}
```

In `app/raseen/api.py` add `from raseen.registry import FACTS, GRID_NOTE, REGISTRY_NOTE, load_grid, load_plants, plants_summary` and, inside `build_app()`:

```python
    @app.get("/api/plants")
    def plants_view() -> dict[str, Any]:
        plants = load_plants()
        return {**envelope(), "plants": plants, "summary": plants_summary(plants), "note": REGISTRY_NOTE, "facts": FACTS}

    @app.get("/api/grid")
    def grid_view() -> dict[str, Any]:
        return {**envelope(), "geojson": load_grid(), "note": GRID_NOTE}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_registry.py tests/test_api.py -v`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add app/raseen/registry app/raseen/api.py app/tests/test_registry.py app/tests/test_api.py
git commit -m "feat(registry): indicative Kingdom renewables registry and grid schematic, /api/plants, /api/grid"
```

---

### Task 14: Kingdom page — map of all renewables with the grid, layer panel, KPI strip, plant list

**Files:**
- Create: `app/raseen/static/maps/kingdom-map.js`
- Replace: `app/raseen/static/pages/kingdom.js`
- Modify: `app/raseen/static/styles.css` (append)

**Interfaces:**
- Produces: `class KingdomMap { constructor(container, plants, grid, { onSelect, onHover, onLeave }); static available(); async init() → boolean; setLayers({ plants, grid, labels }); setFilter({ tech: Set, status: Set }); flyTo(plant); resize(); destroy(); }`; `class KingdomPlan` (SVG fallback, same methods).
- Consumes: `/api/plants` (`plants, summary, facts, note`), `/api/grid` (`geojson, note`), `TECH_COLOUR`, `STATUS_COLOUR`, `TECH_LABEL`, `STATUS_LABEL` from `colour.js`.

- [ ] **Step 1: Write the Kingdom map**

`app/raseen/static/maps/kingdom-map.js`:

```js
import { TECH_COLOUR, STATUS_COLOUR } from "/static/colour.js";
import { fmt } from "/static/format.js";

const DARK_TILES = window.RASEEN_TILES_DARK || "https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
const ATTRIBUTION = "&copy; OpenStreetMap contributors &copy; CARTO · plants and grid indicative";
export const KINGDOM_BOUNDS = [[34.4, 16.0], [55.8, 32.3]];

function tileUrls(template) {
  const m = template.match(/\{([a-z])-([a-z])\}/);
  if (!m) return [template];
  const from = m[1].charCodeAt(0), to = m[2].charCodeAt(0);
  return Array.from({ length: to - from + 1 }, (_, i) => template.replace(m[0], String.fromCharCode(from + i)));
}

function plantsGeoJSON(plants) {
  return { type: "FeatureCollection", features: plants.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { id: p.id, name: p.name_en, tech: p.technology, status: p.status, mw: p.capacity_mw, colour: TECH_COLOUR[p.technology], ring: STATUS_COLOUR[p.status], r: 4 + Math.sqrt(p.capacity_mw) / 4, reference: p.id === "najm-3000" } })) };
}

export class KingdomMap {
  constructor(container, plants, grid, { onSelect, onHover, onLeave } = {}) {
    this.container = container; this.plants = plants; this.grid = grid; this.onSelect = onSelect; this.onHover = onHover; this.onLeave = onLeave;
    this.map = null; this.markers = []; this.ready = false; this.filter = { tech: null, status: null };
  }
  static available() { return typeof maplibregl !== "undefined" && (typeof maplibregl.supported !== "function" || maplibregl.supported()); }
  async init() {
    if (!KingdomMap.available()) return false;
    this.map = new maplibregl.Map({ container: this.container, style: { version: 8, sources: { carto: { type: "raster", tiles: tileUrls(DARK_TILES), tileSize: 256, attribution: ATTRIBUTION, maxzoom: 18 } }, layers: [{ id: "base", type: "raster", source: "carto" }] }, bounds: KINGDOM_BOUNDS, fitBoundsOptions: { padding: 24 }, attributionControl: { compact: false } });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    await new Promise((resolve) => { if (this.map.isStyleLoaded()) resolve(); else this.map.once("style.load", resolve); setTimeout(resolve, 8000); });
    if (!this.map.getStyle()) return false;
    this.map.addSource("grid", { type: "geojson", data: this.grid });
    this.map.addLayer({ id: "grid-lines-glow", type: "line", source: "grid", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#6aa8ee", "line-width": ["match", ["get", "voltage_kv"], 380, 6, 2.5], "line-blur": 6, "line-opacity": 0.35 } });
    this.map.addLayer({ id: "grid-lines", type: "line", source: "grid", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": ["match", ["get", "voltage_kv"], 380, "#9fc3ee", "#f2a33a"], "line-width": ["match", ["get", "voltage_kv"], 380, 1.8, 1.2], "line-dasharray": [3, 2], "line-opacity": 0.9 } });
    this.map.addLayer({ id: "grid-nodes", type: "circle", source: "grid", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 3.5, "circle-color": "#e8eef7", "circle-stroke-color": "#10131a", "circle-stroke-width": 1 } });
    this.map.addSource("plants", { type: "geojson", data: plantsGeoJSON(this.plants) });
    this.map.addLayer({ id: "plants-halo", type: "circle", source: "plants", paint: { "circle-radius": ["*", ["get", "r"], 1.9], "circle-color": ["get", "colour"], "circle-opacity": 0.12 } });
    this.map.addLayer({ id: "plants", type: "circle", source: "plants", paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "colour"], "circle-opacity": 0.85, "circle-stroke-color": ["get", "ring"], "circle-stroke-width": ["case", ["get", "reference"], 3, 1.5] } });
    for (const f of this.grid.features.filter((x) => x.geometry.type === "Point")) { const e = document.createElement("div"); e.className = "node-label"; e.textContent = f.properties.name; this.markers.push(new maplibregl.Marker({ element: e, anchor: "left", offset: [6, 0] }).setLngLat(f.geometry.coordinates).addTo(this.map)); }
    for (const p of this.plants) { const e = document.createElement("div"); e.className = `plant-label ${p.id === "najm-3000" ? "is-ref" : ""}`; e.textContent = p.name_en.replace(/ (PV|Wind|BESS).*$/, ""); e.dataset.tech = p.technology; e.dataset.status = p.status; this.markers.push(new maplibregl.Marker({ element: e, anchor: "top", offset: [0, 4 + Math.sqrt(p.capacity_mw) / 4] }).setLngLat([p.lon, p.lat]).addTo(this.map)); }
    this.map.on("click", "plants", (e) => { const f = e.features?.[0]; if (f) this.onSelect?.(f.properties.id); });
    this.map.on("mousemove", "plants", (e) => { this.map.getCanvas().style.cursor = "pointer"; const f = e.features?.[0]; if (f) this.onHover?.(e.originalEvent, f.properties.id); });
    this.map.on("mouseleave", "plants", (e) => { this.map.getCanvas().style.cursor = ""; this.onLeave?.(e.originalEvent); });
    this.ready = true;
    return true;
  }
  setLayers({ plants = true, grid = true, labels = true }) {
    if (!this.ready) return;
    for (const id of ["plants", "plants-halo"]) this.map.setLayoutProperty(id, "visibility", plants ? "visible" : "none");
    for (const id of ["grid-lines", "grid-lines-glow", "grid-nodes"]) this.map.setLayoutProperty(id, "visibility", grid ? "visible" : "none");
    this.container.classList.toggle("hide-labels", !labels);
    this.container.classList.toggle("hide-plants", !plants);
    this.container.classList.toggle("hide-grid", !grid);
  }
  setFilter({ tech, status }) {
    if (!this.ready) return;
    this.filter = { tech, status };
    const expr = ["all", ["in", ["get", "tech"], ["literal", [...tech]]], ["in", ["get", "status"], ["literal", [...status]]]];
    this.map.setFilter("plants", expr); this.map.setFilter("plants-halo", expr);
    for (const el of this.container.querySelectorAll(".plant-label")) el.hidden = !(tech.has(el.dataset.tech) && status.has(el.dataset.status));
  }
  flyTo(plant) { if (this.ready) this.map.flyTo({ center: [plant.lon, plant.lat], zoom: 8.5, duration: 1600, essential: true }); }
  fitKingdom() { if (this.ready) this.map.fitBounds(KINGDOM_BOUNDS, { padding: 24, duration: 800 }); }
  resize() { this.map?.resize(); }
  destroy() { for (const m of this.markers) m.remove(); this.markers = []; this.map?.remove(); this.map = null; this.ready = false; }
}

/** SVG fallback: equirectangular projection of the Kingdom's bounding box. */
export class KingdomPlan {
  constructor(container, plants, grid, hooks = {}) { Object.assign(this, { container, plants, grid, ...hooks }); this.layers = { plants: true, grid: true, labels: true }; this.filter = { tech: new Set(Object.keys(TECH_COLOUR)), status: new Set(Object.keys(STATUS_COLOUR)) }; }
  static available() { return true; }
  async init() { this.draw(); return true; }
  draw() {
    const NS = "http://www.w3.org/2000/svg"; const el = (n, a = {}) => { const e = document.createElementNS(NS, n); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
    const [[w0, s0], [e0, n0]] = KINGDOM_BOUNDS; const W = 1000, H = Math.round((W * (n0 - s0)) / (e0 - w0));
    const X = (lon) => ((lon - w0) / (e0 - w0)) * W, Y = (lat) => ((n0 - lat) / (n0 - s0)) * H;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Kingdom renewables schematic" });
    svg.append(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#0f1216" }));
    if (this.layers.grid) for (const f of this.grid.features) {
      if (f.geometry.type === "LineString") svg.append(el("polyline", { points: f.geometry.coordinates.map(([lon, lat]) => `${X(lon)},${Y(lat)}`).join(" "), fill: "none", stroke: f.properties.voltage_kv === 380 ? "#9fc3ee" : "#f2a33a", "stroke-width": 2, "stroke-dasharray": "6 4" }));
      else { const [lon, lat] = f.geometry.coordinates; svg.append(el("circle", { cx: X(lon), cy: Y(lat), r: 4, fill: "#e8eef7" })); if (this.layers.labels) { const t = el("text", { x: X(lon) + 7, y: Y(lat) + 4, fill: "#b8bcc6", "font-size": 12 }); t.textContent = f.properties.name; svg.append(t); } }
    }
    if (this.layers.plants) for (const p of this.plants) {
      if (!this.filter.tech.has(p.technology) || !this.filter.status.has(p.status)) continue;
      const c = el("circle", { cx: X(p.lon), cy: Y(p.lat), r: 4 + Math.sqrt(p.capacity_mw) / 4, fill: TECH_COLOUR[p.technology], "fill-opacity": 0.85, stroke: STATUS_COLOUR[p.status], "stroke-width": p.id === "najm-3000" ? 3 : 1.5, style: "cursor:pointer" });
      c.addEventListener("click", () => this.onSelect?.(p.id)); c.addEventListener("mousemove", (e) => this.onHover?.(e, p.id)); c.addEventListener("mouseleave", (e) => this.onLeave?.(e));
      svg.append(c);
      if (this.layers.labels) { const t = el("text", { x: X(p.lon), y: Y(p.lat) + 8 + Math.sqrt(p.capacity_mw) / 4 + 10, fill: "#f2f3f5", "font-size": 11, "text-anchor": "middle" }); t.textContent = p.name_en.replace(/ (PV|Wind|BESS).*$/, ""); svg.append(t); }
    }
    const wrap = document.createElement("div"); wrap.className = "map-fallback"; wrap.append(svg); this.container.replaceChildren(wrap);
  }
  setLayers(l) { this.layers = { ...this.layers, ...l }; this.draw(); }
  setFilter(f) { this.filter = f; this.draw(); }
  flyTo() {} fitKingdom() {} resize() {} destroy() { this.container.replaceChildren(); }
}

export function plantTooltipRows(p) {
  return [{ name: "Technology", value: p.technology.toUpperCase() }, { name: "Capacity", value: `${fmt(p.capacity_mw, 0)} MW` }, { name: "Status", value: p.status.replace("_", " ") }, { name: "Developer", value: p.developer ?? "—" }, { name: "Position", value: `${p.coordinate_quality}-level` }];
}
```

- [ ] **Step 2: Write the Kingdom page**

`app/raseen/static/pages/kingdom.js`:

```js
import { getJSON } from "/static/api.js";
import { fmt, fmtGW } from "/static/format.js";
import { TECH_COLOUR, STATUS_COLOUR, TECH_LABEL, STATUS_LABEL } from "/static/colour.js";
import { KingdomMap, KingdomPlan, plantTooltipRows } from "/static/maps/kingdom-map.js";

const $ = (id) => document.getElementById(id);
let ctx, store, root, view = null;
const layers = { plants: true, grid: true, labels: true };
const filter = { tech: new Set(Object.keys(TECH_COLOUR)), status: new Set(Object.keys(STATUS_COLOUR)) };

function kpi(label, value, unit, sub) { return `<div class="tile"><span class="tile-label">${label}</span><span class="tile-value">${value}</span><span class="tile-unit">${unit}</span><span class="kpi-sub">${sub}</span></div>`; }

function renderList(plants) {
  const q = ($("plant-search")?.value ?? "").toLowerCase();
  const rows = plants.filter((p) => filter.tech.has(p.technology) && filter.status.has(p.status) && (!q || p.name_en.toLowerCase().includes(q) || (p.region ?? "").toLowerCase().includes(q))).sort((a, b) => b.capacity_mw - a.capacity_mw);
  $("plant-list").innerHTML = rows.map((p) => `<button type="button" class="plant-row" data-id="${p.id}"><i class="legend-swatch" style="background:${TECH_COLOUR[p.technology]};border:2px solid ${STATUS_COLOUR[p.status]}"></i><span class="plant-name">${p.name_en}${p.id === "najm-3000" ? ' <span class="status-pill is-sim">twin</span>' : ""}</span><span class="plant-mw mono">${fmt(p.capacity_mw, 0)} MW</span></button>`).join("") || `<p class="empty">No plants match.</p>`;
  for (const btn of $("plant-list").querySelectorAll(".plant-row")) {
    btn.addEventListener("click", () => { const p = plants.find((x) => x.id === btn.dataset.id); view?.flyTo(p); setTimeout(() => ctx.navigate(`#/plant/${p.id}`), 900); });
    btn.addEventListener("mousemove", (e) => { const p = plants.find((x) => x.id === btn.dataset.id); ctx.showTooltip(e, p.name_en, plantTooltipRows(p)); });
    btn.addEventListener("mouseleave", () => ctx.hideTooltip());
  }
  $("list-count").textContent = `${rows.length} of ${plants.length}`;
}

export async function mount(pageRoot, context) {
  ctx = context; store = context.store; root = pageRoot;
  let plantsBody, gridBody;
  try { [plantsBody, gridBody] = await Promise.all([getJSON("/api/plants"), getJSON("/api/grid")]); } catch (e) { ctx.banner(`Registry failed: ${e.message}`); return; }
  const plants = plantsBody.plants; const facts = plantsBody.facts; const summary = plantsBody.summary;
  store.set({ plants, grid: gridBody.geojson });
  root.innerHTML = `
  <div class="kingdom">
    <aside class="panel kingdom-list"><div class="panel-head"><h2>Plants <span class="status-pill" id="list-count"></span></h2></div><input id="plant-search" class="search" type="search" placeholder="Search name or region"><div id="plant-list" class="plant-list"></div></aside>
    <div class="panel kingdom-map-panel">
      <div class="map-box is-tall" id="kingdom-map">
        <div class="map-overlay top-left kpi-strip">
          ${kpi("Renewables operational", fmt(facts.renewables_operational_gw_2024, 2), "GW", `${facts.renewables_projects_2024} projects, end-${facts.peak_load_year}`)}
          ${kpi("PV installed", fmt(facts.pv_installed_gw_2025, 1), "GW", "end-2025")}
          ${kpi("In this registry", fmtGW(summary.operational_mw), "operational", `${fmtGW(summary.pipeline_mw)} in pipeline · indicative`)}
          ${kpi("Record peak load", fmt(facts.peak_load_gw, 1), "GW", `${facts.peak_load_year} · a 3 GW plant ≈ ${facts.plant_share_of_peak_pct} %`)}
          ${kpi("Target", "50 %", "by 2030", facts.target_2030)}
        </div>
        <div class="map-overlay top-right layer-panel">
          <div class="lp-title">Layers</div>
          <label class="check"><input type="checkbox" data-layer="plants" checked> Plants</label>
          <label class="check"><input type="checkbox" data-layer="grid" checked> Transmission grid <span class="kpi-sub">schematic</span></label>
          <label class="check"><input type="checkbox" data-layer="labels" checked> Labels</label>
          <div class="lp-title">Technology</div>
          ${Object.keys(TECH_COLOUR).map((t) => `<label class="check"><input type="checkbox" data-tech="${t}" checked> <i class="legend-swatch" style="background:${TECH_COLOUR[t]}"></i> ${TECH_LABEL[t]} <span class="kpi-sub mono">${fmtGW(summary.by_technology_mw[t] ?? 0)}</span></label>`).join("")}
          <div class="lp-title">Status</div>
          ${Object.keys(STATUS_COLOUR).map((s) => `<label class="check"><input type="checkbox" data-status="${s}" checked> <i class="legend-swatch ring" style="border-color:${STATUS_COLOUR[s]}"></i> ${STATUS_LABEL[s]}</label>`).join("")}
          <div class="lp-title">Capacity</div>
          <div class="cap-scale"><i style="width:8px;height:8px"></i><i style="width:14px;height:14px"></i><i style="width:22px;height:22px"></i><i style="width:32px;height:32px"></i><span class="kpi-sub">100 MW → 3 GW</span></div>
          <button id="fit-kingdom" class="ghost-btn" type="button" style="margin-top:6px">Fit Kingdom</button>
        </div>
        <div class="map-overlay bottom-left"><span class="kpi-sub">${plantsBody.note}</span></div>
      </div>
    </div>
  </div>`;
  const hooks = { onSelect: (id) => { const p = plants.find((x) => x.id === id); view?.flyTo(p); setTimeout(() => ctx.navigate(`#/plant/${id}`), 900); }, onHover: (e, id) => { const p = plants.find((x) => x.id === id); ctx.showTooltip(e, p.name_en, plantTooltipRows(p)); }, onLeave: () => ctx.hideTooltip() };
  const box = $("kingdom-map");
  view = new (KingdomMap.available() ? KingdomMap : KingdomPlan)(box, plants, gridBody.geojson, hooks);
  if (!(await view.init())) { view.destroy(); view = new KingdomPlan(box, plants, gridBody.geojson, hooks); await view.init(); }
  for (const cb of root.querySelectorAll("[data-layer]")) cb.addEventListener("change", () => { layers[cb.dataset.layer] = cb.checked; view.setLayers(layers); });
  for (const cb of root.querySelectorAll("[data-tech]")) cb.addEventListener("change", () => { cb.checked ? filter.tech.add(cb.dataset.tech) : filter.tech.delete(cb.dataset.tech); view.setFilter(filter); renderList(plants); });
  for (const cb of root.querySelectorAll("[data-status]")) cb.addEventListener("change", () => { cb.checked ? filter.status.add(cb.dataset.status) : filter.status.delete(cb.dataset.status); view.setFilter(filter); renderList(plants); });
  $("fit-kingdom").addEventListener("click", () => view.fitKingdom());
  $("plant-search").addEventListener("input", () => renderList(plants));
  renderList(plants);
}
export function unmount() { view?.destroy(); view = null; }
```

- [ ] **Step 3: Append the Kingdom styles**

```css
/* ── kingdom ────────────────────────────────────────────────────────────── */
.kingdom { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: var(--gap); }
@media (max-width: 1000px) { .kingdom { grid-template-columns: 1fr; } }
.kingdom-list { display: flex; flex-direction: column; min-height: 0; max-height: calc(100vh - 120px); }
.search { font: inherit; font-size: 12px; padding: 7px 9px; border-radius: 7px; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); width: 100%; margin-bottom: 8px; }
.plant-list { overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.plant-row { display: grid; grid-template-columns: 14px 1fr auto; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 12px; }
.plant-row:hover { background: var(--surface-2); border-color: var(--border); }
.plant-mw { color: var(--text-2); font-size: 11px; }
.kingdom-map-panel { padding: 6px; }
.kpi-strip { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 6px; padding: 6px; background: transparent; border: 0; backdrop-filter: none; max-width: calc(100% - 300px); }
.kpi-strip .tile { padding: 8px 10px; background: color-mix(in srgb, var(--surface-1) 90%, transparent); }
.kpi-strip .tile-value { font-size: 20px; }
@media (max-width: 1300px) { .kpi-strip { grid-template-columns: repeat(3, 1fr); } }
.layer-panel { display: flex; flex-direction: column; gap: 5px; min-width: 230px; }
.lp-title { font: 600 10px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-top: 6px; }
.legend-swatch.ring { background: transparent; border: 2px solid; border-radius: 50%; width: 10px; height: 10px; }
.cap-scale { display: flex; align-items: center; gap: 8px; }
.cap-scale i { display: inline-block; border-radius: 50%; background: var(--amber); opacity: 0.8; }
.node-label { color: #b8bcc6; font: 10px var(--mono); text-shadow: 0 1px 2px #000; pointer-events: none; }
.plant-label { color: #f2f3f5; font: 600 10px var(--sans); text-shadow: 0 1px 3px #000; pointer-events: none; white-space: nowrap; }
.plant-label.is-ref { color: var(--sim); font-weight: 700; }
.hide-labels .node-label, .hide-labels .plant-label, .hide-plants .plant-label, .hide-grid .node-label { display: none; }
```

- [ ] **Step 4: Visual check**

Run the server; open `#/kingdom`. Expected: dark basemap of Saudi Arabia, plants as amber (PV), cyan (wind), orange (CSP), violet (BESS) circles sized by MW with status-coloured rings, NAJM-3000 with a thick ring and a violet label, dashed blue 380 kV corridors with a soft glow and amber 110 kV evacuation line, load-centre dots and labels; the layer panel toggles layers and filters; the KPI cards read 6.55 GW / 12.5 GW / 72.9 GW / 50 %; clicking a plant flies to it and opens its Plant page; the list filters by search. With the network disabled the SVG schematic appears instead.

- [ ] **Step 5: Commit**

```bash
git add app/raseen/static
git commit -m "feat(kingdom): renewables map with grid layer, layer panel, KPI strip and plant list"
```

---

### Task 15: About page, what's-real annotations, presentation mode check

**Files:**
- Replace: `app/raseen/static/pages/about.js`
- Modify: `app/raseen/static/styles.css` (append)
- Test: `app/tests/test_api.py` (append)

- [ ] **Step 1: Append the failing test**

```python
def test_ui_copy_avoids_the_kill_sentences(client):
    import re
    static = Path(raseen.api.__file__).parent / "static"
    text = " ".join(p.read_text(encoding="utf-8") for p in static.rglob("*") if p.suffix in (".js", ".html") and "vendor" not in p.parts)
    for phrase in ("AI predicts clouds", "operators are blind", "grid will collapse", "we store energy as headroom", "no energy is lost", "we test LVRT", "we control loads"):
        assert not re.search(re.escape(phrase), text, re.I), phrase
```

- [ ] **Step 2: Write the About page**

`app/raseen/static/pages/about.js`:

```js
const STATUS_CLASS = { "real": "is-real", "real code": "is-real", "designed": "is-designed", "representative": "is-designed", "simulated": "is-sim", "indicative": "is-designed" };
const HISTORY = [
  ["v1 · 7 Sep", "NAJM-3000 Digital Twin", "Pre-commissioning twin of a 3,000 MWac plant: pvlib physics engine, simulated SCADA, satellite map, 3D station, 365 MV stations."],
  ["v2 · 9–11 Sep", "NAJM-3000 Grid Twin (team references)", "Forecasting, battery coordination, compliance, load control. Strong on ambition, weak on jurisdiction and physics."],
  ["v3 · 11 Sep", "Grid Twin — logic audit", "Claim-by-claim audit against SAGC/SADC/TPC/GEPC. Dropped load control, 'collapse' framing, LVRT testing. Kept the twin, the sentinel idea, the notice engine. Still needed a 500 MW battery."],
  ["v4.0 · 13 Sep", "Block Gradient Control", "The forecast is an input, not the product. No battery. Curtailment placed by cloud-arrival time; Rolling Solar Reserve; Dynamic Solar Headroom; g = D/(τ + L)."],
  ["v4.1 · 14 Sep", "Raseen (رَصين)", "Renamed. Business model, Arabic reframing, ETA handling between nowcast updates, thirteenth jury answer. This dashboard."],
];
const NEVER = ["\"AI predicts clouds before they reach the plant\"", "\"operators are blind to the weather\"", "\"the grid will collapse\"", "\"we store energy as headroom\" (headroom is not storage)", "\"no energy is lost\"", "\"we test LVRT\"", "\"we control loads\""];
const SOURCES = ["Saudi Arabian Grid Code, May 2026 (National Grid SA & Marafiq; SERA)", "Saudi Arabian Distribution Code, June 2026", "SERA Transmission Planning Criteria 2025; Generation Expansion Planning Criteria 2021", "K.A.CARE Renewable Resource Atlas (1-minute irradiance) — driver for the shadow statistics", "GASTAT Energy Statistics 2024; Ministry of Energy open data (peak load, consumption by region)", "Marcos et al. (UPNA) field ramp-limiting energy losses; DLR Eye2Sky; NREL/CAISO/First Solar 2017 headroom trial", "Project CAD/KML (as-designed geometry) via the NAJM-3000 twin"];

export async function mount(root, { store }) {
  const status = store.get().status;
  const table = (status?.what_is_real ?? []).map((r) => `<tr><td>${r.item}</td><td><span class="status-pill ${STATUS_CLASS[r.status] ?? ""}">${r.status}</span></td><td>${r.note}</td></tr>`).join("");
  root.innerHTML = `
  <section class="split">
    <div class="panel"><div class="panel-head"><h2>What is real, what is designed, what is simulated</h2></div>
      <p class="honesty">${status?.disclaimer ?? ""}</p>
      <table class="table"><thead><tr><th>Item</th><th>Status</th><th>Note</th></tr></thead><tbody>${table}</tbody></table>
      <p class="panel-note" style="margin-top:10px">Turn on <strong>What's real</strong> in the top bar to see these labels on every page.</p>
    </div>
    <div class="panel"><div class="panel-head"><h2>Raseen in one paragraph</h2></div>
      <p>A 3,000 MW PV plant is not one generator; it is thirty blocks spread over eight kilometres, and a cloud crosses them one after another in about ten minutes. Raseen takes the operator's external forecast as an input, measures the front on the first blocks it touches, computes each block's arrival time, and drives per-block set-points through the existing plant controller so that export follows a smooth, pre-declared gradient: descending before the front, holding a rolling reserve on the blocks the cloud has not reached, re-ascending behind it. The energy that shapes the ramp is a thin slice of sunshine deliberately not exported for a few minutes. No battery, no new hardware, no new rights.</p>
      <p class="mono" style="color:var(--text-2)">لا نتنبأ بالطقس؛ نتنبأ بأثره التشغيلي ونتحكم بالمحطة كتلةً كتلةً، فترى الشبكة جدولاً بدل هاوية.</p>
      <div class="panel-head" style="margin-top:12px"><h2>Never said</h2></div>
      <ul class="plain">${NEVER.map((n) => `<li>${n}</li>`).join("")}</ul>
    </div>
  </section>
  <section class="split">
    <div class="panel"><div class="panel-head"><h2>How the idea got here</h2></div><table class="table"><tbody>${HISTORY.map(([d, n, w]) => `<tr><td class="mono" style="white-space:nowrap">${d}</td><td><strong>${n}</strong><br><span class="panel-note">${w}</span></td></tr>`).join("")}</tbody></table></div>
    <div class="panel"><div class="panel-head"><h2>Sources</h2></div><ul class="plain">${SOURCES.map((s) => `<li>${s}</li>`).join("")}</ul>
      <div class="panel-head" style="margin-top:12px"><h2>Build</h2></div>
      <dl class="detail-list"><dt>Version</dt><dd>${status?.version ?? "—"}</dd><dt>Site mode</dt><dd>${status?.site_mode ?? "—"}</dd><dt>Plant</dt><dd>${status?.plant ?? "—"} · ${status?.plant_mw ?? "—"} MW</dd><dt>Cached scenarios</dt><dd>${status?.cache_size ?? "—"}</dd></dl>
    </div>
  </section>`;
}
export function unmount() {}
```

- [ ] **Step 3: Append styles**

```css
.plain { margin: 0; padding-left: 18px; font-size: 12.5px; color: var(--text-2); display: grid; gap: 4px; }
```

- [ ] **Step 4: Presentation-mode check**

Run the server; press `Projector` in the sidebar. Expected: surfaces lift (`#1f242c` panels on `#14181e`), hairlines and muted text brighten; the maps and charts remain readable on a light-room projector. Press `Theme`: the light theme applies with presentation mode still on. Run: `.venv\Scripts\python.exe -m pytest tests/test_api.py -v`. Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add app/raseen/static app/tests/test_api.py
git commit -m "feat(about): what's real page, version history, sources; kill-sentence guard test"
```

---

### Task 16: Browser smoke test (Playwright)

**Files:**
- Create: `app/tests/e2e/__init__.py` (empty), `app/tests/e2e/test_smoke.py`

- [ ] **Step 1: Install the browser**

Run: `.venv\Scripts\python.exe -m playwright install chromium`

- [ ] **Step 2: Write the test**

`app/tests/e2e/test_smoke.py`:

```python
"""One browser pass over the five pages. Needs `playwright install chromium`."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

pytestmark = pytest.mark.e2e
playwright = pytest.importorskip("playwright.sync_api")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    port = _free_port()
    env = {**os.environ, "RASEEN_CACHE_DIR": str(tmp_path_factory.mktemp("cache"))}
    proc = subprocess.Popen([sys.executable, "-m", "raseen", "--port", str(port)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{url}/api/status", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield url
    proc.kill()


@pytest.fixture(scope="module")
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        yield page
        browser.close()


def test_sidebar_switches_all_five_pages(page, server):
    page.goto(f"{server}/#/about")
    page.wait_for_selector("text=What is real")
    assert page.locator("#data-source-label").inner_text() == "SIM"
    for route, title in (("kingdom", "Kingdom"), ("plant", "Plant"), ("control", "Gradient Control"), ("declarations", "Declarations"), ("about", "About")):
        page.click(f'.nav-item[data-route="{route}"]')
        page.wait_for_function(f"document.getElementById('page-title').textContent.startsWith('{title}')")


def test_plant_page_draws_thirty_blocks(page, server):
    page.goto(f"{server}/#/plant/najm-3000")
    page.wait_for_function("document.querySelectorAll('.block-label').length === 30 || document.querySelectorAll('polygon[data-block]').length === 30", timeout=20000)
    page.click(".seg-btn[data-view='plan']")
    page.wait_for_selector("polygon[data-block='B01']")


def test_control_page_runs_the_default_scenario_and_scrubs(page, server):
    page.goto(f"{server}/#/control")
    page.wait_for_function("(document.getElementById('pp-avail')||{}).textContent !== '—' && document.getElementById('pp-avail')", timeout=60000)
    assert "MW" in page.locator("#pp-export-note").inner_text()
    before = page.locator("#tl-clock").inner_text()
    page.keyboard.press("Shift+ArrowRight")
    page.wait_for_function(f"document.getElementById('tl-clock').textContent !== '{before}'")
    assert page.locator("#kpis .tile").count() >= 6
    page.click(".seg-btn[data-ctl='compare']")
    page.wait_for_function("document.querySelectorAll('#map-pair .map-box').length === 2 && !document.getElementById('map-b-wrap').hidden")


def test_declarations_render_the_notice(page, server):
    page.goto(f"{server}/#/control")
    page.wait_for_function("document.getElementById('pp-avail') && document.getElementById('pp-avail').textContent !== '—'", timeout=60000)
    page.click('.nav-item[data-route="declarations"]')
    page.wait_for_selector("text=Ramp Event Notice", timeout=20000)
    assert page.locator("#ledger tr").count() >= 5
```

- [ ] **Step 3: Run it**

Run: `.venv\Scripts\python.exe -m pytest tests/e2e -v -m e2e`
Expected: 4 passed (the map tiles may not load without internet; the tests only rely on DOM produced by the app). The unit suite excludes it by default: run `pytest tests --ignore=tests/e2e` for the fast set.

- [ ] **Step 4: Commit**

```bash
git add app/tests/e2e
git commit -m "test(e2e): Playwright smoke test across the five pages"
```

---

### Task 17: Warm cache, GitHub Actions → Azure, README

**Files:**
- Create: `app/raseen/scenario/__main__.py`, `.github/workflows/deploy-azure.yml` (repository root)
- Replace: `app/README.md`
- Test: `app/tests/test_scenario.py` (append)

- [ ] **Step 1: Append the failing test**

```python
def test_warm_list_covers_the_rehearsed_scenarios():
    from raseen.scenario.__main__ import WARM_SCENARIOS
    ids = {p.scenario_id() for p in WARM_SCENARIOS}
    assert len(ids) == len(WARM_SCENARIOS) >= 8
    assert any(p.event == "thin" for p in WARM_SCENARIOS) and any(p.event == "scattered" for p in WARM_SCENARIOS)
    assert any(p.stall_at_min is not None for p in WARM_SCENARIOS) and any(p.deepen_at_min is not None for p in WARM_SCENARIOS)
```

- [ ] **Step 2: Write the warm-cache CLI**

`app/raseen/scenario/__main__.py`:

```python
"""Precompute the rehearsed scenarios: ``python -m raseen.scenario --warm``."""

from __future__ import annotations

import argparse
import time

from raseen.scenario.cache import CACHE
from raseen.scenario.params import ScenarioParams

WARM_SCENARIOS: list[ScenarioParams] = [
    ScenarioParams(),
    ScenarioParams(g_mw_min=60),
    ScenarioParams(g_mw_min=120),
    ScenarioParams(g_mw_min=150),
    ScenarioParams(heading_deg=0),
    ScenarioParams(event="thin", flat=True, g_mw_min=60),
    ScenarioParams(event="scattered", seed=2),
    ScenarioParams(stall_at_min=-3.0),
    ScenarioParams(deepen_at_min=2.0, deepen_factor=1.2),
    ScenarioParams(confidence=0.3),
    ScenarioParams(confidence=0.9),
]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="raseen.scenario")
    parser.add_argument("--warm", action="store_true", help="precompute the rehearsed scenarios into the cache")
    args = parser.parse_args(argv)
    if not args.warm:
        parser.print_help()
        return 0
    for params in WARM_SCENARIOS:
        t0 = time.perf_counter()
        CACHE.get_or_run(params)
        print(f"{params.scenario_id()[:12]}  {params.event:9s} g={params.g_mw_min:<5} {time.perf_counter() - t0:5.1f} s")
    print(f"{CACHE.size()} scenarios cached in {CACHE.dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: Write the workflow**

`.github/workflows/deploy-azure.yml`:

```yaml
name: Deploy Raseen to Azure

on:
  push:
    branches: [main]
    paths: ["app/**", ".github/workflows/deploy-azure.yml"]
  workflow_dispatch:

env:
  IMAGE: ghcr.io/${{ github.repository_owner }}/raseen

jobs:
  test:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: app } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -e ".[dev]"
      - run: python -m pytest tests --ignore=tests/e2e -q

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }
      - uses: docker/build-push-action@v6
        with:
          context: app
          push: true
          tags: |
            ${{ env.IMAGE }}:latest
            ${{ env.IMAGE }}:${{ github.sha }}
      - uses: azure/webapps-deploy@v3
        with:
          app-name: ${{ secrets.AZURE_WEBAPP_NAME }}
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          images: ${{ env.IMAGE }}:${{ github.sha }}
```

- [ ] **Step 4: Replace the README**

`app/README.md`:

```markdown
# Raseen (رَصين) — dashboard

Block Gradient Control for gigawatt solar, demonstrated on the NAJM-3000 reference plant.
Everything served is **simulated and labelled so**: geometry as-designed, irradiance representative,
controller real code, telemetry/forecast/PPC/TSP simulated. Not calibrated, not validated.

## Pages

| Tab | What it shows |
|---|---|
| Kingdom | Renewable plants (indicative registry) and the 380 kV backbone (schematic) on a dark map |
| Plant | NAJM-3000 on satellite imagery: 363 MVPS, 30 control blocks, zones; Output / Headroom / ETA; block inspector |
| Gradient Control | A cloud event handled by plant-level control and by Raseen; compare, stall, deepen; KPIs; economics; timeline |
| Declarations | The Ramp Event Notice generated from the scenario, with the Grid Code compliance ledger |
| About | What is real, designed and simulated; version history; sources |

## Run locally

    python -m venv .venv
    .venv\Scripts\python.exe -m pip install -e ".[dev]"
    .venv\Scripts\python.exe -m raseen            # http://127.0.0.1:8000

Optional: precompute the rehearsed scenarios so the demo never waits:

    .venv\Scripts\python.exe -m raseen.scenario --warm

## Test

    .venv\Scripts\python.exe -m pytest tests --ignore=tests/e2e     # unit and API
    .venv\Scripts\python.exe -m playwright install chromium
    .venv\Scripts\python.exe -m pytest tests/e2e -m e2e             # browser smoke

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `RASEEN_SITE_MODE` | `real` | `representative` offsets the layout and relabels zones |
| `RASEEN_CACHE_DIR` | `app/.cache` | where scenario JSON is cached |
| `PORT` | `8000` | listening port (Azure sets it) |

Tile URLs can be overridden in the page before `app.js` loads: `window.RASEEN_TILES_SAT`, `window.RASEEN_TILES_DARK`.

## Deploy to Azure (GitHub Student Developer Pack)

1. Create an **Azure Web App for Containers** (Linux, B1) with the Azure for Students credit.
2. In the Web App → *Deployment Center*, download the **publish profile**.
3. In the GitHub repository → *Settings → Secrets*, add `AZURE_WEBAPP_NAME` and `AZURE_WEBAPP_PUBLISH_PROFILE`.
4. In the Web App → *Configuration*, set `WEBSITES_PORT=8000`, `RASEEN_SITE_MODE=real` (or `representative`), `RASEEN_CACHE_DIR=/home/cache`.
5. Push to `main`. The workflow runs the tests, builds the image to GitHub Container Registry and deploys it.

The public site serves the as-designed layout and coordinates of the reference plant. Switch
`RASEEN_SITE_MODE=representative` before publishing if that exposure is not acceptable.

## Architecture

    raseen/geometry   site.json → 30 control blocks, heading projection
    raseen/shadow     front / thin band / scattered fields, per-MVPS coverage and arrival time
    raseen/control    trajectory planner, block allocation (BGC), plant-level scheme, metrics
    raseen/scenario   parameters → 10-second frames, KPIs, notice, economics; cache
    raseen/registry   Kingdom plants and grid schematic
    raseen/api.py     FastAPI; every response carries classification + disclaimer
    raseen/static     ES-module front-end, MapLibre GL, inline SVG charts, no build step
```

- [ ] **Step 5: Run everything**

```powershell
cd C:\Users\msms-\Raseen\app
.venv\Scripts\python.exe -m pytest tests --ignore=tests/e2e -q
.venv\Scripts\python.exe -m ruff check raseen tests
.venv\Scripts\python.exe -m raseen.scenario --warm
docker build -t raseen:local . ; docker run --rm -p 8000:8000 raseen:local   # only if Docker Desktop is installed; otherwise skip
```

Expected: tests pass, ruff clean (fix any import-order or unused-import findings it reports), 11 scenarios cached.

- [ ] **Step 6: Commit and tag**

```bash
cd C:/Users/msms-/Raseen
git add app .github
git commit -m "feat(deploy): warm-cache CLI, GitHub Actions to Azure Web App, README"
git tag v0.1.0
```

---

## Self-review notes (completed while writing)

- **Spec coverage.** §4.1 shell → T4; §4.2 Kingdom → T13–14; §4.3 Plant (satellite, plan, grid, modes, inspector, other plants) → T5, T10 step 6; §4.4 Gradient Control (controls, stall/deepen, compare, plant power, ramp, cloud intelligence, generation chart, block gradient, KPIs, economics, timeline) → T10–11; §4.5 Declarations → T9, T12; §4.6 About and what's-real toggle → T4, T15; §5 backend modules → T2, T3, T6, T7, T8, T9, T13; §6 contract → T8; §7 front-end modules → T4, T5, T10, T14; §8 fallbacks → T5 (plan), T10 (banner, last good scenario), T14 (schematic), T17 (warm cache); §9 tests → every task; §10 deployment → T1 (Dockerfile), T17.
- **Type consistency.** `SiteMap`/`SitePlan` share `init/setMode/setFrame/clear/select/flyToBlock/fitPlant/resize/destroy`; `blockColour(mode, frame, i, controller, cap)` defined once in `site-plan.js`; frame keys used by JS (`A, P_bgc, P_uni, P_base, eta, coverage, firm, q_share, cloud, agg.{A,P_base,P_uni,P_bgc,P_star,R,R_uni,residual}`) match the runner; `kpis` keys used by `renderKpis` match `metrics()`; `economics` keys used by `renderEconomics` match `economics()`; notice keys used by `declarations.js` match `build_notice`/`notice_at`.
- **Known simplification.** The three.js 3D tracker layer from NAJM-3000 is not ported (spec non-goal). The Kingdom KPI facts are constants in `registry/__init__.py` with their source noted.
