# Unified workspace + light/dark themes

## The sidebar: seven areas (not fourteen)
Related screens are **tabs inside an area**, and each area remembers the tab you used last.

| Area | Tabs inside it | What it's for |
|---|---|---|
| **Home** | — | Today at a glance and shortcuts |
| **Find prospects** | — | Search nonprofits and small businesses anywhere in the U.S. and save the good ones |
| **Prospects** | List, map & qualify · Pipeline board | Your saved prospects: table, **map**, duplicates, qualification, and the pipeline board |
| **Email & outreach** | Gmail inbox · Write from template · Follow-ups & reports | Read and send email, draft from templates (and log it), manage who is due a follow-up |
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
