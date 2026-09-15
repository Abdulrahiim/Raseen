from __future__ import annotations

import math

import pytest

from raseen.geometry.site import load_site
from raseen.shadow.fields import (
    DRAW_MARGIN_M,
    EDGE_M,
    INF,
    FrontField,
    ScatteredField,
    build_field,
    cloud_polygons,
    smooth01,
)

DT = 1 / 6
#: -5 .. 70 min at 30 s — the whole solid-front event (contact, plateau, exit).
EVENT_TIMES = [t / 2 for t in range(-10, 141)]


def _never_covered(f, times) -> set[int]:
    """Stations whose coverage is exactly zero at every sampled time."""
    never = set(range(len(f.s)))
    for t in times:
        never &= {i for i, c in enumerate(f.coverage(t)) if c == 0.0}
    return never


@pytest.fixture(scope="module")
def site():
    return load_site(mode="real")


def test_smooth01_is_clamped_and_monotone():
    assert smooth01(-1) == 0.0 and smooth01(2) == 1.0
    vals = [smooth01(u / 10) for u in range(11)]
    assert vals == sorted(vals) and vals[0] == 0.0 and vals[-1] == 1.0


def test_solid_front_covers_nothing_before_and_everything_after_crossing(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6)
    assert isinstance(f, FrontField)
    assert abs(f.tau_min - 9.2) < 0.3
    assert max(f.coverage(-5.0)) == 0.0
    assert min(f.coverage(f.tau_min + 1.0)) > 0.99          # inside the plateau
    assert max(f.coverage(f.tau_min + 40.0 + f.tau_min + 2.0)) < 0.01   # band has passed


def test_first_station_is_touched_at_contact_and_coverage_is_monotone(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6)
    first = min(range(len(f.s)), key=lambda i: f.s[i])
    series = [f.coverage(t)[first] for t in (-0.5, 0.0, 0.1, 0.2, 0.5, 1.0)]
    assert series[1] == 0.0 and series[-1] == 1.0
    assert series == sorted(series)


def test_planned_eta_decrements_exactly_with_time(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6)
    a, b = f.eta_planned(3.0), f.eta_planned(3.0 + DT)
    assert all(math.isclose(x - y, DT, abs_tol=1e-9) for x, y in zip(a, b, strict=True))
    assert abs(min(f.eta_planned(0.0))) < 1e-9


def test_heading_changes_the_crossing_time(site):
    ew = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6).tau_min
    ns = build_field(site, event="solid", heading_deg=0, speed_kmh=48, depth=0.6).tau_min
    assert ns > ew + 3.0


def test_thin_band_leaves_the_plant_uncovered_after_passing(site):
    f = build_field(site, event="thin", heading_deg=90, speed_kmh=48, depth=0.6)
    assert 0 < max(f.coverage(2.0)) <= 1.0
    assert max(f.coverage(f.tau_min + 5.0)) == 0.0


def test_stall_freezes_coverage_but_not_the_planned_eta(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6, stall_at=-2.0)
    assert max(f.coverage(30.0)) == 0.0
    assert abs(min(f.eta_planned(0.0))) < 1e-9


def test_deepen_scales_depth_from_the_given_instant(site):
    f = build_field(
        site, event="solid", heading_deg=90, speed_kmh=48, depth=0.5,
        deepen_at=2.0, deepen_factor=1.2,
    )
    assert f.depth_at(1.0) == 0.5 and abs(f.depth_at(2.0) - 0.6) < 1e-12


def test_scattered_field_is_bounded_and_has_clouds(site):
    f = build_field(site, event="scattered", heading_deg=90, speed_kmh=48, depth=0.6, seed=3)
    assert isinstance(f, ScatteredField) and len(f.clouds) == 12
    covered_at_some_time = False
    for t in range(0, 40, 2):
        cov = f.coverage(float(t))
        assert all(0.0 <= c <= 1.0 for c in cov)
        covered_at_some_time |= max(cov) > 0.5
    assert covered_at_some_time
    eta = f.eta_planned(0.0)
    assert all(e == INF or e >= 0.0 for e in eta)
    assert any(e == 0.0 for e in eta) or any(0 < e < INF for e in eta)


def test_scattered_is_reproducible_by_seed(site):
    a = build_field(site, event="scattered", heading_deg=90, speed_kmh=48, depth=0.6, seed=5)
    b = build_field(site, event="scattered", heading_deg=90, speed_kmh=48, depth=0.6, seed=5)
    assert a.clouds == b.clouds


def test_cloud_polygons_are_lonlat_rings_near_the_site(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6)
    polys = cloud_polygons(f, site, 3.0)
    assert len(polys) == 1 and len(polys[0]) == 4
    for lon, lat in polys[0]:
        assert site.bounds["west"] - 0.5 < lon < site.bounds["east"] + 0.5
        assert site.bounds["south"] - 0.5 < lat < site.bounds["north"] + 0.5
    f2 = build_field(site, event="scattered", heading_deg=90, speed_kmh=48, depth=0.6)
    assert len(cloud_polygons(f2, site, 10.0)) == 12


# --- partial cover ---------------------------------------------------------


def test_full_cover_and_hard_edges_reproduce_the_legacy_band_exactly(site):
    """cover_frac=1, softness=0 must be bit-for-bit the old full-width solid front."""
    f = build_field(
        site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6,
        cover_frac=1.0, cover_offset=0.0, softness=0.0,
    )
    assert f.coverage(3.0) == build_field(
        site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6
    ).coverage(3.0)
    for t in (-3.0, 0.0, 2.5, 9.0, 25.0, 55.0):
        lead = f.s_min + f.v_m_min * t
        trail = lead - f.band_len_m
        legacy_cov = [
            smooth01((lead - si) / EDGE_M) * smooth01((si - trail) / EDGE_M) for si in f.s
        ]
        legacy_eta = [(si - lead) / f.v_m_min for si in f.s]
        assert f.coverage(t) == legacy_cov
        assert f.eta_planned(t) == legacy_eta
    (poly,) = f.polygons_sp(3.0)                      # still drawn across the whole plant
    assert min(p for _, p in poly) == f.p_min - DRAW_MARGIN_M
    assert max(p for _, p in poly) == f.p_max + DRAW_MARGIN_M
    assert not _never_covered(f, EVENT_TIMES)         # every station darkens at some point


def test_partial_cover_leaves_part_of_the_plant_in_the_sun_for_the_whole_event(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6, cover_frac=0.4)
    never = _never_covered(f, EVENT_TIMES)
    assert never                                       # blocks that carry the headroom
    assert len(never) < len(f.s)                       # but the cloud does shade the rest
    assert max(max(f.coverage(t)) for t in EVENT_TIMES) > 0.99
    lo, hi = f.band_lo, f.band_hi
    assert all(not (lo <= f.p[i] <= hi) for i in never)
    (poly,) = f.polygons_sp(20.0)                      # drawn band covers only that slice
    assert min(p for _, p in poly) == lo and max(p for _, p in poly) == hi
    assert hi - lo < f.p_max - f.p_min


def test_never_covered_stations_have_an_infinite_planned_eta(site):
    f = build_field(site, event="solid", heading_deg=90, speed_kmh=48, depth=0.6, cover_frac=0.4)
    never = _never_covered(f, EVENT_TIMES)
    assert never
    for t in (-5.0, 0.0, 4.0, 20.0):
        eta = f.eta_planned(t)
        assert all(eta[i] == INF for i in never)
        assert all(math.isfinite(e) for i, e in enumerate(eta) if i not in never)


def test_softness_thins_the_cloud_and_blurs_its_leading_edge(site):
    kw = dict(event="solid", heading_deg=90, speed_kmh=48, depth=0.6)
    hard = build_field(site, softness=0.0, **kw)
    soft = build_field(site, softness=1.0, **kw)
    peak_hard = max(max(hard.coverage(t)) for t in EVENT_TIMES)
    peak_soft = max(max(soft.coverage(t)) for t in EVENT_TIMES)
    assert peak_hard > 0.99
    assert peak_soft < 0.9 * peak_hard                 # a haze, not a dark band

    first = min(range(len(hard.s)), key=lambda i: hard.s[i])
    ts = [k / 60 for k in range(-60, 181)]             # -1 .. 3 min at 1 s

    def edge_span(f):
        series = [f.coverage(t)[first] for t in ts]
        pk = max(series)
        on = min(t for t, c in zip(ts, series, strict=True) if c > 1e-9)
        full = min(t for t, c in zip(ts, series, strict=True) if c >= 0.99 * pk)
        return full - on

    assert edge_span(soft) > 2.0 * edge_span(hard)


def test_cover_offset_slides_the_band_across_the_plant(site):
    kw = dict(event="solid", heading_deg=90, speed_kmh=48, depth=0.6, cover_frac=0.4)
    left = build_field(site, cover_offset=-1.0, **kw)
    right = build_field(site, cover_offset=1.0, **kw)
    t = 20.0                                           # mid-plateau: the band is over the plant
    lit_l = {i for i, c in enumerate(left.coverage(t)) if c > 0.5}
    lit_r = {i for i, c in enumerate(right.coverage(t)) if c > 0.5}
    assert lit_l and lit_r and not (lit_l & lit_r)
    assert sum(left.p[i] for i in lit_l) / len(lit_l) < sum(right.p[i] for i in lit_r) / len(lit_r)
    assert _never_covered(left, EVENT_TIMES) != _never_covered(right, EVENT_TIMES)


def test_scattered_honours_softness_and_still_reports_inf_for_untouched_stations(site):
    kw = dict(event="scattered", heading_deg=90, speed_kmh=48, depth=0.6, seed=3)
    hard = build_field(site, softness=0.0, **kw)
    soft = build_field(site, softness=1.0, **kw)
    ts = [float(t) for t in range(0, 40, 2)]
    assert max(max(soft.coverage(t)) for t in ts) < max(max(hard.coverage(t)) for t in ts)
    # every cloud starts behind the plant, so an INF at t=0 means "no cloud ever reaches this
    # station" — and such a station must stay at zero coverage for the whole event
    untouched = {i for i, e in enumerate(hard.eta_planned(0.0)) if e == INF}
    assert untouched                                   # scattered cumulus miss much of the plant
    for t in (k / 4 for k in range(0, 241)):           # 0 .. 60 min at 15 s
        cov = hard.coverage(t)
        assert all(cov[i] == 0.0 for i in untouched)


def test_full_width_front_shades_every_station_at_any_softness(site):
    """cover_frac = 1 must mean the whole plant, however soft the edges are.

    The band's margin is derived from the ramp width, so this holds without relying on
    DRAW_MARGIN_M happening to equal the widest ramp.
    """
    for softness in (0.0, 0.5, 1.0):
        f = build_field(
            site, event="solid", heading_deg=0.0, speed_kmh=48.0, depth=0.6,
            cover_frac=1.0, softness=softness,
        )
        assert _never_covered(f, EVENT_TIMES) == set(), f"softness={softness}"
        # The across-window is saturated at both array edges, so it scales nothing away.
        assert f.across(f.p_min) == pytest.approx(1.0)
        assert f.across(f.p_max) == pytest.approx(1.0)


def test_cover_offset_keeps_the_shaded_core_inside_the_plant(site):
    """At ±1 the band sits flush against a real array edge, not off in empty ground.

    Sliding the band must move which stations are shaded without emptying the event: a
    band pushed off the array would silently turn a partial cloud into no cloud at all.
    """
    shaded = {}
    for offset in (-1.0, 0.0, 1.0):
        f = build_field(
            site, event="solid", heading_deg=0.0, speed_kmh=48.0, depth=0.6,
            cover_frac=0.4, cover_offset=offset,
        )
        covered = set(range(len(f.s))) - _never_covered(f, EVENT_TIMES)
        assert covered, f"offset={offset} shaded nothing"
        shaded[offset] = covered
    # The two extremes pick out genuinely different parts of the plant.
    assert shaded[-1.0] != shaded[1.0]


def test_scattered_partial_cover_narrows_the_band_the_cells_drift_through(site):
    """cover_frac must not be silently ignored on the scattered event."""
    wide = build_field(
        site, event="scattered", heading_deg=0.0, speed_kmh=48.0, depth=0.6, seed=3,
    )
    narrow = build_field(
        site, event="scattered", heading_deg=0.0, speed_kmh=48.0, depth=0.6, seed=3,
        cover_frac=0.2,
    )
    centres_wide = {round(c[1], 3) for c in wide.clouds}
    centres_narrow = {round(c[1], 3) for c in narrow.clouds}
    assert centres_wide != centres_narrow
    spread = lambda cs: max(cs) - min(cs)  # noqa: E731
    assert spread(centres_narrow) < spread(centres_wide)
    assert len(_never_covered(narrow, EVENT_TIMES)) > len(_never_covered(wide, EVENT_TIMES))
