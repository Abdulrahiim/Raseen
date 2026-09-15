"""Pluggable weather source interface.

The physics engine depends only on this protocol and on
:class:`~najm3000.weather.interface.WeatherTimeSeries`. Adding a weather source
means adding a provider — no physics module changes.

Each provider is responsible for applying the correct source classification;
``WeatherTimeSeries.validate()` then enforces the labeling rules.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from pvlib.location import Location

from najm3000 import SYNTHETIC_DISCLAIMER
from najm3000.config.schemas import SyntheticClearskyConfig
from najm3000.weather.interface import (
    DataSourceClassification,
    WeatherTimeSeries,
)
from najm3000.weather.synthetic import build_times, generate_clearsky_weather


@runtime_checkable
class WeatherProvider(Protocol):
    """Supplies validated, classified weather for one calendar day."""

    @property
    def classification(self) -> DataSourceClassification:
        """Classification applied to everything this provider returns."""
        ...

    def fetch(
        self,
        location: Location,
        day: str,
        timezone: str,
        timestep_minutes: int,
    ) -> WeatherTimeSeries:
        """Return validated weather for ``day`` in ``timezone``."""
        ...


@dataclass(frozen=True)
class SyntheticClearskyProvider:
    """Clear-sky synthetic weather — software verification only.

    Wraps the existing generator so the synthetic path and any real source are
    substitutable through the same interface.
    """

    config: SyntheticClearskyConfig

    @property
    def classification(self) -> DataSourceClassification:
        """Always ``SYNTHETIC_SOFTWARE_TEST``."""
        return DataSourceClassification.SYNTHETIC_SOFTWARE_TEST

    @property
    def disclaimer(self) -> str:
        """Mandatory label carried by every synthetic output."""
        return SYNTHETIC_DISCLAIMER

    def fetch(
        self,
        location: Location,
        day: str,
        timezone: str,
        timestep_minutes: int,
    ) -> WeatherTimeSeries:
        """Generate one synthetic clear-sky day at the requested timestep."""
        times = build_times(day, timezone, timestep_minutes)
        return generate_clearsky_weather(location, times, self.config)
