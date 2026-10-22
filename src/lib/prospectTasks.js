import {localDateKey,parseLocalDay} from "./outreachPlanning.js";
export const TASK_PRIORITIES=["low","normal","high","urgent"];
export const TASK_STATUSES=["open","in_progress","completed","cancelled"];
const SCORE={urgent:0,high:1,normal:2,low:3};
export function taskBucket(task,asOf=localDateKey()){
 if(task.status==="completed")return "Completed";
 if(task.status==="cancelled")return "Cancelled";
 const due=parseLocalDay(task.due_date||"");
 const today=parseLocalDay(asOf);
 if(due===null||today===null)return "Unscheduled";
 if(due<today)return "Overdue";
 if(due===today)return "Today";
 if(due<=today+7)return "Next 7 days";
 return "Later";
}
export function summarizeTasks(tasks=[],asOf=localDateKey()){
 const counts={"All":tasks.length,"Overdue":0,"Today":0,"Next 7 days":0,"Later":0,"Unscheduled":0,"Completed":0,"Cancelled":0};
 for(const task of tasks)counts[taskBucket(task,asOf)]++;
 return counts;
}
export function filterTasks(tasks=[],{query="",bucket="All",assignee="All",asOf=localDateKey(),prospectNames={}}={}){
 const q=String(query||"").trim().toLocaleLowerCase();
 return tasks.filter(task=>{
  if(bucket!=="All"&&taskBucket(task,asOf)!==bucket)return false;
  if(assignee!=="All"&&task.assigned_to!==assignee)return false;
  if(!q)return true;
  return [task.task_title,task.description,prospectNames[task.prospect_id]||""]
   .some(x=>String(x||"").toLocaleLowerCase().includes(q));
 }).sort((a,b)=>{
  const aClosed=["completed","cancelled"].includes(a.status),bClosed=["completed","cancelled"].includes(b.status);
  return Number(aClosed)-Number(bClosed)
   ||(a.due_date||"9999-12-31").localeCompare(b.due_date||"9999-12-31")
   ||(SCORE[a.priority]??2)-(SCORE[b.priority]??2)
   ||String(a.task_title||"").localeCompare(String(b.task_title||""));
 });
}
export function validateTaskData(data={}){
 const title=String(data.task_title||"").trim(),description=String(data.description||"");
 if(title.length<1||title.length>180)throw Error("Task title must be 1–180 characters.");
 if(description.length>3000)throw Error("Task description must be 3,000 characters or fewer.");
 if(!TASK_PRIORITIES.includes(data.priority||"normal"))throw Error("Unsupported priority.");
 const date=String(data.due_date||"").trim();
 if(date&&parseLocalDay(date)===null)throw Error("Invalid due date.");
 return {task_title:title,description,priority:data.priority||"normal",due_date:date||null};
}
