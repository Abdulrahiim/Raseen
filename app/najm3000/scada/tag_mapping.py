"""SCADA tag mapping: sanitized tag identifiers to asset hierarchy nodes.

Tag mappings are the one place where SCADA naming meets the asset model, which
makes them the likeliest place for restricted material to leak into the
repository. Parsing therefore rejects anything resembling a network address,
hostname, protocol register address, or credential — per ``CONFIDENTIALITY.md``,
none of these may ever be committed.

Real tag mappings are gitignored; only sanitized examples belong in the repo.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

#: Patterns that indicate restricted material rather than a sanitized tag.
_RESTRICTED_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    # Not \b: an address embedded in a tag name such as "10.0.0.1_PAC" has a
    # word character on the right, which \b would not treat as a boundary.
    ("IP address", re.compile(r"(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])")),
    ("hostname", re.compile(r"\b[\w-]+\.(?:internal|local|corp|lan|net|com)\b", re.I)),
    ("register address", re.compile(r"\b(?:modbus|holding|coil|register)\b", re.I)),
    (
        "credential",
        re.compile(r"\b(?:password|passwd|secret|api[_-]?key|token)\b", re.I),
    ),
)


class TagMappingError(Exception):
    """Raised when a tag mapping is invalid or contains restricted material."""


def _reject_restricted(text: str, field: str) -> None:
    for label, pattern in _RESTRICTED_PATTERNS:
        if pattern.search(text):
            msg = (
                f"tag mapping field '{field}' contains restricted material "
                f"({label}); see CONFIDENTIALITY.md — sanitize before committing"
            )
            raise TagMappingError(msg)


class TagMapping(BaseModel):
    """One sanitized SCADA tag mapped onto the asset hierarchy."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    tag_id: str
    description: str
    asset_id: str
    asset_class: str
    physical_quantity: str
    unit: str
    expected_range: tuple[float, float]
    quality_checks: tuple[str, ...] = ()

    @field_validator("expected_range")
    @classmethod
    def _check_range(cls, v: tuple[float, float]) -> tuple[float, float]:
        low, high = v
        if low >= high:
            msg = f"expected_range {v} must be increasing (low < high)"
            raise ValueError(msg)
        return v


def parse_tag_mappings(raw: dict[str, Any]) -> list[TagMapping]:
    """Parse and validate a tag mapping document.

    Rejects duplicate tag IDs and any entry containing restricted material.
    """
    entries = raw.get("tag_mappings")
    if not isinstance(entries, list):
        msg = "tag mapping document must contain a 'tag_mappings' list"
        raise TagMappingError(msg)

    mappings: list[TagMapping] = []
    seen: set[str] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            msg = f"tag_mappings[{index}] is not a mapping"
            raise TagMappingError(msg)
        for field, value in entry.items():
            if isinstance(value, str):
                _reject_restricted(value, field)
        try:
            mapping = TagMapping.model_validate(entry)
        except ValidationError as exc:
            msg = f"tag_mappings[{index}] is invalid:\n{exc}"
            raise TagMappingError(msg) from exc
        if mapping.tag_id in seen:
            msg = f"duplicate tag_id '{mapping.tag_id}' in tag mappings"
            raise TagMappingError(msg)
        seen.add(mapping.tag_id)
        mappings.append(mapping)
    return mappings
