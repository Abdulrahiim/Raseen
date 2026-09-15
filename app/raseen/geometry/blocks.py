"""Group the 363 MVPS into 30 control blocks.

The abstract reference plant reasons about 30 × 100 MW blocks. On the real layout the blocks are
30 contiguous clusters of unequal size (7–17 stations, 58–141 MW). Clustering is
deterministic: farthest-point seeding from the western-most station, then Lloyd
iterations, so every run, machine and test sees the same blocks.

Every geometric step (clustering, west → east ordering, hulls, extents) runs in the
*real-mode frame*: local metres about the real site centre. A representative-mode site
is un-shifted into that frame first, so both modes yield the same partition, ids and
capacities; only zone names and the lon/lat outputs differ, by exactly the
representative offset.

Block hulls are the convex hull of the member stations buffered outward by
``HULL_PAD_M`` (a Minkowski sum with a regular polygon), so they stay convex, contain
every member station with clearance, and never overlap a neighbouring block.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass

from raseen.geometry.site import MVPS_MW, REPRESENTATIVE_OFFSET, Site

K_BLOCKS = 30
MAX_ITERS = 200
#: Outward clearance of every block hull (metres). MVPS nearest-neighbour spacing is
#: 165–480 m and the two closest block hulls are ~118 m apart, so 55 m per side keeps
#: every block fill disjoint while the block still reads as an area, not a line.
HULL_PAD_M = 55.0
#: Number of directions used to round the buffered hull corners.
HULL_PAD_SIDES = 12


def kmeans(points: list[tuple[float, float]], k: int, iters: int = MAX_ITERS) -> list[int]:
    """Deterministic k-means. Returns a cluster label per point."""
    n = len(points)
    if k > n:
        raise ValueError("more clusters than points")
    start = min(range(n), key=lambda i: (points[i][0], points[i][1]))
    centres = [points[start]]
    dmin = [math.dist(p, points[start]) for p in points]
    for _ in range(k - 1):
        j = max(range(n), key=lambda i: (dmin[i], -i))
        centres.append(points[j])
        for i, p in enumerate(points):
            dmin[i] = min(dmin[i], math.dist(p, points[j]))

    labels = [-1] * n
    for _ in range(iters):
        new = [min(range(k), key=lambda c: (math.dist(p, centres[c]), c)) for p in points]
        counts = Counter(new)
        for c in range(k):
            if counts[c] == 0:
                # Donate the farthest member of the largest cluster. While any cluster is
                # empty, n >= k guarantees (pigeonhole) some cluster holds >= 2 points, so the
                # donor never empties and no earlier-checked cluster can become empty.
                big = max(
                    (cc for cc in range(k) if counts[cc] >= 2), key=lambda cc: (counts[cc], -cc)
                )
                members = [i for i in range(n) if new[i] == big]
                far = max(members, key=lambda i: (math.dist(points[i], centres[big]), -i))
                new[far] = c
                counts[c] += 1
                counts[big] -= 1
        if new == labels:
            break
        labels = new
        for c in range(k):
            members = [points[i] for i in range(n) if labels[i] == c]
            centres[c] = (
                sum(p[0] for p in members) / len(members),
                sum(p[1] for p in members) / len(members),
            )
    return labels


def convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Andrew monotone chain. Returns the hull counter-clockwise without repeating the start."""
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def buffer_hull(
    hull: list[tuple[float, float]], pad: float, sides: int = HULL_PAD_SIDES
) -> list[tuple[float, float]]:
    """Offset a convex hull outward by ``pad`` (Minkowski sum with a regular ``sides``-gon).

    The result is convex and counter-clockwise, every input vertex lies at least
    ``pad * cos(pi / sides)`` inside it, and nothing sticks out further than ``pad``.
    Degenerate one- or two-point hulls become a small polygon or a capsule, so a block
    always has an area.
    """
    if pad <= 0:
        return convex_hull(list(hull))
    ring = [
        (pad * math.cos(2 * math.pi * s / sides), pad * math.sin(2 * math.pi * s / sides))
        for s in range(sides)
    ]
    return convex_hull([(x + dx, y + dy) for x, y in hull for dx, dy in ring])


def real_frame(site: Site) -> Site:
    """``site`` with the representative offset removed: the frame every block is built in.

    In real mode this is ``site`` itself. In representative mode the stations and zone
    points are shifted back by ``REPRESENTATIVE_OFFSET`` (rounded to the same 6 decimals
    ``load_site`` uses, so the values are bit-identical to the real-mode site) and the
    local-metre origin is recomputed, giving exactly the real-mode metric. Zone names are
    kept as the site has them; line geometry is not carried.
    """
    if site.mode == "real":
        return site
    dlat, dlon = REPRESENTATIVE_OFFSET

    def unshift(lat: float, lon: float) -> tuple[float, float]:
        return (round(lat - dlat, 6), round(lon - dlon, 6))

    mvps = []
    for p in site.mvps:
        lat, lon = unshift(p["lat"], p["lon"])
        mvps.append({"n": p["n"], "lat": lat, "lon": lon})
    zones = []
    for z in site.zones:
        lat, lon = unshift(z["lat"], z["lon"])
        zones.append({"name": z["name"], "lat": lat, "lon": lon})
    lats = [p["lat"] for p in mvps]
    lons = [p["lon"] for p in mvps]
    bounds = {"south": min(lats), "north": max(lats), "west": min(lons), "east": max(lons)}
    return Site(
        note=site.note, mode="real", bounds=bounds, mvps=mvps, zones=zones, lines=[],
        lat0=(bounds["south"] + bounds["north"]) / 2, lon0=(bounds["west"] + bounds["east"]) / 2,
    )


@dataclass(frozen=True)
class ControlBlock:
    id: str
    label: str
    zone: str
    mvps: tuple[int, ...]
    mvps_index: tuple[int, ...]
    capacity_mw: float
    centroid_xy: tuple[float, float]
    centroid_lonlat: tuple[float, float]
    hull_lonlat: tuple[tuple[float, float], ...]
    extent_m: tuple[float, float]


def control_blocks(site: Site, k: int = K_BLOCKS) -> list[ControlBlock]:
    """Cluster the site's MVPS into ``k`` blocks, numbered west → east by centroid.

    Clustering, ordering, hulls and ``extent_m`` are computed in the real-mode frame (see
    ``real_frame``) so every site mode yields the same partition, ids and capacities.
    ``centroid_xy`` is in the passed site's own local metres; ``centroid_lonlat`` and
    ``hull_lonlat`` are in the passed site's coordinates (offset in representative mode).
    """
    frame = real_frame(site)
    dlat, dlon = (0.0, 0.0) if frame is site else REPRESENTATIVE_OFFSET

    def to_site_lonlat(x: float, y: float) -> tuple[float, float]:
        lon, lat = frame.to_lonlat(x, y)
        return (lon + dlon, lat + dlat)

    xy = frame.mvps_xy()
    labels = kmeans(xy, k)
    zone_xy = [frame.to_local(z["lat"], z["lon"]) for z in frame.zones]

    def nearest_zone(p: tuple[float, float]) -> str:
        j = min(range(len(zone_xy)), key=lambda i: (math.dist(p, zone_xy[i]), i))
        return frame.zones[j]["name"]

    clusters = []
    for c in range(k):
        idx = tuple(i for i in range(len(xy)) if labels[i] == c)
        cx = sum(xy[i][0] for i in idx) / len(idx)
        cy = sum(xy[i][1] for i in idx) / len(idx)
        clusters.append((cx, cy, idx))
    clusters.sort(key=lambda t: (t[0], t[1]))

    per_zone: Counter[str] = Counter()
    blocks: list[ControlBlock] = []
    for order, (cx, cy, idx) in enumerate(clusters, start=1):
        zone = Counter(nearest_zone(xy[i]) for i in idx).most_common(1)[0][0]
        per_zone[zone] += 1
        padded = buffer_hull(convex_hull([xy[i] for i in idx]), HULL_PAD_M)
        hull_ll = tuple(to_site_lonlat(px, py) for px, py in padded)
        w = max(px for px, _ in padded) - min(px for px, _ in padded)
        h = max(py for _, py in padded) - min(py for _, py in padded)
        c_lonlat = to_site_lonlat(cx, cy)
        c_xy = (cx, cy) if frame is site else site.to_local(c_lonlat[1], c_lonlat[0])
        blocks.append(
            ControlBlock(
                id=f"B{order:02d}",
                label=f"{zone} · {per_zone[zone]}",
                zone=zone,
                mvps=tuple(site.mvps[i]["n"] for i in idx),
                mvps_index=idx,
                capacity_mw=len(idx) * MVPS_MW,
                centroid_xy=c_xy,
                centroid_lonlat=c_lonlat,
                hull_lonlat=hull_ll,
                extent_m=(w, h),
            )
        )
    return blocks


#: Blocks per distinct site geometry (mode, stations, zones), so a site loaded from another
#: path or a modified fixture never receives the default site's blocks.
_BLOCK_CACHE: dict[tuple, tuple[ControlBlock, ...]] = {}
_BLOCK_CACHE_MAX = 8


def _geometry_key(site: Site) -> tuple:
    return (
        site.mode,
        tuple((p["n"], p["lat"], p["lon"]) for p in site.mvps),
        tuple((z["name"], z["lat"], z["lon"]) for z in site.zones),
    )


def get_blocks(site: Site) -> list[ControlBlock]:
    """The blocks for ``site``, computed once per distinct site geometry.

    The cache key is the site's mode, stations and zone points, not just its mode, so the
    blocks always belong to the ``Site`` instance passed in.
    """
    key = _geometry_key(site)
    blocks = _BLOCK_CACHE.get(key)
    if blocks is None:
        if len(_BLOCK_CACHE) >= _BLOCK_CACHE_MAX:
            _BLOCK_CACHE.pop(next(iter(_BLOCK_CACHE)))
        blocks = _BLOCK_CACHE[key] = tuple(control_blocks(site))
    return list(blocks)


def blocks_payload(blocks: list[ControlBlock]) -> list[dict]:
    return [
        {
            "id": b.id,
            "label": b.label,
            "zone": b.zone,
            "mvps": list(b.mvps),
            "capacity_mw": round(b.capacity_mw, 2),
            "centroid": [round(b.centroid_lonlat[0], 6), round(b.centroid_lonlat[1], 6)],
            "hull": [[round(lon, 6), round(lat, 6)] for lon, lat in b.hull_lonlat],
            "extent_m": [round(b.extent_m[0]), round(b.extent_m[1])],
        }
        for b in blocks
    ]


def mvps_block_index(site: Site, blocks: list[ControlBlock]) -> list[int]:
    """For each MVPS in ``site.mvps`` order, the index of the block that contains it."""
    index = [-1] * len(site.mvps)
    for bi, b in enumerate(blocks):
        for i in b.mvps_index:
            index[i] = bi
    return index
