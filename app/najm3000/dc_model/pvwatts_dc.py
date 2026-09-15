"""PVWatts DC power model wrapper.

PVWatts is the interim POC model (see ADR-001). It must never be used for
bankable yield assessment. Upgrade path: CEC single-diode once full parameter
sets are confirmed (GAP-004).
"""

from __future__ import annotations

import pandas as pd
from pvlib import pvsystem

from najm3000.config.schemas import PVModuleConfig


def calculate_string_dc_power(
    effective_irradiance: pd.Series,
    cell_temperature: pd.Series,
    module: PVModuleConfig,
    modules_per_string: int,
) -> pd.Series:
    """DC power [W] of one string of series-connected modules.

    ``effective_irradiance`` is POA (front, or bifacial-effective) after
    optical losses such as soiling, in W/m2.
    """
    if modules_per_string <= 0:
        msg = f"modules_per_string must be positive, got {modules_per_string}"
        raise ValueError(msg)
    string_pdc0 = module.pdc_stc.value * modules_per_string
    dc_power: pd.Series = pvsystem.pvwatts_dc(
        effective_irradiance=effective_irradiance,
        temp_cell=cell_temperature,
        pdc0=string_pdc0,
        gamma_pdc=module.gamma_pdc.value,
        temp_ref=25.0,
    )
    dc_power = dc_power.clip(lower=0.0)
    return dc_power.rename("p_dc_string")


def estimate_string_voltage(
    cell_temperature: pd.Series,
    module: PVModuleConfig,
    modules_per_string: int,
) -> pd.Series:
    """Approximate string MPP voltage [V] from Vmp,STC and its temperature
    coefficient. Used only for MPPT-window enforcement in the POC."""
    v_mp: pd.Series = module.v_mp_stc.value * (
        1.0 + module.beta_voc.value * (cell_temperature - 25.0)
    )
    voltage: pd.Series = v_mp * modules_per_string
    voltage.name = "v_string"
    return voltage
