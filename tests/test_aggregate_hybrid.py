import numpy as np
import pandas as pd
import pytest

from app.models.aggregate import local_timezone, summarize
from app.models.hybrid import combine


def test_summarize_constant_series():
    idx = pd.date_range("2022-01-01", "2023-12-31 23:00", freq="h", tz="UTC")
    s = pd.Series(1.0, index=idx)
    out = summarize(s, "Asia/Kolkata", capacity_kw=1.0)
    assert [p["year"] for p in out["per_year"]] == [2022, 2023]
    assert out["per_year"][0]["kwh"] == 8760
    assert out["annual_mean_kwh"] == 8760
    assert out["capacity_factor_pct"] == pytest.approx(100 * 8760 / 8766, rel=1e-4)
    assert len(out["monthly"]) == 12
    # Partial local days at the UTC/IST boundary are dropped.
    assert all(d["kwh"] >= 23 for d in out["daily"])
    assert len(out["diurnal_profile_kw"]) == 12 and len(out["diurnal_profile_kw"][0]) == 24
    assert out["interannual"]["n_years"] == 2
    assert "p90_1yr_kwh_interannual_only" not in out["interannual"]  # needs ≥3 years


def test_timezone_lookup():
    assert local_timezone(19.07, 72.88) == "Asia/Kolkata"
    assert local_timezone(0.0, -30.0).startswith("Etc/GMT") or local_timezone(0.0, -30.0) == "UTC"


def test_hybrid_curtailment():
    idx = pd.date_range("2023-01-01", periods=4, freq="h", tz="UTC")
    solar = pd.Series([0, 50, 100, 0], index=idx, dtype=float)
    wind = pd.Series([30, 60, 80, 10], index=idx, dtype=float)
    frame, meta = combine(solar, wind, export_limit_kw=100)
    assert list(frame["export_kw"]) == [30, 100, 100, 10]
    assert list(frame["curtailed_kw"]) == [0, 10, 80, 0]
    assert meta["curtailed_fraction_pct"] == pytest.approx(100 * 90 / 330, abs=0.01)
    frame2, meta2 = combine(solar, wind, None)
    assert meta2["curtailed_fraction_pct"] == 0
