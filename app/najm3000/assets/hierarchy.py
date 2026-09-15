"""Asset hierarchy identifiers for the electrical aggregation chain.

Minimal Sprint 1 representation: the electrical levels and a helper that
derives the per-block asset counts from a validated block configuration.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from najm3000.config.schemas import BlockConfig


class ElectricalLevel(StrEnum):
    """Aggregation levels from module group to plant scenario."""

    STRING = "string"
    SMB = "smb"
    INVERTER = "inverter"
    IDT = "idt"
    BLOCK = "block"
    PLANT_SCENARIO = "plant_scenario"


@dataclass(frozen=True)
class BlockAssetCounts:
    """Derived per-block asset counts (identical-unit POC assumption)."""

    modules: int
    strings: int
    smbs: int
    inverters: int
    idts: int


def derive_asset_counts(block: BlockConfig) -> BlockAssetCounts:
    """Derive total asset counts for one block from its configuration."""
    idts = block.idts_per_block
    inverters = idts * block.inverters_per_idt
    smbs = inverters * block.smbs_per_inverter
    strings = smbs * block.strings_per_smb
    modules = strings * block.modules_per_string
    return BlockAssetCounts(
        modules=modules,
        strings=strings,
        smbs=smbs,
        inverters=inverters,
        idts=idts,
    )
