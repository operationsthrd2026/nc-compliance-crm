/* ════════════════════════════════════════════════════════════════
   Pipeline board rules (pure, tested).
   • Which stages exist, what each card should signal, and what a move means.
   • A move into a "sent" stage RECORDS a send, so the board asks first and says exactly what will change.
   • Moves always go through applyStatus (the same cadence logic as everywhere else), never a bare status change.
════════════════════════════════════════════════════════════════ */
import { nextAction } from "./outreach.js";
import { scoreProspect } from "./scoring.js";
import { messageEligibility } from "./outreachTemplates.js";

/** The active outreach stages shown as columns (Do Not Respond is a terminal state, viewed in the table). */
export const PIPE_STAGES = [
  { id: "NEW",             label: "New",               hint: "Not contacted yet",                 tone: "gold" },
  { id: "T1 SENT",         label: "Touch 1 sent",      hint: "Waiting for a reply",               tone: "blue",   touch: 1 },
  { id: "T2 SENT",         label: "Touch 2 sent",      hint: "Second email sent",                 tone: "purple", touch: 2 },
  { id: "REVIEW",          label: "Under review",      hint: "Needs a decision",                  tone: "amber" },
  { id: "TOUCH 3 GATE",    label: "Touch 3 gate",      hint: "Waiting for approval to send Touch 3", tone: "pink" },
  { id: "NURTURE/T3 SENT", label: "Nurture / Touch 3", hint: "Final email sent; keep warm",       tone: "muted",  touch: 3 },
  { id: "Replied",         label: "Replied",           hint: "They answered",                     tone: "green" },
  { id: "Converted",       label: "Converted",         hint: "Became a client",                   tone: "gold" },
];
export const stageById = id => PIPE_STAGES.find(s => s.id === id) || null;
const SEND_FIELD = { 1: "t1SendDate", 2: "t2SendDate", 3: "t3SendDate" };
const DAY = 86400000;

export const isDNR = p => !!p.doNotRespond || p.currentStatus === "Do Not Respond";
export const daysSince = (iso, now = new Date()) => iso ? Math.floor((now - new Date(iso + "T12:00:00")) / DAY) : null;
export const lastTouch = p => p.t3SendDate || p.t2SendDate || p.t1SendDate || "";
const plural = (n, a, b) => n === 1 ? a : b;

/** Everything a card needs: fit, the next-step signal, how urgent it is, and whether an email can be written. */
export function cardInfo(p, now = new Date(), scoreOf = scoreProspect){
  const next = nextAction(p, now), fit = scoreOf(p), since = daysSince(lastTouch(p), now);
  let urgency = 0, chip;
  if (isDNR(p)) { urgency = -1; chip = { tone: "muted", text: "Do not contact" }; }
  else if (p.currentStatus === "Converted") chip = { tone: "gold", text: "Converted" };
  else if (p.replyReceived || p.currentStatus === "Replied") { urgency = 3; chip = { tone: "green", text: "Replied — answer them" }; }
  else if (next.overdue){
    const d = daysSince(next.due, now); urgency = 4;
    chip = { tone: "red", text: `${next.label} overdue${d > 0 ? ` · ${d} ${plural(d, "day", "days")}` : ""}` };
  } else if (next.due){
    const left = -daysSince(next.due, now); urgency = left <= 3 ? 2 : 1;
    chip = { tone: left <= 3 ? "amber" : "blue", text: `${next.label} · due ${next.due}` };
  } else chip = { tone: next.tone === "ready" ? "green" : next.tone === "warn" ? "amber" : "muted", text: next.label };
  return { p, fit, next, urgency, chip, since, eligible: messageEligibility(p) };
}

const hay = p => [p.companyName, p.contactName, p.title, p.emailPhone, p.market, p.cityMarket, p.vertical].join(" ").toLowerCase();

/**
 * Columns for the board. Within a column: most urgent first (overdue, then replies, then due soon), then strongest fit.
 * Do Not Respond prospects are hidden unless asked for.
 */
export function buildBoard(prospects, { now = new Date(), query = "", vertical = "", market = "", needsAction = false, hideDNR = true, scoreOf = scoreProspect } = {}){
  const q = String(query || "").trim().toLowerCase();
  let infos = (prospects || []).map(p => cardInfo(p, now, scoreOf)).filter(i => {
    if (hideDNR && isDNR(i.p)) return false;
    if (q && !hay(i.p).includes(q)) return false;
    if (vertical && i.p.vertical !== vertical) return false;
    if (market && (i.p.market || i.p.cityMarket) !== market) return false;
    if (needsAction && i.urgency < 3) return false;           // overdue follow-ups and replies
    return true;
  });
  const columns = PIPE_STAGES.map(stage => {
    const cards = infos.filter(i => i.p.currentStatus === stage.id)
      .sort((a, b) => b.urgency - a.urgency || b.fit.score - a.fit.score || String(a.p.companyName).localeCompare(String(b.p.companyName)));
    return { stage, cards, count: cards.length, overdue: cards.filter(c => c.urgency === 4).length, replies: cards.filter(c => c.urgency === 3).length,
             avgFit: cards.length ? Math.round(cards.reduce((n, c) => n + c.fit.score, 0) / cards.length) : 0 };
  });
  const placed = columns.reduce((n, c) => n + c.count, 0);
  return { columns, total: placed, overdue: columns.reduce((n, c) => n + c.overdue, 0), replies: columns.reduce((n, c) => n + c.replies, 0), hidden: infos.length - placed };
}

/**
 * May this prospect be moved to this stage, and does the person need to confirm first?
 * → { ok, reason?, silent?, needsConfirm?, skips? }
 */
export function canMove(p, stageId, { canEdit = false } = {}){
  const stage = stageById(stageId);
  if (!stage) return { ok: false, reason: "That stage is not on the board." };
  if (p.currentStatus === stageId) return { ok: false, silent: true, reason: "Already in this stage." };
  if (!canEdit) return { ok: false, reason: "Your account is view-only, so cards can't be moved." };
  if (isDNR(p)) return { ok: false, reason: `${p.companyName || "This prospect"} is marked Do Not Respond. Clear that flag on the prospect before moving it.` };
  // Moving into a "sent" stage RECORDS a send (unless that send is already recorded) → confirm first.
  const records = stage.touch && !p[SEND_FIELD[stage.touch]];
  const skips = stage.touch > 1 && !p[SEND_FIELD[stage.touch - 1]] && records;
  return { ok: true, needsConfirm: !!records, skips: !!skips };
}

/** Plain words for what the move will change (shown in the confirmation). Uses the same cadence function that saves it. */
export function movePlan(p, stageId, applyStatus){
  const stage = stageById(stageId), after = applyStatus ? applyStatus(p, stageId) : { ...p, currentStatus: stageId };
  const lines = [`Move “${p.companyName || "this prospect"}” to “${stage?.label || stageId}”.`];
  for (const [k, label] of [["t1SendDate", "Touch 1 sent"], ["t2DueDate", "Touch 2 due"], ["t2SendDate", "Touch 2 sent"], ["t3DueDate", "Touch 3 due"], ["t3SendDate", "Touch 3 sent"]])
    if (after[k] && after[k] !== p[k]) lines.push(`${label}: ${after[k]}.`);
  return { title: stage?.touch ? `Record Touch ${stage.touch} as sent?` : `Move to ${stage?.label}?`, lines };
}
