"""The abstract reference plant: 30 × 100 MW blocks, 10 columns west→east × 3 rows.

Kept as a fixture so the controller port is checked against the published D1 table.
Also usable as a demonstration plant without geometry.
"""

from __future__ import annotations

from raseen.control.planner import Plan, plan_trajectory
from raseen.control.simulate import SchemeResult, metrics, simulate_scheme

NCOL, NROW = 10, 3
BLOCK_MW = 100.0
NB = NCOL * NROW
PLANT = NB * BLOCK_MW
COL_M = 800.0
SPEED_M_MIN = 800.0
DEPTH = 0.60
TAU = NCOL * COL_M / SPEED_M_MIN     # 10 min
PLATEAU = 40.0
DT = 10.0 / 60.0
T_START, T_END = -40.0, 100.0


def _shade(col: int, t: float, band_cols: int | None) -> float:
    x0 = col * COL_M
    x1 = x0 + COL_M
    lead = SPEED_M_MIN * t
    trail = lead - (SPEED_M_MIN * (TAU + PLATEAU) if band_cols is None else band_cols * COL_M)
    return max(0.0, min(x1, lead) - max(x0, trail)) / COL_M


def abstract_arrays(band_cols: int | None = None) -> dict:
    times = []
    t = T_START
    while t <= T_END + 1e-9:
        times.append(round(t, 6))
        t += DT
    A, cov, etas = [], [], []
    for tt in times:
        a_row, c_row, e_row = [], [], []
        for i in range(NB):
            col = i % NCOL
            f = _shade(col, tt, band_cols)
            a_row.append(BLOCK_MW * (1.0 - DEPTH * f))
            c_row.append(f)
            e_row.append((col * COL_M - SPEED_M_MIN * tt) / SPEED_M_MIN)
        A.append(a_row)
        cov.append(c_row)
        etas.append(e_row)
    return {
        "times": times,
        "A": A,
        "A_tot": [sum(r) for r in A],
        "floors": [[BLOCK_MW * (1.0 - DEPTH)] * NB for _ in times],
        "etas": etas,
        "caps": [BLOCK_MW] * NB,
        "coverage": cov,
    }


def abstract_case(
    scheme: str,
    g: float,
    reserve: float = 150.0,
    flat: bool = False,
    band_cols: int | None = None,
    ppc_delay_steps: int = 0,
) -> tuple[Plan, SchemeResult, dict]:
    arrays = abstract_arrays(band_cols)
    if scheme == "base":
        plan = plan_trajectory(
            arrays["times"], arrays["A_tot"], PLANT, g=g, flat=flat, reserve_override=0.0
        )
        plan.P_star = list(arrays["A_tot"])
    else:
        plan = plan_trajectory(
            arrays["times"], arrays["A_tot"], PLANT, g=g, flat=flat,
            reserve_override=(reserve if scheme == "bgc" else 0.0),
        )
    result = simulate_scheme(
        scheme, times=arrays["times"], A=arrays["A"], A_tot=arrays["A_tot"],
        floors=arrays["floors"], etas=arrays["etas"], caps=arrays["caps"], P_star=plan.P_star,
        sigma=3.0, delta=plan.delta, horizon=5.0, slew_pct_min=10.0,
        ppc_delay_steps=ppc_delay_steps,
    )
    m = metrics(
        times=arrays["times"], A_tot=arrays["A_tot"], POI=result.POI, P=result.P, A=arrays["A"],
        etas=arrays["etas"], caps=arrays["caps"], coverage=arrays["coverage"], plant_mw=PLANT,
        horizon=5.0, g_declared=g, P_star=plan.P_star,
    )
    return plan, result, m
