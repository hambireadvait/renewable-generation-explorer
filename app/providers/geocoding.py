"""Open-Meteo Geocoding API adapter (place name → coordinates).

Docs: https://open-meteo.com/en/docs/geocoding-api — no key, GeoNames-based, CC BY 4.0.

The upstream API matches the place *name* only, so "Sangli, Maharashtra" returns nothing.
We therefore search the part before the first comma and use the remaining parts
("Maharashtra", "India", "IN") to filter and rank the candidates by region/country.
"""

from __future__ import annotations

import unicodedata
from typing import Any

from app.config import Settings
from app.providers.base import HttpClient, ProviderError

UPSTREAM_COUNT = 30  # fetch more candidates than we show, so region filtering has something to work with


def _fold(text: Any) -> str:
    """Lower-case and strip accents: 'Īshwarpur' → 'ishwarpur'."""
    norm = unicodedata.normalize("NFKD", str(text or ""))
    return "".join(c for c in norm if not unicodedata.combining(c)).casefold().strip()


def _region_fields(item: dict[str, Any]) -> list[str]:
    keys = ("admin1", "admin2", "admin3", "admin4", "country", "country_code")
    return [_fold(item.get(k)) for k in keys if item.get(k)]


def _matches(qualifier: str, fields: list[str]) -> bool:
    # Prefix match on any word, so "mahar" matches "Maharashtra" and "uttar" matches "Uttar Pradesh".
    return any(f.startswith(qualifier) or any(w.startswith(qualifier) for w in f.split()) for f in fields)


class OpenMeteoGeocoder:
    id = "open_meteo_geocoding"
    name = "Open-Meteo Geocoding"
    attribution = "Geocoding by Open-Meteo.com (GeoNames data, CC BY 4.0)"

    def __init__(self, settings: Settings, http: HttpClient):
        self.settings = settings
        self.http = http

    def search(self, query: str, count: int = 8) -> dict[str, Any]:
        place, *rest = [p.strip() for p in query.split(",")]
        qualifiers = [_fold(q) for q in rest if q.strip()]
        if len(place) < 2:
            return {"results": [], "attribution": self.attribution, "retrieved_at": None, "from_cache": False,
                    "note": "Type at least two letters of the place name."}
        params: dict[str, Any] = {"name": place, "count": UPSTREAM_COUNT if qualifiers else count,
                                  "language": "en", "format": "json"}
        if self.settings.open_meteo_api_key:
            params["apikey"] = self.settings.open_meteo_api_key
        body, when, hit, _ = self.http.get_json(
            self.settings.open_meteo_geocoding_url, params, ttl_s=self.settings.ttl_geocode_s, provider=self.name
        )
        if not isinstance(body, dict):
            raise ProviderError("Unexpected geocoding response.", provider=self.name)
        items = body.get("results") or []
        note = None
        if qualifiers and items:
            matched = [it for it in items if all(_matches(q, _region_fields(it)) for q in qualifiers)]
            if matched:
                items = matched
            else:
                note = f"No “{place}” found in “{', '.join(rest)}”; showing all places with that name."
        results = []
        for item in items[:count]:
            label = ", ".join(str(p) for p in (item.get("name"), item.get("admin1"), item.get("country")) if p)
            results.append({
                "name": item.get("name"),
                "label": label,
                "latitude": item.get("latitude"),
                "longitude": item.get("longitude"),
                "country_code": item.get("country_code"),
                "timezone": item.get("timezone"),
                "elevation_m": item.get("elevation"),
            })
        if not results and not note:
            note = "No places found. Try another spelling (or the official name), or enter coordinates."
        return {"results": results, "attribution": self.attribution, "retrieved_at": when, "from_cache": hit,
                "note": note}
