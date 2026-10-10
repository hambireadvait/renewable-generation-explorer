// "Data & method" page — rendered from the live provider metadata returned by the server.
import { esc } from "../format.js";
import { state } from "../state.js";
import { badge } from "../ui/components.js";
import { icon } from "../ui/icons.js";

export function renderMethod(root) {
  const P = state.providers;
  const all = [...P.forecast.filter((f) => f.id !== "demo"), ...P.historical];
  const rows = all.map((p) => `<tr>
    <td style="white-space:normal;min-width:180px"><b>${esc(p.name)}</b><span class="sub">${esc(p.role)}</span></td>
    <td style="white-space:normal;min-width:220px">${esc(p.dataset)}</td>
    <td style="white-space:normal;min-width:180px">${esc(p.coverage)}<span class="sub">${esc(p.resolution)}</span></td>
    <td>${p.api_key_required ? badge("Key required", "warn") : badge("No key", "success")}</td>
    <td style="white-space:normal;min-width:200px">${esc(p.rate_limits)}<span class="sub">${esc(p.cost)}</span></td>
    <td style="white-space:normal;min-width:180px">${esc(p.license)}${p.docs_url ? `<span class="sub"><a href="${esc(p.docs_url)}" target="_blank" rel="noopener" class="tone-accent">Documentation ↗</a></span>` : ""}</td>
  </tr>`).join("");
  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><div><h3>${icon("database", { size: 15 })} Data sources</h3><p class="panel-sub">Reported live by the server — the same metadata is attached to every result.</p></div>
        <a class="btn btn-secondary btn-sm" href="/docs" target="_blank" rel="noopener">${icon("braces", { size: 14 })} API docs ${icon("external-link", { size: 12 })}</a></div>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Provider</th><th scope="col">Dataset</th><th scope="col">Coverage</th><th scope="col">Key</th><th scope="col">Limits &amp; cost</th><th scope="col">Licence</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>
    <div class="method-grid">
      <article class="method-card"><h3>${icon("calendar-range", { size: 15, cls: "tone-accent" })} This week's forecast</h3>
        <p>The latest hourly weather forecast (irradiance, temperature, wind at 10/80/120/180 m) for the point or region centre, run through the models below. Covers exactly the selected window starting at the current hour.</p></article>
      <article class="method-card"><h3>${icon("history", { size: 15, cls: "tone-cyan" })} Long-term average</h3>
        <p>The same models over whole past years of historical hourly weather, giving typical daily, monthly and yearly generation and the year-to-year spread. Not a forecast of any particular week.</p></article>
      <article class="method-card"><h3>${icon("sun", { size: 15, cls: "tone-solar" })} Solar PV (pvlib)</h3>
        <p>Sun position at mid-hour → Hay–Davies plane-of-array irradiance → incidence-angle loss → SAPM cell temperature → PVWatts DC with temperature coefficient → PVWatts loss categories → inverter clipping at the AC rating.</p></article>
      <article class="method-card"><h3>${icon("wind", { size: 15, cls: "tone-cyan" })} Wind</h3>
        <p>Hub-height speed from the provider's heights with an hourly power-law shear (extrapolation is flagged) → air density from temperature and pressure (IEC 61400-12-1) → your power curve, or a flagged generic curve → losses.</p></article>
      <article class="method-card"><h3>${icon("zap", { size: 15, cls: "tone-accent" })} Combined output</h3>
        <p>Hourly sum of solar and wind, optionally capped at a grid-export limit; the curtailed energy is reported. No storage is modelled.</p></article>
      <article class="method-card"><h3>${icon("scan", { size: 15 })} Regions</h3>
        <p>A drawn region is evaluated at its centre point. Forecast grids (≈1–25 km) and historical grids (25–100 km) cannot resolve variation inside small regions.</p></article>
      <article class="method-card"><h3>${icon("triangle-alert", { size: 15, cls: "tone-solar" })} Not assessed</h3>
        <ul><li>Costs, revenue or financial viability</li><li>Land suitability, permits, grid connection</li><li>Grid-operator curtailment and outages</li><li>Site-specific shading and terrain</li></ul></article>
    </div>`;
}
