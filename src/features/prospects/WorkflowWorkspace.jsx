import React,{useEffect,useMemo,useState} from "react";
import {useSavedSearches,localSavedApi} from "../useSavedSearches.js";
import {groupVisibleTasks,visibleTaskSummary,canDeleteSharedView} from "../../lib/taskCoordination.js";
import {buildWorkflowQueue,filterWorkflowQueue,workflowCounts,workflowCsv,normalizeWorkflowView,
 WORKFLOW_CATEGORIES,WORKFLOW_BUCKETS,validatePresetName} from "../../lib/workflowPlanning.js";
import {localDateKey} from "../../lib/outreachPlanning.js";

const card={background:"var(--pf-bg-FFFFFF)",border:"1px solid var(--pf-bd-E5EAF4)",borderRadius:15,padding:17,minWidth:0};
const field={width:"100%",border:"1px solid var(--pf-bd-DEE5F0)",borderRadius:9,padding:"10px 11px",fontSize:12,color:"var(--pf-tx-23324C)",background:"var(--pf-bg-FFFFFF)"};
const txt={fontSize:11,color:"var(--pf-tx-73829C)"};
const secondary={border:"1px solid var(--pf-bd-DDE4EF)",borderRadius:9,padding:"10px 13px",color:"var(--pf-tx-4E5E7E)",background:"var(--pf-bg-FFFFFF)",fontWeight:760,fontSize:12,cursor:"pointer"};
const primary={...secondary,color:"#fff",background:"var(--pf-bg-6454D9)",border:0};
const label={fontSize:11,color:"var(--pf-tx-536581)",fontWeight:760,display:"grid",gap:5};
const pill=bucket=>({
 display:"inline-block",fontSize:10,fontWeight:800,padding:"5px 9px",borderRadius:20,
 background:bucket==="Immediate review"?"var(--pf-bg-FFF0F0)":bucket==="Overdue"?"var(--pf-bg-FFF2E4)":bucket==="Due today"?"var(--pf-bg-F0EFFF)":"var(--pf-bg-EAF2FB)",
 color:bucket==="Immediate review"?"var(--pf-tx-AF4251)":bucket==="Overdue"?"var(--pf-tx-A45A2A)":bucket==="Due today"?"var(--pf-tx-6651B7)":"var(--pf-tx-4D6385)"
});
const presets=[["All actions","All actions"],["Immediate review","Immediate review"],
 ["Overdue","Overdue"],["Due today","Due today"],["Research","Research"],["Upcoming","Upcoming"],["Ready","Ready"]];
function saveCsv(items,asOf){
 const csv=workflowCsv(items,asOf);
 const href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const link=document.createElement("a");link.href=href;link.download="prospectfinder-workflow-"+asOf+".csv";
 document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(href);
}
export default function WorkflowWorkspace({
 crmData=[],currentUser={},canEdit=false,canAdmin=false,tasksEnabled=false,
 savedApi=localSavedApi,onGetTasks,onOpenTask,
 onOpenProspect,onOpenQuality,onOpenOutreach,onPrepareTask
}){
 const [query,setQuery]=useState(""),[category,setCategory]=useState("All organizations"),
  [bucket,setBucket]=useState("All actions"),[sort,setSort]=useState("urgency");
 const [presetName,setPresetName]=useState(""),[selectedPresetId,setSelectedPresetId]=useState("");
 const [sharePreset,setSharePreset]=useState(false);
 const [visibleTasks,setVisibleTasks]=useState(null),[tasksLoading,setTasksLoading]=useState(false),[taskError,setTaskError]=useState("");
 const [tasksLoadedAt,setTasksLoadedAt]=useState("");
 const [error,setError]=useState(""),[success,setSuccess]=useState("");
 const [page,setPage]=useState(0);
 // Connected accounts save workflow views in the same RLS-protected team
 // store as the classic CRM. Demo mode keeps scoped browser-only views.
 const activeApi=savedApi||localSavedApi;
 const scope=activeApi.local?"phase9-workflow-"+String(currentUser?.id||currentUser?.username||"guest"):"workflow";
 const saved=useSavedSearches(scope,activeApi,{currentUser});
 const canSaveView=canEdit||!!activeApi.local;
 const selectedView=saved.items.find(item=>item.id===selectedPresetId);
 const canDeleteView=canSaveView&&canDeleteSharedView(selectedView,currentUser,canAdmin);
 useEffect(()=>{
  if(!tasksEnabled||typeof onGetTasks!=="function"){setVisibleTasks(null);return;}
  let active=true;setTasksLoading(true);setTaskError("");
  Promise.resolve().then(()=>onGetTasks()).then(rows=>{
   if(!active)return;
   if(!Array.isArray(rows))throw new Error("Invalid task response");
   setVisibleTasks(rows);setTasksLoadedAt(new Date().toLocaleTimeString());
  }).catch(()=>{if(active){setVisibleTasks(null);setTaskError("Visible tasks could not be loaded. The prospect worklist is still available.");}})
    .finally(()=>{if(active)setTasksLoading(false);});
  return ()=>{active=false;};
 },[tasksEnabled,onGetTasks]);
 const refreshTasks=async()=>{
  if(!tasksEnabled||typeof onGetTasks!=="function")return;
  setTasksLoading(true);setTaskError("");
  try{
   const rows=await onGetTasks();if(!Array.isArray(rows))throw new Error("Invalid task response");
   setVisibleTasks(rows);setTasksLoadedAt(new Date().toLocaleTimeString());
  }catch{setVisibleTasks(null);setTaskError("Visible tasks could not be loaded. Retry when CRM is connected.");}
  finally{setTasksLoading(false);}
 };
 const asOf=localDateKey();
 const actions=useMemo(()=>buildWorkflowQueue(crmData,asOf),[crmData,asOf]);
 const taskGroups=useMemo(()=>groupVisibleTasks(visibleTasks||[],asOf),[visibleTasks,asOf]);
 const taskStats=useMemo(()=>visibleTaskSummary(visibleTasks||[],asOf),[visibleTasks,asOf]);
 const counts=useMemo(()=>workflowCounts(actions),[actions]);
 const view={query,category,bucket,sort};
 const visibleActions=useMemo(()=>filterWorkflowQueue(actions,view),[actions,query,category,bucket,sort]);
 const pages=Math.max(1,Math.ceil(visibleActions.length/20)),currentPage=Math.min(page,pages-1);
 const shown=visibleActions.slice(currentPage*20,currentPage*20+20);
 const clearMessages=()=>{setError("");setSuccess("");};
 const setBucketFilter=value=>{setBucket(value);setSelectedPresetId("");setPage(0);clearMessages();};
 const choosePreset=id=>{
  setSelectedPresetId(id);setPage(0);clearMessages();
  if(!id)return;
  const record=saved.items.find(item=>item.id===id);
  if(!record)return;
  const view=normalizeWorkflowView(record.params);
  setQuery(view.query);setCategory(view.category);setBucket(view.bucket);setSort(view.sort);
  setSuccess("Applied saved filter: "+record.name);
 };
 const savePreset=async()=>{
  clearMessages();
  try{
   if(!canSaveView)throw new Error("Only CRM editors can create saved views.");
   const name=validatePresetName(presetName);
   if(saved.items.length>=30)throw new Error("Maximum 30 visible saved filters. Remove an unused filter first.");
   const row=await saved.save(name,normalizeWorkflowView(view),!activeApi.local&&sharePreset);
   setSelectedPresetId(row.id);setPresetName("");
   setSuccess(activeApi.local?"Filter saved privately in this browser.":sharePreset?"Shared filter saved to CRM for the team.":"Private filter saved to your CRM account.");
  }catch(e){setError(e?.message||"Unable to save filter.");}
 };
 const deletePreset=async()=>{
  const record=saved.items.find(item=>item.id===selectedPresetId);
  if(!record)return;
  clearMessages();
  if(!canDeleteView){setError("Only the filter creator or an administrator can delete it.");return;}
  try{
   await saved.remove(record.id);setSelectedPresetId("");
   setSuccess("Saved filter deleted; current queue filters are unchanged.");
  }catch(e){setError(e?.message||"Could not remove filter.");}
 };
 const clearFilters=()=>{
  setQuery("");setCategory("All organizations");setBucket("All actions");setSort("urgency");
  setPage(0);setSelectedPresetId("");clearMessages();
 };
 return <div>
  <div className="pf-page-kicker">PHASE 9 · SHARED TEAM WORKFLOWS</div>
  <h1 className="pf-page-title">Shared action queue & team coordination</h1>
  <p className="pf-page-description">Prioritize existing CRM records, reuse private or shared review views across devices, and see linked tasks your account can access. All actions still require a team member to review and save them.</p>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10,margin:"22px 0 20px"}}>
   {presets.map(([name,value])=><button type="button" key={name} onClick={()=>setBucketFilter(value)}
    style={{...card,textAlign:"left",cursor:"pointer",borderColor:bucket===value?"var(--pf-bd-8575EA)":"var(--pf-bd-E5EAF4)",background:bucket===value?"var(--pf-bg-F7F5FF)":"var(--pf-bg-FFFFFF)"}}>
    <div style={{fontSize:11,color:"var(--pf-tx-78869C)",fontWeight:720}}>{name}</div>
    <div style={{fontSize:25,color:"var(--pf-tx-243250)",fontWeight:840,marginTop:5}}>{(counts[value]||0).toLocaleString()}</div>
   </button>)}
  </div>
  <section style={{...card,marginBottom:15,display:"grid",gap:13}}>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10}}>
    <label style={label}>Search actions<input type="search" style={field} placeholder="Organization, city, type…" value={query}
      onChange={e=>{setQuery(e.target.value);setPage(0);setSelectedPresetId("");}}/></label>
    <label style={label}>Organization type<select style={field} value={category}
     onChange={e=>{setCategory(e.target.value);setPage(0);setSelectedPresetId("");}}>
      {WORKFLOW_CATEGORIES.map(x=><option key={x} value={x}>{x==="Business / Other"?"Small businesses / Other":x}</option>)}
    </select></label>
    <label style={label}>Action category<select style={field} value={bucket}
     onChange={e=>setBucketFilter(e.target.value)}>
      {WORKFLOW_BUCKETS.map(x=><option key={x}>{x}</option>)}
    </select></label>
    <label style={label}>Sort order<select style={field} value={sort}
     onChange={e=>{setSort(e.target.value);setPage(0);setSelectedPresetId("");}}>
      <option value="urgency">Most urgent first</option><option value="fit">Fit rubric first</option>
    </select></label>
   </div>
   <div style={{borderTop:"1px solid var(--pf-bd-EEF1F7)",paddingTop:13,display:"flex",gap:10,alignItems:"end",flexWrap:"wrap"}}>
    <label style={{...label,flex:"1 1 175px"}}>{activeApi.local?"Saved browser filters":"Private & shared CRM filters"}
     <select style={field} value={selectedPresetId} onChange={e=>choosePreset(e.target.value)}>
      <option value="">Choose a saved filter…</option>
      {saved.items.map(x=><option key={x.id} value={x.id}>{x.shared?"[Team] ":"[Private] "}{x.name}{x.createdByName?" · "+x.createdByName:""}</option>)}
     </select>
    </label>
    <button type="button" style={secondary} disabled={!selectedPresetId||!canDeleteView} onClick={deletePreset}>Delete selected</button>
    <label style={{...label,flex:"1 1 160px"}}>Name this filter
     <input style={field} value={presetName} maxLength={80} placeholder="e.g. Daily nonprofit review" onChange={e=>setPresetName(e.target.value)}/>
    </label>
    {!activeApi.local&&canSaveView&&<label style={{display:"inline-flex",alignItems:"center",gap:7,fontSize:11,color:"var(--pf-tx-566781)",fontWeight:740}}>
      <input type="checkbox" checked={sharePreset} onChange={e=>setSharePreset(e.target.checked)}/> Share with CRM team
    </label>}
    <button type="button" style={primary} disabled={!canSaveView||!presetName.trim()||saved.loading} onClick={savePreset}>Save filter</button>
    <button type="button" style={secondary} disabled={saved.loading} onClick={()=>saved.reload()}>{saved.loading?"Loading…":"Refresh views"}</button>
    <button type="button" style={secondary} onClick={clearFilters}>Reset</button>
   </div>
   <div style={{...txt,lineHeight:1.5}}>{activeApi.local
    ?"Demo mode: filters remain in this browser only. Connect CRM to sync across devices."
    :"Saved views sync through CRM. Team views can be opened by permitted teammates; private views stay visible only to their creator."}
    {!canSaveView&&!activeApi.local&&" Your CRM role can use shared views but cannot create or delete them."}</div>
   {saved.error&&<div role="alert" style={{fontSize:11,color:"var(--pf-tx-AF4444)"}}>{saved.error}</div>}
   {error&&<div role="alert" style={{fontSize:11,color:"var(--pf-tx-AF4444)"}}>{error}</div>}
   {success&&<div role="status" style={{fontSize:11,color:"var(--pf-tx-24795B)"}}>{success}</div>}
  </section>
  <section style={{...card,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",gap:13,flexWrap:"wrap"}}>
   <div>
    <h2 style={{fontSize:14,color:"var(--pf-tx-263653)",margin:0}}>Task coordination · only tasks visible to you</h2>
    {visibleTasks!==null?<p style={{...txt,margin:"6px 0 0"}}>{taskStats.active} active linked task(s) · {taskStats.dueNow} due today/overdue · {taskStats.linkedProspects} prospect(s)</p>
      :<p style={{...txt,margin:"6px 0 0"}}>{tasksLoading?"Loading your visible CRM tasks…":"Task totals unavailable; CRM prospect queue remains usable."}</p>}
    {tasksLoadedAt&&<div style={{...txt,marginTop:4}}>Last refreshed at {tasksLoadedAt} · Counts are not organization-wide totals.</div>}
    {taskError&&<div role="alert" style={{...txt,color:"var(--pf-tx-A83D4D)",marginTop:5}}>{taskError}</div>}
   </div>
   {tasksEnabled&&<button type="button" style={secondary} disabled={tasksLoading} onClick={refreshTasks}>{tasksLoading?"Refreshing…":"↻ Refresh visible tasks"}</button>}
  </section>
  <section style={{...card,marginBottom:17}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:13,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
    <div><h2 style={{margin:0,fontSize:15,color:"var(--pf-tx-1F2E49)"}}>Suggested manual actions</h2>
      <p style={{...txt,margin:"6px 0 0"}}>{visibleActions.length.toLocaleString()} matching of {actions.length.toLocaleString()} active records · As of {asOf}</p></div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <button type="button" style={secondary} onClick={onOpenQuality}>Review quality issues</button>
      <button type="button" style={primary} onClick={()=>saveCsv(visibleActions,asOf)}>↓ Export worklist CSV</button>
    </div>
   </div>
   <div style={{overflowX:"auto"}}>
    <table className="pf-recent" style={{width:"100%",minWidth:760}}>
     <thead><tr><th>ORGANIZATION</th><th>QUEUE</th><th>RECOMMENDED NEXT STEP</th><th>WHEN</th><th>VISIBLE TASKS</th><th>HANDOFF</th></tr></thead>
     <tbody>{shown.map(item=><tr key={String(item.id)}>
      <td><strong className="pf-name" style={{overflowWrap:"anywhere"}}>{item.prospect.companyName||"Unnamed organization"}</strong>
        <div style={{...txt,marginTop:4}}>{item.category} · {item.prospect.currentStatus||"NEW"}</div></td>
      <td><span style={pill(item.bucket)}>{item.bucket}</span>
        <div style={{...txt,marginTop:5}}>{item.kind}</div></td>
      <td style={{maxWidth:320,fontSize:11,lineHeight:1.6,color:"var(--pf-tx-475C7A)"}}>
       <strong style={{color:"var(--pf-tx-243653)"}}>{item.action}</strong>
       <div style={{...txt,marginTop:4}}>{item.why}</div></td>
      <td style={{fontSize:11,color:"var(--pf-tx-54657E)",whiteSpace:"nowrap"}}>{item.dueDate||"—"}</td>
      <td style={{fontSize:11,color:"var(--pf-tx-516481)",minWidth:145}}>
       {visibleTasks===null?"Not loaded":(taskGroups.get(String(item.id))||[]).length+" active visible"}
       {(taskGroups.get(String(item.id))||[]).slice(0,1).map(t=><div key={t.id} style={{marginTop:5}}>
        <button className="pf-link" onClick={()=>onOpenTask(t.id)} aria-label={"Open linked task for "+(item.prospect.companyName||"prospect")}>Open task ↗</button>
        <div style={{...txt,marginTop:3}}>{t.due_date||"No due date"} · {t.status}</div>
       </div>)}
      </td>
      <td style={{minWidth:180}}>
       <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
        <button type="button" className="pf-link"
          onClick={()=>item.route==="outreach"?onOpenOutreach(item.id):item.route==="quality"?onOpenQuality():onOpenProspect(item.id)}>
          Open review →
        </button>
        {canEdit&&tasksEnabled&&!(taskGroups.get(String(item.id))||[]).length&&<button type="button" style={{...secondary,padding:"7px 9px",fontSize:10}}
          onClick={()=>onPrepareTask(item)}>Draft task</button>}
        {canEdit&&tasksEnabled&&(taskGroups.get(String(item.id))||[]).length>0&&<span style={{...txt,fontSize:10}}>Review linked task before drafting another</span>}
       </div>
      </td>
     </tr>)}</tbody>
    </table>
    {!shown.length&&<div className="pf-empty">No actions match these filters. Clear filters or review your existing CRM data.</div>}
   </div>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",marginTop:14}}>
    <span style={txt}>Page {currentPage+1} of {pages}</span>
    <div style={{display:"flex",gap:7}}>
     <button type="button" style={secondary} disabled={currentPage===0} onClick={()=>setPage(x=>Math.max(0,x-1))}>Previous</button>
     <button type="button" style={secondary} disabled={currentPage>=pages-1} onClick={()=>setPage(x=>Math.min(pages-1,x+1))}>Next</button>
    </div>
   </div>
  </section>
  <p className="pf-footnote">This queue is rule-based decision support. Converted and do-not-contact prospects remain excluded. Linked tasks reflect only records visible under your CRM permissions; unlisted tasks may exist. Drafting or opening tasks does not send emails or change prospect status.</p>
 </div>;
}
