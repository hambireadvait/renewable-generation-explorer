"""Runtime configuration from environment variables (optionally loaded from a local .env).

Secrets never live in source. See .env.example for every variable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines, '#' comments. Real env vars win."""
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.split(" #", 1)[0].strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _int(name: str, default: int) -> int:
    value = os.environ.get(name, "").strip()
    return int(value) if value else default


@dataclass(frozen=True)
class Settings:
    cache_dir: Path
    ttl_historical_s: int
    ttl_forecast_s: int
    ttl_geocode_s: int
    http_timeout_s: int
    user_agent: str
    open_meteo_api_key: str
    nasa_power_url: str
    open_meteo_forecast_url: str
    open_meteo_archive_url: str
    open_meteo_geocoding_url: str
    offline: bool

    @property
    def open_meteo_commercial(self) -> bool:
        return bool(self.open_meteo_api_key)


@lru_cache
def get_settings() -> Settings:
    _load_dotenv(ROOT / ".env")
    key = os.environ.get("OPEN_METEO_API_KEY", "").strip()
    # Open-Meteo commercial plans use customer-* hosts (per Open-Meteo docs).
    prefix = "customer-" if key else ""
    cache_dir = Path(os.environ.get("CACHE_DIR", ".cache"))
    if not cache_dir.is_absolute():
        cache_dir = ROOT / cache_dir
    return Settings(
        cache_dir=cache_dir,
        ttl_historical_s=_int("CACHE_TTL_HISTORICAL_S", 30 * 86400),
        ttl_forecast_s=_int("CACHE_TTL_FORECAST_S", 3600),
        ttl_geocode_s=_int("CACHE_TTL_GEOCODE_S", 7 * 86400),
        http_timeout_s=_int("HTTP_TIMEOUT_S", 60),
        user_agent=os.environ.get("HTTP_USER_AGENT", "renewable-feasibility-explorer/0.1 (local)"),
        open_meteo_api_key=key,
        nasa_power_url=os.environ.get("NASA_POWER_BASE_URL")
        or "https://power.larc.nasa.gov/api/temporal/hourly/point",
        open_meteo_forecast_url=os.environ.get("OPEN_METEO_FORECAST_URL")
        or f"https://{prefix}api.open-meteo.com/v1/forecast",
        open_meteo_archive_url=os.environ.get("OPEN_METEO_ARCHIVE_URL")
        or f"https://{prefix}archive-api.open-meteo.com/v1/archive",
        open_meteo_geocoding_url=os.environ.get("OPEN_METEO_GEOCODING_URL")
        or f"https://{prefix}geocoding-api.open-meteo.com/v1/search",
        offline=os.environ.get("OFFLINE_MODE", "0").strip() in {"1", "true", "yes"},
    )
