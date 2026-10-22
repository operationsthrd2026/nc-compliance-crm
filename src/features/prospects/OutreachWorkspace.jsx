import React, {useMemo,useState} from "react";
import {contactDetails,leadCategory} from "../../lib/leadQualification.js";
import {localDateKey,parseLocalDay,FOLLOWUP_VIEWS,followupQueue,pipelineSnapshot,outreachCsv} from "../../lib/outreachPlanning.js";

const frame={border:"1px solid var(--pf-bd-E8ECF4)",background:"var(--pf-bg-FFFFFF)",borderRadius:16,padding:20};
const select={border:"1px solid var(--pf-bd-DBE2ED)",background:"var(--pf-bg-FFFFFF)",color:"var(--pf-tx-243653)",padding:"10px 12px",borderRadius:9,fontSize:12,maxWidth:"100%"};
const accent="var(--pf-tx-6656DD)";
const muted="var(--pf-tx-687993)";
const TERMINAL=["Replied","Do Not Respond","Converted","NURTURE/T3 SENT"];
function fmtDay(s){
 if(parseLocalDay(s)===null)return "Not scheduled";
 const [y,m,d]=s.split("-").map(Number);
 return new Date(y,m-1,d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
}
function tagColor(status) {
 if(status==="Overdue")return {color:"var(--pf-tx-B74041)",background:"var(--pf-bg-FFF0F0)"};
 if(status==="Today")return {color:"var(--pf-tx-965C16)",background:"var(--pf-bg-FFF5E5)"};
 if(status==="Next 7 days")return {color:"var(--pf-tx-2861A8)",background:"var(--pf-bg-EAF2FF)"};
 if(status==="Approval needed")return {color:"var(--pf-tx-7445B3)",background:"var(--pf-bg-F4EEFF)"};
 return {color:"var(--pf-tx-5D6B80)",background:"var(--pf-bg-F1F3F7)"};
}
function Pill({status}){
 return <span style={{display:"inline-block",fontSize:10,borderRadius:20,padding:"5px 9px",fontWeight:760,...tagColor(status)}}>{status}</span>;
}
function BarGroup({title,entries,total}){
 const items=Object.entries(entries).sort((a,b)=>b[1]-a[1]);
 return <section style={frame}>
  <h3 style={{fontSize:14,color:"var(--pf-tx-1B2944)",margin:"0 0 6px"}}>{title}</h3>
  <p style={{fontSize:11,color:muted,margin:"0 0 17px"}}>Based on currently saved CRM records</p>
  {items.length?items.slice(0,12).map(([label,count])=>
   <div key={label} style={{marginBottom:13}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:9,fontSize:11,marginBottom:6,color:"var(--pf-tx-31405A)"}}><span>{label}</span><strong>{count.toLocaleString()}</strong></div>
    <div style={{height:7,borderRadius:6,background:"var(--pf-bg-EEF0F7)",overflow:"hidden"}}><div style={{height:"100%",width:(total?100*count/total:0)+"%",background:"var(--pf-bg-8675EC)",borderRadius:6}}/></div>
   </div>
  ):<p style={{color:muted,fontSize:12}}>No records yet</p>}
 </section>;
}
function actionFor(row) {
 if(row.needsApproval)return "Flag for Touch 3 approval";
 return "Record "+row.label+" sent";
}
function ActionPanel({item,canEdit,onUpdateProspect,onClose}){
 const [date,setDate]=useState(item.dueDate||"");
 const [note,setNote]=useState("");
 const [saving,setSaving]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
 const [ask,setAsk]=useState(false);
 const source=item.prospect;
 const channels=contactDetails(source);
 const action=actionFor(item);
 const update=async(changes)=>{
  setSaving(true);setError("");setSuccess("");
  try{
   await onUpdateProspect({id:item.id,changes});
   setSuccess("Saved to your CRM.");
   setAsk(false);
  }catch(e){setError(e?.message||"Could not save to CRM.");}
  finally{setSaving(false);}
 };
 const saveDate=()=> {
  if(!canEdit||saving)return;
  if(!date||parseLocalDay(date)===null){setError("Choose a valid follow-up date.");return;}
  update({[item.dueField]:date});
 };
 const logAction=()=>{
  if(!canEdit||saving)return;
  if(item.needsApproval){
   update({flagToMelissa:true,outreachNotes:[source.outreachNotes||"","Touch 3 approval requested for review."].filter(Boolean).join("\n").slice(0,5000)});
  }else if(ask){
   update({currentStatus:item.stage,...(note.trim()?{outreachNotes:[source.outreachNotes||"",localDateKey()+" · "+item.label+" manually recorded: "+note.trim()].filter(Boolean).join("\n").slice(0,5000)}:{})});
  }else setAsk(true);
 };
 return <aside style={{...frame,position:"sticky",top:16,display:"grid",gap:12,alignSelf:"start"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:8}}>
   <div><div style={{color:accent,fontSize:10,fontWeight:830,letterSpacing:1}}>FOLLOW-UP DETAILS</div>
    <h3 style={{fontSize:17,margin:"6px 0 4px",color:"var(--pf-tx-17233C)"}}>{item.companyName}</h3>
    <p style={{fontSize:11,color:muted,margin:0}}>{item.label} · <Pill status={item.bucket}/></p>
   </div>
   <button aria-label="Close details" onClick={onClose} style={{padding:"5px 10px",border:0,borderRadius:8,background:"var(--pf-bg-F3F4F9)",fontSize:17}}>×</button>
  </div>
  <div style={{fontSize:11,lineHeight:1.7,color:"var(--pf-tx-55657E)"}}>
   <div><strong>Organization:</strong> {source.vertical||leadCategory(source)}</div>
   <div><strong>Location:</strong> {source.cityMarket||source.market||"Not listed"}</div>
   <div><strong>Email:</strong> {channels.email||"Not listed"}</div>
   <div><strong>Phone:</strong> {channels.phone||"Not listed"}</div>
   <div><strong>Current stage:</strong> {source.currentStatus}</div>
  </div>
  {!item.hasContact&&<div style={{fontSize:11,color:"var(--pf-tx-985922)",background:"var(--pf-bg-FFF7E9)",padding:10,borderRadius:8}}>No email or phone is recorded. Research a contact before outreach; use Saved Prospects to add contact details.</div>}
  {item.needsApproval&&<div style={{fontSize:11,color:"var(--pf-tx-7652A7)",background:"var(--pf-bg-F7F1FF)",padding:10,borderRadius:8}}>Touch 3 is awaiting approval. Flag it for review before logging an additional touch.</div>}
  <label style={{fontSize:11,fontWeight:750,color:"var(--pf-tx-596983)",display:"grid",gap:6}}>
   {item.label} due date
   <input type="date" value={date} disabled={!canEdit||saving} onChange={e=>{setDate(e.target.value);setError("");setSuccess("");}} style={select}/>
  </label>
  {canEdit&&<button className="pf-button outline" disabled={saving||!date||date===item.dueDate} onClick={saveDate}>Save follow-up date</button>}
  <div style={{borderTop:"1px solid var(--pf-bd-ECEEF5)",paddingTop:12,display:"grid",gap:10}}>
   <div style={{fontSize:11,fontWeight:770,color:"var(--pf-tx-314161)"}}>Manual outreach log</div>
   {item.needsApproval?null:<label style={{fontSize:11,color:muted,display:"grid",gap:5}}>Optional notes
    <textarea value={note} onChange={e=>setNote(e.target.value)} disabled={!canEdit||saving} rows={3} placeholder="Contacted via email/phone, summary of action…" style={{...select,width:"100%",resize:"vertical"}}/>
   </label>}
   {canEdit&&(!item.needsApproval||!source.flagToMelissa)&&
    <button className="pf-button" onClick={logAction} disabled={saving}>
     {saving?"Saving…":ask?"Confirm: "+action:action}
    </button>}
   {ask&&!item.needsApproval&&<>
     <p style={{fontSize:11,color:"var(--pf-tx-935B31)",margin:0,lineHeight:1.65}}>Only confirm if you have <strong>already sent</strong> this touch. This button logs CRM status and dates; it does not send an email or make a phone call.</p>
     <button className="pf-button outline" onClick={()=>setAsk(false)}>Cancel</button>
   </>}
   {source.flagToMelissa&&item.needsApproval&&<p style={{fontSize:11,color:"var(--pf-tx-7052A4)",margin:0}}>This lead is flagged for review.</p>}
  </div>
  {error&&<div role="alert" style={{padding:10,borderRadius:8,background:"var(--pf-bg-FFF2F0)",fontSize:11,color:"var(--pf-tx-AB4746)"}}>{error}</div>}
  {success&&<div role="status" style={{padding:10,borderRadius:8,background:"var(--pf-bg-EAF8F1)",fontSize:11,color:"var(--pf-tx-167F58)"}}>{success}</div>}
  {!canEdit&&<p style={{fontSize:11,color:muted}}>View-only account. Ask a CRM editor to schedule or record a touch.</p>}
 </aside>;
}
function Followups({crmData,canEdit,onUpdateProspect,initialProspectId=null}){
 const asOf=localDateKey();
 const queue=useMemo(()=>followupQueue(crmData,asOf),[crmData,asOf]);
 const [view,setView]=useState("All"),[keyword,setKeyword]=useState(""),[selectedId,setSelectedId]=useState(initialProspectId);
 const [horizon,setHorizon]=useState("queue");
 const [page,setPage]=useState(0);
 const totals=pipelineSnapshot(crmData,asOf).followups;
 const filtered=queue.filter(row=>{
  if(view!=="All"&&row.bucket!==view)return false;
  if(horizon==="calendar"&&!(row.daysAway!==null&&row.daysAway>=0&&row.daysAway<=30)&&row.bucket!=="Overdue")return false;
  return !keyword.trim()||[row.companyName,row.prospect.cityMarket,row.prospect.market,row.prospect.vertical]
   .some(x=>String(x||"").toLowerCase().includes(keyword.toLowerCase()));
 });
 const perPage=20,numberPages=Math.max(1,Math.ceil(filtered.length/perPage));
 const shown=filtered.slice(Math.min(page,numberPages-1)*perPage,(Math.min(page,numberPages-1)+1)*perPage);
 const active=queue.find(q=>q.id===selectedId)||null;
 const filterView=x=>{setView(x);setPage(0);};
 return <>
  <div className="pf-page-kicker">PHASE 3 · FOLLOW-UP MANAGEMENT</div>
  <h1 className="pf-page-title">Outreach follow-ups</h1>
  <p className="pf-page-description">Review your existing follow-up calendar, reschedule due dates and manually log completed touches. Nothing is sent automatically.</p>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,margin:"21px 0"}}>
   {["Overdue","Today","Next 7 days","Unscheduled","Approval needed"].map(status=>
    <button key={status} onClick={()=>filterView(status===view?"All":status)} style={{...frame,padding:14,textAlign:"left",borderColor:view===status?accent:"var(--pf-bd-E8ECF4)"}}>
     <div style={{fontSize:10,color:muted,fontWeight:760}}>{status}</div><strong style={{display:"block",fontSize:24,color:"var(--pf-tx-22314C)",marginTop:6}}>{totals[status]||0}</strong>
    </button>)}
  </div>
  <div style={{...frame,display:"flex",gap:11,flexWrap:"wrap",alignItems:"end",marginBottom:16}}>
   <label style={{fontSize:11,color:muted,display:"grid",gap:5,flex:"1 1 180px"}}>Search due organizations
    <input value={keyword} onChange={e=>{setKeyword(e.target.value);setPage(0);}} placeholder="Company, industry, city…" style={{...select,width:"100%"}}/>
   </label>
   <label style={{fontSize:11,color:muted,display:"grid",gap:5}}>Due status
    <select value={view} onChange={e=>filterView(e.target.value)} style={select}>{FOLLOWUP_VIEWS.map(x=><option key={x}>{x}</option>)}</select>
   </label>
   <label style={{fontSize:11,color:muted,display:"grid",gap:5}}>Schedule view
    <select value={horizon} onChange={e=>{setHorizon(e.target.value);setPage(0);}} style={select}>
     <option value="queue">All follow-ups</option><option value="calendar">30-day calendar + overdue</option>
    </select>
   </label>
  </div>
  <div style={{display:"grid",gridTemplateColumns:active?"minmax(0,1.4fr) minmax(290px,.9fr)":"minmax(0,1fr)",gap:15,alignItems:"start"}}>
   <div style={frame}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
     <strong style={{fontSize:14,color:"var(--pf-tx-22314C)"}}>{filtered.length} follow-up item{filtered.length===1?"":"s"}</strong>
     <span style={{fontSize:11,color:muted}}>As of {fmtDay(asOf)} · dates shown in your device's timezone</span>
    </div>
    <div style={{overflowX:"auto"}}>
     <table className="pf-recent" style={{minWidth:650}}>
      <thead><tr><th>ORGANIZATION</th><th>NEXT TOUCH</th><th>DUE</th><th>PRIORITY</th><th>REVIEW</th></tr></thead>
      <tbody>{shown.map(row=><tr key={row.id} style={{background:selectedId===row.id?"var(--pf-bg-F8F6FF)":""}}>
       <td><strong className="pf-name">{row.companyName}</strong>
        <div style={{fontSize:10,marginTop:5,color:muted}}>{row.prospect.cityMarket||row.prospect.market||"Location not listed"}{!row.hasContact?" · Contact missing":""}</div></td>
       <td>{row.label}</td><td>{fmtDay(row.dueDate)}</td><td><Pill status={row.bucket}/></td>
       <td><button className="pf-link" onClick={()=>setSelectedId(row.id)}>Manage →</button></td>
      </tr>)}</tbody>
     </table>
     {!shown.length&&<div className="pf-empty">No scheduled follow-ups match this view. Follow-up dates appear here after Touch 1 or Touch 2 is recorded, or when you schedule dates in the CRM.</div>}
    </div>
    {filtered.length>perPage&&<div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:9,marginTop:12}}>
     <button className="pf-button outline" disabled={page===0} onClick={()=>setPage(n=>Math.max(0,n-1))}>Previous</button>
     <span style={{fontSize:11,color:muted}}>{Math.min(page,numberPages-1)+1} / {numberPages}</span>
     <button className="pf-button outline" disabled={page>=numberPages-1} onClick={()=>setPage(n=>Math.min(numberPages-1,n+1))}>Next</button>
    </div>}
   </div>
   {active&&<ActionPanel key={active.id+active.label} item={active} canEdit={canEdit} onUpdateProspect={onUpdateProspect} onClose={()=>setSelectedId(null)}/>}
  </div>
  <p className="pf-footnote">Reply, conversion, do-not-contact and already-recorded Touch 3 stages are excluded from pending follow-ups. Unscheduled means no valid due date is saved. No reminders, calendar invites or email messages are sent from this screen.</p>
 </>;
}
function Reports({crmData}){
 const date=localDateKey(),data=useMemo(()=>pipelineSnapshot(crmData,date),[crmData,date]);
 const exportNow=()=>{
  const csv=outreachCsv(crmData,date);
  const file=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const href=URL.createObjectURL(file),node=document.createElement("a");
  node.href=href;node.download="prospectfinder-outreach-"+date+".csv";
  document.body.appendChild(node);node.click();node.remove();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
 };
 return <>
  <div className="pf-page-kicker">PHASE 3 · PIPELINE REPORTING</div>
  <h1 className="pf-page-title">Pipeline reports</h1>
  <p className="pf-page-description">A live snapshot of saved CRM status, follow-up workload, organization segments and contact completeness. Counts update as your team edits records.</p>
  <div style={{display:"flex",justifyContent:"space-between",gap:15,flexWrap:"wrap",alignItems:"center",marginTop:20}}>
   <span style={{fontSize:11,color:muted}}>Snapshot date: {fmtDay(date)} · Based on saved CRM fields</span>
   <button className="pf-button" onClick={exportNow}>↓ Export outreach report (CSV)</button>
  </div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(165px,1fr))",gap:11,margin:"18px 0 24px"}}>
   {[["Saved prospects",data.total],["New prospects",data.firstTouch],["In outreach pipeline",data.inProgress],["Follow-ups overdue",data.followups.Overdue],["Replied / reply flagged",data.replies],["Converted",data.converted],["Do not contact",data.blocked]].map(([label,count])=>
    <section key={label} style={{...frame,padding:15}}>
     <div style={{fontSize:11,color:muted,fontWeight:760}}>{label}</div>
     <div style={{fontSize:27,fontWeight:830,color:"var(--pf-tx-1F2F4B)",marginTop:9}}>{count.toLocaleString()}</div>
    </section>)}
  </div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
   <BarGroup title="Pipeline stages" entries={data.statuses} total={data.total}/>
   <BarGroup title="Contact readiness" entries={data.readiness} total={data.total}/>
   <BarGroup title="Organization segments" entries={data.categories} total={data.total}/>
   <BarGroup title="Top industries" entries={data.verticals} total={data.total}/>
   <BarGroup title="Lead sources" entries={data.sources} total={data.total}/>
   <BarGroup title="Follow-up workload" entries={Object.fromEntries(Object.entries(data.followups).filter(([k])=>k!=="All"))} total={data.followups.All}/>
  </div>
  <p className="pf-footnote">Reported outreach counts are based on statuses and flags, not confirmed email delivery or logged phone calls. Reports are snapshots; the CRM does not yet keep a complete historical activity timeline. Exporting generates a local CSV and does not send data externally.</p>
 </>;
}
export default function OutreachWorkspace({crmData=[],canEdit=false,onUpdateProspect,onOpenCRM,initialProspectId=null}){
 const [tab,setTab]=useState("followups");
 return <div>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:18}}>
   <div role="tablist" aria-label="Outreach planning sections" style={{display:"flex",gap:5,padding:5,background:"var(--pf-bg-EDEFFA)",borderRadius:11}}>
    {[[ "followups","Follow-up queue"],["reports","Pipeline reports"]].map(([name,label])=>
     <button type="button" role="tab" key={name} aria-selected={tab===name} onClick={()=>setTab(name)}
      style={{border:0,background:tab===name?"var(--pf-bg-FFFFFF)":"transparent",color:tab===name?accent:"var(--pf-tx-657390)",fontSize:12,fontWeight:790,borderRadius:8,padding:"10px 14px",boxShadow:tab===name?"0 2px 6px #202A4814":"none"}}>
      {label}
     </button>)}
   </div>
   <button className="pf-button outline" onClick={onOpenCRM}>Classic CRM ↗</button>
  </div>
  {tab==="followups"?<Followups crmData={crmData} canEdit={canEdit} onUpdateProspect={onUpdateProspect} initialProspectId={initialProspectId}/>:<Reports crmData={crmData}/>}
 </div>;
}
