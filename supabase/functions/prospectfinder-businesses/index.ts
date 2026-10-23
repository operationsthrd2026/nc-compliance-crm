import { finderCors, requireCrmUser, response } from "../_shared/prospectfinder-auth.ts";
import { buildOverpassQuery, normalizeElements, validTags, inUS, MAX_RADIUS_MILES } from "../_shared/finderSearch.js";

// Structured local-business search (OpenStreetMap via Overpass).
// The browser sends INTENT (area, categories, optional name keyword / name hints); this function builds the query
// itself from validated tokens, so no query text from the browser is ever executed.
// Filtering (named places only, every category, the keyword) happens INSIDE the query, results are de-duplicated,
// sorted nearest-first and returned with street address and exact coordinates.
const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const RAW_LIMIT = 300, RETURN_LIMIT = 100;

Deno.serve(async (req: Request) => {
  const headers = finderCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405, headers);
  const auth = await requireCrmUser(req, headers);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return response({ error: "Invalid JSON" }, 400, headers); }

  const lat = Number(body.lat), lon = Number(body.lon), radiusMiles = Number(body.radiusMiles);
  const keyword = String(body.keyword ?? "").slice(0, 60);
  const tags = Array.isArray(body.tags) ? body.tags : [];
  const nameHints = Array.isArray(body.nameHints) ? body.nameHints.filter((h) => typeof h === "string").slice(0, 8) : [];
  const hasTags = tags.length > 0;
  if (!inUS(lat, lon) || !Number.isFinite(radiusMiles) || radiusMiles < 1 || radiusMiles > 50
      || (hasTags && !validTags(tags)) || (!hasTags && !keyword.trim() && nameHints.length === 0))
    return response({ error: "Invalid or unsupported area/category" }, 400, headers);

  const query = buildOverpassQuery({ lat, lon, radiusMiles, tags: hasTags ? tags : [], nameHints, keyword, limit: RAW_LIMIT, timeout: 25 });
  if (!query) return response({ error: "Choose an industry or enter a business name" }, 400, headers);

  let detail = "Business directory temporarily unavailable";
  for (const endpoint of endpoints) {
    try {
      const result = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query), signal: AbortSignal.timeout(28000),
      });
      if (!result.ok) { detail = "Business directory error (" + result.status + ")"; continue; }
      const data = await result.json();
      const raw = Array.isArray(data.elements) ? data.elements : [];
      const remark = String(data.remark ?? "");
      // a server that timed out mid-query and found nothing is a failure to retry elsewhere, not "no results"
      if (raw.length === 0 && /timed out|out of memory|runtime error/i.test(remark)) { detail = "Business directory was too busy"; continue; }
      const elements = normalizeElements(raw, { lat, lon, max: RETURN_LIMIT });
      return response({
        elements, found: raw.length, truncated: raw.length >= RAW_LIMIT, partial: /timed out|out of memory/i.test(remark),
        radiusRequested: radiusMiles, radiusUsed: Math.min(radiusMiles, MAX_RADIUS_MILES), source: "OpenStreetMap",
      }, 200, headers);
    } catch { detail = "Business directory timed out or unavailable"; }
  }
  return response({ error: detail + "; try a smaller radius and a specific industry." }, 502, headers);
});
