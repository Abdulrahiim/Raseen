"""Front-side plane-of-array irradiance via ``pvlib.irradiance``.

Transposition model (Perez or Hay-Davies) is selected in configuration.
Night timesteps (NaN tracker orientation) are returned as zero irradiance.
"""

from __future__ import annotations

import pandas as pd
from pvlib import atmosphere, irradiance

from najm3000.weather.interface import WeatherTimeSeries

POA_COLUMNS: tuple[str, ...] = (
    "poa_global",
    "poa_direct",
    "poa_diffuse",
    "poa_sky_diffuse",
    "poa_ground_diffuse",
)


def calculate_poa_irradiance(
    tracker_orientation: pd.DataFrame,
    weather: WeatherTimeSeries,
    solar_position: pd.DataFrame,
    transposition_model: str = "perez",
    albedo: float = 0.2,
) -> pd.DataFrame:
    """Compute front-side POA irradiance on the tracked module plane."""
    if not weather.is_validated:
        msg = "weather must be validated before use (call weather.validate())"
        raise ValueError(msg)
    times = weather.data.index
    dni_extra = irradiance.get_extra_radiation(times)
    relative_airmass = atmosphere.get_relative_airmass(
        solar_position["apparent_zenith"]
    )
    poa: pd.DataFrame = irradiance.get_total_irradiance(
        surface_tilt=tracker_orientation["surface_tilt"],
        surface_azimuth=tracker_orientation["surface_azimuth"],
        solar_zenith=solar_position["apparent_zenith"],
        solar_azimuth=solar_position["azimuth"],
        dni=weather.data["dni"],
        ghi=weather.data["ghi"],
        dhi=weather.data["dhi"],
        dni_extra=dni_extra,
        airmass=relative_airmass,
        albedo=albedo,
        model=transposition_model,
    )
    # Sun below horizon -> tracker orientation NaN -> POA NaN: physically zero.
    poa = poa.fillna(0.0).clip(lower=0.0)
    missing = [c for c in POA_COLUMNS if c not in poa.columns]
    if missing:
        msg = f"POA output missing columns: {missing}"
        raise RuntimeError(msg)
    return poa
