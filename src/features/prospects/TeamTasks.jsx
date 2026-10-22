import React,{useEffect,useMemo,useState} from "react";
import {TASK_PRIORITIES,TASK_STATUSES,filterTasks,summarizeTasks,taskBucket,validateTaskData} from "../../lib/prospectTasks.js";
import {localDateKey} from "../../lib/outreachPlanning.js";
import {taskProductivitySnapshot,taskProductivityCsv} from "../../lib/taskProductivity.js";

const box={background:"var(--pf-bg-FFFFFF)",border:"1px solid var(--pf-bd-E6EBF3)",borderRadius:15,padding:18};
const field={border:"1px solid var(--pf-bd-DCE2EE)",padding:"10px 11px",borderRadius:9,fontSize:12,color:"var(--pf-tx-243652)",width:"100%",background:"var(--pf-bg-FFFFFF)",minWidth:0};
const name={display:"grid",gap:5,fontSize:11,color:"var(--pf-tx-697993)",fontWeight:750};
const primary={border:0,borderRadius:9,padding:"10px 15px",background:"var(--pf-bg-6958DA)",color:"white",fontWeight:750,fontSize:12,cursor:"pointer"};
const secondary={...primary,background:"var(--pf-bg-EEF0FA)",color:"var(--pf-tx-4D4A82)",border:"1px solid var(--pf-bd-DEE1EE)"};
const buckets=["All","Overdue","Today","Next 7 days","Later","Unscheduled","Completed","Cancelled"];
const priorities={urgent:"var(--pf-bd-B24442)",high:"var(--pf-tx-AF721F)",normal:"var(--pf-tx-5266A0)",low:"var(--pf-tx-688173)"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function pretty(s){return String(s||"").replaceAll("_"," ").replace(/\b\w/g,x=>x.toUpperCase());}
function ownerName(members,id,myId){const found=members.find(x=>x.id===id);return found?.name||found?.username||(id===myId?"You":"Assigned CRM user");}
function niceDate(d){if(!d)return "No due date";const [y,m,day]=d.split("-").map(Number);return new Date(y,m-1,day).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});}
function downloadTaskReport(content){
 const blob=new Blob([content],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob),link=document.createElement("a");
 link.href=url;link.download="prospectfinder-task-workload-"+localDateKey()+".csv";
 document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
function TaskEditor({task,canEdit,onChange,onClose,members,canAdmin,myId}){
 const [title,setTitle]=useState(task.task_title),[description,setDescription]=useState(task.description||"");
 const [priority,setPriority]=useState(task.priority||"normal"),[status,setStatus]=useState(task.status||"open"),[dueDate,setDueDate]=useState(task.due_date||"");
 const [assignee,setAssignee]=useState(task.assigned_to);
 const [saving,setSaving]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 const editable=canEdit&&(canAdmin||task.assigned_to===myId);
 const save=async()=>{
  if(!editable||saving)return;
  setError("");setMessage("");
  let data;try{data=validateTaskData({task_title:title,description,priority,due_date:dueDate});}catch(e){setError(e.message);return;}
  setSaving(true);
  try{
   await onChange(task.id,{...data,status,...(canAdmin?{assigned_to:assignee}:{})});
   setMessage("Task updated in CRM.");
  }catch(e){setError(e?.message||"Unable to update task.");}
  finally{setSaving(false);}
 };
 return <aside style={{...box,position:"sticky",top:16,alignSelf:"start",display:"grid",gap:12}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:8}}>
   <div><div style={{fontSize:10,fontWeight:780,color:"var(--pf-tx-6755CF)"}}>TASK DETAILS</div><h3 style={{margin:"5px 0 0",fontSize:16,color:"var(--pf-tx-233452)"}}>{task.task_title}</h3></div>
   <button type="button" onClick={onClose} aria-label="Close task editor" style={{...secondary,padding:"5px 10px",fontSize:17}}>×</button>
  </div>
  <label style={name}>Task title<input style={field} value={title} maxLength={180} disabled={!editable||saving} onChange={e=>setTitle(e.target.value)}/></label>
  <label style={name}>Description<textarea style={{...field,minHeight:90,resize:"vertical"}} value={description} maxLength={3000} disabled={!editable||saving} onChange={e=>setDescription(e.target.value)}/></label>
  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
   <label style={name}>Due date<input type="date" style={field} value={dueDate} disabled={!editable||saving} onChange={e=>setDueDate(e.target.value)}/></label>
   <label style={name}>Priority<select style={field} value={priority} disabled={!editable||saving} onChange={e=>setPriority(e.target.value)}>
    {TASK_PRIORITIES.map(p=><option key={p} value={p}>{pretty(p)}</option>)}
   </select></label>
  </div>
  <label style={name}>Status<select style={field} value={status} disabled={!editable||saving} onChange={e=>setStatus(e.target.value)}>
   {TASK_STATUSES.map(s=><option key={s} value={s}>{pretty(s)}</option>)}
  </select></label>
  {canAdmin?<label style={name}>Assigned to<select style={field} value={assignee} disabled={saving} onChange={e=>setAssignee(e.target.value)}>
    {members.filter(m=>m.active&&m.role!=="viewer").map(m=><option key={m.id} value={m.id}>{m.name||m.username}</option>)}
    {!members.some(m=>m.id===assignee)&&<option value={assignee}>Existing assigned user</option>}
   </select></label>:<div style={{fontSize:11,color:"var(--pf-tx-687794)"}}>Assigned to {ownerName(members,assignee,myId)}. An administrator manages reassignment.</div>}
  {task.completed_at&&<div style={{fontSize:11,color:"var(--pf-tx-5C718C)"}}>Completed {new Date(task.completed_at).toLocaleString()}</div>}
  {error&&<p role="alert" style={{fontSize:11,color:"var(--pf-tx-A24545)",margin:0}}>{error}</p>}
  {message&&<p role="status" style={{fontSize:11,color:"var(--pf-tx-157A58)",margin:0}}>{message}</p>}
  {editable&&<button style={primary} disabled={saving} onClick={save}>{saving?"Saving…":"Save task changes"}</button>}
  {!editable&&<p style={{fontSize:11,color:"var(--pf-tx-748098)"}}>View-only. Only the assignee or an administrator can edit this task.</p>}
  <p style={{fontSize:10,color:"var(--pf-tx-8A96A8)",margin:0,lineHeight:1.6}}>Completing a task updates its task status only. It does not send outreach or modify the prospect's pipeline stage.</p>
 </aside>;
}
export default function TeamTasks({crmData=[],currentUser={},canEdit=false,canAdmin=false,enabled=false,onGetTasks,onCreateTask,onUpdateTask,onGetTaskMembers,onOpenCRM,initialTaskDraft=null,initialTaskId=null}){
 const myId=currentUser?.id||"";
 const [tasks,setTasks]=useState([]),[members,setMembers]=useState([]);
 const [loading,setLoading]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
 const [keyword,setKeyword]=useState(""),[bucket,setBucket]=useState("All"),[owner,setOwner]=useState("All"),[priorityFilter,setPriorityFilter]=useState("All");
 const [selectedId,setSelectedId]=useState(initialTaskId||""),[creating,setCreating]=useState(false);
 const [companySearch,setCompanySearch]=useState(""),[prospectId,setProspectId]=useState("");
 const [taskTitle,setTaskTitle]=useState(""),[description,setDescription]=useState(""),[dueDate,setDueDate]=useState(""),[priority,setPriority]=useState("normal"),[assignee,setAssignee]=useState(myId);
 const [saving,setSaving]=useState(false);
 const [page,setPage]=useState(0),[refreshedAt,setRefreshedAt]=useState("");
 useEffect(()=>{setAssignee(myId);},[myId]);
 const load=async()=>{
  if(!enabled)return;
  setLoading(true);setError("");
  try{
   const [rows,people]=await Promise.all([onGetTasks(),onGetTaskMembers()]);
   setTasks(Array.isArray(rows)?rows:[]);
   const valid=(Array.isArray(people)?people:[]).filter(m=>m.active&&m.role!=="viewer");
   if(myId&&!valid.some(m=>m.id===myId))valid.push({id:myId,name:currentUser.name||"You",active:true,role:currentUser.role});
   setMembers(valid);setRefreshedAt(new Date().toLocaleTimeString());
  }catch(e){setError("Cannot load team tasks: "+(e?.message||"Check your CRM connection and permissions."));}
  finally{setLoading(false);}
 };
 useEffect(()=>{
  if(!enabled)return;
  let cancelled=false;
  setLoading(true);
  Promise.all([onGetTasks(),onGetTaskMembers()]).then(([rows,people])=>{
   if(cancelled)return;
   setTasks(Array.isArray(rows)?rows:[]);
   const valid=(Array.isArray(people)?people:[]).filter(m=>m.active&&m.role!=="viewer");
   if(myId&&!valid.some(m=>m.id===myId))valid.push({id:myId,name:currentUser.name||"You",active:true,role:currentUser.role});
   setMembers(valid);setRefreshedAt(new Date().toLocaleTimeString());
  }).catch(e=>{if(!cancelled)setError("Cannot load team tasks: "+(e?.message||"Check CRM access."));})
    .finally(()=>{if(!cancelled)setLoading(false);});
  return ()=>{cancelled=true;};
 },[enabled,myId,onGetTasks,onGetTaskMembers]);
 const companies=useMemo(()=>crmData.filter(p=>String(p.companyName||"").toLowerCase().includes(companySearch.toLowerCase())).slice(0,250),[crmData,companySearch]);
 const names=useMemo(()=>Object.fromEntries(crmData.map(p=>[String(p.id),p.companyName||"Unnamed organization"])),[crmData]);
 const asOf=localDateKey(),counts=useMemo(()=>summarizeTasks(tasks,asOf),[tasks,asOf]);
 const productivity=useMemo(()=>taskProductivitySnapshot(tasks,members,{asOf,currentUserId:myId,canAdmin}),[tasks,members,asOf,myId,canAdmin]);
 const all=useMemo(()=>filterTasks(tasks,{query:keyword,bucket,assignee:owner,prospectNames:names,asOf}),[tasks,keyword,bucket,owner,names,asOf]);
 const matchingTasks=useMemo(()=>priorityFilter==="All"?all:all.filter(t=>t.priority===priorityFilter),[all,priorityFilter]);
 const pages=Math.max(1,Math.ceil(matchingTasks.length/20));
 const show=matchingTasks.slice(Math.min(page,pages-1)*20,(Math.min(page,pages-1)+1)*20);
 const chosen=tasks.find(t=>t.id===selectedId)||null;
 const canCreate=canEdit&&enabled;
 useEffect(()=>{
  // A Phase 8 handoff only PREFILLS the existing create form.
  // The user still reviews all fields and explicitly saves to the CRM.
  if(!initialTaskDraft||!canCreate)return;
  const id=String(initialTaskDraft.prospectId||"");
  if(!uuid.test(id)||!crmData.some(p=>p.id===id))return;
  setProspectId(id);setCompanySearch("");
  setTaskTitle(String(initialTaskDraft.taskTitle||"").slice(0,180));
  setDescription(String(initialTaskDraft.description||"").slice(0,3000));
  setPriority(["low","normal","high","urgent"].includes(initialTaskDraft.priority)?initialTaskDraft.priority:"normal");
  setDueDate("");setCreating(true);setSelectedId("");
  setError("");setSuccess("");
 },[initialTaskDraft,canCreate,crmData]);
 const create=async()=>{
  if(!canCreate||saving)return;
  let data;try{data=validateTaskData({task_title:taskTitle,description,due_date:dueDate,priority});}catch(e){setError(e.message);return;}
  if(!uuid.test(String(prospectId))||!crmData.some(p=>p.id===prospectId)){setError("Choose a saved CRM prospect.");return;}
  const target=canAdmin?assignee:myId;
  if(!uuid.test(String(target))){setError("Select a valid CRM assignee.");return;}
  setSaving(true);setError("");setSuccess("");
  try{
   const row=await onCreateTask({...data,prospect_id:prospectId,assigned_to:target});
   setTasks(old=>[row,...old]);setTaskTitle("");setDescription("");setDueDate("");setPriority("normal");setCreating(false);
   setSelectedId(row.id);setSuccess("Task created and assigned. No notification or email was sent.");
  }catch(e){setError("Unable to create task: "+(e?.message||"Access denied."));}
  finally{setSaving(false);}
 };
 const update=async(id,changes)=>{
  const row=await onUpdateTask(id,changes);
  setTasks(old=>old.map(t=>t.id===id?row:t));
  setSuccess("Task saved.");return row;
 };
 const setFilter=b=>{setBucket(b);setPage(0);};
 return <div>
  <div className="pf-page-kicker">PHASE 10 · TEAM PRODUCTIVITY</div>
  <h1 className="pf-page-title">Team productivity & task ownership</h1>
  <p className="pf-page-description">Review your workload, spot overdue assignments, and report task progress from the records your CRM account can access. Task reporting never sends outreach or changes a prospect pipeline stage.</p>
  {!enabled&&<div role="status" style={{...box,margin:"20px 0",fontSize:12,color:"var(--pf-tx-985B27)",background:"var(--pf-bg-FFF9EE)"}}>Task assignments require a connected CRM database. This feature is not available in demo mode.</div>}
  <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",margin:"19px 0 14px"}}>
   <span style={{fontSize:11,color:"var(--pf-tx-73819A)"}}>{loading?"Loading CRM tasks…":tasks.length+" task(s) visible to your account"} {refreshedAt&&"· Updated "+refreshedAt}</span>
   <div style={{display:"flex",gap:9}}>
    <button style={secondary} disabled={!enabled||loading} onClick={load}>↻ Refresh</button>
    {canCreate&&<button style={primary} onClick={()=>{setCreating(x=>!x);setError("");setSuccess("");}}>+ New task</button>}
   </div>
  </div>
  {error&&<p role="alert" style={{...box,fontSize:12,color:"var(--pf-tx-A24444)",background:"var(--pf-bg-FFF3F3)",marginBottom:14}}>{error}</p>}
  {success&&<p role="status" style={{...box,fontSize:12,color:"var(--pf-tx-167C59)",background:"var(--pf-bg-EFFAF4)",marginBottom:14}}>{success}</p>}
  {creating&&canCreate&&<section style={{...box,display:"grid",gap:13,marginBottom:18}}>
   <h3 style={{margin:0,color:"var(--pf-tx-293954)",fontSize:15}}>Create prospect task</h3>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
    <label style={name}>Find prospect<input style={field} value={companySearch} onChange={e=>setCompanySearch(e.target.value)} placeholder="Search saved organization…"/></label>
    <label style={name}>Link to prospect<select style={field} value={prospectId} onChange={e=>setProspectId(e.target.value)}>
     <option value="">Select organization…</option>
     {companies.map(p=><option key={p.id} value={p.id}>{p.companyName||"Unnamed"} · {p.cityMarket||p.market||""}</option>)}
     {prospectId&&!companies.some(p=>p.id===prospectId)&&<option value={prospectId}>{names[prospectId]||"Current selection"}</option>}
    </select></label>
    <label style={name}>Task title<input style={field} maxLength={180} value={taskTitle} onChange={e=>setTaskTitle(e.target.value)} placeholder="e.g. Confirm HR contact or review website"/></label>
    <label style={name}>Due date<input style={field} type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
    <label style={name}>Priority<select style={field} value={priority} onChange={e=>setPriority(e.target.value)}>{TASK_PRIORITIES.map(x=><option key={x}>{x}</option>)}</select></label>
    <label style={name}>Assign to<select style={field} value={canAdmin?assignee:myId} disabled={!canAdmin} onChange={e=>setAssignee(e.target.value)}>
     {members.map(m=><option key={m.id} value={m.id}>{m.name||m.username}</option>)}
     {!members.some(m=>m.id===(canAdmin?assignee:myId))&&<option value={canAdmin?assignee:myId}>You</option>}
    </select></label>
   </div>
   <label style={name}>Details<textarea style={{...field,minHeight:74,resize:"vertical"}} maxLength={3000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="What needs doing? Include specific, non-sensitive next steps."/></label>
   <div style={{display:"flex",gap:9}}>
    <button style={primary} onClick={create} disabled={saving}>{saving?"Creating…":"Save & assign task"}</button>
    <button style={secondary} onClick={()=>setCreating(false)}>Cancel</button>
   </div>
  </section>}
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(118px,1fr))",gap:9,marginBottom:17}}>
   {["All","Overdue","Today","Next 7 days","Unscheduled","Completed"].map(b=><button type="button" key={b} onClick={()=>setFilter(b)} style={{...box,padding:13,textAlign:"left",cursor:"pointer",borderColor:bucket===b?"var(--pf-bd-7665DD)":"var(--pf-bd-E6EBF3)"}}>
     <div style={{fontSize:10,color:"var(--pf-tx-77869B)",fontWeight:740}}>{b}</div>
     <strong style={{fontSize:23,color:"var(--pf-tx-253652)",display:"block",marginTop:5}}>{counts[b]||0}</strong>
   </button>)}
  </div>
  {enabled&&<section style={{...box,display:"grid",gap:14,marginBottom:17}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
     <div><h2 style={{fontSize:15,color:"var(--pf-tx-263652)",margin:0}}>{canAdmin?"Team workload overview":"Your workload overview"}</h2>
      <p style={{fontSize:10,color:"var(--pf-tx-77859A)",margin:"5px 0 0"}}>{productivity.scope} · completed in the last {productivity.windowDays} days{loading&&!refreshedAt?" · loading task data":""}</p></div>
     <button type="button" style={secondary} disabled={loading&&!refreshedAt} onClick={()=>downloadTaskReport(taskProductivityCsv(productivity))}>↓ Export workload CSV</button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(115px,1fr))",gap:9}}>
     {[
      ["Active",productivity.active,"Open + in progress"],
      ["Overdue",productivity.overdue,"Needs attention"],
      ["Due today",productivity.dueToday,"Active tasks"],
      ["Next 7 days",productivity.dueNext7,"Excludes today"],
      ["No due date",productivity.unscheduled,"Active tasks"],
      ["High / urgent",productivity.urgent,"Active tasks"],
      ["Completed",productivity.completedRecent,"Last 30 days"]
     ].map(([title,value,note])=><div key={title} style={{border:"1px solid var(--pf-bd-E8ECF4)",borderRadius:11,padding:12,background:"var(--pf-bg-FBFCFE)"}}>
      <div style={{fontSize:10,fontWeight:750,color:"var(--pf-tx-75839A)"}}>{title}</div>
      <div style={{fontSize:23,fontWeight:850,color:title==="Overdue"&&value?"var(--pf-tx-B44A4A)":"var(--pf-tx-263653)",margin:"5px 0"}}>{value.toLocaleString()}</div>
      <div style={{fontSize:9,color:"var(--pf-tx-8995A8)"}}>{note}</div>
     </div>)}
    </div>
    {canAdmin&&<div>
     <h3 style={{fontSize:13,color:"var(--pf-tx-283A57)",margin:"2px 0 10px"}}>Workload by assignee</h3>
     <div style={{overflowX:"auto"}}>
      <table className="pf-recent" style={{width:"100%",minWidth:760}}>
       <thead><tr><th>ASSIGNEE</th><th>ACTIVE</th><th>OVERDUE</th><th>DUE TODAY</th><th>NEXT 7 DAYS</th><th>UNSCHEDULED</th><th>HIGH / URGENT</th><th>COMPLETED · 30D</th><th>REVIEW</th></tr></thead>
       <tbody>{productivity.assignees.map(person=><tr key={person.id}>
        <td><strong className="pf-name">{person.label}</strong><div style={{fontSize:10,color:"var(--pf-tx-8995A8)",marginTop:3}}>{person.total} total visible</div></td>
        <td>{person.active}</td><td style={{color:person.overdue?"var(--pf-tx-B44A4A)":"var(--pf-tx-62728B)",fontWeight:person.overdue?800:500}}>{person.overdue}</td>
        <td>{person.dueToday}</td><td>{person.dueNext7}</td><td>{person.unscheduled}</td><td>{person.urgent}</td><td>{person.completedRecent}</td>
        <td><button type="button" className="pf-link" onClick={()=>{setOwner(person.id);setBucket("All");setPriorityFilter("All");setPage(0);}}>Review tasks →</button></td>
       </tr>)}</tbody>
      </table>
      {!productivity.assignees.length&&<div className="pf-empty">No visible assignments to report.</div>}
     </div>
    </div>}
    <p style={{fontSize:10,color:"var(--pf-tx-8A96A8)",lineHeight:1.55,margin:0}}>Counts are calculated from task rows returned by CRM access controls. Non-admins see only tasks assigned to them; administrators see the assignments available to their account. Completion totals use the task's recorded completed timestamp, not an inferred status change.</p>
   </section>}
   <section style={{...box,display:"flex",flexWrap:"wrap",gap:11,marginBottom:16,alignItems:"end"}}>
   <label style={{...name,flex:"1 1 230px"}}>Search tasks<input style={field} value={keyword} onChange={e=>{setKeyword(e.target.value);setPage(0);}} placeholder="Task title, company, description…"/></label>
   <label style={name}>Due group<select style={field} value={bucket} onChange={e=>setFilter(e.target.value)}>{buckets.map(x=><option key={x}>{x}</option>)}</select></label>
   <label style={name}>Priority<select style={field} value={priorityFilter} onChange={e=>{setPriorityFilter(e.target.value);setPage(0);}}>
     <option value="All">All priorities</option>
     {TASK_PRIORITIES.map(p=><option key={p} value={p}>{pretty(p)}</option>)}
    </select></label>
   {canAdmin&&<label style={name}>Owner<select style={field} value={owner} onChange={e=>{setOwner(e.target.value);setPage(0);}}>
    <option value="All">All assigned staff</option>
    {members.map(m=><option key={m.id} value={m.id}>{m.name||m.username}</option>)}
   </select></label>}
  </section>
  <div style={{display:"grid",gridTemplateColumns:chosen?"minmax(0,1.35fr) minmax(300px,.85fr)":"minmax(0,1fr)",gap:15,alignItems:"start"}}>
   <section style={{...box,minWidth:0}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,gap:9,flexWrap:"wrap"}}>
     <h3 style={{margin:0,fontSize:15,color:"var(--pf-tx-283A57)"}}>{matchingTasks.length} matching tasks</h3>
     <button className="pf-link" onClick={onOpenCRM}>Classic CRM ↗</button>
    </div>
    <div style={{overflowX:"auto"}}>
     <table className="pf-recent" style={{minWidth:680}}>
      <thead><tr><th>TASK / PROSPECT</th><th>ASSIGNEE</th><th>DUE</th><th>PRIORITY</th><th>STATUS</th><th>ACTION</th></tr></thead>
      <tbody>{show.map(t=><tr key={t.id} style={{background:selectedId===t.id?"var(--pf-bg-F8F7FF)":""}}>
       <td><span className="pf-name">{t.task_title}</span><div style={{fontSize:10,color:"var(--pf-tx-8B97A9)",marginTop:4}}>{names[t.prospect_id]||"Prospect unavailable"}</div></td>
       <td style={{fontSize:11}}>{ownerName(members,t.assigned_to,myId)}</td>
       <td style={{fontSize:11}}>{niceDate(t.due_date)}<div style={{fontSize:10,color:"var(--pf-tx-77839A)"}}>{taskBucket(t,asOf)}</div></td>
       <td><span style={{fontSize:10,color:priorities[t.priority]||"var(--pf-tx-66758C)",fontWeight:770}}>{pretty(t.priority)}</span></td>
       <td><span className="pf-tag">{pretty(t.status)}</span></td>
       <td><button className="pf-link" onClick={()=>setSelectedId(t.id)}>Review →</button></td>
      </tr>)}</tbody>
     </table>
     {!show.length&&<div className="pf-empty">No CRM tasks match this view. Create one to assign lead research, reviews or follow-up preparation.</div>}
    </div>
    {matchingTasks.length>20&&<div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:9,marginTop:15}}>
     <button style={secondary} disabled={page===0} onClick={()=>setPage(n=>Math.max(0,n-1))}>Previous</button>
     <span style={{fontSize:11,color:"var(--pf-tx-768298)"}}>Page {Math.min(page,pages-1)+1} of {pages}</span>
     <button style={secondary} disabled={page>=pages-1} onClick={()=>setPage(n=>Math.min(n+1,pages-1))}>Next</button>
    </div>}
   </section>
   {chosen&&<TaskEditor key={chosen.id} task={chosen} canEdit={canEdit} canAdmin={canAdmin} myId={myId} members={members} onChange={update} onClose={()=>setSelectedId("")}/>}
  </div>
  <p className="pf-footnote">Task ownership uses CRM access controls. Reports contain aggregate task counts and assignee labels, not descriptions or contact records. Editing or completing a task does not contact the prospect, change its pipeline status, or create a reminder.</p>
 </div>;
}