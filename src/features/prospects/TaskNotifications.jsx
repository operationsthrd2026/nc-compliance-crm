import React,{useEffect,useMemo,useState} from "react";
import {buildTaskNotifications,summarizeTaskNotifications} from "../../lib/taskNotifications.js";
import {localDateKey} from "../../lib/outreachPlanning.js";

const panel={background:"var(--pf-bg-FFFFFF)",border:"1px solid var(--pf-bd-E6EBF3)",borderRadius:15,padding:18};
const primary={border:0,borderRadius:9,padding:"9px 12px",background:"var(--pf-bg-6958DA)",color:"#fff",fontWeight:750,fontSize:11,cursor:"pointer"};
const secondary={border:"1px solid var(--pf-bd-DEE3EF)",borderRadius:9,padding:"9px 12px",background:"var(--pf-bg-F6F7FC)",color:"var(--pf-tx-4D4A82)",fontWeight:750,fontSize:11,cursor:"pointer"};
const filters=[
 {value:"all",label:"All alerts",type:null},
 {value:"overdue",label:"Overdue",type:"overdue"},
 {value:"due_today",label:"Due today",type:"due_today"},
 {value:"due_soon",label:"Due soon",type:"due_soon"},
 {value:"priority",label:"High priority",type:"priority"}
];
const tones={
 critical:{background:"var(--pf-bg-FFF0F0)",border:"var(--pf-bd-F1CCCC)",color:"var(--pf-tx-A83D3D)"},
 warning:{background:"var(--pf-bg-FFF7E9)",border:"var(--pf-bd-F1E0BB)",color:"var(--pf-tx-96631B)"},
 notice:{background:"var(--pf-bg-EEF4FF)",border:"var(--pf-bd-D6E2FC)",color:"var(--pf-tx-3D60A8)"},
 info:{background:"var(--pf-bg-F2F4F8)",border:"var(--pf-bd-E0E5EE)",color:"var(--pf-tx-596982)"}
};
function readDismissed(key){
 if(!key||typeof window==="undefined")return [];
 try{
  const value=JSON.parse(window.localStorage.getItem(key)||"[]");
  return Array.isArray(value)?value.filter(x=>typeof x==="string").slice(-500):[];
 }catch{return [];}
}
function dateLabel(value){
 if(!value)return "No due date";
 const [year,month,day]=value.split("-").map(Number);
 return new Date(year,month-1,day).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
}
function typeLabel(type){
 return type==="overdue"?"OVERDUE":type==="due_today"?"DUE TODAY":type==="due_soon"?"DUE SOON":"PRIORITY";
}

export default function TaskNotifications({currentUser={},canAdmin=false,enabled=false,onGetTasks,onOpenTask}){
 const userId=String(currentUser?.id||"");
 const storageKey=userId?"prospectfinder:task-alerts:dismissed:"+userId:"";
 const [tasks,setTasks]=useState([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [refreshedAt,setRefreshedAt]=useState("");
 const [filter,setFilter]=useState("all");
 const [showDismissed,setShowDismissed]=useState(false);
 const [dismissed,setDismissed]=useState(()=>readDismissed(storageKey));

 useEffect(()=>{setDismissed(readDismissed(storageKey));},[storageKey]);
 useEffect(()=>{
  if(!enabled){setTasks([]);setLoading(false);return;}
  let cancelled=false;
  setLoading(true);setError("");
  Promise.resolve().then(()=>onGetTasks()).then(rows=>{
   if(cancelled)return;
   setTasks(Array.isArray(rows)?rows:[]);
   setRefreshedAt(new Date().toLocaleTimeString());
  }).catch(e=>{
   if(!cancelled)setError("Unable to load task reminders: "+(e?.message||"Check your CRM connection and permissions."));
  }).finally(()=>{if(!cancelled)setLoading(false);});
  return ()=>{cancelled=true;};
 },[enabled,onGetTasks]);

 const asOf=localDateKey();
 const notifications=useMemo(()=>buildTaskNotifications(tasks,{asOf,currentUserId:userId,canAdmin}),[tasks,asOf,userId,canAdmin]);
 const dismissedSet=useMemo(()=>new Set(dismissed),[dismissed]);
 const active=useMemo(()=>notifications.filter(item=>!dismissedSet.has(item.id)),[notifications,dismissedSet]);
 const counts=useMemo(()=>summarizeTaskNotifications(active),[active]);
 const dismissedCount=notifications.filter(item=>dismissedSet.has(item.id)).length;
 const visible=notifications.filter(item=>showDismissed===dismissedSet.has(item.id))
  .filter(item=>filter==="all"||(filter==="priority"?["high","urgent"].includes(item.priority):item.type===filter));
 const storeDismissed=next=>{
  const safe=[...new Set(next)].slice(-500);
  setDismissed(safe);
  try{if(storageKey&&typeof window!=="undefined")window.localStorage.setItem(storageKey,JSON.stringify(safe));}catch{}
 };
 const dismiss=id=>storeDismissed([...dismissed,id]);
 const restore=id=>storeDismissed(dismissed.filter(item=>item!==id));

 return <div>
  <div className="pf-page-kicker">PHASE 11 · IN-APP ALERTS</div>
  <h1 className="pf-page-title">Task reminders & alerts</h1>
  <p className="pf-page-description">A focused inbox for overdue work, deadlines, and high-priority assignments visible to your CRM account. Alerts refresh from current task records; this does not send emails or background messages.</p>
  {!enabled&&<div role="status" style={{...panel,marginTop:18,background:"var(--pf-bg-FFF9EE)",color:"var(--pf-tx-985B27)",fontSize:12}}>Task reminders require a connected CRM database. They are unavailable in demo mode.</div>}
  {enabled&&<>
   <section style={{...panel,marginTop:20,display:"grid",gap:15}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
     <div><div style={{fontSize:10,fontWeight:800,color:"var(--pf-tx-6958DA)",letterSpacing:1}}>YOUR TASK ALERTS</div>
      <h2 style={{fontSize:18,color:"var(--pf-tx-263652)",margin:"5px 0"}}>{counts.all} active alert{counts.all===1?"":"s"}</h2>
      <p style={{fontSize:11,color:"var(--pf-tx-77859A)",margin:0}}>{loading?"Checking your CRM tasks…":(tasks.length+" task row(s) visible")}{refreshedAt?" · Refreshed "+refreshedAt:""}</p></div>
     <button type="button" style={secondary} disabled={loading} onClick={async()=>{
      if(typeof onGetTasks!=="function")return;
      setLoading(true);setError("");
      try{const rows=await onGetTasks();setTasks(Array.isArray(rows)?rows:[]);setRefreshedAt(new Date().toLocaleTimeString());}
      catch(e){setError("Unable to refresh reminders: "+(e?.message||"Check your CRM permissions."));}
      finally{setLoading(false);}
     }}>↻ Refresh alerts</button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:9}}>
     {[
      ["Overdue",counts.overdue,"var(--pf-tx-B44343)"],
      ["Due today",counts.dueToday,"var(--pf-tx-A66D1D)"],
      ["Due soon",counts.dueSoon,"var(--pf-tx-3E60A8)"],
      ["High / urgent",counts.highOrUrgent,"var(--pf-tx-5D4DB9)"]
     ].map(([label,value,color])=><div key={label} style={{border:"1px solid var(--pf-bd-E8ECF4)",borderRadius:11,padding:12,background:"var(--pf-bg-FBFCFE)"}}>
      <div style={{fontSize:10,fontWeight:750,color:"var(--pf-tx-75839A)"}}>{label}</div>
      <div style={{fontSize:23,fontWeight:850,color,marginTop:5}}>{value.toLocaleString()}</div>
     </div>)}
    </div>
   </section>
   {error&&<p role="alert" style={{...panel,marginTop:12,color:"var(--pf-tx-A24444)",background:"var(--pf-bg-FFF3F3)",fontSize:12}}>{error}</p>}
   <section style={{...panel,marginTop:15,display:"grid",gap:13}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
     <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
      {filters.map(option=>{
       const count=option.type===null?counts.all:option.type==="overdue"?counts.overdue:option.type==="due_today"?counts.dueToday:option.type==="due_soon"?counts.dueSoon:counts.highOrUrgent;
       return <button key={option.value} type="button" aria-pressed={filter===option.value} onClick={()=>setFilter(option.value)} style={{...secondary,background:filter===option.value?"#EEEAFE":"#F6F7FC",borderColor:filter===option.value?"#C9C1FC":"#DEE3EF"}}>{option.label} ({count})</button>;
      })}
     </div>
     <button type="button" style={secondary} onClick={()=>setShowDismissed(value=>!value)}>{showDismissed?"← Show active alerts":"Show dismissed ("+dismissedCount+")"}</button>
    </div>
    {loading&&!tasks.length?<div className="pf-empty">Loading reminders from your CRM…</div>:visible.length===0?
     <div className="pf-empty">{showDismissed?"No dismissed alerts in this category.":counts.all===0?"You're clear. No overdue, near-due, or high-priority active tasks were found.":"No alerts match this filter."}</div>:
     <div style={{display:"grid",gap:10}}>
      {visible.map(item=>{
       const tone=tones[item.severity]||tones.info;
       return <article key={item.id} style={{border:"1px solid "+tone.border,borderRadius:12,padding:14,display:"grid",gap:9,background:"var(--pf-bg-FFFFFF)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:12}}>
         <div style={{minWidth:0}}>
          <span style={{display:"inline-block",fontSize:9,fontWeight:850,letterSpacing:.7,padding:"4px 7px",borderRadius:6,background:tone.background,color:tone.color}}>{typeLabel(item.type)}</span>
          <h3 style={{fontSize:14,color:"var(--pf-tx-243550)",margin:"8px 0 4px",overflowWrap:"anywhere"}}>{item.taskTitle}</h3>
          <p style={{fontSize:11,color:"var(--pf-tx-6E7D94)",margin:0}}>{item.title} · {item.message}</p>
         </div>
         <span style={{flex:"none",fontSize:10,fontWeight:800,color:item.priority==="urgent"?"var(--pf-tx-B44343)":item.priority==="high"?"var(--pf-tx-A66D1D)":"var(--pf-tx-6D7A91)"}}>{String(item.priority).toUpperCase()}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
         <span style={{fontSize:10,color:"var(--pf-tx-8793A8)"}}>Due: {dateLabel(item.dueDate)}</span>
         <div style={{display:"flex",gap:7}}>
          {showDismissed?
           <button type="button" style={secondary} onClick={()=>restore(item.id)}>Restore alert</button>:
           <button type="button" style={secondary} onClick={()=>dismiss(item.id)}>Dismiss</button>}
          <button type="button" style={primary} onClick={()=>onOpenTask?.(item.taskId)}>Open task →</button>
         </div>
        </div>
       </article>;
      })}
     </div>}
    <p style={{fontSize:10,color:"var(--pf-tx-8995A8)",lineHeight:1.6,margin:0}}>Reminders are calculated from active tasks: overdue, due today, due within three days, or high/urgent priority. Dismissals are saved locally in this browser for this CRM user. No task descriptions or contact details are copied into the alert feed.</p>
   </section>
  </>}
 </div>;
}
