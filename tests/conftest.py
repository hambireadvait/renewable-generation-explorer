from __future__ import annotations

import dataclasses
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.config import get_settings
from app.providers.base import SourceInfo, WeatherSeries


@pytest.fixture
def settings(tmp_path: Path):
    """Real settings with an isolated cache dir and offline mode off."""
    return dataclasses.replace(get_settings(), cache_dir=tmp_path / "cache", offline=False)


def make_weather(index: pd.DatetimeIndex, *, lat=20.0, lon=78.0, ghi_scale=1.0, wind=None, heights=(10, 50)) -> WeatherSeries:
    """Deterministic clear-sky-like weather for model tests (not real data)."""
    import pvlib

    mid = index + pd.Timedelta(minutes=30)
    sp = pvlib.solarposition.get_solarposition(mid, lat, lon)
    cs = pvlib.clearsky.haurwitz(sp["apparent_zenith"])
    ghi = cs["ghi"].to_numpy() * ghi_scale
    erbs = pvlib.irradiance.erbs(ghi, sp["zenith"].to_numpy(), mid)
    data = {
        "ghi": ghi,
        "dni": np.nan_to_num(erbs["dni"]),
        "dhi": np.nan_to_num(erbs["dhi"]),
        "temp_air": np.full(len(index), 25.0),
        "pressure": np.full(len(index), 101325.0),
    }
    w = wind if wind is not None else {h: np.full(len(index), 6.0 * (h / 10) ** 0.14) for h in heights}
    for h, v in w.items():
        data[f"wind_{h}m"] = v
    src = SourceInfo("test", "test", "synthetic test series", "", "n/a", "n/a", "n/a", "2026-01-01T00:00:00+00:00",
                     False, "", is_demo=True)
    return WeatherSeries(pd.DataFrame(data, index=index), sorted(w), src, lat, lon, 0.0, {"max_missing_pct": 0.0})


@pytest.fixture
def year_index():
    return pd.date_range("2023-01-01", "2023-12-31 23:00", freq="h", tz="UTC")
