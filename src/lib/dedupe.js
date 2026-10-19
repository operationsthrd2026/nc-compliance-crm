/* ════════════════════════════════════════════════════════════════
   Duplicate detection + merge (pure)
   ────────────────────────────────────────────────────────────────
   Confidence levels
     high    – same email, same phone, same org domain + similar name,
               or near-identical name in the same city
     medium  – similar name, or same org domain only (could be two
               branches of one organisation — a human should look)
   Matching is signal-based and the reasons are returned so the UI can
   explain WHY two records were flagged. Nothing here ever deletes data.
════════════════════════════════════════════════════════════════ */
import {
  normalizeName, nameTokens, similarityKeys, bigrams, extractEmails, extractPhones,
  domainOfEmail, domainOfUrl, isFreemail,
} from "./text.js";
import { STATUSES } from "../constants.js";

export function keysOf(p){
  const emails = extractEmails(p.emailPhone);
  const phones = extractPhones(p.emailPhone);
  const domains = new Set();
  for (const e of emails){ const d = domainOfEmail(e); if (d && !isFreemail(d)) domains.add(d); }
  const web = domainOfUrl(p.sourceUrl); if (web && !isFreemail(web)) domains.add(web);
  const name = normalizeName(p.companyName), tokens = nameTokens(p.companyName);
  return {
    emails, phones, domains: [...domains],
    name, tokens, set: new Set(tokens), bg: bigrams(name),      // fingerprint, computed once per record
    city: normalizeName(p.market || p.cityMarket || ""),
  };
}

const HIGH_NAME = 0.92, MED_NAME = 0.78;

/** Compare two prospects. Returns null if they don't look related. */
export function comparePair(a, b, ka = keysOf(a), kb = keysOf(b)){
  const reasons = []; let level = null;
  const bump = l => { if (l === "high" || !level) level = l; };

  const sharedEmail = ka.emails.find(e => kb.emails.includes(e));
  if (sharedEmail){ reasons.push(`Same email (${sharedEmail})`); bump("high"); }
  const sharedPhone = ka.phones.find(p => kb.phones.includes(p));
  if (sharedPhone){ reasons.push("Same phone number"); bump("high"); }

  const sim = similarityKeys(ka, kb);
  const sharedDomain = ka.domains.find(d => kb.domains.includes(d));
  const sameCity = ka.city && ka.city === kb.city;

  if (sharedDomain && sim >= MED_NAME){ reasons.push(`Same website/email domain (${sharedDomain}) and similar name`); bump("high"); }
  else if (sharedDomain){ reasons.push(`Same website/email domain (${sharedDomain}) — may be another branch`); bump("medium"); }

  if (!sharedEmail && !sharedPhone && !sharedDomain){
    if (sim >= HIGH_NAME && (sameCity || !ka.city || !kb.city)){ reasons.push(sim === 1 ? "Identical name" : `Near-identical name (${Math.round(sim * 100)}%)`); bump(sameCity ? "high" : "medium"); }
    else if (sim >= MED_NAME){ reasons.push(`Similar name (${Math.round(sim * 100)}%)`); bump("medium"); }
  } else if (sim >= HIGH_NAME && !reasons.some(r => /name/i.test(r))) reasons.push(sim === 1 ? "Identical name" : `Near-identical name (${Math.round(sim * 100)}%)`);

  if (!level) return null;
  // Two distinct people can share a generic switchboard number/domain; same name = stronger.
  return { level, reasons, score: Math.max(sim, level === "high" ? 0.9 : 0.6) };
}

/** Index for fast "is this candidate already in the CRM?" lookups. */
export function buildIndex(list){
  const items = list.map(p => ({ p, k: keysOf(p) }));
  const by = { email: new Map(), phone: new Map(), domain: new Map(), token: new Map(), name: new Map() };
  const add = (m, key, it) => { if (!key) return; (m.get(key) || m.set(key, []).get(key)).push(it); };
  for (const it of items){
    it.k.emails.forEach(e => add(by.email, e, it));
    it.k.phones.forEach(x => add(by.phone, x, it));
    it.k.domains.forEach(d => add(by.domain, d, it));
    add(by.name, it.k.name, it);
    new Set(it.k.tokens.filter(t => t.length >= 3)).forEach(t => add(by.token, t, it));
  }
  // Very common words ("home", "care", "raleigh") would make every record a candidate for
  // every other; skip them when gathering candidates (identical names are still found via by.name).
  const cap = Math.max(30, Math.ceil(items.length * 0.05));
  for (const [tok, arr] of by.token) if (arr.length > cap) by.token.delete(tok);
  return { items, by };
}

export function findMatches(candidate, index, { excludeId, limit = 5 } = {}){
  const kc = keysOf(candidate); const pool = new Set();
  const take = (m, keys) => keys.forEach(k => (m.get(k) || []).forEach(it => pool.add(it)));
  take(index.by.email, kc.emails); take(index.by.phone, kc.phones); take(index.by.domain, kc.domains);
  take(index.by.name, kc.name ? [kc.name] : []);
  take(index.by.token, [...new Set(kc.tokens.filter(t => t.length >= 3))]);
  const out = [];
  for (const it of pool){
    if (excludeId != null && it.p.id === excludeId) continue;
    const r = comparePair(candidate, it.p, kc, it.k);
    if (r) out.push({ prospect: it.p, ...r });
  }
  out.sort((x, y) => (y.level === "high") - (x.level === "high") || y.score - x.score);
  return out.slice(0, limit);
}

/** Group an existing list into duplicate clusters (union-find over matching pairs). */
export function findDuplicateGroups(list, { dismissed = new Set() } = {}){
  const idx = buildIndex(list);
  const parent = new Map(list.map(p => [p.id, p.id]));
  const find = x => { while (parent.get(x) !== x){ parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const pairKey = (a, b) => [String(a), String(b)].sort().join("|");
  const pairInfo = new Map();

  for (const it of idx.items){
    const pool = new Set();
    const take = (m, keys) => keys.forEach(k => (m.get(k) || []).forEach(o => { if (o !== it) pool.add(o); }));
    take(idx.by.email, it.k.emails); take(idx.by.phone, it.k.phones); take(idx.by.domain, it.k.domains);
    take(idx.by.name, it.k.name ? [it.k.name] : []);
    take(idx.by.token, [...new Set(it.k.tokens.filter(t => t.length >= 3))]);
    for (const o of pool){
      const key = pairKey(it.p.id, o.p.id);
      if (pairInfo.has(key) || dismissed.has(key)) continue;
      const r = comparePair(it.p, o.p, it.k, o.k);
      pairInfo.set(key, r);
      if (r){ const ra = find(it.p.id), rb = find(o.p.id); if (ra !== rb) parent.set(ra, rb); }
    }
  }
  const groups = new Map();
  for (const p of list){ const r = find(p.id); (groups.get(r) || groups.set(r, []).get(r)).push(p); }
  const out = [];
  for (const members of groups.values()){
    if (members.length < 2) continue;
    const reasons = new Set(); let level = "medium";
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++){
      const r = pairInfo.get(pairKey(members[i].id, members[j].id)); if (!r) continue;
      r.reasons.forEach(x => reasons.add(x)); if (r.level === "high") level = "high";
    }
    out.push({ id: members.map(m => m.id).sort().join("|"), members, reasons: [...reasons], level });
  }
  out.sort((a, b) => (b.level === "high") - (a.level === "high") || b.members.length - a.members.length);
  return out;
}

export const pairKeyFor = (a, b) => [String(a), String(b)].sort().join("|");

/* ── Merge ───────────────────────────────────────────────────── */
const STATUS_RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
const TEXT_APPEND = ["outreachNotes", "verificationNotes", "remarks", "whyFit", "leadPainPoint"];
const EARLIEST = ["t1SendDate", "t2SendDate", "t3SendDate"];
const empty = v => v == null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Merge `others` into `keeper`. Keeper's own non-empty values win; gaps are
 * filled from the others. Returns a NEW object; nothing is mutated.
 *   • status: the furthest-along outreach stage (Do-Not-Respond always wins)
 *   • flags: OR-ed (doNotRespond, replyReceived, flagToMelissa, t3Approved)
 *   • tags: union • notes: appended without repeating identical text
 */
export function mergeProspects(keeper, others){
  const out = { ...keeper };
  const all = [keeper, ...others];
  for (const o of others){
    for (const [k, v] of Object.entries(o)){
      if (k === "id" || TEXT_APPEND.includes(k) || EARLIEST.includes(k) || k === "tags" || k === "currentStatus") continue;
      if (typeof v === "boolean") continue;
      if (empty(out[k]) && !empty(v)) out[k] = v;
    }
  }
  for (const f of ["doNotRespond", "replyReceived", "flagToMelissa", "t3Approved"]) out[f] = all.some(p => !!p[f]);
  out.tags = [...new Set(all.flatMap(p => p.tags || []))];
  for (const f of TEXT_APPEND){
    const parts = []; for (const p of all){ const t = String(p[f] ?? "").trim(); if (t && !parts.some(x => x.includes(t) || t.includes(x))) parts.push(t); }
    out[f] = parts.join(f === "outreachNotes" ? "\n— merged —\n" : " | ");
  }
  for (const f of EARLIEST){ const ds = all.map(p => p[f]).filter(Boolean).sort(); out[f] = ds[0] || ""; }
  out.currentStatus = out.doNotRespond ? "Do Not Respond"
    : all.map(p => p.currentStatus).filter(Boolean).sort((a, b) => (STATUS_RANK[b] ?? -1) - (STATUS_RANK[a] ?? -1))[0] || keeper.currentStatus;
  const pri = all.map(p => parseInt(p.priorityScore)).filter(n => !isNaN(n));
  if (pri.length) out.priorityScore = String(Math.max(...pri));
  return out;
}

/** Which record should survive a merge? Most complete + furthest along + has engagement. */
export function suggestKeeper(members){
  const filled = p => Object.entries(p).filter(([k, v]) => !k.startsWith("_") && k !== "id" && !(v == null || v === "" || v === false || (Array.isArray(v) && !v.length))).length;
  const score = p => filled(p) + (STATUS_RANK[p.currentStatus] ?? 0) * 2 + (p.replyReceived ? 6 : 0);
  return [...members].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Collapse finder results that are the same organisation found by several sources.
 * `list` should be best-first; the first of each cluster survives, gaps in it are filled from
 * the others, and `_alsoIn` records which other sources found it.
 */
export function collapseResults(list){
  const keep = [], keys = [];
  for (const r of list){
    const k = keysOf(r); let at = -1;
    for (let i = 0; i < keep.length; i++){ const m = comparePair(r, keep[i], k, keys[i]); if (m && m.level === "high"){ at = i; break; } }
    if (at < 0){ keep.push({ ...r }); keys.push(k); continue; }
    const host = keep[at];
    for (const [f, v] of Object.entries(r)){ if (f.startsWith("_") || f === "id" || typeof v === "boolean") continue; if (empty(host[f]) && !empty(v)) host[f] = v; }
    if (r._source && r._source !== host._source) host._alsoIn = [...new Set([...(host._alsoIn || []), r._source])];
    keys[at] = keysOf(host);
  }
  return keep;
}
