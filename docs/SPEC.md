# Renewable Generation Explorer — Product Specification

Status: MVP. Last reviewed 2026-10-10. Scope: **energy generation only** (financial modelling removed).

## 1. Purpose

Tell a planner, operator or student how much energy a solar PV, wind or combined installation
at a place or region will generate **this week**, from the latest weather forecast. Also show what
is **typical** for the site from historical weather. It is a screening tool, not a bankable
energy-yield assessment.

## 2. Two views, kept separate

| | This week's forecast (primary) | Long-term average (secondary) |
|---|---|---|
| Question | "How much will it generate over the next N days?" | "What does it generate on a typical day, month or year?" |
| Weather input | Open-Meteo Forecast API, next 1–16 days (default 7), from the current hour | Whole past calendar years of hourly data (NASA POWER or ERA5) |
| Output | Total for the window, per day, hour by hour, peaks, best/lowest day, daily weather | Mean annual/monthly/daily energy, average-day profile, year-to-year spread |
| Endpoint | `POST /api/forecast` (`use_case: "near_term_forecast"`) | `POST /api/assess` (`use_case: "long_term_average"`) |

The two are never mixed: a forecast says nothing about a typical week, and a long-term average
says nothing about a specific week. Both views label which one you are looking at.

## 3. User flow

1. Pick a location (search, coordinates, map click) or draw a region; a region is evaluated at its centre.
2. Describe the installation: solar and/or wind, sizes, design assumptions and losses. A combined
   view appears when both are enabled, with an optional grid-export limit.
3. Run the forecast → KPIs, per-day and hourly charts, day-by-day table, warnings, assumptions, sources.
4. Optionally run the long-term average for context.
5. Export an HTML report or CSV; save scenarios and compare them side by side (browser-local).

## 4. Architecture

```
Browser — static HTML + ES modules, no build step
  ├─ app.js (hash router, shell) · form.js (site & system) · views/* (pages) · ui/* (icons, toasts, dialogs, menu)
  └─ Leaflet (map) · Chart.js (charts) · Geist font · inlined Lucide icons
        │ JSON over HTTP
        ▼
FastAPI backend (Python)
  ├─ api routes        /api/forecast  /api/assess  /api/geocode  /api/providers  /api/*report  /api/*export
  ├─ validation        Pydantic request models with physical bounds; unknown fields rejected
  ├─ providers/        replaceable adapters → normalized `WeatherSeries`
  │     open_meteo.py   (forecast, and historical ERA5 archive)
  │     nasa_power.py   (historical, default for the long-term view)
  │     geocoding.py    (Open-Meteo geocoding)
  │     demo.py         (synthetic, unmistakably labelled)
  ├─ cache.py          on-disk TTL cache of raw provider responses
  ├─ models/           solar.py (pvlib) · wind.py · hybrid.py · aggregate.py
  └─ report.py         self-contained HTML reports + CSV
```

**Why this stack:** pvlib is the reference open-source PV modelling library, so the solar
physics isn't hand-rolled. FastAPI gives typed validation and OpenAPI docs. The frontend has no
build step, so the app runs with one command. All dependencies are open source, and the default
data sources need no key.

**Replaceability:** every provider implements `HistoricalProvider` or `ForecastProvider`
(`app/providers/base.py`) and returns the same normalized series (UTC hour-start index, W/m², °C,
m/s at named heights, Pa). Models never see provider-specific formats.

## 5. Data sources

| Role | Provider | Key? | Notes |
|---|---|---|---|
| Forecast | Open-Meteo Forecast API (`best_match`) | No (free tier) | ≤16 days, hourly, wind at 10/80/120/180 m; non-commercial free tier; CC BY 4.0 |
| Historical (default) | NASA POWER Hourly | No | 2001→, ≈0.5–1° grid; citation required |
| Historical (alt) | Open-Meteo archive, ERA5 | No (free tier) | 1950→ in app, 0.25° grid |
| Geocoding | Open-Meteo Geocoding | No | GeoNames-based |
| Demo | Built-in | — | **Synthetic — not data** |

Details: [DATA_SOURCES.md](DATA_SOURCES.md). Defaults and limitations: [ASSUMPTIONS_AND_LIMITATIONS.md](ASSUMPTIONS_AND_LIMITATIONS.md).

## 6. Non-goals

No cost, revenue or financial metrics. No assessment of land suitability, permits, grid
connection or grid-side curtailment. No storage modelling. A drawn region is not checked for
buildability, and its weather is taken at a single centre point.
