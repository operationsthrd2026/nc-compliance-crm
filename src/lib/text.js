/* ════════════════════════════════════════════════════════════════
   Text normalisation + similarity helpers (pure, no dependencies)
════════════════════════════════════════════════════════════════ */

// Providers where an email domain says nothing about the organisation.
export const FREEMAIL = new Set([
  "gmail.com","googlemail.com","yahoo.com","ymail.com","hotmail.com","outlook.com","live.com","msn.com",
  "aol.com","icloud.com","me.com","comcast.net","verizon.net","att.net","sbcglobal.net","bellsouth.net",
  "protonmail.com","proton.me","gmx.com","mail.com","earthlink.net","charter.net","windstream.net",
]);

// Legal-form / filler words that must not decide whether two names match.
const NAME_NOISE = new Set([
  "inc","incorporated","llc","l","c","llp","lp","corp","corporation","co","company","ltd","limited",
  "pllc","pc","pa","the","of","and","dba",
]);

export function stripAccents(s){ return String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); }

/** "ACME Home-Care, L.L.C." -> "acme home care" */
export function normalizeName(name){
  const cleaned = stripAccents(name).toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’`]/g, "")          // l.l.c. -> llc, don't -> dont
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return cleaned.split(/\s+/).filter(t => t && !NAME_NOISE.has(t)).join(" ");
}

export function nameTokens(name){ return normalizeName(name).split(" ").filter(Boolean); }

export function bigrams(s){
  const t = s.replace(/\s+/g, " ");
  if (t.length < 2) return t ? [t] : [];
  const out = []; for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice on character bigrams (forgives typos / small word changes). */
export function dice(a, b){
  if (!a || !b) return 0;
  if (a === b) return 1;
  return diceBigrams(bigrams(a), bigrams(b));
}

/** Same as dice() but on precomputed bigram arrays (hot path for dedupe). */
export function diceBigrams(A, B){
  if (!A.length || !B.length) return 0;
  const counts = new Map(); for (const g of A) counts.set(g, (counts.get(g) || 0) + 1);
  let hit = 0; for (const g of B){ const c = counts.get(g); if (c > 0){ hit++; counts.set(g, c - 1); } }
  return (2 * hit) / (A.length + B.length);
}

export function jaccard(ta, tb){
  const A = ta instanceof Set ? ta : new Set(ta), B = tb instanceof Set ? tb : new Set(tb); if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Similarity from precomputed fingerprints {name, set, bg}. */
export function similarityKeys(ka, kb){
  if (!ka.name || !kb.name) return 0;
  if (ka.name === kb.name) return 1;
  const jac = jaccard(ka.set, kb.set);
  const dc = diceBigrams(ka.bg, kb.bg);
  return Math.max(jac * 0.9, dc * 0.5 + jac * 0.5);
}

/** 0..1 similarity between two organisation names. 1 = same after normalisation. */
export function nameSimilarity(a, b){
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const jac = jaccard(na.split(" "), nb.split(" "));
  const dc = dice(na, nb);
  return Math.max(jac * 0.9, dc * 0.5 + jac * 0.5);
}

export const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function extractEmails(text){
  const m = String(text ?? "").match(EMAIL_RE) || [];
  return [...new Set(m.map(e => e.toLowerCase().replace(/[.,;:]+$/, "")))];
}

/** Last-10-digit phone numbers found in free text ("(919) 555-0100 / +1 919.555.0101"). */
export function extractPhones(text){
  const s = String(text ?? "").replace(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " "); // drop emails first
  const out = new Set();
  const re = /(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/g;
  for (const m of s.match(re) || []){ const d = m.replace(/\D/g, ""); if (d.length >= 10) out.add(d.slice(-10)); }
  return [...out];
}

export function domainOfEmail(email){ const m = String(email ?? "").toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/); return m ? m[1] : ""; }

/** Registrable-ish domain from a URL or bare host: "https://www.Acme.org/about" -> "acme.org" */
export function domainOfUrl(url){
  let s = String(url ?? "").trim().toLowerCase(); if (!s) return "";
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].split(":")[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : "";
}

export const isFreemail = d => FREEMAIL.has(String(d ?? "").toLowerCase());
