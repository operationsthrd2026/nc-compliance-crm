import { useState, useMemo } from "react";
import { mergeProspects, suggestKeeper } from "../../lib/dedupe.js";
import { extractEmails } from "../../lib/text.js";
import { Btn, StatusPill, EmptyState, ScoreBadge } from "../../ui/kit.jsx";

const MERGE_FIELDS = ["contactName", "title", "emailPhone", "cityMarket", "market", "sourceUrl", "vertical", "orgSize", "hrPersonListed", "hrPeopleContact"];

function Group({ g, canMerge, tagsEnabled, onMerge, onDismiss, onFlag, onOpen, scoreOf, busy }){
  const [keeperId, setKeeperId] = useState(() => suggestKeeper(g.members).id);
  const [confirm, setConfirm] = useState(false);
  const keeper = g.members.find(m => m.id === keeperId) || g.members[0];
  const others = g.members.filter(m => m.id !== keeper.id);
  const merged = useMemo(() => mergeProspects(keeper, others), [keeper, others]);
  const filled = MERGE_FIELDS.filter(f => !String(keeper[f] || "").trim() && String(merged[f] || "").trim());
  const high = g.level === "high";
  return (
    <div className="nc-card" style={{ padding: 16, borderColor: high ? "rgba(251,191,36,.3)" : undefined }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span className="nc-pill" style={{ background: high ? "rgba(251,191,36,.12)" : "rgba(240,244,255,.06)", color: high ? "var(--nc-amber)" : "var(--nc-text-2)", borderColor: high ? "rgba(251,191,36,.35)" : "var(--nc-border-2)" }}>
          {g.level === "manual" ? "Manual merge" : high ? "Likely duplicate" : "Possible duplicate"}
        </span>
        {g.reasons.slice(0, 4).map(r => <span key={r} className="nc-chip">{r}</span>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(g.members.length, 3)}, minmax(0,1fr))`, gap: 10 }}>
        {g.members.map(m => {
          const isKeep = m.id === keeper.id; const sc = scoreOf(m);
          return (
            <label key={m.id} className="nc-card" style={{ padding: 12, cursor: canMerge ? "pointer" : "default", borderColor: isKeep ? "var(--nc-gold-b)" : undefined, background: isKeep ? "rgba(201,150,58,.07)" : "var(--nc-surface-2)", display: "block" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                {canMerge && <input type="radio" name={`keep-${g.id}`} checked={isKeep} onChange={() => { setKeeperId(m.id); setConfirm(false); }} style={{ accentColor: "#C9963A", marginTop: 3 }} aria-label={`Keep ${m.companyName}`} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="nc-trunc" style={{ font: "800 13px var(--nc-font)" }}>{m.companyName}</div>
                  <div style={{ margin: "5px 0", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><StatusPill status={m.currentStatus} /><ScoreBadge result={sc} size={24} /></div>
                  {[["Contact", [m.contactName, m.title].filter(Boolean).join(", ")], ["Email", extractEmails(m.emailPhone).join(", ") || m.emailPhone], ["Where", [m.cityMarket, m.market].filter(Boolean).join(" · ")], ["Industry", m.vertical]].map(([l, v]) => (
                    <div key={l} style={{ font: "500 11.5px/1.5 var(--nc-font)", color: v ? "var(--nc-text-2)" : "var(--nc-text-3)" }} className="nc-trunc"><span style={{ color: "var(--nc-text-3)" }}>{l}: </span>{v || "—"}</div>
                  ))}
                  {isKeep && canMerge && <div style={{ marginTop: 6, font: "700 10.5px var(--nc-font)", color: "var(--nc-gold-l)" }}>KEEP THIS ONE</div>}
                  <button type="button" onClick={e => { e.preventDefault(); onOpen(m); }} style={{ all: "unset", cursor: "pointer", marginTop: 6, font: "600 11px var(--nc-font)", color: "var(--nc-blue)" }}>View details →</button>
                </div>
              </div>
            </label>
          );
        })}
      </div>
      {canMerge && (
        <div style={{ marginTop: 12, font: "500 12px/1.55 var(--nc-font)", color: "var(--nc-text-2)" }}>
          Keeps <b>{keeper.companyName}</b>{filled.length ? <>, fills {filled.length} empty field{filled.length === 1 ? "" : "s"} from the others</> : null}, combines tags and notes, and keeps the furthest status (<b>{merged.currentStatus}</b>). {others.length} other record{others.length === 1 ? "" : "s"} will be deleted.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {canMerge ? (confirm
          ? <><Btn variant="danger" loading={busy} onClick={() => onMerge(merged, others.map(o => o.id), g)}>Yes — merge and delete {others.length}</Btn><Btn variant="subtle" onClick={() => setConfirm(false)}>Cancel</Btn></>
          : <Btn variant="primary" icon="⇄" onClick={() => setConfirm(true)}>Merge into {keeper.companyName.length > 22 ? keeper.companyName.slice(0, 22) + "…" : keeper.companyName}</Btn>)
          : <span style={{ font: "500 12px var(--nc-font)", color: "var(--nc-text-3)", alignSelf: "center" }}>Only admins can merge or delete records.{tagsEnabled ? " You can flag it for them:" : ""}</span>}
        {!canMerge && tagsEnabled && <Btn size="sm" onClick={() => onFlag(g)}>Flag for admin review</Btn>}
        {g.level !== "manual" && <Btn variant="subtle" onClick={() => onDismiss(g)}>Not duplicates</Btn>}
      </div>
    </div>
  );
}

export default function DuplicatesView({ groups, manualGroup, onClearManual, ...rest }){
  const all = manualGroup ? [manualGroup, ...groups] : groups;
  if (!all.length) return <EmptyState icon="✨" title="No duplicates found">Every prospect looks unique. We compare emails, phone numbers, website domains and company names (ignoring Inc/LLC and punctuation).</EmptyState>;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ font: "500 12.5px/1.5 var(--nc-font)", color: "var(--nc-text-2)" }}>
        {groups.length} group{groups.length === 1 ? "" : "s"} to review. Nothing is changed until you confirm a merge.
        {manualGroup && <Btn variant="subtle" size="sm" onClick={onClearManual} style={{ marginLeft: 8 }}>Close manual merge</Btn>}
      </div>
      {all.map(g => <Group key={g.id} g={g} {...rest} />)}
    </div>
  );
}
