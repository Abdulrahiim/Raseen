"""Run the pre-commissioning dashboard API.

Usage::

    python -m najm3000.dashboard --config-dir config --date 2025-06-21

Serves simulated telemetry. NAJM-3000 is under construction and SCADA is not
commissioned: nothing served here is measured, calibrated, or validated data.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import uvicorn

from najm3000.dashboard.api import build_app
from najm3000.weather.selection import WEATHER_CHOICES


def main(argv: list[str] | None = None) -> int:
    """Start the dashboard API server."""
    parser = argparse.ArgumentParser(
        prog="najm3000.dashboard",
        description="Pre-commissioning digital twin API (simulated telemetry).",
    )
    parser.add_argument("--config-dir", type=Path, default=Path("config"))
    parser.add_argument("--date", required=True, help="simulated day YYYY-MM-DD")
    parser.add_argument(
        "--weather", choices=list(WEATHER_CHOICES), default="synthetic_clearsky"
    )
    parser.add_argument(
        "--no-scenario",
        action="store_true",
        help="disable the scripted demonstration faults",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)

    print("NAJM-3000 Pre-Commissioning Digital Twin — API")
    print("*** SIMULATED TELEMETRY — NOT MEASURED DATA ***")
    print("*** MODEL NOT CALIBRATED — NOT VALIDATED ***")

    app = build_app(
        config_dir=args.config_dir,
        day=args.date,
        weather=args.weather,
        scenario_enabled=not args.no_scenario,
    )
    if not args.no_scenario:
        print("*** SCRIPTED DEMONSTRATION FAULTS ENABLED ***")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
