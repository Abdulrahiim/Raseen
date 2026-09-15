"""Scenario comparison engine.

Runs the same block through the physics chain under different parameter
assumptions and reports the energy difference. Its purpose is sensitivity
analysis on the parameters that are *assumed* rather than confirmed — chiefly
albedo (ASMP-005) and GCR (ASMP-013).

A scenario override never bypasses the schema: the replacement value is
re-validated by Pydantic and is re-stamped as ``Assumed`` provenance carrying
the assumption ID it varies. Scenario output is a sensitivity comparison, not
a yield prediction.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import pandas as pd

from najm3000 import SYNTHETIC_DISCLAIMER
from najm3000.aggregation.aggregator import (
    BlockSimulationResult,
    run_block_simulation,
)
from najm3000.config.overrides import (
    SENSITIVITY_FIELDS,
    ScenarioError,
    ScenarioOverride,
    apply_overrides,
)
from najm3000.config.schemas import (
    BlocksConfig,
    EquipmentConfig,
    ProjectConfig,
)
from najm3000.weather.provider import WeatherProvider


@dataclass(frozen=True)
class Scenario:
    """A named run of one block under a set of parameter overrides."""

    name: str
    block: str
    overrides: tuple[ScenarioOverride, ...] = ()


@dataclass(frozen=True)
class ScenarioComparison:
    """Energy results for a set of scenarios, relative to a baseline."""

    results: dict[str, BlockSimulationResult]
    energy_wh: dict[str, float]
    baseline: str
    day: str
    scenarios: dict[str, Scenario] = field(default_factory=dict)

    def to_dataframe(self) -> pd.DataFrame:
        """One row per scenario with absolute and relative energy deltas."""
        base = self.energy_wh[self.baseline]
        records = []
        for name, energy in self.energy_wh.items():
            delta = energy - base
            records.append(
                {
                    "scenario": name,
                    "block": self.results[name].block_name,
                    "energy_wh": energy,
                    "energy_kwh": energy / 1e3,
                    "delta_wh": delta,
                    "delta_percent": (delta / base * 100.0) if base else float("nan"),
                    "overrides": "; ".join(
                        f"{o.field}={o.value:g} ({o.assumption_id})"
                        for o in self.scenarios[name].overrides
                    )
                    or "—",
                }
            )
        return pd.DataFrame(records)

    def to_markdown(self) -> str:
        """Render the comparison as Markdown with the mandatory labeling."""
        lines = [
            "# NAJM-3000 Digital Twin — Scenario Comparison",
            "",
            f"> **{SYNTHETIC_DISCLAIMER}**",
            "",
            "This is a parameter sensitivity comparison, **not a yield "
            "prediction**. It shows how the model responds to assumed inputs; "
            "it says nothing about actual NAJM-3000 production.",
            "",
            f"- Simulation day: `{self.day}`",
            f"- Baseline scenario: `{self.baseline}`",
            f"- Scenarios compared: {len(self.energy_wh)}",
            "",
            "| Scenario | Block | Energy [kWh] | Δ vs baseline [kWh] | Δ [%] "
            "| Overrides |",
            "|---|---|---|---|---|---|",
        ]
        for record in self.to_dataframe().to_dict("records"):
            lines.append(
                f"| {record['scenario']} | {record['block']} "
                f"| {record['energy_kwh']:,.1f} "
                f"| {record['delta_wh'] / 1e3:,.1f} "
                f"| {record['delta_percent']:+.2f} | {record['overrides']} |"
            )
        lines += ["", "---", "", f"*{SYNTHETIC_DISCLAIMER}*"]
        return "\n".join(lines) + "\n"


def run_scenario_comparison(
    project: ProjectConfig,
    equipment: EquipmentConfig,
    blocks: BlocksConfig,
    weather_provider: WeatherProvider,
    scenarios: Sequence[Scenario],
    day: str,
    baseline: str | None = None,
) -> ScenarioComparison:
    """Run every scenario and compare block energy against the baseline."""
    if not scenarios:
        msg = "at least one scenario is required"
        raise ScenarioError(msg)
    names = [scenario.name for scenario in scenarios]
    duplicates = {name for name in names if names.count(name) > 1}
    if duplicates:
        msg = f"duplicate scenario name(s): {sorted(duplicates)}"
        raise ScenarioError(msg)
    baseline_name = baseline if baseline is not None else names[0]
    if baseline_name not in names:
        msg = f"baseline '{baseline_name}' is not one of the scenarios {names}"
        raise ScenarioError(msg)

    results: dict[str, BlockSimulationResult] = {}
    energies: dict[str, float] = {}
    for scenario in scenarios:
        if scenario.block not in blocks.blocks:
            msg = f"scenario '{scenario.name}' targets unknown block '{scenario.block}'"
            raise ScenarioError(msg)
        modified_block = apply_overrides(
            blocks.blocks[scenario.block], scenario.overrides
        )
        scenario_blocks = blocks.model_copy(
            update={"blocks": {**blocks.blocks, scenario.block: modified_block}}
        )
        result = run_block_simulation(
            project=project,
            equipment=equipment,
            blocks=scenario_blocks,
            weather_provider=weather_provider,
            block_name=scenario.block,
            day=day,
        )
        results[scenario.name] = result
        energies[scenario.name] = result.block_energy_wh()

    return ScenarioComparison(
        results=results,
        energy_wh=energies,
        baseline=baseline_name,
        day=day,
        scenarios={scenario.name: scenario for scenario in scenarios},
    )


def _sensitivity(
    block: str, values: Sequence[float], param: str, assumption_id: str
) -> list[Scenario]:
    if not values:
        msg = f"{param} sensitivity needs at least one value"
        raise ScenarioError(msg)
    return [
        Scenario(
            name=f"{param}_{value:.2f}",
            block=block,
            overrides=(ScenarioOverride(param, value, assumption_id),),
        )
        for value in values
    ]


def albedo_sensitivity(block: str, values: Sequence[float]) -> list[Scenario]:
    """Build one scenario per ground albedo value (varies ASMP-005)."""
    return _sensitivity(block, values, "albedo", "ASMP-005")


def gcr_sensitivity(block: str, values: Sequence[float]) -> list[Scenario]:
    """Build one scenario per ground coverage ratio value (varies ASMP-013)."""
    return _sensitivity(block, values, "gcr", "ASMP-013")


#: Re-exported for callers that import scenario primitives from here.
__all__ = [
    "SENSITIVITY_FIELDS",
    "Scenario",
    "ScenarioComparison",
    "ScenarioError",
    "ScenarioOverride",
    "albedo_sensitivity",
    "apply_overrides",
    "gcr_sensitivity",
    "run_scenario_comparison",
]
