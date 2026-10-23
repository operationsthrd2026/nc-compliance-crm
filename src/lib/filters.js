/* ════════════════════════════════════════════════════════════════
   Prospect filtering / sorting / saved-view model (pure)
════════════════════════════════════════════════════════════════ */
import { extractEmails } from "./text.js";
import { placeKey } from "./geo.js";
import { nextAction } from "./outreach.js";

export const EMPTY_FILTERS = Object.freeze({
  q: "", status: [], vertical: [], market: [], place: [], source: [], tags: [], tier: [], emailStatus: [],
  hasEmail: "any",   // any | yes | no
  hrListed: "any",   // any | Yes | No
  replied: "any",    // any | yes | no
  followup: "any",   // any | overdue
  hideDNR: false, minScore: 0,
});

export const withDefaults = f => ({ ...EMPTY_FILTERS, ...(f || {}) });

const ARRAY_KEYS = ["status", "vertical", "market", "place", "source", "tags", "tier", "emailStatus"];

export function countActive(f){
  const x = withDefaults(f); let n = 0;
  if (x.q.trim()) n++;
  ARRAY_KEYS.forEach(k => { if (x[k].length) n++; });
  if (x.followup !== "any") n++; if (x.hasEmail !== "any") n++; if (x.hrListed !== "any") n++; if (x.replied !== "any") n++;
  if (x.hideDNR) n++; if (x.minScore > 0) n++;
  return n;
}

export function filtersEqual(a, b){ return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b)); }
function normalize(f){ const x = withDefaults(f); const o = { ...x }; ARRAY_KEYS.forEach(k => { o[k] = [...x[k]].sort(); }); o.q = x.q.trim().toLowerCase(); return o; }

const hasEmailOf = p => extractEmails(p.emailPhone).length > 0;

export function matchesQuery(p, q){
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean); if (!tokens.length) return true;
  const hay = [p.companyName, p.contactName, p.title, p.emailPhone, p.cityMarket, p.market, p.vertical, p.outreachNotes, p.sourceType, p.hrPeopleContact, (p.tags || []).join(" ")]
    .join(" \u0001 ").toLowerCase();
  return tokens.every(t => hay.includes(t));
}

/** @param scoreOf (p) => {score, tier}  — injected so the caller can memoise */
export function applyFilters(list, filters, scoreOf){
  const f = withDefaults(filters);
  return list.filter(p => {
    if (f.q.trim() && !matchesQuery(p, f.q)) return false;
    if (f.status.length && !f.status.includes(p.currentStatus)) return false;
    if (f.vertical.length && !f.vertical.includes(p.vertical)) return false;
    if (f.market.length && !f.market.includes(p.market)) return false;
    if (f.place.length){ const k = placeKey(p); if (!k || !f.place.includes(k)) return false; }
    if (f.source.length && !f.source.includes(p.sourceType)) return false;
    if (f.tags.length && !f.tags.some(t => (p.tags || []).includes(t))) return false;
    if (f.emailStatus.length && !f.emailStatus.includes(p.emailStatus || "")) return false;
    if (f.hasEmail === "yes" && !hasEmailOf(p)) return false;
    if (f.hasEmail === "no" && hasEmailOf(p)) return false;
    if (f.hrListed === "Unknown"){ if (p.hrPersonListed === "Yes" || p.hrPersonListed === "No") return false; }
    else if (f.hrListed !== "any" && p.hrPersonListed !== f.hrListed) return false;
    if (f.replied === "yes" && !p.replyReceived) return false;
    if (f.replied === "no" && p.replyReceived) return false;
    if (f.followup === "overdue" && !(nextAction(p).overdue && !p.doNotRespond)) return false;
    if (f.hideDNR && (p.doNotRespond || p.currentStatus === "Do Not Respond")) return false;
    if (f.tier.length || f.minScore > 0){
      const s = scoreOf ? scoreOf(p) : null;
      if (f.tier.length && !(s && f.tier.includes(s.tier))) return false;
      if (f.minScore > 0 && !(s && s.score >= f.minScore)) return false;
    }
    return true;
  });
}

export function sortList(list, key, dir, scoreOf){
  const mul = dir === "desc" ? -1 : 1;
  const val = p => {
    if (key === "score") return scoreOf ? scoreOf(p).score : 0;
    if (key === "priorityScore") return parseInt(p.priorityScore) || 0;
    const v = p[key]; return v == null ? "" : String(v).toLowerCase();
  };
  return list.map((p, i) => ({ p, i, v: val(p) })).sort((a, b) => {
    const ea = a.v === "" || a.v === 0 && key !== "score", eb = b.v === "" || b.v === 0 && key !== "score";
    if (ea !== eb && typeof a.v !== "number") return ea ? 1 : -1;            // empties last regardless of direction
    const c = typeof a.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v));
    return c ? c * mul : a.i - b.i;
  }).map(x => x.p);
}

export const BUILTIN_VIEWS = [
  { id: "all",        name: "All prospects",       filters: {} },
  { id: "ready",      name: "Ready for Touch 1",   filters: { status: ["NEW"], hasEmail: "yes", hideDNR: true } },
  { id: "hot",        name: "Hot & strong fit",    filters: { tier: ["hot", "strong"], hideDNR: true } },
  { id: "noemail",    name: "Missing email",       filters: { hasEmail: "no", hideDNR: true } },
  { id: "unverified", name: "Emails to verify",    filters: { hasEmail: "yes", emailStatus: [""], hideDNR: true } },
  { id: "overdue",    name: "Overdue follow-ups",  filters: { followup: "overdue", hideDNR: true } },
  { id: "replied",    name: "Replied",             filters: { replied: "yes" } },
];

export function allTags(list){
  const c = new Map(); for (const p of list) for (const t of p.tags || []) c.set(t, (c.get(t) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Tags: trim, collapse spaces, lowercase, max 32 chars, no commas. */
export const cleanTag = t => String(t ?? "").replace(/[,;]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 32);
