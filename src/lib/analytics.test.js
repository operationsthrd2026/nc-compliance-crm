import test from "node:test";
import assert from "node:assert/strict";
import { analyticsCsv,analyticsSnapshot,filterAnalyticsLeads,percent,rankCounts } from "./analytics.js";

const leads=[
  {id:"1",companyName:"Hope Foundation",vertical:"Community Development Orgs",sourceType:"Nonprofit Explorer",currentStatus:"T1 SENT",t1SendDate:"2026-10-20",email:"team@hope.org",t2DueDate:"2026-10-21"},
  {id:"2",companyName:"Local Shop",vertical:"Retail",sourceType:"Local directory",currentStatus:"Converted",phone:"+15551234567"},
  {id:"3",companyName:"Another nonprofit",vertical:"Social Service Agencies",sourceType:"Nonprofit Explorer",currentStatus:"Replied",replyReceived:true,t1SendDate:"2026-10-19"},
  {id:"4",companyName:"No contact",vertical:"Services",sourceType:"Local directory",currentStatus:"Do Not Respond",doNotRespond:true}
];
test("empty CRM snapshot does not divide by zero or fabricate task totals",()=>{
 const s=analyticsSnapshot([],null,"2026-10-22");
 assert.equal(s.total,0);assert.equal(s.contactCoveragePct,0);assert.equal(s.conversionSharePct,0);
 assert.equal(s.taskCounts,null);assert.equal(s.taskDueNow,null);
});
test("counts replies, converted share, contacts and logged touches from current CRM",()=>{
 const s=analyticsSnapshot(leads,null,"2026-10-22");
 assert.equal(s.total,4); assert.equal(s.contactListed,2);assert.equal(s.touchLogged,2);
 assert.equal(s.replies,1);assert.equal(s.converted,1);assert.equal(s.dueNow,1);
 assert.equal(s.contactCoveragePct,50);assert.equal(s.conversionSharePct,25);
 assert.deepEqual(s.categoryRows,[{label:"Nonprofit",count:2},{label:"Business / Other",count:2}].sort((a,b)=>a.label.localeCompare(b.label)));
});
test("uses category plus source filters without changing input",()=>{
 const result=filterAnalyticsLeads(leads,{category:"Nonprofit",source:"Nonprofit Explorer"});
 assert.equal(result.length,2);assert.equal(leads.length,4);
 assert.equal(filterAnalyticsLeads(leads,{category:"Business / Other",source:"Nonprofit Explorer"}).length,0);
});
test("task metrics use visible tasks linked to scoped prospects only",()=>{
 const tasks=[
  {prospect_id:"1",status:"open",due_date:"2026-10-20"},
  {prospect_id:"2",status:"completed",due_date:"2026-10-20"},
  {prospect_id:"missing",status:"open",due_date:"2026-10-20"}
 ];
 const onlyNonprofits=filterAnalyticsLeads(leads,{category:"Nonprofit"});
 const s=analyticsSnapshot(onlyNonprofits,tasks,"2026-10-22");
 assert.equal(s.taskCounts.All,1);assert.equal(s.taskCounts.Overdue,1);
 assert.equal(s.taskDueNow,1);
});
test("CSV includes labeled aggregate metrics but not individual email addresses",()=>{
 const s=analyticsSnapshot(leads,[],"2026-10-22");
 const csv=analyticsCsv(s,{asOf:"2026-10-22"});
 assert.match(csv,/"Saved prospects","4"/);
 assert.match(csv,/"Visible linked tasks","0"/);
 assert.doesNotMatch(csv,/team@hope.org/);
 assert.equal(csv.split("\r\n")[0],'"Section","Metric","Count"');
});
test("CSV escapes spreadsheet formulas in dynamic source labels",()=>{
 const s=analyticsSnapshot([{id:"a",sourceType:'=SUM(1,2)',currentStatus:"NEW"}],[],"2026-10-22");
 const csv=analyticsCsv(s,{source:"-BOGUS",asOf:"2026-10-22"});
 assert.match(csv,/"'=SUM\(1,2\)"/);
 assert.match(csv,/"'-BOGUS"/);
});
test("rankCounts sorts by count then label and percent guards zeros",()=>{
 assert.deepEqual(rankCounts({Z:2,A:2,B:0}),[{label:"A",count:2},{label:"Z",count:2}]);
 assert.equal(percent(1,3),33.3);assert.equal(percent(0,0),0);
});
