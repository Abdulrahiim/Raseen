"""Block allocation: where the required curtailment goes, every 10 s.

The plant has no battery. What it has instead is *headroom*: a block held below the power it
could make can be let back up later. That is the whole mechanism — build headroom on the
blocks the cloud has not reached, then release it as the cloud lands on the others, so the
connection point falls along the declared gradient instead of following the sun down.

Headroom is only worth holding where it survives long enough to be released. Curtailment
parked on a block the cloud reaches in one minute expires with that block; the same MW parked
on a block the cloud reaches last (or never) is firm and can be spent exactly when a shaded
block drops out. So the required curtailment is placed **farthest-arrival first**, weights
exp(−(ETA_max − ETA)/σ), capped at each block's post-event floor, then spilled onto the nearer
blocks when the far ones run out of room. Total spill is unaffected by this choice — it is
fixed by the declared line, not by where the curtailment sits — so the ordering costs nothing
and buys a reserve that is roughly twice as large at contact.

The rest of the reference heuristic is kept as the *desired* levels: the reserve slice Δ as a
floor under the above, floor spill, slew clamp, aggregate rebalance (the reactive duty is a
separate helper). The reference script let that final rebalance exceed the slew limit whenever
the sun removed curtailment faster than the remaining blocks could take it over — the
tail of a solid front: on the D1 fixture the verbatim port breaks the 10 %/min limit on
24, 27 and 9 block-steps at g = 90, 120 and 150 MW/min, which the spec forbids. So this
is deliberately not the verbatim six-step port. Here every block moves toward its desired
level only within its slew band, a look-ahead along the declared line pre-positions the
blocks the cloud reaches last so the aggregate stays reachable, and the residual is
placed within slew. The proportional spread of the reference remains only as a last resort
so the plant always tracks its declared line. Every D1 metric still matches the reference
table.

The second strategy, ``allocate_hold``, is the user's own idea and does without arrival
order altogether: ahead of the front every block is held down evenly, by the forecast loss
plus a margin, so the plant reaches its flat line before the first block is shaded; when the
cloud lands, the blocks still in sun give back what they were holding and the export stays
flat through the crossing; when the cloud clears, everyone returns at the up-gradient. A
shaded block only ever follows its own sun down. Nothing is put by; the sunshine deliberately
not exported ahead of the front is what the blocks in sun raise their output with later.
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
    finite: list[float], cands: list[int], sigma: float, farthest_first: bool
) -> dict[int, float]:
    """Priority weights over blocks by cloud arrival time.

    ``farthest_first`` (the default for curtailment) weights exp(−(ETA_max − ETA)/σ), so the
    blocks the cloud reaches last — and the blocks it never reaches, which sit at
    ``_FAR_ETA_MIN`` — take the curtailment first and hold firm, releasable headroom.
    The nearest-first form, exp(−ETA/σ), is used when curtailment is being *withdrawn*:
    it frees the blocks closest to the released region first.
    """
    if farthest_first:
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
    """Steps 1–3: reserve slice, farthest-arrival-first water-filling, floor spill."""
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
    take, rem = _water_fill(rem, room, _eta_weights(finite, cands, sigma, not release))
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

    1. desired levels: reserve slice Δ on blocks with ETA > horizon, then water-filling
       farthest-arrival first — weights exp(−(ETA_max − ETA)/σ), capped at each block's
       post-event floor — so the headroom stands on the blocks the cloud reaches last and
       is still there to be released when a shaded block drops out; then any remainder by
       remaining room;
    2. look-ahead: along ``targets_ahead`` (the declared line) and ``A_ahead`` (the
       nowcast) any block whose slew band would leave the plant unable to reach the line
       is brought down now — the rolling reserve on the blocks the cloud reaches last;
    3. each block moves toward its desired level within its slew band (a drop beyond
       the band happens only where the sun itself fell);
    4. the aggregate residual is placed within slew: extra curtailment on the farthest
       blocks first above their floors, then below the floors; released power likewise to
       the blocks the cloud reaches last (raising a block the cloud is about to reach would
       only step it back down), look-ahead-bound blocks last;
    5. only if slew cannot deliver the aggregate at all is the residual spread in
       proportion (the reference behaviour) so the plant still tracks its declared line.
    In ``release`` mode — the false alarm, where the front stalled and the curtailment is
    being withdrawn — the reserve is dropped and the weights are inverted, so the blocks
    that were holding the reserve give it back first.
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
        take, r = _water_fill(r, room, _eta_weights(finite, cands, sigma, not release))
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
        take, need = _water_fill(need, room, _eta_weights(finite, cands, sigma, True))
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


def allocate_hold(
    A: list[float],
    cap: list[float],
    target: float,
    *,
    slew_lim: list[float],
    prev: list[float],
    shaded: list[bool],
) -> list[float]:
    """Set-points P_i so that Σ P_i = target, held evenly ahead of the front and backfilled.

    There is no arrival order here, only *shaded* or *in sun*:

    1. band: ``lo_i = max(0, prev_i − slew_i)``, ``hi_i = min(A_i, prev_i + slew_i)``; a block
       whose sun fell below ``lo_i`` is forced to ``A_i`` (the same rule as ``allocate_bgc``);
    2. every block starts from ``prev_i`` clamped into its band, so a shaded block follows its
       own sun down and is never curtailed further by the controller;
    3. the residual ``Σp − target``. When the plant must come down (the pre-hold descent) it
       is taken from the blocks in sun in proportion to ``p_i`` — the same fraction off every
       block, the user's "10 % everywhere" — within ``lo_i``; then from the shaded blocks the
       same way; and only if slew cannot deliver it is the rest spread beyond slew, so the
       plant still tracks its declared line. When the plant must come up (the backfill) it is
       given to the blocks in sun in proportion to their room ``hi_i − p_i``, then to the
       shaded blocks toward their own ``A_i``; if the blocks in sun cannot cover it, export
       leaves the line — the shortfall is reported in the frames, not hidden by a step beyond
       slew, because a block cannot be asked for more than its slew on the way up;
    4. ``min(A_i, max(0, p_i))``.

    ``cap`` is the block rating; it is carried so the two allocators share a calling shape,
    and the band already keeps every set-point under the sun, which is under the rating.
    """
    n = len(A)
    lo = [max(0.0, prev[i] - slew_lim[i]) for i in range(n)]
    hi = [min(A[i], prev[i] + slew_lim[i]) for i in range(n)]
    for i in range(n):
        if A[i] < lo[i]:          # the sun took the block below its slew band: a forced drop
            lo[i] = A[i]
        if hi[i] < lo[i]:
            hi[i] = lo[i]
    p = [min(max(prev[i], lo[i]), hi[i]) for i in range(n)]
    in_sun = [i for i in range(n) if not shaded[i]]
    in_shade = [i for i in range(n) if shaded[i]]

    r = sum(p) - target
    if r > _EPS:
        for group in (in_sun, in_shade):
            room = {i: p[i] - lo[i] for i in group if p[i] - lo[i] > _EPS}
            take, r = _water_fill(r, room, {i: p[i] for i in room})
            for i, t in take.items():
                p[i] -= t
            if r <= 1e-6:
                break
        if r > 1e-6:                        # last resort, beyond slew
            tot = sum(p)
            if tot > 0:
                p = [pi - r * pi / tot for pi in p]
    elif r < -_EPS:
        need = -r
        for group in (in_sun, in_shade):
            room = {i: hi[i] - p[i] for i in group if hi[i] - p[i] > _EPS}
            take, need = _water_fill(need, room, dict(room))
            for i, t in take.items():
                p[i] += t
            if need <= 1e-6:
                break
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
