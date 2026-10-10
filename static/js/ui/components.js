// Small HTML builders shared by every view, so cards, states and badges look identical everywhere.
import { icon } from "./icons.js";
import { esc } from "../format.js";

export function statCard({ tone = "neutral", iconName, label, value, sub = "", spark = null, big = false }) {
  return `<article class="stat ${big ? "stat-big" : ""} tone-${tone}">
    <header class="stat-head"><span class="stat-icon">${icon(iconName, { size: 16 })}</span><span class="stat-label">${esc(label)}</span></header>
    <div class="stat-value">${value}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
    ${spark ? `<div class="stat-spark">${spark}</div>` : ""}
  </article>`;
}

// Tiny bar sparkline from real values (no axes). Bars grow in on first paint.
export function sparkBars(values, { tone = "accent", height = 36, labels = [] } = {}) {
  if (!values.length) return "";
  const max = Math.max(...values, 1e-9);
  const w = 100 / values.length;
  const bars = values
    .map((v, i) => {
      const h = Math.max(2, (v / max) * height);
      return `<rect x="${(i * w + w * 0.18).toFixed(2)}" y="${(height - h).toFixed(2)}" width="${(w * 0.64).toFixed(2)}" height="${h.toFixed(2)}" rx="1.5"><title>${esc(labels[i] ?? "")}</title></rect>`;
    })
    .join("");
  return `<svg class="spark tone-${tone}" viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
}

export function emptyState({ iconName, title, body, action = "" }) {
  return `<div class="empty-state">
    <div class="empty-icon">${icon(iconName, { size: 22 })}</div>
    <h3>${esc(title)}</h3>
    <p>${body}</p>
    ${action}
  </div>`;
}

export function errorState({ title, message, issues = [], hint = "", actions = "" }) {
  return `<div class="alert alert-error" role="alert">
    <span class="alert-icon">${icon("circle-alert", { size: 18 })}</span>
    <div class="alert-body">
      <p class="alert-title">${esc(title)}</p>
      <p>${esc(message)}</p>
      ${issues.length ? `<ul>${issues.map((i) => `<li><code>${esc(i.field)}</code> ${esc(i.message)}</li>`).join("")}</ul>` : ""}
      ${hint ? `<p class="muted small">${esc(hint)}</p>` : ""}
      ${actions ? `<div class="alert-actions">${actions}</div>` : ""}
    </div>
  </div>`;
}

export function skeletonResults({ stats = 3, charts = 1, table = true } = {}) {
  const stat = '<div class="stat skeleton-card"><div class="sk sk-line w40"></div><div class="sk sk-line w60 tall"></div><div class="sk sk-line w80"></div></div>';
  return `<div class="results-skeleton" aria-hidden="true">
    <div class="sk-banner sk"></div>
    <div class="stat-grid">${stat.repeat(stats)}</div>
    ${'<div class="panel"><div class="sk sk-line w30"></div><div class="sk sk-chart"></div></div>'.repeat(charts)}
    ${table ? '<div class="panel"><div class="sk sk-line w30"></div>' + '<div class="sk sk-line w100"></div>'.repeat(5) + "</div>" : ""}
  </div>`;
}

export function badge(text, tone = "neutral", iconName = null) {
  return `<span class="badge badge-${tone}">${iconName ? icon(iconName, { size: 12 }) : ""}${esc(text)}</span>`;
}

// Put a button into its loading state; returns a function that restores it.
export function setLoading(btn, label) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = `${icon("loader-circle", { size: 16, cls: "spin" })}<span>${esc(label)}</span>`;
  return () => {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.innerHTML = html;
  };
}
