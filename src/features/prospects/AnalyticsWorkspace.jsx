import React, { useEffect, useMemo, useState } from "react";
import { ANALYTICS_CATEGORIES, analyticsCsv, analyticsSnapshot, filterAnalyticsLeads } from "../../lib/analytics.js";
import { localDateKey } from "../../lib/outreachPlanning.js";

const card={background:"#FFFFFF",border:"1px solid #E5EAF4",borderRadius:16,padding:21,minWidth:0};
const muted="#71809B";
const input={padding:"10px 12px",border:"1px solid #DDE4F0",borderRadius:10,fontSize:12,color:"#21314C",background:"white",minWidth:155,maxWidth:"100%"};
const heading={fontSize:15,fontWeight:800,margin:"0 0 6px",color:"#1B2944"};
const detail={fontSize:11,color:muted,lineHeight:1.55,margin:"0 0 18px"};
const palette=["#6658DB","#9F8AEC","#37A98E","#6C96D6","#EDA85E","#D7809C"];

function SummaryMetric({label,value,note,accent}) {
 return <div style={{...card,padding:"19px 20px"}}>
  <div style={{fontSize:11,fontWeight:700,color:muted}}>{label}</div>
  <div style={{fontSize:28,fontWeight:850,letterSpacing:"-1px",margin:"11px 0 5px",color:accent||"#1A2945"}}>{value}</div>
  <div style={{fontSize:10,color:"#8995AA",lineHeight:1.5}}>{note}</div>
 </div>;
}
function Breakdown({title,subtitle,rows,total,max=10}) {
 const limited=rows.slice(0,max);
 return <section style={card}>
  <h2 style={heading}>{title}</h2><p style={detail}>{subtitle}</p>
  {limited.length?limited.map((item,index)=><div key={item.label} style={{marginBottom:15}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"baseline",marginBottom:6,fontSize:11,color:"#364862"}}>
     <span style={{overflowWrap:"anywhere"}}>{item.label}</span><strong>{item.count.toLocaleString()} · {total?Math.round(item.count/total*100):0}%</strong>
    </div>
    <div style={{height:8,background:"#EEF1F8",borderRadius:8,overflow:"hidden"}}>
     <div style={{height:"100%",background:palette[index%palette.length],width:(total?100*item.count/total:0)+"%",borderRadius:8}}/>
    </div>
   </div>):<p style={{color:muted,fontSize:12}}>No matching CRM records.</p>}
  {rows.length>max&&<p style={{...detail,margin:0}}>Showing top {max} of {rows.length}. The CSV includes all categories.</p>}
 </section>;
}
function downloadCsv(content){
 const blob=new Blob([content],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 const link=document.createElement("a");
 link.href=url;link.download="prospectfinder-analytics-"+localDateKey()+".csv";
 document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}

export default function AnalyticsWorkspace({crmData=[],enabled=false,onGetTasks,onOpenOutreach,onOpenTasks}){
 const [category,setCategory]=useState("All organizations");
 const [source,setSource]=useState("All sources");
 const [visibleTasks,setVisibleTasks]=useState(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [lastLoaded,setLastLoaded]=useState("");
 const asOf=localDateKey();
 const sources=useMemo(()=>["All sources",...new Set(crmData.map(p=>String(p.sourceType||"Unknown source").trim()||"Unknown source").sort())],[crmData]);
 const filtered=useMemo(()=>filterAnalyticsLeads(crmData,{category,source}),[crmData,category,source]);
 const snapshot=useMemo(()=>analyticsSnapshot(filtered,visibleTasks,asOf),[filtered,visibleTasks,asOf]);
 const refresh=async()=>{
  if(!enabled||typeof onGetTasks!=="function")return;
  setLoading(true);setError("");
  try {
   const rows=await onGetTasks();
   if(!Array.isArray(rows))throw new Error("Unexpected task response");
   setVisibleTasks(rows);setLastLoaded(new Date().toLocaleTimeString());
  } catch(e){setVisibleTasks(null);setError("Could not load visible team tasks. CRM lead analytics are still available.");}
  finally{setLoading(false);}
 };
 useEffect(()=>{
  if(!enabled||typeof onGetTasks!=="function"){setVisibleTasks(null);return;}
  let active=true;
  setLoading(true);setError("");setVisibleTasks(null);
  Promise.resolve().then(()=>onGetTasks()).then(rows=>{
   if(!active)return;
   if(!Array.isArray(rows))throw new Error("Unexpected task response");
   setVisibleTasks(rows);setLastLoaded(new Date().toLocaleTimeString());
  }).catch(()=>{if(active){setVisibleTasks(null);setError("Could not load visible team tasks. CRM lead analytics are still available.");}})
    .finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[enabled,onGetTasks]);
 const exportCsv=()=>downloadCsv(analyticsCsv(snapshot,{category,source,asOf}));
 const tiles=[
  ["Saved prospects",snapshot.total.toLocaleString(),"Current filtered CRM records"],
  ["Contact details listed",snapshot.contactListed.toLocaleString(),snapshot.contactCoveragePct+"% have an email or phone"],
  ["Touches logged",snapshot.touchLogged.toLocaleString(),"Recorded touch dates or sent-stage labels"],
  ["Replies flagged",snapshot.replies.toLocaleString(),"Reply status or reply checkbox"],
  ["Converted",snapshot.converted.toLocaleString(),snapshot.conversionSharePct+"% of saved prospects"],
  ["Follow-ups due",snapshot.dueNow.toLocaleString(),"Today or overdue · excludes approvals"]
 ];
 return <div>
  <div className="pf-page-kicker">PHASE 6 · CRM ANALYTICS</div>
  <h1 className="pf-page-title">Performance & pipeline dashboard</h1>
  <p className="pf-page-description">Understand your saved prospects, outreach stages, contact coverage and deadlines from current CRM records. All figures update when prospect data changes.</p>
  <section style={{...card,margin:"22px 0 17px",display:"flex",gap:12,alignItems:"end",flexWrap:"wrap"}}>
   <label style={{display:"grid",gap:6,fontSize:11,fontWeight:700,color:"#5B6D88"}}>Organization type
    <select style={input} value={category} onChange={e=>setCategory(e.target.value)}>
     {ANALYTICS_CATEGORIES.map(x=><option key={x} value={x}>{x==="Business / Other"?"Small businesses / Other":x}</option>)}
    </select>
   </label>
   <label style={{display:"grid",gap:6,fontSize:11,fontWeight:700,color:"#5B6D88"}}>Discovery source
    <select style={input} value={source} onChange={e=>setSource(e.target.value)}>
     {sources.map(x=><option key={x} value={x}>{x}</option>)}
    </select>
   </label>
   <button className="pf-button outline" onClick={()=>{setCategory("All organizations");setSource("All sources");}}>Reset filters</button>
   <div style={{flex:1}}/>
   <button className="pf-button" onClick={exportCsv} aria-label="Download current analytics report as CSV">↓ Export report CSV</button>
  </section>
  <p style={{...detail,margin:"0 0 15px"}}>As of {asOf} · {snapshot.total.toLocaleString()} of {crmData.length.toLocaleString()} visible prospect records. Filters apply to all charts, follow-ups and linked task counts.</p>
  <section aria-label="Prospect analytics summary" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:12,marginBottom:19}}>
   {tiles.map(([label,value,note])=><SummaryMetric key={label} label={label} value={value} note={note}/>)}
  </section>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))",gap:16,marginBottom:17}}>
   <Breakdown title="Pipeline stages" subtitle="Current status of saved prospects" rows={snapshot.statusRows} total={snapshot.total}/>
   <Breakdown title="Organization mix" subtitle="Nonprofit and business segmentation" rows={snapshot.categoryRows} total={snapshot.total}/>
   <Breakdown title="Contact readiness" subtitle="Listed details are not independently verified" rows={snapshot.readinessRows} total={snapshot.total}/>
   <Breakdown title="Discovery sources" subtitle="Where saved records originally came from" rows={snapshot.sourceRows} total={snapshot.total}/>
  </div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:16}}>
   <section style={card}>
    <div style={{display:"flex",justifyContent:"space-between",gap:9,alignItems:"start"}}><div><h2 style={heading}>Upcoming follow-ups</h2><p style={detail}>Sorted by urgency from the existing outreach queue</p></div><button className="pf-link" onClick={onOpenOutreach}>Open outreach →</button></div>
    {snapshot.queue.length?snapshot.queue.slice(0,6).map((item,index)=><div key={String(item.id||index)} style={{display:"flex",justifyContent:"space-between",gap:12,borderBottom:"1px solid #EFF2F8",padding:"10px 0",fontSize:11}}>
     <span style={{fontWeight:720,color:"#30415C",overflowWrap:"anywhere"}}>{item.companyName}</span>
     <span style={{flexShrink:0,color:item.bucket==="Overdue"?"#B34B54":"#7564BE"}}>{item.bucket}{item.dueDate?" · "+item.dueDate:""}</span>
    </div>):<p style={{fontSize:12,color:muted}}>No follow-ups are scheduled in this selection.</p>}
    {snapshot.queue.length>6&&<p style={{...detail,marginTop:12}}>{snapshot.queue.length-6} additional follow-up(s) in Outreach.</p>}
   </section>
   <section style={card}>
    <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"start"}}><div><h2 style={heading}>Visible team tasks</h2><p style={detail}>Only tasks allowed by your CRM permissions and linked to selected prospects</p></div><button className="pf-link" onClick={onOpenTasks}>Open tasks →</button></div>
    {!enabled?<p style={{fontSize:12,color:muted}}>Connect your CRM to see assigned task statistics.</p>:
     <>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>
       <SummaryMetric label="Tasks visible" value={loading?"…":snapshot.taskCounts?.All??"—"} note="Not a company-wide total"/>
       <SummaryMetric label="Due now" value={loading?"…":snapshot.taskDueNow??"—"} note="Due today or overdue"/>
       <SummaryMetric label="Completed" value={loading?"…":snapshot.taskCounts?.Completed??"—"} note="Current completed status"/>
      </div>
      {error&&<p role="alert" style={{fontSize:11,color:"#B04A54"}}>{error}</p>}
      {lastLoaded&&!error&&<p style={{fontSize:11,color:muted}}>Last task refresh: {lastLoaded}</p>}
      <button disabled={loading} onClick={refresh} className="pf-button outline">{loading?"Refreshing…":"↻ Refresh tasks"}</button>
     </>}
   </section>
  </div>
  <p className="pf-footnote">Analytics are point-in-time counts, not historical trends or independently audited performance. No messages are sent and no prospect or task records are changed by this dashboard. The export contains aggregate counts only.</p>
 </div>;
}
