// "Long-term average" page.
import { api } from "../api.js";
import * as charts from "../charts.js";
import { MONTHS, TECH_LABEL, energy, esc, num, pct } from "../format.js";
import { state } from "../state.js";
import { badge, emptyState, errorState, skeletonResults, statCard } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { demoBanner, detailsAccordion, modeBadge, notesPanel, siteMeta, wireExportMenu, wireSaveButton } from "./shared.js";

const $ = (sel, root) => root.querySelector(sel);
const $$ = (sel, root) => [...root.querySelectorAll(sel)];
const TECH_ICON = { solar: "sun", wind: "wind", hybrid: "zap" };

export function renderLongTerm(root, { onRun, onDemo }) {
  charts.destroyAll("lt-");
  root.classList.remove("is-demo");
  const status = state.status.longterm;
  if (status === "loading") {
    const req = state.pending?.longterm;
    const provider = state.providers.historical.find((p) => p.id === req?.provider);
    const n = req ? req.end_year - req.start_year + 1 : 5;
    const note = provider?.is_demo
      ? "Generating synthetic demo data…"
      : `Fetching ${n} year${n > 1 ? "s" : ""} of hourly history from ${provider?.name || "the provider"}. A new location can take 10–40 s; repeat runs use the cache.`;
    root.innerHTML = `<p class="loading-note">${icon("loader-circle", { size: 14, cls: "spin" })} ${esc(note)}</p>${skeletonResults({ stats: 3, charts: 1, table: false })}`;
    return;
  }
  if (status === "error") {
    const { err } = state.error.longterm;
    const provider = err.kind === "provider_error" || err.kind === "network";
    root.innerHTML = errorState({
      title: provider ? "Historical weather could not be retrieved" : "The long-term average could not be run",
      message: err.message,
      issues: err.issues,
      hint: err.hint,
      actions: `<button class="btn btn-secondary btn-sm" data-act="retry">${icon("rotate-ccw", { size: 14 })} Try again</button>
        ${provider ? `<button class="btn btn-ghost btn-sm" data-act="demo">${icon("flask-conical", { size: 14 })} Use demo data instead</button>` : ""}`,
    });
    $('[data-act="retry"]', root).addEventListener("click", onRun);
    $('[data-act="demo"]', root)?.addEventListener("click", onDemo);
    return;
  }
  if (!state.last.longterm) {
    root.innerHTML = emptyState({
      iconName: "history",
      title: "What does this site generate in a typical year?",
      body: "Runs the same solar and wind models over whole past years of historical weather to show typical daily, monthly and yearly generation. It is not a forecast of any particular week.",
      action: `<button class="btn btn-primary" data-act="run">${icon("play", { size: 14 })} Run long-term average</button>`,
    });
    $('[data-act="run"]', root).addEventListener("click", onRun);
    return;
  }
  renderResults(root, state.last.longterm.payload);
}

function renderResults(root, p) {
  const techs = Object.keys(p.results);
  const stats = techs.map((t) => {
    const r = p.results[t];
    const s = r.summary;
    const extra = t === "solar"
      ? `<b>${num(r.metrics.specific_yield_kwh_per_kwp, 0)}</b> kWh/kWp/yr · PR <b>${num(r.metrics.performance_ratio, 2)}</b>`
      : t === "wind"
        ? `Mean wind <b>${num(r.metrics.mean_hub_wind_ms, 2)} m/s</b> at ${num(r.assumptions.hub_height_m, 0)} m`
        : `Curtailed <b>${pct(r.curtailed_fraction_pct, 1)}</b>`;
    return statCard({
      tone: t, iconName: TECH_ICON[t], label: `${TECH_LABEL[t]} · average year`, value: energy(s.annual_mean_kwh),
      sub: `≈ <b>${energy(s.daily_mean_kwh)}</b>/day · <b>${energy(s.annual_mean_kwh / 52.18)}</b>/week · CF <b>${pct(s.capacity_factor_pct, 1)}</b><br>${extra}<br>Range ${energy(s.interannual.min_kwh)} – ${energy(s.interannual.max_kwh)} over ${s.interannual.n_years} y`,
    });
  });
  const tabs = [
    ["monthly", "Monthly"], ["years", "By year"], ["daily", "Daily"], ["diurnal", "Average day"],
    ...(p.results.wind ? [["hist", "Wind distribution"]] : []),
  ];
  root.classList.toggle("is-demo", !!p.is_demo);
  root.innerHTML = `
    ${demoBanner(p)}
    <section class="run-banner longterm">
      <div class="run-banner-main">
        <h2>${esc(p.label)} ${modeBadge(p)} ${badge(`${p.period.start_year}–${p.period.end_year}`, "cyan")}</h2>
        <p>${p.period.n_years} complete years of hourly ${esc(p.source.name)} data · ${esc(p.source.resolution)} grid</p>
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
        <div><h3>${icon("chart-column", { size: 15 })} Generation profile</h3><p class="panel-sub" id="lt-chart-sub"></p></div>
        <div class="chart-controls">
          <div class="select-wrap compact" id="lt-sub-tech" hidden><select aria-label="Technology">${techs.map((t) => `<option value="${t}">${TECH_LABEL[t]}</option>`).join("")}</select>${icon("chevron-down", { size: 14, cls: "select-chevron" })}</div>
          <div class="select-wrap compact" id="lt-sub-month" hidden><select aria-label="Month">${MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join("")}</select>${icon("chevron-down", { size: 14, cls: "select-chevron" })}</div>
          <div class="chart-tabs" role="tablist" aria-label="Chart view">${tabs.map(([k, l], i) => `<button role="tab" aria-selected="${i === 0}" data-chart="${k}">${l}</button>`).join("")}</div>
        </div>
      </div>
      <div class="chart-legend" style="margin-bottom:10px">${techs.map((t) => `<span><i class="legend-swatch" style="background:${charts.techColor(t)}"></i>${TECH_LABEL[t]}</span>`).join("")}</div>
      <div class="chart-box"><canvas id="c-lt" role="img" aria-label="Long-term generation chart"></canvas></div>
    </section>
    ${notesPanel(p)}
    ${detailsAccordion(p)}`;

  const canvas = $("#c-lt", root);
  const techSel = $("#lt-sub-tech select", root);
  const monthSel = $("#lt-sub-month select", root);
  monthSel.value = String(new Date().getMonth());
  let current = "monthly";
  const SUB = {
    monthly: "Mean energy per calendar month · hover for the min–max across years",
    years: "Total energy in each historical year — the year-to-year spread",
    daily: "Energy for every day in the period",
    diurnal: "Average output by hour of day for the selected month (local time)",
    hist: `Hours per year in each hub-height wind-speed bin · Weibull k ${num(p.results.wind?.metrics.weibull_k, 2)}, c ${num(p.results.wind?.metrics.weibull_c_ms, 2)} m/s`,
  };
  const draw = (kind) => {
    current = kind;
    $$(".chart-tabs button", root).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.chart === kind)));
    $("#lt-sub-tech", root).hidden = kind !== "daily";
    $("#lt-sub-month", root).hidden = kind !== "diurnal";
    $("#lt-chart-sub", root).textContent = SUB[kind];
    if (kind === "monthly") charts.monthlyChart("lt-chart", canvas, p.results);
    else if (kind === "years") charts.perYearChart("lt-chart", canvas, p.results);
    else if (kind === "daily") charts.dailyChart("lt-chart", canvas, p.results, techSel.value);
    else if (kind === "diurnal") charts.diurnalChart("lt-chart", canvas, p.results, Number(monthSel.value));
    else charts.histogramChart("lt-chart", canvas, p.results.wind);
  };
  $$(".chart-tabs button", root).forEach((b) => b.addEventListener("click", () => draw(b.dataset.chart)));
  techSel.addEventListener("change", () => draw(current));
  monthSel.addEventListener("change", () => draw(current));
  draw("monthly");

  const req = state.last.longterm.request;
  wireSaveButton($('[data-act="save"]', root), "longterm");
  wireExportMenu($('[data-act="export"]', root), [
    { label: "HTML report", icon: "file-text", run: () => api.report(req) },
    { label: "Print / save as PDF", icon: "printer", print: true },
    { separator: true },
    { label: "Monthly CSV", icon: "file-spreadsheet", run: () => api.exportKind("monthly", req) },
    { label: "Daily CSV", icon: "file-spreadsheet", run: () => api.exportKind("daily", req) },
    { label: "Hourly CSV", icon: "file-spreadsheet", run: () => api.exportKind("hourly", req) },
    { label: "JSON (full result)", icon: "file-json", run: () => api.exportKind("json", req) },
  ]);
}
