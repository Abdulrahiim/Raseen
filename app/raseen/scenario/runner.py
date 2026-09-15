"""Run a scenario on the real plant geometry.

A cloud crosses the 363-MVPS plant. Each 10-second frame carries, per control block, the
available power, the set-point under three controllers (uncontrolled, plant-level, Raseen),
the cloud arrival time, the cover fraction and the cloud outline. The Gradient Control page
replays these frames on the satellite map and the power chart.
"""

from __future__ import annotations

import math
from typing import Any

from raseen.control.planner import apply_release, plan_trajectory
from raseen.control.simulate import metrics, simulate_scheme
from raseen.geometry.blocks import blocks_payload, get_blocks, mvps_block_index
from raseen.geometry.site import MVPS_MW, get_site
from raseen.scenario.economics import economics
from raseen.scenario.params import ScenarioParams
from raseen.shadow.fields import build_field, cloud_polygons

PLANT_MW = 3000.0
T_START = -40.0
T_END = 100.0
DT_MIN = 1.0 / 6.0
#: The nowcast declares a stall this long after the field stops moving.
DETECT_DELAY_MIN = 2.0
#: Inverter apparent-power rating relative to block active rating.
S_RATING_FACTOR = 1.10

CLASSIFICATION = "SIMULATION (RASEEN PROTOTYPE)"
DISCLAIMER = (
    "SIMULATED — NOT MEASURED DATA. Plant geometry is as-designed, not as-built. "
    "The controller is real code; telemetry, forecast and grid interfaces are simulated. "
    "NOT CALIBRATED — NOT VALIDATED."
)
PROVENANCE = {
    "geometry": "as-designed CAD/KML (NAJM-3000), not as-built",
    "irradiance": "representative clear-day available power × geometric shadow field",
    "controller": "real code (raseen.control), executed on simulated inputs",
    "telemetry": "simulated from the shadow field; no SCADA connected",
    "nowcast": "ground-truth arrival times from the shadow generator, not an estimate",
}


def _times() -> list[float]:
    n = int(round((T_END - T_START) / DT_MIN)) + 1
    return [round(T_START + k * DT_MIN, 6) for k in range(n)]


def _r1(x: float) -> float:
    return round(x, 1)


def run_scenario(params: ScenarioParams) -> dict[str, Any]:
    site = get_site()
    blocks = get_blocks(site)
    n = len(blocks)
    caps = [b.capacity_mw for b in blocks]
    members = [list(b.mvps_index) for b in blocks]
    horizon = params.horizon_min

    common = dict(
        event=params.event, heading_deg=params.heading_deg, speed_kmh=params.speed_kmh,
        depth=params.depth, plateau_min=params.plateau_min, seed=params.seed,
        cover_frac=params.cover_frac, cover_offset=params.cover_offset,
        softness=params.softness,
    )
    actual = build_field(
        site, stall_at=params.stall_at_min, deepen_at=params.deepen_at_min,
        deepen_factor=params.deepen_factor, **common,
    )
    planned = build_field(site, **common)

    times = _times()
    A: list[list[float]] = []          # true per-block available power (with stall/deepen)
    A_nowcast: list[list[float]] = []  # what the operator believes (planned field)
    cov: list[list[float]] = []
    floors: list[list[float]] = []
    etas: list[list[float]] = []
    A_tot_planned: list[float] = []
    clouds: list[list[list[list[float]]]] = []
    for t in times:
        cov_m = actual.coverage(t)
        d_t = actual.depth_at(t)
        a_mvps = [MVPS_MW * (1.0 - d_t * c) for c in cov_m]
        cov_p = planned.coverage(t)
        an_mvps = [MVPS_MW * (1.0 - params.depth * c) for c in cov_p]
        eta_m = planned.eta_planned(t)
        A.append([sum(a_mvps[m] for m in idx) for idx in members])
        A_nowcast.append([sum(an_mvps[m] for m in idx) for idx in members])
        A_tot_planned.append(sum(an_mvps))
        cov.append([sum(cov_m[m] for m in idx) / len(idx) for idx in members])
        floors.append([c * (1.0 - d_t) for c in caps])
        etas.append([min(eta_m[m] for m in idx) for idx in members])
        clouds.append(cloud_polygons(actual, site, t))
    A_tot = [sum(row) for row in A]

    plan = plan_trajectory(
        times, A_tot_planned, PLANT_MW, g=params.g_mw_min, flat=params.flat,
        confidence=params.confidence, kappa=params.kappa,
        reserve_override=params.reserve_mw, horizon=horizon,
    )
    P_star = list(plan.P_star)
    release_from: int | None = None
    detect_at: float | None = None
    etas_now = etas
    if params.stall_at_min is not None:
        detect_at = params.stall_at_min + DETECT_DELAY_MIN
        release_from = next(
            (k for k, t in enumerate(times) if t >= detect_at - 1e-9), len(times) - 1
        )
        P_star = apply_release(P_star, A_tot, times, release_from, plan.g_up)
        etas_now = [row if k < release_from else [float("inf")] * n for k, row in enumerate(etas)]
    P_star = [min(P_star[k], A_tot[k]) for k in range(len(times))]

    kw = dict(
        times=times, A=A, A_tot=A_tot, floors=floors, etas=etas_now, caps=caps, P_star=P_star,
        sigma=params.sigma_min, delta=plan.delta, horizon=horizon,
        slew_pct_min=params.slew_pct_min, ppc_delay_steps=params.ppc_delay_steps,
        release_from=release_from, A_nowcast=A_nowcast,
    )
    results = {s: simulate_scheme(s, **kw) for s in ("base", "uni", "bgc")}
    kpis = {
        s: metrics(
            times=times, A_tot=A_tot, POI=r.POI, P=r.P, A=A, etas=etas_now, caps=caps,
            coverage=cov, plant_mw=PLANT_MW, horizon=horizon, g_declared=params.g_mw_min,
            P_star=P_star,
        )
        for s, r in results.items()
    }

    k_min = plan.k_min
    frames = []
    for k, t in enumerate(times):
        if release_from is not None and k >= release_from:
            phase = "released"
        elif t < 0:
            phase = "before"
        elif A_tot[k] > plan.A_min + 1.0 and k < k_min:
            phase = "transit"
        elif A_tot[k] <= plan.A_min + 1.0:
            phase = "cover"
        elif A_tot[k] < PLANT_MW - 1.0:
            phase = "exit"
        else:
            phase = "after"
        eta_row = etas_now[k]
        frames.append({
            "t": round(t, 4),
            "phase": phase,
            "A": [_r1(x) for x in A[k]],
            "P_bgc": [_r1(x) for x in results["bgc"].P[k]],
            "P_uni": [_r1(x) for x in results["uni"].P[k]],
            "P_base": [_r1(x) for x in results["base"].P[k]],
            "eta": [None if not math.isfinite(e) else round(e, 2) for e in eta_row],
            "coverage": [round(c, 2) for c in cov[k]],
            "firm": [bool(e > horizon) for e in eta_row],
            "cloud": clouds[k],
            "agg": {
                "A": _r1(A_tot[k]),
                "P_base": _r1(results["base"].POI[k]),
                "P_uni": _r1(results["uni"].POI[k]),
                "P_bgc": _r1(results["bgc"].POI[k]),
                "P_star": _r1(P_star[k]),
                "R": _r1(results["bgc"].R[k]),
                "residual": _r1(max(0.0, PLANT_MW - A_tot[k])),
            },
        })

    front = {
        "event": params.event, "heading_deg": params.heading_deg, "speed_kmh": params.speed_kmh,
        "tau_min": round(actual.tau_min, 2), "depth": params.depth, "D_mw": _r1(plan.D),
        "L_min": round(plan.L, 2), "g_mw_min": params.g_mw_min, "g_up_mw_min": plan.g_up,
        "delta_mw": _r1(plan.delta), "horizon_min": horizon, "confidence": params.confidence,
        "plateau_min": params.plateau_min, "t_desc_start_min": round(plan.t_desc_start, 2),
        "t_min_min": round(plan.t_min, 2), "t_rise_min": round(plan.t_rise, 2),
        "lead_shortfall_min": round(plan.lead_shortfall, 2), "stall_at_min": params.stall_at_min,
        "deepen_at_min": params.deepen_at_min, "detect_at_min": detect_at,
        "A_min_mw": _r1(plan.A_min),
    }
    return {
        "scenario_id": params.scenario_id(),
        "params": params.model_dump(),
        "geometry": {
            "blocks": blocks_payload(blocks),
            "mvps_block_index": mvps_block_index(site, blocks),
        },
        "front": front,
        "times_min": [round(t, 4) for t in times],
        "frames": frames,
        "kpis": kpis,
        "economics": economics(kpis["bgc"]["spill_mwh"], params.g_mw_min, PLANT_MW),
        "provenance": PROVENANCE,
        "classification": CLASSIFICATION,
        "disclaimer": DISCLAIMER,
        "is_live": False,
    }
