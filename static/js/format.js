// Number formatting (en-IN digit grouping, e.g. 12,34,567).

const numFmt = (d) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: d, minimumFractionDigits: 0 });

export function energy(kwh) {
  if (kwh === null || kwh === undefined || !Number.isFinite(kwh)) return "—";
  const a = Math.abs(kwh);
  if (a >= 1e6) return `${numFmt(2).format(kwh / 1e6)} GWh`;
  if (a >= 1e3) return `${numFmt(1).format(kwh / 1e3)} MWh`;
  return `${numFmt(0).format(kwh)} kWh`;
}

export function num(x, digits = 1) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return numFmt(digits).format(x);
}

export function pct(x, digits = 1) {
  return x === null || x === undefined || !Number.isFinite(x) ? "—" : `${numFmt(digits).format(x)}%`;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const TECH_LABEL = { solar: "Solar PV", wind: "Wind", hybrid: "Combined" };
