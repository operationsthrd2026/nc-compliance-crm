# NC Compliance CRM — v4.0

**HR On Demand · SMB & Nonprofit Outreach Tracker**

A full-featured compliance-vertical CRM for North Carolina prospect management, built with React + Vite + Supabase.

---

## Project structure

```
nc-compliance-crm/
├── src/
│   ├── App.jsx          ← entire CRM application (single-file)
│   └── main.jsx         ← React entry point
├── index.html           ← HTML shell
├── vite.config.js       ← Vite build configuration
├── package.json         ← dependencies & scripts
├── .env.local           ← your secrets (DO NOT commit — git-ignored)
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

---

## Demo login accounts

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
2. Go to **SQL Editor** → paste the contents of `supabase_schema.sql` → **Run**
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
| 🔐 Authentication | 5 role levels · Google Sign-In · session persistence |
| 🔍 AI Prospect Finder | Claude · ChatGPT · Gemini · Apollo.io · Hunter.io |
| 📊 Dashboard | Pipeline, vertical & market breakdowns, VA checklist |
| 🗄️ Prospects | Full CRUD · sortable table · kanban pipeline |
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
| `VITE_APOLLO_KEY` | Optional | Apollo.io API key (Prospect Finder) |
| `VITE_HUNTER_KEY` | Optional | Hunter.io API key (Prospect Finder) |
| `VITE_ANTHROPIC_KEY` | Optional | Anthropic API key (Claude AI search) |

---

*NC Compliance CRM v4.0 · HR On Demand · © 2026*
