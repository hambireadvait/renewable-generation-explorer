"""API tests. External providers are replaced by a mock transport; the demo provider is used for end-to-end runs."""

import datetime as dt

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main
from app.providers.registry import build_registry

YEAR = dt.date.today().year - 1


@pytest.fixture
def api(settings):
    def offline(req):
        raise httpx.ConnectError("no network in tests", request=req)

    main.app.state.registry = build_registry(settings, transport=httpx.MockTransport(offline))
    main._memo.data.clear()
    yield TestClient(main.app)
    main.app.state.registry = None


def body(**over):
    b = {
        "location": {"latitude": 26.92, "longitude": 70.9, "label": "Test site"},
        "provider": "demo", "start_year": YEAR - 2, "end_year": YEAR,
        "solar": {"capacity_kwp": 500}, "wind": {"turbine_rated_kw": 2000, "hub_height_m": 100},
        "hybrid": {"export_limit_kw": 1500},
    }
    b.update(over)
    return b


def test_health_providers_defaults(api):
    assert api.get("/api/health").json()["status"] == "ok"
    prov = api.get("/api/providers").json()
    ids = {p["id"] for p in prov["historical"]}
    assert {"nasa_power", "open_meteo_era5", "demo"} <= ids
    assert all("license" in p and "api_key_required" in p for p in prov["historical"])
    d = api.get("/api/defaults").json()
    assert d["period"]["end_year"] == YEAR and d["forecast"]["days"] == 7
    assert "finance" not in d


def test_long_term_demo_end_to_end(api):
    r = api.post("/api/assess", json=body())
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["use_case"] == "long_term_average" and p["is_demo"] is True
    assert p["warnings"][0].startswith("DEMO MODE")
    assert set(p["results"]) == {"solar", "wind", "hybrid"}
    for tech in ("solar", "wind", "hybrid"):
        s = p["results"][tech]["summary"]
        assert s["annual_mean_kwh"] > 0 and len(s["monthly"]) == 12 and len(s["per_year"]) == 3
        assert s["interannual"]["p90_1yr_kwh_interannual_only"] is not None
    assert p["results"]["hybrid"]["curtailed_fraction_pct"] > 0
    assert "finance" not in p
    assert p["source"]["is_demo"] is True
    assert "land suitability or availability" in p["not_assessed"]


def test_area_selection_uses_centroid(api):
    b = body(location={"area": {"south": 26.0, "west": 70.0, "north": 28.0, "east": 72.0}})
    p = api.post("/api/assess", json=b).json()
    assert p["site"]["requested"]["latitude"] == 27.0 and p["site"]["requested"]["longitude"] == 71.0
    assert p["area"]["evaluated_at"] == "centroid"
    assert any("centroid" in w for w in p["warnings"])


def test_finance_fields_are_rejected(api):
    r = api.post("/api/assess", json=body(finance={"solar": {"capex_per_kw": 1}}))
    assert r.status_code == 422


@pytest.mark.parametrize("patch,field", [
    ({"location": {"latitude": 95, "longitude": 0}}, "location.latitude"),
    ({"solar": {"capacity_kwp": -1}}, "solar.capacity_kwp"),
    ({"solar": None, "wind": None}, "(request)"),
    ({"end_year": YEAR + 1}, "(request)"),
    ({"wind": {"turbine_rated_kw": 100, "power_curve": [[5, 0], [4, 50], [6, 100]]}}, "wind"),
    ({"solar": {"capacity_kwp": 10, "losses_pct": {"bogus": 1}}}, "solar.losses_pct"),
    ({"location": {"area": {"south": 10, "west": 10, "north": 9, "east": 11}}}, "location.area"),
])
def test_validation_errors(api, patch, field):
    r = api.post("/api/assess", json=body(**patch))
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["type"] == "validation_error"
    assert any(i["field"].startswith(field) for i in err["issues"]), err


def test_provider_failure_is_clear_json_error(api):
    r = api.post("/api/assess", json=body(provider="nasa_power"))
    assert r.status_code == 502
    e = r.json()["error"]
    assert e["type"] == "provider_error" and "demo" in e["hint"].lower()


def test_report_and_exports(api):
    b = body()
    r = api.post("/api/report", json=b)
    assert r.status_code == 200 and "DEMO MODE" in r.text and "<svg" in r.text
    assert "attachment" in r.headers["content-disposition"]
    assert api.post("/api/export/cashflow", json=b).status_code == 422
    for kind in ("monthly", "daily", "hourly"):
        r = api.post(f"/api/export/{kind}", json=b)
        assert r.status_code == 200, kind
        assert r.text.startswith("# DEMO MODE"), kind
    hourly = api.post("/api/export/hourly", json=b).text.splitlines()
    assert hourly[2].startswith("time_local_hour_start,time_utc_hour_start,solar_kw")
    assert api.post("/api/export/json", json=b).json()["is_demo"] is True


def fbody(**over):
    b = {"location": {"latitude": 20, "longitude": 78, "label": "Test"}, "provider": "demo", "days": 7,
         "solar": {"capacity_kwp": 100}, "wind": {"turbine_rated_kw": 500, "hub_height_m": 100}}
    b.update(over)
    return b


def test_weekly_forecast_demo(api):
    r = api.post("/api/forecast", json=fbody())
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["use_case"] == "near_term_forecast" and p["is_demo"]
    assert p["label"] == "Generation forecast for the next 7 days"
    assert p["forecast_period"]["hours"] == 168
    assert set(p["results"]) == {"solar", "wind", "hybrid"}
    total_daily = sum(d["hybrid_kwh"] for d in p["daily"])
    assert total_daily == pytest.approx(p["summary"]["total_kwh"], rel=1e-3)
    assert p["results"]["hybrid"]["totals"]["energy_kwh"] == pytest.approx(
        p["results"]["solar"]["totals"]["energy_kwh"] + p["results"]["wind"]["totals"]["energy_kwh"], rel=1e-6)
    d0 = p["daily"][1]
    assert {"weekday", "irradiation_kwh_m2", "mean_hub_wind_ms", "solar_peak_kw"} <= set(d0)
    assert p["summary"]["best_day"]["kwh"] >= p["summary"]["lowest_day"]["kwh"]
    assert "finance" not in p
    assert any("not a typical week" in w for w in p["warnings"])


def test_forecast_region_and_export_limit(api):
    b = fbody(location={"area": {"south": 19, "west": 77, "north": 21, "east": 79}}, hybrid={"export_limit_kw": 200})
    p = api.post("/api/forecast", json=b).json()
    assert p["area"]["evaluated_at"] == "centroid"
    assert p["site"]["requested"]["latitude"] == 20.0
    h = p["results"]["hybrid"]["totals"]
    assert h["peak_kw"] <= 200 + 1e-6 and h["curtailed_kwh"] >= 0


def test_forecast_report_and_csv(api):
    r = api.post("/api/forecast/report", json=fbody())
    assert r.status_code == 200 and "DEMO MODE" in r.text and "Day by day" in r.text and "<svg" in r.text
    csv = api.post("/api/forecast/export", json=fbody(days=1)).text
    assert csv.startswith("# DEMO MODE") and "hybrid_kw" in csv.splitlines()[2]


def test_forecast_rejects_finance_fields(api):
    r = api.post("/api/forecast", json=fbody(finance={}))
    assert r.status_code == 422


def test_index_served(api):
    r = api.get("/")
    assert r.status_code == 200 and "Renewable Generation Explorer" in r.text


def test_static_shell_headers_and_compression(api):
    r = api.get("/")
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["x-content-type-options"] == "nosniff"
    for path in ("/static/styles.css", "/static/js/app.js", "/static/js/ui/icons.js", "/static/favicon.svg"):
        assert api.get(path).status_code == 200, path
    fav = api.get("/favicon.ico", follow_redirects=False)
    assert fav.status_code == 308 and fav.headers["location"] == "/static/favicon.svg"
    big = api.post("/api/assess", json=body(), headers={"Accept-Encoding": "gzip"})
    assert big.headers.get("content-encoding") == "gzip"


def _om_forecast_body(lat=20.0, lon=78.0, days=3):
    import numpy as np
    import pandas as pd

    idx = pd.date_range(pd.Timestamp.now(tz="UTC").floor("D"), periods=24 * (days + 1), freq="h")
    hour = idx.hour.to_numpy()
    ghi = np.clip(900 * np.sin((hour - 1) / 12 * np.pi), 0, None)  # daylight ≈ 01–13 UTC (India)
    hourly = {"time": idx.strftime("%Y-%m-%dT%H:%M").tolist(), "shortwave_radiation": ghi.tolist(),
              "direct_normal_irradiance": (ghi * 0.8).tolist(), "diffuse_radiation": (ghi * 0.2).tolist(),
              "temperature_2m": [30.0] * len(idx), "surface_pressure": [1000.0] * len(idx)}
    for h in (10, 80, 120, 180):
        hourly[f"wind_speed_{h}m"] = [5.0 + h / 100] * len(idx)
    return {"latitude": lat, "longitude": lon, "elevation": 300.0, "hourly": hourly}


def test_rate_limit_error_has_code(settings):
    def limited(req):
        return httpx.Response(429, json={"error": True, "reason": "Daily API request limit exceeded."})

    main.app.state.registry = build_registry(settings, transport=httpx.MockTransport(limited))
    main._memo.data.clear()
    try:
        r = TestClient(main.app).post("/api/forecast", json=fbody(provider="open_meteo_forecast"))
        e = r.json()["error"]
        assert r.status_code == 503 and e["code"] == "rate_limited" and "Daily API request limit" in e["message"]
    finally:
        main.app.state.registry = None


def test_browser_request_never_contains_api_key(api, settings, monkeypatch):
    import dataclasses

    main.app.state.registry = build_registry(dataclasses.replace(settings, open_meteo_api_key="secret-123"))
    r = api.post("/api/forecast/browser-request", json=fbody(provider="open_meteo_forecast", days=7))
    d = r.json()
    assert r.status_code == 200 and d["url"] == "https://api.open-meteo.com/v1/forecast"
    assert "apikey" not in d["params"] and "secret-123" not in r.text
    assert d["params"]["forecast_days"] == 8 and d["params"]["wind_speed_unit"] == "ms"


def test_forecast_from_browser_weather(api):
    req = fbody(provider="open_meteo_forecast", days=2)
    r = api.post("/api/forecast/from-browser", json={"request": req, "weather": _om_forecast_body(days=2)})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["fetched_by"] == "browser" and not p["is_demo"]
    assert "fetched by your browser" in p["source"]["dataset"]
    assert p["forecast_period"]["hours"] <= 48 and p["results"]["solar"]["totals"]["energy_kwh"] >= 0
    rep = api.post("/api/forecast/from-browser?output=report", json={"request": req, "weather": _om_forecast_body(days=2)})
    assert rep.status_code == 200 and "Day by day" in rep.text
    csv = api.post("/api/forecast/from-browser?output=csv", json={"request": req, "weather": _om_forecast_body(days=2)})
    assert csv.status_code == 200 and "solar_kw" in csv.text


def test_forecast_from_browser_rejects_bad_weather(api):
    req = fbody(provider="open_meteo_forecast", days=2)
    far = _om_forecast_body(lat=45.0)
    assert api.post("/api/forecast/from-browser", json={"request": req, "weather": far}).status_code == 422
    bad = _om_forecast_body()
    bad["hourly"]["temperature_2m"] = bad["hourly"]["temperature_2m"][:-5]
    assert api.post("/api/forecast/from-browser", json={"request": req, "weather": bad}).status_code == 422
    demo = fbody(provider="demo")
    assert api.post("/api/forecast/from-browser", json={"request": demo, "weather": _om_forecast_body()}).status_code == 422
