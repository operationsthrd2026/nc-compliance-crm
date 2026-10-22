import { findDuplicateGroups } from "./dedupe.js";
import { contactDetails, contactReadiness, leadCategory } from "./leadQualification.js";
import { safeWebsite } from "./contactDetails.js";
import { scoreProspect } from "./scoring.js";
import { followupItem, localDateKey } from "./outreachPlanning.js";

const CLOSED = new Set(["Converted", "Do Not Respond"]);
export const QUALITY_ISSUE_FILTERS = [
 "All issues", "Potential duplicate", "No usable contact", "Email needs review",
 "No official website", "No source link", "No contact person",
 "No location", "No industry", "No contact evidence"
];

export function isBlocked(p={}){
 return !!p.doNotRespond || p.currentStatus==="Do Not Respond";
}
export function isClosed(p={}){
 return isBlocked(p) || CLOSED.has(p.currentStatus);
}
function text(v){return String(v??"").trim();}
function addIssue(issues,id,label,severity,action,extra=""){
 issues.push({id,label,severity,action,extra});
}
export function issuesForProspect(p={},duplicate=null){
 const issues=[];
 if(isClosed(p))return issues; // no research/outreach task for terminal records
 const d=contactDetails(p);
 const invalid=String(p.emailStatus||"").toLowerCase()==="invalid"
  ||(text(p.email)!==""&&!d.email);
 if(duplicate) addIssue(issues,"Potential duplicate","Potential duplicate",duplicate.level==="high"?"high":"medium",
  "Review the matched CRM records before considering a manual merge.",
  duplicate.reasons.join("; "));
 if(invalid)addIssue(issues,"Email needs review","Email needs review","high",
  "Check the address against the original public source; do not send while unresolved.");
 if(!d.email&&!d.phone)addIssue(issues,"No usable contact","No usable contact","high",
  "Research a publicly listed email or phone number; do not invent a contact.");
 if(!d.website)addIssue(issues,"No official website","No official website","medium",
  "Find the organization's original website, not a directory profile.");
 if(!safeWebsite(p.sourceUrl))addIssue(issues,"No source link","No source link","medium",
  "Record a valid original source page to support the listing.");
 if(!text(p.contactName))addIssue(issues,"No contact person","No contact person","low",
  "Identify an appropriate publicly listed contact if available.");
 if(!text(p.cityMarket)&&!text(p.market))addIssue(issues,"No location","No location","medium",
  "Confirm the organization's location from a reliable source.");
 if(!text(p.vertical))addIssue(issues,"No industry","No industry","medium",
  "Classify this organization's industry.");
 if((d.email||d.phone)&&!text(p.verificationNotes))addIssue(issues,"No contact evidence","No contact evidence","medium",
  "Record where and when the listed contact was checked; a listing alone is not verification.");
 const rank={high:0,medium:1,low:2};
 return issues.sort((a,b)=>rank[a.severity]-rank[b.severity]||a.label.localeCompare(b.label));
}

export function nextReviewAction(p,issues=[],asOf=localDateKey()){
 if(isBlocked(p))return "Do not contact — record excluded";
 if(p.currentStatus==="Converted")return "Converted — no prospecting action";
 if(p.replyReceived||p.currentStatus==="Replied")return "Review reply before further outreach";
 const dupe=issues.find(x=>x.id==="Potential duplicate");
 if(dupe?.severity==="high")return "Review possible duplicate before contacting";
 if(p.flagToMelissa)return "Complete internal review before further outreach";
 const next=followupItem(p,asOf);
 if(next?.needsApproval)return "Obtain approval before Touch 3";
 const invalid=issues.some(x=>x.id==="Email needs review");
 if(invalid)return "Check invalid email before sending";
 if(issues.some(x=>x.id==="No usable contact"))return "Research a public contact";
 if(next?.bucket==="Overdue")return "Review overdue "+next.label+" (manual)";
 if(next?.bucket==="Today")return "Review today's "+next.label+" (manual)";
 if(next?.bucket==="Next 7 days")return "Prepare "+next.label+" for scheduled review";
 if(issues.some(x=>x.id==="No source link"))return "Confirm original listing source";
 if(issues.some(x=>x.id==="No official website"))return "Confirm official organization website";
 if(p.currentStatus==="NEW")return "Qualify contact and prepare Touch 1";
 return "Review qualification and next outreach step";
}

export function qualityRows(leads=[],asOf=localDateKey()){
 // Normalize the explicit public contact fields before reusing CRM dedupe.
 // A directory page is never considered the organization's domain.
 const allowed=leads.filter(p=>p&&p.id!=null&&text(p.companyName)).map(p=>{
  const d=contactDetails(p);
  return {...p,emailPhone:[d.email,d.phone].filter(Boolean).join(" | "),
   sourceUrl:d.website||""};
 });
 const groups=findDuplicateGroups(allowed);
 const dupes=new Map();
 for(const group of groups) for(const p of group.members){
  const previous=dupes.get(String(p.id));
  if(!previous||previous.level==="medium"&&group.level==="high")
   dupes.set(String(p.id),{level:group.level,reasons:group.reasons,members:group.members.length});
 }
 return leads.map(p=>{
  const duplicate=dupes.get(String(p.id))||null;
  const details=contactDetails(p);
  const issues=issuesForProspect(p,duplicate);
  const blocked=isBlocked(p);
  const closed=isClosed(p);
  // Leverage the existing transparent HR-fit rubric, but only count real
  // public contact fields and a confirmed original website as online presence.
  const fit=scoreProspect({...p,emailPhone:[details.email,details.phone].filter(Boolean).join(" | "),
    sourceUrl:details.website||""});
  const urgent=issues.filter(x=>x.severity==="high").length;
  return {
   id:p.id,prospect:p,category:leadCategory(p),readiness:contactReadiness(p),details,
   blocked,closed,duplicate,issues,highIssues:urgent,
   fitScore:closed?null:fit.score,fitTier:closed?"closed":fit.tier,fitFactors:fit.factors,
   nextAction:nextReviewAction(p,issues,asOf),
   qualityPriority:closed?-1:urgent*10+issues.length,
  };
 });
}

export function qualitySummary(rows=[]){
 const active=rows.filter(r=>!r.closed);
 return {
  total:rows.length, active:active.length,
  needsReview:active.filter(r=>r.issues.length>0).length,
  highAttention:active.filter(r=>r.highIssues>0).length,
  possibleDuplicates:active.filter(r=>r.duplicate).length,
  missingContacts:active.filter(r=>r.issues.some(x=>x.id==="No usable contact")).length,
  contactListed:active.filter(r=>r.readiness==="Contact listed").length,
  excluded:rows.length-active.length
 };
}
export function filterQualityRows(rows=[],{
 query="",category="All organizations",issue="All issues",
 mode="quality",includeClosed=false
}={}){
 const q=text(query).toLocaleLowerCase();
 return rows.filter(r=>{
  if(!includeClosed&&r.closed)return false;
  if(category!=="All organizations"&&r.category!==category)return false;
  if(issue!=="All issues"&&!r.issues.some(x=>x.id===issue))return false;
  if(!q)return true;
  return [r.prospect.companyName,r.prospect.cityMarket,r.prospect.market,r.prospect.vertical,
   r.prospect.sourceType,r.nextAction,r.prospect.currentStatus]
   .some(v=>text(v).toLocaleLowerCase().includes(q));
 }).sort((a,b)=>{
  if(mode==="priority"){
   // Active records are ranked by rubric-fit; data quality is a tie breaker.
   return Number(a.closed)-Number(b.closed)
    ||(b.fitScore??-1)-(a.fitScore??-1)
    ||b.qualityPriority-a.qualityPriority
    ||text(a.prospect.companyName).localeCompare(text(b.prospect.companyName));
  }
  return Number(a.closed)-Number(b.closed)
   ||b.highIssues-a.highIssues
   ||b.issues.length-a.issues.length
   ||text(a.prospect.companyName).localeCompare(text(b.prospect.companyName));
 });
}
function csvCell(value){
 const raw=String(value??"");
 return '"'+(/^\s*[=+\-@\t\r]/.test(raw)?"'"+raw:raw).replaceAll('"','""')+'"';
}
export function qualityReviewCsv(rows=[],asOf=localDateKey()){
 const grid=[["Organization","Type","Status","Location","Fit score (rubric only)","Contact readiness",
  "High attention issues","Total issues","Issues to review","Suggested manual action",
  "Official website listed","Original source listed","Report date"]];
 for(const r of rows) grid.push([
  r.prospect.companyName||"",r.category,r.prospect.currentStatus||"NEW",
  r.prospect.cityMarket||r.prospect.market||"",r.fitScore??"",r.readiness,
  r.highIssues,r.issues.length,r.issues.map(x=>x.label).join("; "),
  r.nextAction,r.details.website?"Yes":"No",safeWebsite(r.prospect.sourceUrl)?"Yes":"No",asOf
 ]);
 return grid.map(x=>x.map(csvCell).join(",")).join("\r\n")+"\r\n";
}
