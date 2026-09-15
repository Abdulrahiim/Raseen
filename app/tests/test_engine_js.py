"""The browser engine (raseen/web/engine.js) is a port of the Python simulation, so the
published build can re-run the plant with no server. This holds the two to each other on the
cases the page exposes: same frames, same set-points, same scores, within rounding. Skipped
where node is not installed."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from raseen.scenario.params import ScenarioParams
from raseen.scenario.runner import run_scenario
from raseen.webapp import build_app

APP = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")

CASES = {
    "default": {},
    "band-middle-hold": {"cover_frac": 0.4},
    "stall": {"stall_at_min": -3},
    "deepen": {"deepen_at_min": 2, "deepen_factor": 1.2},
    "thin-flat": {"event": "thin", "flat": True, "g_mw_min": 60},
    "scattered": {"event": "scattered"},
    "soft-offset-fast": {
        "cover_frac": 0.6, "cover_offset": 0.5, "softness": 0.8,
        "speed_kmh": 96, "heading_deg": 225,
    },
}


@pytest.fixture(scope="module")
def site_payload() -> dict:
    from fastapi.testclient import TestClient

    return TestClient(build_app()).get("/api/rs/site").json()


def _run_js(site: dict, params: dict) -> dict:
    with tempfile.TemporaryDirectory(prefix="raseen-engine-") as tmp:
        d = Path(tmp)
        (d / "site.json").write_text(json.dumps(site), encoding="utf-8")
        (d / "params.json").write_text(json.dumps(params), encoding="utf-8")
        subprocess.run(
            [NODE, str(APP / "tools" / "engine_check.mjs"), str(d / "site.json"),
             str(d / "params.json"), str(d / "out.json")],
            check=True, capture_output=True, text=True, timeout=120,
        )
        return json.loads((d / "out.json").read_text(encoding="utf-8"))


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("name", sorted(CASES))
def test_browser_engine_matches_the_python(site_payload, name):
    params = CASES[name]
    py = run_scenario(ScenarioParams(**params))
    js = _run_js(site_payload, params)

    assert js["times_min"] == py["times_min"]
    assert len(js["frames"]) == len(py["frames"])
    # The connection point, every scheme, every frame.
    worst_agg = worst_block = 0.0
    for fp, fj in zip(py["frames"], js["frames"], strict=True):
        assert fj["phase"] == fp["phase"], fp["t"]
        for key in ("A", "P_uni", "P_bgc", "P_hold", "P_star", "P_star_hold", "R", "R_hold"):
            worst_agg = max(worst_agg, abs(fj["agg"][key] - fp["agg"][key]))
        for key in ("A", "P_uni", "P_bgc", "P_hold"):
            for a, b in zip(fp[key], fj[key], strict=True):
                worst_block = max(worst_block, abs(a - b))
        for a, b in zip(fp["coverage"], fj["coverage"], strict=True):
            assert abs(a - b) <= 0.011
        for a, b in zip(fp["eta"], fj["eta"], strict=True):
            assert (a is None) == (b is None)
            if a is not None:
                assert abs(a - b) <= 0.011
    # The plant total must agree to the tenth the payload carries. One block's share of the
    # curtailment may differ by a couple of megawatts on a frame where two blocks tie for
    # the water-fill and the two languages break the tie on the last bit of a float; the
    # page prints whole megawatts per block, and the total is what the grid sees.
    assert worst_agg <= 0.35, worst_agg
    assert worst_block <= 2.5, worst_block

    for scheme in ("base", "uni", "bgc", "hold"):
        kp, kj = py["kpis"][scheme], js["kpis"][scheme]
        tolerances = (
            ("spill_mwh", 0.5), ("max_grad_mw_min", 0.2), ("max_drop10_mw", 0.5),
            ("firm_at_contact_mw", 0.5), ("lead_min", 0.2), ("tracking_error_pct", 0.02),
        )
        for key, tol in tolerances:
            assert abs(kp[key] - kj[key]) <= tol, (scheme, key, kp[key], kj[key])
        assert kp["blocks_stepped"] == kj["blocks_stepped"], scheme
    fp, fj = py["front"], js["front"]
    for key in ("tau_min", "D_mw", "L_min", "delta_mw", "t_desc_start_min", "t_rise_min", "hold_mw",
                "t_hold_start_min", "t_first_min", "t_last_min"):
        assert abs(fp[key] - fj[key]) <= 0.2, (key, fp[key], fj[key])
    for key in ("blocks_reached", "stations_reached", "first_block", "last_block", "detect_at_min"):
        assert fp[key] == fj[key], key
    assert js["economics"]["spill_sar"] == py["economics"]["spill_sar"]
    assert js["is_live"] is False and "NOT MEASURED" in js["disclaimer"]
