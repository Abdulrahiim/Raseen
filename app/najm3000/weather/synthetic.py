"""Synthetic clear-sky weather generation for software verification only.

Outputs are always classified ``SYNTHETIC_SOFTWARE_TEST`` and carry the
mandatory disclaimer. They verify software behaviour — they do not predict
NAJM-3000 production.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from pvlib.location import Location

from najm3000 import SYNTHETIC_DISCLAIMER
from najm3000.config.schemas import SyntheticClearskyConfig
from najm3000.weather.interface import (
    DataSourceClassification,
    WeatherTimeSeries,
)

#: Constant Linke turbidity used instead of the bundled lookup table so the
#: synthetic test day is fully deterministic and needs no extra dependency.
#: Recorded as part of the SYNTHETIC_SOFTWARE_TEST definition (ASMP-005 family).
SYNTHETIC_LINKE_TURBIDITY = 3.0


def build_times(
    day: str, timezone: str, timestep_minutes: int
) -> pd.DatetimeIndex:
    """Build a timezone-aware index covering one calendar day."""
    start = pd.Timestamp(day, tz=timezone)
    end = start + pd.Timedelta(days=1) - pd.Timedelta(minutes=timestep_minutes)
    return pd.date_range(start, end, freq=f"{timestep_minutes}min")


def synthetic_temperature(
    times: pd.DatetimeIndex, t_min: float, t_max: float
) -> pd.Series:
    """Diurnal sinusoidal ambient temperature (minimum ~05:00, maximum ~17:00).

    A software-test profile only — not representative of site conditions.
    """
    if t_max < t_min:
        msg = f"t_max ({t_max}) must be >= t_min ({t_min})"
        raise ValueError(msg)
    hours = times.hour.to_numpy() + times.minute.to_numpy() / 60.0
    phase = 2.0 * np.pi * (hours - 5.0) / 24.0
    values = t_min + (t_max - t_min) * 0.5 * (1.0 - np.cos(phase))
    return pd.Series(values, index=times, name="temp_ambient")


def generate_clearsky_weather(
    location: Location,
    times: pd.DatetimeIndex,
    config: SyntheticClearskyConfig,
) -> WeatherTimeSeries:
    """Generate a validated synthetic clear-sky weather time series."""
    if times.tz is None:
        msg = "times must be timezone-aware"
        raise ValueError(msg)
    clearsky = location.get_clearsky(
        times,
        model=config.clearsky_method,
        linke_turbidity=SYNTHETIC_LINKE_TURBIDITY,
    )
    data = pd.DataFrame(index=times)
    data["ghi"] = clearsky["ghi"].clip(lower=0.0)
    data["dni"] = clearsky["dni"].clip(lower=0.0)
    data["dhi"] = clearsky["dhi"].clip(lower=0.0)
    data["temp_ambient"] = synthetic_temperature(
        times,
        t_min=config.synthetic_temperature.t_min.value,
        t_max=config.synthetic_temperature.t_max.value,
    )
    data["wind_speed"] = config.synthetic_wind.wind_speed.value
    data["albedo"] = config.albedo.value
    data["quality_flag"] = "SYNTHETIC"
    data["source_classification"] = config.classification

    weather = WeatherTimeSeries(
        classification=DataSourceClassification.SYNTHETIC_SOFTWARE_TEST,
        data=data,
        disclaimer=SYNTHETIC_DISCLAIMER,
        albedo=config.albedo.value,
        source_name="synthetic_clearsky",
    )
    return weather.validate()
