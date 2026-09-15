"""NAJM-3000 Digital Twin — report generation CLI.

Usage::

    python -m najm3000.reporting --block representative_block_a \
        --date 2025-06-21 --output outputs/reports/ --sensitivity albedo

Re-runs the block simulation from the validated configuration so that the
reports, plots, and loss waterfall are always internally consistent with the
numbers they describe.

Every artifact carries: SYNTHETIC DEMONSTRATION — NOT PRODUCTION VALIDATION.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from najm3000 import SYNTHETIC_DISCLAIMER, __version__
from najm3000.aggregation.aggregator import run_block_simulation
from najm3000.config.loader import (
    ConfigError,
    check_equipment_references,
    load_blocks_config,
    load_data_sources_config,
    load_equipment_config,
    load_project_config,
)
from najm3000.reporting.assumption_report import (
    build_assumption_report,
    parse_assumptions_register,
    parse_gap_register,
)
from najm3000.reporting.plots import (
    plot_scenario_comparison,
    save_engineering_plots,
    waterfall_data,
)
from najm3000.reporting.provenance_report import build_provenance_report
from najm3000.reporting.scenarios import (
    Scenario,
    ScenarioError,
    albedo_sensitivity,
    gcr_sensitivity,
    run_scenario_comparison,
)
from najm3000.weather.pvgis import WeatherSourceError
from najm3000.weather.selection import WEATHER_CHOICES, build_weather_provider

#: Default sensitivity sweeps for the assumed parameters under study.
ALBEDO_VALUES = (0.15, 0.20, 0.25, 0.30)
GCR_VALUES = (0.30, 0.35, 0.40, 0.45)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="najm3000.reporting",
        description=(
            "Generate provenance, assumption, scenario, and plot artifacts "
            "for one representative block (POC)."
        ),
    )
    parser.add_argument("--config-dir", type=Path, default=Path("config"))
    parser.add_argument(
        "--assumptions-register", type=Path, default=Path("ASSUMPTIONS_REGISTER.md")
    )
    parser.add_argument(
        "--gap-register", type=Path, default=Path("DATA_GAP_REGISTER.md")
    )
    parser.add_argument("--block", required=True)
    parser.add_argument("--date", required=True, help="simulation day YYYY-MM-DD")
    parser.add_argument("--output", type=Path, default=Path("outputs/reports"))
    parser.add_argument(
        "--sensitivity",
        choices=["none", "albedo", "gcr", "both"],
        default="none",
        help="run a labeled parameter sensitivity comparison",
    )
    parser.add_argument(
        "--weather",
        choices=list(WEATHER_CHOICES),
        default="synthetic_clearsky",
        help=(
            "weather source; 'public_pvgis' is PROVISIONAL_PUBLIC satellite "
            "data and is not site-measured"
        ),
    )
    return parser


def _sensitivity_scenarios(kind: str, block: str) -> list[Scenario]:
    scenarios = [Scenario("baseline", block)]
    if kind in ("albedo", "both"):
        scenarios += albedo_sensitivity(block, ALBEDO_VALUES)
    if kind in ("gcr", "both"):
        scenarios += gcr_sensitivity(block, GCR_VALUES)
    return scenarios


def main(argv: list[str] | None = None) -> int:
    """Generate the full Sprint 4 report set for one block."""
    args = _build_parser().parse_args(argv)

    print(f"NAJM-3000 Digital Twin reporting v{__version__}")
    print(f"*** {SYNTHETIC_DISCLAIMER} ***")

    try:
        project = load_project_config(args.config_dir / "project.yaml")
        equipment = load_equipment_config(args.config_dir / "equipment.yaml")
        blocks = load_blocks_config(args.config_dir / "blocks.yaml")
        sources = load_data_sources_config(args.config_dir / "data_sources.yaml")
        check_equipment_references(blocks, equipment)
    except ConfigError as exc:
        sys.stderr.write(f"CONFIGURATION INVALID\n{exc}\n")
        return 1

    try:
        assumptions = parse_assumptions_register(args.assumptions_register)
        gaps = parse_gap_register(args.gap_register)
    except FileNotFoundError as exc:
        sys.stderr.write(f"REGISTER NOT FOUND\n{exc}\n")
        return 1

    try:
        weather_provider = build_weather_provider(sources, args.weather)
    except WeatherSourceError as exc:
        sys.stderr.write(f"WEATHER SOURCE UNAVAILABLE\n{exc}\n")
        return 1

    try:
        result = run_block_simulation(
            project=project,
            equipment=equipment,
            blocks=blocks,
            weather_provider=weather_provider,
            block_name=args.block,
            day=args.date,
        )
    except KeyError as exc:
        sys.stderr.write(f"UNKNOWN BLOCK\n{exc}\n")
        return 1

    output: Path = args.output
    output.mkdir(parents=True, exist_ok=True)

    provenance = build_provenance_report(
        project=project, equipment=equipment, blocks=blocks, sources=sources
    )
    (output / "provenance_report.md").write_text(
        provenance.to_markdown(), encoding="utf-8"
    )
    provenance.to_dataframe().to_csv(output / "provenance_report.csv", index=False)

    assumption_report = build_assumption_report(
        rows=provenance.rows, assumptions=assumptions, gaps=gaps
    )
    (output / "assumption_report.md").write_text(
        assumption_report.to_markdown(), encoding="utf-8"
    )
    assumption_report.to_dataframe().to_csv(
        output / "assumption_report.csv", index=False
    )

    waterfall = waterfall_data(result.ledger, result.block_energy_wh())
    waterfall.to_csv(output / "loss_waterfall.csv", index=False)

    plot_dir = output / "plots"
    plot_paths = save_engineering_plots(result, plot_dir)

    if args.sensitivity != "none":
        try:
            comparison = run_scenario_comparison(
                project=project,
                equipment=equipment,
                blocks=blocks,
                weather_provider=weather_provider,
                scenarios=_sensitivity_scenarios(args.sensitivity, args.block),
                day=args.date,
                baseline="baseline",
            )
        except ScenarioError as exc:
            sys.stderr.write(f"SCENARIO INVALID\n{exc}\n")
            return 1
        (output / "scenario_comparison.md").write_text(
            comparison.to_markdown(), encoding="utf-8"
        )
        comparison.to_dataframe().to_csv(
            output / "scenario_comparison.csv", index=False
        )
        figure = plot_scenario_comparison(comparison)
        figure.savefig(plot_dir / "scenario_comparison.png", dpi=120)

    print(f"block:              {args.block}")
    print(f"date:               {args.date}")
    print(f"parameters audited: {len(provenance.rows)}")
    print(f"parameters flagged: {len(assumption_report.flagged)}")
    print(f"high-risk flagged:  {len(assumption_report.high_risk())}")
    if assumption_report.unregistered_ids:
        print(
            "UNREGISTERED assumption IDs: "
            + ", ".join(assumption_report.unregistered_ids)
        )
    print(f"reports:            {output}")
    print(f"plots:              {len(plot_paths)} figures in {plot_dir}")
    print(f"*** {SYNTHETIC_DISCLAIMER} ***")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
