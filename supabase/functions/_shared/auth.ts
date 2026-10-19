// ═══════════════════════════════════════════════════════
//  Shared helpers for every CRM Edge Function
//  ───────────────────────────────────────────────────────
//  • corsFor(req)       – CORS locked to ALLOWED_ORIGINS (no more "*")
//  • requireCrmUser()   – the caller must hold a real signed-in session
//                         AND map to an ACTIVE crm_users row. The public
//                         anon key alone is rejected.
//  • getApiKey()        – third-party keys are read server-side only
//                         (env secret first, then api_credentials table)
// ═══════════════════════════════════════════════════════
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const DEFAULT_ORIGINS = ["http://localhost:3000", "http://localhost:5173"];

export function corsFor(req: Request): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const list = allowed.length ? allowed : DEFAULT_ORIGINS;
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  // Only echo an origin that is explicitly allowed; otherwise send none,
  // and the browser blocks the response.
  if (list.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export type AuthOk = { ok: true; role: string; email: string; admin: SupabaseClient };
export type AuthFail = { ok: false; response: Response };

export async function requireCrmUser(
  req: Request,
  cors: Record<string, string>,
  opts: { adminOnly?: boolean } = {},
): Promise<AuthOk | AuthFail> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, response: json({ error: "Sign in required" }, 401, cors) };
  }

  // Act as the caller so crm_role() sees their identity.
  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user) {
    // The bare anon key is a valid JWT but has no user — rejected here.
    return { ok: false, response: json({ error: "Invalid or expired session" }, 401, cors) };
  }

  const { data: role, error: roleErr } = await asUser.rpc("crm_role");
  if (roleErr || !role) {
    return { ok: false, response: json({ error: "No active CRM account for this user" }, 403, cors) };
  }
  if (opts.adminOnly && !["superadmin", "admin"].includes(role as string)) {
    return { ok: false, response: json({ error: "Admin access required" }, 403, cors) };
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  return { ok: true, role: role as string, email: userData.user.email ?? "", admin };
}

export async function getApiKey(
  admin: SupabaseClient,
  service: string,
  envName: string,
): Promise<string | null> {
  const fromEnv = Deno.env.get(envName);
  if (fromEnv) return fromEnv;
  const { data } = await admin
    .from("api_credentials").select("api_key").eq("service", service).maybeSingle();
  return data?.api_key || null;
}
