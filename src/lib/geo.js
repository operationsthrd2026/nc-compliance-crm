/* ════════════════════════════════════════════════════════════════
   Map helpers — place a prospect on the U.S. map
   ────────────────────────────────────────────────────────────────
   The CRM stores a market / city as TEXT ("Austin, TX", "Raleigh"),
   not coordinates. We therefore:
     1. read the U.S. state out of the text ("Austin, TX" → TX),
     2. use a bundled city table when the city is known (no paid API),
     3. otherwise place the prospect at its STATE centre ("approximate"),
     4. treat an unqualified name ("Raleigh") as North Carolina ONLY
        when it matches a known NC market — legacy data from before
        the nationwide expansion — and never when a state is given.
   A city is never placed in a state that the text doesn't name.
════════════════════════════════════════════════════════════════ */
import { NC_CITY_COORDS } from "../constants.js";
import { US_STATES } from "./usLocation.js";
import { STATE_CENTROIDS, US_CITIES, cityKey } from "./usCities.js";

const STATE_CODES = new Set(US_STATES.map(([c]) => c));
const NAME_TO_CODE = Object.fromEntries(US_STATES.map(([c, n]) => [n.toLowerCase(), c]));
const CODE_TO_NAME = Object.fromEntries(US_STATES);
const NC_LOWER = Object.fromEntries(Object.keys(NC_CITY_COORDS).map(k => [k.toLowerCase(), k]));
const NC_NAMES_LONGEST_FIRST = Object.keys(NC_CITY_COORDS).sort((a, b) => b.length - a.length);

export const stateName = code => CODE_TO_NAME[code] || code;

/** "Austin, TX 78701" → {city:"Austin", state:"TX"};  "Texas" → {city:"",state:"TX"};  "Raleigh" → {city:"Raleigh",state:""} */
export function parseLocation(text){
  let s = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!s || /^united states( of america)?$|^usa?$/i.test(s)) return { city: "", state: "" };
  s = s.replace(/[\s,]*\b\d{5}(?:-\d{4})?$/, "").replace(/[\s,]+$/, "").replace(/,?\s*(?:USA|United States)$/i, "");
  // trailing state: "…, TX" / "… TX" (code must be UPPER-case) or "…, Texas"
  let m = s.match(/^(.*?)[,\s]+([A-Z]{2})$/);
  if (m && STATE_CODES.has(m[2])) return { city: m[1].replace(/[,\s]+$/, ""), state: m[2] };
  if (STATE_CODES.has(s)) return { city: "", state: s };
  m = s.match(/^(.*?),\s*([A-Za-z .]+)$/);
  if (m && NAME_TO_CODE[m[2].toLowerCase()]) return { city: m[1], state: NAME_TO_CODE[m[2].toLowerCase()] };
  if (NAME_TO_CODE[s.toLowerCase()]) return { city: "", state: NAME_TO_CODE[s.toLowerCase()] };
  return { city: s, state: "" };
}

const titleCase = s => s.replace(/\b([a-z])([a-z']*)/gi, (_, a, b) => a.toUpperCase() + b.toLowerCase());
const LABELS = new Map();
const cache = new Map();

function lookupCity(city, state){
  if (!city) return null;
  if (state === "NC"){ const k = NC_LOWER[city.toLowerCase()]; if (k) return { coords: NC_CITY_COORDS[k], label: k }; }
  const c = US_CITIES.get(cityKey(city, state));
  return c ? { coords: c, label: titleCase(city.replace(/\bst\b\.?/i, "St.")) } : null;
}

function compute(p){
  const a = parseLocation(p.market), b = parseLocation(p.cityMarket);
  let { city, state } = a.state ? a : b.state ? b : { city: a.city || b.city, state: "" };
  if (a.state && !a.city && b.city && (!b.state || b.state === a.state)) city = b.city;   // market="NC", cityMarket="Cary"
  if (!state){
    // Legacy data written before the nationwide expansion: a bare name that is a known NC market.
    const hay = `${a.city} ${b.city}`.toLowerCase();
    const nc = NC_LOWER[city.toLowerCase()] || NC_NAMES_LONGEST_FIRST.find(n => new RegExp(`(^|[^a-z])${n.toLowerCase()}([^a-z]|$)`).test(hay));
    if (!nc) return null;
    city = nc; state = "NC";
  }
  const hit = lookupCity(city, state);
  if (hit){ const key = `${cityKey(hit.label, state)}`; const label = `${hit.label}, ${state}`; LABELS.set(key, label); return { key, label, city: hit.label, state, coords: hit.coords, precision: "city" }; }
  if (!STATE_CENTROIDS[state]) return null;
  LABELS.set(state, stateName(state));
  return { key: state, label: stateName(state), city: "", state, coords: STATE_CENTROIDS[state], precision: "state" };
}

/** @returns {{key,label,city,state,coords:[number,number],precision:'city'|'state'}|null} */
export function placeOf(p){
  const ck = `${p.market ?? ""}\u0001${p.cityMarket ?? ""}`;
  if (cache.has(ck)) return cache.get(ck);
  const r = compute(p); if (cache.size > 5000) cache.clear(); cache.set(ck, r); return r;
}
export const placeKey = p => placeOf(p)?.key || null;
export const placeLabel = key => LABELS.get(key) || (STATE_CODES.has(key) ? stateName(key) : key);

export function groupByPlace(rows){
  const m = new Map(); let unplaced = 0;
  for (const p of rows){
    const pl = placeOf(p);
    if (!pl){ unplaced++; continue; }
    const g = m.get(pl.key) || m.set(pl.key, { ...pl, rows: [] }).get(pl.key);
    g.rows.push(p);
  }
  return { groups: [...m.values()], unplaced };
}

/** Deterministic offset seeded by a string. scale=1 ≈ ±800 m (city pins); scale≈80 ≈ ±60 km (state-level pins). */
export function jitter([lat, lon], seed, scale = 1){
  let h = 0; const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return [lat + (((h % 1000) / 1000) - 0.5) * 0.012 * scale, lon + ((((h >> 10) % 1000) / 1000) - 0.5) * 0.012 * scale];
}
