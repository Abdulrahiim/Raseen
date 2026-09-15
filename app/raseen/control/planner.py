"""Trajectory planner: the declared POI line P*(t) and the reserve slice.

Aggregate-target logic for a plant of any size. The line descends at the declared
gradient g so that it reaches the transit minimum exactly when the available power
does, holds, and re-ascends at g_up.

The flat line can be planned with a *hold margin*: the plant is then held that much below
the transit minimum, and the descent starts earlier by margin / g so it still ends when the
first block is reached. This is the line the pre-hold and backfill strategy follows — the
margin is the loss it keeps in hand for a front deeper than forecast. With no margin the
flat line is exactly what it always was.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Plan:
    P_star: list[float]
    t_desc_start: float
    t_min: float
    k_min: int
    t_rise: float
    A_min: float
    D: float
    L: float
    g: float
    g_up: float
    delta: float
    horizon: float
    lead_shortfall: float
    flat: bool
    #: The level the flat line holds through the crossing (the transit minimum less the hold
    #: margin); for the ramp it is simply the transit minimum.
    hold_mw: float


def plan_trajectory(
    times: list[float],
    A_tot: list[float],
    plant_mw: float,
    *,
    g: float,
    g_up: float | None = None,
    flat: bool = False,
    confidence: float = 0.7,
    kappa: float = 0.25,
    reserve_override: float | None = None,
    horizon: float = 5.0,
    hold_margin: float = 0.0,
) -> Plan:
    g_up = g if g_up is None else g_up
    n = len(times)
    k_min = min(range(n), key=lambda k: (A_tot[k], k))
    A_min, t_min = A_tot[k_min], times[k_min]
    D = plant_mw - A_min
    P_star: list[float] = []
    if flat:
        shaded = [k for k in range(n) if A_tot[k] < plant_mw - 1e-6]
        k_first, k_last = (shaded[0], shaded[-1]) if shaded else (k_min, k_min)
        t_first, t_last = times[k_first], times[k_last]
        # The hold level sits the margin below the transit minimum, and the descent starts
        # earlier by exactly the extra distance, so the plant is at the hold when the first
        # block is reached and not before. A zero margin leaves the old flat line untouched.
        hold = max(0.0, A_min - hold_margin)
        L_pre = (plant_mw - hold) / g
        t_desc_start = t_first - L_pre
        t_rise = t_last
        for k, tt in enumerate(times):
            if tt < t_desc_start:
                p = plant_mw
            elif tt < t_first:
                p = plant_mw - g * (tt - t_desc_start)
            elif tt <= t_last:
                p = hold
            else:
                p = min(plant_mw, hold + g_up * (tt - t_last))
            P_star.append(min(p, A_tot[k]))
    else:
        hold = A_min
        # Start the descent at the feasibility-binding point: the earliest time from which a
        # straight line at gradient g stays at or below the available power at every shaded
        # step. For a uniform (linear) front this is t_min - D/g, so the abstract reference
        # case is unchanged; for the real plant's concave front it starts earlier, so the declared
        # line is tangent to the plunge rather than clamped by it, and the plant holds g.
        shaded_desc = [
            times[k] - (plant_mw - A_tot[k]) / g
            for k in range(k_min + 1)
            if A_tot[k] < plant_mw - 1e-6
        ]
        t_desc_start = min(shaded_desc) if shaded_desc else t_min - D / g
        k_rise = next((k for k in range(k_min, n) if A_tot[k] > A_min + 1e-6), n - 1)
        t_rise = times[k_rise]
        for k, tt in enumerate(times):
            if tt < t_desc_start:
                p = plant_mw
            elif tt <= t_rise:
                p = max(A_min, plant_mw - g * (tt - t_desc_start))
            else:
                p = min(plant_mw, A_min + g_up * (tt - t_rise))
            P_star.append(min(p, A_tot[k]))
    first_shaded = next((times[k] for k in range(n) if A_tot[k] < plant_mw - 1e-6), 0.0)
    L = max(0.0, first_shaded - t_desc_start)
    lead_shortfall = max(0.0, times[0] - t_desc_start)
    if reserve_override is not None:
        delta = float(reserve_override)
    else:
        delta = min(D * (1.0 - confidence) * kappa, 0.10 * plant_mw)
    return Plan(
        P_star=P_star, t_desc_start=t_desc_start, t_min=t_min, k_min=k_min, t_rise=t_rise,
        A_min=A_min, D=D, L=L, g=g, g_up=g_up, delta=delta, horizon=horizon,
        lead_shortfall=lead_shortfall, flat=flat, hold_mw=hold,
    )


def apply_release(
    P_star: list[float], A_tot: list[float], times: list[float], k_detect: int, g_up: float
) -> list[float]:
    """From step ``k_detect`` the target rises toward available power at ``g_up``.

    The false-alarm release: the declared line is abandoned and the plant returns to
    full output within its up-gradient.
    """
    out = list(P_star)
    for k in range(max(1, k_detect), len(out)):
        dt = times[k] - times[k - 1]
        out[k] = min(A_tot[k], out[k - 1] + g_up * dt)
    return out
