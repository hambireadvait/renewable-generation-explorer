import numpy as np
import pytest

from app.models.wind import (
    WindConfig, generic_power_curve, hub_height_speed, simulate_wind, total_loss_pct, validate_power_curve, wind_metrics,
)
from tests.conftest import make_weather


def test_generic_curve_shape():
    c = dict(generic_power_curve(2000, 3, 12, 25))
    assert c[0.0] == 0 and c[2.5] == 0
    assert c[12.0] == 2000 and c[20.0] == 2000 and c[25.0] == 2000
    assert 0 < c[7.5] < 2000
    with pytest.raises(ValueError):
        generic_power_curve(2000, 12, 3, 25)


def test_hub_height_methods(year_index):
    n = len(year_index)
    w = make_weather(year_index, wind={10: np.full(n, 5.0), 50: np.full(n, 5.0 * 5 ** 0.2)})
    v50, info = hub_height_speed(w, 50)
    assert info["extrapolated"] is False and np.allclose(v50, 5.0 * 5 ** 0.2)
    v30, info = hub_height_speed(w, 30)
    assert not info["extrapolated"] and np.allclose(v30, 5.0 * 3 ** 0.2)
    v100, info = hub_height_speed(w, 100)
    assert info["extrapolated"] and info["mean_alpha"] == pytest.approx(0.2, abs=1e-6)
    assert np.allclose(v100, 5.0 * 10 ** 0.2)


def test_alpha_clipped_and_calm_fallback(year_index):
    n = len(year_index)
    v10 = np.full(n, 4.0)
    v10[:100] = 0.1  # calm hours → α from month/hour median
    w = make_weather(year_index, wind={10: v10, 50: np.full(n, 40.0)})  # absurd shear → clipped to 0.5
    _, info = hub_height_speed(w, 100)
    assert info["mean_alpha"] <= 0.5


def test_output_bounded_and_losses(year_index):
    n = len(year_index)
    w = make_weather(year_index, wind={10: np.full(n, 15.0), 50: np.full(n, 15.0)}, heights=(10, 50))
    cfg = WindConfig(turbine_rated_kw=2000, n_turbines=3, hub_height_m=50, air_density_correction=False)
    hourly, meta = simulate_wind(w, cfg)
    loss = total_loss_pct(cfg.losses_pct)
    assert hourly["gross_kw"].max() == pytest.approx(6000)
    assert hourly["ac_kw"].max() == pytest.approx(6000 * (1 - loss / 100))
    assert any("generic" in x.lower() for x in meta["notes"])
    m = wind_metrics(hourly, cfg, 1)
    assert m["capacity_factor_pct"] == pytest.approx(100 * (1 - loss / 100) * 8760 / 8766, rel=1e-3)


def test_density_correction_lowers_output_in_thin_air(year_index):
    n = len(year_index)
    w = make_weather(year_index, wind={10: np.full(n, 7.0), 50: np.full(n, 7.0)})
    w.data["pressure"] = 85000.0  # high-altitude site
    cfg_on = WindConfig(turbine_rated_kw=2000, hub_height_m=50)
    cfg_off = WindConfig(turbine_rated_kw=2000, hub_height_m=50, air_density_correction=False)
    on = simulate_wind(w, cfg_on)[0]["ac_kw"].sum()
    off = simulate_wind(w, cfg_off)[0]["ac_kw"].sum()
    assert on < off


def test_user_curve_and_betz_check(year_index):
    w = make_weather(year_index)
    curve = [(3, 0), (5, 200), (8, 900), (11, 1500), (25, 1500)]
    cfg = WindConfig(turbine_rated_kw=1500, hub_height_m=50, power_curve=curve, rotor_diameter_m=20)
    _, meta = simulate_wind(w, cfg)
    assert meta["assumptions"]["power_curve"] == "user-supplied power curve"
    assert any("Betz" in n for n in meta["notes"])  # 1.5 MW on a 20 m rotor is impossible


def test_validate_power_curve():
    assert validate_power_curve([(3, 0), (2, 10), (4, 20)], 100)
    assert validate_power_curve([(3, 0), (4, 10)], 100)
    assert validate_power_curve([(3, 0), (4, 10), (5, 500)], 100)
    assert validate_power_curve([(3, 0), (4, 10), (5, 100)], 100) == []
