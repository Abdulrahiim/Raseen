"""Parameter provenance data model for the NAJM-3000 Digital Twin.

Every important engineering parameter must carry a provenance record with a
sanitized source ID (``SRC-xxx``) or an assumption ID (``ASMP-xxx``) from the
project registers. Parameters without either are rejected at validation time.
"""

from __future__ import annotations

from datetime import date
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, model_validator


class DataQualityStatus(StrEnum):
    """Data quality status per the project data dictionary."""

    CONFIRMED = "Confirmed"
    PROVISIONAL = "Provisional"
    CONFLICTING = "Conflicting"
    MISSING = "Missing"
    ASSUMED = "Assumed"
    NOT_APPLICABLE = "Not applicable"


class Confidence(StrEnum):
    """Confidence level per the project data dictionary."""

    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class ProvenanceRecord(BaseModel):
    """Provenance of a single engineering parameter.

    At least one of ``source_id`` or ``assumption_id`` must be present.
    """

    model_config = ConfigDict(extra="ignore", frozen=True)

    source_id: str | None = None
    assumption_id: str | None = None
    gap_id: str | None = None
    source_section: str | None = None
    source_page: str | None = None
    revision: str | None = None
    issue_status: str | None = None
    data_quality_status: DataQualityStatus
    confidence: Confidence | None = None
    date_extracted: date | None = None
    extractor_version: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _require_source_or_assumption(self) -> ProvenanceRecord:
        if self.source_id is None and self.assumption_id is None:
            msg = (
                "ProvenanceRecord requires source_id (SRC-xxx) or "
                "assumption_id (ASMP-xxx); neither was provided"
            )
            raise ValueError(msg)
        return self


class ParameterWithProvenance(BaseModel):
    """A numeric parameter value with its SI unit and provenance record."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    value: float
    unit: str
    provenance: ProvenanceRecord

    def is_assumed(self) -> bool:
        """Return True when the parameter is an assumption, not a source value."""
        return self.provenance.data_quality_status is DataQualityStatus.ASSUMED
