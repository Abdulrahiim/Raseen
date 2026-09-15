"""Design-case arithmetic for the NAJM-3000 Grid Twin audit (v3).
Minute-resolution simulation of one frontal cloud-band event at the POI.
All values MW / MWh.
  baseline : no twin - POI follows Available Active Power (SAGC definition)
  A        : BESS-only ramp shaping (no curtailment, no TSP instruction needed)
  B        : TSP Active Power Gradient instruction (SAGC 5.4.2.3) + BESS + 12-min pre-ramp
"""
import json

POI_CAP  = 3000.0    # MWac export limit at the connection point
BESS_P   = 500.0     # MW (SPPC standard block)
BESS_E   = 2000.0    # MWh (4 h)
SOC0     = 0.95      # SOC at event start after forecast-driven pre-positioning
FRONT_MIN, LOW_MIN, REC_MIN = 10, 40, 10   # front crossing / low plateau / trailing edge
DEPTH    = 0.60      # fractional loss at full coverage -> 1,800 MW
G_A      = 130.0     # MW/min: steepest down-gradient a 500 MW BESS can hold for a 180 MW/min event
G_B      = 60.0      # MW/min: TSP-instructed down-gradient in Plan B (2 %/min of capacity)
G_B_UP   = 150.0     # MW/min: TSP-instructed up-gradient in Plan B (up-ramps are less critical)
LEAD_B   = 12        # min of pre-ramp before the front (sentinel lead time)
T0 = 30
N  = T0 + FRONT_MIN + LOW_MIN + REC_MIN + 45

def pv_available(t):
    if t < T0: return POI_CAP
    if t < T0 + FRONT_MIN: return POI_CAP * (1 - DEPTH * (t - T0) / FRONT_MIN)
    if t < T0 + FRONT_MIN + LOW_MIN: return POI_CAP * (1 - DEPTH)
    if t < T0 + FRONT_MIN + LOW_MIN + REC_MIN:
        return POI_CAP * (1 - DEPTH * (1 - (t - T0 - FRONT_MIN - LOW_MIN) / REC_MIN))
    return POI_CAP

def simulate(plan):
    soc = BESS_E * SOC0
    rows, hist = [], []
    poi_prev = POI_CAP
    target = POI_CAP
    spilled = bess_dis = bess_chg = 0.0
    max_drop10 = max_grad = 0.0
    for t in range(N):
        avail = pv_available(t)
        bess = 0.0
        if plan == "baseline":
            pv = avail
        elif plan == "A":
            # hold the POI down-gradient to G_A using discharge only; never curtail
            floor, ceil = poi_prev - G_A, poi_prev + G_A
            if avail < floor:
                bess = min(BESS_P, floor - avail, soc * 60)
            elif avail > ceil:
                bess = -min(BESS_P, avail - ceil, (BESS_E - soc) * 60)
            pv = avail
        else:  # plan B
            if t < T0 - LEAD_B:
                target = POI_CAP
            elif t < T0 + FRONT_MIN + LOW_MIN:
                target = max(POI_CAP * (1 - DEPTH), target - G_B)
            else:
                target = min(POI_CAP, target + G_B_UP)
            recovering = t >= T0 + FRONT_MIN + LOW_MIN
            if avail > target:
                excess = avail - target
                chg = min(BESS_P, excess, (BESS_E - soc) * 60)   # absorb into the BESS first
                bess = -chg
                spilled += (excess - chg) / 60
                pv = target + chg          # PV actually produced (part goes to BESS)
            elif recovering:
                pv, bess = avail, 0.0      # up-gradient is a ceiling, never a floor
                target = avail
            else:
                bess = min(BESS_P, target - avail, soc * 60)
                pv = avail
        poi = pv + bess          # bess < 0 while charging
        # bookkeeping
        if bess > 0: bess_dis += bess / 60
        else:        bess_chg += -bess / 60
        soc -= bess / 60
        hist.append(poi)
        if len(hist) > 10: max_drop10 = max(max_drop10, hist[-11] - poi)
        max_grad = max(max_grad, poi_prev - poi)
        poi_prev = poi
        rows.append(dict(t=t - T0, avail=round(avail), pv=round(pv), bess=round(bess), poi=round(poi), soc=round(soc)))
    declared = [POI_CAP] * N if plan == "baseline" else [r["poi"] for r in rows]   # A/B declare their own trajectory 12 min ahead
    replaced = sum(max(0.0, POI_CAP - r["poi"]) for r in rows) / 60
    return dict(plan=plan, rows=rows, spilled=round(spilled), bess_discharged=round(bess_dis),
                bess_charged=round(bess_chg), max_drop10=round(max_drop10), max_grad=round(max_grad),
                energy_replaced_by_others=round(replaced), soc_end=round(soc))

out = {p: simulate(p) for p in ("baseline", "A", "B")}
print(json.dumps({p: {k: v for k, v in d.items() if k != "rows"} for p, d in out.items()}, indent=1))
json.dump(out, open("/home/claude/audit/scenario.json", "w"))
for p in ("A", "B"):
    print(p, [(r["t"], r["poi"], r["bess"]) for r in out[p]["rows"] if r["t"] in (-13, -12, -6, 0, 3, 5, 10, 13, 15, 20, 50, 55, 60, 65, 70)])
