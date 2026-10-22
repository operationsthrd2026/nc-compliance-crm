/* ════════════════════════════════════════════════════════════════
   Email checking
   ────────────────────────────────────────────────────────────────
   What this CAN tell you (no API key needed):
     • syntax is valid  • not a disposable/no-reply address
     • the domain exists and has a mail server (DNS MX lookup)
     • likely typos in the domain ("gmial.com")
   What it CANNOT tell you without a paid verifier: whether that exact
   mailbox exists. If a Hunter key is configured, Hunter's verifier is
   used to confirm the mailbox ("confirmed": true).
   Statuses: valid | risky | invalid | unknown
════════════════════════════════════════════════════════════════ */
import { domainOfEmail, isFreemail } from "./text.js";

const SYNTAX = /^[a-z0-9._%+'-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;
const DISPOSABLE = new Set(["mailinator.com","guerrillamail.com","10minutemail.com","tempmail.com","temp-mail.org","yopmail.com","trashmail.com","sharklasers.com","getnada.com","throwawaymail.com","maildrop.cc","dispostable.com","fakeinbox.com"]);
const NOREPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|postmaster|abuse|bounce)/i;
const GENERIC_LOCAL = new Set(["info","contact","office","admin","hello","support","sales","team","mail","enquiries","inquiries","general","frontdesk","reception"]);
const TYPOS = { "gmial.com":"gmail.com","gamil.com":"gmail.com","gmai.com":"gmail.com","gmail.co":"gmail.com","gmail.con":"gmail.com","yahooo.com":"yahoo.com","yaho.com":"yahoo.com","yahoo.con":"yahoo.com","hotmial.com":"hotmail.com","hotmail.con":"hotmail.com","outlok.com":"outlook.com","outlook.con":"outlook.com","aol.con":"aol.com","icloud.con":"icloud.com" };

export function localCheck(email){
  const e = String(email ?? "").trim().toLowerCase();
  const domain = domainOfEmail(e); const local = e.split("@")[0] || "";
  const res = { email: e, domain, syntaxOk: SYNTAX.test(e) && !/\.\./.test(e), disposable: DISPOSABLE.has(domain),
    noReply: NOREPLY.test(local), generic: GENERIC_LOCAL.has(local.replace(/[^a-z]/g, "")), webmail: isFreemail(domain), suggestion: TYPOS[domain] || null };
  return res;
}

/** DNS lookup through DNS-over-HTTPS (Cloudflare). Works from a browser, no key. */
export async function mxLookup(domain, { fetchImpl = globalThis.fetch, timeoutMs = 6000 } = {}){
  const q = async type => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: ctl.signal });
      if (!r.ok) throw new Error(`DNS HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  };
  try {
    const mx = await q("MX");
    if (mx.Status === 3) return { ok: true, nxdomain: true, hasMx: false, hasA: false };
    const hasMx = (mx.Answer || []).some(a => a.type === 15 && !/^\s*\d+\s+\.?\s*$/.test(a.data)); // "0 ." = null MX (explicitly no mail)
    if (hasMx) return { ok: true, hasMx: true, hasA: true };
    const a = await q("A");
    return { ok: true, hasMx: false, hasA: (a.Answer || []).some(x => x.type === 1) };
  } catch (err){ return { ok: false, error: err.message || "lookup failed" }; }
}

const domainCache = new Map();

/**
 * @param {string} email
 * @param {{fetchImpl?:Function, hunterVerify?:(email:string)=>Promise<{result:string}|null>, now?:()=>string}} opts
 * @returns {{status, reasons:string[], flags:string[], confirmed:boolean, checkedAt:string, suggestion?:string}}
 */
export async function verifyEmail(email, opts = {}){
  const now = opts.now || (() => new Date().toISOString());
  const l = localCheck(email); const reasons = []; const flags = [];
  const done = (status, extra = {}) => ({ status, reasons, flags, confirmed: false, checkedAt: now(), ...extra });

  if (!l.syntaxOk){ reasons.push("Not a valid email address"); return done("invalid"); }
  if (l.disposable){ reasons.push("Disposable/temporary email service"); return done("invalid"); }
  if (l.noReply){ reasons.push("No-reply or system address — nobody reads it"); return done("invalid"); }
  if (l.generic) flags.push("generic");
  if (l.webmail) flags.push("webmail");

  let status = "valid";
  if (l.suggestion){ reasons.push(`Possible typo — did you mean @${l.suggestion}?`); status = "risky"; }

  if (!domainCache.has(l.domain)) domainCache.set(l.domain, mxLookup(l.domain, opts));
  const dns = await domainCache.get(l.domain);
  if (!dns.ok){ domainCache.delete(l.domain); reasons.push("Couldn't check the domain right now (network)"); return done(status === "risky" ? "risky" : "unknown", { suggestion: l.suggestion || undefined }); }
  if (dns.nxdomain){ reasons.push(`Domain ${l.domain} doesn't exist`); return done("invalid", { suggestion: l.suggestion || undefined }); }
  if (!dns.hasMx && !dns.hasA){ reasons.push(`${l.domain} can't receive email`); return done("invalid"); }
  if (!dns.hasMx){ reasons.push("No mail server record — mail would fall back to the website server"); status = "risky"; }
  else reasons.push(`${l.domain} accepts email`);

  let confirmed = false;
  if (opts.hunterVerify && status !== "invalid"){
    try {
      const h = await opts.hunterVerify(l.email);
      if (h?.result === "deliverable"){ confirmed = true; status = status === "risky" && l.suggestion ? "risky" : "valid"; reasons.push("Mailbox confirmed by Hunter"); }
      else if (h?.result === "undeliverable"){ status = "invalid"; reasons.push("Hunter: mailbox doesn't exist"); }
      else if (h?.result === "risky"){ status = "risky"; reasons.push("Hunter: delivery is uncertain (catch-all or full)"); }
    } catch { /* optional enhancement — ignore failures */ }
  }
  return done(status, { confirmed, suggestion: l.suggestion || undefined });
}

/** Run fn over items with limited concurrency; preserves order. */
export async function mapPool(items, limit, fn, onProgress){
  const out = new Array(items.length); let next = 0, doneN = 0;
  const worker = async () => { while (next < items.length){ const i = next++; out[i] = await fn(items[i], i); onProgress?.(++doneN, items.length); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const EMAIL_STATUS = {
  valid:   { label: "Valid",     color: "var(--k-green)" },
  risky:   { label: "Risky",     color: "var(--k-amber)" },
  invalid: { label: "Invalid",   color: "var(--k-red)" },
  unknown: { label: "Unknown",   color: "var(--k-text2)" },
  "":      { label: "Unchecked", color: "var(--k-text3)" },
};
export const _clearDnsCache = () => domainCache.clear();
