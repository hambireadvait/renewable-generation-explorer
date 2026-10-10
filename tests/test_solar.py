import dataclasses

import pytest

from app.models.solar import SolarConfig, default_orientation, simulate_solar, solar_metrics, total_loss_pct
from tests.conftest import make_weather


def test_default_orientation():
    assert default_orientation(26.9) == (26.9, 180.0)
    assert default_orientation(-33.9) == (33.9, 0.0)
    assert default_orientation(60) == (40.0, 180.0)


def test_pvwatts_default_losses_total():
    # PVWatts v5 default categories with availability 3 % give ≈14.1 % combined.
    assert total_loss_pct(SolarConfig(capacity_kwp=1).losses_pct) == pytest.approx(14.08, abs=0.05)


def test_basic_physics(year_index):
    w = make_weather(year_index, lat=20, lon=78)
    cfg = SolarConfig(capacity_kwp=100)
    hourly, meta = simulate_solar(w, cfg)
    ac = hourly["ac_kw"]
    assert (ac >= 0).all()
    assert ac.max() <= cfg.capacity_kwp / cfg.dc_ac_ratio + 1e-6  # clipped at AC rating
    assert ac[w.data["ghi"] == 0].sum() == 0  # nothing at night
    m = solar_metrics(hourly, cfg, 1)
    # Clear-sky (no clouds) at 20°N: specific yield must be high but physically bounded.
    assert 1500 < m["specific_yield_kwh_per_kwp"] < 2600
    assert 0.6 < m["performance_ratio"] < 0.9
    assert meta["assumptions"]["total_system_loss_pct"] == pytest.approx(14.08, abs=0.05)
    assert any("Orientation not provided" in n for n in meta["notes"])


def test_losses_and_tracking_change_energy(year_index):
    w = make_weather(year_index, lat=20, lon=78)
    base = simulate_solar(w, SolarConfig(capacity_kwp=100))[0]["ac_kw"].sum()
    lossy = SolarConfig(capacity_kwp=100)
    lossy.losses_pct = {**lossy.losses_pct, "soiling": 10.0}
    worse = simulate_solar(w, lossy)[0]["ac_kw"].sum()
    tracker = simulate_solar(w, SolarConfig(capacity_kwp=100, mounting="single_axis"))[0]["ac_kw"].sum()
    assert worse < base
    assert tracker > base * 1.1


def test_energy_scales_with_capacity(year_index):
    w = make_weather(year_index)
    a = simulate_solar(w, SolarConfig(capacity_kwp=10, tilt_deg=20, azimuth_deg=180))[0]["ac_kw"].sum()
    b = simulate_solar(w, SolarConfig(capacity_kwp=20, tilt_deg=20, azimuth_deg=180))[0]["ac_kw"].sum()
    assert b == pytest.approx(2 * a, rel=1e-6)


def test_hotter_is_lower(year_index):
    cool = make_weather(year_index)
    hot = make_weather(year_index)
    hot.data["temp_air"] = 40.0
    cfg = SolarConfig(capacity_kwp=10, tilt_deg=20, azimuth_deg=180)
    assert simulate_solar(hot, cfg)[0]["ac_kw"].sum() < simulate_solar(cool, cfg)[0]["ac_kw"].sum()
