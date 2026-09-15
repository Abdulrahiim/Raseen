"""Constant soiling factor placeholder (ASMP-006).

No cleaning schedule or soiling measurement exists; the constant factor is an
assumption and every application emits an explicit provenance warning.
"""

from __future__ import annotations

import logging

import pandas as pd

logger = logging.getLogger(__name__)


def apply_soiling(
    irradiance: pd.Series, soiling_factor: float
) -> tuple[pd.Series, pd.Series]:
    """Scale irradiance by the soiling factor; return (effective, loss).

    ``soiling_factor`` is the transmission fraction (1 - soiling loss).
    """
    if not 0.0 < soiling_factor <= 1.0:
        msg = f"soiling factor {soiling_factor} outside (0, 1]"
        raise ValueError(msg)
    logger.warning(
        "Soiling factor %.3f is ASSUMED (ASMP-006) — no site soiling data",
        soiling_factor,
    )
    effective: pd.Series = irradiance * soiling_factor
    effective.name = irradiance.name
    loss = (irradiance - effective).rename("soiling_loss_irradiance")
    return effective, loss
