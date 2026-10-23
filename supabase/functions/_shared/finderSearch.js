/* ════════════════════════════════════════════════════════════════
   Prospect-finder search logic — pure JavaScript (no Deno or Node APIs) so the edge functions
   AND the unit tests use the exact same code.

   Why this exists: the search used to (a) cut results to the first 60 and THEN filter them by the
   typed keyword, (b) spend those slots on places with no name, (c) search only 3 of the chosen
   categories, (d) ignore the radius above 15 miles, and (e) return no address or coordinates.
   Everything here is built so that filtering happens INSIDE the query, nearest results come first,
   and every result carries a street address and exact coordinates when OpenStreetMap has them.
════════════════════════════════════════════════════════════════ */

export const MAX_TAGS = 12;
export const MAX_HINTS = 8;
export const MAX_RADIUS_MILES = 25;     // server-side cap (keeps the shared public Overpass servers healthy)
export const BUSINESS_KEYS = ["shop", "office", "craft", "amenity", "healthcare", "leisure", "tourism"];
const SAFE_TOKEN = /^[a-z_]{2,30}$/;

/** Text that may safely go inside a quoted Overpass QL string: letters, digits, space and & ' . - only. */
/** @param {unknown} s @param {number} [max] @returns {string} */
export const sanitizeText = (s, max = 60) =>
  String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 &'.\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** @param {unknown} tags @returns {boolean} */
export const validTags = tags =>
  Array.isArray(tags) && tags.length >= 1 && tags.length <= MAX_TAGS &&
  tags.every(t => Array.isArray(t) && t.length === 2 && t.every(v => typeof v === "string" && SAFE_TOKEN.test(v)));

/** @param {number} lat @param {number} lon @returns {boolean} */
export const inUS = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= 18 && lat <= 72 && lon >= -180 && lon <= -65;

/**
 * Build the Overpass query. All filtering is INSIDE the query: only NAMED places, every requested category,
 * the keyword as a name match, and optional name hints (e.g. "home care") for places that are not tagged.
 */
/**
 * @param {{lat:number, lon:number, radiusMiles:number, tags?:string[][], nameHints?:string[], keyword?:string, limit?:number, timeout?:number}} o
 * @returns {string|null}
 */
export function buildOverpassQuery({ lat, lon, radiusMiles, tags = [], nameHints = [], keyword = "", limit = 300, timeout = 25 }){
  const r = Number(radiusMiles);
  const miles = Math.min(Math.max(Number.isFinite(r) ? r : 5, 1), MAX_RADIUS_MILES);     // not a number → 5; below 1 → 1; above the cap → the cap
  const around = `(around:${Math.round(miles * 1609.344)},${Number(lat).toFixed(5)},${Number(lon).toFixed(5)})`;
  const kw = sanitizeText(keyword, 40);
  const hints = (nameHints || []).map(h => sanitizeText(h, 30)).filter(h => h.length >= 3).slice(0, MAX_HINTS);
  const good = (tags || []).filter(t => Array.isArray(t) && t.length === 2 && t.every(v => typeof v === "string" && SAFE_TOKEN.test(v))).slice(0, MAX_TAGS);
  const clauses = [];
  if (kw){
    // a typed name is a NAME search; stay inside the chosen category when there is one
    if (good.length) for (const [k, v] of good) clauses.push(`nwr["${k}"="${v}"]["name"~"${kw}",i]${around};`);
    else for (const k of BUSINESS_KEYS) clauses.push(`nwr["${k}"]["name"~"${kw}",i]${around};`);
  } else {
    for (const [k, v] of good) clauses.push(`nwr["${k}"="${v}"]["name"]${around};`);
    if (hints.length) clauses.push(`nwr["name"~"${hints.join("|")}",i]${around};`);
  }
  if (!clauses.length) return null;
  return `[out:json][timeout:${Math.min(Math.max(timeout | 0, 5), 40)}];(${clauses.join("")});out tags center ${Math.min(Math.max(limit | 0, 10), 500)};`;
}

export function haversineMiles(lat1, lon1, lat2, lon2){
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Raw Overpass elements → clean results: named only, one per place (a building mapped as both a point and
 * an outline is ONE result), with coordinates, distance and a structured street address; nearest first,
 * with the most complete listings first among equals.
 */
/**
 * @param {any[]|null|undefined} elements
 * @param {{lat?:number, lon?:number, max?:number}} [opts]
 * @returns {any[]}
 */
export function normalizeElements(elements, { lat, lon, max = 100 } = {}){
  const out = [], byName = new Map();          // name → coordinates already kept (the same place mapped twice is ONE result)
  for (const e of Array.isArray(elements) ? elements : []){
    const t = e?.tags || {}; const name = String(t.name || "").trim(); if (!name) continue;
    const c = Number.isFinite(e.lat) && Number.isFinite(e.lon) ? { lat: e.lat, lon: e.lon }
            : e.center && Number.isFinite(e.center.lat) && Number.isFinite(e.center.lon) ? { lat: e.center.lat, lon: e.center.lon } : null;
    const key = slug(name), kept = byName.get(key) || [];
    // same name within ~0.1 mile (a point and an outline of one building) = the same place; a branch farther away is a different one
    if (kept.some(k => (c && k ? haversineMiles(c.lat, c.lon, k.lat, k.lon) < 0.1 : !c && !k && false))) continue;
    kept.push(c); byName.set(key, kept);
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    const address = { street, city: t["addr:city"] || "", state: t["addr:state"] || "", postcode: t["addr:postcode"] || "" };
    const contact = [t.phone || t["contact:phone"], t.website || t["contact:website"], t.email || t["contact:email"], street].filter(Boolean).length;
    out.push({ ...e, lat: c?.lat ?? null, lon: c?.lon ?? null, address, completeness: contact,
      distanceMiles: c && Number.isFinite(lat) && Number.isFinite(lon) ? Math.round(haversineMiles(lat, lon, c.lat, c.lon) * 100) / 100 : null });
  }
  out.sort((a, b) => (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9) || b.completeness - a.completeness);
  return out.slice(0, max);
}

/* ─── nonprofits (ProPublica Nonprofit Explorer) ──────────────── */

/** ProPublica's NTEE major groups: 1 Arts/culture · 2 Education · 3 Environment/animals · 4 Health · 5 Human services ·
    6 International · 7 Public/societal benefit · 8 Religion-related · 9 Membership benefit · 10 Unknown */
export const NTEE_BY_VERTICAL = {
  "Education & Schools": 2, "Healthcare Practices": 4, "Home Health / Homecare": 4, "Human Services Nonprofits": 5, "Social Service Agencies": 5,
  "Community Development Orgs": 5, "Childcare & Licensed Group Homes": 5, "Arts & Cultural Nonprofits": 1, "Environmental Nonprofits": 3,
  "Faith-Based Organizations": 8, "Religious & Faith-Based Nonprofits": 8, "Advocacy Organizations": 7, "Foundations & Grantmakers": 7,
};
const GENERIC_TERMS = ["foundation", "services", "center"];

/**
 * The ProPublica requests to make for one search. ProPublica can filter by STATE and industry group but not by city,
 * and `q` matches NAMES. So for a city (or industry) search with no keyword we sample several common name words and
 * several pages each, then keep only organisations whose city matches — instead of searching for the city's name.
 */
/**
 * @param {{query?:string, city?:string, state?:string, vertical?:string, page?:number, pagesPerRequest?:number}} o
 * @returns {Record<string,string|number>[]}
 */
export function nonprofitSearchPlan({ query, city, state, vertical, page = 0, pagesPerRequest = 3 }){
  const q = sanitizeText(query, 100), ntee = NTEE_BY_VERTICAL[vertical] || null, st = /^[A-Z]{2}$/.test(String(state || "")) ? state : null;
  const terms = q ? [q] : (city || ntee) ? GENERIC_TERMS : ["foundation"];
  const reqs = [];
  for (const term of terms) for (let i = 0; i < pagesPerRequest; i++){
    const p = { q: term, page: Math.max(0, page) * pagesPerRequest + i };
    if (st) p["state[id]"] = st; if (ntee) p["ntee[id]"] = ntee; reqs.push(p);
  }
  return reqs;
}

/** Merge several ProPublica result lists: one row per EIN, only the requested city, alphabetical. */
/**
 * @param {any[][]} lists
 * @param {{city?:string}} [opts]
 * @returns {any[]}
 */
export function mergeNonprofits(lists, { city } = {}){
  const want = slug(city), seen = new Set(), out = [];
  for (const o of (lists || []).flat()){
    if (!o) continue; const id = o.ein || slug(o.name) + "|" + slug(o.city); if (seen.has(id)) continue; seen.add(id);
    if (want && slug(o.city) !== want) continue; out.push(o);
  }
  return out.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}
