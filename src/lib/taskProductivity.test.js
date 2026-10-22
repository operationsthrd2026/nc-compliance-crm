import test from "node:test";
import assert from "node:assert/strict";
import {taskProductivitySnapshot,taskProductivityCsv} from "./taskProductivity.js";

const tasks=[
 {id:"1",assigned_to:"u1",status:"open",priority:"high",due_date:"2026-10-20",task_title:"Private title",description:"Private notes"},
 {id:"2",assigned_to:"u1",status:"in_progress",priority:"urgent",due_date:"2026-10-22",completed_at:null},
 {id:"3",assigned_to:"u2",status:"open",priority:"normal",due_date:"2026-10-28"},
 {id:"4",assigned_to:"u1",status:"open",priority:"normal",due_date:null},
 {id:"5",assigned_to:"u1",status:"completed",priority:"low",due_date:"2026-10-10",completed_at:"2026-10-10T12:00:00Z"},
 {id:"6",assigned_to:"u2",status:"completed",priority:"low",due_date:"2026-09-01",completed_at:"2026-09-01T12:00:00Z"},
 {id:"7",assigned_to:"u2",status:"cancelled",priority:"normal",due_date:"2026-10-22"}
];
const members=[
 {id:"u1",name:"Alex",active:true,role:"user"},
 {id:"u2",name:"Morgan",active:true,role:"manager"}
];
test("admin report summarizes visible workload, due buckets and recent completions",()=>{
 const report=taskProductivitySnapshot(tasks,members,{asOf:"2026-10-22",canAdmin:true,currentUserId:"u1"});
 assert.deepEqual(
  {total:report.total,active:report.active,overdue:report.overdue,dueToday:report.dueToday,
   dueNext7:report.dueNext7,unscheduled:report.unscheduled,urgent:report.urgent,completedRecent:report.completedRecent},
  {total:7,active:4,overdue:1,dueToday:1,dueNext7:1,unscheduled:1,urgent:2,completedRecent:1}
 );
 assert.equal(report.assignees.find(x=>x.id==="u1").active,3);
 assert.equal(report.assignees.find(x=>x.id==="u1").overdue,1);
 assert.equal(report.assignees.find(x=>x.id==="u1").completedRecent,1);
 assert.equal(report.assignees.find(x=>x.id==="u2").dueNext7,1);
 assert.equal(report.windowStart,"2026-09-23");
});
test("non-admin reporting includes only tasks assigned to that CRM user",()=>{
 const report=taskProductivitySnapshot(tasks,members,{asOf:"2026-10-22",canAdmin:false,currentUserId:"u2"});
 assert.equal(report.total,3);
 assert.equal(report.active,1);
 assert.equal(report.dueNext7,1);
 assert.equal(report.isAdmin,false);
 assert.equal(report.assignees.length,0);
 assert.equal(report.scope,"Tasks assigned to you");
});
test("missing identity does not accidentally become an all-team report",()=>{
 const report=taskProductivitySnapshot(tasks,members,{asOf:"2026-10-22",canAdmin:false,currentUserId:""});
 assert.equal(report.total,0);
 assert.equal(report.active,0);
});
test("CSV is aggregate-only, protects formula-like names and includes team rows only for admins",()=>{
 const report=taskProductivitySnapshot(tasks,[{id:"u2",name:"=HYPERLINK(\"x\")",active:true,role:"user"}],
  {asOf:"2026-10-22",canAdmin:true,currentUserId:"u1"});
 const csv=taskProductivityCsv(report);
 assert.ok(csv.includes("Overdue active tasks"));
 assert.ok(csv.includes("Workload by assignee"));
 assert.ok(csv.includes("\"'=HYPERLINK"));
 assert.ok(!csv.includes("Private title"));
 assert.ok(!csv.includes("Private notes"));
 const personal=taskProductivityCsv(taskProductivitySnapshot(tasks,members,{asOf:"2026-10-22",canAdmin:false,currentUserId:"u1"}));
 assert.ok(!personal.includes("Workload by assignee"));
 assert.ok(!personal.includes("Morgan"));
});
