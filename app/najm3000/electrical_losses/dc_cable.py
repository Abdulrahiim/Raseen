"""DC cable loss as a configured design allowance (ASMP-007)."""

from __future__ import annotations

import pandas as pd


def apply_dc_cable_loss(
    p_dc: pd.Series, loss_fraction: float
) -> tuple[pd.Series, pd.Series]:
    """Return (power after loss, loss series) for the DC cable allowance."""
    if not 0.0 <= loss_fraction < 1.0:
        msg = f"dc cable loss fraction {loss_fraction} outside [0, 1)"
        raise ValueError(msg)
    loss = (p_dc.clip(lower=0.0) * loss_fraction).rename("dc_cable_loss")
    net: pd.Series = p_dc - loss
    net.name = p_dc.name
    return net, loss
