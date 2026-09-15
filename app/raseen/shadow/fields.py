"""Shadow fields over the plant, evaluated per MVPS.

A field answers two questions at time ``t`` (minutes from fence contact): how much of
each station is shaded (ground truth, honouring stall/deepen perturbations) and when
the shadow *would* arrive if the front kept its planned motion (what the nowcast
believes until it detects otherwise).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from raseen.geometry.projection import extent_m, perpendicular, project, sp_to_xy
from raseen.geometry.site import Site

INF = float("inf")
#: Width over which coverage rises from 0 to 1 as an edge crosses a station.
EDGE_M = 150.0
#: Thin band (design case D2): two abstract columns of 800 m.
THIN_BAND_M = 1600.0
#: Margin the drawn band extends beyond the plant across the heading.
DRAW_MARGIN_M = 600.0
SCATTERED_CLOUDS = 12


def smooth01(u: float) -> float:
    """Smoothstep clamped to [0, 1]."""
    if u <= 0.0:
        return 0.0
    if u >= 1.0:
        return 1.0
    return u * u * (3.0 - 2.0 * u)


@dataclass
class FrontField:
    """A band of shadow (solid front or thin band) moving along the heading."""

    heading_deg: float
    s: list[float]
    p: list[float]
    v_m_min: float
    depth: float
    band_len_m: float
    tau_min: float
    stall_at: float | None = None
    deepen_at: float | None = None
    deepen_factor: float = 1.0
    s_min: float = field(init=False)
    p_min: float = field(init=False)
    p_max: float = field(init=False)

    def __post_init__(self) -> None:
        self.s_min = min(self.s)
        self.p_min = min(self.p)
        self.p_max = max(self.p)

    def _lead(self, t: float, planned: bool) -> float:
        tt = t if (planned or self.stall_at is None) else min(t, self.stall_at)
        return self.s_min + self.v_m_min * tt

    def depth_at(self, t: float) -> float:
        if self.deepen_at is not None and t >= self.deepen_at:
            return self.depth * self.deepen_factor
        return self.depth

    def coverage(self, t: float) -> list[float]:
        lead = self._lead(t, planned=False)
        trail = lead - self.band_len_m
        return [
            smooth01((lead - si) / EDGE_M) * smooth01((si - trail) / EDGE_M) for si in self.s
        ]

    def eta_planned(self, t: float) -> list[float]:
        lead = self._lead(t, planned=True)
        return [(si - lead) / self.v_m_min for si in self.s]

    def polygons_sp(self, t: float) -> list[list[tuple[float, float]]]:
        lead = self._lead(t, planned=False)
        trail = lead - self.band_len_m
        lo, hi = self.p_min - DRAW_MARGIN_M, self.p_max + DRAW_MARGIN_M
        return [[(trail, lo), (lead, lo), (lead, hi), (trail, hi)]]


@dataclass
class ScatteredField:
    """Scattered cumulus: ellipses drifting along the heading (design case D3)."""

    heading_deg: float
    s: list[float]
    p: list[float]
    v_m_min: float
    depth: float
    tau_min: float
    #: (centre_s_at_t0, centre_p, semi_along, semi_across)
    clouds: list[tuple[float, float, float, float]]
    stall_at: float | None = None
    deepen_at: float | None = None
    deepen_factor: float = 1.0
    s_min: float = field(init=False)
    p_min: float = field(init=False)
    p_max: float = field(init=False)

    def __post_init__(self) -> None:
        self.s_min = min(self.s)
        self.p_min = min(self.p)
        self.p_max = max(self.p)

    def _centre(self, c0: float, t: float, planned: bool) -> float:
        tt = t if (planned or self.stall_at is None) else min(t, self.stall_at)
        return c0 + self.v_m_min * tt

    def depth_at(self, t: float) -> float:
        if self.deepen_at is not None and t >= self.deepen_at:
            return self.depth * self.deepen_factor
        return self.depth

    def coverage(self, t: float) -> list[float]:
        out = []
        for si, pi in zip(self.s, self.p, strict=True):
            best = 0.0
            for c0, pc, a, b in self.clouds:
                c = self._centre(c0, t, planned=False)
                r = math.hypot((si - c) / a, (pi - pc) / b)
                best = max(best, smooth01((1.0 - r) * a / EDGE_M))
            out.append(best)
        return out

    def eta_planned(self, t: float) -> list[float]:
        out = []
        for si, pi in zip(self.s, self.p, strict=True):
            best = INF
            covered = False
            for c0, pc, a, b in self.clouds:
                dp = pi - pc
                if abs(dp) >= b:
                    continue
                half = a * math.sqrt(1.0 - (dp / b) ** 2)
                c = self._centre(c0, t, planned=True)
                lead, trail = c + half, c - half
                if trail <= si <= lead:
                    covered = True
                    break
                if si > lead:
                    best = min(best, (si - lead) / self.v_m_min)
            out.append(0.0 if covered else best)
        return out

    def polygons_sp(self, t: float) -> list[list[tuple[float, float]]]:
        polys = []
        for c0, pc, a, b in self.clouds:
            c = self._centre(c0, t, planned=False)
            polys.append(
                [
                    (c + a * math.cos(k * math.pi / 12), pc + b * math.sin(k * math.pi / 12))
                    for k in range(24)
                ]
            )
        return polys


def build_field(
    site: Site,
    *,
    event: str,
    heading_deg: float,
    speed_kmh: float,
    depth: float,
    plateau_min: float = 40.0,
    seed: int = 1,
    stall_at: float | None = None,
    deepen_at: float | None = None,
    deepen_factor: float = 1.0,
) -> FrontField | ScatteredField:
    xy = site.mvps_xy()
    s = project(xy, heading_deg)
    p = perpendicular(xy, heading_deg)
    v = speed_kmh * 1000.0 / 60.0
    tau = extent_m(xy, heading_deg) / v
    common = dict(
        heading_deg=heading_deg, s=s, p=p, v_m_min=v, depth=depth, tau_min=tau,
        stall_at=stall_at, deepen_at=deepen_at, deepen_factor=deepen_factor,
    )
    if event == "solid":
        return FrontField(band_len_m=(tau + plateau_min) * v, **common)
    if event == "thin":
        return FrontField(band_len_m=THIN_BAND_M, **common)
    if event == "scattered":
        rng = random.Random(seed)
        s_min, p_min, p_max = min(s), min(p), max(p)
        clouds = []
        for _ in range(SCATTERED_CLOUDS):
            a = rng.uniform(400.0, 1200.0)
            b = rng.uniform(300.0, 900.0)
            c0 = s_min - rng.uniform(3.0, 35.0) * v
            pc = rng.uniform(p_min, p_max)
            clouds.append((c0, pc, a, b))
        return ScatteredField(clouds=clouds, **common)
    raise ValueError(f"unknown event {event!r}; choose solid, thin or scattered")


def cloud_polygons(
    field_: FrontField | ScatteredField, site: Site, t: float
) -> list[list[list[float]]]:
    """Cloud outlines at time t as lon/lat rings (not closed), for drawing."""
    rings = []
    for poly in field_.polygons_sp(t):
        ring = []
        for s_, p_ in poly:
            x, y = sp_to_xy(s_, p_, field_.heading_deg)
            lon, lat = site.to_lonlat(x, y)
            ring.append([round(lon, 6), round(lat, 6)])
        rings.append(ring)
    return rings
