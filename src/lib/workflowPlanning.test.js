import test from "node:test";
import assert from "node:assert/strict";
import {
 buildWorkflowQueue,workflowAction,normalizeWorkflowView,filterWorkflowQueue,
 workflowCounts,validatePresetName,workflowCsv
} from "./workflowPlanning.js";
import {qualityRows} from "./qualityReview.js";

const mk=(id,extra={})=>({
 id,companyName:"Organization "+id,vertical:"Healthcare Practices",
 email:id+"@business.example",website:"https://business-"+id+".example",
 sourceUrl:"https://source-"+id+".example/page",verificationNotes:"Directory checked by reviewer",
 market:"Austin",currentStatus:"NEW",...extra
});
const leads=[
 mk("reply",{replyReceived:true,currentStatus:"Replied"}),
 mk("approval",{currentStatus:"TOUCH 3 GATE",t3Approved:false}),
 mk("invalid",{emailStatus:"invalid"}),
 mk("overdue",{currentStatus:"T1 SENT",t2DueDate:"2026-10-20"}),
 mk("today",{currentStatus:"T1 SENT",t2DueDate:"2026-10-22"}),
 mk("future",{currentStatus:"T1 SENT",t2DueDate:"2026-10-25"}),
 mk("nophone",{email:"",phone:"",website:"",sourceUrl:""}),
 mk("blocked",{doNotRespond:true,currentStatus:"Do Not Respond"}),
 mk("converted",{currentStatus:"Converted"}),
 mk("regular")
];
test("blocked and converted records never get suggested actions",()=>{
 const q=buildWorkflowQueue(leads,"2026-10-22");
 assert.equal(q.length,8);
 assert.ok(!q.find(x=>["blocked","converted"].includes(x.id)));
 assert.ok(q.every(x=>x.requiresManualReview));
});
test("reply, approvals, invalid contacts and due dates have explainable safe actions",()=>{
 const actions=Object.fromEntries(buildWorkflowQueue(leads,"2026-10-22").map(x=>[x.id,x]));
 assert.equal(actions.reply.kind,"Reply flagged");
 assert.equal(actions.approval.kind,"Approval gate");
 assert.equal(actions.invalid.kind,"Email needs checking");
 assert.equal(actions.invalid.bucket,"Immediate review");
 assert.match(actions.invalid.action,/do not send/i);
 assert.equal(actions.overdue.bucket,"Overdue");
 assert.equal(actions.today.bucket,"Due today");
 assert.equal(actions.future.bucket,"Upcoming");
 assert.equal(actions.nophone.bucket,"Research");
 assert.equal(actions.regular.bucket,"Ready");
});
test("high-confidence potential duplicate blocks contact preparations",()=>{
 const p1=mk("same1",{companyName:"Shared Organization",email:"hello@same.example",market:"Denver"});
 const p2=mk("same2",{companyName:"Shared Organization",email:"hello@same.example",market:"Denver"});
 const q=buildWorkflowQueue([p1,p2],"2026-10-22");
 assert.equal(q.length,2);
 assert.ok(q.every(x=>x.bucket==="Immediate review"&&x.kind==="Potential duplicate"));
});
test("view filters are validated and filter reliably",()=>{
 const q=buildWorkflowQueue(leads,"2026-10-22");
 assert.equal(filterWorkflowQueue(q,{bucket:"Overdue"}).length,1);
 assert.equal(filterWorkflowQueue(q,{query:"nophone"}).length,1);
 assert.equal(filterWorkflowQueue(q,{category:"Nonprofit"}).length,0);
 const priority=filterWorkflowQueue(q,{sort:"fit"});
 assert.ok(priority[0].fitScore>=priority[1].fitScore);
 assert.deepEqual(normalizeWorkflowView({category:"wat",bucket:"Wrong",sort:"???",query:72}),
  {category:"All organizations",bucket:"All actions",sort:"urgency",query:"72"});
});
test("counts include all groups and no excluded leads",()=>{
 const q=buildWorkflowQueue(leads,"2026-10-22"),counts=workflowCounts(q);
 assert.equal(counts["All actions"],8);
 assert.equal(counts["Overdue"],1);
 assert.equal(counts["Due today"],1);
 assert.equal(counts["Research"],1);
});
test("only valid human-friendly preset names are accepted",()=>{
 assert.equal(validatePresetName("  Daily review "), "Daily review");
 assert.throws(()=>validatePresetName("  "),/1–80/);
 assert.throws(()=>validatePresetName("x".repeat(81)),/1–80/);
});
test("CSV excludes personal contact details and protects spreadsheet cells",()=>{
 const p=mk("danger",{companyName:'=HYPERLINK("https://malicious.test","open")',
  contactName:"Test Person",email:"private@contact.example"});
 const csv=workflowCsv(buildWorkflowQueue([p],"2026-10-22"),"2026-10-22");
 assert.match(csv,/"'=HYPERLINK\(""https:\/\/malicious.test""/);
 assert.doesNotMatch(csv,/private@contact.example|Test Person/);
 assert.match(csv,/"Suggested manual action"/);
});
test("quality snapshot with blocked status is not actionable",()=>{
 const row=qualityRows([mk("x",{doNotRespond:true,currentStatus:"Do Not Respond"})])[0];
 assert.equal(workflowAction(row,"2026-10-22"),null);
 assert.deepEqual(buildWorkflowQueue([], "2026-10-22"),[]);
});
