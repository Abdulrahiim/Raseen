"""Inverter-duty transformer losses (two-component model).

``P_loss(t) = P_no_load + P_load_rated * (P_ac(t) / P_rated)^2``

Loss constants come from validated configuration (GAP-006 resolved with
Provisional GTP values). Losses are non-negative by construction and bounded
by the configured rated values.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from najm3000.config.schemas import IDTConfig


@dataclass(frozen=True)
class IDTResult:
    """IDT output and loss series."""

    p_out: pd.Series
    p_loss: pd.Series


def calculate_idt_losses(p_ac_in: pd.Series, idt: IDTConfig) -> IDTResult:
    """Apply transformer losses to the summed inverter AC input [W].

    The transformer is assumed energized at all timesteps, so no-load losses
    apply continuously; output can therefore be negative at night (station
    consumption), which is physical and reported, not hidden.
    """
    p_rated_w = idt.rated_power_mva * 1e6
    load_fraction = (p_ac_in.clip(lower=0.0) / p_rated_w).clip(lower=0.0)
    p_loss = idt.p_no_load.value + idt.p_load_rated.value * load_fraction**2
    p_loss_series = pd.Series(p_loss, index=p_ac_in.index, name="idt_loss")
    if bool((p_loss_series < 0.0).any()):
        msg = "IDT losses must be non-negative"
        raise RuntimeError(msg)
    max_loss = idt.p_no_load.value + idt.p_load_rated.value * 1.44
    if bool((p_loss_series > max_loss + 1e-6).any()):
        msg = "IDT losses exceeded plausible bound (120% loading)"
        raise RuntimeError(msg)
    p_out = (p_ac_in - p_loss_series).rename("p_idt_out")
    return IDTResult(p_out=p_out, p_loss=p_loss_series)
