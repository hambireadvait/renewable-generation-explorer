// Landing page: live preview from a real forecast call, data sources from the server, scroll reveal.
import { api } from "./api.js";
import { energy, esc, num } from "./format.js";
import { state } from "./state.js";
import { badge } from "./ui/components.js";
import { icon } from "./ui/icons.js";

let previewLoaded = false;
let revealObserver = null;

export function initLanding() {
  setupReveal();
}

export function showLanding() {
  renderSources();
  if (!previewLoaded) loadPreview();
  checkReveal();
}

// Reveal-on-scroll. Elements are only hidden once this runs (html.js-reveal), and a plain geometry
// check backs up IntersectionObserver, so content can never get stuck invisible.
function setupReveal() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.documentElement.classList.add("js-reveal");
  if ("IntersectionObserver" in window) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.isIntersecting && show(e.target));
    }, { rootMargin: "0px 0px -6% 0px" });
    document.querySelectorAll("#view-landing .reveal").forEach((el) => revealObserver.observe(el));
  }
  addEventListener("scroll", checkReveal, { passive: true });
  addEventListener("resize", checkReveal, { passive: true });
  document.addEventListener("visibilitychange", checkReveal);
}

function show(el) {
  el.classList.add("visible");
  revealObserver?.unobserve(el);
}

function checkReveal() {
  if (document.getElementById("view-landing").hidden) return;
  const limit = innerHeight * 0.96;
  document.querySelectorAll("#view-landing .reveal:not(.visible)").forEach((el) => {
    if (el.getBoundingClientRect().top < limit) show(el);
  });
}

function previewRequest() {
  const d = state.defaults;
  return {
    location: { latitude: 26.9176, longitude: 70.9039, label: "Jaisalmer, Rajasthan, India" },
    provider: "open_meteo_forecast",
    days: 7,
    solar: { capacity_kwp: d?.solar.capacity_kwp ?? 1000 },
    wind: { turbine_rated_kw: d?.wind.turbine_rated_kw ?? 3000, hub_height_m: d?.wind.hub_height_m ?? 120 },
  };
}

async function loadPreview() {
  previewLoaded = true;
  const card = document.getElementById("hero-preview");
  const badgeEl = document.getElementById("hero-preview-badge");
  const body = card.querySelector(".preview-body");
  try {
    const req = previewRequest();
    const p = await api.forecast(req);
    const days = p.daily;
    const max = Math.max(...days.map((d) => d.solar_kwh + d.wind_kwh), 1e-9);
    const solar = p.results.solar.totals.energy_kwh;
    const wind = p.results.wind.totals.energy_kwh;
    badgeEl.outerHTML = p.is_demo ? badge("Demo data", "danger", "flask-conical") : badge("Live", "success", "activity");
    body.innerHTML = `
      <div class="preview-total">${energy(p.summary.total_kwh)}<small>forecast</small></div>
      <div class="preview-split">
        <span><i class="legend-swatch" style="background:var(--solar)"></i>Solar ${energy(solar)} · ${num(req.solar.capacity_kwp / 1000, 1)} MWp</span>
        <span><i class="legend-swatch" style="background:var(--cyan)"></i>Wind ${energy(wind)} · ${num(req.wind.turbine_rated_kw / 1000, 1)} MW at ${num(req.wind.hub_height_m, 0)} m</span>
      </div>
      <div class="preview-bars" role="img" aria-label="Forecast energy per day for the next 7 days">
        ${days.map((d, i) => `<div><div class="pbar" title="${esc(d.weekday)} ${esc(d.date)}: ${energy(d.solar_kwh + d.wind_kwh)}">
          <span class="pbar-seg wind" style="height:${(100 * d.wind_kwh / max).toFixed(1)}%;--d:${i * 50}ms"></span>
          <span class="pbar-seg solar" style="height:${(100 * d.solar_kwh / max).toFixed(1)}%;--d:${i * 50 + 25}ms"></span>
        </div><div class="pbar-label">${esc(d.weekday.slice(0, 2))}${d.partial_day ? "*" : ""}</div></div>`).join("")}
      </div>
      <div class="preview-foot">
        <span>${icon("cloud-sun", { size: 12 })} ${esc(p.source.name)} · model ${esc(p.forecast_period.model)} · retrieved ${esc(p.source.retrieved_at.slice(11, 16))} UTC</span>
        <a href="#/forecast" class="tone-accent">Open in app →</a>
      </div>`;
  } catch (err) {
    badgeEl.outerHTML = badge("Unavailable", "neutral");
    body.innerHTML = `<p class="muted" style="padding:24px 0">The live preview could not be loaded (${esc(err.message)}). The app itself can still run in clearly labelled demo mode.</p>
      <a href="#/forecast" class="btn btn-secondary btn-sm">Open the app ${icon("arrow-right", { size: 14 })}</a>`;
  }
}

function renderSources() {
  const P = state.providers;
  const el = document.getElementById("landing-sources");
  if (!P) {
    el.innerHTML = '<p class="muted">Source information is unavailable — the server could not be reached.</p>';
    return;
  }
  const list = [...P.forecast, ...P.historical].filter((p) => !p.is_demo && p.id !== "demo");
  el.innerHTML = list.map((p) => `<article class="source-tile">
      <h3>${icon(p.role === "forecast" ? "cloud-sun" : "database", { size: 16, cls: p.role === "forecast" ? "tone-accent" : "tone-cyan" })} ${esc(p.name)}</h3>
      <p>${esc(p.dataset)}</p>
      <p class="small" style="color:var(--text-3)">${esc(p.coverage)} · ${esc(p.resolution)}</p>
      <div class="source-meta">${badge(p.role === "forecast" ? "Forecast" : "Historical", p.role === "forecast" ? "accent" : "cyan")}${p.api_key_required ? badge("Key required", "warn") : badge("No key", "success")}${badge(p.cost.split(";")[0], "neutral")}</div>
    </article>`).join("");
}
