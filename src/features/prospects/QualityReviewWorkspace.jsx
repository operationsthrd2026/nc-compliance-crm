import React, {useMemo,useState} from "react";
import {qualityRows,qualitySummary,filterQualityRows,qualityReviewCsv,QUALITY_ISSUE_FILTERS} from "../../lib/qualityReview.js";
import {localDateKey} from "../../lib/outreachPlanning.js";
import {safeWebsite} from "../../lib/contactDetails.js";

const card={background:"var(--pf-bg-FFFFFF)",border:"1px solid var(--pf-bd-E5EAF4)",borderRadius:15,padding:19,minWidth:0};
const muted="var(--pf-bd-75849B)",ink="var(--pf-bd-223250)",purple="var(--pf-bd-6656DC)";
const field={background:"var(--pf-bg-FFFFFF)",border:"1px solid var(--pf-bd-DAE2F0)",color:ink,borderRadius:10,padding:"10px 11px",fontSize:12,width:"100%"};
const label={display:"grid",gap:6,fontSize:11,fontWeight:760,color:"var(--pf-tx-536482)"};
const button={border:0,background:purple,color:"#fff",borderRadius:10,padding:"11px 15px",fontWeight:760,fontSize:12,cursor:"pointer"};
const buttonOutline={...button,background:"var(--pf-bg-FFFFFF)",border:"1px solid var(--pf-bd-E3E8F2)",color:"var(--pf-tx-4E5F79)"};
const pill=(tone="medium")=>({
 fontSize:10,fontWeight:780,padding:"5px 8px",borderRadius:20,whiteSpace:"nowrap",
 color:tone==="high"?"var(--pf-tx-B5464F)":tone==="low"?"var(--pf-tx-526483)":"var(--pf-tx-6653B3)",
 background:tone==="high"?"var(--pf-bg-FFF0F0)":tone==="low"?"var(--pf-bg-EFF2F8)":"var(--pf-bg-F2EEFF)"
});
function exportCsv(text){
 const url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));
 const link=document.createElement("a");link.href=url;
 link.download="prospectfinder-quality-review-"+localDateKey()+".csv";
 document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
function Metric({name,value,note,active,onClick}){
 return <button type="button" onClick={onClick}
  style={{...card,cursor:"pointer",textAlign:"left",borderColor:active?"var(--pf-bd-8D80EE)":"var(--pf-bd-E5EAF4)",background:active?"var(--pf-bg-F8F6FF)":"white"}}>
  <span style={{display:"block",fontSize:10,fontWeight:780,color:muted}}>{name}</span>
  <strong style={{display:"block",fontSize:25,margin:"8px 0 5px",color:ink}}>{value.toLocaleString()}</strong>
  <small style={{color:muted,lineHeight:1.5}}>{note}</small>
 </button>;
}
function ReviewDetail({row,onClose,onOpenProspect}){
 const p=row.prospect,source=safeWebsite(p.sourceUrl);
 return <aside style={{...card,position:"sticky",top:18,alignSelf:"start",display:"grid",gap:14,maxHeight:"calc(100vh - 36px)",overflowY:"auto"}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"start"}}>
   <div><div style={{fontSize:10,fontWeight:850,color:purple,letterSpacing:1}}>RECORD REVIEW</div>
    <h2 style={{fontSize:19,color:ink,lineHeight:1.3,margin:"7px 0 3px",overflowWrap:"anywhere"}}>{p.companyName||"Unnamed organization"}</h2>
    <div style={{fontSize:11,color:muted}}>{row.category} · {p.cityMarket||p.market||"Unknown location"}</div></div>
   <button type="button" aria-label="Close review details" onClick={onClose} style={{...buttonOutline,padding:"5px 10px"}}>×</button>
  </div>
  <div style={{background:"var(--pf-bg-F8F6FF)",borderRadius:11,padding:13}}>
   <div style={{fontSize:10,color:"var(--pf-tx-6755A9)",fontWeight:800}}>RECOMMENDED MANUAL NEXT STEP</div>
   <p style={{fontSize:12,color:"var(--pf-tx-3D316D)",fontWeight:750,lineHeight:1.6,margin:"7px 0 0"}}>{row.nextAction}</p>
  </div>
  <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
   <span style={pill(row.highIssues?"high":"medium")}>{row.issues.length} possible quality issue(s)</span>
   <span style={pill("low")}>{row.readiness}</span>
   {row.fitScore!==null&&<span style={pill("medium")}>Fit {row.fitScore}/100</span>}
  </div>
  <section><h3 style={{fontSize:13,color:ink,margin:"0 0 9px"}}>Items to review</h3>
   {row.issues.length?row.issues.map(issue=><div key={issue.id} style={{borderTop:"1px solid var(--pf-bd-EEF1F7)",padding:"12px 0"}}>
    <div style={{display:"flex",alignItems:"start",justifyContent:"space-between",gap:8}}><strong style={{fontSize:11,color:ink}}>{issue.label}</strong><span style={pill(issue.severity)}>{issue.severity}</span></div>
    <p style={{fontSize:11,color:"var(--pf-tx-586983)",lineHeight:1.6,margin:"7px 0 0"}}>{issue.action}</p>
    {issue.extra&&<p style={{fontSize:10,color:muted,overflowWrap:"anywhere",lineHeight:1.5,margin:"6px 0 0"}}>{issue.extra}</p>}
   </div>):<p style={{fontSize:12,color:muted}}>No issues flagged by the automatic review. This does not establish accuracy or verification.</p>}
  </section>
  <section><h3 style={{fontSize:13,color:ink,margin:"0 0 9px"}}>Source evidence</h3>
   <div style={{display:"grid",gap:9,fontSize:11}}>
    <div>Official website: {row.details.website?<a href={row.details.website} target="_blank" rel="noopener noreferrer" style={{color:purple,overflowWrap:"anywhere"}}>Open listed website ↗</a>:<span style={{color:muted}}>Not recorded</span>}</div>
    <div>Original directory/source: {source?<a href={source} target="_blank" rel="noopener noreferrer" style={{color:purple,overflowWrap:"anywhere"}}>Open source page ↗</a>:<span style={{color:muted}}>Not recorded</span>}</div>
    <div>Contact: {row.readiness} (not independently verified)</div>
   </div>
  </section>
  {row.fitScore!==null&&<section><h3 style={{fontSize:13,color:ink,margin:"0 0 7px"}}>Why this fit score?</h3>
   <p style={{fontSize:11,color:muted,lineHeight:1.6,margin:"0 0 7px"}}>Existing CRM HR-service fit rubric. This is not a conversion probability or a verified contact ranking.</p>
   {row.fitFactors.map(f=><div key={f.key} style={{borderTop:"1px solid var(--pf-bd-F0F2F8)",padding:"8px 0",fontSize:11}}>
     <div style={{display:"flex",justifyContent:"space-between",gap:9,color:"var(--pf-tx-3A4B67)"}}><strong>{f.label}</strong><strong>{f.points}/{f.max}</strong></div>
     <div style={{fontSize:10,color:muted,lineHeight:1.45,marginTop:3}}>{f.note}</div>
    </div>)}
  </section>}
  <button style={button} onClick={()=>onOpenProspect(row.id)}>Open qualification editor →</button>
  <p style={{fontSize:10,color:muted,margin:0,lineHeight:1.65}}>Opening the editor does not automatically alter, email or merge records. Confirm contacts and duplicate matches manually before taking action.</p>
 </aside>;
}

export default function QualityReviewWorkspace({crmData=[],onOpenProspect,onOpenCRM}){
 const [mode,setMode]=useState("quality"),[category,setCategory]=useState("All organizations");
 const [issue,setIssue]=useState("All issues"),[query,setQuery]=useState("");
 const [includeClosed,setIncludeClosed]=useState(false),[selectedId,setSelectedId]=useState(null);
 const [page,setPage]=useState(0);
 const [quick,setQuick]=useState("All active");
 const asOf=localDateKey();
 const rows=useMemo(()=>qualityRows(crmData,asOf),[crmData,asOf]);
 const summary=useMemo(()=>qualitySummary(rows),[rows]);
 const scoped=useMemo(()=>{
  const filtered=filterQualityRows(rows,{query,category,issue,mode,includeClosed});
  if(quick==="Needs review")return filtered.filter(r=>r.issues.length>0);
  if(quick==="High attention")return filtered.filter(r=>r.highIssues>0);
  if(quick==="Potential duplicates")return filtered.filter(r=>!!r.duplicate);
  if(quick==="Missing contacts")return filtered.filter(r=>r.issues.some(x=>x.id==="No usable contact"));
  if(quick==="Excluded")return filtered.filter(r=>r.closed);
  return filtered;
 },[rows,query,category,issue,mode,includeClosed,quick]);
 const reset=()=>{setCategory("All organizations");setIssue("All issues");setQuery("");setIncludeClosed(false);setQuick("All active");setPage(0);};
 const chooseQuick=selected=>{setQuick(selected);setIncludeClosed(selected==="Excluded");setPage(0);};
 const pages=Math.max(1,Math.ceil(scoped.length/20));
 const currentPage=Math.min(page,pages-1);
 const visible=scoped.slice(currentPage*20,currentPage*20+20);
 const selected=rows.find(r=>r.id===selectedId)||null;
 const metrics=[
  ["All active",summary.active,"Not converted or blocked"],
  ["Needs review",summary.needsReview,"One or more quality flags"],
  ["High attention",summary.highAttention,"At least one high-impact flag"],
  ["Potential duplicates",summary.possibleDuplicates,"Human review needed"],
  ["Missing contacts",summary.missingContacts,"No valid email or phone"],
  ["Excluded",summary.excluded,"Converted or do-not-contact"]
 ];
 return <div>
  <div className="pf-page-kicker">PHASE 7 · DATA QUALITY & LEAD PRIORITY</div>
  <h1 className="pf-page-title">Lead quality & priority review</h1>
  <p className="pf-page-description">Review missing prospect evidence, possible duplicate records and explainable lead-fit rankings. This is a read-only decision workspace; all edits use your existing CRM qualification editor.</p>
  <section aria-label="Quality review summary" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(165px,1fr))",gap:11,margin:"22px 0 18px"}}>
   {metrics.map(([name,value,note])=><Metric key={name} name={name} value={value} note={note} active={quick===name} onClick={()=>chooseQuick(name)}/>)}
  </section>
  <div role="group" aria-label="Review mode" style={{display:"inline-flex",gap:7,padding:5,borderRadius:13,background:"var(--pf-bg-EAECF7)",margin:"2px 0 18px"}}>
   <button type="button" style={{...(mode==="quality"?button:buttonOutline),boxShadow:"none"}} onClick={()=>{setMode("quality");setPage(0);}}>Quality review</button>
   <button type="button" style={{...(mode==="priority"?button:buttonOutline),boxShadow:"none"}} onClick={()=>{setMode("priority");setPage(0);}}>Lead priority shortlist</button>
  </div>
  <section style={{...card,marginBottom:17}}>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(165px,1fr))",gap:12}}>
    <label style={label}>Find saved organization<input type="search" style={field} placeholder="Name, status, location…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>
    <label style={label}>Organization type<select style={field} value={category} onChange={e=>{setCategory(e.target.value);setPage(0);}}>
     <option>All organizations</option><option>Nonprofit</option><option value="Business / Other">Small businesses / Other</option>
    </select></label>
    <label style={label}>Quality issue<select style={field} value={issue} onChange={e=>{setIssue(e.target.value);setPage(0);}}>
     {QUALITY_ISSUE_FILTERS.map(x=><option key={x}>{x}</option>)}
    </select></label>
   </div>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap",marginTop:15}}>
    <label style={{fontSize:11,color:"var(--pf-tx-60718A)",display:"inline-flex",alignItems:"center",gap:7}}>
     <input type="checkbox" checked={includeClosed} onChange={e=>{setIncludeClosed(e.target.checked);setQuick("All active");setPage(0);}}/> Include converted and do-not-contact records
    </label>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <button style={buttonOutline} onClick={reset}>Reset filters</button>
     <button style={button} onClick={()=>exportCsv(qualityReviewCsv(scoped,asOf))}>↓ Export review CSV</button>
    </div>
   </div>
  </section>
  <p style={{fontSize:11,color:muted,margin:"0 0 14px",lineHeight:1.6}}>
   Showing {scoped.length.toLocaleString()} of {crmData.length.toLocaleString()} visible CRM records. {mode==="quality"?"Highest attention flags are listed first.":"Ranked by existing explainable HR-fit rubric, not by a predicted response rate."}
  </p>
  <div style={{display:"grid",gridTemplateColumns:selected?"minmax(0,1.35fr) minmax(310px,.85fr)":"minmax(0,1fr)",gap:16,alignItems:"start"}}>
   <section style={{...card,overflowX:"auto"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"}}>
     <h2 style={{fontSize:15,color:ink,margin:0}}>{mode==="quality"?"Data quality worklist":"Explainable lead priorities"}</h2>
     <button type="button" className="pf-link" onClick={onOpenCRM}>Classic CRM ↗</button>
    </div>
    <table className="pf-recent" style={{minWidth:700,width:"100%"}}>
     <thead><tr><th>ORGANIZATION</th><th>{mode==="quality"?"QUALITY FLAGS":"FIT SCORE"}</th><th>CONTACT</th><th>SUGGESTED MANUAL ACTION</th><th>REVIEW</th></tr></thead>
     <tbody>{visible.map(row=><tr key={String(row.id)} style={{background:selectedId===row.id?"var(--pf-bg-F6F3FF)":"transparent"}}>
      <td style={{minWidth:150}}>
       <strong className="pf-name" style={{overflowWrap:"anywhere"}}>{row.prospect.companyName||"Unnamed organization"}</strong>
       <div style={{fontSize:10,color:muted,marginTop:5}}>{row.category} · {row.prospect.currentStatus||"NEW"}</div>
       <div style={{fontSize:10,color:muted,marginTop:3}}>{row.prospect.cityMarket||row.prospect.market||""}</div>
      </td>
      <td>{mode==="quality"?<>
       {row.highIssues>0&&<span style={pill("high")}>{row.highIssues} high</span>}
       <div style={{fontSize:11,marginTop:5,color:"var(--pf-tx-485871)"}}>{row.issues.length} item(s) to review</div>
       {row.duplicate&&<div style={{marginTop:6}}><span style={pill(row.duplicate.level)}>Possible duplicate</span></div>}
      </>:<><strong style={{fontSize:19,color:ink}}>{row.fitScore??"—"}</strong>{row.fitScore!==null&&<span style={{fontSize:10,color:muted}}>/100</span>}
       <div style={{fontSize:10,color:muted,marginTop:4}}>Rubric: {row.fitTier}</div>
      </>}</td>
      <td><span style={pill(row.readiness==="Do not contact"?"high":"low")}>{row.readiness}</span></td>
      <td style={{fontSize:11,color:"var(--pf-tx-485B78)",lineHeight:1.5,maxWidth:230}}>{row.nextAction}</td>
      <td><button type="button" className="pf-link" onClick={()=>setSelectedId(row.id)}>Inspect →</button></td>
     </tr>)}</tbody>
    </table>
    {!visible.length&&<div className="pf-empty">No matching saved leads. Adjust the filters or use Find Prospects to discover new organizations.</div>}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:9,flexWrap:"wrap",marginTop:15}}>
     <span style={{fontSize:11,color:muted}}>Page {currentPage+1} of {pages}</span>
     <div style={{display:"flex",gap:9}}>
      <button type="button" style={buttonOutline} disabled={currentPage===0} onClick={()=>setPage(v=>Math.max(0,v-1))}>Previous</button>
      <button type="button" style={buttonOutline} disabled={currentPage>=pages-1} onClick={()=>setPage(v=>Math.min(pages-1,v+1))}>Next</button>
     </div>
    </div>
   </section>
   {selected&&<ReviewDetail row={selected} onClose={()=>setSelectedId(null)} onOpenProspect={onOpenProspect}/>}
  </div>
  <p className="pf-footnote">Potential duplicates are suggestions, not confirmed matches. Contact presence is not verification. CSV exports include organization-level review information only, not names, emails or phone numbers. This page never changes records or sends outreach.</p>
 </div>;
}
