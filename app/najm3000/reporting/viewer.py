"""Data layer for the optional read-only results viewer.

Keeps everything the dashboard needs in one plain object so the Streamlit
script stays a thin UI shell with no engineering logic of its own. Nothing
here writes to disk or touches an external system.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from najm3000 import SYNTHETIC_DISCLAIMER
from najm3000.aggregation.aggregator import (
    BlockSimulationResult,
    run_block_simulation,
)
from najm3000.config.loader import (
    check_equipment_references,
    load_blocks_config,
    load_data_sources_config,
    load_equipment_config,
    load_project_config,
)
from najm3000.config.schemas import (
    BlocksConfig,
    EquipmentConfig,
    ProjectConfig,
)
from najm3000.reporting.assumption_report import (
    AssumptionReport,
    build_assumption_report,
    parse_assumptions_register,
    parse_gap_register,
)
from najm3000.reporting.plots import waterfall_data
from najm3000.reporting.provenance_report import (
    ProvenanceReport,
    build_provenance_report,
)
from najm3000.weather.pvgis import WeatherSourceError
from najm3000.weather.selection import build_weather_provider


class ViewerError(Exception):
    """Raised when the viewer cannot assemble a context for the request."""


def available_blocks(config_dir: Path) -> list[str]:
    """Names of every configured block, for the dashboard selector."""
    return list(load_blocks_config(config_dir / "blocks.yaml").blocks)


@dataclass(frozen=True)
class ViewerContext:
    """Everything the dashboard displays for one block on one test day."""

    block: str
    day: str
    project: ProjectConfig
    equipment: EquipmentConfig
    blocks: BlocksConfig
    result: BlockSimulationResult
    provenance: ProvenanceReport
    assumptions: AssumptionReport
    waterfall: pd.DataFrame
    disclaimer: str
    weather_classification: str
    calibration_status: str
    validation_status: str

    def energy_kwh(self) -> float:
        """Net block energy [kWh] for the simulated day."""
        return self.result.block_energy_wh() / 1e3


def load_viewer_context(
    config_dir: Path,
    assumptions_register: Path,
    gap_register: Path,
    block: str,
    day: str,
    weather: str = "synthetic_clearsky",
) -> ViewerContext:
    """Load configuration, run the block, and build both audit reports."""
    project = load_project_config(config_dir / "project.yaml")
    equipment = load_equipment_config(config_dir / "equipment.yaml")
    blocks = load_blocks_config(config_dir / "blocks.yaml")
    sources = load_data_sources_config(config_dir / "data_sources.yaml")
    check_equipment_references(blocks, equipment)

    try:
        assumption_entries = parse_assumptions_register(assumptions_register)
        gap_entries = parse_gap_register(gap_register)
    except FileNotFoundError as exc:
        msg = f"register could not be read: {exc}"
        raise ViewerError(msg) from exc

    try:
        weather_provider = build_weather_provider(sources, weather)
    except WeatherSourceError as exc:
        raise ViewerError(str(exc)) from exc

    try:
        result = run_block_simulation(
            project=project,
            equipment=equipment,
            blocks=blocks,
            weather_provider=weather_provider,
            block_name=block,
            day=day,
        )
    except KeyError as exc:
        msg = f"unknown block '{block}'"
        raise ViewerError(msg) from exc

    provenance = build_provenance_report(
        project=project, equipment=equipment, blocks=blocks, sources=sources
    )
    assumptions = build_assumption_report(
        rows=provenance.rows, assumptions=assumption_entries, gaps=gap_entries
    )
    return ViewerContext(
        block=block,
        day=day,
        project=project,
        equipment=equipment,
        blocks=blocks,
        result=result,
        provenance=provenance,
        assumptions=assumptions,
        waterfall=waterfall_data(result.ledger, result.block_energy_wh()),
        disclaimer=SYNTHETIC_DISCLAIMER,
        weather_classification=result.metadata["weather_classification"],
        calibration_status=project.project.calibration_status,
        validation_status=project.project.validation_status,
    )
