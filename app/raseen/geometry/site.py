"""Load the as-designed site geometry copied from the NAJM-3000 twin.

`site.json` carries 363 MVPS points, 17 zone label points, 5,000 line segments and
the bounds, all derived from the project CAD/KML. Coordinates are real in ``real``
mode; ``representative`` mode offsets the layout into open desert and relabels zones.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from raseen import PLANT_MW

SITE_PATH = Path(__file__).resolve().parents[1] / "web" / "data" / "site.json"

#: (dlat, dlon) in degrees applied in representative mode.
REPRESENTATIVE_OFFSET = (0.85, -1.60)

#: Every MVPS carries an equal share of the plant rating.
MVPS_MW = PLANT_MW / 363


def site_mode() -> str:
    return os.environ.get("RASEEN_SITE_MODE", "real").lower()


@dataclass(frozen=True)
class Site:
    note: str
    mode: str
    bounds: dict[str, float]
    mvps: list[dict]      # {"n": int, "lat": float, "lon": float}
    zones: list[dict]     # {"name": str, "lat": float, "lon": float}
    lines: list[dict]     # {"b": int | None, "pts": [[lat, lon], ...]}
    lat0: float
    lon0: float

    @property
    def mlat(self) -> float:
        return 111_320.0

    @property
    def mlon(self) -> float:
        return 111_320.0 * math.cos(math.radians(self.lat0))

    def to_local(self, lat: float, lon: float) -> tuple[float, float]:
        """Equirectangular metres about the site centre: x east, y north."""
        return ((lon - self.lon0) * self.mlon, (lat - self.lat0) * self.mlat)

    def to_lonlat(self, x: float, y: float) -> tuple[float, float]:
        return (self.lon0 + x / self.mlon, self.lat0 + y / self.mlat)

    def mvps_xy(self) -> list[tuple[float, float]]:
        return [self.to_local(p["lat"], p["lon"]) for p in self.mvps]


def load_site(path: Path = SITE_PATH, mode: str | None = None) -> Site:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    mode = (mode or site_mode()).lower()
    if mode not in ("real", "representative"):
        raise ValueError(f"RASEEN_SITE_MODE must be 'real' or 'representative', got {mode!r}")
    dlat, dlon = (0.0, 0.0) if mode == "real" else REPRESENTATIVE_OFFSET

    def shift(lat: float, lon: float) -> tuple[float, float]:
        return (round(lat + dlat, 6), round(lon + dlon, 6))

    # Keep the CAD station numbers: they run against the 365-station design basis and two
    # of them (224, 307) have no geometry (GAP-019), so `n` is an identifier, not an index.
    mvps = []
    for p in raw["mvps"]:
        lat, lon = shift(p["lat"], p["lon"])
        mvps.append({"n": int(p["n"]), "lat": lat, "lon": lon})
    mvps.sort(key=lambda p: p["n"])

    zones = []
    for i, z in enumerate(raw["zones"]):
        lat, lon = shift(z["lat"], z["lon"])
        name = z["name"] if mode == "real" else f"Zone {i + 1}"
        zones.append({"name": name, "lat": lat, "lon": lon})

    lines = [
        {"b": line.get("b"), "pts": [list(shift(lat, lon)) for lat, lon in line["pts"]]}
        for line in raw["lines"]
    ]

    lats = [p["lat"] for p in mvps]
    lons = [p["lon"] for p in mvps]
    bounds = {"south": min(lats), "north": max(lats), "west": min(lons), "east": max(lons)}
    note = raw["note"]
    if mode != "real":
        note += (
            " Representative mode: the layout is offset from the real site"
            " and zone names are generic."
        )
    return Site(
        note=note, mode=mode, bounds=bounds, mvps=mvps, zones=zones, lines=lines,
        lat0=(bounds["south"] + bounds["north"]) / 2, lon0=(bounds["west"] + bounds["east"]) / 2,
    )


@lru_cache(maxsize=2)
def _cached(mode: str) -> Site:
    return load_site(mode=mode)


def get_site(mode: str | None = None) -> Site:
    """The site for the requested (or environment) mode, loaded once per process."""
    return _cached((mode or site_mode()).lower())
