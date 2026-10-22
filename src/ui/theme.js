/* Light / dark / follow-system theme. The choice is remembered in this browser. */
import { useSyncExternalStore } from "react";
const KEY = "nc_theme";                       // "light" | "dark" | "system"
// Same question the first-paint script in index.html asks: "does the system prefer LIGHT?" — otherwise dark (the original look).
const mq = () => (typeof window !== "undefined" && window.matchMedia) ? window.matchMedia("(prefers-color-scheme: light)") : null;

export const getPreference = () => { try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; } };
export const resolveTheme = (pref = getPreference()) => pref === "system" ? (mq()?.matches ? "light" : "dark") : pref;

export function applyTheme(pref = getPreference()){
  const t = resolveTheme(pref);
  if (typeof document !== "undefined"){ document.documentElement.setAttribute("data-theme", t); document.documentElement.style.colorScheme = t; }
  return t;
}
const listeners = new Set();
export function setPreference(pref){
  try { if (pref === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref); } catch { /* storage blocked: still applies for this session */ }
  applyTheme(pref); listeners.forEach(l => l());
}
export function initTheme(){
  applyTheme();
  const m = mq(); if (m && m.addEventListener) m.addEventListener("change", () => { if (getPreference() === "system"){ applyTheme(); listeners.forEach(l => l()); } });
}
const subscribe = cb => { listeners.add(cb); return () => listeners.delete(cb); };
/** Re-renders the caller when the theme changes. Returns "light" | "dark". */
export const useTheme = () => useSyncExternalStore(subscribe, () => resolveTheme(), () => "dark");
export const usePreference = () => useSyncExternalStore(subscribe, getPreference, () => "system");

/** Resolve "var(--x)" to the real colour for APIs that can't take CSS variables (e.g. map markers). */
export function cssColor(v){
  const m = /^var\((--[\w-]+)\)$/.exec(String(v));
  if (!m || typeof document === "undefined") return v;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || v;
}
