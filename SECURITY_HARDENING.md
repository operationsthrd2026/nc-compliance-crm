# Security hardening — deployment runbook

This upgrade fixes four problems in v4.0:

| # | Problem | Fix |
|---|---------|-----|
| 1 | `.env.local` (real keys) was committed to a public repo | Untracked, ignored; **keys must be rotated** |
| 2 | Database open to anyone holding the public anon key (RLS off/allow-all) | Role-based Row Level Security; anon gets zero access |
| 3 | Custom login in the browser (unsalted SHA-256, plaintext legacy, demo logins) | Supabase Auth; role derived server-side |
| 4 | Third-party API keys readable from / sent by the browser; edge functions open to anyone, CORS `*` | Keys server-side only; functions require a signed-in CRM user; CORS locked |

**Do the steps in order.** Step 3 before Step 5 matters: if you apply the migration before your own login exists in Supabase Auth, the app will refuse to sign you in. (The migration itself checks for this and aborts safely.)

---

## Step 1 — Rotate the exposed keys (do this first, today)

Removing a file from git does **not** remove it from history, and the repo has been public. Treat these as compromised:

- **Apollo.io API key** — Apollo → Settings → API → revoke and create a new one.
- **Google API key** (Custom Search) — Google Cloud Console → Credentials → delete it and create a new one, then restrict it to the *Custom Search API* only. A key was also hard-coded in `supabase/functions/google-search/index.ts`; that's removed in this version but is still in history.
- **Supabase anon key** — safe to be public *by design*, but only because Step 4 turns on RLS. No rotation needed once Step 4 is done. (If you want a clean slate: Settings → API → JWT secret → rotate; this signs everyone out and requires updating `VITE_SUPABASE_KEY`.)
- Google OAuth **client ID** is public by nature. If you ever committed a Google client *secret*, rotate that too.

Then make the repo **private** (Settings → Danger Zone → Change visibility). Optionally scrub history with [`git filter-repo`](https://github.com/newren/git-filter-repo) (`git filter-repo --path .env.local --invert-paths`) and force-push — but rotation is what actually protects you, since forks and caches may already hold the old history.

## Step 2 — Prepare Supabase Auth (before touching the database)

1. **Authentication → Users → Add user → Create new user.** Use the **same email** as your admin row in `crm_users`, choose a strong password (12+ chars), and tick **Auto Confirm User**.
2. **Authentication → Sign In / Providers → Email:** keep **Confirm email = ON**. Turn **Allow new users to sign up = OFF** (admins create users from now on).
3. **Authentication → URL Configuration:** set Site URL and add your production + `http://localhost:3000` redirect URLs (needed for Google sign-in).

## Step 3 — Deploy the edge functions

```bash
supabase link --project-ref <your-project-ref>

# Only these origins may call the functions from a browser:
supabase secrets set ALLOWED_ORIGINS=https://your-crm-domain.com,http://localhost:3000

# Third-party keys (new values from Step 1). Either set them here…
supabase secrets set APOLLO_API_KEY=... HUNTER_API_KEY=... GOOGLE_API_KEY=... GOOGLE_CSE_ID=...
# …or leave Apollo/Hunter unset and enter them later in the app (Admin → Plugins).

supabase functions deploy apollo-search hunter-search google-search \
  guidestar-search nppes-search osm-search admin-users
```

> If you previously deployed the old `apollo-search`, redeploy it — the old version accepted any key from anyone.

## Step 4 — Run the migration

1. **Back up first** (Database → Backups, or `pg_dump`). The migration drops `crm_users.password` irreversibly.
2. SQL Editor → paste `supabase/migrations/20261019000000_security_hardening.sql` → Run.
3. If it stops with **ABORTED: no active admin … confirmed Supabase Auth account**, go back to Step 2.1. Nothing was changed.

It is safe to re-run.

## Step 5 — Deploy the frontend

- Vercel → Settings → Environment Variables: keep only `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`. **Delete** `VITE_GOOGLE_API_KEY`, `VITE_APOLLO_KEY`, `VITE_HUNTER_KEY`, `VITE_ANTHROPIC_KEY` and `VITE_GOOGLE_CSE_ID` — anything `VITE_`-prefixed is compiled into public JavaScript. Redeploy.
- Sign in with the email + password from Step 2.

## Step 6 — Onboard everyone else

Existing users have no login yet. For each one: **Admin → Users → Edit → type a new password (10+ chars) → Save.** That creates their Supabase login (email is the username). New users: **Add User** does both the login and the role. Google sign-in works for the same email once the login exists (Supabase links them automatically — test with one user first).

Re-enter Apollo / Hunter keys under **Admin → Plugins** if you didn't set them as secrets. Keys are write-only: the page shows "saved securely" and can never display them again.

## Step 7 — Verify the hole is closed

From any terminal (use your real URL + anon key). **All of these must fail:**

```bash
URL=https://YOUR-REF.supabase.co ; ANON=YOUR-ANON-KEY

# Must return "permission denied" (HTTP 401/403), NOT rows:
curl -s "$URL/rest/v1/prospects?select=*"        -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
curl -s "$URL/rest/v1/crm_users?select=*"        -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
curl -s "$URL/rest/v1/api_credentials?select=*"  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"

# Must return 401 "Invalid or expired session":
curl -s -X POST "$URL/functions/v1/apollo-search" -H "apikey: $ANON" \
  -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"query":"test"}'
```

If any of the first three returns data, the migration did not apply — re-run Step 4 and check for errors.

---

## What each role can do (enforced in Postgres, not just the UI)

| | Viewer | User / Manager | Admin | Super Admin |
|---|---|---|---|---|
| Read prospects, settings, emails | ✅ | ✅ | ✅ | ✅ |
| Create / edit prospects, log emails | ❌ | ✅ | ✅ | ✅ |
| Delete prospects | ❌ | ❌ | ✅ | ✅ |
| Manage users / settings / API keys, read audit log | ❌ | ❌ | ✅ | ✅ |
| Create or modify a Super Admin | ❌ | ❌ | ❌ | ✅ |

Other guarantees: deactivating a user cuts their data access immediately (even with a live session); the audit log is append-only and can't be spoofed; Super Admin accounts can't be deleted from the app (remove them in the Supabase dashboard if ever needed).

## Known limitations / follow-ups

- No self-service "forgot password" yet — an admin resets it (Edit user → new password). A recovery-email flow is a good next feature.
- The Google/Gmail OAuth token for the Email Hub is still held in `sessionStorage` (as before). Moving Gmail sending to an edge function would remove that.
- `Delete` of a Super Admin is intentionally blocked by policy.
- Demo Mode (no Supabase configured) still ships demo accounts; it never touches a real database.
