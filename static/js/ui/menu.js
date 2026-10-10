// Accessible dropdown menu (menu button pattern): click/Enter/Space/ArrowDown opens,
// arrow keys move, Enter selects, Esc/Tab/outside click closes.
import { icon } from "./icons.js";
import { esc } from "../format.js";

let openMenu = null;

export function attachMenu(button, items, { align = "end" } = {}) {
  const menu = document.createElement("div");
  menu.className = `menu menu-${align}`;
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = items
    .map((it, i) =>
      it.separator
        ? '<div class="menu-sep" role="separator"></div>'
        : `<button type="button" role="menuitem" tabindex="-1" class="menu-item" data-i="${i}">
            ${it.icon ? icon(it.icon, { size: 15 }) : ""}<span>${esc(it.label)}</span>${it.hint ? `<span class="menu-hint">${esc(it.hint)}</span>` : ""}
          </button>`,
    )
    .join("");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const wrap = button.parentElement;
  wrap.classList.add("menu-anchor");
  wrap.appendChild(menu);
  const entries = () => [...menu.querySelectorAll(".menu-item")];

  function open(focusIndex = 0) {
    if (openMenu && openMenu !== close) openMenu();
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add("in"));
    button.setAttribute("aria-expanded", "true");
    entries()[focusIndex]?.focus();
    openMenu = close;
    document.addEventListener("pointerdown", onOutside, true);
  }
  function close({ restoreFocus = false } = {}) {
    if (menu.hidden) return;
    menu.classList.remove("in");
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (openMenu === close) openMenu = null;
    if (restoreFocus) button.focus();
  }
  function onOutside(e) {
    if (!wrap.contains(e.target)) close();
  }
  button.addEventListener("click", () => (menu.hidden ? open() : close()));
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      open(0);
    }
  });
  menu.addEventListener("keydown", (e) => {
    const list = entries();
    const idx = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(idx + 1) % list.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(idx - 1 + list.length) % list.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close({ restoreFocus: true }); }
    else if (e.key === "Tab") close();
  });
  menu.addEventListener("click", (e) => {
    const btn = e.target.closest(".menu-item");
    if (!btn) return;
    close({ restoreFocus: true });
    items[Number(btn.dataset.i)].onSelect();
  });
  return { open, close };
}
