"""Build a fully static copy of the Raseen dashboard for GitHub Pages.

GitHub Pages serves static files only, so there is no server to run the physics engine or
compute scenarios. This script pre-renders everything into ``docs/``:

* the three pages and their assets, with absolute ``/rs`` and ``/static`` paths rewritten to
  work under a project sub-path (``…github.io/Raseen/``);
* the registry, geometry and a curated set of scenarios as JSON under ``docs/data``;
* a "day bundle" for the Plant page plus a fetch shim (``rs-static-api.js``) that answers the
  NAJM-3000 dashboard's ``/api/*`` calls from that bundle — so the reused dashboard runs with
  no backend (read-only: the scripted fault injection is not part of the static demo).

Run:  .venv/Scripts/python.exe tools/build_static.py
Out:  docs/
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

APP_DIR = Path(__file__).resolve().parents[1]
WEB = APP_DIR / "raseen" / "web"
NAJM_STATIC = APP_DIR / "najm3000" / "dashboard" / "static"
DOCS = APP_DIR.parent / "docs"

# Presets pre-rendered for the Gradient Control page (must match PRESETS in control.js).
SCENARIO_PRESETS: dict[str, dict] = {
    "d1-default": {},
    "d1-g60": {"g_mw_min": 60},
    "d1-g120": {"g_mw_min": 120},
    "d1-ns": {"heading_deg": 0},
    "d1-fast": {"speed_kmh": 72},
    "d1-slow": {"speed_kmh": 24},
    "thin-dsh": {"event": "thin", "flat": True, "g_mw_min": 60},
    "scattered": {"event": "scattered"},
    "stall": {"stall_at_min": -3},
    "deepen": {"deepen_at_min": 2, "deepen_factor": 1.2},
    "high-conf": {"confidence": 0.9},
    "low-conf": {"confidence": 0.3},
    # Partial cover: only part of the plant darkens, so the clear blocks visibly hold the reserve.
    "partial-half": {"cover_frac": 0.5},
    "partial-edge": {"cover_frac": 0.35, "cover_offset": -1.0},
    "partial-soft": {"cover_frac": 0.6, "softness": 0.8},
    "haze": {"softness": 1.0},
}


#: The generated site lives alongside docs/superpowers (the spec and plan); only these
#: entries are the static site, so only these are removed and rebuilt.
SITE_ENTRIES = ("rs", "static", "data", "index.html", "kingdom.html", "control.html", "plant.html", ".nojekyll")


def clean() -> None:
    for name in SITE_ENTRIES:
        target = DOCS / name
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
    for sub in ("rs", "static", "data", "data/scenarios", "data/plant"):
        (DOCS / sub).mkdir(parents=True, exist_ok=True)


def _rewrite_rs_js(text: str) -> str:
    """rs/*.js: absolute module imports /rs/x -> ./x (siblings). /api/rs/ is left alone
    (it is only reached in live mode; the static branch uses window.RASEEN.data)."""
    return text.replace('"/rs/', '"./').replace("'/rs/", "'./")


def _rewrite_static_js(text: str) -> str:
    """static/*.js (vendored dashboard): module imports become sibling-relative; asset
    loads become document-relative (the page sits one level above static/). /api/* is left
    for the fetch shim to intercept."""
    text = text.replace('from "/static/', 'from "./').replace("from '/static/", "from './")
    text = text.replace('import("/static/', 'import("./').replace("import('/static/", "import('./")
    for verb in ("fetch(", ".load(", ".loadAsync("):
        text = text.replace(f'{verb}"/static/', f'{verb}"static/').replace(f"{verb}'/static/", f"{verb}'static/")
    return text


def copy_tree(src: Path, dst: Path, rewrite) -> None:
    for path in src.rglob("*"):
        if path.is_dir() or "__pycache__" in path.parts:
            continue
        target = dst / path.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix == ".js":
            target.write_text(rewrite(path.read_text(encoding="utf-8")), encoding="utf-8")
        else:
            shutil.copy2(path, target)


def page_html(source: Path, *, inject_head: str = "", inject_before_module: str = "") -> str:
    """Rewrite a page's asset paths for the sub-path deployment and inject static config."""
    html = source.read_text(encoding="utf-8")
    html = html.replace('href="/rs/', 'href="rs/').replace('src="/rs/', 'src="rs/')
    html = html.replace('href="/static/', 'href="static/').replace('src="/static/', 'src="static/')
    # Import-map values must be valid URLs (start with ./ or /), not bare specifiers.
    html = html.replace('"/static/vendor/', '"./static/vendor/')
    if inject_head:
        html = html.replace("</head>", f"{inject_head}\n</head>", 1)
    if inject_before_module:
        html = re.sub(r'(<script type="module")', inject_before_module + r"\n\1", html, count=1)
    return html


CONFIG_FLAG = '<script>window.RASEEN = { data: "data", static: true };</script>'


def build_pages() -> None:
    (DOCS / "kingdom.html").write_text(page_html(WEB / "kingdom.html", inject_head=CONFIG_FLAG), encoding="utf-8")
    (DOCS / "control.html").write_text(page_html(WEB / "control.html", inject_head=CONFIG_FLAG), encoding="utf-8")
    # Plant page: inject the fetch shim before the dashboard module so /api/* is served locally.
    shim_tag = '<script src="rs/rs-static-api.js"></script>'
    (DOCS / "plant.html").write_text(
        page_html(NAJM_STATIC / "index.html", inject_head=CONFIG_FLAG, inject_before_module=shim_tag),
        encoding="utf-8",
    )
    (DOCS / "index.html").write_text(
        '<!doctype html><meta charset="utf-8">'
        '<meta http-equiv="refresh" content="0; url=kingdom.html">'
        '<title>Raseen</title><a href="kingdom.html">Raseen dashboard</a>',
        encoding="utf-8",
    )
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")


def build_data(client: TestClient) -> None:
    (DOCS / "data" / "plants.json").write_text(json.dumps(client.get("/api/rs/plants").json()), encoding="utf-8")
    (DOCS / "data" / "grid.json").write_text(json.dumps(client.get("/api/rs/grid").json()), encoding="utf-8")
    (DOCS / "data" / "site.json").write_text(json.dumps(client.get("/api/rs/site").json()), encoding="utf-8")


def build_scenarios() -> None:
    from raseen.scenario.params import ScenarioParams
    from raseen.scenario.runner import run_scenario

    for key, params in SCENARIO_PRESETS.items():
        scenario = run_scenario(ScenarioParams(**params))
        (DOCS / "data" / "scenarios" / f"{key}.json").write_text(json.dumps(scenario, separators=(",", ":")), encoding="utf-8")
        print(f"  scenario {key:12s} g={scenario['front']['g_mw_min']:<4} frames={len(scenario['frames'])}")


def build_plant_bundle(client: TestClient) -> None:
    """Crawl the NAJM-3000 dashboard for a healthy day and store it compactly."""
    status = client.get("/api/status").json()
    day = status["simulated_day"]
    # Timesteps: read the trends of any block to get the day's timestamps.
    first_plant = client.get("/api/plant", params={"t": f"{day}T12:00"}).json()
    blocks_meta = [
        {"block_id": b["block_id"], "config_name": b["config_name"], "row": b["row"], "column": b["column"]}
        for b in first_plant["blocks"]
    ]
    example_id = blocks_meta[0]["block_id"]
    times = client.get(f"/api/trends/{example_id}").json()["timestamps"]

    # Per-timestep plant + weather snapshots (compact arrays).
    ac, measured, ghi, poa, tamb, wind = [], [], [], [], [], []
    for t in times:
        p = client.get("/api/plant", params={"t": t}).json()
        ac.append([b["ac_power_w"] for b in p["blocks"]])
        measured.append([b["measured_w"] for b in p["blocks"]])
        w = client.get("/api/weather", params={"t": t}).json()
        ghi.append(w["ghi_w_m2"]); poa.append(w["poa_w_m2"]); tamb.append(w["temp_ambient_c"]); wind.append(w["wind_speed_m_s"])

    # Per-config series for block detail, trends and performance. One representative block
    # per config; the shim scales power fields by each block's own variation.
    configs: dict[str, dict] = {}
    for block in blocks_meta:
        name = block["config_name"]
        if name in configs:
            continue
        rep = block["block_id"]
        detail_series = {k: [] for k in
                         ("ghi_w_m2", "poa_irradiance_w_m2", "temp_ambient_c", "temp_module_c",
                          "tracker_angle_deg", "dc_power_w", "ac_power_w", "idt_out_power_w", "block_ac_power_w")}
        variation_ref = None
        for t in times:
            d = client.get(f"/api/block/{rep}", params={"t": t}).json()
            variation_ref = d["variation_factor"]
            for k in detail_series:
                detail_series[k].append(d[k])
        configs[name] = {
            "detail": detail_series,
            "variation_ref": variation_ref,
            "trends": client.get(f"/api/trends/{rep}").json(),
            "performance": client.get(f"/api/performance/{rep}").json(),
        }

    # Per-block variation factor (block_ac / config p_block at noon), so the shim can scale.
    noon = len(times) // 2
    for block in blocks_meta:
        d = client.get(f"/api/block/{block['block_id']}", params={"t": times[noon]}).json()
        block["variation"] = d["variation_factor"]

    model = client.get(f"/api/block/{example_id}/model").json()
    model["file"] = model["file"].replace("/static/", "static/") if model.get("file") else ""

    bundle = {
        "status": status,
        "times": times,
        "blocks": blocks_meta,
        "plant": {
            "grid_rows": first_plant["grid_rows"], "grid_columns": first_plant["grid_columns"],
            "spread_assumption_id": first_plant["spread_assumption_id"],
            "spread_fraction": first_plant["spread_fraction"], "scaling_label": first_plant["scaling_label"],
            "block_count": first_plant["block_count"], "measurement_label": first_plant["measurement_label"],
        },
        "series": {"ac": ac, "measured": measured},
        "weather": {"ghi": ghi, "poa": poa, "tamb": tamb, "wind": wind},
        "configs": configs,
        "model": model,
        "classification": first_plant["classification"], "disclaimer": first_plant["disclaimer"],
    }
    (DOCS / "data" / "plant" / "bundle.json").write_text(json.dumps(bundle, separators=(",", ":")), encoding="utf-8")
    size_mb = (DOCS / "data" / "plant" / "bundle.json").stat().st_size / 1e6
    print(f"  plant bundle: {len(times)} timesteps, {len(blocks_meta)} blocks, {len(configs)} configs, {size_mb:.1f} MB")


def main() -> None:
    from raseen.webapp import build_app

    print("Building static site into", DOCS)
    clean()
    copy_tree(WEB, DOCS / "rs", _rewrite_rs_js)
    copy_tree(NAJM_STATIC, DOCS / "static", _rewrite_static_js)
    # The shim is authored in tools/ and copied into rs/ (it must not be rewritten).
    shutil.copy2(APP_DIR / "tools" / "rs-static-api.js", DOCS / "rs" / "rs-static-api.js")
    build_pages()
    app = build_app()
    client = TestClient(app)
    build_data(client)
    build_scenarios()
    build_plant_bundle(client)
    print("Done. Serve locally with:  python -m http.server -d", DOCS)


if __name__ == "__main__":
    main()
