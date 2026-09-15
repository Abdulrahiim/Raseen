"""Physical sanity checks applied to simulation results.

These enforce physics invariants — they never compare against hard-coded
expected energy values.
"""

from __future__ import annotations

import pandas as pd

from najm3000.aggregation.aggregator import BlockSimulationResult


class SanityCheckError(Exception):
    """Raised when a physical sanity check fails."""


def _fail(message: str) -> None:
    raise SanityCheckError(message)


def check_no_negative_dc(result: BlockSimulationResult) -> None:
    """DC power must be non-negative at all timesteps."""
    if bool((result.timeseries["p_dc_string"] < 0.0).any()):
        _fail("negative DC power found")


def check_night_generation(
    result: BlockSimulationResult, solar_elevation: pd.Series
) -> None:
    """AC generation must be zero at night (auxiliary draw is negative)."""
    night = solar_elevation < 0.0
    night_ac = result.timeseries.loc[night, "p_ac_inverter"]
    if bool((night_ac > 0.0).any()):
        _fail("positive AC generation at night")


def check_dc_ge_ac(result: BlockSimulationResult) -> None:
    """Energy conservation: DC input >= AC output whenever generating."""
    ts = result.timeseries
    generating = ts["p_ac_inverter"] > 0.0
    if bool(
        (ts.loc[generating, "p_ac_inverter"]
         > ts.loc[generating, "p_dc_inverter"] + 1e-6).any()
    ):
        _fail("AC output exceeds DC input")


def check_bifacial_gain(result: BlockSimulationResult) -> None:
    """Rear-side irradiance must be non-negative (bifacial gain >= 0)."""
    if bool((result.timeseries["poa_back"] < 0.0).any()):
        _fail("negative rear-side irradiance")


def check_cell_temperature_bounds(result: BlockSimulationResult) -> None:
    """Cell temperature within [-30, +100] degC."""
    temp = result.timeseries["temp_cell"]
    if bool((temp < -30.0).any()) or bool((temp > 100.0).any()):
        _fail("cell temperature outside [-30, 100] degC")


def run_all_checks(
    result: BlockSimulationResult, solar_elevation: pd.Series
) -> None:
    """Run the full sanity check suite; raises on first failure."""
    check_no_negative_dc(result)
    check_night_generation(result, solar_elevation)
    check_dc_ge_ac(result)
    check_bifacial_gain(result)
    check_cell_temperature_bounds(result)
