// Pieces shared by the forecast and long-term result views.
import { saveBlob } from "../api.js";
import { TECH_LABEL, esc, num } from "../format.js";
import { addScenario, allScenarios } from "../scenarios.js";
import { state } from "../state.js";
import { badge } from "../ui/components.js";
import { promptDialog } from "../ui/dialog.js";
import { icon } from "../ui/icons.js";
import { attachMenu } from "../ui/menu.js";
import { toast } from "../ui/toast.js";

export const localTime = (iso) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");

export function demoBanner(p, text = "DEMO MODE — synthetic data, not real measurements or forecasts. Do not use these numbers for any decision.") {
  return p.is_demo ? `<div class="demo-banner" role="note">${icon("flask-conical", { size: 16 })}<span>${esc(text)}</span></div>` : "";
}

export function siteMeta(p) {
  const s = p.site;
  const loc = s.requested.label || `${num(s.requested.latitude, 4)}, ${num(s.requested.longitude, 4)}`;
  const parts = [
    `<span>${icon("map-pin", { size: 12 })}${esc(loc)}</span>`,
    p.area ? `<span>${icon("scan", { size: 12 })}region ≈${num(p.area.approx_area_km2, 0)} km² · centre point</span>` : "",
    `<span>${icon("crosshair", { size: 12 })}grid ${num(s.data_grid_point.latitude, 3)}, ${num(s.data_grid_point.longitude, 3)}</span>`,
    `<span>${icon("globe", { size: 12 })}${esc(s.timezone)}</span>`,
    `<span>${icon("clock", { size: 12 })}retrieved ${esc(localTime(p.source.retrieved_at))} UTC${p.source.from_cache ? " · cached" : ""}</span>`,
  ];
  return parts.filter(Boolean).join("");
}

export function modeBadge(p) {
  return p.is_demo ? badge("Demo data", "danger", "flask-conical") : badge("Live data", "success", "activity");
}

// Classify a warning for its icon.
function noteClass(w) {
  if (w.startsWith("DEMO")) return "demo";
  if (/defaulted|Area selected|not a typical week|centroid/i.test(w)) return "info";
  return "";
}

export function notesPanel(p) {
  const notes = p.warnings.map((w) => {
    const cls = noteClass(w);
    const ic = cls === "demo" ? "flask-conical" : cls === "info" ? "info" : "triangle-alert";
    return `<li class="${cls}">${icon(ic, { size: 14 })}<span>${esc(w)}</span></li>`;
  });
  return `<section class="panel">
    <div class="panel-head"><h3>${icon("triangle-alert", { size: 15, cls: "tone-solar" })} Notes &amp; limitations</h3>${badge(`${p.warnings.length}`, "neutral")}</div>
    <ul class="notes">${notes.join("")}</ul>
    <p class="attribution"><b>Not assessed:</b> ${esc(p.not_assessed.join(", "))}.</p>
  </section>`;
}

function fmtValue(v) {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length > 12 ? `${v.length} points` : v.map(fmtValue).join(", ");
  if (typeof v === "object") return Object.entries(v).map(([k, x]) => `${k.replace(/_/g, " ")}: ${fmtValue(x)}`).join(" · ");
  return String(v);
}

export function detailsAccordion(p) {
  const techBlocks = Object.entries(p.results).map(([t, r]) => {
    const a = r.assumptions || { method: r.method, export_limit_kw: r.export_limit_kw, hourly_correlation_solar_wind: r.hourly_correlation_solar_wind };
    const metrics = r.metrics ? Object.entries(r.metrics).filter(([, v]) => typeof v !== "object" || v === null) : [];
    const rows = [...Object.entries(a), ...metrics].filter(([k]) => k !== "power_curve_points");
    return `<details>
      <summary>${icon(t === "solar" ? "sun" : t === "wind" ? "wind" : "zap", { size: 15, cls: `tone-${t}` })} ${TECH_LABEL[t]} — assumptions${metrics.length ? " &amp; metrics" : ""}${icon("chevron-down", { size: 15, cls: "chev" })}</summary>
      <div class="acc-body"><div class="table-wrap"><table class="kv"><tbody>
        ${rows.map(([k, v]) => `<tr><th scope="row">${esc(k.replace(/_/g, " "))}</th><td>${esc(fmtValue(v))}</td></tr>`).join("")}
      </tbody></table></div></div>
    </details>`;
  });
  const s = p.source;
  return `<div class="accordion">
    ${techBlocks.join("")}
    <details>
      <summary>${icon("database", { size: 15 })} Data source &amp; attribution${icon("chevron-down", { size: 15, cls: "chev" })}</summary>
      <div class="acc-body">
        <dl class="source-dl">
          <dt>Provider</dt><dd>${esc(s.name)}</dd>
          <dt>Dataset</dt><dd>${esc(s.dataset)}</dd>
          <dt>Resolution</dt><dd>${esc(s.resolution)}</dd>
          <dt>Retrieved</dt><dd>${esc(s.retrieved_at)}${s.from_cache ? " (served from local cache)" : ""}</dd>
          <dt>Licence</dt><dd>${esc(s.license)}</dd>
          <dt>Request</dt><dd class="mono">${esc(s.request_url)}</dd>
          <dt>Models</dt><dd>pvlib ${esc(p.model_versions.pvlib)} · app v${esc(p.app_version)}</dd>
        </dl>
        <p class="attribution">${esc(s.attribution)}</p>
      </div>
    </details>
  </div>`;
}

// Export dropdown: items = [{label, icon, hint, run: () => Promise<{blob, filename}> | "print"}]
export function wireExportMenu(button, items) {
  attachMenu(
    button,
    items.map((it) => ({
      label: it.label,
      icon: it.icon,
      hint: it.hint,
      separator: it.separator,
      onSelect: async () => {
        if (it.print) {
          window.print();
          return;
        }
        const restore = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `${icon("loader-circle", { size: 15, cls: "spin" })}<span>Preparing…</span>`;
        try {
          const file = await it.run();
          saveBlob(file);
          toast({ type: "success", title: "Download ready", message: file.filename });
        } catch (err) {
          toast({ type: "error", title: "Export failed", message: err.message });
        } finally {
          button.disabled = false;
          button.innerHTML = restore;
        }
      },
    })),
  );
}

export function wireSaveButton(button, kind) {
  button.addEventListener("click", async () => {
    const last = state.last[kind];
    if (!last) return;
    const site = last.payload.site.requested.label || "Scenario";
    const when = kind === "forecast" ? `next ${last.request.days} d` : `${last.request.start_year}–${last.request.end_year}`;
    const name = await promptDialog({
      title: "Save to compare",
      message: "Saved scenarios stay in this browser and appear on the Compare page.",
      label: "Scenario name",
      value: `${site} · ${when}`,
    });
    if (name === null) return;
    const { persisted } = addScenario(name, last.request, last.payload);
    document.getElementById("scenario-count").textContent = allScenarios().length;
    toast({
      type: persisted ? "success" : "warning",
      title: persisted ? "Scenario saved" : "Saved for this session only",
      message: persisted ? `“${name}” is on the Compare page.` : "Browser storage is unavailable, so it will be lost on reload.",
    });
  });
}
