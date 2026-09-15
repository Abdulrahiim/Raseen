"""Single-axis tracker model wrapper around ``pvlib.tracking.singleaxis``.

All geometry parameters come from validated configuration; the configured
maximum rotation is enforced as a hard physical limit.
"""

from __future__ import annotations

import pandas as pd
from pvlib import tracking

from najm3000.config.schemas import TrackerConfig

#: Numerical tolerance [degrees] applied when checking the rotation limit.
ANGLE_TOLERANCE_DEG = 1e-6


class TrackerLimitError(Exception):
    """Raised when the tracker model produces angles beyond the configured limit."""


def calculate_tracker_orientation(
    solar_position: pd.DataFrame,
    tracker: TrackerConfig,
    gcr: float,
    cross_axis_tilt: float = 0.0,
) -> pd.DataFrame:
    """Compute tracker rotation and module orientation.

    Returns columns ``tracker_theta``, ``aoi``, ``surface_tilt``,
    ``surface_azimuth``. Timesteps with the sun below the horizon contain NaN
    (pvlib convention); downstream stages treat them as zero irradiance.
    """
    orientation: pd.DataFrame = tracking.singleaxis(
        apparent_zenith=solar_position["apparent_zenith"],
        solar_azimuth=solar_position["azimuth"],
        axis_tilt=tracker.axis_tilt.value,
        axis_azimuth=tracker.axis_azimuth.value,
        max_angle=tracker.max_angle.value,
        backtrack=tracker.backtrack,
        gcr=gcr,
        cross_axis_tilt=cross_axis_tilt,
    )
    theta = orientation["tracker_theta"].dropna()
    limit = tracker.max_angle.value + ANGLE_TOLERANCE_DEG
    if bool((theta.abs() > limit).any()):
        worst = float(theta.abs().max())
        msg = (
            f"tracker rotation {worst:.3f} deg exceeds configured maximum "
            f"{tracker.max_angle.value:.3f} deg"
        )
        raise TrackerLimitError(msg)
    return orientation
