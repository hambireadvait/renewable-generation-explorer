// Saved scenarios live in this browser only (localStorage). Each stores the request and key outputs.

const KEY = "rfe.scenarios.v2";

export function loadScenarios() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // private mode / storage full — scenarios then last for this page only
  }
}

let memory = null;

export function allScenarios() {
  if (memory === null) memory = loadScenarios();
  return memory;
}

export function summarise(payload) {
  const forecast = payload.use_case === "near_term_forecast";
  const tech = {};
  for (const [t, r] of Object.entries(payload.results)) {
    tech[t] = forecast
      ? { capacity_kw: r.capacity_kw, energy_kwh: r.totals.energy_kwh, cf_pct: r.totals.capacity_factor_pct,
          per_day_kwh: r.totals.average_per_day_kwh }
      : { capacity_kw: r.capacity_kw, energy_kwh: r.summary.annual_mean_kwh, cf_pct: r.summary.capacity_factor_pct,
          per_day_kwh: r.summary.annual_mean_kwh / 365.25 };
  }
  const fp = payload.forecast_period;
  return {
    kind: forecast ? "forecast" : "long_term",
    site: payload.site.requested.label || `${payload.site.requested.latitude}, ${payload.site.requested.longitude}`,
    source: payload.source.name,
    period: forecast
      ? `${fp.start_local.slice(0, 16).replace("T", " ")} → ${fp.end_local.slice(0, 16).replace("T", " ")}`
      : `${payload.period.start_year}–${payload.period.end_year} average year`,
    energy_label: forecast ? "Forecast period total" : "Mean annual",
    is_demo: payload.is_demo,
    tech,
  };
}

export function addScenario(name, request, payload) {
  const list = allScenarios();
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, saved_at: new Date().toISOString(), request, summary: summarise(payload) };
  list.push(item);
  const ok = persist(list);
  return { item, persisted: ok };
}

export function removeScenario(id) {
  memory = allScenarios().filter((s) => s.id !== id);
  persist(memory);
}
