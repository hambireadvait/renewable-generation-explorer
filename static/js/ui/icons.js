// Lucide icons (https://lucide.dev), ISC licence — lucide-static v1.55.0. Inlined so no icon runtime is needed.
const PATHS = {
 "activity": "<path d=\"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2\"/>",
 "arrow-right": "<path d=\"M5 12h14\"/> <path d=\"m12 5 7 7-7 7\"/>",
 "book-open": "<path d=\"M12 5v16\"/> <path d=\"M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z\"/>",
 "bookmark-plus": "<path d=\"M12 7v6\"/> <path d=\"M15 10H9\"/> <path d=\"M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z\"/>",
 "braces": "<path d=\"M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1\"/> <path d=\"M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1\"/>",
 "calendar-range": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/> <path d=\"M16 2v3\"/> <path d=\"M3 9h18\"/> <path d=\"M8 2v3\"/> <path d=\"M17 13h-6\"/> <path d=\"M13 17H7\"/> <path d=\"M7 13h.01\"/> <path d=\"M17 17h.01\"/>",
 "chart-area": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/> <path d=\"M7 11.207a.5.5 0 0 1 .146-.353l2-2a.5.5 0 0 1 .708 0l3.292 3.292a.5.5 0 0 0 .708 0l4.292-4.292a.5.5 0 0 1 .854.353V16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z\"/>",
 "chart-column": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/> <path d=\"M18 17V9\"/> <path d=\"M13 17V5\"/> <path d=\"M8 17v-3\"/>",
 "chart-line": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/> <path d=\"m19 9-5 5-4-4-3 3\"/>",
 "check": "<path d=\"M20 6 9 17l-5-5\"/>",
 "chevron-down": "<path d=\"m6 9 6 6 6-6\"/>",
 "chevron-right": "<path d=\"m9 18 6-6-6-6\"/>",
 "circle-alert": "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\"/> <line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\"/>",
 "circle-check": "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <path d=\"m16 9-5.5 5.5L8 12\"/>",
 "clock": "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <path d=\"M12 6v6l4 2\"/>",
 "cloud-sun": "<path d=\"M12 2v2\"/> <path d=\"m4.93 4.93 1.41 1.41\"/> <path d=\"M20 12h2\"/> <path d=\"m19.07 4.93-1.41 1.41\"/> <path d=\"M15.947 12.65a4 4 0 0 0-5.925-4.128\"/> <path d=\"M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z\"/>",
 "command": "<path d=\"M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3\"/>",
 "corner-down-left": "<path d=\"M20 4v7a4 4 0 0 1-4 4H4\"/> <path d=\"m9 10-5 5 5 5\"/>",
 "crosshair": "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <line x1=\"22\" x2=\"18\" y1=\"12\" y2=\"12\"/> <line x1=\"6\" x2=\"2\" y1=\"12\" y2=\"12\"/> <line x1=\"12\" x2=\"12\" y1=\"6\" y2=\"2\"/> <line x1=\"12\" x2=\"12\" y1=\"22\" y2=\"18\"/>",
 "database": "<ellipse cx=\"12\" cy=\"5\" rx=\"9\" ry=\"3\"/> <path d=\"M3 5V19A9 3 0 0 0 21 19V5\"/> <path d=\"M3 12A9 3 0 0 0 21 12\"/>",
 "download": "<path d=\"M12 15V3\"/> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/> <path d=\"m7 10 5 5 5-5\"/>",
 "eraser": "<path d=\"M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21\"/> <path d=\"m5.082 11.09 8.828 8.828\"/>",
 "external-link": "<path d=\"M15 3h6v6\"/> <path d=\"M10 14 21 3\"/> <path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"/>",
 "file-json": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"/> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\"/> <path d=\"M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1\"/> <path d=\"M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1\"/>",
 "file-spreadsheet": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"/> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\"/> <path d=\"M8 13h2\"/> <path d=\"M14 13h2\"/> <path d=\"M8 17h2\"/> <path d=\"M14 17h2\"/>",
 "file-text": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"/> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\"/> <path d=\"M10 9H8\"/> <path d=\"M16 13H8\"/> <path d=\"M16 17H8\"/>",
 "flask-conical": "<path d=\"M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2\"/> <path d=\"M6.453 15h11.094\"/> <path d=\"M8.5 2h7\"/>",
 "gauge": "<path d=\"m12 14 4-4\"/> <path d=\"M3.34 19a10 10 0 1 1 17.32 0\"/>",
 "git-compare-arrows": "<circle cx=\"5\" cy=\"6\" r=\"3\"/> <path d=\"M12 6h5a2 2 0 0 1 2 2v7\"/> <path d=\"m15 9-3-3 3-3\"/> <circle cx=\"19\" cy=\"18\" r=\"3\"/> <path d=\"M12 18H7a2 2 0 0 1-2-2V9\"/> <path d=\"m9 15 3 3-3 3\"/>",
 "globe": "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\"/> <path d=\"M2 12h20\"/>",
 "history": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/> <path d=\"M3 3v5h5\"/> <path d=\"M12 7v5l4 2\"/>",
 "info": "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <path d=\"M12 16v-4\"/> <path d=\"M12 8h.01\"/>",
 "layers": "<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\"/> <path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\"/> <path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\"/>",
 "loader-circle": "<path d=\"M21 12a9 9 0 1 1-6.219-8.56\"/>",
 "map-pin": "<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\"/> <circle cx=\"12\" cy=\"10\" r=\"3\"/>",
 "menu": "<path d=\"M4 5h16\"/> <path d=\"M4 12h16\"/> <path d=\"M4 19h16\"/>",
 "mouse-pointer-click": "<path d=\"M14 4.1 12 6\"/> <path d=\"m5.1 8-2.9-.8\"/> <path d=\"m6 12-1.9 2\"/> <path d=\"M7.2 2.2 8 5.1\"/> <path d=\"M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z\"/>",
 "panel-left-close": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/> <path d=\"M9 3v18\"/> <path d=\"m16 15-3-3 3-3\"/>",
 "panel-left-open": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/> <path d=\"M9 3v18\"/> <path d=\"m14 9 3 3-3 3\"/>",
 "play": "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\"/>",
 "printer": "<path d=\"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\"/> <path d=\"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6\"/> <rect x=\"6\" y=\"14\" width=\"12\" height=\"8\" rx=\"1\"/>",
 "rotate-ccw": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/> <path d=\"M3 3v5h5\"/>",
 "scan": "<path d=\"M3 7V5a2 2 0 0 1 2-2h2\"/> <path d=\"M17 3h2a2 2 0 0 1 2 2v2\"/> <path d=\"M21 17v2a2 2 0 0 1-2 2h-2\"/> <path d=\"M7 21H5a2 2 0 0 1-2-2v-2\"/>",
 "search": "<path d=\"m21 21-4.34-4.34\"/> <circle cx=\"11\" cy=\"11\" r=\"8\"/>",
 "sliders-horizontal": "<path d=\"M10 5H3\"/> <path d=\"M12 19H3\"/> <path d=\"M14 3v4\"/> <path d=\"M16 17v4\"/> <path d=\"M21 12h-9\"/> <path d=\"M21 19h-5\"/> <path d=\"M21 5h-7\"/> <path d=\"M8 10v4\"/> <path d=\"M8 12H3\"/>",
 "sun": "<circle cx=\"12\" cy=\"12\" r=\"4\"/> <path d=\"M12 2v2\"/> <path d=\"M12 20v2\"/> <path d=\"m4.93 4.93 1.41 1.41\"/> <path d=\"m17.66 17.66 1.41 1.41\"/> <path d=\"M2 12h2\"/> <path d=\"M20 12h2\"/> <path d=\"m6.34 17.66-1.41 1.41\"/> <path d=\"m19.07 4.93-1.41 1.41\"/>",
 "sunrise": "<path d=\"M12 2v8\"/> <path d=\"m4.93 10.93 1.41 1.41\"/> <path d=\"M2 18h2\"/> <path d=\"M20 18h2\"/> <path d=\"m19.07 10.93-1.41 1.41\"/> <path d=\"M22 22H2\"/> <path d=\"m8 6 4-4 4 4\"/> <path d=\"M16 18a4 4 0 0 0-8 0\"/>",
 "thermometer": "<path d=\"M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z\"/>",
 "trash-2": "<path d=\"M10 11v6\"/> <path d=\"M14 11v6\"/> <path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/> <path d=\"M3 6h18\"/> <path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/>",
 "triangle-alert": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"/> <path d=\"M12 9v4\"/> <path d=\"M12 17h.01\"/>",
 "wind": "<path d=\"M12.8 19.6A2 2 0 1 0 14 16H2\"/> <path d=\"M17.5 8a2.5 2.5 0 1 1 2 4H2\"/> <path d=\"M9.8 4.4A2 2 0 1 1 11 8H2\"/>",
 "x": "<path d=\"M18 6 6 18\"/> <path d=\"m6 6 12 12\"/>",
 "zap": "<path d=\"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z\"/>"
};

export function icon(name, { size = 16, cls = "", label = null, stroke = 2 } = {}) {
  const body = PATHS[name];
  if (!body) throw new Error(`Unknown icon: ${name}`);
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="icon ${cls}" ${a11y} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// Replace every <i data-icon="name" data-size="16"></i> under root with its SVG.
export function hydrateIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach((el) => {
    const svg = icon(el.dataset.icon, { size: Number(el.dataset.size) || 16, cls: el.className || "" });
    el.insertAdjacentHTML("afterend", svg);
    el.remove();
  });
}
