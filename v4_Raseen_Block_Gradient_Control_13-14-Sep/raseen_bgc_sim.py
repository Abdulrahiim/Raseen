"""Raseen (رَصين) v4 — block-level simulation of no-storage ramp shaping.

Plant: 30 control blocks (10 columns west→east × 3 rows), 100 MWac each, 800 m per column.
Front: solid cloud band moving west→east at 800 m/min (48 km/h): one column per minute,
crossing time tau = 10 min; depth D = 60 % of available power; plateau 40 min; exit 10 min.

Schemes
  baseline : MPPT everywhere (no control)
  uniform  : state of the art — plant-level forecast-based curtailment, spread in proportion
             to each block's available power (what a PPC does with one plant set-point)
  bgc      : Block Gradient Control — same aggregate target, but curtailment is placed by ETA:
             blocks about to be shaded descend to their post-shading level first (weights
             exp(-ETA/sigma)), a designed reserve Δ is kept on far-ETA blocks, per-block slew
             limited; shaded blocks carry the reactive duty.
Aggregate target (both controlled schemes): a straight line at gradient g from full output,
starting L = D/g − tau minutes before fence contact so it reaches the plateau exactly when the
front has crossed; up-ramp at g_up on exit. Time step 10 s.
"""
import json, math

NCOL, NROW = 10, 3
BLOCK_MW = 100.0
NB = NCOL * NROW
PLANT = NB * BLOCK_MW                   # 3000 MW
COL_M = 800.0                           # metres per column
SPEED = 800.0 / 60.0                    # m/s (48 km/h)
DEPTH = 0.60
TAU = NCOL * COL_M / SPEED / 60.0       # crossing time, min = 10
PLATEAU = 40.0                          # min fully covered
DT = 10.0 / 60.0                        # step, minutes
T_START, T_END = -40.0, 100.0

def block_xy(i):
    return i % NCOL, i // NCOL          # column (west→east), row

def shade_fraction(col, t, band_cols=None):
    """Fraction of a column's area under the cloud at time t (front reaches column 0's west
    edge at t=0). band_cols=None → solid band (front + plateau + trailing edge)."""
    x0 = col * COL_M; x1 = x0 + COL_M
    lead = SPEED * 60.0 * t             # leading edge position, m
    if band_cols is None:
        trail = lead - SPEED * 60.0 * (TAU + PLATEAU)   # trailing edge (band length = crossing+plateau)
    else:
        trail = lead - band_cols * COL_M
    covered = max(0.0, min(x1, lead) - max(x0, trail))
    return covered / COL_M

def available(i, t, band_cols=None):
    col, _ = block_xy(i)
    f = shade_fraction(col, t, band_cols)
    return BLOCK_MW * (1.0 - DEPTH * f)

def eta(i, t):
    """Minutes until the leading edge reaches the block's west edge (negative = already reached)."""
    col, _ = block_xy(i)
    return (col * COL_M - SPEED * 60.0 * t) / (SPEED * 60.0)

def run(scheme, g=60.0, g_up=None, sigma=3.0, reserve=0.0, slew=10.0, band_cols=None, H=5.0, flat=False):
    """g: down-gradient target MW/min; g_up: up-gradient (default g); sigma: ETA weighting
    (min); reserve: standing headroom kept on far-ETA blocks (MW); slew: max per-block change
    (% of block per minute); H: horizon for 'firm reserve' (min)."""
    g_up = g if g_up is None else g_up
    D = PLANT * DEPTH if band_cols is None else None
    times = []
    t = T_START
    while t <= T_END + 1e-9:
        times.append(round(t, 4)); t += DT
    # aggregate available trajectory
    A = [[available(i, t, band_cols) for i in range(NB)] for t in times]
    Atot = [sum(a) for a in A]
    # aggregate target P*(t)
    if scheme == "baseline":
        Ptar = Atot[:]
    elif flat:
        # hold the transit minimum: pre-descend at g before contact, hold, re-ascend at g_up after exit
        Ptar = []
        Amin = min(Atot)
        k_first = next(k for k in range(len(times)) if Atot[k] < PLANT - 1e-6)     # first shading
        k_last = max(k for k in range(len(times)) if Atot[k] < PLANT - 1e-6)       # last shading
        t_first, t_last = times[k_first], times[k_last]
        L_pre = (PLANT - Amin) / g
        for k, tt in enumerate(times):
            if tt < t_first - L_pre: p = PLANT
            elif tt < t_first: p = PLANT - g * (tt - (t_first - L_pre))
            elif tt <= t_last: p = Amin
            else: p = min(PLANT, Amin + g_up * (tt - t_last))
            Ptar.append(min(p, Atot[k]))
    else:
        Ptar = []
        # down-ramp: reach the minimum of Atot at the time it is first reached
        tmin_idx = min(range(len(times)), key=lambda k: (Atot[k], k))
        Amin, tmin = Atot[tmin_idx], times[tmin_idx]
        L_down = (PLANT - Amin) / g                     # minutes of descent
        t_desc_start = tmin - L_down
        # up-ramp: begins when Atot starts rising again after the minimum
        k_rise = next((k for k in range(tmin_idx, len(times)) if Atot[k] > Amin + 1e-6), len(times) - 1)
        t_rise = times[k_rise]
        for k, tt in enumerate(times):
            if tt < t_desc_start:
                p = PLANT
            elif tt <= tmin:
                p = PLANT - g * (tt - t_desc_start)
            elif tt < t_rise:
                p = Amin
            else:
                p = min(PLANT, Amin + g_up * (tt - t_rise))
            Ptar.append(min(p, Atot[k]))               # never above available (no storage)
    # allocation
    P = []
    prev = [BLOCK_MW] * NB
    for k, tt in enumerate(times):
        a = A[k]; target = Ptar[k]
        if scheme == "baseline":
            p = a[:]
        elif scheme == "uniform":
            frac = target / Atot[k] if Atot[k] > 0 else 0
            p = [x * frac for x in a]
        else:  # bgc
            C = max(0.0, Atot[k] - target)             # required curtailment
            etas = [eta(i, tt) for i in range(NB)]
            floor = [BLOCK_MW * (1 - DEPTH)] * NB       # post-shading level
            # 1) standing reserve on the far-ETA half (blocks not about to be shaded)
            p = a[:]
            far = [i for i in range(NB) if etas[i] > H and a[i] > floor[i] + 1e-9]
            cur = [0.0] * NB
            if reserve > 0 and far:
                per = min(reserve / len(far), BLOCK_MW * 0.3)
                for i in far:
                    cur[i] = min(per, a[i] - floor[i])
            used = sum(cur)
            rem = max(0.0, C - used)
            # 2) descend near-ETA blocks toward their floor, weighted by exp(-ETA/sigma)
            cands = [i for i in range(NB) if a[i] - floor[i] - cur[i] > 1e-9]
            w = {i: math.exp(-max(etas[i], 0.0) / sigma) for i in cands}
            # water-filling with caps
            active = set(cands)
            while rem > 1e-6 and active:
                wsum = sum(w[i] for i in active)
                if wsum <= 0: break
                spill_over = 0.0
                for i in list(active):
                    share = rem * w[i] / wsum
                    cap = a[i] - floor[i] - cur[i]
                    take = min(share, cap)
                    cur[i] += take
                    if take < share - 1e-9:
                        active.discard(i)
                    spill_over += share - take
                rem = spill_over
                if all(a[i] - floor[i] - cur[i] <= 1e-9 for i in active): break
            # 3) anything left (needed only if the target is below the sum of floors): uniform
            if rem > 1e-6:
                room = [a[i] - cur[i] for i in range(NB)]
                tot = sum(room)
                for i in range(NB):
                    cur[i] += rem * room[i] / tot if tot > 0 else 0
            p = [a[i] - cur[i] for i in range(NB)]
            # 4) per-block slew limit (% of block per minute) — feed-forward friendliness
            lim = BLOCK_MW * slew / 100.0 * DT
            for i in range(NB):
                lo, hi = prev[i] - lim, prev[i] + lim
                p[i] = min(a[i], max(min(p[i], hi), lo)) if a[i] >= lo else a[i]
            # re-balance small slew residuals uniformly among blocks with room (keeps Σp = target)
            diff = sum(p) - target
            if abs(diff) > 1e-6:
                if diff > 0:  # need more curtailment
                    room = [p[i] - 0.0 for i in range(NB)]
                    tot = sum(room)
                    p = [p[i] - diff * room[i] / tot for i in range(NB)]
                else:         # need less curtailment
                    room = [a[i] - p[i] for i in range(NB)]
                    tot = sum(room)
                    if tot > 0:
                        p = [p[i] + (-diff) * room[i] / tot for i in range(NB)]
        P.append(p); prev = p
    # metrics
    POI = [sum(p) for p in P]
    spill_down = spill_up = 0.0
    for k, tt in enumerate(times):
        s = (Atot[k] - POI[k]) * DT / 60.0
        if s > 0:
            if tt < (times[min(range(len(times)), key=lambda q: (Atot[q], q))]): spill_down += s
            else: spill_up += s
    steps10 = int(round(10 / DT))
    max_drop10 = max((POI[k - steps10] - POI[k]) for k in range(steps10, len(POI)))
    max_grad = max((POI[k - 1] - POI[k]) / DT for k in range(1, len(POI)))
    max_up = max((POI[k] - POI[k - 1]) / DT for k in range(1, len(POI)))
    # firm reserve: headroom on blocks whose ETA > H, sampled at fence contact and min over crossing
    def firm(k):
        tt = times[k]
        return sum(max(0.0, A[k][i] - P[k][i]) for i in range(NB) if eta(i, tt) > H)
    k0 = times.index(0.0) if 0.0 in times else min(range(len(times)), key=lambda q: abs(times[q]))
    firm_at_contact = firm(k0)
    spill_before_contact = sum((Atot[k] - POI[k]) * DT / 60.0 for k in range(len(times)) if times[k] < 0 and Atot[k] > POI[k])
    # pre-ramp lead
    lead = 0.0
    if scheme != "baseline":
        kk = next((k for k in range(len(times)) if Atot[k] - POI[k] > 1e-3), None)
        lead = -times[kk] if kk is not None and times[kk] < 0 else 0.0
    return dict(scheme=scheme, g=g, g_up=g_up, times=times, POI=[round(x, 1) for x in POI],
                Atot=[round(x, 1) for x in Atot], Ptar=[round(x, 1) for x in Ptar],
                P=[[round(x, 1) for x in p] for p in P], A=[[round(x, 1) for x in a] for a in A],
                spill_down=round(spill_down, 1), spill_up=round(spill_up, 1),
                spill_total=round(spill_down + spill_up, 1), max_drop10=round(max_drop10, 1),
                max_grad=round(max_grad, 1), max_up=round(max_up, 1), lead=round(lead, 1),
                firm_at_contact=round(firm_at_contact, 1), spill_before_contact=round(spill_before_contact, 1))

if __name__ == "__main__":
    out = {}
    for g in (60.0, 90.0, 120.0, 150.0):
        for sch in ("uniform", "bgc"):
            r = run(sch, g=g, reserve=(150.0 if sch == "bgc" else 0.0))
            out[f"{sch}_g{int(g)}"] = r
    out["baseline"] = run("baseline")
    # thin band (partial cover): 2 columns wide
    out["band_baseline"] = run("baseline", band_cols=2)
    out["band_bgc_flat60"] = run("bgc", g=60.0, band_cols=2, flat=True)
    out["band_bgc_flat120"] = run("bgc", g=120.0, band_cols=2, flat=True)
    out["band_bgc_g90"] = run("bgc", g=90.0, band_cols=2)
    summ = {k: {kk: v for kk, v in d.items() if kk not in ("times", "POI", "Atot", "Ptar", "P", "A")} for k, d in out.items()}
    print(json.dumps(summ, indent=1))
    # analytic check of spill for a solid front: (r-g)*tau*T/2 with r = D/tau
    D = PLANT * DEPTH
    for g in (60, 90, 120, 150):
        T = D / g; r = D / TAU
        print(f"g={g}: analytic spill_down = {(r - g) * TAU * T / 2 / 60:.0f} MWh, lead = {T - TAU:.1f} min")
    json.dump(out, open("raseen_sim.json", "w"))
