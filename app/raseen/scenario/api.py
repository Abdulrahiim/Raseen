"""Wire the scenario endpoints into the combined app."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from raseen.scenario.cache import CACHE
from raseen.scenario.params import ScenarioParams


def register_scenario_api(app: FastAPI, envelope: Callable[[], dict[str, Any]]) -> None:
    """Add POST /api/rs/scenario and GET /api/rs/scenario/{id}."""

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        """400 with the envelope, so an out-of-range control value is reported, never rendered."""
        return JSONResponse(status_code=400, content={**envelope(), "detail": exc.errors()})

    @app.post("/api/rs/scenario")
    def create_scenario(params: ScenarioParams) -> dict[str, Any]:
        return CACHE.get_or_run(params)

    @app.get("/api/rs/scenario/{scenario_id}")
    def read_scenario(scenario_id: str) -> dict[str, Any]:
        scenario = CACHE.get(scenario_id)
        if scenario is None:
            raise HTTPException(status_code=404, detail=f"unknown scenario {scenario_id!r}")
        return scenario
