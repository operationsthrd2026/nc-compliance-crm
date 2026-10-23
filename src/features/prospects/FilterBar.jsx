import { useEffect, useRef, useState, useMemo } from "react";
import { STATUSES, VERTICALS } from "../../constants.js";
import { placeLabel } from "../../lib/geo.js";
import { BUILTIN_VIEWS, EMPTY_FILTERS, countActive, filtersEqual, withDefaults } from "../../lib/filters.js";
import { TIERS } from "../../lib/scoring.js";
import { EMAIL_STATUS } from "../../lib/emailCheck.js";
import { Btn, MultiSelect, Popover, Segmented, Check, cx } from "../../ui/kit.jsx";

const countBy = (rows, fn) => { const m = new Map(); for (const r of rows){ const k = fn(r); m.set(k, (m.get(k) || 0) + 1); } return m; };

export default function FilterBar({ filters, setFilters, allRows, tagList, tagsEnabled, savedItems, canEdit, canSaveShared, onSaveView, onDeleteView, onApplyView, viewCounts, currentUserId, isAdmin, isLocalSaved, savedError }){
  const searchRef = useRef(null);
  useEffect(() => {
    const k = e => { if (e.key === "/" && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")){ e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);

  const set = patch => setFilters(f => ({ ...f, ...patch }));
  const active = countActive(filters);

  const opts = useMemo(() => {
    const st = countBy(allRows, r => r.currentStatus), vt = countBy(allRows, r => r.vertical), mk = countBy(allRows, r => r.market),
      sr = countBy(allRows, r => r.sourceType), es = countBy(allRows, r => r.emailStatus || "");
    return {
      status: STATUSES.map(s => ({ value: s, label: s, count: st.get(s) || 0 })),
      vertical: VERTICALS.map(v => ({ value: v, label: v, count: vt.get(v) || 0 })).filter(o => o.count || filters.vertical.includes(o.value)),
      // markets come from YOUR data (nationwide), not a fixed list
      market: [...new Set([...mk.keys(), ...filters.market])].filter(Boolean).map(m => ({ value: m, label: m, count: mk.get(m) || 0 })).sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label))),
      source: [...sr.keys()].filter(Boolean).sort().map(s => ({ value: s, label: s, count: sr.get(s) })),
      tags: tagList.map(([t, n]) => ({ value: t, label: t, count: n })),
      tier: ["hot", "strong", "possible", "low"].map(t => ({ value: t, label: TIERS[t].label })),
      email: ["valid", "risky", "invalid", "unknown", ""].map(s => ({ value: s, label: EMAIL_STATUS[s].label, count: es.get(s) || 0 })),
    };
  }, [allRows, tagList, filters.vertical, filters.market]);

  const f = withDefaults(filters);
  const moreActive = (f.hasEmail !== "any") + (f.hrListed !== "any") + (f.replied !== "any") + (f.hideDNR ? 1 : 0) + (f.minScore > 0 ? 1 : 0);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 260px", minWidth: 200, maxWidth: 420 }}>
          <span aria-hidden style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--nc-text-3)", fontSize: 13 }}>⌕</span>
          <input ref={searchRef} className="nc-input" style={{ paddingLeft: 30, paddingRight: 52 }} value={filters.q} onChange={e => set({ q: e.target.value })}
            placeholder="Search company, contact, email, notes, tags…" aria-label="Search prospects" />
          <span className="nc-kbd nc-hide-sm" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)" }} title="Press / to search">/</span>
        </div>
        <MultiSelect label="Status" options={opts.status} value={f.status} onChange={v => set({ status: v })} />
        <MultiSelect label="Industry" options={opts.vertical} value={f.vertical} onChange={v => set({ vertical: v })} searchable />
        <MultiSelect label="Market" options={opts.market} value={f.market} onChange={v => set({ market: v })} searchable />
        {f.place.map(k => <span key={k} className="nc-chip active" title="Set from the map">📍 {placeLabel(k)}<button type="button" aria-label={`Remove map area ${placeLabel(k)}`} onClick={() => set({ place: f.place.filter(x => x !== k) })}>×</button></span>)}
        <MultiSelect label="Fit" options={opts.tier} value={f.tier} onChange={v => set({ tier: v })} />
        {tagsEnabled && <MultiSelect label="Tags" options={opts.tags} value={f.tags} onChange={v => set({ tags: v })} searchable empty="No tags yet — add some from a prospect or the bulk bar" />}
        {tagsEnabled && <MultiSelect label="Email" options={opts.email} value={f.emailStatus} onChange={v => set({ emailStatus: v })} />}
        <MultiSelect label="Source" options={opts.source} value={f.source} onChange={v => set({ source: v })} searchable />
        <Popover width={300} trigger={({ open, toggle }) => (
          <button type="button" className={cx("nc-chip", "btn", moreActive && "active")} aria-expanded={open} onClick={toggle}>
            More{moreActive > 0 && <span style={{ background: "var(--nc-gold)", color: "#0B1426", borderRadius: 99, padding: "1px 6px", fontSize: 10 }}>{moreActive}</span>}<span aria-hidden style={{ opacity: .6, fontSize: 9 }}>▾</span>
          </button>)}>
          <div style={{ padding: 8, display: "grid", gap: 14 }}>
            <Row label="Has email"><Segmented label="Has email" value={f.hasEmail} onChange={v => set({ hasEmail: v })} options={[{ value: "any", label: "Any" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }]} /></Row>
            <Row label="HR person listed"><Segmented label="HR person listed" value={f.hrListed} onChange={v => set({ hrListed: v })} options={[{ value: "any", label: "Any" }, { value: "Unknown", label: "Unknown" }, { value: "No", label: "No" }, { value: "Yes", label: "Yes" }]} /></Row>
            <Row label="Replied"><Segmented label="Replied" value={f.replied} onChange={v => set({ replied: v })} options={[{ value: "any", label: "Any" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }]} /></Row>
            <Row label={`Minimum fit score: ${f.minScore || "any"}`}><input type="range" min="0" max="90" step="5" value={f.minScore} onChange={e => set({ minScore: Number(e.target.value) })} aria-label="Minimum fit score" style={{ width: "100%", accentColor: "#C9963A" }} /></Row>
            <label style={{ display: "flex", gap: 9, alignItems: "center", font: "500 12.5px var(--nc-font)", cursor: "pointer" }}><Check checked={f.hideDNR} onChange={e => set({ hideDNR: e.target.checked })} label="Hide Do Not Respond" />Hide "Do Not Respond"</label>
          </div>
        </Popover>
        {active > 0 && <Btn variant="subtle" size="sm" onClick={() => onApplyView({ id: "all", filters: {} })} style={{ color: "var(--nc-red)" }}>✕ Clear {active}</Btn>}
        <div style={{ flex: 1 }} />
        {canEdit && <SaveView onSave={onSaveView} disabled={active === 0} canShare={canSaveShared} isLocal={isLocalSaved} />}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }} role="group" aria-label="Saved views">
        <span style={{ font: "700 10px var(--nc-font)", letterSpacing: ".08em", color: "var(--nc-text-3)", textTransform: "uppercase", marginRight: 4 }}>Views</span>
        {BUILTIN_VIEWS.filter(v => tagsEnabled || v.id !== "unverified").map(v => (
          <button key={v.id} type="button" className={cx("nc-chip", "btn", filtersEqual(filters, v.filters) && "active")} onClick={() => onApplyView(v)}>
            {v.name}<span style={{ opacity: .6 }}>{viewCounts[v.id] ?? ""}</span>
          </button>
        ))}
        {savedItems.map(v => {
          const own = v.mine || v.createdBy === currentUserId; const canDel = own || isAdmin;
          return (
            <span key={v.id} className={cx("nc-chip", filtersEqual(filters, v.params) && "active")} style={{ paddingRight: canDel ? 6 : 9 }}>
              <button type="button" onClick={() => onApplyView({ id: v.id, filters: v.params })} style={{ opacity: 1, fontWeight: 600, font: "inherit", color: "inherit" }} title={v.createdByName ? `Saved by ${v.createdByName}` : undefined}>
                {v.shared && !isLocalSaved ? "👥 " : "★ "}{v.name}
              </button>
              {canDel && <button type="button" aria-label={`Delete saved view ${v.name}`} onClick={() => onDeleteView(v)}>×</button>}
            </span>
          );
        })}
        {savedError && <span style={{ color: "var(--nc-amber)", fontSize: 11 }}>Saved views unavailable: {savedError}</span>}
      </div>
    </div>
  );
}

const Row = ({ label, children }) => <div><div style={{ font: "600 11.5px var(--nc-font)", color: "var(--nc-text-2)", marginBottom: 6 }}>{label}</div>{children}</div>;

function SaveView({ onSave, disabled, canShare, isLocal }){
  const [name, setName] = useState(""); const [shared, setShared] = useState(true); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  return (
    <Popover align="right" width={290} trigger={({ toggle }) => <Btn variant="gold-ghost" size="sm" icon="★" disabled={disabled} onClick={toggle} title={disabled ? "Apply some filters first" : "Save the current filters as a view"}>Save view</Btn>}>
      {({ close }) => (
        <form style={{ padding: 8, display: "grid", gap: 10 }} onSubmit={async e => {
          e.preventDefault(); if (!name.trim()) return; setBusy(true); setErr("");
          try { await onSave(name, shared && canShare && !isLocal); setName(""); close(); } catch (x){ setErr(x.message || "Couldn't save"); } finally { setBusy(false); }
        }}>
          <label style={{ font: "600 11.5px var(--nc-font)", color: "var(--nc-text-2)" }}>View name
            <input className="nc-input" style={{ marginTop: 6 }} autoFocus value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="e.g. Raleigh home health, no HR" />
          </label>
          {canShare && !isLocal && <label style={{ display: "flex", gap: 9, alignItems: "center", font: "500 12px var(--nc-font)", cursor: "pointer" }}><Check checked={shared} onChange={e => setShared(e.target.checked)} label="Share with team" />Share with the team</label>}
          {isLocal && <div style={{ font: "500 11px/1.4 var(--nc-font)", color: "var(--nc-text-3)" }}>Saved in this browser only (team sharing needs the database update).</div>}
          {err && <div role="alert" style={{ color: "var(--nc-red)", fontSize: 12 }}>{err}</div>}
          <Btn variant="primary" type="submit" loading={busy} disabled={!name.trim()}>Save view</Btn>
        </form>
      )}
    </Popover>
  );
}
