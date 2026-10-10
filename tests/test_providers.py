"""Provider adapters tested against recorded-shape responses via httpx.MockTransport (no network)."""

import dataclasses
import datetime as dt

import httpx
import numpy as np
import pandas as pd
import pytest

from app.cache import FileCache
from app.providers.base import HttpClient, ProviderError, fill_gaps
from app.providers.nasa_power import NasaPowerProvider
from app.providers.open_meteo import OpenMeteoArchiveProvider, OpenMeteoForecastProvider

YEAR = dt.date.today().year - 1


def power_body(year: int, missing_hour: str | None = None):
    idx = pd.date_range(f"{year}-01-01", f"{year}-12-31 23:00", freq="h")
    keys = idx.strftime("%Y%m%d%H")
    ghi = np.clip(800 * np.sin((idx.hour - 6) / 12 * np.pi), 0, None)
    def series(vals):
        d = {k: float(v) for k, v in zip(keys, vals)}
        if missing_hour:
            d[missing_hour] = -999.0
        return d
    n = len(idx)
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [70.9, 26.9, 173.4]},
        "header": {"api": {"version": "v2.10.2", "name": "POWER Hourly API"}, "fill_value": -999.0},
        "properties": {"parameter": {
            "ALLSKY_SFC_SW_DWN": series(ghi), "ALLSKY_SFC_SW_DNI": series(ghi * 0.8), "ALLSKY_SFC_SW_DIFF": series(ghi * 0.2),
            "T2M": series(np.full(n, 28.0)), "WS10M": series(np.full(n, 4.0)), "WS50M": series(np.full(n, 5.5)),
            "PS": series(np.full(n, 98.8)),
        }},
        "messages": [],
    }


def client(settings, handler):
    return HttpClient(settings, FileCache(settings.cache_dir), transport=httpx.MockTransport(handler))


def test_nasa_power_parse_units_and_fill(settings):
    calls = []

    def handler(req: httpx.Request):
        calls.append(req)
        assert req.url.params["time-standard"] == "UTC"
        assert req.url.params["community"] == "RE"
        return httpx.Response(200, json=power_body(YEAR, missing_hour=f"{YEAR}010112"))

    p = NasaPowerProvider(settings, client(settings, handler))
    ws = p.fetch_years(26.9, 70.9, YEAR, YEAR)
    assert len(ws.data) in (8760, 8784)
    assert ws.data.index.tz is not None and str(ws.data.index.tz) == "UTC"
    assert ws.data["pressure"].iloc[0] == pytest.approx(98_800)  # kPa → Pa
    assert not ws.data.isna().any().any()  # -999 filled
    assert ws.quality["columns"]["ghi"]["missing_hours"] == 1
    assert ws.elevation_m == pytest.approx(173.4)
    assert ws.wind_heights == [10, 50]
    assert "POWER" in ws.source.attribution and ws.source.from_cache is False
    # Second call is served from the on-disk cache.
    ws2 = p.fetch_years(26.9, 70.9, YEAR, YEAR)
    assert len(calls) == 1 and ws2.source.from_cache is True


def test_nasa_power_rejects_future_and_too_early_years(settings):
    p = NasaPowerProvider(settings, client(settings, lambda r: httpx.Response(500)))
    with pytest.raises(ProviderError) as e:
        p.fetch_years(0, 0, 1990, 1991)
    assert e.value.status == 422
    with pytest.raises(ProviderError):
        p.fetch_years(0, 0, YEAR, YEAR + 1)


@pytest.mark.parametrize("status,expected", [(429, 503), (500, 502), (400, 422)])
def test_http_error_mapping(settings, status, expected):
    p = NasaPowerProvider(settings, client(settings, lambda r: httpx.Response(status, json={"messages": ["bad"]})))
    with pytest.raises(ProviderError) as e:
        p.fetch_years(10, 10, YEAR, YEAR)
    assert e.value.status == expected


def test_network_failure_is_provider_error(settings):
    def boom(req):
        raise httpx.ConnectError("dns", request=req)

    p = NasaPowerProvider(settings, client(settings, boom))
    with pytest.raises(ProviderError) as e:
        p.fetch_years(10, 10, YEAR, YEAR)
    assert e.value.status == 502 and e.value.retryable


def test_offline_mode_blocks_network(settings):
    s = dataclasses.replace(settings, offline=True)
    p = NasaPowerProvider(s, client(s, lambda r: pytest.fail("network used in offline mode")))
    with pytest.raises(ProviderError) as e:
        p.fetch_years(10, 10, YEAR, YEAR)
    assert e.value.status == 503


def om_body(start: str, end: str, wind_vars: list[str]):
    idx = pd.date_range(start, pd.Timestamp(end) + pd.Timedelta(hours=23), freq="h")
    n = len(idx)
    ghi = np.arange(n, dtype=float)  # strictly increasing so the shift is easy to check
    hourly = {"time": idx.strftime("%Y-%m-%dT%H:%M").tolist(), "shortwave_radiation": ghi.tolist(),
              "direct_normal_irradiance": ghi.tolist(), "diffuse_radiation": ghi.tolist(),
              "temperature_2m": [25.0] * n, "surface_pressure": [1000.0] * n}
    for v in wind_vars:
        hourly[v] = [5.0] * n
    return {"latitude": 27.0, "longitude": 71.0, "elevation": 240.0, "hourly": hourly}


def test_open_meteo_archive_shift_and_units(settings):
    seen = []

    def handler(req):
        q = req.url.params
        seen.append(q)
        assert q["wind_speed_unit"] == "ms" and q["models"] == "era5" and "apikey" not in q
        return httpx.Response(200, json=om_body(q["start_date"], q["end_date"], ["wind_speed_10m", "wind_speed_100m"]))

    p = OpenMeteoArchiveProvider(settings, client(settings, handler))
    ws = p.fetch_years(27.0, 71.0, YEAR, YEAR)
    # Value labelled 01:00 (mean of 00–01) must now sit at 00:00.
    assert ws.data["ghi"].iloc[0] == 1.0
    assert ws.data["pressure"].iloc[0] == 100_000.0  # hPa → Pa
    assert ws.wind_heights == [10, 100]
    assert ws.latitude == 27.0 and ws.elevation_m == 240.0
    assert "CC BY 4.0" in ws.source.attribution


def test_api_key_is_redacted_everywhere(settings):
    s = dataclasses.replace(settings, open_meteo_api_key="secret-key-123")

    def handler(req):
        assert req.url.params["apikey"] == "secret-key-123"
        q = req.url.params
        return httpx.Response(200, json=om_body(q["start_date"], q["end_date"], ["wind_speed_10m", "wind_speed_100m"]))

    ws = OpenMeteoArchiveProvider(s, client(s, handler)).fetch_years(27.0, 71.0, YEAR, YEAR)
    assert "secret-key-123" not in ws.source.request_url
    for f in s.cache_dir.rglob("*.json.gz"):
        import gzip
        assert "secret-key-123" not in gzip.open(f, "rt").read()


def test_open_meteo_forecast_drops_missing_heights(settings):
    def handler(req):
        today = dt.date.today()
        assert req.url.params["forecast_days"] == "3"  # one extra day so a full window from "now" exists
        body = om_body(str(today), str(today + dt.timedelta(days=2)),
                       ["wind_speed_10m", "wind_speed_80m", "wind_speed_120m", "wind_speed_180m"])
        body["hourly"]["wind_speed_180m"] = [None] * len(body["hourly"]["time"])
        return httpx.Response(200, json=body)

    ws = OpenMeteoForecastProvider(settings, client(settings, handler)).fetch_forecast(27, 71, 2)
    assert ws.wind_heights == [10, 80, 120]
    assert len(ws.data) == 48  # exactly days × 24 h from the current hour
    assert ws.extra["forecast_start_utc"] <= ws.extra["forecast_end_utc"]
    assert ws.data.index[0] >= pd.Timestamp.now(tz="UTC").floor("h") - pd.Timedelta(hours=1)


def test_fill_gaps_report():
    idx = pd.date_range("2023-01-01", periods=48, freq="h", tz="UTC")
    df = pd.DataFrame({"ghi": np.arange(48.0), "temp_air": 20.0}, index=idx)
    df.iloc[5:7, 0] = np.nan       # short gap → interpolated
    df.iloc[20:30, 0] = np.nan     # long gap → month/hour mean
    out, rep = fill_gaps(df)
    assert out.notna().all().all()
    assert out["ghi"].iloc[5] == pytest.approx(5.0)
    assert rep["columns"]["ghi"]["missing_hours"] == 12


def test_geocoder_filters_by_region_after_comma(settings):
    from app.providers.geocoding import OpenMeteoGeocoder

    seen = []
    places = [
        {"name": "Sāngli", "admin1": "Maharashtra", "country": "India", "country_code": "IN", "latitude": 16.85, "longitude": 74.58},
        {"name": "Sangli", "admin1": "Karnataka", "country": "India", "country_code": "IN", "latitude": 15.1, "longitude": 75.1},
    ]

    def handler(req):
        seen.append(req.url.params["name"])
        return httpx.Response(200, json={"results": places})

    g = OpenMeteoGeocoder(settings, client(settings, handler))
    res = g.search("sangli, mahar")
    assert seen[-1] == "sangli"  # only the place name goes upstream
    assert [r["label"] for r in res["results"]] == ["Sāngli, Maharashtra, India"]
    assert res["note"] is None
    res = g.search("Sangli, IN")
    assert len(res["results"]) == 2
    res = g.search("Sangli, Gujarat")  # no region match → fall back to all, with a note
    assert len(res["results"]) == 2 and "showing all places" in res["note"]
