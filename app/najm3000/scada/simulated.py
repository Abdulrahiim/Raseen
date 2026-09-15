"""Simulated historian adapter — the physics engine dressed as telemetry.

NAJM-3000 is under construction and SCADA is not commissioned, so there is no
telemetry to read. This adapter runs the physics chain and expands the result
into per-asset rows in the canonical time-series schema, so the
pre-commissioning dashboard is built against exactly the contract the real
historian will implement.

**This is simulated output, not measured data.** ``is_active`` is ``False`` and
the classification follows the weather source actually used — never
``MEASURED_SITE``. At commissioning, the real adapter replaces this one and
nothing above it changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from najm3000 import __version__
from najm3000.aggregation.aggregator import (
    BlockSimulationResult,
    run_block_simulation,
)
from najm3000.config.schemas import (
    BlocksConfig,
    EquipmentConfig,
    ProjectConfig,
)
from najm3000.scada.adapter_interface import HistorianAdapter
from najm3000.weather.interface import DataSourceClassification
from najm3000.weather.provider import WeatherProvider

#: Quality flag applied to every simulated row. Not a measurement quality code.
SIMULATED_QUALITY_FLAG = "SIMULATED"

#: Flag for timesteps where the modeled quantity is genuinely undefined, such
#: as tracker orientation with the sun below the horizon.
UNDEFINED_QUALITY_FLAG = "UNDEFINED"

#: Explanation attached to every undefined value; the canonical schema refuses
#: an unexplained gap.
UNDEFINED_REASON = "{quantity} is undefined at this timestep in the model"

#: Identifies the pipeline that produced a row, per the canonical schema.
PROCESSING_VERSION = f"najm3000-simulated-{__version__}"


class UnknownTagError(Exception):
    """Raised when a caller requests a tag the adapter cannot serve."""


@dataclass(frozen=True)
class TagSpec:
    """Maps one simulation output column onto a SCADA-style tag."""

    suffix: str
    column: str
    physical_quantity: str
    unit: str
    asset_suffix: str


#: Tags emitted per configured block. Names are sanitized identifiers only.
BLOCK_TAG_SPECS: tuple[TagSpec, ...] = (
    TagSpec("GHI", "ghi", "ghi", "W/m2", "weather"),
    TagSpec("POA_IRR", "poa_effective", "poa_irradiance", "W/m2", "weather"),
    TagSpec("TAMB", "temp_ambient", "temp_ambient", "degC", "weather"),
    TagSpec("WIND", "wind_speed", "wind_speed", "m/s", "weather"),
    TagSpec("TMOD", "temp_cell", "temp_module", "degC", "array"),
    TagSpec("TRK_ANGLE", "tracker_theta", "tracker_angle", "deg", "tracker"),
    TagSpec("INV_PDC", "p_dc_inverter", "dc_power", "W", "inverter_01"),
    TagSpec("INV_PAC", "p_ac_inverter", "ac_power", "W", "inverter_01"),
    TagSpec("IDT_POUT", "p_idt_out", "idt_out_power", "W", "idt_01"),
    TagSpec("BLK_PAC", "p_block", "block_power", "W", "block"),
)


def _tag_id(block_name: str, spec: TagSpec) -> str:
    return f"{block_name}_{spec.suffix}".upper().replace("-", "_")


@dataclass
class SimulatedHistorianAdapter(HistorianAdapter):
    """Serves canonical telemetry rows computed by the physics engine."""

    project: ProjectConfig
    equipment: EquipmentConfig
    blocks: BlocksConfig
    weather_provider: WeatherProvider
    day: str
    _cache: dict[str, BlockSimulationResult] = field(
        default_factory=dict, repr=False
    )

    #: This adapter is never connected to a live system.
    is_active: bool = False

    @property
    def classification(self) -> str:
        """Source classification, inherited from the weather actually used."""
        value = self.weather_provider.classification
        if value is DataSourceClassification.MEASURED_SITE:
            msg = "a simulated adapter must never carry MEASURED_SITE"
            raise ValueError(msg)
        return str(value)

    @property
    def disclaimer(self) -> str:
        """Label stating this is simulated output, not measured data."""
        return (
            "SIMULATED TELEMETRY — PRE-COMMISSIONING DIGITAL TWIN. "
            "NOT MEASURED DATA, NOT CALIBRATED, NOT VALIDATED."
        )

    # -- simulation ---------------------------------------------------------

    def result_for(self, block_name: str) -> BlockSimulationResult:
        """Run (or reuse) the physics chain for one configured block."""
        if block_name not in self._cache:
            self._cache[block_name] = run_block_simulation(
                project=self.project,
                equipment=self.equipment,
                blocks=self.blocks,
                weather_provider=self.weather_provider,
                block_name=block_name,
                day=self.day,
            )
        return self._cache[block_name]

    # -- historian interface ------------------------------------------------

    def list_available_tags(self) -> list[str]:
        """Every tag this adapter can serve, for all configured blocks."""
        return [
            _tag_id(block_name, spec)
            for block_name in self.blocks.blocks
            for spec in BLOCK_TAG_SPECS
        ]

    def fetch(
        self,
        tag_ids: list[str],
        start: pd.Timestamp,
        end: pd.Timestamp,
    ) -> pd.DataFrame:
        """Return canonical rows for ``tag_ids`` within ``[start, end]``."""
        index = {
            _tag_id(block_name, spec): (block_name, spec)
            for block_name in self.blocks.blocks
            for spec in BLOCK_TAG_SPECS
        }
        unknown = [tag for tag in tag_ids if tag not in index]
        if unknown:
            msg = f"unknown tag(s): {sorted(unknown)}"
            raise UnknownTagError(msg)

        frames: list[pd.DataFrame] = []
        for tag in tag_ids:
            block_name, spec = index[tag]
            series = self.result_for(block_name).timeseries[spec.column]
            stamps = pd.DatetimeIndex(series.index)
            window = (stamps >= start) & (stamps <= end)
            selected = series[window]
            if selected.empty:
                continue
            values = selected.to_numpy(dtype=float)
            # Some quantities are genuinely undefined at some timesteps —
            # tracker orientation below the horizon, for instance. Those are
            # reported as explained gaps rather than filled with an invented
            # value, exactly as a real historian would carry them.
            undefined = pd.isna(values)
            frames.append(
                pd.DataFrame(
                    {
                        "timestamp": pd.DatetimeIndex(selected.index),
                        "tag_id": tag,
                        "asset_id": f"{block_name}.{spec.asset_suffix}",
                        "value_raw": values,
                        # A simulation applies no QC correction.
                        "value_qc": values,
                        "quality_flag": [
                            UNDEFINED_QUALITY_FLAG if flag else SIMULATED_QUALITY_FLAG
                            for flag in undefined
                        ],
                        "source_classification": self.classification,
                        "unit": spec.unit,
                        "sensor_status": "SIMULATED",
                        "exclusion_reason": [
                            UNDEFINED_REASON.format(quantity=spec.physical_quantity)
                            if flag
                            else None
                            for flag in undefined
                        ],
                        "correction_reason": None,
                        "processing_version": PROCESSING_VERSION,
                    }
                )
            )
        if not frames:
            from najm3000.scada.canonical import empty_canonical_frame

            return empty_canonical_frame()
        return pd.concat(frames, ignore_index=True)
