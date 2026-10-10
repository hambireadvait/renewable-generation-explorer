// Toast notifications. Announced politely to screen readers; errors use role="alert".
import { icon } from "./icons.js";
import { esc } from "../format.js";

const ICON = { success: "circle-check", error: "circle-alert", info: "info", warning: "triangle-alert" };
let region = null;

function container() {
  if (!region) {
    region = document.createElement("div");
    region.className = "toast-region";
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  return region;
}

export function toast({ type = "info", title, message = "", timeout = 4500 } = {}) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `
    <span class="toast-icon">${icon(ICON[type] || "info", { size: 18 })}</span>
    <div class="toast-body"><p class="toast-title">${esc(title)}</p>${message ? `<p class="toast-msg">${esc(message)}</p>` : ""}</div>
    <button class="icon-btn toast-close" type="button" aria-label="Dismiss notification">${icon("x", { size: 14 })}</button>`;
  container().appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    el.classList.remove("in");
    el.classList.add("out");
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector(".toast-close").addEventListener("click", close);
  if (timeout) {
    timer = setTimeout(close, timeout);
    el.addEventListener("mouseenter", () => clearTimeout(timer));
    el.addEventListener("mouseleave", () => (timer = setTimeout(close, 2000)));
  }
  return close;
}
