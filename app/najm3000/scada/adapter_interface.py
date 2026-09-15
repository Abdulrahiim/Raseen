"""Historian adapter interface — defined, and deliberately inactive.

NAJM-3000's SCADA system is not commissioned and no operational data exists.
This module defines the contract a future adapter must satisfy, and ships an
implementation that refuses to serve data rather than inventing any.

**No credentials, hostnames, IP addresses, or register addresses appear in this
interface, and none may be added.** See ``CONFIDENTIALITY.md``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import pandas as pd

from najm3000.scada.canonical import validate_canonical_frame


class ScadaInactiveError(Exception):
    """Raised when data is requested from an inactive SCADA connection."""


class HistorianAdapter(ABC):
    """Contract for any SCADA/historian data source.

    Implementations return frames conforming to the canonical time-series
    schema. The physics engine never imports an adapter directly; the two
    layers meet only at the canonical schema.
    """

    #: Whether this adapter is connected to a live historian.
    is_active: bool = False

    @property
    @abstractmethod
    def classification(self) -> str:
        """Source classification applied to every row this adapter returns.

        Part of the contract because consumers must be able to state where
        their data came from without knowing which adapter is behind them.
        """

    @property
    @abstractmethod
    def disclaimer(self) -> str:
        """Label describing what this data is, and is not."""

    @abstractmethod
    def fetch(
        self,
        tag_ids: list[str],
        start: pd.Timestamp,
        end: pd.Timestamp,
    ) -> pd.DataFrame:
        """Return canonical time-series data for ``tag_ids`` over a window."""

    @abstractmethod
    def list_available_tags(self) -> list[str]:
        """Return the sanitized tag identifiers this adapter can serve."""

    def fetch_validated(
        self,
        tag_ids: list[str],
        start: pd.Timestamp,
        end: pd.Timestamp,
    ) -> pd.DataFrame:
        """Fetch and validate against the canonical schema."""
        return validate_canonical_frame(self.fetch(tag_ids, start, end))


class InactiveHistorianAdapter(HistorianAdapter):
    """The only adapter available before commissioning.

    Every data request fails loudly. Returning empty or placeholder rows would
    let downstream code silently treat "no data" as "zero production".
    """

    is_active = False

    @property
    def classification(self) -> str:
        """No data exists, so no classification applies."""
        return "NOT_AVAILABLE"

    @property
    def disclaimer(self) -> str:
        """States plainly that there is nothing to read."""
        return (
            "SCADA NOT COMMISSIONED — NO OPERATIONAL DATA EXISTS FOR NAJM-3000."
        )

    def fetch(
        self,
        tag_ids: list[str],
        start: pd.Timestamp,
        end: pd.Timestamp,
    ) -> pd.DataFrame:
        """Always raise: there is no historian to read from."""
        msg = (
            "SCADA is not commissioned for NAJM-3000 and no operational data "
            "exists. No historian connection is configured, and this adapter "
            "will not return placeholder data. See docs/scada_integration_plan.md."
        )
        raise ScadaInactiveError(msg)

    def list_available_tags(self) -> list[str]:
        """No tags exist yet; an empty list is the honest answer."""
        return []
