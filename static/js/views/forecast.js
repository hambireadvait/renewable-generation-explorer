// "This week's forecast" page.
import { api } from "../api.js";
import * as charts from "../charts.js";
import { TECH_LABEL, energy, esc, num, pct } from "../format.js";
import { state } from "../state.js";
import { badge, emptyState, errorState, skeletonResults, sparkBars, statCard } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { demoBanner, detailsAccordion, localTime, modeBadge, notesPanel, siteMeta, wireExportMenu, wireSaveButton } from "./shared.js";

const $ = (sel, root = document) => root.querySelector(sel);
const TECH_ICON = { solar: "sun", wind: "wind", hybrid: "zap" };

export function renderForecast(root, { onRun, onDemo }) {
  charts.destroyAll("fc-");
  root.classList.remove("is-demo");
  const status = state.status.forecast;
  if (status === "loading") {
    const days = state.pending?.forecast?.days ?? 7;
    root.innerHTML = `<p class="loading-note">${icon("loader-circle", { size: 14, cls: "spin" })} Fetching the latest weather forecast and modelling ${days * 24} hours of generation…</p>${skeletonResults({ stats: 3, charts: 1 })}`;
    return;
  }
  if (status === "error") {
    const { err } = state.error.forecast;
    const provider = err.kind === "provider_error" || err.kind === "network";
    root.innerHTML = errorState({
      title: provider ? "The weather forecast could not be retrieved" : "The forecast could not be run",
      message: err.message,
      issues: err.issues,
      hint: err.hint,
      actions: `<button class="btn btn-secondary btn-sm" data-act="retry">${icon("rotate-ccw", { size: 14 })} Try again</button>
        ${provider ? `<button class="btn btn-ghost btn-sm" data-act="demo">${icon("flask-conical", { size: 14 })} Use demo data instead</button>` : ""}`,
    });
    root.querySelector('[data-act="retry"]').addEventListener("click", onRun);
    root.querySelector('[data-act="demo"]')?.addEventListener("click", onDemo);
    return;
  }
  if (!state.last.forecast) {
    root.innerHTML = emptyState({
      iconName: "calendar-range",
      title: "How much energy will be generated this week?",
      body: "Choose a place or draw a region, describe the solar and wind capacity on the left, then run the forecast.",
      action: `<button class="btn btn-primary" data-act="run">${icon("play", { size: 14 })} Run forecast</button>`,
    });
    root.querySelector('[data-act="run"]').addEventListener("click", onRun);
    return;
  }
  renderResults(root, state.last.forecast.payload);
}

function renderResults(root, p) {
  const fp = p.forecast_period;
  const headline = p.summary.headline_technology;
  const techs = Object.keys(p.results);
  const gen = techs.filter((t) => t !== "hybrid");
  const head = p.results[headline];
  const daily = p.daily;
  const fullDays = daily.filter((d) => !d.partial_day);
  const windowLabel = fp.days_requested === 7 ? "this week" : fp.days_requested === 1 ? "next 24 hours" : `next ${fp.days_requested} days`;

  const stats = [
    statCard({
      big: true, tone: headline, iconName: TECH_ICON[headline],
      label: `${techs.length > 1 ? "Total generation" : TECH_LABEL[headline]} · ${windowLabel}`,
      value: energy(p.summary.total_kwh),
      sub: `≈ <b>${energy(head.totals.average_per_day_kwh)}</b> per day · best <b>${esc(p.summary.best_day.date.slice(5))}</b> ${energy(p.summary.best_day.kwh)} · lowest <b>${esc(p.summary.lowest_day.date.slice(5))}</b> ${energy(p.summary.lowest_day.kwh)}`,
      spark: sparkBars(daily.map((d) => d[`${headline}_kwh`]), { tone: headline, labels: daily.map((d) => `${d.date}: ${energy(d[`${headline}_kwh`])}`) }),
    }),
    ...gen.map((t) => {
      const r = p.results[t];
      return statCard({
        tone: t, iconName: TECH_ICON[t],
        label: `${TECH_LABEL[t]} · ${num(r.capacity_kw, 0)} ${t === "solar" ? "kWp" : "kW"}`,
        value: energy(r.totals.energy_kwh),
        sub: `Capacity factor <b>${pct(r.totals.capacity_factor_pct, 1)}</b> · ${energy(r.totals.average_per_day_kwh)}/day<br>Peak <b>${num(r.totals.peak_kw, 0)} kW</b>${r.totals.peak_time_local ? ` at ${esc(localTime(r.totals.peak_time_local).slice(5))}` : ""}`,
      });
    }),
  ];
  if (p.results.hybrid?.export_limit_kw) {
    stats.push(statCard({ tone: "warn", iconName: "gauge", label: "Curtailed by export limit", value: energy(p.results.hybrid.totals.curtailed_kwh),
      sub: `Limit <b>${num(p.results.hybrid.export_limit_kw, 0)} kW</b>` }));
  }

  const maxDay = Math.max(...daily.map((d) => d[`${headline}_kwh`]), 1e-9);
  const bestDate = p.summary.best_day.date;
  const showWind = "wind" in p.results;
  const rows = daily.map((d) => `<tr>
      <td><b>${esc(d.weekday.slice(0, 3))}</b> ${esc(d.date.slice(5))}${d.partial_day ? ` ${badge(`${d.hours} h`, "neutral")}` : ""}${d.date === bestDate && fullDays.length > 1 ? ` ${badge("best", "success")}` : ""}</td>
      ${gen.map((t) => `<td class="num">${energy(d[`${t}_kwh`])}</td>`).join("")}
      <td class="num"><div class="bar-cell"><b>${energy(d[`${headline}_kwh`])}</b><span class="bar"><i class="${headline}" style="width:${(100 * d[`${headline}_kwh`] / maxDay).toFixed(1)}%"></i></span></div></td>
      <td class="num">${num(d.irradiation_kwh_m2, 2)}</td>
      ${showWind ? `<td class="num">${num(d.mean_hub_wind_ms, 1)}</td>` : ""}
      <td class="num">${num(d.mean_temp_c, 0)}° / ${num(d.max_temp_c, 0)}°</td></tr>`).join("");

  root.classList.toggle("is-demo", !!p.is_demo);
  root.innerHTML = `
    ${demoBanner(p, "DEMO MODE — synthetic forecast, not real weather. Do not use these numbers for any decision.")}
    <section class="run-banner">
      <div class="run-banner-main">
        <h2>${esc(p.label)} ${modeBadge(p)} ${badge(`model ${fp.model}`, "neutral")}</h2>
        <p>${esc(localTime(fp.start_local))} → ${esc(localTime(fp.end_local))} local time · ${fp.hours} hours · ${esc(p.source.name)}${p.fetched_by === "browser" ? " · fetched by your browser" : ""}</p>
        <div class="meta">${siteMeta(p)}</div>
      </div>
      <div class="run-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-act="save">${icon("bookmark-plus", { size: 15 })}<span>Save</span></button>
        <div><button class="btn btn-secondary btn-sm" type="button" data-act="export">${icon("download", { size: 15 })}<span>Export</span>${icon("chevron-down", { size: 14 })}</button></div>
      </div>
    </section>
    <div class="stat-grid">${stats.join("")}</div>
    <section class="panel">
      <div class="panel-head">
        <div><h3>${icon("chart-column", { size: 15 })} Generation</h3><p class="panel-sub" id="fc-chart-sub">Energy per day · * partial day</p></div>
        <div class="chart-controls">
          <div class="chart-legend">${gen.map((t) => `<span><i class="legend-swatch" style="background:${charts.techColor(t)}"></i>${TECH_LABEL[t]}</span>`).join("")}${p.results.hybrid ? `<span><i class="legend-swatch" style="background:${charts.techColor("hybrid")}"></i>Combined</span>` : ""}</div>
          <div class="chart-tabs" role="tablist" aria-label="Chart view">
            <button role="tab" aria-selected="true" data-chart="daily">Daily</button>
            <button role="tab" aria-selected="false" data-chart="hourly">Hourly</button>
          </div>
        </div>
      </div>
      <div class="chart-box"><canvas id="c-fc" aria-label="Forecast generation chart" role="img"></canvas></div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h3>${icon("calendar-range", { size: 15 })} Day by day</h3><p class="panel-sub">Energy, sunlight, wind and temperature for each local day</p></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Day</th>${gen.map((t) => `<th scope="col" class="num">${TECH_LABEL[t]}</th>`).join("")}<th scope="col" class="num">${techs.length > 1 ? "Combined" : "Total"}</th>
          <th scope="col" class="num">Sunlight<span class="unit">kWh/m²</span></th>${showWind ? '<th scope="col" class="num">Hub wind<span class="unit">m/s</span></th>' : ""}<th scope="col" class="num">Temp<span class="unit">avg / max</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>
    ${notesPanel(p)}
    ${detailsAccordion(p)}`;

  const canvas = $("#c-fc", root);
  const drawChart = (kind) => {
    $$(".chart-tabs button", root).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.chart === kind)));
    $("#fc-chart-sub", root).textContent = kind === "daily" ? "Energy per day · * partial day" : "Hour-mean power output, local time";
    if (kind === "daily") charts.forecastDailyChart("fc-chart", canvas, p);
    else charts.forecastChart("fc-chart", canvas, p);
  };
  $$(".chart-tabs button", root).forEach((b) => b.addEventListener("click", () => drawChart(b.dataset.chart)));
  drawChart("daily");
  const req = state.last.forecast.request;
  wireSaveButton($('[data-act="save"]', root), "forecast");
  wireExportMenu($('[data-act="export"]', root), [
    { label: "HTML report", icon: "file-text", run: () => api.forecastReport(req, p) },
    { label: "Print / save as PDF", icon: "printer", print: true },
    { separator: true },
    { label: "Hourly CSV", icon: "file-spreadsheet", run: () => api.forecastExport(req, p) },
  ]);
}

function $$(sel, root) {
  return [...root.querySelectorAll(sel)];
}
