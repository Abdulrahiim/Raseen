"""PVWatts inverter model with clipping, MPPT window, and night consumption.

Explicit behaviours required by the modeling methodology:

* AC output is hard-limited at ``paco`` (clipping — inherent in PVWatts).
* DC input at string voltages outside the MPPT window produces zero output.
* At night the inverter draws its configured auxiliary power (negative AC).
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from pvlib import inverter as pvlib_inverter

from najm3000.config.schemas import InverterConfig


@dataclass(frozen=True)
class InverterResult:
    """AC output plus bookkeeping series for the loss ledger."""

    p_ac: pd.Series
    p_dc_input: pd.Series
    clipping_loss: pd.Series
    mppt_loss: pd.Series
    night_consumption: pd.Series


def calculate_inverter_output(
    p_dc: pd.Series,
    string_voltage: pd.Series,
    config: InverterConfig,
) -> InverterResult:
    """Convert aggregated DC input [W] to AC output [W] for one inverter."""
    mppt_ok = (string_voltage >= config.mppt_low.value) & (
        string_voltage <= config.mppt_high.value
    )
    daytime = p_dc > 0.0
    usable_dc = p_dc.where(mppt_ok | ~daytime, other=0.0)
    mppt_loss = (p_dc - usable_dc).clip(lower=0.0).rename("mppt_loss")

    pdc0 = config.pdc0()
    p_ac: pd.Series = pvlib_inverter.pvwatts(
        pdc=usable_dc,
        pdc0=pdc0,
        eta_inv_nom=config.eta_inv_nom.value,
    )
    # Below-startup DC can yield small negative AC in the PVWatts curve;
    # a real inverter does not generate there — clamp to zero (day) and let
    # the explicit night draw handle standby consumption.
    p_ac = p_ac.clip(lower=0.0, upper=config.paco.value)

    # Ideal (unclipped) conversion at nominal efficiency for clipping ledger.
    ideal_ac = usable_dc * config.eta_inv_nom.value
    clipping_loss = (
        (ideal_ac - p_ac).where(ideal_ac > config.paco.value, other=0.0)
    ).clip(lower=0.0).rename("clipping_loss")

    night = usable_dc <= 0.0
    night_draw = pd.Series(0.0, index=p_dc.index, name="night_consumption")
    night_draw.loc[night] = config.night_power.value
    p_ac = p_ac.where(~night, other=-config.night_power.value)

    if bool((p_ac > config.paco.value + 1e-6).any()):
        msg = "inverter AC output exceeded rated paco after clipping"
        raise RuntimeError(msg)

    return InverterResult(
        p_ac=p_ac.rename("p_ac"),
        p_dc_input=p_dc.rename("p_dc_input"),
        clipping_loss=clipping_loss,
        mppt_loss=mppt_loss,
        night_consumption=night_draw,
    )
