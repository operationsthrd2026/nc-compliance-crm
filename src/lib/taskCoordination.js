import {taskBucket} from "./prospectTasks.js";
import {localDateKey} from "./outreachPlanning.js";

const OPEN=new Set(["open","in_progress"]);
const dateValue=x=>String(x||"");
export function activeVisibleTasks(tasks=[]){
 return tasks.filter(t=>t&&t.id&&t.prospect_id&&OPEN.has(t.status));
}
/**
 * Correlates only tasks already returned under CRM's RLS visibility.
 * Never treat 0 as proof that no other team member has a task.
 */
export function groupVisibleTasks(tasks=[],asOf=localDateKey()){
 const byProspect=new Map();
 for(const task of activeVisibleTasks(tasks)){
  const key=String(task.prospect_id);
  if(!byProspect.has(key))byProspect.set(key,[]);
  byProspect.get(key).push(task);
 }
 for(const rows of byProspect.values()){
  rows.sort((a,b)=>{
   const aUrgent=["Overdue","Today"].includes(taskBucket(a,asOf));
   const bUrgent=["Overdue","Today"].includes(taskBucket(b,asOf));
   return Number(bUrgent)-Number(aUrgent)
    ||dateValue(a.due_date||"9999-12-31").localeCompare(dateValue(b.due_date||"9999-12-31"))
    ||String(a.task_title||"").localeCompare(String(b.task_title||""));
  });
 }
 return byProspect;
}
export function visibleTaskSummary(tasks=[],asOf=localDateKey()){
 const active=activeVisibleTasks(tasks);
 return {
  active:active.length,
  dueNow:active.filter(t=>["Overdue","Today"].includes(taskBucket(t,asOf))).length,
  linkedProspects:new Set(active.map(t=>String(t.prospect_id))).size
 };
}
export function canDeleteSharedView(row,currentUser={},canAdmin=false){
 return !!row && (!!row.mine||!!canAdmin
  ||!!(row.createdBy&&currentUser?.id&&String(row.createdBy)===String(currentUser.id)));
}
