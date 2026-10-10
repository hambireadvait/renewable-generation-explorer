"""DEMO provider — synthetic weather. NOT REAL DATA.

Exists so the app can be explored offline or when upstream providers are down. Every series it
returns has `source.is_demo = True`; the API and UI label all results derived from it as demo.
The numbers are plausible in shape (clear-sky sun path × random cloudiness, Weibull-like wind)
but are not derived from any observation and must never be used for decisions.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import numpy as np
import pandas as pd
import pvlib

from app.providers.base import SourceInfo, WeatherSeries, complete_years_frame

DEMO_LABEL = "DEMO — synthetic data, not real measurements or forecasts"


def _synthetic(index: pd.DatetimeIndex, lat: float, lon: float, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    mid = index + pd.Timedelta(minutes=30)
    solpos = pvlib.solarposition.get_solarposition(mid, lat, lon)
    clear = pvlib.clearsky.haurwitz(solpos["apparent_zenith"])["ghi"].to_numpy()
    n_days = int(np.ceil(len(index) / 24)) + 1
    # Daily cloudiness: AR(1) process mapped to a clearness factor in [0.25, 1.0].
    z = np.zeros(n_days)
    for i in range(1, n_days):
        z[i] = 0.6 * z[i - 1] + rng.normal(0, 0.8)
    daily_k = 0.25 + 0.75 / (1 + np.exp(-(z + 1.0)))
    day_idx = ((index - index[0]).total_seconds() // 86400).astype(int)
    k = daily_k[day_idx] * (0.9 + 0.1 * rng.random(len(index)))
    ghi = clear * k
    erbs = pvlib.irradiance.erbs(ghi, solpos["zenith"].to_numpy(), mid)
    doy = index.dayofyear.to_numpy()
    hour = index.hour.to_numpy() + lon / 15.0
    season = np.cos(2 * np.pi * (doy - 196) / 365.25) * (1 if lat >= 0 else -1)
    temp = 27 - 0.3 * abs(lat) + 8 * season * min(abs(lat) / 30, 1) + 5 * np.sin(2 * np.pi * (hour - 9) / 24)
    temp = temp + rng.normal(0, 1.2, len(index))
    # Wind: Rayleigh-distributed hourly speeds with a mild diurnal cycle, then a power-law profile.
    w10 = rng.rayleigh(4.2, len(index)) * (1 + 0.15 * np.sin(2 * np.pi * (hour - 14) / 24))
    w10 = np.clip(w10, 0, 30)
    return pd.DataFrame(
        {
            "ghi": ghi,
            "dni": np.nan_to_num(erbs["dni"]),
            "dhi": np.nan_to_num(erbs["dhi"]),
            "temp_air": temp,
            "pressure": np.full(len(index), 101325.0),
            "wind_10m": w10,
            "wind_50m": w10 * (50 / 10) ** 0.14,
            "wind_100m": w10 * (100 / 10) ** 0.14,
        },
        index=index,
    )


class DemoProvider:
    id = "demo"
    name = "Demo (synthetic)"
    min_year = 2001
    max_days = 16
    wind_heights = [10, 50, 100]

    def describe(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": "historical+forecast",
            "dataset": DEMO_LABEL,
            "coverage": "Anywhere (synthetic)",
            "resolution": "n/a",
            "variables": "Synthetic GHI/DNI/DHI, temperature, wind at 10/50/100 m",
            "units": "W/m², °C, m/s, Pa",
            "api_key_required": False,
            "rate_limits": "n/a (local)",
            "cost": "Free",
            "license": "n/a",
            "attribution": DEMO_LABEL,
            "docs_url": "",
            "min_year": self.min_year,
            "wind_heights_m": self.wind_heights,
            "is_demo": True,
        }

    def _source(self) -> SourceInfo:
        return SourceInfo(
            provider_id=self.id,
            name=self.name,
            dataset=DEMO_LABEL,
            docs_url="",
            license="n/a",
            attribution=DEMO_LABEL,
            resolution="n/a",
            retrieved_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            from_cache=False,
            request_url="(generated locally)",
            is_demo=True,
        )

    def fetch_years(self, lat: float, lon: float, start_year: int, end_year: int) -> WeatherSeries:
        index = complete_years_frame(start_year, end_year)
        seed = int(abs(lat * 1000) + abs(lon * 10)) + start_year
        data = _synthetic(index, lat, lon, seed)
        return WeatherSeries(data=data, wind_heights=list(self.wind_heights), source=self._source(),
                             latitude=lat, longitude=lon, elevation_m=None,
                             quality={"hours": len(index), "max_missing_pct": 0.0, "note": DEMO_LABEL, "columns": {}})

    def fetch_forecast(self, lat: float, lon: float, days: int) -> WeatherSeries:
        start = pd.Timestamp.now(tz="UTC").floor("h")
        index = pd.date_range(start, periods=days * 24, freq="h")
        data = _synthetic(index, lat, lon, seed=int(abs(lat * 1000) + abs(lon * 10)))
        return WeatherSeries(
            data=data, wind_heights=list(self.wind_heights), source=self._source(),
            latitude=lat, longitude=lon, elevation_m=None,
            quality={"hours": len(index), "max_missing_pct": 0.0, "note": DEMO_LABEL, "columns": {}},
            extra={"forecast_model": "synthetic", "forecast_start_utc": index[0].isoformat(),
                   "forecast_end_utc": (index[-1] + pd.Timedelta(hours=1)).isoformat()},
        )
