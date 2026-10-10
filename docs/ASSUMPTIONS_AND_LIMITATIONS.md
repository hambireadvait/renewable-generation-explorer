# Assumptions and limitations

Every default below can be changed in the UI or API. Defaults exist so the tool works out of the box;
they are **not** recommendations for a specific project. The app models **energy only**: no costs or revenue.

## Inputs the user must supply (or consciously accept the default)

| Input | Why it matters | Default |
|---|---|---|
| Location | Resource varies strongly by site | Jaisalmer, Rajasthan (example) |
| Solar DC capacity (kWp) | Scales energy and cost linearly | 1 000 kWp |
| Tilt / azimuth / mounting | ±5–25 % energy | Tilt ≈ \|latitude\| (≤40°), equator-facing, fixed open rack |
| Wind turbine rating, count, **hub height** | Energy scales strongly with hub-height wind | 1 × 3 000 kW at 120 m |
| **Wind power curve** | Generic curve can be off by ±10–25 % | Generic idealised curve (flagged) |
| Forecast window | Totals scale with it; skill drops after ~3 days | Next 7 days from the current hour |

## Physical modelling defaults

### Solar (pvlib — PVWatts-style chain)

| Item | Default | Basis |
|---|---|---|
| Sun position | At mid-hour (hour-mean irradiance) | Standard practice for hourly averages |
| Beam/diffuse | Provider DNI and DHI; beam suppressed when apparent zenith ≥ 87° | Avoids low-sun artefacts in gridded data |
| Transposition | Hay–Davies, albedo 0.2 | Widely used, robust for hourly data |
| Incidence-angle loss | pvlib `physical` model, beam only | |
| Cell temperature | SAPM: open rack glass/polymer (ground, tracker) or close-mount glass/glass (roof) | Sandia parameters in pvlib |
| Temperature coefficient | −0.35 %/°C | Typical modern mono-Si |
| Losses | PVWatts v5 categories: soiling 2, shading 3, snow 0, mismatch 2, wiring 2, connections 0.5, LID 1.5, nameplate 1, age 0, availability 3 → ≈14.1 % combined | NREL PVWatts v5 default loss categories. Soiling is often higher in dusty regions (e.g. NW India) — consider 3–5 % or more without frequent cleaning |
| Inverter | PVWatts inverter model, 96 % nominal efficiency, DC/AC 1.2, clipping at AC rating | |
| Tracker | Single-axis, N–S axis, ±60°, backtracking, GCR 0.35 | |
| Degradation | Not applied (output of a new system) | |

### Wind

| Item | Default | Basis / caveat |
|---|---|---|
| Hub-height speed | Power law with **hourly** shear exponent from the two provider heights that bracket (or are nearest below) the hub; α clipped to [0, 0.5]; calm hours use the month×hour median α | Captures diurnal stability changes better than a fixed 1/7. Extrapolation above the highest data height (50 m POWER, 100 m ERA5) is flagged |
| Air density | From 2 m temperature (−6.5 K/km lapse) and surface pressure (hypsometric); speed normalised with v·(ρ/1.225)^(1/3) | IEC 61400-12-1 method for pitch-regulated turbines |
| Power curve | User curve, else generic: cubic ramp from cut-in 3 m/s to rated 12 m/s, flat to cut-out 25 m/s | Generic curve is **not** a real turbine |
| Losses | wake 0 (single turbine — set 5–10 % for arrays), availability 3, electrical 2, turbine performance 2, environmental 1.5, curtailment 0 → ≈8.2 % combined | Typical screening values |
| Betz check | If rotor diameter is given, warns when the curve implies Cp > 16/27 | Catches inconsistent inputs |

### Hybrid
Hourly sum of independently modelled solar AC and wind net output, optionally capped at a grid-export limit
(excess is curtailed and reported). No storage, no shared-infrastructure loss modelling.

### Aggregation and uncertainty
- Per-year totals on UTC calendar years; monthly, daily and average-day profiles in the site's local time zone
  (from coordinates via `timezonefinder`). Partial local days at the period edges are dropped.
- Missing hours: gaps ≤3 h interpolated, longer gaps filled with the same month/hour mean; counts reported.
  Requests with >10 % missing data are refused.
- Shown: year-to-year min/max, coefficient of variation, and a one-year P90 = mean − 1.2816σ using
  **interannual variability only** (needs ≥3 years; noisy with few years).
- **Not quantified:** dataset bias, model error, loss uncertainty, long-term climate trends. The observed
  NASA POWER vs ERA5 spread (see DATA_SOURCES.md) shows these can exceed interannual variability.

## Forecast specifics

- Weather: Open-Meteo `best_match`, so the model blend depends on the location; hourly radiation is
  the preceding-hour mean, shifted back to hour-start.
- Window: exactly `days × 24` hours from the current hour. Partial local days at either end are
  flagged in the table and chart.
- The weekly total reflects the weather forecast for those specific days, not a typical week. Compare
  with the long-term average tab, keeping in mind that its "per week" figure is an annual average
  and ignores seasonality.
- Typical forecast error grows with lead time. Day-ahead cloud timing and wind speed can easily be
  off by 20–50 % for a given day; days 5–16 are indicative only.

## Known limitations

- **Not assessed:** costs, revenue or financial viability; land suitability/availability, terrain, land use,
  environmental constraints, permits, grid connection capacity, grid-operator curtailment, plant outages
  beyond the availability loss.
- **Spatial resolution:** gridded data (≈0.25°–1°) cannot capture local terrain, coastal gradients or obstacles.
  A drawn area is evaluated at its centroid only.
- **Wind:** reanalysis wind is smoothed and often biased; extrapolation to modern hub heights (100–160 m) from
  10/50/100 m data is a large uncertainty. Bankable wind assessment needs ≥12 months of on-site measurement
  (met mast or LiDAR) correlated to long-term reference data.
- **Solar:** no horizon or near-shading model (only a flat shading loss %), no bifacial gain, no snow model,
  no spectral correction; soiling is a fixed percentage.
- **Forecast:** Open-Meteo `best_match` model; skill falls off after a few days; the 16-day option may return
  slightly fewer hours than requested (a warning says so).
- **Free-tier terms:** Open-Meteo's free tier is non-commercial; commercial deployments need a paid key.
  OSM tiles are for light use only.
- **Scenarios** are stored in the browser's localStorage and are lost if site data is cleared.
- **Demo mode** data is synthetic and must never be used for decisions.
