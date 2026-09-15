"""Block simulation orchestrator and multi-level aggregation.

Runs the full chain for one configurable MV block:

weather -> solar position -> tracker -> front POA -> bifacial -> soiling ->
cell temperature -> string DC -> mismatch/cable allowances -> inverter
(clipping, MPPT, night draw) -> IDT losses -> AC cable -> block output

Aggregation identities (string -> SMB -> inverter -> IDT -> block) hold by
construction for identical strings and are re-verified via the loss ledger.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from pvlib.location import Location

from najm3000 import PHYSICS_BASELINE_LABEL, SYNTHETIC_DISCLAIMER
from najm3000.aggregation.loss_ledger import LossLedger
from najm3000.bifacial.infinite_sheds import calculate_bifacial_irradiance
from najm3000.config.schemas import (
    BlocksConfig,
    EquipmentConfig,
    ProjectConfig,
)
from najm3000.dc_model.pvwatts_dc import (
    calculate_string_dc_power,
    estimate_string_voltage,
)
from najm3000.electrical_losses.ac_cable import apply_ac_cable_loss
from najm3000.electrical_losses.dc_cable import apply_dc_cable_loss
from najm3000.inverter.idt_losses import calculate_idt_losses
from najm3000.inverter.pvwatts_inverter import calculate_inverter_output
from najm3000.soiling.soiling_factor import apply_soiling
from najm3000.temperature.cell_temperature import calculate_cell_temperature
from najm3000.tracking.poa_irradiance import calculate_poa_irradiance
from najm3000.tracking.single_axis import calculate_tracker_orientation
from najm3000.tracking.solar_position import calculate_solar_position
from najm3000.weather.interface import WeatherTimeSeries
from najm3000.weather.provider import WeatherProvider


@dataclass(frozen=True)
class BlockSimulationResult:
    """Time series, loss ledger, and labeling for one block run."""

    block_name: str
    timeseries: pd.DataFrame
    ledger: LossLedger
    metadata: dict[str, str]

    def block_energy_wh(self) -> float:
        """Net block energy [Wh] over the simulated window."""
        dt_hours = _timestep_hours(self.timeseries.index)
        return float(self.timeseries["p_block"].sum() * dt_hours)


def _timestep_hours(index: pd.Index) -> float:
    datetime_index = pd.DatetimeIndex(index)
    if len(datetime_index) < 2:
        msg = "need at least two timesteps"
        raise ValueError(msg)
    delta = datetime_index[1] - datetime_index[0]
    return float(delta.total_seconds()) / 3600.0


def make_location(project: ProjectConfig) -> Location:
    """Build the pvlib Location from validated project configuration."""
    return Location(
        latitude=project.location.latitude.value,
        longitude=project.location.longitude.value,
        tz=project.location.timezone,
        altitude=project.location.altitude.value,
        name=project.location.name,
    )


def run_block_simulation(
    project: ProjectConfig,
    equipment: EquipmentConfig,
    blocks: BlocksConfig,
    weather_provider: WeatherProvider,
    block_name: str,
    day: str,
) -> BlockSimulationResult:
    """Run the full physics chain for one block on one day.

    The weather source is supplied as a provider, so swapping synthetic input
    for a real source requires no change in this module or anything below it.
    """
    if block_name not in blocks.blocks:
        msg = f"unknown block '{block_name}'"
        raise KeyError(msg)
    block = blocks.blocks[block_name]
    module = equipment.pv_modules[block.pv_module]
    inverter = equipment.inverters[block.inverter]
    idt = equipment.idts[block.idt]
    tracker = equipment.trackers[block.tracker]

    location = make_location(project)
    weather: WeatherTimeSeries = weather_provider.fetch(
        location,
        day=day,
        timezone=project.location.timezone,
        timestep_minutes=project.simulation.timestep_minutes,
    )
    times = pd.DatetimeIndex(weather.data.index)
    solar_position = calculate_solar_position(
        location, times, method=project.model_selection.solar_position
    )
    orientation = calculate_tracker_orientation(
        solar_position,
        tracker,
        gcr=block.gcr.value,
        cross_axis_tilt=block.cross_axis_tilt.value,
    )
    poa_front = calculate_poa_irradiance(
        orientation,
        weather,
        solar_position,
        transposition_model=project.model_selection.irradiance_transposition,
        albedo=block.albedo.value,
    )
    bifacial = calculate_bifacial_irradiance(
        orientation, solar_position, weather, block, module, tracker
    )
    effective_irradiance, _soiling_irr_loss = apply_soiling(
        bifacial["poa_global"], block.soiling_factor.value
    )
    temp_cell = calculate_cell_temperature(
        poa_global=bifacial["poa_front"],
        temp_ambient=weather.data["temp_ambient"],
        wind_speed=weather.data["wind_speed"],
    )

    # --- DC chain (identical strings; aggregation by exact multiplication) ---
    p_dc_string = calculate_string_dc_power(
        effective_irradiance, temp_cell, module, block.modules_per_string
    )
    strings_per_inverter = block.strings_per_smb * block.smbs_per_inverter
    p_dc_inverter_gross = p_dc_string * strings_per_inverter

    p_after_mismatch, mismatch_loss = apply_dc_cable_loss(
        p_dc_inverter_gross, block.dc_mismatch_loss_fraction.value
    )
    p_dc_inverter_net, dc_cable_loss = apply_dc_cable_loss(
        p_after_mismatch, block.dc_cable_loss_fraction.value
    )

    string_voltage = estimate_string_voltage(
        temp_cell, module, block.modules_per_string
    )
    inverter_result = calculate_inverter_output(
        p_dc_inverter_net, string_voltage, inverter
    )

    # --- AC chain ---
    p_ac_idt_in = inverter_result.p_ac * block.inverters_per_idt
    idt_result = calculate_idt_losses(p_ac_idt_in, idt)
    p_block_single_idt, ac_cable_loss = apply_ac_cable_loss(
        idt_result.p_out, block.ac_cable_loss_fraction.value
    )
    p_block = p_block_single_idt * block.idts_per_block

    # --- Loss ledger (per block, energy terms) ---
    dt_hours = _timestep_hours(times)
    n_inverters = block.inverters_per_idt * block.idts_per_block

    def energy(series: pd.Series, scale: float = 1.0) -> float:
        return float(series.sum() * dt_hours * scale)

    gross_wh = energy(p_dc_inverter_gross, n_inverters)
    ledger = LossLedger(gross_energy_wh=gross_wh)
    ledger.add("dc_mismatch", energy(mismatch_loss, n_inverters))
    ledger.add("dc_cable", energy(dc_cable_loss, n_inverters))
    ledger.add("mppt_window", energy(inverter_result.mppt_loss, n_inverters))
    usable_dc = p_dc_inverter_net - inverter_result.mppt_loss
    p_ac_day = inverter_result.p_ac.clip(lower=0.0)
    ledger.add("inverter_conversion", energy(usable_dc - p_ac_day, n_inverters))
    ledger.add(
        "inverter_night_consumption",
        energy(inverter_result.night_consumption, n_inverters),
    )
    ledger.add("idt_losses", energy(idt_result.p_loss, block.idts_per_block))
    ledger.add("ac_cable", energy(ac_cable_loss, block.idts_per_block))
    ledger.check_closure(energy(p_block))

    timeseries = pd.DataFrame(
        {
            "ghi": weather.data["ghi"],
            "dni": weather.data["dni"],
            "dhi": weather.data["dhi"],
            "temp_ambient": weather.data["temp_ambient"],
            "wind_speed": weather.data["wind_speed"],
            "poa_front": bifacial["poa_front"],
            "poa_back": bifacial["poa_back"],
            "poa_effective": effective_irradiance,
            "temp_cell": temp_cell,
            "tracker_theta": orientation["tracker_theta"],
            "p_dc_string": p_dc_string,
            "p_dc_inverter": p_dc_inverter_net,
            "p_ac_inverter": inverter_result.p_ac,
            "p_idt_out": idt_result.p_out,
            "p_block": p_block,
            "poa_front_transposition": poa_front["poa_global"],
        }
    )
    metadata = {
        "block": block_name,
        "weather_classification": weather.classification.value,
        "weather_source": weather.source_name,
        "weather_disclaimer": weather.disclaimer,
        "disclaimer": SYNTHETIC_DISCLAIMER,
        "physics_baseline": PHYSICS_BASELINE_LABEL,
        "calibration_status": project.project.calibration_status,
        "validation_status": project.project.validation_status,
        "warning": block.warning,
    }
    return BlockSimulationResult(
        block_name=block_name,
        timeseries=timeseries,
        ledger=ledger,
        metadata=metadata,
    )


def scale_to_plant(
    result: BlockSimulationResult, blocks: BlocksConfig
) -> dict[str, float | str]:
    """Illustrative plant-level scaling — clearly labeled, never a yield claim."""
    scenario = blocks.plant_scaling_scenario
    block_wh = result.block_energy_wh()
    return {
        "label": scenario.label,
        "warning": scenario.warning,
        "representative_block": scenario.representative_block,
        "block_count": float(scenario.block_count),
        "block_energy_wh": block_wh,
        "scaled_plant_energy_wh": block_wh * scenario.block_count,
        "disclaimer": SYNTHETIC_DISCLAIMER,
    }
