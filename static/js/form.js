// Site & system configuration panel: defaults, toggles, place search, map, validation and request building.
import { api } from "./api.js";
import { esc, num } from "./format.js";
import { createMap } from "./map.js";
import { state } from "./state.js";
import { icon } from "./ui/icons.js";
import { toast } from "./ui/toast.js";
import { checkNumber, checkYears, getPath, parsePowerCurve, setPath } from "./validate.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Fields that only apply to the long-term run.
const LONG_TERM_ONLY = new Set(["provider", "start_year", "end_year"]);
const DEFAULT_SITE = { lat: 26.9176, lon: 70.9039, label: "Jaisalmer, Rajasthan, India" };

export function initForm({ onSubmit }) {
  buildLossFields();
  applyDefaults();
  setupProvider();
  setupToggles();
  setupMap();
  setupSearch();
  $$("[data-path]").forEach((el) => el.addEventListener("input", () => el.classList.remove("invalid")));
  $("#form").addEventListener("submit", (e) => {
    e.preventDefault();
    onSubmit();
  });
  setLocation(DEFAULT_SITE.lat, DEFAULT_SITE.lon, DEFAULT_SITE.label);
  setupConfigToggle();
}

// Small screens: the panel collapses to a one-line summary so results are visible without scrolling past the form.
const SMALL = matchMedia("(max-width: 1023px)");
function setupConfigToggle() {
  $("#config-toggle").addEventListener("click", () => setConfigOpen($("#config").classList.contains("collapsed")));
  $("#form").addEventListener("input", updateConfigSummary);
  $("#form").addEventListener("change", updateConfigSummary);
  SMALL.addEventListener("change", (e) => setConfigOpen(!e.matches));
  setConfigOpen(!SMALL.matches);
  updateConfigSummary();
}

export function setConfigOpen(open) {
  $("#config").classList.toggle("collapsed", !open);
  $("#config-toggle").setAttribute("aria-expanded", String(open));
  $("#config-toggle-label").textContent = open ? "Hide" : "Edit";
}

export function updateConfigSummary() {
  const parts = [state.label || `${$("#f-lat").value}, ${$("#f-lon").value}`];
  if ($("#use-solar").checked) parts.push(`${num(Number($("#f-skwp").value) || 0, 0)} kWp solar`);
  if ($("#use-wind").checked) {
    const n = Number($("#f-wn").value) || 1;
    parts.push(`${n > 1 ? `${n} × ` : ""}${num(Number($("#f-wkw").value) || 0, 0)} kW wind`);
  }
  $("#config-summary").textContent = parts.join(" · ");
}

export function forecastDays() {
  return Number($('input[name="forecast-days"]:checked')?.value || 7);
}

function areaKm2(a) {
  return (a.north - a.south) * 111.32 * (a.east - a.west) * 111.32 * Math.cos(((a.north + a.south) / 2) * Math.PI / 180);
}

function buildLossFields() {
  const lossInputs = (tech, losses) =>
    Object.keys(losses)
      .map((k) => `<div class="field"><label class="field-label" for="loss-${tech}-${k}">${esc(k.replace(/_/g, " "))}</label>
        <div class="input-wrap"><input id="loss-${tech}-${k}" data-path="${tech}.losses_pct.${k}" data-type="number" data-min="0" data-max="50" step="0.1" inputmode="decimal"><span class="suffix">%</span></div></div>`)
      .join("");
  $("#solar-losses").innerHTML = lossInputs("solar", state.defaults.solar.losses_pct);
  $("#wind-losses").innerHTML = lossInputs("wind", state.defaults.wind.losses_pct);
  $$("#solar-losses input, #wind-losses input").forEach((el) => el.addEventListener("input", updateLossTotals));
}

export function applyDefaults() {
  const values = { solar: state.defaults.solar, wind: state.defaults.wind };
  $$("[data-path]").forEach((el) => {
    const v = getPath(values, el.dataset.path);
    if (v === undefined) return;
    if (el.dataset.type === "bool") el.checked = !!v;
    else el.value = v === null ? "" : v;
  });
  updateLossTotals();
}

function updateLossTotals() {
  const combine = (sel) => {
    let keep = 1;
    $$(sel).forEach((el) => { keep *= 1 - (Number(el.value) || 0) / 100; });
    return 100 * (1 - keep);
  };
  $("#solar-loss-total").textContent = `· losses ${num(combine("#solar-losses input"), 1)}%`;
  $("#wind-loss-total").textContent = `· losses ${num(combine("#wind-losses input"), 1)}%`;
}

function setupProvider() {
  const sel = $("#provider");
  sel.innerHTML = state.providers.historical
    .map((p) => `<option value="${esc(p.id)}">${esc(p.is_demo ? "Demo — synthetic" : p.name)}</option>`)
    .join("");
  sel.value = state.providers.defaults.historical;
  const refresh = () => {
    const p = state.providers.historical.find((x) => x.id === sel.value);
    const last = state.defaults.period.end_year;
    const first = Math.max(p.min_year, last - 39);
    const opts = [];
    for (let y = last; y >= first; y--) opts.push(`<option>${y}</option>`);
    const s = $("#start-year"), e = $("#end-year");
    const prevS = Number(s.value) || state.defaults.period.start_year;
    const prevE = Number(e.value) || last;
    s.innerHTML = opts.join("");
    e.innerHTML = opts.join("");
    s.value = Math.max(prevS, first);
    e.value = Math.min(prevE, last);
    $("#provider-note").textContent = p.is_demo
      ? "Synthetic data generated by this app — not real. For trying the app offline only."
      : `${p.coverage} · ${p.resolution} · ${p.api_key_required ? "API key required" : "no API key needed"}`;
    document.dispatchEvent(new CustomEvent("mode-change"));
  };
  sel.addEventListener("change", refresh);
  $("#forecast-provider").addEventListener("change", () => document.dispatchEvent(new CustomEvent("mode-change")));
  refresh();
}

function setupToggles() {
  const sync = () => {
    const s = $("#use-solar").checked, w = $("#use-wind").checked;
    $("#solar-fields").disabled = !s;
    $("#wind-fields").disabled = !w;
    $("#hybrid-fields").hidden = !(s && w);
    $("#hybrid-fields .cfg-body").hidden = !$("#use-hybrid").checked;
    const curve = $("#use-curve").checked;
    $("#curve-box").hidden = !curve;
    $("#generic-curve").hidden = curve;
  };
  ["#use-solar", "#use-wind", "#use-hybrid", "#use-curve"].forEach((id) => $(id).addEventListener("change", sync));
  sync();
}

// --------------------------------------------------------------------------- map & location

function setupMap() {
  const drawBtn = $("#draw-area");
  state.map = createMap($("#map"), {
    onPoint: (lat, lon) => {
      clearArea();
      setLocation(lat, lon, null, { pan: false });
    },
    onArea: (area) => {
      state.area = area;
      const lat = +((area.north + area.south) / 2).toFixed(5);
      const lon = +((area.east + area.west) / 2).toFixed(5);
      setLocation(lat, lon, "Selected region", { pan: false, keepArea: true });
      const km2 = areaKm2(area);
      $("#area-info").innerHTML = `${icon("scan", { size: 12 })} Region ≈ <b>${num(km2, km2 < 10 ? 2 : 0)} km²</b> — weather is taken at its centre (${num(lat, 3)}, ${num(lon, 3)}).`;
      $("#clear-area").hidden = false;
      toast({ type: "info", title: "Region selected", message: `≈ ${num(km2, km2 < 10 ? 2 : 0)} km², evaluated at its centre point.`, timeout: 3000 });
    },
    onDrawChange: (on) => {
      drawBtn.setAttribute("aria-pressed", String(on));
      drawBtn.lastChild.textContent = on ? " Drag on map… (Esc)" : " Draw region";
    },
  });
  drawBtn.addEventListener("click", () => (drawBtn.getAttribute("aria-pressed") === "true" ? state.map.stopDraw() : state.map.startDraw()));
  $("#clear-area").addEventListener("click", () => {
    clearArea();
    setLocation(Number($("#f-lat").value), Number($("#f-lon").value), null, { pan: false });
  });
}

export function setLocation(lat, lon, label, { pan = true, keepArea = false } = {}) {
  $("#f-lat").value = lat;
  $("#f-lon").value = lon;
  $("#f-lat").classList.remove("invalid");
  $("#f-lon").classList.remove("invalid");
  state.label = label;
  if (!keepArea) state.area = null;
  state.map.setPoint(lat, lon, { pan });
  $("#place").value = label || "";
  if ($("#config-summary")) updateConfigSummary();
}

export function clearArea() {
  state.area = null;
  state.map.clearArea();
  $("#area-info").textContent = "Click the map to set a point, or draw a rectangle for a region (weather is taken at its centre).";
  $("#clear-area").hidden = true;
}

function setupSearch() {
  const input = $("#place");
  const list = $("#place-results");
  let timer = null;
  let ctrl = null;
  let items = [];
  let active = -1;
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const highlight = (i) => {
    active = i;
    $$("li[role=option]", list).forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    if (i >= 0) input.setAttribute("aria-activedescendant", `place-opt-${i}`);
  };
  const choose = (r) => {
    clearArea();
    setLocation(r.latitude, r.longitude, r.label);
    close();
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      list.innerHTML = `<li class="note-row">${icon("loader-circle", { size: 13, cls: "spin" })} Searching…</li>`;
      try {
        const res = await api.geocode(q, ctrl.signal);
        items = res.results;
        active = -1;
        const note = res.note ? `<li class="note-row">${icon("info", { size: 12 })} ${esc(res.note)}</li>` : "";
        list.innerHTML = items.length
          ? note + items.map((r, i) => `<li role="option" id="place-opt-${i}" data-i="${i}" aria-selected="false"><span>${esc(r.label)}</span><span class="coords">${num(r.latitude, 2)}, ${num(r.longitude, 2)}</span></li>`).join("") +
            `<li class="note-row">${esc(res.attribution)}</li>`
          : note || '<li class="note-row">No places found. Try another spelling or enter coordinates.</li>';
      } catch (err) {
        if (err.name === "AbortError") return;
        list.innerHTML = `<li class="note-row">Search failed: ${esc(err.message)}</li>`;
      }
    }, 280);
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) {
      e.preventDefault();
      choose(items[Number(li.dataset.i)]);
    }
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden || !items.length) {
      if (e.key === "Enter") e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(Math.min(active + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[Math.max(active, 0)]); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
  ["#f-lat", "#f-lon"].forEach((id) =>
    $(id).addEventListener("change", () => {
      const lat = Number($("#f-lat").value);
      const lon = Number($("#f-lon").value);
      clearArea();
      state.label = null;
      $("#place").value = "";
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) state.map.setPoint(lat, lon);
    }),
  );
}

// --------------------------------------------------------------------------- request building

function sectionEnabled(path) {
  const s = $("#use-solar").checked, w = $("#use-wind").checked;
  if (path.startsWith("solar.") && !s) return false;
  if (path.startsWith("wind.") && !w) return false;
  if (path.startsWith("hybrid.") && !(s && w && $("#use-hybrid").checked)) return false;
  if ($("#use-curve").checked && /^wind\.(cut_in_ms|rated_speed_ms|cut_out_ms)$/.test(path)) return false;
  return true;
}

function labelFor(el) {
  return el.closest(".field")?.querySelector(".field-label")?.childNodes[0]?.textContent.trim() || el.getAttribute("aria-label") || el.dataset.path;
}

// kind: "forecast" | "longterm". Returns { req, errors } and marks invalid fields.
export function collectRequest(kind) {
  const req = {};
  const errors = [];
  $$("[data-path]").forEach((el) => el.classList.remove("invalid"));
  $$("[data-error-for]").forEach((el) => (el.textContent = ""));
  for (const el of $$("[data-path]")) {
    const path = el.dataset.path;
    if (!sectionEnabled(path)) continue;
    if (kind === "forecast" && LONG_TERM_ONLY.has(path)) continue;
    const type = el.dataset.type;
    if (type === "bool") {
      setPath(req, path, el.checked);
      continue;
    }
    const raw = el.value.trim();
    if (type === "text") {
      if (raw) setPath(req, path, raw);
      continue;
    }
    const msg = checkNumber(raw, {
      min: el.dataset.min !== undefined ? Number(el.dataset.min) : undefined,
      max: el.dataset.max !== undefined ? Number(el.dataset.max) : undefined,
      exclusiveMin: el.dataset.xmin !== undefined ? Number(el.dataset.xmin) : undefined,
      integer: type === "int",
      required: el.required,
    });
    if (msg) {
      el.classList.add("invalid");
      errors.push(`${labelFor(el)}: ${msg}`);
      continue;
    }
    if (raw !== "") setPath(req, path, Number(raw));
  }
  if (!$("#use-solar").checked && !$("#use-wind").checked) errors.push("Turn on solar and/or wind.");
  if ($("#use-wind").checked && $("#use-curve").checked) {
    const { points, errors: ce } = parsePowerCurve($("#power-curve").value);
    if (ce.length || points.length === 0) {
      $("#power-curve").classList.add("invalid");
      $('[data-error-for="wind.power_curve"]').textContent = ce.join("; ") || "Enter the power curve";
      errors.push("Power curve: " + (ce[0] || "missing"));
    } else req.wind.power_curve = points;
  }
  if (state.area) req.location.area = state.area;
  if (state.label) req.location.label = state.label;
  if ($("#use-solar").checked && $("#use-wind").checked) req.hybrid = { ...(req.hybrid || {}), enabled: $("#use-hybrid").checked };
  if (kind === "forecast") {
    req.days = forecastDays();
    req.provider = $("#forecast-provider").value;
  } else {
    const p = state.providers.historical.find((x) => x.id === req.provider);
    const ym = checkYears(req.start_year, req.end_year, p.min_year, state.defaults.period.end_year);
    if (ym) {
      $('[data-error-for="years"]').textContent = ym;
      errors.push(ym);
    }
    req.include_daily = true;
  }
  $("#form-error").textContent = errors.length ? `${errors.length} input${errors.length > 1 ? "s" : ""} to fix: ${errors.slice(0, 2).join(" · ")}${errors.length > 2 ? " …" : ""}` : "";
  if (errors.length) {
    if (SMALL.matches) setConfigOpen(true);
    $(".invalid")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  return { req, errors };
}

export function markServerIssues(issues) {
  for (const i of issues || []) $(`[data-path="${i.field}"]`)?.classList.add("invalid");
}

// Restore a saved request into the form (used by Compare → "Load & re-run").
export function loadRequestIntoForm(req, kind) {
  applyDefaults();
  $("#use-solar").checked = !!req.solar;
  $("#use-wind").checked = !!req.wind;
  $("#use-hybrid").checked = req.hybrid ? req.hybrid.enabled !== false : true;
  $("#use-curve").checked = !!req.wind?.power_curve;
  $("#power-curve").value = req.wind?.power_curve ? req.wind.power_curve.map((p) => p.join(", ")).join("\n") : "";
  if (kind === "forecast") {
    const radio = $(`input[name="forecast-days"][value="${req.days}"]`) || $('input[name="forecast-days"][value="7"]');
    radio.checked = true;
    $("#forecast-provider").value = req.provider;
  } else {
    $("#provider").value = req.provider;
    $("#provider").dispatchEvent(new Event("change"));
  }
  $$("[data-path]").forEach((el) => {
    const v = getPath(req, el.dataset.path);
    if (v === undefined) return;
    if (el.dataset.type === "bool") el.checked = !!v;
    else el.value = v === null ? "" : v;
  });
  ["#use-solar", "#use-wind", "#use-hybrid", "#use-curve"].forEach((id) => $(id).dispatchEvent(new Event("change")));
  updateLossTotals();
  if (req.location.area) {
    state.area = req.location.area;
    state.map.setArea(req.location.area);
    $("#clear-area").hidden = false;
  } else clearArea();
  state.label = req.location.label || null;
  $("#place").value = state.label || "";
  state.map.setPoint(req.location.latitude, req.location.longitude, { pan: !req.location.area });
  document.dispatchEvent(new CustomEvent("mode-change"));
}

export function isDemoSelected(kind) {
  return kind === "longterm" ? $("#provider").value === "demo" : $("#forecast-provider").value === "demo";
}
