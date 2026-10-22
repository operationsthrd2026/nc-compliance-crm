import React,{useEffect,useMemo,useState} from "react";
import {contactChecklist,defaultTemplateFor,draftFor,mailtoLink,messageEligibility,OUTREACH_TEMPLATES,verificationActivityDetails} from "../../lib/outreachTemplates.js";
import {safeWebsite} from "../../lib/contactDetails.js";

const panel={border:"1px solid var(--pf-bd-E6EAF3)",borderRadius:15,padding:20,background:"var(--pf-bg-FFFFFF)"};
const small={fontSize:11,color:"var(--pf-tx-66758F)",lineHeight:1.6};
const field={border:"1px solid var(--pf-bd-DCE3EF)",borderRadius:9,padding:"10px 11px",fontSize:12,background:"var(--pf-bg-FFFFFF)",color:"var(--pf-tx-1B2943)",width:"100%",minWidth:0};
const action={border:0,borderRadius:9,padding:"10px 14px",fontSize:12,fontWeight:760,background:"var(--pf-bg-6958DF)",color:"#fff",cursor:"pointer"};
const secondary={...action,background:"var(--pf-bg-F0F1FA)",color:"var(--pf-tx-4B4C76)",border:"1px solid var(--pf-bd-DFE2EE)"};
const types=[
 ["note","Research / general note"],["email_prepared","Email draft prepared"],
 ["email_sent","Email sent externally"],["call","Phone call"],["meeting","Meeting"],
 ["reply","Reply received"],["verification","Manual source review"],["other","Other activity"]
];
function statusLabel(t){return types.find(([k])=>k===t)?.[1]||"Activity";}
function niceTime(ts){const d=new Date(ts);return Number.isNaN(d.valueOf())?"Date unavailable":d.toLocaleString("en-US",{dateStyle:"medium",timeStyle:"short"});}
function ActivityTimeline({prospect,enabled,onGetActivities,onLogActivity,canEdit}){
 const [entries,setEntries]=useState([]),[loading,setLoading]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [category,setCategory]=useState("note"),[summary,setSummary]=useState(""),[details,setDetails]=useState("");
 const [saving,setSaving]=useState(false);
 const id=prospect?.id||"";
 const refresh=async()=>{
  if(!enabled||!id)return;
  setLoading(true);setError("");
  try{const data=await onGetActivities(id);setEntries(data||[]);}
  catch(e){setError("Could not load activity history: "+(e?.message||"Access denied."));}
  finally{setLoading(false);}
 };
 useEffect(()=>{
  let active=true;
  setEntries([]);setError("");setNotice("");
  if(!enabled||!id)return;
  setLoading(true);
  onGetActivities(id).then(rows=>{if(active)setEntries(rows||[]);})
   .catch(e=>{if(active)setError("Could not load history: "+(e?.message||"Check CRM connection."));})
   .finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[id,enabled,onGetActivities]);
 const submit=async()=>{
  const title=summary.trim(),note=details.trim();
  if(!title||title.length>180){setError("Add an activity summary of 1–180 characters.");return;}
  if(note.length>4000){setError("Activity details must be 4,000 characters or fewer.");return;}
  if(category==="email_sent"&&!window.confirm("Confirm you ALREADY sent an email outside the CRM. This will only record a manual activity, not send a message."))return;
  setSaving(true);setError("");setNotice("");
  try{
   const saved=await onLogActivity({prospectId:id,activityType:category,summary:title,details:note});
   if(saved)setEntries(old=>[saved,...old].slice(0,100));
   setSummary("");setDetails("");setNotice("Manual activity saved. No message was sent by the CRM.");
  }catch(e){setError("Could not record activity: "+(e?.message||"Permission denied."));}
  finally{setSaving(false);}
 };
 return <section style={panel}>
  <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"}}>
   <div><h3 style={{margin:"0 0 4px",fontSize:15}}>Activity timeline</h3>
    <p style={{...small,margin:0}}>Append-only notes and manually recorded outreach. No automated email tracking.</p></div>
   {enabled&&<button style={secondary} onClick={refresh} disabled={loading}>↻ Refresh</button>}
  </div>
  {!enabled?<p style={{...small,color:"var(--pf-tx-975D2F)",marginTop:15}}>The activity journal requires a live CRM connection. Templates are still available without it.</p>:null}
  {canEdit&&enabled&&<div style={{background:"var(--pf-bg-F7F8FD)",borderRadius:11,padding:14,marginTop:17,display:"grid",gap:10}}>
    <label style={small}>Activity type
     <select value={category} onChange={e=>setCategory(e.target.value)} style={{...field,marginTop:4}}>
      {types.map(([id,label])=><option key={id} value={id}>{label}</option>)}
     </select>
    </label>
    <label style={small}>Summary
     <input value={summary} maxLength={180} onChange={e=>setSummary(e.target.value)} style={{...field,marginTop:4}} placeholder="e.g. Left voicemail about HR policy review"/>
    </label>
    <label style={small}>Details (optional)
     <textarea value={details} maxLength={4000} onChange={e=>setDetails(e.target.value)} style={{...field,marginTop:4,minHeight:77,resize:"vertical"}} placeholder="What happened, next steps, or an independent verification source…"/>
    </label>
    <p style={{...small,margin:0}}>Only record outreach that actually happened. Saving an entry doesn't send emails or change pipeline status.</p>
    <div><button style={action} onClick={submit} disabled={saving||!summary.trim()}>{saving?"Recording…":"Record activity"}</button></div>
   </div>}
   {notice&&<p role="status" style={{...small,color:"var(--pf-tx-127B59)"}}>{notice}</p>}
   {error&&<p role="alert" style={{...small,color:"var(--pf-tx-AB4545)"}}>{error}</p>}
   {enabled&&<div style={{marginTop:17,display:"grid",gap:10}}>
    {loading?<p style={small}>Loading activities…</p>:entries.length?entries.map(row=><article key={row.id} style={{borderLeft:"3px solid var(--pf-bd-8C7CE7)",background:"var(--pf-bg-FAFBFE)",borderRadius:8,padding:"11px 13px"}}>
     <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
      <strong style={{fontSize:12,color:"var(--pf-tx-263754)"}}>{row.summary}</strong>
      <span style={{fontSize:10,color:"var(--pf-tx-74809A)"}}>{niceTime(row.created_at)}</span>
     </div>
     <div style={{fontSize:10,color:"var(--pf-tx-6653B2)",marginTop:5,fontWeight:760}}>{statusLabel(row.activity_type)}</div>
     {row.details&&<p style={{fontSize:11,color:"var(--pf-tx-50607A)",whiteSpace:"pre-wrap",overflowWrap:"anywhere",margin:"8px 0 0"}}>{row.details}</p>}
    </article>):<p style={small}>No recorded activities for this prospect yet.</p>}
   </div>}
 </section>;
}
export default function OutreachTools({crmData=[],canEdit=false,enabled=false,onGetActivities,onLogActivity,onOpenCRM}){
 const [term,setTerm]=useState(""),[prospectId,setProspectId]=useState(""),[templateId,setTemplateId]=useState("business-intro");
 const [subject,setSubject]=useState(""),[body,setBody]=useState("");
 const [evidence,setEvidence]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const matching=useMemo(()=>crmData.filter(p=>(p.companyName||"").toLowerCase().includes(term.trim().toLowerCase())).slice(0,300),[crmData,term]);
 const prospect=crmData.find(p=>String(p.id)===String(prospectId))||null;
 const eligible=messageEligibility(prospect||{});
 const checklist=contactChecklist(prospect||{});
 useEffect(()=>{
  if(!prospect)return;
  setTemplateId(defaultTemplateFor(prospect));
  setEvidence("");setMessage("");setError("");
 },[prospect?.id]);
 useEffect(()=>{
  if(!prospect)return;
  const data=draftFor(prospect,templateId);
  setSubject(data.subject);setBody(data.body);
  setMessage("");setError("");
 },[prospect?.id,templateId]);
 const log=async(activityType,summary,details)=>{
  if(!enabled||!canEdit)throw Error("A live CRM editor account is required to record an activity.");
  return await onLogActivity({prospectId:prospect.id,activityType,summary,details});
 };
 const sourceReview=async()=>{
  if(!prospect||busy)return;
  if(evidence.trim().length<10){setError("Provide a specific source URL or at least 10 characters explaining what you checked.");return;}
  setBusy(true);setError("");setMessage("");
  try{
   await log("verification","Manual source review recorded",verificationActivityDetails(prospect,evidence));
   setEvidence("");
   setMessage("Source review recorded. This does NOT verify deliverability or phone ownership. Use Refresh in the activity timeline to see it.");
  }catch(e){setError(e.message||"Could not save source review.");}
  finally{setBusy(false);}
 };
 const prepared=async()=>{
  if(!prospect||busy||eligible.blocked)return;
  setBusy(true);setError("");setMessage("");
  try{
   await log("email_prepared","Draft prepared: "+OUTREACH_TEMPLATES.find(t=>t.id===templateId)?.label,
    ("Subject: "+subject+"\n\n"+body).slice(0,4000));
   setMessage("Draft preparation recorded in the CRM. Email not sent. Refresh the activity timeline to see it.");
  }catch(e){setError(e.message||"Could not record draft.");}
  finally{setBusy(false);}
 };
 const copy=async()=>{
  if(eligible.blocked||!prospect)return;
  try{
   await navigator.clipboard.writeText("Subject: "+subject+"\n\n"+body);
   setMessage("Draft copied. Nothing has been sent or logged automatically.");setError("");
  }catch{setError("Clipboard permission denied. Select and copy the subject/body fields manually.");}
 };
 const mailto=mailtoLink(eligible.email,subject,body);
 return <div>
  <div className="pf-page-kicker">PHASE 4 · OUTREACH WORKSPACE</div>
  <h1 className="pf-page-title">Templates & activity</h1>
  <p className="pf-page-description">Prepare outreach drafts, review public contact details and record manual activity against saved CRM prospects. Search APIs are not used.</p>
  <section style={{...panel,margin:"23px 0 17px",display:"grid",gap:12}}>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(225px,1fr))",gap:11}}>
    <label style={small}>Find an existing prospect
     <input style={{...field,marginTop:5}} value={term} onChange={e=>setTerm(e.target.value)} placeholder="Search saved organizations…"/>
    </label>
    <label style={small}>Select organization
     <select style={{...field,marginTop:5}} value={prospectId} onChange={e=>setProspectId(e.target.value)}>
      <option value="">Choose a saved prospect…</option>
      {matching.map(p=><option key={String(p.id)} value={String(p.id)}>{p.companyName||"Unnamed"} — {p.cityMarket||p.market||"No location"}</option>)}
      {prospect&&!matching.some(p=>p.id===prospect.id)&&<option key={String(prospect.id)} value={String(prospect.id)}>{prospect.companyName} (current selection)</option>}
     </select>
    </label>
   </div>
   <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:9}}>
    <span style={small}>Showing up to 300 matching prospects · {crmData.length} total saved CRM records</span>
    <button className="pf-button outline" onClick={onOpenCRM}>Open Classic CRM ↗</button>
   </div>
  </section>
  {!prospect?<div style={{...panel,color:"var(--pf-tx-74819B)",fontSize:12}}>Select a saved organization above to prepare a draft, review contact fields or open its activity timeline.</div>:
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(330px,1fr))",gap:16,alignItems:"start"}}>
   <div style={{display:"grid",gap:16}}>
    <section style={{...panel,display:"grid",gap:13}}>
     <div><h3 style={{margin:"0 0 5px",fontSize:15}}>Outreach draft</h3>
      <p style={{...small,margin:0}}>Editable email templates. No automated sending, personalization research or mass campaigns.</p></div>
     <label style={small}>Template
      <select value={templateId} onChange={e=>setTemplateId(e.target.value)} style={{...field,marginTop:5}}>
       {OUTREACH_TEMPLATES.map(t=><option value={t.id} key={t.id}>{t.label}</option>)}
      </select>
     </label>
     <div style={{background:eligible.blocked?"var(--pf-bg-FFF0F0)":"var(--pf-bg-F5F7FB)",borderRadius:9,padding:11,fontSize:11,color:eligible.blocked?"var(--pf-tx-A34343)":"var(--pf-tx-596A83)"}}>{eligible.warning}</div>
     <label style={small}>Subject
      <input value={subject} onChange={e=>setSubject(e.target.value)} disabled={eligible.blocked} style={{...field,marginTop:5}}/>
     </label>
     <label style={small}>Message
      <textarea value={body} onChange={e=>setBody(e.target.value)} disabled={eligible.blocked} rows={13} style={{...field,marginTop:5,resize:"vertical",lineHeight:1.6}}/>
     </label>
     <div style={{display:"flex",gap:9,flexWrap:"wrap"}}>
      <button style={action} onClick={copy} disabled={eligible.blocked}>Copy draft</button>
      {eligible.canOpenEmail&&mailto?<a style={{...secondary,textDecoration:"none",display:"inline-flex",alignItems:"center"}} href={mailto}>Open email app ↗</a>:
       <button style={secondary} disabled title="A valid saved email is needed">Open email app ↗</button>}
      {enabled&&canEdit&&<button style={secondary} disabled={busy||eligible.blocked} onClick={prepared}>Record draft prepared</button>}
     </div>
     <p style={{...small,margin:0}}>Opening your email app creates an editable unsent message. Review recipients, content, consent and accuracy before sending.</p>
    </section>
    <section style={{...panel,display:"grid",gap:12}}>
     <div><h3 style={{margin:"0 0 5px",fontSize:15}}>Contact source review</h3>
      <p style={{...small,margin:0}}>Syntax and source presence are different from verified ownership or deliverability.</p></div>
     {checklist.map(x=><div key={x.key} style={{padding:"10px 12px",border:"1px solid var(--pf-bd-E8EBF4)",borderRadius:9}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
       <strong style={{fontSize:11,color:"var(--pf-tx-273957)"}}>{x.name}</strong>
       <span style={{fontSize:10,color:x.value?"var(--pf-tx-167D5A)":"var(--pf-tx-9B633A)"}}>{x.value?"Listed":"Missing"}</span>
      </div>
      <div style={{...small,marginTop:5,overflowWrap:"anywhere"}}>{x.value||x.detail}</div>
      {x.value&&<div style={{...small,fontSize:10,marginTop:4}}>{x.detail}</div>}
     </div>)}
     {safeWebsite(prospect.sourceUrl)&&<a href={safeWebsite(prospect.sourceUrl)} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"var(--pf-tx-6453D0)",overflowWrap:"anywhere"}}>View original prospect source ↗</a>}
     {enabled&&canEdit&&<label style={small}>Source evidence / manual check details
      <textarea rows={3} style={{...field,marginTop:5,resize:"vertical"}} value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="Source URL, page reviewed, date and what was checked…"/>
     </label>}
     {enabled&&canEdit&&<div><button style={secondary} onClick={sourceReview} disabled={busy||evidence.trim().length<10}>Record manual source review</button></div>}
     <p style={{...small,margin:0}}>A manual source review is not an email inbox verification or a phone connection test. Never label it as deliverability verified.</p>
    </section>
   </div>
   <ActivityTimeline key={String(prospect.id)} prospect={prospect} enabled={enabled} onLogActivity={onLogActivity} onGetActivities={onGetActivities} canEdit={canEdit}/>
  </div>}
  {message&&<p role="status" style={{fontSize:12,color:"var(--pf-tx-127C5B)",background:"var(--pf-bg-EAF8F1)",borderRadius:8,padding:11,marginTop:14}}>{message}</p>}
  {error&&<p role="alert" style={{fontSize:12,color:"var(--pf-tx-A54543)",background:"var(--pf-bg-FFF0EE)",borderRadius:8,padding:11,marginTop:14}}>{error}</p>}
 </div>;
}
