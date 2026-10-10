"""Self-contained HTML report (print-to-PDF friendly) and CSV exports."""

from __future__ import annotations

import csv
import html
import io
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
TECH_LABEL = {"solar": "Solar PV", "wind": "Wind", "hybrid": "Hybrid (export)"}
TECH_COLOR = {"solar": "#c98a00", "wind": "#2a6fb0", "hybrid": "#3c8d5a"}


def _e(x: Any) -> str:
    return html.escape("" if x is None else str(x))


def inr(x: float | None, digits: int = 0) -> str:
    """Number with Indian digit grouping (12,34,56,789) — used for kW/kWh figures."""
    if x is None:
        return "—"
    neg = x < 0
    x = abs(x)
    whole, _, frac = f"{x:.{digits}f}".partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    out = whole + (f".{frac}" if frac else "")
    return ("−" if neg else "") + out


def kwh(x: float | None) -> str:
    if x is None:
        return "—"
    if abs(x) >= 1e6:
        return f"{x / 1e6:,.2f} GWh"
    if abs(x) >= 1e3:
        return f"{x / 1e3:,.1f} MWh"
    return f"{x:,.0f} kWh"


def _bar_svg(values: list[float], labels: list[str], color: str, title: str, unit: str) -> str:
    w, h, pad_l, pad_b, pad_t = 640, 220, 56, 28, 24
    vmax = max([abs(v) for v in values] + [1e-9])
    vmin = min(values + [0])
    span = vmax - min(vmin, 0) if vmin < 0 else vmax
    inner_w, inner_h = w - pad_l - 10, h - pad_b - pad_t
    zero_y = pad_t + inner_h * (vmax / span) if vmin < 0 else pad_t + inner_h
    bw = inner_w / max(len(values), 1)
    parts = [f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="{_e(title)}" xmlns="http://www.w3.org/2000/svg">',
             f'<text x="{pad_l}" y="15" font-size="12" font-weight="600">{_e(title)} ({_e(unit)})</text>',
             f'<line x1="{pad_l}" y1="{zero_y:.1f}" x2="{w - 10}" y2="{zero_y:.1f}" stroke="#888" stroke-width="1"/>']
    for i, (v, lab) in enumerate(zip(values, labels)):
        bh = inner_h * abs(v) / span
        y = zero_y - bh if v >= 0 else zero_y
        fill = color if v >= 0 else "#b03a2e"
        parts.append(f'<rect x="{pad_l + i * bw + 2:.1f}" y="{y:.1f}" width="{bw - 4:.1f}" height="{bh:.1f}" fill="{fill}"/>')
        if len(labels) <= 13 or i % max(1, len(labels) // 12) == 0:
            parts.append(f'<text x="{pad_l + i * bw + bw / 2:.1f}" y="{h - 10}" font-size="10" text-anchor="middle">{_e(lab)}</text>')
    parts.append(f'<text x="{pad_l - 6}" y="{pad_t + 8}" font-size="10" text-anchor="end">{_e(_short(vmax))}</text>')
    if vmin < 0:
        parts.append(f'<text x="{pad_l - 6}" y="{h - pad_b}" font-size="10" text-anchor="end">{_e(_short(vmin))}</text>')
    parts.append("</svg>")
    return "".join(parts)


def _short(v: float) -> str:
    a = abs(v)
    if a >= 1e6:
        return f"{v / 1e6:.1f} M"
    if a >= 1e3:
        return f"{v / 1e3:.1f} k"
    return f"{v:.0f}"


def _table(headers: list[str], rows: list[list[Any]]) -> str:
    head = "".join(f"<th>{_e(h)}</th>" for h in headers)
    body = "".join("<tr>" + "".join(f"<td>{_e(c)}</td>" for c in r) + "</tr>" for r in rows)
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def render_html(p: dict[str, Any]) -> str:
    sections = []
    # Generation summary
    rows = []
    for tech, r in p["results"].items():
        s = r["summary"]
        ia = s["interannual"]
        rows.append([TECH_LABEL[tech], f"{inr(r['capacity_kw'], 1)} ({r['capacity_basis']})", kwh(s["annual_mean_kwh"]),
                     f"{s['capacity_factor_pct']}%" if s["capacity_factor_pct"] is not None else "—",
                     f"{kwh(ia['min_kwh'])} – {kwh(ia['max_kwh'])}", f"{ia['cv_pct']}%" if ia.get("cv_pct") else "—"])
    sections.append("<h2>Generation estimate (long-term, from historical weather)</h2>"
                    + _table(["Technology", "Capacity", "Mean annual energy", "Capacity factor",
                              "Range over years", "Year-to-year CV"], rows))
    for tech, r in p["results"].items():
        s = r["summary"]
        vals = [m["mean_kwh"] for m in s["monthly"]]
        labs = [MONTHS[m["month"] - 1] for m in s["monthly"]]
        sections.append(_bar_svg(vals, labs, TECH_COLOR[tech], f"{TECH_LABEL[tech]} — mean monthly energy", "kWh"))
        metrics = r.get("metrics") or {}
        flat = [[k.replace("_", " "), v] for k, v in metrics.items() if not isinstance(v, (list, dict))]
        if tech == "hybrid":
            flat = [["curtailed kWh per year", r["curtailed_kwh_per_year"]],
                    ["curtailed fraction %", r["curtailed_fraction_pct"]],
                    ["hourly correlation solar–wind", r["hourly_correlation_solar_wind"]],
                    ["method", r["method"]]]
        if flat:
            sections.append(f"<h3>{TECH_LABEL[tech]} metrics</h3>" + _table(["Metric", "Value"], flat))
        if "assumptions" in r:
            a = {k: v for k, v in r["assumptions"].items() if k != "power_curve_points"}
            sections.append(f"<details open><summary>{TECH_LABEL[tech]} assumptions</summary>"
                            + _table(["Assumption", "Value"], [[k.replace("_", " "), _fmt(v)] for k, v in a.items()])
                            + "</details>")
    intro = (f"<b>What this is:</b> a long-term average from historical weather ({p['period']['start_year']}–"
             f"{p['period']['end_year']}, {p['period']['n_years']} years). It is not a forecast and not a bankable "
             "energy-yield assessment.")
    return _page(p, "Long-term average generation", intro, sections)


def render_forecast_html(p: dict[str, Any]) -> str:
    fp = p["forecast_period"]
    sections = []
    techs = list(p["results"])
    rows = []
    for t, r in p["results"].items():
        tot = r["totals"]
        rows.append([TECH_LABEL[t], f"{inr(r['capacity_kw'], 1)} ({r['capacity_basis']})", kwh(tot["energy_kwh"]),
                     kwh(tot["average_per_day_kwh"]), f"{tot['capacity_factor_pct']}%", f"{inr(tot['peak_kw'], 1)} kW"])
    sections.append("<h2>Forecast generation</h2>" + _table(
        ["Technology", "Capacity", "Total for period", "Average per day", "Capacity factor", "Peak"], rows))
    headline = p["summary"]["headline_technology"]
    daily = p["daily"]
    sections.append(_bar_svg([d[f"{headline}_kwh"] for d in daily], [d["date"][5:] for d in daily],
                             TECH_COLOR[headline], f"{TECH_LABEL[headline]} — energy per day", "kWh"))
    head = ["Date", "Day"] + [f"{TECH_LABEL[t]} kWh" for t in techs] + ["Irradiation kWh/m²", "Mean temp °C"]
    if "wind" in p["results"]:
        head.append("Mean hub wind m/s")
    drows = []
    for d in daily:
        row = [d["date"] + (" (partial)" if d["partial_day"] else ""), d["weekday"][:3]]
        row += [inr(d[f"{t}_kwh"], 1) for t in techs] + [d["irradiation_kwh_m2"], d["mean_temp_c"]]
        if "wind" in p["results"]:
            row.append(d.get("mean_hub_wind_ms"))
        drows.append(row)
    sections.append("<h2>Day by day</h2>" + _table(head, drows))
    for t, r in p["results"].items():
        if "assumptions" in r:
            a = {k: v for k, v in r["assumptions"].items() if k != "power_curve_points"}
            sections.append(f"<details open><summary>{TECH_LABEL[t]} assumptions</summary>"
                            + _table(["Assumption", "Value"], [[k.replace("_", " "), _fmt(v)] for k, v in a.items()])
                            + "</details>")
    intro = (f"<b>Forecast period:</b> {_e(fp['start_local'][:16].replace('T', ' '))} → "
             f"{_e(fp['end_local'][:16].replace('T', ' '))} local time ({fp['hours']} hours), weather model "
             f"{_e(fp['model'])}. Forecast weather for these specific days — not a typical week, and less reliable "
             "beyond the first few days.")
    return _page(p, p["label"], intro, sections)


def _page(p: dict[str, Any], heading: str, intro: str, sections: list[str]) -> str:
    site = p["site"]
    src = p["source"]
    loc_label = site["requested"].get("label") or f"{site['requested']['latitude']:.4f}, {site['requested']['longitude']:.4f}"
    demo_banner = ('<div class="demo">DEMO MODE — SYNTHETIC DATA, NOT REAL. Do not use these numbers for any decision.</div>'
                   if p.get("is_demo") else "")
    area = p.get("area")
    area_line = (f" · area ≈{area['approx_area_km2']:,} km² evaluated at its centroid" if area else "")
    warnings = "".join(f"<li>{_e(w)}</li>" for w in p["warnings"])
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_e(heading)} — {_e(loc_label)}</title>
<style>
body{{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d232a;background:#fff;max-width:900px;margin:24px auto;padding:0 16px;line-height:1.45}}
h1{{font-size:22px;margin-bottom:4px}} h2{{font-size:17px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}} h3{{font-size:14px}}
table{{border-collapse:collapse;width:100%;font-size:12.5px;margin:8px 0}} th,td{{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}} th{{background:#f4f5f7}}
.muted{{color:#5b6570;font-size:12.5px}} .demo{{background:#b00020;color:#fff;font-weight:700;padding:10px;text-align:center;margin:12px 0}}
.box{{background:#f7f7f2;border:1px solid #e3e1d0;padding:10px 12px;font-size:12.5px}} svg{{width:100%;height:auto;margin:6px 0}} details summary{{cursor:pointer;font-weight:600;font-size:13px}}
@media print{{details{{display:block}} .demo{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}}}
</style></head><body>
{demo_banner}
<h1>{_e(heading)}</h1>
<p class="muted">{_e(loc_label)}{_e(area_line)} · data grid point {site['data_grid_point']['latitude']:.3f}, {site['data_grid_point']['longitude']:.3f} ·
time zone {_e(site['timezone'])} · generated {_e(p['generated_at'])} · app v{_e(p['app_version'])}</p>
<div class="box">{intro} <b>Not assessed:</b> {_e(", ".join(p["not_assessed"]))}.</div>
<h2>Data source</h2>
<p>{_e(src['name'])} — {_e(src['dataset'])}. Resolution {_e(src['resolution'])}. Retrieved {_e(src['retrieved_at'])}.
Licence: {_e(src['license'])}.</p><p class="muted">{_e(src['attribution'])}</p>
{''.join(sections)}
<h2>Warnings and limitations</h2><ul>{warnings}</ul>
<h2>Inputs</h2><pre style="font-size:11px;white-space:pre-wrap">{_e(_json(p["request"]))}</pre>
</body></html>"""


def _fmt(v: Any) -> str:
    if isinstance(v, dict):
        return "; ".join(f"{k.replace('_', ' ')}: {_fmt(x)}" for k, x in v.items())
    if isinstance(v, list):
        return ", ".join(_fmt(x) for x in v)
    return "—" if v is None else str(v)


def _json(obj: Any) -> str:
    import json

    return json.dumps(obj, indent=2, ensure_ascii=False)


def csv_monthly(p: dict[str, Any]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["technology", "month", "mean_kwh", "min_kwh", "max_kwh", "source", "period"])
    period = f"{p['period']['start_year']}-{p['period']['end_year']}"
    for tech, r in p["results"].items():
        for m in r["summary"]["monthly"]:
            w.writerow([tech, m["month"], m["mean_kwh"], m["min_kwh"], m["max_kwh"], p["source"]["name"], period])
    return _prefix(p) + buf.getvalue()


def csv_daily(p: dict[str, Any]) -> str:
    buf = io.StringIO()
    techs = list(p["results"])
    w = csv.writer(buf)
    w.writerow(["date_local"] + [f"{t}_kwh" for t in techs])
    series = {t: {d["date"]: d["kwh"] for d in p["results"][t]["summary"].get("daily", [])} for t in techs}
    dates = sorted(set().union(*[s.keys() for s in series.values()])) if series else []
    for d in dates:
        w.writerow([d] + [series[t].get(d, "") for t in techs])
    return _prefix(p) + buf.getvalue()


def csv_hourly(p: dict[str, Any], hourly: pd.DataFrame) -> str:
    local = hourly.tz_convert(ZoneInfo(p["site"]["timezone"]))
    out = local.round(4).copy()
    out.insert(0, "time_utc_hour_start", hourly.index.strftime("%Y-%m-%dT%H:%M:%SZ"))
    out.index = local.index.strftime("%Y-%m-%dT%H:%M:%S%z")
    out.index.name = "time_local_hour_start"
    return _prefix(p) + out.to_csv()


def _prefix(p: dict[str, Any]) -> str:
    demo = "# DEMO MODE — SYNTHETIC DATA, NOT REAL\n" if p.get("is_demo") else ""
    return (f"{demo}# use_case: {p['use_case']}; source: {p['source']['name']} ({p['source']['dataset']}); "
            f"retrieved {p['source']['retrieved_at']}; units: kWh, kW, W/m², °C, m/s\n")
