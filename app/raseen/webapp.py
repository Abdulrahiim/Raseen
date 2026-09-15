"""Raseen combined web application.

Raseen reuses the NAJM-3000 pre-commissioning dashboard as its **Plant** page and adds
two pages of its own — **Kingdom** (the Saudi renewable fleet and grid) and **Gradient
Control** (a cloud crossing the plant, block by block). One FastAPI app serves all three:
the NAJM-3000 routes and ``/static`` are kept untouched; Raseen's own assets are served at
``/rs`` and its endpoints under ``/api/rs``. Nothing served here is measured, calibrated or
validated data — every payload carries a classification and disclaimer.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from najm3000.dashboard.api import build_app as build_najm_app

APP_DIR = Path(__file__).resolve().parent
CONFIG_DIR = APP_DIR.parent / "config"
WEB_DIR = APP_DIR / "web"

#: Simulated day the Plant page replays. NAJM-3000 is pre-commissioning; this is not a date
#: of real operation.
DEFAULT_DAY = os.environ.get("RASEEN_DAY", "2025-06-21")

CLASSIFICATION = "SIMULATION (RASEEN PROTOTYPE)"
DISCLAIMER = (
    "SIMULATED — NOT MEASURED DATA. Plant geometry is as-designed, not as-built. "
    "The controller is real code; telemetry, forecast and grid interfaces are simulated. "
    "NOT CALIBRATED — NOT VALIDATED."
)


def _page(name: str) -> FileResponse:
    return FileResponse(WEB_DIR / name)


def build_app(config_dir: Path = CONFIG_DIR, day: str = DEFAULT_DAY) -> FastAPI:
    """Build the combined app: the NAJM-3000 dashboard plus Raseen's pages and API."""
    # The NAJM-3000 dashboard, unchanged. It owns /static, /api/status, /api/plant, the 3D
    # model routes, etc., and now serves its page at /plant (see the vendored api.py edit).
    app = build_najm_app(
        config_dir=config_dir, day=day, weather="synthetic_clearsky", scenario_enabled=False
    )
    app.title = "Raseen"

    # Raseen assets and pages.
    app.mount("/rs", StaticFiles(directory=WEB_DIR), name="rs")
    register_raseen_api(app)

    @app.get("/", include_in_schema=False)
    def home() -> RedirectResponse:
        return RedirectResponse("/kingdom")

    @app.get("/kingdom", include_in_schema=False)
    def kingdom_page() -> FileResponse:
        return _page("kingdom.html")

    @app.get("/control", include_in_schema=False)
    def control_page() -> FileResponse:
        return _page("control.html")

    return app


def register_raseen_api(app: FastAPI) -> None:
    """Attach Raseen's JSON API. Geometry is available now; the scenario runner is added when
    the ``raseen.scenario`` module is present, so the base app runs before it is built."""
    from raseen.geometry.blocks import blocks_payload, get_blocks, mvps_block_index
    from raseen.geometry.site import MVPS_MW, get_site

    def envelope() -> dict[str, Any]:
        return {"classification": CLASSIFICATION, "disclaimer": DISCLAIMER, "is_live": False}

    app.state.raseen_envelope = envelope

    @app.get("/api/rs/status")
    def rs_status() -> dict[str, Any]:
        site = get_site()
        return {
            **envelope(),
            "product": "Raseen",
            "product_ar": "رَصين",
            "plant": "NAJM-3000",
            "plant_mw": 3000.0,
            "site_mode": site.mode,
            "block_count": len(get_blocks(site)),
        }

    @app.get("/api/rs/site")
    def rs_site() -> dict[str, Any]:
        site = get_site()
        blocks = get_blocks(site)
        return {
            **envelope(),
            "plant": "NAJM-3000",
            "plant_mw": 3000.0,
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

    # Optional modules, wired in only if built. Keeps the base app importable on its own.
    try:
        from raseen.registry import register_registry_api

        register_registry_api(app, envelope)
    except ImportError:
        pass
    try:
        from raseen.scenario.api import register_scenario_api

        register_scenario_api(app, envelope)
    except ImportError:
        pass


app = build_app()
