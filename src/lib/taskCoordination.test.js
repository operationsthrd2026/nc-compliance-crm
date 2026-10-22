import test from "node:test";
import assert from "node:assert/strict";
import {activeVisibleTasks,groupVisibleTasks,visibleTaskSummary,canDeleteSharedView} from "./taskCoordination.js";

const task=(id,prospect_id,status="open",due_date="")=>({
 id,prospect_id,status,due_date,task_title:"Task "+id,assigned_to:"user-1"
});
const rows=[
 task("1","alpha","open","2026-10-20"),
 task("2","alpha","in_progress","2026-10-29"),
 task("3","alpha","completed","2026-10-20"),
 task("4","beta","open","2026-10-22"),
 task("5","gamma","cancelled","2026-10-19"),
 task("6","alpha","open","2026-10-22")
];
test("tasks are grouped only from visible open and in-progress records",()=>{
 const groups=groupVisibleTasks(rows,"2026-10-22");
 assert.equal(groups.get("alpha").length,3);
 assert.equal(groups.get("alpha")[0].id,"1");
 assert.equal(groups.get("alpha")[1].id,"6");
 assert.equal(groups.get("beta").length,1);
 assert.equal(groups.has("gamma"),false);
 assert.equal(activeVisibleTasks(rows).length,4);
});
test("visible summary counts due now without claiming whole-team visibility",()=>{
 const summary=visibleTaskSummary(rows,"2026-10-22");
 assert.deepEqual(summary,{active:4,dueNow:3,linkedProspects:2});
 assert.deepEqual(visibleTaskSummary([]),{active:0,dueNow:0,linkedProspects:0});
});
test("view deletion is limited to creators or CRM admins",()=>{
 const user={id:"user-123"};
 assert.equal(canDeleteSharedView({createdBy:"user-123"},user,false),true);
 assert.equal(canDeleteSharedView({createdBy:"other-user"},user,false),false);
 assert.equal(canDeleteSharedView({createdBy:"other-user"},user,true),true);
 assert.equal(canDeleteSharedView(null,user,true),false);
 assert.equal(canDeleteSharedView({mine:true},user,false),true);
});
test("malformed and closed tasks never appear as active",()=>{
 const malformed=[null,{}, {id:"z",prospect_id:"x",status:"completed"}, {id:"a",status:"open"}];
 assert.deepEqual(activeVisibleTasks(malformed),[]);
 assert.equal(groupVisibleTasks(malformed).size,0);
});
