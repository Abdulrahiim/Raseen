"""JSON API for the pre-commissioning dashboard.

**This module deliberately does not import the physics engine.** It talks only
to a :class:`~najm3000.scada.adapter_interface.HistorianAdapter`. Today that is
``SimulatedHistorianAdapter``; at commissioning it becomes the real historian
adapter, and neither this module nor the dashboard above it changes. A test
asserts the absence of those imports, because that substitution is the whole
point of the architecture.

Every response carries ``classification`` and ``disclaimer`` so the dashboard
cannot render live-looking values without also rendering their provenance.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from najm3000 import __version__
from najm3000.config.loader import (
    check_equipment_references,
    load_blocks_config,
    load_data_sources_config,
    load_equipment_config,
    load_project_config,
)
from najm3000.config.overrides import (
    ScenarioError,
    ScenarioOverride,
    apply_overrides,
)
from najm3000.config.schemas import BlocksConfig, ProjectConfig
from najm3000.dashboard.diagnostics import StationSignals, diagnose
from najm3000.dashboard.faults import FAULT_CATALOGUE, FaultError, FaultRegistry
from najm3000.dashboard.performance import (
    MEASURED_LABEL,
    MeasurementModel,
    deviation_percent,
    summarise,
)
from najm3000.dashboard.plant import Plant, PlantBlock, build_plant
from najm3000.scada.adapter_interface import HistorianAdapter
from najm3000.scada.simulated import BLOCK_TAG_SPECS, SimulatedHistorianAdapter
from najm3000.weather.selection import build_weather_provider

#: Label shown wherever the dashboard states where its data comes from.
SIMULATION_DATA_SOURCE = "SIMULATION (PRE-COMMISSIONING)"

#: Front-end assets, served locally. No external requests are made.
STATIC_DIR = Path(__file__).parent / "static"

#: Extracted 3D parts and their asset mapping, produced offline by
#: tools/prepare_model.mjs from the supplied CAD export.
MODEL_MANIFEST = STATIC_DIR / "models" / "manifest.json"

#: Tag suffix per dashboard field.
_SUFFIX = {spec.column: spec.suffix for spec in BLOCK_TAG_SPECS}


class FaultRequest(BaseModel):
    """A fault a presenter chooses to demonstrate."""

    block_id: str
    asset: str
    fault_type: str


class ScenarioRequest(BaseModel):
    """Parameters a viewer may vary during a live session."""

    albedo: float | None = Field(default=None)
    gcr: float | None = Field(default=None)
    day: str | None = Field(default=None)


@dataclass
class DashboardState:
    """Everything the API serves, rebuilt when a scenario changes."""

    adapter: HistorianAdapter
    plant: Plant
    day: str
    calibration_status: str
    validation_status: str
    timestep_minutes: int
    blocks_config: BlocksConfig
    installed_kw_by_config: dict[str, float]


def _series(adapter: HistorianAdapter, config_name: str, column: str) -> pd.Series:
    """One simulated signal for one block configuration, as a series."""
    tag = f"{config_name}_{_SUFFIX[column]}".upper().replace("-", "_")
    frame = adapter.fetch(
        [tag], pd.Timestamp.min.tz_localize("UTC"), pd.Timestamp.max.tz_localize("UTC")
    )
    return pd.Series(
        frame["value_raw"].to_numpy(), index=pd.DatetimeIndex(frame["timestamp"])
    )


def build_app(
    config_dir: Path,
    day: str,
    weather: str = "synthetic_clearsky",
    scenario_enabled: bool = False,
) -> FastAPI:
    """Construct the dashboard API bound to a configuration directory."""
    project = load_project_config(config_dir / "project.yaml")
    equipment = load_equipment_config(config_dir / "equipment.yaml")
    blocks = load_blocks_config(config_dir / "blocks.yaml")
    sources = load_data_sources_config(config_dir / "data_sources.yaml")
    check_equipment_references(blocks, equipment)

    def make_state(
        current_day: str,
        current_blocks: BlocksConfig,
        current_project: ProjectConfig,
    ) -> DashboardState:
        adapter = SimulatedHistorianAdapter(
            project=current_project,
            equipment=equipment,
            blocks=current_blocks,
            weather_provider=build_weather_provider(sources, weather),
            day=current_day,
        )
        installed = {}
        for name, block in current_blocks.blocks.items():
            modules = (
                block.modules_per_string
                * block.strings_per_smb
                * block.smbs_per_inverter
                * block.inverters_per_idt
                * block.idts_per_block
            )
            module_w = equipment.pv_modules[block.pv_module].pdc_stc.value
            installed[name] = modules * module_w / 1e3

        return DashboardState(
            adapter=adapter,
            plant=build_plant(current_blocks),
            day=current_day,
            calibration_status=current_project.project.calibration_status,
            validation_status=current_project.project.validation_status,
            timestep_minutes=current_project.simulation.timestep_minutes,
            blocks_config=current_blocks,
            installed_kw_by_config=installed,
        )

    state = make_state(day, blocks, project)
    faults = FaultRegistry()
    measurement = MeasurementModel().for_plant(
        [b.block_id for b in state.plant.blocks]
    )

    # A scripted demonstration: faults arise as the clock passes each entry, so
    # a presenter does not have to click during the walkthrough. Entries are
    # fractions of the simulated day.
    def _scenario_block(position: float) -> str:
        """A station at a fraction through the plant, whatever its size."""
        blocks = state.plant.blocks
        return blocks[min(int(len(blocks) * position), len(blocks) - 1)].block_id

    scenario = [
        (0.34, _scenario_block(0.11), "inverter_01", "inverter_trip"),
        (0.52, measurement.degraded_block_id or _scenario_block(0.02),
         "skid", "string_outage"),
        (0.66, _scenario_block(0.32), "idt_01", "idt_over_temperature"),
        (0.78, _scenario_block(0.56), "rmu", "rmu_communication_loss"),
    ]
    # Off unless asked for: a dashboard that raises alarms on its own would
    # confuse anyone using it for engineering review. The demonstration CLI
    # turns it on.
    scenario_state = {"on": scenario_enabled}

    def run_scenario(when: pd.Timestamp) -> None:
        """Activate scenario faults whose moment has passed."""
        if not scenario_state["on"]:
            return
        series = _series(state.adapter, state.plant.blocks[0].config_name, "p_block")
        index = pd.DatetimeIndex(series.index)
        if not len(index):
            return
        position = int(index.get_indexer(pd.Index([when]), method="nearest")[0])
        fraction = position / max(1, len(index) - 1)
        for moment, block_id, asset, fault_type in scenario:
            if fraction >= moment:
                try:
                    faults.inject(block_id, asset, fault_type)
                except FaultError:
                    continue
    model_parts: list[dict[str, Any]] = []
    model_note = ""
    model_file = ""
    if MODEL_MANIFEST.exists():
        manifest = json.loads(MODEL_MANIFEST.read_text(encoding="utf-8"))
        model_parts = manifest.get("parts", [])
        model_note = manifest.get("note", "")
        model_file = manifest.get("file", "")

    app = FastAPI(
        title="NAJM-3000 Pre-Commissioning Digital Twin",
        description=(
            "Simulated telemetry. NAJM-3000 is under construction; SCADA is "
            "not commissioned. Not measured data, not calibrated, not validated."
        ),
        version=__version__,
    )

    def envelope() -> dict[str, Any]:
        return {
            "classification": state.adapter.classification,
            "disclaimer": state.adapter.disclaimer,
            "is_live": bool(state.adapter.is_active),
        }

    def at(column: str, config_name: str, when: pd.Timestamp) -> float:
        series = _series(state.adapter, config_name, column)
        if when not in series.index:
            available = f"{series.index.min()} .. {series.index.max()}"
            msg = f"timestamp outside the simulated day; available: {available}"
            raise HTTPException(status_code=400, detail=msg)
        value = series.loc[when]
        return 0.0 if pd.isna(value) else float(value)

    def _step_index(current: DashboardState, when: pd.Timestamp) -> int:
        """Timestep number, so measurement noise lines up with the trends."""
        name = current.plant.blocks[0].config_name
        index = pd.DatetimeIndex(_series(current.adapter, name, "p_block").index)
        if not len(index):
            return 0
        return int(index.get_indexer(pd.Index([when]), method="nearest")[0])

    def parse_time(value: str) -> pd.Timestamp:
        try:
            stamp = pd.Timestamp(value)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        tz = project.location.timezone
        return stamp.tz_localize(tz) if stamp.tz is None else stamp.tz_convert(tz)

    def find_block(block_id: str) -> PlantBlock:
        for block in state.plant.blocks:
            if block.block_id == block_id:
                return block
        raise HTTPException(status_code=404, detail=f"unknown block '{block_id}'")

    @app.get("/api/status")
    def status() -> dict[str, Any]:
        return {
            **envelope(),
            "data_source": SIMULATION_DATA_SOURCE,
            "project": "NAJM-3000",
            "project_status": "pre-operational (under construction)",
            "calibration_status": state.calibration_status,
            "validation_status": state.validation_status,
            "simulated_day": state.day,
            "timestep_minutes": state.timestep_minutes,
            "block_count": state.plant.block_count,
            "block_count_source": state.plant.block_count_source,
            "block_count_note": state.plant.block_count_note,
            "layout_note": state.plant.layout_note,
            "scaling_label": state.plant.label,
            "spread_assumption_id": state.plant.spread_assumption_id,
            "injected_faults": faults.count(),
            "measurement_label": MEASURED_LABEL,
            "degraded_block": measurement.degraded_block_id,
            "scenario_enabled": scenario_state["on"],
            "model_available": bool(model_parts),
            "model_note": model_note,
            "fault_catalogue": [
                {
                    "key": f.key,
                    "label": f.label,
                    "severity": f.severity,
                    "asset_kinds": list(f.asset_kinds),
                    "description": f.description,
                }
                for f in FAULT_CATALOGUE.values()
            ],
            "version": __version__,
        }

    @app.get("/api/plant")
    def plant_view(t: str) -> dict[str, Any]:
        when = parse_time(t)
        run_scenario(when)
        configs = {b.config_name for b in state.plant.blocks}
        per_config = {name: at("p_block", name, when) for name in configs}
        scaled = state.plant.scale(per_config)
        step = _step_index(state, when)
        measured = {
            block.block_id: scaled[block.block_id]
            * measurement.factor(
                block.block_id, step, measurement.is_degraded(block.block_id)
            )
            if scaled[block.block_id] > 0.0
            else scaled[block.block_id]
            for block in state.plant.blocks
        }
        return {
            **envelope(),
            "timestamp": when.isoformat(),
            "block_count": state.plant.block_count,
            "plant_ac_power_w": sum(scaled.values()),
            "plant_measured_w": sum(measured.values()),
            "plant_deviation_percent": deviation_percent(
                sum(measured.values()), sum(scaled.values())
            ),
            "measurement_label": MEASURED_LABEL,
            "grid_rows": state.plant.grid_rows,
            "grid_columns": state.plant.grid_columns,
            "spread_assumption_id": state.plant.spread_assumption_id,
            "spread_fraction": state.plant.spread_fraction,
            "scaling_label": state.plant.label,
            "blocks": [
                {
                    "block_id": block.block_id,
                    "config_name": block.config_name,
                    "row": block.row,
                    "column": block.column,
                    "ac_power_w": scaled[block.block_id],
                    "measured_w": measured[block.block_id],
                    "deviation_percent": deviation_percent(
                        measured[block.block_id], scaled[block.block_id]
                    ),
                    "fault_severity": faults.worst_severity(block.block_id),
                }
                for block in state.plant.blocks
            ],
        }

    @app.get("/api/block/{block_id}")
    def block_view(block_id: str, t: str) -> dict[str, Any]:
        block = find_block(block_id)
        when = parse_time(t)
        name = block.config_name
        return {
            **envelope(),
            "timestamp": when.isoformat(),
            "block_id": block.block_id,
            "config_name": name,
            "variation_factor": block.variation,
            "ghi_w_m2": at("ghi", name, when),
            "poa_irradiance_w_m2": at("poa_effective", name, when),
            "temp_ambient_c": at("temp_ambient", name, when),
            "temp_module_c": at("temp_cell", name, when),
            "tracker_angle_deg": at("tracker_theta", name, when),
            "dc_power_w": at("p_dc_inverter", name, when),
            "ac_power_w": at("p_ac_inverter", name, when),
            "idt_out_power_w": at("p_idt_out", name, when),
            "block_ac_power_w": at("p_block", name, when) * block.variation,
        }

    @app.get("/api/trends/{block_id}")
    def trends(block_id: str) -> dict[str, Any]:
        block = find_block(block_id)
        name = block.config_name
        poa = _series(state.adapter, name, "poa_effective")
        return {
            **envelope(),
            "block_id": block.block_id,
            "timestamps": [stamp.isoformat() for stamp in poa.index],
            "poa_w_m2": [float(v) for v in poa.to_numpy()],
            "temp_module_c": [
                float(v) for v in _series(state.adapter, name, "temp_cell").to_numpy()
            ],
            "dc_power_w": [
                float(v)
                for v in _series(state.adapter, name, "p_dc_inverter").to_numpy()
            ],
            "ac_power_w": [
                float(v)
                for v in _series(state.adapter, name, "p_ac_inverter").to_numpy()
            ],
            "measured_ac_power_w": [
                float(v)
                for v in measurement.apply(
                    block.block_id,
                    _series(state.adapter, name, "p_ac_inverter"),
                ).to_numpy()
            ],
            "measurement_label": MEASURED_LABEL,
            "degraded": measurement.is_degraded(block.block_id),
        }

    @app.get("/api/performance/{block_id}")
    def performance(block_id: str) -> dict[str, Any]:
        """Expected against simulated-measured energy, deviation and PR."""
        block = find_block(block_id)
        name = block.config_name
        expected_power = _series(state.adapter, name, "p_block") * block.variation
        measured_power = measurement.apply(block.block_id, expected_power)
        poa = _series(state.adapter, name, "poa_effective")

        installed_kw = state.installed_kw_by_config[name] * block.variation

        summary = summarise(
            block_id=block.block_id,
            expected_power_w=expected_power,
            measured_power_w=measured_power,
            poa_w_per_m2=poa,
            installed_kw=installed_kw,
            timestep_hours=state.timestep_minutes / 60.0,
            degraded=measurement.is_degraded(block.block_id),
        )
        return {**envelope(), **summary.as_dict()}

    @app.get("/api/diagnostics/{block_id}")
    def diagnostics(block_id: str) -> dict[str, Any]:
        """Attribute a station's deviation to a cause, inferred from signals."""
        block = find_block(block_id)
        name = block.config_name
        expected = _series(state.adapter, name, "p_block") * block.variation / 1e3
        measured = measurement.apply(block.block_id, expected)

        # A faulted asset changes what the signals look like. The engine is not
        # told which fault: it sees only the resulting shape, as it would with
        # real telemetry.
        active = {f.asset: f for f in faults.for_block(block_id)}
        inverters = {
            "inverter_01": _series(state.adapter, name, "p_ac_inverter") / 1e3,
            "inverter_02": _series(state.adapter, name, "p_ac_inverter") / 1e3,
        }
        for asset in ("inverter_01", "inverter_02"):
            if asset in active and active[asset].fault_type == "inverter_trip":
                inverters[asset] = inverters[asset] * 0.0
                measured = measured * 0.5
        if "skid" in active:
            measured = measured * 0.88
        if "idt_01" in active:
            hot = _series(state.adapter, name, "temp_cell") > 60.0
            measured = measured.where(~hot, measured * 0.86)
        if "rmu" in active:
            steps = pd.Series(range(len(measured)), index=measured.index)
            measured = measured.where(steps % 4 != 0, 0.0)

        signals = StationSignals(
            block_id=block.block_id,
            expected_kw=expected,
            measured_kw=measured,
            poa_w_m2=_series(state.adapter, name, "poa_effective"),
            temp_module_c=_series(state.adapter, name, "temp_cell"),
            rated_kw=state.installed_kw_by_config[name],
            inverters_kw=inverters,
        )
        finding = diagnose(signals)
        return {
            **envelope(),
            "block_id": block.block_id,
            "finding": finding.as_dict() if finding else None,
            "healthy": finding is None,
        }

    @app.get("/api/alarms")
    def alarms() -> dict[str, Any]:
        """Chronological event log across the plant."""
        entries = sorted(
            (f.as_dict() for f in faults.all()),
            key=lambda e: str(e["injected_at"]),
            reverse=True,
        )
        return {
            **envelope(),
            "count": len(entries),
            "alarms": entries,
        }

    @app.post("/api/scenario-mode")
    def scenario_mode(enabled: bool = True) -> dict[str, Any]:
        """Turn the scripted demonstration scenario on or off."""
        scenario_state["on"] = enabled
        if not enabled:
            faults.clear()
        return {**envelope(), "scenario_enabled": enabled}

    @app.get("/api/weather")
    def weather_view(t: str) -> dict[str, Any]:
        when = parse_time(t)
        name = sorted({b.config_name for b in state.plant.blocks})[0]
        return {
            **envelope(),
            "timestamp": when.isoformat(),
            "ghi_w_m2": at("ghi", name, when),
            "poa_w_m2": at("poa_effective", name, when),
            "temp_ambient_c": at("temp_ambient", name, when),
            "wind_speed_m_s": at("wind_speed", name, when),
        }

    @app.post("/api/scenario")
    def set_scenario(request: ScenarioRequest) -> dict[str, Any]:
        nonlocal state
        updated_blocks = blocks
        if request.albedo is not None or request.gcr is not None:
            overrides = []
            if request.albedo is not None:
                overrides.append(
                    ScenarioOverride("albedo", request.albedo, "ASMP-005")
                )
            if request.gcr is not None:
                overrides.append(ScenarioOverride("gcr", request.gcr, "ASMP-013"))
            try:
                updated = {
                    name: apply_overrides(block, overrides)
                    for name, block in blocks.blocks.items()
                }
            except ScenarioError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            updated_blocks = blocks.model_copy(update={"blocks": updated})

        state = make_state(request.day or state.day, updated_blocks, project)
        return {**envelope(), "applied": request.model_dump(exclude_none=True)}

    @app.get("/api/block/{block_id}/model")
    def block_model(block_id: str) -> dict[str, Any]:
        """3D parts for a station, with any injected fault mapped to a part."""
        block = find_block(block_id)
        active = {f.asset: f for f in faults.for_block(block_id)}
        return {
            **envelope(),
            "block_id": block.block_id,
            "config_name": block.config_name,
            "note": model_note,
            "file": f"/static/models/{model_file}" if model_file else "",
            "parts": [
                {
                    "key": part["key"],
                    "group": part["group"],
                    "asset": part["asset"],
                    "label": part["label"],
                    "fault": active[part["asset"]].as_dict()
                    if part["asset"] in active
                    else None,
                }
                for part in model_parts
            ],
            "faults": [f.as_dict() for f in faults.for_block(block_id)],
        }

    @app.post("/api/fault")
    def inject_fault(request: FaultRequest) -> dict[str, Any]:
        """Place a demonstration fault on one asset of one station."""
        find_block(request.block_id)
        try:
            fault = faults.inject(
                request.block_id, request.asset, request.fault_type
            )
        except FaultError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {**envelope(), "fault": fault.as_dict()}

    @app.delete("/api/fault")
    def clear_faults(
        block_id: str | None = None, asset: str | None = None
    ) -> dict[str, Any]:
        """Clear injected faults; omit both arguments to clear everything."""
        return {**envelope(), "cleared": faults.clear(block_id, asset)}

    @app.get("/api/faults")
    def list_faults() -> dict[str, Any]:
        """Every fault currently injected, across all stations."""
        return {**envelope(), "faults": [f.as_dict() for f in faults.all()]}

    app.mount(
        "/static", StaticFiles(directory=STATIC_DIR), name="static"
    )

    @app.get("/plant", include_in_schema=False)
    def dashboard() -> FileResponse:
        """Serve the Plant page (the NAJM-3000 dashboard, reused by Raseen)."""
        return FileResponse(STATIC_DIR / "index.html")

    return app
