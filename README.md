# Renewable Generation Explorer

A local web app that answers **"how much solar and wind energy will this place or region generate
this week?"**: it runs the latest weather forecast through solar PV and wind turbine models.
A second tab shows the **long-term average** (typical day, month and year) from historical weather.
Every assumption, data source and limitation is shown next to the results.

| Tab | Weather input | Output |
|---|---|---|
| **This week's forecast** (default) | Open-Meteo weather forecast, next 1–16 days (default 7) | Total energy for the window, per day, hour by hour, peak output, best/lowest day |
| **Long-term average** | Whole past years of *historical* hourly data (NASA POWER or ERA5) | Typical daily/weekly/monthly/annual generation, year-to-year spread |

> Energy estimates only. The app does **not** assess costs, revenue or financial viability, and it
> does not check land suitability, permits or grid access.

## Quick start

Requirements: Python 3.11+ (tested on 3.14). Node is optional (only for the JS unit tests).

```bash
cd renewable-feasibility
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m uvicorn app.main:app --port 8010
```

Open <http://127.0.0.1:8010> for the landing page, or go straight to the app at
<http://127.0.0.1:8010/#/forecast>. Interactive API docs: <http://127.0.0.1:8010/docs>.

For development, add `--reload` so backend changes restart the server. Frontend files are served as-is
(no build step), so refreshing the browser picks up CSS/JS edits.
No API keys are needed: the default data sources are free and keyless.

### Tests

```bash
.venv/bin/python -m pytest          # physics, providers (mocked HTTP), API
node --test 'tests/js/*.test.mjs'   # client-side validation helpers
```

The tests never call the network: provider adapters are tested against recorded-shape responses
through `httpx.MockTransport`, and the end-to-end API tests use the demo provider.

## Interface

A dark, keyboard-friendly interface. Routes are hash-based, so they work on any static host path:

| Route | Page |
|---|---|
| `#/` | Landing page with a **live preview** (a real forecast for the default site) and the data sources reported by the server |
| `#/forecast` | This week's forecast: site & system panel, forecast window (24 h–16 days), totals, daily/hourly charts, day-by-day table |
| `#/long-term` | Long-term average: source and years, typical yields, monthly / by-year / daily / average-day / wind-distribution charts |
| `#/compare` | Saved scenarios side by side (re-run or delete with confirmation) |
| `#/method` | Data sources (live metadata from the server) and the modelling method |

Highlights:
- Collapsible sidebar, which becomes an icon rail at 1024–1279 px and an off-canvas drawer below 1024 px.
- On phones the site & system panel collapses to a one-line summary, so results show first.
- Skeleton loaders, toasts, confirmation and naming dialogs, and an accessible export menu.
- `⌘/Ctrl + Enter` runs the current page.
- Region drawing works with mouse, pen and touch. `Esc` cancels.
- Respects `prefers-reduced-motion`. Visible focus rings throughout.

## Using the app

1. **Location or region**: search a place, type coordinates, click the map, or press
   *Draw region* and drag a rectangle. A region's weather is taken at its centre point.
2. **What is installed**: solar capacity, mounting, tilt and losses; wind turbine rating, count,
   hub height and (ideally) the manufacturer's power curve; optional grid-export limit for the
   combined output.
3. Press **Forecast this week's generation**. You get:
   - the total energy for the window, the average per day, and the best and lowest day;
   - per-technology totals, capacity factor and peak output time;
   - a per-day chart and an hour-by-hour chart;
   - a day-by-day table with sunlight (kWh/m²), hub-height wind and temperature;
   - warnings, assumptions and source attribution.
4. Optional: open **Long-term average**, choose the historical source and years, and press
   *Estimate long-term average* to see what is typical for the site.
5. **Export**: HTML report (printable to PDF) or CSV. **Save to compare** keeps scenarios
   (different sites, sizes or settings) side by side in your browser.

### Demo mode

Choose **Demo (synthetic)** as the source to explore the app offline. Demo data is generated
locally and is *not real*: the header chip turns red, a red banner appears, every chart is
watermarked, and reports/CSVs start with `DEMO MODE — SYNTHETIC DATA, NOT REAL`. If a live provider
fails, the app shows the error and *offers* demo mode; it never substitutes it silently.

## Configuration

Set through environment variables, optionally from a local `.env` file (git-ignored). Nothing is
required for local use.

| Variable | Default | Purpose |
|---|---|---|
| `CACHE_DIR` | `.cache` | On-disk cache of raw provider responses |
| `CACHE_TTL_FORECAST_S` | `3600` (1 h) | Forecast cache lifetime |
| `CACHE_TTL_HISTORICAL_S` | `2592000` (30 d) | Historical data cache lifetime |
| `CACHE_TTL_GEOCODE_S` | `604800` (7 d) | Geocoding cache lifetime |
| `HTTP_TIMEOUT_S` | `60` | Upstream request timeout |
| `HTTP_USER_AGENT` | `renewable-feasibility-explorer/0.1 (local)` | Sent to providers; add a contact for heavy use |
| `OPEN_METEO_API_KEY` | *(empty)* | **Required for commercial use** of Open-Meteo. When set, the app switches to the `customer-*` hosts. Never commit it. |
| `NASA_POWER_BASE_URL`, `OPEN_METEO_FORECAST_URL`, `OPEN_METEO_ARCHIVE_URL`, `OPEN_METEO_GEOCODING_URL` | official endpoints | Override, e.g. for a self-hosted Open-Meteo |
| `OFFLINE_MODE` | `0` | `1` = no outbound calls; only cached data and demo mode work |

## Project layout

```
app/
  main.py            FastAPI routes, error handling, static frontend
  schemas.py         request validation (Pydantic)
  service.py         orchestration: provider → physics → payload (forecast + long-term)
  providers/         replaceable data adapters (base.py defines the contract)
  models/            solar.py (pvlib), wind.py, hybrid.py, aggregate.py
  report.py          HTML reports + CSV exports
  cache.py, config.py
static/              index.html, styles.css (design tokens + components), favicon.svg
  js/app.js          boot, hash router, app shell (sidebar / drawer), run orchestration
  js/form.js         site & system panel: defaults, search, map, validation, request building
  js/views/          forecast, long-term, compare and method pages + shared result pieces
  js/ui/             icons (inlined Lucide), toasts, dialogs, dropdown menu, shared builders
  js/landing.js      landing page (live preview, sources, scroll reveal)
tests/               pytest suite + tests/js (node:test)
docs/                SPEC, DATA_SOURCES, API, ASSUMPTIONS_AND_LIMITATIONS
```

## Documentation

- [docs/SPEC.md](docs/SPEC.md): product specification and architecture
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md): providers, coverage, units, licences, limits, adding a provider
- [docs/API.md](docs/API.md): backend endpoints
- [docs/ASSUMPTIONS_AND_LIMITATIONS.md](docs/ASSUMPTIONS_AND_LIMITATIONS.md): every default and its basis, plus known limitations
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production start command, environment variables, Docker / Render, pre-launch checklist

## Licences and attribution

Open-Meteo data is CC BY 4.0 (free tier is non-commercial only). NASA POWER results must carry the
NASA POWER acknowledgement. ERA5 contains modified Copernicus Climate Change Service information.
The app includes these attributions in the results, reports and CSV headers.
Map tiles © OpenStreetMap contributors. Icons: Lucide (ISC). Font: Geist (SIL OFL).
