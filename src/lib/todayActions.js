/* ════════════════════════════════════════════════════════════════
   "What should I do next?" — ranks the user's next best actions from CRM data.
   RULES: this only SUGGESTS. Nothing is sent, saved or changed; every action
   opens the screen where a person does the step. Prospects marked Do Not
   Respond or already Converted are never suggested.
════════════════════════════════════════════════════════════════ */
import { extractEmails } from "./text.js";
import { nextAction } from "./outreach.js";
import { scoreProspect } from "./scoring.js";
import { placeOf } from "./geo.js";
import { STATUSES } from "../constants.js";

const live = p => !p.doNotRespond && p.currentStatus !== "Do Not Respond" && p.currentStatus !== "Converted";
const hasEmail = p => extractEmails(p.emailPhone).length > 0;
const names = (list, n = 3) => list.slice(0, n).map(p => p.companyName || "Unnamed");
const plural = (n, one, many) => n === 1 ? one : many;

/**
 * @returns {{actions: Array, allClear: boolean, more: number}}
 * action = { id, tone:'urgent'|'ready'|'info'|'attention', icon, priority, count, title, detail, sample[], cta, target, secondary? }
 * target = {type:'view',viewId} | {type:'mode',mode} | {type:'email',id} | {type:'open',id}
 */
export function buildToday(crm, { now = new Date(), scoreOf = scoreProspect, dupGroups = 0, tagsEnabled = true, max = 6 } = {}){
  const pool = crm.filter(live);
  const fit = p => scoreOf(p).score;
  const byFit = (a, b) => fit(b) - fit(a);
  const out = [];

  const replies = pool.filter(p => p.replyReceived).sort(byFit);
  if (replies.length) out.push({
    id: "replies", tone: "urgent", icon: "reply", priority: 100, count: replies.length,
    title: `${replies.length} ${plural(replies.length, "reply", "replies")} waiting for you`,
    detail: "People who answered are your warmest leads — respond while it's fresh.",
    sample: names(replies), cta: replies.length === 1 ? `Open ${replies[0].companyName || "reply"}` : "Open replies",
    target: replies.length === 1 ? { type: "open", id: replies[0].id } : { type: "view", viewId: "replied" },
  });

  const overdue = pool.filter(p => !p.replyReceived && nextAction(p, now).overdue).sort(byFit);
  if (overdue.length) out.push({
    id: "overdue", tone: "urgent", icon: "clock", priority: 90, count: overdue.length,
    title: `${overdue.length} ${plural(overdue.length, "follow-up is", "follow-ups are")} overdue`,
    detail: "The next-touch date has passed. Each is one click from a drafted email.",
    sample: names(overdue), cta: overdue.length === 1 ? "Write the follow-up" : "Review overdue",
    target: overdue.length === 1 ? { type: "email", id: overdue[0].id } : { type: "view", viewId: "overdue" },
  });

  const ready = pool.filter(p => p.currentStatus === "NEW" && hasEmail(p)).sort(byFit);
  if (ready.length) out.push({
    id: "ready", tone: "ready", icon: "mail", priority: 70 + (fit(ready[0]) >= 70 ? 5 : 0), count: ready.length,
    title: `${ready.length} ready for Touch 1`,
    detail: `Best fit first — start with ${ready[0].companyName || "the top one"}.`,
    sample: names(ready), cta: `Start with ${ready[0].companyName || "the top one"}`,
    target: { type: "email", id: ready[0].id },
    secondary: { label: "See all", target: { type: "view", viewId: "ready" } },
  });

  const unchecked = tagsEnabled ? pool.filter(p => hasEmail(p) && !p.emailStatus) : [];
  if (unchecked.length) out.push({
    id: "verify", tone: "info", icon: "check", priority: 50, count: unchecked.length,
    title: `${unchecked.length} email ${plural(unchecked.length, "address", "addresses")} not checked yet`,
    detail: "A quick check catches typos and dead domains before you send.",
    sample: names(unchecked), cta: "Check them", target: { type: "view", viewId: "unverified" },
  });

  const noEmail = pool.filter(p => p.currentStatus === "NEW" && !hasEmail(p));
  if (noEmail.length) out.push({
    id: "noemail", tone: "attention", icon: "alert", priority: 40, count: noEmail.length,
    title: `${noEmail.length} ${plural(noEmail.length, "prospect has", "prospects have")} no email`,
    detail: "Add a contact before you can reach out.",
    sample: names(noEmail), cta: "Add contacts", target: { type: "view", viewId: "noemail" },
  });

  const strong = pool.filter(p => ["hot", "strong"].includes(scoreOf(p).tier) && !["Yes", "No"].includes(p.hrPersonListed)).sort(byFit);
  if (strong.length) out.push({
    id: "qualify", tone: "info", icon: "sparkle", priority: 35, count: strong.length,
    title: `${strong.length} strong ${plural(strong.length, "prospect needs", "prospects need")} an HR check`,
    detail: "Knowing whether they already have an HR contact sharpens the fit score.",
    sample: names(strong), cta: "Review", target: { type: "mode", mode: "qualify" },
  });

  if (dupGroups > 0) out.push({
    id: "duplicates", tone: "attention", icon: "users", priority: 30, count: dupGroups,
    title: `${dupGroups} possible ${plural(dupGroups, "duplicate", "duplicates")}`,
    detail: "Review before contacting the same organisation twice. Nothing merges without your OK.",
    sample: [], cta: "Review", target: { type: "mode", mode: "duplicates" },
  });

  out.sort((a, b) => b.priority - a.priority);
  return { actions: out.slice(0, max), allClear: out.length === 0, more: Math.max(0, out.length - max) };
}

/** Counts per pipeline stage (in stage order) — excludes nothing; the UI decides what to show. */
export function pipelineStats(crm){
  const c = Object.fromEntries(STATUSES.map(s => [s, 0])); let other = 0;
  for (const p of crm){ if (p.currentStatus in c) c[p.currentStatus]++; else other++; }
  return { stages: STATUSES.map(s => ({ status: s, count: c[s] })).filter(x => x.count > 0), other, total: crm.length };
}

/** The places with the most prospects: [{key,label,count,precision}] */
export function topPlaces(crm, n = 5){
  const m = new Map();
  for (const p of crm){ const pl = placeOf(p); if (!pl) continue; const g = m.get(pl.key) || m.set(pl.key, { key: pl.key, label: pl.label, precision: pl.precision, count: 0 }).get(pl.key); g.count++; }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, n);
}
