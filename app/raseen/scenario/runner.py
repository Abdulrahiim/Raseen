"""Run a scenario on the real plant geometry.

A cloud crosses the 363-MVPS plant. Each 10-second frame carries, per control block, the
available power, the set-point under four rules (uncontrolled, plant-level, and Raseen's two
strategies: the declared ramp and the pre-hold and backfill), the cloud arrival time, the
cover fraction and the cloud outline. The Gradient Control page replays these frames on the
satellite map and the power chart.
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

#: Bumped whenever the controller or the shadow model changes what a scenario computes.
#: It is part of the cache key, so an engine change invalidates every stored scenario rather
#: than silently serving numbers the current code would never produce. "r2" was the move to
#: placing curtailment farthest-arrival first (see raseen.control.allocate). "r3" adds the
#: pre-hold and backfill strategy: every frame now carries ``P_hold`` and the front carries
#: the hold numbers, and an r2 file has neither, so the page would have nothing to draw for
#: that strategy.
ENGINE_REVISION = "r3"

PLANT_MW = 3000.0
T_START = -40.0
T_END = 100.0
DT_MIN = 1.0 / 6.0
#: The nowcast declares a stall this long after the field stops moving.
DETECT_DELAY_MIN = 2.0
#: Inverter apparent-power rating relative to block active rating.
S_RATING_FACTOR = 1.10
#: A block or station counts as *reached* by the front when the planned cover on it ever
#: exceeds this share. An edge that only brushes a corner is not a block the cloud reaches,
#: and the briefing's "reaches N of 30 blocks" must not count it.
REACHED_COVERAGE = 0.5

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
    # The deepest planned cover each block and each station ever sees, for the honest count
    # of what the front reaches. Running maxima, so the per-station field is never kept.
    reach_block = [0.0] * n
    reach_station = [0.0] * len(site.mvps)
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
        for m, c in enumerate(cov_p):
            if c > reach_station[m]:
                reach_station[m] = c
        for i, idx in enumerate(members):
            c = sum(cov_p[m] for m in idx) / len(idx)
            if c > reach_block[i]:
                reach_block[i] = c
    A_tot = [sum(row) for row in A]

    plan = plan_trajectory(
        times, A_tot_planned, PLANT_MW, g=params.g_mw_min, flat=params.flat,
        confidence=params.confidence, kappa=params.kappa,
        reserve_override=params.reserve_mw, horizon=horizon,
    )
    # The second strategy plans against the same planned field, always flat: the plant is
    # held the reserve slice below the transit minimum, so the margin the ramp keeps as
    # headroom on the far blocks is here taken off every block evenly, ahead of the front.
    plan_h = plan_trajectory(
        times, A_tot_planned, PLANT_MW, g=params.g_mw_min, flat=True, hold_margin=plan.delta,
        confidence=params.confidence, kappa=params.kappa,
        reserve_override=params.reserve_mw, horizon=horizon,
    )
    P_star = list(plan.P_star)
    P_star_hold = list(plan_h.P_star)
    release_from: int | None = None
    detect_at: float | None = None
    etas_now = etas
    if params.stall_at_min is not None:
        detect_at = params.stall_at_min + DETECT_DELAY_MIN
        release_from = next(
            (k for k, t in enumerate(times) if t >= detect_at - 1e-9), len(times) - 1
        )
        P_star = apply_release(P_star, A_tot, times, release_from, plan.g_up)
        P_star_hold = apply_release(P_star_hold, A_tot, times, release_from, plan_h.g_up)
        etas_now = [row if k < release_from else [float("inf")] * n for k, row in enumerate(etas)]
    P_star = [min(P_star[k], A_tot[k]) for k in range(len(times))]
    P_star_hold = [min(P_star_hold[k], A_tot[k]) for k in range(len(times))]

    kw = dict(
        times=times, A=A, A_tot=A_tot, floors=floors, etas=etas_now, caps=caps, P_star=P_star,
        sigma=params.sigma_min, delta=plan.delta, horizon=horizon,
        slew_pct_min=params.slew_pct_min, ppc_delay_steps=params.ppc_delay_steps,
        release_from=release_from, A_nowcast=A_nowcast,
    )
    results = {s: simulate_scheme(s, **kw) for s in ("base", "uni", "bgc")}
    # The hold scheme follows its own line, and reads the measured cover so a block counts
    # as shaded from the moment the cloud's edge is on it, not only from its planned arrival.
    results["hold"] = simulate_scheme("hold", **{**kw, "P_star": P_star_hold, "coverage": cov})
    declared = {s: (P_star_hold if s == "hold" else P_star) for s in results}
    kpis = {
        s: metrics(
            times=times, A_tot=A_tot, POI=r.POI, P=r.P, A=A, etas=etas_now, caps=caps,
            coverage=cov, plant_mw=PLANT_MW, horizon=horizon, g_declared=params.g_mw_min,
            P_star=declared[s],
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
            "P_hold": [_r1(x) for x in results["hold"].P[k]],
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
                "P_hold": _r1(results["hold"].POI[k]),
                "P_star": _r1(P_star[k]),
                "P_star_hold": _r1(P_star_hold[k]),
                "R": _r1(results["bgc"].R[k]),
                "R_hold": _r1(results["hold"].R[k]),
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
    # The hold strategy's numbers, and what the front reaches, all from the planned field —
    # the briefing quotes a forecast, so it must quote what the forecast said, not the truth.
    shaded_planned = [k for k in range(len(times)) if A_tot_planned[k] < PLANT_MW - 1e-6]
    k_first, k_last = (
        (shaded_planned[0], shaded_planned[-1]) if shaded_planned else (plan_h.k_min, plan_h.k_min)
    )
    reached = [i for i in range(n) if reach_block[i] > REACHED_COVERAGE]
    by_arrival = sorted(reached, key=lambda i: (etas[0][i], i))
    front.update({
        "hold_mw": _r1(plan_h.hold_mw), "hold_margin_mw": _r1(plan.delta),
        "t_hold_start_min": round(plan_h.t_desc_start, 2),
        "t_first_min": round(times[k_first], 2), "t_last_min": round(times[k_last], 2),
        "blocks_reached": len(reached),
        "stations_reached": sum(1 for c in reach_station if c > REACHED_COVERAGE),
        "first_block": blocks[by_arrival[0]].id if by_arrival else None,
        "last_block": blocks[by_arrival[-1]].id if by_arrival else None,
    })
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
