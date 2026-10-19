// ═══════════════════════════════════════════════════════
//  Supabase Edge Function: admin-users
//  ───────────────────────────────────────────────────────
//  Admin-only user lifecycle for Supabase Auth. The browser can never
//  create or change login credentials itself (that needs the service
//  role key), so Admin → Users calls this function.
//
//  POST { action: "create" | "set_password" | "delete", email, password? }
//
//  Rules enforced here (in addition to RLS on crm_users):
//   • caller must be admin / superadmin
//   • only a superadmin may touch a superadmin's login
//   • nobody can delete or reset their own login through this endpoint
//   • passwords must be at least 10 characters
// ═══════════════════════════════════════════════════════
import { corsFor, json, requireCrmUser } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const auth = await requireCrmUser(req, cors, { adminOnly: true });
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  try {
    const { action, email, password } = await req.json();
    const target = String(email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) return json({ error: "Valid email required" }, 400, cors);

    if (target === auth.email.toLowerCase() && action !== "create") {
      return json({ error: "Use another admin to change your own login." }, 400, cors);
    }

    // Protect superadmin accounts from plain admins.
    const { data: profile } = await admin
      .from("crm_users").select("role").ilike("email", target).maybeSingle();
    if (profile?.role === "superadmin" && auth.role !== "superadmin") {
      return json({ error: "Only a Super Admin can modify a Super Admin." }, 403, cors);
    }

    if (action === "create") {
      if (typeof password !== "string" || password.length < 10) {
        return json({ error: "Password must be at least 10 characters." }, 400, cors);
      }
      const { error } = await admin.auth.admin.createUser({ email: target, password, email_confirm: true });
      if (error) {
        // Already has a login → treat as success so the profile can still be saved.
        if (/already|exists|registered/i.test(error.message)) return json({ ok: true, existed: true }, 200, cors);
        return json({ error: error.message }, 400, cors);
      }
      return json({ ok: true }, 200, cors);
    }

    const { data: uid } = await admin.rpc("crm_auth_user_id", { p_email: target });

    if (action === "set_password") {
      if (typeof password !== "string" || password.length < 10) {
        return json({ error: "Password must be at least 10 characters." }, 400, cors);
      }
      // Existing CRM users from before the security upgrade have no login yet:
      // setting a password for them creates it.
      if (!uid) {
        if (!profile) return json({ error: "No CRM user with that email." }, 404, cors);
        const { error } = await admin.auth.admin.createUser({ email: target, password, email_confirm: true });
        if (error) return json({ error: error.message }, 400, cors);
        return json({ ok: true, created: true }, 200, cors);
      }
      const { error } = await admin.auth.admin.updateUserById(uid as string, { password });
      if (error) return json({ error: error.message }, 400, cors);
      return json({ ok: true }, 200, cors);
    }

    if (action === "delete") {
      if (!uid) return json({ ok: true, noLogin: true }, 200, cors); // nothing to remove
      const { error } = await admin.auth.admin.deleteUser(uid as string);
      if (error) return json({ error: error.message }, 400, cors);
      return json({ ok: true }, 200, cors);
    }

    return json({ error: "Unknown action" }, 400, cors);
  } catch (e) {
    return json({ error: (e as Error).message || "Unknown error" }, 500, cors);
  }
});
