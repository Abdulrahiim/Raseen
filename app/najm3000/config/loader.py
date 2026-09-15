"""YAML configuration loading with hard-fail validation.

Any ``PLACEHOLDER`` value, schema violation, or missing provenance raises an
error — the model never runs on invalid or invented parameters.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from najm3000.config.schemas import (
    BlocksConfig,
    DataSourcesFile,
    EquipmentConfig,
    ProjectConfig,
)

PLACEHOLDER_TOKEN = "PLACEHOLDER"  # noqa: S105 — not a credential


class ConfigError(Exception):
    """Raised when a configuration file cannot be validated."""


def _scan_for_placeholder(node: object, path: str = "") -> None:
    """Recursively reject any value containing the PLACEHOLDER token."""
    if isinstance(node, str) and PLACEHOLDER_TOKEN in node:
        msg = f"PLACEHOLDER value found at '{path}' — populate the live config"
        raise ConfigError(msg)
    if isinstance(node, dict):
        for key, value in node.items():
            _scan_for_placeholder(value, f"{path}.{key}" if path else str(key))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            _scan_for_placeholder(value, f"{path}[{i}]")


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        msg = f"configuration file not found: {path}"
        raise ConfigError(msg)
    with path.open("r", encoding="utf-8") as handle:
        raw = yaml.safe_load(handle)
    if not isinstance(raw, dict):
        msg = f"configuration file {path} did not parse to a mapping"
        raise ConfigError(msg)
    _scan_for_placeholder(raw)
    return raw


def load_project_config(path: Path) -> ProjectConfig:
    """Load and validate the project configuration."""
    raw = _load_yaml(path)
    try:
        return ProjectConfig.model_validate(raw)
    except ValidationError as exc:
        msg = f"project configuration invalid ({path}):\n{exc}"
        raise ConfigError(msg) from exc


def load_equipment_config(path: Path) -> EquipmentConfig:
    """Load and validate the multi-vendor equipment library."""
    raw = _load_yaml(path)
    try:
        return EquipmentConfig.model_validate(raw)
    except ValidationError as exc:
        msg = f"equipment configuration invalid ({path}):\n{exc}"
        raise ConfigError(msg) from exc


def load_blocks_config(path: Path) -> BlocksConfig:
    """Load and validate the MV block configuration."""
    raw = _load_yaml(path)
    try:
        config = BlocksConfig.model_validate(raw)
    except ValidationError as exc:
        msg = f"blocks configuration invalid ({path}):\n{exc}"
        raise ConfigError(msg) from exc
    _check_block_aliases(config)
    return config


def load_data_sources_config(path: Path) -> DataSourcesFile:
    """Load and validate the weather/data source configuration."""
    raw = _load_yaml(path)
    try:
        return DataSourcesFile.model_validate(raw)
    except ValidationError as exc:
        msg = f"data sources configuration invalid ({path}):\n{exc}"
        raise ConfigError(msg) from exc


def _check_block_aliases(config: BlocksConfig) -> None:
    scaling = config.plant_scaling_scenario
    if scaling.representative_block not in config.blocks:
        msg = (
            f"plant_scaling_scenario.representative_block "
            f"'{scaling.representative_block}' is not a configured block"
        )
        raise ConfigError(msg)


def check_equipment_references(
    blocks: BlocksConfig, equipment: EquipmentConfig
) -> None:
    """Verify every block references only equipment aliases that exist."""
    for name, block in blocks.blocks.items():
        references: list[tuple[str, str, set[str]]] = [
            ("pv_module", block.pv_module, set(equipment.pv_modules)),
            ("inverter", block.inverter, set(equipment.inverters)),
            ("idt", block.idt, set(equipment.idts)),
            ("tracker", block.tracker, set(equipment.trackers)),
            ("smb", block.smb, set(equipment.smbs)),
        ]
        for field, alias, library in references:
            if alias not in library:
                msg = (
                    f"block '{name}' references unknown {field} alias "
                    f"'{alias}'"
                )
                raise ConfigError(msg)
