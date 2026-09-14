"""JSON API for the Raseen dashboard.

This module never imports the NAJM-3000 twin package: Raseen reads a copied geometry
file and runs its own controller. Every response carries ``classification``, ``disclaimer`` and
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
