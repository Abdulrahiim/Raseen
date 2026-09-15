"""Engineering plots and the automated loss waterfall.

Figures are built on ``matplotlib.figure.Figure`` directly rather than through
``pyplot``, so no interactive backend or global state is required.

Every figure carries the mandatory ``SYNTHETIC DEMONSTRATION — NOT PRODUCTION
VALIDATION`` label in its title, and every axis is labeled in SI units.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from matplotlib.figure import Figure

from najm3000 import SYNTHETIC_DISCLAIMER
from najm3000.aggregation.aggregator import BlockSimulationResult
from najm3000.aggregation.loss_ledger import LossLedger
from najm3000.reporting.scenarios import ScenarioComparison

_GROSS_STAGE = "gross_energy_wh"
_NET_STAGE = "net_block_energy"


def waterfall_data(ledger: LossLedger, net_energy_wh: float) -> pd.DataFrame:
    """Build the loss waterfall table from gross energy down to net energy.

    Raises ``EnergyBalanceError`` if the ledger does not close: a waterfall
    that silently absorbed unaccounted energy would misrepresent the model.
    """
    ledger.check_closure(net_energy_wh)
    gross = ledger.gross_energy_wh
    records: list[dict[str, object]] = [
        {
            "stage": _GROSS_STAGE,
            "delta_wh": gross,
            "cumulative_wh": gross,
            "percent_of_gross": 100.0,
        }
    ]
    cumulative = gross
    for name, loss_wh in ledger.losses.items():
        cumulative -= loss_wh
        records.append(
            {
                "stage": name,
                "delta_wh": -loss_wh,
                "cumulative_wh": cumulative,
                "percent_of_gross": (-loss_wh / gross * 100.0) if gross else 0.0,
            }
        )
    records.append(
        {
            "stage": _NET_STAGE,
            "delta_wh": net_energy_wh,
            "cumulative_wh": net_energy_wh,
            "percent_of_gross": (net_energy_wh / gross * 100.0) if gross else 0.0,
        }
    )
    return pd.DataFrame(records)


def _titled(figure: Figure, title: str) -> Figure:
    figure.suptitle(f"{title}\n{SYNTHETIC_DISCLAIMER}", fontsize=10)
    figure.tight_layout()
    return figure


def plot_loss_waterfall(result: BlockSimulationResult) -> Figure:
    """Waterfall from gross DC energy through every loss to net block energy."""
    frame = waterfall_data(result.ledger, result.block_energy_wh())
    figure = Figure(figsize=(10, 5))
    axes = figure.add_subplot(111)

    stages = list(frame["stage"])
    deltas = [float(v) for v in frame["delta_wh"]]
    cumulative = [float(v) for v in frame["cumulative_wh"]]

    shares = [float(v) for v in frame["percent_of_gross"]]
    stage_bars = zip(stages, deltas, cumulative, shares, strict=True)
    for index, (stage, delta, top, share) in enumerate(stage_bars):
        if stage in (_GROSS_STAGE, _NET_STAGE):
            axes.bar(index, top / 1e3, color="#1f4e79")
            continue
        axes.bar(index, -delta / 1e3, bottom=top / 1e3, color="#c0504d")
        # Loss bars are thin next to gross energy; label the share so the
        # waterfall stays readable.
        axes.text(
            index,
            (top - delta) / 1e3,
            f"{abs(share):.2f}%",
            ha="center",
            va="bottom",
            fontsize=8,
            color="#7f2b28",
        )
    axes.set_xticks(range(len(stages)))
    axes.set_xticklabels(stages, rotation=45, ha="right", fontsize=8)
    axes.set_ylabel("Energy [kWh]")
    axes.set_xlabel("Loss stage")
    axes.grid(axis="y", alpha=0.3)
    return _titled(figure, f"Loss waterfall — block '{result.block_name}'")


def plot_irradiance(result: BlockSimulationResult) -> Figure:
    """Front, rear, and effective plane-of-array irradiance over the day."""
    figure = Figure(figsize=(10, 5))
    axes = figure.add_subplot(111)
    timeseries = result.timeseries
    axes.plot(timeseries.index, timeseries["ghi"], label="GHI")
    axes.plot(timeseries.index, timeseries["poa_front"], label="POA front")
    axes.plot(timeseries.index, timeseries["poa_back"], label="POA rear")
    axes.plot(
        timeseries.index,
        timeseries["poa_effective"],
        label="POA effective (bifacial, soiled)",
        linestyle="--",
    )
    axes.set_ylabel("Irradiance [W/m²]")
    axes.set_xlabel("Time (timezone-aware)")
    axes.legend(fontsize=8)
    axes.grid(alpha=0.3)
    return _titled(figure, f"Irradiance — block '{result.block_name}'")


def plot_temperature(result: BlockSimulationResult) -> Figure:
    """Ambient and modeled cell temperature over the day."""
    figure = Figure(figsize=(10, 5))
    axes = figure.add_subplot(111)
    timeseries = result.timeseries
    axes.plot(timeseries.index, timeseries["temp_ambient"], label="Ambient")
    axes.plot(timeseries.index, timeseries["temp_cell"], label="Cell (modeled)")
    axes.set_ylabel("Temperature [°C]")
    axes.set_xlabel("Time (timezone-aware)")
    axes.legend(fontsize=8)
    axes.grid(alpha=0.3)
    return _titled(figure, f"Temperature — block '{result.block_name}'")


def plot_power_chain(result: BlockSimulationResult) -> Figure:
    """DC input, AC output, and net block power through the conversion chain."""
    figure = Figure(figsize=(10, 5))
    axes = figure.add_subplot(111)
    timeseries = result.timeseries
    axes.plot(
        timeseries.index, timeseries["p_dc_inverter"] / 1e6, label="DC into inverter"
    )
    axes.plot(
        timeseries.index, timeseries["p_ac_inverter"] / 1e6, label="AC out of inverter"
    )
    axes.plot(
        timeseries.index,
        timeseries["p_block"] / 1e6,
        label="Net AC at block",
        linestyle="--",
    )
    axes.set_ylabel("Power [MW]")
    axes.set_xlabel("Time (timezone-aware)")
    axes.legend(fontsize=8)
    axes.grid(alpha=0.3)
    return _titled(figure, f"Power conversion chain — block '{result.block_name}'")


def plot_scenario_comparison(comparison: ScenarioComparison) -> Figure:
    """Energy per scenario, for sensitivity comparison only."""
    frame = comparison.to_dataframe()
    figure = Figure(figsize=(10, 5))
    axes = figure.add_subplot(111)
    axes.bar(frame["scenario"], frame["energy_kwh"], color="#1f4e79")
    axes.set_ylabel("Block energy [kWh]")
    axes.set_xlabel("Scenario")
    axes.tick_params(axis="x", rotation=45, labelsize=8)
    axes.grid(axis="y", alpha=0.3)
    return _titled(
        figure,
        f"Scenario sensitivity ({comparison.day}) — "
        f"baseline '{comparison.baseline}' — NOT A YIELD PREDICTION",
    )


def save_engineering_plots(
    result: BlockSimulationResult, output_dir: Path
) -> list[Path]:
    """Render and save the four standard engineering figures as PNG files."""
    output_dir.mkdir(parents=True, exist_ok=True)
    figures = {
        "irradiance": plot_irradiance(result),
        "temperature": plot_temperature(result),
        "power_chain": plot_power_chain(result),
        "loss_waterfall": plot_loss_waterfall(result),
    }
    paths: list[Path] = []
    for name, figure in figures.items():
        path = output_dir / f"{result.block_name}_{name}.png"
        figure.savefig(path, dpi=120, bbox_inches="tight")
        paths.append(path)
    return paths
