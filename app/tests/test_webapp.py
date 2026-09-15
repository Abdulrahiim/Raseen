"""Tests for the combined Raseen web app: the NAJM-3000 dashboard reused as the Plant page,
plus the Raseen Kingdom and Gradient Control pages and their API."""

from __future__ import annotations

import os
import tempfile

os.environ.setdefault("RASEEN_CACHE_DIR", tempfile.mkdtemp(prefix="raseen-cache-"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from raseen.webapp import CLASSIFICATION, build_app  # noqa: E402


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(build_app())


# --- pages -----------------------------------------------------------------


def test_home_redirects_to_kingdom(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code in (307, 302)
    assert r.headers["location"] == "/kingdom"


@pytest.mark.parametrize("route", ["/kingdom", "/plant", "/control"])
def test_pages_serve_html(client, route):
    r = client.get(route)
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


def test_plant_page_is_the_najm_dashboard_with_the_raseen_sidebar(client):
    body = client.get("/plant").text
    assert "/rs/sidebar.js" in body        # Raseen sidebar injected
    assert "Raseen" in body                # rebranded title
    assert 'id="site-map"' in body         # the NAJM-3000 satellite map panel is intact


def test_sidebar_and_page_assets_are_served(client):
    for asset in (
        "/rs/sidebar.js", "/rs/shell.css", "/rs/kingdom.js", "/rs/kingdom-map.js",
        "/rs/kingdom.css", "/rs/control.js", "/rs/charts.js", "/rs/control.css",
        "/rs/site-map.js", "/rs/colour.js", "/rs/data/site.json",
        "/static/app.js", "/static/sitemap.js", "/static/styles.css",
    ):
        assert client.get(asset).status_code == 200, asset


# --- Raseen API ------------------------------------------------------------


def _envelope_ok(body: dict) -> None:
    assert body["classification"] == CLASSIFICATION
    assert "NOT MEASURED" in body["disclaimer"].upper()
    assert body["is_live"] is False


def test_rs_status_and_site(client):
    _envelope_ok(client.get("/api/rs/status").json())
    site = client.get("/api/rs/site").json()
    _envelope_ok(site)
    assert len(site["mvps"]) == 363 and len(site["blocks"]) == 30
    assert site["blocks"][0]["id"] == "B01"
    assert len(site["mvps_block_index"]) == 363


def test_najm_status_still_served(client):
    """The reused dashboard keeps its own status route."""
    body = client.get("/api/status").json()
    assert body["block_count"] == 365
    assert body["is_live"] is False


def test_scenario_endpoint(client):
    body = client.post("/api/rs/scenario", json={"g_mw_min": 120}).json()
    _envelope_ok(body)
    assert len(body["frames"]) == 841 and body["front"]["g_mw_min"] == 120
    # Raseen holds the declared gradient against a much steeper uncontrolled drop.
    assert body["kpis"]["bgc"]["max_grad_mw_min"] <= 120 * 1.1
    assert body["kpis"]["base"]["max_grad_mw_min"] > body["kpis"]["bgc"]["max_grad_mw_min"]
    # The second strategy travels in the same payload, with its own line and reserve.
    frame = body["frames"][400]
    assert len(frame["P_hold"]) == 30
    assert {"P_hold", "P_star_hold", "R_hold"} <= set(frame["agg"])
    assert body["kpis"]["hold"]["max_grad_mw_min"] <= 120 * 1.1
    front = body["front"]
    for key in ("hold_mw", "hold_margin_mw", "t_hold_start_min", "t_first_min", "t_last_min",
                "blocks_reached", "stations_reached", "first_block", "last_block"):
        assert key in front, key
    assert front["blocks_reached"] == 30 and front["stations_reached"] == 363
    assert front["t_hold_start_min"] < front["t_desc_start_min"]
    again = client.get(f"/api/rs/scenario/{body['scenario_id']}")
    assert again.status_code == 200
    assert client.get("/api/rs/scenario/nope").status_code == 404
    bad = client.post("/api/rs/scenario", json={"depth": 5})
    assert bad.status_code == 400 and bad.json()["classification"] == CLASSIFICATION


def test_partial_cover_reports_what_the_front_reaches(client):
    body = client.post("/api/rs/scenario", json={"cover_frac": 0.4}).json()
    front = body["front"]
    assert 0 < front["blocks_reached"] < 30
    assert 0 < front["stations_reached"] < 363
    assert front["first_block"] and front["last_block"]
    # Through the cover the hold strategy sits on its flat line while the ramp follows its own.
    cover = [f for f in body["frames"] if f["phase"] == "cover"]
    assert cover
    assert all(abs(f["agg"]["P_hold"] - f["agg"]["P_star_hold"]) < 5.0 for f in cover)


def test_plants_and_grid(client):
    plants = client.get("/api/rs/plants").json()
    _envelope_ok(plants)
    assert len(plants["plants"]) >= 30
    assert plants["summary"]["count"] == len(plants["plants"])
    assert {p["technology"] for p in plants["plants"]} == {"pv", "wind", "csp", "bess"}
    assert "indicative" in plants["note"].lower()
    grid = client.get("/api/rs/grid").json()
    _envelope_ok(grid)
    assert grid["geojson"]["type"] == "FeatureCollection"


def test_ui_copy_avoids_the_kill_sentences():
    import re
    from pathlib import Path

    import raseen.webapp

    web = Path(raseen.webapp.__file__).parent / "web"
    suffixes = {".js", ".html", ".css"}
    text = " ".join(
        p.read_text(encoding="utf-8") for p in web.rglob("*") if p.suffix in suffixes
    )
    for phrase in (
        "AI predicts clouds", "operators are blind", "grid will collapse",
        "we store energy as headroom", "no energy is lost", "we test LVRT", "we control loads",
    ):
        assert not re.search(re.escape(phrase), text, re.I), phrase
