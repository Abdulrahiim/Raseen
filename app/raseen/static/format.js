export const fmt = (v, digits = 1) =>
  v === null || v === undefined || Number.isNaN(v) || !Number.isFinite(v)
    ? "—"
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtMW = (v) => `${fmt(v, 0)} MW`;
export const fmtPct = (v, digits = 1) => `${fmt(v, digits)} %`;
export const fmtMin = (t) => (t === null || t === undefined || !Number.isFinite(t) ? "—" : `${t >= 0 ? "+" : "−"}${fmt(Math.abs(t), 1)} min`);
/** Scenario clock: minutes from fence contact as ±MM:SS. */
export function clockLabel(t) {
  if (t === null || t === undefined || !Number.isFinite(t)) return "—";
  const sign = t < 0 ? "−" : "+";
  const total = Math.round(Math.abs(t) * 60);
  const mm = Math.floor(total / 60); const ss = total % 60;
  return `${sign}${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
export const fmtGW = (mw) => `${fmt(mw / 1000, 2)} GW`;
