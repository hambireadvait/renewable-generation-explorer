// Chart.js wrappers themed from the CSS design tokens.
/* global Chart */
import { MONTHS, TECH_LABEL, num } from "./format.js";

const registry = new Map();
const TECH_VAR = { solar: "--solar", wind: "--cyan", hybrid: "--accent" };
let themed = false;

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function techColor(tech) {
  return css(TECH_VAR[tech] || "--text-2");
}

function alpha(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function theme() {
  if (themed || typeof Chart === "undefined") return;
  themed = true;
  Chart.defaults.font.family = css("--font");
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css("--text-3");
  Chart.defaults.borderColor = alpha(css("--border"), 0.7);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  Chart.defaults.animation = reduce ? false : { duration: 450, easing: "easeOutCubic" };
}

function base(unit) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#1c1c20",
        borderColor: css("--border-2"),
        borderWidth: 1,
        titleColor: css("--text"),
        bodyColor: css("--text-2"),
        footerColor: css("--text"),
        padding: 10,
        cornerRadius: 8,
        boxPadding: 4,
        usePointStyle: true,
        titleFont: { weight: "600" },
        footerFont: { weight: "600" },
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${num(ctx.parsed.y, 2)} ${unit}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: css("--border") }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 12 } },
      y: {
        beginAtZero: true,
        grid: { color: alpha(css("--border"), 0.6) },
        border: { display: false },
        ticks: { padding: 6, callback: (v) => num(v, 1) },
        title: { display: !!unit, text: unit, color: css("--text-3"), font: { size: 11 } },
      },
    },
  };
}

function draw(id, canvas, config) {
  if (!canvas) return;
  if (typeof Chart === "undefined") {
    canvas.replaceWith(Object.assign(document.createElement("p"), { className: "hint", textContent: "Chart library failed to load (offline?). Tables below still show every value." }));
    return;
  }
  theme();
  registry.get(id)?.destroy();
  registry.set(id, new Chart(canvas, config));
}

export function destroyAll(prefix) {
  for (const [id, chart] of registry) {
    if (id.startsWith(prefix)) {
      chart.destroy();
      registry.delete(id);
    }
  }
}

const kUnit = (values) => {
  const max = Math.max(...values.map(Math.abs), 0);
  if (max >= 5e6) return { div: 1e6, unit: "GWh" };
  if (max >= 5e3) return { div: 1e3, unit: "MWh" };
  return { div: 1, unit: "kWh" };
};

const bar = (tech, extra = {}) => ({
  backgroundColor: techColor(tech),
  hoverBackgroundColor: alpha(techColor(tech), 0.85),
  borderRadius: 4,
  borderSkipped: false,
  maxBarThickness: 34,
  ...extra,
});

function areaGradient(canvas, color) {
  const ctx = canvas.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, canvas.parentElement?.clientHeight || 300);
  g.addColorStop(0, alpha(color, 0.28));
  g.addColorStop(1, alpha(color, 0));
  return g;
}

export function monthlyChart(id, canvas, results) {
  const techs = Object.keys(results);
  const all = techs.flatMap((t) => results[t].summary.monthly.map((m) => m.mean_kwh));
  const { div, unit } = kUnit(all);
  const datasets = techs.map((t) => ({
    label: TECH_LABEL[t],
    data: results[t].summary.monthly.map((m) => m.mean_kwh / div),
    minmax: results[t].summary.monthly.map((m) => [m.min_kwh / div, m.max_kwh / div]),
    ...bar(t),
  }));
  const opts = base(unit);
  opts.plugins.tooltip.callbacks.label = (ctx) => {
    const [lo, hi] = ctx.dataset.minmax[ctx.dataIndex];
    return `${ctx.dataset.label}: ${num(ctx.parsed.y, 2)} ${unit}  (range ${num(lo, 2)}–${num(hi, 2)})`;
  };
  draw(id, canvas, { type: "bar", data: { labels: MONTHS, datasets }, options: opts });
}

export function perYearChart(id, canvas, results) {
  const techs = Object.keys(results);
  const years = results[techs[0]].summary.per_year.map((y) => y.year);
  const all = techs.flatMap((t) => results[t].summary.per_year.map((y) => y.kwh));
  const { div, unit } = kUnit(all);
  const datasets = techs.map((t) => ({ label: TECH_LABEL[t], data: results[t].summary.per_year.map((y) => y.kwh / div), ...bar(t) }));
  draw(id, canvas, { type: "bar", data: { labels: years, datasets }, options: base(unit) });
}

export function dailyChart(id, canvas, results, tech) {
  const daily = results[tech].summary.daily || [];
  const vals = daily.map((d) => d.kwh);
  const { div, unit } = kUnit(vals);
  const opts = base(unit);
  opts.scales.x.ticks.maxTicksLimit = 8;
  const color = techColor(tech);
  draw(id, canvas, {
    type: "line",
    data: {
      labels: daily.map((d) => d.date),
      datasets: [{ label: `${TECH_LABEL[tech]} daily energy`, data: vals.map((v) => v / div), borderColor: color, borderWidth: 1.2,
                   pointRadius: 0, fill: true, backgroundColor: areaGradient(canvas, color), tension: 0.15 }],
    },
    options: opts,
  });
}

export function diurnalChart(id, canvas, results, month) {
  const techs = Object.keys(results);
  const datasets = techs.map((t) => ({
    label: TECH_LABEL[t],
    data: results[t].summary.diurnal_profile_kw[month],
    borderColor: techColor(t),
    backgroundColor: techColor(t),
    borderWidth: 2,
    tension: 0.35,
    pointRadius: 0,
    pointHoverRadius: 4,
    borderDash: t === "hybrid" ? [5, 4] : undefined,
  }));
  const opts = base("mean kW");
  draw(id, canvas, { type: "line", data: { labels: [...Array(24).keys()].map((h) => `${String(h).padStart(2, "0")}:00`), datasets }, options: opts });
}

export function histogramChart(id, canvas, wind) {
  const h = wind.metrics.histogram;
  const opts = base("hours / year");
  opts.scales.y2 = {
    position: "right", beginAtZero: true, grid: { display: false }, border: { display: false },
    title: { display: true, text: "MWh / year", color: css("--text-3"), font: { size: 11 } },
  };
  opts.scales.x.title = { display: true, text: "hub-height wind speed (m/s)", color: css("--text-3"), font: { size: 11 } };
  opts.plugins.tooltip.callbacks.label = (ctx) => `${ctx.dataset.label}: ${num(ctx.parsed.y, 1)}`;
  draw(id, canvas, {
    data: {
      labels: h.map((b) => b.bin_ms),
      datasets: [
        { type: "bar", label: "Hours per year", data: h.map((b) => b.hours_per_year), yAxisID: "y", ...bar("wind", { backgroundColor: alpha(techColor("wind"), 0.75) }) },
        { type: "line", label: "Net energy (MWh/yr)", data: h.map((b) => b.net_kwh_per_year / 1000), borderColor: techColor("hybrid"), backgroundColor: techColor("hybrid"), pointRadius: 2.5, borderWidth: 2, tension: 0.3, yAxisID: "y2" },
      ],
    },
    options: opts,
  });
}

export function forecastChart(id, canvas, payload) {
  const rows = payload.hourly;
  const labels = rows.map((r) => {
    const t = r.time_local;
    return `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`;
  });
  const line = (key, label, tech, extra = {}) => ({
    label, data: rows.map((r) => r[key]), borderColor: techColor(tech), pointRadius: 0, pointHoverRadius: 3,
    tension: 0.25, borderWidth: 1.6, fill: true, backgroundColor: areaGradient(canvas, techColor(tech)), ...extra,
  });
  const datasets = [];
  if ("solar_kw" in rows[0]) datasets.push(line("solar_kw", "Solar AC", "solar"));
  if ("wind_kw" in rows[0]) datasets.push(line("wind_kw", "Wind net", "wind"));
  if ("hybrid_kw" in rows[0]) datasets.push(line("hybrid_kw", "Combined export", "hybrid", { borderDash: [5, 4], fill: false, borderWidth: 1.4 }));
  const opts = base("kW");
  opts.scales.x.ticks.maxTicksLimit = 10;
  draw(id, canvas, { type: "line", data: { labels, datasets }, options: opts });
}

export function forecastDailyChart(id, canvas, payload) {
  const days = payload.daily;
  const techs = ["solar", "wind"].filter((t) => t in payload.results);
  const all = days.map((d) => techs.reduce((a, t) => a + d[`${t}_kwh`], 0));
  const { div, unit } = kUnit(all);
  const opts = base(unit);
  opts.scales.x.stacked = true;
  opts.scales.y.stacked = true;
  opts.plugins.tooltip.callbacks.footer = (items) => {
    const total = items.reduce((a, i) => a + i.parsed.y, 0);
    const d = days[items[0].dataIndex];
    return `Total ${num(total, 2)} ${unit}${d.partial_day ? `  · partial day (${d.hours} h)` : ""}`;
  };
  const datasets = techs.map((t, i) => ({
    label: TECH_LABEL[t], data: days.map((d) => d[`${t}_kwh`] / div),
    ...bar(t, { borderRadius: i === techs.length - 1 ? { topLeft: 4, topRight: 4 } : 0, maxBarThickness: 44 }),
  }));
  const labels = days.map((d) => `${d.weekday.slice(0, 3)} ${d.date.slice(8)}${d.partial_day ? "*" : ""}`);
  draw(id, canvas, { type: "bar", data: { labels, datasets }, options: opts });
}
