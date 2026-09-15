from __future__ import annotations

import sys
from pathlib import Path

import raseen.api


def test_status_carries_the_envelope(client):
    body = client.get("/api/status").json()
    assert body["classification"] == "SIMULATION (RASEEN PROTOTYPE)"
    assert "NOT MEASURED" in body["disclaimer"].upper()
    assert "NOT CALIBRATED" in body["disclaimer"].upper()
    assert body["is_live"] is False
    assert body["plant"] == "NAJM-3000"
    assert body["site_mode"] in ("real", "representative")
    assert len(body["what_is_real"]) >= 6


def test_api_never_imports_najm3000():
    assert not any(name.split(".")[0] == "najm3000" for name in sys.modules)
    source = Path(raseen.api.__file__).read_text(encoding="utf-8")
    assert "najm3000" not in source


def test_index_shows_a_simulated_source_before_any_data_loads(client):
    body = client.get("/").text
    chip = body[body.index('id="data-source-chip"'):][:400]
    assert "SIM" in chip
    assert "LIVE" not in chip


def test_static_assets_are_served(client):
    assert client.get("/static/styles.css").status_code == 200


def test_shell_has_sidebar_tabs_and_page_root(client):
    body = client.get("/").text
    for route in ("#/kingdom", "#/plant/najm-3000", "#/control", "#/declarations", "#/about"):
        assert f'href="{route}"' in body
    assert 'id="page-root"' in body
    assert 'id="banner"' in body
    for asset in ("app.js", "store.js", "api.js", "format.js", "colour.js",
                  "pages/about.js", "pages/plant.js", "pages/kingdom.js",
                  "pages/control.js", "pages/declarations.js"):
        assert client.get(f"/static/{asset}").status_code == 200, asset
