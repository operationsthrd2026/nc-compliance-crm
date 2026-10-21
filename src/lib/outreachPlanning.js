import {contactDetails,contactReadiness,leadCategory} from "./leadQualification.js";

const CLOSED=new Set(["Replied","Converted","Do Not Respond","NURTURE/T3 SENT"]);
const STAGE_T2=new Set(["T1 SENT"]);
const STAGE_T3=new Set(["T2 SENT","TOUCH 3 GATE"]);
export const FOLLOWUP_VIEWS=["All","Overdue","Today","Next 7 days","Later","Unscheduled","Approval needed"];
export const DATE_STEPS=["t2DueDate","t3DueDate"];

export function parseLocalDay(value){
 const match=/^(\d{4})-(\d\d)-(\d\d)$/.exec(String(value||""));
 if(!match)return null;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 const date=Date.UTC(year,month-1,day);
 const check=new Date(date);
 return check.getUTCFullYear()===year&&check.getUTCMonth()===month-1&&check.getUTCDate()===day?Math.floor(date/86400000):null;
}
export function localDateKey(date=new Date()){
 const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,"0"),d=String(date.getDate()).padStart(2,"0");
 return [y,m,d].join("-");
}
export function nextTouch(prospect={}){
 const stage=String(prospect.currentStatus||"NEW");
 if(prospect.doNotRespond||CLOSED.has(stage))return null;
 if(STAGE_T2.has(stage))return {label:"Touch 2",dueField:"t2DueDate",sentField:"t2SendDate",stage:"T2 SENT",needsApproval:false};
 if(STAGE_T3.has(stage))return {
  label:"Touch 3",dueField:"t3DueDate",sentField:"t3SendDate",stage:"NURTURE/T3 SENT",
  needsApproval:stage==="TOUCH 3 GATE"&&!prospect.t3Approved
 };
 return null;
}
export function followupItem(prospect,asOf=localDateKey()){
 const step=nextTouch(prospect);
 if(!step)return null;
 const day=parseLocalDay(asOf);
 const due=String(prospect[step.dueField]||"");
 const dateDay=parseLocalDay(due);
 const daysAway=day!==null&&dateDay!==null?dateDay-day:null;
 let bucket=step.needsApproval?"Approval needed":dateDay===null?"Unscheduled":
  daysAway<0?"Overdue":daysAway===0?"Today":daysAway<=7?"Next 7 days":"Later";
 const {email,phone}=contactDetails(prospect);
 return {
  id:prospect.id,companyName:prospect.companyName||"Unnamed prospect",prospect,
  ...step,dueDate:dateDay===null?"":due,daysAway,bucket,
  hasContact:!!(email||phone)
 };
}
const ORDER={"Overdue":0,"Today":1,"Next 7 days":2,"Approval needed":3,"Unscheduled":4,"Later":5};
export function followupQueue(leads=[],asOf=localDateKey()){
 return leads.map(p=>followupItem(p,asOf)).filter(Boolean).sort((a,b)=>
  (ORDER[a.bucket]??9)-(ORDER[b.bucket]??9)
  ||(a.dueDate||"9999-12-31").localeCompare(b.dueDate||"9999-12-31")
  ||a.companyName.localeCompare(b.companyName));
}
export function pipelineSnapshot(leads=[],asOf=localDateKey()){
 const statuses={};
 const sources={};
 const verticals={};
 const categories={"Nonprofit":0,"Business / Other":0};
 const readiness={"Contact listed":0,"Website only":0,"Needs research":0,"Do not contact":0};
 let replies=0,converted=0,blocked=0,inProgress=0,firstTouch=0;
 for(const p of leads){
  const status=String(p.currentStatus||"NEW");
  statuses[status]=(statuses[status]||0)+1;
  const category=leadCategory(p);
  categories[category]++;
  const vertical=String(p.vertical||"Uncategorized").trim()||"Uncategorized";
  verticals[vertical]=(verticals[vertical]||0)+1;
  const source=String(p.sourceType||"Unknown source").trim()||"Unknown source";
  sources[source]=(sources[source]||0)+1;
  readiness[contactReadiness(p)]++;
  if(status==="Replied"||p.replyReceived)replies++;
  if(status==="Converted")converted++;
  if(status==="Do Not Respond"||p.doNotRespond)blocked++;
  if(status==="NEW"&&!p.doNotRespond)firstTouch++;
  if(!["NEW","Do Not Respond","Converted","Replied"].includes(status)&&!p.doNotRespond)inProgress++;
 }
 const queue=followupQueue(leads,asOf);
 const followups={};
 for(const category of FOLLOWUP_VIEWS)followups[category]=category==="All"?queue.length:queue.filter(q=>q.bucket===category).length;
 return {total:leads.length,statuses,sources,verticals,categories,readiness,
  replies,converted,blocked,inProgress,firstTouch,followups,queue};
}
function csvValue(value){
 const raw=String(value??"");
 // Guard spreadsheet applications against CSV formula execution.
 const safe=/^[\s]*[=+\-@\t\r]/.test(raw)?"'"+raw:raw;
 return '"'+safe.replaceAll('"','""')+'"';
}
export function outreachCsv(leads=[],asOf=localDateKey()){
 const columns=["Organization","Category","Industry","Location","Status","Contact","Title","Email","Phone",
 "Website","Source","Touch 1 sent","Touch 2 due","Touch 2 sent","Touch 3 due","Touch 3 sent",
 "Next action","Next due","Follow-up status","Do not contact","Reply received","Conversion","Outreach notes"];
 const rows=leads.map(p=>{
  const d=contactDetails(p),next=followupItem(p,asOf);
  return [p.companyName,leadCategory(p),p.vertical,p.cityMarket||p.market,p.currentStatus||"NEW",
   p.contactName,p.title,d.email,d.phone,d.website,p.sourceType,p.t1SendDate,p.t2DueDate,p.t2SendDate,
   p.t3DueDate,p.t3SendDate,next?.label||"",next?.dueDate||"",next?.bucket||"",
   p.doNotRespond||p.currentStatus==="Do Not Respond"?"Yes":"No",p.replyReceived?"Yes":"No",
   p.currentStatus==="Converted"?"Yes":"No",p.outreachNotes];
 });
 return [columns,...rows].map(r=>r.map(csvValue).join(",")).join("\r\n")+"\r\n";
}
