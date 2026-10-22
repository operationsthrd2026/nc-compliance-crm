import {qualityRows} from "./qualityReview.js";
import {followupItem,localDateKey} from "./outreachPlanning.js";

export const WORKFLOW_BUCKETS=[
 "All actions","Immediate review","Overdue","Due today","Research","Upcoming","Ready"
];
export const WORKFLOW_CATEGORIES=["All organizations","Nonprofit","Business / Other"];
export const WORKFLOW_SORTS=["urgency","fit"];
const ORDER={"Immediate review":0,"Overdue":1,"Due today":2,"Research":3,"Upcoming":4,"Ready":5};
const text=value=>String(value??"").trim();
const PROHIBITED=new Set(["Do Not Respond","Converted"]);
const shortName=p=>text(p.companyName||"Unnamed organization").slice(0,125);

export function workflowAction(row,asOf=localDateKey()){
 const p=row.prospect;
 // Suppress all terminal leads; never propose outreach for blocked prospects.
 if(row.closed||p.doNotRespond||PROHIBITED.has(p.currentStatus))return null;
 const follow=followupItem(p,asOf);
 const has=id=>row.issues.some(x=>x.id===id);
 const named=shortName(p);
 const result=(bucket,kind,action,taskTitle,route,why)=>({
  id:p.id,prospect:p,category:row.category,bucket,kind,action,taskTitle,route,
  why,fitScore:row.fitScore,qualityFlags:row.issues.length,
  dueDate:follow?.dueDate||"",followupBucket:follow?.bucket||"",
  // This is decision support, not a trigger for communications.
  requiresManualReview:true
 });
 if(p.replyReceived||p.currentStatus==="Replied")
  return result("Immediate review","Reply flagged","Review the reply and decide the next step.",
   "Review prospect reply — "+named,"qualification","A reply has been recorded.");
 if(follow?.needsApproval)
  return result("Immediate review","Approval gate","Request/confirm approval before Touch 3.",
   "Request Touch 3 approval — "+named,"outreach","Third-touch approval is required.");
 if(p.flagToMelissa)
  return result("Immediate review","Flagged for review","Complete internal review before further outreach.",
   "Review flagged prospect — "+named,"qualification","The prospect is flagged for management review.");
 if(row.duplicate?.level==="high")
  return result("Immediate review","Potential duplicate","Inspect possible duplicate records before proceeding.",
   "Review possible CRM duplicate — "+named,"quality","High-confidence duplicate signals were detected; not a confirmed match.");
 if(has("Email needs review"))
  return result("Immediate review","Email needs checking","Review the invalid email; do not send outreach.",
   "Check recorded email — "+named,"qualification","The email field or verification status requires correction.");
 if(has("No usable contact"))
  return result("Research","Contact research","Find a publicly listed contact before preparing outreach.",
   "Research public contact — "+named,"qualification","No usable email or phone is on file.");
 if(has("No source link")||has("No official website"))
  return result("Research","Source research","Check the organization's own website and original source.",
   "Verify organization source — "+named,"quality","Source or original website evidence is incomplete.");
 if(has("No contact evidence"))
  return result("Research","Contact evidence","Record where listed contact information was checked.",
   "Document contact evidence — "+named,"qualification","A listed contact is not necessarily verified.");
 if(follow?.bucket==="Overdue")
  return result("Overdue","Overdue follow-up","Review the overdue follow-up; log any completed outreach manually.",
   "Review overdue "+follow.label+" — "+named,"outreach","A scheduled follow-up is overdue.");
 if(follow?.bucket==="Today")
  return result("Due today","Follow-up today","Review today's due follow-up before any outreach.",
   "Review due "+follow.label+" — "+named,"outreach","A scheduled follow-up is due today.");
 if(follow?.bucket==="Next 7 days"||follow?.bucket==="Later")
  return result("Upcoming","Upcoming follow-up","Prepare for the scheduled follow-up.",
   "Prepare "+follow.label+" — "+named,"outreach","An existing follow-up has a future due date.");
 if(row.issues.length)
  return result("Research","Qualification review","Review outstanding qualification fields.",
   "Complete qualification — "+named,"qualification","One or more data quality fields need attention.");
 if(follow?.bucket==="Unscheduled")
  return result("Research","Missing due date","Review the outreach schedule and choose a due date.",
   "Schedule "+follow.label+" — "+named,"outreach","This active outreach step has no due date.");
 return result("Ready","Manual preparation","Review the prospect and prepare an appropriate next step.",
  "Review next prospect step — "+named,"qualification","No immediate blockers were flagged automatically.");
}

export function buildWorkflowQueue(leads=[],asOf=localDateKey()){
 return qualityRows(leads,asOf).map(row=>workflowAction(row,asOf)).filter(Boolean)
  .sort((a,b)=>(ORDER[a.bucket]??9)-(ORDER[b.bucket]??9)
   ||(a.dueDate||"9999-12-31").localeCompare(b.dueDate||"9999-12-31")
   ||(b.fitScore??-1)-(a.fitScore??-1)
   ||shortName(a.prospect).localeCompare(shortName(b.prospect)));
}
export function normalizeWorkflowView(raw={}){
 const p=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
 return {
  category:WORKFLOW_CATEGORIES.includes(p.category)?p.category:"All organizations",
  bucket:WORKFLOW_BUCKETS.includes(p.bucket)?p.bucket:"All actions",
  sort:WORKFLOW_SORTS.includes(p.sort)?p.sort:"urgency",
  query:text(p.query).slice(0,120)
 };
}
export function filterWorkflowQueue(items=[],raw={}){
 const opts=normalizeWorkflowView(raw);
 const q=opts.query.toLocaleLowerCase();
 const out=items.filter(item=>
  (opts.category==="All organizations"||item.category===opts.category)
  &&(opts.bucket==="All actions"||item.bucket===opts.bucket)
  &&(!q||[item.prospect.companyName,item.prospect.cityMarket,item.prospect.market,
   item.prospect.vertical,item.kind,item.action,item.category]
   .some(x=>text(x).toLocaleLowerCase().includes(q)))
 );
 return [...out].sort((a,b)=>{
  if(opts.sort==="fit")
   return (b.fitScore??-1)-(a.fitScore??-1)||(ORDER[a.bucket]??9)-(ORDER[b.bucket]??9)
    ||shortName(a.prospect).localeCompare(shortName(b.prospect));
  return (ORDER[a.bucket]??9)-(ORDER[b.bucket]??9)
   ||(a.dueDate||"9999-12-31").localeCompare(b.dueDate||"9999-12-31")
   ||(b.fitScore??-1)-(a.fitScore??-1)
   ||shortName(a.prospect).localeCompare(shortName(b.prospect));
 });
}
export function workflowCounts(items=[]){
 const counts=Object.fromEntries(WORKFLOW_BUCKETS.map(b=>[b,0]));
 counts["All actions"]=items.length;
 for(const item of items)if(Object.hasOwn(counts,item.bucket))counts[item.bucket]++;
 return counts;
}
export function validatePresetName(name){
 const trimmed=text(name);
 if(!trimmed||trimmed.length>80)throw new Error("Name must be 1–80 characters.");
 return trimmed;
}
function csvCell(value){
 const raw=String(value??"");
 return '"'+(/^\s*[=+\-@\t\r]/.test(raw)?"'"+raw:raw).replaceAll('"','""')+'"';
}
export function workflowCsv(items=[],asOf=localDateKey()){
 const header=["Organization","Type","Current stage","Location","Queue","Action type",
  "Suggested manual action","Due date","Fit rubric score","Quality issues","Report date"];
 const rows=items.map(x=>[
  x.prospect.companyName||"",x.category,x.prospect.currentStatus||"NEW",
  x.prospect.cityMarket||x.prospect.market||"",x.bucket,x.kind,x.action,
  x.dueDate,x.fitScore??"",x.qualityFlags,asOf
 ]);
 return [header,...rows].map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n";
}
