"""Provenance report generator.

Walks the validated configuration tree and emits one row per engineering
parameter, recording where the value came from: a sanitized source ID
(``SRC-xxx``) or an assumption ID (``ASMP-xxx``). Vendor variants are reported
under their own alias — unlike equipment is never merged or averaged.

The report is the audit trail required by ``README.md``: every important
parameter must be traceable to a source or a registered assumption.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from pydantic import BaseModel

from najm3000 import SYNTHETIC_DISCLAIMER
from najm3000.assets.provenance import ParameterWithProvenance
from najm3000.config.schemas import (
    BlocksConfig,
    DataSourcesFile,
    EquipmentConfig,
    ProjectConfig,
)


class ProvenanceReportError(Exception):
    """Raised when a parameter reaches the report without provenance."""


@dataclass(frozen=True)
class ProvenanceRow:
    """One engineering parameter and its provenance, flattened for reporting."""

    parameter_path: str
    value: float
    unit: str
    source_id: str | None
    assumption_id: str | None
    gap_id: str | None
    data_quality_status: str
    confidence: str | None
    notes: str | None

    def has_provenance(self) -> bool:
        """True when the value is traceable to a source or an assumption."""
        return self.source_id is not None or self.assumption_id is not None


def _row_from_parameter(path: str, param: ParameterWithProvenance) -> ProvenanceRow:
    record = param.provenance
    return ProvenanceRow(
        parameter_path=path,
        value=param.value,
        unit=param.unit,
        source_id=record.source_id,
        assumption_id=record.assumption_id,
        gap_id=record.gap_id,
        data_quality_status=str(record.data_quality_status),
        confidence=str(record.confidence) if record.confidence else None,
        notes=record.notes,
    )


def collect_provenance(node: object, prefix: str = "") -> list[ProvenanceRow]:
    """Recursively collect every ``ParameterWithProvenance`` under ``node``.

    Descends through Pydantic models, dictionaries (equipment libraries keyed
    by vendor alias), and lists, building a dotted parameter path.
    """
    rows: list[ProvenanceRow] = []
    if isinstance(node, ParameterWithProvenance):
        rows.append(_row_from_parameter(prefix, node))
    elif isinstance(node, BaseModel):
        for name in type(node).model_fields:
            child = getattr(node, name)
            rows.extend(collect_provenance(child, _join(prefix, name)))
    elif isinstance(node, dict):
        for key, child in node.items():
            rows.extend(collect_provenance(child, _join(prefix, str(key))))
    elif isinstance(node, (list, tuple)):
        for index, child in enumerate(node):
            rows.extend(collect_provenance(child, f"{prefix}[{index}]"))
    return rows


def _join(prefix: str, name: str) -> str:
    return f"{prefix}.{name}" if prefix else name


def check_all_rows_have_provenance(rows: list[ProvenanceRow]) -> None:
    """Reject any parameter carrying neither a source ID nor an assumption ID."""
    orphans = [row.parameter_path for row in rows if not row.has_provenance()]
    if orphans:
        msg = (
            f"{len(orphans)} parameter(s) reached the report without provenance: "
            + ", ".join(sorted(orphans))
        )
        raise ProvenanceReportError(msg)


@dataclass(frozen=True)
class ProvenanceReport:
    """Full parameter provenance audit trail for one configuration set."""

    rows: list[ProvenanceRow]
    calibration_status: str
    validation_status: str
    weather_source: str

    def summary_by_status(self) -> dict[str, int]:
        """Parameter count per data quality status."""
        counts: dict[str, int] = {}
        for row in self.rows:
            counts[row.data_quality_status] = (
                counts.get(row.data_quality_status, 0) + 1
            )
        return counts

    def to_dataframe(self) -> pd.DataFrame:
        """Report rows as a DataFrame, one row per parameter."""
        return pd.DataFrame(
            [
                {
                    "parameter_path": row.parameter_path,
                    "value": row.value,
                    "unit": row.unit,
                    "source_id": row.source_id,
                    "assumption_id": row.assumption_id,
                    "gap_id": row.gap_id,
                    "data_quality_status": row.data_quality_status,
                    "confidence": row.confidence,
                    "notes": row.notes,
                }
                for row in self.rows
            ]
        )

    def to_markdown(self) -> str:
        """Render the report as Markdown with the mandatory status labels."""
        lines = [
            "# NAJM-3000 Digital Twin — Parameter Provenance Report",
            "",
            f"> **{SYNTHETIC_DISCLAIMER}**",
            "",
            f"- Model calibration status: `{self.calibration_status}`",
            f"- Model validation status: `{self.validation_status}`",
            f"- Weather source classification: `{self.weather_source}`",
            f"- Parameters reported: {len(self.rows)}",
            "",
            "## Summary by Data Quality Status",
            "",
            "| Data Quality Status | Parameters |",
            "|---|---|",
        ]
        for status, count in sorted(self.summary_by_status().items()):
            lines.append(f"| {status} | {count} |")
        lines += [
            "",
            "## Parameter Register",
            "",
            "| Parameter | Value | Unit | Source ID | Assumption ID | Gap ID "
            "| Status | Confidence |",
            "|---|---|---|---|---|---|---|---|",
        ]
        for row in self.rows:
            lines.append(
                f"| {row.parameter_path} | {row.value:g} | {row.unit} "
                f"| {row.source_id or '—'} | {row.assumption_id or '—'} "
                f"| {row.gap_id or '—'} | {row.data_quality_status} "
                f"| {row.confidence or '—'} |"
            )
        lines += [
            "",
            "---",
            "",
            f"*{SYNTHETIC_DISCLAIMER}*",
        ]
        return "\n".join(lines) + "\n"


def build_provenance_report(
    project: ProjectConfig,
    equipment: EquipmentConfig,
    blocks: BlocksConfig,
    sources: DataSourcesFile,
) -> ProvenanceReport:
    """Collect provenance for every configured parameter and validate it."""
    rows: list[ProvenanceRow] = []
    rows.extend(collect_provenance(project, "project"))
    rows.extend(collect_provenance(equipment, "equipment"))
    rows.extend(collect_provenance(blocks, "blocks"))
    rows.extend(collect_provenance(sources, "data_sources"))
    check_all_rows_have_provenance(rows)
    return ProvenanceReport(
        rows=rows,
        calibration_status=project.project.calibration_status,
        validation_status=project.project.validation_status,
        weather_source=project.simulation.weather_source,
    )
