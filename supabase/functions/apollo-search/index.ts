// ═══════════════════════════════════════════════════════
//  Supabase Edge Function: apollo-search
//  ───────────────────────────────────────────────────────
//  Proxies People Search requests to Apollo.io (Apollo sends no CORS
//  headers, so browsers can't call it directly).
//
//  SECURITY: the caller must be a signed-in CRM user. The Apollo key is
//  read SERVER-SIDE (APOLLO_API_KEY secret, or the locked-down
//  api_credentials table) and is never sent by — or returned to — the
//  browser. Previously this function accepted any key in the request
//  body and was callable with just the public anon key.
// ═══════════════════════════════════════════════════════
import { corsFor, getApiKey, json, requireCrmUser } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const auth = await requireCrmUser(req, cors);
  if (!auth.ok) return auth.response;

  try {
    const { query, page = 1, perPage = 10 } = await req.json();
    if (!query || !String(query).trim()) return json({ error: "Missing query" }, 400, cors);

    const apiKey = await getApiKey(auth.admin, "apollo", "APOLLO_API_KEY");
    if (!apiKey) {
      return json({ error: "Apollo is not configured. An admin can add the key under Admin → Plugins." }, 400, cors);
    }

    const apolloRes = await fetch("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({
        api_key: apiKey,
        q_organization_name: String(query).slice(0, 200),
        page: Math.max(1, Number(page) || 1),
        per_page: Math.min(25, Math.max(1, Number(perPage) || 10)),
      }),
    });

    const data = await apolloRes.json().catch(() => ({}));
    if (!apolloRes.ok) {
      return json({ error: data?.error || `Apollo API error (HTTP ${apolloRes.status})`, status: apolloRes.status }, apolloRes.status, cors);
    }
    return json(data, 200, cors);
  } catch (e) {
    return json({ error: (e as Error).message || "Unknown error" }, 500, cors);
  }
});
