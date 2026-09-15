"""Scenario cache: memory first, then JSON on disk (RASEEN_CACHE_DIR, default app/.cache)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from raseen.scenario.params import ScenarioParams
from raseen.scenario.runner import run_scenario

DEFAULT_DIR = Path(__file__).resolve().parents[2] / ".cache"


class ScenarioCache:
    def __init__(self, directory: Path | str | None = None) -> None:
        self.dir = Path(directory or os.environ.get("RASEEN_CACHE_DIR", DEFAULT_DIR))
        self.memory: dict[str, dict[str, Any]] = {}

    def _path(self, scenario_id: str) -> Path:
        return self.dir / f"{scenario_id}.json"

    def get(self, scenario_id: str) -> dict[str, Any] | None:
        if scenario_id in self.memory:
            return self.memory[scenario_id]
        path = self._path(scenario_id)
        if path.exists():
            try:
                scenario = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return None
            self.memory[scenario_id] = scenario
            return scenario
        return None

    def put(self, scenario: dict[str, Any]) -> None:
        self.memory[scenario["scenario_id"]] = scenario
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            self._path(scenario["scenario_id"]).write_text(
                json.dumps(scenario, separators=(",", ":")), encoding="utf-8"
            )
        except OSError:
            pass  # a read-only disk must not break the demo; memory still serves it

    def get_or_run(self, params: ScenarioParams) -> dict[str, Any]:
        scenario = self.get(params.scenario_id())
        if scenario is None:
            scenario = run_scenario(params)
            self.put(scenario)
        return scenario

    def size(self) -> int:
        on_disk = len(list(self.dir.glob("*.json"))) if self.dir.exists() else 0
        return max(on_disk, len(self.memory))


CACHE = ScenarioCache()
