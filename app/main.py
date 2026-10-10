"""FastAPI app: JSON API under /api, static frontend at /."""

from __future__ import annotations

import json
import threading
from collections import OrderedDict
from typing import Callable, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app import __version__, report
from app.config import ROOT, get_settings
from app.models.solar import DEFAULT_LOSSES_PCT as SOLAR_LOSSES
from app.models.wind import DEFAULT_LOSSES_PCT as WIND_LOSSES
from app.providers.base import ProviderError
from app.providers.registry import DEFAULT_FORECAST, DEFAULT_HISTORICAL, Registry, build_registry
from app.schemas import AssessRequest, ForecastRequest, _default_years
from app.service import Computed, assess, forecast

app = FastAPI(
    title="Renewable Generation Explorer API",
    version=__version__,
    description="Solar / wind / hybrid energy generation estimates. Near-term (this week) forecasts use weather "
                "forecasts; long-term averages use historical weather. Energy only — no financial modelling.",
)
# Long-term payloads (hourly series, daily rows) compress ~10×.
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def _headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    path = request.url.path
    if path == "/" or path.startswith("/static/"):
        # Assets are not fingerprinted: always revalidate (cheap 304s via ETag) so deploys show up immediately.
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


def get_registry(request: Request) -> Registry:
    reg = getattr(request.app.state, "registry", None)
    if reg is None:
        reg = build_registry(get_settings())
        request.app.state.registry = reg
    return reg


class _Memo:
    """Tiny LRU so report/export calls right after /assess don't recompute."""

    def __init__(self, size: int = 16):
        self.size = size
        self.data: OrderedDict[str, Computed] = OrderedDict()
        self.lock = threading.Lock()

    def get_or_compute(self, key: str, fn: Callable[[], Computed]) -> Computed:
        with self.lock:
            if key in self.data:
                self.data.move_to_end(key)
                return self.data[key]
        value = fn()
        with self.lock:
            self.data[key] = value
            while len(self.data) > self.size:
                self.data.popitem(last=False)
        return value


_memo = _Memo()


@app.exception_handler(ProviderError)
async def _provider_error(_: Request, exc: ProviderError):
    return JSONResponse(status_code=exc.status, content={"error": {
        "type": "provider_error", "provider": exc.provider, "message": exc.message, "retryable": exc.retryable,
        "hint": "You can retry, choose another data source, or run in clearly-labelled demo mode.",
    }})


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError):
    issues = []
    for e in exc.errors():
        loc = ".".join(str(x) for x in e.get("loc", []) if x != "body")
        msg = str(e.get("msg", "")).removeprefix("Value error, ")
        issues.append({"field": loc or "(request)", "message": msg})
    return JSONResponse(status_code=422, content={"error": {"type": "validation_error",
                                                            "message": "Some inputs are invalid.", "issues": issues}})


def _computed_assess(req: AssessRequest, request: Request) -> Computed:
    key = "assess:" + json.dumps(req.model_dump(mode="json"), sort_keys=True)
    return _memo.get_or_compute(key, lambda: assess(req, get_registry(request)))


def _computed_forecast(req: ForecastRequest, request: Request) -> Computed:
    # Forecast data itself is cached for ≤1 h on disk; the memo only spares recomputation for exports.
    key = "forecast:" + json.dumps(req.model_dump(mode="json"), sort_keys=True)
    return _memo.get_or_compute(key, lambda: forecast(req, get_registry(request)))


@app.get("/api/health")
def health():
    s = get_settings()
    return {"status": "ok", "version": __version__, "offline_mode": s.offline,
            "open_meteo_commercial_key": s.open_meteo_commercial}


@app.get("/api/providers")
def providers(request: Request):
    reg = get_registry(request)
    return {
        "historical": [p.describe() for p in reg.historical.values()],
        "forecast": [p.describe() for p in reg.forecast.values()],
        "geocoding": {"id": reg.geocoder.id, "name": reg.geocoder.name, "attribution": reg.geocoder.attribution,
                      "api_key_required": False},
        "defaults": {"historical": DEFAULT_HISTORICAL, "forecast": DEFAULT_FORECAST},
    }


@app.get("/api/defaults")
def defaults():
    start, end = _default_years()
    return {
        "period": {"start_year": start, "end_year": end},
        "solar": {"capacity_kwp": 1000, "mounting": "fixed_open_rack", "dc_ac_ratio": 1.2,
                  "inverter_efficiency_pct": 96.0, "temp_coeff_pct_per_c": -0.35, "albedo": 0.2,
                  "losses_pct": SOLAR_LOSSES, "tilt_deg": None, "azimuth_deg": None},
        "wind": {"turbine_rated_kw": 3000, "n_turbines": 1, "hub_height_m": 120, "rotor_diameter_m": None,
                 "cut_in_ms": 3.0, "rated_speed_ms": 12.0, "cut_out_ms": 25.0, "air_density_correction": True,
                 "losses_pct": WIND_LOSSES},
        "forecast": {"days": 7, "max_days": 16},
        "notes": "All defaults are placeholders for screening; replace with project-specific values. "
                 "See docs/ASSUMPTIONS_AND_LIMITATIONS.md for sources.",
    }


@app.get("/api/geocode")
def geocode(request: Request, q: str = Query(min_length=2, max_length=100), count: int = Query(8, ge=1, le=20)):
    return get_registry(request).geocoder.search(q.strip(), count)


@app.post("/api/assess")
def api_assess(req: AssessRequest, request: Request):
    return _computed_assess(req, request).payload


@app.post("/api/forecast")
def api_forecast(req: ForecastRequest, request: Request):
    return _computed_forecast(req, request).payload


@app.post("/api/forecast/report", response_class=HTMLResponse)
def api_forecast_report(req: ForecastRequest, request: Request, download: bool = True):
    payload = _computed_forecast(req, request).payload
    headers = {"Content-Disposition": 'attachment; filename="generation-forecast.html"'} if download else {}
    return HTMLResponse(report.render_forecast_html(payload), headers=headers)


@app.post("/api/report", response_class=HTMLResponse)
def api_report(req: AssessRequest, request: Request, download: bool = True):
    payload = _computed_assess(req, request).payload
    headers = {"Content-Disposition": 'attachment; filename="long-term-generation.html"'} if download else {}
    return HTMLResponse(report.render_html(payload), headers=headers)


@app.post("/api/export/{kind}")
def api_export(kind: Literal["monthly", "daily", "hourly", "json"], req: AssessRequest, request: Request):
    computed = _computed_assess(req, request)
    p = computed.payload
    if kind == "json":
        body, media, ext = json.dumps(p, ensure_ascii=False, indent=1), "application/json", "json"
    elif kind == "monthly":
        body, media, ext = report.csv_monthly(p), "text/csv", "csv"
    elif kind == "daily":
        if not req.include_daily:
            raise HTTPException(422, "include_daily must be true for daily export")
        body, media, ext = report.csv_daily(p), "text/csv", "csv"
    else:
        body, media, ext = report.csv_hourly(p, computed.hourly), "text/csv", "csv"
    return PlainTextResponse(body, media_type=media, headers={
        "Content-Disposition": f'attachment; filename="long-term-{kind}.{ext}"'})


@app.post("/api/forecast/export")
def api_forecast_export(req: ForecastRequest, request: Request):
    computed = _computed_forecast(req, request)
    return PlainTextResponse(report.csv_hourly(computed.payload, computed.hourly), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="forecast-hourly.csv"'})


STATIC = ROOT / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return RedirectResponse("/static/favicon.svg", status_code=308)
