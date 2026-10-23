# Production acceptance checklist

**Purpose:** prove the *live* system works — not just that the code builds. A merged PR, a passing test suite or a green Netlify deploy is **not** acceptance. Mark an item **Pass** only if you personally saw it work; otherwise leave it **Not checked**.

Use PowerShell. Replace `<ANON_KEY>` with your **public (anon)** key — never the service-role key.

```powershell
$URL  = "https://ifpzpepurqlvaixxshzk.supabase.co"
$ANON = "<ANON_KEY>"
```

You will need four test accounts (create them under Admin → Users): one each of **viewer**, **user**, **manager**, **admin**. Use fake prospects only.

---

## 1. Is the right version deployed?

| # | Check | How | Expected |
|---|---|---|---|
| 1.1 | Latest code | `git ls-remote https://github.com/operationsthrd2026/nc-compliance-crm refs/heads/main` | A commit hash. Write it down. |
| 1.2 | Deployed commit | Netlify → Deploys → the **Published** deploy → commit | Same hash as 1.1 |
| 1.3 | Auto-deploy is wired | Netlify → Site configuration → Build & deploy → *Continuous deployment* | Repository `operationsthrd2026/nc-compliance-crm`, branch `main`. (A deploy marked `api` is a manual upload and will **not** update when you merge.) |
| 1.4 | Who can open the site | Open the production URL in a private window, signed out of Netlify | Matches your intent. If Netlify asks for a team login (SSO), outside users cannot reach the CRM — decide whether that is what you want. |
| 1.5 | Right backend | Netlify → Environment variables → `VITE_SUPABASE_URL` | `https://ifpzpepurqlvaixxshzk.supabase.co` |
| 1.6 | Key is the *public* one | Run the snippet below on the value of `VITE_SUPABASE_KEY` | Output contains `"role":"anon"` and `"ref":"ifpzpepurqlvaixxshzk"`. If it says `service_role`, **stop and rotate that key now.** |
| 1.7 | No private keys in the browser | Netlify env vars | Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` start with `VITE_`. No Apollo / Hunter / Google / AI-provider keys. |

```powershell
# 1.6 — read what kind of key it is (prints only the public claims)
$k = "<paste VITE_SUPABASE_KEY>"; $p = $k.Split('.')[1]
$p = $p.Replace('-','+').Replace('_','/').PadRight($p.Length + (4 - $p.Length % 4) % 4, '=')
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p))
```

## 2. Is the database configured correctly?

| # | Check | How | Expected |
|---|---|---|---|
| 2.1 | Migrations applied | Supabase → SQL Editor → run **`docs/verify_migrations.sql`** | Every row `ok = true` (row 16 is optional). Any `false` names the missing migration. Run missing ones **in filename order**; do not re-run ones that passed. |
| 2.2 | Signed-out users see nothing | Run the loop below | Every table answers **`42501 permission denied`**. Any row of data = **critical**, tell me immediately. |
| 2.3 | Edge functions require sign-in | Run the second snippet | **401** (not search results) |
| 2.4 | Netlify is allowed to call your functions | Run the third snippet | The header echoes the Netlify URL; the "evil" origin gets **no** header |

```powershell
# 2.2
foreach ($t in "prospects","crm_users","api_credentials","audit_log","system_settings","saved_searches","outreach_activities","prospect_tasks") {
  "--- $t"; curl.exe -s "$URL/rest/v1/${t}?select=*&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"; ""
}

# 2.3 — a signed-out call to a search function
curl.exe -s -i -X POST "$URL/functions/v1/hunter-search" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"domain":"example.com"}'

# 2.4 — CORS preflight from Netlify, then from a stranger
foreach ($o in "https://nc-compliance-crm.netlify.app","https://evil.example") {
  $r = Invoke-WebRequest -UseBasicParsing -Method Options -Uri "$URL/functions/v1/hunter-search" -Headers @{ Origin=$o; "Access-Control-Request-Method"="POST"; apikey=$ANON }
  "$o  ->  Allow-Origin: [$($r.Headers['Access-Control-Allow-Origin'])]"
}
```

**If 2.4 shows nothing for the Netlify URL**, the search functions will fail in the browser. Fix:
```powershell
supabase secrets set ALLOWED_ORIGINS=https://nc-compliance-crm.netlify.app,https://main--nc-compliance-crm.netlify.app,http://localhost:3000
```
(add the Vercel address too if you still use it). Re-run 2.4.

## 3. Sign-in, roles and the existing CRM (regression)

Sign in on the **production** URL with each account.

| # | Check | Expected |
|---|---|---|
| 3.1 | Wrong password | A generic error; no hint which part was wrong |
| 3.2 | Sign in / sign out, reload while signed in | Stays signed in on reload; sign-out returns to login and a reload does not restore the session |
| 3.3 | Viewer | Can read prospects; cannot add, edit, bulk-edit or delete (buttons hidden **and** a forced change is refused) |
| 3.4 | User / manager | Can add and edit; **cannot** delete or merge |
| 3.5 | Admin | Can delete/merge; Admin panel opens; can create a user and set their password |
| 3.6 | Prospects | Create → edit → status change → reload: all persisted |
| 3.7 | Pipeline | Opens without crashing; moving a card persists after reload |
| 3.8 | Import / export | Import a small spreadsheet (append); export; open the file — no `=`/`+`/`@` cell is executed as a formula |
| 3.9 | Dashboard / Email Hub / Calendar | Each opens; numbers match the Prospects list |

## 4. ProspectFinder end to end

**Do not run paid-provider searches unless you have approved the cost.** The free sources (nonprofit directory, local business directory, NPI) need no key.

| # | Check | Expected |
|---|---|---|
| 4.1 | Search anywhere in the U.S. (e.g. a city and state outside NC) | Results appear; empty/failed searches show a clear message, not a blank screen |
| 4.2 | Source attribution | Each result names its source and the source link opens |
| 4.3 | Nothing invented | A result with no email shows **no** email; unknown HR status shows **Unknown**, not "No" |
| 4.4 | Duplicates | A result already in the CRM is marked *Already in CRM* and can't be added twice |
| 4.5 | Save to CRM | Add one result → reload → it is in Prospects with source, website/email/phone in the right fields |
| 4.6 | Viewer account | Cannot add to the CRM |
| 4.7 | Map | Switch Prospects → **Map**: a prospect in e.g. Austin, TX appears in Texas (not North Carolina); a prospect with only a state shows at the state centre marked *approximate* |

## 5. Tasks, shared views and workload (two people, two devices)

| # | Check | Expected |
|---|---|---|
| 5.1 | Admin creates a task for the *user* account | The user sees it on their own device after reload |
| 5.2 | User changes status and due date | Persists after reload; admin sees the change |
| 5.3 | Manager (not involved) | Does **not** see that task (current design: own tasks, tasks you created, or admin) — confirm this is what you want |
| 5.4 | User tries to assign a task to someone else | Refused |
| 5.5 | Nobody can delete a task | No delete control; a forced delete is refused |
| 5.6 | Shared view | Admin saves a **shared** workflow view → appears for the user; a **private** view does not |
| 5.7 | Workload report | Totals equal the number of tasks you created; empty state is sensible when there are none |

## 6. Phase 11 alerts

| # | Check | Expected |
|---|---|---|
| 6.1 | Make tasks that are overdue, due today, due in 2 days, urgent, and urgent-and-overdue | Each appears in the right category; the urgent-and-overdue one is counted in **both** without double-counting the total |
| 6.2 | Complete one / change a due date | The alert list and counts update |
| 6.3 | Dismiss one, then restore it | Works. Note: dismissals are saved **in this browser only** — a second device will still show it |
| 6.4 | Sign in as another user | Sees only their own alerts |

## 7. Data you should review by hand

Older records may show **HR person listed = "No"** that nobody ever checked (the old default). It makes those prospects look *under-served* in the fit score. Count them in Supabase:

```sql
select count(*) filter (where hr_person_listed = 'No')                                          as marked_no,
       count(*) filter (where hr_person_listed = 'No' and coalesce(hr_people_contact,'') = '')  as no_and_no_contact_named,
       count(*)                                                                                  as total
from public.prospects;
```
In the CRM: Prospects → **More → HR person listed → No** to see them. Review before changing anything. If you decide a batch really is unverified, an admin can mark it Unknown (**take a backup first**; this edits data):
```sql
update public.prospects set hr_person_listed = 'Unknown'
where hr_person_listed = 'No' and coalesce(hr_people_contact,'') = '';   -- only if YOU have decided this
```

---

## 8. Unified workspace and themes (look at it with your own eyes)

Open the live site in a normal window **and** a phone (or a narrow window). Do each step in **Light**, then **Dark** (switch is bottom-left, and on the sign-in page).

| # | Check | Expected |
|---|---|---|
| 8.1 | Sidebar | Seven areas only: Home, Find prospects, Prospects, Email & outreach, Calendar & tasks, Insights, Settings. Each area with several screens shows them as tabs at the top; leave and come back — you return to the tab you were on. |
| 8.1b | Quick actions | Open a prospect: **Write email** opens the template composer with that prospect chosen; **Schedule follow-up** opens a pre-filled task (nothing saved until you press Save); **Show on map** opens the map at that place. |
| 8.1c | Today and search | Home says what to do first and lists the next actions; each button opens the right screen with the right prospect or filter. **Ctrl+K** opens the palette — type a company name and press Enter to open it; type "add" for the Add dialog; Esc closes. The Today suggestions never send or change anything by themselves. |
| 8.1d | Outreach desk | Email & outreach opens on the **Outreach desk**. The left list shows replies, overdue and ready prospects (never Do Not Respond). Choose someone, press **Open in my email app**: your mail app opens with the draft, and the desk asks **"Did you send it?"** and lists what will change. Press **Not yet** → check the prospect did NOT change. Repeat and press **Yes** → the prospect moves to Touch 1 sent, gets a Touch 2 date, and an "email_sent" entry appears in Activity log. With Gmail connected, **Send with Gmail** sends one real email. |
| 8.1e | No fake email data | **Gmail inbox** shows only your real Gmail (or says it isn't connected) — never made-up people like "Sandra Kim". Sending from there without Gmail connected changes nothing. |
| 8.2 | Prospects | Four views (Table / Map / Duplicates / Qualification). Open a row → the side panel has **Qualify**; it opens that prospect in Qualification. |
| 8.3 | Pipeline, Calendar, Email Hub | Open, show your data, move a pipeline card and reload — it stays. Email Hub signs in to Gmail as before. |
| 8.4 | Admin | Users, plugins, audit log all open. Create a test user, then delete it. |
| 8.5 | Import / export | Prospects toolbar: Import a small spreadsheet; Export downloads a file that opens cleanly. |
| 8.6 | **Readability in both themes** | On every screen above: no text that is hard to read, no white-on-white or dark-on-dark, no pale box that glows in dark mode, no black box in light mode. Note the screen and what you saw. |
| 8.7 | Switch behaviour | Choose Light, reload — still Light. Choose Auto — follows your computer. The switch also works on the sign-in page. |
| 8.8 | Map | Light and Dark both show a readable map with visible bubbles; clicking one still offers "Show N in table". |
| 8.9 | Roll-back hatch | `https://your-site/?classic=1` opens the old shell (you can stop using it once 8.1–8.8 are accepted). |

---

## Record the results

| Item | Pass / Fail / Not checked | Date | Checked by | Notes (commit hash, screenshots) |
|---|---|---|---|---|
| 1 Deployed version | | | | |
| 2 Database & functions | | | | |
| 3 Sign-in & regression | | | | |
| 4 ProspectFinder | | | | |
| 5 Tasks & shared views | | | | |
| 6 Alerts | | | | |
| 7 Data review | | | | |
| 8 Unified workspace & themes | | | | |

Anything that fails: write down exactly what you did and what you saw (a screenshot helps) and send it over — that is enough to fix it.
