"""Canonical time-series schema for SCADA/historian data.

This is the only shape the comparison layer accepts. The physics engine and
the SCADA adapter have no dependency on each other — they meet here.

Two rules are structural rather than advisory:

* ``value_raw`` and ``value_qc`` are both required, so a quality correction can
  never overwrite the original measurement.
* ``processing_version`` is required, so no QC output enters the comparison
  layer without a traceable pipeline version.

Nothing in this module connects to anything. NAJM-3000's SCADA is not
commissioned; see ``docs/scada_integration_plan.md``.
"""

from __future__ import annotations

import pandas as pd

from najm3000.weather.interface import DataSourceClassification

#: Columns every canonical frame must carry, in order.
CANONICAL_COLUMNS: tuple[str, ...] = (
    "timestamp",
    "tag_id",
    "asset_id",
    "value_raw",
    "value_qc",
    "quality_flag",
    "source_classification",
    "unit",
    "sensor_status",
    "exclusion_reason",
    "correction_reason",
    "processing_version",
)

#: Columns that must be present in every canonical frame.
REQUIRED_COLUMNS: tuple[str, ...] = (
    "timestamp",
    "tag_id",
    "asset_id",
    "value_raw",
    "quality_flag",
    "source_classification",
    "unit",
    "processing_version",
)

#: Columns that must additionally be fully populated. ``value_raw`` is absent
#: here because an explained gap is legitimate data — see NULL_PERMITTED_FLAGS.
NON_NULL_COLUMNS: tuple[str, ...] = (
    "tag_id",
    "asset_id",
    "quality_flag",
    "source_classification",
    "unit",
    "processing_version",
)

#: Quality flags under which ``value_raw`` may be null. A gap is legitimate
#: data — an unexplained gap is indistinguishable from a modelling error, so
#: every null must also carry an ``exclusion_reason``.
NULL_PERMITTED_FLAGS: frozenset[str] = frozenset(
    {"NO_DATA", "EXCLUDED", "SENSOR_FAULT", "UNDEFINED"}
)


class CanonicalSchemaError(Exception):
    """Raised when a frame does not conform to the canonical schema."""


def empty_canonical_frame() -> pd.DataFrame:
    """An empty frame with the full canonical column set."""
    return pd.DataFrame({column: [] for column in CANONICAL_COLUMNS})


def validate_canonical_frame(frame: pd.DataFrame) -> pd.DataFrame:
    """Validate ``frame`` against the canonical schema; return it unchanged."""
    missing = [c for c in REQUIRED_COLUMNS if c not in frame.columns]
    if missing:
        msg = f"canonical frame missing required column(s): {missing}"
        raise CanonicalSchemaError(msg)

    timestamps = pd.DatetimeIndex(frame["timestamp"])
    if timestamps.tz is None:
        msg = "canonical 'timestamp' must be timezone-aware (naive rejected)"
        raise CanonicalSchemaError(msg)

    for column in NON_NULL_COLUMNS:
        if bool(frame[column].isna().any()):
            msg = f"canonical column '{column}' contains null values"
            raise CanonicalSchemaError(msg)

    missing_value = frame["value_raw"].isna()
    if bool(missing_value.any()):
        flags = frame.loc[missing_value, "quality_flag"].astype(str)
        unexplained = ~flags.isin(NULL_PERMITTED_FLAGS)
        if bool(unexplained.any()):
            msg = (
                f"{int(unexplained.sum())} row(s) have an unexplained null "
                f"value_raw; a gap must carry a quality_flag in "
                f"{sorted(NULL_PERMITTED_FLAGS)}"
            )
            raise CanonicalSchemaError(msg)
        if "exclusion_reason" not in frame.columns or bool(
            frame.loc[missing_value, "exclusion_reason"].isna().any()
        ):
            msg = (
                "rows with a null value_raw must state why in "
                "'exclusion_reason'"
            )
            raise CanonicalSchemaError(msg)

    valid = {c.value for c in DataSourceClassification}
    unknown = set(frame["source_classification"].astype(str)) - valid
    if unknown:
        msg = (
            f"unknown source_classification value(s): {sorted(unknown)}; "
            f"allowed: {sorted(valid)}"
        )
        raise CanonicalSchemaError(msg)

    return frame
