import React, { useMemo, useState } from "react";
import NationwideFinder from "./NationwideFinder.jsx";

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
  ".pf-root{--pf-ink:#15213A;--pf-muted:#71809B;--pf-primary:#6454E8;--pf-border:#E8ECF4;--pf-canvas:#F5F7FC;display:flex;min-height:100vh;background:var(--pf-canvas);color:var(--pf-ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;}",
  ".pf-root *{box-sizing:border-box}.pf-root button,.pf-root select,.pf-root input{font-family:inherit}.pf-root button{cursor:pointer}",
  ".pf-side{width:244px;flex:none;background:#101C36;color:#C7D2E8;min-height:100vh;position:sticky;top:0;align-self:flex-start;display:flex;flex-direction:column;padding:25px 16px 18px}",
  ".pf-brand{display:flex;gap:11px;align-items:center;padding:2px 9px 27px}.pf-mark{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(140deg,#9E8EFF,#6354E8);color:white;font-weight:900;font-size:21px;box-shadow:0 7px 20px #6255dd55}.pf-brand-name{font-size:18px;font-weight:820;color:white;letter-spacing:-.65px}.pf-brand-sub{font-size:10px;color:#99A9C8;letter-spacing:.09em;text-transform:uppercase;margin-top:2px}",
  ".pf-navhint{font-size:10px;text-transform:uppercase;font-weight:800;letter-spacing:1.6px;color:#7183A5;margin:10px 13px 11px}",
  ".pf-navbtn{border:0;background:transparent;color:#AFC1DD;width:100%;display:flex;align-items:center;text-align:left;gap:13px;padding:13px 14px;border-radius:11px;font-size:13px;font-weight:640;margin:1px 0}",
  ".pf-navbtn:hover{background:#243452;color:#fff}.pf-navbtn.active{background:#6557DD;color:white;box-shadow:0 8px 22px #6557dd30}.pf-ico{width:23px;text-align:center;font-size:17px}",
  ".pf-side-bottom{margin-top:auto;border-top:1px solid #2A3750;padding-top:16px}.pf-user{display:flex;gap:10px;align-items:center;background:#1A2945;border:1px solid #2C3D60;border-radius:13px;padding:11px;margin-top:15px}.pf-avatar{width:34px;height:34px;border-radius:10px;background:#DEDCFF;color:#5949BC;display:grid;place-items:center;font-weight:800}.pf-user-name{font-size:12px;font-weight:700;color:#EFF3FB;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:136px}.pf-user-sub{font-size:10px;color:#91A4C7}",
  ".pf-main{flex:1;min-width:0}.pf-header{height:80px;background:#fff;border-bottom:1px solid var(--pf-border);display:flex;align-items:center;justify-content:space-between;padding:0 34px;gap:15px}.pf-breadcrumb{font-size:12px;color:var(--pf-muted);font-weight:600}.pf-header strong{font-size:14px;color:#1C2841}.pf-pill{border:1px solid #DFE7F3;padding:8px 12px;border-radius:100px;color:#5B6880;font-size:11px;font-weight:750;background:#F8F9FC}.pf-online{width:7px;height:7px;background:#25C69A;display:inline-block;border-radius:50%;margin-right:6px}.pf-content{padding:33px 36px 60px;max-width:1500px;margin:0 auto}",
  ".pf-page-kicker{font-weight:850;color:#6755E9;letter-spacing:1.7px;font-size:10px;text-transform:uppercase}.pf-page-title{font-size:32px;line-height:1.16;font-weight:860;letter-spacing:-1.4px;margin:9px 0 8px}.pf-page-description{color:var(--pf-muted);font-size:13px;line-height:1.6;margin:0}",
  ".pf-hero{margin-top:24px;background:linear-gradient(112deg,#4F42CE 0%,#6F60EC 55%,#8C79F0 100%);color:white;min-height:225px;border-radius:21px;position:relative;overflow:hidden;display:flex;align-items:center;padding:35px 42px;box-shadow:0 16px 30px #6557dd1e}.pf-hero:before{content:'';position:absolute;width:420px;height:420px;border:1px solid #ffffff25;border-radius:50%;right:-90px;top:-125px}.pf-hero:after{content:'';position:absolute;width:270px;height:270px;border:1px solid #ffffff45;border-radius:50%;right:40px;top:80px}.pf-hero>*{z-index:1;position:relative}.pf-hero-head{font-size:29px;line-height:1.18;letter-spacing:-1.1px;font-weight:840;max-width:500px;margin:7px 0}.pf-hero-sub{font-size:12px;color:#E5E0FF;max-width:410px;line-height:1.7;margin:11px 0 20px}.pf-hero-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:2px;font-weight:800;color:#D7D0FF}",
  ".pf-button{border:0;background:var(--pf-primary);color:white;border-radius:11px;padding:12px 17px;font-weight:760;font-size:12px;display:inline-flex;align-items:center;gap:8px;justify-content:center;box-shadow:0 8px 20px #6454e828}.pf-button:hover{filter:brightness(.96)}.pf-button.white{background:white;color:#5143C9;box-shadow:none}.pf-button.outline{background:#fff;color:#485674;border:1px solid var(--pf-border);box-shadow:none}",
  ".pf-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px;margin-top:22px}.pf-metric{background:white;border:1px solid var(--pf-border);border-radius:15px;padding:19px 20px;min-height:118px}.pf-metric-top{display:flex;align-items:center;justify-content:space-between}.pf-metric-ico{width:35px;height:35px;border-radius:10px;display:grid;place-items:center;background:#F0ECFF;color:#6557DD;font-size:17px}.pf-metric-label{color:var(--pf-muted);font-weight:690;font-size:11px}.pf-metric-num{margin:13px 0 1px;font-weight:860;font-size:28px;letter-spacing:-1px;line-height:1.1}.pf-metric-foot{color:#8793A8;font-size:10px;margin-top:7px}",
  ".pf-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(270px,1fr);gap:20px;margin-top:23px}.pf-card{background:white;border:1px solid var(--pf-border);border-radius:16px;padding:22px;min-width:0}.pf-card-title{font-size:14px;font-weight:830;letter-spacing:-.3px;margin:0}.pf-card-sub{font-size:11px;color:var(--pf-muted);margin:7px 0 0}.pf-card-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.pf-link{border:0;background:transparent;color:var(--pf-primary);font-weight:800;font-size:11px;padding:5px}.pf-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:21px}.pf-action{border:1px solid #E5E7F2;border-radius:13px;background:#FBFCFF;padding:18px;display:flex;gap:10px;text-align:left;align-items:center;min-height:88px}.pf-action:hover{border-color:#8174EF;background:#F5F2FF}.pf-action-ico{width:43px;height:43px;flex:none;border-radius:12px;background:#EDEBFF;display:grid;place-items:center;font-size:20px}.pf-action strong{display:block;font-size:12px}.pf-action small{display:block;color:var(--pf-muted);font-size:10px;margin-top:4px;line-height:1.4}",
  ".pf-recent{width:100%;border-collapse:collapse;margin-top:15px}.pf-recent th{text-align:left;color:#8390A6;font-size:10px;letter-spacing:.3px;padding:13px 9px;border-bottom:1px solid var(--pf-border);font-weight:750}.pf-recent td{font-size:11px;padding:14px 9px;border-bottom:1px solid #F1F3F8;color:#394860}.pf-recent tr:last-child td{border-bottom:0}.pf-name{font-weight:790;color:#1B2944}.pf-tag{font-size:9px;padding:5px 8px;border-radius:50px;display:inline-block;background:#F0F1F7;color:#637187;font-weight:750}.pf-tag.green{background:#DDF9ED;color:#0D8C6B}.pf-tag.blue{background:#E7EFFF;color:#3869CD}.pf-tag.red{background:#FFEBED;color:#C74758}.pf-empty{text-align:center;padding:30px 15px;color:#8793A8;font-size:12px;line-height:1.7}",
  ".pf-searchline{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.pf-searchline input{padding:12px 13px;border:1px solid #E0E6F0;border-radius:10px;flex:1;min-width:200px;background:white;color:#253653;font-size:12px}.pf-finder-card{margin-top:23px}.pf-finder-card .pf-native-search input,.pf-finder-card .pf-native-search select{background:#fff!important;color:#22314C!important;border:1px solid #DEE4F0!important;border-radius:9px!important}.pf-finder-card .pf-native-search label{color:#53627D!important}.pf-finder-card button:disabled{opacity:.55;cursor:not-allowed}.pf-footnote{font-size:11px;color:#8190AB;margin-top:22px}",
  "@media(max-width:1080px){.pf-metrics{grid-template-columns:repeat(2,1fr)}.pf-layout{grid-template-columns:1fr}.pf-side{width:205px}.pf-content{padding:25px}}",
  "@media(max-width:720px){.pf-root{display:block}.pf-side{position:relative;width:100%;min-height:auto;padding:10px 12px;flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap}.pf-brand{padding:4px 7px}.pf-brand-sub,.pf-navhint,.pf-side-bottom{display:none}.pf-side nav{display:flex;flex-wrap:wrap;gap:4px}.pf-navbtn{width:auto;padding:9px 11px;font-size:11px;gap:5px}.pf-ico{width:auto}.pf-header{height:57px;padding:0 18px}.pf-header .pf-pill{display:none}.pf-content{padding:20px 14px 48px}.pf-page-title{font-size:25px}.pf-hero{padding:25px;min-height:205px}.pf-hero-head{font-size:24px}.pf-metrics{grid-template-columns:repeat(2,1fr);gap:9px}.pf-metric{padding:14px}.pf-metric-num{font-size:23px}.pf-actions{grid-template-columns:1fr}.pf-card{padding:17px}}"
].join("\n");

function MiniTable({ data, onOpenCRM, limit = 5 }) {
  const items = data.slice(0, limit);
  return <div style={{overflowX:"auto"}}>
    <table className="pf-recent">
      <thead><tr><th>ORGANIZATION</th><th>LOCATION</th><th>STATUS</th></tr></thead>
      <tbody>{items.map((p,i)=><tr key={p.id || i}>
        <td><span className="pf-name">{text(p.companyName) || "Unnamed prospect"}</span><div style={{color:"#95A1B5",fontSize:10,marginTop:4}}>{text(p.vertical) || "Uncategorized"}</div></td>
        <td>{text(p.cityMarket || p.market) || "Not listed"}</td>
        <td><span className={"pf-tag " + statusTone(p.currentStatus)}>{statusName(p.currentStatus)}</span></td>
      </tr>)}</tbody>
    </table>
    {!items.length && <div className="pf-empty">No saved prospects yet. Discover organizations and save them to start building your pipeline.</div>}
    {items.length > 0 && <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}><button className="pf-link" onClick={onOpenCRM}>Manage all in CRM →</button></div>}
  </div>;
}

export default function ProspectHome({ crmData = [], currentUser, onOpenCRM, onOpenAdmin, onLogout, onAddProspects, baseUrl, requestHeaders, dbStatus, canAdmin }) {
  const [tab, setTab] = useState("overview");
  const [term, setTerm] = useState("");
  const nonprofitCount = useMemo(() => crmData.filter(p => nonprofitPattern.test(text(p.vertical))).length, [crmData]);
  const smallCount = Math.max(0, crmData.length - nonprofitCount);
  const fresh = crmData.filter(p => statusName(p.currentStatus).toUpperCase() === "NEW").length;
  const contacted = crmData.filter(p => /T1 SENT|T2 SENT|T3 SENT|CONTACTED|FOLLOW.UP/i.test(statusName(p.currentStatus))).length;
  const recent = [...crmData].reverse();
  const filtered = recent.filter(p => [p.companyName,p.vertical,p.cityMarket,p.market,p.emailPhone].some(v => text(v).toLowerCase().includes(term.toLowerCase())));
  const nav = [
    ["overview","◈","Overview"],["discover","⌕","Find Prospects"],["leads","▤","Saved Prospects"],["crm","▦","Classic CRM"]
  ];
  const toTab = id => id==="crm" ? onOpenCRM() : setTab(id);
  const name = text(currentUser?.name || currentUser?.username || "Team Member");
  return <div className="pf-root">
    <style>{css}</style>
    <aside className="pf-side">
      <div className="pf-brand"><span className="pf-mark">P</span><div><div className="pf-brand-name">ProspectFinder</div><div className="pf-brand-sub">Discovery workspace</div></div></div>
      <p className="pf-navhint">WORKSPACE</p>
      <nav aria-label="ProspectFinder navigation">{nav.map(([id,ico,label]) => <button key={id} className={"pf-navbtn " + (tab===id?"active":"")} onClick={()=>toTab(id)}><span className="pf-ico">{ico}</span>{label}</button>)}</nav>
      <div className="pf-side-bottom">
        <button className="pf-navbtn" onClick={onOpenCRM}><span className="pf-ico">↗</span>Lead management</button>
        {canAdmin && <button className="pf-navbtn" onClick={onOpenAdmin}><span className="pf-ico">⚙</span>Admin settings</button>}
        <button className="pf-navbtn" onClick={onLogout}><span className="pf-ico">⇥</span>Sign out</button>
        <div className="pf-user"><div className="pf-avatar">{name.charAt(0).toUpperCase()}</div><div><div className="pf-user-name">{name}</div><div className="pf-user-sub">CRM account</div></div></div>
      </div>
    </aside>
    <main className="pf-main">
      <header className="pf-header"><div><div className="pf-breadcrumb">Workspace / {tab==="overview"?"Overview":tab==="discover"?"Find Prospects":"Saved Prospects"}</div><strong>United States prospect discovery</strong></div><div className="pf-pill"><span className="pf-online"/>{dbStatus==="connected"?"CRM Connected":dbStatus==="local"?"Demo Mode":"CRM "+(dbStatus||"Status")}</div></header>
      <div className="pf-content">
      {tab==="overview" && <>
        <div className="pf-page-kicker">YOUR PROSPECTING COMMAND CENTER</div>
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
              <button className="pf-action" onClick={()=>setTab("leads")}><span className="pf-action-ico">▤</span><span><strong>Review saved leads</strong><small>{fresh} prospects currently marked new</small></span></button>
              <button className="pf-action" onClick={onOpenCRM}><span className="pf-action-ico">↗</span><span><strong>Manage outreach</strong><small>Open your existing CRM pipeline</small></span></button>
            </div>
          </section>
          <section className="pf-card">
            <div className="pf-card-top"><div><h3 className="pf-card-title">Recent saved prospects</h3><p className="pf-card-sub">Records from your existing CRM</p></div><button className="pf-link" onClick={()=>setTab("leads")}>View all →</button></div>
            <MiniTable data={recent} onOpenCRM={onOpenCRM} limit={4}/>
          </section>
        </div>
        <p className="pf-footnote">Lead counts reflect CRM records. Directory listings and public contact details are not the same as verified decision-maker contacts.</p>
      </>}
      {tab==="discover" && <>
        <div className="pf-page-kicker">LIVE ORGANIZATION DISCOVERY</div><h1 className="pf-page-title">Find your next prospect</h1>
        <p className="pf-page-description">Search nonprofit and small-business sources by U.S. state, city, ZIP, industry or keyword. Save selected results to your CRM.</p>
        <section className="pf-finder-card"><NationwideFinder embedded baseUrl={baseUrl} requestHeaders={requestHeaders} crmData={crmData} onAddProspects={onAddProspects}/></section>
      </>}
      {tab==="leads" && <>
        <div className="pf-page-kicker">YOUR CRM DATABASE</div><h1 className="pf-page-title">Saved prospects</h1>
        <p className="pf-page-description">A quick overview of your existing leads. For editing, verification, exports and outreach, open the classic CRM.</p>
        <div className="pf-searchline"><input aria-label="Filter saved prospects" placeholder="Search saved organizations by name, category, location or contact…" value={term} onChange={e=>setTerm(e.target.value)}/><button className="pf-button" onClick={onOpenCRM}>↗ Open lead management</button></div>
        <section className="pf-card"><div className="pf-card-top"><h3 className="pf-card-title">{filtered.length} saved prospects</h3><button className="pf-link" onClick={()=>setTab("discover")}>+ Discover more</button></div><MiniTable data={filtered} onOpenCRM={onOpenCRM} limit={50}/></section>
      </>}
      </div>
    </main>
  </div>;
}
