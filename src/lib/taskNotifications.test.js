import test from "node:test";
import assert from "node:assert/strict";
import {buildTaskNotifications,summarizeTaskNotifications} from "./taskNotifications.js";

const tasks=[
 {id:"1",assigned_to:"u1",status:"open",priority:"normal",due_date:"2026-10-20",task_title:"Overdue follow-up"},
 {id:"2",assigned_to:"u1",status:"in_progress",priority:"urgent",due_date:"2026-10-22",task_title:"Due today urgent"},
 {id:"3",assigned_to:"u1",status:"open",priority:"normal",due_date:"2026-10-24",task_title:"Upcoming review"},
 {id:"4",assigned_to:"u1",status:"open",priority:"high",due_date:"2026-10-28",task_title:"High priority later"},
 {id:"5",assigned_to:"u1",status:"open",priority:"urgent",due_date:null,task_title:"Urgent unscheduled"},
 {id:"6",assigned_to:"u1",status:"completed",priority:"urgent",due_date:"2026-10-22",task_title:"Completed task"},
 {id:"7",assigned_to:"u1",status:"cancelled",priority:"high",due_date:"2026-10-22",task_title:"Cancelled task"},
 {id:"8",assigned_to:"u2",status:"open",priority:"urgent",due_date:"2026-10-20",task_title:"Other person's task"}
];

test("builds one highest-priority reminder per active task and excludes closed tasks",()=>{
 const alerts=buildTaskNotifications(tasks,{asOf:"2026-10-22",currentUserId:"u1"});
 assert.deepEqual(alerts.map(x=>[x.taskId,x.type]),[
  ["1","overdue"],["2","due_today"],["3","due_soon"],["4","priority"],["5","priority"]
 ]);
 assert.equal(new Set(alerts.map(x=>x.id)).size,alerts.length);
 assert.ok(!alerts.some(x=>x.taskTitle==="Completed task"||x.taskTitle==="Cancelled task"));
 assert.ok(!alerts.some(x=>x.taskId==="8"));
 assert.match(alerts[0].message,/2 days overdue/);
});
test("admin alerts stay within the supplied rows and summarize by category",()=>{
 const alerts=buildTaskNotifications(tasks,{asOf:"2026-10-22",currentUserId:"u1",canAdmin:true});
 assert.equal(alerts.length,6);
 assert.deepEqual(summarizeTaskNotifications(alerts),{all:6,overdue:2,dueToday:1,dueSoon:1,priority:2});
});
test("a non-admin without an identity cannot receive team alerts",()=>{
 assert.deepEqual(buildTaskNotifications(tasks,{asOf:"2026-10-22"}),[]);
});
test("alerts do not include task descriptions or contact information",()=>{
 const rows=[{id:"a",assigned_to:"u1",status:"open",priority:"normal",due_date:"2026-10-20",task_title:"Check records",description:"Private details",email:"private@example.com"}];
 const alerts=buildTaskNotifications(rows,{asOf:"2026-10-22",currentUserId:"u1"});
 assert.equal(alerts.length,1);
 assert.equal(Object.hasOwn(alerts[0],"description"),false);
 assert.equal(Object.hasOwn(alerts[0],"email"),false);
});
