"""Wind energy model: hub-height extrapolation → air-density adjustment → power curve → losses.

* Hub-height speed: power-law profile. The shear exponent α is computed every hour from the two
  provider heights that best bracket (or sit nearest below) the hub, clipped to [0, 0.5]; hours
  where α cannot be computed (near-calm) use the median α for that month and hour of day.
* Air density at hub height from 2 m temperature (lapse rate 6.5 K/km) and surface pressure
  (hypsometric). Wind speed is normalised to the power curve's reference density (1.225 kg/m³)
  with v·(ρ/ρ₀)^(1/3), the IEC 61400-12-1 method for pitch-regulated turbines.
* Power curve: user-supplied manufacturer curve, or a clearly-labelled GENERIC idealised curve.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from app.providers.base import WeatherSeries

RHO_REF = 1.225  # kg/m³
R_DRY = 287.05  # J/(kg·K)
G = 9.80665
BETZ = 16 / 27

DEFAULT_LOSSES_PCT = {
    "wake": 0.0,          # single turbine; set ~5–10 % for arrays
    "availability": 3.0,
    "electrical": 2.0,
    "turbine_performance": 2.0,
    "environmental": 1.5,  # soiling of blades, icing, high-temperature derating
    "curtailment": 0.0,
}


@dataclass
class WindConfig:
    turbine_rated_kw: float
    n_turbines: int = 1
    hub_height_m: float = 100.0
    rotor_diameter_m: float | None = None
    power_curve: list[tuple[float, float]] | None = None  # (m/s, kW) — overrides generic curve
    cut_in_ms: float = 3.0
    rated_speed_ms: float = 12.0
    cut_out_ms: float = 25.0
    air_density_correction: bool = True
    losses_pct: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_LOSSES_PCT))


def generic_power_curve(rated_kw: float, cut_in: float, rated: float, cut_out: float) -> list[tuple[float, float]]:
    """Idealised curve: cubic ramp between cut-in and rated speed, flat to cut-out. Not a real turbine."""
    if not 0 < cut_in < rated < cut_out:
        raise ValueError("Need 0 < cut-in < rated speed < cut-out.")
    speeds = np.round(np.arange(0, cut_out + 0.001, 0.5), 2)
    pts: list[tuple[float, float]] = []
    for v in speeds:
        if v < cut_in:
            p = 0.0
        elif v < rated:
            p = rated_kw * (v**3 - cut_in**3) / (rated**3 - cut_in**3)
        else:
            p = rated_kw
        pts.append((float(v), round(float(p), 3)))
    pts.append((cut_out + 0.01, 0.0))
    return pts


def total_loss_pct(losses: dict[str, float]) -> float:
    keep = 1.0
    for v in losses.values():
        keep *= 1 - float(v) / 100.0
    return 100 * (1 - keep)


def _alpha(v_lo: pd.Series, v_hi: pd.Series, h_lo: float, h_hi: float) -> pd.Series:
    valid = (v_lo > 0.5) & (v_hi > 0.5)
    alpha = pd.Series(np.nan, index=v_lo.index)
    alpha[valid] = np.log(v_hi[valid] / v_lo[valid]) / np.log(h_hi / h_lo)
    alpha = alpha.clip(0.0, 0.5)
    fallback = alpha.groupby([alpha.index.month, alpha.index.hour]).transform("median")
    return alpha.fillna(fallback).fillna(1 / 7)


def hub_height_speed(weather: WeatherSeries, hub_m: float) -> tuple[pd.Series, dict[str, Any]]:
    heights = sorted(weather.wind_heights)
    df = weather.data
    info: dict[str, Any] = {"available_heights_m": heights, "hub_height_m": hub_m}
    if hub_m in heights:
        info.update(method="direct (provider height equals hub height)", extrapolated=False)
        return df[weather.wind_column(int(hub_m))], info
    if len(heights) == 1:
        h = heights[0]
        alpha = pd.Series(1 / 7, index=df.index)
        info.update(method=f"power law with fixed α=1/7 from {h} m (only one height available)",
                    extrapolated=True, reference_height_m=h)
        v = df[weather.wind_column(h)] * (hub_m / h) ** alpha
        info["mean_alpha"] = 1 / 7
        return v, info
    below = [h for h in heights if h < hub_m]
    above = [h for h in heights if h > hub_m]
    if below and above:
        h_lo, h_hi = below[-1], above[0]
        ref = h_lo
        extrapolated = False
        method = f"interpolated between {h_lo} m and {h_hi} m using hourly shear exponent"
    elif below:  # hub above every provider height → extrapolate from the two highest
        h_lo, h_hi = below[-2], below[-1]
        ref = h_hi
        extrapolated = True
        method = f"extrapolated upward from {h_hi} m using hourly shear from {h_lo}–{h_hi} m"
    else:  # hub below lowest height
        h_lo, h_hi = above[0], above[1]
        ref = h_lo
        extrapolated = True
        method = f"extrapolated downward from {h_lo} m using hourly shear from {h_lo}–{h_hi} m"
    v_lo, v_hi = df[weather.wind_column(h_lo)], df[weather.wind_column(h_hi)]
    alpha = _alpha(v_lo, v_hi, h_lo, h_hi)
    v_ref = df[weather.wind_column(ref)]
    v = v_ref * (hub_m / ref) ** alpha
    info.update(method=method, extrapolated=extrapolated, reference_height_m=ref,
                mean_alpha=round(float(alpha.mean()), 3), extrapolation_ratio=round(hub_m / max(heights), 2))
    return v, info


def air_density(weather: WeatherSeries, hub_m: float) -> tuple[pd.Series, str]:
    df = weather.data
    t_hub = df["temp_air"] + 273.15 - 0.0065 * (hub_m - 2.0)
    if "pressure" in df and df["pressure"].notna().all():
        p_hub = df["pressure"] * np.exp(-G * hub_m / (R_DRY * t_hub))
        how = "from provider surface pressure and 2 m temperature (dry air)"
    else:
        elev = weather.elevation_m or 0.0
        p_surface = 101325.0 * (1 - 2.25577e-5 * elev) ** 5.25588
        p_hub = p_surface * np.exp(-G * hub_m / (R_DRY * t_hub))
        how = f"standard-atmosphere pressure at {elev:.0f} m elevation (no pressure data)"
    return p_hub / (R_DRY * t_hub), how


def validate_power_curve(curve: list[tuple[float, float]], rated_kw: float) -> list[str]:
    errors = []
    if len(curve) < 3:
        errors.append("Power curve needs at least 3 points.")
    speeds = [p[0] for p in curve]
    if any(b <= a for a, b in zip(speeds, speeds[1:])):
        errors.append("Power-curve wind speeds must be strictly increasing.")
    if any(p[1] < 0 for p in curve) or any(p[0] < 0 for p in curve):
        errors.append("Power-curve values must be non-negative.")
    if curve and max(p[1] for p in curve) > rated_kw * 1.1:
        errors.append("Power curve exceeds the stated rated power by more than 10%.")
    return errors


def simulate_wind(weather: WeatherSeries, cfg: WindConfig) -> tuple[pd.DataFrame, dict[str, Any]]:
    notes: list[str] = []
    v_hub, height_info = hub_height_speed(weather, cfg.hub_height_m)
    if height_info.get("extrapolated"):
        notes.append(
            f"Hub-height wind ({cfg.hub_height_m:.0f} m) is not in the source data; {height_info['method']}. "
            "Extrapolated shear is a major uncertainty, especially beyond ~1.5× the highest data height."
        )
    rho, rho_how = air_density(weather, cfg.hub_height_m)
    if cfg.air_density_correction:
        v_eq = v_hub * (rho / RHO_REF) ** (1 / 3)
    else:
        v_eq = v_hub
        notes.append("Air-density correction disabled; power curve applied at actual wind speed.")

    if cfg.power_curve:
        curve = sorted((float(a), float(b)) for a, b in cfg.power_curve)
        curve_label = "user-supplied power curve"
        if curve[-1][1] > 0:
            notes.append(f"Power curve ends at {curve[-1][0]} m/s with non-zero power; output is held at 0 above it "
                         "(treated as cut-out).")
            curve.append((curve[-1][0] + 0.01, 0.0))
    else:
        curve = generic_power_curve(cfg.turbine_rated_kw, cfg.cut_in_ms, cfg.rated_speed_ms, cfg.cut_out_ms)
        curve_label = (f"GENERIC idealised curve (cut-in {cfg.cut_in_ms}, rated {cfg.rated_speed_ms}, "
                       f"cut-out {cfg.cut_out_ms} m/s) — not a specific turbine")
        notes.append("No manufacturer power curve supplied: a generic idealised curve was used. Real turbines "
                     "of the same rating can differ by ±10–25% in annual energy. Supply the actual curve.")
    if cfg.rotor_diameter_m:
        area = np.pi * (cfg.rotor_diameter_m / 2) ** 2
        cps = [p * 1000 / (0.5 * RHO_REF * area * v**3) for v, p in curve if v > 0 and p > 0]
        if cps and max(cps) > BETZ:
            notes.append(f"Power curve implies a power coefficient of {max(cps):.2f} for a {cfg.rotor_diameter_m} m "
                         f"rotor, above the Betz limit ({BETZ:.3f}). Check rotor diameter or curve.")
        specific = cfg.turbine_rated_kw * 1000 / area
        height_info["specific_rating_w_m2"] = round(specific, 1)

    xs, ys = zip(*curve)
    gross_kw_per_turbine = np.interp(v_eq.to_numpy(), xs, ys, left=0.0, right=0.0)
    gross_kw = gross_kw_per_turbine * cfg.n_turbines
    loss_pct = total_loss_pct(cfg.losses_pct)
    net_kw = gross_kw * (1 - loss_pct / 100.0)
    hourly = pd.DataFrame({
        "wind_hub_ms": v_hub,
        "air_density_kg_m3": rho,
        "gross_kw": gross_kw,
        "ac_kw": net_kw,
    }, index=weather.data.index)
    assumptions = {
        "turbine_rated_kw": cfg.turbine_rated_kw,
        "n_turbines": cfg.n_turbines,
        "capacity_kw": cfg.turbine_rated_kw * cfg.n_turbines,
        "hub_height_m": cfg.hub_height_m,
        "rotor_diameter_m": cfg.rotor_diameter_m,
        "power_curve": curve_label,
        "power_curve_points": [[round(a, 2), round(b, 2)] for a, b in curve],
        "hub_height_method": height_info,
        "air_density": rho_how + ("; IEC 61400-12-1 speed normalisation" if cfg.air_density_correction else ""),
        "losses_pct": cfg.losses_pct,
        "total_loss_pct": round(loss_pct, 2),
    }
    return hourly, {"assumptions": assumptions, "notes": notes}


def wind_metrics(hourly: pd.DataFrame, cfg: WindConfig, n_years: float) -> dict[str, Any]:
    v = hourly["wind_hub_ms"].to_numpy()
    positive = v[v > 0.1]
    k = c = None
    if len(positive) > 100 and positive.std() > 0.05:  # constant series → fit undefined
        k, _, c = stats.weibull_min.fit(positive, floc=0)
    capacity = cfg.turbine_rated_kw * cfg.n_turbines
    net = hourly["ac_kw"].sum() / n_years
    bins = np.arange(0, max(26, int(np.ceil(v.max())) + 1), 1.0)
    counts, _ = np.histogram(v, bins=bins)
    energy, _ = np.histogram(v, bins=bins, weights=hourly["ac_kw"].to_numpy())
    return {
        "mean_hub_wind_ms": round(float(v.mean()), 2),
        "weibull_k": round(float(k), 2) if k else None,
        "weibull_c_ms": round(float(c), 2) if c else None,
        "mean_air_density_kg_m3": round(float(hourly["air_density_kg_m3"].mean()), 3),
        "capacity_factor_pct": round(100 * net / (capacity * 8766), 2),
        "full_load_hours": round(net / capacity, 0),
        "hours_below_cut_in_pct": round(100 * float((v < cfg.cut_in_ms).mean()), 1) if not cfg.power_curve else None,
        "histogram": [
            {"bin_ms": f"{int(b)}–{int(b) + 1}", "hours_per_year": round(cnt / n_years, 1),
             "net_kwh_per_year": round(e / n_years, 1)}
            for b, cnt, e in zip(bins[:-1], counts, energy)
        ],
    }
