// Runs a forecast / long-term request and keeps per-view status in shared state.
import { markServerIssues } from "../form.js";
import { state } from "../state.js";
import { toast } from "../ui/toast.js";

const listeners = new Set();
export const onRunChange = (fn) => listeners.add(fn);
const notify = (kind) => listeners.forEach((fn) => fn(kind));

export async function execute(kind, req, call) {
  state.controllers[kind]?.abort();
  const ctrl = (state.controllers[kind] = new AbortController());
  state.status[kind] = "loading";
  state.error[kind] = null;
  state.pending = { ...state.pending, [kind]: req };
  notify(kind);
  try {
    const payload = await call(req, ctrl.signal);
    if (state.controllers[kind] !== ctrl) return;
    state.last[kind] = { request: req, payload };
    state.status[kind] = "ok";
  } catch (err) {
    if (err.name === "AbortError" || state.controllers[kind] !== ctrl) return;
    state.status[kind] = "error";
    state.error[kind] = { err, req };
    markServerIssues(err.issues);
    toast({ type: "error", title: err.kind === "validation_error" ? "Check the highlighted inputs" : "Run failed", message: err.message });
  }
  notify(kind);
}

export function cancel(kind) {
  state.controllers[kind]?.abort();
  state.controllers[kind] = null;
  state.status[kind] = state.last[kind] ? "ok" : "idle";
  notify(kind);
}
