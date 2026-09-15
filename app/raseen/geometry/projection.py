"""Heading geometry. Heading = direction of motion, degrees clockwise from north."""

from __future__ import annotations

import math


def heading_vector(heading_deg: float) -> tuple[float, float]:
    """Unit vector of motion in local (x east, y north) metres. 90° → (1, 0)."""
    th = math.radians(heading_deg)
    return (math.sin(th), math.cos(th))


def project(points_xy: list[tuple[float, float]], heading_deg: float) -> list[float]:
    """Scalar position of each point along the heading (metres)."""
    ux, uy = heading_vector(heading_deg)
    return [x * ux + y * uy for x, y in points_xy]


def perpendicular(points_xy: list[tuple[float, float]], heading_deg: float) -> list[float]:
    """Scalar position across the heading, positive to the left of motion."""
    ux, uy = heading_vector(heading_deg)
    return [-x * uy + y * ux for x, y in points_xy]


def sp_to_xy(s: float, p: float, heading_deg: float) -> tuple[float, float]:
    """Inverse of (project, perpendicular)."""
    ux, uy = heading_vector(heading_deg)
    return (s * ux - p * uy, s * uy + p * ux)


def extent_m(points_xy: list[tuple[float, float]], heading_deg: float) -> float:
    s = project(points_xy, heading_deg)
    return max(s) - min(s)


def crossing_time_min(extent_metres: float, speed_kmh: float) -> float:
    """Minutes for a front to cross ``extent_metres`` at ``speed_kmh``."""
    return extent_metres / (speed_kmh * 1000.0 / 60.0)
