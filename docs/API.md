# Backend API

Base URL when running locally: `http://127.0.0.1:8010`. OpenAPI/Swagger UI: `/docs`; schema: `/openapi.json`.
All request bodies are JSON and **unknown fields are rejected**. No authentication (local tool).

## Errors

All errors use one envelope:

```json
{"error": {"type": "validation_error", "message": "Some inputs are invalid.",
           "issues": [{"field": "solar.capacity_kwp", "message": "Input should be greater than 0"}]}}
```

| Status | `type` | When |
|---|---|---|
| 422 | `validation_error` | Inputs out of range or inconsistent (with per-field `issues`) |
| 422 | `provider_error` | The provider can't serve the request (e.g. years outside coverage, >10% missing data) |
| 502 | `provider_error` | Upstream unreachable or returned an error |
| 503 | `provider_error` | Upstream rate-limited (429) or `OFFLINE_MODE` without cached data |
| 504 | `provider_error` | Upstream timeout |

Provider errors include `provider`, `retryable` and a `hint` (retry / switch source / demo mode).

## Endpoints

### `GET /api/health`
`{"status":"ok","version":"0.1.0","offline_mode":false,"open_meteo_commercial_key":false}`

### `GET /api/providers`
Metadata for every provider: dataset, coverage, resolution, variables, units, `api_key_required`, rate limits,
cost, licence, attribution, docs URL, min year, wind heights. Also the default provider ids.

### `GET /api/defaults`
Default design assumptions, the default forecast window (7 days) and the default historical period.

### `GET /api/geocode?q=<text>&count=8`
Place search (2–100 characters). Returns `results[]` with `label`, `latitude`, `longitude`, `country_code`,
`timezone`, `elevation_m`, plus `attribution` and `retrieved_at`.

### `POST /api/assess` — long-term average generation (historical weather)

```json
{
  "location": {"latitude": 26.9176, "longitude": 70.9039, "label": "Jaisalmer"},
  "provider": "nasa_power",                 // "nasa_power" | "open_meteo_era5" | "demo"
  "start_year": 2021, "end_year": 2025,     // complete past years, ≤ 20
  "solar": {"capacity_kwp": 1000, "mounting": "fixed_open_rack", "tilt_deg": null, "azimuth_deg": null,
            "dc_ac_ratio": 1.2, "inverter_efficiency_pct": 96, "temp_coeff_pct_per_c": -0.35, "albedo": 0.2,
            "losses_pct": {"soiling": 2, "shading": 3, "...": "PVWatts categories"}},
  "wind": {"turbine_rated_kw": 3000, "n_turbines": 1, "hub_height_m": 120, "rotor_diameter_m": null,
           "power_curve": [[3, 0], [4, 120], "..."],   // optional; else generic curve from cut_in/rated/cut_out
           "cut_in_ms": 3, "rated_speed_ms": 12, "cut_out_ms": 25, "air_density_correction": true,
           "losses_pct": {"wake": 0, "availability": 3, "electrical": 2, "turbine_performance": 2,
                          "environmental": 1.5, "curtailment": 0}},
  "hybrid": {"enabled": true, "export_limit_kw": 3000},
  "include_daily": true
}
```

Instead of `latitude`/`longitude` you may send `"area": {"south":…, "west":…, "north":…, "east":…}`
(≤10°×10°, no antimeridian crossing); the centroid is evaluated. At least one of `solar`/`wind` is required.
There are no financial fields; sending any is a validation error.

Response (abridged):

```json
{
  "use_case": "long_term_average",
  "label": "Long-term average generation from historical weather — not a forecast",
  "is_demo": false,
  "period": {"start_year": 2021, "end_year": 2025, "n_years": 5},
  "site": {"requested": {...}, "data_grid_point": {"latitude":…, "longitude":…, "elevation_m":…}, "timezone": "Asia/Kolkata"},
  "area": null,
  "source": {"name": "NASA POWER (Hourly)", "dataset": "...", "retrieved_at": "2026-10-10T07:15:30+00:00",
             "from_cache": true, "license": "...", "attribution": "...", "request_url": "...", "is_demo": false},
  "data_quality": {"max_missing_pct": 0.0, "note": "..."},
  "results": {
    "solar": {"capacity_kw": 1000, "capacity_basis": "kWp DC",
              "summary": {"annual_mean_kwh": …, "capacity_factor_pct": …, "per_year": [...], "interannual": {...},
                          "monthly": [{"month":1,"mean_kwh":…,"min_kwh":…,"max_kwh":…}], "daily": [...],
                          "diurnal_profile_kw": [[24 values] × 12], "timezone": "..."},
              "metrics": {"specific_yield_kwh_per_kwp": …, "performance_ratio": …, ...},
              "assumptions": {...}, "notes": [...]},
    "wind": {... "metrics": {"mean_hub_wind_ms":…, "weibull_k":…, "weibull_c_ms":…, "histogram": [...]}},
    "hybrid": {... "curtailed_kwh_per_year": …, "curtailed_fraction_pct": …, "hourly_correlation_solar_wind": …}
  },
  "warnings": ["..."],
  "not_assessed": ["land suitability or availability", "..."],
  "request": {...}
}
```

### `POST /api/forecast` — this week's generation forecast

```json
{"location": {"latitude": 26.92, "longitude": 70.90, "label": "Jaisalmer"},   // or "area": {...}
 "provider": "open_meteo_forecast", "days": 7,
 "solar": {"capacity_kwp": 1000}, "wind": {"turbine_rated_kw": 3000, "hub_height_m": 120},
 "hybrid": {"enabled": true, "export_limit_kw": 3000}}
```

`days` is 1–16 (default 7). The window starts at the current hour and covers exactly `days × 24` hours. The
16-day maximum can come up short, and a warning says so. Response (abridged):

```json
{
  "use_case": "near_term_forecast",
  "label": "Generation forecast for the next 7 days",
  "forecast_period": {"days_requested": 7, "start_local": "2026-10-10T12:30:00+05:30", "end_local": "2026-10-17T12:30:00+05:30",
                      "start_utc": "...", "end_utc": "...", "hours": 168, "model": "best_match"},
  "site": {...}, "area": null, "source": {...},
  "results": {
    "solar": {"capacity_kw": 1000, "totals": {"energy_kwh": 32500, "capacity_factor_pct": 19.4,
              "average_per_day_kwh": 4640, "peak_kw": 690, "peak_time_local": "..."}, "assumptions": {...}},
    "wind": {...},
    "hybrid": {"totals": {"energy_kwh": ..., "curtailed_kwh": 0, ...}, "export_limit_kw": 3000, ...}
  },
  "summary": {"headline_technology": "hybrid", "total_kwh": 54200,
              "best_day": {"date": "2026-10-15", "kwh": 11800}, "lowest_day": {"date": "2026-10-12", "kwh": 5100}},
  "daily": [{"date": "2026-10-11", "weekday": "Sunday", "hours": 24, "partial_day": false,
             "solar_kwh": ..., "solar_peak_kw": ..., "wind_kwh": ..., "hybrid_kwh": ...,
             "irradiation_kwh_m2": 5.3, "mean_hub_wind_ms": 3.4, "mean_temp_c": 30.1, "max_temp_c": 35.5}],
  "hourly": [{"time_local": "...", "solar_kw": ..., "wind_kw": ..., "hybrid_kw": ..., "wind_hub_ms": ...,
              "ghi_wm2": ..., "temp_air_c": ..., "wind_10m_ms": ...}],
  "totals": {"solar_kwh": ..., "wind_kwh": ..., "hybrid_kwh": ...},
  "warnings": [...], "not_assessed": [...]
}
```

### `POST /api/forecast/report?download=true`
Same body as `/api/forecast`. Self-contained HTML report: totals, per-day chart, day-by-day table, assumptions.

### `POST /api/forecast/export`
Same body as `/api/forecast`; hourly CSV (local and UTC timestamps).

### `POST /api/report?download=true`
Same body as `/api/assess`. Returns a self-contained HTML report (inline SVG charts, print-friendly).

### `POST /api/export/{kind}`
Same body as `/api/assess`. `kind` = `monthly` | `daily` | `hourly` (CSV) or `json`.
CSVs start with `#` comment lines giving the use case, source, retrieval time and units (and a DEMO line in demo mode).

## Caching

Raw upstream responses are cached on disk (`CACHE_DIR`), keyed by the request URL with any API key redacted:
historical 30 days, forecast 1 hour, geocoding 7 days. The last 16 computed assessments are kept in memory so report and export calls right after a run don't recompute.
