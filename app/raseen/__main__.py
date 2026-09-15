"""Run the Raseen dashboard: ``python -m raseen [--host H] [--port P]``."""

from __future__ import annotations

import argparse
import os

import uvicorn

from raseen import CLASSIFICATION, __version__


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="raseen", description="Raseen dashboard (prototype).")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args(argv)
    print(f"Raseen {__version__} — {CLASSIFICATION}")
    print("*** SIMULATED TELEMETRY — NOT MEASURED DATA — NOT CALIBRATED — NOT VALIDATED ***")
    uvicorn.run(
        "raseen.webapp:app", host=args.host, port=args.port, reload=args.reload, log_level="info"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
