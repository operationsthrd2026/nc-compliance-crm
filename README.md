# NC Compliance CRM — v4.0

**HR On Demand · SMB & Nonprofit Outreach Tracker**

A full-featured compliance-vertical CRM for North Carolina prospect management, built with React + Vite + Supabase.

---

## Project structure

```
nc-compliance-crm/
├── src/
│   ├── App.jsx          ← CRM shell, dashboard, pipeline, finder modal
│   ├── constants.js     ← brand colours, statuses, shared helpers
│   ├── lib/             ← tested logic: scoring, duplicates, email checks, filters, geo (npm test)
│   ├── features/prospects/ ← Prospects screen (table, filters, drawer, map, duplicates)
│   ├── ui/ + styles/    ← component kit and the dark + gold theme
│   └── main.jsx         ← React entry point
├── index.html           ← HTML shell
├── vite.config.js       ← Vite build configuration
├── package.json         ← dependencies & scripts
├── .env.local           ← your local config (git-ignored — never commit it)
├── .env.example         ← template showing what goes in .env.local
├── .gitignore
└── README.md
```

---

## Quick start

### 1 — Install dependencies

```bash
npm install
```

### 2 — Configure environment

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> **No Supabase yet?** Leave `.env.local` empty and the app runs in **Demo Mode** — fully functional, data resets on page refresh.

### 3 — Start the dev server

```bash
npm run dev
```

Opens at **http://localhost:3000**

### 4 — Build for production

```bash
npm run build
```

Creates a `dist/` folder ready to deploy.

### 5 — Run the tests

```bash
npm test
```

---

## Demo-mode accounts (only when Supabase is NOT configured)

> These exist **only** in Demo Mode (no `VITE_SUPABASE_*` set) and never touch a real database. With Supabase configured, users sign in with their **email + password** (or Google) through Supabase Auth, and these accounts do not exist.

| Username     | Password    | Role         |
|-------------|-------------|--------------|
| `superadmin` | `superadmin` | 🔱 Super Admin |
| `admin`      | `admin`      | ⚡ Admin       |
| `manager1`   | `manager123` | 📋 Manager     |
| `user1`      | `user123`    | 👤 User        |
| `viewer1`    | `view123`    | 👁 Viewer      |

---

## Database setup (Supabase)

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → run your table schema, then run `supabase/migrations/20261019000000_security_hardening.sql` (**required** — see `SECURITY_HARDENING.md`)
3. Copy **Project URL** + **anon key** from Settings → API
4. Paste them into `.env.local`

See **`SETUP_GUIDE.md`** for the full walkthrough.

---

## Deployment

### Vercel (recommended)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy from project root
vercel

# Add environment variables in Vercel dashboard:
# Settings → Environment Variables
# VITE_SUPABASE_URL = https://your-project.supabase.co
# VITE_SUPABASE_KEY = eyJhbGc...
```

Then add your custom domain in **Vercel → Settings → Domains**.

### Netlify

```bash
npm run build
# Drag the dist/ folder to netlify.com/drop
```

### VPS (Nginx / Caddy)

```bash
npm run build
scp -r dist/ user@your-server:/var/www/nc-crm/
```

See **`SETUP_GUIDE.md`** → VPS tab for the full Caddy config.

---

## Features

| Feature | Details |
|---------|---------|
| 🔐 Authentication | Supabase Auth (email + password, Google) · 5 role levels enforced by Row Level Security |
| 🔍 Prospect Finder | Apollo · Hunter · GuideStar · NPI Registry · local directory — fuzzy duplicate check, explainable fit score, email verification, shared saved searches |
| 📊 Dashboard | Pipeline, vertical & market breakdowns, VA checklist |
| 🗄️ Prospects | Filters, saved views, bulk actions, detail drawer, NC territory map, duplicate finder & merge · kanban pipeline — see `PROSPECTS_UPGRADE.md` |
| 📧 Email Hub | Outreach queue · compose + templates · inbox · sent tracking |
| 📁 Excel Import | Smart column mapping · append or replace · template download |
| ⬇️ Excel Export | Full 28-field export with one click |
| 🛡️ Admin Panel | User management · CRM data · system settings · plugins · audit log |
| 🗄️ Database | Supabase (PostgreSQL) · real-time · auto-persisted |

---

## Tech stack

- **React 18** with hooks (no class components)
- **Vite 5** — HMR dev server, esbuild production bundling
- **SheetJS (xlsx)** — Excel import/export
- **Supabase** — PostgreSQL database, REST API, Row Level Security
- **Zero UI library** — all styles are inline React, no Tailwind/MUI dependency

---

## Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | For live DB | Your Supabase project URL |
| `VITE_SUPABASE_KEY` | For live DB | Supabase anon/public key |

> Third-party keys (Apollo, Hunter, Google Search) are **not** `VITE_` variables — anything with that prefix is compiled into the public JavaScript. They are stored server-side; see `SECURITY_HARDENING.md`.

---

*NC Compliance CRM v4.0 · HR On Demand · © 2026*
