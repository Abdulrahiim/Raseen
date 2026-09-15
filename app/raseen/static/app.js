import { store } from "/static/store.js";
import { getJSON } from "/static/api.js";
import { clockLabel } from "/static/format.js";

const $ = (id) => document.getElementById(id);
const PAGES = {
  kingdom: () => import("/static/pages/kingdom.js"),
  plant: () => import("/static/pages/plant.js"),
  control: () => import("/static/pages/control.js"),
  declarations: () => import("/static/pages/declarations.js"),
  about: () => import("/static/pages/about.js"),
};
const TITLES = { kingdom: "Kingdom", plant: "Plant", control: "Gradient Control", declarations: "Declarations", about: "About · what's real" };

let current = null;   // { name, module }

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [name, ...rest] = hash.split("/");
  return { name: PAGES[name] ? name : "kingdom", params: rest.filter(Boolean) };
}

export function navigate(path) { location.hash = path.startsWith("#") ? path : `#${path}`; }

export function banner(message) {
  const el = $("banner");
  if (!message) { el.hidden = true; el.textContent = ""; return; }
  el.textContent = message; el.hidden = false;
}

export function showTooltip(event, heading, rows) {
  const tip = $("tooltip");
  tip.replaceChildren();
  const head = document.createElement("div"); head.className = "tooltip-head"; head.textContent = heading; tip.append(head);
  for (const row of rows) {
    const line = document.createElement("div"); line.className = "tooltip-row";
    const name = document.createElement("span"); name.textContent = row.name;
    const value = document.createElement("span"); value.className = "tooltip-value"; value.textContent = row.value;
    line.append(name, value); tip.append(line);
  }
  tip.style.left = `${event.clientX}px`; tip.style.top = `${event.clientY}px`; tip.classList.add("is-visible");
}
export function hideTooltip() { $("tooltip").classList.remove("is-visible"); }

async function route() {
  const { name, params } = parseRoute();
  if (current?.module?.unmount) { try { current.module.unmount(); } catch (e) { console.warn(e); } }
  const root = $("page-root"); root.replaceChildren();
  for (const item of document.querySelectorAll(".nav-item")) item.classList.toggle("is-active", item.dataset.route === name);
  $("page-title").textContent = TITLES[name];
  try {
    const module = await PAGES[name]();
    current = { name, module };
    await module.mount(root, { store, navigate, params, showTooltip, hideTooltip, banner });
  } catch (error) {
    banner(`Page failed: ${error.message}`); console.error(error);
  }
}

function applyTheme(theme) { document.documentElement.dataset.theme = theme; try { localStorage.setItem("raseen-theme", theme); } catch (e) { /* private mode */ } }

async function boot() {
  try { const saved = localStorage.getItem("raseen-theme"); if (saved) store.set({ theme: saved }); } catch (e) { /* ignore */ }
  applyTheme(store.get().theme);
  $("theme-toggle").addEventListener("click", () => { const next = store.get().theme === "dark" ? "light" : "dark"; store.set({ theme: next }); applyTheme(next); });
  $("presentation-toggle").addEventListener("click", (e) => { const on = !store.get().presentation; store.set({ presentation: on }); document.documentElement.dataset.presentation = on ? "on" : "off"; e.currentTarget.setAttribute("aria-pressed", String(on)); });
  $("whatsreal-toggle").addEventListener("click", (e) => { const on = !store.get().whatsReal; store.set({ whatsReal: on }); document.documentElement.dataset.whatsreal = on ? "on" : "off"; e.currentTarget.setAttribute("aria-pressed", String(on)); });
  $("sidebar-toggle").addEventListener("click", () => document.querySelector(".shell").classList.toggle("is-collapsed"));

  store.subscribe((state, changed) => {
    if (changed.includes("scenario") || changed.includes("frameIndex")) {
      const frame = store.currentFrame();
      $("clock").hidden = !frame;
      if (frame) $("clock-value").textContent = clockLabel(frame.t);
    }
  });

  try {
    const status = await getJSON("/api/status");
    store.set({ status });
    $("data-source-label").textContent = status.is_live ? "LIVE" : "SIM";
    $("data-source-chip").title = status.disclaimer;
    $("version").textContent = `v${status.version} · ${status.site_mode}`;
  } catch (error) { banner(`API unavailable: ${error.message}`); }

  addEventListener("hashchange", route);
  await route();
}

boot();
