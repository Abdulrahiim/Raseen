"""Parameter overrides applied to a validated block configuration.

Pure configuration manipulation: it produces a new, re-validated
:class:`~najm3000.config.schemas.BlockConfig` and touches no physics. That
separation lets the dashboard API vary a scenario without depending on the
physics engine, which is what keeps the historian adapter the only swap point.

An override never bypasses the schema. The replacement value is re-validated by
Pydantic and re-stamped as ``Assumed`` provenance carrying the assumption ID it
varies, so a sensitivity run cannot smuggle an unprovenanced value into the model.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from pydantic import ValidationError

from najm3000.assets.provenance import (
    Confidence,
    DataQualityStatus,
    ParameterWithProvenance,
    ProvenanceRecord,
)
from najm3000.config.schemas import BlockConfig

#: Block fields that may be varied. Structural fields (equipment aliases,
#: component counts) are deliberately excluded.
SENSITIVITY_FIELDS = frozenset(
    {
        "gcr",
        "cross_axis_tilt",
        "albedo",
        "soiling_factor",
        "dc_cable_loss_fraction",
        "ac_cable_loss_fraction",
        "dc_mismatch_loss_fraction",
    }
)


class ScenarioError(Exception):
    """Raised when a scenario is malformed or its override is invalid."""


@dataclass(frozen=True)
class ScenarioOverride:
    """One parameter substitution, traceable to the assumption it varies."""

    field: str
    value: float
    assumption_id: str
    notes: str | None = None


def apply_overrides(
    block: BlockConfig, overrides: Iterable[ScenarioOverride]
) -> BlockConfig:
    """Return a validated copy of ``block`` with the overrides applied.

    The original block is never mutated, and each replaced value carries
    ``Assumed`` provenance naming the assumption under study.
    """
    updates: dict[str, ParameterWithProvenance] = {}
    for override in overrides:
        if override.field not in SENSITIVITY_FIELDS:
            msg = (
                f"'{override.field}' is not a configurable sensitivity "
                f"parameter; allowed: {sorted(SENSITIVITY_FIELDS)}"
            )
            raise ScenarioError(msg)
        current: ParameterWithProvenance = getattr(block, override.field)
        updates[override.field] = ParameterWithProvenance(
            value=override.value,
            unit=current.unit,
            provenance=ProvenanceRecord(
                assumption_id=override.assumption_id,
                data_quality_status=DataQualityStatus.ASSUMED,
                confidence=Confidence.LOW,
                notes=override.notes
                or f"scenario override of {override.field} for sensitivity study",
            ),
        )
    try:
        return BlockConfig.model_validate(
            {**block.model_dump(), **{k: v.model_dump() for k, v in updates.items()}}
        )
    except ValidationError as exc:
        msg = f"scenario override failed schema validation:\n{exc}"
        raise ScenarioError(msg) from exc
