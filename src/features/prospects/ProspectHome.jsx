import React, { useEffect, useMemo, useState } from "react";
import NationwideFinder from "./NationwideFinder.jsx";
import { ThemeToggle } from "../../ui/kit.jsx";
import {safeWebsite,safeEmail,safePhone} from "../../lib/contactDetails.js";
import ApiIntegrations from "./ApiIntegrations.jsx";
import OutreachWorkspace from "./OutreachWorkspace.jsx";
import OutreachTools from "./OutreachTools.jsx";
import TeamTasks from "./TeamTasks.jsx";
import TaskNotifications from "./TaskNotifications.jsx";
import AnalyticsWorkspace from "./AnalyticsWorkspace.jsx";
import QualityReviewWorkspace from "./QualityReviewWorkspace.jsx";
import WorkflowWorkspace from "./WorkflowWorkspace.jsx";

/**
 * The nationwide ProspectFinder experience is the default authenticated landing page.
 * The original CRM remains available under "Classic CRM", preserving its workflows.
 * All counts below come from existing Supabase-backed CRM records, never mock data.
 */
const nonprofitPattern = /nonprofit|non-profit|foundation|charit|faith|social service|human service|advocacy|community development|environmental|cultural|grantmaker/i;
const statusName = value => String(value || "NEW").replaceAll("_", " ");
const statusTone = value => /won|booked|converted/i.test(value) ? "green" : /sent|contacted|nurture/i.test(value) ? "blue" : /lost|do not/i.test(value) ? "red" : "neutral";
const text = value => String(value || "").trim();
const css = [
  ".pf-root{--pf-ink:var(--pf-tx-15213A);--pf-muted:var(--pf-tx-71809B);--pf-primary:#6454E8;--pf-border:var(--pf-bd-E8ECF4);--pf-canvas:var(--pf-bg-F5F7FC);display:flex;min-height:100vh;background:var(--pf-canvas);color:var(--pf-ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;}",
  ".pf-root *{box-sizing:border-box}.pf-root button,.pf-root select,.pf-root input{font-family:inherit}.pf-root button{cursor:pointer}",
  ".pf-side{width:244px;flex:none;background:#101C36;color:#C7D2E8;min-height:100vh;position:sticky;top:0;align-self:flex-start;display:flex;flex-direction:column;padding:25px 16px 18px}",
  ".pf-brand{display:flex;gap:11px;align-items:center;padding:2px 9px 27px}.pf-mark{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(140deg,#9E8EFF,#6354E8);color:white;font-weight:900;font-size:21px;box-shadow:0 7px 20px #6255dd55}.pf-brand-name{font-size:18px;font-weight:820;color:white;letter-spacing:-.65px}.pf-brand-sub{font-size:10px;color:#99A9C8;letter-spacing:.09em;text-transform:uppercase;margin-top:2px}",
  ".pf-navhint{font-size:10px;text-transform:uppercase;font-weight:800;letter-spacing:1.6px;color:#7183A5;margin:10px 13px 11px}",
  ".pf-navbtn{border:0;background:transparent;color:#AFC1DD;width:100%;display:flex;align-items:center;text-align:left;gap:13px;padding:13px 14px;border-radius:11px;font-size:13px;font-weight:640;margin:1px 0}",
  ".pf-navbtn:hover{background:#243452;color:#fff}.pf-navbtn.active{background:#6557DD;color:white;box-shadow:0 8px 22px #6557dd30}.pf-ico{width:23px;text-align:center;font-size:17px}",
  ".pf-side-bottom{margin-top:auto;border-top:1px solid #2A3750;padding-top:16px}.pf-user{display:flex;gap:10px;align-items:center;background:#1A2945;border:1px solid #2C3D60;border-radius:13px;padding:11px;margin-top:15px}.pf-avatar{width:34px;height:34px;border-radius:10px;background:#DEDCFF;color:#5949BC;display:grid;place-items:center;font-weight:800}.pf-user-name{font-size:12px;font-weight:700;color:#EFF3FB;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:136px}.pf-user-sub{font-size:10px;color:#91A4C7}",
  ".pf-main{flex:1;min-width:0}.pf-header{height:80px;background:var(--pf-bg-FFFFFF);border-bottom:1px solid var(--pf-border);display:flex;align-items:center;justify-content:space-between;padding:0 34px;gap:15px}.pf-breadcrumb{font-size:12px;color:var(--pf-muted);font-weight:600}.pf-header strong{font-size:14px;color:var(--pf-tx-1C2841)}.pf-pill{border:1px solid var(--pf-bd-DFE7F3);padding:8px 12px;border-radius:100px;color:var(--pf-tx-5B6880);font-size:11px;font-weight:750;background:var(--pf-bg-F8F9FC)}.pf-online{width:7px;height:7px;background:var(--pf-bg-25C69A);display:inline-block;border-radius:50%;margin-right:6px}.pf-content{padding:33px 36px 60px;max-width:1500px;margin:0 auto}",
  ".pf-page-kicker{font-weight:850;color:var(--pf-tx-6755E9);letter-spacing:1.7px;font-size:10px;text-transform:uppercase}.pf-page-title{font-size:32px;line-height:1.16;font-weight:860;letter-spacing:-1.4px;margin:9px 0 8px}.pf-page-description{color:var(--pf-muted);font-size:13px;line-height:1.6;margin:0}",
  ".pf-hero{margin-top:24px;background:linear-gradient(112deg,var(--pf-bg-4F42CE) 0%,var(--pf-bg-6F60EC) 55%,var(--pf-bg-8C79F0) 100%);color:white;min-height:225px;border-radius:21px;position:relative;overflow:hidden;display:flex;align-items:center;padding:35px 42px;box-shadow:0 16px 30px #6557dd1e}.pf-hero:before{content:'';position:absolute;width:420px;height:420px;border:1px solid #ffffff25;border-radius:50%;right:-90px;top:-125px}.pf-hero:after{content:'';position:absolute;width:270px;height:270px;border:1px solid #ffffff45;border-radius:50%;right:40px;top:80px}.pf-hero>*{z-index:1;position:relative}.pf-hero-head{font-size:29px;line-height:1.18;letter-spacing:-1.1px;font-weight:840;max-width:500px;margin:7px 0}.pf-hero-sub{font-size:12px;color:#E5E0FF;max-width:410px;line-height:1.7;margin:11px 0 20px}.pf-hero-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:2px;font-weight:800;color:#D7D0FF}",
  ".pf-button{border:0;background:var(--pf-primary);color:white;border-radius:11px;padding:12px 17px;font-weight:760;font-size:12px;display:inline-flex;align-items:center;gap:8px;justify-content:center;box-shadow:0 8px 20px #6454e828}.pf-button:hover{filter:brightness(.96)}.pf-button.white{background:var(--pf-bg-FFFFFF);color:var(--pf-tx-5143C9);box-shadow:none}.pf-button.outline{background:var(--pf-bg-FFFFFF);color:var(--pf-tx-485674);border:1px solid var(--pf-border);box-shadow:none}",
  ".pf-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px;margin-top:22px}.pf-metric{background:var(--pf-bg-FFFFFF);border:1px solid var(--pf-border);border-radius:15px;padding:19px 20px;min-height:118px}.pf-metric-top{display:flex;align-items:center;justify-content:space-between}.pf-metric-ico{width:35px;height:35px;border-radius:10px;display:grid;place-items:center;background:var(--pf-bg-F0ECFF);color:var(--pf-tx-6557DD);font-size:17px}.pf-metric-label{color:var(--pf-muted);font-weight:690;font-size:11px}.pf-metric-num{margin:13px 0 1px;font-weight:860;font-size:28px;letter-spacing:-1px;line-height:1.1}.pf-metric-foot{color:var(--pf-tx-8793A8);font-size:10px;margin-top:7px}",
  ".pf-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(270px,1fr);gap:20px;margin-top:23px}.pf-card{background:var(--pf-bg-FFFFFF);border:1px solid var(--pf-border);border-radius:16px;padding:22px;min-width:0}.pf-card-title{font-size:14px;font-weight:830;letter-spacing:-.3px;margin:0}.pf-card-sub{font-size:11px;color:var(--pf-muted);margin:7px 0 0}.pf-card-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.pf-link{border:0;background:transparent;color:var(--pf-primary);font-weight:800;font-size:11px;padding:5px}.pf-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:21px}.pf-action{border:1px solid var(--pf-bd-E5E7F2);border-radius:13px;background:var(--pf-bg-FBFCFF);padding:18px;display:flex;gap:10px;text-align:left;align-items:center;min-height:88px}.pf-action:hover{border-color:var(--pf-bd-8174EF);background:var(--pf-bg-F5F2FF)}.pf-action-ico{width:43px;height:43px;flex:none;border-radius:12px;background:var(--pf-bg-EDEBFF);display:grid;place-items:center;font-size:20px}.pf-action strong{display:block;font-size:12px}.pf-action small{display:block;color:var(--pf-muted);font-size:10px;margin-top:4px;line-height:1.4}",
  ".pf-recent{width:100%;border-collapse:collapse;margin-top:15px}.pf-recent th{text-align:left;color:var(--pf-tx-8390A6);font-size:10px;letter-spacing:.3px;padding:13px 9px;border-bottom:1px solid var(--pf-border);font-weight:750}.pf-recent td{font-size:11px;padding:14px 9px;border-bottom:1px solid var(--pf-bd-F1F3F8);color:var(--pf-tx-394860)}.pf-recent tr:last-child td{border-bottom:0}.pf-name{font-weight:790;color:var(--pf-tx-1B2944)}.pf-tag{font-size:9px;padding:5px 8px;border-radius:50px;display:inline-block;background:var(--pf-bg-F0F1F7);color:var(--pf-tx-637187);font-weight:750}.pf-tag.green{background:var(--pf-bg-DDF9ED);color:var(--pf-tx-0D8C6B)}.pf-tag.blue{background:var(--pf-bg-E7EFFF);color:var(--pf-tx-3869CD)}.pf-tag.red{background:var(--pf-bg-FFEBED);color:var(--pf-tx-C74758)}.pf-empty{text-align:center;padding:30px 15px;color:var(--pf-tx-8793A8);font-size:12px;line-height:1.7}",
  ".pf-searchline{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.pf-searchline input{padding:12px 13px;border:1px solid var(--pf-bd-E0E6F0);border-radius:10px;flex:1;min-width:200px;background:var(--pf-bg-FFFFFF);color:var(--pf-tx-253653);font-size:12px}.pf-finder-card{margin-top:23px}.pf-finder-card .pf-native-search input,.pf-finder-card .pf-native-search select{background:var(--pf-bg-FFFFFF)!important;color:var(--pf-tx-22314C)!important;border:1px solid var(--pf-bd-DEE4F0)!important;border-radius:9px!important}.pf-finder-card .pf-native-search label{color:var(--pf-tx-53627D)!important}.pf-finder-card button:disabled{opacity:.55;cursor:not-allowed}.pf-footnote{font-size:11px;color:var(--pf-tx-8190AB);margin-top:22px}",
  "@media(max-width:1080px){.pf-metrics{grid-template-columns:repeat(2,1fr)}.pf-layout{grid-template-columns:1fr}.pf-side{width:205px}.pf-content{padding:25px}}",
  "@media(max-width:720px){.pf-root{display:block}.pf-side{position:relative;width:100%;min-height:auto;padding:10px 12px;flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap}.pf-brand{padding:4px 7px}.pf-brand-sub,.pf-navhint,.pf-side-bottom{display:none}.pf-side nav{display:flex;flex-wrap:wrap;gap:4px}.pf-navbtn{width:auto;padding:9px 11px;font-size:11px;gap:5px}.pf-ico{width:auto}.pf-header{height:57px;padding:0 18px}.pf-header .pf-pill{display:none}.pf-content{padding:20px 14px 48px}.pf-page-title{font-size:25px}.pf-hero{padding:25px;min-height:205px}.pf-hero-head{font-size:24px}.pf-metrics{grid-template-columns:repeat(2,1fr);gap:9px}.pf-metric{padding:14px}.pf-metric-num{font-size:23px}.pf-actions{grid-template-columns:1fr}.pf-card{padding:17px}}",
  ".pf-subtabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--pf-border);margin:-8px 0 24px}.pf-subtab{border:0;background:transparent;color:var(--pf-muted);font-size:13.5px;font-weight:650;padding:11px 16px;border-bottom:3px solid transparent;margin-bottom:-1px;border-radius:9px 9px 0 0}.pf-subtab:hover{color:var(--pf-ink);background:rgba(127,127,160,.08)}.pf-subtab.active{color:var(--pf-ink);border-bottom-color:var(--pf-primary)}.pf-subtab:focus-visible{outline:2px solid var(--pf-primary);outline-offset:-2px}"
].join("\n");

function MiniTable({ data, onOpenCRM, limit = 5, showContacts = false }) {
  const items = data.slice(0, limit);
  return <div style={{overflowX:"auto"}}>
    <table className="pf-recent">
      <thead><tr><th>ORGANIZATION</th><th>LOCATION</th>{showContacts&&<><th>WEBSITE</th><th>EMAIL</th><th>PHONE</th></>}<th>STATUS</th></tr></thead>
      <tbody>{items.map((p,i)=><tr key={p.id || i}>
        <td><span className="pf-name">{text(p.companyName) || "Unnamed prospect"}</span><div style={{color:"var(--pf-tx-95A1B5)",fontSize:10,marginTop:4}}>{text(p.vertical) || "Uncategorized"}</div></td>
        <td>{text(p.cityMarket || p.market) || "Not listed"}</td>
        {showContacts&&<>
         <td>{safeWebsite(p.website)?<a href={safeWebsite(p.website)} target="_blank" rel="noopener noreferrer" style={{color:"var(--pf-tx-5848C9)"}}>Visit ↗</a>:"Not available"}</td>
         <td>{safeEmail(p.email)?<a href={"mailto:"+safeEmail(p.email)} style={{color:"var(--pf-tx-5848C9)"}}>{safeEmail(p.email)}</a>:"Not available"}</td>
         <td>{safePhone(p.phone)?<a href={"tel:"+safePhone(p.phone).replace(/[^\d+]/g,"")} style={{color:"var(--pf-tx-5848C9)"}}>{safePhone(p.phone)}</a>:"Not available"}</td>
        </>}
        <td><span className={"pf-tag " + statusTone(p.currentStatus)}>{statusName(p.currentStatus)}</span></td>
      </tr>)}</tbody>
    </table>
    {!items.length && <div className="pf-empty">No saved prospects yet. Discover organizations and save them to start building your pipeline.</div>}
    {items.length > 0 && <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}><button className="pf-link" onClick={onOpenCRM}>Manage all in CRM →</button></div>}
  </div>;
}

export default function ProspectHome({ crmData = [], currentUser, onOpenCRM: onOpenCRMProp, onOpenAdmin, classicViews, onSelectClassic, renderAdmin, onOpenQualification, workspaceRequest, onLogout, onAddProspects, onUpdateProspect, canEdit=false, baseUrl, requestHeaders, dbStatus, canAdmin, onLoadApiCredentials, onSaveApiCredential, activityEnabled=false, onGetActivities, onLogActivity, tasksEnabled=false, onGetTasks, onGetTaskMembers, onCreateTask, onUpdateTask, savedApi }) {
  const [tab, setTab] = useState("overview");
  const [focusedProspectId, setFocusedProspectId] = useState(null);
  const [focusedOutreachId, setFocusedOutreachId] = useState(null);
  const [taskDraft, setTaskDraft] = useState(null);
  const [composeId, setComposeId] = useState(null);   // prospect chosen for "Write email"
  const [lastSub, setLastSub] = useState({});   // remembers the last tab you used in each area
  const [focusedTaskId,setFocusedTaskId] = useState(null);
  // The classic CRM screens now live INSIDE this workspace (one navigation, one app).
  const CLASSIC = ["table","pipeline","calendar","email"];
  const CRUMBS = { table:"Prospects", pipeline:"Pipeline", calendar:"Calendar", email:"Email Hub", admin:"Admin" };
  const openProspects = () => { onSelectClassic?.("table"); setTab("table"); };
  const onOpenCRM = () => { onOpenCRMProp?.(); openProspects(); };   // children call this to jump to the Prospects area
  const openQualification = id => { onOpenQualification?.(id); openProspects(); };
  useEffect(() => {
    if (!workspaceRequest) return;
    const { type, id, company } = workspaceRequest;
    if (type === "email"){ setComposeId(id); setLastSub(m => ({ ...m, email: "tools" })); setTab("tools"); }
    if (type === "task"){ setTaskDraft({ prospectId: id, taskTitle: `Follow up with ${company || "prospect"}`, description: "", priority: "normal" }); setFocusedTaskId(null); setLastSub(m => ({ ...m, calendar: "tasks" })); setTab("tasks"); }
  }, [workspaceRequest]);
  const nonprofitCount = useMemo(() => crmData.filter(p => nonprofitPattern.test(text(p.vertical))).length, [crmData]);
  const smallCount = Math.max(0, crmData.length - nonprofitCount);
  const fresh = crmData.filter(p => statusName(p.currentStatus).toUpperCase() === "NEW").length;
  const contacted = crmData.filter(p => /T1 SENT|T2 SENT|T3 SENT|CONTACTED|FOLLOW.UP/i.test(statusName(p.currentStatus))).length;
  const recent = [...crmData].reverse();
  // Seven areas instead of fourteen sidebar items. Related screens are tabs INSIDE an area:
  //   find prospects → prospects (list · map · pipeline) → email → calendar → insights → settings
  const HUBS = [
    { id:"overview",  label:"Home",             icon:"🏠", subs:[["overview","Home"]] },
    { id:"find",      label:"Find prospects",   icon:"🔍", subs:[["discover","Find prospects"]] },
    { id:"prospects", label:"Prospects",        icon:"👥", subs:[["table","List, map & qualify"],["pipeline","Pipeline board"]] },
    { id:"email",     label:"Email & outreach", icon:"✉️", subs:[["email","Gmail inbox"],["tools","Write from template"],["outreach","Follow-ups & reports"]] },
    { id:"calendar",  label:"Calendar & tasks", icon:"📅", subs:[["calendar","Calendar"],["tasks","Team tasks"],["notifications","Task alerts"]] },
    { id:"insights",  label:"Insights",         icon:"📊", subs:[["analytics","Analytics"],["quality","Quality & priorities"],["workflow","Action queue"]] },
    { id:"settings",  label:"Settings",         icon:"⚙️", subs:[["integrations","API integrations"], ...((canAdmin && renderAdmin) ? [["admin","Admin"]] : [])] },
  ];
  const hubOfTab = id => HUBS.find(h => h.subs.some(([t]) => t === id)) || HUBS[0];
  const hub = hubOfTab(tab);
  const subLabel = (hub.subs.find(([t]) => t === tab) || [])[1] || "";
  const toTab = id => { setLastSub(m => ({ ...m, [hubOfTab(id).id]: id })); if(CLASSIC.includes(id)){ onSelectClassic?.(id); setTab(id); return; } if(id==="crm")return onOpenCRM(); if(id==="outreach")setFocusedOutreachId(null); if(id==="tools")setComposeId(null); if(id==="tasks"){setTaskDraft(null);setFocusedTaskId(null);} setTab(id); };
  const name = text(currentUser?.name || currentUser?.username || "Team Member");
  return <div className="pf-root">
    <style>{css}</style>
    <aside className="pf-side">
      <div className="pf-brand"><span className="pf-mark">P</span><div><div className="pf-brand-name">ProspectFinder</div><div className="pf-brand-sub">NATIONWIDE CRM</div></div></div>
      <p className="pf-navhint">WORKSPACE</p>
      <nav aria-label="ProspectFinder navigation">{HUBS.map(h => <button key={h.id} className={"pf-navbtn " + (hub.id===h.id?"active":"")} aria-current={hub.id===h.id?"page":undefined} onClick={()=>toTab(lastSub[h.id] && h.subs.some(([t])=>t===lastSub[h.id]) ? lastSub[h.id] : h.subs[0][0])}><span className="pf-ico">{h.icon}</span>{h.label}</button>)}</nav>
      <div className="pf-side-bottom">
        {canAdmin && !renderAdmin && <button className="pf-navbtn" onClick={onOpenAdmin}><span className="pf-ico">⚙</span>Admin settings</button>}
        <div style={{padding:"4px 2px 10px"}}><ThemeToggle onDark/></div>
        <button className="pf-navbtn" onClick={onLogout}><span className="pf-ico">⇥</span>Sign out</button>
        <div className="pf-user"><div className="pf-avatar">{name.charAt(0).toUpperCase()}</div><div><div className="pf-user-name">{name}</div><div className="pf-user-sub">CRM account</div></div></div>
      </div>
    </aside>
    <main className="pf-main">
      <header className="pf-header"><div><div className="pf-breadcrumb">Workspace / {hub.label}{hub.subs.length>1 ? " / " + subLabel : ""}</div><strong>ProspectFinder · U.S. Nationwide</strong></div><div className="pf-pill"><span className="pf-online"/>{dbStatus==="connected"?"CRM Connected":dbStatus==="local"?"Demo Mode":"CRM "+(dbStatus||"Status")}</div></header>
      <div className="pf-content">
      {hub.subs.length > 1 && (
        <div className="pf-subtabs" role="tablist" aria-label={hub.label}>
          {hub.subs.map(([id,label]) => <button key={id} type="button" role="tab" aria-selected={tab===id} className={"pf-subtab " + (tab===id?"active":"")} onClick={()=>toTab(id)}>{label}</button>)}
        </div>
      )}
      {tab==="overview" && <>
        <div className="pf-page-kicker">PROSPECTFINDER · NATIONWIDE CRM</div>
        <h1 className="pf-page-title">Good morning, {name.split(" ")[0]} <span aria-hidden="true">✳</span></h1>
        <p className="pf-page-description">Discover organizations nationwide, qualify opportunities, and move prospects into your CRM.</p>
        <section className="pf-hero">
          <div><div className="pf-hero-eyebrow">PROSPECT DISCOVERY · UNITED STATES</div>
            <h2 className="pf-hero-head">Discover more. Connect with purpose.</h2>
            <p className="pf-hero-sub">Find nonprofits and local businesses anywhere in the U.S. and save qualified leads straight to your existing CRM.</p>
            <button className="pf-button white" onClick={()=>setTab("discover")}>⌕ &nbsp; Start finding prospects <span aria-hidden="true">→</span></button>
          </div>
        </section>
        <section className="pf-metrics" aria-label="Your saved prospect statistics">
          {[
            ["◫","Total saved leads",crmData.length,"From your connected CRM"],
            ["♡","Nonprofits",nonprofitCount,"Categorized nonprofit prospects"],
            ["▣","Small businesses",smallCount,"Other saved organizations"],
            ["↗","Outreach started",contacted,"Leads with contacted status"]
          ].map(([ico,label,num,foot])=><div className="pf-metric" key={label}><div className="pf-metric-top"><span className="pf-metric-label">{label}</span><span className="pf-metric-ico">{ico}</span></div><div className="pf-metric-num">{num.toLocaleString()}</div><div className="pf-metric-foot">{foot}</div></div>)}
        </section>
        <div className="pf-layout">
          <section className="pf-card">
            <div className="pf-card-top"><div><h3 className="pf-card-title">Quick discovery</h3><p className="pf-card-sub">Jump into your next targeted search</p></div></div>
            <div className="pf-actions">
              <button className="pf-action" onClick={()=>setTab("discover")}><span className="pf-action-ico">♡</span><span><strong>Find nonprofits</strong><small>Organizations, charities & foundations</small></span></button>
              <button className="pf-action" onClick={()=>setTab("discover")}><span className="pf-action-ico">▣</span><span><strong>Find small businesses</strong><small>Local services, shops & companies</small></span></button>
              <button className="pf-action" onClick={()=>openQualification(null)}><span className="pf-action-ico">▤</span><span><strong>Qualify saved leads</strong><small>{fresh} prospects currently marked new</small></span></button>
              <button className="pf-action" onClick={()=>setTab("outreach")}><span className="pf-action-ico">◷</span><span><strong>Manage follow-ups</strong><small>Due dates, manual outreach and pipeline reports</small></span></button>
              <button className="pf-action" onClick={()=>setTab("analytics")}><span className="pf-action-ico">▥</span><span><strong>Review analytics</strong><small>Pipeline performance, contact coverage and tasks</small></span></button>
              <button className="pf-action" onClick={()=>setTab("quality")}><span className="pf-action-ico">◇</span><span><strong>Review lead quality</strong><small>Duplicate warnings, missing data and priorities</small></span></button>
              <button className="pf-action" onClick={()=>setTab("workflow")}><span className="pf-action-ico">◷</span><span><strong>Open action queue</strong><small>Manual next steps and reusable review filters</small></span></button>
            </div>
          </section>
          <section className="pf-card">
            <div className="pf-card-top"><div><h3 className="pf-card-title">Recent saved prospects</h3><p className="pf-card-sub">Records from your existing CRM</p></div><button className="pf-link" onClick={()=>openQualification(null)}>View all →</button></div>
            <MiniTable data={recent} onOpenCRM={onOpenCRM} limit={4}/>
          </section>
        </div>
        <p className="pf-footnote">Lead counts reflect CRM records. Directory listings and public contact details are not the same as verified decision-maker contacts.</p>
      </>}
      {tab==="discover" && <>
        <div className="pf-page-kicker">LIVE ORGANIZATION DISCOVERY</div><h1 className="pf-page-title">Find your next prospect</h1>
        <p className="pf-page-description">Search nonprofit and small-business sources by U.S. state, city, ZIP, industry or keyword. Save selected results to your CRM.</p>
        <section className="pf-finder-card"><NationwideFinder embedded baseUrl={baseUrl} requestHeaders={requestHeaders} crmData={crmData} onAddProspects={onAddProspects} canAdmin={canAdmin}/></section>
      </>}
      {tab==="integrations" && <>
        <div className="pf-page-kicker">CONNECT DATA SOURCES</div><h1 className="pf-page-title">API Integrations</h1>
        <p className="pf-page-description">Add or update optional API keys, see which providers are configured, and review free sources available for prospect discovery.</p>
        <div style={{marginTop:23}}><ApiIntegrations canAdmin={canAdmin} isConnected={dbStatus==="connected"} onLoad={onLoadApiCredentials} onSave={onSaveApiCredential} onOpenAdmin={onOpenAdmin} baseUrl={baseUrl} requestHeaders={requestHeaders}/></div>
      </>}
      {CLASSIC.includes(tab) && <div className="pf-classic">{classicViews}</div>}
      {tab==="admin" && renderAdmin && renderAdmin(()=>setTab("overview"))}
      {tab==="outreach" && <OutreachWorkspace crmData={crmData} canEdit={canEdit} onUpdateProspect={onUpdateProspect} onOpenCRM={onOpenCRM} initialProspectId={focusedOutreachId}/>}
      {tab==="tools" && <OutreachTools crmData={crmData} canEdit={canEdit} enabled={activityEnabled} onGetActivities={onGetActivities} onLogActivity={onLogActivity} onOpenCRM={onOpenCRM} initialProspectId={composeId}/>}
      {tab==="tasks" && <TeamTasks crmData={crmData} currentUser={currentUser} canEdit={canEdit} canAdmin={canAdmin} enabled={tasksEnabled} onGetTasks={onGetTasks} onGetTaskMembers={onGetTaskMembers} onCreateTask={onCreateTask} onUpdateTask={onUpdateTask} onOpenCRM={onOpenCRM} initialTaskDraft={taskDraft} initialTaskId={focusedTaskId}/>}
      {tab==="notifications" && <TaskNotifications currentUser={currentUser} canAdmin={canAdmin} enabled={tasksEnabled} onGetTasks={onGetTasks} onOpenTask={id=>{setFocusedTaskId(id);setTaskDraft(null);setTab("tasks");}}/>}
      {tab==="analytics" && <AnalyticsWorkspace crmData={crmData} enabled={tasksEnabled} onGetTasks={onGetTasks} onOpenOutreach={()=>setTab("outreach")} onOpenTasks={()=>setTab("tasks")}/> }
      {tab==="quality" && <QualityReviewWorkspace crmData={crmData} onOpenProspect={openQualification} onOpenCRM={onOpenCRM}/>}
      {tab==="workflow" && <WorkflowWorkspace crmData={crmData} currentUser={currentUser} canEdit={canEdit} canAdmin={canAdmin} tasksEnabled={tasksEnabled} savedApi={savedApi} onGetTasks={onGetTasks} onOpenTask={id=>{setFocusedTaskId(id);setTaskDraft(null);setTab("tasks");}} onOpenProspect={openQualification} onOpenQuality={()=>setTab("quality")} onOpenOutreach={id=>{setFocusedOutreachId(id);setTab("outreach");}} onPrepareTask={item=>{setFocusedTaskId(null);setTaskDraft({prospectId:item.id,taskTitle:item.taskTitle,description:item.why,priority:["Immediate review","Overdue","Due today"].includes(item.bucket)?"high":"normal"});setTab("tasks");}}/>}
      </div>
    </main>
  </div>;
}
