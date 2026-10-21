import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { cleanTag } from "./lib/filters.js";
import { mapPool } from "./lib/emailCheck.js";
import ProspectsView from "./features/prospects/ProspectsView.jsx";
import NationwideFinder from "./features/prospects/NationwideFinder.jsx";
import ProspectHome from "./features/prospects/ProspectHome.jsx";
import { localSavedApi } from "./features/useSavedSearches.js";
import { scoreProspect, priorityFromScore, explainFit } from "./lib/scoring.js";
import { buildIndex, findMatches, collapseResults } from "./lib/dedupe.js";
import { extractEmails } from "./lib/text.js";
import { emailKind } from "./lib/scoring.js";
import { verifyEmail } from "./lib/emailCheck.js";
import { allTags } from "./lib/filters.js";
import { useSavedSearches } from "./features/useSavedSearches.js";
import { TagInput, ScoreBadge, EmailBadge } from "./ui/kit.jsx";
import { N, NL, NC, NB, G, GL, W, WM, WD, BR, ROLES, STATUSES, VERTICALS, MARKETS, ORG_SIZES, SRC_TYPES, SC, EMPTY_P, uid, today, isPast, hasEM, initials, addDays, inp, LBL, B, NC_CITY_COORDS, DEFAULT_NC_COORDS } from "./constants.js";

/* ════════════════════════════════════════════════════════════════
   SUPABASE CONFIG
   ─ Option A (recommended): set VITE_SUPABASE_URL and VITE_SUPABASE_KEY
     in your .env.local file (see .env.example). Vite injects them at
     build time via import.meta.env — credentials never appear in source.

   ─ Option B (quick start): paste your values directly into the
     strings below. Fine for local testing; remove before pushing to
     a public repository.

   ─ Leave both as-is to run in Demo Mode (fully functional, data
     resets on refresh).
════════════════════════════════════════════════════════════════ */

// ── Supabase credentials ─────────────────────────────────────
// Vite statically replaces import.meta.env.VITE_* at build time.
// Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY in Vercel → Settings →
// Environment Variables, then trigger a new deployment.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "YOUR_PROJECT_URL_HERE";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || "YOUR_ANON_KEY_HERE";

const isConfigured =
  SUPABASE_URL !== "YOUR_PROJECT_URL_HERE" &&
  SUPABASE_KEY !== "YOUR_ANON_KEY_HERE" &&
  SUPABASE_URL.startsWith("https://");

/* ── Debug logging ──────────────────────────────────────────────
   console.error() always fires — those indicate real problems and
   should be visible regardless. dlog()/dwarn() info
   traces (DB connection status, successful saves, etc.) are gated
   behind a DEBUG flag to keep the production console clean.
   Enable verbose logging from the browser console with:
     localStorage.setItem("nc_crm_debug","1")
   then refresh the page. Disable with:
     localStorage.removeItem("nc_crm_debug")              */
const DEBUG = typeof window !== "undefined" && window.localStorage?.getItem("nc_crm_debug") === "1";
const dlog = (...args) => { if (DEBUG) console.log(...args); };
const dwarn = (...args) => { if (DEBUG) console.warn(...args); };

if (DEBUG) {
  console.log("[NC CRM] Debug logging enabled. Supabase configured:", isConfigured,
    "| URL:", SUPABASE_URL.startsWith("https://") ? SUPABASE_URL.slice(0,40)+"…" : "(not set)");
}

// ── Supabase Auth client (separate from the sbFetch REST helper) ──
// Owns the browser session (email+password and Google sign-in). Every
// DB / Edge Function request is sent with the signed-in user's access
// token (see authHeaders), so Postgres Row Level Security can tell who
// is calling and enforce their role. The anon key alone grants nothing.
const supabaseAuth = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// Which optional database features exist? Filled by DB.detectSchema() after sign-in so the
// app keeps working if the code is deployed before the SQL migration has been run.
const SCHEMA = { tags: false, savedSearches: false };

// Placeholder shown in the UI for an API key that is saved server-side.
// The real key is never sent to the browser.
const KEY_MASK = "__configured__";

// Headers carrying the signed-in user's JWT (falls back to the anon key,
// which RLS treats as "not signed in" and denies).
async function authHeaders() {
  let token = SUPABASE_KEY;
  if (supabaseAuth) {
    const { data } = await supabaseAuth.auth.getSession();
    if (data?.session?.access_token) token = data.session.access_token;
  }
  return {
    "apikey":        SUPABASE_KEY,
    "Authorization": `Bearer ${token}`,
    "Content-Type":  "application/json",
  };
}

// Admin-only login management (create / set_password / delete) via the
// admin-users Edge Function — the browser can't hold the service key.
async function adminUsersCall(payload) {
  if (!isConfigured) return { ok: true, local: true };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST", headers: await authHeaders(), body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

/* ════════════════════════════════════════════════════════════════
   SUPABASE DATABASE LAYER
   All DB calls go through these helpers. When not configured,
   they fall back to local state (demo mode).
════════════════════════════════════════════════════════════════ */
async function sbFetch(path, method = "GET", body = null, prefer = "return=representation", quiet = false) {
  // Clean, conflict-free header builder
  const headers = {
    ...(await authHeaders()),
    "Prefer":        prefer,
  };

  const options = { method, headers };
  if (body !== null) options.body = typeof body === "string" ? body : JSON.stringify(body);

  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  dlog(`[NC CRM DB] ${method} ${path}`);

  const res = await fetch(url, options);

  // 204 No Content — DELETE returns this on success
  if (res.status === 204) return null;

  const text = await res.text();

  if (!res.ok) {
    if (!quiet) console.error(`[NC CRM DB] ❌ ${method} ${path} → ${res.status}:`, text);
    throw new Error(`Supabase ${res.status} on ${method} ${path}: ${text}`);
  }

  if (!text || text.trim() === "") return null;

  try { return JSON.parse(text); }
  catch(e) { return text; }
}

// Convert DB row (snake_case) → app object (camelCase)
function dbToProspect(r) {
  if (!r) return null;
  return {
    id: r.id, companyName: r.company_name || "", contactName: r.contact_name || "",
    title: r.title || "", emailPhone: r.email_phone || "", cityMarket: r.city_market || "",
    market: r.market || "", sourceUrl: r.source_url || "", sourceType: r.source_type || "",
    verificationNotes: r.verification_notes || "", whyFit: r.why_fit || "",
    vertical: r.vertical || "", hrPersonListed: r.hr_person_listed || "No",
    hrPeopleContact: r.hr_people_contact || "", orgSize: r.org_size || "",
    t1SendDate: r.t1_send_date || "", t1DueDate: r.t1_due_date || "",
    t2SendDate: r.t2_send_date || "", t2DueDate: r.t2_due_date || "",
    t3SendDate: r.t3_send_date || "", t3DueDate: r.t3_due_date || "",
    leadPainPoint: r.lead_pain_point || "", melissaReview: r.melissa_review || "",
    t3Approved: !!r.t3_approved, replyReceived: !!r.reply_received,
    flagToMelissa: !!r.flag_to_melissa, doNotRespond: !!r.do_not_respond,
    currentStatus: r.current_status || "NEW", outreachNotes: r.outreach_notes || "",
    priorityScore: r.priority_score ? String(r.priority_score) : "", remarks: r.remarks || "",
    tags: Array.isArray(r.tags) ? r.tags : [], emailStatus: r.email_status || "", emailCheckedAt: r.email_checked_at || "",
  };
}

// Convert app object (camelCase) → DB row (snake_case)
function prospectToDb(p) {
  return {
    company_name: p.companyName, contact_name: p.contactName, title: p.title,
    email_phone: p.emailPhone, city_market: p.cityMarket, market: p.market,
    source_url: p.sourceUrl, source_type: p.sourceType,
    verification_notes: p.verificationNotes, why_fit: p.whyFit,
    vertical: p.vertical, hr_person_listed: p.hrPersonListed,
    hr_people_contact: p.hrPeopleContact, org_size: p.orgSize,
    t1_send_date: p.t1SendDate || null, t1_due_date: p.t1DueDate || null,
    t2_send_date: p.t2SendDate || null, t2_due_date: p.t2DueDate || null,
    t3_send_date: p.t3SendDate || null, t3_due_date: p.t3DueDate || null,
    lead_pain_point: p.leadPainPoint, melissa_review: p.melissaReview,
    t3_approved: !!p.t3Approved, reply_received: !!p.replyReceived,
    flag_to_melissa: !!p.flagToMelissa, do_not_respond: !!p.doNotRespond,
    current_status: p.currentStatus, outreach_notes: p.outreachNotes,
    priority_score: p.priorityScore ? parseInt(p.priorityScore) : null,
    remarks: p.remarks,
    // v2 columns — only sent once the migration exists (see DB.detectSchema)
    ...(SCHEMA.tags ? { tags: p.tags || [], email_status: p.emailStatus || null, email_checked_at: p.emailCheckedAt || null } : {}),
  };
}

function dbToSaved(r) {
  return { id: r.id, scope: r.scope, name: r.name, params: r.params || {}, shared: !!r.shared,
    createdBy: r.created_by, createdByName: r.created_by_name || "", createdAt: r.created_at || "" };
}

function dbToUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, password: "", name: r.name,
    email: r.email, role: r.role, active: r.active,
    avatar: r.avatar || r.name.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase(),
    createdAt: r.created_at ? r.created_at.slice(0,10) : "",
    lastLogin: r.last_login || null,
  };
}

const DB = {
  // Prospects
  async getProspects() {
    const rows = await sbFetch("prospects?order=created_at.asc&select=*");
    return (rows || []).map(dbToProspect);
  },
  async upsertProspect(p) {
    const body = prospectToDb(p); // never includes id — safe for both INSERT and UPDATE
    const isDbId = typeof p.id === "string" && /^[0-9a-f-]{36}$/.test(p.id);
    if (isDbId) {
      // UPDATE existing row
      const rows = await sbFetch(`prospects?id=eq.${encodeURIComponent(p.id)}`, "PATCH", body, "return=representation");
      return dbToProspect(Array.isArray(rows) ? rows[0] : rows);
    } else {
      // INSERT new row — let Supabase generate the UUID
      const rows = await sbFetch("prospects", "POST", body, "return=representation");
      return dbToProspect(Array.isArray(rows) ? rows[0] : rows);
    }
  },
  async deleteProspect(id) {
    const rows = await sbFetch(`prospects?id=eq.${encodeURIComponent(id)}`, "DELETE");
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("Not permitted, or the prospect no longer exists.");
  },
  async upsertProspects(list) {
    // Bulk INSERT — strip local numeric IDs so Supabase generates fresh UUIDs
    const rows = list.map(p => {
      const row = prospectToDb(p);
      // Only include id if it looks like a real UUID
      if (typeof p.id === "string" && /^[0-9a-f-]{36}$/.test(p.id)) row.id = p.id;
      return row;
    });
    const result = await sbFetch("prospects", "POST", rows, "return=representation");
    return (Array.isArray(result) ? result : []).map(dbToProspect);
  },
  async deleteAllProspects() {
    await sbFetch("prospects?id=neq.00000000-0000-0000-0000-000000000000", "DELETE");
  },

  // The signed-in caller's own ACTIVE profile (null = no CRM access)
  async getMyProfile() {
    const rows = await sbFetch("rpc/crm_me", "POST", {});
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row ? dbToUser(row) : null;
  },

  // Users
  async getUsers() {
    const rows = await sbFetch("crm_users?order=created_at.asc&select=*");
    return (rows || []).map(dbToUser);
  },
  async upsertUser(u) {
    const isDbId = typeof u.id === "string" && /^[0-9a-f-]{36}$/.test(u.id);
    // No password here: credentials live in Supabase Auth (see admin-users function).
    const body = { username:u.username, name:u.name, email:u.email, role:u.role, active:u.active, avatar:u.avatar };
    if (isDbId) {
      const rows = await sbFetch(`crm_users?id=eq.${encodeURIComponent(u.id)}`, "PATCH", body, "return=representation");
      return dbToUser(Array.isArray(rows) ? rows[0] : rows);
    } else {
      const rows = await sbFetch("crm_users", "POST", body, "return=representation");
      return dbToUser(Array.isArray(rows) ? rows[0] : rows);
    }
  },
  async deleteUser(id) {
    const rows = await sbFetch(`crm_users?id=eq.${encodeURIComponent(id)}`, "DELETE");
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("Not permitted, or user no longer exists.");
  },
  async updateLastLogin(id) {
    await sbFetch("rpc/crm_touch_login", "POST", {}, "return=minimal");
  },

  // Audit log
  async getAuditLog() {
    const rows = await sbFetch("audit_log?order=created_at.asc&select=*&limit=200");
    return (rows||[]).map(r=>({ time: r.created_at ? r.created_at.slice(0,16).replace("T"," ") : "", user: r.username, action: r.action }));
  },
  async addAudit(username, action) {
    await sbFetch("audit_log", "POST", { username, action }, "return=minimal");
  },

  // System settings
  async getSettings() {
    const rows = await sbFetch("system_settings?select=key,value");
    const out = {};
    (rows||[]).forEach(r => {
      if (r.value === "true") out[r.key] = true;
      else if (r.value === "false") out[r.key] = false;
      else if (!isNaN(r.value) && r.value !== "") out[r.key] = r.value;
      else out[r.key] = r.value || "";
    });
    return out;
  },
  async saveSettings(settings) {
    // Upsert all settings at once using Supabase merge-duplicates
    // Third-party API keys are NEVER stored in system_settings.
    const rows = Object.entries(settings)
      .filter(([key]) => !/key$|secret$|token$/i.test(key))
      .map(([key, value]) => ({ key, value: String(value) }));
    await sbFetch("system_settings", "POST", rows, "resolution=merge-duplicates,return=minimal");
  },

  // API plugin credentials (Apollo, Hunter, Anthropic, ...) — stored
  // in their own table so each integration carries its own metadata
  // (last updated, by whom). Returns a flat { apollo: "key", hunter: "key", ... } map.
  async getApiCredentials() {
    // Status only — the browser can never read a key. Returns { apollo: KEY_MASK, ... }
    // for each service that has a key saved server-side.
    const rows = await sbFetch("rpc/crm_api_key_status", "POST", {});
    const out = {};
    (rows||[]).forEach(r => { if (r.configured) out[r.service] = KEY_MASK; });
    return out;
  },
  // Write-only, admin-only (enforced in Postgres). Empty string removes the key.
  async saveApiCredential(service, apiKey) {
    await sbFetch("rpc/crm_set_api_credential", "POST", { p_service: service, p_key: apiKey }, "return=minimal");
  },

  // Which optional features does this database support?
  async detectSchema() {
    const probe = async (path) => { try { await sbFetch(path, "GET", null, "return=minimal", true); return true; } catch { return false; } }; // quiet: "missing" is an expected answer
    SCHEMA.tags = await probe("prospects?select=tags,email_status,email_checked_at&limit=1");
    SCHEMA.savedSearches = await probe("saved_searches?select=id&limit=1");
    return { ...SCHEMA };
  },

  // Shared saved searches / views
  async getSavedSearches(scope) {
    const rows = await sbFetch(`saved_searches?scope=eq.${encodeURIComponent(scope)}&order=created_at.desc&select=*`);
    return (rows || []).map(dbToSaved);
  },
  async saveSearch(s) {
    const rows = await sbFetch("saved_searches", "POST",
      { scope: s.scope, name: s.name, params: s.params, shared: s.shared !== false, created_by_name: s.createdByName || null },
      "return=representation");
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error("Not permitted to save searches");
    return dbToSaved(row);
  },
  async deleteSavedSearch(id) {
    const rows = await sbFetch(`saved_searches?id=eq.${encodeURIComponent(id)}`, "DELETE");
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("Not permitted, or already deleted");
  },

  // Emails
  async getEmails() {
    const rows = await sbFetch("emails?order=sent_at.desc&select=*&limit=100");
    return rows || [];
  },
  async addEmail(email) {
    await sbFetch("emails", "POST", email, "return=minimal");
  },
};

/* ════════════════════════════════════════════════════════════════
   GMAIL API HELPERS
   Uses the Google access token captured during OAuth sign-in
   (stored in sessionStorage as "google_access_token").
   Falls back gracefully to Gmail compose links / mock data if the
   token is missing or a request fails (e.g. token expired).
════════════════════════════════════════════════════════════════ */
function getGoogleToken() {
  return sessionStorage.getItem("google_access_token") || null;
}

function isGmailConnected() {
  return !!getGoogleToken();
}

// Send an email through the signed-in user's real Gmail account
async function sendViaGmailAPI({ to, subject, body, cc }) {
  const token = getGoogleToken();
  if (!token) return { ok: false, reason: "no_token" };

  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ].filter(Boolean).join("\r\n");

  const raw = `${headers}\r\n\r\n${body}`;
  const encoded = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  try {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encoded }),
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      console.error("[NC CRM] Gmail send failed:", res.status, err);
      return { ok: false, reason: "api_error", status: res.status, error: err };
    }
    const data = await res.json();
    dlog("[NC CRM] ✅ Email sent via Gmail API, id:", data.id);
    return { ok: true, id: data.id };
  } catch (e) {
    console.error("[NC CRM] Gmail send exception:", e.message);
    return { ok: false, reason: "network_error", error: e.message };
  }
}

// Fetch recent inbox messages from the signed-in user's real Gmail
async function fetchGmailInbox(maxResults = 15) {
  const token = getGoogleToken();
  if (!token) return { ok: false, reason: "no_token", messages: [] };

  try {
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=in:inbox`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listRes.ok) {
      const err = await listRes.json().catch(()=>({}));
      console.error("[NC CRM] Gmail list failed:", listRes.status, err);
      return { ok: false, reason: "api_error", status: listRes.status, messages: [] };
    }
    const listData = await listRes.json();
    if (!listData.messages || listData.messages.length === 0) {
      return { ok: true, messages: [] };
    }

    const detailed = await Promise.all(
      listData.messages.map(async (m) => {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        return r.ok ? r.json() : null;
      })
    );

    const messages = detailed.filter(Boolean).map(m => {
      const headers = m.payload?.headers || [];
      const get = name => headers.find(h => h.name === name)?.value || "";
      const fromRaw = get("From");
      const fromMatch = fromRaw.match(/^(.*?)\s*<(.+)>$/);
      const fromName = fromMatch ? fromMatch[1].replace(/"/g,"").trim() : fromRaw;
      const fromEmail = fromMatch ? fromMatch[2] : fromRaw;
      return {
        id: m.id,
        from: fromName || fromEmail,
        fromEmail,
        subject: get("Subject") || "(no subject)",
        preview: (m.snippet || "").slice(0, 140),
        body: m.snippet || "",
        date: get("Date") ? new Date(get("Date")).toLocaleString("sv-SE").slice(0,16).replace("T"," ") : "",
        read: !m.labelIds?.includes("UNREAD"),
        starred: m.labelIds?.includes("STARRED") || false,
        label: "reply",
        sentiment: "neutral",
        prospectId: null,
        touch: null,
        _gmailId: m.id,
      };
    });

    return { ok: true, messages };
  } catch (e) {
    console.error("[NC CRM] Gmail fetch exception:", e.message);
    return { ok: false, reason: "network_error", error: e.message, messages: [] };
  }
}

/* ════════════════════════════════════════════════════════════════
   THEME
════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════
   ROLES
════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════
   INITIAL DATA
════════════════════════════════════════════════════════════════ */
const INIT_USERS=[
  {id:1,username:"superadmin",password:"superadmin",name:"Super Administrator",email:"superadmin@hrondemand.com",role:"superadmin",active:true,createdAt:"2024-01-01",lastLogin:null,avatar:"SA"},
  {id:2,username:"admin",     password:"admin",     name:"System Administrator",email:"admin@hrondemand.com",   role:"admin",     active:true,createdAt:"2024-01-01",lastLogin:null,avatar:"AD"},
  {id:3,username:"manager1",  password:"manager123",name:"Melissa Pennington",  email:"melissa@hrondemand.com", role:"manager",   active:true,createdAt:"2024-01-15",lastLogin:null,avatar:"MP"},
  {id:4,username:"user1",     password:"user123",   name:"Jordan Hayes",        email:"jordan@hrondemand.com",  role:"user",      active:true,createdAt:"2024-02-01",lastLogin:null,avatar:"JH"},
  {id:5,username:"viewer1",   password:"view123",   name:"Alex Torres",         email:"alex@hrondemand.com",    role:"viewer",    active:true,createdAt:"2024-02-10",lastLogin:null,avatar:"AT"},
];




const SEED=[
  {id:1,companyName:"Comfort Keepers – Raleigh",contactName:"Bob Marshall",title:"Franchise Owner",emailPhone:"bobmarshall@comfortkeepers.com",cityMarket:"Raleigh",market:"Raleigh",sourceUrl:"",sourceType:"Franchise Directory",verificationNotes:"Verified.",whyFit:"Wage/hour compliance risk.",vertical:"Home Health / Homecare",hrPersonListed:"No",hrPeopleContact:"",orgSize:"10-49",t1SendDate:"2026-05-05",t1DueDate:"2026-05-12",t2SendDate:"2026-05-12",t2DueDate:"2026-05-19",t3SendDate:"2026-05-19",t3DueDate:"2026-05-26",leadPainPoint:"Caregiver misclassification.",melissaReview:"",t3Approved:false,replyReceived:false,flagToMelissa:false,doNotRespond:true,currentStatus:"NURTURE/T3 SENT",outreachNotes:"",priorityScore:"5",remarks:""},
  {id:2,companyName:"Bright Horizons Childcare",contactName:"Sandra Kim",title:"Executive Director",emailPhone:"sandra@brighthorizons-nc.com",cityMarket:"Durham",market:"Durham",sourceUrl:"",sourceType:"LinkedIn",verificationNotes:"Confirmed active.",whyFit:"Staff classification risk.",vertical:"Childcare & Licensed Group Homes",hrPersonListed:"Yes",hrPeopleContact:"Sandra Kim",orgSize:"50-99",t1SendDate:"2026-05-10",t1DueDate:"2026-05-17",t2SendDate:"",t2DueDate:"",t3SendDate:"",t3DueDate:"",leadPainPoint:"Worker classification, I-9.",melissaReview:"",t3Approved:false,replyReceived:false,flagToMelissa:true,doNotRespond:false,currentStatus:"T1 SENT",outreachNotes:"",priorityScore:"8",remarks:""},
  {id:3,companyName:"NC Hope Foundation",contactName:"Dr. Angela Foster",title:"Executive Director",emailPhone:"afoster@nchopefoundation.org",cityMarket:"Raleigh",market:"Raleigh",sourceUrl:"",sourceType:"Nonprofit Directory",verificationNotes:"501(c)(3) confirmed.",whyFit:"HR documentation gaps.",vertical:"Nonprofits & Associations",hrPersonListed:"No",hrPeopleContact:"",orgSize:"10-49",t1SendDate:"",t1DueDate:"",t2SendDate:"",t2DueDate:"",t3SendDate:"",t3DueDate:"",leadPainPoint:"HR documentation gaps.",melissaReview:"",t3Approved:false,replyReceived:false,flagToMelissa:false,doNotRespond:false,currentStatus:"NEW",outreachNotes:"",priorityScore:"7",remarks:""},
  {id:4,companyName:"Triangle Logistics Partners",contactName:"Marcus Webb",title:"Operations Manager",emailPhone:"mwebb@trianglelogistics.com",cityMarket:"Durham",market:"Durham",sourceUrl:"",sourceType:"Apollo.io",verificationNotes:"Verified.",whyFit:"Driver classification risk.",vertical:"Light Manufacturing & Logistics",hrPersonListed:"No",hrPeopleContact:"",orgSize:"50-99",t1SendDate:"2026-05-08",t1DueDate:"2026-05-15",t2SendDate:"2026-05-15",t2DueDate:"2026-05-22",t3SendDate:"2026-05-22",t3DueDate:"2026-05-29",leadPainPoint:"Driver misclassification.",melissaReview:"Approved",t3Approved:true,replyReceived:false,flagToMelissa:false,doNotRespond:false,currentStatus:"TOUCH 3 GATE",outreachNotes:"",priorityScore:"9",remarks:""},
  {id:5,companyName:"Community Care Services",contactName:"Linda Torres",title:"Executive Director",emailPhone:"ltorres@communitycare-nc.org",cityMarket:"Greensboro",market:"Greensboro",sourceUrl:"",sourceType:"Nonprofit Directory",verificationNotes:"Active 501(c)(3).",whyFit:"Human services org with staffing compliance exposure.",vertical:"Human Services Nonprofits",hrPersonListed:"No",hrPeopleContact:"",orgSize:"50-99",t1SendDate:"",t1DueDate:"",t2SendDate:"",t2DueDate:"",t3SendDate:"",t3DueDate:"",leadPainPoint:"FLSA, I-9 documentation.",melissaReview:"",t3Approved:false,replyReceived:false,flagToMelissa:false,doNotRespond:false,currentStatus:"NEW",outreachNotes:"",priorityScore:"8",remarks:""},
];

const DEFAULT_SYS={siteName:"NC Compliance CRM",orgName:"HR On Demand",senderName:"Melissa Pennington",senderEmail:"melissa@hrondemand.com",senderTitle:"Founder, HR On Demand",honeyLink:"[Schedule Link]",website:"thehrondemand.com",maxProspects:1000,requireMelissaApproval:true,autoArchiveDNR:false,emailGmailDefault:true,apolloKey:"",hunterKey:"",anthropicKey:""};


/* ════════════════════════════════════════════════════════════════
   EXCEL COLUMN MAP
════════════════════════════════════════════════════════════════ */
const COL_MAP={"tags":"tags","tag":"tags","email status":"emailStatus","company name":"companyName","company":"companyName","contact name":"contactName","contact":"contactName","name":"contactName","title":"title","job title":"title","position":"title","email":"emailPhone","phone":"emailPhone","email/phone":"emailPhone","email / phone":"emailPhone","city":"cityMarket","city/market":"cityMarket","market":"market","source url":"sourceUrl","url":"sourceUrl","source type":"sourceType","source":"sourceType","notes":"verificationNotes","verification notes":"verificationNotes","why fit":"whyFit","vertical":"vertical","industry":"vertical","hr person listed":"hrPersonListed","org size":"orgSize","company size":"orgSize","t1 send date":"t1SendDate","t1 due date":"t1DueDate","t2 send date":"t2SendDate","t2 due date":"t2DueDate","t3 send date":"t3SendDate","t3 due date":"t3DueDate","lead pain point":"leadPainPoint","pain point":"leadPainPoint","status":"currentStatus","current status":"currentStatus","priority score":"priorityScore","priority":"priorityScore","outreach notes":"outreachNotes","remarks":"remarks"};

/* ════════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
const pct=(n,t)=>t?((n/t)*100).toFixed(1)+"%":"0%";
const tsNow=()=>new Date().toLocaleString("sv-SE",{hour12:false}).replace("T"," ").slice(0,16);
// Add N days to a YYYY-MM-DD date string (or today if none given), return YYYY-MM-DD

/* ── Password hashing (SHA-256 via Web Crypto API) ─────────────
   Stored passwords are SHA-256 hex digests, prefixed "sha256:" so
   we can distinguish them from legacy plaintext values already
   sitting in the database/seed data. This is NOT a substitute for
   server-side bcrypt+salt — it prevents plaintext exposure if the
   database is read directly (e.g. via the Supabase table editor or
   a leaked anon key), but a stolen hash can still be brute-forced
   offline. True per-user salting requires a server-side auth layer
   (e.g. a Supabase Edge Function), which is a larger infrastructure
   change. This is a meaningful improvement with zero new deps.    */
const PW_HASH_PREFIX="sha256:";
async function sha256Hex(text){
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function hashPassword(plain){
  return PW_HASH_PREFIX+await sha256Hex(plain);
}
// Verify a plaintext attempt against a stored value that may be either
// a sha256 hash (new accounts) or legacy plaintext (old seed data /
// accounts created before this change). Legacy matches still work so
// no one gets locked out — but the next saveU() will re-hash on edit.
async function verifyPassword(plainAttempt,stored){
  if(!stored)return false;
  if(stored.startsWith(PW_HASH_PREFIX)){
    return (PW_HASH_PREFIX+await sha256Hex(plainAttempt))===stored;
  }
  // Legacy plaintext comparison (pre-hashing accounts)
  return plainAttempt===stored;
}
// A password value is "already hashed" if it carries our prefix —
// used by saveU to avoid re-hashing a hash when a user record is
// edited without changing the password.
const isHashed=v=>typeof v==="string"&&v.startsWith(PW_HASH_PREFIX);
/* ── Outreach cadence ─────────────────────────────────────────
   Touch 2 is due 7 days after Touch 1 is sent.
   Touch 3 is due 14 days (2 weeks) after Touch 2 is sent.
   applyTouchDates() auto-stamps send/due dates whenever a status
   change represents "I just sent this touch" — called from qStatus
   and the Email Hub send flow so the calendar always reflects
   accurate due dates without manual entry.                      */
const applyTouchDates=(prospect,newStatus)=>{
  const patch={currentStatus:newStatus};
  if(newStatus==="T1 SENT"&&!prospect.t1SendDate){
    patch.t1SendDate=today();
    patch.t2DueDate=addDays(today(),7);
  }
  if(newStatus==="T2 SENT"&&!prospect.t2SendDate){
    patch.t2SendDate=today();
    patch.t3DueDate=addDays(today(),14);
  }
  if((newStatus==="NURTURE/T3 SENT")&&!prospect.t3SendDate){
    patch.t3SendDate=today();
  }
  return{...prospect,...patch};
};
const mapHdr=h=>COL_MAP[(h||"").toLowerCase().trim().replace(/[_\-]+/g," ")]||null;
const parseBool=v=>{if(typeof v==="boolean")return v;const s=String(v||"").toLowerCase().trim();return s==="yes"||s==="true"||s==="1"||s==="y";};
const parseDate=v=>{if(!v)return"";if(typeof v==="number"){try{const d=XLSX.SSF.parse_date_code(v);return`${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;}catch{return"";}}const s=String(v).trim();if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;try{const d=new Date(s);if(!isNaN(d))return d.toISOString().split("T")[0];}catch{}return s;};
const rowToProspect=row=>{const p={...EMPTY_P,id:uid()};Object.entries(row).forEach(([col,val])=>{const f=mapHdr(col);if(!f)return;const df=["t1SendDate","t1DueDate","t2SendDate","t2DueDate","t3SendDate","t3DueDate"];const bf=["t3Approved","replyReceived","flagToMelissa","doNotRespond"];if(df.includes(f))p[f]=parseDate(val);else if(bf.includes(f))p[f]=parseBool(val);else if(f==="tags")p[f]=[...new Set(String(val||"").split(/[;,]/).map(cleanTag).filter(Boolean))].slice(0,30);else if(f==="emailStatus"){const v=String(val||"").trim().toLowerCase();p[f]=["valid","risky","invalid","unknown"].includes(v)?v:"";}else p[f]=val!=null?String(val).trim():"";});return p;};
const exportToExcel=(crmData,fn="NC_CRM_Export")=>{const rows=crmData.map(p=({"Company Name":p.companyName,"Contact Name":p.contactName,"Title":p.title,"Email/Phone":p.emailPhone,"City/Market":p.cityMarket,"Market":p.market,"Vertical":p.vertical,"Org Size":p.orgSize,"Source Type":p.sourceType,"Source URL":p.sourceUrl,"Why Fit":p.whyFit,"Lead Pain Point":p.leadPainPoint,"Current Status":p.currentStatus,"Priority Score":p.priorityScore,"T1 Send Date":p.t1SendDate,"T1 Due Date":p.t1DueDate,"T2 Send Date":p.t2SendDate,"T2 Due Date":p.t2DueDate,"T3 Send Date":p.t3SendDate,"T3 Due Date":p.t3DueDate,"HR Person Listed":p.hrPersonListed,"HR Contact":p.hrPeopleContact,"Flag to Melissa":p.flagToMelissa?"Yes":"No","Reply Received":p.replyReceived?"Yes":"No","T3 Approved":p.t3Approved?"Yes":"No","Do Not Respond":p.doNotRespond?"Yes":"No","Tags":(p.tags||[]).join("; "),"Email Status":p.emailStatus||"","Fit Score":scoreProspect(p).score,"Outreach Notes":p.outreachNotes,"Remarks":p.remarks}));const wb=XLSX.utils.book_new();const ws=XLSX.utils.json_to_sheet(rows);ws["!cols"]=Object.keys(rows[0]||{}).map(()=>({wch:18}));XLSX.utils.book_append_sheet(wb,ws,"Prospects");XLSX.writeFile(wb,`${fn}_${today()}.xlsx`);};

/* ════════════════════════════════════════════════════════════════
   STYLES
════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════
   ATOMS
════════════════════════════════════════════════════════════════ */
function Spin({s=18,c=W}){return <span style={{display:"inline-block",width:s,height:s,border:`2px solid ${c}33`,borderTopColor:c,borderRadius:"50%",animation:"spin 0.65s linear infinite",flexShrink:0}}/>;}
function SBadge({status,sm}){const s=SC[status]||{bg:"rgba(255,255,255,0.06)",c:WM,b:BR};return <span style={{background:s.bg,color:s.c,border:`1px solid ${s.b}`,borderRadius:20,padding:sm?"2px 8px":"3px 11px",fontSize:sm?9:11,fontWeight:700,whiteSpace:"nowrap",display:"inline-block"}}>{status}</span>;}
function RPill({role}){const r=ROLES[role]||ROLES.user;return <span style={{background:r.bg,color:r.color,border:`1px solid ${r.color}44`,borderRadius:20,padding:"2px 10px",fontSize:10,fontWeight:700,whiteSpace:"nowrap"}}>{r.icon} {r.label}</span>;}
function Tgl({on,onChange,danger}){return <div onClick={()=>onChange(!on)} style={{width:40,height:22,borderRadius:11,background:on?(danger?"#ef4444":G):"rgba(255,255,255,0.12)",position:"relative",cursor:"pointer",flexShrink:0,transition:"background 0.2s"}}><div style={{position:"absolute",top:2,left:on?20:2,width:18,height:18,background:"#fff",borderRadius:"50%",transition:"left 0.2s",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/></div>;}
function FG({label,children,span}){return <div style={span?{gridColumn:"1/-1"}:{}}><label style={LBL}>{label}</label>{children}</div>;}
function Toast({msg,type}){const ok=type!=="err";return <div style={{position:"fixed",bottom:24,right:24,zIndex:9999,padding:"12px 20px",borderRadius:12,fontSize:13,fontWeight:600,background:ok?"rgba(52,211,153,0.15)":"rgba(239,68,68,0.15)",border:`1px solid ${ok?"rgba(52,211,153,0.4)":"rgba(239,68,68,0.4)"}`,color:ok?"#34d399":"#f87171",animation:"slideUp 0.2s ease",backdropFilter:"blur(12px)",boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>{ok?"✅ ":"⚠️ "}{msg}</div>;}

function DW({onClose,title,width=580,children}){
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(6px)"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:NL,border:"1px solid rgba(201,150,58,0.25)",borderRadius:18,width:"100%",maxWidth:width,maxHeight:"92vh",display:"flex",flexDirection:"column",animation:"fadeUp 0.22s ease",boxShadow:"0 40px 100px rgba(0,0,0,0.7)"}}>
      <div style={{padding:"16px 22px",borderBottom:`1px solid ${BR}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <h3 style={{margin:0,fontSize:15,fontWeight:800,color:W}}>{title}</h3>
        <button onClick={onClose} style={{...B.ghost,padding:"4px 10px",fontSize:16}}> ✕</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"18px 22px"}}>{children}</div>
    </div>
  </div>;
}

function GS(){return <style>{`
  *{box-sizing:border-box}body,html{margin:0;padding:0}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
  ::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:rgba(255,255,255,0.02)}::-webkit-scrollbar-thumb{background:rgba(201,150,58,0.3);border-radius:4px}
  select option{background:#111E38;color:#F0F4FF}
  .rh:hover{background:rgba(255,255,255,0.025)!important}
  .bh:hover{opacity:0.82!important;transform:translateY(-1px)}
  input:focus,select:focus,textarea:focus{border-color:${G}!important;outline:none}
  textarea{resize:vertical}
  .drop-z-active{border-color:${G}!important;background:rgba(201,150,58,0.06)!important}
`}</style>;}

/* ════════════════════════════════════════════════════════════════
   LOGIN  — Professional two-panel design
════════════════════════════════════════════════════════════════ */
// HR On Demand logo — vector SVG rebuilt at full quality, embedded as
// base64 data URI so no external file dependency is needed.
const HR_LOGO="data:image/webp;base64,UklGRrIoAABXRUJQVlA4IKYoAABQlACdASoIAlsBPikUiUMhoSERC+xsGAKEsbd+K66MYJcxBe/t//0jRr8PjuvQ/2v8nNyP6d+IX9S/ZX0GMbnMfud/WP+9/ltdV88LyD8j/tH9d/aT+2////u/KP+e/jh+//2I/FH9v9wL9Hf61/YP8z/nf7T//P+Z9KX+0/wHuF/Zv+x+wD+N/zX/Gf3f9wP33+3X+w/2v/Fe4r9bv8J7gH8y/nn3i/v/4iXoA/zP+0/ez8sP+I/6n+K/fb6Gv2E/6H+d/e/6CP5X/Tf9n+dH7//YB6AH7/+6b/AP3591fwT9Svxo+O/l39o7i/zX9l/Jv+z+kt7X+pvMz+P/Y/8h/YP3C/vH7Y/Lf+o8FfiH/U+oF+J/xz+0/lZ/gv3I+i+DJyyoA/Kf5r/hf7h+4/9w9O7Us8Gf6L3Af6B/b/9V4wHitUAP55/a/+n/jfda/kf+x/bP9H+7Xto/K/7t/z/8h/nvkL/kX9T/2v98/zH/r/0H/////3Oexv9S//17pn7Lf/MQ6SpYLGPBCv+Qcn0L5BU54SJHUefXwwYmXp/4ay152x+ggux/50l153BQ+LmwP/MLxR+qx/QW3ztQXcng0AHT7iCthtgXWFSCzgrKPLgOHmrUdsvnWHakxnAALxFwZXxo3Ulc3y9WfqrzvOx3psqYK6DPDFYhP7D3zni8tTH/rAXqzGjUtdvBAONFgElGPvA3YoUS0YCSbapcohsUp17E379W2sFaghjLuJAAZ2DjSXZcDF3EDLzQ3b+1s2Pzm0XmUr/nNdgFc+T6pxjwnYMqOVOnRfb7S0p7GVNIkt5T0mmoIMMMYgji9XokyRnKd7vgZjMSILPf71uHeYvPsnqp5Odv4yTzU3LA2JljX448e+v7oKV0gVfPd01Ck5eZH00/u8RDY4WK+YWjqOREJHr7Q+JmAbqoILqkEKw/OLhhfnkOBFoHbQW7e0ereQT52W13Msiz+FMVLkCcOIPlZkeooGNBmy0n3bxGPOVH58a+93LMX3uD/ow0Vf5ggC+jbtRa4irkL35VE+uJcO/+GJQ+JBk7JMlrUplZWw1v0En9wmn4guOFsRMHMjxMy/DzF0vDPff72sOAoNiAZ4z/VkQ/l9v4C98sScZ0ssv8YMFoUpdCzrvJsD887fL9ZCe/chfIFmf2ZEDN72yOGIdszCIiNipoOZ2+6FPodV58fJtDEN4c/UBhnsqFggrkeWwzieDTsuiZuG0QJU7XPO1BCxrTCoKgAH3dfX54NsC1Eg5mn/u1xo9amTqAEhqXVhUfnnakze9tZqCzpHVO1yD9AzpkXlO+y2rrrkvucIl17Qu2jS0pWpyfQASudxCWIcswZSV2tDXC2gpGTYdfZz7amHnS5NM2tOmTiibb8SrgajxOl4v1L8AFzioRWPzztQW5eOs9vQ1sajepreH30HMaadTmeCXTyPemx+gu1uL/9fH2OM4r3XikvKR+C6wtsFYdwZsMVlR+efdtnX6wqQYTTs8Lktqb6qmQguscgyelC8UfvnSQFmiMaq8VNlhC+Ndw0H4LrC52b2Z9ZKIjvnEIGrSBb2P1djtraj8+NAI8vPAgDha5ceoPc1AAAP75L25Bb7OYcn8eulOkywYI+Rw9MKCU1TV1aizyq78Muy3P7lTNGcq+WWl12YcYj7dMGTuaMjpRg89CkvGZ0OPxf2SFy0grGVVp7Yt1DPWs3gCFjxL9s9ulnoYeOG4l+NALplJVAMIAsIbzxXSfLNl9ahilEOqp91EiqDVJUzLRwTwUaoGaFKCcJrxrJJ8l8ZRu0Gc80VNgBr6z3K0YLwq8qNf11tYdGXWNI3N5gbtR6lO0Dj0ThlfUMe7fFQXKK3pSpNy4tyAWRGeawVEGkbpgfQzWekmwr4/ZGqgXSbPt3MHzxqc0Z00iQVJJs+7IckoazWQXuZrrn3cjMaosqL09/t1wVsQOWFEhjaRzQVWPumqbr0m/OCw+20GaRLoy4HTdqyWxdn2AclMQ+HKZDu5ZJCdpYH3Hzmalz3eXmiKlwurPJGg83Az4RWWfwCLC9mTh05M0bz8XOP9RdQzmlcvuTbhnDEI0ckt/7DcyDV5Shilwb9JxNc8RfT9BA2H6z6cG+KPsW+YaNx4e+u2cVvB1w6+G6ro7uV/Mung1Bs8XJtPiQ64ziR0I1rKjyjxoZ9OTKeF3DkAeGA1pOEPW1TRV8VTRQLK1eyEnsnDMhLgHyWRBfRBjbKChwDjUSbbjb6JIVrng3c2efMKZ+C5b0SRvFwrH9gPDZOvkwWIG3dpWu0q4uzU6maYqqKLfC34ZyfacoJ3+HjO64ELl6Y2LxNouvgszzFP+fVbpmUsMwUt+A3+zDNEigzrXcCglkkzpqDXViaSBgfik4bhtrMFRZcED9zRlHqk2uaMpQy/k7k0uXVC4XyNce8RHYp5nZOB9CkOttJD1eRF8RtvtXCiea9rsaHtAEck8DVNLPtrnAuZ8VD8r+ub0zxtQ/ZfjvQa4RTzg/DO01/rR1oM4/+rEk3qaabjnGs5fePADPXuF7VJnMmvsnbBKAkpXhLYuqFpJyDvNWr2nDap//I3EkVoscjQ7anHpauOQHZufdCDnB/Mx7+1gY7kMHar/0grp4FuM2NrX7XiFLkisI0tY6I3pOvq83xTaXZv0o6h03hrGdU+ys+3eGd9DGoSe8MDZijDbiTSgT874EaSPNDLs5/n/k5jpyjQEFZXOG27x45e9nbbsM9UZNilZTMEa5eqlWBtsa71YWQq3uKmm9HNYgG8S2inpba7iNVoHoK0h575qjhyCxq14Q80ZFTL2aAKOztOafPZVJ0SEzgzeI584uexuze06NQKqsETp4/h5vkVylDBEIjy9brnKnrGJ0Kd7xr3D8SVr8w0QwGFn9fgersXrhPrhMy7/kk2AfiffHZEDOJLxRyYPyxQdWlMnYMwazfnMJtEhrrHjpfQblWZ1vqxJVpZ1D+sJBjsyMcsI5S4oWqn1+PamVMAFOOPdHeSrrMnkR0Rsl9buS5CZbSx89BXe47tQdr04ukVMBvLr31af/3Q8DFP3oEBcpwuBGghzbquXRZdL4IwLOlnCNxuhdKJGHX7K+0Kq6CVYuOnfXuZZXX4XytrpAVaf2aBV2CWqHcP1xlZ//rKBe4ZJsnmpDFcqEXYqFR43jt1kjeka/zd/9fR/sTY9BhW4IXgBbGjsSfe9rWH/8ijVnZBkr5phXSgaA5prqAY1a0p+EMr5bjgc9jM3AJKfPG5FxL8zX/KoFG3kyxW8OX4LKegH/uzorYmzceV/7ah1UDsVMG7H8/c4tk/5x91gBpbEgKmX0axaqrHF4ADfChzmvOyUXHy2oMGkQZe9ME9JHXqEPdt/k5nHoBYJDCMCyjZBl72ls+niOAP0+vyDjON7hfy3wy+jkx8ey8LdyKD2PjJd9HjI2yTLOwWAbmFLscQLVnspbO6McUFCVdePS0gS3nUC+JNlOS+l3pvEesSZhI1MvqoqMzdqkvz76rui2mXCeMNWyD6yeKhIkaruArhOue0FJ3x6bRqfrIqFr9e+f7IDGFt4QZn2kNYRpkc8Zi+W9L7i8n+kgoNwEjfyL0EbkkXWdknLwml2G5KjvL4T1Yjlas6mdl6n6aaWg4XcE7jTohvStub8QBv8XLX6Jh7dbIB3xOZfUgGaWJS+B5yzcWmXCjywVm0A40pBb9QbpaUBuwLM/IfiI8wM4BqB58wV4t++pHlJ6zemp5JFr8dwZ9gH/wkvo2upRUqft7GND+ACyY4UqSQxN/koExD62OuaCXNUXPjvO6YyQkipD52+9OAfoLfS8Jw02Azyr9qTdb/m4Gzsr8kXtKcltuHYybecMZuA25SGRIbL09ACR6KVS1QOZ/Bna2uQShLYNdIPGgLBDghwU1yi+aFWn5f1NLZako+RqHPBIkbtIy5CJ4Svihuz8vCgBJ4HlZzbgEm2cW2Pz1PQXphuaKL3iobe7ymEOzZbelp+oiMlMyF4obp0MnmgLPH2LkHcDKzR9J/9qb8lBIlBrGio2mw/79MV/fFCAt2VrXLbPImccq2cQ/EEvhNNg0Mi5lvZwyxQsaxAoojR5/pbG/f7F2iefnsjDvPasxecZ8fyu9cRnw5zpqH0+sSYJpMniAPIkP6y8MQZYYGX7/DKv7cDXx5rTc1CHmrgBjH4x/sq1dO9O4UuQs6sZB9WNrQAFqTDeXiwRcVv1fB0/ymuQy6bpezpW5DhlBYYw5fdm2Ec5v5E/2afZ6o3O7gPGfSMDurXq85BGXXFVK2yIvYE9aA27oYzO0Y/rq9pWPi2BC1yCwjbj7cJ+l3jy77Mim5NUBH1WjHawMc7vBe1PpFVyIXFooq7t87DQetQsdNZFJIksOnYPvU6pJk2GPpaeiu5jxMxwkNqKwIEbn8JzVoKIW7WVH1JQFD98MnKN568wH+z5T5duE4vwFDyJzNrxMz+X3FrbhL2LiAnd0/Eyu9bUXITR2j4woRZMY8D9DNTS+dvN545U5vM5ceusrJeo629COzWEX4uN2r2j2DJSC1+iiVBbMUd5qfmVoEYOpLRxjY9eIBRe8nmhTKHDlf2KS0wPCpAE9+Y06MVqa6d7nh2uv/nphBojvTlPqnJorI/NSL5FJtAbICLGkgE8k/sI4b8vEjDjzcvymn0oaBmKbZW+bgBFdSEln7hEAecI7VphvnV1FpwSZAXUYizHv2edeA+njPbtOdgogVCe+Ixdq+VYoVgyJTtfHrY/AEyJRhcrQfgQFh9Xjijebz3955H10VNhlXm/Aa0AaMymbq3vN9WJMfZPGRZ0SGrN6as0XuE3Zf7iGUJwlCMdazA+fnzaznQL/aQNnwA/auc9t+uavsoHNa/MOlC5nFkY+DSJSltlrUQH2ABfzIwuAYU7fgiiBs01ic4G4xcw0GaZXbK9pbqKv07evBgJkWQD8+Zn/lzP3H3Za7hHPVf7L89gczWDU70erj4HbACvFJibx/UsjTN5fR8UX9QeVTrF8EqqLjsjxtNtvxIwu30Gq2c1HpeMObRNCo8+PQyapMEwAPfcYh8Bw2gX1+HtDUijXOAaxD5Dzy7fchfmVfE2zW1jN3+iIFMGShCZuSx3pDYlLtJOjzux8kjE+v2aR3FxMtdWVqNGxQ5I6CVkCXM1sUOBfUenXq+KQtKdtN8osxiMfq+ljU/OS2K9I5LgQSwEAiw1yiKG4uBWkEfTWdHqgSlqylUByPFQRyXdMcMznNGg7vz2Jezj0vX/GsAk9gIPbjECnGXDdGgHi5rCpM0O0SdN6CkX+IejRubLB1KoSSVrQNIOXeB9cTdWOnBuitP/PqxF4eom+C2qXISXbL8S093ORbCa7ZxD1vIN9wdiBUNldmkuzIX9LefLIl1ZK+uE63qry2uAGKfWbHs1RjSQDwW0V8Bh7PMwW0uiZxoBRe67StTuvSUq+Z43tJMEXHLMhYGa7ZDjS5iWzM2hxWEJyjdbQCj//b7b44wKf0eZXKy3sWJoz1W20UTIMRCKAbHl/bej/9LwHWqEkBCapzxERcsBbp5EIK1O8tEfgln4YvCve4aYMqsaUJ6GKs7VJGY3RAk8dgZ5h0WRsB0QQ/3b9IbYmV7hy4ea9OVZ9oof0AeQqUnv2x4AaoUeLRYyNYa3zflNMVDKRLYKoBX9/p/vMWdrqL7s/ajB2jO5xRIMRCgj/oxqeNLXZ6f/sY+mFjvB1PuO3bgAZyvdz90Obs6pqntHXRIFQgV3p54eUDPXzhKUuHrgiek5R9xzmECu7GQfdzUr53n6yJOxq1rYAMN/O/jAgltn4Sw8Khz/foYNFaTdB4xU0fzH4pU5Gz/5MAxe/cRu7uDjG9+vM4iL+qH/wpprff8SdNc1pITXP4fpZ/3p7KrLTQ5z4XD5HGNRbvHJVTLb7ZtmQEpHQixM2WNsAh8uuetnP2XFSdP16fhbk7d/TUcLWtCuc5W8IXkFi7r2N0lKhSuqG84FIs3NXi8yZ+jXMN4mZJKjJaVWWUsHFryNwMElNuTxelRuKMPT4uSZPV77PwsHgLD/4TxqxiCUDvdANO+aMcyKHwIMTdS646MxbI4gcwdMIHBq0WfraQURIm26LKUc1Hp4LBagBBXP++XJDxtGqiGBeGzXpmJigeu/ll0nVnvsJnH7P1oZmsRXHEC2sh/j7rfR2qBMwISSsRKTGoP69xo/vZ4hVK4qkY9MLEPbTQGDpgari0f/H8jXqv+/AjtR+CXZxyTJwtgIIhnjmEv16gNOhb+OwcWXOMhqZcJ2DLEag2lItebdAUqyxmzsUZEL2yQRlXsplWJmf0TKMmU4nkkuCmpOvJ/+J+H8mJ44XpJAqrxEyN5Zrrhexaz+GEWNlVqIUwB/AZ8BCWeDTcB+DJTlkkFGMhIV9maq/0n7GV3lG3PO6G3Xz3/Jof5PZCVgaZti4y9PLqaH028GHmHMyJx6hHIiEgjEfqYOyR1KwvwLGIEb/SY2sH9w7bM7o6si8vUnKhfSeIJKXZmruOWPLKlhvVawaH7SroczwdErkpvynkPxqPXCxXn3tquHILqVoxGSKOhIGzze6YxZLRMQwKQo7YE+T71IO7Kjyy36CgoASTOAvj8DHGpTHhq5roiJMx7iKqtCmxiQTcPIxXNPVOgJLvBQJD3begbYFs/Itt1sywOD0h2N/XFrRkZ3YRGV87NMtzyiz6pS3JrTRIgSbqfplYiyrg1jIehI4CzwgYoAR2CaqFqfIL/AE2s5/ZoNbtKKGVQZ7a7TQYvA2y26UzuBqqflvZjQPLh8e9m3xZG4vZzgLTKi2vjX1jrYrjlkk4GxJFqDF7czwszpkQsZb9HA/B+OaiuZ7GTwRugNmkiNxBM+4VnVkTrAxF/TU/MwNECxl/wYS2m03y2f2qFLSN0jPcEOzmbQvErD05/YCMIwvuRiSTGfjyeygQP1i8ej4nst6rlOWdaU9stg09uK8vcNbFcT8GhzxzfOMvb+zzqN8bDWg1IZUId6SU3Blt1YJH6qa4HvYlIosJcc4uapWryb3cJu9gbGJA6drbRh3zW39mEcbyHB5ZB2H5VQtBz8+5LQINbXYc0k8Z8VUPARHS0+/QRDWUiDay6WORbr4MiFfrioxSnHP6dPfjvNFOLtpN1Kiuq2eKN/ymtPl/Gvr2pH2C87/NTlhZLP2oU+KiHp+jLYb+nEhsE8FaUnGgaGQWZ2wd9rT5MJX7ou5ZEHAlz6Ejy8uu51WUdbUTjdQjbCByMlpS3q/42xBTw/vvT7MG9EVrmSHWup3FIWpZ79lctUqP6KL7YtLllGT5brCypuFqSpOYXttTPbcyhC7tT7xrj0qjr3OyVT+cjHQZXo5sys5fMwE6wwfg5WiLsrOREinlXdU/gRkXga8znVmausj6ZfR/qZdmcz1P50lmzhFssVzg+UJhoMUyywgvD2ctKrRYujKFckXnVLnMaPLPKir+NcmRXhy/XnmC9HUSN1bNJie+phQHaGxx8P65jT52u8Rb5vLNs7TqbHNl3yhn/0VxlE1dXiciWruy2phvG9e89DXuFzKWWk1rVItO3iW0RpZ8r4Ecyan6FOQBs0nx9ST6YtChBPZwvosrdTuCt3Rgr03G15XKtCwwLreDshHyRONe9Z0cMO+128C+7URNxCJHdj+1T2DqkOncA6TgIsB6A5Hh92oys8zlGwLXMEjychLgolJ4MBfl7j8g2e/JAN1iG9QWFndSKjpUL4cohC7+68MSTM7yPdA4CAfJgYus6qrpOkU2KHMnLv+HT2ROo76rXLkk3gy/t4gyw8U+Ix7NLHcrw5iREOCbt4D5NagxRNofjesNRqyT/Q7kNglnN4PfOg3Eal1dpkbQekMB7BBrl5J3erHhaDqkMYfq+dsJcYFyes3lTjto3foVbjsY8WiHh+sCLzmSMCwRpDsQgd1Igf1EnTrLE2w7WQUvr/QOOkDFOdiYwsFODNQgRWW6K17YxtvJ1uWXpGWvM7lseq/2h9C7O0Qwox1vepDul/YlTccrBTbsg3n3LSQU8GVUbuRw0QQ4loZUPUtXTynOp3phZ9PI9JRhsfu6OdzGf/j39Ob83tq2defOWkTmRSIVPmPXBeE6ofvZOfuZL61GLF5mjNgEqPUmEX9+dF7/ZB7PZs63tBlkrF87kw5xpWMcIsxRUJ7kJlDrBGKcZDY13JTBW/JAzU0gKg7AyH/mUz41OF0/m0/r00yHiNVYqd6WwJG7G5kRbIFOIhVzYynsvv5OKZemTty9QahOl1FxCR9Ri6nktZvZ5e09rG8kzdgZBoFT24tpviWu3MwuzitMUbVBMRE6cS9iGcaOSRUYzmJCUwWemcFZ3qtwYiErVS3u17+Cz3vC8zm0YaDjNa5/+Mwlx4obOl2efpsxs0IA8sj680kIz/z8OGaHEJ5gWVgVBpECZgO7wJBot4zZ1uG2UO7q0pyD65HKOwycQrAsPJmSgEf9iUmiFIghpEJOOpijjOdEDier1aJwDR7e5eZdXhJ55uCezqIATHXH9WS/JlhDdKBVdyoTTQEFjFOHMCwIF8cTGe0R2KvCsxA7EAXVzCXDFQ5tw4FW7k6MzMT/BEn8iaA+eyJJa6ceFy+bUybsAoL1o7vy2KMw/VtoolXMqReWaHKHAmmb8tMjHjXX14Yzhq0rXOwGUPRlg9WelB85A08IM6MElFY2aW43E7TnDwc25cQ5mHj2LB+kc5MLBcuYocmMGHyUyFa76A2+r+LK9n3dLCCfrK28bBUA5wxxX0IDdZtbP7EKXOdVo2GUXCWjaU1wAYl6gDSZBnbWDR13gxa3VyemBMjocJ4irFhr3vGgQ7FdcMfv3q5h29VlMO9yQhIH/xtAEDutX2nYdoZWahKTY+xqPmcoYWXY+fFrL1dn7CjsUNRSwJBq8ID8XCdYtLAzdwXv1XoNP77xZhqd0009N7LSkZizxzDOrl7YIPHxN8K4oy0zhrmi6zCJ9wfzAaH8OqM8MYsTGova5CRoO4tqB7eL1EWnMWcxH1NE8Qj+kkgtS4BTBU0YxcGubog6VIKnlT6uLIBeJQVleElSUbfe3IbPA/gXBCYfBhznLah8aco1Ccp9IYa7IapvIyyG0T2O9tl4VKNSJWnfJxKGftu8nOGWvkj1Q2YjFEb5U0t/0/lB0IuWP5iMH/svvwmB+lnvtBJ6XX0d341kdYP6mqIiQKbNFkzTmfNjBT35si3WgAlNkqQiDVyNmJbGKsE4eD3TtnEXhYg9Jni66MW+KnRZKDv0Yv2KWltzFDXQjGr4FKFeARs93t7DZiHFt1cMr3f53Sa5rNzzxjP/EXjOMqGBqCsO18fyh4bW/3C+KHT3S3MI6Qig/jKIp/3uQLEv+wdv1hXeE138IBfAUxfv19SYGzpK8zW5ZiP0bs6yGX/AGqnlBZYnaJ/GL1FpDuExLQbh6Fl8bBVsGTQ39TW3SHIiD51T2gIbSwPC2fQE6BsoYZq1w2scznB7iqDBfjQeHNJZbWwxn/0MHGXzVF/FCP89OUIl7ajgsVC4OR69c8cm4af5X/DHNsnUkPVn7pLzF8mi+NQZvjdg2/WJsiDKmwDBnlbtP+EHK7sVwLZIy2dp5ZJp/ML/tWH77JmkAKWTq/t3IsII4hnM4f+6OtaERSHN0niK3dikYv8Hgdj3pa3PuiWwxxCf2QAA8FfdWakzFAWV5R+UTZHNDcD2SAhoNuncavcXdvqHMXXnJ6HNLnqaaHe8ZedGjXDwoX0ndry46RGAPwTATRfS9kdcWvHN9zCFWtsuloH201iKhnlN/8FntChpwQ9YgJrM2EBXgfiUsoxH7TGR3A/1bhjWLWC9qY2ypLdT4NJsFy7OJC5dZxZY87fDUvAIF7t5IqesQ4A9f+z2MEG0tJt9LBF+t3vPuekBXIa2lAmRVQ45mLsqmm3xAtnmzTCOtwlWPShKhaVXXtBZGpUY5jGspNjIivwhMMinf8Z2jECcXF4zUG9+T0nmiYfpdB2+sU2Oe1drAsSSjgInI8gigziTEhj39KoxUGw3Wb+tmwqLZOmujys1TuFq2nEt6Eq/K3jA9e6Q7ojUeBRYElKBToRRkQnx4/u3Pl+qshagXlpWfw2x9BDOSEItgWxH29eZ2nEBLZm9ApXGdUS6cCAsQ6shqPS4Fq9z2YvZzSxLh8u7iMMxl9ii4qyLgQgO8TPPmMHcWQs/erC7xDkCH4bI8nh1jzYTsHwBvq/FoOfg6yjISbTJZRtr5guDxSvtOBLvR86ne1QXlNBu0v438H12L6tRmg2I/AxiOck0vzOnjWES7QH5Vayy0yeaqc0AKn+orzeV/d2+N+xkJaCviY+MT+AQt6Yzw5kSx3h1/0Uv12j56502X4qw0eYaXGerhePUFEu9QKzFRrnX4YNP7UPizMjTeCSaQNTg9wYSwM/VKixGy+LpE3auZUAPe2N51SNQv24v0bqnm2SdV59M2GwOT7Bjc/hB5gZY+sMq/bjPC6qYKrON0XBpLminffuKV4Nvsf8CxBpPTjT859L2f3aQS0b9qbjbQYgh7bd0JHm41BNkp7PxGHY1S5xw4iTewfDmP/s5p7ZGA8mZej4GUKgmpvQGgpOP0HajPpzKca2z65L+PBm6KEzqYEEFCX3qQFXr35m6Vc3W6nG8Iigobs5rTujgQKXCqglMDb8TK1fMzTMge4wa/vfGyz3XMyg6vMcXhtKjQQDPjbippbjWcRIGVK73eWZyBurNfr3ZMzh9DVO7Zjkx8LDMH5tzpH7ylaBCpYcJsghQOUak376LNNYZYs8+jQnyEx0J2C3MHxPEqFBxtbDMmm9j+c5yahXR8rigZXcVkHrlOEQAqyw7Fts30CAPveDz/xtgHC+2xW5ZTqgIJ4vaxChZllglzkhoLyzTrpH7RWZPAPBnj+IOnggksD5xowQNtmrObGAqf/Ge7chG631pM7uZ5INNP1y3hHXQGZTSZK+8i3Yp/BjZ2tXYNR7Y/F95Jr+sycKDp96wzY2NUjpzVTyYiH1/Q9abOWYqprcwDEOqMhmi8WYQ/geMnNk7d5Kk0DcTighOyYOAolPdrvb7dE2Q0suNJ2UW61tBNvrBA2doAAAp5bGLLHboEeeQgfs3lhnw8zniELdu9P8dgfp7EpIt2GqkbYZdAFPXADWpx87sPgNVx9J96fUAuKJ5cuWHItfpMYBjEbn8cBVWNw+Y334WYbhZFEsZa96nJEn7z+Gay/Q7tbMJ8OKusWtvAoMGiCBlKwKmCAMIQS+S0v7q/OWGq2aNZlKKdbRcVFpKNNGQ7o80YuV3ZNVIVpZ6l+nGkGCv91+JtrhhDM+NqqIVGNWOQMrdzdOUu/lXYyFPx+1YWs93x1Bpvp4gUa18eDiNhsQjx4sg/B/ZH8F0mOOuNWOn+YENk8PmvJbKyPchG2WVaqz2ZfpUhIIUohmMPELqgtS9ZnH6x8Fbei/+SwOBbpl8noU/T1wKIhKVOz6ckjCMpkiOJ7EHmKOk50xm/4QYsuYeM8SXNbkab+4JglqwZDU/HhPRBXrM7Qag+q7lmZnceG5be5tzvdKSAn69fRd6G5ZSySOtJC32Omnl08qbuNsnZ2eqn9B4weZr04kYxF7EQhgXN7WAb+Ql46Q7eZ65EDprQib4FVFUAUPJY/e3LCZpo7NveNByfE02jwmS9QA1Tdl5bvXCcWR76T2vEExHVBH9Ja1PDR/3qvyninXJwmKNNW/BRnuEy3U6jk0MtBfli8AiQlY2GaTqJTK4x1F3P8M+efmGlo6wsE+/UnzdwNSzGyUPLqqI9WJKe4MNv+e+NgykRtN4dux5KTIsKHht80GtAQhuzXWkt8b5Xe3ZJFvIrgD0mkzL3XM2MLpMDMP6xhApCQc7I+VnF5qjkZd3SRZQdTRoWuh8Z7dpkoPwdd/tPn6+4uTOrzkegy3OUF0Oh75z7I24RqURS/nonaLcdM9cZcHovO0LEkY4ec62LcsEGahCD75PO6On+FNIDj2i+EElpbmEVGMuSWLx3Z1CilXKxAD6k07FqNmsd+hpfRp8C5s8eZPiyE6Vl0bn5XjzMZw1xcsJHKtjidYYJ6pvKUJJC7sdr0/apJn8IUCNvZauXLAfk3K3LbOZ1LJMxLBzZUn7/YR8s3Bp8+nIteEWY8wvXwKlvueibGkBac8BGXxGqbontR9ObnMl27uLb46+s46lfecRZZq5UfF28+I8Fa/w4LSHgG0f8NNd99zB1vjpVO4WW9S4Sv2Yk7dlLhuvito6c4ZKWAMaUoZBYzwXiUN7qptRl7jXj/5GpiT7r5KzDlhe2N9rY1gZG4NureBQqqs0UKzf8O2YoASNj3V9lSZpzq1g/+lW544GVzrcMkrm4ROPDKvR5Z38SDO2AwH5ylSZB+GyENCKUOPx6tNsDqb24BX46t8NaYr5HYNOUfSEluJelQXEhOpV+5yPvBorUP0mp2RdPDn+OaJpNeTi15XJAHc7CUEvH3y8aMZ64oz+HkkXKJCW2LXEpzuCjGlzLYJK17UCCG5BgySae9OtqYYoyHgjZH8v56kf9Zr8LMcUmSJfI0jues3SR5eCi76wsdVSOCVyLjzevbNy4qDof4YuKOlPMKk3dtsOa7cu0pKVHP+UnHlns5oVUkIhoyRHrg0N/a5cC+ydFbf6s7o3cseXttxGOJbqWtGYVOk2+xtYe0oBF03nac4KXn7ukr3BB4X3C/T0xmzr8Vp9uQ/mYw33dqAGk/EX2oLYGf6yel9GccV7fRKC8edwEyL0S8H4M+nI/TjPihKdjnzXGOKHeLLmrce7B8ITr3Tcx7/i2MGOxwfodnYtZ7vbOXIZh1WDBy3pSyHqEtcCpazJyqTEf57hSXXerlfpFCHF78sr2s8LN29S15StOWEDFBBh2ggQaYyUhrlMMaWkUZqbCGA5dwHb0nOGldI2mrwyXXrGfKkASJ2qXl4hL5YG4iYlKaEZwEEjooOaUIsrREYV58nzF5CSk9FeDyCNsjJJjXIupaej1RbvjZlFz5+4UJ5J5PM5BrNjX+1JD+m+FT9KpkdWO1znwa+h4iNria2TqL+ESnDPqHo0ti/fyu127oM3Am3mP10ClZrX32Fff7vlxOJXxLJuhLVUqXHENj6Y5lO40vswuOFXXppz8XwGSbFdgJ94RxKx1Psp0zTkhBbveEx2r4ubI9+spjJTDOduQaraNwJebRGeK8uq9Wgb9gVdmAMkGwNdZqfLJ+hfp1RbnZEi7TUhSLnS+HuHwmONJHkkrkrwvxZDnncY9eryqeI3a0z/SAd3W+V+75VXGNp3G3cXFFGSYjkFo7YDQQxaA9XQyGuPHxDf392r7kSwiYjrm7aoqRzsv+kWGCQyLlk5KU08/5fGDDFl3WT+rH26CVDWAjBDY2f61mmQygcc11g9f+nMY+kZEvY1sH/PzxHNMqp40mtlSVdtDxGGuy0jCy8KwC6bg4eblip5WLQrqFB68RwqKH6oXIzYagwHXrZg+y5MgCxOVlKYp9YbHbCwE3ysx9M2XBP1yVViQoAnRoIVQAs/sBXj69osmHuA8SqIsGmm7cKwkPDBN7UnLW6JWk0u9qx5Yk9yyHibLLBZebNGdSs+KZDLOoHDKZ58vT0imPCPnTHIxBZ+07kcZcX9Fdhg93nQbhgd8TpflTaWQsovf7amp/cWDcpC2EJVNlAFtYkGeyFSVqW+IM4j32XTXGUURLQLVWgIVYtNfsGaqz20n52EeIRvxD9l5P+5Bhasc9OCzlFpjMLY9K+MYCb8OnhRsGhazTAVGnqT/1JKsoq0GYmLitclJ2MM8abgThhFgizD+3gqijBMTJlm9zBXOer4CkKUayz8VbpG66TBdfaiacGp/D4lrbCNkMz7BQut+VfXvfnT2rAAtxdQn2+PD89seah0TMaL6NXjnwMi/WFw2NlQInCAAAA==";

function LoginScreen({users,onLogin}){
  const [un,setUn]=useState("");const [pw,setPw]=useState("");const [show,setShow]=useState(false);
  const [loading,setLoading]=useState(false);const [gload,setGload]=useState(false);const [err,setErr]=useState("");

  const attempt=async(u,p)=>{
    const usr=(u||un).trim();const pass=p||pw;if(!usr||!pass)return;
    setErr("");setLoading(true);
    if(isConfigured){
      // Real authentication: Supabase verifies the password (salted, rate-limited).
      // On success the session listener in <App/> loads the profile + data.
      const {error}=await supabaseAuth.auth.signInWithPassword({email:usr,password:pass});
      if(error){setErr("Incorrect email or password.");setLoading(false);}
      return;
    }
    await new Promise(r=>setTimeout(r,420)); // small delay for UX feel (demo mode only)
    const candidate=users.find(x=>x.username.toLowerCase()===usr.toLowerCase());
    if(candidate){
      const ok=await verifyPassword(pass,candidate.password);
      if(ok&&candidate.active){onLogin(candidate);return;}
      if(ok&&!candidate.active){setErr("This account has been deactivated. Contact your administrator.");setLoading(false);return;}
    }
    setErr("Incorrect username or password.");
    setLoading(false);
  };

  const googleSign=async()=>{
    if (supabaseAuth) {
      // Real Google OAuth — redirects to Google's account chooser.
      // Requesting Gmail send/read scopes alongside basic profile so the
      // CRM can send emails and load the inbox via Gmail API after login.
      // access_type=offline + prompt=consent ensures we get a refresh token
      // and that provider_token is returned even on repeat sign-ins.
      setGload(true);
      const { error } = await supabaseAuth.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          scopes: "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });
      if (error) {
        console.error("[NC CRM] Google sign-in error:", error.message);
        alert("Google sign-in failed: " + error.message + "\n\nMake sure Google is enabled as a provider in Supabase → Authentication → Providers.");
        setGload(false);
      }
      // On success, the page redirects to Google then back — no further code runs here
    } else {
      // Demo mode fallback — no Supabase configured
      setGload(true);
      setTimeout(()=>{const u=users.find(x=>x.active);if(u)onLogin(u);else setGload(false);},900);
    }
  };

  return(
    <div style={{minHeight:"100vh",background:N,fontFamily:"'Segoe UI',system-ui,sans-serif",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden",padding:24}}>
      <GS/>
      {/* background glows */}
      <div style={{position:"absolute",inset:0,backgroundImage:"radial-gradient(circle at 30% 40%,rgba(201,150,58,0.07) 0%,transparent 55%),radial-gradient(circle at 75% 70%,rgba(96,165,250,0.05) 0%,transparent 45%)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${G},transparent)`,opacity:0.4}}/>

      <div style={{width:"100%",maxWidth:440,animation:"fadeUp 0.4s ease",position:"relative",zIndex:1}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:16}}>
            <img src={HR_LOGO} alt="HR on Demand" style={{
              height:110,width:"auto",objectFit:"contain",
              filter:"drop-shadow(0 8px 32px rgba(193,127,50,0.45))",
              borderRadius:10,
            }}/>
          </div>
          <h1 style={{margin:"0 0 6px",fontSize:26,fontWeight:900,color:W,letterSpacing:"-0.02em"}}>NC Compliance CRM</h1>
          <p style={{margin:0,fontSize:13,color:WM}}>HR On Demand · SMB & Nonprofit Outreach</p>
        </div>

        {/* Card */}
        <div style={{background:NL,border:"1px solid rgba(201,150,58,0.2)",borderRadius:20,padding:"28px 28px 24px",boxShadow:"0 32px 80px rgba(0,0,0,0.6)"}}>
          <div style={{marginBottom:22}}>
            <h2 style={{margin:"0 0 4px",fontSize:18,fontWeight:800,color:W}}>Welcome back</h2>
            <p style={{margin:0,fontSize:13,color:WM}}>Sign in to access your compliance workspace</p>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:16}}>
            <FG label={isConfigured?"Email":"Username"}>
              <input value={un} onChange={e=>{setUn(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&attempt()} placeholder={isConfigured?"you@company.com":"Enter your username"} style={inp()} autoFocus/>
            </FG>
            <FG label="Password">
              <div style={{position:"relative"}}>
                <input type={show?"text":"password"} value={pw} onChange={e=>{setPw(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&attempt()} placeholder="Enter your password" style={{...inp(),paddingRight:44}}/>
                <button type="button" onClick={()=>setShow(!show)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:WD,padding:4}}>{show?"🙈":"👁"}</button>
              </div>
            </FG>
          </div>

          {err&&<div style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:9,padding:"10px 14px",fontSize:12,color:"#f87171",marginBottom:14,display:"flex",gap:8,alignItems:"flex-start"}}>⚠️ <span>{err}</span></div>}

          <button onClick={()=>attempt()} disabled={loading||!un||!pw} className="bh" style={{...B.gold,width:"100%",padding:"13px",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8,opacity:(!un||!pw)?0.45:1,marginBottom:12}}>
            {loading?<><Spin s={16} c="#0B1426"/> Signing in…</>:"Sign In →"}
          </button>

          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{flex:1,height:1,background:BR}}/><span style={{fontSize:11,color:WD}}>OR</span><div style={{flex:1,height:1,background:BR}}/>
          </div>

          <button onClick={googleSign} disabled={gload} className="bh" style={{...B.ghost,width:"100%",padding:"12px",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
            {gload?<><Spin s={16}/> Connecting…</>:<><svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>Continue with Google</>}
          </button>
        </div>

        <p style={{textAlign:"center",marginTop:16,fontSize:11,color:WD}}>Version 4.0 · © 2026 HR On Demand · NC Compliance CRM</p>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   PROSPECT FINDER — AI-Powered Search Engine
════════════════════════════════════════════════════════════════ */
// Every source below returns REAL data — no simulated/demo results.
// Sources requiring an API key show a clear "requires key" state until
// configured in Admin → Plugins; sources that need no key are always
// LIVE. Coverage is intentionally scoped to what genuinely has a free,
// legitimate, accessible data source — no source pretends to search
// LinkedIn, ChatGPT, Gemini, or Charity Navigator, since none of those
// have an accessible API for this without a paid/approved integration.
const AI_SOURCES=[
  {id:"hunter",   label:"Hunter.io",        icon:"🎯", color:"#f59e0b", desc:"Real contacts + verified emails by company domain. Requires a free Hunter.io API key (Admin → Plugins)."},
  {id:"apollo",   label:"Apollo.io",        icon:"🚀", color:"#7c3aed", desc:"Real B2B contacts (name, title, company). Requires an Apollo.io API key + the apollo-search proxy deployed. Apollo's API doesn't include email/phone on this endpoint."},
  {id:"guidestar",label:"GuideStar",        icon:"🏛️", color:"#60a5fa", desc:"Real NC nonprofit data via ProPublica's free Nonprofit Explorer API (IRS Form 990 filings). No API key needed — always LIVE once the guidestar-search proxy is deployed."},
  {id:"nppes",    label:"NPI Registry",     icon:"🩺", color:"#34d399", desc:"Real NC healthcare organizations (clinics, home health agencies, group practices) via the federal CMS NPI Registry. No API key needed — always LIVE once the nppes-search proxy is deployed."},
  {id:"osm",      label:"Local Business Directory", icon:"🗺️", color:"#84cc16", desc:"Real local businesses (construction, manufacturing, childcare, general SMB) via OpenStreetMap's free, no-key Overpass API. Coverage varies by area — community-mapped data, not a complete census."},
];

/* ════════════════════════════════════════════════════════════════
   LIVE PROSPECT SEARCH — Hunter.io & Apollo.io
   ─────────────────────────────────────────────────────────────
   HUNTER.IO: Domain Search API supports CORS for browser requests,
   so this returns REAL data when sysSettings.hunterKey is set.
   Docs: https://hunter.io/api-documentation/v2#domain-search

   APOLLO.IO: Apollo's People/Organization Search API does NOT allow
   cross-origin browser requests (no CORS headers) — any direct fetch
   from this static site will fail with a network/CORS error, NOT an
   auth error, regardless of how valid the key is. Apollo is designed
   to be called from a server. apolloSearch() below still attempts the
   call (in case Apollo enables CORS in future, or if proxied later)
   but DETECTS the CORS failure and returns a clear explanatory error
   instead of silently falling back to mock data — so the UI can show
   the user exactly what's happening rather than pretending it worked.

   To get real Apollo results, the call would need to go through a
   server-side proxy (e.g. a Supabase Edge Function) that holds the
   API key and forwards the request — a larger infrastructure change.
════════════════════════════════════════════════════════════════ */

// NC city center coordinates — used to anchor the Overpass "around"
// radius search, and as a city-level map pin fallback for sources
// that don't return precise coordinates (Hunter, Apollo, GuideStar,
// NPI Registry all return a street address or city, not lat/lon).
// These are approximate downtown coordinates for each CRM market.
 // geographic center of NC, used when no market is selected

// Leaflet's default marker images reference relative file paths that
// break under Vite's bundler — this is the standard fix, pointing
// Leaflet at CDN-hosted copies of its own default icons instead.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Custom colored pin matching the CRM theme / source colors, built as
// a small inline SVG data URI — no extra image assets needed.
function makeColoredPin(color, selected){
  const size = selected ? 34 : 26;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size*1.3}" viewBox="0 0 24 31">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 19 12 19s12-10 12-19c0-6.6-5.4-12-12-12z" fill="${color}" stroke="${selected?"#F0F4FF":"#0B1426"}" stroke-width="${selected?2:1.5}"/>
    <circle cx="12" cy="12" r="4.5" fill="#0B1426"/>
  </svg>`;
  return new L.Icon({
    iconUrl: "data:image/svg+xml;base64," + btoa(svg),
    iconSize: [size, size*1.3],
    iconAnchor: [size/2, size*1.3],
    popupAnchor: [0, -size*1.1],
  });
}

// react-leaflet child component that auto-fits the map's viewport to
// contain every pinned result whenever the result set changes (e.g.
// after a new search). Falls back to centering on the selected/default
// NC location when there are no pins to fit yet.
function FitToPins({pinned, fallbackCenter}){
  const map = useMap();
  useEffect(()=>{
    if(pinned.length===0){
      map.setView(fallbackCenter, 7);
      return;
    }
    if(pinned.length===1){
      map.setView([pinned[0]._lat,pinned[0]._lon], 12);
      return;
    }
    const bounds = L.latLngBounds(pinned.map(r=>[r._lat,r._lon]));
    map.fitBounds(bounds, {padding:[30,30], maxZoom:13});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[pinned.map(r=>r._id).join(","), fallbackCenter[0], fallbackCenter[1]]);
  return null;
}


// Small deterministic offset (±~800m) so multiple city-level pins for
// the same market don't stack exactly on top of one another on the
// map. Deterministic (seeded by a string, not Math.random) so the
// same prospect always lands in the same spot across re-renders.
function jitterCoord([lat,lon], seed){
  let h=0; for(let i=0;i<seed.length;i++){h=(h*31+seed.charCodeAt(i))|0;}
  const dLat=((h%1000)/1000-0.5)*0.012;
  const dLon=(((h>>10)%1000)/1000-0.5)*0.012;
  return [lat+dLat, lon+dLon];
}
function cityFallbackCoord(market, seed){
  const base = market && NC_CITY_COORDS[market] ? NC_CITY_COORDS[market] : DEFAULT_NC_COORDS;
  return jitterCoord(base, seed||market||"x");
}

/* Fit scoring now lives in src/lib/scoring.js (explainable rubric; replaces the old data-completeness heuristic). */

// Convert a Hunter.io domain-search "email" entry into a CRM prospect shape
function hunterEmailToProspect(domainData, emailEntry, vertical, market){
  const company = domainData.organization || domainData.domain || "Unknown Company";
  const name = [emailEntry.first_name, emailEntry.last_name].filter(Boolean).join(" ") || "Unknown Contact";
  const title = emailEntry.position || "";
  return {
    companyName: company,
    contactName: name,
    title,
    emailPhone: emailEntry.value || "",
    cityMarket: market || "",
    market: market || "",
    sourceUrl: domainData.domain ? `https://${domainData.domain}` : "",
    sourceType: "Hunter.io",
    verificationNotes: emailEntry.verification?.status
      ? `Hunter.io verification: ${emailEntry.verification.status}`
      : "Found via Hunter.io domain search",
    whyFit: `Found via Hunter.io for domain ${domainData.domain || "unknown"}${title?`. Role: ${title}.`:""}`,
    vertical: vertical || "",
    hrPersonListed: /hr|human resources|people|talent/i.test(title) ? "Yes" : "No",
    hrPeopleContact: "",
    orgSize: "",
    leadPainPoint: "",
    priorityScore: emailEntry.confidence ? String(Math.max(1, Math.min(10, Math.round(emailEntry.confidence/10)))) : "",
    // Hunter doesn't return coordinates — city-level fallback only.
    _lat: cityFallbackCoord(market, company)[0], _lon: cityFallbackCoord(market, company)[1], _geoPrecise: false,
  };
}

// Real Hunter.io domain search. Requires either a company domain (derived
// from the query) or falls back to Hunter's general "Discover" isn\'t
// available on free plans, so we ask the user to search by domain/company
// name and Hunter resolves it via the domain-search endpoint using a
// best-guess .com domain if the query doesn't look like a domain already.
async function hunterSearch(query, apiKey, vertical, market, log){
  if(!apiKey) return {ok:false, reason:"no_key", results:[]};
  if(!query.trim()) return {ok:false, reason:"no_query", results:[]};

  // Guess a domain from the query: if it already looks like a domain, use it;
  // otherwise strip spaces/punctuation and try "<slug>.com" as a best guess.
  const looksLikeDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(query.trim());
  const domain = looksLikeDomain
    ? query.trim().toLowerCase()
    : query.trim().toLowerCase().replace(/[^a-z0-9]+/g,"") + ".com";

  try{
    // Server-side proxy: the Hunter key never reaches the browser.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/hunter-search`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ domain, limit: 10 }),
    });
    const data = await res.json().catch(()=>({}));

    if(!res.ok){
      const msg = data?.error || data?.errors?.[0]?.details || data?.errors?.[0]?.id || `HTTP ${res.status}`;
      log?.(`Hunter.io: ${msg}`);
      return {ok:false, reason:"api_error", status:res.status, message:msg, results:[]};
    }

    const emails = data?.data?.emails || [];
    if(emails.length===0){
      log?.(`Hunter.io: No contacts found for domain "${domain}" — try a more specific company name or exact domain.`);
      return {ok:true, results:[], domainTried:domain};
    }

    const results = emails.map(e => hunterEmailToProspect(data.data, e, vertical, market));
    log?.(`Hunter.io: Found ${results.length} contact(s) for ${domain}`);
    return {ok:true, results, domainTried:domain};
  }catch(e){
    log?.(`Hunter.io: Network error — ${e.message}`);
    return {ok:false, reason:"network_error", message:e.message, results:[]};
  }
}

// Apollo.io People Search — routed through a Supabase Edge Function proxy
// (supabase/functions/apollo-search) because Apollo's API does not send
// CORS headers and blocks direct browser requests. The Edge Function runs
// server-side, calls Apollo, and returns the response with CORS headers
// so the browser can read it.
//
// If the Edge Function isn't deployed yet, this call fails with a 404 —
// in that case we report a clear "proxy not deployed" message rather than
// a generic error, with a pointer to SETUP_GUIDE.md for deployment steps.
async function apolloSearch(query, apiKey, vertical, market, log){
  if(!apiKey) return {ok:false, reason:"no_key", results:[]};
  if(!query.trim()) return {ok:false, reason:"no_query", results:[]};
  if(!isConfigured) return {ok:false, reason:"no_proxy", message:"Supabase not configured — Apollo proxy requires Supabase", results:[]};

  try{
    const res = await fetch(`${SUPABASE_URL}/functions/v1/apollo-search`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ query, page: 1, perPage: 10 }), // key is read server-side
    });

    if(res.status===404){
      log?.(`Apollo.io: Proxy function not deployed yet. See SETUP_GUIDE.md → "Deploying the Apollo proxy" to enable live Apollo results.`);
      return {ok:false, reason:"no_proxy", results:[]};
    }

    const data = await res.json().catch(()=>({}));

    if(!res.ok){
      const msg = data?.error || `HTTP ${res.status}`;
      log?.(`Apollo.io: ${msg}`);
      return {ok:false, reason:"api_error", status:res.status, message:msg, results:[]};
    }

    const people = data?.people || [];
    const results = people.map(p => {
      const hasEmail = !!p.email;
      return {
        companyName: p.organization?.name || p.organization_name || "Unknown Company",
        contactName: [p.first_name, p.last_name].filter(Boolean).join(" "),
        title: p.title || "",
        // Apollo's current People Search endpoint (api_search) does NOT
        // return email/phone — that requires a separate, credit-consuming
        // Enrichment call. Rather than show a misleadingly blank contact
        // field, flag it clearly so the user knows to look it up (e.g. via
        // Hunter.io for the same person/domain, or Apollo's Enrichment UI).
        emailPhone: p.email || p.phone_number || "",
        cityMarket: market || p.city || "",
        market: market || p.city || "",
        sourceUrl: p.linkedin_url || "",
        sourceType: "Apollo.io",
        verificationNotes: hasEmail
          ? "Found via Apollo.io people search (via proxy)"
          : "Found via Apollo.io — email/phone not included by this endpoint. Use Apollo Enrichment or search this contact's domain in Hunter.io to find their email.",
        whyFit: `Found via Apollo.io for "${query}". Title: ${p.title||"—"}.`,
        vertical: vertical || "",
        hrPersonListed: /hr|human resources|people|talent/i.test(p.title||"") ? "Yes" : "No",
        hrPeopleContact: "",
        orgSize: p.organization?.estimated_num_employees ? String(p.organization.estimated_num_employees) : "",
        leadPainPoint: "",
        priorityScore: "",
      };
    });
    const missingEmailCount = results.filter(r=>!r.emailPhone).length;
    log?.(`Apollo.io: Found ${results.length} contact(s) via proxy${missingEmailCount?` — ${missingEmailCount} missing email (Apollo's search endpoint doesn't include contact info; see notes on each result)`:""}`);
    return {ok:true, results};
  }catch(e){
    log?.(`Apollo.io: ${e.message}`);
    return {ok:false, reason:"network_error", message:e.message, results:[]};
  }
}

/* ════════════════════════════════════════════════════════════════
   PROPUBLICA NONPROFIT EXPLORER — real nonprofit data, NO API KEY
   ─────────────────────────────────────────────────────────────
   Free, public, GET-only JSON API covering 1.8M+ US tax-exempt
   organizations from IRS Form 990 filings. No registration or key
   required — this powers the "GuideStar" source with REAL results
   for nonprofit verticals (GuideStar itself requires a paid API;
   ProPublica's Nonprofit Explorer aggregates the same underlying
   IRS data and links to each org's GuideStar profile).
   Docs: https://projects.propublica.org/nonprofits/api
════════════════════════════════════════════════════════════════ */

// Map CRM verticals to ProPublica NTEE major-group codes (1-10) where
// a reasonable mapping exists. Verticals not listed search without an
// NTEE filter (still scoped to NC nonprofits via state[id]=NC).
const VERTICAL_TO_NTEE = {
  "Nonprofits & Associations": null,
  "Faith-Based Organizations": 8,
  "Human Services Nonprofits": 5,
  "Community Development Orgs": 5,
  "Religious & Faith-Based Nonprofits": 8,
  "Social Service Agencies": 5,
  "Arts & Cultural Nonprofits": 1,
  "Environmental Nonprofits": 3,
  "Advocacy Organizations": 7,
  "Foundations & Grantmakers": 7,
  "Education & Schools": 2,
};

function proPublicaOrgToProspect(org, vertical, market){
  const city = org.city ? org.city.replace(/\s+/g," ").trim() : "";
  const cityTitleCase = city ? city.split(" ").map(w=>w.charAt(0)+w.slice(1).toLowerCase()).join(" ") : "";
  return {
    companyName: org.name || "Unknown Organization",
    contactName: "",
    title: "",
    emailPhone: "",
    cityMarket: cityTitleCase || market || "",
    market: market || cityTitleCase || "",
    sourceUrl: org.guidestar_url || (org.ein ? `https://projects.propublica.org/nonprofits/organizations/${org.ein}` : ""),
    sourceType: "GuideStar (via ProPublica)",
    verificationNotes: `IRS-registered 501(c)(${org.subseccd||"3"}) nonprofit, EIN ${org.strein||org.ein||"—"}. Email/phone not in IRS data — find a contact via Hunter.io or the organization's website.`,
    whyFit: `Found via ProPublica Nonprofit Explorer (IRS Form 990 data) for "${vertical||"nonprofit"}" in ${cityTitleCase||market||"NC"}.`,
    vertical: vertical || "",
    hrPersonListed: "No",
    hrPeopleContact: "",
    orgSize: "",
    leadPainPoint: "",
    priorityScore: "",
    _ein: org.ein,
    // ProPublica doesn't return coordinates — fall back to the org's
    // own city if we recognize it, else the search market.
    _lat: cityFallbackCoord(NC_CITY_COORDS[cityTitleCase]?cityTitleCase:market, org.ein||org.name)[0],
    _lon: cityFallbackCoord(NC_CITY_COORDS[cityTitleCase]?cityTitleCase:market, org.ein||org.name)[1],
    _geoPrecise: false,
  };
}

/* ════════════════════════════════════════════════════════════════
   NPPES NPI REGISTRY — real healthcare/home-health org data, NO KEY
   ─────────────────────────────────────────────────────────────
   Free, public, no-auth API maintained by CMS (Centers for Medicare
   & Medicaid Services) covering 7M+ active healthcare provider
   records — including organizations (NPI-2: clinics, home health
   agencies, group practices), not just individual clinicians.
   Powers REAL results for "Healthcare Practices" and "Home Health /
   Homecare" verticals — a strong fit since this is exactly the kind
   of organization HR On Demand targets.
   Docs: https://npiregistry.cms.hhs.gov/api-page
════════════════════════════════════════════════════════════════ */

// Map CRM verticals to NUCC taxonomy description search terms (wildcard
// trailing * supported by the API after 2+ characters). Verticals not
// listed here aren't covered by NPPES (it's healthcare-provider data
// only) — runSearch() only routes matching verticals to this source.
const VERTICAL_TO_NPPES_TAXONOMY = {
  "Healthcare Practices": "",          // no taxonomy filter — broadest match across all practice types
  "Home Health / Homecare": "Home Health",
};

function nppesOrgToProspect(record, vertical, market){
  const org = record.basic?.organization_name || [record.basic?.first_name,record.basic?.last_name].filter(Boolean).join(" ") || "Unknown Provider";
  const loc = (record.addresses||[]).find(a=>a.address_purpose==="LOCATION") || record.addresses?.[0] || {};
  const cityTitleCase = loc.city ? loc.city.split(" ").map(w=>w.charAt(0)+(w.slice(1)||"").toLowerCase()).join(" ") : "";
  const phone = loc.telephone_number || "";
  const primaryTaxonomy = (record.taxonomies||[]).find(t=>t.primary) || record.taxonomies?.[0] || {};
  const authOfficial = record.basic?.authorized_official_first_name
    ? [record.basic.authorized_official_first_name, record.basic.authorized_official_last_name].filter(Boolean).join(" ")
    : "";
  return {
    companyName: org,
    contactName: authOfficial,
    title: authOfficial ? (record.basic?.authorized_official_title_or_position || "Authorized Official") : "",
    // NPPES provides a phone number (rare among our other sources!) but
    // never an email — be explicit about which one this is.
    emailPhone: phone || "",
    cityMarket: cityTitleCase || market || "",
    market: market || cityTitleCase || "",
    sourceUrl: `https://npiregistry.cms.hhs.gov/registry/provider-view/${record.number}`,
    sourceType: "NPI Registry (NPPES/CMS)",
    verificationNotes: `NPI ${record.number} — ${primaryTaxonomy.desc||"Healthcare provider"}.${phone?` Phone: ${phone}.`:" No phone on file."} Email not available via NPPES — try the organization's website or Hunter.io.`,
    whyFit: `Found via the federal NPI Registry (CMS) for "${vertical}" in ${cityTitleCase||market||"NC"}. Taxonomy: ${primaryTaxonomy.desc||"—"}.`,
    vertical: vertical || "",
    hrPersonListed: "No",
    hrPeopleContact: "",
    orgSize: "",
    leadPainPoint: "",
    priorityScore: "",
    _npi: record.number,
    // NPPES doesn't return coordinates in this response — fall back
    // to the provider's own city if recognized, else search market.
    _lat: cityFallbackCoord(NC_CITY_COORDS[cityTitleCase]?cityTitleCase:market, record.number)[0],
    _lon: cityFallbackCoord(NC_CITY_COORDS[cityTitleCase]?cityTitleCase:market, record.number)[1],
    _geoPrecise: false,
  };
}

// Search the NPPES NPI Registry — routed through a Supabase Edge
// Function proxy (supabase/functions/nppes-search) since this API's
// CORS support is unconfirmed/inconsistent. No API key involved.
// enumeration_type=NPI-2 restricts results to ORGANIZATIONS (clinics,
// agencies, group practices) rather than individual clinicians, since
// the CRM targets organizational HR compliance prospects.
async function nppesSearch(query, vertical, market, log){
  if(!isConfigured) return {ok:false, reason:"no_proxy", message:"Supabase not configured — NPI Registry proxy requires Supabase", results:[]};

  try{
    const taxonomy = VERTICAL_TO_NPPES_TAXONOMY[vertical];
    const orgName = query.trim() ? `${query.trim()}*` : null;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/nppes-search`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        organizationName: orgName,
        taxonomyDescription: taxonomy || null,
        state: "NC",
      }),
    });

    if(res.status===404){
      log?.(`NPI Registry (CMS): Proxy function not deployed yet. See SETUP_GUIDE.md → "Deploying the NPI Registry proxy" to enable live results.`);
      return {ok:false, reason:"no_proxy", results:[]};
    }

    const data = await res.json().catch(()=>({}));

    if(!res.ok){
      log?.(`NPI Registry (CMS): ${data?.error||`HTTP ${res.status}`}`);
      return {ok:false, reason:"api_error", status:res.status, message:data?.error, results:[]};
    }

    const records = (data?.results||[]).filter(r=>r.enumeration_type==="NPI-2"); // orgs only
    if(records.length===0){
      log?.(`NPI Registry (CMS): No NC ${vertical||"healthcare"} organizations found for "${query||"(any)"}" — try a broader org name or remove the keyword.`);
      return {ok:true, results:[]};
    }

    const results = records.slice(0,10).map(r => nppesOrgToProspect(r, vertical, market));
    log?.(`NPI Registry (CMS): Found ${data.result_count||records.length} NC organization(s) via proxy — showing ${results.length}`);
    return {ok:true, results};
  }catch(e){
    log?.(`NPI Registry (CMS): ${e.message}`);
    return {ok:false, reason:"network_error", message:e.message, results:[]};
  }
}

/* ════════════════════════════════════════════════════════════════
   OPENSTREETMAP / OVERPASS API — real local business data, NO KEY
   ─────────────────────────────────────────────────────────────
   Free, public, no-auth, no-billing API serving OpenStreetMap's
   community-maintained business/POI data — 10,000 requests/day per
   IP, no signup required. Fills the gap GuideStar (nonprofits) and
   NPI Registry (healthcare) don't cover: construction, manufacturing/
   logistics, childcare, and general SMB — exactly the verticals this
   CRM otherwise has no real source for.

   Coverage caveat, stated honestly: OSM data is community-contributed
   and coverage varies by area and category. Major/established
   businesses are usually well-tagged; small or newer businesses may
   be missing or have incomplete contact info. This is real data, not
   a complete census — treat sparse results as "OSM doesn't have this
   indexed yet," not as "no businesses exist."
   Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
════════════════════════════════════════════════════════════════ */

// Map CRM verticals to OSM tag queries. Each entry is a list of
// [key,value] tag pairs ORed together — e.g. Construction matches
// craft=electrician OR craft=plumber OR office=construction, etc.
const VERTICAL_TO_OSM_TAGS = {
  "Construction & Contractors": [["office","construction"],["craft","electrician"],["craft","plumber"],["craft","carpenter"],["craft","painter"],["craft","roofer"],["craft","hvac"]],
  "Light Manufacturing & Logistics": [["man_made","works"],["industrial","factory"],["building","warehouse"],["office","logistics"]],
  "Childcare & Licensed Group Homes": [["amenity","childcare"],["amenity","kindergarten"]],
  "Education & Schools": [["amenity","school"],["amenity","college"]],
};
// Fallback when the vertical has no specific mapping (or "All
// Verticals" is selected) — searches general small-business office/
// shop categories rather than returning nothing.
const OSM_FALLBACK_TAGS = [["office","company"],["office","yes"],["shop","yes"]];

function osmTagsToOverpassQuery(tags, lat, lon, radiusMeters){
  const clauses = tags.map(([k,v])=>`node["${k}"="${v}"](around:${radiusMeters},${lat},${lon});way["${k}"="${v}"](around:${radiusMeters},${lat},${lon});`).join("");
  return `[out:json][timeout:25];(${clauses});out center 20;`;
}

function osmElementToProspect(el, vertical, market){
  const tags = el.tags || {};
  const name = tags.name || tags["operator"] || "Unnamed business (OSM)";
  const addrParts = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const city = tags["addr:city"] || market || "";
  const phone = tags.phone || tags["contact:phone"] || "";
  const website = tags.website || tags["contact:website"] || "";
  const category = tags.craft || tags.office || tags.shop || tags.amenity || tags.man_made || tags.industrial || tags.building || "business";
  // OSM nodes have lat/lon directly; ways/relations return a "center"
  // point instead (we requested `out center` in the Overpass query).
  const lat = el.lat ?? el.center?.lat ?? null;
  const lon = el.lon ?? el.center?.lon ?? null;
  return {
    companyName: name,
    contactName: "",
    title: "",
    // OSM sometimes has a phone number but never an email — be explicit.
    emailPhone: phone || "",
    cityMarket: city,
    market: market || city,
    sourceUrl: website || (el.id ? `https://www.openstreetmap.org/${el.type}/${el.id}` : ""),
    sourceType: "OpenStreetMap (Overpass)",
    verificationNotes: `Community-mapped OSM data (category: ${category}).${addrParts?` Address: ${addrParts}, ${city}.`:""}${phone?` Phone: ${phone}.`:""} Email not available — check the website${website?"":" (not listed)"} or try Hunter.io for this domain.`,
    whyFit: `Found via OpenStreetMap for "${vertical||category}" near ${market||"NC"}.`,
    vertical: vertical || "",
    hrPersonListed: "No",
    hrPeopleContact: "",
    orgSize: "",
    leadPainPoint: "",
    priorityScore: "",
    // Real, precise coordinates from OSM — _geoPrecise marks this as
    // exact (vs. city-level fallback used by other sources).
    _lat: lat, _lon: lon, _geoPrecise: lat!=null&&lon!=null,
  };
}

// Search OpenStreetMap via the Overpass API — routed through a
// Supabase Edge Function proxy (supabase/functions/osm-search) since
// Overpass's CORS support is inconsistent across its public mirror
// servers. No API key involved on either hop; OSM data is fully open
// (ODbL license — attribution required, which the UI provides).
async function osmSearch(query, vertical, market, log){
  if(!isConfigured) return {ok:false, reason:"no_proxy", message:"Supabase not configured — OpenStreetMap proxy requires Supabase", results:[]};

  try{
    const [lat,lon] = market && NC_CITY_COORDS[market] ? NC_CITY_COORDS[market] : DEFAULT_NC_COORDS;
    const radius = market ? 15000 : 60000; // tighter radius for a specific city, wider for "All Markets"
    const tags = VERTICAL_TO_OSM_TAGS[vertical] || OSM_FALLBACK_TAGS;
    const overpassQL = osmTagsToOverpassQuery(tags, lat, lon, radius);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/osm-search`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ overpassQL }),
    });

    if(res.status===404){
      log?.(`OpenStreetMap: Proxy function not deployed yet. See SETUP_GUIDE.md → "Deploying the OpenStreetMap proxy" to enable live results.`);
      return {ok:false, reason:"no_proxy", results:[]};
    }

    const data = await res.json().catch(()=>({}));

    if(!res.ok){
      log?.(`OpenStreetMap: ${data?.error||`HTTP ${res.status}`}`);
      return {ok:false, reason:"api_error", status:res.status, message:data?.error, results:[]};
    }

    const elements = (data?.elements||[]).filter(el=>el.tags?.name); // skip unnamed nodes
    if(elements.length===0){
      log?.(`OpenStreetMap: No tagged businesses found near ${market||"NC"} for "${vertical||"this category"}" — OSM coverage varies by area; try a nearby city or a broader vertical.`);
      return {ok:true, results:[]};
    }

    // Apply free-text query as a simple name/category filter if provided
    const qL = query.trim().toLowerCase();
    const filtered = qL ? elements.filter(el=>(el.tags.name||"").toLowerCase().includes(qL)) : elements;
    const finalEls = (filtered.length>0?filtered:elements).slice(0,10);

    const results = finalEls.map(el => osmElementToProspect(el, vertical, market));
    log?.(`OpenStreetMap: Found ${elements.length} business(es) via proxy — showing ${results.length} (data © OpenStreetMap contributors, ODbL)`);
    return {ok:true, results};
  }catch(e){
    log?.(`OpenStreetMap: ${e.message}`);
    return {ok:false, reason:"network_error", message:e.message, results:[]};
  }
}

// Search ProPublica's Nonprofit Explorer — routed through a Supabase
// Edge Function proxy (supabase/functions/guidestar-search) because
// ProPublica's API does not send CORS headers and blocks direct
// browser requests. No API key is involved on either hop; the proxy
// exists solely to work around the browser CORS restriction.
//
// If the Edge Function isn't deployed yet, this call fails with a 404
// — in that case we report a clear "proxy not deployed" message
// rather than a generic error, with a pointer to SETUP_GUIDE.md.
async function guidestarSearch(query, vertical, market, log){
  const q = query.trim() || vertical || "nonprofit";
  if(!isConfigured) return {ok:false, reason:"no_proxy", message:"Supabase not configured — GuideStar proxy requires Supabase", results:[]};

  try{
    const nteeCode = VERTICAL_TO_NTEE[vertical] || null;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/guidestar-search`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ query: q, state: "NC", nteeCode }),
    });

    if(res.status===404){
      log?.(`GuideStar (ProPublica): Proxy function not deployed yet. See SETUP_GUIDE.md → "Deploying the GuideStar proxy" to enable live results.`);
      return {ok:false, reason:"no_proxy", results:[]};
    }

    const data = await res.json().catch(()=>({}));

    if(!res.ok){
      log?.(`GuideStar (ProPublica): ${data?.error||`HTTP ${res.status}`} — the API may be temporarily unavailable.`);
      return {ok:false, reason:"api_error", status:res.status, message:data?.error, results:[]};
    }

    const orgs = data?.organizations || [];

    if(orgs.length===0){
      log?.(`GuideStar (ProPublica): No NC nonprofits found for "${q}" — try a broader term (e.g. just the vertical name).`);
      return {ok:true, results:[]};
    }

    const results = orgs.slice(0,10).map(org => proPublicaOrgToProspect(org, vertical, market));
    log?.(`GuideStar (ProPublica): Found ${data.total_results||results.length} NC nonprofit(s) matching "${q}" via proxy — showing ${results.length}`);
    return {ok:true, results};
  }catch(e){
    log?.(`GuideStar (ProPublica): ${e.message}`);
    return {ok:false, reason: e instanceof TypeError ? "cors_blocked" : "network_error", message:e.message, results:[]};
  }
}

/* ════════════════════════════════════════════════════════════════
   NC CHAMBER OF COMMERCE DIRECTORY — manual-search reference, NOT
   an automated source.
   ─────────────────────────────────────────────────────────────
   Local chamber-of-commerce member directories are real, valuable
   prospect sources, but none offer a public API and most explicitly
   prohibit automated/scripted access in their terms of use (same
   restriction as the NC Secretary of State's business registry).
   Rather than scrape them — which would violate their terms — this
   is a curated list of direct links to each chamber's own member/
   business directory search page, for the VA to search manually.
   This is intentionally separate from AI_SOURCES/runSearch since it
   is not a "click search, get results" automated flow.
════════════════════════════════════════════════════════════════ */
const NC_CHAMBER_DIRECTORY = [
  {market:"Raleigh",       name:"Greater Raleigh Chamber of Commerce",        url:"https://www.raleighchamber.org/",                 directoryUrl:"https://web.raleighchamber.org/directory/", note:"1,800+ member firms — Wake County's largest business org"},
  {market:"Durham",        name:"Greater Durham Chamber of Commerce",         url:"https://durhamchamber.org/",                      directoryUrl:"https://durhamchamber.org/business-directory/"},
  {market:"Chapel Hill",   name:"Chapel Hill–Carrboro Chamber of Commerce",   url:"https://www.carolinachamber.org/",                directoryUrl:"https://www.carolinachamber.org/list/"},
  {market:"Cary",          name:"Cary Chamber of Commerce",                  url:"https://www.carychamber.com/",                    directoryUrl:"https://www.carychamber.com/list/"},
  {market:"Charlotte",     name:"Charlotte Regional Business Alliance",       url:"https://charlotteregion.com/",                    directoryUrl:"https://charlotteregion.com/membership-directory/"},
  {market:"Greensboro",    name:"Greensboro Chamber of Commerce",             url:"https://greensboro.org/",                         directoryUrl:"https://greensboro.org/member-directory/"},
  {market:"Winston-Salem", name:"Winston-Salem Chamber of Commerce",          url:"https://winstonsalem.com/",                       directoryUrl:"https://winstonsalem.com/directory/"},
  {market:"High Point",    name:"High Point Chamber of Commerce",             url:"https://www.highpointnc.org/",                    directoryUrl:"https://www.highpointnc.org/member-directory/"},
  {market:"Wilmington",    name:"Wilmington Chamber of Commerce",             url:"https://wilmingtonchamber.org/",                  directoryUrl:"https://wilmingtonchamber.org/directory/", note:"1,000+ members, southeastern NC"},
  {market:"Asheville",     name:"Asheville Area Chamber of Commerce",         url:"https://www.ashevillechamber.org/",               directoryUrl:"https://www.ashevillechamber.org/member-directory/"},
  {market:"Fayetteville",  name:"Fayetteville Chamber of Commerce",           url:"https://www.fayettevillencchamber.org/",          directoryUrl:"https://www.fayettevillencchamber.org/list/"},
  {market:"Rocky Mount",   name:"Rocky Mount Area Chamber of Commerce",       url:"https://rockymountchamber.org/",                  directoryUrl:"https://rockymountchamber.org/directory/"},
  {market:"Goldsboro",     name:"Greater Goldsboro Chamber of Commerce",      url:"https://goldsborochamber.org/",                   directoryUrl:"https://goldsborochamber.org/directory/"},
];
// Statewide resources that don't map to a single CRM market
const NC_STATEWIDE_DIRECTORIES = [
  {name:"NC Chamber Federation — full list of 60+ local chambers", url:"https://ncchamber.com/membership/local-chambers/", note:"Use this if your target city isn't in the list above"},
  {name:"NC Secretary of State Business Registration Search",      url:"https://www.sosnc.gov/online_services/search/by_title/_Business_Registration", note:"Official NC business registry — manual search only; automated access isn't permitted per their terms"},
  {name:"US Chamber of Commerce — NC Chamber Finder",               url:"https://www.uschamber.com/co/chambers/north-carolina", note:"Searchable by city if you need a chamber not listed above"},
];

function ProspectFinderModal({onClose,onAddProspects,existingIds,sysSettings,crmData,savedApi,hunterVerify,currentUser,features}){
  const [step,setStep]=useState("search"); // search | results | confirm
  const [showChambers,setShowChambers]=useState(false);
  const [query,setQuery]=useState("");
  const [vertical,setVertical]=useState("");
  const [market,setMarket]=useState("");
  const [orgSize,setOrgSize]=useState("");
  const [orgType,setOrgType]=useState("all"); // all | nonprofit | smb
  const [selectedSources,setSelectedSources]=useState(AI_SOURCES.map(s=>s.id)); // search every real source by default — no manual source-picking needed
  const [showSourcePicker,setShowSourcePicker]=useState(false); // advanced: narrow down to specific sources
  const [searching,setSearching]=useState(false);
  const [results,setResults]=useState([]);
  const [selected,setSelected]=useState(new Set());
  const [progress,setProgress]=useState({});
  const [searchLog,setSearchLog]=useState([]);
  const [sortBy,setSortBy]=useState("priority"); // priority | name | verified
  const [resultFilter,setResultFilter]=useState("all"); // all | verified | unverified | new
  const [recentSearches,setRecentSearches]=useState(()=>{
    try{return JSON.parse(localStorage.getItem("nc_crm_recent_searches")||"[]");}catch{return[];}
  });

  const toggleSrc=id=>setSelectedSources(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const toggleSel=id=>setSelected(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const selectAll=()=>setSelected(new Set(results.map(r=>r._id)));
  const clearSel=()=>setSelected(new Set());

  /* ── Finder upgrades ──────────────────────────────────────────
     • duplicate check against the CRM is now fuzzy (name variants, email, phone, website domain)
     • fit score is an explainable rubric (see src/lib/scoring.js) instead of "has a website/phone"
     • emails can be verified before adding • searches can be saved/shared • results can be tagged on add */
  const crmIndex=useMemo(()=>buildIndex(crmData||[]),[crmData]);
  const matchOf=useMemo(()=>{const m=new Map();for(const r of results){const x=findMatches(r,crmIndex,{limit:1})[0];if(x)m.set(r._id,x);}return m;},[results,crmIndex]);
  const isIn=r=>matchOf.get(r._id)?.level==="high";
  const [verifyProg,setVerifyProg]=useState(null);
  const [addTags,setAddTags]=useState([]);
  const [saveName,setSaveName]=useState("");
  const [showSave,setShowSave]=useState(false);
  const saved=useSavedSearches("finder",savedApi,{enabled:!!savedApi,currentUser});
  const bestEmail=r=>{const e=extractEmails(r.emailPhone);return e.find(x=>emailKind(x)==="personal")||e.find(x=>emailKind(x)==="hr")||e[0];};
  const verifyResults=async()=>{
    const targets=displayedResults.filter(r=>bestEmail(r));
    if(!targets.length){log("No email addresses to verify in these results.");return;}
    setVerifyProg({done:0,total:targets.length});
    const out=await mapPool(targets,4,async r=>({id:r._id,v:await verifyEmail(bestEmail(r),{hunterVerify})}),(done,total)=>setVerifyProg({done,total}));
    const byId=new Map(out.map(x=>[x.id,x.v]));
    setResults(prev=>prev.map(r=>{const v=byId.get(r._id);return v?{...r,emailStatus:v.status,emailCheckedAt:v.checkedAt,_emailConfirmed:!!v.confirmed}:r;}));
    const n=st=>out.filter(x=>x.v.status===st).length;
    log(`Email check: ${n("valid")} valid, ${n("risky")} risky, ${n("invalid")} invalid${n("unknown")?`, ${n("unknown")} could not be checked`:""}.`);
    setVerifyProg(null);
  };
  const applySaved=sv=>{const q=sv.params||{};setQuery(q.query||"");setVertical(q.vertical||"");setMarket(q.market||"");setOrgSize(q.orgSize||"");setOrgType(q.orgType||"all");if(Array.isArray(q.sources)&&q.sources.length)setSelectedSources(q.sources);};
  const saveCurrentSearch=async()=>{
    if(!saveName.trim())return;
    try{await saved.save(saveName,{query:query.trim(),vertical,market,orgSize,orgType,sources:selectedSources},true);setSaveName("");setShowSave(false);}
    catch(e){log(`Couldn't save search: ${e.message}`);}
  };

  const log=msg=>setSearchLog(p=>[...p,{t:tsNow().slice(11),msg}]);

  // Re-apply a recent search's filters (does not auto-run — lets user review/tweak first)
  const applyRecentSearch=(s)=>{
    setQuery(s.query||"");
    setVertical(s.vertical||"");
    setMarket(s.market||"");
    setOrgSize(s.orgSize||"");
    setOrgType(s.orgType||"all");
  };
  const clearRecentSearches=()=>{
    setRecentSearches([]);
    try{localStorage.removeItem("nc_crm_recent_searches");}catch{}
  };

  const runSearch=async()=>{
    if(!query.trim()&&!vertical&&!market){return;}
    if(selectedSources.length===0){
      setStep("results");
      setSearchLog([{t:tsNow().slice(11),msg:"No sources selected — open \"Customize Sources\" and select at least one, or click \"Select All\"."}]);
      return;
    }
    setSearching(true);setResults([]);setSelected(new Set());setSearchLog([]);
    setStep("results");

    // Save this search to recent history (dedupe, cap at 6, most-recent-first)
    const searchSummary={query:query.trim(),vertical,market,orgSize,orgType,ts:Date.now()};
    const label=[searchSummary.query,searchSummary.vertical,searchSummary.market].filter(Boolean).join(" · ")||"(filters only)";
    setRecentSearches(prev=>{
      const next=[{...searchSummary,label},...prev.filter(s=>s.label!==label)].slice(0,6);
      try{localStorage.setItem("nc_crm_recent_searches",JSON.stringify(next));}catch{}
      return next;
    });

    const prog={};selectedSources.forEach(s=>{prog[s]="searching";});
    setProgress({...prog});

    let allResults=[];
    const pushResults=(chunk)=>{allResults=[...allResults,...chunk];setResults([...allResults]);};

    // Every source is a real API call — no simulated/demo data exists
    // anywhere in this flow. Sources run in sequence (not parallel) so
    // the search log reads top-to-bottom in the order selected, and so
    // a slow/failing source doesn't block the others from completing.
    for(const src of selectedSources){
      const srcInfo=AI_SOURCES.find(s=>s.id===src);
      log(`${srcInfo?.label||src}: Searching live API…`);
      setProgress(p=>({...p,[src]:"loading"}));

      let outcome;
      if(src==="hunter"){
        outcome=await hunterSearch(query,sysSettings.hunterKey,vertical,market,log);
      }else if(src==="apollo"){
        outcome=await apolloSearch(query,sysSettings.apolloKey,vertical,market,log);
      }else if(src==="guidestar"){
        outcome=await guidestarSearch(query,vertical,market,log);
      }else if(src==="nppes"){
        outcome=await nppesSearch(query,vertical,market,log);
      }else if(src==="osm"){
        outcome=await osmSearch(query,vertical,market,log);
      }

      if(outcome?.ok){
        const chunk=(outcome.results||[]).map(p=>({...EMPTY_P,...p,_id:uid(),_source:src,_verified:true}));
        pushResults(chunk);
        setProgress(p=>({...p,[src]:"done"}));
        if(chunk.length===0){
          log(`${srcInfo?.label||src}: 0 results${outcome.domainTried?` for domain "${outcome.domainTried}"`:""} — try a different/more specific query.`);
        }
      }else{
        setProgress(p=>({...p,[src]:"error"}));
        const PROXY_LABELS={guidestar:"GuideStar",nppes:"NPI Registry",osm:"OpenStreetMap",apollo:"Apollo"};
        const proxyLabel=PROXY_LABELS[src]||srcInfo?.label||src;
        const noKeySource=["guidestar","nppes","osm"].includes(src);
        const reasonMsg={
          no_proxy:`${proxyLabel} proxy not deployed — see SETUP_GUIDE.md to enable live results`,
          cors_blocked:`blocked by browser (CORS) — requires the ${proxyLabel} proxy (see SETUP_GUIDE.md)`,
          api_error:`API error — ${outcome?.message||(noKeySource?"the underlying API may be temporarily unavailable":"check your API key in Admin → Plugins")}`,
          network_error:`network error — ${outcome?.message||"unknown"}`,
          no_key:"no API key configured",
          no_query:"enter a search query (Hunter/Apollo need a company name or domain)",
        }[outcome?.reason]||"unknown error";
        log(`${srcInfo?.label||src}: ${reasonMsg}`);
      }
    }

    // All sources have been awaited sequentially above — search is
    // already complete by this point, no artificial delay needed.
    setSearching(false);
    log("Search complete.");
  };

  const doAdd=()=>{
    const toAdd=results.filter(r=>selected.has(r._id)).map(r=>{
      const {_id,_source,_verified,_fit,_alsoIn,_emailConfirmed,...rest}=r;
      const fit=scoreProspect(r);
      return{...EMPTY_P,...rest,id:uid(),sourceType:AI_SOURCES.find(s=>s.id===r._source)?.label||r._source,currentStatus:"NEW",
        tags:[...new Set([...(rest.tags||[]),...addTags])].slice(0,30),
        priorityScore:rest.priorityScore||String(priorityFromScore(fit.score)),
        whyFit:[rest.whyFit,explainFit(fit)].filter(Boolean).join(" · ")};
    });
    onAddProspects(toAdd);
    onClose();
  };

  const hasKey=src=>(src==="apollo"&&sysSettings.apolloKey)||(src==="hunter"&&sysSettings.hunterKey)||!["apollo","hunter"].includes(src);

  // Apply in-results filter + sort to the raw results list, without
  // mutating `results` itself (so toggling filters doesn't lose data).
  const displayedResults=useMemo(()=>{
    // score every result, best first, then fold the same organisation found by several sources into one row
    let list=collapseResults(results.map(r=>({...r,_fit:scoreProspect(r)})).sort((x,y)=>y._fit.score-x._fit.score));
    if(resultFilter==="verified")list=list.filter(r=>r._verified);
    else if(resultFilter==="unverified")list=list.filter(r=>!r._verified);
    else if(resultFilter==="new")list=list.filter(r=>!isIn(r));
    else if(resultFilter==="validemail")list=list.filter(r=>r.emailStatus==="valid");

    if(sortBy==="priority")list.sort((a,b)=>b._fit.score-a._fit.score);
    else if(sortBy==="name")list.sort((a,b)=>(a.companyName||"").localeCompare(b.companyName||""));
    else if(sortBy==="verified")list.sort((a,b)=>(b._verified?1:0)-(a._verified?1:0));
    return list;
  },[results,resultFilter,sortBy,matchOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const newCount=results.filter(r=>!isIn(r)).length;
  const verifiedCount=results.filter(r=>r._verified).length;

  return(
    <DW onClose={onClose} title="🔍 AI Prospect Finder" width={1080}>
      {/* Source selector — searches everything by default */}
      <div style={{marginBottom:18}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <p style={{margin:0,fontSize:11,fontWeight:700,color:WM,textTransform:"uppercase",letterSpacing:"0.07em"}}>Search Sources</p>
            <span style={{fontSize:11,fontWeight:600,color:selectedSources.length===0?"#f87171":selectedSources.length===AI_SOURCES.length?"#34d399":"#fbbf24"}}>
              {selectedSources.length===0
                ? "⚠️ No sources selected"
                : selectedSources.length===AI_SOURCES.length
                ? `✓ Searching all ${AI_SOURCES.length} sources`
                : `Searching ${selectedSources.length} of ${AI_SOURCES.length} sources`}
            </span>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setShowSourcePicker(v=>!v)} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,padding:"5px 12px",borderRadius:8,border:`1px solid ${showSourcePicker?"rgba(96,165,250,0.4)":BR}`,background:showSourcePicker?"rgba(96,165,250,0.1)":"rgba(255,255,255,0.03)",color:showSourcePicker?"#60a5fa":WM,cursor:"pointer",fontWeight:600}}>
              ⚙️ Customize Sources {showSourcePicker?"▲":"▼"}
            </button>
            <button onClick={()=>setShowChambers(v=>!v)} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,padding:"5px 12px",borderRadius:8,border:`1px solid ${showChambers?"rgba(132,204,22,0.4)":BR}`,background:showChambers?"rgba(132,204,22,0.1)":"rgba(255,255,255,0.03)",color:showChambers?"#84cc16":WM,cursor:"pointer",fontWeight:600}}>
              🏛️ NC Chamber Directories {showChambers?"▲":"▼"}
            </button>
          </div>
        </div>

        {/* Advanced: per-source picker, hidden by default since "search
            everything" is now the normal flow — only needed if someone
            wants to deliberately narrow the search (e.g. nonprofits only). */}
        {showSourcePicker&&(
          <div style={{background:"rgba(96,165,250,0.05)",border:"1px solid rgba(96,165,250,0.2)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:9}}>
              <p style={{margin:0,fontSize:11,color:WM,lineHeight:1.5}}>Every search runs against all sources by default. Deselect any you want to skip for this search.</p>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={()=>setSelectedSources(AI_SOURCES.map(s=>s.id))} style={{...B.ghost,fontSize:10,padding:"4px 10px"}}>Select All</button>
                <button onClick={()=>setSelectedSources([])} style={{...B.ghost,fontSize:10,padding:"4px 10px"}}>Clear All</button>
              </div>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
              {AI_SOURCES.map(s=>{
                const active=selectedSources.includes(s.id);
                const needsKey=["apollo","hunter"].includes(s.id)&&!hasKey(s.id);
                const isLive=(s.id==="hunter"&&sysSettings.hunterKey)||(s.id==="apollo"&&sysSettings.apolloKey)||["guidestar","nppes","osm"].includes(s.id);
                return(
                  <button key={s.id} onClick={()=>!needsKey&&toggleSrc(s.id)} title={needsKey?"API key required — configure in Settings":s.id==="apollo"?"Apollo key configured — live results require the Apollo proxy Edge Function (see SETUP_GUIDE.md). If not deployed, the search log will explain.":s.desc}
                    style={{display:"flex",alignItems:"center",gap:7,padding:"8px 13px",background:active?`rgba(201,150,58,0.14)`:"rgba(255,255,255,0.04)",border:`1.5px solid ${active?G:"rgba(255,255,255,0.1)"}`,borderRadius:9,cursor:needsKey?"not-allowed":"pointer",opacity:needsKey?0.45:1,transition:"all 0.15s"}}>
                    <span style={{fontSize:16}}>{s.icon}</span>
                    <div style={{textAlign:"left"}}>
                      <p style={{margin:0,fontSize:11,fontWeight:700,color:active?GL:WM,display:"flex",alignItems:"center",gap:5}}>
                        {s.label}
                        {isLive&&<span style={{fontSize:8,padding:"1px 5px",borderRadius:20,background:"rgba(52,211,153,0.15)",color:"#34d399",fontWeight:800}}>LIVE</span>}
                      </p>
                      {needsKey&&<p style={{margin:0,fontSize:9,color:"#f87171"}}>API key required</p>}
                    </div>
                    {active&&<span style={{marginLeft:2,fontSize:10,color:GL}}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {showChambers&&(
          <div style={{background:"rgba(132,204,22,0.05)",border:"1px solid rgba(132,204,22,0.2)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
            <p style={{margin:"0 0 8px",fontSize:11,color:WM,lineHeight:1.5}}>
              Chamber-of-commerce member directories are real, valuable prospect sources, but none offer a public search API — most explicitly disallow automated access. These are direct links to search each chamber's directory <strong style={{color:GL}}>manually</strong>; not part of the automated search above.
            </p>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:6,marginBottom:10}}>
              {NC_CHAMBER_DIRECTORY.map(c=>(
                <a key={c.market} href={c.directoryUrl} target="_blank" rel="noopener noreferrer" style={{display:"block",padding:"8px 11px",borderRadius:8,background:"rgba(255,255,255,0.03)",border:`1px solid ${BR}`,textDecoration:"none",transition:"all 0.15s"}} className="rh">
                  <p style={{margin:0,fontSize:11,fontWeight:700,color:W}}>{c.market}</p>
                  <p style={{margin:"2px 0 0",fontSize:10,color:WM,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name} ↗</p>
                  {c.note&&<p style={{margin:"2px 0 0",fontSize:9,color:WD}}>{c.note}</p>}
                </a>
              ))}
            </div>
            <p style={{margin:"0 0 6px",fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.06em"}}>Statewide / Other</p>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {NC_STATEWIDE_DIRECTORIES.map(d=>(
                <a key={d.name} href={d.url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"#60a5fa",textDecoration:"none"}}>
                  {d.name} ↗ <span style={{color:WD,fontWeight:400}}>— {d.note}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>


      {/* Recent searches */}
      {recentSearches.length>0&&step==="search"&&(
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
            <p style={{margin:0,fontSize:11,fontWeight:700,color:WM,textTransform:"uppercase",letterSpacing:"0.07em"}}>Recent Searches</p>
            <button onClick={clearRecentSearches} style={{...B.ghost,fontSize:9,padding:"3px 8px"}}>Clear</button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {recentSearches.map((s,i)=>(
              <button key={i} onClick={()=>applyRecentSearch(s)} style={{fontSize:11,padding:"5px 12px",borderRadius:20,border:`1px solid ${BR}`,background:"rgba(255,255,255,0.03)",color:WM,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                🕓 {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Saved searches — shared with the team (or this browser in demo mode) */}
      {step==="search"&&savedApi&&(
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7,gap:8,flexWrap:"wrap"}}>
            <p style={{margin:0,fontSize:11,fontWeight:700,color:WM,textTransform:"uppercase",letterSpacing:"0.07em"}}>Saved Searches <span style={{color:WD,fontWeight:500,textTransform:"none",letterSpacing:0}}>{saved.isLocal?"· this browser only":"· shared with your team"}</span></p>
            {!showSave&&<button onClick={()=>setShowSave(true)} disabled={!query.trim()&&!vertical&&!market} className="nc-btn gold-ghost sm" title="Save the current criteria">★ Save this search</button>}
          </div>
          {showSave&&(
            <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
              <input className="nc-input" style={{maxWidth:320}} autoFocus value={saveName} maxLength={80} placeholder="Name, e.g. Raleigh home health" onChange={e=>setSaveName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveCurrentSearch();if(e.key==="Escape")setShowSave(false);}}/>
              <button className="nc-btn primary sm" onClick={saveCurrentSearch} disabled={!saveName.trim()}>Save</button>
              <button className="nc-btn subtle sm" onClick={()=>setShowSave(false)}>Cancel</button>
            </div>
          )}
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {saved.items.length===0&&!showSave&&<span style={{fontSize:11,color:WD}}>Nothing saved yet — set up a search you run often, then save it.</span>}
            {saved.items.map(sv=>(
              <span key={sv.id} className="nc-chip" style={{paddingRight:6}}>
                <button onClick={()=>applySaved(sv)} style={{opacity:1,font:"inherit",color:"inherit",fontWeight:600}} title={sv.createdByName?`Saved by ${sv.createdByName}`:undefined}>★ {sv.name}</button>
                <button aria-label={`Delete saved search ${sv.name}`} onClick={()=>saved.remove(sv.id).catch(e=>log(`Couldn't delete: ${e.message}`))}>×</button>
              </span>
            ))}
            {saved.error&&<span style={{fontSize:11,color:"#fbbf24"}}>Saved searches unavailable: {saved.error}</span>}
          </div>
        </div>
      )}

      {/* Search form */}
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11,marginBottom:11}}>
          <FG label="Keywords / Search Query" span>
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:WD}}>🔍</span>
              <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&runSearch()} placeholder='e.g. "home health Raleigh" or "nonprofit Charlotte compliance"' style={{...inp(),paddingLeft:32}}/>
            </div>
            {selectedSources.includes("hunter")&&sysSettings.hunterKey&&(
              <p style={{margin:"6px 0 0",fontSize:10,color:"#fbbf24"}}>🎯 Hunter.io is LIVE — for best results, enter a company name or domain (e.g. "acmehealth" or "acmehealth.com"). Hunter.io will search that domain for contacts.</p>
            )}
          </FG>
          <FG label="Organization Type">
            <select value={orgType} onChange={e=>{
              const v=e.target.value; setOrgType(v);
              // Nudge the source selection toward the sources that actually
              // cover this org type — doesn't force it, just helps.
              if(v==="nonprofit"&&!selectedSources.includes("guidestar")) setSelectedSources(s=>[...s,"guidestar"]);
              if(v==="healthcare"&&!selectedSources.includes("nppes")) setSelectedSources(s=>[...s,"nppes"]);
            }} style={{...inp(),cursor:"pointer"}}>
              <option value="all">All Organizations</option>
              <option value="nonprofit">Nonprofits (501c) — best with GuideStar</option>
              <option value="healthcare">Healthcare / Home Health — best with NPI Registry</option>
              <option value="smb">SMB / For-Profit — best with Hunter.io / Apollo.io</option>
            </select>
          </FG>
          <FG label="Vertical / Industry">
            <select value={vertical} onChange={e=>setVertical(e.target.value)} style={{...inp(),cursor:"pointer"}}>
              <option value="">All Verticals</option>{VERTICALS.map(v=><option key={v}>{v}</option>)}
            </select>
          </FG>
          <FG label="Market / City">
            <select value={market} onChange={e=>setMarket(e.target.value)} style={{...inp(),cursor:"pointer"}}>
              <option value="">All Markets</option>{MARKETS.map(m=><option key={m}>{m}</option>)}
            </select>
          </FG>
          <FG label="&nbsp;">
            <button onClick={runSearch} disabled={searching||(!query.trim()&&!vertical&&!market)} className="bh" style={{...B.gold,width:"100%",padding:"10px",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:8,opacity:searching||(!query.trim()&&!vertical&&!market)?0.5:1}}>
              {searching?<><Spin s={16} c="#0B1426"/> Searching…</>:"🔍 Search Prospects"}
            </button>
          </FG>
        </div>
      </div>

      {/* Initial empty state — before any search */}
      {step==="search"&&(
        <div style={{textAlign:"center",padding:"40px 0",color:WD}}>
          <p style={{fontSize:40,margin:"0 0 10px"}}>🔍</p>
          <p style={{margin:0,fontSize:14,color:WM}}>Run a search to discover prospects</p>
          <p style={{margin:"6px 0 0",fontSize:12}}>Try entering a keyword, selecting a vertical, or choosing a market</p>
        </div>
      )}

      {/* Results */}
      {step==="results"&&(
        <div style={{animation:"fadeUp 0.2s ease"}}>
          {/* Source progress */}
          <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:12}}>
            {selectedSources.map(s=>{
              const si=AI_SOURCES.find(x=>x.id===s);
              const st=progress[s];
              const isLive=(s==="hunter"&&sysSettings.hunterKey)||(s==="apollo"&&sysSettings.apolloKey)||["guidestar","nppes","osm"].includes(s);
              return(
                <div key={s} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",background:"rgba(255,255,255,0.04)",border:`1px solid ${st==="done"?"rgba(52,211,153,0.3)":st==="error"?"rgba(248,113,113,0.35)":st==="loading"?`${si?.color}44`:"rgba(255,255,255,0.08)"}`,borderRadius:20}}>
                  <span style={{fontSize:13}}>{si?.icon}</span>
                  <span style={{fontSize:11,fontWeight:600,color:st==="done"?"#34d399":st==="error"?"#f87171":st==="loading"?si?.color:WM}}>{si?.label}</span>
                  {isLive&&<span style={{fontSize:8,padding:"1px 5px",borderRadius:20,background:"rgba(52,211,153,0.15)",color:"#34d399",fontWeight:800}}>LIVE</span>}
                  {st==="loading"&&<Spin s={10} c={si?.color}/>}
                  {st==="done"&&<span style={{fontSize:10,color:"#34d399"}}>✓</span>}
                  {st==="error"&&<span style={{fontSize:10,color:"#f87171"}}>⚠️</span>}
                </div>
              );
            })}
          </div>

          {/* Search log */}
          {searchLog.length>0&&(
            <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"8px 12px",marginBottom:12,maxHeight:80,overflowY:"auto",fontFamily:"monospace",fontSize:10,color:WD}}>
              {searchLog.map((l,i)=><div key={i}><span style={{color:G}}>[{l.t}]</span> {l.msg}</div>)}
            </div>
          )}

          {/* Results header */}
          {results.length>0&&(
            <div style={{display:"flex",flexDirection:"column",gap:9,marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <p style={{margin:0,fontSize:13,fontWeight:700,color:W}}>{results.length} prospects found</p>
                <span style={{fontSize:11,color:"#34d399"}}>{newCount} new</span>
                <span style={{fontSize:11,color:WD}}>·</span>
                <span style={{fontSize:11,color:WM}}>{verifiedCount} verified</span>
                <span style={{fontSize:11,color:WD}}>·</span>
                <span style={{fontSize:11,color:WM}}>{selected.size} selected</span>
                <div style={{marginLeft:"auto",display:"flex",gap:7}}>
                  <button onClick={verifyResults} disabled={!!verifyProg} className="nc-btn gold-ghost sm" title={hunterVerify?"Checks syntax, the domain's mail server, and the mailbox (Hunter)":"Checks syntax and that the domain can receive email"}>
                    {verifyProg?`Verifying ${verifyProg.done}/${verifyProg.total}…`:"✓ Verify emails"}
                  </button>
                  <button onClick={selectAll} style={{...B.ghost,fontSize:10,padding:"5px 11px"}}>Select All</button>
                  <button onClick={clearSel} style={{...B.ghost,fontSize:10,padding:"5px 11px"}}>Clear</button>
                  {selected.size>0&&<button onClick={doAdd} className="bh" style={{...B.gold,fontSize:11,padding:"7px 16px",display:"flex",gap:6,alignItems:"center"}}>
                    ➕ Add {selected.size} to CRM
                  </button>}
                </div>
              </div>
              {selected.size>0&&(
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,color:WM,whiteSpace:"nowrap"}}>Tag these {selected.size} as</span>
                  <div style={{minWidth:240,flex:"0 1 380px"}}>
                    <TagInput value={addTags} onChange={setAddTags} suggestions={allTags(crmData||[])} disabled={features?.tags===false}
                      placeholder={features?.tags===false?"Tags need the database update":"e.g. q4-home-health (optional)"}/>
                  </div>
                </div>
              )}
              {/* Sort + in-results filter controls */}
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{fontSize:10,color:WD,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>Show:</span>
                {[["all","All"],["new","New only"],["validemail","Valid email"],["verified","Verified"],["unverified","Unverified"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setResultFilter(k)} style={{fontSize:10,padding:"4px 11px",borderRadius:20,border:`1px solid ${resultFilter===k?"rgba(201,150,58,0.4)":BR}`,background:resultFilter===k?"rgba(201,150,58,0.12)":"rgba(255,255,255,0.03)",color:resultFilter===k?GL:WD,cursor:"pointer",fontWeight:resultFilter===k?700:500}}>{l}</button>
                ))}
                <span style={{fontSize:10,color:WD,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginLeft:10}}>Sort:</span>
                {[["priority","Best fit"],["verified","Verified first"],["name","Company name"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setSortBy(k)} style={{fontSize:10,padding:"4px 11px",borderRadius:20,border:`1px solid ${sortBy===k?"rgba(96,165,250,0.4)":BR}`,background:sortBy===k?"rgba(96,165,250,0.12)":"rgba(255,255,255,0.03)",color:sortBy===k?"#60a5fa":WD,cursor:"pointer",fontWeight:sortBy===k?700:500}}>{l}</button>
                ))}
              </div>
              {results.some(r=>r._source==="osm")&&(
                <p style={{margin:0,fontSize:9,color:WD}}>Map &amp; Local Business Directory results © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" style={{color:WD,textDecoration:"underline"}}>OpenStreetMap contributors</a>, ODbL.</p>
              )}
            </div>
          )}

          {/* ═══ MAP VIEW — real tile-based map via Leaflet/OpenStreetMap ═══ */}
          {results.length>0&&(()=>{
            const pinned = displayedResults.filter(r=>r._lat!=null&&r._lon!=null);
            const center = market && NC_CITY_COORDS[market] ? NC_CITY_COORDS[market] : DEFAULT_NC_COORDS;
            return(
              <div style={{position:"relative",borderRadius:12,overflow:"hidden",border:`1px solid ${BR}`,marginBottom:14}}>
                <MapContainer center={center} zoom={market?11:7} style={{height:280,width:"100%"}} scrollWheelZoom={true}>
                  <TileLayer
                    attribution='© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <FitToPins pinned={pinned} fallbackCenter={center}/>
                  {pinned.map(r=>{
                    const sel=selected.has(r._id);
                    const si=AI_SOURCES.find(s=>s.id===r._source);
                    const alreadyIn=isIn(r);
                    return(
                      <Marker key={r._id} position={[r._lat,r._lon]} icon={makeColoredPin(sel?"#C9963A":(si?.color||"#84cc16"), sel)}
                        eventHandlers={{click:()=>!alreadyIn&&toggleSel(r._id)}}>
                        <Popup>
                          <div style={{minWidth:180,fontFamily:"inherit"}}>
                            <p style={{margin:"0 0 3px",fontWeight:700,fontSize:13}}>{r.companyName}</p>
                            <p style={{margin:"0 0 3px",fontSize:11,color:"#555"}}>{r.cityMarket||r.market||"NC"}{!r._geoPrecise?" (city-level estimate)":""}</p>
                            {r.contactName&&<p style={{margin:"0 0 3px",fontSize:11}}>{r.contactName}{r.title?` · ${r.title}`:""}</p>}
                            {r.emailPhone&&<p style={{margin:"0 0 3px",fontSize:11}}>{r.emailPhone}</p>}
                            <p style={{margin:"4px 0 0",fontSize:10,color:si?.color}}>{si?.icon} {si?.label}</p>
                            {!alreadyIn&&(
                              <button onClick={()=>toggleSel(r._id)} style={{marginTop:6,fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:6,border:"none",background:sel?"#C9963A":"#1B2A4A",color:sel?"#0B1426":"#fff",cursor:"pointer"}}>
                                {sel?"✓ Selected":"+ Select"}
                              </button>
                            )}
                            {alreadyIn&&<p style={{margin:"6px 0 0",fontSize:10,color:"#34d399",fontWeight:700}}>Already in CRM</p>}
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                </MapContainer>
                <div style={{position:"absolute",bottom:8,left:10,zIndex:1000,fontSize:9,color:"#fff",background:"rgba(11,20,38,0.75)",padding:"4px 9px",borderRadius:6,display:"flex",alignItems:"center",gap:10}}>
                  <span>📍 {pinned.length} of {displayedResults.length} mapped</span>
                  <span style={{display:"flex",alignItems:"center",gap:4}}>city-level estimate vs. precise — see pin popup</span>
                </div>
              </div>
            );
          })()}

          {/* ═══ RESULTS TABLE (GHL-style) ═══ */}
          <div style={{border:`1px solid ${BR}`,borderRadius:11,overflow:"hidden",maxHeight:360,overflowY:"auto"}}>
            {searching&&results.length===0&&(
              <div style={{textAlign:"center",padding:"32px 0"}}>
                <Spin s={36} c={G}/>
                <p style={{color:WM,marginTop:12,fontSize:13}}>Searching across {selectedSources.length} source{selectedSources.length!==1?"s":""}…</p>
              </div>
            )}
            {displayedResults.length>0&&(
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{background:"rgba(255,255,255,0.03)",borderBottom:`1px solid ${BR}`}}>
                    <th style={{width:36,padding:"9px 8px"}}>
                      <input type="checkbox" checked={displayedResults.every(r=>selected.has(r._id)||isIn(r))} onChange={()=>{
                        const allSel = displayedResults.every(r=>selected.has(r._id));
                        setSelected(prev=>{
                          const next=new Set(prev);
                          displayedResults.forEach(r=>{
                            const already=isIn(r);
                            if(already)return;
                            if(allSel)next.delete(r._id);else next.add(r._id);
                          });
                          return next;
                        });
                      }} style={{cursor:"pointer"}}/>
                    </th>
                    <th style={{textAlign:"left",padding:"9px 8px",fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.05em"}}>Business</th>
                    <th style={{textAlign:"left",padding:"9px 8px",fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.05em"}}>Fit Score</th>
                    <th style={{textAlign:"left",padding:"9px 8px",fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.05em"}}>Online Presence</th>
                    <th style={{textAlign:"left",padding:"9px 8px",fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.05em"}}>Source</th>
                    <th style={{textAlign:"left",padding:"9px 8px",fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.05em"}}>Status</th>
                    <th style={{textAlign:"right",padding:"9px 8px",fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.05em"}}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedResults.map(r=>{
                    const sel=selected.has(r._id);
                    const si=AI_SOURCES.find(s=>s.id===r._source);
                    const alreadyIn=isIn(r);
                    const fit=r._fit||scoreProspect(r);
                    const poss=!alreadyIn&&matchOf.get(r._id)?.level==="medium"?matchOf.get(r._id):null;
                    return(
                      <tr key={r._id} onClick={()=>!alreadyIn&&toggleSel(r._id)} style={{borderBottom:`1px solid rgba(255,255,255,0.04)`,background:sel?"rgba(201,150,58,0.06)":"transparent",cursor:alreadyIn?"default":"pointer",opacity:alreadyIn?0.5:1}} className={alreadyIn?"":"rh"}>
                        <td style={{padding:"10px 8px"}} onClick={e=>e.stopPropagation()}>
                          <input type="checkbox" checked={sel} disabled={alreadyIn} onChange={()=>!alreadyIn&&toggleSel(r._id)} style={{cursor:alreadyIn?"default":"pointer"}}/>
                        </td>
                        <td style={{padding:"10px 8px",maxWidth:240}}>
                          <p style={{margin:0,fontSize:12,fontWeight:700,color:W,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.companyName}</p>
                          <p style={{margin:"2px 0 0",fontSize:10,color:WM,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.contactName?`${r.contactName} · `:""}{r.cityMarket||r.market||"NC"}</p>
                          {alreadyIn&&<span style={{fontSize:9,color:"#34d399",fontWeight:700}} title={(matchOf.get(r._id)?.reasons||[]).join(" · ")}>Already in CRM · {matchOf.get(r._id)?.prospect.companyName}</span>}
                          {poss&&<span style={{fontSize:9,color:"#fbbf24",fontWeight:700,display:"block"}} title={poss.reasons.join(" · ")}>⚠ Possible match: {poss.prospect.companyName}</span>}
                          {r._alsoIn?.length>0&&<span style={{fontSize:9,color:WD,display:"block"}}>Also found via {r._alsoIn.map(id=>AI_SOURCES.find(x=>x.id===id)?.label||id).join(", ")}</span>}
                          {r.emailStatus&&<span style={{display:"block",marginTop:2}}><EmailBadge status={r.emailStatus} confirmed={r._emailConfirmed}/></span>}
                        </td>
                        <td style={{padding:"10px 8px"}}><ScoreBadge result={fit} size={32} showLabel/></td>
                        <td style={{padding:"10px 8px"}}>
                          <div style={{display:"flex",gap:5}}>
                            <span title={r.sourceUrl?"Has a website":"No website found"} style={{width:20,height:20,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",background:r.sourceUrl?"rgba(52,211,153,0.15)":"rgba(255,255,255,0.04)",fontSize:10}}>{r.sourceUrl?"🌐":"—"}</span>
                            <span title={r.emailPhone?"Has contact info":"No contact info found"} style={{width:20,height:20,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",background:r.emailPhone?"rgba(52,211,153,0.15)":"rgba(255,255,255,0.04)",fontSize:10}}>{r.emailPhone?"☎️":"—"}</span>
                          </div>
                        </td>
                        <td style={{padding:"10px 8px"}}>
                          <span style={{fontSize:9,color:si?.color,border:`1px solid ${si?.color}44`,borderRadius:20,padding:"2px 9px",whiteSpace:"nowrap"}}>{si?.icon} {si?.label}</span>
                        </td>
                        <td style={{padding:"10px 8px"}}>
                          <span style={{fontSize:10,color:alreadyIn?"#34d399":WD,fontWeight:600}}>{alreadyIn?"In CRM":"Not added"}</span>
                        </td>
                        <td style={{padding:"10px 8px",textAlign:"right"}} onClick={e=>e.stopPropagation()}>
                          {alreadyIn?(
                            <span style={{fontSize:10,color:WD}}>—</span>
                          ):(
                            <button onClick={()=>{
                              setSelected(new Set([r._id]));
                              setTimeout(doAdd,0);
                            }} style={{fontSize:11,fontWeight:700,color:GL,background:"none",border:"none",cursor:"pointer",padding:"4px 8px"}}>+ Add</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {!searching&&results.length>0&&displayedResults.length===0&&(
              <div style={{textAlign:"center",padding:"32px 0",color:WD}}>
                <p style={{fontSize:40,margin:"0 0 10px"}}>🗂️</p>
                <p style={{margin:0,fontSize:14,color:WM}}>No results match this filter</p>
                <p style={{margin:"6px 0 0",fontSize:12}}>Try "All" or a different Show filter above</p>
                <button onClick={()=>setResultFilter("all")} className="bh" style={{...B.ghost,fontSize:11,padding:"6px 14px",marginTop:10}}>Show All Results</button>
              </div>
            )}
            {!searching&&results.length===0&&(
              <div style={{textAlign:"center",padding:"32px 0",color:WD}}>
                <p style={{fontSize:40,margin:"0 0 10px"}}>🔍</p>
                <p style={{margin:0,fontSize:14,color:WM}}>No prospects found for this search</p>
                <p style={{margin:"6px 0 0",fontSize:12}}>Try a broader keyword, switch verticals, or search "All Markets"</p>
                <div style={{display:"flex",gap:7,justifyContent:"center",marginTop:12,flexWrap:"wrap"}}>
                  {vertical&&<button onClick={()=>setVertical("")} className="bh" style={{...B.ghost,fontSize:11,padding:"6px 13px"}}>Clear Vertical</button>}
                  {market&&<button onClick={()=>setMarket("")} className="bh" style={{...B.ghost,fontSize:11,padding:"6px 13px"}}>Clear Market</button>}
                  {orgType!=="all"&&<button onClick={()=>setOrgType("all")} className="bh" style={{...B.ghost,fontSize:11,padding:"6px 13px"}}>All Org Types</button>}
                </div>
              </div>
            )}
          </div>

          {/* Bottom action bar */}
          {results.length>0&&selected.size>0&&(
            <div style={{marginTop:14,padding:"12px 16px",background:"rgba(201,150,58,0.08)",border:"1px solid rgba(201,150,58,0.25)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <p style={{margin:0,fontSize:13,color:W}}><strong style={{color:GL}}>{selected.size}</strong> prospect{selected.size!==1?"s":""} selected and ready to add</p>
              <button onClick={doAdd} className="bh" style={{...B.gold,display:"flex",gap:8,alignItems:"center",padding:"10px 22px",fontSize:13}}>
                ➕ Add to Prospect List →
              </button>
            </div>
          )}
        </div>
      )}
    </DW>
  );
}

/* ════════════════════════════════════════════════════════════════
   EXCEL IMPORT MODAL
════════════════════════════════════════════════════════════════ */
function ExcelImportModal({onClose,onImport}){
  const [step,setStep]=useState("upload");
  const [rows,setRows]=useState([]);
  const [fileName,setFileName]=useState("");
  const [headers,setHeaders]=useState([]);
  const [colMap,setColMap]=useState({});
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [mode,setMode]=useState("append");
  const dropRef=useRef();

  const processFile=file=>{
    if(!file)return;
    const ext=(file.name||"").split(".").pop().toLowerCase();
    if(!["xlsx","xls","csv"].includes(ext)){setErr("Please upload an .xlsx, .xls, or .csv file.");return;}
    setErr("");setLoading(true);setFileName(file.name);
    const reader=new FileReader();
    reader.onload=e=>{
      try{
        const wb=XLSX.read(e.target.result,{type:"array",cellDates:true,dateNF:"yyyy-mm-dd"});
        const ws=wb.Sheets[wb.SheetNames[0]];
        const data=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,dateNF:"yyyy-mm-dd"});
        if(!data||data.length<2){setErr("Sheet appears empty.");setLoading(false);return;}
        const hdrs=data[0].map(h=>String(h||"").trim());
        const dataRows=data.slice(1).filter(r=>r.some(c=>c!==null&&c!==undefined&&String(c).trim()!==""));
        const mapped={};
        hdrs.forEach(h=>{const f=mapHdr(h);if(f)mapped[h]=f;});
        setHeaders(hdrs);setColMap(mapped);
        setRows(dataRows.map(r=>{const obj={};hdrs.forEach((h,i)=>{obj[h]=r[i]!==undefined?r[i]:"";});return obj;}));
        setStep("preview");setLoading(false);
      }catch(ex){setErr("Failed to parse: "+ex.message);setLoading(false);}
    };
    reader.onerror=()=>{setErr("Failed to read file.");setLoading(false);};
    reader.readAsArrayBuffer(file);
  };

  const handleDrop=e=>{e.preventDefault();dropRef.current?.classList.remove("drop-z-active");processFile(e.dataTransfer.files[0]);};
  const handleDragOver=e=>{e.preventDefault();dropRef.current?.classList.add("drop-z-active");};
  const handleDragLeave=()=>dropRef.current?.classList.remove("drop-z-active");

  const doImport=()=>{
    const prospects=rows.map(row=>{const rem={};Object.entries(row).forEach(([h,v])=>{rem[colMap[h]||h]=v;});return rowToProspect(rem);});
    onImport(prospects,mode);setStep("done");
  };

  const previewP=rows.slice(0,4).map(row=>{const r={};Object.entries(row).forEach(([h,v])=>{if(colMap[h])r[colMap[h]]=v;});return r;});

  const downloadTemplate=()=>{
    const hdr=[["Company Name","Contact Name","Title","Email/Phone","City/Market","Market","Vertical","Org Size","Source Type","Source URL","Why Fit","Lead Pain Point","Current Status","Priority Score","T1 Send Date","T1 Due Date","T2 Send Date","T2 Due Date","T3 Send Date","T3 Due Date","HR Person Listed","Outreach Notes","Remarks"]];
    const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet(hdr);ws["!cols"]=hdr[0].map(()=>({wch:18}));
    XLSX.utils.book_append_sheet(wb,ws,"Prospects");XLSX.writeFile(wb,"NC_CRM_Import_Template.xlsx");
  };

  return(
    <DW onClose={onClose} title="📁 Import from Excel / CSV" width={720}>
      {/* step bar */}
      <div style={{display:"flex",alignItems:"center",marginBottom:18,gap:0}}>
        {["upload","preview","done"].map((s,i)=>(
          <div key={s} style={{display:"flex",alignItems:"center",flex:1}}>
            <div style={{width:24,height:24,borderRadius:"50%",background:step===s?G:["upload","preview","done"].indexOf(step)>i?"rgba(52,211,153,0.2)":"rgba(255,255,255,0.06)",border:`2px solid ${step===s?G:["upload","preview","done"].indexOf(step)>i?"rgba(52,211,153,0.5)":BR}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:step===s?N:["upload","preview","done"].indexOf(step)>i?"#34d399":WD,flexShrink:0}}>
              {["upload","preview","done"].indexOf(step)>i?"✓":i+1}
            </div>
            <span style={{fontSize:11,fontWeight:step===s?700:500,color:step===s?W:WD,marginLeft:7,flex:1}}>{s==="upload"?"1. Upload":s==="preview"?"2. Map & Preview":"3. Done"}</span>
            {i<2&&<div style={{width:20,height:1,background:BR,flexShrink:0}}/>}
          </div>
        ))}
      </div>

      {step==="upload"&&(
        <div style={{animation:"fadeUp 0.2s ease"}}>
          {err&&<div style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#f87171",marginBottom:14}}>⚠️ {err}</div>}
          <div ref={dropRef} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onClick={()=>document.getElementById("xlsIn").click()}
            style={{border:"2px dashed rgba(201,150,58,0.35)",borderRadius:14,padding:"40px 24px",textAlign:"center",cursor:"pointer",transition:"all 0.2s",background:"rgba(201,150,58,0.03)",marginBottom:16}}>
            <div style={{fontSize:52,marginBottom:10}}>📊</div>
            <p style={{margin:"0 0 6px",fontSize:15,fontWeight:700,color:W}}>Drop your file here</p>
            <p style={{margin:"0 0 14px",fontSize:12,color:WM}}>Supports .xlsx · .xls · .csv</p>
            {loading?<Spin s={28} c={G}/>:<button className="bh" style={{...B.gold,fontSize:12}}>Browse Files</button>}
            <input id="xlsIn" type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={e=>{processFile(e.target.files[0]);e.target.value="";}}/>
          </div>
          <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:16,marginBottom:14}}>
            <p style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:W}}>📥 Download Import Template</p>
            <p style={{margin:"0 0 10px",fontSize:11,color:WM}}>Pre-formatted Excel with all column headers ready to fill.</p>
            <button onClick={downloadTemplate} className="bh" style={{...B.green,fontSize:11}}>⬇️ Download Template (.xlsx)</button>
          </div>
          <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:12}}>
            <p style={{margin:"0 0 8px",fontSize:9,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.07em"}}>Accepted Column Headers (auto-detected)</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {["Company Name","Contact Name","Title","Email/Phone","Market","Vertical","Org Size","Status","Priority Score","T1 Send Date","T2 Send Date","T3 Send Date","Why Fit","Outreach Notes"].map(h=>(
                <span key={h} style={{background:"rgba(201,150,58,0.1)",color:GL,border:"1px solid rgba(201,150,58,0.2)",borderRadius:6,padding:"2px 8px",fontSize:10}}>{h}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {step==="preview"&&(
        <div style={{animation:"fadeUp 0.2s ease"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div><p style={{margin:0,fontSize:13,fontWeight:700,color:W}}>📄 {fileName}</p><p style={{margin:"3px 0 0",fontSize:11,color:WM}}>{rows.length} rows · {Object.values(colMap).filter(Boolean).length}/{headers.length} columns mapped</p></div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:11,color:WM}}>Mode:</span>
              <select value={mode} onChange={e=>setMode(e.target.value)} style={{...inp(),width:"auto",fontSize:11,padding:"6px 10px",cursor:"pointer"}}>
                <option value="append">Append (add to existing)</option>
                <option value="replace">Replace all records</option>
              </select>
            </div>
          </div>
          <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,marginBottom:14,overflow:"hidden"}}>
            <div style={{padding:"9px 14px",borderBottom:"1px solid rgba(255,255,255,0.07)",background:"rgba(255,255,255,0.03)"}}><p style={{margin:0,fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.06em"}}>Column Mapping — correct if needed</p></div>
            <div style={{padding:"12px 14px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:7}}>
              {headers.map(h=>(
                <div key={h} style={{display:"flex",alignItems:"center",gap:7,padding:"5px 9px",background:colMap[h]?"rgba(52,211,153,0.05)":"rgba(255,255,255,0.02)",border:`1px solid ${colMap[h]?"rgba(52,211,153,0.2)":BR}`,borderRadius:7}}>
                  <span style={{fontSize:11,color:colMap[h]?"#34d399":WD,flex:"0 0 120px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={h}>{h}</span>
                  <span style={{color:WD,fontSize:11}}>→</span>
                  <select value={colMap[h]||""} onChange={e=>setColMap(m=>({...m,[h]:e.target.value}))} style={{...inp(),fontSize:10,padding:"3px 7px",flex:1,cursor:"pointer"}}>
                    <option value="">(skip)</option>
                    {Object.keys(EMPTY_P).filter(k=>k!=="id").map(k=><option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,overflow:"hidden",marginBottom:14}}>
            <div style={{padding:"9px 14px",borderBottom:"1px solid rgba(255,255,255,0.07)",background:"rgba(255,255,255,0.03)"}}><p style={{margin:0,fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.06em"}}>Preview — first {Math.min(4,rows.length)} rows</p></div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:560,fontSize:11}}>
                <thead><tr style={{background:"rgba(255,255,255,0.03)"}}>
                  {["Company","Contact","Email/Phone","Market","Vertical","Status"].map(h=><th key={h} style={{textAlign:"left",padding:"7px 12px",color:WD,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",fontSize:9,whiteSpace:"nowrap"}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {previewP.map((p,i)=>(
                    <tr key={i} style={{borderTop:`1px solid ${BR}`,background:i%2?"rgba(255,255,255,0.015)":"transparent"}}>
                      <td style={{padding:"7px 12px",color:W,fontWeight:600}}>{p.companyName||<span style={{color:WD}}>—</span>}</td>
                      <td style={{padding:"7px 12px",color:WM}}>{p.contactName||"—"}</td>
                      <td style={{padding:"7px 12px",color:WM}}>{p.emailPhone||"—"}</td>
                      <td style={{padding:"7px 12px",color:WM}}>{p.market||"—"}</td>
                      <td style={{padding:"7px 12px",color:WM,maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.vertical||"—"}</td>
                      <td style={{padding:"7px 12px"}}>{p.currentStatus?<SBadge status={p.currentStatus} sm/>:"—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {mode==="replace"&&<div style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#f87171",marginBottom:14}}>⚠️ <strong>Replace mode:</strong> All existing records will be deleted.</div>}
          <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
            <button onClick={()=>{setStep("upload");setRows([]);setFileName("");setErr("");}} className="bh" style={B.ghost}>← Back</button>
            <button onClick={doImport} className="bh" style={{...B.gold,display:"flex",gap:8,alignItems:"center"}}>Import {rows.length} Records →</button>
          </div>
        </div>
      )}

      {step==="done"&&(
        <div style={{textAlign:"center",padding:"32px 0",animation:"fadeUp 0.2s ease"}}>
          <div style={{fontSize:56,marginBottom:14}}>✅</div>
          <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800,color:W}}>Import Successful!</h3>
          <p style={{margin:"0 0 24px",fontSize:13,color:WM}}>{rows.length} prospects {mode==="replace"?"imported (replaced all existing data)":"added to your CRM"}.</p>
          <button onClick={onClose} className="bh" style={{...B.gold,padding:"12px 32px",fontSize:14}}>Done — View Prospects</button>
        </div>
      )}
    </DW>
  );
}

/* ════════════════════════════════════════════════════════════════
   PROSPECT FORM MODAL
════════════════════════════════════════════════════════════════ */
function ProspectModal({prospect,isNew,onSave,onDelete,onClose,canDelete}){
  const [form,setForm]=useState(prospect||{...EMPTY_P,id:uid()});
  const [tab,setTab]=useState("info");
  const sf=(k,v)=>setForm(f=>({...f,[k]:v}));
  const fv=k=>form[k]!=null?form[k]:"";

  const TABS=[{id:"info",l:"📋 Basic"},{id:"outreach",l:"📧 Outreach"},{id:"dates",l:"📅 Dates"},{id:"flags",l:"🚩 Flags"}];

  return(
    <DW onClose={onClose} title={isNew?"➕ Add Prospect":`✏️ ${prospect?.companyName||"Edit Prospect"}`} width={630}>
      <div style={{display:"flex",gap:3,background:"rgba(255,255,255,0.04)",borderRadius:9,padding:3,marginBottom:16}}>
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,background:tab===t.id?"rgba(201,150,58,0.14)":"transparent",color:tab===t.id?GL:WM,border:`1px solid ${tab===t.id?"rgba(201,150,58,0.3)":"transparent"}`,borderRadius:7,padding:"7px",fontSize:11,fontWeight:tab===t.id?700:500,cursor:"pointer",transition:"all 0.15s"}}>{t.l}</button>)}
      </div>

      {tab==="info"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11,animation:"fadeUp 0.2s ease"}}>
          <FG label="Company Name *"><input value={fv("companyName")} onChange={e=>sf("companyName",e.target.value)} style={inp()}/></FG>
          <FG label="Contact Name"><input value={fv("contactName")} onChange={e=>sf("contactName",e.target.value)} style={inp()}/></FG>
          <FG label="Title"><input value={fv("title")} onChange={e=>sf("title",e.target.value)} style={inp()}/></FG>
          <FG label="Email / Phone"><input value={fv("emailPhone")} onChange={e=>sf("emailPhone",e.target.value)} style={inp()}/></FG>
          <FG label="City / Market"><input value={fv("cityMarket")} onChange={e=>sf("cityMarket",e.target.value)} style={inp()}/></FG>
          <FG label="Market"><select value={fv("market")} onChange={e=>sf("market",e.target.value)} style={{...inp(),cursor:"pointer"}}><option value="">Select…</option>{MARKETS.map(m=><option key={m}>{m}</option>)}</select></FG>
          <FG label="Vertical"><select value={fv("vertical")} onChange={e=>sf("vertical",e.target.value)} style={{...inp(),cursor:"pointer"}}><option value="">Select…</option>{VERTICALS.map(v=><option key={v}>{v}</option>)}</select></FG>
          <FG label="Org Size"><select value={fv("orgSize")} onChange={e=>sf("orgSize",e.target.value)} style={{...inp(),cursor:"pointer"}}><option value="">Select…</option>{ORG_SIZES.map(s=><option key={s}>{s}</option>)}</select></FG>
          <FG label="Source Type"><select value={fv("sourceType")} onChange={e=>sf("sourceType",e.target.value)} style={{...inp(),cursor:"pointer"}}><option value="">Select…</option>{SRC_TYPES.map(s=><option key={s}>{s}</option>)}</select></FG>
          <FG label="Priority Score (1–10)"><input type="number" min="1" max="10" value={fv("priorityScore")} onChange={e=>sf("priorityScore",e.target.value)} style={inp()}/></FG>
          <FG label="Status" span><select value={fv("currentStatus")} onChange={e=>sf("currentStatus",e.target.value)} style={{...inp(),cursor:"pointer"}}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></FG>
          <FG label="Source URL" span><input value={fv("sourceUrl")} onChange={e=>sf("sourceUrl",e.target.value)} placeholder="https://…" style={inp()}/></FG>
          <FG label="Why a Fit" span><textarea value={fv("whyFit")} onChange={e=>sf("whyFit",e.target.value)} rows={2} style={{...inp(),resize:"vertical"}}/></FG>
          <FG label="Verification Notes" span><input value={fv("verificationNotes")} onChange={e=>sf("verificationNotes",e.target.value)} style={inp()}/></FG>
        </div>
      )}

      {tab==="outreach"&&(
        <div style={{display:"flex",flexDirection:"column",gap:11,animation:"fadeUp 0.2s ease"}}>
          <FG label="Lead Pain Point"><textarea value={fv("leadPainPoint")} onChange={e=>sf("leadPainPoint",e.target.value)} rows={2} style={{...inp(),resize:"vertical"}}/></FG>
          <FG label="Outreach Notes"><textarea value={fv("outreachNotes")} onChange={e=>sf("outreachNotes",e.target.value)} rows={3} style={{...inp(),resize:"vertical"}}/></FG>
          <FG label="Melissa Review Notes"><input value={fv("melissaReview")} onChange={e=>sf("melissaReview",e.target.value)} style={inp()}/></FG>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11}}>
            <FG label="HR Person Listed?"><select value={fv("hrPersonListed")} onChange={e=>sf("hrPersonListed",e.target.value)} style={{...inp(),cursor:"pointer"}}><option>No</option><option>Yes</option></select></FG>
            <FG label="HR People Contact"><input value={fv("hrPeopleContact")} onChange={e=>sf("hrPeopleContact",e.target.value)} style={inp()}/></FG>
          </div>
          <FG label="Remarks"><input value={fv("remarks")} onChange={e=>sf("remarks",e.target.value)} style={inp()}/></FG>
        </div>
      )}

      {tab==="dates"&&(
        <div style={{display:"flex",flexDirection:"column",gap:11,animation:"fadeUp 0.2s ease"}}>
          {[{label:"Touch 1",c:"rgba(96,165,250,0.06)",bc:"rgba(96,165,250,0.2)",tc:"#60a5fa",send:"t1SendDate",due:"t1DueDate"},
            {label:"Touch 2",c:"rgba(139,92,246,0.06)",bc:"rgba(139,92,246,0.2)",tc:"#a78bfa",send:"t2SendDate",due:"t2DueDate"},
            {label:"Touch 3",c:"rgba(236,72,153,0.06)",bc:"rgba(236,72,153,0.2)",tc:"#f472b6",send:"t3SendDate",due:"t3DueDate"}].map(t=>(
            <div key={t.label} style={{background:t.c,border:`1px solid ${t.bc}`,borderRadius:10,padding:14}}>
              <p style={{margin:"0 0 10px",fontSize:11,fontWeight:700,color:t.tc,textTransform:"uppercase",letterSpacing:"0.06em"}}>📧 {t.label}</p>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <FG label="Send Date"><input type="date" value={fv(t.send)} onChange={e=>sf(t.send,e.target.value)} style={inp()}/></FG>
                <FG label="Due Date"><input type="date" value={fv(t.due)} onChange={e=>sf(t.due,e.target.value)} style={inp()}/></FG>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==="flags"&&(
        <div style={{display:"flex",flexDirection:"column",gap:9,animation:"fadeUp 0.2s ease"}}>
          {[{k:"flagToMelissa",l:"🚩 Flag to Melissa",d:"Immediately notify Melissa",danger:true},
            {k:"replyReceived",l:"📩 Reply Received",d:"Prospect has replied to an email",danger:false},
            {k:"t3Approved",l:"✓ T3 Approved",d:"Melissa approved Touch 3 send",danger:false},
            {k:"doNotRespond",l:"🚫 Do Not Respond",d:"Mark as DNR — no further contact",danger:true}].map(f=>(
            <div key={f.k} style={{display:"flex",alignItems:"center",gap:13,padding:"13px 15px",background:fv(f.k)?(f.danger?"rgba(239,68,68,0.06)":"rgba(52,211,153,0.06)"):"rgba(255,255,255,0.03)",border:`1px solid ${fv(f.k)?(f.danger?"rgba(239,68,68,0.22)":"rgba(52,211,153,0.22)"):BR}`,borderRadius:10,transition:"all 0.2s"}}>
              <Tgl on={!!fv(f.k)} onChange={v=>sf(f.k,v)} danger={f.danger}/>
              <div><p style={{margin:0,fontSize:13,fontWeight:600,color:W}}>{f.l}</p><p style={{margin:"2px 0 0",fontSize:11,color:WM}}>{f.d}</p></div>
            </div>
          ))}
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",gap:10,paddingTop:16,borderTop:`1px solid ${BR}`,marginTop:16}}>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} className="bh" style={B.ghost}>Cancel</button>
          {!isNew&&canDelete&&<button onClick={()=>onDelete&&onDelete(form.id)} className="bh" style={B.danger}>🗑 Delete</button>}
        </div>
        <button onClick={()=>onSave(form)} className="bh" style={{...B.gold,display:"flex",alignItems:"center",gap:8}}>
          {isNew?"➕ Add Prospect":"💾 Save Changes"}
        </button>
      </div>
    </DW>
  );
}

/* ════════════════════════════════════════════════════════════════
   ADMIN PANEL
════════════════════════════════════════════════════════════════ */
function AdminPanel({currentUser,users,setUsers,onSaveUser,onDeleteUser,crmData,setCrmData,onSaveProspect,onDeleteProspect,onImportProspects,sysSettings,setSysSettings,onSaveSettings,auditLog,addAudit,onBack,onLogout,dbStatus}){
  const [tab,setTab]=useState("overview");
  const [toast,setToast]=useState(null);
  const [uDlg,setUDlg]=useState(null);
  const [pDlg,setPDlg]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const [uForm,setUForm]=useState({});
  const [fErr,setFErr]=useState("");
  const [srch,setSrch]=useState("");
  const [sfilt,setSfilt]=useState("All");
  const [showImport,setShowImport]=useState(false);
  const [settings,setSettings]=useState({...sysSettings});
  // sysSettings loads asynchronously from Supabase — if AdminPanel mounts
  // before that load finishes (or before the admin opens Settings/Plugins),
  // `settings` would be stuck with the initial (possibly empty) snapshot
  // and saving would overwrite real DB values with blanks. Keep `settings`
  // in sync with sysSettings until the admin starts editing, so freshly-
  // loaded API keys / settings always appear correctly.
  const settingsTouched=useRef(false);
  useEffect(()=>{
    if(!settingsTouched.current)setSettings({...sysSettings});
  },[sysSettings]);

  const isSuper=currentUser.role==="superadmin";
  const isAdmin=ROLES[currentUser.role].canAdmin;
  const t2=(msg,type="ok")=>{setToast({msg,type});setTimeout(()=>setToast(null),3200);};
  const uf=(k,v)=>setUForm(f=>({...f,[k]:v}));

  // User ops
  const openAddU=()=>{setUForm({username:"",password:"",name:"",email:"",role:"user",active:true});setFErr("");setUDlg("add");};
  const openEditU=u=>{setUForm({...u,password:""});setFErr("");setUDlg(u);};
  const saveU=async()=>{
    if(!uForm.name?.trim()||!uForm.username?.trim()||!uForm.email?.trim()){setFErr("All fields required.");return;}
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(uForm.email.trim())){setFErr("Enter a valid email — it is the user's login.");return;}
    if(uDlg==="add"&&!uForm.password?.trim()){setFErr("Password required for new users.");return;}
    if(uForm.password&&uForm.password.length<10){setFErr("Password must be at least 10 characters.");return;}
    if(uForm.role==="superadmin"&&!isSuper){setFErr("Only Super Admin can assign this role.");return;}
    try{
      if(uDlg==="add"){
        if(users.find(u=>u.username.toLowerCase()===uForm.username.toLowerCase())){setFErr("Username already exists.");return;}
        if(users.find(u=>(u.email||"").toLowerCase()===uForm.email.trim().toLowerCase())){setFErr("A user with that email already exists.");return;}
        // 1) real login in Supabase Auth (server-side)   2) CRM profile + role row
        await adminUsersCall({action:"create",email:uForm.email.trim(),password:uForm.password});
        const pw=isConfigured?"":await hashPassword(uForm.password); // hash only kept in demo mode
        const nu={...uForm,email:uForm.email.trim(),password:pw,id:uid(),createdAt:today(),lastLogin:null,avatar:initials(uForm.name)};
        await onSaveUser(nu);
        addAudit(currentUser.username,`Created user: ${nu.username} (${nu.role})`);t2(`User "${nu.username}" created.`);
      }else{
        if(uDlg.id===currentUser.id&&uForm.role!==currentUser.role){setFErr("Cannot change your own role.");return;}
        if(isConfigured&&uForm.email.trim().toLowerCase()!==(uDlg.email||"").toLowerCase()){setFErr("Email is the user's login and can't be changed. Delete and recreate the user instead.");return;}
        // Empty password field on edit = "leave unchanged".
        let pw=uDlg.password;
        if(uForm.password?.trim()){
          await adminUsersCall({action:"set_password",email:uDlg.email,password:uForm.password.trim()});
          pw=isConfigured?"":await hashPassword(uForm.password.trim());
        }
        const updated={...uDlg,...uForm,password:pw};
        await onSaveUser(updated);
        addAudit(currentUser.username,`Updated user: ${uForm.username}`);t2(`"${uForm.username}" updated.`);
      }
      setUDlg(null);
    }catch(e){setFErr(e.message||"Could not save user.");}
  };
  const deleteU=async u=>{if(u.id===currentUser.id){t2("Cannot delete yourself.","err");return;}try{await onDeleteUser(u.id);await adminUsersCall({action:"delete",email:u.email});}catch(e){t2(`Delete failed: ${e.message}`,"err");return;}addAudit(currentUser.username,`Deleted user: ${u.username}`);t2(`"${u.username}" deleted.`,"err");setConfirmDel(null);};
  const toggleActive=async u=>{if(u.id===currentUser.id){t2("Cannot deactivate yourself.","err");return;}try{await onSaveUser({...u,active:!u.active});}catch(e){t2(`Update failed: ${e.message}`,"err");return;}addAudit(currentUser.username,`${u.active?"Deactivated":"Activated"}: ${u.username}`);t2(`${u.name} ${u.active?"deactivated":"activated"}.`,u.active?"err":"ok");};

  // Prospect ops
  const saveP=async form=>{const isNew=!crmData.find(p=>p.id===form.id);await onSaveProspect(form);addAudit(currentUser.username,isNew?`Added: ${form.companyName}`:`Edited: ${form.companyName}`);t2(isNew?"Added!":"Saved!");setPDlg(null);};
  const deleteP=async id=>{const p=crmData.find(x=>x.id===id);await onDeleteProspect(id);addAudit(currentUser.username,`Deleted: ${p?.companyName||id}`);t2(`"${p?.companyName}" deleted.`,"err");setConfirmDel(null);setPDlg(null);};
  const saveSettings=async()=>{await onSaveSettings({...settings});settingsTouched.current=false;addAudit(currentUser.username,"Updated system settings");t2("Settings saved.");};

  const filtP=crmData.filter(p=>{const q=srch.toLowerCase();return(sfilt==="All"||p.currentStatus===sfilt)&&(!q||[p.companyName,p.contactName,p.market,p.vertical].some(v=>(v||"").toLowerCase().includes(q)));});
  const TABS=[{id:"overview",l:"📊 Overview"},{id:"users",l:"👥 Users"},{id:"crm",l:"🗄️ Prospects"},{id:"settings",l:"⚙️ Settings"},{id:"plugins",l:"🔌 Plugins"},{id:"audit",l:"📋 Audit Log"}];

  return(
    <div style={{minHeight:"100vh",background:N,color:W,fontFamily:"'Segoe UI',system-ui,sans-serif",display:"flex",flexDirection:"column"}}>
      <GS/>
      <header style={{background:NL,borderBottom:"2px solid rgba(168,85,247,0.22)",padding:"0 20px",height:56,display:"flex",alignItems:"center",gap:14,flexShrink:0,position:"sticky",top:0,zIndex:200,boxShadow:"0 2px 24px rgba(0,0,0,0.5)"}}>
        <div style={{width:34,height:34,background:"linear-gradient(135deg,#a855f7,#7c3aed)",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>🛡️</div>
        <div style={{flex:1}}><p style={{margin:0,fontSize:13,fontWeight:900,color:W,letterSpacing:"0.04em"}}>ADMIN PANEL</p><p style={{margin:0,fontSize:10,color:"rgba(192,132,252,0.65)"}}>NC Compliance CRM · System Administration</p></div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{padding:"3px 10px 3px 4px",background:"rgba(255,255,255,0.04)",border:`1px solid ${BR}`,borderRadius:24,display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:28,height:28,background:ROLES[currentUser.role]?.bg,border:`1.5px solid ${ROLES[currentUser.role]?.color}55`,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:ROLES[currentUser.role]?.color}}>{currentUser.avatar}</div>
            <div><p style={{margin:0,fontSize:11,fontWeight:700,color:W}}>{currentUser.name}</p><RPill role={currentUser.role}/></div>
          </div>
          <button onClick={onBack} className="bh" style={{...B.ghost,fontSize:11,padding:"7px 13px"}}>← Back to CRM</button>
          <button onClick={onLogout} className="bh" style={{...B.danger,fontSize:11,padding:"7px 13px"}}>Sign Out</button>
        </div>
      </header>

      <div style={{display:"flex",flex:1,overflow:"hidden",minHeight:0}}>
        <aside style={{width:195,background:NL,borderRight:`1px solid ${BR}`,display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{flex:1,padding:"14px 8px"}}>
            {TABS.map(tb=><button key={tb.id} onClick={()=>setTab(tb.id)} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"10px 12px",background:tab===tb.id?"rgba(201,150,58,0.1)":"transparent",border:"none",borderLeft:`3px solid ${tab===tb.id?G:"transparent"}`,borderRadius:"0 8px 8px 0",color:tab===tb.id?GL:WM,cursor:"pointer",fontSize:12,fontWeight:tab===tb.id?700:500,marginBottom:2,textAlign:"left",transition:"all 0.15s"}}>{tb.l}</button>)}
          </div>
          <div style={{padding:"12px",borderTop:`1px solid ${BR}`}}>
            <p style={{margin:"0 0 8px",fontSize:9,fontWeight:800,color:WD,textTransform:"uppercase",letterSpacing:"0.09em"}}>Live Stats</p>
            {[["Users",users.length,"#c084fc"],["Active",users.filter(u=>u.active).length,"#34d399"],["Prospects",crmData.length,GL],["Converted",crmData.filter(p=>p.currentStatus==="Converted").length,"#60a5fa"]].map(([l,v,c])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:11,color:WD}}>{l}</span><span style={{fontSize:13,fontWeight:800,color:c}}>{v}</span></div>
            ))}
          </div>
        </aside>

        <main style={{flex:1,overflowY:"auto",padding:"24px 26px"}}>

          {tab==="overview"&&(
            <div style={{animation:"fadeUp 0.3s ease"}}>
              <div style={{marginBottom:20}}><h2 style={{margin:0,fontSize:20,fontWeight:900,color:W}}>System Overview</h2><p style={{margin:"4px 0 0",fontSize:12,color:WM}}>Live metrics across all modules</p></div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:22}}>
                {[{l:"Total Users",v:users.length,c:"#c084fc",i:"👥"},{l:"Active Users",v:users.filter(u=>u.active).length,c:"#34d399",i:"✅"},{l:"Prospects",v:crmData.length,c:GL,i:"🏢"},{l:"Converted",v:crmData.filter(p=>p.currentStatus==="Converted").length,c:"#60a5fa",i:"🎯"},{l:"Flagged",v:crmData.filter(p=>p.flagToMelissa).length,c:"#f472b6",i:"🚩"},{l:"DNR",v:crmData.filter(p=>p.doNotRespond).length,c:"#f87171",i:"🚫"}].map(s=>(
                  <div key={s.l} style={{background:NC,border:`1px solid ${BR}`,borderRadius:12,padding:"14px 14px 12px",position:"relative",overflow:"hidden"}}>
                    <p style={{margin:0,fontSize:9.5,color:WD,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.l}</p>
                    <p style={{margin:"6px 0 0",fontSize:28,fontWeight:900,color:s.v>0?s.c:"rgba(255,255,255,0.12)",lineHeight:1}}>{s.v}</p>
                    <span style={{position:"absolute",top:11,right:12,fontSize:18,opacity:0.14}}>{s.i}</span>
                    <div style={{position:"absolute",bottom:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${s.c},transparent)`,opacity:0.5}}/>
                  </div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                <div style={{background:NC,border:`1px solid rgba(201,150,58,0.2)`,borderRadius:13,overflow:"hidden"}}>
                  <div style={{padding:"10px 15px",borderBottom:`1px solid ${BR}`,background:"rgba(201,150,58,0.07)"}}><p style={{margin:0,fontSize:10,fontWeight:800,color:GL,textTransform:"uppercase",letterSpacing:"0.07em"}}>Pipeline</p></div>
                  {STATUSES.map((s,i)=>{const c=crmData.filter(p=>p.currentStatus===s).length;return(
                    <div key={s} style={{display:"grid",gridTemplateColumns:"1fr auto auto",alignItems:"center",padding:"5px 13px",background:i%2?"rgba(255,255,255,0.016)":"transparent",borderBottom:`1px solid rgba(255,255,255,0.03)`}}>
                      <SBadge status={s} sm/><span style={{fontSize:14,fontWeight:800,color:W,textAlign:"center",padding:"0 11px",minWidth:24}}>{c}</span><span style={{fontSize:10,color:WD,minWidth:34,textAlign:"right"}}>{pct(c,crmData.length)}</span>
                    </div>
                  );})}
                </div>
                <div style={{background:NC,border:`1px solid ${BR}`,borderRadius:13,overflow:"hidden"}}>
                  <div style={{padding:"10px 15px",borderBottom:`1px solid ${BR}`,background:"rgba(255,255,255,0.03)"}}><p style={{margin:0,fontSize:10,fontWeight:800,color:WM,textTransform:"uppercase",letterSpacing:"0.07em"}}>User Roster</p></div>
                  {users.map((u,i)=>(
                    <div key={u.id} style={{display:"flex",alignItems:"center",gap:9,padding:"8px 13px",borderBottom:`1px solid rgba(255,255,255,0.03)`,background:i%2?"rgba(255,255,255,0.016)":"transparent"}}>
                      <div style={{width:30,height:30,background:ROLES[u.role]?.bg,border:`1.5px solid ${ROLES[u.role]?.color}55`,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:ROLES[u.role]?.color,flexShrink:0}}>{u.avatar}</div>
                      <div style={{flex:1,minWidth:0}}><p style={{margin:0,fontSize:12,fontWeight:700,color:W,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name}</p><p style={{margin:0,fontSize:10,color:WD}}>@{u.username}</p></div>
                      <RPill role={u.role}/>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab==="users"&&(
            <div style={{animation:"fadeUp 0.3s ease"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20}}>
                <div><h2 style={{margin:0,fontSize:20,fontWeight:900,color:W}}>User Accounts</h2><p style={{margin:"4px 0 0",fontSize:12,color:WM}}>Manage access levels and credentials</p></div>
                {isAdmin&&<button onClick={openAddU} className="bh" style={{...B.gold,flexShrink:0}}>+ Add User</button>}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:22}}>
                {users.map(u=>(
                  <div key={u.id} style={{background:NC,border:`1px solid ${u.id===currentUser.id?"rgba(201,150,58,0.4)":BR}`,borderRadius:13,padding:"14px 18px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                    <div style={{width:46,height:46,background:ROLES[u.role]?.bg,border:`2px solid ${ROLES[u.role]?.color}44`,borderRadius:13,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,color:ROLES[u.role]?.color,flexShrink:0}}>{u.avatar}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                        <span style={{fontSize:14,fontWeight:800,color:W}}>{u.name}</span>
                        <RPill role={u.role}/>
                        {u.id===currentUser.id&&<span style={{fontSize:10,color:GL,fontWeight:700}}>(You)</span>}
                        {!u.active&&<span style={{fontSize:9,color:"#f87171",border:"1px solid rgba(248,113,113,0.3)",borderRadius:20,padding:"1px 8px",fontWeight:700}}>INACTIVE</span>}
                      </div>
                      <div style={{display:"flex",gap:14,fontSize:11,color:WD,flexWrap:"wrap"}}><span>@{u.username}</span><span>{u.email}</span><span>Since {u.createdAt}</span>{u.lastLogin&&<span>Last: {u.lastLogin}</span>}</div>
                    </div>
                    {isAdmin&&u.id!==currentUser.id&&(
                      <div style={{display:"flex",gap:7,flexShrink:0}}>
                        <button onClick={()=>toggleActive(u)} className="bh" style={{...B[u.active?"danger":"green"],fontSize:11,padding:"6px 12px"}}>{u.active?"Deactivate":"Activate"}</button>
                        <button onClick={()=>openEditU(u)} className="bh" style={{...B.ghost,fontSize:11,padding:"6px 12px",color:GL,borderColor:"rgba(201,150,58,0.3)"}}>✏️ Edit</button>
                        {isSuper&&<button onClick={()=>setConfirmDel({type:"user",item:u})} className="bh" style={{...B.danger,fontSize:11,padding:"6px 10px"}}>🗑</button>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{background:NC,border:`1px solid ${BR}`,borderRadius:13,overflow:"hidden"}}>
                <div style={{padding:"10px 15px",borderBottom:`1px solid ${BR}`,background:"rgba(255,255,255,0.03)"}}><p style={{margin:0,fontSize:11,fontWeight:700,color:W}}>🔐 Role Permissions Matrix</p></div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead><tr style={{background:"rgba(255,255,255,0.03)"}}><th style={{textAlign:"left",padding:"8px 14px",color:WD,fontWeight:700}}>Role</th>{["View CRM","Add/Edit","Delete","Manage Users","Admin Panel","System Config"].map(h=><th key={h} style={{textAlign:"center",padding:"8px 10px",color:WD,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {Object.entries(ROLES).map(([key,r],i)=>(
                        <tr key={key} style={{borderTop:`1px solid rgba(255,255,255,0.04)`,background:i%2?"rgba(255,255,255,0.015)":"transparent"}}>
                          <td style={{padding:"8px 14px"}}><RPill role={key}/></td>
                          {[true,r.canEdit,r.canDelete,r.canManageUsers,r.canAdmin,r.canEditSystem].map((v,j)=><td key={j} style={{textAlign:"center",padding:"8px",fontSize:14}}>{v?"✅":"❌"}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab==="crm"&&(
            <div style={{animation:"fadeUp 0.3s ease"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
                <div><h2 style={{margin:0,fontSize:20,fontWeight:900,color:W}}>CRM — Prospects</h2><p style={{margin:"4px 0 0",fontSize:12,color:WM}}>{crmData.length} total records</p></div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  <button onClick={()=>setShowImport(true)} className="bh" style={{...B.purple,fontSize:11,display:"flex",gap:5,alignItems:"center"}}>📁 Import</button>
                  <button onClick={()=>{exportToExcel(crmData,"NC_CRM_Admin");t2("Exported!");}} className="bh" style={{...B.green,fontSize:11}}>⬇️ Export</button>
                  {isAdmin&&<button onClick={async()=>{if(window.confirm("Reset all CRM data? This will overwrite the database.")){await onImportProspects(SEED,"replace");addAudit(currentUser.username,"Reset CRM to seed");t2("Data reset.","err");}}} className="bh" style={{...B.danger,fontSize:11}}>↺ Reset</button>}
                  <button onClick={()=>setPDlg("add")} className="bh" style={{...B.gold,fontSize:11}}>+ Add</button>
                </div>
              </div>
              <div style={{display:"flex",gap:9,marginBottom:11,flexWrap:"wrap"}}>
                <div style={{position:"relative",flex:1,minWidth:180}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:12,color:WD}}>🔍</span><input value={srch} onChange={e=>setSrch(e.target.value)} placeholder="Search…" style={{...inp(),paddingLeft:30}}/></div>
                <select value={sfilt} onChange={e=>setSfilt(e.target.value)} style={{...inp(),width:"auto",minWidth:130,cursor:"pointer"}}><option value="All">All Statuses</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select>
                <span style={{fontSize:11,color:WD,alignSelf:"center"}}>{filtP.length}/{crmData.length}</span>
              </div>
              <div style={{background:NC,border:`1px solid rgba(201,150,58,0.18)`,borderRadius:13,overflow:"hidden"}}>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",minWidth:720}}>
                    <thead><tr style={{background:"rgba(255,255,255,0.04)",borderBottom:`1px solid rgba(255,255,255,0.07)`}}>{["Company","Contact","Vertical","Market","Status","Pri.","Actions"].map(h=><th key={h} style={{textAlign:"left",padding:"9px 13px",fontSize:10,color:WD,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {filtP.length===0&&<tr><td colSpan={7} style={{padding:"30px 0",textAlign:"center",color:WD,fontSize:13}}>No records match.</td></tr>}
                      {filtP.map((p,i)=>(
                        <tr key={p.id} className="rh" style={{borderBottom:`1px solid rgba(255,255,255,0.04)`,background:i%2?"rgba(255,255,255,0.015)":"transparent"}}>
                          <td style={{padding:"10px 13px"}}><p style={{margin:0,fontSize:12,fontWeight:700,color:W,maxWidth:170,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.companyName}</p><div style={{display:"flex",gap:4,marginTop:1}}>{p.flagToMelissa&&<span style={{fontSize:9,color:"#f472b6"}}>🚩</span>}{p.doNotRespond&&<span style={{fontSize:9,color:"#f87171"}}>🚫</span>}</div></td>
                          <td style={{padding:"10px 13px"}}><p style={{margin:0,fontSize:12,color:WM}}>{p.contactName||"—"}</p><p style={{margin:0,fontSize:10,color:WD}}>{p.title}</p></td>
                          <td style={{padding:"10px 13px",fontSize:11,color:WD,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.vertical||"—"}</td>
                          <td style={{padding:"10px 13px",fontSize:11,color:WD}}>{p.market||"—"}</td>
                          <td style={{padding:"10px 13px"}}><SBadge status={p.currentStatus} sm/></td>
                          <td style={{padding:"10px 13px",fontSize:14,fontWeight:800,color:parseInt(p.priorityScore)>=7?"#f472b6":parseInt(p.priorityScore)>=4?GL:"rgba(255,255,255,0.2)"}}>{p.priorityScore||"—"}</td>
                          <td style={{padding:"10px 13px"}}><div style={{display:"flex",gap:6}}><button onClick={()=>setPDlg(p)} className="bh" style={{...B.ghost,fontSize:10,padding:"4px 9px",color:GL,borderColor:"rgba(201,150,58,0.3)"}}>✏️</button>{isAdmin&&<button onClick={()=>setConfirmDel({type:"prospect",item:p})} className="bh" style={{...B.danger,fontSize:10,padding:"4px 9px"}}>🗑</button>}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab==="settings"&&(
            <div style={{animation:"fadeUp 0.3s ease",maxWidth:660}}>
              <div style={{marginBottom:20}}><h2 style={{margin:0,fontSize:20,fontWeight:900,color:W}}>System Settings</h2><p style={{margin:"4px 0 0",fontSize:12,color:WM}}>Global configuration — Admin only</p></div>
              {!isAdmin?(<div style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:13,padding:"32px 24px",textAlign:"center"}}><span style={{fontSize:40}}>🔒</span><p style={{margin:"12px 0 6px",fontSize:15,fontWeight:700,color:"#f87171"}}>Access Restricted</p><p style={{margin:0,fontSize:13,color:WM}}>Admin privileges required.</p></div>):(
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                {[{title:"CRM Identity",icon:"🏷️",fields:[{k:"siteName",l:"System Name"},{k:"orgName",l:"Organization Name"}]},{title:"Email & Outreach",icon:"📧",fields:[{k:"senderName",l:"Sender Name"},{k:"senderEmail",l:"Sender Email"},{k:"senderTitle",l:"Sender Title"},{k:"honeyLink",l:"Schedule / Honey Link"},{k:"website",l:"Website"}]}].map(sec=>(
                  <div key={sec.title} style={{background:NC,border:`1px solid ${BR}`,borderRadius:13,overflow:"hidden"}}>
                    <div style={{padding:"10px 17px",borderBottom:`1px solid ${BR}`,background:"rgba(255,255,255,0.03)"}}><p style={{margin:0,fontSize:12,fontWeight:700,color:W}}>{sec.icon} {sec.title}</p></div>
                    <div style={{padding:"15px 17px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{sec.fields.map(f=><FG key={f.k} label={f.l}><input value={settings[f.k]||""} onChange={e=>{settingsTouched.current=true;setSettings(s=>({...s,[f.k]:e.target.value}));}} style={inp()}/></FG>)}</div>
                  </div>
                ))}
                <div style={{background:NC,border:`1px solid ${BR}`,borderRadius:13,overflow:"hidden"}}>
                  <div style={{padding:"10px 17px",borderBottom:`1px solid ${BR}`,background:"rgba(255,255,255,0.03)"}}><p style={{margin:0,fontSize:12,fontWeight:700,color:W}}>📦 Capacity</p></div>
                  <div style={{padding:"15px 17px"}}><FG label="Max Prospects"><input type="number" value={settings.maxProspects||1000} onChange={e=>{settingsTouched.current=true;setSettings(s=>({...s,maxProspects:parseInt(e.target.value)||1000}));}} style={{...inp(),width:200}}/></FG><div style={{marginTop:10,display:"flex",alignItems:"center",gap:12}}><div style={{flex:1,height:6,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",background:`linear-gradient(90deg,${G},#34d399)`,borderRadius:3,width:Math.min((crmData.length/(settings.maxProspects||1000))*100,100)+"%"}}/></div><span style={{fontSize:11,color:WD,whiteSpace:"nowrap"}}>{crmData.length}/{settings.maxProspects||1000}</span></div></div>
                </div>
                {isSuper&&(
                  <div style={{background:NC,border:`1px solid ${BR}`,borderRadius:13,overflow:"hidden"}}>
                    <div style={{padding:"10px 17px",borderBottom:`1px solid ${BR}`,background:"rgba(255,255,255,0.03)"}}><p style={{margin:0,fontSize:12,fontWeight:700,color:W}}>⚙️ Behavior Flags</p></div>
                    <div style={{padding:"15px 17px",display:"flex",flexDirection:"column",gap:10}}>
                      {[{k:"requireMelissaApproval",l:"Require Melissa approval before Touch 3",d:"Blocks T3 queue until flagged and approved"},{k:"autoArchiveDNR",l:"Auto-archive DNR after 30 days",d:"Removes from active pipeline"},{k:"emailGmailDefault",l:"Use Gmail compose by default",d:"Opens Gmail for outreach emails"}].map(f=>(
                        <div key={f.k} style={{display:"flex",alignItems:"flex-start",gap:13,padding:"11px 13px",background:"rgba(255,255,255,0.03)",borderRadius:9,border:`1px solid ${BR}`}}>
                          <Tgl on={!!settings[f.k]} onChange={v=>{settingsTouched.current=true;setSettings(s=>({...s,[f.k]:v}));}}/>
                          <div><p style={{margin:0,fontSize:13,fontWeight:600,color:W}}>{f.l}</p><p style={{margin:"3px 0 0",fontSize:11,color:WM}}>{f.d}</p></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={saveSettings} className="bh" style={{...B.gold,alignSelf:"flex-start",padding:"12px 28px",fontSize:13}}>💾 Save All Settings</button>
              </div>
              )}
            </div>
          )}

          {tab==="plugins"&&(
            <div style={{animation:"fadeUp 0.3s ease",maxWidth:660}}>
              <div style={{marginBottom:20}}><h2 style={{margin:0,fontSize:20,fontWeight:900,color:W}}>🔌 Plugin Integrations</h2><p style={{margin:"4px 0 0",fontSize:12,color:WM}}>Connect external tools for automated prospect discovery</p></div>
              {[{id:"apollo",name:"Apollo.io",icon:"🚀",color:"#7c3aed",desc:"B2B contact & company database with 275M+ profiles. Automates prospect discovery and email finding.",key:"apolloKey",service:"apollo",docs:"https://apolloio.github.io/apollo-api-docs/",features:["Contact search","Email verification","Company firmographics","Bulk export"]},
                {id:"hunter",name:"Hunter.io",icon:"🎯",color:"#f59e0b",desc:"Email finding and verification tool. Finds professional email addresses from company domains.",key:"hunterKey",service:"hunter",docs:"https://hunter.io/api-documentation/v2",features:["Domain search","Email finder","Email verifier","Bulk tasks"]},
                {id:"anthropic",name:"Claude AI (Anthropic)",icon:"🤖",color:"#c084fc",desc:"Anthropic Claude API for intelligent prospect research, context analysis, and personalized outreach drafts.",key:"anthropicKey",service:"anthropic",docs:"https://docs.anthropic.com",features:["Prospect research","Outreach drafting","Pain point analysis","Fit scoring"]},
              ].map(p=>(
                <div key={p.id} style={{background:NC,border:`1px solid ${p.color}33`,borderRadius:13,overflow:"hidden",marginBottom:13}}>
                  <div style={{padding:"12px 18px",borderBottom:`1px solid ${BR}`,background:`rgba(255,255,255,0.03)`,display:"flex",alignItems:"center",gap:12}}>
                    <span style={{fontSize:22}}>{p.icon}</span>
                    <div style={{flex:1}}><p style={{margin:0,fontSize:13,fontWeight:800,color:W}}>{p.name}</p><p style={{margin:0,fontSize:11,color:WM}}>{p.desc}</p></div>
                    <a href={p.docs} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:p.color,textDecoration:"none",border:`1px solid ${p.color}44`,borderRadius:7,padding:"4px 10px"}}>Docs ↗</a>
                  </div>
                  <div style={{padding:"14px 18px"}}>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:13}}>
                      {p.features.map(f=><span key={f} style={{fontSize:10,color:p.color,background:`${p.color}18`,border:`1px solid ${p.color}33`,borderRadius:6,padding:"2px 8px"}}>{f}</span>)}
                    </div>
                    {isAdmin?(
                      <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
                        <div style={{flex:1}}>
                          <label style={{...LBL,color:`${p.color}cc`}}>API Key</label>
                          <input type="password" autoComplete="off" value={settings[p.key]===KEY_MASK?"":(settings[p.key]||"")} onChange={e=>{settingsTouched.current=true;setSettings(s=>({...s,[p.key]:e.target.value}));}} placeholder={settings[p.key]===KEY_MASK?"•••••••• saved securely — type a new key to replace":`Enter your ${p.name} API key…`} style={inp()}/>
                        </div>
                        <button onClick={async()=>{
                          const newKey=settings[p.key]||"";
                          if(isConfigured&&(newKey===KEY_MASK||!newKey.trim())){t2("Type a new key to replace the saved one.","err");return;}
                          if(isConfigured){
                            try{
                              await DB.saveApiCredential(p.service,newKey.trim());
                              // The key now lives server-side only; the browser keeps just a marker.
                              setSysSettings(s=>({...s,[p.key]:KEY_MASK}));
                              setSettings(s=>({...s,[p.key]:KEY_MASK}));
                              addAudit(currentUser.username,`Updated ${p.name} API key`);
                              t2(`${p.name} key saved securely on the server.`);
                            }catch(e){
                              t2(`Could not save ${p.name} key: ${e.message}`,"err");
                            }
                          }else{
                            setSysSettings(s=>({...s,[p.key]:newKey}));
                            addAudit(currentUser.username,`Updated ${p.name} API key (local only — Supabase not configured)`);
                            t2(`${p.name} key set for this session (Supabase not configured — won't persist).`,"err");
                          }
                        }} className="bh" style={{...B.gold,fontSize:11,padding:"9px 16px",flexShrink:0}}>Save Key</button>
                      </div>
                    ):(
                      <div style={{padding:"10px 14px",background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:8,fontSize:12,color:"#f87171"}}>🔒 Admin access required to configure API keys.</div>
                    )}
                    <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:settings[p.key]?"#34d399":"#94a3b8",flexShrink:0}}/>
                      <span style={{fontSize:11,color:settings[p.key]?"#34d399":WD}}>{settings[p.key]?"Connected — key configured":"Not connected — enter API key above"}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div style={{background:"rgba(96,165,250,0.06)",border:"1px solid rgba(96,165,250,0.2)",borderRadius:13,padding:16}}>
                <p style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:"#60a5fa"}}>💡 How Plugins Work</p>
                <p style={{margin:"0 0 6px",fontSize:12,color:WM}}>Once connected, these plugins are available in the <strong style={{color:W}}>Prospect Finder</strong> search engine. Select the desired source before running a search to pull live results from that platform.</p>
                <p style={{margin:0,fontSize:11,color:WD}}>Note: Apollo.io and Hunter.io require paid subscription API keys. Claude AI uses your Anthropic API key.</p>
              </div>
            </div>
          )}

          {tab==="audit"&&(
            <div style={{animation:"fadeUp 0.3s ease"}}>
              <div style={{marginBottom:20}}><h2 style={{margin:0,fontSize:20,fontWeight:900,color:W}}>Audit Log</h2><p style={{margin:"4px 0 0",fontSize:12,color:WM}}>All system actions recorded in real time</p></div>
              <div style={{background:NC,border:`1px solid ${BR}`,borderRadius:13,overflow:"hidden"}}>
                {[...auditLog].reverse().map((log,i)=>(
                  <div key={i} className="rh" style={{display:"flex",alignItems:"center",gap:14,padding:"11px 18px",borderBottom:`1px solid rgba(255,255,255,0.04)`,background:i%2?"rgba(255,255,255,0.015)":"transparent"}}>
                    <span style={{fontSize:11,color:WD,fontFamily:"monospace",whiteSpace:"nowrap",flexShrink:0}}>{log.time}</span>
                    <span style={{fontSize:11,fontWeight:700,color:GL,whiteSpace:"nowrap",flexShrink:0}}>@{log.user}</span>
                    <span style={{fontSize:12,color:WM,flex:1}}>{log.action}</span>
                  </div>
                ))}
                {auditLog.length===0&&<p style={{padding:"30px 0",textAlign:"center",color:WD,margin:0}}>No activity yet.</p>}
              </div>
            </div>
          )}
        </main>
      </div>

      {toast&&<Toast msg={toast.msg} type={toast.type}/>}

      {showImport&&<ExcelImportModal onClose={()=>setShowImport(false)} onImport={async(rows,mode)=>{await onImportProspects(rows,mode);addAudit(currentUser.username,`Imported ${rows.length} prospects (${mode})`);setShowImport(false);t2(`${rows.length} imported!`);}}/>}
      {pDlg&&<ProspectModal prospect={pDlg==="add"?{...EMPTY_P,id:uid()}:pDlg} isNew={pDlg==="add"} onSave={saveP} onDelete={id=>setConfirmDel({type:"prospect",item:crmData.find(p=>p.id===id)})} onClose={()=>setPDlg(null)} canDelete={isAdmin}/>}

      {confirmDel&&<DW onClose={()=>setConfirmDel(null)} title="Confirm Delete" width={380}>
        <div style={{textAlign:"center",padding:"8px 0"}}>
          <span style={{fontSize:44}}>⚠️</span>
          <p style={{margin:"14px 0 8px",fontSize:15,fontWeight:800,color:W}}>Delete {confirmDel.type==="user"?"User":"Prospect"}?</p>
          <p style={{margin:"0 0 22px",fontSize:13,color:WM}}>{confirmDel.type==="user"?`"${confirmDel.item.name}" (@${confirmDel.item.username})`:`"${confirmDel.item.companyName}"`} will be permanently removed.</p>
          <div style={{display:"flex",gap:10,justifyContent:"center"}}>
            <button onClick={()=>setConfirmDel(null)} className="bh" style={B.ghost}>Cancel</button>
            <button onClick={()=>confirmDel.type==="user"?deleteU(confirmDel.item):deleteP(confirmDel.item.id)} className="bh" style={B.danger}>Delete Permanently</button>
          </div>
        </div>
      </DW>}

      {uDlg&&<DW onClose={()=>setUDlg(null)} title={uDlg==="add"?"Create New User":`Edit — ${uDlg.username||""}`} width={500}>
        <div style={{display:"flex",flexDirection:"column",gap:13}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <FG label="Full Name *"><input value={uForm.name||""} onChange={e=>uf("name",e.target.value)} placeholder="Jane Doe" style={inp()}/></FG>
            <FG label="Username *"><input value={uForm.username||""} onChange={e=>uf("username",e.target.value.toLowerCase().replace(/\s/g,""))} placeholder="janedoe" style={inp()} disabled={uDlg!=="add"}/></FG>
          </div>
          <FG label="Email *"><input type="email" value={uForm.email||""} onChange={e=>uf("email",e.target.value)} placeholder="jane@company.com" style={inp()}/></FG>
          <FG label={uDlg==="add"?"Password *":"New Password (optional)"}><input type="text" value={uForm.password||""} onChange={e=>uf("password",e.target.value)} placeholder={uDlg==="add"?"Min 4 characters":"Leave blank to keep current password"} style={inp()}/></FG>
          <FG label="Role / Access Level *">
            <select value={uForm.role||"user"} onChange={e=>uf("role",e.target.value)} style={{...inp(),cursor:"pointer"}}>
              {Object.entries(ROLES).map(([k,r])=>k==="superadmin"&&!isSuper?null:<option key={k} value={k}>{r.icon} {r.label}</option>)}
            </select>
            <p style={{margin:"5px 0 0",fontSize:11,color:WD}}>{{superadmin:"Full system control.",admin:"Manage users, CRM, settings & plugins.",manager:"Full CRM + approvals.",user:"Add/edit prospects.",viewer:"View-only access."}[uForm.role||"user"]}</p>
          </FG>
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 13px",background:"rgba(255,255,255,0.03)",borderRadius:9,border:`1px solid ${BR}`}}>
            <Tgl on={!!uForm.active} onChange={v=>uf("active",v)}/><span style={{fontSize:13,color:WM}}>Account Active</span>
          </div>
          {fErr&&<div style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#f87171"}}>⚠️ {fErr}</div>}
          <div style={{display:"flex",justifyContent:"flex-end",gap:10,paddingTop:4}}>
            <button onClick={()=>setUDlg(null)} className="bh" style={B.ghost}>Cancel</button>
            <button onClick={saveU} className="bh" style={B.gold}>{uDlg==="add"?"Create User":"Save Changes"}</button>
          </div>
        </div>
      </DW>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   EMAIL TEMPLATES
════════════════════════════════════════════════════════════════ */
const EMAIL_TEMPLATES=[
  {id:"t1_standard",touch:"T1",name:"Touch 1 — Standard Introduction",subject:"HR Compliance Support for {company}",body:`Hi {contact},

I hope this message finds you well.

My name is {senderName} and I'm the {senderTitle} at {orgName}. We specialize in HR compliance for organizations like {company} — helping you stay ahead of FLSA, I-9, and classification requirements that are increasingly scrutinized in North Carolina.

I noticed {company} operates in the {vertical} space, and we've worked with similar organizations in {market} that faced {painPoint}.

Would you be open to a 15-minute call to see if there's a fit?

{scheduleLink}

Best,
{senderName}
{senderTitle} | {orgName}
{website}`},
  {id:"t1_nonprofit",touch:"T1",name:"Touch 1 — Nonprofit Focused",subject:"HR Compliance for {company}",body:`Hi {contact},

I wanted to reach out because nonprofit organizations like {company} often face unique HR compliance challenges — from volunteer vs. employee classification to FLSA exemptions and grant-funded position documentation.

We've helped several nonprofits in {market} build solid HR foundations without breaking the budget.

Would a quick 15-minute conversation be worth your time?

{scheduleLink}

Warm regards,
{senderName}
{senderTitle} | {orgName}
{website}`},
  {id:"t2_followup",touch:"T2",name:"Touch 2 — Gentle Follow-Up",subject:"Following up — HR Compliance for {company}",body:`Hi {contact},

I wanted to follow up on my message from last week regarding HR compliance support for {company}.

I understand your inbox is busy, so I'll keep this brief: our team helps organizations in {market} avoid costly misclassification penalties and stay FLSA-compliant.

If the timing isn't right, I completely understand — just let me know and I'll circle back when it's more convenient.

{scheduleLink}

Best,
{senderName}
{orgName} | {website}`},
  {id:"t3_final",touch:"T3",name:"Touch 3 — Final Outreach",subject:"Last note — HR Compliance, {company}",body:`Hi {contact},

I'll make this my last note for now.

We've helped several {vertical} organizations in North Carolina reduce HR compliance risk significantly. If {company} ever needs support with classification, documentation, or policy development, I'd love to connect.

I'll leave the door open — feel free to reach out any time at {senderEmail} or book a time directly:

{scheduleLink}

Thank you for your time,
{senderName}
{senderTitle} | {orgName}
{website}`},
  {id:"custom",touch:"Custom",name:"Custom Message",subject:"",body:""},
];

/* ════════════════════════════════════════════════════════════════
   MOCK INBOX EMAILS
════════════════════════════════════════════════════════════════ */
const MOCK_INBOX=[
  {id:"rx1",from:"Sandra Kim",fromEmail:"sandra@brighthorizons-nc.com",subject:"Re: HR Compliance Support for Bright Horizons Childcare",preview:"Hi Melissa, thanks for reaching out. We've actually been dealing with some classification questions…",body:"Hi Melissa,\n\nThanks for reaching out. We've actually been dealing with some classification questions around our part-time staff and would love to connect.\n\nCould we schedule a call next Tuesday at 2pm?\n\nBest,\nSandra",date:"2026-06-04 09:22",read:false,starred:true,prospectId:2,touch:"T1",sentiment:"positive",label:"reply"},
  {id:"rx2",from:"Marcus Webb",fromEmail:"mwebb@trianglelogistics.com",subject:"Re: HR Compliance — Triangle Logistics Partners",preview:"Hello, we're not currently looking for HR services. Please remove us from your list.",body:"Hello,\n\nWe're not currently looking for HR services. Please remove us from your list.\n\nMarcus Webb\nOperations Manager",date:"2026-06-03 14:45",read:true,starred:false,prospectId:4,touch:"T3",sentiment:"negative",label:"dnr"},
  {id:"rx3",from:"Dr. Angela Foster",fromEmail:"afoster@nchopefoundation.org",subject:"Re: HR Compliance for NC Hope Foundation",preview:"Hi there, I saw your message. We are a small nonprofit and honestly don't have much budget right now…",body:"Hi there,\n\nI saw your message. We are a small nonprofit and honestly don't have much budget right now, but the topic is relevant. Can you send some information about pricing?\n\nDr. Angela Foster\nExecutive Director",date:"2026-06-02 11:10",read:false,starred:false,prospectId:3,touch:"T1",sentiment:"neutral",label:"reply"},
  {id:"rx4",from:"Linda Torres",fromEmail:"ltorres@communitycare-nc.org",subject:"Out of Office: Re: HR Compliance Support",preview:"I am currently out of office and will return June 10th. For urgent matters…",body:"I am currently out of office and will return June 10th.\n\nFor urgent matters, please contact our office directly.\n\nLinda Torres",date:"2026-06-01 08:33",read:true,starred:false,prospectId:5,touch:"T1",sentiment:"neutral",label:"ooo"},
  {id:"rx5",from:"Keith Reynolds",fromEmail:"kreynolds@pbancnc.com",subject:"Re: HR Compliance for Piedmont Builders Alliance",preview:"Melissa — I forwarded your email to our HR consultant. She may reach out.",body:"Melissa —\n\nI forwarded your email to our HR consultant. She may reach out if she thinks there's a fit.\n\nKeith",date:"2026-05-31 16:20",read:true,starred:true,prospectId:null,touch:"T2",sentiment:"neutral",label:"reply"},
];

const MOCK_SENT=[
  {id:"sx1",to:"Sandra Kim",toEmail:"sandra@brighthorizons-nc.com",subject:"HR Compliance Support for Bright Horizons Childcare",date:"2026-05-28 09:00",touch:"T1",opened:true,prospectId:2,via:"demo"},
  {id:"sx2",to:"Bob Marshall",toEmail:"bobmarshall@comfortkeepers.com",subject:"Touch 3 — HR Compliance, Comfort Keepers",date:"2026-05-19 09:30",touch:"T3",opened:true,prospectId:1,via:"demo"},
  {id:"sx3",to:"Dr. Angela Foster",toEmail:"afoster@nchopefoundation.org",subject:"HR Compliance for NC Hope Foundation",date:"2026-06-01 10:00",touch:"T1",opened:false,prospectId:3,via:"demo"},
  {id:"sx4",to:"Marcus Webb",toEmail:"mwebb@trianglelogistics.com",subject:"Following up — HR Compliance for Triangle Logistics",date:"2026-05-22 09:15",touch:"T2",opened:true,prospectId:4,via:"demo"},
  {id:"sx5",to:"Linda Torres",toEmail:"ltorres@communitycare-nc.org",subject:"HR Compliance Support for Community Care Services",date:"2026-06-01 09:45",touch:"T1",opened:true,prospectId:5,via:"demo"},
];

/* ════════════════════════════════════════════════════════════════
   EMAIL HUB COMPONENT
════════════════════════════════════════════════════════════════ */
function EmailHub({crmData,setCrmData,q1,q2,q3,totalDue,qStatus,canEdit,currentUser,sysSettings,onViewProspect,t2}){
  const [etab,setEtab]=useState("queue");
  const [inbox,setInbox]=useState(MOCK_INBOX);
  const [sent,setSent]=useState(MOCK_SENT);
  const [inboxSearch,setInboxSearch]=useState("");
  const [selectedEmail,setSelectedEmail]=useState(null);
  const [compose,setCompose]=useState(null);
  const [inboxConnected,setInboxConnected]=useState(false);
  const [connecting,setConnecting]=useState(false);
  const [usingRealGmail,setUsingRealGmail]=useState(false);

  // Auto-connect inbox if the user signed in with Google (token already present)
  useEffect(() => {
    if (isGmailConnected() && !inboxConnected) {
      connectInbox();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load sent-email history from Supabase on mount (persists across refreshes)
  useEffect(() => {
    if (!isConfigured) return;
    DB.getEmails().then(rows => {
      if (rows && rows.length > 0) {
        const mapped = rows.map(r => ({
          id: r.id,
          to: r.to_name || r.to_email,
          toEmail: r.to_email,
          subject: r.subject,
          date: (r.sent_at || "").slice(0,16).replace("T"," "),
          touch: r.touch || "Custom",
          opened: !!r.opened,
          prospectId: r.prospect_id || null,
          via: r.from_email ? "gmail" : "demo",
        }));
        setSent(mapped);
        dlog("[NC CRM] Loaded", mapped.length, "sent emails from DB");
      }
    }).catch(e => dwarn("[NC CRM] Could not load email history:", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selectedTemplate,setSelectedTemplate]=useState("t1_standard");
  const [composeForm,setComposeForm]=useState({to:"",subject:"",body:"",cc:"",bcc:""});
  const [sending,setSending]=useState(false);
  const [inboxFilter,setInboxFilter]=useState("all");

  const unread=inbox.filter(e=>!e.read).length;
  const replies=inbox.filter(e=>e.label==="reply").length;

  const connectInbox=async()=>{
    setConnecting(true);
    if (isGmailConnected()) {
      const result = await fetchGmailInbox(15);
      setConnecting(false);
      if (result.ok) {
        if (result.messages.length > 0) {
          setInbox(result.messages);
          t2(`Gmail connected! Loaded ${result.messages.length} messages.`);
        } else {
          setInbox([]);
          t2("Gmail connected — your inbox is empty.");
        }
        setInboxConnected(true);
        setUsingRealGmail(true);
      } else if (result.reason === "no_token") {
        // Shouldn't happen if isGmailConnected() returned true, but just in case
        setInboxConnected(true);
        setUsingRealGmail(false);
        setInbox(MOCK_INBOX);
        t2("Showing demo inbox — Gmail token unavailable.");
      } else {
        // Gmail API error (e.g. token expired or scopes missing)
        setInboxConnected(true);
        setUsingRealGmail(false);
        setInbox(MOCK_INBOX);
        t2("Couldn't load Gmail — showing demo inbox. Try signing out and back in.", "err");
      }
    } else {
      // Not signed in via Google — fall back to demo inbox
      setTimeout(()=>{
        setConnecting(false);
        setInboxConnected(true);
        setUsingRealGmail(false);
        setInbox(MOCK_INBOX);
        t2("Showing demo inbox. Sign in with Google to connect your real Gmail.");
      },900);
    }
  };

  const refreshInbox=async()=>{
    if (usingRealGmail) {
      const result = await fetchGmailInbox(15);
      if (result.ok) {
        setInbox(result.messages);
        t2(`Inbox refreshed — ${result.messages.length} messages.`);
      } else {
        t2("Couldn't refresh Gmail inbox.", "err");
      }
    } else {
      setInbox(MOCK_INBOX);
      t2("Demo inbox refreshed!");
    }
  };

  const fillTemplate=(tpl,prospect)=>{
    if(!tpl||!prospect)return{subject:tpl?.subject||"",body:tpl?.body||""};
    const replacements={
      "{company}":prospect.companyName||"","{contact}":prospect.contactName?.split(" ")[0]||"there",
      "{vertical}":prospect.vertical||"your industry","{market}":prospect.market||"your area",
      "{painPoint}":prospect.leadPainPoint||"HR compliance challenges",
      "{senderName}":sysSettings.senderName||"Melissa Pennington",
      "{senderTitle}":sysSettings.senderTitle||"Founder",
      "{orgName}":sysSettings.orgName||"HR On Demand",
      "{senderEmail}":sysSettings.senderEmail||"melissa@hrondemand.com",
      "{scheduleLink}":sysSettings.honeyLink||"[Schedule Link]",
      "{website}":sysSettings.website||"thehrondemand.com",
    };
    let subject=tpl.subject;let body=tpl.body;
    Object.entries(replacements).forEach(([k,v])=>{
      subject=subject.replaceAll(k,v);body=body.replaceAll(k,v);
    });
    return{subject,body};
  };

  const openCompose=(prospect,touchKey)=>{
    const tplId=touchKey==="t1"?"t1_standard":touchKey==="t2"?"t2_followup":touchKey==="t3"?"t3_final":"t1_standard";
    const tpl=EMAIL_TEMPLATES.find(t=>t.id===tplId)||EMAIL_TEMPLATES[0];
    const filled=fillTemplate(tpl,prospect);
    setComposeForm({to:prospect?.emailPhone||"",subject:filled.subject,body:filled.body,cc:"",bcc:"",prospectId:prospect?.id,touchKey});
    setCompose("write");
  };

  const sendEmail=async(prospect,touchKey)=>{
    setSending(true);
    const recipient = prospect?.emailPhone || composeForm.to;

    if (isGmailConnected()) {
      const result = await sendViaGmailAPI({
        to: recipient,
        cc: composeForm.cc,
        subject: composeForm.subject,
        body: composeForm.body,
      });
      setSending(false);
      if (result.ok) {
        const next=touchKey==="t1"?"T1 SENT":touchKey==="t2"?"T2 SENT":"NURTURE/T3 SENT";
        if(prospect)qStatus(prospect.id,next);
        const newSent={id:"sx"+uid(),to:prospect?.contactName||recipient,toEmail:recipient,subject:composeForm.subject,date:tsNow(),touch:touchKey==="t1"?"T1":touchKey==="t2"?"T2":"T3",opened:false,prospectId:prospect?.id||null,via:"gmail",gmailId:result.id};
        setSent(p=>[newSent,...p]);
        setCompose(null);
        t2(`✅ Email sent via Gmail to ${prospect?.companyName||recipient}!`);
        // Persist to Supabase emails table
        if (isConfigured) {
          DB.addEmail({
            prospect_id: (prospect?.id && /^[0-9a-f-]{36}$/.test(String(prospect.id))) ? prospect.id : null,
            to_email: recipient,
            to_name: prospect?.contactName || "",
            subject: composeForm.subject,
            body: composeForm.body,
            touch: newSent.touch,
            direction: "outbound",
            from_email: sessionStorage.getItem("google_email") || "",
            from_name: currentUser.name,
            opened: false,
            sent_at: new Date().toISOString(),
          }).catch(e => dwarn("[NC CRM] Could not save email to DB:", e.message));
        }
      } else {
        t2("Gmail send failed — opening Gmail compose instead.", "err");
        window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipient)}&su=${encodeURIComponent(composeForm.subject)}&body=${encodeURIComponent(composeForm.body)}`, "_blank");
      }
      return;
    }

    // Demo fallback — no Gmail connected
    setTimeout(()=>{
      const next=touchKey==="t1"?"T1 SENT":touchKey==="t2"?"T2 SENT":"NURTURE/T3 SENT";
      if(prospect)qStatus(prospect.id,next);
      const newSent={id:"sx"+uid(),to:prospect?.contactName||recipient,toEmail:recipient,subject:composeForm.subject,date:tsNow(),touch:touchKey==="t1"?"T1":touchKey==="t2"?"T2":"T3",opened:false,prospectId:prospect?.id||null,via:"demo"};
      setSent(p=>[newSent,...p]);
      setSending(false);setCompose(null);
      t2(`Email logged for ${prospect?.companyName||recipient} (demo mode — connect Gmail to send for real).`);
      if (isConfigured) {
        DB.addEmail({
          prospect_id: (prospect?.id && /^[0-9a-f-]{36}$/.test(String(prospect.id))) ? prospect.id : null,
          to_email: recipient,
          to_name: prospect?.contactName || "",
          subject: composeForm.subject,
          body: composeForm.body,
          touch: newSent.touch,
          direction: "outbound",
          from_email: "",
          from_name: currentUser.name,
          opened: false,
          sent_at: new Date().toISOString(),
        }).catch(e => dwarn("[NC CRM] Could not save email to DB:", e.message));
      }
    },800);
  };

  const markRead=id=>setInbox(p=>p.map(e=>e.id===id?{...e,read:true}:e));
  const markStar=id=>setInbox(p=>p.map(e=>e.id===id?{...e,starred:!e.starred}:e));
  const handleReplyAction=(email)=>{
    const prospect=crmData.find(p=>p.id===email.prospectId);
    if(prospect){
      setCrmData(prev=>prev.map(p=>p.id===prospect.id?{...p,replyReceived:true,flagToMelissa:true,currentStatus:"Replied"}:p));
      t2(`${prospect.companyName} flagged & marked Replied!`);
    }
    setInbox(prev=>prev.map(e=>e.id===email.id?{...e,read:true}:e));
  };
  const handleDNRAction=(email)=>{
    const prospect=crmData.find(p=>p.id===email.prospectId);
    if(prospect){setCrmData(prev=>prev.map(p=>p.id===prospect.id?{...p,doNotRespond:true,currentStatus:"Do Not Respond"}:p));t2(`${prospect.companyName} marked Do Not Respond.`,"err");}
    setInbox(prev=>prev.map(e=>e.id===email.id?{...e,read:true}:e));
  };

  const filtInbox=inbox.filter(e=>{
    const q=inboxSearch.toLowerCase();
    const matchQ=!q||(e.from+e.subject+e.preview).toLowerCase().includes(q);
    const matchF=inboxFilter==="all"||(inboxFilter==="unread"&&!e.read)||(inboxFilter==="starred"&&e.starred)||(inboxFilter==="replies"&&e.label==="reply")||(inboxFilter==="ooo"&&e.label==="ooo");
    return matchQ&&matchF;
  });

  const ETABS=[
    {id:"queue",l:"📤 Outreach Queue",badge:totalDue>0?totalDue:null},
    {id:"compose",l:"✏️ Compose"},
    {id:"inbox",l:"📥 Inbox",badge:unread>0?unread:null},
    {id:"sent",l:"📨 Sent"},
    {id:"templates",l:"📋 Templates"},
  ];

  const sentimentColor=s=>s==="positive"?"#34d399":s==="negative"?"#f87171":"#fbbf24";
  const sentimentLabel=s=>s==="positive"?"✅ Positive":s==="negative"?"❌ Negative":"➡️ Neutral";

  return(
    <div style={{display:"flex",height:"calc(100vh - 82px)",overflow:"hidden",animation:"fadeUp 0.3s ease"}}>
      {/* Left sidebar */}
      <div style={{width:200,background:NL,borderRight:`1px solid ${BR}`,display:"flex",flexDirection:"column",flexShrink:0}}>
        {/* Inbox connection */}
        <div style={{padding:"12px 12px 10px",borderBottom:`1px solid ${BR}`}}>
          {!inboxConnected?(
            <button onClick={connectInbox} disabled={connecting} className="bh" style={{...B.gold,width:"100%",fontSize:11,padding:"9px",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              {connecting?<><Spin s={12} c={N}/> Connecting…</>:<>🔗 Connect Inbox</>}
            </button>
          ):(
            <div style={{display:"flex",alignItems:"center",gap:7,padding:"7px 10px",background:usingRealGmail?"rgba(52,211,153,0.08)":"rgba(251,191,36,0.08)",border:`1px solid ${usingRealGmail?"rgba(52,211,153,0.22)":"rgba(251,191,36,0.22)"}`,borderRadius:8}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:usingRealGmail?"#34d399":"#fbbf24",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <p style={{margin:0,fontSize:10,fontWeight:700,color:usingRealGmail?"#34d399":"#fbbf24"}}>{usingRealGmail?"Gmail Connected":"Demo Inbox"}</p>
                <p style={{margin:0,fontSize:9,color:WD,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{usingRealGmail?(sessionStorage.getItem("google_email")||currentUser.email):"Sign in with Google for live Gmail"}</p>
              </div>
              <button onClick={()=>{setInboxConnected(false);setUsingRealGmail(false);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:WD,padding:2}}>✕</button>
            </div>
          )}
        </div>
        {/* Tabs */}
        <div style={{padding:"8px 6px",flex:1}}>
          {ETABS.map(t=>(
            <button key={t.id} onClick={()=>{setEtab(t.id);if(t.id==="compose")setCompose("write");else setCompose(null);}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"9px 10px",background:etab===t.id?"rgba(201,150,58,0.1)":"transparent",border:"none",borderLeft:`3px solid ${etab===t.id?G:"transparent"}`,borderRadius:"0 8px 8px 0",color:etab===t.id?GL:WM,cursor:"pointer",fontSize:12,fontWeight:etab===t.id?700:500,marginBottom:2,textAlign:"left",transition:"all 0.15s"}}>
              <span>{t.l}</span>
              {t.badge&&<span style={{background:etab===t.id?G:"rgba(255,255,255,0.12)",color:etab===t.id?N:W,borderRadius:20,padding:"1px 7px",fontSize:9,fontWeight:800}}>{t.badge}</span>}
            </button>
          ))}
        </div>
        {/* Stats */}
        <div style={{padding:"10px 12px",borderTop:`1px solid ${BR}`,fontSize:11}}>
          <p style={{margin:"0 0 6px",fontSize:9,fontWeight:800,color:WD,textTransform:"uppercase",letterSpacing:"0.08em"}}>Email Stats</p>
          {[["Queued",totalDue,GL],["Unread",unread,"#60a5fa"],["Replies",replies,"#34d399"],["Sent",sent.length,WM]].map(([l,v,c])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{color:WD}}>{l}</span><span style={{fontWeight:800,color:c}}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main content area */}
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",minWidth:0}}>

        {/* OUTREACH QUEUE */}
        {etab==="queue"&&(
          <div style={{padding:"18px 20px 40px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
              <div><h2 style={{margin:0,fontSize:16,fontWeight:800,color:W}}>📤 Outreach Queue</h2><p style={{margin:"3px 0 0",fontSize:11,color:WM}}>{totalDue} emails due across Touch 1–3 sequences</p></div>
              {canEdit&&<button onClick={()=>{setEtab("compose");setCompose("write");}} className="bh" style={{...B.gold,fontSize:11,display:"flex",gap:6,alignItems:"center"}}>✏️ New Email</button>}
            </div>
            {[{touch:"t1",label:"Touch 1",sub:"NEW prospects — first contact",queue:q1,color:GL,bg:"rgba(201,150,58,0.08)",bc:"rgba(201,150,58,0.25)",next:"T1 SENT"},
              {touch:"t2",label:"Touch 2",sub:"Follow-up — T1 sent, no reply",queue:q2,color:"#a78bfa",bg:"rgba(139,92,246,0.08)",bc:"rgba(139,92,246,0.25)",next:"T2 SENT"},
              {touch:"t3",label:"Touch 3",sub:"Final outreach — approved by Melissa",queue:q3,color:"#f472b6",bg:"rgba(236,72,153,0.08)",bc:"rgba(236,72,153,0.25)",next:"NURTURE/T3 SENT"}].map(({touch,label,sub,queue,color,bg,bc,next})=>(
              <div key={touch} style={{background:bg,border:`1px solid ${bc}`,borderRadius:13,overflow:"hidden",marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderBottom:`1px solid ${bc}`,flexWrap:"wrap",gap:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{background:color,color:N,borderRadius:8,padding:"3px 12px",fontSize:11,fontWeight:800}}>{label}</span>
                    <div><p style={{margin:0,fontSize:12,fontWeight:700,color:W}}>{queue.length} prospect{queue.length!==1?"s":""} due</p><p style={{margin:0,fontSize:10,color:WM}}>{sub}</p></div>
                  </div>
                  {queue.length>0&&canEdit&&(
                    <div style={{marginLeft:"auto",display:"flex",gap:7}}>
                      <button onClick={()=>queue.forEach(p=>qStatus(p.id,next))} style={{...B.green,fontSize:10,padding:"5px 11px"}}>✓ Mark All Sent</button>
                    </div>
                  )}
                </div>
                {queue.length===0
                  ?<div style={{padding:"14px 16px",display:"flex",gap:10,alignItems:"center"}}><span style={{fontSize:18}}>✅</span><span style={{fontSize:12,color:WD}}>All clear — no emails due for this touch.</span></div>
                  :<div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:8}}>
                    {queue.map(p=>(
                      <div key={p.id} style={{background:NL,border:`1px solid ${BR}`,borderRadius:10,padding:"12px 15px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                            <span style={{fontSize:13,fontWeight:700,color:W}}>{p.companyName}</span>
                            <SBadge status={p.currentStatus} sm/>
                            {p.priorityScore&&<span style={{fontSize:9,color:parseInt(p.priorityScore)>=7?"#f472b6":GL,border:`1px solid ${parseInt(p.priorityScore)>=7?"rgba(244,114,182,0.3)":"rgba(219,168,67,0.3)"}`,borderRadius:20,padding:"1px 7px",fontWeight:700}}>⭐ P{p.priorityScore}</span>}
                          </div>
                          <p style={{margin:0,fontSize:11,color:WM}}>{p.contactName} · <span style={{color:"#60a5fa"}}>{p.emailPhone}</span> · {p.market}</p>
                          {p.leadPainPoint&&<p style={{margin:"4px 0 0",fontSize:10,color:WD,fontStyle:"italic"}}>📌 {p.leadPainPoint}</p>}
                        </div>
                        {canEdit&&(
                          <div style={{display:"flex",gap:7,flexShrink:0,flexWrap:"wrap"}}>
                            <button onClick={()=>openCompose(p,touch)} className="bh" style={{...B.gold,fontSize:11,padding:"7px 13px",display:"flex",gap:5,alignItems:"center"}}>✏️ Compose</button>
                            {isGmailConnected()?(
                              <a href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(p.emailPhone)}&su=${encodeURIComponent("HR Compliance — "+p.companyName)}`} target="_blank" rel="noopener noreferrer" style={{background:"#EA4335",color:"#fff",borderRadius:8,padding:"7px 12px",fontSize:11,fontWeight:700,textDecoration:"none",display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                                Open in Gmail
                              </a>
                            ):(
                              <a href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(p.emailPhone)}&su=${encodeURIComponent("HR Compliance — "+p.companyName)}`} target="_blank" rel="noopener noreferrer" style={{background:"#EA4335",color:"#fff",borderRadius:8,padding:"7px 12px",fontSize:11,fontWeight:700,textDecoration:"none",display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                                Gmail
                              </a>
                            )}
                            <button onClick={()=>{qStatus(p.id,next);t2(`${p.companyName} → ${next}`);}} style={{...B.green,fontSize:11,padding:"7px 12px"}}>✓ Sent</button>
                            <button onClick={()=>onViewProspect(p)} style={{...B.ghost,fontSize:10,padding:"6px 10px"}}>View</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                }
              </div>
            ))}
          </div>
        )}

        {/* COMPOSE */}
        {(etab==="compose"||compose==="write")&&(
          <div style={{padding:"18px 20px 40px",maxWidth:780}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:10}}>
              <div><h2 style={{margin:0,fontSize:16,fontWeight:800,color:W}}>✏️ Compose Email</h2><p style={{margin:"3px 0 0",fontSize:11,color:WM}}>Use a template or write a custom message</p></div>
              {isGmailConnected()?(
                <span style={{fontSize:11,padding:"5px 12px",background:"rgba(52,211,153,0.1)",border:"1px solid rgba(52,211,153,0.25)",borderRadius:20,color:"#34d399",fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
                  <span style={{width:7,height:7,borderRadius:"50%",background:"#34d399"}}/> Sends via {sessionStorage.getItem("google_email")||"Gmail"}
                </span>
              ):(
                <span style={{fontSize:11,padding:"5px 12px",background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.25)",borderRadius:20,color:"#fbbf24",fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
                  <span style={{width:7,height:7,borderRadius:"50%",background:"#fbbf24"}}/> Demo mode — sign in with Google to send for real
                </span>
              )}
            </div>
            {/* Template picker */}
            <div style={{background:NL,border:`1px solid ${BR}`,borderRadius:12,padding:"14px 16px",marginBottom:14}}>
              <p style={{margin:"0 0 10px",fontSize:11,fontWeight:700,color:WM,textTransform:"uppercase",letterSpacing:"0.06em"}}>Load Template</p>
              <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                {EMAIL_TEMPLATES.map(t=>(
                  <button key={t.id} onClick={()=>{
                    setSelectedTemplate(t.id);
                    const prospect=crmData.find(p=>p.emailPhone===composeForm.to)||null;
                    const filled=fillTemplate(t,prospect);
                    setComposeForm(f=>({...f,subject:filled.subject,body:filled.body}));
                  }} style={{background:selectedTemplate===t.id?"rgba(201,150,58,0.15)":"rgba(255,255,255,0.04)",border:`1px solid ${selectedTemplate===t.id?"rgba(201,150,58,0.4)":BR}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:11,fontWeight:selectedTemplate===t.id?700:500,color:selectedTemplate===t.id?GL:WM}}>
                    <span style={{marginRight:5}}>{t.touch==="T1"?"📧":t.touch==="T2"?"📩":t.touch==="T3"?"📬":"📝"}</span>{t.name}
                  </button>
                ))}
              </div>
            </div>
            {/* Prospect quick-select */}
            <div style={{background:NL,border:`1px solid ${BR}`,borderRadius:12,padding:"14px 16px",marginBottom:14}}>
              <p style={{margin:"0 0 10px",fontSize:11,fontWeight:700,color:WM,textTransform:"uppercase",letterSpacing:"0.06em"}}>Send to Prospect</p>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {crmData.filter(p=>hasEM(p)).slice(0,8).map(p=>(
                  <button key={p.id} onClick={()=>{
                    const tpl=EMAIL_TEMPLATES.find(t=>t.id===selectedTemplate)||EMAIL_TEMPLATES[0];
                    const filled=fillTemplate(tpl,p);
                    setComposeForm(f=>({...f,to:p.emailPhone,subject:filled.subject,body:filled.body,prospectId:p.id}));
                  }} style={{background:composeForm.prospectId===p.id?"rgba(201,150,58,0.12)":"rgba(255,255,255,0.03)",border:`1px solid ${composeForm.prospectId===p.id?"rgba(201,150,58,0.35)":BR}`,borderRadius:8,padding:"6px 11px",cursor:"pointer",fontSize:11,color:composeForm.prospectId===p.id?GL:WM}}>
                    {p.companyName}
                  </button>
                ))}
              </div>
            </div>
            {/* Form */}
            <div style={{background:NL,border:`1px solid ${BR}`,borderRadius:12,padding:"16px"}}>
              <div style={{display:"flex",flexDirection:"column",gap:11}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11}}>
                  <FG label="To"><input value={composeForm.to} onChange={e=>setComposeForm(f=>({...f,to:e.target.value}))} placeholder="recipient@email.com" style={inp()}/></FG>
                  <FG label="CC (optional)"><input value={composeForm.cc} onChange={e=>setComposeForm(f=>({...f,cc:e.target.value}))} placeholder="cc@email.com" style={inp()}/></FG>
                </div>
                <FG label="Subject"><input value={composeForm.subject} onChange={e=>setComposeForm(f=>({...f,subject:e.target.value}))} placeholder="Email subject…" style={inp()}/></FG>
                <FG label="Message">
                  <textarea value={composeForm.body} onChange={e=>setComposeForm(f=>({...f,body:e.target.value}))} rows={14} style={{...inp(),resize:"vertical",lineHeight:1.6,fontFamily:"'Segoe UI',system-ui,sans-serif"}}/>
                </FG>
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"space-between",marginTop:14,flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",gap:7}}>
                  <a href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(composeForm.to)}&su=${encodeURIComponent(composeForm.subject)}&body=${encodeURIComponent(composeForm.body)}`} target="_blank" rel="noopener noreferrer" style={{...B.ghost,textDecoration:"none",display:"flex",alignItems:"center",gap:6,fontSize:11,padding:"8px 14px"}}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                    Open in Gmail
                  </a>
                  <button onClick={()=>setComposeForm({to:"",subject:"",body:"",cc:"",bcc:""})} style={{...B.ghost,fontSize:11,padding:"8px 14px"}}>Clear</button>
                </div>
                <button onClick={()=>{
                  const p=crmData.find(x=>x.id===composeForm.prospectId)||null;
                  const touchKey=selectedTemplate.startsWith("t1")?"t1":selectedTemplate.startsWith("t2")?"t2":selectedTemplate.startsWith("t3")?"t3":"t1";
                  sendEmail(p,touchKey);
                }} disabled={sending||!composeForm.to||!composeForm.subject} className="bh" style={{...B.gold,display:"flex",gap:8,alignItems:"center",fontSize:13,padding:"10px 24px",opacity:(!composeForm.to||!composeForm.subject)?0.45:1}}>
                  {sending?<><Spin s={14} c={N}/> Sending…</>:isGmailConnected()?"📤 Send via Gmail":"📤 Log Email (Demo)"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* INBOX */}
        {etab==="inbox"&&(
          <div style={{display:"flex",flex:1,overflow:"hidden",minHeight:0}}>
            {/* Email list */}
            <div style={{width:selectedEmail?320:undefined,flex:selectedEmail?undefined:1,borderRight:selectedEmail?`1px solid ${BR}`:"none",overflowY:"auto",display:"flex",flexDirection:"column"}}>
              {/* Inbox header */}
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${BR}`,flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <h3 style={{margin:0,fontSize:14,fontWeight:800,color:W,flex:1}}>📥 Inbox {unread>0&&<span style={{background:"#60a5fa",color:N,borderRadius:20,padding:"1px 8px",fontSize:10,fontWeight:800,marginLeft:6}}>{unread}</span>}</h3>
                  {!inboxConnected&&<button onClick={connectInbox} disabled={connecting} className="bh" style={{...B.blue,fontSize:10,padding:"5px 10px"}}>{connecting?<Spin s={10}/>:"🔗 Connect"}</button>}
                  {inboxConnected&&<button onClick={refreshInbox} style={{...B.ghost,fontSize:10,padding:"5px 10px"}}>↻ Refresh</button>}
                </div>
                <div style={{position:"relative",marginBottom:8}}>
                  <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",fontSize:11,color:WD}}>🔍</span>
                  <input value={inboxSearch} onChange={e=>setInboxSearch(e.target.value)} placeholder="Search inbox…" style={{...inp(),paddingLeft:28,fontSize:11}}/>
                </div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {[["all","All"],["unread","Unread"],["replies","Replies"],["starred","Starred"],["ooo","Out of Office"]].map(([k,l])=>(
                    <button key={k} onClick={()=>setInboxFilter(k)} style={{background:inboxFilter===k?"rgba(201,150,58,0.15)":"rgba(255,255,255,0.04)",border:`1px solid ${inboxFilter===k?"rgba(201,150,58,0.35)":BR}`,borderRadius:20,padding:"3px 10px",cursor:"pointer",fontSize:10,fontWeight:inboxFilter===k?700:500,color:inboxFilter===k?GL:WD}}>{l}</button>
                  ))}
                </div>
              </div>
              {/* Email rows */}
              {!inboxConnected&&(
                <div style={{padding:"32px 20px",textAlign:"center"}}>
                  <span style={{fontSize:40,display:"block",marginBottom:12}}>📥</span>
                  <p style={{margin:"0 0 6px",fontSize:13,fontWeight:700,color:W}}>Connect Your Inbox</p>
                  <p style={{margin:"0 0 16px",fontSize:11,color:WM}}>{isGmailConnected()?"You're signed in with Google — connect to load your real Gmail inbox.":"Sign in with Google on the login screen to connect your real Gmail, or view a demo inbox."}</p>
                  <button onClick={connectInbox} disabled={connecting} className="bh" style={{...B.gold,fontSize:12}}>
                    {connecting?<><Spin s={14} c={N}/> Connecting…</>:isGmailConnected()?"🔗 Connect Gmail Inbox":"🔗 Connect Inbox (Demo)"}
                  </button>
                  <p style={{margin:"12px 0 0",fontSize:10,color:WD}}>{isGmailConnected()?`Signed in as ${sessionStorage.getItem("google_email")||""}`:"Supports Gmail · Outlook · IMAP"}</p>
                </div>
              )}
              {inboxConnected&&filtInbox.map(e=>{
                const prospect=crmData.find(p=>p.id===e.prospectId);
                return(
                  <div key={e.id} onClick={()=>{setSelectedEmail(e);markRead(e.id);}} style={{padding:"12px 14px",borderBottom:`1px solid ${BR}`,cursor:"pointer",background:selectedEmail?.id===e.id?"rgba(201,150,58,0.08)":!e.read?"rgba(96,165,250,0.05)":"transparent",transition:"background 0.15s"}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:!e.read?"#60a5fa":"transparent",flexShrink:0,marginTop:5}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                          <span style={{fontSize:12,fontWeight:!e.read?700:600,color:W,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>{e.from}</span>
                          {e.starred&&<span style={{fontSize:11,color:"#fbbf24"}}>★</span>}
                          <span style={{marginLeft:"auto",fontSize:9,color:WD,flexShrink:0,whiteSpace:"nowrap"}}>{e.date.slice(5,16)}</span>
                        </div>
                        <p style={{margin:0,fontSize:11,color:!e.read?WM:WD,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:!e.read?600:400}}>{e.subject}</p>
                        <p style={{margin:"2px 0 0",fontSize:10,color:WD,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.preview}</p>
                        <div style={{display:"flex",gap:5,marginTop:5,flexWrap:"wrap"}}>
                          {prospect&&<span style={{fontSize:9,color:GL,border:"1px solid rgba(219,168,67,0.25)",borderRadius:6,padding:"1px 6px"}}>{prospect.companyName}</span>}
                          <span style={{fontSize:9,color:sentimentColor(e.sentiment),border:`1px solid ${sentimentColor(e.sentiment)}33`,borderRadius:6,padding:"1px 6px"}}>{sentimentLabel(e.sentiment)}</span>
                          {e.label==="ooo"&&<span style={{fontSize:9,color:"#fbbf24",border:"1px solid rgba(251,191,36,0.25)",borderRadius:6,padding:"1px 6px"}}>🏖 OOO</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {inboxConnected&&filtInbox.length===0&&(
                <div style={{padding:"32px 20px",textAlign:"center",color:WD,fontSize:12}}>No emails match your filter.</div>
              )}
            </div>

            {/* Email detail pane */}
            {selectedEmail&&(
              <div style={{flex:1,overflowY:"auto",padding:"18px 22px",minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                  <button onClick={()=>setSelectedEmail(null)} style={{...B.ghost,fontSize:11,padding:"5px 10px"}}>← Back</button>
                  <button onClick={()=>markStar(selectedEmail.id)} style={{...B.ghost,fontSize:13,padding:"5px 10px",color:selectedEmail.starred?"#fbbf24":WD}}>{selectedEmail.starred?"★":"☆"}</button>
                </div>
                <h3 style={{margin:"0 0 10px",fontSize:15,fontWeight:800,color:W,lineHeight:1.3}}>{selectedEmail.subject}</h3>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap",padding:"10px 14px",background:"rgba(255,255,255,0.03)",borderRadius:10,border:`1px solid ${BR}`}}>
                  <div style={{width:36,height:36,borderRadius:10,background:"rgba(96,165,250,0.15)",border:"1.5px solid rgba(96,165,250,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:"#60a5fa",flexShrink:0}}>{selectedEmail.from.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase()}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{margin:0,fontSize:13,fontWeight:700,color:W}}>{selectedEmail.from}</p>
                    <p style={{margin:0,fontSize:11,color:WD}}>{selectedEmail.fromEmail} · {selectedEmail.date}</p>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:9,padding:"3px 9px",background:`${sentimentColor(selectedEmail.sentiment)}18`,border:`1px solid ${sentimentColor(selectedEmail.sentiment)}44`,borderRadius:20,color:sentimentColor(selectedEmail.sentiment),fontWeight:700}}>{sentimentLabel(selectedEmail.sentiment)}</span>
                    {selectedEmail.touch&&<span style={{fontSize:9,padding:"3px 9px",background:"rgba(255,255,255,0.06)",border:`1px solid ${BR}`,borderRadius:20,color:WM}}>Touch {selectedEmail.touch}</span>}
                  </div>
                </div>
                {/* Linked prospect */}
                {crmData.find(p=>p.id===selectedEmail.prospectId)&&(
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"rgba(201,150,58,0.06)",border:"1px solid rgba(201,150,58,0.2)",borderRadius:10,marginBottom:14}}>
                    <span style={{fontSize:16}}>🏢</span>
                    <div style={{flex:1}}>
                      <p style={{margin:0,fontSize:12,fontWeight:700,color:GL}}>Linked Prospect: {crmData.find(p=>p.id===selectedEmail.prospectId)?.companyName}</p>
                      <p style={{margin:0,fontSize:10,color:WD}}>{crmData.find(p=>p.id===selectedEmail.prospectId)?.currentStatus} · Priority {crmData.find(p=>p.id===selectedEmail.prospectId)?.priorityScore||"—"}</p>
                    </div>
                    <button onClick={()=>onViewProspect(crmData.find(p=>p.id===selectedEmail.prospectId))} style={{...B.ghost,fontSize:10,padding:"5px 10px"}}>View Record</button>
                  </div>
                )}
                {/* Email body */}
                <div style={{background:NL,border:`1px solid ${BR}`,borderRadius:12,padding:"18px 20px",marginBottom:16}}>
                  <pre style={{margin:0,fontSize:13,color:WM,lineHeight:1.7,whiteSpace:"pre-wrap",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>{selectedEmail.body}</pre>
                </div>
                {/* Action buttons */}
                {canEdit&&(
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {selectedEmail.label==="reply"&&(
                      <button onClick={()=>handleReplyAction(selectedEmail)} className="bh" style={{...B.gold,fontSize:12,display:"flex",gap:6,alignItems:"center"}}>🚩 Flag to Melissa & Mark Replied</button>
                    )}
                    <button onClick={()=>{
                      // Match prospect by ID first, fall back to matching by email
                      // (real Gmail messages won't have prospectId pre-set)
                      const matchedProspect = selectedEmail.prospectId
                        ? crmData.find(p=>p.id===selectedEmail.prospectId)
                        : crmData.find(p=>(p.emailPhone||"").toLowerCase()===selectedEmail.fromEmail.toLowerCase());
                      const quoted = "\n\n---\nOn "+selectedEmail.date+", "+selectedEmail.from+" wrote:\n"+selectedEmail.body.split("\n").map(l=>"> "+l).join("\n");
                      setComposeForm({
                        to:selectedEmail.fromEmail,
                        subject: selectedEmail.subject.startsWith("Re:") ? selectedEmail.subject : "Re: "+selectedEmail.subject,
                        body: quoted,
                        cc:"", bcc:"",
                        prospectId: matchedProspect?.id ?? selectedEmail.prospectId ?? null,
                      });
                      setSelectedTemplate("custom");
                      setEtab("compose");setCompose("write");
                    }} className="bh" style={{...B.blue,fontSize:12,display:"flex",gap:6,alignItems:"center"}}>↩️ Reply</button>
                    {selectedEmail.label!=="dnr"&&<button onClick={()=>handleDNRAction(selectedEmail)} className="bh" style={{...B.danger,fontSize:12}}>🚫 Mark Do Not Respond</button>}
                    {!isGmailConnected()&&(
                      <a href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(selectedEmail.fromEmail)}&su=${encodeURIComponent("Re: "+selectedEmail.subject)}`} target="_blank" rel="noopener noreferrer" style={{...B.ghost,textDecoration:"none",display:"flex",alignItems:"center",gap:5,fontSize:12}}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                        Reply in Gmail
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* SENT */}
        {etab==="sent"&&(
          <div style={{padding:"18px 20px 40px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
              <div><h2 style={{margin:0,fontSize:16,fontWeight:800,color:W}}>📨 Sent Emails</h2><p style={{margin:"3px 0 0",fontSize:11,color:WM}}>{sent.length} emails · {sent.filter(e=>e.via==="gmail").length} via Gmail · {sent.filter(e=>e.opened).length} opened</p></div>
              {canEdit&&<button onClick={()=>{setEtab("compose");setCompose("write");}} className="bh" style={{...B.gold,fontSize:11,display:"flex",gap:6,alignItems:"center"}}>✏️ New Email</button>}
            </div>
            <div style={{background:NL,border:`1px solid ${BR}`,borderRadius:13,overflow:"hidden"}}>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:660}}>
                  <thead><tr style={{background:"rgba(255,255,255,0.04)",borderBottom:`1px solid rgba(255,255,255,0.07)`}}>
                    {["To","Subject","Touch","Sent Via","Date","Status"].map(h=><th key={h} style={{textAlign:"left",padding:"9px 14px",fontSize:10,color:WD,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",whiteSpace:"nowrap"}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {sent.length===0&&<tr><td colSpan={6} style={{padding:"32px 0",textAlign:"center",color:WD,fontSize:13}}>No emails sent yet.</td></tr>}
                    {sent.map((e,i)=>{
                      const prospect=crmData.find(p=>p.id===e.prospectId);
                      return(
                        <tr key={e.id} className="rh" style={{borderBottom:`1px solid rgba(255,255,255,0.04)`,background:i%2?"rgba(255,255,255,0.016)":"transparent"}}>
                          <td style={{padding:"10px 14px"}}>
                            <p style={{margin:0,fontSize:12,fontWeight:600,color:W}}>{e.to}</p>
                            {prospect&&<p style={{margin:0,fontSize:10,color:WD}}>{prospect.companyName}</p>}
                          </td>
                          <td style={{padding:"10px 14px",fontSize:12,color:WM,maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.subject}</td>
                          <td style={{padding:"10px 14px"}}><span style={{fontSize:10,padding:"2px 8px",background:e.touch==="T1"?"rgba(219,168,67,0.12)":e.touch==="T2"?"rgba(139,92,246,0.12)":"rgba(236,72,153,0.12)",border:`1px solid ${e.touch==="T1"?"rgba(219,168,67,0.3)":e.touch==="T2"?"rgba(139,92,246,0.3)":"rgba(236,72,153,0.3)"}`,borderRadius:6,color:e.touch==="T1"?GL:e.touch==="T2"?"#a78bfa":"#f472b6",fontWeight:700}}>Touch {e.touch}</span></td>
                          <td style={{padding:"10px 14px"}}>{e.via==="gmail"?<span style={{fontSize:10,color:"#34d399",display:"flex",alignItems:"center",gap:4}}><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg> Gmail</span>:<span style={{fontSize:10,color:WD}}>Demo log</span>}</td>
                          <td style={{padding:"10px 14px",fontSize:11,color:WD,whiteSpace:"nowrap"}}>{(e.date||"").slice(0,16)}</td>
                          <td style={{padding:"10px 14px"}}><span style={{fontSize:10,color:e.opened?"#34d399":WD,display:"flex",alignItems:"center",gap:4}}>{e.opened?<>✓ Opened</>:<>— Not opened</>}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TEMPLATES */}
        {etab==="templates"&&(
          <div style={{padding:"18px 20px 40px",maxWidth:780}}>
            <div style={{marginBottom:16}}><h2 style={{margin:0,fontSize:16,fontWeight:800,color:W}}>📋 Email Templates</h2><p style={{margin:"3px 0 0",fontSize:11,color:WM}}>Pre-written outreach templates — tokens auto-fill with prospect data</p></div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {EMAIL_TEMPLATES.filter(t=>t.id!=="custom").map(t=>(
                <div key={t.id} style={{background:NL,border:`1px solid ${BR}`,borderRadius:13,overflow:"hidden"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderBottom:`1px solid ${BR}`,background:"rgba(255,255,255,0.03)"}}>
                    <span style={{fontSize:18}}>{t.touch==="T1"?"📧":t.touch==="T2"?"📩":"📬"}</span>
                    <div style={{flex:1}}>
                      <p style={{margin:0,fontSize:13,fontWeight:700,color:W}}>{t.name}</p>
                      <p style={{margin:0,fontSize:10,color:WD}}>Subject: {t.subject}</p>
                    </div>
                    <span style={{fontSize:10,padding:"3px 10px",background:t.touch==="T1"?"rgba(219,168,67,0.12)":t.touch==="T2"?"rgba(139,92,246,0.12)":"rgba(236,72,153,0.12)",border:`1px solid ${t.touch==="T1"?"rgba(219,168,67,0.3)":t.touch==="T2"?"rgba(139,92,246,0.3)":"rgba(236,72,153,0.3)"}`,borderRadius:20,color:t.touch==="T1"?GL:t.touch==="T2"?"#a78bfa":"#f472b6",fontWeight:700}}>Touch {t.touch}</span>
                    <button onClick={()=>{
                      setSelectedTemplate(t.id);
                      // If a prospect is already selected in compose, re-fill template with their data
                      const existingProspect = composeForm.prospectId ? crmData.find(p=>p.id===composeForm.prospectId) : null;
                      const filled = existingProspect ? fillTemplate(t, existingProspect) : {subject:t.subject, body:t.body};
                      setComposeForm(f=>({...f,subject:filled.subject,body:filled.body}));
                      setEtab("compose");setCompose("write");
                    }} className="bh" style={{...B.gold,fontSize:10,padding:"5px 12px"}}>Use Template</button>
                  </div>
                  <div style={{padding:"14px 16px"}}>
                    <p style={{margin:"0 0 6px",fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.06em"}}>Preview</p>
                    <pre style={{margin:0,fontSize:11,color:WM,lineHeight:1.6,whiteSpace:"pre-wrap",fontFamily:"'Segoe UI',system-ui,sans-serif",maxHeight:160,overflow:"hidden",position:"relative"}}>{t.body.slice(0,400)}{t.body.length>400&&"…"}</pre>
                    <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:5}}>
                      <p style={{margin:0,fontSize:9,color:WD,width:"100%"}}>Auto-fill tokens:</p>
                      {["{company}","{contact}","{vertical}","{market}","{painPoint}","{senderName}","{scheduleLink}"].map(tk=>(
                        <span key={tk} style={{fontSize:9,padding:"2px 7px",background:"rgba(201,150,58,0.08)",border:"1px solid rgba(201,150,58,0.2)",borderRadius:6,color:GL,fontFamily:"monospace"}}>{tk}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   CALENDAR VIEW
   Plots T1/T2/T3 send & due dates onto a month grid, similar to
   activity calendars in HubSpot/Salesforce. Click a day to see
   every action item due that date; click an item to open the
   prospect record.
════════════════════════════════════════════════════════════════ */
const CAL_EVENT_TYPES={
  t1_due:{label:"Touch 1 Due",  color:"#60a5fa", bg:"rgba(96,165,250,0.16)",  bc:"rgba(96,165,250,0.35)",  icon:"📧"},
  t2_due:{label:"Touch 2 Due",  color:"#a78bfa", bg:"rgba(167,139,250,0.16)", bc:"rgba(167,139,250,0.35)", icon:"📩"},
  t3_due:{label:"Touch 3 Due",  color:"#f472b6", bg:"rgba(244,114,182,0.16)", bc:"rgba(244,114,182,0.35)", icon:"📬"},
  t1_sent:{label:"Touch 1 Sent",color:"#34d399", bg:"rgba(52,211,153,0.14)",  bc:"rgba(52,211,153,0.3)",   icon:"✅"},
  t2_sent:{label:"Touch 2 Sent",color:"#34d399", bg:"rgba(52,211,153,0.14)",  bc:"rgba(52,211,153,0.3)",   icon:"✅"},
  t3_sent:{label:"Touch 3 Sent",color:"#34d399", bg:"rgba(52,211,153,0.14)",  bc:"rgba(52,211,153,0.3)",   icon:"✅"},
};
const CAL_WEEKDAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const CAL_WEEKDAYS_MIN=["Su","Mo","Tu","We","Th","Fr","Sa"];

function CalendarView({crmData,onViewProspect,onGoToEmail}){
  const now=new Date();
  const [viewMonth,setViewMonth]=useState(now.getMonth()); // 0-11
  const [viewYear,setViewYear]=useState(now.getFullYear());
  const [pickerMonth,setPickerMonth]=useState(now.getMonth()); // mini calendar can browse independently
  const [pickerYear,setPickerYear]=useState(now.getFullYear());
  const [selectedDay,setSelectedDay]=useState(today());
  const [filterTypes,setFilterTypes]=useState(new Set(Object.keys(CAL_EVENT_TYPES)));
  const [dayDlg,setDayDlg]=useState(null); // date string when "+N more" is clicked

  // Build a map: { "YYYY-MM-DD": [ {prospect, type}, ... ] }
  const eventsByDate=useMemo(()=>{
    const map={};
    const add=(date,prospect,type)=>{
      if(!date)return;
      if(!map[date])map[date]=[];
      map[date].push({prospect,type});
    };
    crmData.forEach(p=>{
      if(p.doNotRespond)return;
      add(p.t1DueDate, p,"t1_due");
      add(p.t2DueDate, p,"t2_due");
      add(p.t3DueDate, p,"t3_due");
      add(p.t1SendDate,p,"t1_sent");
      add(p.t2SendDate,p,"t2_sent");
      add(p.t3SendDate,p,"t3_sent");
    });
    return map;
  },[crmData]);

  const visibleEvents=(date)=> (eventsByDate[date]||[]).filter(e=>filterTypes.has(e.type));

  // ── Main grid (month view) ──────────────────────────────────
  const firstOfMonth=new Date(viewYear,viewMonth,1);
  const lastOfMonth=new Date(viewYear,viewMonth+1,0);
  const startWeekday=firstOfMonth.getDay(); // 0=Sun
  const daysInMonth=lastOfMonth.getDate();
  const gridCells=[];
  for(let i=0;i<startWeekday;i++)gridCells.push(null);
  for(let d=1;d<=daysInMonth;d++)gridCells.push(d);
  while(gridCells.length%7!==0)gridCells.push(null);
  const gridWeeks=[];
  for(let i=0;i<gridCells.length;i+=7)gridWeeks.push(gridCells.slice(i,i+7));

  const monthLabel=firstOfMonth.toLocaleDateString("en-US",{month:"long",year:"numeric"});
  const fmtCellDate=(y,m,d)=>`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  const prevMonth=()=>{ if(viewMonth===0){setViewMonth(11);setViewYear(y=>y-1);} else setViewMonth(m=>m-1); };
  const nextMonth=()=>{ if(viewMonth===11){setViewMonth(0);setViewYear(y=>y+1);} else setViewMonth(m=>m+1); };
  const goToday=()=>{
    setViewMonth(now.getMonth());setViewYear(now.getFullYear());
    setPickerMonth(now.getMonth());setPickerYear(now.getFullYear());
    setSelectedDay(today());
  };

  // ── Mini date-picker (left sidebar) ─────────────────────────
  const pFirstOfMonth=new Date(pickerYear,pickerMonth,1);
  const pLastOfMonth=new Date(pickerYear,pickerMonth+1,0);
  const pStartWeekday=pFirstOfMonth.getDay();
  const pDaysInMonth=pLastOfMonth.getDate();
  // Leading days from previous month
  const pPrevMonthLastDate=new Date(pickerYear,pickerMonth,0).getDate();
  const pickerCells=[];
  for(let i=0;i<pStartWeekday;i++){
    pickerCells.push({d:pPrevMonthLastDate-pStartWeekday+1+i,muted:true,m:pickerMonth-1,y:pickerYear});
  }
  for(let d=1;d<=pDaysInMonth;d++)pickerCells.push({d,muted:false,m:pickerMonth,y:pickerYear});
  let trailing=1;
  while(pickerCells.length%7!==0){pickerCells.push({d:trailing++,muted:true,m:pickerMonth+1,y:pickerYear});}
  const pickerLabel=pFirstOfMonth.toLocaleDateString("en-US",{month:"long",year:"numeric"});
  const prevPickerMonth=()=>{ if(pickerMonth===0){setPickerMonth(11);setPickerYear(y=>y-1);} else setPickerMonth(m=>m-1); };
  const nextPickerMonth=()=>{ if(pickerMonth===11){setPickerMonth(0);setPickerYear(y=>y+1);} else setPickerMonth(m=>m+1); };
  const normMonth=m=>((m%12)+12)%12;
  const normYear=(m,y)=> m<0?y-1 : m>11?y+1 : y;

  const toggleFilter=type=>setFilterTypes(prev=>{
    const next=new Set(prev);
    if(next.has(type))next.delete(type);else next.add(type);
    return next;
  });

  // Upcoming due items (next 14 days + overdue), for the sidebar
  const upcoming=useMemo(()=>{
    const items=[];
    Object.entries(eventsByDate).forEach(([date,evts])=>{
      evts.forEach(e=>{
        if(!e.type.endsWith("_due"))return;
        const d=new Date(date+"T00:00:00");
        const diffDays=Math.round((d-new Date(today()+"T00:00:00"))/86400000);
        if(diffDays>=-30&&diffDays<=14)items.push({date,diffDays,...e});
      });
    });
    return items.sort((a,b)=>a.date.localeCompare(b.date));
  },[eventsByDate]);

  const selectedEvents=visibleEvents(selectedDay);
  const todayStr=today();
  const MAX_PILLS=3;

  return(
    <div style={{padding:"16px",animation:"fadeUp 0.3s ease",display:"flex",gap:16,maxWidth:1440,margin:"0 auto",alignItems:"flex-start"}}>

      {/* ═══ LEFT SIDEBAR ═══ */}
      <div style={{flex:"0 0 248px",minWidth:220,display:"flex",flexDirection:"column",gap:14,position:"sticky",top:16}}>

        {/* Mini date picker */}
        <div style={{background:NL,border:`1px solid ${BR}`,borderRadius:11,padding:"14px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <span style={{fontSize:12,fontWeight:800,color:W}}>{pickerLabel}</span>
            <div style={{display:"flex",gap:2}}>
              <button onClick={prevPickerMonth} style={{...B.ghost,fontSize:11,padding:"3px 8px"}}>‹</button>
              <button onClick={nextPickerMonth} style={{...B.ghost,fontSize:11,padding:"3px 8px"}}>›</button>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:2}}>
            {CAL_WEEKDAYS_MIN.map(d=>(
              <div key={d} style={{textAlign:"center",fontSize:9,fontWeight:700,color:WD,padding:"3px 0"}}>{d}</div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
            {pickerCells.map((cell,i)=>{
              const m=normMonth(cell.m), y=normYear(cell.m,cell.y);
              const dateStr=fmtCellDate(y,m,cell.d);
              const isToday=dateStr===todayStr;
              const isSelected=dateStr===selectedDay;
              const hasEvents=!!eventsByDate[dateStr]?.length;
              return(
                <button key={i} onClick={()=>{
                  setSelectedDay(dateStr);
                  if(!cell.muted){setViewMonth(pickerMonth);setViewYear(pickerYear);}
                  else{setViewMonth(m);setViewYear(y);setPickerMonth(m);setPickerYear(y);}
                }} style={{
                  aspectRatio:"1",border:"none",borderRadius:7,cursor:"pointer",fontSize:11,fontWeight:isToday?800:600,
                  background:isSelected?G:isToday?"rgba(96,165,250,0.15)":"transparent",
                  color:isSelected?N:cell.muted?WD:isToday?"#60a5fa":W,
                  opacity:cell.muted?0.35:1,position:"relative",
                  display:"flex",alignItems:"center",justifyContent:"center"
                }}>
                  {cell.d}
                  {hasEvents&&!isSelected&&<span style={{position:"absolute",bottom:2,width:4,height:4,borderRadius:"50%",background:GL}}/>}
                </button>
              );
            })}
          </div>
          <button onClick={goToday} className="bh" style={{...B.gold,width:"100%",fontSize:11,padding:"7px",marginTop:10}}>Today</button>
        </div>

        {/* Legend / event type filters */}
        <div style={{background:NL,border:`1px solid ${BR}`,borderRadius:11,padding:"14px"}}>
          <p style={{margin:"0 0 10px",fontSize:11,fontWeight:800,color:WD,textTransform:"uppercase",letterSpacing:"0.07em"}}>Action Items</p>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(CAL_EVENT_TYPES).map(([key,t])=>(
              <label key={key} onClick={()=>toggleFilter(key)} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:"pointer",opacity:filterTypes.has(key)?1:0.4,padding:"3px 0"}}>
                <span style={{width:13,height:13,borderRadius:4,background:filterTypes.has(key)?t.color:"transparent",border:`1.5px solid ${t.color}`,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {filterTypes.has(key)&&<span style={{color:N,fontSize:9,fontWeight:900}}>✓</span>}
                </span>
                <span style={{color:WM}}>{t.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Due Soon & Overdue */}
        <div style={{background:NL,border:`1px solid ${BR}`,borderRadius:11,overflow:"hidden"}}>
          <div style={{padding:"11px 14px",borderBottom:`1px solid ${BR}`}}>
            <p style={{margin:0,fontSize:12,fontWeight:800,color:W}}>⏰ Due Soon &amp; Overdue</p>
            <p style={{margin:"2px 0 0",fontSize:10,color:WM}}>Next 14 days</p>
          </div>
          <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:5,maxHeight:280,overflowY:"auto"}}>
            {upcoming.length===0&&<p style={{fontSize:11,color:WD,textAlign:"center",padding:"12px 0",margin:0}}>No upcoming due dates.</p>}
            {upcoming.map((e,i)=>{
              const t=CAL_EVENT_TYPES[e.type];
              const overdue=e.diffDays<0;
              const label=overdue?`${Math.abs(e.diffDays)}d overdue`:e.diffDays===0?"Today":e.diffDays===1?"Tomorrow":`in ${e.diffDays}d`;
              return(
                <div key={i} onClick={()=>{
                  const d=new Date(e.date+"T00:00:00");
                  setSelectedDay(e.date);setViewMonth(d.getMonth());setViewYear(d.getFullYear());setPickerMonth(d.getMonth());setPickerYear(d.getFullYear());
                }} className="rh" style={{display:"flex",alignItems:"center",gap:7,padding:"6px 8px",borderRadius:8,cursor:"pointer",background:overdue?"rgba(248,113,113,0.07)":"rgba(255,255,255,0.02)",border:`1px solid ${overdue?"rgba(248,113,113,0.22)":BR}`}}>
                  <span style={{width:8,height:8,borderRadius:3,background:t.color,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{margin:0,fontSize:11,fontWeight:700,color:W,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.prospect.companyName}</p>
                    <p style={{margin:0,fontSize:9,color:t.color}}>{t.label}</p>
                  </div>
                  <span style={{fontSize:9,fontWeight:800,color:overdue?"#f87171":WD,flexShrink:0,whiteSpace:"nowrap"}}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══ MAIN CALENDAR ═══ */}
      <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:14}}>

        {/* Toolbar */}
        <div style={{background:NL,border:`1px solid ${BR}`,borderRadius:11,padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <h2 style={{margin:0,fontSize:17,fontWeight:800,color:W}}>📅 Calendar</h2>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <button onClick={prevMonth} style={{...B.ghost,fontSize:13,padding:"6px 11px"}}>‹</button>
              <button onClick={nextMonth} style={{...B.ghost,fontSize:13,padding:"6px 11px"}}>›</button>
            </div>
            <span style={{fontSize:14,fontWeight:800,color:W,minWidth:150}}>{monthLabel}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={goToday} className="bh" style={{...B.gold,fontSize:11,padding:"7px 16px",fontWeight:700}}>Today</button>
            <div style={{display:"flex",background:"rgba(255,255,255,0.03)",border:`1px solid ${BR}`,borderRadius:9,padding:2}}>
              <span style={{fontSize:11,padding:"6px 14px",borderRadius:7,background:G,color:N,fontWeight:800}}>Month</span>
            </div>
          </div>
        </div>

        {/* Weekday header */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:NL,border:`1px solid ${BR}`,borderRadius:"11px 11px 0 0",overflow:"hidden"}}>
          {CAL_WEEKDAYS.map(d=>(
            <div key={d} style={{textAlign:"center",fontSize:11,fontWeight:800,color:WD,textTransform:"uppercase",letterSpacing:"0.06em",padding:"10px 0",borderRight:`1px solid ${BR}`}}>{d}</div>
          ))}
        </div>

        {/* Month grid */}
        <div style={{display:"flex",flexDirection:"column",border:`1px solid ${BR}`,borderTop:"none",borderRadius:"0 0 11px 11px",overflow:"hidden",flex:1}}>
          {gridWeeks.map((week,wi)=>(
            <div key={wi} style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderBottom:wi<gridWeeks.length-1?`1px solid ${BR}`:"none"}}>
              {week.map((d,di)=>{
                if(d===null)return <div key={di} style={{minHeight:118,background:"rgba(255,255,255,0.012)",borderRight:di<6?`1px solid ${BR}`:"none"}}/>;
                const dateStr=fmtCellDate(viewYear,viewMonth,d);
                const evts=visibleEvents(dateStr);
                const isToday=dateStr===todayStr;
                const isSelected=dateStr===selectedDay;
                const visible=evts.slice(0,MAX_PILLS);
                const hiddenCount=evts.length-visible.length;
                return(
                  <div key={di} onClick={()=>setSelectedDay(dateStr)} style={{minHeight:118,padding:"7px 8px",cursor:"pointer",background:isSelected?"rgba(201,150,58,0.08)":"transparent",borderRight:di<6?`1px solid ${BR}`:"none",display:"flex",flexDirection:"column",gap:4,transition:"background 0.12s"}}>
                    <span style={{
                      fontSize:12,fontWeight:isToday?800:600,
                      color:isToday?N:isSelected?GL:WM,
                      width:22,height:22,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                      background:isToday?G:"transparent",
                    }}>{d}</span>
                    <div style={{display:"flex",flexDirection:"column",gap:3,overflow:"hidden"}}>
                      {visible.map((e,i)=>{
                        const t=CAL_EVENT_TYPES[e.type];
                        return(
                          <div key={i} onClick={(ev)=>{ev.stopPropagation();onViewProspect(e.prospect);}} style={{fontSize:10,padding:"3px 6px",borderRadius:5,background:t.bg,color:t.color,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",cursor:"pointer"}} title={`${t.label} — ${e.prospect.companyName}`}>
                            {e.prospect.companyName}
                          </div>
                        );
                      })}
                      {hiddenCount>0&&(
                        <div onClick={(ev)=>{ev.stopPropagation();setDayDlg(dateStr);}} style={{fontSize:10,padding:"2px 6px",color:GL,fontWeight:700,cursor:"pointer"}}>
                          +{hiddenCount} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Selected day details strip */}
        <div style={{background:NL,border:`1px solid ${BR}`,borderRadius:11,overflow:"hidden"}}>
          <div style={{padding:"11px 16px",borderBottom:`1px solid ${BR}`,background:"rgba(255,255,255,0.03)",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <p style={{margin:0,fontSize:13,fontWeight:800,color:W}}>
              {new Date(selectedDay+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}
              {selectedDay===todayStr&&<span style={{marginLeft:8,fontSize:9,padding:"2px 8px",background:"rgba(96,165,250,0.15)",color:"#60a5fa",borderRadius:20,fontWeight:700}}>TODAY</span>}
              <span style={{marginLeft:8,fontSize:11,color:WM,fontWeight:500}}>· {selectedEvents.length} action item{selectedEvents.length!==1?"s":""}</span>
            </p>
            {selectedEvents.some(e=>e.type.endsWith("_due"))&&(
              <button onClick={onGoToEmail} className="bh" style={{...B.gold,fontSize:11,padding:"7px 14px"}}>📧 Go to Outreach Queue</button>
            )}
          </div>
          <div style={{padding:"10px 12px",display:"flex",flexWrap:"wrap",gap:8,maxHeight:200,overflowY:"auto"}}>
            {selectedEvents.length===0&&<p style={{fontSize:12,color:WD,padding:"10px 4px",margin:0}}>Nothing scheduled this day.</p>}
            {selectedEvents.map((e,i)=>{
              const t=CAL_EVENT_TYPES[e.type];
              const isDue=e.type.endsWith("_due");
              return(
                <div key={i} onClick={()=>onViewProspect(e.prospect)} className="rh" style={{background:NB,border:`1px solid ${t.bc}`,borderRadius:9,padding:"9px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:9,minWidth:240,flex:"1 1 320px"}}>
                  <span style={{fontSize:15,flexShrink:0}}>{t.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{margin:0,fontSize:12,fontWeight:700,color:W,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.prospect.companyName}</p>
                    <p style={{margin:"2px 0 0",fontSize:10,color:t.color,fontWeight:700}}>{t.label}{isDue&&selectedDay<todayStr?" · Overdue":""}</p>
                  </div>
                  <SBadge status={e.prospect.currentStatus} sm/>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* "+N more" overflow modal */}
      {dayDlg&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}} onClick={()=>setDayDlg(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:NL,border:`1px solid ${BR}`,borderRadius:13,padding:"18px 20px",maxWidth:420,width:"100%",maxHeight:"70vh",overflowY:"auto"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <h3 style={{margin:0,fontSize:14,fontWeight:800,color:W}}>{new Date(dayDlg+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</h3>
              <button onClick={()=>setDayDlg(null)} style={{...B.ghost,fontSize:11,padding:"5px 10px"}}>✕</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {visibleEvents(dayDlg).map((e,i)=>{
                const t=CAL_EVENT_TYPES[e.type];
                return(
                  <div key={i} onClick={()=>{onViewProspect(e.prospect);setDayDlg(null);}} className="rh" style={{background:NB,border:`1px solid ${t.bc}`,borderRadius:9,padding:"9px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:9}}>
                    <span style={{fontSize:15,flexShrink:0}}>{t.icon}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{margin:0,fontSize:12,fontWeight:700,color:W}}>{e.prospect.companyName}</p>
                      <p style={{margin:"2px 0 0",fontSize:10,color:t.color,fontWeight:700}}>{t.label}</p>
                    </div>
                    <SBadge status={e.prospect.currentStatus} sm/>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
   CRM APP — MAIN INTERFACE
════════════════════════════════════════════════════════════════ */
const CHECKLIST=["Pull 10 new prospects using approved sources (AI Finder, Apollo, etc.)","Send Touch 1 emails every Monday","Send Touch 2 emails 7 days after T1 if no reply","ANY reply → Flag to Melissa IMMEDIATELY","Flag to Melissa before Touch 3 — wait for approval","After Touch 3 → update status to NURTURE/T3 SENT","Log Call Booked after Melissa handles reply"];

function CRMApp({currentUser,onLogout,onOpenAdmin,crmData,setCrmData,onSaveProspect,onDeleteProspect,onImportProspects,sysSettings,dbStatus,features,addAudit}){
  const [experience,setExperience]=useState("prospectfinder");
  const [view,setView]=useState("dashboard");
  const [search,setSearch]=useState("");
  const [sfilt,setSfilt]=useState("All");
  const [vfilt,setVfilt]=useState("All");
  const [mfilt,setMfilt]=useState("All");
  const [pDlg,setPDlg]=useState(null);
  const [toast,setToast]=useState(null);
  const [cl,setCl]=useState(Array(CHECKLIST.length).fill(false));
  const [showImport,setShowImport]=useState(false);
  const [showFinder,setShowFinder]=useState(false);
  const [sortCol,setSortCol]=useState("companyName");
  // Pipeline (kanban) state. These MUST be top-level hooks: they used to be declared inside the
  // conditional pipeline view, which crashed the app (React error #310) the first time it opened.
  const [pipeSearch,setPipeSearch]=useState("");
  const [dragOver,setDragOver]=useState(null);
  const [dragging,setDragging]=useState(null);
  const [sortDir,setSortDir]=useState("asc");

  const role=ROLES[currentUser.role];
  const canEdit=role.canEdit;
  const t2=(msg,t="ok")=>{setToast({msg,t});setTimeout(()=>setToast(null),3000);};

  const q1=crmData.filter(p=>p.currentStatus==="NEW"&&!p.doNotRespond&&hasEM(p));
  const q2=crmData.filter(p=>p.currentStatus==="T1 SENT"&&isPast(p.t1DueDate)&&!p.doNotRespond&&hasEM(p));
  const q3=crmData.filter(p=>((p.currentStatus==="T2 SENT"&&isPast(p.t2DueDate))||(p.currentStatus==="TOUCH 3 GATE"&&p.t3Approved))&&!p.doNotRespond&&hasEM(p));
  const totalDue=q1.length+q2.length+q3.length;

  // Duplicate detection by both company name AND email — catches cases
  // where the same org appears under a slightly different name but
  // shares a contact email already in the CRM.
  const existingIds=new Set([
    ...crmData.map(p=>p.companyName?.toLowerCase()).filter(Boolean),
    ...crmData.map(p=>p.emailPhone?.toLowerCase()).filter(Boolean),
  ]);

  const sorted=[...crmData].sort((a,b)=>{
    const av=String(a[sortCol]||"").toLowerCase();const bv=String(b[sortCol]||"").toLowerCase();
    return sortDir==="asc"?av.localeCompare(bv):bv.localeCompare(av);
  });
  const filtered=sorted.filter(p=>{
    const q=search.toLowerCase();
    return(!q||[p.companyName,p.contactName,p.cityMarket,p.emailPhone,p.vertical,p.title,p.outreachNotes].some(v=>(v||"").toLowerCase().includes(q)))
      &&(sfilt==="All"||p.currentStatus===sfilt)
      &&(vfilt==="All"||p.vertical===vfilt)
      &&(mfilt==="All"||p.market===mfilt);
  });

  const saveP=async form=>{
    if(!canEdit){t2("View-only access.","err");return;}
    const isNew=!crmData.find(p=>p.id===form.id);
    // an edited email address invalidates any earlier verification result
    const before=crmData.find(p=>p.id===form.id);
    const f=(before&&before.emailPhone!==form.emailPhone)?{...form,emailStatus:"",emailCheckedAt:""}:form;
    const res=await onSaveProspect(f);
    if(res&&res.__saveFailed){t2(`Couldn't save: ${res.__saveFailed}`,"err");return;}
    setPDlg(null);t2(isNew?"Prospect added!":"Changes saved!");
  };
  const deleteP=async id=>{
    if(!role.canDelete){t2("Insufficient permissions.","err");return;}
    if(!window.confirm("Delete this prospect?"))return;
    await onDeleteProspect(id);setPDlg(null);t2("Deleted.","err");
  };
  const qStatus=async (id,s)=>{
    const p=crmData.find(x=>x.id===id);if(!p)return;
    await onSaveProspect(applyTouchDates(p,s));
  };
  const doSort=col=>{if(sortCol===col)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortCol(col);setSortDir("asc");}};
  const SI=({col})=>sortCol===col?<span style={{fontSize:9,marginLeft:2}}>{sortDir==="asc"?"▲":"▼"}</span>:null;

  const tot=crmData.length;
  const pipeSumm=STATUSES.map(s=>({s,c:crmData.filter(p=>p.currentStatus===s).length}));
  const vertBreak=VERTICALS.map(v=>({v,c:crmData.filter(p=>p.vertical===v).length})).filter(x=>x.c>0).sort((a,b)=>b.c-a.c);
  const mktBreak=MARKETS.map(m=>({m,c:crmData.filter(p=>p.market===m).length})).filter(x=>x.c>0).sort((a,b)=>b.c-a.c);
  const typeBreak=[{l:"Nonprofits",c:crmData.filter(p=>["Human Services Nonprofits","Nonprofits & Associations","Faith-Based Organizations","Foundations & Grantmakers","Advocacy Organizations","Social Service Agencies","Arts & Cultural Nonprofits","Environmental Nonprofits","Religious & Faith-Based Nonprofits","Community Development Orgs"].includes(p.vertical)).length,col:"#c084fc"},{l:"SMB / For-Profit",c:crmData.filter(p=>["Home Health / Homecare","Childcare & Licensed Group Homes","Construction & Contractors","Healthcare Practices","Light Manufacturing & Logistics","Education & Schools"].includes(p.vertical)).length,col:"#60a5fa"}];

  const NAVS=[{id:"dashboard",l:"📊",full:"Dashboard"},{id:"finder",l:"🔍",full:"Prospect Finder",alert:false},{id:"table",l:"🗄️",full:"Prospects"},{id:"pipeline",l:"◫",full:"Pipeline"},{id:"calendar",l:"📅",full:"Calendar"},{id:"email",l:"📧",full:`Email${totalDue>0?` (${totalDue})`:""}`,alert:totalDue>0}];
  const [sidebarExpanded,setSidebarExpanded]=useState(false);
  const SIDEBAR_W=sidebarExpanded?228:62;

  /* ── Prospects screen plumbing ───────────────────────────────── */
  // Shared (database) saved searches when the migration exists, else this browser only.
  const savedApi=useMemo(()=>(isConfigured&&features?.savedSearches)
    ?{list:sc=>DB.getSavedSearches(sc),save:x=>DB.saveSearch(x),remove:id=>DB.deleteSavedSearch(id)}
    :localSavedApi,[features?.savedSearches]);
  // Mailbox-level email verification (only when a Hunter key is configured server-side).
  const hunterVerify=useMemo(()=>(isConfigured&&sysSettings.hunterKey)?async email=>{
    const res=await fetch(`${SUPABASE_URL}/functions/v1/hunter-verify`,{method:"POST",headers:await authHeaders(),body:JSON.stringify({email})});
    return res.ok?res.json():null;
  }:undefined,[sysSettings.hunterKey]);
  // Apply many changes with limited parallelism. `patch` is an object to merge or fn(prospect)=>prospect.
  const bulkSave=useCallback(async updates=>{
    const byId=new Map(crmData.map(x=>[x.id,x]));
    let ok=0,failed=0;
    await mapPool(updates,5,async({id,patch})=>{
      const cur=byId.get(id);if(!cur){failed++;return;}
      const next=typeof patch==="function"?patch(cur):{...cur,...patch};
      const res=await onSaveProspect(next);
      if(res&&res.__saveFailed)failed++;else ok++;
    });
    return{ok,failed};
  },[crmData,onSaveProspect]);
  const deleteMany=useCallback(async ids=>{
    let ok=0,failed=0;
    await mapPool(ids,5,async id=>{(await onDeleteProspect(id))?ok++:failed++;});
    if(ok&&addAudit)addAudit(currentUser.username,`Deleted ${ok} prospect${ok===1?"":"s"} (bulk)`);
    return{ok,failed};
  },[onDeleteProspect,addAudit,currentUser]);
  // Merge duplicates: save the combined record FIRST; only delete the others if that succeeded.
  const mergeRecords=useCallback(async(merged,deleteIds)=>{
    const res=await onSaveProspect(merged);
    if(res&&res.__saveFailed){t2(`Couldn't save the merged record — nothing was deleted (${res.__saveFailed})`,"err");return false;}
    const r=await deleteMany(deleteIds);
    if(addAudit)addAudit(currentUser.username,`Merged ${deleteIds.length+1} records into ${merged.companyName}`);
    t2(r.failed?`Merged, but ${r.failed} duplicate${r.failed===1?"":"s"} couldn't be removed`:`Merged — ${r.ok} duplicate${r.ok===1?"":"s"} removed`,r.failed?"err":"ok");
    return r.failed===0;
  },[onSaveProspect,deleteMany,addAudit,currentUser]);
  const exportRows=useCallback((rows,name)=>{exportToExcel(rows,name);t2(`Exported ${rows.length} prospect${rows.length===1?"":"s"}`);},[]);


  return(
    experience==="prospectfinder" ? (
      <ProspectHome
        crmData={crmData}
        currentUser={currentUser}
        onOpenCRM={()=>{setView("table");setExperience("classic");}}
        onOpenAdmin={onOpenAdmin}
        onLogout={onLogout}
        onAddProspects={async prospects=>{
          await onImportProspects(prospects,"append");
          t2(prospects.length+" prospect"+(prospects.length===1?"":"s")+" added to CRM!");
        }}
        baseUrl={SUPABASE_URL}
        requestHeaders={authHeaders}
        dbStatus={dbStatus}
        canAdmin={role.canAdmin}
      />
    ) : (
    <div style={{background:N,minHeight:"100vh",fontFamily:"'Segoe UI',system-ui,sans-serif",color:W,display:"flex"}}>
      <GS/>
      <button
        onClick={()=>setExperience("prospectfinder")}
        style={{position:"fixed",bottom:20,right:20,zIndex:9995,padding:"12px 18px",border:0,borderRadius:12,color:"#fff",background:"#6454E8",boxShadow:"0 8px 25px #11182755",cursor:"pointer",fontWeight:800,fontSize:12}}>
        ← Back to ProspectFinder
      </button>
      {toast&&<Toast msg={toast.msg} type={toast.t}/>}

      {/* ═══ LEFT SIDEBAR — hover to expand, collapses to icon-only ═══ */}
      <aside
        onMouseEnter={()=>setSidebarExpanded(true)}
        onMouseLeave={()=>setSidebarExpanded(false)}
        style={{
          width:SIDEBAR_W,flexShrink:0,background:NL,
          borderRight:"1px solid rgba(201,150,58,0.18)",
          display:"flex",flexDirection:"column",
          position:"sticky",top:0,height:"100vh",overflowY:"auto",overflowX:"hidden",
          transition:"width 0.22s cubic-bezier(0.4,0,0.2,1)",
          zIndex:200,
        }}>

        {/* Logo */}
        <div style={{
          padding: sidebarExpanded?"14px 14px 12px":"10px 8px",
          borderBottom:"1px solid rgba(255,255,255,0.06)",
          display:"flex",alignItems:"center",justifyContent:"center",
          transition:"padding 0.22s",minHeight:88,
        }}>
          {sidebarExpanded?(
            /* Full logo when expanded */
            <img src={HR_LOGO} alt="HR on Demand" style={{
              height:62,width:"auto",objectFit:"contain",
              filter:"drop-shadow(0 2px 8px rgba(193,127,50,0.35))",
              transition:"all 0.2s",
            }}/>
          ):(
            /* Collapsed: show a cropped/zoomed version of the real logo */
            <div style={{
              width:42,height:42,borderRadius:8,overflow:"hidden",
              border:"1.5px solid rgba(193,127,50,0.4)",
              flexShrink:0,transition:"all 0.2s",
              display:"flex",alignItems:"center",justifyContent:"center",
              background:"#1B2A4A",
            }}>
              <img src={HR_LOGO} alt="HR" style={{
                height:38,width:"auto",objectFit:"contain",
              }}/>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav style={{flex:1,padding:"10px 8px",display:"flex",flexDirection:"column",gap:2}}>
          {NAVS.map(n=>{
            const active=view===n.id;
            return(
              <button key={n.id} onClick={()=>setView(n.id)}
                title={!sidebarExpanded?n.full:undefined}
                style={{
                  position:"relative",display:"flex",alignItems:"center",
                  gap: sidebarExpanded?10:0,
                  justifyContent: sidebarExpanded?"flex-start":"center",
                  background:active?"rgba(201,150,58,0.15)":"transparent",
                  color:active?GL:WM,
                  border:`1px solid ${active?"rgba(201,150,58,0.3)":"transparent"}`,
                  borderRadius:8,
                  padding: sidebarExpanded?"10px 12px":"10px 0",
                  fontSize:13,fontWeight:active?700:600,
                  cursor:"pointer",textAlign:"left",width:"100%",
                  transition:"all 0.15s",whiteSpace:"nowrap",overflow:"hidden",
                }}>
                <span style={{fontSize:17,width:22,textAlign:"center",flexShrink:0}}>{n.l}</span>
                {sidebarExpanded&&<span style={{flex:1,fontSize:12,transition:"opacity 0.15s",opacity:sidebarExpanded?1:0}}>{n.full}</span>}
                {n.alert&&sidebarExpanded&&<span style={{width:8,height:8,background:"#f472b6",borderRadius:"50%",flexShrink:0}}/>}
                {n.alert&&!sidebarExpanded&&<span style={{position:"absolute",top:6,right:6,width:7,height:7,background:"#f472b6",borderRadius:"50%",border:"1.5px solid #0B1426"}}/>}
              </button>
            );
          })}
        </nav>

        {/* Quick actions — show labels only when expanded */}
        <div style={{padding:"8px",display:"flex",flexDirection:"column",gap:5,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
          {canEdit&&(
            <button onClick={()=>setShowImport(true)} className="bh"
              title={!sidebarExpanded?"Import":""}
              style={{...B.purple,fontSize:11,padding:"8px",width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
              <span>📁</span>{sidebarExpanded&&<span>Import</span>}
            </button>
          )}
          <button onClick={()=>{exportToExcel(crmData,"NC_CRM");t2("Exported!");}} className="bh"
            title={!sidebarExpanded?"Export":""}
            style={{...B.green,fontSize:11,padding:"8px",width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
            <span>⬇️</span>{sidebarExpanded&&<span>Export</span>}
          </button>
          {canEdit&&(
            <button onClick={()=>setPDlg("add")} className="bh"
              title={!sidebarExpanded?"Add Prospect":""}
              style={{...B.gold,fontSize:11,padding:"8px",width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
              <span>＋</span>{sidebarExpanded&&<span>Add Prospect</span>}
            </button>
          )}
        </div>

        {/* User account footer */}
        <div style={{padding:"10px 8px",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{
            display:"flex",alignItems:"center",
            gap: sidebarExpanded?8:0,
            justifyContent: sidebarExpanded?"flex-start":"center",
            padding: sidebarExpanded?"7px 8px":"7px 4px",
            background:"rgba(255,255,255,0.04)",
            border:`1px solid ${BR}`,borderRadius:9,marginBottom:6,
            overflow:"hidden",transition:"all 0.2s",
          }}>
            <div style={{width:28,height:28,background:ROLES[currentUser.role]?.bg,border:`1.5px solid ${ROLES[currentUser.role]?.color}55`,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:ROLES[currentUser.role]?.color,flexShrink:0}}>{currentUser.avatar}</div>
            {sidebarExpanded&&<div style={{minWidth:0,flex:1}}>
              <p style={{margin:0,fontSize:11,fontWeight:700,color:W,lineHeight:1.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentUser.name.split(" ")[0]}</p>
              <p style={{margin:0,fontSize:9,color:ROLES[currentUser.role]?.color,lineHeight:1}}>{ROLES[currentUser.role]?.label}</p>
            </div>}
          </div>
          <div style={{display:"flex",gap:5,justifyContent: sidebarExpanded?"stretch":"center"}}>
            {role.canAdmin&&(
              <button onClick={onOpenAdmin} className="bh"
                title={!sidebarExpanded?"Admin":""}
                style={{...B.purple,fontSize:10,padding:"6px",flex:sidebarExpanded?1:0,width:sidebarExpanded?"auto":36,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                <span>🛡️</span>{sidebarExpanded&&<span>Admin</span>}
              </button>
            )}
            <button onClick={onLogout} className="bh"
              title={!sidebarExpanded?"Sign Out":""}
              style={{...B.ghost,fontSize:10,padding:"6px",flex:sidebarExpanded?1:0,width:sidebarExpanded?"auto":36,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
              <span>↩</span>{sidebarExpanded&&<span>Sign Out</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* ═══ MAIN CONTENT COLUMN ═══ */}
      <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column"}}>
        {/* Top bar */}
        <header style={{background:NL,borderBottom:"1px solid rgba(201,150,58,0.2)",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 24px rgba(0,0,0,0.5)"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"0 20px",height:54}}>
            <p style={{fontSize:13,fontWeight:800,color:W,margin:0,flex:1}}>{NAVS.find(n=>n.id===view)?.full||"Dashboard"}</p>
            <p style={{fontSize:10.5,color:"rgba(201,150,58,0.7)",margin:0,whiteSpace:"nowrap"}}>SMB &amp; Nonprofit Outreach Tracker</p>
          </div>
          <div style={{borderTop:"1px solid rgba(201,150,58,0.08)",padding:"3px 20px",overflowX:"auto"}}>
            <p style={{margin:0,fontSize:10,color:WD,whiteSpace:"nowrap"}}>⚠️ T1 = Daily (NEW) · T2 +7d after T1 · T3 when T2 due or Melissa approves · Flag ALL replies immediately{!canEdit?" · 👁 View-only":""}</p>
          </div>
        </header>


      {/* DASHBOARD */}
      {view==="dashboard"&&(
        <div style={{padding:"18px 16px",maxWidth:1400,margin:"0 auto",animation:"fadeUp 0.3s ease"}}>
          <div style={{background:NL,border:"1px solid rgba(201,150,58,0.18)",borderRadius:11,padding:"11px 18px",textAlign:"center",marginBottom:14}}>
            <p style={{margin:0,fontSize:13,fontWeight:800,color:W,letterSpacing:"0.04em"}}>OUTREACH DASHBOARD — {sysSettings.orgName||"HR On Demand"} | SMB & Nonprofit Compliance-Vertical Tracker</p>
          </div>
          {(q2.length>0||q3.length>0)&&(
            <div style={{display:"flex",gap:10,marginBottom:13,flexWrap:"wrap"}}>
              {q2.length>0&&<div onClick={()=>setView("email")} style={{flex:1,minWidth:170,background:"rgba(139,92,246,0.08)",border:"2px solid rgba(139,92,246,0.35)",borderRadius:11,padding:"11px 15px",cursor:"pointer",display:"flex",alignItems:"center",gap:11}}>
                <span style={{fontSize:22}}>⏰</span><div><p style={{margin:0,fontSize:13,fontWeight:800,color:"#a78bfa"}}>{q2.length} Touch 2 Due</p><p style={{margin:0,fontSize:11,color:"rgba(167,139,250,0.6)"}}>Follow-up overdue</p></div><span style={{marginLeft:"auto",fontSize:26,fontWeight:800,color:"#a78bfa"}}>{q2.length}</span>
              </div>}
              {q3.length>0&&<div onClick={()=>setView("email")} style={{flex:1,minWidth:170,background:"rgba(236,72,153,0.08)",border:"2px solid rgba(236,72,153,0.35)",borderRadius:11,padding:"11px 15px",cursor:"pointer",display:"flex",alignItems:"center",gap:11}}>
                <span style={{fontSize:22}}>🔔</span><div><p style={{margin:0,fontSize:13,fontWeight:800,color:"#f472b6"}}>{q3.length} Touch 3 Due</p><p style={{margin:0,fontSize:11,color:"rgba(244,114,182,0.6)"}}>Ready to send</p></div><span style={{marginLeft:"auto",fontSize:26,fontWeight:800,color:"#f472b6"}}>{q3.length}</span>
              </div>}
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:9,marginBottom:14}}>
            {[{l:"Prospects",v:tot,c:W,i:"👥"},{l:"T1 Queue",v:q1.length,c:GL,i:"📤",cl:true},{l:"T2 Overdue",v:q2.length,c:"#a78bfa",i:"⏰",cl:true},{l:"T3 Due",v:q3.length,c:"#f472b6",i:"🔔",cl:true},{l:"Replies",v:crmData.filter(p=>p.replyReceived).length,c:"#34d399",i:"📩"},{l:"Converted",v:crmData.filter(p=>p.currentStatus==="Converted").length,c:"#60a5fa",i:"🎯"}].map(s=>(
              <div key={s.l} onClick={s.cl?()=>setView("email"):undefined} style={{background:NL,border:`1px solid ${BR}`,borderRadius:11,padding:"12px 12px 10px",position:"relative",overflow:"hidden",cursor:s.cl?"pointer":"default"}}>
                <p style={{margin:0,fontSize:9.5,color:WD,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.l}</p>
                <p style={{margin:"5px 0 0",fontSize:26,fontWeight:900,color:s.v>0?s.c:"rgba(255,255,255,0.12)",lineHeight:1}}>{s.v}</p>
                <span style={{position:"absolute",top:10,right:10,fontSize:15,opacity:0.15}}>{s.i}</span>
                <div style={{position:"absolute",bottom:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${s.c},transparent)`,opacity:0.4}}/>
              </div>
            ))}
          </div>

          {/* Org type breakdown */}
          <div style={{display:"flex",gap:9,marginBottom:14,flexWrap:"wrap"}}>
            {typeBreak.map(t=>(
              <div key={t.l} style={{flex:1,minWidth:150,background:NL,border:`1px solid ${BR}`,borderRadius:11,padding:"12px 15px",display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:36,height:36,borderRadius:10,background:`${t.col}22`,border:`1.5px solid ${t.col}55`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>
                  {t.l.includes("Nonprofit")?"🏛️":"🏢"}
                </div>
                <div><p style={{margin:0,fontSize:22,fontWeight:900,color:t.col,lineHeight:1}}>{t.c}</p><p style={{margin:"2px 0 0",fontSize:11,color:WM}}>{t.l}</p></div>
                <div style={{flex:1,height:4,background:"rgba(255,255,255,0.06)",borderRadius:2,marginLeft:8}}>
                  <div style={{height:"100%",background:t.col,borderRadius:2,width:tot>0?Math.round((t.c/tot)*100)+"%":"0%",transition:"width 0.5s ease"}}/>
                </div>
              </div>
            ))}
            <div style={{flex:1,minWidth:150,background:NL,border:`1px solid rgba(201,150,58,0.2)`,borderRadius:11,padding:"12px 15px",cursor:"pointer",display:"flex",alignItems:"center",gap:12}} onClick={()=>setView("finder")}>
              <div style={{width:36,height:36,borderRadius:10,background:"rgba(201,150,58,0.15)",border:"1.5px solid rgba(201,150,58,0.4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🔍</div>
              <div><p style={{margin:0,fontSize:13,fontWeight:700,color:GL}}>Find Prospects</p><p style={{margin:"2px 0 0",fontSize:11,color:WM}}>AI · Apollo · Hunter · LinkedIn</p></div>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1.1fr 1fr 0.6fr",gap:13}}>
            {/* Pipeline + Checklist */}
            <div style={{background:NL,border:"1px solid rgba(201,150,58,0.18)",borderRadius:12,overflow:"hidden"}}>
              <div style={{background:"rgba(201,150,58,0.08)",padding:"8px 13px",borderBottom:"1px solid rgba(201,150,58,0.12)"}}><p style={{margin:0,fontSize:10,fontWeight:800,color:GL,textTransform:"uppercase",letterSpacing:"0.08em"}}>◫ Pipeline Status</p></div>
              {pipeSumm.map((s,i)=>(
                <div key={s.s} style={{display:"grid",gridTemplateColumns:"1fr auto auto",alignItems:"center",padding:"5px 12px",background:i%2?"rgba(255,255,255,0.018)":"transparent",borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                  <SBadge status={s.s} sm/><span style={{fontSize:14,fontWeight:800,color:W,textAlign:"center",padding:"0 10px",minWidth:22}}>{s.c}</span><span style={{fontSize:10,color:WD,minWidth:34,textAlign:"right"}}>{pct(s.c,tot)}</span>
                </div>
              ))}
              <div style={{background:"rgba(201,150,58,0.06)",borderTop:"1px solid rgba(201,150,58,0.12)",padding:"7px 12px",marginTop:4}}><p style={{margin:0,fontSize:10,fontWeight:800,color:GL,textTransform:"uppercase",letterSpacing:"0.07em"}}>⚠️ VA Weekly Checklist</p></div>
              {CHECKLIST.map((item,i)=>(
                <div key={i} onClick={()=>{const c=[...cl];c[i]=!c[i];setCl(c);}} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"7px 12px",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                  <div style={{width:13,height:13,borderRadius:4,border:`2px solid ${cl[i]?G:BR}`,background:cl[i]?G:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1,transition:"all 0.2s"}}>{cl[i]&&<span style={{fontSize:8,color:N,fontWeight:900}}>✓</span>}</div>
                  <span style={{fontSize:11,color:cl[i]?WD:WM,textDecoration:cl[i]?"line-through":"none",lineHeight:1.4}}>{item}</span>
                </div>
              ))}
            </div>
            {/* Vertical */}
            <div style={{background:NL,border:"1px solid rgba(201,150,58,0.18)",borderRadius:12,overflow:"hidden",alignSelf:"start"}}>
              <div style={{background:"rgba(201,150,58,0.08)",padding:"8px 13px",borderBottom:"1px solid rgba(201,150,58,0.12)"}}><p style={{margin:0,fontSize:10,fontWeight:800,color:GL,textTransform:"uppercase",letterSpacing:"0.08em"}}>📊 Vertical Breakdown</p></div>
              {vertBreak.length===0&&<p style={{color:WD,fontSize:12,textAlign:"center",padding:18,margin:0}}>No data yet</p>}
              {vertBreak.slice(0,8).map((r,i)=>(
                <div key={r.v} style={{padding:"6px 12px",borderBottom:"1px solid rgba(255,255,255,0.03)",background:i%2?"rgba(255,255,255,0.016)":"transparent"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:10,color:WM,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}}>{r.v}</span><span style={{fontSize:13,fontWeight:800,color:W,flexShrink:0}}>{r.c}</span></div>
                  <div style={{height:2,background:"rgba(255,255,255,0.06)",borderRadius:1}}><div style={{height:"100%",background:`linear-gradient(90deg,${G},${GL})`,borderRadius:1,width:pct(r.c,vertBreak[0]?.c||1),transition:"width 0.4s ease"}}/></div>
                </div>
              ))}
            </div>
            {/* Market */}
            <div style={{background:NL,border:"1px solid rgba(201,150,58,0.18)",borderRadius:12,overflow:"hidden",alignSelf:"start"}}>
              <div style={{background:"rgba(201,150,58,0.08)",padding:"8px 13px",borderBottom:"1px solid rgba(201,150,58,0.12)"}}><p style={{margin:0,fontSize:10,fontWeight:800,color:GL,textTransform:"uppercase",letterSpacing:"0.08em"}}>📍 Market</p></div>
              {mktBreak.length===0&&<p style={{color:WD,fontSize:12,textAlign:"center",padding:18,margin:0}}>Set markets</p>}
              {mktBreak.map((r,i)=>(
                <div key={r.m} style={{padding:"6px 12px",borderBottom:"1px solid rgba(255,255,255,0.03)",background:i%2?"rgba(255,255,255,0.016)":"transparent"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,color:WM}}>{r.m}</span><span style={{fontSize:13,fontWeight:800,color:W}}>{r.c}</span></div>
                  <div style={{height:2,background:"rgba(255,255,255,0.06)",borderRadius:1}}><div style={{height:"100%",background:"rgba(96,165,250,0.6)",borderRadius:1,width:Math.round((r.c/(mktBreak[0]?.c||1))*100)+"%",transition:"width 0.4s ease"}}/></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PROSPECT FINDER */}
      {view==="finder"&&(
        <div style={{padding:"18px 16px",maxWidth:1100,margin:"0 auto",animation:"fadeUp 0.3s ease"}}>
          <div style={{background:NL,border:"1px solid rgba(201,150,58,0.2)",borderRadius:13,padding:"18px 20px",marginBottom:18}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
              <div style={{flex:1}}>
                <h2 style={{margin:"0 0 6px",fontSize:18,fontWeight:900,color:W}}>🔍 AI Prospect Finder</h2>
                <p style={{margin:0,fontSize:12,color:WM}}>Search across multiple AI engines and data sources to discover SMB and nonprofit prospects for HR compliance outreach. Select your sources, enter search criteria, and add results directly to your prospect list.</p>
              </div>
              <button onClick={()=>setShowFinder(true)} className="bh" style={{...B.gold,display:"flex",gap:8,alignItems:"center",padding:"11px 20px",fontSize:13,flexShrink:0}}>
                🔍 Open Search Engine
              </button>
            </div>
          </div>

          {/* Source cards */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:11,marginBottom:18}}>
            {AI_SOURCES.map(s=>(
              <div key={s.id} style={{background:NL,border:`1px solid ${s.color}33`,borderRadius:12,padding:"14px 15px"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <span style={{fontSize:22}}>{s.icon}</span>
                  <div><p style={{margin:0,fontSize:12,fontWeight:700,color:W}}>{s.label}</p><p style={{margin:0,fontSize:10,color:`${s.color}cc`}}>
                    {["apollo","hunter"].includes(s.id)?"Requires API key":"Free to use in finder"}
                  </p></div>
                </div>
                <p style={{margin:0,fontSize:11,color:WM,lineHeight:1.4}}>{s.desc}</p>
              </div>
            ))}
          </div>

          <div style={{background:"rgba(96,165,250,0.06)",border:"1px solid rgba(96,165,250,0.2)",borderRadius:12,padding:16}}>
            <p style={{margin:"0 0 8px",fontSize:12,fontWeight:700,color:"#60a5fa"}}>💡 How the Prospect Finder Works</p>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
              {[{i:"1️⃣",t:"Select sources",d:"Choose which AI or database tools to search (Claude, ChatGPT, Apollo, etc.)"},
                {i:"2️⃣",t:"Enter criteria",d:"Type keywords, select vertical, market, org type, and org size filters"},
                {i:"3️⃣",t:"Review results",d:"Browse prospects with contact info, fit rationale, and pain points"},
                {i:"4️⃣",t:"Add to CRM",d:"Select any or all results and add them directly to your prospect list"},
              ].map(s=>(
                <div key={s.i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  <span style={{fontSize:18,flexShrink:0}}>{s.i}</span>
                  <div><p style={{margin:0,fontSize:11,fontWeight:700,color:W}}>{s.t}</p><p style={{margin:"2px 0 0",fontSize:11,color:WM}}>{s.d}</p></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FILTER BAR */}
      {view==="pipeline"&&(
        <div style={{background:NL,borderBottom:`1px solid ${BR}`,padding:"9px 16px",position:"sticky",top:82,zIndex:50,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{position:"relative",flex:1,minWidth:170}}>
            <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",fontSize:12,color:WD}}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search company, contact, email, notes…" style={{...inp(),paddingLeft:28}}/>
          </div>
          <select value={sfilt} onChange={e=>setSfilt(e.target.value)} style={{...inp(),width:"auto",minWidth:130,cursor:"pointer"}}><option value="All">All Statuses</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select>
          <select value={vfilt} onChange={e=>setVfilt(e.target.value)} style={{...inp(),width:"auto",minWidth:140,cursor:"pointer"}}><option value="All">All Verticals</option>{VERTICALS.map(v=><option key={v}>{v}</option>)}</select>
          <select value={mfilt} onChange={e=>setMfilt(e.target.value)} style={{...inp(),width:"auto",minWidth:110,cursor:"pointer"}}><option value="All">All Markets</option>{MARKETS.map(m=><option key={m}>{m}</option>)}</select>
          <span style={{fontSize:11,color:WD,whiteSpace:"nowrap"}}>{filtered.length}/{tot}</span>
          {(search||sfilt!=="All"||vfilt!=="All"||mfilt!=="All")&&<button onClick={()=>{setSearch("");setSfilt("All");setVfilt("All");setMfilt("All");}} style={{...B.ghost,fontSize:10,padding:"5px 9px",color:"#f87171",borderColor:"rgba(248,113,113,0.3)"}}>✕ Clear</button>}
        </div>
      )}

      {/* PROSPECTS — table / map / duplicates (src/features/prospects) */}
      {view==="table"&&(
        <ProspectsView crmData={crmData} role={role} currentUser={currentUser} canEdit={canEdit} features={features}
          sysSettings={sysSettings} savedApi={savedApi} hunterVerify={hunterVerify} applyStatus={applyTouchDates}
          onEditProspect={p=>setPDlg(p)} onAddProspect={()=>setPDlg("add")} onOpenFinder={()=>setShowFinder(true)} onOpenImport={()=>setShowImport(true)}
          onExport={exportRows} onBulkSave={bulkSave} onDeleteMany={deleteMany} onMerge={mergeRecords} toast={t2}/>
      )}

      {/* PIPELINE — Bitrix24-style kanban */}
      {view==="pipeline"&&(()=>{
        // Pipeline uses only the active outreach stages (not DNR/Converted
        // which are terminal states better viewed in the table).
        const PIPE_STAGES=[
          {s:"NEW",           label:"New & Unassigned",  accent:"#DBA843", bg:"rgba(201,150,58,0.18)"},
          {s:"T1 SENT",       label:"Touch 1 Sent",      accent:"#60a5fa", bg:"rgba(96,165,250,0.18)"},
          {s:"T2 SENT",       label:"Touch 2 Sent",      accent:"#a78bfa", bg:"rgba(139,92,246,0.18)"},
          {s:"REVIEW",        label:"Under Review",      accent:"#fde047", bg:"rgba(251,191,36,0.18)"},
          {s:"TOUCH 3 GATE",  label:"Touch 3 Gate",      accent:"#f472b6", bg:"rgba(236,72,153,0.18)"},
          {s:"NURTURE/T3 SENT",label:"Nurtured / T3",   accent:"#2dd4bf", bg:"rgba(20,184,166,0.18)"},
          {s:"Replied",       label:"Replied ✦",         accent:"#34d399", bg:"rgba(52,211,153,0.18)"},
          {s:"Converted",     label:"Converted 🎉",      accent:"#c084fc", bg:"rgba(168,85,247,0.18)"},
        ];
        // (pipeSearch / dragOver / dragging are declared at the top of CRMApp — hooks can't live inside this conditional block)

        const pipeFiltered=filtered.filter(p=>!pipeSearch||(p.companyName+p.contactName+p.vertical+p.cityMarket).toLowerCase().includes(pipeSearch.toLowerCase()));

        const totalProspects=pipeFiltered.length;
        const totalReplied=pipeFiltered.filter(p=>p.replyReceived).length;
        const totalFlagged=pipeFiltered.filter(p=>p.flagToMelissa).length;

        const handleDragStart=(e,p)=>{
          setDragging(p);
          e.dataTransfer.effectAllowed="move";
        };
        const handleDrop=(e,stage)=>{
          e.preventDefault();
          if(dragging&&dragging.currentStatus!==stage){
            onSaveProspect({...dragging,currentStatus:stage});
          }
          setDragging(null);setDragOver(null);
        };

        return(
          <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 90px)",overflow:"hidden"}}>

            {/* Board toolbar */}
            <div style={{background:NL,borderBottom:`1px solid ${BR}`,padding:"10px 18px",display:"flex",alignItems:"center",gap:12,flexShrink:0,flexWrap:"wrap"}}>
              <h2 style={{margin:0,fontSize:15,fontWeight:800,color:W}}>Pipeline</h2>
              {/* Search */}
              <div style={{position:"relative",flex:"0 0 260px"}}>
                <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:13,color:WD}}>🔍</span>
                <input value={pipeSearch} onChange={e=>setPipeSearch(e.target.value)} placeholder="Search pipeline…" style={{...inp(),paddingLeft:30,fontSize:11,padding:"6px 10px 6px 30px",height:32}}/>
              </div>
              {/* Summary pills */}
              <div style={{display:"flex",gap:7,alignItems:"center"}}>
                <span style={{fontSize:11,padding:"3px 12px",borderRadius:20,background:"rgba(201,150,58,0.12)",color:GL,border:"1px solid rgba(201,150,58,0.25)",fontWeight:700}}>{totalProspects} prospects</span>
                {totalReplied>0&&<span style={{fontSize:11,padding:"3px 12px",borderRadius:20,background:"rgba(52,211,153,0.1)",color:"#34d399",border:"1px solid rgba(52,211,153,0.25)",fontWeight:700}}>📩 {totalReplied} replied</span>}
                {totalFlagged>0&&<span style={{fontSize:11,padding:"3px 12px",borderRadius:20,background:"rgba(244,114,182,0.1)",color:"#f472b6",border:"1px solid rgba(244,114,182,0.25)",fontWeight:700}}>🚩 {totalFlagged} flagged</span>}
              </div>
              <div style={{marginLeft:"auto",display:"flex",gap:7}}>
                {canEdit&&<button onClick={()=>setPDlg({...EMPTY_P,id:uid()})} className="bh" style={{...B.gold,fontSize:11,padding:"7px 14px",display:"flex",alignItems:"center",gap:5}}>＋ Add Prospect</button>}
              </div>
            </div>

            {/* Kanban board */}
            <div style={{flex:1,overflowX:"auto",overflowY:"hidden",padding:"14px 16px"}}>
              <div style={{display:"flex",gap:11,height:"100%",minWidth:PIPE_STAGES.length*220}}>
                {PIPE_STAGES.map(({s,label,accent,bg})=>{
                  const cards=pipeFiltered.filter(p=>p.currentStatus===s);
                  const avgPriority=cards.length?Math.round(cards.reduce((a,p)=>a+(parseInt(p.priorityScore)||0),0)/cards.length):0;
                  const isDragTarget=dragOver===s;

                  return(
                    <div key={s}
                      onDragOver={e=>{e.preventDefault();setDragOver(s);}}
                      onDragLeave={()=>setDragOver(null)}
                      onDrop={e=>handleDrop(e,s)}
                      style={{
                        flex:"0 0 214px",display:"flex",flexDirection:"column",
                        background:isDragTarget?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.02)",
                        border:`1.5px solid ${isDragTarget?accent:"rgba(255,255,255,0.06)"}`,
                        borderRadius:13,overflow:"hidden",
                        transition:"border-color 0.15s, background 0.15s",
                      }}>

                      {/* Column header — colored accent bar */}
                      <div style={{background:bg,borderBottom:`1px solid ${accent}44`,padding:"10px 12px 8px"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                          <span style={{fontSize:10,fontWeight:800,color:accent,textTransform:"uppercase",letterSpacing:"0.06em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{label}</span>
                          <span style={{fontSize:12,fontWeight:900,color:W,background:"rgba(0,0,0,0.25)",borderRadius:20,padding:"1px 8px",marginLeft:5,flexShrink:0}}>{cards.length}</span>
                        </div>
                        {/* Column metric strip — avg priority + flagged count */}
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{fontSize:9,color:"rgba(255,255,255,0.5)"}}>{cards.length} prospect{cards.length!==1?"s":""}</span>
                          {avgPriority>0&&<span style={{fontSize:9,color:accent,fontWeight:700}}>avg ⭐{avgPriority}</span>}
                          {cards.filter(p=>p.flagToMelissa).length>0&&<span style={{fontSize:9,color:"#f472b6",fontWeight:700}}>🚩{cards.filter(p=>p.flagToMelissa).length}</span>}
                        </div>
                      </div>

                      {/* Cards scroll area */}
                      <div style={{flex:1,overflowY:"auto",padding:"8px 8px 4px"}}>
                        <div style={{display:"flex",flexDirection:"column",gap:7}}>
                          {cards.map(p=>{
                            const sc2=SC[p.currentStatus]||{};
                            const lastTouchDate=p.t3SendDate||p.t2SendDate||p.t1SendDate||null;
                            const touchCount=[p.t1SendDate,p.t2SendDate,p.t3SendDate].filter(Boolean).length;
                            return(
                              <div key={p.id}
                                draggable
                                onDragStart={e=>handleDragStart(e,p)}
                                onDragEnd={()=>{setDragging(null);setDragOver(null);}}
                                onClick={()=>setPDlg(p)}
                                className="rh"
                                style={{
                                  background:NL,border:`1px solid rgba(255,255,255,0.07)`,
                                  borderLeft:`3px solid ${accent}`,
                                  borderRadius:9,padding:"10px 11px",cursor:"pointer",
                                  opacity:dragging?.id===p.id?0.5:1,
                                  transition:"opacity 0.15s",
                                }}>

                                {/* Company name */}
                                <p style={{margin:"0 0 3px",fontSize:12,fontWeight:800,color:W,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.companyName}</p>

                                {/* Contact + title */}
                                {p.contactName&&<p style={{margin:"0 0 5px",fontSize:10,color:WM,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>👤 {p.contactName}{p.title?` · ${p.title}`:""}</p>}

                                {/* Vertical + market pills */}
                                <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
                                  {p.vertical&&<span style={{fontSize:8,padding:"2px 7px",background:`${accent}15`,color:accent,borderRadius:20,border:`1px solid ${accent}30`,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.vertical}</span>}
                                  {p.cityMarket&&<span style={{fontSize:8,padding:"2px 7px",background:"rgba(255,255,255,0.04)",color:WD,borderRadius:20,border:`1px solid rgba(255,255,255,0.08)`}}>{p.cityMarket}</span>}
                                </div>

                                {/* Dates + touches */}
                                {lastTouchDate&&(
                                  <p style={{margin:"0 0 5px",fontSize:9,color:WD}}>Last touch: {lastTouchDate}</p>
                                )}

                                {/* Bottom row: flags + priority + touch count */}
                                <div style={{display:"flex",alignItems:"center",gap:5,marginTop:2}}>
                                  {p.flagToMelissa&&<span style={{fontSize:10}}>🚩</span>}
                                  {p.replyReceived&&<span style={{fontSize:10}}>📩</span>}
                                  {p.doNotRespond&&<span style={{fontSize:10}}>🚫</span>}
                                  {p.t3Approved&&<span style={{fontSize:10}}>✅</span>}
                                  {touchCount>0&&<span style={{fontSize:8,padding:"1px 6px",background:"rgba(255,255,255,0.05)",color:WD,borderRadius:20,border:`1px solid rgba(255,255,255,0.08)`}}>T{touchCount}</span>}
                                  {p.priorityScore&&<span style={{marginLeft:"auto",fontSize:9,fontWeight:800,color:parseInt(p.priorityScore)>=8?"#f472b6":parseInt(p.priorityScore)>=5?GL:WD}}>⭐{p.priorityScore}</span>}
                                </div>

                                {/* Priority bar */}
                                {p.priorityScore&&(
                                  <div style={{marginTop:6,height:2,background:"rgba(255,255,255,0.06)",borderRadius:1}}>
                                    <div style={{height:"100%",background:parseInt(p.priorityScore)>=8?"#f472b6":parseInt(p.priorityScore)>=5?accent:WD,borderRadius:1,width:Math.min(parseInt(p.priorityScore)*10,100)+"%",transition:"width 0.3s"}}/>
                                  </div>
                                )}

                                {/* Email + org size footer */}
                                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6,paddingTop:5,borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                                  <span style={{fontSize:9,color:WD,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{p.emailPhone||"No email"}</span>
                                  {p.orgSize&&<span style={{fontSize:8,color:WD,flexShrink:0,marginLeft:4}}>{p.orgSize}</span>}
                                </div>
                              </div>
                            );
                          })}

                          {/* Empty state */}
                          {cards.length===0&&(
                            <div style={{textAlign:"center",padding:"20px 10px",color:WD}}>
                              <p style={{fontSize:22,margin:"0 0 4px"}}>○</p>
                              <p style={{fontSize:10,margin:0}}>No prospects</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Add here button */}
                      {canEdit&&(
                        <div style={{padding:"6px 8px",borderTop:"1px solid rgba(255,255,255,0.04)",flexShrink:0}}>
                          <button
                            onClick={()=>setPDlg({...EMPTY_P,id:uid(),currentStatus:s})}
                            style={{...B.ghost,fontSize:10,padding:"6px",width:"100%",color:WD,borderStyle:"dashed",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                            <span style={{fontSize:14,lineHeight:1}}>+</span> Quick add
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* CALENDAR */}
      {view==="calendar"&&(
        <CalendarView crmData={crmData} onViewProspect={p=>setPDlg(p)} onGoToEmail={()=>setView("email")}/>
      )}

      {/* EMAIL HUB */}
      {view==="email"&&(
        <EmailHub
          crmData={crmData}
          setCrmData={setCrmData}
          q1={q1} q2={q2} q3={q3}
          totalDue={totalDue}
          qStatus={qStatus}
          canEdit={canEdit}
          currentUser={currentUser}
          sysSettings={sysSettings}
          onViewProspect={p=>setPDlg(p)}
          t2={t2}
        />
      )}
      </div>
      {/* ═══ end main content column ═══ */}

      {/* MODALS */}
      {showImport&&<ExcelImportModal onClose={()=>setShowImport(false)} onImport={async (rows,mode)=>{await onImportProspects(rows,mode);setShowImport(false);t2(`${rows.length} prospects ${mode==="replace"?"imported":"added"}!`);}}/>}
      {showFinder&&<NationwideFinder baseUrl={SUPABASE_URL} requestHeaders={authHeaders} crmData={crmData} savedApi={savedApi} hunterVerify={hunterVerify} currentUser={currentUser} features={features} onClose={()=>setShowFinder(false)} onAddProspects={async prospects=>{await onImportProspects(prospects,"append");t2(`${prospects.length} prospect${prospects.length!==1?"s":""} added to CRM!`);}} existingIds={existingIds} sysSettings={sysSettings}/>}
      {pDlg&&<ProspectModal prospect={pDlg==="add"?{...EMPTY_P,id:uid()}:pDlg} isNew={pDlg==="add"||!crmData.find(p=>p.id===pDlg?.id)} onSave={saveP} onDelete={canEdit&&role.canDelete?deleteP:null} onClose={()=>setPDlg(null)} canDelete={canEdit&&role.canDelete}/>}
    </div>
    )
  );
}

/* ════════════════════════════════════════════════════════════════
   ROOT APP  —  Supabase-powered with local fallback
════════════════════════════════════════════════════════════════ */
export default function App(){
  const [screen,setScreen]   = useState("loading");
  const [currentUser,setCurrentUser] = useState(null);
  // Start with empty arrays — DB data loads in useEffect below.
  // INIT_USERS / SEED are used ONLY in demo mode (Supabase not configured).
  const [users,setUsers]     = useState([]);
  const [crmData,setCrmData] = useState([]);
  const [features,setFeatures] = useState({tags:!isConfigured,savedSearches:!isConfigured}); // optional DB features (see DB.detectSchema)
  const crmRef = useRef([]); crmRef.current = crmData; // latest list, for rolling back failed saves
  const [sysSettings,setSysSettings] = useState(DEFAULT_SYS);
  const [auditLog,setAuditLog] = useState([]);
  const [dbStatus,setDbStatus] = useState(isConfigured ? "connecting" : "local");
  const [dbError,setDbError]   = useState(null);

  // Tracks whether we're currently mid-OAuth-redirect (URL has #access_token)
  // so the init effect can wait instead of racing to "login" first.
  const isOAuthRedirect = typeof window !== "undefined" &&
    (window.location.hash.includes("access_token") || window.location.hash.includes("provider_token"));

  /* ── Session bootstrap ──────────────────────────────────────
   * Demo mode (no Supabase): seed data + local login.
   * Supabase mode: identity ALWAYS comes from a real Supabase Auth
   * session (email+password or Google). We ask Postgres who that user
   * is (crm_me) and load only what Row Level Security lets them see.
   * Nothing is read before sign-in and no role/ID is trusted from
   * browser storage.                                                  */
  const bootedUserRef = useRef(null);
  const nowStamp = () => new Date().toLocaleString("sv-SE",{hour12:false}).replace("T"," ").slice(0,16);

  useEffect(()=>{
    if (!isConfigured) {
      dlog("[NC CRM] Running in Demo Mode — no Supabase credentials found.");
      setUsers(INIT_USERS);
      setCrmData(SEED);
      setSysSettings(DEFAULT_SYS);
      setAuditLog([{time: nowStamp(), user:"system", action:"Demo mode initialized"}]);
      setDbStatus("local");
      try {
        const saved = JSON.parse(sessionStorage.getItem("crm_v4") || "null");
        const live = saved && INIT_USERS.find(u => u.id === saved.id && u.active);
        if (live) { setCurrentUser(live); setScreen("crm"); return; }
      } catch {}
      setScreen("login");
      return;
    }

    let cancelled = false;
    const clearGoogleTokens = () => ["google_access_token","google_refresh_token","google_email"].forEach(k => sessionStorage.removeItem(k));
    const cleanUrl = () => { if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search); };

    const rejectSession = async (msg) => {
      bootedUserRef.current = null;
      alert(msg);
      await supabaseAuth.auth.signOut().catch(()=>{});
      cleanUrl();
      if (!cancelled) { setCurrentUser(null); setScreen("login"); }
    };

    const bootstrap = async (session) => {
      if (!session?.user) return;
      // INITIAL_SESSION and SIGNED_IN can both fire for one sign-in; also SIGNED_IN
      // re-fires on tab focus. Handle each user session once.
      if (bootedUserRef.current === session.user.id) return;
      bootedUserRef.current = session.user.id;
      setScreen("loading");
      try {
        const profile = await DB.getMyProfile();
        if (!profile) {
          await rejectSession(`No active CRM account for ${session.user.email}.\n\nAsk an administrator to add or reactivate this email under Admin → Users.`);
          return;
        }
        // Gmail tokens (Google sign-in only) for the Email Hub
        if (session.provider_token) {
          sessionStorage.setItem("google_access_token", session.provider_token);
          if (session.provider_refresh_token) sessionStorage.setItem("google_refresh_token", session.provider_refresh_token);
          sessionStorage.setItem("google_email", (session.user.email || "").toLowerCase());
        }

        const [settings, dbUsers, dbProspects, dbAudit, keyStatus, feat] = await Promise.all([
          DB.getSettings().catch(e => { dwarn("[NC CRM] getSettings failed:", e.message); return {}; }),
          DB.getUsers().catch(e => { dwarn("[NC CRM] getUsers failed:", e.message); return []; }),
          DB.getProspects(),                       // surface real errors (RLS / network)
          DB.getAuditLog().catch(() => []),        // admins only — empty for everyone else
          DB.getApiCredentials().catch(() => ({})),
          DB.detectSchema().catch(() => ({ tags: false, savedSearches: false })),
        ]);
        setFeatures(feat);
        if (cancelled) return;

        setUsers(dbUsers && dbUsers.length ? dbUsers : [profile]);
        setCrmData(dbProspects || []);
        setSysSettings({
          ...DEFAULT_SYS, ...settings,
          // keys never reach the browser — only a "configured" marker
          apolloKey: keyStatus.apollo || "", hunterKey: keyStatus.hunter || "", anthropicKey: keyStatus.anthropic || "",
        });
        const me = { ...profile, lastLogin: new Date().toLocaleString() };
        setAuditLog([...(dbAudit || []), { time: nowStamp(), user: me.username, action: "Logged in" }]);
        setDbStatus("connected");
        setDbError(null);
        setCurrentUser(me);
        DB.updateLastLogin().catch(() => {});
        DB.addAudit(me.username, "Logged in").catch(() => {});
        cleanUrl(); // drop #access_token=… from the address bar
        setScreen("crm");
      } catch (e) {
        console.error("[NC CRM] ❌ Sign-in bootstrap failed:", e.message);
        bootedUserRef.current = null;
        setDbError(e.message);
        setDbStatus("error");
        setScreen("login");
      }
    };

    supabaseAuth.auth.getSession().then(({ data }) => {
      if (data?.session) bootstrap(data.session);
      else if (!isOAuthRedirect) setScreen("login");
    });
    // If an OAuth redirect never yields a session, don't hang on the loader.
    const fallback = setTimeout(() => setScreen(s => (s === "loading" && !bootedUserRef.current) ? "login" : s), 6000);

    const { data: listener } = supabaseAuth.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        bootedUserRef.current = null;
        clearGoogleTokens();
        // wipe in-memory data so nothing lingers after sign-out
        setCurrentUser(null); setCrmData([]); setUsers([]); setAuditLog([]);
        setSysSettings(DEFAULT_SYS);
        setScreen("login");
      } else if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        // Never await other Supabase calls inside this callback (can deadlock) — defer.
        setTimeout(() => bootstrap(session), 0);
      }
    });

    return () => { cancelled = true; clearTimeout(fallback); listener?.subscription?.unsubscribe(); };
  }, []);

  /* ── Audit helper ────────────────────────────────────────── */
  const addAudit = useCallback(async (username, action) => {
    const entry = { time: nowStamp(), user: username, action };
    setAuditLog(prev => [...prev, entry]);
    if (isConfigured && dbStatus === "connected") {
      try { await DB.addAudit(username, action); } catch {}
    }
  },[dbStatus]);

  /* ── Demo-mode login / logout ────────────────────────────── */
  // (In Supabase mode sign-in is handled by the auth listener above.)
  const login = async (user) => {
    const u = { ...user, lastLogin: new Date().toLocaleString() };
    setCurrentUser(u);
    setUsers(prev => prev.map(x => x.id === u.id ? {...x, lastLogin:u.lastLogin} : x));
    sessionStorage.setItem("crm_v4", JSON.stringify(u)); // demo mode only
    addAudit(u.username, "Logged in");
    setScreen("crm");
  };

  const logout = async () => {
    if (currentUser) { try { await addAudit(currentUser.username, "Logged out"); } catch {} }
    sessionStorage.removeItem("crm_v4");
    if (supabaseAuth) await supabaseAuth.auth.signOut().catch(()=>{});
    setCurrentUser(null);
    setScreen("login");
  };


  const openAdmin = () => {
    if (currentUser && ROLES[currentUser.role].canAdmin) setScreen("admin");
  };

  /* ── DB-aware save / delete wrappers passed down ─────────── */
  // Returns the saved prospect. If the database refused the change, the on-screen edit is
  // rolled back and the returned object carries __saveFailed (callers/bulk actions check it).
  const handleSaveProspect = useCallback(async (form) => {
    const before = crmRef.current.find(p => p.id === form.id);
    // Step 1: optimistic UI update (instant feedback)
    setCrmData(prev => {
      const exists = prev.find(p => p.id === form.id);
      return exists ? prev.map(p => p.id === form.id ? form : p) : [...prev, form];
    });

    // Step 2: persist to Supabase
    if (isConfigured) {
      let reason = "The database did not accept this change.";
      try {
        dlog("[NC CRM] Saving prospect to DB:", form.companyName, "| id:", form.id);
        const saved = await DB.upsertProspect(form);
        if (saved && saved.id) {
          setCrmData(prev => prev.map(p => p.id === form.id ? saved : p)); // swap temp id for the real UUID
          return saved;
        }
        reason = "Not permitted, or the record no longer exists.";
      } catch(e) {
        console.error("[NC CRM] ❌ Prospect save failed:", e.message);
        reason = e.message || reason;
      }
      // roll the screen back so it never shows data that was not stored
      setCrmData(prev => before ? prev.map(p => p.id === form.id ? before : p) : prev.filter(p => p.id !== form.id));
      return { ...form, __saveFailed: reason };
    }
    return form;
  },[]); // no deps — uses module-level isConfigured and crmRef

  // Returns true when deleted; false (and restores the row) when the database refused.
  const handleDeleteProspect = useCallback(async (id) => {
    const before = crmRef.current.find(p => p.id === id);
    setCrmData(prev => prev.filter(p => p.id !== id)); // optimistic
    if (isConfigured) {
      try {
        await DB.deleteProspect(id);
      } catch(e) {
        console.error("[NC CRM] ❌ Delete failed:", e.message);
        if (before) setCrmData(prev => prev.some(p => p.id === id) ? prev : [...prev, before]);
        return false;
      }
    }
    return true;
  },[]);

  const handleImportProspects = useCallback(async (rows, mode) => {
    if (mode === "replace") {
      setCrmData(rows); // optimistic
      if (isConfigured) {
        try {
          await DB.deleteAllProspects();
          const saved = await DB.upsertProspects(rows);
          if (saved && saved.length) {
            setCrmData(saved);
            dlog("[NC CRM] ✅ Imported", saved.length, "prospects (replace)");
          }
        } catch(e) { console.error("[NC CRM] ❌ Import replace failed:", e.message); }
      }
    } else {
      setCrmData(prev => [...prev, ...rows]); // optimistic
      if (isConfigured) {
        try {
          const saved = await DB.upsertProspects(rows);
          if (saved && saved.length) {
            setCrmData(prev => {
              const tempIds = new Set(rows.map(r => r.id));
              return [...prev.filter(p => !tempIds.has(p.id)), ...saved];
            });
            dlog("[NC CRM] ✅ Imported", saved.length, "prospects (append)");
          }
        } catch(e) { console.error("[NC CRM] ❌ Import append failed:", e.message); }
      }
    }
  },[]);

  const handleSaveUser = useCallback(async (u) => {
    let saved = u;
    if (isConfigured) {
      saved = await DB.upsertUser(u);            // throws on failure → Admin panel shows the error
      if (!saved || !saved.id) throw new Error("Not permitted, or the user could not be saved.");
    }
    setUsers(prev => prev.some(x => x.id === u.id) ? prev.map(x => x.id === u.id ? saved : x) : [...prev, saved]);
    return saved;
  },[]);

  const handleDeleteUser = useCallback(async (id) => {
    if (isConfigured) await DB.deleteUser(id);   // throws if RLS denies
    setUsers(prev => prev.filter(u => u.id !== id));
  },[]);

  const handleSaveSettings = useCallback(async (settings) => {
    setSysSettings(settings);
    if (isConfigured) {
      try {
        await DB.saveSettings(settings);
        dlog("[NC CRM] ✅ Settings saved to DB");
      } catch(e) {
        console.error("[NC CRM] ❌ Settings save failed:", e.message);
      }
    }
  },[]);

  /* ── Loading screen ──────────────────────────────────────── */
  if (screen === "loading") return (
    <div style={{background:N,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <GS/>
      <div style={{textAlign:"center"}}>
        <div style={{width:64,height:64,background:`linear-gradient(135deg,${G},${GL})`,borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",boxShadow:`0 12px 40px rgba(201,150,58,0.4)`}}>
          <span style={{fontSize:30}}>⚖️</span>
        </div>
        <Spin s={36} c={G}/>
        <p style={{color:WD,fontSize:13,marginTop:16}}>
          {isConfigured ? "Connecting to database…" : "Loading NC Compliance CRM…"}
        </p>
        {isConfigured && <p style={{color:WD,fontSize:11,marginTop:6,opacity:0.6}}>Supabase · PostgreSQL</p>}
      </div>
    </div>
  );

  /* ── DB status banner (shown across all screens) ─────────── */
  const DbBanner = () => {
    // "connecting" and "connected" states are hidden — no need to show
    // a persistent indicator when everything is working normally.
    // Only show banners that require user action (Demo Mode / DB Error).
    if (dbStatus === "connecting") return null;
    if (dbStatus === "connected") return null;
    if (dbStatus === "local") return (
      <div style={{position:"fixed",bottom:12,left:12,zIndex:9998,display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.25)",borderRadius:20,fontSize:10,color:"#fbbf24",cursor:"pointer",maxWidth:460}}
        title="Open browser console (F12) to see debug info. Check that VITE_SUPABASE_URL and VITE_SUPABASE_KEY are set in Vercel → Settings → Environment Variables, then redeploy."
        onClick={()=>alert("Demo Mode active — Supabase not connected.\n\nTo connect:\n1. Go to Vercel → your project → Settings → Environment Variables\n2. Make sure VITE_SUPABASE_URL and VITE_SUPABASE_KEY are set\n3. Trigger a new deployment (Deployments → Redeploy)\n4. Open browser console (F12) and look for [NC CRM] log messages")}>
        <div style={{width:6,height:6,borderRadius:"50%",background:"#fbbf24",flexShrink:0}}/>
        <span>⚠️ Demo Mode — data resets on refresh. <u>Click for fix instructions.</u></span>
      </div>
    );
    if (dbStatus === "error") return (
      <div style={{position:"fixed",bottom:12,left:12,zIndex:9998,display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:20,fontSize:10,color:"#f87171",cursor:"pointer",maxWidth:520}}
        title={dbError}
        onClick={()=>alert(`Supabase DB Error:\n\n${dbError}\n\nCheck browser console (F12) for [NC CRM] log messages.`)}>
        <div style={{width:6,height:6,borderRadius:"50%",background:"#f87171",flexShrink:0}}/>
        <span>❌ DB Error — {(dbError||"").slice(0,60)}{(dbError||"").length>60?"…":""} · <u>Click for details</u></span>
      </div>
    );
    return null;
  };

  if (screen === "login") return (
    <>
      <LoginScreen users={users} onLogin={login}/>
      <DbBanner/>
    </>
  );

  if (screen === "admin" && currentUser && ROLES[currentUser.role].canAdmin) return (
    <>
      <AdminPanel
        currentUser={currentUser}
        users={users}
        setUsers={(u) => {
          if (typeof u === "function") setUsers(u);
          else setUsers(u);
        }}
        onSaveUser={handleSaveUser}
        onDeleteUser={handleDeleteUser}
        crmData={crmData}
        setCrmData={setCrmData}
        onSaveProspect={handleSaveProspect}
        onDeleteProspect={handleDeleteProspect}
        onImportProspects={handleImportProspects}
        sysSettings={sysSettings}
        setSysSettings={setSysSettings}
        onSaveSettings={handleSaveSettings}
        auditLog={auditLog}
        addAudit={addAudit}
        onBack={()=>setScreen("crm")}
        onLogout={logout}
        dbStatus={dbStatus}
      />
      <DbBanner/>
    </>
  );

  if (screen === "crm" && currentUser) return (
    <>
      <CRMApp
        currentUser={currentUser}
        onLogout={logout}
        onOpenAdmin={openAdmin}
        crmData={crmData}
        setCrmData={setCrmData}
        onSaveProspect={handleSaveProspect}
        onDeleteProspect={handleDeleteProspect}
        onImportProspects={handleImportProspects}
        sysSettings={sysSettings}
        dbStatus={dbStatus}
        features={features}
        addAudit={addAudit}
      />
      <DbBanner/>
    </>
  );

  return <><LoginScreen users={users} onLogin={login}/><DbBanner/></>;
}
