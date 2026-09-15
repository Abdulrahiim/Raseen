"""Plant model for the dashboard overview.

Expands the configured representative blocks into the full plant so the
overview can show many blocks with drill-down.

**Illustrative per-block spread (ASMP-023).** Blocks of identical configuration
produce identical model output. A plant view showing hundreds of identical
values would misrepresent how a real plant behaves and would read as obviously
artificial. A deterministic spread is therefore applied for presentation,
seeded from the block index so it is fully reproducible. It represents module
power-bin distribution, layout and orientation differences.

It is **not** observed or expected inter-block variation — that is unknown until
measured data exists (Sprint 7). It affects presentation only and is never used
in energy accounting, the loss ledger, or any report.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

from najm3000.config.schemas import BlocksConfig

#: Assumption governing the illustrative spread.
BLOCK_SPREAD_ASSUMPTION_ID = "ASMP-023"

#: Half-width of the spread: blocks land within +/- 2% of the modeled value.
BLOCK_SPREAD_FRACTION = 0.02

#: Share of stations given the first (alphabetically) configuration.
#:
#: Derived, not invented: the design basis states a plant DC/AC ratio of
#: 1.096:1 at inverter level. With the Vendor A station at 1.116 and the
#: Vendor B station at 1.051, a 69/31 split reproduces that average. It is an
#: inference from plant totals, not an as-built assignment — the per-station
#: vendor mix remains unknown (GAP-001, DR-002).
PRIMARY_CONFIG_SHARE = 0.69

#: The per-block vendor mix is not known (GAP-001), so the arrangement shown is
#: illustrative rather than an as-built layout.
LAYOUT_NOTE = (
    "Equipment is assigned to contiguous zones for presentation, split to "
    "reproduce the design-basis plant DC/AC ratio. The per-station vendor mix "
    "is unknown (GAP-001); this is not an as-built layout."
)

#: Note attached to the block count, because GAP-019 is unresolved.
BLOCK_COUNT_NOTE = (
    "Block count is taken from configuration. GAP-019 is unresolved: the "
    "electrical design basis states 365 MVPS while the IDT GTP BOQ lists "
    "286+2 units. The figure shown is not a confirmed plant configuration."
)


def variation_factor(index: int) -> float:
    """Deterministic illustrative spread factor for block ``index``.

    Uses a stable hash so the same block always receives the same factor across
    runs, processes and machines — Python's ``hash()`` is salted per process and
    would break reproducibility.
    """
    digest = hashlib.sha256(str(index).encode("utf-8")).digest()
    # Map the first 8 bytes to a uniform value in [-1, 1].
    raw = int.from_bytes(digest[:8], "big") / (2**64 - 1)
    return 1.0 + BLOCK_SPREAD_FRACTION * (2.0 * raw - 1.0)


@dataclass(frozen=True)
class PlantBlock:
    """One block in the plant overview."""

    block_id: str
    config_name: str
    row: int
    column: int
    variation: float


@dataclass(frozen=True)
class Plant:
    """The plant as the dashboard presents it."""

    blocks: tuple[PlantBlock, ...]
    block_count: int
    block_count_source: str
    block_count_note: str
    layout_note: str
    label: str
    grid_rows: int
    grid_columns: int
    spread_assumption_id: str = BLOCK_SPREAD_ASSUMPTION_ID
    spread_fraction: float = BLOCK_SPREAD_FRACTION

    def scale(self, value_by_config: dict[str, float]) -> dict[str, float]:
        """Apply each block's illustrative variation to its configuration value."""
        return {
            block.block_id: value_by_config[block.config_name] * block.variation
            for block in self.blocks
        }

    def total(self, value_by_config: dict[str, float]) -> float:
        """Plant total — by construction the sum of the scaled block values."""
        return sum(self.scale(value_by_config).values())


def build_plant(blocks: BlocksConfig) -> Plant:
    """Expand the configured blocks into the plant used by the overview."""
    scenario = blocks.plant_scaling_scenario
    count = scenario.block_count
    config_names = sorted(blocks.blocks)
    columns = max(1, math.ceil(math.sqrt(count)))

    # Assign configurations in contiguous zones rather than alternating.
    # Real plants group equipment by area and construction phase; interleaving
    # every other block would render as a checkerboard and misrepresent the
    # layout. The per-block vendor mix is unknown (GAP-001), so any assignment
    # is illustrative — this one is at least shaped like a real plant.
    boundary = round(count * PRIMARY_CONFIG_SHARE)
    zone_size = math.ceil(count / len(config_names))

    def zone_of(index: int) -> str:
        """Configuration for a station, in contiguous zones."""
        if len(config_names) == 2:
            # Split to reproduce the design-basis plant DC/AC ratio (see
            # PRIMARY_CONFIG_SHARE) rather than splitting evenly.
            return config_names[0] if index < boundary else config_names[1]
        return config_names[min(index // zone_size, len(config_names) - 1)]

    plant_blocks = tuple(
        PlantBlock(
            block_id=f"BLK_{index + 1:04d}",
            config_name=zone_of(index),
            row=index // columns,
            column=index % columns,
            variation=variation_factor(index),
        )
        for index in range(count)
    )
    return Plant(
        blocks=plant_blocks,
        block_count=count,
        block_count_source="config/blocks.yaml plant_scaling_scenario.block_count",
        block_count_note=BLOCK_COUNT_NOTE,
        layout_note=LAYOUT_NOTE,
        label=scenario.label,
        grid_rows=math.ceil(count / columns),
        grid_columns=columns,
    )
