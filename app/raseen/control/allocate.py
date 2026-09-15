"""Block allocation (v4 §7.3): where the required curtailment goes, every 10 s.

The six steps of the v4 heuristic are kept as the *desired* levels: reserve slice on the
far blocks, descend-first water-filling by exp(−ETA/σ) capped at each block's post-event
floor, floor spill, slew clamp, aggregate rebalance (the reactive duty is a separate
helper). The reference script let that final rebalance exceed the slew limit whenever
the sun removed curtailment faster than the remaining blocks could take it over — the
tail of a solid front: on the D1 fixture the verbatim port breaks the 10 %/min limit on
24, 27 and 9 block-steps at g = 90, 120 and 150 MW/min, which the spec forbids. So this
is deliberately not the verbatim six-step port. Here every block moves toward its desired
level only within its slew band, a look-ahead along the declared line pre-positions the
blocks the cloud reaches last so the aggregate stays reachable, and the residual is
placed within slew (nearest blocks first). The proportional spread of the reference
remains only as a last resort so the plant always tracks its declared line. Every D1
metric still matches the reference table.
"""

from __future__ import annotations

import math

#: Weight given to a block whose arrival time is unknown (no cloud on its path).
_FAR_ETA_MIN = 60.0
_EPS = 1e-9


def _water_fill(
    rem: float, room: dict[int, float], w: dict[int, float]
) -> tuple[dict[int, float], float]:
    """Spread ``rem`` over blocks in proportion to ``w``, capped by ``room``.

    Returns (take per block, amount that found no room).
    """
    take = dict.fromkeys(room, 0.0)
    active = {i for i in room if room[i] > _EPS and w.get(i, 0.0) > 0.0}
    guard = 0
    while rem > 1e-6 and active and guard < 300:
        guard += 1
        wsum = sum(w[i] for i in active)
        if wsum <= 0:
            break
        spill = 0.0
        for i in list(active):
            share = rem * w[i] / wsum
            t = min(share, room[i] - take[i])
            take[i] += t
            if t < share - _EPS:
                active.discard(i)
            spill += share - t
        rem = spill
    return take, rem


def _eta_weights(
    finite: list[float], cands: list[int], sigma: float, invert: bool
) -> dict[int, float]:
    """exp(−ETA/σ): nearest blocks first; inverted, the farthest blocks first."""
    if invert:
        emax = max((finite[i] for i in cands), default=0.0)
        return {i: math.exp(-max(emax - finite[i], 0.0) / sigma) for i in cands}
    return {i: math.exp(-max(finite[i], 0.0) / sigma) for i in cands}


def _desired_levels(
    A: list[float],
    floor: list[float],
    eta: list[float],
    finite: list[float],
    cap: list[float],
    target: float,
    *,
    delta: float,
    horizon: float,
    sigma: float,
    release: bool,
) -> list[float]:
    """v4 §7.3 steps 1–3: reserve slice, descend-first water-filling, floor spill."""
    n = len(A)
    C = max(0.0, sum(A) - target)
    cur = [0.0] * n
    if delta > 0 and not release:
        far = [i for i in range(n) if eta[i] > horizon and A[i] > floor[i] + _EPS]
        if far:
            per = delta / len(far)
            for i in far:
                cur[i] = min(per, 0.3 * cap[i], A[i] - floor[i])
    rem = max(0.0, C - sum(cur))
    cands = [i for i in range(n) if A[i] - floor[i] - cur[i] > _EPS]
    room = {i: A[i] - floor[i] - cur[i] for i in cands}
    take, rem = _water_fill(rem, room, _eta_weights(finite, cands, sigma, release))
    for i, t in take.items():
        cur[i] += t
    if rem > 1e-6:
        room_l = [A[i] - cur[i] for i in range(n)]
        tot = sum(room_l)
        if tot > 0:
            for i in range(n):
                cur[i] += rem * room_l[i] / tot
    return [A[i] - cur[i] for i in range(n)]


def allocate_bgc(
    A: list[float],
    floor: list[float],
    eta: list[float],
    cap: list[float],
    target: float,
    *,
    delta: float,
    horizon: float,
    sigma: float,
    slew_lim: list[float],
    prev: list[float],
    release: bool = False,
    targets_ahead: list[float] | None = None,
    A_ahead: list[list[float]] | None = None,
) -> list[float]:
    """Set-points P_i so that Σ P_i = target, curtailment placed by cloud-arrival order.

    1. desired levels: reserve slice Δ on blocks with ETA > horizon, then descend-first
       water-filling with weights exp(−ETA/σ) capped at each block's post-event floor,
       then any remainder by remaining room (v4 §7.3 steps 1–3);
    2. look-ahead: along ``targets_ahead`` (the declared line) and ``A_ahead`` (the
       nowcast) any block whose slew band would leave the plant unable to reach the line
       is brought down now — the rolling reserve on the blocks the cloud reaches last;
    3. each block moves toward its desired level within its slew band (a drop beyond
       the band happens only where the sun itself fell);
    4. the aggregate residual is placed within slew: extra curtailment on the nearest
       blocks first above their floors, then below the floors; released power to the
       nearest blocks first, look-ahead-bound blocks last;
    5. only if slew cannot deliver the aggregate at all is the residual spread in
       proportion (the reference behaviour) so the plant still tracks its declared line.
    In ``release`` mode the reserve is dropped and the weights are inverted so the
    nearest blocks are freed first.
    """
    n = len(A)
    finite = [e if math.isfinite(e) else _FAR_ETA_MIN for e in eta]
    desired = _desired_levels(
        A, floor, eta, finite, cap, target,
        delta=delta, horizon=horizon, sigma=sigma, release=release,
    )
    lo = [max(0.0, prev[i] - slew_lim[i]) for i in range(n)]
    hi = [min(A[i], prev[i] + slew_lim[i]) for i in range(n)]
    for i in range(n):
        if A[i] < lo[i]:          # the sun took the block below its slew band: a forced drop
            lo[i] = A[i]
        if hi[i] < lo[i]:
            hi[i] = lo[i]
    p = [min(max(prev[i], lo[i]), hi[i]) for i in range(n)]
    ub = list(hi)
    pinned: set[int] = set()

    # 2. look-ahead pre-positioning along the declared line. For the step j ahead the
    #    plant must be able to reach the line with one slew step to spare (j − 1 steps),
    #    otherwise a block exactly on its limit falls one step behind and never catches
    #    up. The next step itself (j = 1) is the aggregate balance below.
    if targets_ahead and A_ahead:
        for j, (tgt, Aj) in enumerate(zip(targets_ahead, A_ahead, strict=False), start=1):
            if j < 2:
                continue
            s = j - 1
            reach = 0.0
            room: dict[int, float] = {}
            for i in range(n):
                fl = min(floor[i], p[i])
                base = max(fl, p[i] - s * slew_lim[i])
                reach += min(Aj[i], base)
                if base < Aj[i] - _EPS:
                    r_i = min(p[i] - lo[i], p[i] - s * slew_lim[i] - fl)
                    if r_i > _EPS:
                        room[i] = r_i
            if not room:
                continue
            excess = reach - tgt
            if excess > 1e-6:
                take, _ = _water_fill(excess, room, dict.fromkeys(room, 1.0))
                for i, t in take.items():
                    if t > 0.0:
                        p[i] -= t
                pinned.update(room)
            elif excess > -sum(room.values()):
                pinned.update(room)         # about to bind: do not hand these blocks power back
        for i in pinned:
            ub[i] = min(hi[i], p[i])

    # 3. toward the desired level, within the band.
    p = [min(max(desired[i], lo[i]), ub[i]) for i in range(n)]

    # 4. aggregate residual, within slew.
    r = sum(p) - target
    if r > _EPS:
        cands = [i for i in range(n) if p[i] - max(lo[i], floor[i]) > _EPS]
        room = {i: p[i] - max(lo[i], floor[i]) for i in cands}
        take, r = _water_fill(r, room, _eta_weights(finite, cands, sigma, release))
        for i, t in take.items():
            p[i] -= t
        if r > 1e-6:
            room = {i: p[i] - lo[i] for i in range(n) if p[i] - lo[i] > _EPS}
            take, r = _water_fill(r, room, dict.fromkeys(room, 1.0))
            for i, t in take.items():
                p[i] -= t
        if r > 1e-6:                        # 5. last resort, beyond slew
            tot = sum(p)
            if tot > 0:
                p = [pi - r * pi / tot for pi in p]
    elif r < -_EPS:
        need = -r
        cands = [i for i in range(n) if i not in pinned and hi[i] - p[i] > _EPS]
        room = {i: hi[i] - p[i] for i in cands}
        take, need = _water_fill(need, room, _eta_weights(finite, cands, sigma, False))
        for i, t in take.items():
            p[i] += t
        if need > 1e-6:
            room = {i: hi[i] - p[i] for i in pinned if hi[i] - p[i] > _EPS}
            take, need = _water_fill(need, room, dict.fromkeys(room, 1.0))
            for i, t in take.items():
                p[i] += t
        if need > 1e-6:                     # 5. last resort, beyond slew
            room_l = [A[i] - p[i] for i in range(n)]
            tot = sum(room_l)
            if tot > 0:
                p = [p[i] + need * room_l[i] / tot for i in range(n)]
    return [min(A[i], max(0.0, p[i])) for i in range(n)]


def allocate_uniform(A: list[float], frac: float) -> list[float]:
    """The state of the art: one plant-level set-point spread in proportion to available power."""
    f = min(1.0, max(0.0, frac))
    return [a * f for a in A]


def reactive_shares(P: list[float], S: list[float]) -> list[float]:
    """Share of the plant Q order per block, ∝ free apparent power √(S² − P²)."""
    free = [math.sqrt(max(0.0, s * s - p * p)) for p, s in zip(P, S, strict=False)]
    tot = sum(free)
    if tot <= 0:
        return [1.0 / len(P)] * len(P)
    return [f / tot for f in free]
