/* ════════════════════════════════════════════════════════════════
   Street-view and map links.
   • No API key, no cost, no tracking: these are plain links that Google / OpenStreetMap document for exactly
     this purpose. Nothing is sent anywhere until a person clicks one.
   • Exact links need coordinates. Where a prospect has none (e.g. nonprofits, which only list a city) we offer a
     "Find on Maps" search by name + place instead, and never invent a location.
   • An embedded, draggable Street View inside the app needs a Google Maps API key with billing; that is a
     separate decision and is not used here.
════════════════════════════════════════════════════════════════ */
const num = v => (v === "" || v == null || typeof v === "boolean" ? NaN : Number(v));

export const validCoords = (lat, lon) => {
  const a = num(lat), b = num(lon);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
};
/** Street View at the exact spot (Google "Maps URLs": map_action=pano). */
export const streetViewUrl = (lat, lon) => validCoords(lat, lon) ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${num(lat).toFixed(6)},${num(lon).toFixed(6)}` : "";
export const googleMapsUrl = (lat, lon) => validCoords(lat, lon) ? `https://www.google.com/maps/search/?api=1&query=${num(lat).toFixed(6)},${num(lon).toFixed(6)}` : "";
export const mapsSearchUrl = (...parts) => { const q = parts.map(x => String(x ?? "").trim()).filter(Boolean).join(", "); return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : ""; };
export const osmUrl = (lat, lon, zoom = 18) => validCoords(lat, lon) ? `https://www.openstreetmap.org/?mlat=${num(lat).toFixed(6)}&mlon=${num(lon).toFixed(6)}#map=${zoom}/${num(lat).toFixed(6)}/${num(lon).toFixed(6)}` : "";

/** The best links we can honestly offer for a prospect. */
export function locationLinks(p = {}){
  const exact = validCoords(p.latitude, p.longitude);
  const where = [p.companyName, p.streetAddress || p.cityMarket || p.market];
  return {
    exact,
    streetView: exact ? streetViewUrl(p.latitude, p.longitude) : "",
    map: exact ? googleMapsUrl(p.latitude, p.longitude) : mapsSearchUrl(...where),
    osm: exact ? osmUrl(p.latitude, p.longitude) : "",
  };
}

/** "10 Main St, Austin, TX 78701" from an OpenStreetMap-style address object. */
export const formatAddress = (a = {}) => [a.street, a.city, [a.state, a.postcode].filter(Boolean).join(" ")].map(x => String(x || "").trim()).filter(Boolean).join(", ");

/** What to store: a coordinate PAIR, or nothing. A lone or out-of-range number is dropped rather than guessed at. */
export function geoForDb(p = {}){
  const ok = validCoords(p.latitude, p.longitude);
  return { latitude: ok ? num(p.latitude) : null, longitude: ok ? num(p.longitude) : null, street_address: p.streetAddress ? String(p.streetAddress).trim().slice(0, 300) || null : null };
}
