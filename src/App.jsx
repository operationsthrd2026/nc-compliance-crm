import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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
const dlog = (...args) => { if (DEBUG) dlog(...args); };
const dwarn = (...args) => { if (DEBUG) dwarn(...args); };

if (DEBUG) {
  console.log("[NC CRM] Debug logging enabled. Supabase configured:", isConfigured,
    "| URL:", SUPABASE_URL.startsWith("https://") ? SUPABASE_URL.slice(0,40)+"…" : "(not set)");
}

// ── Supabase Auth client (separate from the sbFetch REST helper) ──
// Used ONLY for Google OAuth sign-in. All other DB reads/writes still
// go through sbFetch with the anon key — this client just manages the
// browser auth session and OAuth redirect flow.
const supabaseAuth = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/* ════════════════════════════════════════════════════════════════
   SUPABASE DATABASE LAYER
   All DB calls go through these helpers. When not configured,
   they fall back to local state (demo mode).
════════════════════════════════════════════════════════════════ */
async function sbFetch(path, method = "GET", body = null, prefer = "return=representation") {
  // Clean, conflict-free header builder
  const headers = {
    "apikey":        SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Content-Type":  "application/json",
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
    console.error(`[NC CRM DB] ❌ ${method} ${path} → ${res.status}:`, text);
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
  };
}

function dbToUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, password: r.password, name: r.name,
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
    await sbFetch(`prospects?id=eq.${encodeURIComponent(id)}`, "DELETE");
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

  // Users
  async getUsers() {
    const rows = await sbFetch("crm_users?order=created_at.asc&select=*");
    return (rows || []).map(dbToUser);
  },
  async upsertUser(u) {
    const isDbId = typeof u.id === "string" && /^[0-9a-f-]{36}$/.test(u.id);
    const body = { username:u.username, password:u.password, name:u.name, email:u.email, role:u.role, active:u.active, avatar:u.avatar };
    if (isDbId) {
      const rows = await sbFetch(`crm_users?id=eq.${encodeURIComponent(u.id)}`, "PATCH", body, "return=representation");
      return dbToUser(Array.isArray(rows) ? rows[0] : rows);
    } else {
      const rows = await sbFetch("crm_users", "POST", body, "return=representation");
      return dbToUser(Array.isArray(rows) ? rows[0] : rows);
    }
  },
  async deleteUser(id) {
    await sbFetch(`crm_users?id=eq.${encodeURIComponent(id)}`, "DELETE");
  },
  async updateLastLogin(id) {
    await sbFetch(`crm_users?id=eq.${encodeURIComponent(id)}`, "PATCH", { last_login: new Date().toISOString() }, "return=minimal");
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
    const rows = Object.entries(settings).map(([key, value]) => ({ key, value: String(value) }));
    await sbFetch("system_settings", "POST", rows, "resolution=merge-duplicates,return=minimal");
  },

  // API plugin credentials (Apollo, Hunter, Anthropic, ...) — stored
  // in their own table so each integration carries its own metadata
  // (last updated, by whom). Returns a flat { apollo: "key", hunter: "key", ... } map.
  async getApiCredentials() {
    const rows = await sbFetch("api_credentials?select=service,api_key,updated_at,updated_by");
    const out = {};
    (rows||[]).forEach(r => { out[r.service] = r.api_key || ""; });
    return out;
  },
  // Upsert a single credential by service name. Uses PATCH-then-POST-
  // fallback (same pattern as saveSettings's sibling methods) so this
  // works whether or not the seed row for this service already exists.
  async saveApiCredential(service, apiKey, username) {
    const patchResult = await sbFetch(`api_credentials?service=eq.${encodeURIComponent(service)}`, "PATCH",
      { api_key: apiKey, updated_by: username||"" }, "return=representation"
    ).catch(()=>null);
    if (patchResult && Array.isArray(patchResult) && patchResult.length>0) return patchResult[0];
    // No existing row — insert one
    const inserted = await sbFetch("api_credentials", "POST",
      { service, api_key: apiKey, updated_by: username||"" }, "return=representation"
    );
    return Array.isArray(inserted) ? inserted[0] : inserted;
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
const N="#0B1426";const NL="#111E38";const NC="#162040";const NB="#1C2B50";
const G="#C9963A";const GL="#DBA843";const W="#F0F4FF";const WM="rgba(240,244,255,0.55)";const WD="rgba(240,244,255,0.28)";const BR="rgba(240,244,255,0.08)";

/* ════════════════════════════════════════════════════════════════
   ROLES
════════════════════════════════════════════════════════════════ */
const ROLES={
  superadmin:{label:"Super Admin",color:"#e879f9",bg:"rgba(232,121,249,0.13)",icon:"🔱",canAdmin:true,canManageUsers:true,canDelete:true,canEditSystem:true,canEdit:true},
  admin:     {label:"Admin",      color:"#DBA843",bg:"rgba(219,168,67,0.13)", icon:"⚡",canAdmin:true,canManageUsers:true,canDelete:true,canEditSystem:true,canEdit:true},
  manager:   {label:"Manager",   color:"#34d399",bg:"rgba(52,211,153,0.13)", icon:"📋",canAdmin:false,canManageUsers:false,canDelete:false,canEditSystem:false,canEdit:true},
  user:      {label:"User",      color:"#60a5fa",bg:"rgba(96,165,250,0.13)", icon:"👤",canAdmin:false,canManageUsers:false,canDelete:false,canEditSystem:false,canEdit:true},
  viewer:    {label:"Viewer",    color:"#94a3b8",bg:"rgba(148,163,184,0.1)", icon:"👁",canAdmin:false,canManageUsers:false,canDelete:false,canEditSystem:false,canEdit:false},
};

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

const STATUSES=["NEW","T1 SENT","T2 SENT","REVIEW","TOUCH 3 GATE","NURTURE/T3 SENT","Replied","Do Not Respond","Converted"];
const VERTICALS=["Home Health / Homecare","Childcare & Licensed Group Homes","Construction & Contractors","Healthcare Practices","Light Manufacturing & Logistics","Nonprofits & Associations","Faith-Based Organizations","Education & Schools","Human Services Nonprofits","Community Development Orgs","Religious & Faith-Based Nonprofits","Social Service Agencies","Arts & Cultural Nonprofits","Environmental Nonprofits","Advocacy Organizations","Foundations & Grantmakers"];
const MARKETS=["Raleigh","Durham","Chapel Hill","Greenville","Cary","Wilmington","Charlotte","Asheville","Fayetteville","Greensboro","Winston-Salem","High Point","Rocky Mount","Goldsboro","Other"];
const ORG_SIZES=["1-9","10-49","50-99","100-249","250-499","500+"];
const SRC_TYPES=["Apollo.io","Hunter.io","LinkedIn","Nonprofit Directory","Charity Navigator","GuideStar / Candid","Google Maps","IRS 990 Database","State Registry","Referral","Website","Claude AI","ChatGPT","Gemini","Other AI","Manual Research"];

const SC={
  "NEW":            {bg:"rgba(201,150,58,0.15)",c:"#DBA843",b:"rgba(201,150,58,0.4)"},
  "T1 SENT":        {bg:"rgba(96,165,250,0.12)",c:"#60a5fa",b:"rgba(96,165,250,0.35)"},
  "T2 SENT":        {bg:"rgba(139,92,246,0.12)",c:"#a78bfa",b:"rgba(139,92,246,0.35)"},
  "REVIEW":         {bg:"rgba(251,191,36,0.12)",c:"#fde047",b:"rgba(251,191,36,0.35)"},
  "TOUCH 3 GATE":   {bg:"rgba(236,72,153,0.12)",c:"#f472b6",b:"rgba(236,72,153,0.35)"},
  "NURTURE/T3 SENT":{bg:"rgba(20,184,166,0.12)",c:"#2dd4bf",b:"rgba(20,184,166,0.35)"},
  "Replied":        {bg:"rgba(52,211,153,0.12)",c:"#34d399",b:"rgba(52,211,153,0.35)"},
  "Do Not Respond": {bg:"rgba(239,68,68,0.12)", c:"#f87171",b:"rgba(239,68,68,0.35)"},
  "Converted":      {bg:"rgba(168,85,247,0.12)",c:"#c084fc",b:"rgba(168,85,247,0.35)"},
};

const EMPTY_P={id:null,companyName:"",contactName:"",title:"",emailPhone:"",cityMarket:"",market:"",sourceUrl:"",sourceType:"",verificationNotes:"",whyFit:"",vertical:"",hrPersonListed:"No",hrPeopleContact:"",orgSize:"",t1SendDate:"",t1DueDate:"",t2SendDate:"",t2DueDate:"",t3SendDate:"",t3DueDate:"",leadPainPoint:"",melissaReview:"",t3Approved:false,replyReceived:false,flagToMelissa:false,doNotRespond:false,currentStatus:"NEW",outreachNotes:"",priorityScore:"",remarks:""};

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
const COL_MAP={"company name":"companyName","company":"companyName","contact name":"contactName","contact":"contactName","name":"contactName","title":"title","job title":"title","position":"title","email":"emailPhone","phone":"emailPhone","email/phone":"emailPhone","email / phone":"emailPhone","city":"cityMarket","city/market":"cityMarket","market":"market","source url":"sourceUrl","url":"sourceUrl","source type":"sourceType","source":"sourceType","notes":"verificationNotes","verification notes":"verificationNotes","why fit":"whyFit","vertical":"vertical","industry":"vertical","hr person listed":"hrPersonListed","org size":"orgSize","company size":"orgSize","t1 send date":"t1SendDate","t1 due date":"t1DueDate","t2 send date":"t2SendDate","t2 due date":"t2DueDate","t3 send date":"t3SendDate","t3 due date":"t3DueDate","lead pain point":"leadPainPoint","pain point":"leadPainPoint","status":"currentStatus","current status":"currentStatus","priority score":"priorityScore","priority":"priorityScore","outreach notes":"outreachNotes","remarks":"remarks"};

/* ════════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
const uid=()=>Date.now()+Math.random();
const today=()=>new Date().toISOString().split("T")[0];
const pct=(n,t)=>t?((n/t)*100).toFixed(1)+"%":"0%";
const isPast=d=>d&&new Date(d+"T23:59:59")<new Date();
const hasEM=p=>!!(p.emailPhone&&p.emailPhone.includes("@"));
const tsNow=()=>new Date().toLocaleString("sv-SE",{hour12:false}).replace("T"," ").slice(0,16);
const initials=n=>n.split(" ").map(x=>x[0]||"").join("").slice(0,2).toUpperCase();
// Add N days to a YYYY-MM-DD date string (or today if none given), return YYYY-MM-DD
const addDays=(dateStr,n)=>{const d=dateStr?new Date(dateStr+"T00:00:00"):new Date();d.setDate(d.getDate()+n);return d.toISOString().split("T")[0];};

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
const rowToProspect=row=>{const p={...EMPTY_P,id:uid()};Object.entries(row).forEach(([col,val])=>{const f=mapHdr(col);if(!f)return;const df=["t1SendDate","t1DueDate","t2SendDate","t2DueDate","t3SendDate","t3DueDate"];const bf=["t3Approved","replyReceived","flagToMelissa","doNotRespond"];if(df.includes(f))p[f]=parseDate(val);else if(bf.includes(f))p[f]=parseBool(val);else p[f]=val!=null?String(val).trim():"";});return p;};
const exportToExcel=(crmData,fn="NC_CRM_Export")=>{const rows=crmData.map(p=({"Company Name":p.companyName,"Contact Name":p.contactName,"Title":p.title,"Email/Phone":p.emailPhone,"City/Market":p.cityMarket,"Market":p.market,"Vertical":p.vertical,"Org Size":p.orgSize,"Source Type":p.sourceType,"Source URL":p.sourceUrl,"Why Fit":p.whyFit,"Lead Pain Point":p.leadPainPoint,"Current Status":p.currentStatus,"Priority Score":p.priorityScore,"T1 Send Date":p.t1SendDate,"T1 Due Date":p.t1DueDate,"T2 Send Date":p.t2SendDate,"T2 Due Date":p.t2DueDate,"T3 Send Date":p.t3SendDate,"T3 Due Date":p.t3DueDate,"HR Person Listed":p.hrPersonListed,"HR Contact":p.hrPeopleContact,"Flag to Melissa":p.flagToMelissa?"Yes":"No","Reply Received":p.replyReceived?"Yes":"No","T3 Approved":p.t3Approved?"Yes":"No","Do Not Respond":p.doNotRespond?"Yes":"No","Outreach Notes":p.outreachNotes,"Remarks":p.remarks}));const wb=XLSX.utils.book_new();const ws=XLSX.utils.json_to_sheet(rows);ws["!cols"]=Object.keys(rows[0]||{}).map(()=>({wch:18}));XLSX.utils.book_append_sheet(wb,ws,"Prospects");XLSX.writeFile(wb,`${fn}_${today()}.xlsx`);};

/* ════════════════════════════════════════════════════════════════
   STYLES
════════════════════════════════════════════════════════════════ */
const inp=()=>({background:"rgba(255,255,255,0.06)",border:"1.5px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"9px 12px",color:W,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box",fontFamily:"inherit",transition:"border-color 0.2s"});
const LBL={display:"block",fontSize:10,color:WD,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:700};
const B={
  gold:   {background:`linear-gradient(135deg,${G},${GL})`,color:"#0B1426",border:"none",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:800,cursor:"pointer"},
  ghost:  {background:"rgba(255,255,255,0.06)",color:WM,border:"1px solid rgba(255,255,255,0.12)",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:600,cursor:"pointer"},
  danger: {background:"rgba(239,68,68,0.1)",color:"#f87171",border:"1px solid rgba(239,68,68,0.28)",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:700,cursor:"pointer"},
  green:  {background:"rgba(52,211,153,0.12)",color:"#34d399",border:"1px solid rgba(52,211,153,0.28)",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:700,cursor:"pointer"},
  purple: {background:"rgba(168,85,247,0.12)",color:"#c084fc",border:"1px solid rgba(168,85,247,0.28)",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:700,cursor:"pointer"},
  blue:   {background:"rgba(96,165,250,0.12)",color:"#60a5fa",border:"1px solid rgba(96,165,250,0.28)",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:700,cursor:"pointer"},
};

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
const HR_LOGO="data:image/webp;base64,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";

function LoginScreen({users,onLogin}){
  const [un,setUn]=useState("");const [pw,setPw]=useState("");const [show,setShow]=useState(false);
  const [loading,setLoading]=useState(false);const [gload,setGload]=useState(false);const [err,setErr]=useState("");

  const attempt=async(u,p)=>{
    const usr=(u||un).trim();const pass=p||pw;if(!usr||!pass)return;
    setErr("");setLoading(true);
    await new Promise(r=>setTimeout(r,420)); // small delay for UX feel
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
            <FG label="Username">
              <input value={un} onChange={e=>{setUn(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&attempt()} placeholder="Enter your username" style={inp()} autoFocus/>
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
const NC_CITY_COORDS = {
  "Raleigh":[35.7796,-78.6382], "Durham":[35.9940,-78.8986], "Chapel Hill":[35.9132,-79.0558],
  "Greenville":[35.6127,-77.3664], "Cary":[35.7915,-78.7811], "Wilmington":[34.2257,-77.9447],
  "Charlotte":[35.2271,-80.8431], "Asheville":[35.5951,-82.5515], "Fayetteville":[35.0527,-78.8784],
  "Greensboro":[36.0726,-79.7920], "Winston-Salem":[36.0999,-80.2442], "High Point":[35.9557,-80.0053],
  "Rocky Mount":[35.9382,-77.7905], "Goldsboro":[35.3849,-77.9928],
};
const DEFAULT_NC_COORDS = [35.7596,-79.0193]; // geographic center of NC, used when no market is selected

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

/* ── Fit Score — transparent, NOT a conversion rate ──────────────
   This is intentionally NOT presented as "conversion rate" or any
   implied probability of closing a deal — we have no historical
   outcome data to base that on. It's a simple, fully-explainable
   heuristic from signals actually present on each result: having a
   website, a phone number, a named contact, and an exact vertical
   match each add points. The breakdown is shown to the user on
   request so nothing here is a black box.                         */
function computeFitScore(prospect){
  let score = 30; // baseline
  const reasons = [];
  if(prospect.sourceUrl){ score+=20; reasons.push("Has a website (+20)"); }
  if(prospect.emailPhone){ score+=20; reasons.push("Has contact info (+20)"); }
  if(prospect.contactName){ score+=15; reasons.push("Named contact available (+15)"); }
  if(prospect._verified){ score+=10; reasons.push("Verified result (+10)"); }
  if(prospect._geoPrecise){ score+=5; reasons.push("Precise location data (+5)"); }
  score = Math.max(0, Math.min(100, score));
  const label = score>=70?"Strong fit":score>=45?"Possible fit":"Limited info";
  return { score, label, reasons };
}

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
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(apiKey)}&limit=10`;
    const res = await fetch(url);
    const data = await res.json();

    if(!res.ok){
      const msg = data?.errors?.[0]?.details || data?.errors?.[0]?.id || `HTTP ${res.status}`;
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
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "apikey": SUPABASE_KEY,
      },
      body: JSON.stringify({ apiKey, query, page: 1, perPage: 10 }),
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
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "apikey": SUPABASE_KEY,
      },
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
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "apikey": SUPABASE_KEY,
      },
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
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "apikey": SUPABASE_KEY,
      },
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

function ProspectFinderModal({onClose,onAddProspects,existingIds,sysSettings}){
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
      const {_id,_source,_verified,...rest}=r;
      return{...EMPTY_P,...rest,id:uid(),sourceType:AI_SOURCES.find(s=>s.id===r._source)?.label||r._source,currentStatus:"NEW"};
    });
    onAddProspects(toAdd);
    onClose();
  };

  const hasKey=src=>(src==="apollo"&&sysSettings.apolloKey)||(src==="hunter"&&sysSettings.hunterKey)||!["apollo","hunter"].includes(src);

  // Apply in-results filter + sort to the raw results list, without
  // mutating `results` itself (so toggling filters doesn't lose data).
  const displayedResults=useMemo(()=>{
    let list=[...results];
    if(resultFilter==="verified")list=list.filter(r=>r._verified);
    else if(resultFilter==="unverified")list=list.filter(r=>!r._verified);
    else if(resultFilter==="new")list=list.filter(r=>!existingIds.has(r.companyName?.toLowerCase())&&!existingIds.has(r.emailPhone?.toLowerCase()));

    if(sortBy==="priority")list.sort((a,b)=>(parseInt(b.priorityScore)||0)-(parseInt(a.priorityScore)||0));
    else if(sortBy==="name")list.sort((a,b)=>(a.companyName||"").localeCompare(b.companyName||""));
    else if(sortBy==="verified")list.sort((a,b)=>(b._verified?1:0)-(a._verified?1:0));
    return list;
  },[results,resultFilter,sortBy,existingIds]);

  const newCount=results.filter(r=>!existingIds.has(r.companyName?.toLowerCase())&&!existingIds.has(r.emailPhone?.toLowerCase())).length;
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
                  <button onClick={selectAll} style={{...B.ghost,fontSize:10,padding:"5px 11px"}}>Select All</button>
                  <button onClick={clearSel} style={{...B.ghost,fontSize:10,padding:"5px 11px"}}>Clear</button>
                  {selected.size>0&&<button onClick={doAdd} className="bh" style={{...B.gold,fontSize:11,padding:"7px 16px",display:"flex",gap:6,alignItems:"center"}}>
                    ➕ Add {selected.size} to CRM
                  </button>}
                </div>
              </div>
              {/* Sort + in-results filter controls */}
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{fontSize:10,color:WD,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>Show:</span>
                {[["all","All"],["new","New only"],["verified","Verified"],["unverified","Unverified"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setResultFilter(k)} style={{fontSize:10,padding:"4px 11px",borderRadius:20,border:`1px solid ${resultFilter===k?"rgba(201,150,58,0.4)":BR}`,background:resultFilter===k?"rgba(201,150,58,0.12)":"rgba(255,255,255,0.03)",color:resultFilter===k?GL:WD,cursor:"pointer",fontWeight:resultFilter===k?700:500}}>{l}</button>
                ))}
                <span style={{fontSize:10,color:WD,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginLeft:10}}>Sort:</span>
                {[["priority","Priority"],["verified","Verified first"],["name","Company name"]].map(([k,l])=>(
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
                    const alreadyIn=existingIds.has(r.companyName?.toLowerCase())||existingIds.has(r.emailPhone?.toLowerCase());
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
                      <input type="checkbox" checked={displayedResults.every(r=>selected.has(r._id)||existingIds.has(r.companyName?.toLowerCase()))} onChange={()=>{
                        const allSel = displayedResults.every(r=>selected.has(r._id));
                        setSelected(prev=>{
                          const next=new Set(prev);
                          displayedResults.forEach(r=>{
                            const already=existingIds.has(r.companyName?.toLowerCase())||existingIds.has(r.emailPhone?.toLowerCase());
                            if(already)return;
                            if(allSel)next.delete(r._id);else next.add(r._id);
                          });
                          return next;
                        });
                      }} style={{cursor:"pointer"}}/>
                    </th>
                    <th style={{textAlign:"left",padding:"9px 8px",fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.05em"}}>Business</th>
                    <th style={{textAlign:"left",padding:"9px 8px",fontSize:10,fontWeight:700,color:WD,textTransform:"uppercase",letterSpacing:"0.05em"}}>Fit Score</th>
                    <th style={{textAlign:"left",padding:"9px 8px",fontS
