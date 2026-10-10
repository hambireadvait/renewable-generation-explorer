// Modal dialogs built on <dialog> (native focus trap and inert background).
// Results are settled directly from button clicks / Enter / Esc rather than the async "close" event,
// which is not reliably delivered when a dialog is closed by form submission.
import { icon } from "./icons.js";
import { esc } from "../format.js";

function openDialog(html, labelledBy) {
  const dlg = document.createElement("dialog");
  dlg.className = "modal";
  dlg.setAttribute("aria-labelledby", labelledBy);
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  let done = null;
  const settle = (value) => {
    if (!done) return;
    const resolve = done;
    done = null;
    if (dlg.open) dlg.close();
    dlg.classList.add("closing");
    setTimeout(() => dlg.remove(), 160);
    resolve(value);
  };
  const promise = new Promise((resolve) => (done = resolve));
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault(); // Esc
    settle(null);
  });
  dlg.addEventListener("close", () => settle(null)); // fallback (e.g. closed programmatically elsewhere)
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) settle(null); // backdrop click
  });
  dlg.querySelector("form").addEventListener("submit", (e) => e.preventDefault());
  dlg.showModal();
  return { dlg, settle, promise };
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  const { dlg, settle, promise } = openDialog(`
    <form class="modal-card">
      <div class="modal-head">
        <span class="modal-icon ${danger ? "danger" : ""}">${icon(danger ? "trash-2" : "info", { size: 18 })}</span>
        <div>
          <h2 id="modal-title">${esc(title)}</h2>
          <p class="muted">${esc(message)}</p>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" type="button" data-v="cancel">${esc(cancelLabel)}</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" type="button" data-v="ok">${esc(confirmLabel)}</button>
      </div>
    </form>`, "modal-title");
  dlg.querySelector('[data-v="cancel"]').addEventListener("click", () => settle(null));
  dlg.querySelector('[data-v="ok"]').addEventListener("click", () => settle(true));
  // Destructive actions start focused on Cancel; others on the confirm button.
  dlg.querySelector(danger ? '[data-v="cancel"]' : '[data-v="ok"]').focus();
  return promise.then((v) => v === true);
}

// Single-input prompt dialog. Resolves to the trimmed value (or the default if left empty), or null if cancelled.
export function promptDialog({ title, message = "", label, value = "", confirmLabel = "Save", maxLength = 60 }) {
  const { dlg, settle, promise } = openDialog(`
    <form class="modal-card">
      <div class="modal-head">
        <span class="modal-icon">${icon("bookmark-plus", { size: 18 })}</span>
        <div style="flex:1;min-width:0">
          <h2 id="prompt-title">${esc(title)}</h2>
          ${message ? `<p class="muted">${esc(message)}</p>` : ""}
        </div>
      </div>
      <div class="field" style="margin:16px 0 0">
        <label class="field-label" for="prompt-input">${esc(label)}</label>
        <div class="input-wrap"><input id="prompt-input" maxlength="${maxLength}" autocomplete="off"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" type="button" data-v="cancel">Cancel</button>
        <button class="btn btn-primary" type="button" data-v="ok">${esc(confirmLabel)}</button>
      </div>
    </form>`, "prompt-title");
  const input = dlg.querySelector("#prompt-input");
  input.value = value;
  const accept = () => settle(input.value.trim() || value);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      accept();
    }
  });
  dlg.querySelector('[data-v="cancel"]').addEventListener("click", () => settle(null));
  dlg.querySelector('[data-v="ok"]').addEventListener("click", accept);
  input.select();
  return promise;
}
