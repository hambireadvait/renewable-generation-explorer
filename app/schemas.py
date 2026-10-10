"""Request validation. Bounds are physical/plausibility limits, not recommendations."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.solar import DEFAULT_LOSSES_PCT as SOLAR_LOSSES
from app.models.wind import DEFAULT_LOSSES_PCT as WIND_LOSSES


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Area(Strict):
    south: float = Field(ge=-90, le=90)
    west: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)

    @model_validator(mode="after")
    def _ordered(self):
        if self.north <= self.south:
            raise ValueError("area.north must be greater than area.south")
        if self.east <= self.west:
            raise ValueError("area.east must be greater than area.west (areas crossing the antimeridian are not supported)")
        if self.north - self.south > 10 or self.east - self.west > 10:
            raise ValueError("area must be at most 10° × 10°; a single-point estimate is meaningless for larger regions")
        return self


class Location(Strict):
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    label: str | None = Field(default=None, max_length=200)
    area: Area | None = None

    @model_validator(mode="after")
    def _point_or_area(self):
        if self.area is not None:
            self.latitude = round((self.area.north + self.area.south) / 2, 5)
            self.longitude = round((self.area.east + self.area.west) / 2, 5)
        if self.latitude is None or self.longitude is None:
            raise ValueError("provide latitude and longitude, or an area")
        return self


class SolarInput(Strict):
    capacity_kwp: float = Field(gt=0, le=2_000_000, description="DC nameplate, kWp")
    tilt_deg: float | None = Field(default=None, ge=0, le=90)
    azimuth_deg: float | None = Field(default=None, ge=0, lt=360, description="180 = south")
    mounting: Literal["fixed_open_rack", "fixed_roof_mount", "single_axis"] = "fixed_open_rack"
    dc_ac_ratio: float = Field(default=1.2, ge=0.8, le=2.0)
    inverter_efficiency_pct: float = Field(default=96.0, ge=80, le=99.5)
    temp_coeff_pct_per_c: float = Field(default=-0.35, ge=-0.6, le=0)
    albedo: float = Field(default=0.2, ge=0, le=0.9)
    losses_pct: dict[str, float] = Field(default_factory=lambda: dict(SOLAR_LOSSES))

    @field_validator("losses_pct")
    @classmethod
    def _losses(cls, v: dict[str, float]):
        unknown = set(v) - set(SOLAR_LOSSES)
        if unknown:
            raise ValueError(f"unknown solar loss categories: {sorted(unknown)}")
        if any(not 0 <= x <= 50 for x in v.values()):
            raise ValueError("each solar loss must be between 0 and 50 %")
        return {**SOLAR_LOSSES, **v}


class WindInput(Strict):
    turbine_rated_kw: float = Field(gt=0, le=20_000)
    n_turbines: int = Field(default=1, ge=1, le=1000)
    hub_height_m: float = Field(default=100, ge=10, le=250)
    rotor_diameter_m: float | None = Field(default=None, gt=1, le=300)
    power_curve: list[tuple[float, float]] | None = Field(
        default=None, description="Manufacturer curve as [[wind_speed_m_s, power_kW], ...]; overrides generic curve"
    )
    cut_in_ms: float = Field(default=3.0, gt=0, le=10)
    rated_speed_ms: float = Field(default=12.0, gt=0, le=25)
    cut_out_ms: float = Field(default=25.0, gt=0, le=40)
    air_density_correction: bool = True
    losses_pct: dict[str, float] = Field(default_factory=lambda: dict(WIND_LOSSES))

    @field_validator("losses_pct")
    @classmethod
    def _losses(cls, v: dict[str, float]):
        unknown = set(v) - set(WIND_LOSSES)
        if unknown:
            raise ValueError(f"unknown wind loss categories: {sorted(unknown)}")
        if any(not 0 <= x <= 50 for x in v.values()):
            raise ValueError("each wind loss must be between 0 and 50 %")
        return {**WIND_LOSSES, **v}

    @model_validator(mode="after")
    def _curve(self):
        if self.power_curve is None:
            if not self.cut_in_ms < self.rated_speed_ms < self.cut_out_ms:
                raise ValueError("generic curve needs cut_in_ms < rated_speed_ms < cut_out_ms")
            return self
        from app.models.wind import validate_power_curve

        errors = validate_power_curve(self.power_curve, self.turbine_rated_kw)
        if errors:
            raise ValueError(" ".join(errors))
        return self


class HybridInput(Strict):
    enabled: bool = True
    export_limit_kw: float | None = Field(default=None, gt=0, le=5_000_000,
                                          description="Shared grid-connection limit; output above it is curtailed")


def _default_years() -> tuple[int, int]:
    last = dt.date.today().year - 1
    return last - 4, last


class AssessRequest(Strict):
    location: Location
    provider: Literal["nasa_power", "open_meteo_era5", "demo"] = "nasa_power"
    start_year: int = Field(default_factory=lambda: _default_years()[0], ge=1950)
    end_year: int = Field(default_factory=lambda: _default_years()[1])
    solar: SolarInput | None = None
    wind: WindInput | None = None
    hybrid: HybridInput | None = None
    include_daily: bool = True

    @model_validator(mode="after")
    def _check(self):
        if self.solar is None and self.wind is None:
            raise ValueError("enable at least one technology (solar and/or wind)")
        if self.end_year < self.start_year:
            raise ValueError("end_year must be ≥ start_year")
        if self.end_year - self.start_year + 1 > 20:
            raise ValueError("at most 20 years per assessment")
        last = dt.date.today().year - 1
        if self.end_year > last:
            raise ValueError(f"end_year must be a complete past year (≤ {last})")
        return self


class ForecastRequest(Strict):
    location: Location
    provider: Literal["open_meteo_forecast", "demo"] = "open_meteo_forecast"
    days: int = Field(default=7, ge=1, le=16, description="Forecast horizon; 7 = this coming week")
    solar: SolarInput | None = None
    wind: WindInput | None = None
    hybrid: HybridInput | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.solar is None and self.wind is None:
            raise ValueError("enable at least one technology (solar and/or wind)")
        return self
