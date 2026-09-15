export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function hexToRgb(hex) { const h = hex.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function rgbToHex([r, g, b]) { return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join(""); }
export function lerpHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b); const u = Math.max(0, Math.min(1, t));
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * u));
}
function ramp(stops, t) {
  const u = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  return lerpHex(stops[i], stops[i + 1], u - i);
}
/** Set-point as a share of block capacity, 0..1 → dark navy .. bright blue. */
export function outputColour(ratio) {
  return ramp([cssVar("--ramp-0"), cssVar("--ramp-2"), cssVar("--ramp-4"), cssVar("--ramp-5")], ratio);
}
/** Headroom share 0..1; firm (ETA beyond the horizon) in violet, expiring in dim violet. */
export function headroomColour(ratio, firm) {
  if (ratio < 0.01) return cssVar("--surface-3");
  return ramp([cssVar("--surface-3"), firm ? cssVar("--violet") : cssVar("--violet-dim")], 0.25 + 0.75 * ratio);
}
/** Minutes to arrival: 0 bright cyan → 15+ dark; passed/covered grey. */
export function etaColour(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return cssVar("--surface-3");
  if (minutes <= 0) return "#4a5160";
  return ramp([cssVar("--cyan"), cssVar("--surface-3")], minutes / 15);
}
export const TECH_COLOUR = { pv: "#f2a33a", wind: "#2ec4d6", csp: "#ec835a", bess: "#8b7cf6" };
export const STATUS_COLOUR = { operational: "#22b573", under_construction: "#fab219", awarded: "#9aa1ad", planned: "#5a6270" };
export const TECH_LABEL = { pv: "Solar PV", wind: "Wind", csp: "CSP", bess: "Battery storage" };
export const STATUS_LABEL = { operational: "Operational", under_construction: "Under construction", awarded: "Awarded", planned: "Planned" };
