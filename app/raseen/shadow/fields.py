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
#: Softness widens every coverage ramp by up to this factor (EDGE_M → 4 × EDGE_M = 600 m).
#: A CHOSEN DEMO CONVENTION, not a measured cloud property — the model is not calibrated.
SOFT_EDGE_GAIN = 3.0
#: Softness also caps peak coverage at 1 − 0.6 × softness, so a fully soft cloud removes 40 %
#: of what the same deck would remove opaque. Also a chosen convention, not an observation.
SOFT_PEAK_DROP = 0.6


def smooth01(u: float) -> float:
    """Smoothstep clamped to [0, 1]."""
    if u <= 0.0:
        return 0.0
    if u >= 1.0:
        return 1.0
    return u * u * (3.0 - 2.0 * u)


def soft_edge_m(softness: float) -> float:
    """Width over which coverage ramps, widened by ``softness`` (0 → EDGE_M)."""
    return EDGE_M * (1.0 + SOFT_EDGE_GAIN * softness)


def soft_peak(softness: float) -> float:
    """Deepest coverage a cloud of this ``softness`` reaches (0 → 1.0, fully opaque)."""
    return 1.0 - SOFT_PEAK_DROP * softness


@dataclass
class FrontField:
    """A band of shadow (solid front or thin band) moving along the heading.

    The band is finite across the heading too: it only shades stations whose ``p`` lies in
    ``[band_lo, band_hi]``. Left unset (``p_lo``/``p_hi`` = None) that window spans the whole
    plant plus ``DRAW_MARGIN_M``, which is the full-width front.
    """

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
    #: Across-heading limits of the band; None on either side means "out to the plant edge".
    p_lo: float | None = None
    p_hi: float | None = None
    softness: float = 0.0
    s_min: float = field(init=False)
    p_min: float = field(init=False)
    p_max: float = field(init=False)
    band_lo: float = field(init=False)
    band_hi: float = field(init=False)
    edge_m: float = field(init=False)
    peak: float = field(init=False)

    def __post_init__(self) -> None:
        self.s_min = min(self.s)
        self.p_min = min(self.p)
        self.p_max = max(self.p)
        # Full width: push the band edge at least one ramp width clear of the array so the
        # outermost rows sit at across() == 1 for ANY softness (never relying on
        # DRAW_MARGIN_M happening to equal the widest ramp).
        margin = max(DRAW_MARGIN_M, soft_edge_m(self.softness))
        lo = self.p_min - margin if self.p_lo is None else self.p_lo
        hi = self.p_max + margin if self.p_hi is None else self.p_hi
        self.band_lo, self.band_hi = min(lo, hi), max(lo, hi)
        self.edge_m = soft_edge_m(self.softness)
        self.peak = soft_peak(self.softness)

    def _lead(self, t: float, planned: bool) -> float:
        tt = t if (planned or self.stall_at is None) else min(t, self.stall_at)
        return self.s_min + self.v_m_min * tt

    def across(self, pi: float) -> float:
        """Across-heading window at ``pi``: 0 outside the band, 1 well inside it."""
        return smooth01((pi - self.band_lo) / self.edge_m) * smooth01(
            (self.band_hi - pi) / self.edge_m
        )

    def depth_at(self, t: float) -> float:
        if self.deepen_at is not None and t >= self.deepen_at:
            return self.depth * self.deepen_factor
        return self.depth

    def coverage(self, t: float) -> list[float]:
        lead = self._lead(t, planned=False)
        trail = lead - self.band_len_m
        e = self.edge_m
        return [
            self.peak
            * smooth01((lead - si) / e)
            * smooth01((si - trail) / e)
            * self.across(pi)
            for si, pi in zip(self.s, self.p, strict=True)
        ]

    def eta_planned(self, t: float) -> list[float]:
        """Minutes until the band reaches each station; INF where it never will.

        A station outside the across-heading window is never darkened by this cloud, so its
        ETA is infinite — reporting 0 or a finite value would make the controller curtail a
        block that keeps full sun, which is exactly the headroom the unshaded plant carries.
        """
        lead = self._lead(t, planned=True)
        return [
            (si - lead) / self.v_m_min if self.across(pi) > 0.0 else INF
            for si, pi in zip(self.s, self.p, strict=True)
        ]

    def polygons_sp(self, t: float) -> list[list[tuple[float, float]]]:
        lead = self._lead(t, planned=False)
        trail = lead - self.band_len_m
        lo, hi = self.band_lo, self.band_hi
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
    softness: float = 0.0
    s_min: float = field(init=False)
    p_min: float = field(init=False)
    p_max: float = field(init=False)
    edge_m: float = field(init=False)
    peak: float = field(init=False)

    def __post_init__(self) -> None:
        self.s_min = min(self.s)
        self.p_min = min(self.p)
        self.p_max = max(self.p)
        self.edge_m = soft_edge_m(self.softness)
        self.peak = soft_peak(self.softness)

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
                best = max(best, smooth01((1.0 - r) * a / self.edge_m))
            out.append(self.peak * best)
        return out

    def eta_planned(self, t: float) -> list[float]:
        """Minutes until a cloud reaches each station; INF for stations no cloud ever reaches.

        Softness blurs the edges but does not move them: the support of ``coverage`` is still
        the ellipse ``r < 1``, so the never-covered test below stays exact.
        """
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
    cover_frac: float = 1.0,
    cover_offset: float = 0.0,
    softness: float = 0.0,
) -> FrontField | ScatteredField:
    xy = site.mvps_xy()
    s = project(xy, heading_deg)
    p = perpendicular(xy, heading_deg)
    v = speed_kmh * 1000.0 / 60.0
    tau = extent_m(xy, heading_deg) / v
    common = dict(
        heading_deg=heading_deg, s=s, p=p, v_m_min=v, depth=depth, tau_min=tau,
        stall_at=stall_at, deepen_at=deepen_at, deepen_factor=deepen_factor,
        softness=softness,
    )
    # cover_frac is a fraction of the PLANT's across-heading extent and names the width of the
    # fully-shaded core; the band limits add one ramp width each side, so across() reaches 1.0
    # exactly at the core edges. cover_offset slides that core within the plant, so at ±1 it
    # sits flush against a real array edge rather than hanging off into empty ground.
    # cover_frac >= 1 leaves the limits unset, which is the legacy full-width band.
    p_lo = p_hi = None
    if cover_frac < 1.0:
        lo_p, hi_p = min(p), max(p)
        span = hi_p - lo_p
        core = span * cover_frac
        centre = 0.5 * (lo_p + hi_p) + cover_offset * 0.5 * (span - core)
        ramp = soft_edge_m(softness)
        p_lo, p_hi = centre - 0.5 * core - ramp, centre + 0.5 * core + ramp
    if event == "solid":
        return FrontField(band_len_m=(tau + plateau_min) * v, p_lo=p_lo, p_hi=p_hi, **common)
    if event == "thin":
        return FrontField(band_len_m=THIN_BAND_M, p_lo=p_lo, p_hi=p_hi, **common)
    if event == "scattered":
        rng = random.Random(seed)
        s_min, p_min, p_max = min(s), min(p), max(p)
        # Partial cover on scattered cumulus means the cells only drift over part of the
        # plant, so restrict where their centres are seeded rather than clipping the
        # ellipses — that keeps each cloud a whole cloud and leaves eta_planned exact.
        lo_c, hi_c = (p_min, p_max) if p_lo is None else (p_lo, p_hi)
        clouds = []
        for _ in range(SCATTERED_CLOUDS):
            a = rng.uniform(400.0, 1200.0)
            b = rng.uniform(300.0, 900.0)
            c0 = s_min - rng.uniform(3.0, 35.0) * v
            pc = rng.uniform(lo_c, hi_c)
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
