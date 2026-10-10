// Backend API client. Errors are normalised to ApiError { status, kind, message, issues, retryable }.

export class ApiError extends Error {
  constructor({ status, kind, message, issues = [], retryable = false, provider = null, hint = null, code = null }) {
    super(message);
    Object.assign(this, { status, kind, issues, retryable, provider, hint, code });
  }
}

async function parseError(resp) {
  let body = null;
  try {
    body = await resp.json();
  } catch {
    /* non-JSON */
  }
  const e = body?.error;
  if (e) {
    return new ApiError({
      status: resp.status, kind: e.type, message: e.message, issues: e.issues || [],
      retryable: !!e.retryable, provider: e.provider, hint: e.hint, code: e.code || null,
    });
  }
  const detail = body?.detail;
  return new ApiError({
    status: resp.status, kind: "http_error",
    message: typeof detail === "string" ? detail : `Request failed (HTTP ${resp.status})`,
  });
}

async function request(method, url, body, { signal, as = "json" } = {}) {
  let resp;
  try {
    resp = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError({ status: 0, kind: "network", message: "Cannot reach the app server. Is it running?", retryable: true });
  }
  if (!resp.ok) throw await parseError(resp);
  if (as === "blob") return { blob: await resp.blob(), filename: filenameFrom(resp) };
  return resp.json();
}

function filenameFrom(resp) {
  const cd = resp.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename="([^"]+)"/);
  return m ? m[1] : "download";
}

// When the server's free Open-Meteo quota is used up (shared hosting IPs), the visitor's browser fetches the
// forecast itself — the server tells it exactly what to request and then models the returned weather.
const WEATHER = Symbol("browser-fetched weather");

async function browserForecast(req, signal) {
  const { url, params } = await request("POST", "/api/forecast/browser-request", req, { signal });
  let resp;
  try {
    resp = await fetch(`${url}?${new URLSearchParams(params)}`, { signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError({ status: 0, kind: "provider_error", message: "Your browser could not reach Open-Meteo either. Check your connection.", retryable: true });
  }
  const weather = await resp.json().catch(() => null);
  if (!resp.ok || !weather) {
    throw new ApiError({ status: resp.status, kind: "provider_error", retryable: true,
      message: `Open-Meteo returned HTTP ${resp.status}${weather?.reason ? `: ${weather.reason}` : ""}` });
  }
  const payload = await request("POST", "/api/forecast/from-browser", { request: req, weather }, { signal });
  payload[WEATHER] = weather; // kept off the JSON so saved scenarios stay small
  return payload;
}

async function forecastWithFallback(req, signal) {
  try {
    return await request("POST", "/api/forecast", req, { signal });
  } catch (err) {
    if (err instanceof ApiError && err.code === "rate_limited" && req.provider === "open_meteo_forecast") {
      return browserForecast(req, signal);
    }
    throw err;
  }
}

const fromBrowser = (req, payload, output) =>
  request("POST", `/api/forecast/from-browser?output=${output}`, { request: req, weather: payload[WEATHER] }, { as: "blob" });

export const api = {
  defaults: () => request("GET", "/api/defaults"),
  providers: () => request("GET", "/api/providers"),
  geocode: (q, signal) => request("GET", `/api/geocode?q=${encodeURIComponent(q)}`, null, { signal }),
  assess: (body, signal) => request("POST", "/api/assess", body, { signal }),
  forecast: forecastWithFallback,
  report: (body) => request("POST", "/api/report", body, { as: "blob" }),
  exportKind: (kind, body) => request("POST", `/api/export/${kind}`, body, { as: "blob" }),
  // Exports reuse the browser-fetched weather when that is how the forecast was obtained.
  forecastExport: (body, payload) =>
    payload?.[WEATHER] ? fromBrowser(body, payload, "csv") : request("POST", "/api/forecast/export", body, { as: "blob" }),
  forecastReport: (body, payload) =>
    payload?.[WEATHER] ? fromBrowser(body, payload, "report") : request("POST", "/api/forecast/report", body, { as: "blob" }),
};

export function saveBlob({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
