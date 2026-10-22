/* ════════════════════════════════════════════════════════════════
   Outreach desk — who to write to, the message, and the person's context, on one screen.
   RULES: nothing is sent automatically. "Open in my email app" and "Copy" only prepare the message; the touch is
   RECORDED (status + dates + activity log) only after the person confirms they sent it. "Send with Gmail" is a
   direct click on a connected Gmail account, and records only when Gmail reports success.
════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useState } from "react";
import Icon from "../../ui/icons.jsx";
import { Btn, ScoreRing, EmailBadge, EmptyState } from "../../ui/kit.jsx";
import { scoreProspect } from "../../lib/scoring.js";
import { verifyEmail } from "../../lib/emailCheck.js";
import { draftFor, messageEligibility, mailtoLink, contactChecklist, defaultTemplateFor } from "../../lib/outreachTemplates.js";
import { buildDeskQueue, suggestedTemplate, draftIssues, recordPlan, touchOf, STATUS_AFTER, isReply, stripLineBreaks } from "../../lib/outreachDesk.js";

const replyDraft = p => ({ subject: `Re: HR support for ${(p.companyName || "your organization").slice(0, 100)}`, body: `Hi ${(p.contactName || "").trim().split(/\s+/)[0] || "there"},\n\nThank you for getting back to me.\n\n` });
const clean = v => String(v ?? "").trim();

export default function OutreachDesk({
  crmData = [], canEdit = false, initialProspectId = null, applyStatus, onSaveProspect, onLogActivity, activityEnabled = false,
  onGetActivities, gmail, onEmailSent, onOpenProspect, onFind, toast = () => {},
}){
  const [filter, setFilter] = useState("");
  const queue = useMemo(() => buildDeskQueue(crmData), [crmData]);
  const flat = useMemo(() => queue.sections.flatMap(s => s.items.map(i => i.p)), [queue]);
  const [selectedId, setSelectedId] = useState(initialProspectId ? String(initialProspectId) : null);
  const selected = useMemo(() => crmData.find(p => String(p.id) === String(selectedId)) || null, [crmData, selectedId]);
  useEffect(() => { if (initialProspectId) setSelectedId(String(initialProspectId)); }, [initialProspectId]);
  useEffect(() => { if (!selectedId && flat.length) setSelectedId(String(flat[0].id)); }, [flat, selectedId]);

  const [templateId, setTemplateId] = useState("business-intro");
  const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false); const [awaiting, setAwaiting] = useState(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [note, setNote] = useState("");
  const [acts, setActs] = useState([]);

  useEffect(() => { if (selected){ setTemplateId(suggestedTemplate(selected)); setAwaiting(null); setError(""); setNote(""); setPreview(false); } }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected) return;
    const d = templateId === "reply" ? replyDraft(selected) : draftFor(selected, templateId);
    setSubject(d.subject); setBody(d.body); setAwaiting(null); setError(""); setNote("");
  }, [selected?.id, templateId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true; setActs([]);
    if (selected && onGetActivities && activityEnabled) Promise.resolve(onGetActivities(selected.id)).then(r => { if (live) setActs(Array.isArray(r) ? r.slice(0, 5) : []); }).catch(() => {});
    return () => { live = false; };
  }, [selected?.id, activityEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const touch = templateId === "reply" ? null : touchOf(templateId);
  const el = selected ? messageEligibility(selected) : null;
  const issues = selected ? draftIssues(selected, subject, body, { touch }) : { blocking: true, items: [] };
  const fit = useMemo(() => selected ? scoreProspect(selected) : null, [selected]);
  const gmailOn = !!gmail?.isConnected?.();
  const safeSubject = stripLineBreaks(subject);
  const mailto = el ? mailtoLink(el.email, safeSubject, body) : "";
  const plan = selected ? recordPlan(selected, touch, applyStatus) : null;

  const found = useMemo(() => {
    const q = filter.trim().toLowerCase(); if (!q) return [];
    return crmData.filter(p => `${p.companyName || ""} ${p.contactName || ""}`.toLowerCase().includes(q)).slice(0, 8);
  }, [filter, crmData]);

  const nextAfter = () => { const i = flat.findIndex(p => String(p.id) === String(selected?.id)); return flat[i + 1] || flat[i - 1] || null; };

  const record = async via => {
    if (!selected) return;
    const upNext = nextAfter(); setBusy(true); setError("");
    try {
      if (touch){
        const res = await onSaveProspect(selected.id, cur => applyStatus(cur, STATUS_AFTER[touch]));
        if (res.failed){ setError("Couldn't update this prospect (check your permissions). Nothing was recorded."); return; }
      }
      let logged = true;
      if (activityEnabled && onLogActivity){
        try { await onLogActivity({ prospectId: selected.id, activityType: touch ? "email_sent" : "reply", summary: touch ? `Touch ${touch} sent (${via})` : `Reply sent (${via})`, details: `Subject: ${safeSubject}\n\n${body}`.slice(0, 4000) }); }
        catch { logged = false; }
      }
      toast(`${touch ? `Touch ${touch}` : "Reply"} recorded for ${selected.companyName}.${logged ? "" : " (The activity log entry could not be saved.)"}`, logged ? "ok" : "err");
      setAwaiting(null); setSelectedId(upNext ? String(upNext.id) : null);
    } catch (e){ setError(e.message || "Couldn't record this."); }
    finally { setBusy(false); }
  };
  const openMail = () => { if (!mailto || issues.blocking) return; window.open(mailto, "_self"); setAwaiting({ via: "your email app" }); };
  const copyDraft = async () => {
    if (issues.blocking) return;
    try { await navigator.clipboard.writeText(`To: ${el.email}\nSubject: ${safeSubject}\n\n${body}`); setNote("Copied. Nothing has been sent or recorded."); }
    catch { setError("Couldn't access the clipboard — select the text and copy it manually."); }
    setAwaiting({ via: "copy and paste" });
  };
  const sendGmail = async () => {
    if (!gmailOn || issues.blocking || busy) return;
    setBusy(true); setError("");
    const r = await gmail.send({ to: el.email, subject: safeSubject, body });
    if (r?.ok){ onEmailSent?.({ prospect: selected, subject: safeSubject, body, touch, to: el.email }); await record("Gmail"); }
    else { setError(`Gmail couldn't send this${r?.reason ? ` (${r.reason})` : ""}. Nothing was recorded — you can open it in your email app instead.`); setBusy(false); }
  };
  const checkEmail = async () => {
    if (!el?.email || !canEdit) return; setBusy(true);
    try { const r = await verifyEmail(el.email, {}); await onSaveProspect(selected.id, cur => ({ ...cur, emailStatus: r.status, emailCheckedAt: r.checkedAt })); toast(`${el.email}: ${r.reasons[0] || r.status}`); }
    finally { setBusy(false); }
  };

  const cards = selected ? [
    { id: defaultTemplateFor(selected), label: defaultTemplateFor(selected) === "nonprofit-intro" ? "Nonprofit introduction" : "Introduction", touch: 1 },
    { id: "follow-up", label: "Follow-up", touch: 2 }, { id: "final-check-in", label: "Final check-in", touch: 3 }, { id: "reply", label: "Reply", touch: null },
  ] : [];

  return (
    <div className="nc">
      <div className="pf-page-kicker">EMAIL & OUTREACH</div>
      <h1 className="pf-page-title">Outreach desk</h1>
      <p className="pf-page-description">Pick someone, review the draft, and send. <strong>Nothing is sent automatically</strong> — a touch is recorded only after you confirm.</p>
      <div className="od-status" role="status">
        <span className={"od-dot " + (gmailOn ? "on" : "")} aria-hidden="true" />
        {gmailOn ? "Gmail is connected — you can send from here." : "Gmail isn't connected — drafts open in your email app. (Connect Gmail in the Gmail inbox tab to send from here.)"}
      </div>

      <div className="od">
        {/* ── who to write to ── */}
        <aside className="od-q" aria-label="Who to write to">
          <input className="nc-input" placeholder="Find any prospect…" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Find any prospect" />
          {filter.trim() && (
            <div role="group" aria-label="Search results">
              <div className="od-sec-h"><span>Search results</span></div>
              {found.length === 0 && <div className="td-muted" style={{ padding: "6px 10px" }}>No prospect matches.</div>}
              {found.map(p => <Row key={p.id} p={p} sel={String(p.id) === String(selectedId)} reason={p.currentStatus} onPick={() => { setSelectedId(String(p.id)); setFilter(""); }} />)}
            </div>
          )}
          {queue.sections.map(s => (
            <div key={s.id} role="group" aria-label={s.title}>
              <div className="od-sec-h"><span>{s.title}</span><span>{s.items.length}</span></div>
              {s.items.map(i => <Row key={i.p.id} p={i.p} sel={String(i.p.id) === String(selectedId)} reason={i.reason} onPick={() => setSelectedId(String(i.p.id))} />)}
            </div>
          ))}
          {queue.total === 0 && !filter.trim() && (
            <div className="td-empty" style={{ padding: "22px 10px" }}>
              <div className="td-empty-ico"><Icon name="check" size={24} /></div>
              <h2 style={{ fontSize: 17 }}>Nothing to send right now</h2>
              <p>No replies, overdue follow-ups or new prospects with an email.{queue.needsEmail ? ` ${queue.needsEmail} new prospect${queue.needsEmail === 1 ? " has" : "s have"} no email yet.` : ""}</p>
              {onFind && <Btn variant="primary" onClick={onFind}>Find prospects</Btn>}
            </div>
          )}
          {queue.needsEmail > 0 && queue.total > 0 && <p className="td-muted" style={{ padding: "10px 10px 2px" }}>+ {queue.needsEmail} new prospect{queue.needsEmail === 1 ? "" : "s"} need an email before you can write.</p>}
        </aside>

        {/* ── the message ── */}
        <section className="od-c" aria-label="Message">
          {!selected ? <EmptyState icon="✉️" title="Choose someone to write to">Pick a prospect on the left, or search for any prospect.</EmptyState> : <>
            <header>
              <h2 className="od-name">{selected.companyName || "(unnamed)"}</h2>
              <div className="td-muted">{[selected.contactName, selected.title].filter(Boolean).join(" · ") || "No contact name on file"}</div>
            </header>

            <div className="od-tpls" role="group" aria-label="Template">
              {cards.map(c => (
                <button key={c.id} type="button" className="od-tpl" aria-pressed={templateId === c.id} onClick={() => setTemplateId(c.id)}>
                  {c.label}<small>{c.touch ? `Touch ${c.touch}` : "Personal reply"}{templateId !== c.id && suggestedTemplate(selected) === c.id ? " · suggested" : ""}</small>
                </button>
              ))}
            </div>

            <div className="od-field"><label>To</label>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className="od-to">{el.email || "— no email on file —"}</span>
                {el.hasEmail && <EmailBadge status={selected.emailStatus || ""} />}
                {el.hasEmail && canEdit && <button type="button" className="td-link" onClick={checkEmail} disabled={busy}>Check this address</button>}
              </div>
            </div>

            {preview ? (
              <div className="od-preview" aria-label="Preview"><strong>{safeSubject}</strong>{"\n\n"}{body}</div>
            ) : <>
              <div className="od-field"><label htmlFor="od-subj">Subject</label><input id="od-subj" className="od-input" value={subject} onChange={e => setSubject(e.target.value)} /></div>
              <div className="od-field"><label htmlFor="od-body">Message</label><textarea id="od-body" className="od-textarea" value={body} onChange={e => setBody(e.target.value)} /></div>
            </>}
            <div className="od-meta"><button type="button" className="td-link" onClick={() => setPreview(v => !v)}>{preview ? "Edit" : "Preview"}</button><span>{body.trim() ? body.trim().split(/\s+/).length : 0} words</span></div>

            {issues.items.length > 0 && (
              <ul className="od-issues" aria-label="Before you send">
                {issues.items.map((i, k) => <li key={k} className={"od-issue " + i.level}><Icon name={i.level === "block" ? "alert" : i.level === "warn" ? "alert" : "sparkle"} size={16} /><span>{i.text}</span></li>)}
              </ul>
            )}
            {error && <div className="od-issue block" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
            {note && <div className="td-muted" role="status">{note}</div>}

            {awaiting ? (
              <div className="od-confirm" role="group" aria-label="Confirm you sent it">
                <strong>Did you send it with {awaiting.via}?</strong>
                <span className="td-muted">Nothing has been recorded yet. If you confirm, this will:</span>
                <ul className="od-plan">{plan.changes.map((c, k) => <li key={k}>{c}</li>)}</ul>
                <div className="od-actions">
                  <Btn variant="primary" loading={busy} disabled={!canEdit} onClick={() => record(awaiting.via)}>Yes — {plan.title.toLowerCase()}</Btn>
                  <Btn variant="ghost" onClick={() => setAwaiting(null)}>Not yet</Btn>
                  {!canEdit && <span className="td-muted">View-only access can't record sends.</span>}
                </div>
              </div>
            ) : (
              <div className="od-actions">
                {gmailOn && <Btn variant="primary" icon="✉️" disabled={issues.blocking || busy || !canEdit} loading={busy} onClick={sendGmail}>Send with Gmail</Btn>}
                <Btn variant={gmailOn ? "ghost" : "primary"} icon="↗" disabled={issues.blocking || !mailto} onClick={openMail}>Open in my email app</Btn>
                <Btn variant="ghost" disabled={issues.blocking} onClick={copyDraft}>Copy</Btn>
                <span style={{ flex: 1 }} />
                <Btn variant="subtle" disabled={!nextAfter()} onClick={() => { const n = nextAfter(); if (n) setSelectedId(String(n.id)); }}>Skip →</Btn>
              </div>
            )}
          </>}
        </section>

        {/* ── context ── */}
        <aside className="od-x" aria-label="About this prospect">
          {selected && <>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {fit && <ScoreRing score={fit.score} color={fit.color} size={46} />}
              <div><div style={{ font: "700 13.5px var(--nc-font)" }}>{fit ? `${fit.label} fit` : ""}</div><div className="td-muted">{selected.currentStatus}</div></div>
            </div>
            {fit && <ul className="od-why">{fit.factors.filter(f => f.points > 0).sort((a, b) => b.points / (b.max || 1) - a.points / (a.max || 1)).slice(0, 3).map(f => <li key={f.key}><b>{f.label}:</b> {f.note}</li>)}</ul>}
            <div>
              <div className="od-sec-h" style={{ padding: "0 0 6px" }}><span>Contact details on file</span></div>
              <ul className="od-why">{contactChecklist(selected).map(c => <li key={c.key}><b>{c.name}:</b> {c.value || <span className="td-muted">none</span>}</li>)}</ul>
              <p className="td-muted" style={{ margin: "6px 0 0", fontSize: 12 }}>Public listings are not verified decision-maker contacts.</p>
            </div>
            <div>
              <div className="od-sec-h" style={{ padding: "0 0 6px" }}><span>Recent activity</span></div>
              {acts.length === 0 ? <p className="td-muted" style={{ margin: 0 }}>{activityEnabled ? "No activity logged yet." : "Activity history needs the database update."}</p>
                : <ul className="od-why">{acts.map((a, k) => <li key={a.id || k}>{a.summary || a.activityType || a.activity_type}</li>)}</ul>}
            </div>
            <Btn variant="ghost" size="sm" onClick={() => onOpenProspect?.(selected)}>Open in Prospects</Btn>
          </>}
        </aside>
      </div>
    </div>
  );
}

function Row({ p, sel, reason, onPick }){
  const s = scoreProspect(p);
  return (
    <button type="button" className={"od-row " + (sel ? "sel" : "")} onClick={onPick} aria-current={sel ? "true" : undefined}>
      <ScoreRing score={s.score} color={s.color} size={30} />
      <span className="od-row-main"><span className="od-row-t">{p.companyName || "(unnamed)"}</span><span className="od-row-s">{clean(reason)}</span></span>
    </button>
  );
}
