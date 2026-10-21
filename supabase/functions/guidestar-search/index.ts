import { corsFor, requireCrmUser } from "../_shared/auth.ts";

// ═══════════════════════════════════════════════════════════════════
//  Supabase Edge Function: guidestar-search
//  ─────────────────────────────────────────────────────────────────
//  Proxies nonprofit search requests to ProPublica's Nonprofit
//  Explorer API. ProPublica's API does not send CORS headers, so
//  browsers block direct requests from the CRM. This function runs
//  server-side (Deno), calls ProPublica, and returns the result with
//  CORS headers so the browser can read it.
//
//  No API key is required — ProPublica's Nonprofit Explorer is a
//  free, public dataset of IRS Form 990 filings. This function exists
//  purely to work around the browser CORS restriction, not to hide
//  any credentials.
//  Docs: https://projects.propublica.org/nonprofits/api
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
    const { query, state = null, nteeCode = null, page = 0 } = body;

    if (!query || !query.trim()) {
      return new Response(JSON.stringify({ error: "Missing query" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Forward the request to ProPublica's Nonprofit Explorer API.
    // This call happens server-side, so ProPublica's lack of CORS
    // support doesn't matter — only the browser-to-edge-function hop
    // needs CORS, which we provide via CORS_HEADERS above.
    const ppUrl = new URL("https://projects.propublica.org/nonprofits/api/v2/search.json");
    ppUrl.searchParams.set("q", query);
    if (state && /^[A-Z]{2}$/.test(state)) ppUrl.searchParams.set("state[id]", state);
    ppUrl.searchParams.set("page", String(Math.min(50, Math.max(0, Number(page) || 0))));
    if (nteeCode) ppUrl.searchParams.set("ntee[id]", String(nteeCode));

    const ppRes = await fetch(ppUrl.toString(), {
      headers: { "Accept": "application/json" },
    });

    if (!ppRes.ok) {
      return new Response(JSON.stringify({
        error: `ProPublica API error (HTTP ${ppRes.status})`,
        status: ppRes.status,
      }), {
        status: ppRes.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const data = await ppRes.json();

    // Pass through ProPublica's response as-is — the CRM's
    // guidestarSearch() function already knows how to map
    // data.organizations into prospects.
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
