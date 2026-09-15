"""Pydantic v2 configuration schemas for the NAJM-3000 Digital Twin.

All equipment and site parameters enter the model exclusively through these
schemas. Validation fails hard: no fallback defaults for missing engineering
values, no ``PLACEHOLDER`` strings, no naive datetimes, no parameters without
provenance.
"""

from __future__ import annotations

from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

from najm3000.assets.provenance import ParameterWithProvenance

_MODEL_CONFIG = ConfigDict(extra="ignore", frozen=True)


# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------


class ProjectMeta(BaseModel):
    """Project identity block; enforces pre-operational status statements."""

    model_config = _MODEL_CONFIG

    name: Literal["NAJM-3000"]
    version: str
    status: Literal["pre-operational"]
    description: str
    calibration_status: Literal["not-calibrated"]
    validation_status: Literal["not-validated"]


class LocationConfig(BaseModel):
    """Site location. Coordinates live only in the gitignored live config."""

    model_config = _MODEL_CONFIG

    latitude: ParameterWithProvenance
    longitude: ParameterWithProvenance
    altitude: ParameterWithProvenance
    timezone: str
    name: str

    @field_validator("latitude")
    @classmethod
    def _check_latitude(
        cls, v: ParameterWithProvenance
    ) -> ParameterWithProvenance:
        if not -90.0 <= v.value <= 90.0:
            msg = f"latitude {v.value} outside [-90, 90]"
            raise ValueError(msg)
        return v

    @field_validator("longitude")
    @classmethod
    def _check_longitude(
        cls, v: ParameterWithProvenance
    ) -> ParameterWithProvenance:
        if not -180.0 <= v.value <= 180.0:
            msg = f"longitude {v.value} outside [-180, 180]"
            raise ValueError(msg)
        return v

    @field_validator("timezone")
    @classmethod
    def _check_timezone(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            msg = f"'{v}' is not a valid IANA timezone"
            raise ValueError(msg) from exc
        return v


class SimulationConfig(BaseModel):
    """Simulation time settings."""

    model_config = _MODEL_CONFIG

    timestep_minutes: int = Field(gt=0, le=60)
    start_date: str | None = None
    end_date: str | None = None
    weather_source: Literal[
        "MEASURED_SITE",
        "OFFICIAL_TMY",
        "PROVISIONAL_PUBLIC",
        "SYNTHETIC_SOFTWARE_TEST",
    ]


class OutputsConfig(BaseModel):
    """Output location and mandatory labeling."""

    model_config = _MODEL_CONFIG

    directory: str
    format: Literal["parquet", "csv"]
    include_provenance: bool
    include_assumptions: bool
    disclaimer: str

    @field_validator("disclaimer")
    @classmethod
    def _check_disclaimer(cls, v: str) -> str:
        if not v.strip():
            msg = "outputs.disclaimer must not be empty"
            raise ValueError(msg)
        return v


class ModelSelectionConfig(BaseModel):
    """pvlib model selections."""

    model_config = _MODEL_CONFIG

    solar_position: str
    irradiance_transposition: Literal["perez", "haydavies"]
    temperature_model: Literal["pvsyst_cell", "sapm_cell"]
    dc_model: Literal["pvwatts"]
    inverter_model: Literal["pvwatts"]
    bifacial_model: Literal["infinite_sheds"]


class PhysicsBaselineConfig(BaseModel):
    """Physics baseline: 100% availability, zero curtailment — labeled."""

    model_config = _MODEL_CONFIG

    availability_fraction: float = Field(ge=0.0, le=1.0)
    curtailment_fraction: float = Field(ge=0.0, le=1.0)


class ProjectConfig(BaseModel):
    """Top-level project configuration."""

    model_config = _MODEL_CONFIG

    project: ProjectMeta
    location: LocationConfig
    simulation: SimulationConfig
    outputs: OutputsConfig
    model_selection: ModelSelectionConfig
    physics_baseline: PhysicsBaselineConfig


# ---------------------------------------------------------------------------
# Equipment
# ---------------------------------------------------------------------------


class PVModuleConfig(BaseModel):
    """Bifacial PV module parameters (PVWatts-compatible subset)."""

    model_config = _MODEL_CONFIG

    description: str
    technology: str
    bifacial: bool
    pdc_stc: ParameterWithProvenance
    v_mp_stc: ParameterWithProvenance
    i_mp_stc: ParameterWithProvenance
    v_oc_stc: ParameterWithProvenance
    i_sc_stc: ParameterWithProvenance
    gamma_pdc: ParameterWithProvenance
    beta_voc: ParameterWithProvenance
    alpha_isc: ParameterWithProvenance
    bifaciality: ParameterWithProvenance
    rear_mismatch_factor: ParameterWithProvenance
    max_series_fuse: ParameterWithProvenance
    module_width: ParameterWithProvenance
    module_length: ParameterWithProvenance

    @field_validator("gamma_pdc")
    @classmethod
    def _check_gamma(cls, v: ParameterWithProvenance) -> ParameterWithProvenance:
        if not -0.01 <= v.value < 0.0:
            msg = f"gamma_pdc {v.value} outside plausible range [-0.01, 0)"
            raise ValueError(msg)
        return v

    @field_validator("bifaciality")
    @classmethod
    def _check_bifaciality(
        cls, v: ParameterWithProvenance
    ) -> ParameterWithProvenance:
        if not 0.0 <= v.value <= 1.0:
            msg = f"bifaciality {v.value} outside [0, 1]"
            raise ValueError(msg)
        return v


class InverterConfig(BaseModel):
    """Central inverter parameters (PVWatts-compatible subset)."""

    model_config = _MODEL_CONFIG

    description: str
    type: Literal["central", "string"]
    paco: ParameterWithProvenance
    eta_inv_nom: ParameterWithProvenance
    night_power: ParameterWithProvenance
    mppt_low: ParameterWithProvenance
    mppt_high: ParameterWithProvenance
    max_dc_voltage: ParameterWithProvenance

    @field_validator("eta_inv_nom")
    @classmethod
    def _check_eta(cls, v: ParameterWithProvenance) -> ParameterWithProvenance:
        if not 0.5 < v.value < 1.0:
            msg = f"eta_inv_nom {v.value} outside plausible range (0.5, 1.0)"
            raise ValueError(msg)
        return v

    def pdc0(self) -> float:
        """DC input power [W] that yields rated AC output (PVWatts pdc0)."""
        return self.paco.value / self.eta_inv_nom.value


class IDTConfig(BaseModel):
    """Inverter-duty transformer parameters (two-component loss model)."""

    model_config = _MODEL_CONFIG

    description: str
    rated_power_mva: float = Field(gt=0.0)
    hv_voltage_kv: float = Field(gt=0.0)
    lv_voltage_kv: float = Field(gt=0.0)
    lv_windings: int = Field(ge=1, le=2)
    p_no_load: ParameterWithProvenance
    p_load_rated: ParameterWithProvenance

    @field_validator("p_no_load", "p_load_rated")
    @classmethod
    def _check_losses(cls, v: ParameterWithProvenance) -> ParameterWithProvenance:
        if v.value < 0.0:
            msg = f"transformer loss {v.value} W must be non-negative"
            raise ValueError(msg)
        return v


class TrackerConfig(BaseModel):
    """Single-axis tracker parameters."""

    model_config = _MODEL_CONFIG

    description: str
    type: Literal["single_axis"]
    axis_tilt: ParameterWithProvenance
    axis_azimuth: ParameterWithProvenance
    max_angle: ParameterWithProvenance
    backtrack: bool
    axis_height: ParameterWithProvenance

    @field_validator("max_angle")
    @classmethod
    def _check_max_angle(
        cls, v: ParameterWithProvenance
    ) -> ParameterWithProvenance:
        if not 0.0 < v.value <= 90.0:
            msg = f"max_angle {v.value} outside (0, 90] degrees"
            raise ValueError(msg)
        return v


class SMBConfig(BaseModel):
    """String monitoring box (DC combiner) parameters."""

    model_config = _MODEL_CONFIG

    description: str
    system_voltage: int = Field(gt=0)
    string_inputs: int = Field(gt=0)
    max_string_current: ParameterWithProvenance


class EquipmentConfig(BaseModel):
    """Multi-vendor equipment library. Unlike equipment is never averaged."""

    model_config = _MODEL_CONFIG

    pv_modules: dict[str, PVModuleConfig]
    inverters: dict[str, InverterConfig]
    idts: dict[str, IDTConfig]
    trackers: dict[str, TrackerConfig]
    smbs: dict[str, SMBConfig]


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------


class BlockPhysicsBaseline(BaseModel):
    """Per-block physics baseline with its mandatory label."""

    model_config = _MODEL_CONFIG

    availability_fraction: float = Field(ge=0.0, le=1.0)
    curtailment_fraction: float = Field(ge=0.0, le=1.0)
    label: str


class BlockConfig(BaseModel):
    """One MV block: equipment aliases plus electrical build-up counts."""

    model_config = _MODEL_CONFIG

    description: str
    status: str
    warning: str
    pv_module: str
    inverter: str
    idt: str
    tracker: str
    smb: str
    modules_per_string: int = Field(gt=0)
    strings_per_smb: int = Field(gt=0)
    smbs_per_inverter: int = Field(gt=0)
    inverters_per_idt: int = Field(ge=1)
    idts_per_block: int = Field(ge=1)
    gcr: ParameterWithProvenance
    cross_axis_tilt: ParameterWithProvenance
    albedo: ParameterWithProvenance
    soiling_factor: ParameterWithProvenance
    dc_cable_loss_fraction: ParameterWithProvenance
    ac_cable_loss_fraction: ParameterWithProvenance
    dc_mismatch_loss_fraction: ParameterWithProvenance
    physics_baseline: BlockPhysicsBaseline

    @field_validator("gcr")
    @classmethod
    def _check_gcr(cls, v: ParameterWithProvenance) -> ParameterWithProvenance:
        if not 0.0 < v.value < 1.0:
            msg = f"gcr {v.value} outside (0, 1)"
            raise ValueError(msg)
        return v

    @field_validator("albedo", "soiling_factor")
    @classmethod
    def _check_fraction(
        cls, v: ParameterWithProvenance
    ) -> ParameterWithProvenance:
        if not 0.0 <= v.value <= 1.0:
            msg = f"fraction {v.value} outside [0, 1]"
            raise ValueError(msg)
        return v


class PlantScalingScenario(BaseModel):
    """Illustrative plant scaling — clearly labeled, never a yield claim."""

    model_config = _MODEL_CONFIG

    description: str
    warning: str
    representative_block: str
    block_count: int = Field(gt=0)
    label: str


class BlocksConfig(BaseModel):
    """All configured blocks plus the labeled scaling scenario."""

    model_config = _MODEL_CONFIG

    blocks: dict[str, BlockConfig]
    plant_scaling_scenario: PlantScalingScenario


# ---------------------------------------------------------------------------
# Data sources
# ---------------------------------------------------------------------------


class SyntheticTemperatureConfig(BaseModel):
    """Synthetic diurnal temperature profile bounds."""

    model_config = _MODEL_CONFIG

    t_min: ParameterWithProvenance
    t_max: ParameterWithProvenance


class SyntheticWindConfig(BaseModel):
    """Synthetic constant wind speed."""

    model_config = _MODEL_CONFIG

    wind_speed: ParameterWithProvenance


class SyntheticClearskyConfig(BaseModel):
    """Authorized synthetic clear-sky weather source (software test only)."""

    model_config = _MODEL_CONFIG

    classification: Literal["SYNTHETIC_SOFTWARE_TEST"]
    description: str
    disclaimer: str
    authorized: Literal[True]
    clearsky_method: Literal["ineichen", "simplified_solis"]
    synthetic_temperature: SyntheticTemperatureConfig
    synthetic_wind: SyntheticWindConfig
    albedo: ParameterWithProvenance


class PublicWeatherConfig(BaseModel):
    """Publicly sourced weather (PVGIS), classified ``PROVISIONAL_PUBLIC``.

    The classification is locked by ``Literal``: public data must never be
    labeled ``MEASURED_SITE`` (see ``docs/weather_data_policy.md``). It is real
    weather, but it is not site-measured and cannot calibrate or validate the
    model.
    """

    model_config = _MODEL_CONFIG

    classification: Literal["PROVISIONAL_PUBLIC"]
    description: str
    disclaimer: str
    authorized: Literal[True]
    provider: Literal["pvgis"]
    radiation_database: str
    albedo: ParameterWithProvenance

    @field_validator("disclaimer")
    @classmethod
    def _check_disclaimer(cls, v: str) -> str:
        if "NOT SITE-MEASURED" not in v.upper():
            msg = (
                "public weather disclaimer must state 'NOT SITE-MEASURED' so "
                "the data is never mistaken for site measurements"
            )
            raise ValueError(msg)
        return v


class DataSourcesConfig(BaseModel):
    """Weather/data source registry.

    ``synthetic_clearsky`` is always present. ``public_pvgis`` is optional and,
    when present, must carry written project-lead approval recorded in
    ``DATA_REGISTER.md`` per the weather data policy.
    """

    model_config = _MODEL_CONFIG

    synthetic_clearsky: SyntheticClearskyConfig
    public_pvgis: PublicWeatherConfig | None = None


class DataSourcesFile(BaseModel):
    """Top-level wrapper matching config/data_sources.yaml."""

    model_config = _MODEL_CONFIG

    data_sources: DataSourcesConfig
