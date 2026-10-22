# Prospects & Finder upgrade

## What's new

**Prospects screen** (sidebar → Prospects)
- **Search + filters** — status, industry, market, fit, tags, email status, source, plus HR-listed / replied / hide-Do-Not-Respond / minimum fit score. `Ctrl K` jumps to search.
- **Saved views** — six built-in (Ready for Touch 1, Hot & strong fit, Missing email, Emails to verify, Replied, All) plus your own. Shared with the team once the database update is applied; otherwise saved in your browser.
- **Table** — sortable, show/hide columns, compact/comfortable rows, paging, a **Next step** column (overdue follow-ups in red), duplicate warnings.
- **Detail drawer** — click any row: contact info, *why* the fit score is what it is, tags, notes, timeline, status, possible duplicates. `Esc` closes.
- **Bulk actions** — select rows (or "Select all N matching"): change status, add/remove tags, set industry/market, verify emails, Do Not Respond, export, merge, delete (admins).
- **Map** — nationwide U.S. territory map: one bubble per city (or per state when no city is recognised, marked *approximate*); size = prospects, colour = average fit. The state is read from the saved text ("Austin, TX"), so "Durham, NH" is never placed in North Carolina. Click a bubble for the top prospects and "Show in table".
- **Duplicates** — finds the same organisation by email, phone, website domain or name (ignores Inc/LLC/punctuation). Pick which record to keep, review what will be combined, confirm. **Nothing changes until you confirm.** "Not duplicates" is remembered in your browser.

**Prospect Finder**
- Duplicate check against your CRM is now fuzzy (was: identical lowercase name/email only). *Already in CRM* = near-certain match; *Possible match* = worth a look (e.g. same name, different city).
- The same organisation found by several sources becomes one row ("Also found via …"), with missing details filled in from each.
- **Fit score** is an explainable rubric (see below) instead of "has a website/phone".
- **✓ Verify emails** before adding. **Saved searches** (shared). **Tag on add**; priority and a "why fit" note are filled automatically.

**Fixed:** clicking **Pipeline** used to crash the app (React error #310 — hooks declared inside a conditional block).
**Fixed:** saving/deleting a prospect the database refuses (e.g. a viewer) used to *look* successful. It now reports the failure and rolls the screen back.

## Deploy (in this order)

1. **Run the SQL:** Supabase → SQL Editor → paste `supabase/migrations/20261020000000_prospect_features.sql` → Run. (Needs `20261019000000_security_hardening.sql` applied first; it says so if not. Safe to re-run.)
2. **Optional — mailbox-level email checks:** `supabase functions deploy hunter-verify` (only does anything if a Hunter key is saved under Admin → Plugins).
3. **Deploy the site** (merge → Vercel).

Deploying the site *before* step 1 is safe: the app detects the missing columns, hides tags / email-status / shared views (it says "needs the database update"), and never sends the missing columns, so saving keeps working.

## How the fit score works (0–100)

Not a conversion probability — there's no sales history to learn from. It's a transparent rubric of how likely an organisation is to **need** outside HR-compliance help and whether you can **reach** someone:

| Factor | Max | Logic |
|---|---|---|
| Industry | 25 | Heavier regulation ⇒ higher (home health & childcare 25 … foundations 7) |
| Organisation size | 20 | Sweet spot 50–99 (20), 10–49 (18), 100–249 (15); tiny or huge scores low |
| HR gap | 15 | Recorded "No" 15 (confirm it) · **Unknown 7 (neutral — never assumed to be "No")** · "Yes" 3 |
| Reachability | 20 | Named contact 5 · personal email 10 / HR mailbox 9 / generic 5 · phone 3 · verified +2 |
| Online presence & market | 10 | Website 5 · known NC market 5 |
| Engagement | 10 | Replied 10 · flagged 4 |

Tiers: **Hot** ≥70 · **Strong** ≥50 · **Possible** ≥30 · **Low**. Do-Not-Respond is always *Excluded*. The industry weights are a **starting assumption** — edit `SCORING` at the top of `src/lib/scoring.js` (and run `npm test`) to match what actually converts for you.

## Email verification — what it can and can't tell you

Without any key it checks syntax, disposable/no-reply addresses, typos ("gmial.com") and that the domain has a mail server (DNS). **That can't prove the specific mailbox exists.** With a Hunter key (`hunter-verify`) it asks Hunter to confirm the mailbox ("Valid ✓"). Generic addresses (info@, office@) are flagged but not rejected.

## Known limits
- "Not duplicates" decisions and column/density preferences are per-browser.
- Map pins use a bundled table of ~150 larger U.S. cities (no geocoding service, no cost). Smaller places are shown at their **state** centre and labelled approximate. Prospects with no recognisable U.S. state/city are listed as "can't be placed".
- Merge/delete are admin-only (matches the database rules); other roles can flag a duplicate for review.
- Run `npm test` for the logic tests (49).
