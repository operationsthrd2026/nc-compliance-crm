import {localDateKey,parseLocalDay} from "./outreachPlanning.js";
import {taskBucket} from "./prospectTasks.js";

const ACTIVE=new Set(["open","in_progress"]);
const CLOSED=new Set(["completed","cancelled"]);
const STATUSES=["open","in_progress","completed","cancelled"];
const PRIORITIES=["urgent","high","normal","low"];

function localDayFromTimestamp(value){
 if(!value)return null;
 const date=new Date(value);
 return Number.isNaN(date.getTime())?null:parseLocalDay(localDateKey(date));
}
function csvCell(value){
 const raw=String(value??"");
 const guarded=/^\s*[=+\-@\t\r]/.test(raw)?"'"+raw:raw;
 return '"'+guarded.replaceAll('"','""')+'"';
}
function memberLabel(member,id,currentUserId){
 if(String(id)===String(currentUserId))return "You";
 return member?.name||member?.username||"Inactive or unavailable user";
}

/**
 * Produces a productivity report strictly from tasks already returned by CRM.
 * Admins see a breakdown of visible assigned work; non-admins see only tasks
 * assigned to themselves, never an inferred organization-wide total.
 */
export function taskProductivitySnapshot(tasks=[],members=[],{
 asOf=localDateKey(),currentUserId="",canAdmin=false,days=30
}={}){
 const today=parseLocalDay(asOf);
 const windowDays=Number.isFinite(days)?Math.max(1,Math.min(365,Math.floor(days))):30;
 const start=today===null?null:today-windowDays+1;
 const scoped=(Array.isArray(tasks)?tasks:[]).filter(t=>t&&t.id&&
   (canAdmin||!!currentUserId&&String(t.assigned_to)===String(currentUserId)));
 const active=scoped.filter(t=>ACTIVE.has(t.status));
 const recentCompleted=scoped.filter(t=>{
  if(t.status!=="completed"||start===null||today===null)return false;
  const completed=localDayFromTimestamp(t.completed_at);
  return completed!==null&&completed>=start&&completed<=today;
 });
 const statusRows=STATUSES.map(status=>({label:status,count:scoped.filter(t=>t.status===status).length}));
 const priorityRows=PRIORITIES.map(priority=>({label:priority,count:scoped.filter(t=>t.priority===priority).length}));
 const countActive=bucket=>active.filter(t=>taskBucket(t,asOf)===bucket).length;
 const memberById=new Map((Array.isArray(members)?members:[]).map(m=>[String(m.id),m]));
 let assignees=[];
 if(canAdmin){
  const ids=new Set(scoped.map(t=>String(t.assigned_to)));
  for(const member of members||[])if(member?.id&&member.active&&member.role!=="viewer")ids.add(String(member.id));
  assignees=[...ids].map(id=>{
   const assigned=scoped.filter(t=>String(t.assigned_to)===id);
   const assignedActive=assigned.filter(t=>ACTIVE.has(t.status));
   const recent=recentCompleted.filter(t=>String(t.assigned_to)===id).length;
   return {
    id,label:memberLabel(memberById.get(id),id,currentUserId),
    total:assigned.length,active:assignedActive.length,
    overdue:assignedActive.filter(t=>taskBucket(t,asOf)==="Overdue").length,
    dueToday:assignedActive.filter(t=>taskBucket(t,asOf)==="Today").length,
    dueNext7:assignedActive.filter(t=>taskBucket(t,asOf)==="Next 7 days").length,
    unscheduled:assignedActive.filter(t=>taskBucket(t,asOf)==="Unscheduled").length,
    urgent:assignedActive.filter(t=>["urgent","high"].includes(t.priority)).length,
    completedRecent:recent
   };
  }).sort((a,b)=>b.overdue-a.overdue||b.urgent-a.urgent||b.active-a.active||a.label.localeCompare(b.label));
 }
 return {
  asOf,windowDays,windowStart:start===null?"":new Date(start*86400000).toISOString().slice(0,10),
  scope:canAdmin?"All task rows visible to CRM administrator":"Tasks assigned to you",
  isAdmin:!!canAdmin,total:scoped.length,active:active.length,
  overdue:countActive("Overdue"),dueToday:countActive("Today"),
  dueNext7:countActive("Next 7 days"),unscheduled:countActive("Unscheduled"),
  urgent:active.filter(t=>["urgent","high"].includes(t.priority)).length,
  completedRecent:recentCompleted.length,statusRows,priorityRows,assignees
 };
}

export function taskProductivityCsv(snapshot){
 const rows=[
  ["Report","As of",snapshot.asOf],
  ["Report","Completion window start",snapshot.windowStart],
  ["Report","Data scope",snapshot.scope],
  ["Summary","Tasks in scope",snapshot.total],
  ["Summary","Active tasks",snapshot.active],
  ["Summary","Overdue active tasks",snapshot.overdue],
  ["Summary","Due today",snapshot.dueToday],
  ["Summary","Due in next 7 days (excluding today)",snapshot.dueNext7],
  ["Summary","Unscheduled active tasks",snapshot.unscheduled],
  ["Summary","High or urgent active tasks",snapshot.urgent],
  ["Summary","Completed in last "+snapshot.windowDays+" days",snapshot.completedRecent],
  ...snapshot.statusRows.map(x=>["Task status",x.label,x.count]),
  ...snapshot.priorityRows.map(x=>["Priority",x.label,x.count])
 ];
 if(snapshot.isAdmin){
  rows.push(["Workload by assignee","Assignee","Total tasks","Active","Overdue","Due today","Due next 7 days","Unscheduled","High/urgent active","Completed in window"]);
  for(const person of snapshot.assignees)rows.push([
   "Workload by assignee",person.label,person.total,person.active,person.overdue,
   person.dueToday,person.dueNext7,person.unscheduled,person.urgent,person.completedRecent
  ]);
 }
 return rows.map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n";
}
