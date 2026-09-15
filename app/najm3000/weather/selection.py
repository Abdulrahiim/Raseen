"""Weather source selection shared by the CLIs and the viewer.

Turns a ``--weather`` choice plus the validated data-source configuration into
a concrete :class:`~najm3000.weather.provider.WeatherProvider`.

Selection is explicit: a caller that asks for public data and has not
configured (and had approved) a public source gets an error, never a silent
fallback to synthetic input.
"""

from __future__ import annotations

from najm3000 import PUBLIC_DATA_DISCLAIMER, SYNTHETIC_DISCLAIMER
from najm3000.config.schemas import DataSourcesFile, ProjectConfig
from najm3000.weather.interface import DataSourceClassification
from najm3000.weather.provider import SyntheticClearskyProvider, WeatherProvider
from najm3000.weather.pvgis import PVGISProvider, WeatherSourceError

#: Weather sources selectable on the command line.
WEATHER_CHOICES: tuple[str, ...] = ("synthetic_clearsky", "public_pvgis")


def run_disclaimer(classification: DataSourceClassification) -> str:
    """Label appropriate to the data a run actually used.

    Printing "SYNTHETIC DEMONSTRATION" over real satellite data would be a
    labeling error in its own right, so the disclaimer follows the source.
    """
    if classification is DataSourceClassification.SYNTHETIC_SOFTWARE_TEST:
        return SYNTHETIC_DISCLAIMER
    if classification is DataSourceClassification.PROVISIONAL_PUBLIC:
        return PUBLIC_DATA_DISCLAIMER
    msg = (
        f"no run disclaimer is defined for {classification.value}; measured "
        f"and official-TMY sources are not yet authorized"
    )
    raise WeatherSourceError(msg)


def apply_timestep_override(
    project: ProjectConfig, timestep_minutes: int
) -> ProjectConfig:
    """Return a copy of ``project`` with the simulation timestep replaced.

    One configuration can then serve both a sub-hourly synthetic run and an
    hourly public-data run without editing the file. The value is re-validated
    by the schema, so an out-of-range timestep is still rejected.
    """
    return project.model_copy(
        update={
            "simulation": project.simulation.model_copy(
                update={"timestep_minutes": timestep_minutes}
            )
        }
    )


def build_weather_provider(
    sources: DataSourcesFile, choice: str
) -> WeatherProvider:
    """Return the provider for ``choice``; never substitute a different source."""
    if choice == "synthetic_clearsky":
        return SyntheticClearskyProvider(
            config=sources.data_sources.synthetic_clearsky
        )
    if choice == "public_pvgis":
        config = sources.data_sources.public_pvgis
        if config is None:
            msg = (
                "no 'public_pvgis' source is configured in data_sources.yaml. "
                "Public weather requires written project-lead approval recorded "
                "in DATA_REGISTER.md before it is added (see "
                "docs/weather_data_policy.md)."
            )
            raise WeatherSourceError(msg)
        return PVGISProvider(config=config)
    msg = f"unknown weather source '{choice}'; choose from {list(WEATHER_CHOICES)}"
    raise WeatherSourceError(msg)
