"""Run one controller over the event and score it."""

from __future__ import annotations

import math
from dataclasses import dataclass

from raseen.control.allocate import allocate_bgc, allocate_hold, allocate_uniform

#: A set-point drop larger than this share of block capacity in one step, not caused by the
#: block's own sun falling, counts as a "step".
STEP_THRESHOLD = 0.05
#: A block is "already shaded" when this share of its stations is under cover.
SHADED_COVERAGE = 0.95
#: For the hold strategy a block is shaded from the moment the cloud's edge is on its first
#: stations — this share of its cover — so the controller stops taking from it the instant
#: its own sun starts to fall. ``SHADED_COVERAGE`` above is the scoring threshold, where the
#: whole block is under cover; the two answer different questions.
HOLD_SHADED_COVERAGE = 0.02


@dataclass
class SchemeResult:
    P: list[list[float]]     # [k][i]
    POI: list[float]
    R: list[float]           # firm reserve per step: headroom on blocks with ETA > horizon


def firm_reserve(A: list[float], P: list[float], eta: list[float], horizon: float) -> float:
    return sum(max(0.0, a - p) for a, p, e in zip(A, P, eta, strict=True) if e > horizon)


def simulate_scheme(
    scheme: str,
    *,
    times: list[float],
    A: list[list[float]],
    A_tot: list[float],
    floors: list[list[float]],
    etas: list[list[float]],
    caps: list[float],
    P_star: list[float],
    sigma: float,
    delta: float,
    horizon: float,
    slew_pct_min: float,
    ppc_delay_steps: int = 1,
    release_from: int | None = None,
    A_nowcast: list[list[float]] | None = None,
    coverage: list[list[float]] | None = None,
) -> SchemeResult:
    """Run one scheme over the event: ``base`` (no control), ``uni`` (one plant-level
    set-point spread in proportion), ``bgc`` (block allocation along the declared line),
    ``hold`` (every block held down evenly ahead of the front, and the blocks still in sun
    giving back what they were holding when the cloud lands).

    ``A`` is the true per-block available power: it caps every set-point and is what the
    plant measures at the current step. The BGC look-ahead over the next ``horizon``
    minutes reads ``A_nowcast`` instead, the field the operator believes at that moment,
    so the controller never sees a stall or a deepening before its nowcast does. It
    defaults to ``A`` (a perfect nowcast, the abstract fixture's case); a scenario runner
    that keeps a separate planned field should pass that field here.

    The hold scheme needs to know which blocks are shaded. A block is shaded when its
    measured ``coverage`` is above ``HOLD_SHADED_COVERAGE`` or its planned arrival time has
    passed (``etas[k][i] <= 0``); with ``coverage=None`` only the arrival test is used. The
    firm reserve ``R`` is scored the same way for every scheme: headroom on the blocks with
    an arrival beyond the horizon, which for the hold scheme is the backfill the plant can
    still call on.
    """
    dt = times[1] - times[0]
    slew_lim = [c * slew_pct_min / 100.0 * dt for c in caps]
    ahead = max(1, int(round(horizon / dt)))   # look-ahead steps along the declared line
    believed = A if A_nowcast is None else A_nowcast
    P: list[list[float]] = []
    prev = list(A[0])
    for k, _t in enumerate(times):
        if scheme == "base":
            p = list(A[k])
        elif scheme == "uni":
            kk = max(0, k - ppc_delay_steps)
            frac = P_star[kk] / A_tot[kk] if A_tot[kk] > 0 else 0.0
            p = allocate_uniform(A[k], frac)
        elif scheme == "bgc":
            release = release_from is not None and k >= release_from
            p = allocate_bgc(
                A[k], floors[k], etas[k], caps, P_star[k],
                delta=delta, horizon=horizon, sigma=sigma, slew_lim=slew_lim, prev=prev,
                release=release,
                targets_ahead=P_star[k + 1 : k + 1 + ahead],
                A_ahead=believed[k + 1 : k + 1 + ahead],
            )
        elif scheme == "hold":
            shaded = [
                etas[k][i] <= 0.0
                or (coverage is not None and coverage[k][i] > HOLD_SHADED_COVERAGE)
                for i in range(len(caps))
            ]
            p = allocate_hold(
                A[k], caps, P_star[k], slew_lim=slew_lim, prev=prev, shaded=shaded
            )
        else:
            raise ValueError(f"unknown scheme {scheme!r}")
        P.append(p)
        prev = p
    POI = [sum(p) for p in P]
    R = [firm_reserve(A[k], P[k], etas[k], horizon) for k in range(len(times))]
    return SchemeResult(P=P, POI=POI, R=R)


def metrics(
    *,
    times: list[float],
    A_tot: list[float],
    POI: list[float],
    P: list[list[float]],
    A: list[list[float]],
    etas: list[list[float]],
    caps: list[float],
    coverage: list[list[float]],
    plant_mw: float,
    horizon: float,
    g_declared: float,
    P_star: list[float],
) -> dict[str, float | int]:
    n_steps = len(times)
    dt = times[1] - times[0]
    k_min = min(range(n_steps), key=lambda k: (A_tot[k], k))
    spill_down = spill_up = spill_before = 0.0
    for k in range(n_steps):
        s = (A_tot[k] - POI[k]) * dt / 60.0
        if s > 0:
            if k < k_min:
                spill_down += s
            else:
                spill_up += s
            if times[k] < 0:
                spill_before += s
    steps10 = int(round(10.0 / dt))
    max_drop10 = max((POI[k - steps10] - POI[k] for k in range(steps10, n_steps)), default=0.0)
    max_grad = max(((POI[k - 1] - POI[k]) / dt for k in range(1, n_steps)), default=0.0)
    max_up = max(((POI[k] - POI[k - 1]) / dt for k in range(1, n_steps)), default=0.0)
    lead = 0.0
    for k in range(n_steps):
        if A_tot[k] - POI[k] > 1e-3:
            lead = -times[k] if times[k] < 0 else 0.0
            break
    k0 = min(range(n_steps), key=lambda k: abs(times[k]))
    firm_at_contact = firm_reserve(A[k0], P[k0], etas[k0], horizon)
    shaded_curtailment = 0.0
    for k in range(n_steps):
        for i in range(len(caps)):
            if coverage[k][i] > SHADED_COVERAGE:
                shaded_curtailment += max(0.0, A[k][i] - P[k][i]) * dt / 60.0
    stepped = 0
    for i, cap in enumerate(caps):
        for k in range(1, n_steps):
            if A[k][i] < A[k - 1][i] - 0.05:      # the sun fell on this block: forced, not a step
                continue
            if P[k - 1][i] - P[k][i] > STEP_THRESHOLD * cap and P[k][i] < A[k][i] - 0.5:
                stepped += 1
                break
    tracking = 0.0
    for k in range(n_steps):
        if P_star[k] < plant_mw - 1.0:
            tracking = max(tracking, abs(POI[k] - P_star[k]) / plant_mw * 100.0)
    return {
        "spill_mwh": round(spill_down + spill_up, 1),
        "spill_down_mwh": round(spill_down, 1),
        "spill_up_mwh": round(spill_up, 1),
        "spill_before_contact_mwh": round(spill_before, 1),
        "max_drop10_mw": round(max_drop10, 1),
        "max_grad_mw_min": round(max_grad, 1),
        "max_up_mw_min": round(max_up, 1),
        "grad_ratio": round(max_grad / g_declared, 3) if g_declared else 0.0,
        "lead_min": round(lead, 1),
        "firm_at_contact_mw": round(firm_at_contact, 1),
        "shaded_curtailment_mwh": round(shaded_curtailment, 1),
        "blocks_stepped": stepped,
        "tracking_error_pct": round(tracking, 2),
    }


def is_finite(x: float) -> bool:
    return math.isfinite(x)
