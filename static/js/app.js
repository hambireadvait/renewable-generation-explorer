// Entry point: boot, hash router, app shell (sidebar / drawer), run orchestration.
import { api } from "./api.js";
import { collectRequest, initForm, isDemoSelected, loadRequestIntoForm, setConfigOpen } from "./form.js";
import { initLanding, showLanding } from "./landing.js";
import { allScenarios } from "./scenarios.js";
import { state } from "./state.js";
import { errorState } from "./ui/components.js";
import { hydrateIcons, icon } from "./ui/icons.js";
import { toast } from "./ui/toast.js";
import { renderCompare } from "./views/compare.js";
import { renderForecast } from "./views/forecast.js";
import { renderLongTerm } from "./views/longterm.js";
import { renderMethod } from "./views/method.js";
import { execute, onRunChange } from "./views/runner.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const ROUTES = {
  "/": { view: "landing", doc: "Renewable Generation Explorer — solar & wind generation forecasts" },
  "/forecast": { view: "app", page: "forecast", config: true, title: "This week's forecast", sub: "How much energy the site will generate, from the latest weather forecast", run: "Run forecast", busy: "Forecasting…" },
  "/long-term": { view: "app", page: "longterm", config: true, title: "Long-term average", sub: "Typical generation from whole years of historical weather", run: "Run long-term average", busy: "Fetching history…" },
  "/compare": { view: "app", page: "compare", config: false, title: "Compare scenarios", sub: "Saved runs from this browser, side by side" },
  "/method": { view: "app", page: "method", config: false, title: "Data & method", sub: "Where the numbers come from — and what they leave out" },
};
const ROUTE_OF_PAGE = { forecast: "/forecast", longterm: "/long-term", compare: "/compare", method: "/method" };

// --------------------------------------------------------------------------- boot

async function boot() {
  hydrateIcons();
  initShell();
  initLanding();
  try {
    const [defaults, providers] = await Promise.all([api.defaults(), api.providers()]);
    state.defaults = defaults;
    state.providers = providers;
  } catch (err) {
    bootFailed(err);
    return;
  }
  initForm({ onSubmit: runCurrent });
  onRunChange(onRunStateChange);
  document.addEventListener("mode-change", updateMode);
  $("#scenario-count").textContent = allScenarios().length;
  window.addEventListener("hashchange", route);
  route();
}

function bootFailed(err) {
  $("#content").innerHTML = `<div style="grid-column:1/-1">${errorState({
    title: "The app server could not be reached",
    message: err.message,
    hint: "Start it with: .venv/bin/python -m uvicorn app.main:app --port 8010",
    actions: `<button class="btn btn-secondary btn-sm" onclick="location.reload()">${icon("rotate-ccw", { size: 14 })} Retry</button>`,
  })}</div>`;
  $("#status-sub").textContent = "Server unreachable";
  $("#status-card .dot").className = "dot off";
  window.addEventListener("hashchange", () => showView(currentRoute()));
  showView(currentRoute());
}

// --------------------------------------------------------------------------- router

function currentRoute() {
  const h = location.hash;
  const path = h.startsWith("#/") ? h.slice(1).replace(/\/$/, "") || "/" : "/";
  return ROUTES[path] ? path : "/";
}

function showView(path) {
  const r = ROUTES[path];
  const wasLanding = !$("#view-landing").hidden;
  $("#view-landing").hidden = r.view !== "landing";
  $("#view-app").hidden = r.view !== "app";
  if ((r.view === "landing") !== wasLanding) window.scrollTo({ top: 0 });
  return r;
}

function route() {
  const path = currentRoute();
  const r = showView(path);
  closeDrawer();
  if (r.view === "landing") {
    state.route = "landing";
    document.title = r.doc;
    showLanding();
    return;
  }
  state.route = r.page;
  document.title = `${r.title} · Renewable Generation Explorer`;
  $("#page-title").textContent = r.title;
  $("#page-sub").textContent = r.sub;
  $$(".side-nav a[data-route]").forEach((a) => (a.dataset.route === r.page ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  $(".workspace").classList.toggle("no-config", !r.config);
  $$(".page").forEach((pg) => (pg.hidden = pg.dataset.page !== r.page));
  updateRunButton();
  updateMode();
  renderPage(r.page);
  // First visit to the forecast page runs the default site immediately, so there is something to look at.
  if (r.page === "forecast" && state.status.forecast === "idle" && !state.last.forecast) runForecast();
}

function renderPage(page) {
  const hooks = (kind) => ({ onRun: kind === "forecast" ? runForecast : runLongTerm, onDemo: () => runDemo(kind) });
  if (page === "forecast") renderForecast($("#fc-results"), hooks("forecast"));
  else if (page === "longterm") renderLongTerm($("#lt-results"), hooks("longterm"));
  else if (page === "compare") renderCompare($("#compare"), { onLoad: loadScenario });
  else if (page === "method") renderMethod($("#sources"));
}

// --------------------------------------------------------------------------- runs

function runCurrent() {
  if (state.route === "longterm") runLongTerm();
  else if (state.route === "forecast") runForecast();
  else location.hash = "#/forecast";
}

function runForecast() {
  const { req, errors } = collectRequest("forecast");
  if (errors.length) return invalidInputs(errors);
  execute("forecast", req, api.forecast);
}

function runLongTerm() {
  const { req, errors } = collectRequest("longterm");
  if (errors.length) return invalidInputs(errors);
  execute("longterm", req, api.assess);
}

function runDemo(kind) {
  const sel = kind === "forecast" ? $("#forecast-provider") : $("#provider");
  sel.value = "demo";
  sel.dispatchEvent(new Event("change"));
  toast({ type: "warning", title: "Switched to demo data", message: "Results are synthetic and labelled as such everywhere." });
  if (kind === "forecast") runForecast();
  else runLongTerm();
}

function invalidInputs(errors) {
  toast({ type: "warning", title: `${errors.length} input${errors.length > 1 ? "s need" : " needs"} attention`, message: errors[0] });
}

function loadScenario(s) {
  loadRequestIntoForm(s.request, s.summary.kind);
  const page = s.summary.kind === "forecast" ? "forecast" : "longterm";
  location.hash = `#${ROUTE_OF_PAGE[page]}`;
  execute(page, s.request, page === "forecast" ? api.forecast : api.assess);
  toast({ type: "info", title: "Scenario loaded", message: `Re-running “${s.name}” with fresh data.` });
}

function onRunStateChange(kind) {
  updateRunButton();
  if (state.route === kind) {
    renderPage(kind);
    // On small screens the results are below the form — bring them into view when a run finishes.
    if (state.status[kind] === "loading" && matchMedia("(max-width: 1023px)").matches) {
      setConfigOpen(false);
      $(kind === "forecast" ? "#fc-results" : "#lt-results").closest(".page").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

function updateRunButton() {
  const r = ROUTES[ROUTE_OF_PAGE[state.route]] || ROUTES["/forecast"];
  const btn = $("#run");
  const busy = state.status[state.route] === "loading";
  btn.disabled = busy;
  btn.setAttribute("aria-busy", String(busy));
  btn.innerHTML = busy
    ? `${icon("loader-circle", { size: 15, cls: "spin" })}<span>${r.busy}</span>`
    : `${icon("play", { size: 15 })}<span>${r.run || "Run forecast"}</span><kbd class="kbd">${IS_MAC ? "⌘" : "Ctrl"} ↵</kbd>`;
}

function updateMode() {
  if (!state.providers) return;
  const kind = state.route === "longterm" ? "longterm" : "forecast";
  const demo = isDemoSelected(kind);
  const sel = kind === "longterm" ? $("#provider") : $("#forecast-provider");
  const card = $("#status-card");
  card.classList.toggle("is-demo", demo);
  $(".dot", card).className = `dot ${demo ? "demo" : "live"}`;
  $(".status-title", card).textContent = demo ? "Demo mode" : "Live data";
  $("#status-sub").textContent = demo ? "Synthetic — not real data" : sel.options[sel.selectedIndex]?.text || "";
  $("#header-actions").innerHTML = demo
    ? `<span class="badge badge-danger">${icon("flask-conical", { size: 12 })}Demo data</span>`
    : `<span class="badge badge-success hide-sm">${icon("activity", { size: 12 })}Live data</span>`;
}

// --------------------------------------------------------------------------- shell: sidebar, drawer, shortcuts

function initShell() {
  const app = $("#view-app");
  try {
    if (localStorage.getItem("rfe.sidebar") === "collapsed") app.classList.add("collapsed");
  } catch { /* storage unavailable */ }
  const collapseBtn = $("#collapse-btn");
  const syncCollapse = () => {
    const c = app.classList.contains("collapsed");
    collapseBtn.setAttribute("aria-label", c ? "Expand sidebar" : "Collapse sidebar");
    collapseBtn.innerHTML = icon(c ? "panel-left-open" : "panel-left-close", { size: 17 });
  };
  collapseBtn.addEventListener("click", () => {
    app.classList.toggle("collapsed");
    try {
      localStorage.setItem("rfe.sidebar", app.classList.contains("collapsed") ? "collapsed" : "expanded");
    } catch { /* ignore */ }
    syncCollapse();
  });
  syncCollapse();

  $("#menu-btn").addEventListener("click", openDrawer);
  $("#sidebar-close").addEventListener("click", closeDrawer);
  $("#drawer-backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && app.classList.contains("nav-open")) closeDrawer();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !$("#view-app").hidden && (state.route === "forecast" || state.route === "longterm")) {
      e.preventDefault();
      runCurrent();
    }
  });
  // Changing the forecast window re-runs immediately — it is a view control, not a model input.
  $$('input[name="forecast-days"]').forEach((r) => r.addEventListener("change", () => state.last.forecast && runForecast()));
}

function openDrawer() {
  const app = $("#view-app");
  app.classList.add("nav-open");
  $("#drawer-backdrop").hidden = false;
  $("#menu-btn").setAttribute("aria-expanded", "true");
  $(".side-nav a")?.focus();
}

function closeDrawer() {
  const app = $("#view-app");
  if (!app.classList.contains("nav-open")) return;
  app.classList.remove("nav-open");
  $("#drawer-backdrop").hidden = true;
  $("#menu-btn").setAttribute("aria-expanded", "false");
  $("#menu-btn").focus();
}

boot();
