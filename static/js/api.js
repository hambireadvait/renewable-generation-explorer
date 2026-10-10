// Backend API client. Errors are normalised to ApiError { status, kind, message, issues, retryable }.

export class ApiError extends Error {
  constructor({ status, kind, message, issues = [], retryable = false, provider = null, hint = null }) {
    super(message);
    Object.assign(this, { status, kind, issues, retryable, provider, hint });
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
      retryable: !!e.retryable, provider: e.provider, hint: e.hint,
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

export const api = {
  defaults: () => request("GET", "/api/defaults"),
  providers: () => request("GET", "/api/providers"),
  geocode: (q, signal) => request("GET", `/api/geocode?q=${encodeURIComponent(q)}`, null, { signal }),
  assess: (body, signal) => request("POST", "/api/assess", body, { signal }),
  forecast: (body, signal) => request("POST", "/api/forecast", body, { signal }),
  report: (body) => request("POST", "/api/report", body, { as: "blob" }),
  exportKind: (kind, body) => request("POST", `/api/export/${kind}`, body, { as: "blob" }),
  forecastExport: (body) => request("POST", "/api/forecast/export", body, { as: "blob" }),
  forecastReport: (body) => request("POST", "/api/forecast/report", body, { as: "blob" }),
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
