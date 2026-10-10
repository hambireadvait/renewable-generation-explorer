"""Turn an hourly kWh series into daily / monthly / per-year / diurnal summaries."""

from __future__ import annotations

from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from timezonefinder import TimezoneFinder

_TF: TimezoneFinder | None = None


def local_timezone(lat: float, lon: float) -> str:
    global _TF
    if _TF is None:
        _TF = TimezoneFinder()
    name = _TF.timezone_at(lat=lat, lng=lon)
    if name:
        return name
    offset = int(round(lon / 15.0))  # open ocean: nautical time zone
    return "UTC" if offset == 0 else f"Etc/GMT{-offset:+d}"


def summarize(hourly_kwh: pd.Series, tz: str, capacity_kw: float, *, include_daily: bool = True) -> dict[str, Any]:
    """hourly_kwh: UTC hour-start index, kWh per hour (== hour-mean kW)."""
    s = hourly_kwh.astype(float)
    years = sorted(set(s.index.year))
    # Per-year totals on UTC calendar years so every year has exactly its 8760/8784 hours.
    per_year = []
    for y in years:
        part = s[s.index.year == y]
        hours = len(part)
        per_year.append({
            "year": int(y),
            "kwh": round(float(part.sum()), 1),
            "capacity_factor_pct": round(100 * part.sum() / (capacity_kw * hours), 2) if capacity_kw and hours else None,
            "hours": hours,
        })
    totals = np.array([p["kwh"] for p in per_year])
    mean = float(totals.mean()) if len(totals) else 0.0
    std = float(totals.std(ddof=1)) if len(totals) > 1 else None
    interannual: dict[str, Any] = {
        "n_years": len(totals),
        "min_kwh": round(float(totals.min()), 1) if len(totals) else None,
        "max_kwh": round(float(totals.max()), 1) if len(totals) else None,
        "std_kwh": round(std, 1) if std is not None else None,
        "cv_pct": round(100 * std / mean, 2) if std and mean else None,
    }
    if std is not None and len(totals) >= 3:
        # One-year P90 assuming normally distributed annual yield; interannual variability ONLY
        # (excludes model, data and loss uncertainty) and noisy with few years.
        interannual["p90_1yr_kwh_interannual_only"] = round(mean - 1.2816 * std, 1)
    local = s.tz_convert(ZoneInfo(tz))
    in_range = local[(local.index.year >= years[0]) & (local.index.year <= years[-1])] if years else local
    # Drop the partial local day at either end (shift between UTC and local time).
    days = in_range.groupby(in_range.index.date)
    counts = days.size()
    daily = days.sum()[counts >= 23]  # DST days have 23/25 hours
    monthly_tot = in_range.groupby([in_range.index.year, in_range.index.month]).sum()
    monthly = []
    for m in range(1, 13):
        vals = monthly_tot[monthly_tot.index.get_level_values(1) == m].to_numpy()
        if len(vals):
            monthly.append({"month": m, "mean_kwh": round(float(vals.mean()), 1),
                            "min_kwh": round(float(vals.min()), 1), "max_kwh": round(float(vals.max()), 1)})
    diurnal = in_range.groupby([in_range.index.month, in_range.index.hour]).mean()
    diurnal_profile = [
        [round(float(diurnal.get((m, h), 0.0)), 3) for h in range(24)] for m in range(1, 13)
    ]
    out: dict[str, Any] = {
        "annual_mean_kwh": round(mean, 1),
        "capacity_factor_pct": round(100 * mean / (capacity_kw * 8766), 2) if capacity_kw else None,
        "per_year": per_year,
        "interannual": interannual,
        "monthly": monthly,
        "daily_mean_kwh": round(float(daily.mean()), 2) if len(daily) else None,
        "diurnal_profile_kw": diurnal_profile,
        "timezone": tz,
    }
    if include_daily:
        out["daily"] = [{"date": str(d), "kwh": round(float(v), 2)} for d, v in daily.items()]
    return out
