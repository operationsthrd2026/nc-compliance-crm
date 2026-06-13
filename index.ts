// ═══════════════════════════════════════════════════════════════════
//  Supabase Edge Function: apollo-search
//  ─────────────────────────────────────────────────────────────────
//  Proxies People Search requests to Apollo.io. Apollo's API does not
//  send CORS headers, so browsers block direct requests from the CRM.
//  This function runs server-side (Deno), calls Apollo, and returns
//  the result with CORS headers so the browser can read it.
//
//  The Apollo API key is read from sysSettings.apolloKey, which the
//  CRM sends in the request body — NOT stored as a Supabase secret —
//  so each organization's own key is used (matches how the CRM already
//  manages per-org plugin keys in Admin → Plugins).
// ═══════════════════════════════════════════════════════════════════

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
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

  try {
    const body = await req.json();
    const { apiKey, query, page = 1, perPage = 10 } = body;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing apiKey" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (!query || !query.trim()) {
      return new Response(JSON.stringify({ error: "Missing query" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Forward the request to Apollo.io's People Search API.
    // This call happens server-side, so Apollo's lack of CORS support
    // doesn't matter — only the browser-to-edge-function hop needs CORS,
    // which we provide via CORS_HEADERS above.
    const apolloRes = await fetch("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({
        api_key: apiKey,
        q_organization_name: query,
        page,
        per_page: perPage,
      }),
    });

    const data = await apolloRes.json();

    if (!apolloRes.ok) {
      return new Response(JSON.stringify({
        error: data?.error || `Apollo API error (HTTP ${apolloRes.status})`,
        status: apolloRes.status,
      }), {
        status: apolloRes.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Pass through Apollo's response as-is — the CRM\'s apolloSearch()
    // function already knows how to map data.people into prospects.
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
