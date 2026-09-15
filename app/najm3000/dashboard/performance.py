"""Expected-vs-actual comparison for the pre-commissioning dashboard.

Comparing physics *expected* output against *measured* output is the core value
a commissioned digital twin delivers. NAJM-3000 has no measured data, so the
"actual" channel here is the physics output with measurement effects applied.

**It is a simulated measurement, and is labeled as one everywhere it appears.**
Comparing the model against a channel derived from the model measures nothing
about reality: it demonstrates the comparison machinery, not plant performance.
Calibration remains a Sprint 9 activity requiring real telemetry.

The effects are deterministic, seeded from the block id, so a run is
reproducible and the same station always behaves the same way.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, replace

import pandas as pd

#: Label carried by the simulated measurement channel wherever it is shown.
MEASURED_LABEL = "SIMULATED MEASUREMENT — NOT REAL TELEMETRY"

#: Irradiance at standard test conditions, for the performance ratio.
G_STC_W_PER_M2 = 1000.0


def deviation_percent(actual: float, expected: float) -> float | None:
    """Percentage difference of actual against expected.

    Returns ``None`` where expected output is zero — at night the ratio is
    meaningless, and reporting a large percentage of nothing would be noise.
    """
    if expected == 0.0:
        return None
    return (actual - expected) / expected * 100.0


def performance_ratio(
    energy_kwh: float, poa_kwh_per_m2: float, installed_kw: float
) -> float | None:
    """Performance ratio: delivered energy over irradiance-implied energy.

    ``PR = E / (H_poa * P_stc / G_stc)``, the standard IEC 61724 form with
    ``H_poa`` in kWh/m², ``P_stc`` the installed DC capacity in kW, and
    ``G_stc`` 1 kW/m². Undefined without irradiation or capacity.
    """
    if poa_kwh_per_m2 <= 0.0 or installed_kw <= 0.0:
        return None
    reference = poa_kwh_per_m2 * installed_kw / (G_STC_W_PER_M2 / 1000.0)
    if reference == 0.0:
        return None
    return energy_kwh / reference


def _unit_hash(*parts: str) -> float:
    """Stable value in [0, 1) from the given strings.

    ``hash()`` is salted per process, so it cannot be used where a run must
    reproduce across sessions and machines.
    """
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


@dataclass(frozen=True)
class MeasurementModel:
    """Applies plausible measurement effects to a physics output series.

    Three effects, each with a documented reason:

    * **Persistent block bias** — no two stations perform identically, and a
      real fleet shows a spread against a single model.
    * **Time-varying noise** — instrumentation and inverter telemetry are not
      noiseless.
    * **One degraded station** — a fleet with no underperformer gives the
      comparison nothing to find. It is chosen deterministically and reported,
      never hidden.

    The channel runs slightly *below* the model on average. A simulated
    measurement that beat the physics would flatter the twin.
    """

    #: Mean shortfall applied to every station.
    base_shortfall: float = 0.015

    #: Half-width of the persistent per-station bias.
    block_bias: float = 0.02

    #: Half-width of the time-varying noise.
    noise: float = 0.012

    #: Additional shortfall on the single degraded station.
    degraded_shortfall: float = 0.06

    #: Envelope the combined effects must stay inside.
    max_deviation: float = 0.12

    #: Station carrying the extra shortfall. Set via :meth:`for_plant` so a
    #: caller cannot forget to mark it and end up with a fleet that has no
    #: underperformer at all.
    degraded_block_id: str | None = None

    @property
    def label(self) -> str:
        """Label for the channel this model produces."""
        return MEASURED_LABEL

    def for_plant(self, block_ids: list[str]) -> MeasurementModel:
        """Bind the model to a plant, choosing which station is degraded."""
        return replace(self, degraded_block_id=self.degraded_block(block_ids))

    def degraded_block(self, block_ids: list[str]) -> str | None:
        """The station carrying the extra shortfall, chosen deterministically."""
        if not block_ids:
            return None
        ordered = sorted(block_ids)
        index = int(_unit_hash("degraded", str(len(ordered))) * len(ordered))
        return ordered[min(index, len(ordered) - 1)]

    def factor(self, block_id: str, step: int, degraded: bool = False) -> float:
        """Combined measurement factor for one station at one timestep."""
        bias = (_unit_hash("bias", block_id) * 2.0 - 1.0) * self.block_bias
        wobble = math.sin(step * 0.7 + _unit_hash("phase", block_id) * math.tau)
        jitter = wobble * self.noise
        shortfall = self.base_shortfall + (self.degraded_shortfall if degraded else 0.0)
        factor = 1.0 - shortfall + bias + jitter
        lower = 1.0 - self.max_deviation
        upper = 1.0 + self.max_deviation
        return min(max(factor, lower), upper)

    def is_degraded(self, block_id: str) -> bool:
        """Whether this station carries the extra shortfall."""
        return self.degraded_block_id is not None and block_id == self.degraded_block_id

    def apply(
        self, block_id: str, expected: pd.Series, degraded: bool | None = None
    ) -> pd.Series:
        """Return the simulated measured series for one station.

        Zero stays zero: no noise may invent generation at night.
        """
        flag = self.is_degraded(block_id) if degraded is None else degraded
        factors = [
            self.factor(block_id, step, flag) for step in range(len(expected))
        ]
        measured = expected.to_numpy(dtype=float) * factors
        result = pd.Series(measured, index=expected.index, name="measured")
        return result.where(expected != 0.0, 0.0).clip(lower=0.0)


@dataclass(frozen=True)
class ComparisonSummary:
    """Expected against simulated-measured for one station over one day."""

    block_id: str
    expected_energy_kwh: float
    measured_energy_kwh: float
    deviation_percent: float | None
    expected_pr: float | None
    measured_pr: float | None
    poa_kwh_per_m2: float
    installed_kw: float
    degraded: bool
    label: str = MEASURED_LABEL

    def as_dict(self) -> dict[str, object]:
        """Serialisable form for the API."""
        return {
            "block_id": self.block_id,
            "expected_energy_kwh": self.expected_energy_kwh,
            "measured_energy_kwh": self.measured_energy_kwh,
            "deviation_percent": self.deviation_percent,
            "expected_pr": self.expected_pr,
            "measured_pr": self.measured_pr,
            "poa_kwh_per_m2": self.poa_kwh_per_m2,
            "installed_kw": self.installed_kw,
            "degraded": self.degraded,
            "measurement_label": self.label,
        }


def summarise(
    block_id: str,
    expected_power_w: pd.Series,
    measured_power_w: pd.Series,
    poa_w_per_m2: pd.Series,
    installed_kw: float,
    timestep_hours: float,
    degraded: bool = False,
) -> ComparisonSummary:
    """Energy, deviation and performance ratio for one station."""
    expected_kwh = float(expected_power_w.clip(lower=0.0).sum()) * timestep_hours / 1e3
    measured_kwh = float(measured_power_w.clip(lower=0.0).sum()) * timestep_hours / 1e3
    poa_kwh = float(poa_w_per_m2.clip(lower=0.0).sum()) * timestep_hours / 1e3

    return ComparisonSummary(
        block_id=block_id,
        expected_energy_kwh=expected_kwh,
        measured_energy_kwh=measured_kwh,
        deviation_percent=deviation_percent(measured_kwh, expected_kwh),
        expected_pr=performance_ratio(expected_kwh, poa_kwh, installed_kw),
        measured_pr=performance_ratio(measured_kwh, poa_kwh, installed_kw),
        poa_kwh_per_m2=poa_kwh,
        installed_kw=installed_kw,
        degraded=degraded,
    )
