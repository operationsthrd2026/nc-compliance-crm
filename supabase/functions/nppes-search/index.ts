import { corsFor, requireCrmUser } from "../_shared/auth.ts";

// ═══════════════════════════════════════════════════════════════════
//  Supabase Edge Function: nppes-search
//  ─────────────────────────────────────────────────────────────────
//  Proxies organization search requests to the NPPES NPI Registry —
//  a free, public API maintained by CMS (Centers for Medicare &
//  Medicaid Services) covering 7M+ active healthcare provider
//  records, including organizations (clinics, home health agencies,
//  group practices), not just individual clinicians.
//
//  This function exists to work around inconsistent/unconfirmed CORS
//  support on NPPES's API — it runs server-side (Deno), calls NPPES,
//  and returns the result with CORS headers so the browser can read
//  it. No API key is involved on either hop; NPPES is fully public.
//  Docs: https://npiregistry.cms.hhs.gov/api-page
// ═══════════════════════════════════════════════════════════════════

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
    const { organizationName = null, taxonomyDescription = null, state = "NC" } = body;

    // Forward the request to the NPPES NPI Registry API. This call
    // happens server-side, so any CORS restriction on NPPES's side
    // doesn't matter — only the browser-to-edge-function hop needs
    // CORS, which we provide via CORS_HEADERS above.
    const npiUrl = new URL("https://npiregistry.cms.hhs.gov/api/");
    npiUrl.searchParams.set("version", "2.1");
    npiUrl.searchParams.set("enumeration_type", "NPI-2"); // organizations only, not individuals
    npiUrl.searchParams.set("state", state);
    npiUrl.searchParams.set("limit", "20");
    if (organizationName) npiUrl.searchParams.set("organization_name", organizationName);
    if (taxonomyDescription) npiUrl.searchParams.set("taxonomy_description", taxonomyDescription);

    const npiRes = await fetch(npiUrl.toString(), {
      headers: { "Accept": "application/json" },
    });

    if (!npiRes.ok) {
      return new Response(JSON.stringify({
        error: `NPI Registry API error (HTTP ${npiRes.status})`,
        status: npiRes.status,
      }), {
        status: npiRes.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const data = await npiRes.json();

    // Pass through NPPES's response as-is — the CRM's nppesSearch()
    // function already knows how to map data.results into prospects.
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message || "Unknown error" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
