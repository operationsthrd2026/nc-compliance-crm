import test from "node:test";
import assert from "node:assert/strict";
import {localDateKey,parseLocalDay,nextTouch,followupItem,followupQueue,pipelineSnapshot,outreachCsv} from "./outreachPlanning.js";

const today="2026-10-22";
const leads=[
 {id:"a",companyName:"Alpha",currentStatus:"T1 SENT",t2DueDate:"2026-10-20",email:"a@alpha.org"},
 {id:"b",companyName:"Beta",currentStatus:"T2 SENT",t3DueDate:"2026-10-22",phone:"+1 202 555 0103"},
 {id:"c",companyName:"Cedar",currentStatus:"T1 SENT",t2DueDate:"2026-10-27"},
 {id:"d",companyName:"Delta",currentStatus:"T1 SENT",t2DueDate:""},
 {id:"e",companyName:"Echo",currentStatus:"TOUCH 3 GATE",t3DueDate:"2026-10-19",t3Approved:false},
 {id:"f",companyName:"Foxtrot",currentStatus:"Replied",t2DueDate:"2026-10-18"},
 {id:"g",companyName:"Gamma",currentStatus:"Do Not Respond",doNotRespond:true,t2DueDate:"2026-10-18"},
 {id:"h",companyName:"Hotel",currentStatus:"Converted",t2DueDate:"2026-10-18"},
 {id:"i",companyName:"Iota",currentStatus:"NEW",vertical:"Foundations & Grantmakers"}
];
test("uses valid day-only dates and rejects invalid dates",()=>{
 assert.equal(parseLocalDay("2026-02-30"),null);
 assert.equal(parseLocalDay("2026-10-22T09:00"),null);
 assert.equal(parseLocalDay("2026-10-22")-parseLocalDay("2026-10-21"),1);
 assert.equal(localDateKey(new Date(2026,9,22,6)),"2026-10-22");
});
test("queue labels overdue today and upcoming without phantom schedules",()=>{
 const q=followupQueue(leads,today);
 assert.deepEqual(q.map(x=>x.companyName),["Alpha","Beta","Cedar","Echo","Delta"]);
 assert.deepEqual(q.map(x=>x.bucket),["Overdue","Today","Next 7 days","Approval needed","Unscheduled"]);
 assert.equal(q[0].daysAway,-2);
 assert.equal(q[3].needsApproval,true);
 assert.equal(q[4].dueDate,"");
});
test("closed and opted out leads are excluded from follow-ups",()=>{
 assert.equal(followupItem(leads[5],today),null);
 assert.equal(followupItem(leads[6],today),null);
 assert.equal(followupItem(leads[7],today),null);
 assert.equal(nextTouch({currentStatus:"NEW"}),null);
 assert.equal(nextTouch({currentStatus:"TOUCH 3 GATE",t3Approved:true})?.needsApproval,false);
});
test("reports are grounded in actual CRM status and not invented activity",()=>{
 const s=pipelineSnapshot(leads,today);
 assert.equal(s.total,9);
 assert.equal(s.followups.All,5);
 assert.equal(s.followups.Overdue,1);
 assert.equal(s.converted,1);
 assert.equal(s.replies,1);
 assert.equal(s.firstTouch,1);
 assert.equal(s.categories.Nonprofit,1);
});
test("csv quotes columns and guards spreadsheet formula injection",()=>{
 const csv=outreachCsv([{companyName:"=HYPERLINK(\"bad\")",currentStatus:"NEW",outreachNotes:"+formula"}],today);
 assert.match(csv,/'=HYPERLINK/);
 assert.match(csv,/'\+formula/);
 assert.match(csv,/\"Touch 2 due\"/);
 assert.ok(!csv.includes("undefined"));
});
