// ═══════════════════════════════════════════════════════
//  Supabase Edge Function: hunter-search
//  ───────────────────────────────────────────────────────
//  Server-side proxy for Hunter.io domain search. Replaces the old
//  browser-side call that put the Hunter API key in a URL query string
//  (visible in devtools, logs and browser history).
// ═══════════════════════════════════════════════════════
import { corsFor, getApiKey, json, requireCrmUser } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const auth = await requireCrmUser(req, cors);
  if (!auth.ok) return auth.response;

  try {
    const { domain, limit = 10 } = await req.json();
    const d = String(domain ?? "").trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return json({ error: "Invalid domain" }, 400, cors);

    const apiKey = await getApiKey(auth.admin, "hunter", "HUNTER_API_KEY");
    if (!apiKey) {
      return json({ error: "Hunter.io is not configured. An admin can add the key under Admin → Plugins." }, 400, cors);
    }

    const url = new URL("https://api.hunter.io/v2/domain-search");
    url.searchParams.set("domain", d);
    url.searchParams.set("limit", String(Math.min(25, Math.max(1, Number(limit) || 10))));
    url.searchParams.set("api_key", apiKey);

    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    return json(data, res.status, cors);
  } catch (e) {
    return json({ error: (e as Error).message || "Unknown error" }, 500, cors);
  }
});
