import React,{useMemo,useState} from "react";
import {useSavedSearches,localSavedApi} from "../useSavedSearches.js";
import {buildWorkflowQueue,filterWorkflowQueue,workflowCounts,workflowCsv,normalizeWorkflowView,
 WORKFLOW_CATEGORIES,WORKFLOW_BUCKETS,validatePresetName} from "../../lib/workflowPlanning.js";
import {localDateKey} from "../../lib/outreachPlanning.js";

const card={background:"#fff",border:"1px solid #E5EAF4",borderRadius:15,padding:17,minWidth:0};
const field={width:"100%",border:"1px solid #DEE5F0",borderRadius:9,padding:"10px 11px",fontSize:12,color:"#23324C",background:"#fff"};
const txt={fontSize:11,color:"#73829C"};
const secondary={border:"1px solid #DDE4EF",borderRadius:9,padding:"10px 13px",color:"#4E5E7E",background:"#fff",fontWeight:760,fontSize:12,cursor:"pointer"};
const primary={...secondary,color:"#fff",background:"#6454D9",border:0};
const label={fontSize:11,color:"#536581",fontWeight:760,display:"grid",gap:5};
const pill=bucket=>({
 display:"inline-block",fontSize:10,fontWeight:800,padding:"5px 9px",borderRadius:20,
 background:bucket==="Immediate review"?"#FFF0F0":bucket==="Overdue"?"#FFF2E4":bucket==="Due today"?"#F0EFFF":"#EAF2FB",
 color:bucket==="Immediate review"?"#AF4251":bucket==="Overdue"?"#A45A2A":bucket==="Due today"?"#6651B7":"#4D6385"
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
 crmData=[],currentUser={},canEdit=false,tasksEnabled=false,
 onOpenProspect,onOpenQuality,onOpenOutreach,onPrepareTask
}){
 const [query,setQuery]=useState(""),[category,setCategory]=useState("All organizations"),
  [bucket,setBucket]=useState("All actions"),[sort,setSort]=useState("urgency");
 const [presetName,setPresetName]=useState(""),[selectedPresetId,setSelectedPresetId]=useState("");
 const [error,setError]=useState(""),[success,setSuccess]=useState("");
 const [page,setPage]=useState(0);
 // Per-CRM-user browser-only preferences: no permission, schema, or API changes.
 const scope="phase8-workflow-"+String(currentUser?.id||currentUser?.username||"guest");
 const saved=useSavedSearches(scope,localSavedApi,{currentUser});
 const asOf=localDateKey();
 const actions=useMemo(()=>buildWorkflowQueue(crmData,asOf),[crmData,asOf]);
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
  setSuccess("Applied saved browser filter: "+record.name);
 };
 const savePreset=async()=>{
  clearMessages();
  try{
   const name=validatePresetName(presetName);
   if(saved.items.length>=30)throw new Error("Maximum 30 saved filters per browser account. Remove an unused filter first.");
   const row=await saved.save(name,normalizeWorkflowView(view),false);
   setSelectedPresetId(row.id);setPresetName("");
   setSuccess("Filter saved in this browser for your CRM account.");
  }catch(e){setError(e?.message||"Unable to save filter.");}
 };
 const deletePreset=async()=>{
  const record=saved.items.find(item=>item.id===selectedPresetId);
  if(!record)return;
  clearMessages();
  try{
   await saved.remove(record.id);setSelectedPresetId("");
   setSuccess("Saved browser filter deleted; current queue filters are unchanged.");
  }catch(e){setError(e?.message||"Could not remove filter.");}
 };
 const clearFilters=()=>{
  setQuery("");setCategory("All organizations");setBucket("All actions");setSort("urgency");
  setPage(0);setSelectedPresetId("");clearMessages();
 };
 return <div>
  <div className="pf-page-kicker">PHASE 8 · GUIDED WORKFLOWS</div>
  <h1 className="pf-page-title">Action queue & saved review filters</h1>
  <p className="pf-page-description">A suggested daily worklist from existing CRM evidence, follow-up dates and review flags. Choose an item to open its existing workspace or prepare a task draft. Nothing is sent, scheduled or saved automatically.</p>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10,margin:"22px 0 20px"}}>
   {presets.map(([name,value])=><button type="button" key={name} onClick={()=>setBucketFilter(value)}
    style={{...card,textAlign:"left",cursor:"pointer",borderColor:bucket===value?"#8575EA":"#E5EAF4",background:bucket===value?"#F7F5FF":"#fff"}}>
    <div style={{fontSize:11,color:"#78869C",fontWeight:720}}>{name}</div>
    <div style={{fontSize:25,color:"#243250",fontWeight:840,marginTop:5}}>{(counts[value]||0).toLocaleString()}</div>
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
   <div style={{borderTop:"1px solid #EEF1F7",paddingTop:13,display:"flex",gap:10,alignItems:"end",flexWrap:"wrap"}}>
    <label style={{...label,flex:"1 1 175px"}}>Saved browser filters
     <select style={field} value={selectedPresetId} onChange={e=>choosePreset(e.target.value)}>
      <option value="">Choose a saved filter…</option>
      {saved.items.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
     </select>
    </label>
    <button type="button" style={secondary} disabled={!selectedPresetId} onClick={deletePreset}>Delete selected</button>
    <label style={{...label,flex:"1 1 160px"}}>Name this filter
     <input style={field} value={presetName} maxLength={80} placeholder="e.g. Daily nonprofit review" onChange={e=>setPresetName(e.target.value)}/>
    </label>
    <button type="button" style={primary} onClick={savePreset}>Save filter</button>
    <button type="button" style={secondary} onClick={clearFilters}>Reset</button>
   </div>
   <div style={{...txt,lineHeight:1.5}}>Filters are saved per CRM user <strong>in this browser only</strong>; they do not sync across devices or change shared CRM records.</div>
   {saved.error&&<div role="alert" style={{fontSize:11,color:"#AF4444"}}>{saved.error}</div>}
   {error&&<div role="alert" style={{fontSize:11,color:"#AF4444"}}>{error}</div>}
   {success&&<div role="status" style={{fontSize:11,color:"#24795B"}}>{success}</div>}
  </section>
  <section style={{...card,marginBottom:17}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:13,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
    <div><h2 style={{margin:0,fontSize:15,color:"#1F2E49"}}>Suggested manual actions</h2>
      <p style={{...txt,margin:"6px 0 0"}}>{visibleActions.length.toLocaleString()} matching of {actions.length.toLocaleString()} active records · As of {asOf}</p></div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <button type="button" style={secondary} onClick={onOpenQuality}>Review quality issues</button>
      <button type="button" style={primary} onClick={()=>saveCsv(visibleActions,asOf)}>↓ Export worklist CSV</button>
    </div>
   </div>
   <div style={{overflowX:"auto"}}>
    <table className="pf-recent" style={{width:"100%",minWidth:760}}>
     <thead><tr><th>ORGANIZATION</th><th>QUEUE</th><th>RECOMMENDED NEXT STEP</th><th>WHEN</th><th>HANDOFF</th></tr></thead>
     <tbody>{shown.map(item=><tr key={String(item.id)}>
      <td><strong className="pf-name" style={{overflowWrap:"anywhere"}}>{item.prospect.companyName||"Unnamed organization"}</strong>
        <div style={{...txt,marginTop:4}}>{item.category} · {item.prospect.currentStatus||"NEW"}</div></td>
      <td><span style={pill(item.bucket)}>{item.bucket}</span>
        <div style={{...txt,marginTop:5}}>{item.kind}</div></td>
      <td style={{maxWidth:320,fontSize:11,lineHeight:1.6,color:"#475C7A"}}>
       <strong style={{color:"#243653"}}>{item.action}</strong>
       <div style={{...txt,marginTop:4}}>{item.why}</div></td>
      <td style={{fontSize:11,color:"#54657E",whiteSpace:"nowrap"}}>{item.dueDate||"—"}</td>
      <td style={{minWidth:180}}>
       <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
        <button type="button" className="pf-link"
          onClick={()=>item.route==="outreach"?onOpenOutreach(item.id):item.route==="quality"?onOpenQuality():onOpenProspect(item.id)}>
          Open review →
        </button>
        {canEdit&&tasksEnabled&&<button type="button" style={{...secondary,padding:"7px 9px",fontSize:10}}
          onClick={()=>onPrepareTask(item)}>Draft task</button>}
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
  <p className="pf-footnote">This is a rule-based suggestion queue, not a verified compliance assessment or an automated campaign. Blocked and converted prospects are excluded. Task drafts must be reviewed and manually saved in Team Tasks; sending emails, merging duplicates and making status changes remain separate actions.</p>
 </div>;
}
