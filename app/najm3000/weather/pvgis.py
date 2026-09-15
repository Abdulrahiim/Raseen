"""PVGIS public weather ingestion, classified ``PROVISIONAL_PUBLIC``.

Source: PVGIS (EU Joint Research Centre), radiation database ``PVGIS-SARAH3``
(Meteosat satellite-derived), meteorological database ERA5. Retrieved through
``pvlib.iotools.get_pvgis_hourly``.

**This is real weather, but it is not site-measured data.** Use of an external
weather source was authorized in writing by the project lead on 2026-08-02 and
is recorded in ``DATA_REGISTER.md``. The classification is locked to
``PROVISIONAL_PUBLIC``: it cannot calibrate or validate the Digital Twin, which
still requires on-site measurement (GAP-002) or the approved owner TMY
(GAP-020 / DR-001).

PVGIS returns *plane-of-array* components. This module requests the horizontal
plane and asserts it in the response, then derives GHI/DHI/DNI from it.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import pandas as pd
from pvlib import irradiance
from pvlib.location import Location

from najm3000.config.schemas import PublicWeatherConfig
from najm3000.weather.interface import (
    DataSourceClassification,
    WeatherTimeSeries,
)

#: Temporal coverage of PVGIS-SARAH3, verified against the live API 2026-08-02.
PVGIS_YEAR_MIN = 2005
PVGIS_YEAR_MAX = 2023

#: PVGIS hourly products are hourly averages; finer timesteps would require
#: interpolating irradiance, which invents data that was never observed.
PVGIS_TIMESTEP_MINUTES = 60

#: Columns expected from ``get_pvgis_hourly(map_variables=True)``.
REQUIRED_PVGIS_COLUMNS: tuple[str, ...] = (
    "poa_direct",
    "poa_sky_diffuse",
    "poa_ground_diffuse",
    "solar_elevation",
    "temp_air",
    "wind_speed",
    "Int",
)

#: Quality flags derived from the PVGIS ``Int`` reconstruction indicator.
FLAG_RECONSTRUCTED = "PVGIS_RECONSTRUCTED"
FLAG_SATELLITE = "PVGIS_MEASURED_SATELLITE"

PvgisFetcher = Callable[[float, float, int], tuple[pd.DataFrame, dict[str, Any]]]


class WeatherSourceError(Exception):
    """Raised when a public weather source cannot supply valid data.

    Never caught to substitute another source: a silent fallback would emit
    unlabeled data, which the weather data policy forbids.
    """


def _fetch_from_pvgis(
    latitude: float, longitude: float, year: int
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Retrieve one year of hourly PVGIS data on the horizontal plane."""
    from pvlib.iotools import get_pvgis_hourly

    data, meta = get_pvgis_hourly(
        latitude=latitude,
        longitude=longitude,
        start=year,
        end=year,
        raddatabase="PVGIS-SARAH3",
        components=True,
        surface_tilt=0,
        surface_azimuth=180,
        map_variables=True,
        timeout=90,
    )
    return data, meta


def convert_pvgis_frame(
    raw: pd.DataFrame, timezone: str, albedo: float
) -> pd.DataFrame:
    """Convert a PVGIS hourly frame to the canonical weather schema.

    PVGIS supplies beam and diffuse on the *plane of array*. On the horizontal
    plane the ground-reflected component is zero, so the plane components
    reduce to horizontal quantities:

        GHI = beam_horizontal + diffuse_horizontal
        DHI = diffuse_horizontal
        DNI = derived via ``pvlib.irradiance.dni``

    DNI is derived rather than computed as ``BHI / sin(elevation)``, which
    diverges at sunrise and sunset.
    """
    missing = [c for c in REQUIRED_PVGIS_COLUMNS if c not in raw.columns]
    if missing:
        msg = f"PVGIS response missing expected column(s): {missing}"
        raise WeatherSourceError(msg)

    index = pd.DatetimeIndex(raw.index)
    if index.tz is None:
        msg = "PVGIS response index must be timezone-aware (naive rejected)"
        raise WeatherSourceError(msg)

    if bool((raw["poa_ground_diffuse"].abs() > 0.0).any()):
        msg = (
            "PVGIS response is not on the horizontal plane: ground-reflected "
            "irradiance is non-zero, so the components cannot be read as "
            "horizontal GHI/DHI"
        )
        raise WeatherSourceError(msg)

    local_index = index.tz_convert(timezone)
    ghi = (raw["poa_direct"] + raw["poa_sky_diffuse"]).clip(lower=0.0)
    dhi = raw["poa_sky_diffuse"].clip(lower=0.0)
    zenith = 90.0 - raw["solar_elevation"]
    dni = irradiance.dni(
        ghi=ghi.to_numpy(), dhi=dhi.to_numpy(), zenith=zenith.to_numpy()
    )

    data = pd.DataFrame(index=local_index)
    data["ghi"] = ghi.to_numpy()
    data["dni"] = pd.Series(dni, index=local_index).fillna(0.0).clip(lower=0.0)
    data["dhi"] = dhi.to_numpy()
    data["temp_ambient"] = raw["temp_air"].to_numpy()
    data["wind_speed"] = raw["wind_speed"].clip(lower=0.0).to_numpy()
    data["albedo"] = albedo
    data["quality_flag"] = [
        FLAG_RECONSTRUCTED if int(v) == 1 else FLAG_SATELLITE
        for v in raw["Int"].to_numpy()
    ]
    data["source_classification"] = DataSourceClassification.PROVISIONAL_PUBLIC.value
    return data


@dataclass(frozen=True)
class PVGISProvider:
    """Weather provider backed by PVGIS, labeled ``PROVISIONAL_PUBLIC``.

    ``fetcher`` is injectable so tests never perform network I/O.
    """

    config: PublicWeatherConfig
    #: Resolved at call time (not bound here) so tests can substitute it and
    #: no import performs network I/O.
    fetcher: PvgisFetcher | None = field(default=None)

    @property
    def classification(self) -> DataSourceClassification:
        """Classification applied to everything this provider returns."""
        return DataSourceClassification.PROVISIONAL_PUBLIC

    def fetch(
        self,
        location: Location,
        day: str,
        timezone: str,
        timestep_minutes: int,
    ) -> WeatherTimeSeries:
        """Return validated public weather for one calendar day."""
        if timestep_minutes != PVGIS_TIMESTEP_MINUTES:
            msg = (
                f"PVGIS supplies hourly averages; timestep_minutes="
                f"{timestep_minutes} would require interpolating irradiance. "
                f"Set timestep_minutes to {PVGIS_TIMESTEP_MINUTES}."
            )
            raise WeatherSourceError(msg)

        year = pd.Timestamp(day).year
        if not PVGIS_YEAR_MIN <= year <= PVGIS_YEAR_MAX:
            msg = (
                f"requested year {year} is outside PVGIS-SARAH3 coverage "
                f"({PVGIS_YEAR_MIN}-{PVGIS_YEAR_MAX}); the synthetic test day "
                f"is deliberately outside this range"
            )
            raise WeatherSourceError(msg)

        fetcher = self.fetcher if self.fetcher is not None else _fetch_from_pvgis
        try:
            raw, _meta = fetcher(location.latitude, location.longitude, year)
        except WeatherSourceError:
            raise
        except Exception as exc:  # noqa: BLE001 — surfaced, never substituted
            msg = f"PVGIS retrieval failed ({type(exc).__name__}): {exc}"
            raise WeatherSourceError(msg) from exc

        data = convert_pvgis_frame(
            raw, timezone=timezone, albedo=self.config.albedo.value
        )
        wanted = pd.DatetimeIndex(data.index).normalize() == pd.Timestamp(
            day, tz=timezone
        )
        day_data: pd.DataFrame = data[wanted]
        if day_data.empty:
            msg = f"PVGIS returned no data for {day}"
            raise WeatherSourceError(msg)

        weather = WeatherTimeSeries(
            classification=DataSourceClassification.PROVISIONAL_PUBLIC,
            data=day_data,
            disclaimer=self.config.disclaimer,
            albedo=self.config.albedo.value,
            source_name=f"pvgis_{self.config.radiation_database}",
        )
        return weather.validate()
