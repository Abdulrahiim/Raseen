"""Solar position calculation wrapper around pvlib.

Thin wrapper enforcing timezone-aware input and a stable output schema.
"""

from __future__ import annotations

import pandas as pd
from pvlib.location import Location


def calculate_solar_position(
    location: Location,
    times: pd.DatetimeIndex,
    method: str = "nrel_numpy",
) -> pd.DataFrame:
    """Compute solar position for timezone-aware ``times``.

    Returns a DataFrame with at least ``apparent_zenith``, ``azimuth``, and
    ``apparent_elevation`` columns.
    """
    if times.tz is None:
        msg = "times must be timezone-aware (naive DatetimeIndex rejected)"
        raise ValueError(msg)
    solar_position: pd.DataFrame = location.get_solarposition(
        times, method=method
    )
    required = ("apparent_zenith", "azimuth", "apparent_elevation")
    missing = [c for c in required if c not in solar_position.columns]
    if missing:
        msg = f"solar position output missing columns: {missing}"
        raise RuntimeError(msg)
    return solar_position
