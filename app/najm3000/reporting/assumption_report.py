"""Assumption report generator.

Cross-references every non-source-backed parameter in the configuration
against the project registers (``ASSUMPTIONS_REGISTER.md`` and
``DATA_GAP_REGISTER.md``) and reports it with the risk level *recorded in the
register*. Risk levels are never invented here — a parameter citing an
assumption ID that is absent from the register is reported as
``UNREGISTERED``, which is a governance failure to be fixed, not a value to be
guessed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from najm3000 import SYNTHETIC_DISCLAIMER
from najm3000.reporting.provenance_report import ProvenanceRow

#: Data quality statuses that require an assumption or gap to be reported.
FLAGGED_STATUSES = frozenset({"Assumed", "Conflicting", "Missing"})

#: Risk label used when a parameter cites an ID that is not in the register.
UNREGISTERED_RISK = "UNREGISTERED"

#: Priority labels defined in the "Gap Priority Levels" table of the register.
GAP_PRIORITY_LABELS = {
    "P1": "P1 — Critical",
    "P2": "P2 — High",
    "P3": "P3 — Medium",
    "P4": "P4 — Low",
}

_ASSUMPTION_ID = re.compile(r"^ASMP-[A-Z0-9-]+$")
_GAP_ID = re.compile(r"^GAP-[A-Z0-9-]+$")


@dataclass(frozen=True)
class AssumptionEntry:
    """One row of the assumptions register."""

    assumption_id: str
    parameter: str
    asset_class: str
    assumed_value: str
    unit: str
    risk: str
    status: str


@dataclass(frozen=True)
class GapEntry:
    """One row of the data gap register."""

    gap_id: str
    category: str
    priority: str
    status: str

    def priority_label(self) -> str:
        """Full priority label per the register's priority table."""
        return GAP_PRIORITY_LABELS.get(self.priority, self.priority)


def _register_table_rows(path: Path) -> list[list[str]]:
    """Return the cells of every data row in the file's ``## Register`` table.

    Only the ``## Register`` section is parsed, so secondary tables (such as
    "Resolved Assumptions") never overwrite the authoritative rows.
    """
    if not path.exists():
        msg = f"register file not found: {path}"
        raise FileNotFoundError(msg)
    rows: list[list[str]] = []
    in_register = False
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            in_register = stripped.lower().startswith("## register")
            continue
        if not in_register or not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if all(set(cell) <= {"-", ":"} for cell in cells if cell):
            continue  # separator row
        rows.append(cells)
    return rows


def parse_assumptions_register(path: Path) -> dict[str, AssumptionEntry]:
    """Parse ``ASSUMPTIONS_REGISTER.md`` into entries keyed by assumption ID."""
    entries: dict[str, AssumptionEntry] = {}
    for cells in _register_table_rows(path):
        if len(cells) < 9 or not _ASSUMPTION_ID.match(cells[0]):
            continue
        entries[cells[0]] = AssumptionEntry(
            assumption_id=cells[0],
            parameter=cells[1],
            asset_class=cells[2],
            assumed_value=cells[3],
            unit=cells[4],
            risk=cells[6],
            status=cells[8],
        )
    return entries


def parse_gap_register(path: Path) -> dict[str, GapEntry]:
    """Parse ``DATA_GAP_REGISTER.md`` into entries keyed by gap ID."""
    entries: dict[str, GapEntry] = {}
    for cells in _register_table_rows(path):
        if len(cells) < 7 or not _GAP_ID.match(cells[0]):
            continue
        entries[cells[0]] = GapEntry(
            gap_id=cells[0],
            category=cells[1],
            priority=cells[5],
            status=cells[6],
        )
    return entries


@dataclass(frozen=True)
class FlaggedParameter:
    """A configured parameter that is not backed by a confirmed source."""

    parameter_path: str
    value: float
    unit: str
    data_quality_status: str
    assumption_id: str | None
    risk: str
    assumption_status: str | None
    gap_id: str | None
    gap_priority: str | None
    notes: str | None


@dataclass(frozen=True)
class AssumptionReport:
    """Every assumed, conflicting, or missing parameter with its risk level."""

    flagged: list[FlaggedParameter]
    unregistered_ids: list[str]
    total_parameters: int

    def high_risk(self) -> list[FlaggedParameter]:
        """Flagged parameters whose registered risk level is High."""
        return [f for f in self.flagged if f.risk == "High"]

    def summary_by_risk(self) -> dict[str, int]:
        """Flagged parameter count per risk level."""
        counts: dict[str, int] = {}
        for item in self.flagged:
            counts[item.risk] = counts.get(item.risk, 0) + 1
        return counts

    def to_dataframe(self) -> pd.DataFrame:
        """Flagged parameters as a DataFrame."""
        return pd.DataFrame(
            [
                {
                    "parameter_path": f.parameter_path,
                    "value": f.value,
                    "unit": f.unit,
                    "data_quality_status": f.data_quality_status,
                    "assumption_id": f.assumption_id,
                    "risk": f.risk,
                    "assumption_status": f.assumption_status,
                    "gap_id": f.gap_id,
                    "gap_priority": f.gap_priority,
                    "notes": f.notes,
                }
                for f in self.flagged
            ]
        )

    def to_markdown(self) -> str:
        """Render the assumption report as Markdown."""
        lines = [
            "# NAJM-3000 Digital Twin — Assumption and Conflict Report",
            "",
            f"> **{SYNTHETIC_DISCLAIMER}**",
            "",
            "Risk levels are read from `ASSUMPTIONS_REGISTER.md`. They are not",
            "derived, inferred, or invented by this report.",
            "",
            f"- Parameters inspected: {self.total_parameters}",
            f"- Parameters flagged: {len(self.flagged)}",
            f"- High-risk parameters: {len(self.high_risk())}",
            "",
            "## Summary by Risk Level",
            "",
            "| Risk | Parameters |",
            "|---|---|",
        ]
        for risk, count in sorted(self.summary_by_risk().items()):
            lines.append(f"| {risk} | {count} |")
        if self.unregistered_ids:
            lines += [
                "",
                "## ⚠️ Unregistered Assumption IDs",
                "",
                "These parameters cite an assumption ID that is absent from the",
                "register. Add them to `ASSUMPTIONS_REGISTER.md` before use.",
                "",
            ]
            lines += [f"- `{aid}`" for aid in self.unregistered_ids]
        lines += [
            "",
            "## Flagged Parameters",
            "",
            "| Parameter | Value | Unit | Status | Assumption ID | Risk "
            "| Assumption Status | Gap ID | Gap Priority |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        for item in self.flagged:
            lines.append(
                f"| {item.parameter_path} | {item.value:g} | {item.unit} "
                f"| {item.data_quality_status} | {item.assumption_id or '—'} "
                f"| {item.risk} | {item.assumption_status or '—'} "
                f"| {item.gap_id or '—'} | {item.gap_priority or '—'} |"
            )
        lines += ["", "---", "", f"*{SYNTHETIC_DISCLAIMER}*"]
        return "\n".join(lines) + "\n"


def build_assumption_report(
    rows: list[ProvenanceRow],
    assumptions: dict[str, AssumptionEntry],
    gaps: dict[str, GapEntry],
) -> AssumptionReport:
    """Flag every non-source-backed parameter and attach its registered risk."""
    flagged: list[FlaggedParameter] = []
    unregistered: list[str] = []
    for row in rows:
        if row.data_quality_status not in FLAGGED_STATUSES:
            continue
        entry = assumptions.get(row.assumption_id or "")
        if entry is None:
            risk = UNREGISTERED_RISK
            if row.assumption_id and row.assumption_id not in unregistered:
                unregistered.append(row.assumption_id)
        else:
            risk = entry.risk
        gap = gaps.get(row.gap_id or "")
        flagged.append(
            FlaggedParameter(
                parameter_path=row.parameter_path,
                value=row.value,
                unit=row.unit,
                data_quality_status=row.data_quality_status,
                assumption_id=row.assumption_id,
                risk=risk,
                assumption_status=entry.status if entry else None,
                gap_id=row.gap_id,
                gap_priority=gap.priority_label() if gap else None,
                notes=row.notes,
            )
        )
    return AssumptionReport(
        flagged=flagged,
        unregistered_ids=unregistered,
        total_parameters=len(rows),
    )
