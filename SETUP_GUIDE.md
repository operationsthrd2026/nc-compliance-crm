# NC Compliance CRM — Supabase Database Setup Guide

## What you're getting
- **PostgreSQL database** hosted on Supabase (free)
- All prospects, users, emails, audit logs, and settings **persist forever**
- Real-time sync — changes by one user appear instantly for all others
- Same login credentials as before (superadmin/superadmin, admin/admin, etc.)

---

## Step 1 — Create a free Supabase account

1. Go to **[supabase.com](https://supabase.com)** and click **Start your project**
2. Sign up with GitHub, Google, or email
3. Click **New project**
4. Fill in:
   - **Project name:** `nc-compliance-crm`
   - **Database password:** choose a strong password (save it)
   - **Region:** `US East (N. Virginia)` — closest to NC
5. Click **Create new project** and wait ~2 minutes for it to provision

---

## Step 2 — Run the SQL schema

1. In your Supabase dashboard, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open the file **`supabase_schema.sql`** (included with this guide)
4. Copy the entire contents and paste into the SQL editor
5. Click **Run** (or press Cmd/Ctrl + Enter)
6. You should see: `Success. No rows returned`

This creates all 5 tables, indexes, security policies, and seeds the demo data.

---

## Step 3 — Get your API credentials

1. In the Supabase dashboard, click **Settings** (gear icon) → **API**
2. Copy these two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** — a long JWT string starting with `eyJ...`

---

## Step 4 — Add credentials to the CRM

Open **`NC_Compliance_CRM_With_Auth.jsx`** and find this section near the top (around line 5):

```js
// ─── SUPABASE CONFIG ─────────────────────────────────────────
const SUPABASE_URL = "YOUR_PROJECT_URL_HERE";
const SUPABASE_KEY = "YOUR_ANON_KEY_HERE";
```

Replace the placeholder values with your actual URL and key:

```js
const SUPABASE_URL = "https://abcdefgh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
```

Save the file. The CRM will now read and write to your live database.

---

## Step 5 — Verify it's working

1. Open the CRM and log in as `admin / admin`
2. Add a new prospect
3. Open a new browser tab and log in as a different account
4. You should see the new prospect appear in real time

---

## What's stored where

| Data | Table | Notes |
|------|-------|-------|
| User accounts | `crm_users` | All 5 default accounts pre-seeded |
| Prospects | `prospects` | All fields, auto-timestamps |
| Emails sent/received | `emails` | Linked to prospects |
| Audit log | `audit_log` | Every action logged with user + timestamp |
| System settings | `system_settings` | Key-value pairs |

---

## Viewing your data

In the Supabase dashboard:
- **Table Editor** — browse and edit rows visually (like a spreadsheet)
- **SQL Editor** — run any query, e.g.: `SELECT * FROM prospects WHERE current_status = 'NEW';`
- **Logs** — see all API calls in real time

---

## Troubleshooting

**"Failed to connect"** → Double-check your URL and key. The URL must not have a trailing slash.

**"Permission denied"** → The Row Level Security policies are set to allow all access. If this happens, go to SQL Editor and run:
```sql
ALTER TABLE prospects DISABLE ROW LEVEL SECURITY;
```

**Data not showing** → Make sure you ran the full `supabase_schema.sql` including the seed data at the bottom.

**"Duplicate key" error on seed** → The `ON CONFLICT DO NOTHING` clauses handle this — it means the data was already inserted. Safe to ignore.

---

## Next steps (optional)

- **Custom domain:** Supabase lets you add a custom domain (Pro plan)
- **Backups:** Daily backups are automatic on all plans
- **More security:** For production, update the Row Level Security policies to restrict access by user role
- **Email integration:** Supabase supports sending transactional emails via Resend or SendGrid

---

*NC Compliance CRM v4.0 — HR On Demand*
