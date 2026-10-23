# Unified workspace + light/dark themes

## The pipeline board (rebuilt)
**What was wrong:** dropping a card saved a bare status change that **skipped the cadence logic** (no send date, no Touch 2 due date), so a card dragged to "Touch 1 sent" never reached your follow-ups. It also had no keyboard or touch way to move a card, let a Do Not Respond prospect be dragged into outreach, failed silently, had no undo, showed 8–10px text with no fit score or overdue signal, repeated the search box twice, and used fixed colours that would be unreadable in light mode.

**What it does now**
- **Two ways to move a card:** drag it (mouse), or use the **Move to…** menu on the card (keyboard, phone, tablet, screen reader). Both use the same rules.
- **Moves use the cadence logic**, so dates are set exactly as everywhere else.
- **A move that records a send asks first.** Moving a card into *Touch 1/2/3 sent* shows what will change (the stage, the send date, the next due date) and saves **nothing until you confirm**. A warning appears if it skips an earlier touch. Moves that don't record a send (Under review, Replied…) happen immediately.
- **Undo** for 12 seconds after every move (it also removes the dates the move had set).
- **A refused save is reported** ("Nothing was changed") and the card stays put.
- **Do Not Respond is protected:** hidden by default (**Show Do Not Respond** reveals them as "Do not contact") and never movable into outreach. View-only accounts cannot move cards.
- **Cards show what matters:** fit score, the next step or how late it is ("Touch 2 overdue · 9 days"), reply status, last touch, plus **Email** (opens the Outreach desk on that prospect), **Street** (if the prospect has coordinates) and **Move to…**. Click the name to edit.
- **Columns** show the count, how many are overdue or replied, and the average fit; the most urgent cards are on top. Filters: search, industry, market, **Needs action** (overdue + replies), **Hide empty stages**. Summary pills show totals.

## Finding prospects: better search, a results map and Street View
**What was wrong with the search (and is fixed)**
- A typed keyword was applied *after* the server had already cut the list to 60, so a keyword like "dental" could remove nearly everything. The keyword is now part of the query itself.
- Businesses with no name used up result slots. The query now asks only for named places.
- Only the first 3 of an industry's categories were searched, and the radius was silently capped at 15 miles even though the menu offers 25. All categories are searched, up to a 25-mile cap (the page tells you if it was limited).
- Results were not nearest-first and had no address or coordinates. They are now de-duplicated, nearest-first, with street address, exact coordinates and distance. Results are shown best-first (new leads before ones you already have, strongest fit, then nearest).
- Many industries gained more OpenStreetMap categories, plus "name hints" (for example "home care") that catch businesses that are in the right line of work but not tagged.
- Nonprofit search by city used to type the *city's name* into a name search. It now samples common name words, filters by state and by industry group, checks several pages, and keeps only organisations in that city.
- With no industry and no name, the search used to quietly look for restaurants. It now asks you to choose one.

**Map and Street View**
- **Find prospects → "Map + Street View"** shows the results on a map; each pin has Street View, Open in Maps and Select.
- Every result with exact coordinates has a **Street View** link; each saved prospect has **Street View** and **Open in Maps** in its side panel; the territory map's "Show each prospect" pins now sit at the exact location with the same links.
- These are Google's documented **keyless links** (no API key, no cost, nothing is sent until you click; they open Google Maps in a new tab). Businesses saved from the finder keep their coordinates and street address. Nonprofits only list a city, so they get **Find on Maps** (a search), never an invented street view.
- An **embedded, draggable Street View inside the app** needs a Google Maps API key with billing. That is a separate decision and is not used.

**Limits (please read)**
- The search sources (OpenStreetMap's Overpass servers and ProPublica) could not be reached from where this was built, so the new queries are tested for correctness and safety (including injection attempts) but **not against the live services**. Try the checks in section 8.
- OpenStreetMap is community-edited: coverage and completeness vary by area, and many small businesses are missing or have no phone or email.
- ProPublica cannot filter by city, so a city-only nonprofit search is a *sample* (a few name words and pages), not a complete list.

**Deploying this change (three parts)**
1. The website (the patch, as usual).
2. **Two server functions must be redeployed** or the search improvements will not take effect: `supabase functions deploy prospectfinder-businesses` and `supabase functions deploy prospectfinder-nonprofits` (the shared file `_shared/finderSearch.js` goes with them).
3. **One small database change**: run `supabase/migrations/20261024000000_prospect_location.sql` in the Supabase SQL editor. Until you do, everything works but coordinates are not saved. Then run `docs/verify_migrations.sql` (19 rows, all `ok = true`).

## Redundancy cleanup — what was removed, fixed and kept
**Removed (verified unreachable or superseded)**
- The **old finder screen and its search helpers** in `App.jsx` (about 1,200 lines: 22 functions and tables that nothing could reach since "Find prospects" switched to the nationwide finder), plus the Leaflet pin setup and imports that only they used. `App.jsx` went from 4,964 to about 3,700 lines.
- Admin's **second Prospects table** (with its own edit, import, export and add). The tab now points to the real Prospects area. This also removed its **"Reset all CRM data"** button, which replaced every prospect with built-in *sample* data.
- The Activity log's **second email composer** (template, subject, message, Copy, Open email app, "Record draft prepared"). The Outreach desk does all of that. The Activity log keeps the contact-details check, manual source review and the activity timeline, and has a **Write an email →** button that opens the desk with that prospect chosen. *Difference to know about:* "Record draft prepared" is gone; the desk records only sends you confirm.
- A few unused one-line helpers (`nameSimilarity`/`dice`, `publicDetailsFromApollo`, `DEFAULT_NC_COORDS`, `nonProfitCategories`, `TERMINAL`, `DATE_STEPS`, `ICON_NAMES`).

**Made live instead of deleted (the live finder was missing them)**
- Duplicate check against your CRM: it now catches name variants and shared email / phone / website, not only identical ids. A near-certain match is "Already in CRM"; a same-name-other-city match is a warning you can override.
- The same organisation found by two sources is shown once ("Also found via …").
- A **Fit** column, and a priority plus a readable "why fit" saved when a result is added.
- A contact with an HR / people job title marks the prospect as having an HR person (otherwise it stays "Unknown").

**Bugs fixed on the way**
- **Export to Excel never worked**: the code read `crmData.map(p=({…}))` (a missing `>`), which throws on every click, from the Prospects toolbar, the bulk bar and Admin alike. Fixed and covered by tests.
- **My duplicate detector wrongly linked unrelated organisations** that were both sourced from ProPublica / OpenStreetMap (it treated the *listing* link as their website). Hundreds of nonprofits would have chained into one fake "duplicate group". It now ignores listing sites (ProPublica, OpenStreetMap, GuideStar, LinkedIn, Facebook and others) and uses each organisation's own website.

**Still overlapping — left for your decision (not removed)**
- **Gmail inbox tab** still contains an older "Outreach Queue / Compose / Sent" that overlaps the Outreach desk. Its Sent history and reading replies are unique, so I did not remove it.
- **Follow-ups & reports** vs the desk queue vs Today's suggestions: related but different jobs (Follow-ups can reschedule dates).
- **Action Queue** vs Today's suggestions.
- The old standalone shell at `?classic=1` (your rollback hatch).

## Email & outreach (redesigned)
**Outreach desk** is now the main email screen: three columns on one page.
- **Left — who to write to**, organised by urgency: replies to answer → overdue follow-ups → due in the next 3 days → ready for Touch 1 (best fit first). Do Not Respond and converted prospects never appear. Search finds any prospect.
- **Middle — the message.** The right template is suggested for where the prospect is in your cadence (introduction → follow-up → final check-in, or a personal reply), with a personalised greeting, editable subject and text, a preview, and a "before you send" list (no email on file, no contact name, leftover placeholders, a failed email check…).
- **Right — context:** why the prospect is a good fit, the contact details on file, and recent activity.

**How sending works — nothing is automatic**
1. *Open in my email app* or *Copy* only **prepare** the message.
2. The desk then asks **"Did you send it?"** and lists exactly what it will change (move to "Touch 1 sent", the next touch date, an activity-log entry). Only when you press **Yes** is anything saved. **Not yet** changes nothing.
3. *Send with Gmail* appears only when Gmail is connected, and records the touch only if Gmail reports success. If Gmail refuses, nothing is recorded.
4. If the database refuses a change (for example a view-only account), you are told and nothing else is recorded.

**Honesty fixes in the Gmail inbox tab (real workspaces)**
- It no longer shows **fictional emails** (sample people and companies). Until Gmail is connected it says so; the sample emails remain only in demo mode.
- Clicking Send there when Gmail isn't connected used to **pretend to send** (it moved the prospect to "T1 SENT" and wrote an "outbound email" row though nothing was sent). It now does nothing and tells you to connect Gmail.
- The "Opened / Not opened" tick was never backed by any tracking, so it was removed (a reply is the only reliable signal).
- Email headers built for Gmail now strip line breaks (prevents header injection).

## Today, search and shortcuts
- **Today (Home)** tells you what to do next instead of listing menus. It ranks: replies waiting → overdue follow-ups → prospects ready for Touch 1 → unchecked emails → prospects with no email → strong prospects needing an HR check → possible duplicates. The most urgent one is shown large; each has a button that opens the exact place to do it (for example, one overdue follow-up opens the email composer with that prospect already chosen). It also shows four numbers, your pipeline by stage, and where your prospects are (click any to drill in).
- **It only suggests.** Nothing is sent, saved, merged or changed automatically. Do Not Respond and Converted prospects are never suggested.
- **Getting started** card (new accounts): four steps worked out from what you've actually done; **Hide** dismisses it.
- **Ctrl+K (⌘K on Mac)** opens a search-and-jump palette: type part of a company name to open it, or type what you want ("add", "map", "calendar", "dark theme"). **/** jumps to the prospect search box. **Esc** closes things.
- Top bar: a search box (opens the palette) and a **+ New** menu (add a prospect, import, find prospects, new task).

## The sidebar: seven areas (not fourteen)
Related screens are **tabs inside an area**, and each area remembers the tab you used last.

| Area | Tabs inside it | What it's for |
|---|---|---|
| **Home** | — | Today at a glance and shortcuts |
| **Find prospects** | — | Search nonprofits and small businesses anywhere in the U.S. and save the good ones |
| **Prospects** | List, map & qualify · Pipeline board | Your saved prospects: table, **map**, duplicates, qualification, and the pipeline board |
| **Email & outreach** | Outreach desk · Gmail inbox · Follow-ups & reports · Activity log | Write and send (the desk), read replies, manage who is due a follow-up, review contact details and log activity |
| **Calendar & tasks** | Calendar · Team tasks · Task alerts | Due dates, tasks and reminders |
| **Insights** | Analytics · Quality & priorities · Action queue | Reports, data clean-up and "what should I do next" |
| **Settings** | API integrations · Admin (admins) | Connections, users and the audit log |

**Quick actions on every prospect** (open any row in Prospects): **Write email** (opens the template composer with that prospect chosen), **Schedule follow-up** (opens a task pre-filled for you to review and save), **Show on map** (the Map view, filtered to that place). Nothing is sent or saved automatically.

## What changed (the first step)
The app used to be two apps in one: the new ProspectFinder workspace (light, purple) and the classic CRM (dark, gold), each with its own navigation. They are now **one app with one sidebar**.

| Before | Now |
|---|---|
| Classic CRM → Dashboard | **Overview** (the new home) |
| Classic CRM → Prospect Finder | **Find Prospects** (the nationwide finder) |
| Classic CRM → Prospects (table) **and** Saved Prospects | **Prospects** — one area with four views: **Table · Map · Duplicates · Qualification** |
| Classic CRM → Pipeline / Calendar / Email Hub | **Pipeline · Calendar · Email Hub** in the same sidebar (screens unchanged) |
| Admin (a separate full-screen page) | **Admin** inside the workspace (users, plugins, audit log) |
| Excel import / export | Buttons in the **Prospects** toolbar (and still in Admin) |
| "Classic CRM", "Lead management", "Saved Prospects" buttons | Removed (they were duplicates) |

Nothing was rewritten: the classic screens are rendered in place and share the same data and permissions. Everything the new workspace already had (tasks, alerts, analytics, quality review, action queue, templates & activity, API integrations) is untouched in function.

**Safety hatch:** add `?classic=1` to the address (e.g. `https://your-site/?classic=1`) to open the old standalone shell. It exists only so you can roll back while you accept the new layout; it can be deleted later.

### Prospects ↔ Qualification
In **Prospects → Qualification** you get the former "Saved Prospects" workspace. In the Table, open a row and press **Qualify** to jump straight to that prospect in Qualification. Other screens that used to link to "Saved Prospects" now land here.

## Themes
A **Light / Dark / Auto** switch sits at the bottom of the sidebar and on the sign-in screen. The choice is remembered per browser; **Auto** follows the computer's setting.

- **Dark** is the original look. The only deliberate change: the dimmest helper text (placeholders, hints) was brightened slightly — it measured 2.4:1 contrast, below the 3:1 minimum for readable text.
- **Light** is new for the classic screens and matches the new workspace's look. The workspace screens are **identical to before** in light mode (their original colours are the light values).
- The sidebar stays dark navy in both themes, by design.
- Map tiles are inverted in dark mode so the map isn't a bright rectangle.

### How it works (for whoever maintains it)
- `src/styles/theme.css` — the core colours (background, text, borders, gold, green/amber/red…) for both themes. **Change brand colours here.**
- `src/styles/pf-palette.css` — about 335 colours of the workspace screens, generated from their original values. Light = original; dark = mapped by role (text / background / border) and lightness.
- `src/ui/theme.js` — remembers the choice, follows the system, sets `<html data-theme>`.
- Contrast is checked automatically (`npm test`): core tokens in both themes, and **every text-on-background pair found in the workspace screens' source** (61 pairs) in dark mode, plus a check that light mode is exactly the original colours.

## What was NOT verified (please look)
I could not take screenshots, so the tests above prove readability by arithmetic and prove behaviour in a simulated browser, but **not that it looks good**. Please look at both themes on: Overview, Find Prospects, Prospects (all four views), Pipeline, Calendar, Email Hub, Team Tasks, Analytics, Admin, and the sign-in page — on a laptop and a phone. See section 8 of `ACCEPTANCE_CHECKLIST.md`. Known soft spots:
- A few colours are intentionally unchanged in dark mode (the purple primary buttons, status colours that were already light). The purple used as *text* on dark may look dim in places.
- Screens built with fixed pale colours that the generator treats as "decorative" may show a slightly different tint than you'd choose by hand — tell me which and I'll tune that one colour.
- The old finder modal (~500 lines in `App.jsx`) is no longer shown anywhere; it was not themed and can be deleted.

## Rolling back
- Netlify: Deploys → pick the previous deploy → **Publish deploy** (seconds).
- In the app: `?classic=1` opens the old shell.
