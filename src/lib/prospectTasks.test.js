import test from "node:test";
import assert from "node:assert/strict";
import {taskBucket,summarizeTasks,filterTasks,validateTaskData} from "./prospectTasks.js";
const tasks=[
 {id:"1",task_title:"Review handbook",due_date:"2026-10-21",priority:"normal",status:"open",assigned_to:"a",prospect_id:"p1"},
 {id:"2",task_title:"Confirm email",due_date:"2026-10-22",priority:"urgent",status:"in_progress",assigned_to:"b",prospect_id:"p2"},
 {id:"3",task_title:"Call director",due_date:"2026-10-26",priority:"high",status:"open",assigned_to:"a",prospect_id:"p3"},
 {id:"4",task_title:"Source verification",due_date:null,priority:"low",status:"open",assigned_to:"a",prospect_id:"p4"},
 {id:"5",task_title:"Closed",due_date:"2026-10-20",priority:"high",status:"completed",assigned_to:"a",prospect_id:"p5"}
];
test("due buckets never treat closed tasks as overdue",()=>{
 assert.deepEqual(tasks.map(x=>taskBucket(x,"2026-10-22")),["Overdue","Today","Next 7 days","Unscheduled","Completed"]);
});
test("filters combine owner and date and company search without changing original",()=>{
 assert.deepEqual(filterTasks(tasks,{bucket:"Overdue",assignee:"a",asOf:"2026-10-22"}).map(t=>t.id),["1"]);
 assert.equal(filterTasks(tasks,{query:"hope",prospectNames:{p3:"Hope Center"}}).length,1);
 assert.equal(tasks[0].status,"open");
});
test("summary is based only on saved task state",()=>{
 const result=summarizeTasks(tasks,"2026-10-22");
 assert.equal(result.All,5);assert.equal(result.Overdue,1);assert.equal(result.Completed,1);
});
test("safe form validation rejects invalid dates and unsupported states",()=>{
 assert.throws(()=>validateTaskData({task_title:" ",priority:"normal"}),/title/);
 assert.throws(()=>validateTaskData({task_title:"Task",due_date:"2026-02-30"}),/date/);
 assert.throws(()=>validateTaskData({task_title:"Task",priority:"superurgent"}),/priority/);
 assert.deepEqual(validateTaskData({task_title:" Follow up ",priority:"high"}),{task_title:"Follow up",description:"",priority:"high",due_date:null});
});
