"""Canonical weather time-series interface with enforced source labeling.

The physics engine accepts only :class:`WeatherTimeSeries` objects. Every
instance carries a :class:`DataSourceClassification`; synthetic data must
carry the mandatory disclaimer and can never be re-labeled as measured data.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

import pandas as pd

from najm3000 import SYNTHETIC_DISCLAIMER


class DataSourceClassification(StrEnum):
    """Weather/data source classification labels (see CONFIDENTIALITY.md)."""

    MEASURED_SITE = "MEASURED_SITE"
    OFFICIAL_TMY = "OFFICIAL_TMY"
    PROVISIONAL_PUBLIC = "PROVISIONAL_PUBLIC"
    SYNTHETIC_SOFTWARE_TEST = "SYNTHETIC_SOFTWARE_TEST"


REQUIRED_COLUMNS: tuple[str, ...] = (
    "ghi",
    "dni",
    "dhi",
    "temp_ambient",
    "wind_speed",
)


class WeatherValidationError(Exception):
    """Raised when a weather time series violates the canonical schema."""


@dataclass(frozen=True)
class WeatherTimeSeries:
    """Weather input with a mandatory, immutable source classification."""

    classification: DataSourceClassification
    data: pd.DataFrame
    disclaimer: str = ""
    albedo: float | None = None
    source_name: str = ""
    _validated: bool = field(default=False, repr=False, compare=False)

    def validate(self) -> WeatherTimeSeries:
        """Validate schema, timezone-awareness, labeling, and physical limits."""
        index = self.data.index
        if not isinstance(index, pd.DatetimeIndex):
            msg = "weather data index must be a pandas DatetimeIndex"
            raise WeatherValidationError(msg)
        if index.tz is None:
            msg = "weather data index must be timezone-aware (naive rejected)"
            raise WeatherValidationError(msg)
        if index.has_duplicates:
            msg = "weather data index contains duplicate timestamps"
            raise WeatherValidationError(msg)
        missing = [c for c in REQUIRED_COLUMNS if c not in self.data.columns]
        if missing:
            msg = f"weather data missing required columns: {missing}"
            raise WeatherValidationError(msg)
        for column in ("ghi", "dni", "dhi"):
            if bool((self.data[column] < 0.0).any()):
                msg = f"negative irradiance found in column '{column}'"
                raise WeatherValidationError(msg)
        if bool((self.data["wind_speed"] < 0.0).any()):
            msg = "negative wind speed found"
            raise WeatherValidationError(msg)
        if (
            self.classification
            is DataSourceClassification.SYNTHETIC_SOFTWARE_TEST
            and SYNTHETIC_DISCLAIMER not in self.disclaimer
        ):
            msg = (
                "synthetic weather must carry the disclaimer "
                f"'{SYNTHETIC_DISCLAIMER}'"
            )
            raise WeatherValidationError(msg)
        object.__setattr__(self, "_validated", True)
        return self

    @property
    def is_validated(self) -> bool:
        """True once :meth:`validate` has passed."""
        return self._validated

    def relabel(
        self, classification: DataSourceClassification
    ) -> WeatherTimeSeries:
        """Refuse promotion of any non-measured source to ``MEASURED_SITE``.

        Per ``docs/weather_data_policy.md``, ``MEASURED_SITE`` may only be
        applied to data actually measured on the NAJM-3000 site. Synthetic and
        publicly sourced data can never be promoted into it, no matter how
        real the public data is.
        """
        if (
            classification is DataSourceClassification.MEASURED_SITE
            and self.classification is not DataSourceClassification.MEASURED_SITE
        ):
            msg = (
                f"{self.classification.value} data must never be reclassified "
                f"as MEASURED_SITE; that label is reserved for data measured "
                f"on the NAJM-3000 site"
            )
            raise WeatherValidationError(msg)
        return WeatherTimeSeries(
            classification=classification,
            data=self.data,
            disclaimer=self.disclaimer,
            albedo=self.albedo,
            source_name=self.source_name,
        )
