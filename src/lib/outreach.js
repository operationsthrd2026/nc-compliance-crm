/* "What should I do with this prospect next?" — derived from status + dates (pure) */
import { extractEmails } from "./text.js";

const past = (d, now) => !!d && new Date(d + "T23:59:59") < now;
export const fmtDay = d => { if (!d) return ""; const x = new Date(d + "T12:00:00"); return isNaN(x) ? "" : x.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };

/** @returns {{label:string, due:string, overdue:boolean, tone:'ready'|'warn'|'due'|'muted'|'done'|'info'}} */
export function nextAction(p, now = new Date()){
  if (p.doNotRespond || p.currentStatus === "Do Not Respond") return { label: "Do not contact", due: "", overdue: false, tone: "muted" };
  const hasEmail = extractEmails(p.emailPhone).length > 0;
  switch (p.currentStatus){
    case "NEW": return hasEmail ? { label: "Send Touch 1", due: "", overdue: false, tone: "ready" } : { label: "Find an email first", due: "", overdue: false, tone: "warn" };
    case "T1 SENT": { const o = past(p.t2DueDate, now); return { label: "Touch 2", due: p.t2DueDate || "", overdue: o, tone: o ? "due" : "info" }; }
    case "T2 SENT": { const o = past(p.t3DueDate, now); return { label: "Touch 3 (needs approval)", due: p.t3DueDate || "", overdue: o, tone: o ? "due" : "info" }; }
    case "REVIEW": return { label: "Needs review", due: "", overdue: false, tone: "warn" };
    case "TOUCH 3 GATE": return p.t3Approved ? { label: "Send Touch 3", due: "", overdue: false, tone: "ready" } : { label: "Awaiting approval", due: "", overdue: false, tone: "warn" };
    case "NURTURE/T3 SENT": return { label: "Nurture", due: "", overdue: false, tone: "info" };
    case "Replied": return { label: "Follow up on reply", due: "", overdue: false, tone: "ready" };
    case "Converted": return { label: "Converted", due: "", overdue: false, tone: "done" };
    default: return { label: "—", due: "", overdue: false, tone: "muted" };
  }
}
