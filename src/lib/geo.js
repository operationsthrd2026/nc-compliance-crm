/* ════════════════════════════════════════════════════════════════
   Map helpers — place a prospect on the NC map (city-level)
   The CRM stores a market/city, not coordinates, so pins are placed at
   the city centre with a small deterministic offset so they don't stack.
════════════════════════════════════════════════════════════════ */
import { NC_CITY_COORDS } from "../constants.js";

const CITY_NAMES = Object.keys(NC_CITY_COORDS);

/** "Raleigh" (market) → "Raleigh";  "Cary, NC 27511" → "Cary";  else null */
export function placeOf(p){
  if (p.market && NC_CITY_COORDS[p.market]) return p.market;
  const hay = String(p.cityMarket || "").toLowerCase();
  if (hay){
    // longest names first so "Chapel Hill" wins over a hypothetical "Hill"
    for (const c of [...CITY_NAMES].sort((a, b) => b.length - a.length)){
      if (new RegExp(`\\b${c.toLowerCase()}\\b`).test(hay)) return c;
    }
  }
  return null;
}

export function groupByPlace(rows){
  const m = new Map(); let unplaced = 0;
  for (const p of rows){
    const place = placeOf(p);
    if (!place){ unplaced++; continue; }
    (m.get(place) || m.set(place, []).get(place)).push(p);
  }
  return { places: m, unplaced };
}

/** Deterministic ±~800 m offset seeded by a string (same prospect → same spot). */
export function jitter([lat, lon], seed){
  let h = 0; const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return [lat + (((h % 1000) / 1000) - 0.5) * 0.012, lon + ((((h >> 10) % 1000) / 1000) - 0.5) * 0.012];
}

export const coordsOf = place => NC_CITY_COORDS[place] || null;
