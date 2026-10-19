import { useState } from "react";
import { STATUSES, VERTICALS, MARKETS } from "../../constants.js";
import { Btn, Popover, MenuItem, TagInput, Spinner } from "../../ui/kit.jsx";
import { cleanTag } from "../../lib/filters.js";

export default function BulkBar({ count, filteredCount, onSelectAllFiltered, onClear, canEdit, canDelete, tagsEnabled, tagList, selectedTags, busy, actions }){
  const [toAdd, setToAdd] = useState([]);
  const allSelected = count >= filteredCount;
  return (
    <div className="nc-bulk" role="toolbar" aria-label="Bulk actions">
      <span style={{ font: "700 12.5px var(--nc-font)", padding: "0 8px", whiteSpace: "nowrap" }}>{count} selected</span>
      {!allSelected && <Btn variant="subtle" size="sm" onClick={onSelectAllFiltered}>Select all {filteredCount}</Btn>}
      <span style={{ width: 1, height: 22, background: "var(--nc-border-2)" }} aria-hidden />
      {busy ? (
        <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "0 10px", font: "600 12.5px var(--nc-font)" }}>
          <Spinner size={14} color="var(--nc-gold-l)" />{busy.label}{busy.total ? ` ${busy.done}/${busy.total}` : "…"}
        </span>
      ) : canEdit ? (
        <>
          <Popover up trigger={({ toggle }) => <Btn size="sm" onClick={toggle}>Status ▾</Btn>}>
            {({ close }) => <div style={{ maxHeight: 300, overflowY: "auto" }}>{STATUSES.map(s => <MenuItem key={s} onClick={() => { close(); actions.setStatus(s); }}>{s}</MenuItem>)}</div>}
          </Popover>

          <Popover up width={290} trigger={({ toggle }) => <Btn size="sm" onClick={toggle} disabled={!tagsEnabled} title={tagsEnabled ? "" : "Needs the database update"}>Tags ▾</Btn>}>
            {({ close }) => (
              <div style={{ padding: 8, display: "grid", gap: 10 }}>
                <div style={{ font: "700 10px var(--nc-font)", letterSpacing: ".08em", color: "var(--nc-text-3)", textTransform: "uppercase" }}>Add tags to {count}</div>
                <TagInput value={toAdd} onChange={setToAdd} suggestions={tagList} placeholder="e.g. q4-outreach" />
                <Btn variant="primary" size="sm" disabled={!toAdd.length} onClick={() => { actions.addTags(toAdd.map(cleanTag)); setToAdd([]); close(); }}>Add {toAdd.length || ""} tag{toAdd.length === 1 ? "" : "s"}</Btn>
                {selectedTags.length > 0 && <>
                  <div className="nc-menu-sep" />
                  <div style={{ font: "700 10px var(--nc-font)", letterSpacing: ".08em", color: "var(--nc-text-3)", textTransform: "uppercase" }}>Remove from selection</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{selectedTags.map(([t, n]) => <button key={t} type="button" className="nc-tag" style={{ cursor: "pointer" }} onClick={() => { actions.removeTag(t); close(); }}>{t} · {n} ✕</button>)}</div>
                </>}
              </div>
            )}
          </Popover>

          <Popover up trigger={({ toggle }) => <Btn size="sm" onClick={toggle}>Set ▾</Btn>}>
            {({ close }) => (
              <div style={{ maxHeight: 340, overflowY: "auto" }}>
                <div className="nc-menu-label">Industry</div>
                {VERTICALS.map(v => <MenuItem key={v} onClick={() => { close(); actions.setField("vertical", v); }}>{v}</MenuItem>)}
                <div className="nc-menu-sep" /><div className="nc-menu-label">Market</div>
                {MARKETS.map(m => <MenuItem key={m} onClick={() => { close(); actions.setField("market", m); }}>{m}</MenuItem>)}
              </div>
            )}
          </Popover>

          <Btn size="sm" onClick={actions.verify} disabled={!tagsEnabled} title={tagsEnabled ? "Check email addresses" : "Needs the database update"}>✓ Verify emails</Btn>
          <Popover up trigger={({ toggle }) => <Btn size="sm" onClick={toggle} aria-label="More actions">⋯</Btn>}>
            {({ close }) => <>
              <MenuItem onClick={() => { close(); actions.setDnr(true); }}>🚫 Mark Do Not Respond</MenuItem>
              <MenuItem onClick={() => { close(); actions.setDnr(false); }}>Undo Do Not Respond</MenuItem>
              <div className="nc-menu-sep" />
              <MenuItem disabled={!canDelete || count < 2 || count > 6} onClick={() => { close(); actions.merge(); }} title={!canDelete ? "Admins only" : "Pick 2–6 records"}>⇄ Merge selected…</MenuItem>
              <MenuItem disabled={!canDelete} onClick={() => { close(); actions.remove(); }} style={{ color: "var(--nc-red)" }}>🗑 Delete {count}…</MenuItem>
            </>}
          </Popover>
        </>
      ) : <span style={{ color: "var(--nc-text-3)", fontSize: 12, padding: "0 8px" }}>View-only access</span>}
      <Btn size="sm" onClick={actions.export} disabled={!!busy}>⬇ Export</Btn>
      <Btn variant="subtle" size="icon" onClick={onClear} aria-label="Clear selection">✕</Btn>
    </div>
  );
}
