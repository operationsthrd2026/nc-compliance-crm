import {localDateKey,parseLocalDay} from "./outreachPlanning.js";
import {taskBucket} from "./prospectTasks.js";

const ACTIVE=new Set(["open","in_progress"]);
const PRIORITY_SCORE={urgent:0,high:1,normal:2,low:3};
const TYPE_SCORE={overdue:0,due_today:1,due_soon:2,priority:3};

function dueLabel(date){
 if(!date)return "No due date";
 const parts=String(date).split("-").map(Number);
 if(parts.length!==3||parts.some(Number.isNaN))return "Due date unavailable";
 return new Date(parts[0],parts[1]-1,parts[2]).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
}

/**
 * Builds one actionable alert per active task using only rows supplied by the CRM.
 * Non-admins are restricted to their assigned tasks; admin results remain limited
 * to the task rows already returned by CRM access controls.
 */
export function buildTaskNotifications(tasks=[],{
 asOf=localDateKey(),currentUserId="",canAdmin=false
}={}){
 const today=parseLocalDay(asOf);
 const scoped=(Array.isArray(tasks)?tasks:[]).filter(task=>task&&task.id&&
  (canAdmin||!!currentUserId&&String(task.assigned_to)===String(currentUserId)));
 const notifications=[];
 for(const task of scoped){
  if(!ACTIVE.has(task.status))continue;
  const bucket=taskBucket(task,asOf);
  const due=parseLocalDay(task.due_date||"");
  let type="",title="",message="",severity="info";
  if(bucket==="Overdue"){
   type="overdue";title="Overdue task";severity="critical";
   const days=today!==null&&due!==null?today-due:0;
   message="Due "+dueLabel(task.due_date)+(days>0?" · "+days+" day"+(days===1?"":"s")+" overdue":"");
  }else if(bucket==="Today"){
   type="due_today";title="Due today";severity="warning";
   message="Due "+dueLabel(task.due_date);
  }else if(due!==null&&today!==null&&due>today&&due<=today+3){
   type="due_soon";title="Due soon";severity="notice";
   message="Due "+dueLabel(task.due_date)+" · "+(due-today)+" day"+(due-today===1?"":"s")+" left";
  }else if(["urgent","high"].includes(task.priority)){
   type="priority";title=task.priority==="urgent"?"Urgent priority":"High priority";severity=task.priority==="urgent"?"critical":"warning";
   message=(task.priority==="urgent"?"Urgent":"High")+" priority · "+(task.due_date?"Due "+dueLabel(task.due_date):"No due date set");
  }else{
   continue;
  }
  notifications.push({
   id:"task:"+String(task.id)+":"+type+":"+(task.due_date||"unscheduled"),
   taskId:String(task.id),type,title,message,severity,
   taskTitle:String(task.task_title||"Untitled task"),
   priority:String(task.priority||"normal"),
   dueDate:task.due_date||"",
   daysUntilDue:due!==null&&today!==null?due-today:null
  });
 }
 return notifications.sort((a,b)=>
  (TYPE_SCORE[a.type]??9)-(TYPE_SCORE[b.type]??9)||
  (a.dueDate||"9999-12-31").localeCompare(b.dueDate||"9999-12-31")||
  (PRIORITY_SCORE[a.priority]??2)-(PRIORITY_SCORE[b.priority]??2)||
  a.taskTitle.localeCompare(b.taskTitle)
 );
}

export function summarizeTaskNotifications(notifications=[]){
 const rows=Array.isArray(notifications)?notifications:[];
 return {
  all:rows.length,
  overdue:rows.filter(item=>item.type==="overdue").length,
  dueToday:rows.filter(item=>item.type==="due_today").length,
  dueSoon:rows.filter(item=>item.type==="due_soon").length,
  priority:rows.filter(item=>item.type==="priority").length
 };
}
