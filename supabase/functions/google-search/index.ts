// ═══════════════════════════════════════════════════════════════════
//  Supabase Edge Function: google-search
//  ─────────────────────────────────────────────────────────────────
//  Proxies requests to Google's Custom Search JSON API. The API key
//  is held server-side as a Supabase secret (never sent to or stored
//  in the browser) — this function reads it from environment
//  variables, calls Google, and returns the result with CORS headers
//  so the browser can read it.
//
//  IMPORTANT: Google Custom Search returns WEB PAGE results (title,
//  URL, snippet) — not structured contact data. There is no name,
//  email, or job title in this response. The CRM maps results into
//  the company/source-link/why-fit fields, not contact fields.
//  Docs: https://developers.google.com/custom-search/v1/overview
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
    // The API key and Search Engine ID are read from Supabase secrets
    // (set via `supabase secrets set`), never from the request body —
    // this keeps them out of browser network traffic entirely.
    const apiKey = Deno.env.get("GOOGLE_API_KEY");
    const cseId = Deno.env.get("GOOGLE_CSE_ID");

    if (!apiKey || !cseId) {
      return new Response(JSON.stringify({
        error: "Google API key or Search Engine ID not configured on the server. Run: supabase secrets set GOOGLE_API_KEY=AIzaSyDPkG2u7heg4bqdhifZ16MtJnnlp-NcAjs GOOGLE_CSE_ID=b37b5c147a97f4cbd",
      }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { query, num = 10 } = body;

    if (!query || !query.trim()) {
      return new Response(JSON.stringify({ error: "Missing query" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const googleUrl = new URL("https://www.googleapis.com/customsearch/v1");
    googleUrl.searchParams.set("key", apiKey);
    googleUrl.searchParams.set("cx", cseId);
    googleUrl.searchParams.set("q", query);
    googleUrl.searchParams.set("num", String(Math.min(num, 10))); // Google caps at 10 per request

    const googleRes = await fetch(googleUrl.toString());
    const data = await googleRes.json();

    if (!googleRes.ok) {
      return new Response(JSON.stringify({
        error: data?.error?.message || `Google API error (HTTP ${googleRes.status})`,
        status: googleRes.status,
      }), {
        status: googleRes.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Pass through Google's response as-is — the CRM's googleSearch()
    // function already knows how to map data.items into prospects.
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
