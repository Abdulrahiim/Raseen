"""Demonstration fault injection for the pre-commissioning dashboard.

NAJM-3000 has no operational data, so the dashboard cannot detect anything.
A fault here is **chosen by the presenter**, recorded as presentation state,
and labeled as a demonstration wherever it appears.

Two rules make that safe:

* A fault never touches the physics. It is an overlay on the presentation
  layer, so the loss ledger still closes and the energy balance still holds.
* Severity comes from the catalogue, never from the caller, so a fault cannot
  be dressed up as more or less serious than its type.

``docs/ai_analytics_roadmap.md`` permits synthetic fault demonstrations
provided they are clearly labeled. This module is that provision.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

#: Prefix carried by every injected fault, so no UI can render it as an alarm.
INJECTED_LABEL = "INJECTED — DEMONSTRATION"

#: Severity ranking, most serious last. Names match the reserved status
#: palette; they are never reused for series colours.
SEVERITY_ORDER: tuple[str, ...] = ("warning", "serious", "critical")


class FaultError(Exception):
    """Raised when a fault cannot be injected as requested."""


@dataclass(frozen=True)
class FaultType:
    """One demonstrable failure mode."""

    key: str
    label: str
    severity: str
    asset_kinds: tuple[str, ...]
    description: str


#: Failure modes a presenter may demonstrate, and the assets each can sit on.
FAULT_CATALOGUE: dict[str, FaultType] = {
    fault.key: fault
    for fault in (
        FaultType(
            key="inverter_trip",
            label="Inverter trip",
            severity="critical",
            asset_kinds=("inverter_01", "inverter_02"),
            description="Inverter offline; the station loses that conversion path.",
        ),
        FaultType(
            key="mppt_underperformance",
            label="MPPT underperformance",
            severity="serious",
            asset_kinds=("inverter_01", "inverter_02"),
            description="Inverter tracking away from the maximum power point.",
        ),
        FaultType(
            key="idt_over_temperature",
            label="IDT over-temperature",
            severity="serious",
            asset_kinds=("idt_01",),
            description="Transformer winding temperature above its alarm setting.",
        ),
        FaultType(
            key="rmu_communication_loss",
            label="RMU communication loss",
            severity="warning",
            asset_kinds=("rmu",),
            description="Ring main unit not reporting to the station controller.",
        ),
        FaultType(
            key="string_outage",
            label="String outage",
            severity="warning",
            asset_kinds=("skid", "inverter_01", "inverter_02"),
            description="One or more strings disconnected from the combiner.",
        ),
    )
}


@dataclass(frozen=True)
class InjectedFault:
    """A fault a presenter placed on one asset of one station."""

    block_id: str
    asset: str
    fault_type: str
    label: str
    severity: str
    description: str
    injected_at: str

    def as_dict(self) -> dict[str, str]:
        """Serialisable form for the API."""
        return {
            "block_id": self.block_id,
            "asset": self.asset,
            "fault_type": self.fault_type,
            "label": self.label,
            "severity": self.severity,
            "description": self.description,
            "injected_at": self.injected_at,
            "origin": "injected",
        }


@dataclass
class FaultRegistry:
    """In-memory record of injected faults. Presentation state only."""

    _faults: dict[tuple[str, str], InjectedFault] = field(default_factory=dict)

    def inject(self, block_id: str, asset: str, fault_type: str) -> InjectedFault:
        """Place a fault on one asset, replacing any fault already there."""
        definition = FAULT_CATALOGUE.get(fault_type)
        if definition is None:
            msg = (
                f"unknown fault type '{fault_type}'; "
                f"choose from {sorted(FAULT_CATALOGUE)}"
            )
            raise FaultError(msg)
        if asset not in definition.asset_kinds:
            msg = (
                f"'{definition.label}' cannot apply to '{asset}'; "
                f"it applies to {list(definition.asset_kinds)}"
            )
            raise FaultError(msg)

        fault = InjectedFault(
            block_id=block_id,
            asset=asset,
            fault_type=fault_type,
            label=f"{INJECTED_LABEL}: {definition.label}",
            severity=definition.severity,
            description=definition.description,
            injected_at=datetime.now(UTC).isoformat(timespec="seconds"),
        )
        self._faults[(block_id, asset)] = fault
        return fault

    def clear(self, block_id: str | None = None, asset: str | None = None) -> int:
        """Remove faults; returns how many were removed."""
        doomed = [
            key
            for key in self._faults
            if (block_id is None or key[0] == block_id)
            and (asset is None or key[1] == asset)
        ]
        for key in doomed:
            del self._faults[key]
        return len(doomed)

    def for_block(self, block_id: str) -> list[InjectedFault]:
        """Every fault injected on one station."""
        return [f for (b, _), f in self._faults.items() if b == block_id]

    def all(self) -> list[InjectedFault]:
        """Every fault currently injected."""
        return list(self._faults.values())

    def count(self) -> int:
        """How many faults are injected."""
        return len(self._faults)

    def worst_severity(self, block_id: str) -> str | None:
        """Most serious severity on a station, or None if it is healthy."""
        severities = [f.severity for f in self.for_block(block_id)]
        if not severities:
            return None
        return max(severities, key=SEVERITY_ORDER.index)
