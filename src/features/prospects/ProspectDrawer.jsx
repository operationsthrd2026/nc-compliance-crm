import { useEffect, useState } from "react";
import { STATUSES } from "../../constants.js";
import { extractEmails, extractPhones, domainOfUrl } from "../../lib/text.js";
import { nextAction, fmtDay } from "../../lib/outreach.js";
import { Drawer, Section, StatusPill, ScoreBadge, ScoreBreakdown, EmailBadge, TagInput, Btn } from "../../ui/kit.jsx";

const Field = ({ label, children }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ font: "600 10.5px var(--nc-font)", color: "var(--nc-text-3)", marginBottom: 3 }}>{label}</div>
    <div style={{ font: "500 13px/1.4 var(--nc-font)", wordBreak: "break-word" }}>{children || <span style={{ color: "var(--nc-text-3)" }}>—</span>}</div>
  </div>
);

export default function ProspectDrawer({ onQualify, prospect: p, scoreResult, canEdit, tagsEnabled, tagList, dupMatches, onClose, onPatch, onEdit, onVerify, verifying, lastCheck, hunterOn, onOpenOther }){
  const [notes, setNotes] = useState(p.outreachNotes || "");
  useEffect(() => { setNotes(p.outreachNotes || ""); }, [p.id, p.outreachNotes]);
  const emails = extractEmails(p.emailPhone), phones = extractPhones(p.emailPhone);
  const site = domainOfUrl(p.sourceUrl), na = nextAction(p);
  const saveNotes = () => { if (notes !== (p.outreachNotes || "")) onPatch({ outreachNotes: notes }); };

  return (
    <Drawer onClose={onClose} title={p.companyName || "(unnamed)"}
      subtitle={<div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <StatusPill status={p.currentStatus} /><ScoreBadge result={scoreResult} size={30} showLabel />
        {tagsEnabled && emails.length > 0 && <EmailBadge status={p.emailStatus || ""} confirmed={lastCheck?.confirmed} />}
      </div>}
      footer={<>{onQualify && <Btn variant="gold-ghost" icon="✔" onClick={() => onQualify(p)}>Qualify</Btn>}<Btn variant="primary" icon="✎" onClick={() => onEdit(p)}>{canEdit ? "Open full editor" : "View all fields"}</Btn><Btn onClick={onClose}>Close</Btn></>}>

      <div className="nc-card" style={{ padding: "12px 14px", marginBottom: 20, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div><div style={{ font: "600 10.5px var(--nc-font)", color: "var(--nc-text-3)" }}>NEXT STEP</div>
          <div style={{ font: "700 14px var(--nc-font)", color: na.tone === "due" ? "var(--nc-red)" : na.tone === "ready" ? "var(--nc-green)" : "var(--nc-text)" }}>{na.label}{na.due ? ` · ${na.overdue ? "overdue " : "due "}${fmtDay(na.due)}` : ""}</div></div>
        {canEdit && <select className="nc-select" style={{ width: "auto", minWidth: 150 }} value={p.currentStatus} aria-label="Change status" onChange={e => onPatch({ currentStatus: e.target.value })}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>}
      </div>

      <Section title="Contact" action={tagsEnabled && emails.length > 0 && canEdit && <Btn size="sm" variant="gold-ghost" loading={verifying} onClick={onVerify}>{hunterOn ? "Verify (mailbox)" : "Verify email"}</Btn>}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Name">{p.contactName}</Field><Field label="Title">{p.title}</Field>
          <Field label="Email">{emails.map(e => <div key={e}><a href={`mailto:${e}`} style={{ color: "var(--nc-gold-l)" }}>{e}</a></div>)}</Field>
          <Field label="Phone">{phones.map(x => x.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")).join(", ")}</Field>
          <Field label="Website">{site && <a href={p.sourceUrl.startsWith("http") ? p.sourceUrl : `https://${site}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--nc-gold-l)" }}>{site}</a>}</Field>
          <Field label="Location">{[p.cityMarket, p.market && p.market !== p.cityMarket ? p.market : ""].filter(Boolean).join(" · ")}</Field>
          <Field label="Industry">{p.vertical}</Field><Field label="Size / HR">{[p.orgSize, p.hrPersonListed === "Yes" ? `HR: ${p.hrPeopleContact || "listed"}` : p.hrPersonListed === "No" ? "No HR listed" : ""].filter(Boolean).join(" · ")}</Field>
        </div>
        {lastCheck && (
          <ul style={{ margin: "12px 0 0", padding: "10px 12px 10px 28px", background: "rgba(240,244,255,.04)", border: "1px solid var(--nc-border)", borderRadius: 8, font: "500 12px/1.6 var(--nc-font)", color: "var(--nc-text-2)" }}>
            {lastCheck.reasons.map((r, i) => <li key={i}>{r}</li>)}
            {lastCheck.suggestion && <li>Suggested domain: <b>{lastCheck.suggestion}</b></li>}
            {!hunterOn && lastCheck.status === "valid" && <li style={{ color: "var(--nc-text-3)" }}>Domain check only — this can't confirm the mailbox itself exists.</li>}
          </ul>
        )}
      </Section>

      <Section title="Why this score"><ScoreBreakdown result={scoreResult} /></Section>

      <Section title="Tags">
        {tagsEnabled ? <TagInput value={p.tags || []} suggestions={tagList} disabled={!canEdit} onChange={tags => onPatch({ tags })} />
          : <div style={{ font: "500 12px/1.5 var(--nc-font)", color: "var(--nc-text-3)" }}>Tags need the latest database update (run <code>20261020000000_prospect_features.sql</code>).</div>}
      </Section>

      <Section title="Outreach">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
          {[["Touch 1", p.t1SendDate, null], ["Touch 2", p.t2SendDate, p.t2DueDate], ["Touch 3", p.t3SendDate, p.t3DueDate]].map(([l, sent, due]) => (
            <div key={l} className="nc-card" style={{ padding: "9px 11px" }}>
              <div style={{ font: "600 10.5px var(--nc-font)", color: "var(--nc-text-3)" }}>{l}</div>
              <div style={{ font: "700 12.5px var(--nc-font)", color: sent ? "var(--nc-green)" : "var(--nc-text-3)" }}>{sent ? `Sent ${fmtDay(sent)}` : due ? `Due ${fmtDay(due)}` : "Not sent"}</div>
            </div>
          ))}
        </div>
        <textarea className="nc-textarea" value={notes} disabled={!canEdit} onChange={e => setNotes(e.target.value)} onBlur={saveNotes} placeholder={canEdit ? "Notes — saved when you click away" : "No notes"} aria-label="Outreach notes" />
        {(p.whyFit || p.leadPainPoint) && <div style={{ marginTop: 12, display: "grid", gap: 10 }}>{p.whyFit && <Field label="Why a fit">{p.whyFit}</Field>}{p.leadPainPoint && <Field label="Pain point">{p.leadPainPoint}</Field>}</div>}
        {canEdit && <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <Btn size="sm" variant={p.replyReceived ? "gold-ghost" : "ghost"} onClick={() => onPatch({ replyReceived: !p.replyReceived })}>{p.replyReceived ? "✓ Replied" : "Mark replied"}</Btn>
          <Btn size="sm" variant={p.doNotRespond ? "danger" : "ghost"} onClick={() => onPatch({ doNotRespond: !p.doNotRespond })}>{p.doNotRespond ? "🚫 Do not respond (undo)" : "Do not respond"}</Btn>
        </div>}
      </Section>

      {dupMatches.length > 0 && (
        <Section title={`Possible duplicates (${dupMatches.length})`}>
          <div style={{ display: "grid", gap: 8 }}>
            {dupMatches.map(m => (
              <div key={m.prospect.id} className="nc-card" style={{ padding: "10px 12px", display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nc-trunc" style={{ font: "700 12.5px var(--nc-font)" }}>{m.prospect.companyName}</div>
                  <div style={{ font: "500 11px var(--nc-font)", color: m.level === "high" ? "var(--nc-amber)" : "var(--nc-text-3)" }}>{m.reasons.join(" · ")}</div>
                </div>
                <Btn size="sm" onClick={() => onOpenOther(m.prospect)}>Open</Btn>
              </div>
            ))}
          </div>
        </Section>
      )}
    </Drawer>
  );
}
