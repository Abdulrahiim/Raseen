"""Attribute a measured-vs-expected deviation to a cause.

This is deterministic rule-based attribution of the kind PV analytics platforms
use — not machine learning, and it is described that way wherever it appears.

**The engine reads only signals.** It has no access to the fault registry, so
identifying an injected fault is an inference from the signal pattern rather
than a lookup. A test asserts the absence of that import, because that property
is the only reason the feature demonstrates anything.

What it cannot tell you: how it would perform on real telemetry. Demonstrating
inference on synthetic signals says nothing about detection accuracy, and no
output here should be read as a validated diagnosis.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

#: Stated on every finding, so a reader knows what the inference ran on.
BASIS = "Inferred from SIMULATED signals — rule-based attribution, not ML"

#: Below this share of expected output a station counts as offline.
OFFLINE_FRACTION = 0.05

#: Deviation smaller than this is measurement spread, not a finding.
NOISE_FLOOR_PERCENT = 3.0

#: Irradiance below this is night; deviation there is meaningless.
DARK_W_M2 = 20.0

#: Module temperature above which thermal derating is plausible.
HOT_MODULE_C = 60.0


@dataclass(frozen=True)
class StationSignals:
    """Everything the engine is allowed to look at for one station."""

    block_id: str
    expected_kw: pd.Series
    measured_kw: pd.Series
    poa_w_m2: pd.Series
    temp_module_c: pd.Series
    rated_kw: float
    inverters_kw: dict[str, pd.Series] = field(default_factory=dict)


@dataclass(frozen=True)
class Diagnosis:
    """One attributed cause, with the evidence that led to it."""

    block_id: str
    cause: str
    title: str
    severity: str
    confidence: str
    explanation: str
    evidence: list[str]
    deviation_percent: float | None
    basis: str = BASIS

    def as_dict(self) -> dict[str, object]:
        """Serialisable form for the API."""
        return {
            "block_id": self.block_id,
            "cause": self.cause,
            "title": self.title,
            "severity": self.severity,
            "confidence": self.confidence,
            "explanation": self.explanation,
            "evidence": list(self.evidence),
            "deviation_percent": self.deviation_percent,
            "basis": self.basis,
        }


def _daylight(signals: StationSignals) -> pd.Series:
    return signals.poa_w_m2 > DARK_W_M2


def _totals(signals: StationSignals) -> tuple[float, float, float | None]:
    day = _daylight(signals)
    expected = float(signals.expected_kw[day].clip(lower=0.0).sum())
    measured = float(signals.measured_kw[day].clip(lower=0.0).sum())
    deviation = None if expected <= 0.0 else (measured - expected) / expected * 100.0
    return expected, measured, deviation


def diagnose(signals: StationSignals) -> Diagnosis | None:
    """Return the most likely cause of a station's deficit, or None if healthy.

    Rules are ordered most-specific first: a total outage is not also reported
    as an optical loss.
    """
    day = _daylight(signals)
    if not bool(day.any()):
        return None

    expected_kwh, measured_kwh, deviation = _totals(signals)
    if deviation is None or deviation > -NOISE_FLOOR_PERCENT:
        return None

    def build(
        cause: str,
        title: str,
        severity: str,
        confidence: str,
        explanation: str,
        evidence: list[str],
    ) -> Diagnosis:
        return Diagnosis(
            block_id=signals.block_id,
            cause=cause,
            title=title,
            severity=severity,
            confidence=confidence,
            explanation=explanation,
            evidence=evidence,
            deviation_percent=deviation,
        )

    expected_day = signals.expected_kw[day]
    measured_day = signals.measured_kw[day]
    ratio = (measured_day / expected_day.where(expected_day > 0.0)).dropna()

    # 1. Whole station offline through daylight.
    if measured_kwh <= expected_kwh * OFFLINE_FRACTION:
        return build(
            "inverter_offline",
            "Station offline",
            "critical",
            "High",
            f"The station reported {measured_kwh:,.0f} kWh against "
            f"{expected_kwh:,.0f} kWh expected while irradiance was present. "
            f"Output is absent across the whole daylight period, which points "
            f"to the conversion path being down rather than an optical or "
            f"thermal loss.",
            [
                f"Measured {measured_kwh:,.0f} kWh vs expected {expected_kwh:,.0f} kWh",
                f"Peak irradiance {float(signals.poa_w_m2.max()):,.0f} W/m² "
                f"— the resource was available",
                "Deficit spans the full daylight window, not a part of it",
            ],
        )

    # 2. One inverter of several contributing nothing.
    silent = [
        name
        for name, series in signals.inverters_kw.items()
        if float(series[day].clip(lower=0.0).sum()) <= 0.0
    ]
    if silent and len(silent) < len(signals.inverters_kw):
        share = len(silent) / len(signals.inverters_kw) * 100.0
        return build(
            "single_inverter_outage",
            "Inverter outage",
            "critical",
            "High",
            f"{', '.join(silent)} reported no output while the remaining "
            f"units ran normally. That accounts for about {share:.0f}% of "
            f"station capacity and matches the {deviation:.1f}% deficit.",
            [f"{name} produced 0 kWh through daylight" for name in silent]
            + [
                f"{len(signals.inverters_kw) - len(silent)} of "
                f"{len(signals.inverters_kw)} inverters reporting normally",
            ],
        )

    # 3. Intermittent reporting: full output interrupted by dropouts.
    zero_steps = int((measured_day <= 0.0).sum())
    if zero_steps and zero_steps < len(measured_day) * 0.6:
        healthy = ratio[ratio > 0.5]
        if len(healthy) and float(healthy.mean()) > 0.9:
            return build(
                "intermittent_reporting",
                "Intermittent reporting",
                "serious",
                "Medium",
                f"Output alternates between full and zero across "
                f"{zero_steps} intervals while irradiance is steady. When the "
                f"station does report it matches expectation, so this looks "
                f"like a telemetry or communications dropout rather than a "
                f"loss of generation.",
                [
                    f"{zero_steps} zero intervals during daylight",
                    f"Reporting intervals average "
                    f"{float(healthy.mean()) * 100:.0f}% of expected",
                    "No progressive trend — consistent with dropout, not degradation",
                ],
            )

    # 4. Deficit concentrated at high module temperature.
    hot = signals.temp_module_c > HOT_MODULE_C
    if bool((hot & day).any()) and bool((~hot & day).any()):
        hot_ratio = float(ratio[hot.reindex(ratio.index, fill_value=False)].mean())
        cool_ratio = float(ratio[~hot.reindex(ratio.index, fill_value=True)].mean())
        if hot_ratio < cool_ratio - 0.05:
            return build(
                "thermal_derating",
                "Thermal derating",
                "warning",
                "Medium",
                f"The deficit appears only when module temperature exceeds "
                f"{HOT_MODULE_C:.0f} °C. Output holds at "
                f"{cool_ratio * 100:.0f}% of expectation while cool and falls "
                f"to {hot_ratio * 100:.0f}% while hot, which is the signature "
                f"of temperature-driven derating rather than a component fault.",
                [
                    f"Cool intervals at {cool_ratio * 100:.0f}% of expected",
                    f"Hot intervals at {hot_ratio * 100:.0f}% of expected",
                    f"Peak module temperature "
                    f"{float(signals.temp_module_c.max()):.0f} °C",
                ],
            )

    # 5. Deficit proportional to irradiance across the day.
    if len(ratio) >= 4 and float(ratio.std()) < 0.05:
        return build(
            "optical_loss",
            "Optical loss (soiling or degradation)",
            "warning",
            "Medium",
            f"Output tracks {float(ratio.mean()) * 100:.0f}% of expectation "
            f"consistently through the day, scaling with irradiance rather "
            f"than appearing at a particular time or temperature. That is the "
            f"pattern of an optical loss — soiling, shading or module "
            f"degradation — not an equipment failure.",
            [
                f"Ratio to expected steady at "
                f"{float(ratio.mean()) * 100:.0f}% (spread "
                f"{float(ratio.std()) * 100:.1f} points)",
                "Deficit scales with irradiance",
                "No temperature dependence and no dropouts",
            ],
        )

    # 6. A real deficit that fits no rule. Say so rather than guessing.
    return build(
        "unattributed",
        "Deviation not attributed",
        "warning",
        "Low",
        f"The station is {abs(deviation):.1f}% below expectation, but the "
        f"pattern does not match a known signature. It is neither a clean "
        f"outage, a proportional optical loss, nor temperature-linked. This "
        f"needs an engineer.",
        [
            f"Deviation {deviation:.1f}%",
            f"Ratio spread {float(ratio.std()) * 100:.1f} points — "
            f"inconsistent with a single cause",
        ],
    )
