"""Provider contract and shared helpers.

Every adapter returns a `WeatherSeries` in one normalized convention, so the energy models
never depend on a particular provider:

* index: tz-aware UTC `DatetimeIndex`, hourly, each label = START of the averaging hour
* ghi / dni / dhi: hour-mean irradiance, W/m²
* temp_air: °C at 2 m
* pressure: surface pressure, Pa (optional)
* wind_<h>m: wind speed in m/s at height h metres (one column per available height)
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx
import numpy as np
import pandas as pd

from app.cache import FileCache
from app.config import Settings

IRRADIANCE_COLUMNS = ("ghi", "dni", "dhi")


class ProviderError(Exception):
    """Raised for any upstream failure. `status` is the HTTP status we return to our client."""

    def __init__(self, message: str, *, provider: str, status: int = 502, retryable: bool = True):
        super().__init__(message)
        self.message = message
        self.provider = provider
        self.status = status
        self.retryable = retryable


@dataclass
class SourceInfo:
    provider_id: str
    name: str
    dataset: str
    docs_url: str
    license: str
    attribution: str
    resolution: str
    retrieved_at: str  # ISO-8601 UTC time the upstream response was fetched (cache keeps it)
    from_cache: bool
    request_url: str  # with any API key redacted
    is_demo: bool = False

    def as_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class WeatherSeries:
    data: pd.DataFrame
    wind_heights: list[int]
    source: SourceInfo
    latitude: float  # grid point actually used by the provider (may differ from request)
    longitude: float
    elevation_m: float | None
    quality: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)  # e.g. forecast model / issue time

    def wind_column(self, height: int) -> str:
        return f"wind_{height}m"


class HistoricalProvider(Protocol):
    id: str
    name: str
    min_year: int
    wind_heights: list[int]

    def fetch_years(self, lat: float, lon: float, start_year: int, end_year: int) -> WeatherSeries: ...

    def describe(self) -> dict[str, Any]: ...


class ForecastProvider(Protocol):
    id: str
    name: str
    max_days: int

    def fetch_forecast(self, lat: float, lon: float, days: int) -> WeatherSeries: ...

    def describe(self) -> dict[str, Any]: ...


# --------------------------------------------------------------------------------------
# HTTP + cache


class HttpClient:
    """Thin wrapper: GET JSON with on-disk caching and uniform error mapping."""

    def __init__(self, settings: Settings, cache: FileCache, transport: httpx.BaseTransport | None = None):
        self.settings = settings
        self.cache = cache
        self._client = httpx.Client(
            timeout=settings.http_timeout_s,
            headers={"User-Agent": settings.user_agent},
            transport=transport,
            follow_redirects=True,
        )

    @staticmethod
    def _redacted_url(url: str, params: dict[str, Any]) -> str:
        safe = {k: ("***" if k.lower() in {"apikey", "api_key", "key"} else v) for k, v in params.items()}
        return str(httpx.URL(url, params=safe))

    def get_json(self, url: str, params: dict[str, Any], *, ttl_s: int, provider: str) -> tuple[Any, str, bool, str]:
        """Return (json, retrieved_at_iso, from_cache, redacted_url)."""
        redacted = self._redacted_url(url, params)
        cached = self.cache.get(redacted, ttl_s)
        if cached is not None:
            value, stored_at = cached
            return value, _iso(stored_at), True, redacted
        if self.settings.offline:
            raise ProviderError(
                "OFFLINE_MODE is enabled and no cached response exists for this request.",
                provider=provider, status=503, retryable=False,
            )
        try:
            resp = self._client.get(url, params=params)
        except httpx.TimeoutException as exc:
            raise ProviderError(f"{provider} did not respond within {self.settings.http_timeout_s}s.",
                                provider=provider, status=504) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Could not reach {provider}: {exc.__class__.__name__}.",
                                provider=provider, status=502) from exc
        if resp.status_code == 429:
            raise ProviderError(f"{provider} rate limit reached (HTTP 429: {_error_detail(resp)}). Try again later.",
                                provider=provider, status=503)
        if resp.status_code >= 400:
            detail = _error_detail(resp)
            status = 422 if resp.status_code == 400 else 502
            raise ProviderError(f"{provider} returned HTTP {resp.status_code}: {detail}",
                                provider=provider, status=status, retryable=resp.status_code >= 500)
        try:
            value = resp.json()
        except ValueError as exc:
            raise ProviderError(f"{provider} returned a non-JSON response.", provider=provider) from exc
        stored_at = self.cache.set(redacted, value)
        return value, _iso(stored_at), False, redacted


def _error_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return resp.text[:200]
    if isinstance(body, dict):
        for key in ("reason", "message", "messages", "detail", "error"):
            if body.get(key):
                return str(body[key])[:300]
    return str(body)[:300]


def _iso(epoch: float) -> str:
    return dt.datetime.fromtimestamp(epoch, tz=dt.timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------------------
# Data quality


def fill_gaps(df: pd.DataFrame, *, max_interp_hours: int = 3) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Fill missing values and report what was filled.

    Short gaps (≤ max_interp_hours) are linearly interpolated; longer gaps are filled with the
    mean for the same calendar month and UTC hour from the rest of the series. Irradiance is
    floored at 0. Returns (filled_df, quality report).
    """
    out = df.copy()
    report: dict[str, Any] = {"hours": int(len(df)), "columns": {}}
    for col in out.columns:
        series = out[col].astype(float)
        missing = int(series.isna().sum())
        if missing:
            series = series.interpolate(limit=max_interp_hours, limit_area="inside")
            still = series.isna()
            if still.any():
                clim = series.groupby([series.index.month, series.index.hour]).transform("mean")
                series = series.where(~still, clim)
                series = series.fillna(series.mean())  # pathological: whole month missing
        if col in IRRADIANCE_COLUMNS:
            series = series.clip(lower=0)
        out[col] = series
        report["columns"][col] = {"missing_hours": missing, "missing_pct": round(100 * missing / max(len(df), 1), 3)}
    worst = max((c["missing_pct"] for c in report["columns"].values()), default=0.0)
    report["max_missing_pct"] = worst
    report["note"] = (
        "Missing hours were interpolated (gaps ≤ 3 h) or filled with the month/hour mean."
        if worst > 0 else "No missing hours."
    )
    return out, report


def complete_years_frame(start_year: int, end_year: int) -> pd.DatetimeIndex:
    return pd.date_range(
        pd.Timestamp(f"{start_year}-01-01", tz="UTC"),
        pd.Timestamp(f"{end_year}-12-31 23:00", tz="UTC"),
        freq="h",
    )


def to_float_array(values: list[Any], fill_value: float | None = None) -> np.ndarray:
    arr = np.array([np.nan if v is None else v for v in values], dtype=float)
    if fill_value is not None:
        arr[np.isclose(arr, fill_value)] = np.nan
    return arr
