"""Kingdom registry: Saudi renewable plants and the indicative transmission backbone.

Compiled from public announcements (SPPC/NREP rounds, developer releases, GASTAT/MoE).
Capacities are nameplate as announced; coordinates are town-level or approximate unless
marked ``site``; the grid is a schematic. Not an official dataset.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI

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
    "source": "GASTAT Energy Statistics 2024; Ministry of Energy open data",
}


@lru_cache(maxsize=1)
def _plants_file() -> dict[str, Any]:
    return json.loads((DATA / "plants.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _grid_file() -> dict[str, Any]:
    return json.loads((DATA / "grid.json").read_text(encoding="utf-8"))


REGISTRY_NOTE = _plants_file()["note"]
GRID_NOTE = _grid_file()["note"]


def load_plants() -> list[dict[str, Any]]:
    """Plants, with NAJM-3000 placed at the twin's site centre (follows the site mode)."""
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


def register_registry_api(app: FastAPI, envelope: Callable[[], dict[str, Any]]) -> None:
    """Add GET /api/rs/plants and /api/rs/grid to the combined app."""

    @app.get("/api/rs/plants")
    def plants_view() -> dict[str, Any]:
        plants = load_plants()
        return {
            **envelope(),
            "plants": plants,
            "summary": plants_summary(plants),
            "note": REGISTRY_NOTE,
            "facts": FACTS,
        }

    @app.get("/api/rs/grid")
    def grid_view() -> dict[str, Any]:
        return {**envelope(), "geojson": load_grid(), "note": GRID_NOTE}
