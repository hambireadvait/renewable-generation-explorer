# Data sources

Verified on **2026-10-10** against official documentation and with live requests from this app.
Re-check terms before commercial use; providers change limits and licences.

## Summary

| Provider | Used for | Key? | Cost | Licence / terms |
|---|---|---|---|---|
| NASA POWER Hourly API | Historical resource (default) | No | Free | NASA open data; citation required |
| Open-Meteo Historical Weather API (ERA5) | Historical resource (alternative) | No (free tier) | Free non-commercial; paid plans otherwise | CC BY 4.0; free tier non-commercial only |
| Open-Meteo Forecast API | Near-term forecast | No (free tier) | As above | As above |
| Open-Meteo Geocoding API | Place search | No (free tier) | As above | As above (GeoNames-based) |
| OpenStreetMap tiles | Base map | No | Free, light use | OSM tile usage policy; attribution |
| Demo (built-in) | Offline exploration | — | — | **Synthetic — not data** |

## NASA POWER — Hourly API

- Docs: <https://power.larc.nasa.gov/docs/services/api/temporal/hourly/>
- Endpoint: `GET https://power.larc.nasa.gov/api/temporal/hourly/point`
- Parameters used: `parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,ALLSKY_SFC_SW_DIFF,T2M,WS10M,WS50M,PS`,
  `community=RE`, `latitude`, `longitude`, `start=YYYYMMDD`, `end=YYYYMMDD`, `format=JSON`, `time-standard=UTC`.
- Coverage: global, 2001-01-01 → near real time. The app uses complete calendar years up to last year.
- Resolution: solar from CERES SYN1deg (≈1°); meteorology from MERRA-2 (≈0.5° × 0.625°).
- Units: irradiance Wh/m² per hour (= hour-mean W/m²), T2M °C, wind m/s, PS kPa (converted to Pa). Fill value −999.
- Timestamps: the label is the **start** of the hour (POWER FAQ), which matches the app's convention.
- Limits: max 15 parameters per request. No fixed public rate limit; the service returns HTTP 429 when overloaded.
  The app requests one calendar year per call (~1–3 s each) and caches each year for 30 days.
- Citation (shown in results): *"The data was obtained from the National Aeronautics and Space Administration
  (NASA) Langley Research Center (LaRC) Prediction of Worldwide Energy Resource (POWER) Project funded through the
  NASA Earth Science/Applied Science Program."* plus the API version and access date.

## Open-Meteo — Historical Weather API (ERA5)

- Docs: <https://open-meteo.com/en/docs/historical-weather-api> · Terms: <https://open-meteo.com/en/terms>
- Endpoint: `GET https://archive-api.open-meteo.com/v1/archive` (commercial: `customer-archive-api…` + `apikey`)
- Parameters used: `hourly=shortwave_radiation,direct_normal_irradiance,diffuse_radiation,temperature_2m,surface_pressure,wind_speed_10m,wind_speed_100m`,
  `models=era5` (one consistent reanalysis for every year), `wind_speed_unit=ms`, `timezone=GMT`.
- Coverage: ERA5, global, 1940 → ~5 days ago; 0.25° grid. The app allows complete years from 1950.
- Units: radiation W/m² as the **mean over the preceding hour** (shifted back one hour by the adapter);
  temperature °C; wind m/s (requested); pressure hPa (converted to Pa). Wind is instantaneous at the label time.
- Free tier: 600 calls/min, 5 000/hour, 10 000/day, 300 000/month; non-commercial only; requests spanning long
  periods or many variables count as several calls. Attribution required (CC BY 4.0).

## Open-Meteo — Forecast API

- Docs: <https://open-meteo.com/en/docs>
- Endpoint: `GET https://api.open-meteo.com/v1/forecast`
- Variables: as above plus `wind_speed_80m, wind_speed_120m, wind_speed_180m`; `forecast_days` 1–16.
- Model: `best_match` (Open-Meteo picks the best national/global model for the location). Heights the model
  doesn't supply for >10% of the window are dropped.
- The app trims hours before the retrieval hour, labels the forecast period in UTC and local time, flags partial
  days, and caches responses for 1 hour.

## Open-Meteo — Geocoding API

- Docs: <https://open-meteo.com/en/docs/geocoding-api> · Endpoint `GET https://geocoding-api.open-meteo.com/v1/search`
- Returns place name, admin region, country, coordinates, time zone. Cached 7 days.

## Map tiles

OpenStreetMap standard tiles (`tile.openstreetmap.org`) via Leaflet. Fine for local, light use; heavy or
commercial use must switch to a tile provider that allows it (see the OSM Tile Usage Policy).

## Observed dataset disagreement

At Jaisalmer (26.92 N, 70.90 E), 2021–2025, with the same system settings:

| | NASA POWER | ERA5 (Open-Meteo) |
|---|---|---|
| Fixed-tilt solar specific yield | 1 583 kWh/kWp | 1 744 kWh/kWp |
| Mean wind speed at 120 m (extrapolated) | 6.37 m/s | 5.75 m/s |
| 3 MW generic-curve turbine energy | 5.71 GWh/yr | 4.05 GWh/yr |

Neither is "right": both are coarse gridded products with known regional biases. The spread is a useful
lower bound on data uncertainty. The app warns about this and lets you switch sources.

## Adding or replacing a provider

1. Create `app/providers/<name>.py` implementing `HistoricalProvider.fetch_years(lat, lon, start_year, end_year)`
   and/or `ForecastProvider.fetch_forecast(lat, lon, days)`, plus `describe()`.
2. Return a `WeatherSeries` in the normalized convention documented in `app/providers/base.py`
   (UTC hour-start index; `ghi/dni/dhi` W/m²; `temp_air` °C; `pressure` Pa; `wind_<h>m` m/s; `wind_heights`).
3. Use `HttpClient.get_json` for caching, key redaction and uniform error mapping; call `fill_gaps` and report quality.
4. Register it in `app/providers/registry.py` and add it to the `provider` literal in `app/schemas.py`.
5. Add a mocked test in `tests/test_providers.py`.

Candidates worth adding: NREL NSRDB (satellite solar, strong in the Americas and South Asia; free API key),
PVGIS (EU JRC; SARAH/ERA5-based solar), Global Wind Atlas (long-term mean wind for scaling, not hourly), and
on-site measurement uploads (CSV) for bankable work.
