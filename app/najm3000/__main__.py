"""NAJM-3000 Digital Twin — single-block simulation CLI.

Usage::

    python -m najm3000 --block representative_block_a \
        --weather synthetic_clearsky --date 2025-06-21 --output outputs/

Every output is labeled with the classification of the weather it actually
used — ``SYNTHETIC DEMONSTRATION`` for synthetic input, ``PROVISIONAL PUBLIC
DATA — NOT SITE-MEASURED`` for public satellite input — and always states that
the model is neither calibrated nor validated.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from najm3000 import __version__
from najm3000.aggregation.aggregator import (
    run_block_simulation,
    scale_to_plant,
)
from najm3000.config.loader import (
    ConfigError,
    check_equipment_references,
    load_blocks_config,
    load_data_sources_config,
    load_equipment_config,
    load_project_config,
)
from najm3000.weather.pvgis import WeatherSourceError
from najm3000.weather.selection import (
    WEATHER_CHOICES,
    apply_timestep_override,
    build_weather_provider,
    run_disclaimer,
)


def main(argv: list[str] | None = None) -> int:
    """Run one representative-block simulation end-to-end."""
    parser = argparse.ArgumentParser(
        prog="najm3000",
        description="NAJM-3000 Digital Twin single-block simulation (POC).",
    )
    parser.add_argument("--config-dir", type=Path, default=Path("config"))
    parser.add_argument("--block", required=True)
    parser.add_argument(
        "--weather",
        choices=list(WEATHER_CHOICES),
        default="synthetic_clearsky",
        help=(
            "weather source; 'public_pvgis' is PROVISIONAL_PUBLIC satellite "
            "data and is not site-measured"
        ),
    )
    parser.add_argument("--date", required=True, help="simulation day YYYY-MM-DD")
    parser.add_argument("--output", type=Path, default=Path("outputs"))
    parser.add_argument(
        "--scale-plant",
        action="store_true",
        help="also print the labeled illustrative plant scaling scenario",
    )
    parser.add_argument(
        "--timestep-minutes",
        type=int,
        default=None,
        help=(
            "override the configured simulation timestep; public hourly "
            "sources require 60"
        ),
    )
    args = parser.parse_args(argv)

    print(f"NAJM-3000 Digital Twin v{__version__}")

    try:
        project = load_project_config(args.config_dir / "project.yaml")
        equipment = load_equipment_config(args.config_dir / "equipment.yaml")
        blocks = load_blocks_config(args.config_dir / "blocks.yaml")
        sources = load_data_sources_config(
            args.config_dir / "data_sources.yaml"
        )
        check_equipment_references(blocks, equipment)
    except ConfigError as exc:
        sys.stderr.write(f"CONFIGURATION INVALID\n{exc}\n")
        return 1

    if args.timestep_minutes is not None:
        project = apply_timestep_override(project, args.timestep_minutes)

    try:
        weather_provider = build_weather_provider(sources, args.weather)
        result = run_block_simulation(
            project=project,
            equipment=equipment,
            blocks=blocks,
            weather_provider=weather_provider,
            block_name=args.block,
            day=args.date,
        )
    except WeatherSourceError as exc:
        sys.stderr.write(f"WEATHER SOURCE UNAVAILABLE\n{exc}\n")
        return 1
    except KeyError as exc:
        sys.stderr.write(f"UNKNOWN BLOCK\n{exc}\n")
        return 1

    # The label follows the data actually used: calling real satellite data a
    # "synthetic demonstration" would itself be a labeling error.
    disclaimer = run_disclaimer(weather_provider.classification)
    print(f"*** {disclaimer} ***")

    args.output.mkdir(parents=True, exist_ok=True)
    stem = f"{args.block}_{args.date}"
    parquet_path = args.output / f"{stem}.parquet"
    meta_path = args.output / f"{stem}.metadata.json"
    result.timeseries.to_parquet(parquet_path)
    metadata = {
        "najm3000_version": __version__,
        "data_source_classification": result.metadata[
            "weather_classification"
        ],
        "simulation_date": args.date,
        "timestep_minutes": str(project.simulation.timestep_minutes),
        "block_id": args.block,
        "weather_source_id": args.weather,
        "model_stage": "block_chain_poc",
        **result.metadata,
        "disclaimer": disclaimer,
        "loss_ledger_wh": result.ledger.as_dict(),
    }
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    energy_kwh = result.block_energy_wh() / 1e3
    print(f"block:            {args.block}")
    print(f"date:             {args.date}")
    print(f"weather source:   {args.weather} ({weather_provider.classification})")
    print(f"net block energy: {energy_kwh:,.1f} kWh  [{disclaimer}]")
    print("loss ledger [kWh]:")
    for name, wh in result.ledger.as_dict().items():
        print(f"  {name:28s} {wh / 1e3:,.1f}")
    print(f"time series:      {parquet_path}")
    print(f"metadata:         {meta_path}")

    if args.scale_plant:
        scaled = scale_to_plant(result, blocks)
        print("plant scaling scenario (ILLUSTRATIVE ONLY):")
        for key, value in scaled.items():
            print(f"  {key}: {value}")

    print(f"*** {disclaimer} ***")
    print("*** MODEL NOT CALIBRATED — NOT VALIDATED ***")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
