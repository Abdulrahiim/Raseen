from __future__ import annotations

import math

import pytest

from raseen.geometry.site import load_site
from raseen.shadow.fields import (
    INF,
    FrontField,
    ScatteredField,
    build_field,
    cloud_polygons,
    smooth01,
)

DT = 1 / 6


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
