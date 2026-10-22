import { useState, useMemo, useCallback, useEffect, useDeferredValue } from "react";
import { EMPTY_FILTERS, BUILTIN_VIEWS, applyFilters, sortList, withDefaults, allTags, countActive } from "../../lib/filters.js";
import { scoreProspect } from "../../lib/scoring.js";
import { findDuplicateGroups, findMatches, buildIndex, pairKeyFor } from "../../lib/dedupe.js";
import { extractEmails } from "../../lib/text.js";
import { placeKey, placeLabel } from "../../lib/geo.js";
import { emailKind } from "../../lib/scoring.js";
import { verifyEmail, mapPool } from "../../lib/emailCheck.js";
import { Btn, Segmented, Popover, Check, EmptyState, useDebounced } from "../../ui/kit.jsx";
import { useSavedSearches, loadDismissed, saveDismissed } from "../useSavedSearches.js";
import FilterBar from "./FilterBar.jsx";
import ProspectTable, { COLUMNS } from "./ProspectTable.jsx";
import ProspectDrawer from "./ProspectDrawer.jsx";
import BulkBar from "./BulkBar.jsx";
import TerritoryMap from "./TerritoryMap.jsx";
import DuplicatesView from "./DuplicatesView.jsx";
import LeadQualification from "./LeadQualification.jsx";

const PREF_KEY = "nc_prospect_prefs";
const DEFAULT_PREFS = { compact: false, pageSize: 50, cols: { contact: true, fit: true, email: true, vertical: true, market: true, next: true, tags: true } };
const loadPrefs = () => { try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || "null"); return p ? { ...DEFAULT_PREFS, ...p, cols: { ...DEFAULT_PREFS.cols, ...(p.cols || {}) } } : DEFAULT_PREFS; } catch { return DEFAULT_PREFS; } };

/** The email most worth checking: a named person's before a generic mailbox. */
const primaryEmail = p => { const e = extractEmails(p.emailPhone); return e.find(x => emailKind(x) === "personal") || e.find(x => emailKind(x) === "hr") || e[0]; };

export default function ProspectsView({
  crmData, role, currentUser, canEdit, features, sysSettings, savedApi, hunterVerify, applyStatus,
  onEditProspect, onAddProspect, onOpenFinder, onOpenImport, onExport, onBulkSave, onDeleteMany, onMerge, toast,
  qualifyRequest, onQualifyUpdate, onWorkspaceAction,
}){
  const tagsEnabled = !!features?.tags;
  const [prefs, setPrefsState] = useState(loadPrefs);
  const setPrefs = patch => setPrefsState(p => { const n = { ...p, ...patch }; try { localStorage.setItem(PREF_KEY, JSON.stringify(n)); } catch { /* ignore */ } return n; });

  const [mode, setMode] = useState("table");
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [sort, setSort] = useState({ key: "score", dir: "desc" });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [lastCheck, setLastCheck] = useState({});
  const [verifyingId, setVerifyingId] = useState(null);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [manualGroup, setManualGroup] = useState(null);
  const [mergingId, setMergingId] = useState(null);
  const [qualifyId, setQualifyId] = useState(null);
  // Other parts of the workspace can ask to open a prospect in Qualification
  useEffect(() => { if (qualifyRequest){ setQualifyId(qualifyRequest.id || null); setMode("qualify"); } }, [qualifyRequest]);

  /* ── derived data ─────────────────────────────────────────── */
  const scoreMap = useMemo(() => { const m = new Map(); for (const p of crmData) m.set(p.id, scoreProspect(p)); return m; }, [crmData]);
  const scoreOf = useCallback(p => scoreMap.get(p.id) || scoreProspect(p), [scoreMap]);
  const q = useDebounced(filters.q, 160);
  const effective = useMemo(() => ({ ...filters, q }), [filters, q]);
  const filtered = useMemo(() => sortList(applyFilters(crmData, effective, scoreOf), sort.key, sort.dir, scoreOf), [crmData, effective, sort, scoreOf]);
  const tagList = useMemo(() => allTags(crmData), [crmData]);
  // markets actually present in the data (most common first) — nationwide, not a fixed NC list
  const marketOptions = useMemo(() => { const c = new Map(); for (const p of crmData) if (p.market) c.set(p.market, (c.get(p.market) || 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30).map(([m]) => m); }, [crmData]);
  const viewCounts = useMemo(() => Object.fromEntries(BUILTIN_VIEWS.map(v => [v.id, applyFilters(crmData, withDefaults(v.filters), scoreOf).length])), [crmData, scoreOf]);

  const deferred = useDeferredValue(crmData);
  const dupGroups = useMemo(() => findDuplicateGroups(deferred, { dismissed }), [deferred, dismissed]);
  const dupOf = useMemo(() => { const m = new Map(); for (const g of dupGroups) for (const x of g.members) m.set(x.id, { level: g.level, size: g.members.length }); return m; }, [dupGroups]);

  const pageSize = prefs.pageSize;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const rows = useMemo(() => filtered.slice(safePage * pageSize, (safePage + 1) * pageSize), [filtered, safePage, pageSize]);

  useEffect(() => { setPage(0); }, [effective, sort]);
  useEffect(() => { setSelected(prev => { const ids = new Set(crmData.map(p => p.id)); const next = new Set([...prev].filter(id => ids.has(id))); return next.size === prev.size ? prev : next; }); }, [crmData]);

  const openProspect = openId ? crmData.find(p => p.id === openId) : null;
  useEffect(() => { if (openId && !openProspect) setOpenId(null); }, [openId, openProspect]);
  const dupIndex = useMemo(() => openProspect ? buildIndex(crmData) : null, [crmData, !!openProspect]); // eslint-disable-line react-hooks/exhaustive-deps
  const dupMatches = useMemo(() => openProspect && dupIndex ? findMatches(openProspect, dupIndex, { excludeId: openProspect.id }) : [], [openProspect, dupIndex]);

  const saved = useSavedSearches("prospects", savedApi, { enabled: true, currentUser });

  /* ── selection ────────────────────────────────────────────── */
  const toggle = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePage = () => setSelected(s => { const n = new Set(s); const all = rows.every(r => n.has(r.id)); rows.forEach(r => all ? n.delete(r.id) : n.add(r.id)); return n; });
  const selectAllFiltered = () => setSelected(new Set(filtered.map(p => p.id)));
  const selectedRows = useMemo(() => crmData.filter(p => selected.has(p.id)), [crmData, selected]);
  const selectedTags = useMemo(() => allTags(selectedRows), [selectedRows]);

  /* ── applying changes ─────────────────────────────────────── */
  const run = useCallback(async (label, ids, fn, okMsg) => {
    setBusy({ label, done: 0, total: 0 });
    try {
      const r = await onBulkSave(ids.map(id => ({ id, patch: fn })));
      if (r.failed) toast(`${r.ok} updated, ${r.failed} couldn't be saved (check your permissions)`, "err");
      else toast(okMsg || `${r.ok} updated`);
    } finally { setBusy(null); }
  }, [onBulkSave, toast]);

  const ids = () => [...selected];
  const actions = {
    setStatus: s => run("Updating status", ids(), p => applyStatus(p, s), `Moved ${selected.size} to “${s}”`),
    addTags: tags => run("Adding tags", ids(), p => ({ ...p, tags: [...new Set([...(p.tags || []), ...tags])].slice(0, 30) }), `Tagged ${selected.size} prospect${selected.size === 1 ? "" : "s"}`),
    removeTag: t => run("Removing tag", ids(), p => ({ ...p, tags: (p.tags || []).filter(x => x !== t) }), `Removed “${t}”`),
    setField: (f, v) => run("Updating", ids(), p => ({ ...p, [f]: v }), `Set ${f === "vertical" ? "industry" : f} to “${v}”`),
    setDnr: on => run("Updating", ids(), p => ({ ...p, doNotRespond: on, currentStatus: on ? "Do Not Respond" : (p.currentStatus === "Do Not Respond" ? "NEW" : p.currentStatus) }), on ? "Marked Do Not Respond" : "Restored"),
    verify: () => verifyRows(selectedRows),
    export: () => onExport(selected.size ? selectedRows : filtered, selected.size ? "NC_CRM_selected" : "NC_CRM_filtered"),
    merge: () => { setManualGroup({ id: "manual", members: selectedRows, reasons: ["Selected by you"], level: "manual" }); setMode("duplicates"); },
    remove: async () => {
      if (!window.confirm(`Delete ${selected.size} prospect${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
      setBusy({ label: "Deleting", done: 0, total: 0 });
      try { const r = await onDeleteMany(ids()); setSelected(new Set()); toast(r.failed ? `${r.ok} deleted, ${r.failed} failed` : `${r.ok} deleted`, r.failed ? "err" : "ok"); } finally { setBusy(null); }
    },
  };

  const verifyRows = async list => {
    const targets = list.filter(p => primaryEmail(p));
    if (!targets.length){ toast("None of these prospects have an email address.", "err"); return null; }
    const label = "Verifying emails";
    setBusy({ label, done: 0, total: targets.length });
    try {
      const results = await mapPool(targets, 4, async p => ({ id: p.id, r: await verifyEmail(primaryEmail(p), { hunterVerify }) }), (done, total) => setBusy({ label, done, total }));
      setLastCheck(c => ({ ...c, ...Object.fromEntries(results.map(x => [x.id, x.r])) }));
      const byId = new Map(results.map(x => [x.id, x.r]));
      await onBulkSave(targets.map(p => ({ id: p.id, patch: { emailStatus: byId.get(p.id).status === "unknown" ? (p.emailStatus || "unknown") : byId.get(p.id).status, emailCheckedAt: byId.get(p.id).checkedAt } })));
      const n = s => results.filter(x => x.r.status === s).length;
      toast(`${n("valid")} valid · ${n("risky")} risky · ${n("invalid")} invalid${n("unknown") ? ` · ${n("unknown")} couldn't be checked` : ""}`, n("invalid") || n("unknown") ? "err" : "ok");
      return results;
    } finally { setBusy(null); }
  };

  const patchOne = useCallback(async (id, patch) => {
    const fn = p => {
      if (Object.keys(patch).length === 1 && "currentStatus" in patch) return applyStatus(p, patch.currentStatus);
      if ("doNotRespond" in patch) return { ...p, ...patch, currentStatus: patch.doNotRespond ? "Do Not Respond" : (p.currentStatus === "Do Not Respond" ? "NEW" : p.currentStatus) };
      return { ...p, ...patch };
    };
    const r = await onBulkSave([{ id, patch: fn }]);
    if (r.failed) toast("Couldn't save that change", "err");
  }, [onBulkSave, applyStatus, toast]);

  /* ── saved views ──────────────────────────────────────────── */
  const applyView = v => { setFilters({ ...EMPTY_FILTERS, ...(v.filters || {}) }); setPage(0); };
  const saveView = async (name, shared) => { await saved.save(name, { ...filters, q: filters.q.trim() }, shared); toast(`View “${name}” saved`); };
  const deleteView = async v => { try { await saved.remove(v.id); toast("View deleted"); } catch (e){ toast(e.message || "Couldn't delete", "err"); } };

  /* ── duplicates ───────────────────────────────────────────── */
  const dismissGroup = g => { const n = new Set(dismissed); for (let i = 0; i < g.members.length; i++) for (let j = i + 1; j < g.members.length; j++) n.add(pairKeyFor(g.members[i].id, g.members[j].id)); setDismissed(n); saveDismissed(n); };
  const mergeGroup = async (merged, deleteIds, g) => {
    setMergingId(g.id);
    try { const ok = await onMerge(merged, deleteIds); if (ok && g.id === "manual") { setManualGroup(null); setSelected(new Set()); } } finally { setMergingId(null); }
  };
  const flagGroup = g => run("Flagging", g.members.map(m => m.id), p => ({ ...p, tags: [...new Set([...(p.tags || []), "possible-duplicate"])] }), "Flagged for admin review");

  const active = countActive(filters);
  const exportNow = () => onExport(selected.size ? selectedRows : filtered, selected.size ? "NC_CRM_selected" : active ? "NC_CRM_filtered" : "NC_CRM");

  /* ── render ───────────────────────────────────────────────── */
  const visibleCols = { ...prefs.cols, tags: prefs.cols.tags && tagsEnabled };
  return (
    <div className="nc nc-fade">
      <div className="nc-toolbar" style={{ padding: "12px 16px 12px", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Segmented label="View" value={mode} onChange={setMode} options={[
            { value: "table", label: "Table", icon: "☰" }, { value: "map", label: "Map", icon: "🗺" },
            { value: "duplicates", label: "Duplicates", icon: "⇄", badge: dupGroups.length, badgeColor: "var(--nc-amber)" },
            { value: "qualify", label: "Qualification", icon: "✔" },
          ]} />
          <div style={{ flex: 1 }} />
          <Btn variant="gold-ghost" icon="🔍" onClick={onOpenFinder}>Find prospects</Btn>
          {canEdit && <Btn icon="⬆" onClick={onOpenImport}>Import</Btn>}
          <Btn icon="⬇" onClick={exportNow} disabled={!crmData.length}>{selected.size ? `Export ${selected.size}` : "Export"}</Btn>
          {canEdit && <Btn variant="primary" icon="+" onClick={onAddProspect}>Add prospect</Btn>}
        </div>
        {(mode === "table" || mode === "map") && (
          <FilterBar filters={filters} setFilters={setFilters} allRows={crmData} tagList={tagList} tagsEnabled={tagsEnabled}
            savedItems={saved.items} canEdit={canEdit} canSaveShared={!saved.isLocal} isLocalSaved={saved.isLocal} savedError={saved.error}
            onSaveView={saveView} onDeleteView={deleteView} onApplyView={applyView} viewCounts={viewCounts}
            currentUserId={currentUser?.id} isAdmin={!!role?.canAdmin} />
        )}
      </div>

      <div style={{ padding: "14px 16px 110px" }}>
        {mode === "table" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ font: "600 12.5px var(--nc-font)", color: "var(--nc-text-2)" }}>
                <b style={{ color: "var(--nc-text)" }}>{filtered.length.toLocaleString()}</b> of {crmData.length.toLocaleString()} prospects{active > 0 && " match your filters"}
              </div>
              <div style={{ flex: 1 }} />
              <Popover align="right" width={210} trigger={({ toggle }) => <Btn size="sm" variant="subtle" onClick={toggle}>▥ Columns</Btn>}>
                <div style={{ padding: 4 }}>
                  {COLUMNS.filter(c => !c.always).map(c => (
                    <label key={c.id} className="nc-menu-item" style={{ cursor: "pointer" }}>
                      <Check checked={!!prefs.cols[c.id]} onChange={e => setPrefs({ cols: { ...prefs.cols, [c.id]: e.target.checked } })} label={c.label} />{c.label}
                    </label>
                  ))}
                </div>
              </Popover>
              <Segmented label="Row density" value={prefs.compact ? "compact" : "comfortable"} onChange={v => setPrefs({ compact: v === "compact" })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
            </div>

            {crmData.length === 0 ? (
              <EmptyState icon="🌱" title="Your prospect list is empty" action={<div style={{ display: "flex", gap: 8, justifyContent: "center" }}><Btn variant="primary" onClick={onOpenFinder}>🔍 Find prospects</Btn>{canEdit && <Btn onClick={onOpenImport}>⬆ Import a spreadsheet</Btn>}</div>}>
                Search live nonprofit, healthcare and business directories, or import the list you already have.
              </EmptyState>
            ) : filtered.length === 0 ? (
              <EmptyState icon="🔎" title="No prospects match" action={<Btn onClick={() => applyView({ filters: {} })}>Clear all filters</Btn>}>
                Try removing a filter or searching for a different word.
              </EmptyState>
            ) : (
              <>
                <ProspectTable rows={rows} selected={selected} onToggle={toggle} onTogglePage={togglePage} sort={sort}
                  onSort={key => setSort(s => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "score" ? "desc" : "asc" })}
                  cols={visibleCols} compact={prefs.compact} onOpen={p => setOpenId(p.id)} openId={openId} scoreOf={scoreOf} dupOf={dupOf}
                  onEdit={onEditProspect} canEdit={canEdit} tagsEnabled={tagsEnabled} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, flexWrap: "wrap", gap: 10, font: "500 12px var(--nc-font)", color: "var(--nc-text-2)" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>Rows per page
                    <select className="nc-select" style={{ width: "auto" }} value={pageSize} onChange={e => setPrefs({ pageSize: Number(e.target.value) })} aria-label="Rows per page">{[25, 50, 100, 250].map(n => <option key={n} value={n}>{n}</option>)}</select>
                  </label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span>{safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)} of {filtered.length.toLocaleString()}</span>
                    <Btn size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Previous page">‹</Btn>
                    <Btn size="sm" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} aria-label="Next page">›</Btn>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {mode === "map" && <TerritoryMap rows={filtered} scoreOf={scoreOf} onOpen={p => setOpenId(p.id)} onPickPlace={k => { setFilters(f => ({ ...f, place: [k] })); setMode("table"); }} />}

        {mode === "qualify" && (
          <div className="pf-embed">
            <LeadQualification crmData={crmData} initialProspectId={qualifyId} canEdit={canEdit} onUpdateProspect={onQualifyUpdate} onOpenCRM={() => setMode("table")} />
          </div>
        )}

        {mode === "duplicates" && (
          <DuplicatesView groups={dupGroups} manualGroup={manualGroup} onClearManual={() => setManualGroup(null)}
            canMerge={!!role?.canDelete} tagsEnabled={tagsEnabled} scoreOf={scoreOf} busy={mergingId}
            onMerge={(merged, delIds, g) => mergeGroup(merged, delIds, { ...g })} onDismiss={dismissGroup} onFlag={flagGroup}
            onOpen={p => setOpenId(p.id)} />
        )}
      </div>

      {selected.size > 0 && mode === "table" && (
        <BulkBar marketOptions={marketOptions} count={selected.size} filteredCount={filtered.length} onSelectAllFiltered={selectAllFiltered} onClear={() => setSelected(new Set())}
          canEdit={canEdit} canDelete={!!role?.canDelete} tagsEnabled={tagsEnabled} tagList={tagList} selectedTags={selectedTags} busy={busy} actions={actions} />
      )}

      {openProspect && (
        <ProspectDrawer prospect={openProspect} scoreResult={scoreOf(openProspect)} canEdit={canEdit} tagsEnabled={tagsEnabled} tagList={tagList}
          dupMatches={dupMatches} lastCheck={lastCheck[openProspect.id]} verifying={verifyingId === openProspect.id} hunterOn={!!hunterVerify}
          onClose={() => setOpenId(null)} onPatch={patch => patchOne(openProspect.id, patch)} onQualify={p => { setOpenId(null); setQualifyId(p.id); setMode("qualify"); }}
          onEmail={onWorkspaceAction ? p => { setOpenId(null); onWorkspaceAction("email", p); } : undefined}
          onSchedule={onWorkspaceAction ? p => { setOpenId(null); onWorkspaceAction("task", p); } : undefined}
          onShowOnMap={p => {
            const k = placeKey(p);
            if (!k){ toast("This prospect has no recognised U.S. state or city yet — set its Market first.", "err"); return; }
            setOpenId(null); setFilters(f => ({ ...EMPTY_FILTERS, place: [k] })); setMode("map"); toast(`Showing ${placeLabel(k)} on the map`);
          }}
          onEdit={p => { setOpenId(null); onEditProspect(p); }} onOpenOther={p => setOpenId(p.id)}
          onVerify={async () => { setVerifyingId(openProspect.id); try { await verifyRows([openProspect]); } finally { setVerifyingId(null); } }} />
      )}
    </div>
  );
}
