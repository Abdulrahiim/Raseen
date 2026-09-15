"""Loss ledger: named energy loss accounting with a closure check.

Every stage of the chain registers its loss energy; the ledger verifies that
``gross - sum(losses) - net`` closes to within tolerance, so no energy is
silently created or destroyed between aggregation levels.
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: Relative closure tolerance for the energy balance.
CLOSURE_RTOL = 1e-6


class EnergyBalanceError(Exception):
    """Raised when the loss ledger does not close."""


@dataclass
class LossLedger:
    """Accumulates loss energies [Wh] for one simulation run."""

    gross_energy_wh: float
    losses: dict[str, float] = field(default_factory=dict)

    def add(self, name: str, energy_wh: float) -> None:
        """Register a loss term; negative losses are rejected."""
        if energy_wh < 0.0:
            msg = f"loss '{name}' is negative ({energy_wh} Wh)"
            raise EnergyBalanceError(msg)
        self.losses[name] = self.losses.get(name, 0.0) + energy_wh

    def total_losses_wh(self) -> float:
        """Sum of all registered loss energies."""
        return sum(self.losses.values())

    def check_closure(self, net_energy_wh: float) -> None:
        """Verify gross - losses == net within tolerance."""
        expected_net = self.gross_energy_wh - self.total_losses_wh()
        scale = max(abs(self.gross_energy_wh), 1.0)
        if abs(expected_net - net_energy_wh) > CLOSURE_RTOL * scale:
            msg = (
                f"energy balance does not close: gross={self.gross_energy_wh:.3f} Wh, "
                f"losses={self.total_losses_wh():.3f} Wh, "
                f"net={net_energy_wh:.3f} Wh, "
                f"expected net={expected_net:.3f} Wh"
            )
            raise EnergyBalanceError(msg)

    def as_dict(self) -> dict[str, float]:
        """Ledger content as a plain dictionary (for reports)."""
        return {"gross_energy_wh": self.gross_energy_wh, **self.losses}
