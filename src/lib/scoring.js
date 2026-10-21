/* ════════════════════════════════════════════════════════════════
   Prospect fit score (0–100) — fully explainable, NOT a conversion
   probability. There is no sales-outcome history to learn from, so this
   is a transparent rubric: how likely is this organisation to NEED
   outside HR-compliance help, and can we actually reach someone?

   Every point is traceable to a labelled factor (see `factors`), and all
   weights live in SCORING below so the team can tune them without
   touching any other code.
════════════════════════════════════════════════════════════════ */
import { extractEmails, extractPhones } from "./text.js";


export const SCORING = {
  // Max 25 — heavier regulation ⇒ heavier HR/compliance burden (licensing,
  // credentialing, wage-hour, safety). Defaults are a starting assumption.
  verticalWeights: {
    "Home Health / Homecare": 25, "Childcare & Licensed Group Homes": 25, "Healthcare Practices": 22,
    "Human Services Nonprofits": 21, "Social Service Agencies": 21, "Construction & Contractors": 20,
    "Light Manufacturing & Logistics": 18, "Education & Schools": 16, "Nonprofits & Associations": 16,
    "Community Development Orgs": 14, "Faith-Based Organizations": 12, "Religious & Faith-Based Nonprofits": 12,
    "Advocacy Organizations": 12, "Environmental Nonprofits": 11, "Arts & Cultural Nonprofits": 10,
    "Foundations & Grantmakers": 7,
  },
  verticalUnknown: 8,
  // Max 20 — big enough to need HR, too small to have a department.
  sizeWeights: { "1-9": 6, "10-49": 18, "50-99": 20, "100-249": 15, "250-499": 8, "500+": 3 },
  sizeUnknown: 8,
  // Max 15
  hrGap: { No: 15, Yes: 3, unknown: 7 },
  // Max 20
  reach: { contact: 5, personalEmail: 10, hrEmail: 9, genericEmail: 5, phone: 3, verifiedBonus: 2 },
  // Max 10 each
  presence: { website: 5, knownMarket: 5 },
  engagement: { replied: 10, flagged: 4 },
  tiers: { hot: 70, strong: 50, possible: 30 },
};

const GENERIC = new Set(["info", "contact", "office", "admin", "hello", "support", "sales", "team", "mail", "enquiries", "inquiries", "general", "frontdesk", "reception"]);
const HR_ROLE = new Set(["hr", "humanresources", "people", "jobs", "careers", "recruiting", "payroll"]);

export function emailKind(email){
  const local = String(email).split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  if (HR_ROLE.has(local)) return "hr";
  if (GENERIC.has(local)) return "generic";
  return "personal";
}

export const TIERS = {
  hot:      { label: "Hot",      color: "#f472b6" },
  strong:   { label: "Strong",   color: "#34d399" },
  possible: { label: "Possible", color: "#fbbf24" },
  low:      { label: "Low",      color: "rgba(240,244,255,0.38)" },
  excluded: { label: "Excluded", color: "#f87171" },
};

export function scoreProspect(p, cfg = SCORING){
  if (p.doNotRespond || p.currentStatus === "Do Not Respond"){
    return { score: 0, tier: "excluded", ...TIERS.excluded, factors: [{ key: "dnr", label: "Do not respond", points: 0, max: 0, note: "Marked Do Not Respond — excluded from outreach" }], missing: [] };
  }
  const factors = []; const missing = [];
  const add = (key, label, points, max, note) => factors.push({ key, label, points, max, note });

  // 1. Vertical
  const vw = cfg.verticalWeights[p.vertical];
  if (vw != null) add("vertical", "Industry", vw, 25, `${p.vertical}${vw >= 20 ? " — heavily regulated" : ""}`);
  else { add("vertical", "Industry", cfg.verticalUnknown, 25, "No industry set"); missing.push("industry"); }

  // 2. Size
  const sw = cfg.sizeWeights[p.orgSize];
  if (sw != null) add("size", "Organisation size", sw, 20, `${p.orgSize} employees${sw >= 15 ? " — needs HR help, unlikely to have a department" : sw <= 6 ? " — very small or very large" : ""}`);
  else { add("size", "Organisation size", cfg.sizeUnknown, 20, "Size unknown (neutral)"); missing.push("organisation size"); }

  // 3. HR gap
  const hr = p.hrPersonListed === "No" ? "No" : p.hrPersonListed === "Yes" ? "Yes" : "unknown";
  add("hrgap", "HR gap", cfg.hrGap[hr], 15, hr === "No" ? "No HR person listed — likely under-served" : hr === "Yes" ? "Already has an HR contact" : "HR staffing unknown (neutral)");
  if (hr === "unknown") missing.push("HR person listed");

  // 4. Reachability
  const emails = extractEmails(p.emailPhone), phones = extractPhones(p.emailPhone);
  let reach = 0; const notes = [];
  if (p.contactName){ reach += cfg.reach.contact; notes.push("named contact"); } else missing.push("contact name");
  if (p.emailStatus === "invalid" && emails.length){ notes.push("email failed verification (0)"); }
  else if (emails.length){
    const kinds = emails.map(emailKind);
    const k = kinds.includes("personal") ? "personal" : kinds.includes("hr") ? "hr" : "generic";
    reach += k === "personal" ? cfg.reach.personalEmail : k === "hr" ? cfg.reach.hrEmail : cfg.reach.genericEmail;
    notes.push(k === "personal" ? "personal email" : k === "hr" ? "HR mailbox" : "generic mailbox");
    if (p.emailStatus === "valid"){ reach += cfg.reach.verifiedBonus; notes.push("verified"); }
  } else missing.push("email");
  if (phones.length){ reach += cfg.reach.phone; notes.push("phone"); }
  reach = Math.min(20, reach);
  add("reach", "Reachability", reach, 20, notes.join(", ") || "No contact details");

  // 5. Presence + market
  const known = Boolean(String(p.market||p.cityMarket||"").trim());
  add("presence", "Online presence & market", (p.sourceUrl ? cfg.presence.website : 0) + (known ? cfg.presence.knownMarket : 0), 10,
    [p.sourceUrl ? "has website" : "no website", known ? `${p.market} market` : "market not set"].join(", "));

  // 6. Engagement (only meaningful for existing CRM records)
  const eng = p.replyReceived ? cfg.engagement.replied : p.flagToMelissa ? cfg.engagement.flagged : 0;
  if (eng) add("engagement", "Engagement", eng, 10, p.replyReceived ? "Replied to outreach" : "Flagged for review");

  const score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));
  const tier = score >= cfg.tiers.hot ? "hot" : score >= cfg.tiers.strong ? "strong" : score >= cfg.tiers.possible ? "possible" : "low";
  return { score, tier, ...TIERS[tier], factors, missing };
}

/** 1–10 priority (the CRM's existing "Pri." column) from a 0–100 score. */
export const priorityFromScore = score => Math.max(1, Math.min(10, Math.ceil(score / 10)));

/** One-line, human-readable reason for the score (saved into "Why fit" when a result is added). */
export function explainFit(result){
  if (!result || result.tier === "excluded") return "";
  const strong = result.factors.filter(f => f.max > 0 && f.points >= f.max * 0.6 && f.key !== "presence").map(f => f.note.replace(/ — .*$/, ""));
  return `Fit ${result.score}/100 (${result.label})${strong.length ? ": " + strong.join("; ") : ""}`;
}
