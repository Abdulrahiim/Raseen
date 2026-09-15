"""AC cable loss as a configured design allowance (ASMP-008)."""

from __future__ import annotations

import pandas as pd


def apply_ac_cable_loss(
    p_ac: pd.Series, loss_fraction: float
) -> tuple[pd.Series, pd.Series]:
    """Return (power after loss, loss series) for the AC cable allowance.

    The allowance applies to positive (generating) power only; night auxiliary
    draw is not scaled.
    """
    if not 0.0 <= loss_fraction < 1.0:
        msg = f"ac cable loss fraction {loss_fraction} outside [0, 1)"
        raise ValueError(msg)
    loss = (p_ac.clip(lower=0.0) * loss_fraction).rename("ac_cable_loss")
    net: pd.Series = p_ac - loss
    net.name = p_ac.name
    return net, loss
