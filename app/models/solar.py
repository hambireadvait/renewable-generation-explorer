"""Solar PV energy model built on pvlib (PVWatts-style).

Chain per hour: solar position (at mid-hour) → plane-of-array irradiance (Hay–Davies) →
incidence-angle loss on beam → cell temperature (SAPM) → DC power (PVWatts, linear temperature
coefficient) → system losses (PVWatts loss categories) → inverter (PVWatts inverter, clipping at
AC rating). Physical outputs only; no money here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
import pvlib

from app.providers.base import WeatherSeries

DEFAULT_LOSSES_PCT = {
    # PVWatts v5 default loss categories (NREL TP-6A20-62641) → ≈14.08 % combined.
    "soiling": 2.0,
    "shading": 3.0,
    "snow": 0.0,
    "mismatch": 2.0,
    "wiring": 2.0,
    "connections": 0.5,
    "lid": 1.5,
    "nameplate_rating": 1.0,
    "age": 0.0,
    "availability": 3.0,
}

MOUNTING = {
    "fixed_open_rack": ("sapm", "open_rack_glass_polymer"),
    "fixed_roof_mount": ("sapm", "close_mount_glass_glass"),
    "single_axis": ("sapm", "open_rack_glass_polymer"),
}


@dataclass
class SolarConfig:
    capacity_kwp: float
    tilt_deg: float | None = None
    azimuth_deg: float | None = None  # 180 = south-facing; pvlib convention (N=0, E=90)
    mounting: str = "fixed_open_rack"
    dc_ac_ratio: float = 1.2
    inverter_efficiency_pct: float = 96.0
    temp_coeff_pct_per_c: float = -0.35
    albedo: float = 0.2
    tracker_max_angle_deg: float = 60.0
    tracker_gcr: float = 0.35
    losses_pct: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_LOSSES_PCT))


def default_orientation(lat: float) -> tuple[float, float]:
    """Rule of thumb: tilt ≈ |latitude| (capped at 40°), facing the equator."""
    return min(abs(lat), 40.0), (180.0 if lat >= 0 else 0.0)


def total_loss_pct(losses: dict[str, float]) -> float:
    return float(pvlib.pvsystem.pvwatts_losses(**{k: float(v) for k, v in losses.items()}))


def simulate_solar(weather: WeatherSeries, cfg: SolarConfig) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Return (hourly frame, assumptions/notes). Hourly frame columns (UTC hour-start index):
    poa_wm2, temp_cell_c, dc_kw, ac_kw. ac_kw is the hour-mean power, so ac_kw == kWh for that hour.
    """
    df = weather.data
    lat, lon = weather.latitude, weather.longitude
    notes: list[str] = []
    mid = df.index + pd.Timedelta(minutes=30)
    solpos = pvlib.solarposition.get_solarposition(mid, lat, lon, altitude=weather.elevation_m or 0)
    solpos.index = df.index
    dni_extra = pvlib.irradiance.get_extra_radiation(mid)
    dni_extra = pd.Series(np.asarray(dni_extra), index=df.index)

    ghi = df["ghi"].clip(lower=0)
    if {"dni", "dhi"}.issubset(df.columns):
        dni, dhi = df["dni"].clip(lower=0), df["dhi"].clip(lower=0)
    else:  # pragma: no cover - all current providers supply DNI/DHI
        erbs = pvlib.irradiance.erbs(ghi, solpos["zenith"], df.index)
        dni, dhi = erbs["dni"], erbs["dhi"]
        notes.append("DNI/DHI not supplied; decomposed from GHI with the Erbs model.")
    # Suppress spurious beam at very low sun (reanalysis artefacts near sunrise/sunset).
    dni = dni.where(solpos["apparent_zenith"] < 87, 0.0)

    default_tilt, default_az = default_orientation(lat)
    if cfg.mounting == "single_axis":
        track = pvlib.tracking.singleaxis(
            solpos["apparent_zenith"], solpos["azimuth"], axis_tilt=0, axis_azimuth=180,
            max_angle=cfg.tracker_max_angle_deg, backtrack=True, gcr=cfg.tracker_gcr,
        )
        surface_tilt = track["surface_tilt"].fillna(0)
        surface_az = track["surface_azimuth"].fillna(180)
        orientation = {"type": "single-axis tracker (N–S axis, backtracking)",
                       "max_angle_deg": cfg.tracker_max_angle_deg, "gcr": cfg.tracker_gcr}
    else:
        tilt = default_tilt if cfg.tilt_deg is None else cfg.tilt_deg
        az = default_az if cfg.azimuth_deg is None else cfg.azimuth_deg
        if cfg.tilt_deg is None or cfg.azimuth_deg is None:
            notes.append(f"Orientation not provided; defaulted to tilt {tilt:.0f}°, azimuth {az:.0f}° "
                         "(equator-facing, tilt≈|latitude|). Not an optimisation.")
        surface_tilt, surface_az = tilt, az
        orientation = {"type": cfg.mounting.replace("_", " "), "tilt_deg": round(tilt, 1), "azimuth_deg": round(az, 1)}

    poa = pvlib.irradiance.get_total_irradiance(
        surface_tilt, surface_az, solpos["apparent_zenith"], solpos["azimuth"],
        dni, ghi, dhi, dni_extra=dni_extra, model="haydavies", albedo=cfg.albedo,
    )
    aoi = pvlib.irradiance.aoi(surface_tilt, surface_az, solpos["apparent_zenith"], solpos["azimuth"])
    iam = pvlib.iam.physical(aoi)
    effective = (poa["poa_direct"].fillna(0) * iam.fillna(0) + poa["poa_diffuse"].fillna(0)).clip(lower=0)

    model, params_key = MOUNTING[cfg.mounting]
    tparams = pvlib.temperature.TEMPERATURE_MODEL_PARAMETERS[model][params_key]
    wind10 = df["wind_10m"] if "wind_10m" in df else pd.Series(1.0, index=df.index)
    temp_cell = pvlib.temperature.sapm_cell(poa["poa_global"].fillna(0), df["temp_air"], wind10, **tparams)

    pdc0_w = cfg.capacity_kwp * 1000.0
    dc_w = pvlib.pvsystem.pvwatts_dc(effective, temp_cell, pdc0_w, cfg.temp_coeff_pct_per_c / 100.0)
    loss_pct = total_loss_pct(cfg.losses_pct)
    dc_w = dc_w * (1 - loss_pct / 100.0)
    pac0_w = pdc0_w / cfg.dc_ac_ratio
    eta = cfg.inverter_efficiency_pct / 100.0
    ac_w = pvlib.inverter.pvwatts(dc_w, pdc0=pac0_w / eta, eta_inv_nom=eta).clip(lower=0)

    hourly = pd.DataFrame({
        "poa_wm2": poa["poa_global"].fillna(0),
        "temp_cell_c": temp_cell,
        "dc_kw": dc_w / 1000.0,
        "ac_kw": ac_w / 1000.0,
    }, index=df.index)
    clipped_kwh = float(((dc_w * eta - pac0_w) / 1000.0).clip(lower=0).sum())  # approx.: nominal efficiency
    assumptions = {
        "capacity_kwp_dc": cfg.capacity_kwp,
        "capacity_kw_ac": round(cfg.capacity_kwp / cfg.dc_ac_ratio, 3),
        "orientation": orientation,
        "dc_ac_ratio": cfg.dc_ac_ratio,
        "inverter_efficiency_pct": cfg.inverter_efficiency_pct,
        "temp_coeff_pct_per_c": cfg.temp_coeff_pct_per_c,
        "temperature_model": f"SAPM ({params_key})",
        "transposition_model": "Hay–Davies",
        "iam_model": "physical (beam only)",
        "albedo": cfg.albedo,
        "losses_pct": cfg.losses_pct,
        "total_system_loss_pct": round(loss_pct, 2),
        "degradation": "Not applied (energy for a new system).",
    }
    meta = {"assumptions": assumptions, "notes": notes, "approx_inverter_clipping_kwh": round(clipped_kwh, 1)}
    return hourly, meta


def solar_metrics(hourly: pd.DataFrame, cfg: SolarConfig, n_years: float) -> dict[str, Any]:
    ac_kwh = hourly["ac_kw"].sum() / n_years
    poa_kwh_m2 = hourly["poa_wm2"].sum() / 1000.0 / n_years
    return {
        "specific_yield_kwh_per_kwp": round(ac_kwh / cfg.capacity_kwp, 1),
        "performance_ratio": round(ac_kwh / (poa_kwh_m2 * cfg.capacity_kwp), 3) if poa_kwh_m2 > 0 else None,
        "poa_insolation_kwh_m2_yr": round(poa_kwh_m2, 1),
        "capacity_factor_dc_pct": round(100 * ac_kwh / (cfg.capacity_kwp * 8766), 2),
        "capacity_factor_ac_pct": round(100 * ac_kwh / (cfg.capacity_kwp / cfg.dc_ac_ratio * 8766), 2),
        "mean_cell_temp_daylight_c": round(float(hourly.loc[hourly["poa_wm2"] > 50, "temp_cell_c"].mean()), 1)
        if (hourly["poa_wm2"] > 50).any() else None,
    }
