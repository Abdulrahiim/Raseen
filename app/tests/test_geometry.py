from __future__ import annotations

import math

import pytest

from raseen import MVPS_COUNT_DESIGN
from raseen.geometry.projection import (
    crossing_time_min,
    extent_m,
    heading_vector,
    perpendicular,
    project,
    sp_to_xy,
)
from raseen.geometry.site import MVPS_MW, Site, get_site, load_site


@pytest.fixture(scope="module")
def site() -> Site:
    return load_site(mode="real")


def test_site_loads_363_mvps_with_bounds_and_zones(site):
    assert len(site.mvps) == 363
    numbers = [p["n"] for p in site.mvps]
    assert numbers == sorted(numbers) and len(set(numbers)) == 363
    # Stations keep their CAD numbers, which run against the 365-station design basis;
    # two design numbers have no geometry (GAP-019), so the set is 1..365 minus {224, 307}.
    design = set(range(1, MVPS_COUNT_DESIGN + 1))
    assert set(numbers) <= design
    assert design - set(numbers) == {224, 307}
    assert site.bounds["south"] < site.bounds["north"]
    assert site.bounds["west"] < site.bounds["east"]
    assert len(site.zones) >= 15
    assert "as-designed" in site.note


def test_local_metres_round_trip(site):
    p = site.mvps[10]
    x, y = site.to_local(p["lat"], p["lon"])
    lon, lat = site.to_lonlat(x, y)
    assert abs(lon - p["lon"]) < 1e-9 and abs(lat - p["lat"]) < 1e-9


def test_plant_extent_matches_the_known_footprint(site):
    xy = site.mvps_xy()
    assert 7000 < extent_m(xy, 90) < 7700      # east–west ≈ 7.36 km
    assert 10200 < extent_m(xy, 0) < 10900     # north–south ≈ 10.56 km


def test_crossing_time_depends_on_heading(site):
    xy = site.mvps_xy()
    taus = [crossing_time_min(extent_m(xy, h), 48.0) for h in range(0, 360, 15)]
    assert all(7.0 < tau < 14.0 for tau in taus)
    assert abs(crossing_time_min(extent_m(xy, 90), 48.0) - 9.2) < 0.3
    assert abs(crossing_time_min(extent_m(xy, 0), 48.0) - 13.2) < 0.3


def test_heading_vector_convention():
    ux, uy = heading_vector(90)
    assert abs(ux - 1) < 1e-12 and abs(uy) < 1e-12      # eastward
    ux, uy = heading_vector(0)
    assert abs(ux) < 1e-12 and abs(uy - 1) < 1e-12      # northward


def test_projection_and_perpendicular_are_orthonormal():
    pts = [(100.0, 0.0), (0.0, 100.0), (300.0, -200.0)]
    for h in (0, 37, 90, 200):
        s = project(pts, h)
        p = perpendicular(pts, h)
        for (x, y), si, pi in zip(pts, s, p, strict=True):
            xx, yy = sp_to_xy(si, pi, h)
            assert math.isclose(xx, x, abs_tol=1e-9) and math.isclose(yy, y, abs_tol=1e-9)


def test_representative_mode_shifts_and_relabels(site):
    rep = load_site(mode="representative")
    assert rep.mode == "representative"
    assert abs(rep.mvps[0]["lat"] - site.mvps[0]["lat"]) > 0.5
    assert all(z["name"].startswith("Zone ") for z in rep.zones)
    assert "Representative mode" in rep.note


def test_mvps_capacity_sums_to_the_plant():
    assert abs(MVPS_MW * 363 - 3000.0) < 1e-9


def test_mode_argument_is_case_insensitive():
    assert load_site(mode="Real").mode == "real"
    assert load_site(mode="REPRESENTATIVE").mode == "representative"
    assert get_site("Representative").mode == "representative"
    assert get_site("Real") is get_site("real")
    with pytest.raises(ValueError):
        load_site(mode="synthetic")


# --- Task 3: control blocks -------------------------------------------------------

from dataclasses import replace  # noqa: E402

from raseen.geometry.blocks import (  # noqa: E402
    HULL_PAD_M,
    HULL_PAD_SIDES,
    ControlBlock,
    blocks_payload,
    buffer_hull,
    control_blocks,
    convex_hull,
    get_blocks,
    kmeans,
    mvps_block_index,
    real_frame,
)
from raseen.geometry.site import REPRESENTATIVE_OFFSET  # noqa: E402


def test_kmeans_is_deterministic_and_covers_every_point(site):
    xy = site.mvps_xy()
    a = kmeans(xy, 30)
    b = kmeans(xy, 30)
    assert a == b
    assert len(a) == 363
    assert set(a) == set(range(30))


def test_convex_hull_of_a_square_has_four_corners():
    pts = [(0, 0), (1, 0), (1, 1), (0, 1), (0.5, 0.5), (0.2, 0.8)]
    assert len(convex_hull(pts)) == 4


def test_thirty_blocks_partition_the_plant(site):
    blocks = control_blocks(site)
    assert len(blocks) == 30
    assert [b.id for b in blocks] == [f"B{i:02d}" for i in range(1, 31)]
    all_mvps = sorted(n for b in blocks for n in b.mvps)
    # CAD station numbers are 1..365 minus {224, 307}: compare with the site, not a range.
    assert all_mvps == sorted(p["n"] for p in site.mvps)
    assert abs(sum(b.capacity_mw for b in blocks) - 3000.0) < 1e-6
    assert all(5 <= len(b.mvps) <= 20 for b in blocks)
    assert all(50.0 < b.capacity_mw < 170.0 for b in blocks)
    xs = [b.centroid_xy[0] for b in blocks]
    assert xs == sorted(xs)


def test_blocks_have_hulls_and_zone_labels(site):
    blocks = control_blocks(site)
    for b in blocks:
        assert isinstance(b, ControlBlock)
        assert len(b.hull_lonlat) >= 3
        assert b.zone in {z["name"] for z in site.zones}
        assert b.label.startswith(b.zone)
        assert b.extent_m[0] > 100 and b.extent_m[1] > 100
    assert len({b.label for b in blocks}) == 30


def test_payload_and_index(site):
    blocks = control_blocks(site)
    payload = blocks_payload(blocks)
    assert payload[0].keys() >= {
        "id", "label", "zone", "mvps", "capacity_mw", "centroid", "hull", "extent_m",
    }
    idx = mvps_block_index(site, blocks)
    assert len(idx) == 363
    assert idx[blocks[7].mvps_index[0]] == 7


def _cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _is_convex_ccw(poly):
    n = len(poly)
    return n >= 3 and all(
        _cross(poly[i], poly[(i + 1) % n], poly[(i + 2) % n]) > 0 for i in range(n)
    )


def _strictly_inside(p, poly):
    n = len(poly)
    return all(_cross(poly[i], poly[(i + 1) % n], p) > 0 for i in range(n))


def _convex_overlap(a, b):
    """Separating-axis test for two convex polygons: True when their interiors overlap."""
    for poly in (a, b):
        n = len(poly)
        for i in range(n):
            ex, ey = poly[(i + 1) % n][0] - poly[i][0], poly[(i + 1) % n][1] - poly[i][1]
            nx, ny = -ey, ex
            pa = [nx * x + ny * y for x, y in a]
            pb = [nx * x + ny * y for x, y in b]
            if max(pa) <= min(pb) or max(pb) <= min(pa):
                return False
    return True


def _hull_xy(site, block):
    return [site.to_local(lat, lon) for lon, lat in block.hull_lonlat]


def test_kmeans_handles_tiny_inputs_without_empty_clusters():
    # n == k with duplicate points: seeding and assignment tie on the duplicate and the
    # empty-cluster repair has to donate from a cluster that keeps at least one member.
    pts = [(0.0, 0.0), (0.0, 0.0), (1.0, 1.0)]
    labels = kmeans(pts, 3)
    assert len(labels) == 3 and set(labels) == {0, 1, 2}
    pts = [(0.0, 0.0), (0.0, 0.0), (0.0, 0.0), (5.0, 5.0), (5.0, 5.0)]
    labels = kmeans(pts, 5)
    assert set(labels) == set(range(5))
    with pytest.raises(ValueError):
        kmeans(pts, 6)


def test_buffer_hull_is_convex_and_keeps_clearance():
    square = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)]
    padded = buffer_hull(square, 10.0)
    assert _is_convex_ccw(padded)
    assert len(padded) <= len(square) + HULL_PAD_SIDES
    clearance = 10.0 * math.cos(math.pi / HULL_PAD_SIDES)
    for v in square:
        assert _strictly_inside(v, padded)
        n = len(padded)
        for i in range(n):
            a, b = padded[i], padded[(i + 1) % n]
            assert _cross(a, b, v) / math.dist(a, b) >= clearance - 1e-9
    assert max(x for x, _ in padded) <= 110.0 + 1e-9 and min(y for _, y in padded) >= -10.0 - 1e-9
    # Degenerate hulls still become an area.
    assert _is_convex_ccw(buffer_hull([(0.0, 0.0)], 10.0))
    assert _is_convex_ccw(buffer_hull([(0.0, 0.0), (50.0, 0.0)], 10.0))
    assert buffer_hull(square, 0.0) == convex_hull(square)


@pytest.mark.parametrize("mode", ["real", "representative"])
def test_block_hulls_are_convex_disjoint_and_contain_only_their_stations(mode):
    s = load_site(mode=mode)
    xy = s.mvps_xy()
    blocks = control_blocks(s)
    hulls = [_hull_xy(s, b) for b in blocks]
    for b, hull in zip(blocks, hulls, strict=True):
        assert _is_convex_ccw(hull)
        members = set(b.mvps_index)
        assert all(_strictly_inside(xy[i], hull) for i in members)
        foreign_inside = [
            i for i in range(len(xy)) if i not in members and _strictly_inside(xy[i], hull)
        ]
        assert foreign_inside == []
    for i in range(len(hulls)):
        for j in range(i + 1, len(hulls)):
            assert not _convex_overlap(hulls[i], hulls[j]), (blocks[i].id, blocks[j].id)
    assert HULL_PAD_M > 0


def test_blocks_are_identical_across_site_modes(site):
    rep = load_site(mode="representative")
    frame = real_frame(rep)
    assert frame.mode == "real"
    assert frame.mvps == site.mvps and frame.lat0 == site.lat0 and frame.lon0 == site.lon0
    assert real_frame(site) is site
    real_blocks = control_blocks(site)
    rep_blocks = control_blocks(rep)
    assert [b.mvps for b in rep_blocks] == [b.mvps for b in real_blocks]
    assert [b.id for b in rep_blocks] == [b.id for b in real_blocks]
    assert [b.capacity_mw for b in rep_blocks] == [b.capacity_mw for b in real_blocks]
    assert [b.extent_m for b in rep_blocks] == [b.extent_m for b in real_blocks]
    assert all(50.0 < b.capacity_mw < 170.0 for b in rep_blocks)
    dlat, dlon = REPRESENTATIVE_OFFSET
    for a, b in zip(real_blocks, rep_blocks, strict=True):
        # Generic "Zone k" names index the same zone points as the real names; the
        # per-zone numbering may differ because two real label points share a name.
        assert b.zone.startswith("Zone ")
        assert site.zones[int(b.zone.split()[1]) - 1]["name"] == a.zone
        assert b.label.startswith(b.zone)
        assert abs(b.centroid_lonlat[0] - a.centroid_lonlat[0] - dlon) < 1e-9
        assert abs(b.centroid_lonlat[1] - a.centroid_lonlat[1] - dlat) < 1e-9
        for (lon_b, lat_b), (lon_a, lat_a) in zip(b.hull_lonlat, a.hull_lonlat, strict=True):
            assert abs(lon_b - lon_a - dlon) < 1e-9 and abs(lat_b - lat_a - dlat) < 1e-9
    xs = [b.centroid_xy[0] for b in rep_blocks]
    assert xs == sorted(xs)


def test_get_blocks_is_keyed_on_site_geometry(site):
    first = get_blocks(site)
    assert first == control_blocks(site)
    assert get_blocks(site)[0] is first[0]                     # cached, not recomputed
    assert get_blocks(load_site(mode="real"))[0] is first[0]   # same geometry, same cache entry
    rep = get_blocks(load_site(mode="representative"))
    assert rep[0].zone.startswith("Zone ") and rep[0] is not first[0]
    # A modified fixture must get its own blocks, not the default site's.
    subset = replace(site, mvps=site.mvps[:200])
    sub_blocks = get_blocks(subset)
    assert sorted(n for b in sub_blocks for n in b.mvps) == sorted(p["n"] for p in subset.mvps)
    assert mvps_block_index(subset, sub_blocks).count(-1) == 0
