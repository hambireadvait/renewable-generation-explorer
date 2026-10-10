"""Open-Meteo adapters: Historical Weather API (ERA5) and Forecast API.

Docs: https://open-meteo.com/en/docs/historical-weather-api , https://open-meteo.com/en/docs
Terms: https://open-meteo.com/en/terms
* Free tier: no key, NON-COMMERCIAL use only, 600/min · 5 000/h · 10 000/day · 300 000/month,
  data under CC BY 4.0 (attribution required). Commercial use needs a paid key (OPEN_METEO_API_KEY).
* Radiation variables are the mean over the PRECEDING hour → we shift them back one hour so the
  label marks the start of the averaging interval. Temperature, pressure and wind are instantaneous
  values at the label time and are kept as the value at the start of the interval.
* Requested with wind_speed_unit=ms and timezone=GMT; pressure arrives in hPa (→ Pa).
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import pandas as pd

from app.config import Settings
from app.providers.base import (
    HttpClient,
    ProviderError,
    SourceInfo,
    WeatherSeries,
    complete_years_frame,
    fill_gaps,
    to_float_array,
)

ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"
LICENSE = "CC BY 4.0; free tier for non-commercial use only"

RADIATION = {
    "shortwave_radiation": "ghi",
    "direct_normal_irradiance": "dni",
    "diffuse_radiation": "dhi",
}
STATE = {"temperature_2m": "temp_air", "surface_pressure": "pressure"}


def _parse_hourly(body: dict[str, Any], wind_vars: dict[str, str], provider: str) -> pd.DataFrame:
    if not isinstance(body, dict) or "hourly" not in body:
        reason = body.get("reason") if isinstance(body, dict) else None
        raise ProviderError(f"Unexpected Open-Meteo response. {reason or ''}".strip(), provider=provider)
    hourly = body["hourly"]
    index = pd.to_datetime(hourly["time"], utc=True)
    cols: dict[str, Any] = {}
    for var, col in {**RADIATION, **STATE, **wind_vars}.items():
        if var not in hourly:
            raise ProviderError(f"Open-Meteo response lacks '{var}'.", provider=provider)
        cols[col] = to_float_array(hourly[var])
    df = pd.DataFrame(cols, index=index)
    # Preceding-hour mean labeled at hour end → move to hour start.
    for col in RADIATION.values():
        df[col] = df[col].shift(-1)
    df["pressure"] = df["pressure"] * 100.0  # hPa → Pa
    return df


class OpenMeteoArchiveProvider:
    id = "open_meteo_era5"
    name = "Open-Meteo Historical (ERA5)"
    min_year = 1950
    wind_heights = [10, 100]
    _wind_vars = {"wind_speed_10m": "wind_10m", "wind_speed_100m": "wind_100m"}

    def __init__(self, settings: Settings, http: HttpClient):
        self.settings = settings
        self.http = http

    def describe(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": "historical",
            "dataset": "ECMWF ERA5 reanalysis via Open-Meteo Historical Weather API (models=era5)",
            "coverage": "Global, 1940 → ~5 days ago (app allows 1950+ complete years)",
            "resolution": "0.25° (~25–30 km)",
            "variables": "GHI, DNI, DHI, T2M, wind at 10 m and 100 m, surface pressure",
            "units": "W/m² (preceding-hour mean), °C, m/s, Pa (converted from hPa)",
            "api_key_required": False,
            "rate_limits": "Free tier: 600/min, 5 000/h, 10 000/day, 300 000/month (multi-year requests count as several calls)",
            "cost": "Free for non-commercial use; paid plans for commercial use",
            "license": LICENSE,
            "attribution": ATTRIBUTION,
            "docs_url": "https://open-meteo.com/en/docs/historical-weather-api",
            "min_year": self.min_year,
            "wind_heights_m": self.wind_heights,
            "commercial_key_configured": self.settings.open_meteo_commercial,
        }

    def fetch_years(self, lat: float, lon: float, start_year: int, end_year: int) -> WeatherSeries:
        last_complete = dt.date.today().year - 1
        if start_year < self.min_year or end_year > last_complete or start_year > end_year:
            raise ProviderError(
                f"Open-Meteo ERA5 supports complete years {self.min_year}–{last_complete} in this app.",
                provider=self.name, status=422, retryable=False,
            )
        frames, retrieved, hits, urls = [], [], [], []
        body: dict[str, Any] = {}
        for year in range(start_year, end_year + 1):
            # Ask for one extra hour so the shifted radiation series has a value for 23:00 on 31 Dec.
            # (Skipped when 1 Jan of the next year is inside the archive's ~5-day lag.)
            lag_ok = dt.date.today() - dt.date(year + 1, 1, 1) > dt.timedelta(days=7)
            end = f"{year + 1}-01-01" if lag_ok else f"{year}-12-31"
            params = self._params(lat, lon, f"{year}-01-01", end)
            body, when, hit, url = self.http.get_json(
                self.settings.open_meteo_archive_url, params, ttl_s=self.settings.ttl_historical_s, provider=self.name
            )
            df = _parse_hourly(body, self._wind_vars, self.name)
            frames.append(df[df.index.year == year])
            retrieved.append(when)
            hits.append(hit)
            urls.append(url)
        raw = pd.concat(frames).sort_index()
        raw = raw.reindex(complete_years_frame(start_year, end_year))
        data, quality = fill_gaps(raw)
        if quality["max_missing_pct"] > 10:
            raise ProviderError("Open-Meteo ERA5 data is more than 10% missing for this request.",
                                provider=self.name, status=422, retryable=False)
        source = SourceInfo(
            provider_id=self.id,
            name=self.name,
            dataset=f"ERA5 reanalysis (Open-Meteo archive, models=era5), {start_year}–{end_year}",
            docs_url="https://open-meteo.com/en/docs/historical-weather-api",
            license=LICENSE,
            attribution=ATTRIBUTION + "; Contains modified Copernicus Climate Change Service information (ERA5).",
            resolution="0.25°",
            retrieved_at=min(retrieved),
            from_cache=all(hits),
            request_url=urls[0] + (f" (+{len(urls) - 1} more yearly requests)" if len(urls) > 1 else ""),
        )
        return WeatherSeries(
            data=data,
            wind_heights=list(self.wind_heights),
            source=source,
            latitude=float(body.get("latitude", lat)),
            longitude=float(body.get("longitude", lon)),
            elevation_m=body.get("elevation"),
            quality=quality,
        )

    def _params(self, lat: float, lon: float, start: str, end: str) -> dict[str, Any]:
        params: dict[str, Any] = {
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "start_date": start,
            "end_date": end,
            "hourly": ",".join([*RADIATION, *STATE, *self._wind_vars]),
            "models": "era5",
            "wind_speed_unit": "ms",
            "timezone": "GMT",
        }
        if self.settings.open_meteo_api_key:
            params["apikey"] = self.settings.open_meteo_api_key
        return params


class OpenMeteoForecastProvider:
    id = "open_meteo_forecast"
    name = "Open-Meteo Forecast"
    max_days = 16
    wind_heights = [10, 80, 120, 180]
    _wind_vars = {f"wind_speed_{h}m": f"wind_{h}m" for h in (10, 80, 120, 180)}

    def __init__(self, settings: Settings, http: HttpClient):
        self.settings = settings
        self.http = http

    def describe(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": "forecast",
            "dataset": "Open-Meteo Forecast API, 'best_match' (blend of national weather-service models chosen by location)",
            "coverage": "Global, up to 16 days ahead, hourly",
            "resolution": "Depends on the model selected for the location (≈1–25 km)",
            "variables": "GHI, DNI, DHI, T2M, wind at 10/80/120/180 m, surface pressure",
            "units": "W/m² (preceding-hour mean), °C, m/s, Pa",
            "api_key_required": False,
            "rate_limits": "Free tier: 600/min, 5 000/h, 10 000/day, 300 000/month",
            "cost": "Free for non-commercial use; paid plans for commercial use",
            "license": LICENSE,
            "attribution": ATTRIBUTION,
            "docs_url": "https://open-meteo.com/en/docs",
            "max_days": self.max_days,
        }

    def forecast_params(self, lat: float, lon: float, days: int, *, with_key: bool = True) -> dict[str, Any]:
        if not 1 <= days <= self.max_days:
            raise ProviderError(f"Forecast days must be 1–{self.max_days}.", provider=self.name,
                                status=422, retryable=False, code="bad_request")
        params: dict[str, Any] = {
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "hourly": ",".join([*RADIATION, *STATE, *self._wind_vars]),
            # Open-Meteo counts days from 00:00 UTC today; ask for one extra day so a full
            # `days × 24 h` window starting now is available (capped at the 16-day maximum).
            "forecast_days": min(days + 1, self.max_days),
            "wind_speed_unit": "ms",
            "timezone": "GMT",
        }
        if with_key and self.settings.open_meteo_api_key:
            params["apikey"] = self.settings.open_meteo_api_key
        return params

    def browser_request(self, lat: float, lon: float, days: int) -> dict[str, Any]:
        """The exact free-tier request a visitor's browser can make itself (never includes the API key)."""
        return {"url": "https://api.open-meteo.com/v1/forecast", "params": self.forecast_params(lat, lon, days, with_key=False)}

    def fetch_forecast(self, lat: float, lon: float, days: int) -> WeatherSeries:
        params = self.forecast_params(lat, lon, days)
        body, when, hit, url = self.http.get_json(
            self.settings.open_meteo_forecast_url, params, ttl_s=self.settings.ttl_forecast_s, provider=self.name
        )
        return self.series_from_body(body, lat, lon, days, retrieved_at=when, from_cache=hit, request_url=url)

    def series_from_body(self, body: dict[str, Any], lat: float, lon: float, days: int, *, retrieved_at: str,
                         from_cache: bool, request_url: str, fetched_by: str = "server") -> WeatherSeries:
        df = _parse_hourly(body, self._wind_vars, self.name)
        # Drop heights the selected model does not provide for most of the window.
        heights = [h for h in self.wind_heights if df[f"wind_{h}m"].notna().mean() > 0.9]
        df = df.drop(columns=[f"wind_{h}m" for h in self.wind_heights if h not in heights])
        # Keep only hours from the start of the current hour of retrieval onward.
        start = pd.Timestamp(retrieved_at).floor("h")
        df = df.iloc[:-1]  # last row has no radiation after the shift
        df = df[(df.index >= start) & (df.index < start + pd.Timedelta(hours=24 * days))]
        if df.empty or 10 not in heights:
            raise ProviderError("Open-Meteo forecast returned no usable hours for this location.",
                                provider=self.name, status=422 if fetched_by == "browser" else 502)
        data, quality = fill_gaps(df)
        source = SourceInfo(
            provider_id=self.id,
            name=self.name,
            dataset="Open-Meteo Forecast API (best_match)"
            + (" — fetched by your browser (server quota exhausted)" if fetched_by == "browser" else ""),
            docs_url="https://open-meteo.com/en/docs",
            license=LICENSE,
            attribution=ATTRIBUTION,
            resolution="Model-dependent",
            retrieved_at=retrieved_at,
            from_cache=from_cache,
            request_url=request_url,
        )
        return WeatherSeries(
            data=data,
            wind_heights=heights,
            source=source,
            latitude=float(body.get("latitude", lat)),
            longitude=float(body.get("longitude", lon)),
            elevation_m=body.get("elevation"),
            quality=quality,
            extra={
                "forecast_model": "best_match",
                "fetched_by": fetched_by,
                "forecast_start_utc": data.index[0].isoformat(),
                "forecast_end_utc": (data.index[-1] + pd.Timedelta(hours=1)).isoformat(),
            },
        )
