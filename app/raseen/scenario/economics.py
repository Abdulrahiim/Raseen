"""Spilled sunshine priced against the battery alternative."""

from __future__ import annotations

import math

SAR_PER_MWH = 50.0
CLEAR_DAY_MWH = 25_000.0
ANNUAL_ENERGY_MWH = 7.36e6            # 3,000 MW × 8,760 h × 0.28 capacity factor
BATTERY_BLOCK_CAPEX_SAR = 1.09e9      # 500 MW / 2,000 MWh SPPC block
BATTERY_BLOCK_ANNUAL_SAR = 120e6      # annualised, mid of the SAR 110–130 m/yr range
#: Field anchors, annual energy not exported vs ramp limit (% of capacity per minute):
#: Marcos et al. (UPNA) 4.37 % at 2 %/min and 1.38 % at 5 %/min are field measurements; the
#: middle point, 2 % at 3 %/min, is an ASSUMPTION interpolated between them — not measured,
#: and not a result this project computed.
ANCHORS = [(2.0, 4.37), (3.0, 2.0), (5.0, 1.38)]


def annual_spill_pct(g_pct_min: float) -> float:
    """Log-linear interpolation between the field anchors, clamped at the ends."""
    x = math.log(max(1e-6, g_pct_min))
    pts = [(math.log(g), pct) for g, pct in ANCHORS]
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:], strict=False):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def economics(spill_mwh: float, g_mw_min: float, plant_mw: float) -> dict:
    g_pct = g_mw_min / plant_mw * 100.0
    pct = annual_spill_pct(g_pct)
    annual_mwh = ANNUAL_ENERGY_MWH * pct / 100.0
    annual_sar = annual_mwh * SAR_PER_MWH
    ratio = round(BATTERY_BLOCK_ANNUAL_SAR / annual_sar, 1) if annual_sar > 0 else None
    return {
        "spill_mwh": round(spill_mwh, 1),
        "spill_sar": round(spill_mwh * SAR_PER_MWH),
        "spill_share_of_day_pct": round(spill_mwh / CLEAR_DAY_MWH * 100.0, 2),
        "g_pct_min": round(g_pct, 2),
        "annual_spill_pct": round(pct, 2),
        "annual_spill_mwh": round(annual_mwh),
        "annual_spill_sar": round(annual_sar),
        "battery_block_capex_sar": BATTERY_BLOCK_CAPEX_SAR,
        "battery_block_annual_sar": BATTERY_BLOCK_ANNUAL_SAR,
        "battery_to_spill_ratio": ratio,
        "sar_per_mwh": SAR_PER_MWH,
        "assumptions": (
            "SAR 50/MWh energy value; clear day ≈ 25 GWh; annual energy ≈ 7.36 TWh; "
            "battery block 500 MW/2,000 MWh ≈ SAR 1.09 bn, ≈ SAR 120 m/yr; "
            "annual spill from Marcos et al. field anchors."
        ),
    }
