import { useState, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

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

// Reads from .env.local first (Option A), falls back to hardcoded (Option B)
const SUPABASE_URL =https://tprimzlbzbrhuxxsgxxa.supabase.co
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
  "YOUR_PROJECT_URL_HERE";   // ← Option B: paste your Project URL here

const SUPABASE_KEY =eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcmltemxiemJyaHV4eHNneHhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NTA4MjIsImV4cCI6MjA5NjQyNjgyMn0.hVD7jE5Kxi732cpCti8rb6A3udVAqf1NVTbtUfnuAKs
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_KEY) ||
  "YOUR_ANON_KEY_HERE";      // ← Option B: paste your anon key here

const isConfigured =
  SUPABASE_URL !== "YOUR_PROJECT_URL_HERE" &&
  SUPABASE_KEY !== "YOUR_ANON_KEY_HERE" &&
  SUPABASE_URL.startsWith("https://");

/* ════════════════════════════════════════════════════════════════
   SUPABASE DATABASE LAYER
   All DB calls go through these helpers. When not configured,
   they fall back to local state (demo mode).
════════════════════════════════════════════════════════════════ */
async function sbFetch(path, opts = {}) {
  // Build headers — prefer in opts.headers wins over opts.prefer wins over default
  const preferHeader = (opts.headers && opts.headers["Prefer"]) || opts.prefer || "return=representation";
  const headers = {
    "apikey":        SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Content-Type":  "application/json",
    "Prefer":        preferHeader,
    ...(opts.headers || {}),
  };
  // Remove internal-only key so it doesn't leak into headers
  delete headers["Prefer"]; headers["Prefer"] = preferHeader;

  const fetchOpts = { method: opts.method || "GET", headers };
  if (opts.body) fetchOpts.body = opts.body;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, fetchOpts);

  // 204 No Content (DELETE success) — nothing to parse
  if (res.status === 204) return null;

  if (!res.ok) {
    let errText = "";
    try { errText = await res.text(); } catch {}
    throw new Error(`Supabase ${res.status} on ${path}: ${errText}`);
  }

  // Some responses (PATCH with return=minimal) are also empty
  const text = await res.text();
  if (!text || text.trim() === "") return null;
  try { return JSON.parse(text); }
  catch { return text; }
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
      const rows = await sbFetch(`prospects?id=eq.${encodeURIComponent(p.id)}`, {
        method: "PATCH",
        headers: { "Prefer": "return=representation" },
        body: JSON.stringify(body),
      });
      return dbToProspect(Array.isArray(rows) ? rows[0] : rows);
    } else {
      // INSERT new row — let Supabase generate the UUID
      const rows = await sbFetch("prospects", {
        method: "POST",
        headers: { "Prefer": "return=representation" },
        body: JSON.stringify(body),
      });
      return dbToProspect(Array.isArray(rows) ? rows[0] : rows);
    }
  },
  async deleteProspect(id) {
    await sbFetch(`prospects?id=eq.${id}`, { method: "DELETE" });
  },
  async upsertProspects(list) {
    // Bulk INSERT — strip local numeric IDs so Supabase generates fresh UUIDs
    const rows = list.map(p => {
      const row = prospectToDb(p);
      // Only include id if it looks like a real UUID
      if (typeof p.id === "string" && /^[0-9a-f-]{36}$/.test(p.id)) row.id = p.id;
      return row;
    });
    const result = await sbFetch("prospects", {
      method: "POST",
      headers: { "Prefer": "return=representation" },
      body: JSON.stringify(rows),
    });
    return (Array.isArray(result) ? result : []).map(dbToProspect);
  },
  async deleteAllProspects() {
    await sbFetch("prospects?id=neq.00000000-0000-0000-0000-000000000000", { method: "DELETE" });
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
      const rows = await sbFetch(`crm_users?id=eq.${encodeURIComponent(u.id)}`, {
        method:"PATCH",
        headers:{"Prefer":"return=representation"},
        body: JSON.stringify(body),
      });
      return dbToUser(Array.isArray(rows) ? rows[0] : rows);
    } else {
      const rows = await sbFetch("crm_users", {
        method:"POST",
        headers:{"Prefer":"return=representation"},
        body: JSON.stringify(body),
      });
      return dbToUser(Array.isArray(rows) ? rows[0] : rows);
    }
  },
  async deleteUser(id) {
    await sbFetch(`crm_users?id=eq.${id}`, { method:"DELETE" });
  },
  async updateLastLogin(id) {
    await sbFetch(`crm_users?id=eq.${id}`, {
      method:"PATCH", prefer:"return=minimal",
      body: JSON.stringify({ last_login: new Date().toISOString() }),
    });
  },

  // Audit log
  async getAuditLog() {
    const rows = await sbFetch("audit_log?order=created_at.asc&select=*&limit=200");
    return (rows||[]).map(r=>({ time: r.created_at ? r.created_at.slice(0,16).replace("T"," ") : "", user: r.username, action: r.action }));
  },
  async addAudit(username, action) {
    await sbFetch("audit_log", { method:"POST", prefer:"return=minimal", body: JSON.stringify({ username, action }) });
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
    // Upsert each key one at a time to avoid bulk conflict issues
    const entries = Object.entries(settings);
    for (const [key, value] of entries) {
      await sbFetch(`system_settings?key=eq.${encodeURIComponent(key)}`, {
        method: "PATCH",
        headers: { "Prefer": "return=minimal" },
        body: JSON.stringify({ value: String(value) }),
      }).catch(async () => {
        // If PATCH fails (row doesn't exist), INSERT it
        await sbFetch("system_settings", {
          method: "POST",
          headers: { "Prefer": "return=minimal" },
          body: JSON.stringify({ key, value: String(value) }),
        });
      });
    }
  },

  // Emails
  async getEmails() {
    const rows = await sbFetch("emails?order=sent_at.desc&select=*&limit=100");
    return rows || [];
  },
  async addEmail(email) {
    await sbFetch("emails", { method:"POST", prefer:"return=minimal", body: JSON.stringify(email) });
  },
};

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
   AI SEARCH — MOCK PROSPECT DATABASE (simulates API results)
════════════════════════════════════════════════════════════════ */
const MOCK_PROSPECTS=[
  {companyName:"Sunrise Senior Living NC",contactName:"Patricia Moore",title:"Regional Director",emailPhone:"pmoore@sunrisesenior-nc.com",cityMarket:"Raleigh",market:"Raleigh",vertical:"Home Health / Homecare",orgSize:"100-249",sourceType:"Claude AI",whyFit:"Large senior care organization with FLSA wage classification exposure and caregiver staffing compliance needs.",leadPainPoint:"Overtime misclassification, caregiver independent contractor risk",priorityScore:"9"},
  {companyName:"Healing Hands Home Health",contactName:"Dr. Amara Osei",title:"CEO",emailPhone:"aosei@healinghands-nc.org",cityMarket:"Charlotte",market:"Charlotte",vertical:"Home Health / Homecare",orgSize:"50-99",sourceType:"ChatGPT",whyFit:"Mid-size home health agency facing NC DMA audit exposure and FLSA classification issues.",leadPainPoint:"NC DHHS compliance, aide classification",priorityScore:"8"},
  {companyName:"Green Sprouts Child Dev Center",contactName:"Maria Vasquez",title:"Director",emailPhone:"mvasquez@greensprouts.org",cityMarket:"Durham",market:"Durham",vertical:"Childcare & Licensed Group Homes",orgSize:"10-49",sourceType:"Gemini",whyFit:"Licensed childcare center; NC DCDEE compliance and worker classification risk.",leadPainPoint:"Staff ratios, I-9 compliance",priorityScore:"7"},
  {companyName:"Hope Harbor Nonprofit",contactName:"Rev. James Washington",title:"Executive Director",emailPhone:"jwashington@hopeharbor.org",cityMarket:"Greenville",market:"Greenville",vertical:"Human Services Nonprofits",orgSize:"10-49",sourceType:"Claude AI",whyFit:"Faith-adjacent nonprofit with 25+ employees; no dedicated HR function.",leadPainPoint:"HR policy gaps, volunteer vs employee classification",priorityScore:"8"},
  {companyName:"Piedmont Builders Alliance",contactName:"Keith Reynolds",title:"President",emailPhone:"kreynolds@pbancnc.com",cityMarket:"Greensboro",market:"Greensboro",vertical:"Construction & Contractors",orgSize:"50-99",sourceType:"Apollo.io",whyFit:"Subcontractor-heavy construction firm with NLRB and misclassification exposure.",leadPainPoint:"Subcontractor classification, prevailing wage",priorityScore:"7"},
  {companyName:"Triangle Arts Collective",contactName:"Sofia Reyes",title:"Managing Director",emailPhone:"sreyes@trianglearts.org",cityMarket:"Chapel Hill",market:"Chapel Hill",vertical:"Arts & Cultural Nonprofits",orgSize:"1-9",sourceType:"Claude AI",whyFit:"Growing arts nonprofit transitioning from all-volunteer to paid staff model.",leadPainPoint:"First-time employer compliance, exempt status",priorityScore:"6"},
  {companyName:"Coastal Care Alliance",contactName:"Thomas Bradley",title:"COO",emailPhone:"tbradley@coastalcarealliance.org",cityMarket:"Wilmington",market:"Wilmington",vertical:"Social Service Agencies",orgSize:"100-249",sourceType:"GuideStar / Candid",whyFit:"Multi-program social services agency with complex employee classification across grant-funded programs.",leadPainPoint:"Grant-funded position classification, benefits eligibility",priorityScore:"9"},
  {companyName:"NC Faith Works",contactName:"Pastor Diane Hughes",title:"Executive Director",emailPhone:"dhughes@ncfaithworks.org",cityMarket:"Fayetteville",market:"Fayetteville",vertical:"Religious & Faith-Based Nonprofits",orgSize:"10-49",sourceType:"Gemini",whyFit:"Faith-based org employing community workers with unclear FLSA exempt status.",leadPainPoint:"Minister classification, housing allowance, W-2 vs 1099",priorityScore:"7"},
  {companyName:"Appalachian Aid Society",contactName:"Wendy Blackburn",title:"President",emailPhone:"wblackburn@appalaid.org",cityMarket:"Asheville",market:"Asheville",vertical:"Community Development Orgs",orgSize:"50-99",sourceType:"IRS 990 Database",whyFit:"Rural community development nonprofit with scattered workforce across multiple counties.",leadPainPoint:"Multi-county compliance, remote worker policy",priorityScore:"8"},
  {companyName:"MedFirst Home Services",contactName:"Raj Patel",title:"Owner",emailPhone:"rpatel@medfirst-nc.com",cityMarket:"Cary",market:"Cary",vertical:"Healthcare Practices",orgSize:"10-49",sourceType:"Hunter.io",whyFit:"Owner-operated healthcare practice expanding to home visits; no HR infrastructure.",leadPainPoint:"Clinical staff classification, HIPAA + HR crossover",priorityScore:"8"},
  {companyName:"Brightpath Learning Center",contactName:"Tanya Green",title:"Executive Director",emailPhone:"tgreen@brightpath-ed.org",cityMarket:"Rocky Mount",market:"Rocky Mount",vertical:"Education & Schools",orgSize:"50-99",sourceType:"Claude AI",whyFit:"Charter school with teacher classification issues and substitute worker exposure.",leadPainPoint:"Teacher aide classification, FMLA compliance",priorityScore:"7"},
  {companyName:"NC Advocacy Network",contactName:"Marcus Bell",title:"Director",emailPhone:"mbell@ncadvocacy.org",cityMarket:"Raleigh",market:"Raleigh",vertical:"Advocacy Organizations",orgSize:"10-49",sourceType:"ChatGPT",whyFit:"Policy advocacy nonprofit scaling quickly without HR systems.",leadPainPoint:"Exempt status for policy staff, intern classification",priorityScore:"6"},
  {companyName:"CaringBridge Senior Network",contactName:"Estelle Nguyen",title:"Regional VP",emailPhone:"anguyen@caringbridge-nc.org",cityMarket:"Durham",market:"Durham",vertical:"Home Health / Homecare",orgSize:"250-499",sourceType:"LinkedIn",whyFit:"Large home care network with multi-state operations and NC-specific wage exposure.",leadPainPoint:"Multi-state compliance, aide scheduling violations",priorityScore:"9"},
  {companyName:"First Steps Family Services",contactName:"Denise Carter",title:"CEO",emailPhone:"dcarter@firststepsnc.org",cityMarket:"Charlotte",market:"Charlotte",vertical:"Human Services Nonprofits",orgSize:"100-249",sourceType:"Charity Navigator",whyFit:"Well-funded human services org with complex employee roster across 6 programs.",leadPainPoint:"Cross-program classification, FMLA administration",priorityScore:"8"},
  {companyName:"Oak Ridge Environmental Group",contactName:"Samuel Park",title:"Executive Director",emailPhone:"spark@oakridgeenv.org",cityMarket:"Chapel Hill",market:"Chapel Hill",vertical:"Environmental Nonprofits",orgSize:"10-49",sourceType:"Gemini",whyFit:"Fast-growing env nonprofit moving from grant-only to mixed staffing model.",leadPainPoint:"First employment handbook, overtime policy",priorityScore:"6"},
  {companyName:"Trailhead Construction Group",contactName:"Bobby Simmons",title:"GM",emailPhone:"bsimmons@trailheadcg.com",cityMarket:"Greenville",market:"Greenville",vertical:"Construction & Contractors",orgSize:"50-99",sourceType:"Apollo.io",whyFit:"Licensed GC with 40+ field workers and inconsistent 1099 vs W-2 classification.",leadPainPoint:"IRS 1099 exposure, workers comp classification",priorityScore:"8"},
  {companyName:"Sandhills Family Foundation",contactName:"Helen Marshall",title:"President",emailPhone:"hmarshall@sandhill-ff.org",cityMarket:"Fayetteville",market:"Fayetteville",vertical:"Foundations & Grantmakers",orgSize:"1-9",sourceType:"Claude AI",whyFit:"Small private foundation transitioning to operational phase with first paid employees.",leadPainPoint:"Private foundation employee rules, conflict of interest",priorityScore:"7"},
  {companyName:"WNC Homecare Partners",contactName:"Craig Lawson",title:"Owner",emailPhone:"clawson@wnchomecare.com",cityMarket:"Asheville",market:"Asheville",vertical:"Home Health / Homecare",orgSize:"10-49",sourceType:"Google Maps",whyFit:"Independent home care agency with scheduling compliance and overtime exposure.",leadPainPoint:"Travel time pay, companion service exemption",priorityScore:"7"},
  {companyName:"Cape Fear Literacy Council",contactName:"Josephine Adams",title:"Executive Director",emailPhone:"jadams@capefearlit.org",cityMarket:"Wilmington",market:"Wilmington",vertical:"Education & Schools",orgSize:"10-49",sourceType:"State Registry",whyFit:"Literacy nonprofit with tutors classified as contractors — clear misclassification risk.",leadPainPoint:"Tutor contractor vs employee classification",priorityScore:"8"},
  {companyName:"New Leaf Recovery Services",contactName:"Dr. Paul Chen",title:"Clinical Director",emailPhone:"pchen@newleafrecover.org",cityMarket:"Raleigh",market:"Raleigh",vertical:"Healthcare Practices",orgSize:"50-99",sourceType:"LinkedIn",whyFit:"Behavioral health clinic with clinical and support staff classification complexity.",leadPainPoint:"Clinical exempt status, on-call pay policy",priorityScore:"8"},
];

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
function LoginScreen({users,onLogin}){
  const [un,setUn]=useState("");const [pw,setPw]=useState("");const [show,setShow]=useState(false);
  const [loading,setLoading]=useState(false);const [gload,setGload]=useState(false);const [err,setErr]=useState("");

  const attempt=(u,p)=>{
    const usr=(u||un).trim();const pass=p||pw;if(!usr||!pass)return;
    setErr("");setLoading(true);
    setTimeout(()=>{
      const m=users.find(x=>x.username.toLowerCase()===usr.toLowerCase()&&x.password===pass);
      if(m&&m.active){onLogin(m);return;}
      setErr(m&&!m.active?"This account has been deactivated. Contact your administrator.":"Incorrect username or password.");
      setLoading(false);
    },520);
  };

  const googleSign=()=>{setGload(true);setTimeout(()=>{const u=users.find(x=>x.active);if(u)onLogin(u);else setGload(false);},900);};

  return(
    <div style={{minHeight:"100vh",background:N,fontFamily:"'Segoe UI',system-ui,sans-serif",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden",padding:24}}>
      <GS/>
      {/* background glows */}
      <div style={{position:"absolute",inset:0,backgroundImage:"radial-gradient(circle at 30% 40%,rgba(201,150,58,0.07) 0%,transparent 55%),radial-gradient(circle at 75% 70%,rgba(96,165,250,0.05) 0%,transparent 45%)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${G},transparent)`,opacity:0.4}}/>

      <div style={{width:"100%",maxWidth:440,animation:"fadeUp 0.4s ease",position:"relative",zIndex:1}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:72,height:72,background:`linear-gradient(145deg,${G},${GL})`,borderRadius:22,marginBottom:16,boxShadow:`0 12px 48px rgba(201,150,58,0.35),0 0 0 1px rgba(201,150,58,0.2)`}}>
            <span style={{fontSize:34}}>⚖️</span>
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
const AI_SOURCES=[
  {id:"claude",   label:"Claude AI",    icon:"🤖", color:"#c084fc", desc:"Anthropic's Claude for intelligent prospect discovery"},
  {id:"chatgpt",  label:"ChatGPT",      icon:"🧠", color:"#10a37f", desc:"OpenAI GPT-4 for broad organizational research"},
  {id:"gemini",   label:"Gemini",       icon:"✨", color:"#4285F4", desc:"Google Gemini for real-time web-sourced results"},
  {id:"apollo",   label:"Apollo.io",    icon:"🚀", color:"#7c3aed", desc:"B2B database — requires API key"},
  {id:"hunter",   label:"Hunter.io",    icon:"🎯", color:"#f59e0b", desc:"Email finder & verifier — requires API key"},
  {id:"guidestar",label:"GuideStar",    icon:"🏛️", color:"#60a5fa", desc:"Nonprofit IRS 990 & financial data"},
  {id:"charity",  label:"Charity Navigator",icon:"⭐",color:"#34d399",desc:"Nonprofit ratings & financial health data"},
  {id:"linkedin", label:"LinkedIn",     icon:"💼", color:"#0077b5", desc:"Professional network search"},
];

function ProspectFinderModal({onClose,onAddProspects,existingIds,sysSettings}){
  const [step,setStep]=useState("search"); // search | results | confirm
  const [query,setQuery]=useState("");
  const [vertical,setVertical]=useState("");
  const [market,setMarket]=useState("");
  const [orgSize,setOrgSize]=useState("");
  const [orgType,setOrgType]=useState("all"); // all | nonprofit | smb
  const [selectedSources,setSelectedSources]=useState(["claude","chatgpt","gemini"]);
  const [searching,setSearching]=useState(false);
  const [results,setResults]=useState([]);
  const [selected,setSelected]=useState(new Set());
  const [progress,setProgress]=useState({});
  const [searchLog,setSearchLog]=useState([]);

  const toggleSrc=id=>setSelectedSources(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const toggleSel=id=>setSelected(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const selectAll=()=>setSelected(new Set(results.map(r=>r._id)));
  const clearSel=()=>setSelected(new Set());

  const log=msg=>setSearchLog(p=>[...p,{t:tsNow().slice(11),msg}]);

  const runSearch=async()=>{
    if(!query.trim()&&!vertical&&!market){return;}
    setSearching(true);setResults([]);setSelected(new Set());setSearchLog([]);
    setStep("results");

    const prog={};selectedSources.forEach(s=>{prog[s]="searching";});
    setProgress({...prog});

    // Simulate each source searching with staggered timing
    const filtered=MOCK_PROSPECTS.filter(p=>{
      const qL=query.toLowerCase();
      const matchQ=!query||(p.companyName+p.contactName+p.whyFit+p.leadPainPoint+p.vertical+p.cityMarket).toLowerCase().includes(qL);
      const matchV=!vertical||p.vertical===vertical;
      const matchM=!market||p.market===market;
      const matchS=!orgSize||p.orgSize===orgSize;
      const matchT=orgType==="all"||(orgType==="nonprofit"&&(p.vertical||"").toLowerCase().includes("nonprofit")||orgType==="nonprofit"&&["Human Services Nonprofits","Nonprofits & Associations","Faith-Based Organizations","Foundations & Grantmakers","Advocacy Organizations","Social Service Agencies","Arts & Cultural Nonprofits","Environmental Nonprofits","Religious & Faith-Based Nonprofits","Community Development Orgs"].includes(p.vertical))||(orgType==="smb"&&!["Human Services Nonprofits","Nonprofits & Associations","Faith-Based Organizations","Foundations & Grantmakers","Advocacy Organizations","Social Service Agencies","Arts & Cultural Nonprofits","Environmental Nonprofits","Religious & Faith-Based Nonprofits","Community Development Orgs"].includes(p.vertical));
      return matchQ&&matchV&&matchM&&matchS&&matchT;
    });

    let allResults=[];
    const sourceChunks={};
    const total=filtered.length;
    const perSource=Math.max(2,Math.ceil(total/Math.max(selectedSources.length,1)));

    for(let i=0;i<selectedSources.length;i++){
      const src=selectedSources[i];
      const delay=i*700+400;
      setTimeout(()=>{
        const srcInfo=AI_SOURCES.find(s=>s.id===src);
        log(`${srcInfo?.label||src}: Searching…`);
        setProgress(p=>({...p,[src]:"loading"}));
      },delay);
      setTimeout(()=>{
        const start=i*perSource;
        const chunk=filtered.slice(start,start+perSource).map(p=>({...p,_id:uid(),_source:src,_verified:Math.random()>0.3}));
        const srcInfo=AI_SOURCES.find(s=>s.id===src);
        log(`${srcInfo?.label||src}: Found ${chunk.length} prospects`);
        setProgress(p=>({...p,[src]:"done"}));
        allResults=[...allResults,...chunk];
        setResults([...allResults]);
      },delay+900);
    }

    setTimeout(()=>{
      setSearching(false);
      log("Search complete.");
    },selectedSources.length*700+1400);
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

  return(
    <DW onClose={onClose} title="🔍 AI Prospect Finder" width={860}>
      {/* Source selector tabs */}
      <div style={{marginBottom:18}}>
        <p style={{margin:"0 0 10px",fontSize:11,fontWeight:700,color:WM,textTransform:"uppercase",letterSpacing:"0.07em"}}>Select Search Sources</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
          {AI_SOURCES.map(s=>{
            const active=selectedSources.includes(s.id);
            const needsKey=["apollo","hunter"].includes(s.id)&&!hasKey(s.id);
            return(
              <button key={s.id} onClick={()=>!needsKey&&toggleSrc(s.id)} title={needsKey?"API key required — configure in Settings":s.desc}
                style={{display:"flex",alignItems:"center",gap:7,padding:"8px 13px",background:active?`rgba(201,150,58,0.14)`:"rgba(255,255,255,0.04)",border:`1.5px solid ${active?G:"rgba(255,255,255,0.1)"}`,borderRadius:9,cursor:needsKey?"not-allowed":"pointer",opacity:needsKey?0.45:1,transition:"all 0.15s"}}>
                <span style={{fontSize:16}}>{s.icon}</span>
                <div style={{textAlign:"left"}}>
                  <p style={{margin:0,fontSize:11,fontWeight:700,color:active?GL:WM}}>{s.label}</p>
                  {needsKey&&<p style={{margin:0,fontSize:9,color:"#f87171"}}>API key required</p>}
                </div>
                {active&&<span style={{marginLeft:2,fontSize:10,color:GL}}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search form */}
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11,marginBottom:11}}>
          <FG label="Keywords / Search Query" span>
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:WD}}>🔍</span>
              <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&runSearch()} placeholder='e.g. "home health Raleigh" or "nonprofit Charlotte compliance"' style={{...inp(),paddingLeft:32}}/>
            </div>
          </FG>
          <FG label="Organization Type">
            <select value={orgType} onChange={e=>setOrgType(e.target.value)} style={{...inp(),cursor:"pointer"}}>
              <option value="all">All Organizations</option>
              <option value="nonprofit">Nonprofits Only</option>
              <option value="smb">SMB / For-Profit Only</option>
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
          <FG label="Org Size">
            <select value={orgSize} onChange={e=>setOrgSize(e.target.value)} style={{...inp(),cursor:"pointer"}}>
              <option value="">Any Size</option>{ORG_SIZES.map(s=><option key={s}>{s}</option>)}
            </select>
          </FG>
          <FG label="&nbsp;">
            <button onClick={runSearch} disabled={searching||(!query.trim()&&!vertical&&!market)} className="bh" style={{...B.gold,width:"100%",padding:"10px",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:8,opacity:searching||(!query.trim()&&!vertical&&!market)?0.5:1}}>
              {searching?<><Spin s={16} c="#0B1426"/> Searching…</>:"🔍 Search Prospects"}
            </button>
          </FG>
        </div>
      </div>

      {/* Results */}
      {step==="results"&&(
        <div style={{animation:"fadeUp 0.2s ease"}}>
          {/* Source progress */}
          <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:12}}>
            {selectedSources.map(s=>{
              const si=AI_SOURCES.find(x=>x.id===s);
              const st=progress[s];
              return(
                <div key={s} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",background:"rgba(255,255,255,0.04)",border:`1px solid ${st==="done"?"rgba(52,211,153,0.3)":st==="loading"?`${si?.color}44`:"rgba(255,255,255,0.08)"}`,borderRadius:20}}>
                  <span style={{fontSize:13}}>{si?.icon}</span>
                  <span style={{fontSize:11,fontWeight:600,color:st==="done"?"#34d399":st==="loading"?si?.color:WM}}>{si?.label}</span>
                  {st==="loading"&&<Spin s={10} c={si?.color}/>}
                  {st==="done"&&<span style={{fontSize:10,color:"#34d399"}}>✓</span>}
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
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>
              <p style={{margin:0,fontSize:13,fontWeight:700,color:W}}>{results.length} prospects found</p>
              <span style={{fontSize:11,color:WM}}>{selected.size} selected</span>
              <div style={{marginLeft:"auto",display:"flex",gap:7}}>
                <button onClick={selectAll} style={{...B.ghost,fontSize:10,padding:"5px 11px"}}>Select All</button>
                <button onClick={clearSel} style={{...B.ghost,fontSize:10,padding:"5px 11px"}}>Clear</button>
                {selected.size>0&&<button onClick={doAdd} className="bh" style={{...B.gold,fontSize:11,padding:"7px 16px",display:"flex",gap:6,alignItems:"center"}}>
                  ➕ Add {selected.size} to CRM
                </button>}
              </div>
            </div>
          )}

          {/* Result cards */}
          <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:360,overflowY:"auto",paddingRight:2}}>
            {searching&&results.length===0&&(
              <div style={{textAlign:"center",padding:"32px 0"}}>
                <Spin s={36} c={G}/>
                <p style={{color:WM,marginTop:12,fontSize:13}}>Searching across {selectedSources.length} source{selectedSources.length!==1?"s":""}…</p>
              </div>
            )}
            {results.map(r=>{
              const sel=selected.has(r._id);
              const si=AI_SOURCES.find(s=>s.id===r._source);
              const alreadyIn=existingIds.has(r.companyName?.toLowerCase());
              return(
                <div key={r._id} onClick={()=>!alreadyIn&&toggleSel(r._id)} style={{background:sel?"rgba(201,150,58,0.08)":alreadyIn?"rgba(255,255,255,0.02)":"rgba(255,255,255,0.03)",border:`1.5px solid ${sel?G:alreadyIn?"rgba(255,255,255,0.05)":"rgba(255,255,255,0.07)"}`,borderRadius:11,padding:"12px 14px",cursor:alreadyIn?"default":"pointer",transition:"all 0.15s",opacity:alreadyIn?0.5:1}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                    <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${sel?G:"rgba(255,255,255,0.15)"}`,background:sel?G:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1,transition:"all 0.15s"}}>
                      {sel&&<span style={{fontSize:11,color:N,fontWeight:900}}>✓</span>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                        <span style={{fontSize:13,fontWeight:700,color:W}}>{r.companyName}</span>
                        {alreadyIn&&<span style={{fontSize:9,color:"#34d399",border:"1px solid rgba(52,211,153,0.3)",borderRadius:20,padding:"1px 7px",fontWeight:700}}>Already in CRM</span>}
                        {r._verified&&!alreadyIn&&<span style={{fontSize:9,color:"#34d399",border:"1px solid rgba(52,211,153,0.3)",borderRadius:20,padding:"1px 7px"}}>✓ Verified</span>}
                        <span style={{fontSize:9,padding:"2px 8px",background:`rgba(201,150,58,0.1)`,border:`1px solid rgba(201,150,58,0.2)`,borderRadius:20,color:GL,fontWeight:700}}>{r.vertical}</span>
                        <span style={{fontSize:9,padding:"2px 8px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,color:WM}}>{r.market}</span>
                        <span style={{marginLeft:"auto",fontSize:9,color:si?.color,border:`1px solid ${si?.color}44`,borderRadius:20,padding:"1px 8px"}}>{si?.icon} {si?.label}</span>
                      </div>
                      <div style={{display:"flex",gap:12,fontSize:11,color:WM,flexWrap:"wrap",marginBottom:4}}>
                        <span>👤 {r.contactName} · {r.title}</span>
                        <span>📧 {r.emailPhone}</span>
                        <span>🏢 {r.orgSize} employees</span>
                        {r.priorityScore&&<span style={{color:parseInt(r.priorityScore)>=8?"#f472b6":GL,fontWeight:700}}>⭐ Priority {r.priorityScore}</span>}
                      </div>
                      <p style={{margin:0,fontSize:11,color:WD,lineHeight:1.4}}><span style={{color:WM,fontWeight:600}}>Why fit:</span> {r.whyFit}</p>
                      {r.leadPainPoint&&<p style={{margin:"3px 0 0",fontSize:11,color:WD}}><span style={{color:"#f472b6",fontWeight:600}}>Pain:</span> {r.leadPainPoint}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
            {!searching&&results.length===0&&(
              <div style={{textAlign:"center",padding:"32px 0",color:WD}}>
                <p style={{fontSize:40,margin:"0 0 10px"}}>🔍</p>
                <p style={{margin:0,fontSize:14,color:WM}}>Run a search to discover prospects</p>
                <p style={{margin:"6px 0 0",fontSize:12}}>Try entering a keyword, selecting a vertical, or choosing a market</p>
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
function AdminPanel({currentUser,users,setUsers,crmData,setCrmData,sysSettings,setSysSettings,auditLog,addAudit,onBack,onLogout}){
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

  const isSuper=currentUser.role==="superadmin";
  const isAdmin=ROLES[currentUser.role].canAdmin;
  const t2=(msg,type="ok")=>{setToast({msg,type});setTimeout(()=>setToast(null),3200);};
  const uf=(k,v)=>setUForm(f=>({...f,[k]:v}));

  // User ops
  const openAddU=()=>{setUForm({username:"",password:"",name:"",email:"",role:"user",active:true});setFErr("");setUDlg("add");};
  const openEditU=u=>{setUForm({...u});setFErr("");setUDlg(u);};
  const saveU=()=>{
    if(!uForm.name?.trim()||!uForm.username?.trim()||!uForm.password?.trim()||!uForm.email?.trim()){setFErr("All fields required.");return;}
    if(uForm.password.length<4){setFErr("Password min 4 chars.");return;}
    if(uForm.role==="superadmin"&&!isSuper){setFErr("Only Super Admin can assign this role.");return;}
    if(uDlg==="add"){
      if(users.find(u=>u.username.toLowerCase()===uForm.username.toLowerCase())){setFErr("Username already exists.");return;}
      const nu={...uForm,id:uid(),createdAt:today(),lastLogin:null,avatar:initials(uForm.name)};
      setUsers(p=>[...p,nu]);addAudit(currentUser.username,`Created user: ${nu.username} (${nu.role})`);t2(`User "${nu.username}" created.`);
    }else{
      if(uDlg.id===currentUser.id&&uForm.role!==currentUser.role){setFErr("Cannot change your own role.");return;}
      setUsers(p=>p.map(u=>u.id===uDlg.id?{...u,...uForm}:u));
      addAudit(currentUser.username,`Updated user: ${uForm.username}`);t2(`"${uForm.username}" updated.`);
    }
    setUDlg(null);
  };
  const deleteU=u=>{if(u.id===currentUser.id){t2("Cannot delete yourself.","err");return;}setUsers(p=>p.filter(x=>x.id!==u.id));addAudit(currentUser.username,`Deleted user: ${u.username}`);t2(`"${u.username}" deleted.`,"err");setConfirmDel(null);};
  const toggleActive=u=>{if(u.id===currentUser.id){t2("Cannot deactivate yourself.","err");return;}setUsers(p=>p.map(x=>x.id===u.id?{...x,active:!x.active}:x));addAudit(currentUser.username,`${u.active?"Deactivated":"Activated"}: ${u.username}`);t2(`${u.name} ${u.active?"deactivated":"activated"}.`,u.active?"err":"ok");};

  // Prospect ops
  const saveP=form=>{const isNew=!crmData.find(p=>p.id===form.id);if(isNew){setCrmData(p=>[...p,form]);addAudit(currentUser.username,`Added: ${form.companyName}`);}else{setCrmData(p=>p.map(x=>x.id===form.id?form:x));addAudit(currentUser.username,`Edited: ${form.companyName}`);}t2(isNew?"Added!":"Saved!");setPDlg(null);};
  const deleteP=id=>{const p=crmData.find(x=>x.id===id);setCrmData(prev=>prev.filter(x=>x.id!==id));addAudit(currentUser.username,`Deleted: ${p?.companyName||id}`);t2(`"${p?.companyName}" deleted.`,"err");setConfirmDel(null);setPDlg(null);};
  const saveSettings=()=>{setSysSettings({...settings});addAudit(currentUser.username,"Updated system settings");t2("Settings saved.");};

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
                  {isAdmin&&<button onClick={()=>{if(window.confirm("Reset all CRM data?")){setCrmData(SEED);addAudit(currentUser.username,"Reset CRM to seed");t2("Data reset.","err");}}} className="bh" style={{...B.danger,fontSize:11}}>↺ Reset</button>}
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
                    <div style={{padding:"15px 17px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{sec.fields.map(f=><FG key={f.k} label={f.l}><input value={settings[f.k]||""} onChange={e=>setSettings(s=>({...s,[f.k]:e.target.value}))} style={inp()}/></FG>)}</div>
                  </div>
                ))}
                <div style={{background:NC,border:`1px solid ${BR}`,borderRadius:13,overflow:"hidden"}}>
                  <div style={{padding:"10px 17px",borderBottom:`1px solid ${BR}`,background:"rgba(255,255,255,0.03)"}}><p style={{margin:0,fontSize:12,fontWeight:700,color:W}}>📦 Capacity</p></div>
                  <div style={{padding:"15px 17px"}}><FG label="Max Prospects"><input type="number" value={settings.maxProspects||1000} onChange={e=>setSettings(s=>({...s,maxProspects:parseInt(e.target.value)||1000}))} style={{...inp(),width:200}}/></FG><div style={{marginTop:10,display:"flex",alignItems:"center",gap:12}}><div style={{flex:1,height:6,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",background:`linear-gradient(90deg,${G},#34d399)`,borderRadius:3,width:Math.min((crmData.length/(settings.maxProspects||1000))*100,100)+"%"}}/></div><span style={{fontSize:11,color:WD,whiteSpace:"nowrap"}}>{crmData.length}/{settings.maxProspects||1000}</span></div></div>
                </div>
                {isSuper&&(
                  <div style={{background:NC,border:`1px solid ${BR}`,borderRadius:13,overflow:"hidden"}}>
                    <div style={{padding:"10px 17px",borderBottom:`1px solid ${BR}`,background:"rgba(255,255,255,0.03)"}}><p style={{margin:0,fontSize:12,fontWeight:700,color:W}}>⚙️ Behavior Flags</p></div>
                    <div style={{padding:"15px 17px",display:"flex",flexDirection:"column",gap:10}}>
                      {[{k:"requireMelissaApproval",l:"Require Melissa approval before Touch 3",d:"Blocks T3 queue until flagged and approved"},{k:"autoArchiveDNR",l:"Auto-archive DNR after 30 days",d:"Removes from active pipeline"},{k:"emailGmailDefault",l:"Use Gmail compose by default",d:"Opens Gmail for outreach emails"}].map(f=>(
                        <div key={f.k} style={{display:"flex",alignItems:"flex-start",gap:13,padding:"11px 13px",background:"rgba(255,255,255,0.03)",borderRadius:9,border:`1px solid ${BR}`}}>
                          <Tgl on={!!settings[f.k]} onChange={v=>setSettings(s=>({...s,[f.k]:v}))}/>
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
              {[{id:"apollo",name:"Apollo.io",icon:"🚀",color:"#7c3aed",desc:"B2B contact & company database with 275M+ profiles. Automates prospect discovery and email finding.",key:"apolloKey",docs:"https://apolloio.github.io/apollo-api-docs/",features:["Contact search","Email verification","Company firmographics","Bulk export"]},
                {id:"hunter",name:"Hunter.io",icon:"🎯",color:"#f59e0b",desc:"Email finding and verification tool. Finds professional email addresses from company domains.",key:"hunterKey",docs:"https://hunter.io/api-documentation/v2",features:["Domain search","Email finder","Email verifier","Bulk tasks"]},
                {id:"anthropic",name:"Claude AI (Anthropic)",icon:"🤖",color:"#c084fc",desc:"Anthropic Claude API for intelligent prospect research, context analysis, and personalized outreach drafts.",key:"anthropicKey",docs:"https://docs.anthropic.com",features:["Prospect research","Outreach drafting","Pain point analysis","Fit scoring"]},
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
                          <input type="password" value={settings[p.key]||""} onChange={e=>setSettings(s=>({...s,[p.key]:e.target.value}))} placeholder={`Enter your ${p.name} API key…`} style={inp()}/>
                        </div>
                        <button onClick={()=>{setSysSettings(s=>({...s,[p.key]:settings[p.key]}));addAudit(currentUser.username,`Updated ${p.name} API key`);t2(`${p.name} key saved.`);}} className="bh" style={{...B.gold,fontSize:11,padding:"9px 16px",flexShrink:0}}>Save Key</button>
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

      {showImport&&<ExcelImportModal onClose={()=>setShowImport(false)} onImport={(rows,mode)=>{if(mode==="replace")setCrmData(rows);else setCrmData(p=>[...p,...rows]);addAudit(currentUser.username,`Imported ${rows.length} prospects (${mode})`);setShowImport(false);t2(`${rows.length} imported!`);}}/>}
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
          <FG label="Password *"><input type="text" value={uForm.password||""} onChange={e=>uf("password",e.target.value)} placeholder="Min 4 characters" style={inp()}/></FG>
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
  {id:"sx1",to:"Sandra Kim",toEmail:"sandra@brighthorizons-nc.com",subject:"HR Compliance Support for Bright Horizons Childcare",date:"2026-05-28 09:00",touch:"T1",opened:true,prospectId:2},
  {id:"sx2",to:"Bob Marshall",toEmail:"bobmarshall@comfortkeepers.com",subject:"Touch 3 — HR Compliance, Comfort Keepers",date:"2026-05-19 09:30",touch:"T3",opened:true,prospectId:1},
  {id:"sx3",to:"Dr. Angela Foster",toEmail:"afoster@nchopefoundation.org",subject:"HR Compliance for NC Hope Foundation",date:"2026-06-01 10:00",touch:"T1",opened:false,prospectId:3},
  {id:"sx4",to:"Marcus Webb",toEmail:"mwebb@trianglelogistics.com",subject:"Following up — HR Compliance for Triangle Logistics",date:"2026-05-22 09:15",touch:"T2",opened:true,prospectId:4},
  {id:"sx5",to:"Linda Torres",toEmail:"ltorres@communitycare-nc.org",subject:"HR Compliance Support for Community Care Services",date:"2026-06-01 09:45",touch:"T1",opened:true,prospectId:5},
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
  const [selectedTemplate,setSelectedTemplate]=useState("t1_standard");
  const [composeForm,setComposeForm]=useState({to:"",subject:"",body:"",cc:"",bcc:""});
  const [sending,setSending]=useState(false);
  const [inboxFilter,setInboxFilter]=useState("all");

  const unread=inbox.filter(e=>!e.read).length;
  const replies=inbox.filter(e=>e.label==="reply").length;

  const connectInbox=()=>{
    setConnecting(true);
    setTimeout(()=>{setConnecting(false);setInboxConnected(true);t2("Inbox connected! Showing demo emails.");},1400);
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

  const sendEmail=(prospect,touchKey)=>{
    setSending(true);
    setTimeout(()=>{
      const next=touchKey==="t1"?"T1 SENT":touchKey==="t2"?"T2 SENT":"NURTURE/T3 SENT";
      if(prospect)qStatus(prospect.id,next);
      const newSent={id:"sx"+uid(),to:prospect?.contactName||composeForm.to,toEmail:prospect?.emailPhone||composeForm.to,subject:composeForm.subject,date:tsNow(),touch:touchKey==="t1"?"T1":touchKey==="t2"?"T2":"T3",opened:false,prospectId:prospect?.id||null};
      setSent(p=>[newSent,...p]);
      setSending(false);setCompose(null);
      t2(`Email sent to ${prospect?.companyName||composeForm.to}!`);
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
            <div style={{display:"flex",alignItems:"center",gap:7,padding:"7px 10px",background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.22)",borderRadius:8}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:"#34d399",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <p style={{margin:0,fontSize:10,fontWeight:700,color:"#34d399"}}>Inbox Connected</p>
                <p style={{margin:0,fontSize:9,color:WD,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sysSettings.senderEmail||"melissa@hrondemand.com"}</p>
              </div>
              <button onClick={()=>setInboxConnected(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:WD,padding:2}}>✕</button>
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
                            <a href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(p.emailPhone)}&su=${encodeURIComponent("HR Compliance — "+p.companyName)}`} target="_blank" rel="noopener noreferrer" style={{background:"#EA4335",color:"#fff",borderRadius:8,padding:"7px 12px",fontSize:11,fontWeight:700,textDecoration:"none",display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                              Gmail
                            </a>
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
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <div><h2 style={{margin:0,fontSize:16,fontWeight:800,color:W}}>✏️ Compose Email</h2><p style={{margin:"3px 0 0",fontSize:11,color:WM}}>Use a template or write a custom message</p></div>
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
                  {sending?<><Spin s={14} c={N}/> Sending…</>:"📤 Send Email"}
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
                  {inboxConnected&&<button onClick={()=>{setInbox(MOCK_INBOX);t2("Inbox refreshed!");}} style={{...B.ghost,fontSize:10,padding:"5px 10px"}}>↻ Refresh</button>}
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
                  <p style={{margin:"0 0 16px",fontSize:11,color:WM}}>Link your email account to see replies from prospects, track opens, and manage all outreach in one place.</p>
                  <button onClick={connectInbox} disabled={connecting} className="bh" style={{...B.gold,fontSize:12}}>
                    {connecting?<><Spin s={14} c={N}/> Connecting…</>:"🔗 Connect Inbox"}
                  </button>
                  <p style={{margin:"12px 0 0",fontSize:10,color:WD}}>Supports Gmail · Outlook · IMAP</p>
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
                      setComposeForm({to:selectedEmail.fromEmail,subject:"Re: "+selectedEmail.subject,body:"\n\n---\nOn "+selectedEmail.date+", "+selectedEmail.from+" wrote:\n"+selectedEmail.body.split("\n").map(l=>"> "+l).join("\n"),cc:"",bcc:"",prospectId:selectedEmail.prospectId});
                      setEtab("compose");setCompose("write");
                    }} className="bh" style={{...B.blue,fontSize:12,display:"flex",gap:6,alignItems:"center"}}>↩️ Reply</button>
                    {selectedEmail.label!=="dnr"&&<button onClick={()=>handleDNRAction(selectedEmail)} className="bh" style={{...B.danger,fontSize:12}}>🚫 Mark Do Not Respond</button>}
                    <a href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(selectedEmail.fromEmail)}&su=${encodeURIComponent("Re: "+selectedEmail.subject)}`} target="_blank" rel="noopener noreferrer" style={{...B.ghost,textDecoration:"none",display:"flex",alignItems:"center",gap:5,fontSize:12}}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                      Reply in Gmail
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* SENT */}
        {etab==="sent"&&(
          <div style={{padding:"18px 20px 40px"}}>
            <div style={{marginBottom:16}}><h2 style={{margin:0,fontSize:16,fontWeight:800,color:W}}>📨 Sent Emails</h2><p style={{margin:"3px 0 0",fontSize:11,color:WM}}>{sent.length} emails sent · {sent.filter(e=>e.opened).length} opened</p></div>
            <div style={{background:NL,border:`1px solid ${BR}`,borderRadius:13,overflow:"hidden"}}>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
                  <thead><tr style={{background:"rgba(255,255,255,0.04)",borderBottom:`1px solid rgba(255,255,255,0.07)`}}>
                    {["To","Subject","Touch","Date","Status"].map(h=><th key={h} style={{textAlign:"left",padding:"9px 14px",fontSize:10,color:WD,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",whiteSpace:"nowrap"}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
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
                          <td style={{padding:"10px 14px",fontSize:11,color:WD,whiteSpace:"nowrap"}}>{e.date.slice(0,16)}</td>
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
                    <button onClick={()=>{setSelectedTemplate(t.id);setComposeForm(f=>({...f,subject:t.subject,body:t.body}));setEtab("compose");setCompose("write");}} className="bh" style={{...B.gold,fontSize:10,padding:"5px 12px"}}>Use Template</button>
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
   CRM APP — MAIN INTERFACE
════════════════════════════════════════════════════════════════ */
const CHECKLIST=["Pull 10 new prospects using approved sources (AI Finder, Apollo, etc.)","Send Touch 1 emails every Monday","Send Touch 2 emails 7 days after T1 if no reply","ANY reply → Flag to Melissa IMMEDIATELY","Flag to Melissa before Touch 3 — wait for approval","After Touch 3 → update status to NURTURE/T3 SENT","Log Call Booked after Melissa handles reply"];

function CRMApp({currentUser,onLogout,onOpenAdmin,crmData,setCrmData,onSaveProspect,onDeleteProspect,onImportProspects,sysSettings,dbStatus}){
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
  const [sortDir,setSortDir]=useState("asc");

  const role=ROLES[currentUser.role];
  const canEdit=role.canEdit;
  const t2=(msg,t="ok")=>{setToast({msg,t});setTimeout(()=>setToast(null),3000);};

  const q1=crmData.filter(p=>p.currentStatus==="NEW"&&!p.doNotRespond&&hasEM(p));
  const q2=crmData.filter(p=>p.currentStatus==="T1 SENT"&&isPast(p.t1DueDate)&&!p.doNotRespond&&hasEM(p));
  const q3=crmData.filter(p=>((p.currentStatus==="T2 SENT"&&isPast(p.t2DueDate))||(p.currentStatus==="TOUCH 3 GATE"&&p.t3Approved))&&!p.doNotRespond&&hasEM(p));
  const totalDue=q1.length+q2.length+q3.length;

  const existingIds=new Set(crmData.map(p=>p.companyName?.toLowerCase()));

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
    await onSaveProspect(form);
    setPDlg(null);t2(isNew?"Prospect added!":"Changes saved!");
  };
  const deleteP=async id=>{
    if(!role.canDelete){t2("Insufficient permissions.","err");return;}
    if(!window.confirm("Delete this prospect?"))return;
    await onDeleteProspect(id);setPDlg(null);t2("Deleted.","err");
  };
  const qStatus=async (id,s)=>{
    const p=crmData.find(x=>x.id===id);if(!p)return;
    await onSaveProspect({...p,currentStatus:s});
  };
  const doSort=col=>{if(sortCol===col)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortCol(col);setSortDir("asc");}};
  const SI=({col})=>sortCol===col?<span style={{fontSize:9,marginLeft:2}}>{sortDir==="asc"?"▲":"▼"}</span>:null;

  const tot=crmData.length;
  const pipeSumm=STATUSES.map(s=>({s,c:crmData.filter(p=>p.currentStatus===s).length}));
  const vertBreak=VERTICALS.map(v=>({v,c:crmData.filter(p=>p.vertical===v).length})).filter(x=>x.c>0).sort((a,b)=>b.c-a.c);
  const mktBreak=MARKETS.map(m=>({m,c:crmData.filter(p=>p.market===m).length})).filter(x=>x.c>0).sort((a,b)=>b.c-a.c);
  const typeBreak=[{l:"Nonprofits",c:crmData.filter(p=>["Human Services Nonprofits","Nonprofits & Associations","Faith-Based Organizations","Foundations & Grantmakers","Advocacy Organizations","Social Service Agencies","Arts & Cultural Nonprofits","Environmental Nonprofits","Religious & Faith-Based Nonprofits","Community Development Orgs"].includes(p.vertical)).length,col:"#c084fc"},{l:"SMB / For-Profit",c:crmData.filter(p=>["Home Health / Homecare","Childcare & Licensed Group Homes","Construction & Contractors","Healthcare Practices","Light Manufacturing & Logistics","Education & Schools"].includes(p.vertical)).length,col:"#60a5fa"}];

  const NAVS=[{id:"dashboard",l:"📊",full:"Dashboard"},{id:"finder",l:"🔍",full:"Prospect Finder",alert:false},{id:"table",l:"🗄️",full:"Prospects"},{id:"pipeline",l:"◫",full:"Pipeline"},{id:"email",l:"📧",full:`Email${totalDue>0?` (${totalDue})`:""}`,alert:totalDue>0}];

  return(
    <div style={{background:N,minHeight:"100vh",fontFamily:"'Segoe UI',system-ui,sans-serif",color:W}}>
      <GS/>
      {toast&&<Toast msg={toast.msg} type={toast.t}/>}

      {/* HEADER */}
      <header style={{background:NL,borderBottom:"1px solid rgba(201,150,58,0.2)",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 24px rgba(0,0,0,0.5)"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"0 16px",height:54}}>
          <div style={{background:`linear-gradient(135deg,${G},${GL})`,borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:`0 4px 16px rgba(201,150,58,0.4)`}}>
            <span style={{fontSize:18}}>⚖️</span>
          </div>
          <div style={{minWidth:0,flex:1}}>
            <p style={{fontSize:11,fontWeight:900,color:W,margin:0,letterSpacing:"0.05em"}}>NC COMPLIANCE-VERTICAL</p>
            <p style={{fontSize:9.5,color:"rgba(201,150,58,0.7)",margin:0}}>{sysSettings.orgName||"HR On Demand"} · SMB & Nonprofit Outreach Tracker</p>
          </div>
          <nav style={{display:"flex",gap:3,background:"rgba(255,255,255,0.05)",borderRadius:10,padding:3}}>
            {NAVS.map(n=>(
              <button key={n.id} onClick={()=>setView(n.id)} style={{position:"relative",background:view===n.id?"rgba(201,150,58,0.15)":"transparent",color:view===n.id?GL:WM,border:`1px solid ${view===n.id?"rgba(201,150,58,0.3)":"transparent"}`,borderRadius:7,padding:"6px 11px",fontSize:11.5,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.15s"}}>
                {n.l} {n.full}
                {n.alert&&<span style={{position:"absolute",top:-3,right:-3,width:8,height:8,background:"#f472b6",borderRadius:"50%",border:"1.5px solid #0B1426"}}/>}
              </button>
            ))}
          </nav>
          <div style={{display:"flex",gap:7,alignItems:"center"}}>
            {canEdit&&<button onClick={()=>setShowImport(true)} className="bh" style={{...B.purple,fontSize:10,padding:"6px 10px"}}>📁 Import</button>}
            <button onClick={()=>{exportToExcel(crmData,"NC_CRM");t2("Exported!");}} className="bh" style={{...B.green,fontSize:10,padding:"6px 10px"}}>⬇️ Export</button>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"3px 10px 3px 4px",background:"rgba(255,255,255,0.05)",border:`1px solid ${BR}`,borderRadius:24}}>
              <div style={{width:27,height:27,background:ROLES[currentUser.role]?.bg,border:`1.5px solid ${ROLES[currentUser.role]?.color}55`,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:ROLES[currentUser.role]?.color}}>{currentUser.avatar}</div>
              <div><p style={{margin:0,fontSize:11,fontWeight:700,color:W,lineHeight:1.2}}>{currentUser.name.split(" ")[0]}</p><p style={{margin:0,fontSize:9,color:ROLES[currentUser.role]?.color,lineHeight:1}}>{ROLES[currentUser.role]?.label}</p></div>
            </div>
            {role.canAdmin&&<button onClick={onOpenAdmin} className="bh" style={{...B.purple,fontSize:10,padding:"6px 11px"}}>🛡️ Admin</button>}
            {canEdit&&<button onClick={()=>setPDlg("add")} className="bh" style={{...B.gold,fontSize:11,padding:"7px 13px"}}>+ Add</button>}
            <button onClick={onLogout} className="bh" style={{...B.ghost,fontSize:10,padding:"6px 10px"}}>Sign Out</button>
          </div>
        </div>
        <div style={{borderTop:"1px solid rgba(201,150,58,0.08)",padding:"3px 16px",overflowX:"auto"}}>
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
      {(view==="table"||view==="pipeline")&&(
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

      {/* TABLE */}
      {view==="table"&&(
        <div style={{padding:"13px 16px 60px",animation:"fadeUp 0.3s ease",overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
            <thead>
              <tr style={{background:NL,borderBottom:`1px solid rgba(255,255,255,0.07)`}}>
                {[["companyName","Company"],["contactName","Contact"],["vertical","Vertical"],["market","Market"],["currentStatus","Status"],["priorityScore","Pri."]].map(([col,h])=>(
                  <th key={col} onClick={()=>doSort(col)} style={{textAlign:"left",padding:"9px 13px",fontSize:10,color:WD,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",whiteSpace:"nowrap",cursor:"pointer",userSelect:"none",transition:"color 0.15s"}}>
                    {h}<SI col={col}/>
                  </th>
                ))}
                <th style={{textAlign:"left",padding:"9px 13px",fontSize:10,color:WD,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length===0&&<tr><td colSpan={7} style={{padding:"44px 0",textAlign:"center",color:WD,fontSize:13}}>No prospects found.{canEdit&&<><br/><button onClick={()=>setShowFinder(true)} style={{...B.gold,marginTop:12,fontSize:12}}>🔍 Search for Prospects</button> <button onClick={()=>setPDlg("add")} style={{...B.ghost,marginTop:12,fontSize:12}}>+ Add Manually</button></>}</td></tr>}
              {filtered.map((p,i)=>(
                <tr key={p.id} className="rh" style={{borderBottom:`1px solid rgba(255,255,255,0.04)`,background:i%2?"rgba(255,255,255,0.018)":"transparent"}}>
                  <td style={{padding:"10px 13px"}}>
                    <p style={{margin:0,fontSize:12,fontWeight:700,color:W,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.companyName}</p>
                    <div style={{display:"flex",gap:4,marginTop:2}}>
                      {p.flagToMelissa&&<span style={{fontSize:9,color:"#f472b6"}}>🚩</span>}
                      {p.doNotRespond&&<span style={{fontSize:9,color:"#f87171"}}>🚫</span>}
                      {p.replyReceived&&<span style={{fontSize:9,color:"#34d399"}}>📩</span>}
                      {p.sourceType&&["Claude AI","ChatGPT","Gemini"].some(x=>p.sourceType.includes(x))&&<span style={{fontSize:9,color:"#c084fc"}}>🤖</span>}
                    </div>
                  </td>
                  <td style={{padding:"10px 13px"}}><p style={{margin:0,fontSize:12,color:WM}}>{p.contactName||"—"}</p><p style={{margin:0,fontSize:10,color:WD}}>{p.title}</p></td>
                  <td style={{padding:"10px 13px",fontSize:11,color:WD,maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.vertical||"—"}</td>
                  <td style={{padding:"10px 13px",fontSize:11,color:WD}}>{p.market||"—"}</td>
                  <td style={{padding:"10px 13px"}}><SBadge status={p.currentStatus} sm/></td>
                  <td style={{padding:"10px 13px",fontSize:14,fontWeight:800,color:parseInt(p.priorityScore)>=7?"#f472b6":parseInt(p.priorityScore)>=4?GL:"rgba(255,255,255,0.2)"}}>{p.priorityScore||"—"}</td>
                  <td style={{padding:"10px 13px"}}>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>setPDlg(p)} className="bh" style={{...B.ghost,fontSize:10,padding:"4px 9px",color:GL,borderColor:"rgba(201,150,58,0.3)"}}>{canEdit?"✏️ Edit":"👁 View"}</button>
                      {canEdit&&<select value={p.currentStatus} onChange={e=>qStatus(p.id,e.target.value)} style={{...inp(),width:"auto",fontSize:9,padding:"3px 6px",cursor:"pointer"}}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PIPELINE */}
      {view==="pipeline"&&(
        <div style={{padding:"13px 16px 60px",animation:"fadeUp 0.3s ease",overflowX:"auto"}}>
          <div style={{display:"flex",gap:9,minWidth:960}}>
            {STATUSES.slice(0,7).map(s=>{
              const cards=filtered.filter(p=>p.currentStatus===s);const sc2=SC[s]||{};
              return(
                <div key={s} style={{flex:1,minWidth:148,background:"rgba(255,255,255,0.02)",border:`1px solid rgba(255,255,255,0.06)`,borderRadius:11,overflow:"hidden"}}>
                  <div style={{background:sc2.bg||"rgba(255,255,255,0.03)",borderBottom:`1px solid ${sc2.b||BR}`,padding:"7px 9px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:9,fontWeight:800,color:sc2.c||WM,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s}</span>
                    <span style={{fontSize:12,fontWeight:800,color:sc2.c||W,flexShrink:0,marginLeft:3}}>{cards.length}</span>
                  </div>
                  <div style={{padding:6,display:"flex",flexDirection:"column",gap:5,maxHeight:500,overflowY:"auto"}}>
                    {cards.map(p=>(
                      <div key={p.id} onClick={()=>setPDlg(p)} className="rh" style={{background:NL,border:`1px solid rgba(255,255,255,0.07)`,borderRadius:9,padding:"9px 10px",cursor:"pointer"}}>
                        <p style={{margin:0,fontSize:11,fontWeight:700,color:W,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.companyName}</p>
                        <p style={{margin:"2px 0 0",fontSize:10,color:WD,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.contactName||"—"}</p>
                        <div style={{display:"flex",gap:4,marginTop:4}}>
                          {p.flagToMelissa&&<span style={{fontSize:9,color:"#f472b6"}}>🚩</span>}
                          {p.replyReceived&&<span style={{fontSize:9,color:"#34d399"}}>📩</span>}
                          {p.doNotRespond&&<span style={{fontSize:9,color:"#f87171"}}>🚫</span>}
                          {p.priorityScore&&<span style={{fontSize:9,marginLeft:"auto",color:parseInt(p.priorityScore)>=7?"#f472b6":GL}}>⭐{p.priorityScore}</span>}
                        </div>
                        {p.priorityScore&&<div style={{marginTop:4,height:2,background:"rgba(255,255,255,0.06)",borderRadius:1}}><div style={{height:"100%",background:parseInt(p.priorityScore)>=7?"#f472b6":G,borderRadius:1,width:Math.min(parseInt(p.priorityScore)*10,100)+"%"}}/></div>}
                      </div>
                    ))}
                    {cards.length===0&&<p style={{fontSize:10,color:WD,textAlign:"center",padding:"10px 0",margin:0}}>Empty</p>}
                    {canEdit&&<button onClick={()=>setPDlg({...EMPTY_P,id:uid(),currentStatus:s})} style={{...B.ghost,fontSize:9,padding:"5px",width:"100%",color:WD,borderStyle:"dashed"}}>+ Add here</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
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

      {/* MODALS */}
      {showImport&&<ExcelImportModal onClose={()=>setShowImport(false)} onImport={async (rows,mode)=>{await onImportProspects(rows,mode);setShowImport(false);t2(`${rows.length} prospects ${mode==="replace"?"imported":"added"}!`);}}/>}
      {showFinder&&<ProspectFinderModal onClose={()=>setShowFinder(false)} onAddProspects={async prospects=>{await onImportProspects(prospects,"append");t2(`${prospects.length} prospect${prospects.length!==1?"s":""} added to CRM!`);}} existingIds={existingIds} sysSettings={sysSettings}/>}
      {pDlg&&<ProspectModal prospect={pDlg==="add"?{...EMPTY_P,id:uid()}:pDlg} isNew={pDlg==="add"||!crmData.find(p=>p.id===pDlg?.id)} onSave={saveP} onDelete={canEdit&&role.canDelete?deleteP:null} onClose={()=>setPDlg(null)} canDelete={canEdit&&role.canDelete}/>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   ROOT APP  —  Supabase-powered with local fallback
════════════════════════════════════════════════════════════════ */
export default function App(){
  const [screen,setScreen]   = useState("loading");
  const [currentUser,setCurrentUser] = useState(null);
  const [users,setUsers]     = useState(INIT_USERS);
  const [crmData,setCrmData] = useState(SEED);
  const [sysSettings,setSysSettings] = useState(DEFAULT_SYS);
  const [auditLog,setAuditLog] = useState([{time:"2026-06-05 00:00",user:"system",action:"System initialized — NC Compliance CRM v4.0"}]);
  const [dbStatus,setDbStatus] = useState(isConfigured ? "connecting" : "local");
  const [dbError,setDbError]   = useState(null);

  /* ── Load everything from DB on mount ────────────────────── */
  useEffect(()=>{
    const init = async () => {
      // Restore session regardless of DB mode
      let sessionUser = null;
      try {
        const s = sessionStorage.getItem("crm_v4");
        if (s) sessionUser = JSON.parse(s);
      } catch {}

      if (!isConfigured) {
        // Local / demo mode — use seed data
        setDbStatus("local");
        if (sessionUser) {
          const live = INIT_USERS.find(u => u.id === sessionUser.id && u.active);
          if (live) { setCurrentUser(sessionUser); setScreen("crm"); return; }
        }
        setScreen("login");
        return;
      }

      // Supabase mode
      try {
        const [dbUsers, dbProspects, dbSettings, dbAudit] = await Promise.all([
          DB.getUsers(),
          DB.getProspects(),
          DB.getSettings(),
          DB.getAuditLog(),
        ]);
        if (dbUsers.length)     setUsers(dbUsers);
        if (dbProspects.length) setCrmData(dbProspects);
        if (Object.keys(dbSettings).length) setSysSettings(s=>({...s,...dbSettings}));
        if (dbAudit.length)     setAuditLog(dbAudit);
        setDbStatus("connected");

        if (sessionUser) {
          const live = dbUsers.find(u => u.id === sessionUser.id && u.active) ||
                       INIT_USERS.find(u => u.id === sessionUser.id && u.active);
          if (live) { setCurrentUser(sessionUser); setScreen("crm"); return; }
        }
        setScreen("login");
      } catch(e) {
        console.error("Supabase load failed:", e);
        setDbError(e.message);
        setDbStatus("error");
        // Fall back to local data so the app still works
        if (sessionUser) {
          const live = INIT_USERS.find(u => u.id === sessionUser.id && u.active);
          if (live) { setCurrentUser(sessionUser); setScreen("crm"); return; }
        }
        setScreen("login");
      }
    };
    init();
  },[]);

  /* ── Audit helper ────────────────────────────────────────── */
  const addAudit = useCallback(async (username, action) => {
    const ts = new Date().toLocaleString("sv-SE",{hour12:false}).replace("T"," ").slice(0,16);
    const entry = { time:ts, user:username, action };
    setAuditLog(prev => [...prev, entry]);
    if (isConfigured && dbStatus === "connected") {
      try { await DB.addAudit(username, action); } catch {}
    }
  },[dbStatus]);

  /* ── CRM data helpers (sync UI + DB) ────────────────────── */
  const syncCrmData = useCallback(async (updater, dbAction) => {
    setCrmData(updater); // optimistic update
    if (isConfigured && dbStatus === "connected") {
      try { await dbAction(); } catch(e) { console.warn("DB sync warn:", e.message); }
    }
  },[dbStatus]);

  const syncUsers = useCallback(async (updater, dbAction) => {
    setUsers(updater);
    if (isConfigured && dbStatus === "connected") {
      try { await dbAction(); } catch(e) { console.warn("DB sync warn:", e.message); }
    }
  },[dbStatus]);

  /* ── Wrapped setCrmData that also persists ───────────────── */
  const setCrmDataDb = useCallback((prospectOrUpdater, dbHint) => {
    if (typeof prospectOrUpdater === "function") {
      setCrmData(prospectOrUpdater);
    } else {
      setCrmData(prospectOrUpdater);
    }
    // DB persistence happens via specific save/delete calls below
  },[]);

  /* ── Login / Logout ──────────────────────────────────────── */
  const login = async (user) => {
    const u = { ...user, lastLogin: new Date().toLocaleString() };
    setCurrentUser(u);
    setUsers(prev => prev.map(x => x.id === u.id ? {...x, lastLogin:u.lastLogin} : x));
    sessionStorage.setItem("crm_v4", JSON.stringify(u));
    addAudit(u.username, "Logged in");
    if (isConfigured && dbStatus === "connected") {
      try { await DB.updateLastLogin(u.id); } catch {}
    }
    setScreen("crm");
  };

  const logout = () => {
    if (currentUser) addAudit(currentUser.username, "Logged out");
    sessionStorage.removeItem("crm_v4");
    setCurrentUser(null);
    setScreen("login");
  };

  const openAdmin = () => {
    if (currentUser && ROLES[currentUser.role].canAdmin) setScreen("admin");
  };

  /* ── DB-aware save / delete wrappers passed down ─────────── */
  const handleSaveProspect = useCallback(async (form) => {
    if (isConfigured && dbStatus === "connected") {
      try {
        const saved = await DB.upsertProspect(form);
        if (saved) {
          setCrmData(prev => {
            const exists = prev.find(p => p.id === form.id);
            return exists ? prev.map(p => p.id === form.id ? saved : p) : [...prev, saved];
          });
          return saved;
        }
      } catch(e) { console.warn("upsert failed, using local:", e.message); }
    }
    // Local fallback
    setCrmData(prev => {
      const exists = prev.find(p => p.id === form.id);
      return exists ? prev.map(p => p.id === form.id ? form : p) : [...prev, form];
    });
    return form;
  },[dbStatus]);

  const handleDeleteProspect = useCallback(async (id) => {
    setCrmData(prev => prev.filter(p => p.id !== id));
    if (isConfigured && dbStatus === "connected") {
      try { await DB.deleteProspect(id); } catch(e) { console.warn("delete failed:", e.message); }
    }
  },[dbStatus]);

  const handleImportProspects = useCallback(async (rows, mode) => {
    if (mode === "replace") {
      setCrmData(rows);
      if (isConfigured && dbStatus === "connected") {
        try {
          await DB.deleteAllProspects();
          const saved = await DB.upsertProspects(rows);
          if (saved && saved.length) setCrmData(saved);
        } catch(e) { console.warn("import replace failed:", e.message); }
      }
    } else {
      setCrmData(prev => [...prev, ...rows]);
      if (isConfigured && dbStatus === "connected") {
        try {
          const saved = await DB.upsertProspects(rows);
          if (saved && saved.length) {
            setCrmData(prev => {
              const ids = new Set(rows.map(r => r.id));
              return [...prev.filter(p => !ids.has(p.id)), ...saved];
            });
          }
        } catch(e) { console.warn("import append failed:", e.message); }
      }
    }
  },[dbStatus]);

  const handleSaveUser = useCallback(async (u) => {
    if (isConfigured && dbStatus === "connected") {
      try {
        const saved = await DB.upsertUser(u);
        if (saved) {
          setUsers(prev => {
            const exists = prev.find(x => x.id === u.id);
            return exists ? prev.map(x => x.id === u.id ? saved : x) : [...prev, saved];
          });
          return saved;
        }
      } catch(e) { console.warn("user upsert failed:", e.message); }
    }
    setUsers(prev => {
      const exists = prev.find(x => x.id === u.id);
      return exists ? prev.map(x => x.id === u.id ? u : x) : [...prev, u];
    });
    return u;
  },[dbStatus]);

  const handleDeleteUser = useCallback(async (id) => {
    setUsers(prev => prev.filter(u => u.id !== id));
    if (isConfigured && dbStatus === "connected") {
      try { await DB.deleteUser(id); } catch(e) { console.warn("user delete failed:", e.message); }
    }
  },[dbStatus]);

  const handleSaveSettings = useCallback(async (settings) => {
    setSysSettings(settings);
    if (isConfigured && dbStatus === "connected") {
      try { await DB.saveSettings(settings); } catch(e) { console.warn("settings save failed:", e.message); }
    }
  },[dbStatus]);

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
    if (dbStatus === "connected") return (
      <div style={{position:"fixed",bottom:12,left:12,zIndex:9998,display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:"rgba(52,211,153,0.1)",border:"1px solid rgba(52,211,153,0.25)",borderRadius:20,fontSize:10,color:"#34d399"}}>
        <div style={{width:6,height:6,borderRadius:"50%",background:"#34d399"}}/>
        Supabase · Live
      </div>
    );
    if (dbStatus === "local") return (
      <div style={{position:"fixed",bottom:12,left:12,zIndex:9998,display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.25)",borderRadius:20,fontSize:10,color:"#fbbf24",cursor:"pointer"}} title="Click to learn how to connect your database" onClick={()=>alert("Add your Supabase URL and key at the top of the JSX file. See SETUP_GUIDE.md for instructions.")}>
        <div style={{width:6,height:6,borderRadius:"50%",background:"#fbbf24"}}/>
        Demo Mode — data resets on refresh · Add DB credentials to persist
      </div>
    );
    if (dbStatus === "error") return (
      <div style={{position:"fixed",bottom:12,left:12,zIndex:9998,display:"flex",alignItems:"center",gap:6,padding:"5px 12px",background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:20,fontSize:10,color:"#f87171"}} title={dbError}>
        <div style={{width:6,height:6,borderRadius:"50%",background:"#f87171"}}/>
        DB Error — using local data · hover for details
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
      />
      <DbBanner/>
    </>
  );

  return <><LoginScreen users={users} onLogin={login}/><DbBanner/></>;
}
