// Pure client-side validation helpers (no DOM). The server re-validates everything;
// these exist to give fast, field-level feedback. Tested with `node --test tests/js`.

export function parsePowerCurve(text) {
  const points = [];
  const errors = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) return;
    const parts = line.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length !== 2) {
      errors.push(`Line ${i + 1}: expected "wind_speed_m_s, power_kW"`);
      return;
    }
    const [v, p] = parts.map(Number);
    if (!Number.isFinite(v) || !Number.isFinite(p)) {
      // Allow a single header row such as "speed,power".
      if (points.length === 0 && errors.length === 0 && i === firstNonEmpty(lines)) return;
      errors.push(`Line ${i + 1}: not numbers`);
      return;
    }
    if (v < 0 || p < 0) errors.push(`Line ${i + 1}: values must be ≥ 0`);
    points.push([v, p]);
  });
  for (let i = 1; i < points.length; i++) {
    if (points[i][0] <= points[i - 1][0]) {
      errors.push("Wind speeds must be strictly increasing");
      break;
    }
  }
  if (points.length > 0 && points.length < 3) errors.push("Need at least 3 points");
  return { points, errors };
}

function firstNonEmpty(lines) {
  return lines.findIndex((l) => l.replace(/#.*/, "").trim() !== "");
}

// rules: { min, max, exclusiveMin, integer, required }
export function checkNumber(value, rules = {}) {
  if (value === "" || value === null || value === undefined) {
    return rules.required ? "Required" : null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return "Must be a number";
  if (rules.integer && !Number.isInteger(n)) return "Must be a whole number";
  if (rules.exclusiveMin !== undefined && n <= rules.exclusiveMin) return `Must be greater than ${rules.exclusiveMin}`;
  if (rules.min !== undefined && n < rules.min) return `Must be ≥ ${rules.min}`;
  if (rules.max !== undefined && n > rules.max) return `Must be ≤ ${rules.max}`;
  return null;
}

export function checkYears(start, end, minYear, lastYear) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "Choose start and end years";
  if (start < minYear) return `This source starts in ${minYear}`;
  if (end > lastYear) return `End year must be a complete past year (≤ ${lastYear})`;
  if (end < start) return "End year must be after start year";
  if (end - start + 1 > 20) return "At most 20 years";
  return null;
}

export function checkCoords(lat, lon) {
  const a = checkNumber(lat, { min: -90, max: 90, required: true });
  const b = checkNumber(lon, { min: -180, max: 180, required: true });
  return { latitude: a, longitude: b };
}

// Set a nested value on obj using a dotted path, creating objects as needed.
export function setPath(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== "object" || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return obj;
}

export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
