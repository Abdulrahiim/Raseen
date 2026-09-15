"""Shared test setup: isolate the scenario cache so tests never touch app/.cache."""

from __future__ import annotations

import os
import tempfile

os.environ.setdefault("RASEEN_CACHE_DIR", tempfile.mkdtemp(prefix="raseen-cache-"))
