/* ════════════════════════════════════════════════════════════════
   Outreach desk logic (pure). Decides WHO to write to next, WHICH template fits,
   and what could go wrong with a draft. It never sends or saves anything.
════════════════════════════════════════════════════════════════ */
import { nextAction } from "./outreach.js";
import { scoreProspect } from "./scoring.js";
import { messageEligibility, defaultTemplateFor } from "./outreachTemplates.js";

/** Which touch of the cadence each template is. */
export const TOUCH_OF = { "nonprofit-intro": 1, "business-intro": 1, "follow-up": 2, "final-check-in": 3 };
/** The pipeline status that RECORDING that touch moves a prospect to. */
export const STATUS_AFTER = { 1: "T1 SENT", 2: "T2 SENT", 3: "NURTURE/T3 SENT" };
export const touchOf = id => TOUCH_OF[id] || null;

export const isReply = p => !!p.replyReceived || p.currentStatus === "Replied";

/** The template that fits where this prospect is in the cadence. "reply" = a personal answer (no touch). */
export function suggestedTemplate(p){
  if (isReply(p)) return "reply";
  switch (p.currentStatus){
    case "T1 SENT": return "follow-up";
    case "T2 SENT": case "TOUCH 3 GATE": return "final-check-in";
    default: return defaultTemplateFor(p);
  }
}

const live = p => !p.doNotRespond && p.currentStatus !== "Do Not Respond" && p.currentStatus !== "Converted";
const daysUntil = (iso, now) => (new Date(iso + "T12:00:00") - now) / 86400000;

/**
 * @returns {{sections:Array<{id,title,tone,hint,items:Array<{p,reason}>}>, total:number, needsEmail:number}}
 * Each prospect appears once, in the most urgent section that applies. Do Not Respond / Converted never appear.
 */
export function buildDeskQueue(crm, { now = new Date(), scoreOf = scoreProspect, soonDays = 3 } = {}){
  const pool = crm.filter(live), used = new Set(), sections = [];
  const sendable = p => messageEligibility(p).canOpenEmail;
  const byFit = (a, b) => scoreOf(b).score - scoreOf(a).score;
  const add = (id, title, tone, hint, list, reason) => {
    const items = list.filter(p => !used.has(p.id)).sort(byFit).map(p => ({ p, reason: reason(p) }));
    items.forEach(i => used.add(i.p.id)); if (items.length) sections.push({ id, title, tone, hint, items });
  };
  add("replies", "Replies to answer", "urgent", "They answered — reply while it's fresh.", pool.filter(isReply), () => "Replied");
  add("overdue", "Overdue follow-ups", "urgent", "The next-touch date has passed.", pool.filter(p => sendable(p) && nextAction(p, now).overdue), p => `${nextAction(p, now).label} · overdue`);
  add("soon", `Due in the next ${soonDays} days`, "info", "Coming up.", pool.filter(p => { const n = nextAction(p, now); return sendable(p) && n.due && !n.overdue && daysUntil(n.due, now) <= soonDays; }), p => `${nextAction(p, now).label} · due ${nextAction(p, now).due}`);
  add("ready", "Ready for Touch 1", "ready", "Best fit first.", pool.filter(p => p.currentStatus === "NEW" && sendable(p)), () => "New — ready for Touch 1");
  const needsEmail = pool.filter(p => p.currentStatus === "NEW" && !sendable(p) && !used.has(p.id)).length;
  return { sections, total: sections.reduce((n, s) => n + s.items.length, 0), needsEmail };
}

/**
 * Things to tell the person BEFORE they send. level 'block' disables sending; 'warn' / 'info' don't.
 */
export function draftIssues(p, subject, body, { touch } = {}){
  const out = []; const el = messageEligibility(p);
  if (el.blocked) out.push({ level: "block", text: el.warning });
  else if (!el.hasEmail) out.push({ level: "block", text: "No valid email address is listed. Add and confirm one before contacting." });
  if (!String(subject || "").trim()) out.push({ level: "block", text: "The subject is empty." });
  if (!String(body || "").trim()) out.push({ level: "block", text: "The message is empty." });
  if (/{{\s*\w+\s*}}/.test(`${subject}\n${body}`)) out.push({ level: "warn", text: "A placeholder like {{company}} is still in the text." });
  if (!String(p.contactName || "").trim()) out.push({ level: "warn", text: "No contact name is on file, so the greeting reads “Hi there”. Add a name if you have one." });
  if (p.emailStatus === "invalid") out.push({ level: "warn", text: "This address failed an email check — it may bounce." });
  else if (p.emailStatus === "risky") out.push({ level: "info", text: "This address was flagged as risky by an email check." });
  if (String(body || "").length > 3500) out.push({ level: "warn", text: "Too long for the “Open in my email app” link. Use Copy or Gmail instead." });
  if (touch === 3) out.push({ level: "info", text: "Touch 3 is usually sent after approval — confirm that's done." });
  return { blocking: out.some(i => i.level === "block"), items: out };
}

/** Plain words describing what RECORDING this send will change (shown before the person confirms). */
export function recordPlan(p, touch, applyStatus){
  if (!touch) return { title: "Record this reply", changes: ["Add “Reply sent” to the activity log. The pipeline stage stays the same."] };
  const status = STATUS_AFTER[touch]; const after = applyStatus ? applyStatus(p, status) : p;
  const changes = [`Move “${p.companyName || "this prospect"}” to “${status}”.`];
  const dateKeys = [["t1SendDate", "Touch 1 sent"], ["t2DueDate", "Touch 2 due"], ["t3DueDate", "Touch 3 due"]];
  for (const [k, label] of dateKeys) if (after[k] && after[k] !== p[k]) changes.push(`${label}: ${after[k]}.`);
  changes.push(`Add “Touch ${touch} sent” to the activity log.`);
  return { title: `Record Touch ${touch} as sent`, changes };
}

export const stripLineBreaks = s => String(s ?? "").replace(/[\r\n]+/g, " ").trim();
