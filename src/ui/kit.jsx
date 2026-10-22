/* ════════════════════════════════════════════════════════════════
   UI kit — small, dependency-free building blocks (styles: modern.css)
════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useRef, useId, useCallback } from "react";
import { SC } from "../constants.js";
import { EMAIL_STATUS } from "../lib/emailCheck.js";
import { cleanTag } from "../lib/filters.js";

export const cx = (...a) => a.filter(Boolean).join(" ");
/** A translucent version of any colour — works with CSS variables (unlike hex+"22"). */
export const alpha = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

export function useDebounced(value, ms = 180){
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function useOutside(ref, onOut, active){
  useEffect(() => {
    if (!active) return;
    const down = e => { if (ref.current && !ref.current.contains(e.target)) onOut(); };
    const key = e => { if (e.key === "Escape") onOut(); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [ref, onOut, active]);
}

export function Spinner({ size = 16, color = "currentColor" }){
  return <span aria-hidden style={{ display: "inline-block", width: size, height: size, border: `2px solid ${alpha(color, 20)}`, borderTopColor: color, borderRadius: "50%", animation: "nc-spin .7s linear infinite", flexShrink: 0 }} />;
}

export function Btn({ variant = "ghost", size, icon, loading, className, children, ...rest }){
  return (
    <button type="button" className={cx("nc-btn", variant, size, className)} {...rest} disabled={rest.disabled || loading}>
      {loading ? <Spinner size={13} /> : icon ? <span aria-hidden>{icon}</span> : null}
      {children}
    </button>
  );
}

export function Check({ checked, indeterminate, onChange, label, ...rest }){
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate && !checked; }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" className="nc-check" checked={!!checked} onChange={onChange} aria-label={label} {...rest} />;
}

export function StatusPill({ status }){
  const s = SC[status] || { bg: "rgba(var(--k-ink-rgb),.06)", c: "rgba(var(--k-ink-rgb),.55)", b: "rgba(var(--k-ink-rgb),.12)" };
  return <span className="nc-pill" style={{ background: s.bg, color: s.c, borderColor: s.b }}>{status || "—"}</span>;
}

export function ScoreRing({ score, color, size = 34, label }){
  const r = (size - 5) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <span role="img" aria-label={label || `Fit score ${score} out of 100`} style={{ position: "relative", display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "rgba(var(--k-ink-rgb),.12)" }} strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ stroke: color, transition: "stroke-dashoffset .5s" }} />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", font: `800 ${size > 40 ? 15 : 10.5}px var(--nc-font)`, color }}>{score}</span>
    </span>
  );
}

export function ScoreBadge({ result, size = 34, showLabel }){
  if (!result) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }} title={`${result.label} fit — ${result.score}/100\n` + result.factors.map(f => `${f.label}: ${f.points}/${f.max}`).join("\n")}>
      <ScoreRing score={result.score} color={result.color} size={size} />
      {showLabel && <span style={{ font: "700 11px var(--nc-font)", color: result.color }}>{result.label}</span>}
    </span>
  );
}

/** Per-factor breakdown (the "why" behind a score) */
export function ScoreBreakdown({ result }){
  return (
    <div style={{ display: "grid", gap: 9 }}>
      {result.factors.map(f => (
        <div key={f.key}>
          <div style={{ display: "flex", justifyContent: "space-between", font: "600 11.5px var(--nc-font)", marginBottom: 4 }}>
            <span>{f.label}</span><span style={{ color: "var(--nc-text-2)" }}>{f.points}{f.max ? <span style={{ color: "var(--nc-text-3)" }}> / {f.max}</span> : null}</span>
          </div>
          {f.max > 0 && <div className="nc-bar"><i style={{ width: `${(f.points / f.max) * 100}%`, background: result.color }} /></div>}
          <div style={{ font: "500 11px var(--nc-font)", color: "var(--nc-text-3)", marginTop: 3 }}>{f.note}</div>
        </div>
      ))}
      {result.missing?.length > 0 && (
        <div style={{ font: "500 11.5px/1.45 var(--nc-font)", color: "var(--nc-amber)", background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.2)", borderRadius: 8, padding: "8px 10px" }}>
          Add <b>{result.missing.join(", ")}</b> for a more accurate score.
        </div>
      )}
    </div>
  );
}

export function EmailBadge({ status = "", flags = [], confirmed, compact }){
  const e = EMAIL_STATUS[status] || EMAIL_STATUS[""];
  const icon = status === "valid" ? "✓" : status === "risky" ? "!" : status === "invalid" ? "✕" : "·";
  return (
    <span title={`${e.label}${confirmed ? " (mailbox confirmed)" : ""}${flags.length ? " · " + flags.join(", ") : ""}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, font: "700 10.5px var(--nc-font)", color: e.color }}>
      <span aria-hidden style={{ width: 15, height: 15, borderRadius: "50%", display: "inline-grid", placeItems: "center", background: alpha(e.color, 13), border: `1px solid ${alpha(e.color, 33)}`, fontSize: 9 }}>{icon}</span>
      {!compact && <span>{e.label}{confirmed ? " ✓" : ""}</span>}
    </span>
  );
}

/** Anchored popover. Pass `trigger({open,toggle})`. */
export function Popover({ trigger, children, align = "left", up = false, width, onOpenChange }){
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => { setOpen(false); onOpenChange?.(false); }, [onOpenChange]);
  const toggle = () => setOpen(o => { onOpenChange?.(!o); return !o; });
  useOutside(ref, close, open);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {trigger({ open, toggle })}
      {open && (
        <div className="nc-pop" role="menu" style={{ [align]: 0, [up ? "bottom" : "top"]: "calc(100% + 6px)", width }}>
          {typeof children === "function" ? children({ close }) : children}
        </div>
      )}
    </span>
  );
}

export function MenuItem({ children, on, icon, ...rest }){
  return <button type="button" role="menuitem" className={cx("nc-menu-item", on && "on")} {...rest}>{icon && <span aria-hidden style={{ width: 16, textAlign: "center" }}>{icon}</span>}<span style={{ flex: 1 }}>{children}</span></button>;
}

/** Multi-select dropdown used by the filter bar */
export function MultiSelect({ label, options, value, onChange, searchable, empty = "Nothing to choose from" }){
  const [q, setQ] = useState("");
  const shown = options.filter(o => !q || String(o.label).toLowerCase().includes(q.toLowerCase()));
  const toggleVal = v => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  return (
    <Popover trigger={({ open, toggle }) => (
      <button type="button" className={cx("nc-chip", "btn", value.length && "active")} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        {label}{value.length > 0 && <span style={{ background: "var(--nc-gold)", color: "#0B1426", borderRadius: 99, padding: "1px 6px", fontSize: 10 }}>{value.length}</span>}<span aria-hidden style={{ opacity: .6, fontSize: 9 }}>▾</span>
      </button>
    )} width={250}>
      <div>
        {searchable && <input className="nc-input" style={{ marginBottom: 6 }} placeholder={`Search ${label.toLowerCase()}…`} value={q} onChange={e => setQ(e.target.value)} autoFocus aria-label={`Search ${label}`} />}
        <div style={{ maxHeight: 280, overflowY: "auto" }}>
          {shown.length === 0 && <div style={{ padding: "10px 8px", color: "var(--nc-text-3)", fontSize: 12 }}>{empty}</div>}
          {shown.map(o => (
            <label key={String(o.value)} className="nc-menu-item" style={{ cursor: "pointer" }}>
              <Check checked={value.includes(o.value)} onChange={() => toggleVal(o.value)} label={String(o.label)} />
              <span className="nc-trunc" style={{ flex: 1 }}>{o.label}</span>
              {o.count != null && <span style={{ color: "var(--nc-text-3)", fontSize: 11 }}>{o.count}</span>}
            </label>
          ))}
        </div>
        {value.length > 0 && <><div className="nc-menu-sep" /><button type="button" className="nc-menu-item" onClick={() => onChange([])}>Clear {label.toLowerCase()}</button></>}
      </div>
    </Popover>
  );
}

export function Segmented({ options, value, onChange, label }){
  return (
    <div className="nc-seg" role="tablist" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.icon && <span aria-hidden>{o.icon}</span>}{o.label}
          {o.badge != null && o.badge > 0 && <span style={{ background: o.badgeColor || "var(--nc-gold)", color: "#0B1426", borderRadius: 99, padding: "1px 6px", fontSize: 10 }}>{o.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }){
  return <div className="nc-empty"><div className="ico" aria-hidden>{icon}</div><h3>{title}</h3><p>{children}</p>{action}</div>;
}

/** Slide-over panel with Escape-to-close and focus restore */
export function Drawer({ onClose, title, subtitle, children, footer, width }){
  const ref = useRef(null); const id = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const key = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    ref.current?.focus();
    return () => { document.removeEventListener("keydown", key); if (prev && prev.focus) prev.focus(); };
  }, [onClose]);
  return (
    <>
      <div className="nc-scrim" onClick={onClose} />
      <aside ref={ref} tabIndex={-1} className="nc-drawer nc" role="dialog" aria-modal="true" aria-labelledby={id} style={width ? { width } : undefined}>
        <header style={{ padding: "16px 18px 14px", borderBottom: "1px solid var(--nc-border)", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={id} className="nc-trunc" style={{ margin: 0, font: "800 17px var(--nc-font)" }}>{title}</h2>
            {subtitle && <div style={{ marginTop: 6 }}>{subtitle}</div>}
          </div>
          <Btn variant="subtle" size="icon" onClick={onClose} aria-label="Close panel">✕</Btn>
        </header>
        <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>{children}</div>
        {footer && <footer style={{ padding: "12px 18px", borderTop: "1px solid var(--nc-border)", display: "flex", gap: 8, flexWrap: "wrap" }}>{footer}</footer>}
      </aside>
    </>
  );
}

export function Section({ title, action, children }){
  return (
    <section style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ margin: 0, font: "700 10.5px var(--nc-font)", textTransform: "uppercase", letterSpacing: ".08em", color: "var(--nc-text-3)" }}>{title}</h3>{action}
      </div>
      {children}
    </section>
  );
}

/** Chips + text box. Enter / comma adds, Backspace removes the last. */
export function TagInput({ value, onChange, suggestions = [], placeholder = "Add tag…", max = 30, disabled }){
  const [text, setText] = useState(""); const [focus, setFocus] = useState(false);
  const add = raw => { const t = cleanTag(raw); if (!t || value.includes(t) || value.length >= max) { setText(""); return; } onChange([...value, t]); setText(""); };
  const sugg = suggestions.filter(([t]) => !value.includes(t) && (!text || t.includes(cleanTag(text)))).slice(0, 6);
  return (
    <div style={{ position: "relative" }}>
      <div className="nc-input" style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 8px", alignItems: "center", opacity: disabled ? .6 : 1 }} onClick={e => e.currentTarget.querySelector("input")?.focus()}>
        {disabled && !value.length && <span style={{ color: "var(--nc-text-3)", fontSize: 12, padding: "2px 3px" }}>{placeholder}</span>}
        {value.map(t => <span key={t} className="nc-tag" style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>{t}{!disabled && <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(value.filter(x => x !== t))} style={{ all: "unset", cursor: "pointer", opacity: .7 }}>×</button>}</span>)}
        {!disabled && <input value={text} placeholder={value.length ? "" : placeholder} aria-label="Add a tag"
          onChange={e => { const v = e.target.value; if (/[,;]$/.test(v)) add(v); else setText(v); }}
          onKeyDown={e => { if (e.key === "Enter"){ e.preventDefault(); add(text); } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1)); }}
          onFocus={() => setFocus(true)} onBlur={() => { setTimeout(() => setFocus(false), 120); if (text) add(text); }}
          style={{ all: "unset", flex: 1, minWidth: 80, font: "500 12.5px var(--nc-font)", color: "var(--nc-text)" }} />}
      </div>
      {focus && sugg.length > 0 && (
        <div className="nc-pop" style={{ left: 0, top: "calc(100% + 4px)", minWidth: 200 }}>
          {sugg.map(([t, n]) => <button type="button" key={t} className="nc-menu-item" onMouseDown={e => { e.preventDefault(); add(t); }}><span style={{ flex: 1 }}>{t}</span><span style={{ color: "var(--nc-text-3)", fontSize: 11 }}>{n}</span></button>)}
        </div>
      )}
    </div>
  );
}

/** Light / Dark / Auto switch. Pass `onDark` when it sits on an always-dark surface (the sidebar). */
import { usePreference, setPreference } from "./theme.js";
export function ThemeToggle({ onDark = false, compact = false }){
  const pref = usePreference();
  const opts = [["light", "☀", "Light"], ["dark", "☾", "Dark"], ["system", "◐", "Auto"]];
  return (
    <div data-theme={onDark ? "dark" : undefined} role="radiogroup" aria-label="Colour theme" className="nc-seg" style={onDark ? { background: "rgba(255,255,255,.06)", borderColor: "rgba(255,255,255,.1)" } : undefined}>
      {opts.map(([v, ico, label]) => (
        <button key={v} type="button" role="radio" aria-checked={pref === v} className={pref === v ? "on" : ""} title={`${label} theme`} onClick={() => setPreference(v)}>
          <span aria-hidden>{ico}</span>{!compact && label}
        </button>
      ))}
    </div>
  );
}
