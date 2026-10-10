"""NASA POWER Hourly API adapter (historical / long-term resource).

Docs: https://power.larc.nasa.gov/docs/services/api/temporal/hourly/
* No API key. Max 15 parameters per request. Coverage 2001-01-01 → near real time.
* Hourly values are labeled with the START of the hour (POWER FAQ) — matches our convention.
* Units: irradiance Wh/m² per hour (= hour-mean W/m²), T2M °C, WS m/s, PS kPa. Fill = -999.
* Citation is required — see `ATTRIBUTION`.
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

PARAMS = {
    "ALLSKY_SFC_SW_DWN": "ghi",
    "ALLSKY_SFC_SW_DNI": "dni",
    "ALLSKY_SFC_SW_DIFF": "dhi",
    "T2M": "temp_air",
    "WS10M": "wind_10m",
    "WS50M": "wind_50m",
    "PS": "pressure",
}

ATTRIBUTION = (
    "The data was obtained from the National Aeronautics and Space Administration (NASA) Langley "
    "Research Center (LaRC) Prediction of Worldwide Energy Resource (POWER) Project funded through "
    "the NASA Earth Science/Applied Science Program."
)


class NasaPowerProvider:
    id = "nasa_power"
    name = "NASA POWER (Hourly)"
    min_year = 2001
    wind_heights = [10, 50]

    def __init__(self, settings: Settings, http: HttpClient):
        self.settings = settings
        self.http = http

    def describe(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": "historical",
            "dataset": "POWER Hourly API (CERES SYN1deg solar; MERRA-2 meteorology)",
            "coverage": "Global, 2001 → near real time (most recent complete year usable)",
            "resolution": "Solar ≈1°×1°, meteorology ≈0.5°×0.625°",
            "variables": "GHI, DNI, DHI, T2M, wind at 10 m and 50 m, surface pressure",
            "units": "W/m² (hour mean), °C, m/s, Pa (converted from kPa)",
            "api_key_required": False,
            "rate_limits": "No published fixed limit; service may return HTTP 429 under load.",
            "cost": "Free",
            "license": "NASA open data; citation and acknowledgement required",
            "attribution": ATTRIBUTION,
            "docs_url": "https://power.larc.nasa.gov/docs/services/api/temporal/hourly/",
            "min_year": self.min_year,
            "wind_heights_m": self.wind_heights,
        }

    def fetch_years(self, lat: float, lon: float, start_year: int, end_year: int) -> WeatherSeries:
        last_complete = dt.date.today().year - 1
        if start_year < self.min_year or end_year > last_complete or start_year > end_year:
            raise ProviderError(
                f"NASA POWER hourly data supports complete years {self.min_year}–{last_complete}.",
                provider=self.name, status=422, retryable=False,
            )
        frames: list[pd.DataFrame] = []
        retrieved, from_cache, urls, version = [], [], [], None
        elevation = None
        grid_lat, grid_lon = lat, lon
        # One request per calendar year → each year is cached independently and reused.
        for year in range(start_year, end_year + 1):
            params = {
                "parameters": ",".join(PARAMS),
                "community": "RE",
                "longitude": round(lon, 4),
                "latitude": round(lat, 4),
                "start": f"{year}0101",
                "end": f"{year}1231",
                "format": "JSON",
                "time-standard": "UTC",
            }
            body, when, hit, url = self.http.get_json(
                self.settings.nasa_power_url, params, ttl_s=self.settings.ttl_historical_s, provider=self.name
            )
            frames.append(self._parse(body))
            retrieved.append(when)
            from_cache.append(hit)
            urls.append(url)
            version = (body.get("header", {}).get("api", {}) or {}).get("version", version)
            coords = (body.get("geometry") or {}).get("coordinates") or []
            if len(coords) >= 2:
                grid_lon, grid_lat = float(coords[0]), float(coords[1])
            if len(coords) >= 3 and coords[2] not in (None, -999):
                elevation = float(coords[2])

        raw = pd.concat(frames).sort_index()
        raw = raw[~raw.index.duplicated()]
        raw = raw.reindex(complete_years_frame(start_year, end_year))
        data, quality = fill_gaps(raw)
        if quality["max_missing_pct"] > 10:
            raise ProviderError(
                f"NASA POWER data for this location/period is more than 10% missing "
                f"({quality['max_missing_pct']:.1f}%); results would be unreliable.",
                provider=self.name, status=422, retryable=False,
            )
        source = SourceInfo(
            provider_id=self.id,
            name=self.name,
            dataset=f"POWER Hourly API {version or ''}".strip() + f", community RE, {start_year}–{end_year}",
            docs_url="https://power.larc.nasa.gov/docs/services/api/temporal/hourly/",
            license="NASA open data — citation required",
            attribution=ATTRIBUTION
            + f" Data: POWER Project's Hourly {version or '2.x'} version, accessed {min(retrieved)[:10]}.",
            resolution="Solar ≈1°×1°, meteorology ≈0.5°×0.625°",
            retrieved_at=min(retrieved),
            from_cache=all(from_cache),
            request_url=urls[0] + (f" (+{len(urls) - 1} more yearly requests)" if len(urls) > 1 else ""),
        )
        return WeatherSeries(
            data=data,
            wind_heights=list(self.wind_heights),
            source=source,
            latitude=grid_lat,
            longitude=grid_lon,
            elevation_m=elevation,
            quality=quality,
        )

    def _parse(self, body: dict[str, Any]) -> pd.DataFrame:
        try:
            block = body["properties"]["parameter"]
            fill = float(body.get("header", {}).get("fill_value", -999.0))
        except (KeyError, TypeError) as exc:
            msgs = body.get("messages") if isinstance(body, dict) else None
            raise ProviderError(f"Unexpected NASA POWER response format. {msgs or ''}".strip(),
                                provider=self.name) from exc
        missing = [p for p in PARAMS if p not in block]
        if missing:
            raise ProviderError(f"NASA POWER response lacks parameters: {', '.join(missing)}", provider=self.name)
        keys = list(block["ALLSKY_SFC_SW_DWN"].keys())
        index = pd.to_datetime(keys, format="%Y%m%d%H", utc=True)
        cols = {}
        for param, col in PARAMS.items():
            series = block[param]
            cols[col] = to_float_array([series.get(k) for k in keys], fill_value=fill)
        df = pd.DataFrame(cols, index=index)
        df["pressure"] = df["pressure"] * 1000.0  # kPa → Pa
        return df
