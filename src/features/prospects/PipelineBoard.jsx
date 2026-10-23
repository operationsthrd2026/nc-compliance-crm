/* ════════════════════════════════════════════════════════════════
   Pipeline board. A card can be moved by dragging (mouse) OR with its "Move to…" menu (keyboard, touch, screen readers).
   • Every move goes through the cadence logic (applyStatus), so dates are set exactly as everywhere else.
   • A move that RECORDS a send asks first and lists what it will change; nothing is saved until the person confirms.
   • A refused save is reported and nothing else changes; every move can be undone for a few seconds.
   • Do Not Respond prospects are hidden by default and can never be moved into outreach.
════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../../ui/icons.jsx";
import { Btn, ScoreRing, EmptyState } from "../../ui/kit.jsx";
import { VERTICALS } from "../../constants.js";
import { PIPE_STAGES, buildBoard, canMove, movePlan, stageById } from "../../lib/pipeline.js";
import { locationLinks } from "../../lib/maps.js";

const when = n => n == null ? "" : n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;

export default function PipelineBoard({ crmData = [], canEdit = false, applyStatus, onSaveOne, onEdit, onAdd, onWriteEmail, toast = () => {} }){
  const [query, setQuery] = useState(""), [vertical, setVertical] = useState(""), [market, setMarket] = useState("");
  const [needsAction, setNeedsAction] = useState(false), [showDNR, setShowDNR] = useState(false), [hideEmpty, setHideEmpty] = useState(false);
  const [dragId, setDragId] = useState(null), [overId, setOverId] = useState(null), [busyIds, setBusyIds] = useState([]);
  const [confirm, setConfirm] = useState(null), [undo, setUndo] = useState(null), [error, setError] = useState(""), [said, setSaid] = useState("");
  const confirmRef = useRef(null);

  const board = useMemo(() => buildBoard(crmData, { query, vertical, market, needsAction, hideDNR: !showDNR }), [crmData, query, vertical, market, needsAction, showDNR]);
  const markets = useMemo(() => [...new Set(crmData.map(p => p.market || p.cityMarket).filter(Boolean))].sort(), [crmData]);
  const filtered = !!(query || vertical || market || needsAction);

  useEffect(() => { if (confirm) confirmRef.current?.focus(); }, [confirm]);
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 12000); return () => clearTimeout(t); }, [undo]);

  const busy = (id, on) => setBusyIds(b => on ? [...b, String(id)] : b.filter(x => x !== String(id)));
  const doMove = async (p, stageId) => {
    const stage = stageById(stageId), prev = { ...p }; setError(""); busy(p.id, true);
    try {
      const res = await onSaveOne(p.id, cur => applyStatus(cur, stageId));
      if (res.failed){ setError(`Couldn't move ${p.companyName || "this prospect"} (check your permissions). Nothing was changed.`); return; }
      setUndo({ id: p.id, prev, text: `Moved ${p.companyName || "prospect"} to ${stage.label}` }); setSaid(`Moved ${p.companyName} to ${stage.label}`);
    } catch (e){ setError(e?.message || "Couldn't move this prospect. Nothing was changed."); }
    finally { busy(p.id, false); }
  };
  const attempt = (p, stageId) => {
    const v = canMove(p, stageId, { canEdit });
    if (!v.ok){ if (!v.silent) setError(v.reason); return; }
    setError("");
    if (v.needsConfirm) setConfirm({ p, stageId, skips: v.skips, plan: movePlan(p, stageId, applyStatus) });
    else doMove(p, stageId);
  };
  const undoMove = async () => {
    const u = undo; if (!u) return; setUndo(null); busy(u.id, true);
    try { const res = await onSaveOne(u.id, () => u.prev); if (res.failed) setError("Couldn't undo that move."); else { toast("Move undone"); setSaid("Move undone"); } }
    finally { busy(u.id, false); }
  };
  const drop = (e, stageId) => {
    e.preventDefault(); const id = dragId ?? e.dataTransfer?.getData?.("text/plain"); setDragId(null); setOverId(null);
    const p = crmData.find(x => String(x.id) === String(id)); if (p) attempt(p, stageId);
  };

  if (!crmData.length) return <div className="nc"><EmptyState icon="🗂️" title="Your pipeline is empty" action={canEdit ? <Btn variant="primary" onClick={() => onAdd("NEW")}>Add a prospect</Btn> : null}>Add your first prospect, or find some in Find prospects.</EmptyState></div>;

  return (
    <div className="pb nc">
      <div className="pb-bar" role="search">
        <input className="nc-input pb-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search company, contact, email…" aria-label="Search the pipeline" />
        <select className="nc-select" value={vertical} onChange={e => setVertical(e.target.value)} aria-label="Filter by industry"><option value="">All industries</option>{VERTICALS.map(v => <option key={v}>{v}</option>)}</select>
        <select className="nc-select" value={market} onChange={e => setMarket(e.target.value)} aria-label="Filter by market"><option value="">All markets</option>{markets.map(m => <option key={m}>{m}</option>)}</select>
        <button type="button" className="nc-chip" aria-pressed={needsAction} onClick={() => setNeedsAction(v => !v)}>Needs action</button>
        <button type="button" className="nc-chip" aria-pressed={showDNR} onClick={() => setShowDNR(v => !v)}>Show Do Not Respond</button>
        <button type="button" className="nc-chip" aria-pressed={hideEmpty} onClick={() => setHideEmpty(v => !v)}>Hide empty stages</button>
        {filtered && <button type="button" className="td-link" onClick={() => { setQuery(""); setVertical(""); setMarket(""); setNeedsAction(false); }}>Clear filters</button>}
        <span className="pb-pills" aria-label="Summary">
          <span className="pb-pill">{board.total} prospect{board.total === 1 ? "" : "s"}</span>
          {board.overdue > 0 && <span className="pb-pill red">{board.overdue} overdue</span>}
          {board.replies > 0 && <span className="pb-pill green">{board.replies} replied</span>}
        </span>
        {canEdit && <Btn variant="primary" size="sm" icon="＋" onClick={() => onAdd("NEW")}>Add prospect</Btn>}
      </div>

      {error && <div className="od-issue block" role="alert"><Icon name="alert" size={16} /><span style={{ flex: 1 }}>{error}</span><button type="button" className="td-link" onClick={() => setError("")}>Dismiss</button></div>}

      <div className="pb-board" role="region" aria-label="Pipeline board">
        {board.columns.filter(c => !(hideEmpty && c.count === 0)).map(({ stage, cards, count, overdue, replies, avgFit }) => (
          <section key={stage.id} className={`pb-col tone-${stage.tone} ${overId === stage.id ? "over" : ""}`} aria-label={`${stage.label}, ${count} prospect${count === 1 ? "" : "s"}`}
            onDragOver={e => { if (dragId == null) return; e.preventDefault(); if (overId !== stage.id) setOverId(stage.id); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOverId(o => o === stage.id ? null : o); }}
            onDrop={e => drop(e, stage.id)}>
            <header className="pb-col-h" title={stage.hint}>
              <div className="pb-col-t"><span>{stage.label}</span><b>{count}</b></div>
              <div className="pb-col-s">
                {overdue > 0 && <span className="pb-flag red">{overdue} overdue</span>}
                {replies > 0 && <span className="pb-flag green">{replies} replied</span>}
                {count > 0 && <span className="pb-flag">avg fit {avgFit}</span>}
                {count === 0 && <span className="pb-flag">{stage.hint}</span>}
              </div>
            </header>
            <ul className="pb-cards">
              {cards.map(({ p, fit, chip, since, eligible }) => {
                const links = locationLinks(p), isBusy = busyIds.includes(String(p.id));
                return (
                  <li key={p.id} className={`pb-card ${dragId === p.id ? "drag" : ""} ${isBusy ? "busy" : ""}`} draggable={canEdit && !isBusy}
                    onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(p.id)); setDragId(p.id); }}
                    onDragEnd={() => { setDragId(null); setOverId(null); }} aria-busy={isBusy || undefined}>
                    <button type="button" className="pb-card-main" onClick={() => onEdit(p)} aria-label={`Open ${p.companyName || "prospect"}`}>
                      <span className="pb-title">{p.companyName || "(unnamed)"}</span>
                      <span className="pb-sub">{[p.contactName, p.title].filter(Boolean).join(" · ") || "No contact yet"}</span>
                    </button>
                    <div className="pb-row">
                      <ScoreRing score={fit.score} color={fit.color} size={28} />
                      <span className={`pb-chip ${chip.tone}`}>{chip.text}</span>
                    </div>
                    <div className="pb-meta">
                      {(p.cityMarket || p.market) && <span>{p.cityMarket || p.market}</span>}
                      {since != null && <span>Last touch {when(since)}</span>}
                      {p.flagToMelissa && <span title="Flagged for Melissa"><Icon name="alert" size={12} /> Flagged</span>}
                      {p.t3Approved && <span title="Touch 3 approved"><Icon name="check" size={12} /> T3 approved</span>}
                    </div>
                    <div className="pb-actions">
                      {eligible.canOpenEmail && onWriteEmail && <button type="button" className="nc-btn ghost sm" onClick={() => onWriteEmail(p.id)} aria-label={`Write an email to ${p.companyName}`}><Icon name="mail" size={14} />Email</button>}
                      {links.streetView && <a className="nc-btn ghost sm" href={links.streetView} target="_blank" rel="noopener noreferrer" aria-label={`Street View of ${p.companyName}`}><Icon name="map" size={14} />Street</a>}
                      {canEdit && (
                        <select className="pb-move" value="" aria-label={`Move ${p.companyName || "prospect"} to another stage`} onChange={e => { if (e.target.value) attempt(p, e.target.value); }}>
                          <option value="">Move to…</option>
                          {PIPE_STAGES.filter(s => s.id !== p.currentStatus).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                      )}
                    </div>
                  </li>
                );
              })}
              {count === 0 && <li className="pb-empty">{filtered ? "No matches here" : dragId != null ? "Drop here" : "Nothing in this stage"}</li>}
            </ul>
            {canEdit && <button type="button" className="pb-quick" onClick={() => onAdd(stage.id)}>＋ Add here</button>}
          </section>
        ))}
      </div>
      {board.hidden > 0 && <p className="td-muted" style={{ margin: "2px 4px" }}>{board.hidden} prospect{board.hidden === 1 ? " is" : "s are"} in a stage that is not on the board (for example Do Not Respond). Use the Prospects list to see them.</p>}

      {confirm && (
        <div className="nc-cmd-scrim" onMouseDown={e => { if (e.target === e.currentTarget) setConfirm(null); }}>
          <div className="nc-cmd pb-confirm" role="dialog" aria-modal="true" aria-label={confirm.plan.title} onKeyDown={e => { if (e.key === "Escape") setConfirm(null); }}>
            <h2 style={{ margin: 0, font: "750 18px var(--nc-font)" }}>{confirm.plan.title}</h2>
            <p className="td-muted" style={{ margin: "6px 0 10px" }}>Nothing has been saved yet. If you confirm, this will:</p>
            <ul className="od-plan">{confirm.plan.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            {confirm.skips && <div className="od-issue warn" style={{ marginTop: 10 }}><Icon name="alert" size={16} /><span>This skips an earlier touch — its date will stay empty.</span></div>}
            <div className="od-actions" style={{ marginTop: 14 }}>
              <button ref={confirmRef} type="button" className="nc-btn primary" onClick={() => { const c = confirm; setConfirm(null); doMove(c.p, c.stageId); }}>Yes — {confirm.plan.title.replace("?", "").toLowerCase()}</button>
              <Btn variant="ghost" onClick={() => setConfirm(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
      {undo && <div className="pb-undo" role="status"><span>{undo.text}</span><button type="button" onClick={undoMove}>Undo</button></div>}
      <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{said}</div>
    </div>
  );
}
