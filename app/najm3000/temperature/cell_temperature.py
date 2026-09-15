"""Cell temperature model wrapper (pvlib PVsyst model).

The PVsyst heat-loss coefficients are not available from the audited module
datasheets, so the pvlib defaults for open-rack glass/glass modules are used
and explicitly labeled as assumed (see ASSUMPTIONS_REGISTER).
"""

from __future__ import annotations

import pandas as pd
from pvlib import temperature

#: pvlib default PVsyst coefficients — ASSUMED (not from a datasheet).
DEFAULT_U_C = 29.0
DEFAULT_U_V = 0.0

#: Physical plausibility bounds for cell temperature [degC].
CELL_TEMP_MIN = -30.0
CELL_TEMP_MAX = 100.0


class CellTemperatureError(Exception):
    """Raised when computed cell temperatures leave the physical range."""


def calculate_cell_temperature(
    poa_global: pd.Series,
    temp_ambient: pd.Series,
    wind_speed: pd.Series,
    u_c: float = DEFAULT_U_C,
    u_v: float = DEFAULT_U_V,
) -> pd.Series:
    """Compute cell temperature [degC] with the PVsyst model."""
    cell_temp: pd.Series = temperature.pvsyst_cell(
        poa_global=poa_global,
        temp_air=temp_ambient,
        wind_speed=wind_speed,
        u_c=u_c,
        u_v=u_v,
    )
    if bool((cell_temp < CELL_TEMP_MIN).any()) or bool(
        (cell_temp > CELL_TEMP_MAX).any()
    ):
        msg = (
            f"cell temperature outside plausible range "
            f"[{CELL_TEMP_MIN}, {CELL_TEMP_MAX}] degC"
        )
        raise CellTemperatureError(msg)
    return cell_temp.rename("temp_cell")
