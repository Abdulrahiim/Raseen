from __future__ import annotations

import pytest

from raseen.control.allocate import allocate_bgc, allocate_hold, allocate_uniform, reactive_shares
from raseen.control.fixture import abstract_arrays, abstract_case
from raseen.control.planner import apply_release, plan_trajectory
from raseen.control.simulate import simulate_scheme

# Pinned reference numbers for the abstract design case D1 (30 x 100 MW blocks, perfectly
# forecast front). These are the targets the controller must keep reproducing.
#
# Spill, lead and gradient are properties of the declared line and have never moved. The
# firm reserve did: placing the curtailment farthest-arrival first instead of nearest-first
# leaves the headroom on blocks the cloud has not reached, where it is still releasable at
# contact. The earlier figures (287.5 / 218.9 / 188.1 / 154.3) were what the same plant held
# when most of its curtailment sat on blocks about to be shaded, where it expired unused.
ABSTRACT_D1 = {  # g: (spill_total, lead, firm_at_contact_bgc)
    60.0: (605.0, 19.8, 712.6),
    90.0: (305.0, 9.8, 651.8),
    120.0: (155.0, 4.8, 414.6),
    150.0: (65.0, 1.8, 185.0),
}


@pytest.mark.parametrize("g", sorted(ABSTRACT_D1))
def test_abstract_d1_reproduces_the_reference_table(g):
    spill_ref, lead_ref, firm_ref = ABSTRACT_D1[g]
    for scheme in ("uni", "bgc"):
        plan, result, m = abstract_case(scheme, g)
        assert abs(m["spill_mwh"] - spill_ref) / spill_ref < 0.05, (scheme, m["spill_mwh"])
        assert abs(m["lead_min"] - lead_ref) < 0.5
        assert abs(m["max_grad_mw_min"] - g) < 1.0
        assert abs(m["max_drop10_mw"] - 10 * g) < 15.0
    _, _, mb = abstract_case("bgc", g)
    assert abs(mb["firm_at_contact_mw"] - firm_ref) / firm_ref < 0.10


def test_analytic_spill_relation_holds():
    # E_down = (r - g) * tau * (D / g) / 2 with r = D / tau, D = 1800, tau = 10.
    for g in (60.0, 90.0, 120.0, 150.0):
        _, _, m = abstract_case("bgc", g)
        analytic = (180.0 - g) * 10.0 * (1800.0 / g) / 2 / 60.0
        assert abs(m["spill_down_mwh"] - analytic) / analytic < 0.05


def test_plant_level_and_bgc_spill_the_same_for_a_perfect_front():
    _, _, mu = abstract_case("uni", 90.0, ppc_delay_steps=0)
    _, _, mb = abstract_case("bgc", 90.0, ppc_delay_steps=0)
    assert abs(mu["spill_mwh"] - mb["spill_mwh"]) / mb["spill_mwh"] < 0.01


def test_export_never_exceeds_available_and_tracks_the_declared_line():
    plan, result, m = abstract_case("bgc", 90.0)
    arrays = abstract_arrays()
    for k, p in enumerate(result.P):
        for i, pi in enumerate(p):
            assert pi <= arrays["A"][k][i] + 1e-6
            assert pi >= -1e-6
        if plan.P_star[k] <= arrays["A_tot"][k] - 1e-6:
            assert abs(sum(p) - plan.P_star[k]) < 1e-2
    assert m["tracking_error_pct"] < 0.5


def test_bgc_leaves_shaded_blocks_alone_and_does_not_step():
    _, _, mb = abstract_case("bgc", 90.0)
    _, _, mu = abstract_case("uni", 90.0)
    _, _, m0 = abstract_case("base", 90.0)
    # the proportional rule curtails shaded blocks
    assert mu["shaded_curtailment_mwh"] > 5.0
    assert mb["shaded_curtailment_mwh"] < 0.05 * mu["shaded_curtailment_mwh"] + 0.5
    assert m0["shaded_curtailment_mwh"] == 0.0
    assert mb["blocks_stepped"] == 0


def test_slew_limit_is_respected_for_bgc():
    _, result, _ = abstract_case("bgc", 90.0)
    lim = 100.0 * 10.0 / 100.0 * (1 / 6) + 1e-6   # 10 %/min of a 100 MW block per 10 s step
    arrays = abstract_arrays()
    for k in range(1, len(result.P)):
        for i in range(30):
            drop = result.P[k - 1][i] - result.P[k][i]
            # a block may fall faster only because the sun did
            # (available dropped below the set-point)
            if drop > lim + 1.0:
                a_now = arrays["A"][k][i]
                assert result.P[k][i] <= a_now + 1e-6 and a_now < result.P[k - 1][i]


def test_flat_mode_holds_the_transit_minimum_for_a_thin_band():
    plan, result, m = abstract_case("bgc", 60.0, flat=True, band_cols=2)
    assert abs(m["spill_mwh"] - 46.0) / 46.0 < 0.10
    assert m["max_grad_mw_min"] <= 60.0 + 1.0
    mid = min(range(len(plan.P_star)), key=lambda k: plan.P_star[k])
    assert abs(result.POI[mid] - plan.A_min) < 5.0


def test_curtailment_sits_on_the_blocks_the_cloud_reaches_last():
    A = [100.0, 100.0, 100.0]
    floor = [40.0, 40.0, 40.0]
    eta = [1.0, 5.0, 10.0]
    cap = [100.0, 100.0, 100.0]
    slew = [100.0, 100.0, 100.0]
    kw = dict(delta=0.0, horizon=5.0, sigma=3.0, slew_lim=slew, prev=A)
    p = allocate_bgc(A, floor, eta, cap, 250.0, **kw)
    assert abs(sum(p) - 250.0) < 1e-6
    # Farthest-arrival first: block 2 (ETA 10 min) is held lowest, so its headroom is still
    # there to be released when block 0 (ETA 1 min) goes under the cloud.
    assert p[2] < p[1] < p[0]
    r = allocate_bgc(A, floor, eta, cap, 250.0, release=True, **kw)
    assert abs(sum(r) - 250.0) < 1e-6
    assert r[2] > r[0]                            # release mode: the reserve is given back first
    q = allocate_bgc(A, floor, eta, cap, 280.0, **{**kw, "delta": 30.0})
    # reserve slice on the far block only
    assert q[2] < 100.0 - 1e-6 and abs(q[0] - 100.0) < 1e-6


def test_far_blocks_raise_output_as_the_cloud_lands_on_the_near_ones():
    """The mechanism itself: headroom built before contact is spent to cover the loss.

    Two blocks. The cloud reaches block 0 first; block 1 it never reaches. Holding the
    aggregate flat at 150 MW while block 0's sun falls from 100 to 40 MW must be paid for by
    block 1 *rising*, which it can only do because it was held below its available power to
    begin with.

    ``floor`` is the level the plant settles at under full cover, and the runner applies the
    same one to every block — a block is not allowed to be curtailed below it, whether or not
    the cloud reaches that block.
    """
    cap = [100.0, 100.0]
    floor = [40.0, 40.0]
    slew = [100.0, 100.0]
    kw = dict(delta=0.0, horizon=5.0, sigma=3.0, slew_lim=slew)
    before = allocate_bgc([100.0, 100.0], floor, [6.0, float("inf")], cap, 150.0,
                          prev=[100.0, 100.0], **kw)
    assert abs(sum(before) - 150.0) < 1e-6
    assert before[1] < 100.0 - 1e-6               # headroom parked on the block that keeps sun
    during = allocate_bgc([40.0, 100.0], floor, [0.0, float("inf")], cap, 140.0,
                          prev=before, **kw)
    assert abs(sum(during) - 140.0) < 1e-6
    assert during[1] > before[1] + 1e-6           # …and released when the cloud lands


def test_uniform_and_reactive_helpers():
    assert allocate_uniform([100.0, 50.0], 0.5) == [50.0, 25.0]
    assert allocate_uniform([100.0], 2.0) == [100.0]
    shares = reactive_shares([0.0, 100.0], [110.0, 110.0])
    assert abs(sum(shares) - 1.0) < 1e-9 and shares[0] > shares[1]


def test_planner_lead_and_release():
    arrays = abstract_arrays()
    plan = plan_trajectory(arrays["times"], arrays["A_tot"], 3000.0, g=90.0, confidence=0.7)
    assert abs(plan.D - 1800.0) < 1.0 and abs(plan.L - 10.0) < 0.3
    assert abs(plan.delta - 135.0) < 1e-6           # 1800 × (1 − 0.7) × 0.25
    assert plan.lead_shortfall == 0.0
    tight = plan_trajectory(arrays["times"], arrays["A_tot"], 3000.0, g=30.0, confidence=0.7)
    assert tight.lead_shortfall > 0.0
    k = 100
    released = apply_release(plan.P_star, arrays["A_tot"], arrays["times"], k, plan.g_up)
    assert released[:k] == plan.P_star[:k]
    assert all(released[j] <= arrays["A_tot"][j] + 1e-9 for j in range(k, len(released)))
    assert released[k + 60] >= released[k]


def test_bgc_look_ahead_reads_the_nowcast_and_has_no_foresight_of_the_true_field():
    arrays = abstract_arrays()
    times, A = arrays["times"], arrays["A"]
    plan = plan_trajectory(times, arrays["A_tot"], 3000.0, g=90.0, reserve_override=150.0)
    kw = dict(
        times=times, A_tot=arrays["A_tot"], floors=arrays["floors"], etas=arrays["etas"],
        caps=arrays["caps"], P_star=plan.P_star, sigma=3.0, delta=plan.delta, horizon=5.0,
        slew_pct_min=10.0, ppc_delay_steps=0,
    )
    ref = simulate_scheme("bgc", A=A, **kw)
    # the default nowcast is the true field itself (the fixture's operator sees the front exactly)
    assert simulate_scheme("bgc", A=A, A_nowcast=A, **kw).P == ref.P
    # the sun changes after k_cut while the operator's nowcast does not: nothing the controller
    # did up to k_cut may depend on that future, only on the field it could know
    k_cut = 300
    A_alt = [list(row) for row in A]
    for k in range(k_cut + 1, len(A_alt)):
        A_alt[k] = [0.5 * a for a in A_alt[k]]
    alt = simulate_scheme("bgc", A=A_alt, A_nowcast=A, **kw)
    assert alt.P[: k_cut + 1] == ref.P[: k_cut + 1]
    for k in range(k_cut + 1, len(times)):
        assert all(p <= a + 1e-6 for p, a in zip(alt.P[k], A_alt[k], strict=True))


# --- the second strategy: pre-hold and backfill ------------------------------------------


def test_hold_allocator_takes_evenly_from_the_blocks_in_sun_ahead_of_the_front():
    """The pre-hold descent: nothing is shaded yet, and every block gives the same share."""
    A = [100.0, 100.0, 100.0]
    cap = [100.0, 100.0, 100.0]
    slew = [100.0, 100.0, 100.0]
    p = allocate_hold(A, cap, 270.0, slew_lim=slew, prev=A, shaded=[False, False, False])
    assert abs(sum(p) - 270.0) < 1e-6
    assert all(abs(x - 90.0) < 1e-6 for x in p)


def test_hold_allocator_backfills_from_the_blocks_in_sun_and_never_curtails_a_shaded_block():
    """The mechanism the user asked for: hold everyone down evenly, then let the blocks still
    in sun give back what they were holding when the cloud lands on the middle one."""
    cap = [100.0, 100.0, 100.0]
    slew = [100.0, 100.0, 100.0]
    held = [90.0, 90.0, 90.0]
    # The cloud lands on block 1 and takes 20 % of it: its sun falls to 80 MW.
    during = allocate_hold([100.0, 80.0, 100.0], cap, 270.0, slew_lim=slew, prev=held,
                           shaded=[False, True, False])
    assert abs(sum(during) - 270.0) < 1e-6
    assert abs(during[1] - 80.0) < 1e-6              # follows its own sun, nothing more taken
    assert during[0] > 90.0 + 1e-6 and during[2] > 90.0 + 1e-6   # the sides give back
    assert abs(during[0] - during[2]) < 1e-6         # evenly, having equal room
    # Slew binds on the way up: the sides can only rise by their band, so export leaves the
    # line and the shortfall is reported rather than taken from the shaded block.
    tight = allocate_hold([100.0, 80.0, 100.0], cap, 270.0, slew_lim=[2.0, 2.0, 2.0],
                          prev=held, shaded=[False, True, False])
    assert abs(tight[1] - 80.0) < 1e-6
    assert abs(tight[0] - 92.0) < 1e-6 and abs(tight[2] - 92.0) < 1e-6
    assert sum(tight) < 270.0 - 1e-6


def test_hold_scheme_keeps_export_on_the_flat_line_through_a_partial_cover():
    """A three-block plant, a cloud that only ever reaches the middle block. The hold line is
    planned against the same field and the scheme must sit on it through the crossing while
    the shaded block is left to its sun."""
    times = [round(-10.0 + k / 6.0, 6) for k in range(181)]   # −10 … +20 min, 10 s steps
    cap = [100.0, 100.0, 100.0]
    A, cov, etas = [], [], []
    for t in times:
        f = 0.0 if t < 0 else min(1.0, t / 1.0)     # block 1 goes under cover over one minute
        A.append([100.0, 100.0 * (1.0 - 0.5 * f), 100.0])
        cov.append([0.0, f, 0.0])
        etas.append([float("inf"), -t, float("inf")])
    A_tot = [sum(r) for r in A]
    plan = plan_trajectory(times, A_tot, 300.0, g=30.0, flat=True, hold_margin=10.0,
                           reserve_override=0.0)
    assert abs(plan.hold_mw - 240.0) < 1e-6           # A_min 250 less the 10 MW margin
    result = simulate_scheme(
        "hold", times=times, A=A, A_tot=A_tot, floors=[[50.0] * 3 for _ in times], etas=etas,
        caps=cap, P_star=plan.P_star, sigma=3.0, delta=0.0, horizon=5.0, slew_pct_min=10.0,
        ppc_delay_steps=0, coverage=cov,
    )
    for k, t in enumerate(times):
        p = result.P[k]
        assert all(pi <= A[k][i] + 1e-6 for i, pi in enumerate(p))
        if t >= 2.0:                                   # on the hold, cloud fully on block 1
            assert abs(sum(p) - 240.0) < 1e-6
            assert abs(p[1] - 50.0) < 1e-6             # the shaded block at its own sun
            assert abs(p[0] - 95.0) < 1e-6 and abs(p[2] - 95.0) < 1e-6   # the sides back-filled
        if cov[k][1] > 0.02 and k > 0:
            # Once shaded a block only falls with its own sun, or within slew while the
            # pre-hold descent is still finishing and the blocks in sun have no room left.
            lim = 100.0 * 10.0 / 100.0 / 6.0
            assert p[1] >= min(A[k][1], result.P[k - 1][1] - lim) - 1e-4


def test_hold_margin_lowers_the_flat_line_and_starts_the_descent_earlier():
    arrays = abstract_arrays()
    base = plan_trajectory(arrays["times"], arrays["A_tot"], 3000.0, g=90.0, flat=True)
    same = plan_trajectory(arrays["times"], arrays["A_tot"], 3000.0, g=90.0, flat=True,
                           hold_margin=0.0)
    assert same.P_star == base.P_star and same.hold_mw == base.A_min
    lower = plan_trajectory(arrays["times"], arrays["A_tot"], 3000.0, g=90.0, flat=True,
                            hold_margin=135.0)
    assert abs(lower.hold_mw - (base.A_min - 135.0)) < 1e-6
    assert lower.t_desc_start < base.t_desc_start - 1.0
    assert min(lower.P_star) < min(base.P_star) - 100.0
    # The ramp is untouched by the margin: it is a property of the flat line only.
    ramp = plan_trajectory(arrays["times"], arrays["A_tot"], 3000.0, g=90.0, hold_margin=135.0)
    assert ramp.P_star == plan_trajectory(arrays["times"], arrays["A_tot"], 3000.0, g=90.0).P_star


def test_hold_scheme_on_the_abstract_plant_holds_the_declared_gradient():
    """On a full-width front there is nothing left in sun to back-fill from, so the strategy
    degenerates to the flat line — still within the declared gradient, no block stepped."""
    plan, result, m = abstract_case("hold", 90.0, flat=True, hold_margin=135.0)
    assert m["max_grad_mw_min"] <= 90.0 + 1.0
    assert m["blocks_stepped"] == 0
    assert m["tracking_error_pct"] < 0.5
    k_hold = min(range(len(plan.P_star)), key=lambda k: plan.P_star[k])
    assert abs(result.POI[k_hold] - plan.hold_mw) < 5.0
