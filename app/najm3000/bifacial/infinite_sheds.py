"""Bifacial irradiance via ``pvlib.bifacial.infinite_sheds``.

Effective irradiance follows the project methodology::

    G_eff = G_front + bifaciality * G_rear * (1 - rear_mismatch)

implemented by passing ``bifaciality * (1 - rear_mismatch)`` as the effective
bifaciality to pvlib. Geometry (GCR, axis height) is provisional/assumed —
see ASMP-002 and ASMP-013.
"""

from __future__ import annotations

import pandas as pd
from pvlib import irradiance
from pvlib.bifacial import infinite_sheds

from najm3000.config.schemas import BlockConfig, PVModuleConfig, TrackerConfig
from najm3000.weather.interface import WeatherTimeSeries


def calculate_bifacial_irradiance(
    tracker_orientation: pd.DataFrame,
    solar_position: pd.DataFrame,
    weather: WeatherTimeSeries,
    block: BlockConfig,
    module: PVModuleConfig,
    tracker: TrackerConfig,
) -> pd.DataFrame:
    """Compute bifacial effective irradiance for the tracked plane.

    Returns columns ``poa_global`` (bifacial-effective), ``poa_front``,
    ``poa_back``. Night timesteps are zero.
    """
    if not weather.is_validated:
        msg = "weather must be validated before use"
        raise ValueError(msg)
    gcr = block.gcr.value
    collector_width = module.module_length.value
    pitch = collector_width / gcr
    effective_bifaciality = module.bifaciality.value * (
        1.0 - module.rear_mismatch_factor.value
    )
    dni_extra = irradiance.get_extra_radiation(weather.data.index)
    result: pd.DataFrame = infinite_sheds.get_irradiance(
        surface_tilt=tracker_orientation["surface_tilt"],
        surface_azimuth=tracker_orientation["surface_azimuth"],
        solar_zenith=solar_position["apparent_zenith"],
        solar_azimuth=solar_position["azimuth"],
        gcr=gcr,
        height=tracker.axis_height.value,
        pitch=pitch,
        ghi=weather.data["ghi"],
        dhi=weather.data["dhi"],
        dni=weather.data["dni"],
        albedo=block.albedo.value,
        model="haydavies",
        dni_extra=dni_extra,
        bifaciality=effective_bifaciality,
    )
    result = result.fillna(0.0).clip(lower=0.0)
    required = ("poa_global", "poa_front", "poa_back")
    missing = [c for c in required if c not in result.columns]
    if missing:
        msg = f"bifacial output missing columns: {missing}"
        raise RuntimeError(msg)
    return result
