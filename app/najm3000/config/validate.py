"""CLI entry point for configuration validation.

Usage::

    python -m najm3000.config.validate --config-dir config/
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from najm3000.config.loader import (
    ConfigError,
    check_equipment_references,
    load_blocks_config,
    load_data_sources_config,
    load_equipment_config,
    load_project_config,
)


def main(argv: list[str] | None = None) -> int:
    """Validate all four live configuration files; return process exit code."""
    parser = argparse.ArgumentParser(
        prog="najm3000.config.validate",
        description="Validate NAJM-3000 Digital Twin configuration files.",
    )
    parser.add_argument(
        "--config-dir",
        type=Path,
        default=Path("config"),
        help="directory containing project/equipment/blocks/data_sources yaml",
    )
    args = parser.parse_args(argv)
    config_dir: Path = args.config_dir

    try:
        project = load_project_config(config_dir / "project.yaml")
        equipment = load_equipment_config(config_dir / "equipment.yaml")
        blocks = load_blocks_config(config_dir / "blocks.yaml")
        sources = load_data_sources_config(config_dir / "data_sources.yaml")
        check_equipment_references(blocks, equipment)
    except ConfigError as exc:
        sys.stderr.write(f"CONFIGURATION INVALID\n{exc}\n")
        return 1

    sys.stdout.write(
        "Configuration valid.\n"
        f"  project:      {project.project.name} ({project.project.status})\n"
        f"  equipment:    {len(equipment.pv_modules)} modules, "
        f"{len(equipment.inverters)} inverters, {len(equipment.idts)} IDTs, "
        f"{len(equipment.trackers)} trackers, {len(equipment.smbs)} SMBs\n"
        f"  blocks:       {', '.join(blocks.blocks)}\n"
        f"  weather:      {sources.data_sources.synthetic_clearsky.classification}\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
