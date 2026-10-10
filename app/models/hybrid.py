"""Hybrid solar + wind at one site: hourly sum, optionally capped by a shared grid-export limit."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def combine(solar_kw: pd.Series, wind_kw: pd.Series, export_limit_kw: float | None) -> tuple[pd.DataFrame, dict[str, Any]]:
    total = solar_kw.add(wind_kw, fill_value=0.0)
    if export_limit_kw:
        export = total.clip(upper=export_limit_kw)
    else:
        export = total
    curtailed = total - export
    corr = float(np.corrcoef(solar_kw.to_numpy(), wind_kw.to_numpy())[0, 1]) if solar_kw.std() and wind_kw.std() else None
    frame = pd.DataFrame({"solar_kw": solar_kw, "wind_kw": wind_kw, "total_kw": total,
                          "export_kw": export, "curtailed_kw": curtailed})
    gross = float(total.sum())
    meta = {
        "export_limit_kw": export_limit_kw,
        "curtailed_fraction_pct": round(100 * float(curtailed.sum()) / gross, 2) if gross else 0.0,
        "hourly_correlation_solar_wind": round(corr, 3) if corr is not None else None,
        "method": "Hourly sum of independently modelled solar AC and wind net output; any output above the "
                  "export limit is curtailed. No storage, no grid-side curtailment, no shared-loss modelling.",
    }
    return frame, meta
