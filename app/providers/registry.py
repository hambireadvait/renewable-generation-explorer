"""Provider registry — the single place where adapters are wired up.

To add a provider: implement `HistoricalProvider` or `ForecastProvider` (see base.py) and
register it below. Nothing else in the app needs to change.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.cache import FileCache
from app.config import Settings
from app.providers.base import ForecastProvider, HistoricalProvider, HttpClient
from app.providers.demo import DemoProvider
from app.providers.geocoding import OpenMeteoGeocoder
from app.providers.nasa_power import NasaPowerProvider
from app.providers.open_meteo import OpenMeteoArchiveProvider, OpenMeteoForecastProvider

DEFAULT_HISTORICAL = "nasa_power"
DEFAULT_FORECAST = "open_meteo_forecast"


@dataclass
class Registry:
    historical: dict[str, HistoricalProvider]
    forecast: dict[str, ForecastProvider]
    geocoder: OpenMeteoGeocoder


def build_registry(settings: Settings, transport: httpx.BaseTransport | None = None) -> Registry:
    http = HttpClient(settings, FileCache(settings.cache_dir), transport=transport)
    demo = DemoProvider()
    historical: dict[str, HistoricalProvider] = {
        "nasa_power": NasaPowerProvider(settings, http),
        "open_meteo_era5": OpenMeteoArchiveProvider(settings, http),
        "demo": demo,
    }
    forecast: dict[str, ForecastProvider] = {
        "open_meteo_forecast": OpenMeteoForecastProvider(settings, http),
        "demo": demo,
    }
    return Registry(historical=historical, forecast=forecast, geocoder=OpenMeteoGeocoder(settings, http))
