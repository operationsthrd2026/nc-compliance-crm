import { corsFor, requireCrmUser } from "../_shared/auth.ts";

// ═══════════════════════════════════════════════════════════════════
//  Supabase Edge Function: osm-search
//  ─────────────────────────────────────────────────────────────────
//  Proxies business/POI search requests to the Overpass API — the
//  official query service for OpenStreetMap data. Free, public,
//  no-auth, no-billing, 10,000 requests/day per IP. This function
//  runs server-side (Deno), calls Overpass, and returns the result
//  with CORS headers so the browser can read it.
//
//  No API key is involved on either hop — OSM data is fully open
//  (ODbL license, attribution required and provided in the CRM UI).
//  This proxy exists because Overpass's public mirror servers have
//  inconsistent CORS support.
//
//  Tries the primary Overpass endpoint first, then falls back to a
//  secondary public mirror if the primary is overloaded/unavailable
//  (the public Overpass infrastructure is shared by the whole OSM
//  community and can be slow at peak times).
//  Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
// ═══════════════════════════════════════════════════════════════════

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

Deno.serve(async (req: Request) => {
  const CORS_HEADERS = corsFor(req);
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Must be a signed-in user with an active CRM account (anon key alone is rejected)
  const auth = await requireCrmUser(req, CORS_HEADERS);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { overpassQL } = body;

    if (typeof overpassQL !== "string" || !overpassQL.trim() || overpassQL.length > 12000 || !overpassQL.includes("[out:json]") || !overpassQL.includes("around:")) {
      return new Response(JSON.stringify({ error: "Invalid or oversized Overpass query" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    let lastError = "";
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const overpassRes = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(overpassQL)}`,
        });

        if (!overpassRes.ok) {
          lastError = `Overpass returned HTTP ${overpassRes.status} from ${endpoint}`;
          continue; // try next mirror
        }

        const data = await overpassRes.json();

        // Pass through Overpass's response as-is — the CRM's
        // osmSearch() function already knows how to map
        // data.elements into prospects.
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      } catch (e) {
        lastError = (e as Error).message;
        continue; // try next mirror
      }
    }

    // All mirrors failed
    return new Response(JSON.stringify({
      error: `All Overpass API mirrors unavailable. Last error: ${lastError}`,
    }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message || "Unknown error" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
