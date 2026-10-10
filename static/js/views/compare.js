// "Compare" page: scenarios saved in this browser.
import { TECH_LABEL, energy, esc, num, pct } from "../format.js";
import { allScenarios, removeScenario } from "../scenarios.js";
import { badge, emptyState } from "../ui/components.js";
import { confirmDialog } from "../ui/dialog.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";

export function renderCompare(root, { onLoad }) {
  const list = allScenarios();
  document.getElementById("scenario-count").textContent = list.length;
  if (!list.length) {
    root.innerHTML = emptyState({
      iconName: "git-compare-arrows",
      title: "No saved scenarios yet",
      body: "Run a forecast or a long-term average and press <b>Save</b> to compare different sites, capacities, tilts or hub heights side by side. Scenarios are kept in this browser only.",
      action: `<a class="btn btn-primary" href="#/forecast">${icon("calendar-range", { size: 14 })} Go to forecast</a>`,
    });
    return;
  }
  const rows = list.flatMap((s) => {
    const entries = Object.entries(s.summary.tech);
    const maxE = Math.max(...entries.map(([, v]) => v.energy_kwh || 0), 1e-9);
    return entries.map(([t, v], i) => `<tr>
      ${i === 0 ? `<td rowspan="${entries.length}" style="white-space:normal;min-width:220px;vertical-align:top">
          <div class="scenario-name">${esc(s.name)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">${badge(s.summary.kind === "forecast" ? "Forecast" : "Long-term", s.summary.kind === "forecast" ? "accent" : "cyan")}${s.summary.is_demo ? badge("Demo data", "danger", "flask-conical") : ""}</div>
          <span class="sub">${esc(s.summary.site)}</span><span class="sub">${esc(s.summary.period)} · ${esc(s.summary.source)}</span>
        </td>` : ""}
      <td>${icon(t === "solar" ? "sun" : t === "wind" ? "wind" : "zap", { size: 14, cls: `tone-${t}` })}</td>
      <td>${TECH_LABEL[t]}</td>
      <td class="num">${num(v.capacity_kw, 0)} kW</td>
      <td class="num"><div class="bar-cell"><b>${energy(v.energy_kwh)}</b><span class="bar"><i class="${t}" style="width:${(100 * v.energy_kwh / maxE).toFixed(1)}%"></i></span></div><span class="sub">${esc(s.summary.energy_label)}</span></td>
      <td class="num">${energy(v.per_day_kwh)}</td>
      <td class="num">${pct(v.cf_pct, 1)}</td>
      ${i === 0 ? `<td rowspan="${entries.length}" style="vertical-align:top"><div class="row-actions">
          <button class="btn btn-ghost btn-xs" data-load="${s.id}" title="Load inputs and re-run">${icon("rotate-ccw", { size: 13 })} Re-run</button>
          <button class="icon-btn" data-del="${s.id}" aria-label="Delete ${esc(s.name)}" title="Delete">${icon("trash-2", { size: 15 })}</button>
        </div></td>` : ""}
    </tr>`);
  }).join("");
  root.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div><h3>${icon("git-compare-arrows", { size: 15 })} Saved scenarios ${badge(String(list.length), "neutral")}</h3>
          <p class="panel-sub">Forecast totals cover each scenario's own forecast window; long-term values are an average year. Stored in this browser only.</p></div>
        <button class="btn btn-ghost btn-sm" data-act="clear">${icon("trash-2", { size: 14 })} Clear all</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Scenario</th><th scope="col"><span class="sr-only">Icon</span></th><th scope="col">Technology</th><th scope="col" class="num">Capacity</th><th scope="col" class="num">Energy</th><th scope="col" class="num">Per day</th><th scope="col" class="num">CF</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
  root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    const s = allScenarios().find((x) => x.id === b.dataset.del);
    const ok = await confirmDialog({ title: "Delete scenario?", message: `“${s.name}” will be removed from this browser. This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    removeScenario(s.id);
    toast({ type: "success", title: "Scenario deleted", message: s.name });
    renderCompare(root, { onLoad });
  }));
  root.querySelectorAll("[data-load]").forEach((b) => b.addEventListener("click", () => {
    const s = allScenarios().find((x) => x.id === b.dataset.load);
    if (s) onLoad(s);
  }));
  root.querySelector('[data-act="clear"]').addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Clear all scenarios?", message: `All ${list.length} saved scenarios will be removed from this browser.`, confirmLabel: "Clear all", danger: true });
    if (!ok) return;
    allScenarios().map((s) => s.id).forEach(removeScenario);
    toast({ type: "success", title: "All scenarios cleared" });
    renderCompare(root, { onLoad });
  });
}
