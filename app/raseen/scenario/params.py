"""Scenario parameters — the contract between the Gradient Control page and the runner."""

from __future__ import annotations

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ScenarioParams(BaseModel):
    """Everything the control on the page can vary. Ranges match the sliders."""

    model_config = ConfigDict(extra="forbid")

    event: Literal["solid", "thin", "scattered"] = "solid"
    heading_deg: float = Field(90.0, ge=0.0, lt=360.0, description="motion, ° cw from north")
    speed_kmh: float = Field(48.0, ge=10.0, le=120.0)
    depth: float = Field(0.6, ge=0.2, le=0.8, description="power lost under full cover")
    g_mw_min: float = Field(90.0, ge=30.0, le=300.0, description="declared down-gradient")
    confidence: float = Field(0.7, ge=0.1, le=1.0)
    reserve_mw: float | None = Field(None, ge=0.0, le=600.0, description="override reserve")
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
