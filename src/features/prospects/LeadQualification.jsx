import React, {useEffect,useMemo,useState} from "react";
import {safeOrganizationWebsite,safeEmail,safePhone} from "../../lib/contactDetails.js";
import {LEAD_STAGES,contactDetails,contactReadiness,filterSavedLeads,leadCategory,readinessCounts} from "../../lib/leadQualification.js";

const fLabel={fontSize:11,color:"#63718B",fontWeight:750,display:"grid",gap:6};
const input={border:"1px solid #DDE3EF",borderRadius:9,padding:"10px 12px",fontSize:12,color:"#1D2B45",width:"100%",background:"#fff",minWidth:0};
const link={color:"#5C49C7",fontWeight:700,textDecoration:"none"};
const PAGE=25;
const statusName=v=>String(v||"NEW").replaceAll("_"," ");
function Details({selected,onUpdateProspect,canEdit,onOpenCRM,onClose}) {
 const [draft,setDraft]=useState({});
 const [saving,setSaving]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
 useEffect(()=>{
  if(!selected)return;
  const channels=contactDetails(selected);
  setDraft({
   currentStatus:selected.currentStatus||"NEW",
   contactName:selected.contactName||"",title:selected.title||"",
   email:channels.email,phone:channels.phone,website:channels.website,
   outreachNotes:selected.outreachNotes||"",verificationNotes:selected.verificationNotes||"",
   doNotRespond:!!selected.doNotRespond||selected.currentStatus==="Do Not Respond",
   flagToMelissa:!!selected.flagToMelissa
  });
  setError("");setSuccess("");
 },[selected?.id]);
 if(!selected)return null;
 const readiness=contactReadiness(selected);
 const change=(k,v)=>{setDraft(old=>({...old,[k]:v}));setError("");setSuccess("");};
 const save=async()=>{
  if(!canEdit||saving)return;
  const rawWebsite=String(draft.website||"").trim(),rawEmail=String(draft.email||"").trim(),rawPhone=String(draft.phone||"").trim();
  const website=safeOrganizationWebsite(rawWebsite),email=safeEmail(rawEmail),phone=safePhone(rawPhone);
  if(rawWebsite&&!website){setError("Enter a valid organization website (not a directory/social profile), or leave it blank.");return;}
  if(rawEmail&&!email){setError("Enter one valid email address, or leave it blank.");return;}
  if(rawPhone&&!phone){setError("Enter a valid public phone number, or leave it blank.");return;}
  const doNotRespond=!!draft.doNotRespond||draft.currentStatus==="Do Not Respond";
  setSaving(true);setError("");setSuccess("");
  try{
   await onUpdateProspect({
    id:selected.id,
    changes:{
     currentStatus:draft.currentStatus,contactName:String(draft.contactName||"").trim().slice(0,180),
     title:String(draft.title||"").trim().slice(0,180),
     website,email,phone,emailPhone:[email,phone].filter(Boolean).join(" | "),
     outreachNotes:String(draft.outreachNotes||"").slice(0,5000),
     verificationNotes:String(draft.verificationNotes||"").slice(0,2500),
     doNotRespond,flagToMelissa:!!draft.flagToMelissa
    }
   });
   setSuccess("Saved to CRM.");
  }catch(e){setError("Changes were not saved: "+(e?.message||"Check your permissions or connection."));}
  finally{setSaving(false);}
 };
 return <section aria-label={"Qualify "+selected.companyName} className="pf-card" style={{position:"sticky",top:20,alignSelf:"start",display:"grid",gap:13,padding:19,maxHeight:"calc(100vh - 40px)",overflowY:"auto"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
   <div><div style={{fontSize:10,color:"#7761D8",fontWeight:850,letterSpacing:1}}>LEAD QUALIFICATION</div>
    <h3 style={{fontSize:18,lineHeight:1.3,margin:"6px 0",color:"#1B2944"}}>{selected.companyName||"Unnamed organization"}</h3>
    <div style={{fontSize:11,color:"#74829B"}}>{selected.vertical||"Uncategorized"} · {selected.cityMarket||selected.market||"Location unavailable"}</div></div>
   <button type="button" onClick={onClose} aria-label="Close prospect details" style={{background:"#F0F2F8",border:0,borderRadius:8,padding:"6px 11px",fontSize:16}}>×</button>
  </div>
  <div style={{background:"#F5F3FF",padding:10,borderRadius:10,fontSize:11,color:"#5242AF"}}><strong>Contact readiness:</strong> {readiness}. A listed contact is not necessarily verified.</div>
  {selected.sourceUrl&&<a href={selected.sourceUrl} rel="noopener noreferrer" target="_blank" style={{...link,fontSize:11,overflowWrap:"anywhere"}}>View original source ↗</a>}
  <label style={fLabel}>Pipeline status
   <select style={input} value={draft.currentStatus||"NEW"} disabled={!canEdit||saving} onChange={e=>change("currentStatus",e.target.value)}>
    {[...new Set([draft.currentStatus||"NEW",...LEAD_STAGES])].map(x=><option key={x} value={x}>{statusName(x)}</option>)}
   </select>
  </label>
  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
   <label style={fLabel}>Contact person<input style={input} disabled={!canEdit||saving} value={draft.contactName||""} onChange={e=>change("contactName",e.target.value)}/></label>
   <label style={fLabel}>Job title<input style={input} disabled={!canEdit||saving} value={draft.title||""} onChange={e=>change("title",e.target.value)}/></label>
  </div>
  <label style={fLabel}>Organization website<input style={input} disabled={!canEdit||saving} placeholder="https://example.org" value={draft.website||""} onChange={e=>change("website",e.target.value)}/></label>
  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
   <label style={fLabel}>Email<input style={input} disabled={!canEdit||saving} type="email" value={draft.email||""} onChange={e=>change("email",e.target.value)}/></label>
   <label style={fLabel}>Phone<input style={input} disabled={!canEdit||saving} value={draft.phone||""} onChange={e=>change("phone",e.target.value)}/></label>
  </div>
  <label style={fLabel}>Verification notes<textarea style={{...input,minHeight:66,resize:"vertical"}} disabled={!canEdit||saving} value={draft.verificationNotes||""} onChange={e=>change("verificationNotes",e.target.value)} placeholder="Record where each contact detail was checked. Do not mark AI/directory contacts as verified without evidence."/></label>
  <label style={fLabel}>Outreach notes<textarea style={{...input,minHeight:78,resize:"vertical"}} disabled={!canEdit||saving} value={draft.outreachNotes||""} onChange={e=>change("outreachNotes",e.target.value)} placeholder="Research findings, next action, contact attempts…"/></label>
  <div style={{display:"flex",gap:15,flexWrap:"wrap"}}>
   <label style={{fontSize:11,fontWeight:700,color:"#465472",display:"flex",gap:6,alignItems:"center"}}><input type="checkbox" checked={!!draft.doNotRespond||draft.currentStatus==="Do Not Respond"} disabled={!canEdit||saving||draft.currentStatus==="Do Not Respond"} onChange={e=>change("doNotRespond",e.target.checked)}/> Do not contact</label>
   <label style={{fontSize:11,fontWeight:700,color:"#465472",display:"flex",gap:6,alignItems:"center"}}><input type="checkbox" checked={!!draft.flagToMelissa} disabled={!canEdit||saving} onChange={e=>change("flagToMelissa",e.target.checked)}/> Flag for review</label>
  </div>
  {(selected.t2DueDate||selected.t3DueDate)&&<div style={{fontSize:11,color:"#687895"}}>Follow-up: {selected.t3DueDate||selected.t2DueDate} (managed by existing outreach pipeline)</div>}
  {error&&<div role="alert" style={{color:"#A33F40",fontSize:11,background:"#FFF2F2",padding:11,borderRadius:8}}>{error}</div>}
  {success&&<div role="status" style={{color:"#167C5D",fontSize:11,background:"#EDF9F3",padding:11,borderRadius:8}}>{success}</div>}
  <div style={{display:"flex",gap:9,flexWrap:"wrap"}}>
   {canEdit&&<button className="pf-button" disabled={saving} onClick={save}>{saving?"Saving…":"Save qualification"}</button>}
   <button className="pf-button outline" onClick={onOpenCRM}>Open Classic CRM ↗</button>
  </div>
  {!canEdit&&<p style={{fontSize:11,color:"#74829B",margin:0}}>View-only access. An editor, manager or administrator can save changes.</p>}
 </section>;
}
export default function LeadQualification({crmData=[],initialProspectId=null,onOpenCRM,onUpdateProspect,canEdit=false}) {
 const [query,setQuery]=useState(""),[status,setStatus]=useState("all"),[readiness,setReadiness]=useState("all");
 const [category,setCategory]=useState("all"),[page,setPage]=useState(0),[selectedId,setSelectedId]=useState(initialProspectId);
 const counts=useMemo(()=>readinessCounts(crmData),[crmData]);
 const filtered=useMemo(()=>filterSavedLeads(crmData,{query,status,readiness,category}),[crmData,query,status,readiness,category]);
 const sorted=useMemo(()=>[...filtered].reverse(),[filtered]);
 const pages=Math.max(1,Math.ceil(sorted.length/PAGE));
 const visible=sorted.slice(Math.min(page,pages-1)*PAGE,(Math.min(page,pages-1)+1)*PAGE);
 const selected=crmData.find(p=>p.id===selectedId)||null;
 const update=(setter)=>(v)=>{setter(v);setPage(0);};
 const statuses=[...new Set([...LEAD_STAGES,...crmData.map(p=>p.currentStatus||"NEW")])];
 return <div>
  <div className="pf-page-kicker">PHASE 2 · LEAD QUALIFICATION</div>
  <h1 className="pf-page-title">Saved prospects</h1>
  <p className="pf-page-description">Review contact completeness, filter your pipeline, and update qualification notes and statuses. Changes save to your existing CRM; no search API is needed.</p>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,margin:"23px 0 21px"}}>
   {[["All leads",crmData.length],["Contact listed",counts["Contact listed"]],["Website only",counts["Website only"]],["Needs research",counts["Needs research"]],["Do not contact",counts["Do not contact"]]].map(([label,n])=>
    <button key={label} type="button" onClick={()=>{setReadiness(label==="All leads"?"all":label);setPage(0);}} style={{background:"#fff",border:"1px solid "+((readiness===label||label==="All leads"&&readiness==="all")?"#8A78EF":"#E8ECF4"),borderRadius:13,padding:14,textAlign:"left",boxShadow:"0 3px 12px #17284907"}}>
     <span style={{display:"block",fontSize:10,color:"#71809B",fontWeight:750}}>{label}</span><strong style={{fontSize:24,color:"#1B2943",display:"block",marginTop:5}}>{n}</strong>
    </button>)}
  </div>
  <section className="pf-card" style={{marginBottom:17}}>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:11}}>
    <label style={fLabel}>Search organizations<input style={input} value={query} onChange={e=>update(setQuery)(e.target.value)} placeholder="Name, email, industry, location…"/></label>
    <label style={fLabel}>Pipeline status<select style={input} value={status} onChange={e=>update(setStatus)(e.target.value)}><option value="all">All statuses</option>{statuses.map(x=><option key={x} value={x}>{statusName(x)}</option>)}</select></label>
    <label style={fLabel}>Contact readiness<select style={input} value={readiness} onChange={e=>update(setReadiness)(e.target.value)}><option value="all">All contacts</option>{Object.keys(counts).map(x=><option key={x} value={x}>{x}</option>)}</select></label>
    <label style={fLabel}>Category<select style={input} value={category} onChange={e=>update(setCategory)(e.target.value)}><option value="all">All organizations</option><option value="Nonprofit">Nonprofit</option><option value="Business / Other">Business / Other</option></select></label>
   </div>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:14,gap:9,flexWrap:"wrap"}}>
    <span style={{fontSize:11,color:"#66758D"}}>{sorted.length} matching of {crmData.length} saved records</span>
    <button className="pf-link" onClick={()=>{setQuery("");setStatus("all");setReadiness("all");setCategory("all");setPage(0);}}>Clear filters</button>
   </div>
  </section>
  <div style={{display:"grid",gridTemplateColumns:selected?"minmax(0,1.35fr) minmax(290px,0.95fr)":"minmax(0,1fr)",gap:16,alignItems:"start"}}>
   <section className="pf-card" style={{minWidth:0}}>
    <div className="pf-card-top"><div><h3 className="pf-card-title">Qualification queue</h3><p className="pf-card-sub">Select an organization to review or edit its CRM record.</p></div><button className="pf-link" onClick={onOpenCRM}>Full pipeline ↗</button></div>
    <div style={{overflowX:"auto"}}>
     <table className="pf-recent" style={{minWidth:610}}>
      <thead><tr><th>ORGANIZATION</th><th>CONTACT READINESS</th><th>STATUS</th><th>LOCATION</th><th>REVIEW</th></tr></thead>
      <tbody>{visible.map(p=>{
       const readiness=contactReadiness(p),channels=contactDetails(p);
       return <tr key={p.id} style={{background:selectedId===p.id?"#F7F5FF":"transparent"}}>
        <td><strong className="pf-name">{p.companyName||"Unnamed prospect"}</strong><div style={{fontSize:10,color:"#8B97AA",marginTop:3}}>{leadCategory(p)} · {p.vertical||"Uncategorized"}</div>
         <div style={{fontSize:10,color:"#60708C",marginTop:4}}>{channels.email||channels.phone||""}</div></td>
        <td><span className="pf-tag">{readiness}</span></td>
        <td><span className={"pf-tag "+(/replied|converted/i.test(p.currentStatus||"")?"green":/sent|nurture/i.test(p.currentStatus||"")?"blue":/do not/i.test(p.currentStatus||"")?"red":"")}>{statusName(p.currentStatus)}</span></td>
        <td>{p.cityMarket||p.market||"—"}</td>
        <td><button className="pf-link" aria-label={"Review "+p.companyName} onClick={()=>setSelectedId(p.id)}>Review →</button></td>
       </tr>;
      })}</tbody>
     </table>
     {!visible.length&&<div className="pf-empty">No saved prospects match these filters. Change the filters or open your existing CRM.</div>}
    </div>
    {sorted.length>PAGE&&<div style={{display:"flex",gap:10,alignItems:"center",justifyContent:"flex-end",marginTop:17}}>
     <button className="pf-button outline" disabled={page===0} onClick={()=>setPage(v=>Math.max(0,v-1))}>Previous</button>
     <span style={{fontSize:11,color:"#6A7993"}}>Page {Math.min(page,pages-1)+1} of {pages}</span>
     <button className="pf-button outline" disabled={page>=pages-1} onClick={()=>setPage(v=>Math.min(pages-1,v+1))}>Next</button>
    </div>}
   </section>
   {selected&&<Details key={selectedId} selected={selected} canEdit={canEdit} onOpenCRM={onOpenCRM} onUpdateProspect={onUpdateProspect} onClose={()=>setSelectedId(null)}/>}
  </div>
 </div>;
}