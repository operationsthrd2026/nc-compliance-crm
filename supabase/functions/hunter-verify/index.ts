// ═══════════════════════════════════════════════════════
//  Supabase Edge Function: hunter-verify
//  ───────────────────────────────────────────────────────
//  OPTIONAL. Confirms that a specific mailbox exists using Hunter.io's
//  Email Verifier. Without a Hunter key the CRM still checks syntax,
//  disposable/no-reply addresses and the domain's mail server (DNS) in
//  the browser — this adds mailbox-level confirmation on top.
//
//  Requires: signed-in CRM user. Key is read server-side only.
//  Returns:  { result: "deliverable" | "undeliverable" | "risky" | "unknown", score }
// ═══════════════════════════════════════════════════════
import { corsFor, getApiKey, json, requireCrmUser } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const auth = await requireCrmUser(req, cors);
  if (!auth.ok) return auth.response;

  try {
    const { email } = await req.json();
    const e = String(email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 254) return json({ error: "Invalid email" }, 400, cors);

    const apiKey = await getApiKey(auth.admin, "hunter", "HUNTER_API_KEY");
    if (!apiKey) return json({ error: "Hunter.io is not configured." }, 400, cors);

    const url = new URL("https://api.hunter.io/v2/email-verifier");
    url.searchParams.set("email", e);
    url.searchParams.set("api_key", apiKey);

    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: data?.errors?.[0]?.details || `Hunter error (HTTP ${res.status})` }, res.status, cors);

    // Never forward the raw payload; return only what the app needs.
    return json({ result: data?.data?.result ?? "unknown", score: data?.data?.score ?? null }, 200, cors);
  } catch (e) {
    return json({ error: (e as Error).message || "Unknown error" }, 500, cors);
  }
});
