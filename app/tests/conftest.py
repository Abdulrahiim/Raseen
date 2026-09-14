from __future__ import annotations

import os
import tempfile

# Scenario caching (added in a later task) must never pollute app/.cache during tests.
os.environ.setdefault("RASEEN_CACHE_DIR", tempfile.mkdtemp(prefix="raseen-cache-"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from raseen.api import build_app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(build_app())
