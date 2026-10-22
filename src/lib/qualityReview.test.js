import test from "node:test";
import assert from "node:assert/strict";
import {
 issuesForProspect, nextReviewAction, qualityRows, qualitySummary, filterQualityRows,
 qualityReviewCsv
} from "./qualityReview.js";

const prospects=[
 {id:"a",companyName:"Harbor Care",vertical:"Home Health / Homecare",market:"Austin",
  cityMarket:"Austin, TX",currentStatus:"NEW",email:"office@harbor.example",
  website:"https://harbor.example",sourceUrl:"https://directory.example/harbor",
  sourceType:"Public directory",hrPersonListed:"No",orgSize:"10-49"},
 {id:"b",companyName:"Harbor Care",vertical:"Home Health / Homecare",market:"Austin",
  cityMarket:"Austin, TX",currentStatus:"T1 SENT",email:"office@harbor.example",
  website:"https://harbor.example",sourceUrl:"https://directory.example/harbor2",
  sourceType:"Public directory"},
 {id:"c",companyName:"Hope Foundation",vertical:"Nonprofits & Associations",
  currentStatus:"NEW",sourceType:"Nonprofit Explorer"},
 {id:"d",companyName:"Stopped Lead",currentStatus:"Do Not Respond",doNotRespond:true},
 {id:"e",companyName:"Finished Lead",currentStatus:"Converted",email:"exec@finished.example"}
];

test("flags a potential duplicate using explicit email and original website fields",()=>{
 const rows=qualityRows(prospects,"2026-10-22");
 assert.equal(rows[0].duplicate?.level,"high");
 assert.equal(rows[1].duplicate?.level,"high");
 assert.ok(rows[0].issues.some(i=>i.id==="Potential duplicate"&&i.severity==="high"));
 assert.equal(rows[2].duplicate,null);
});
test("missing evidence and contacts are actionable but never fabricated",()=>{
 const row=qualityRows(prospects,"2026-10-22").find(x=>x.id==="c");
 assert.ok(row.issues.some(i=>i.id==="No usable contact"));
 assert.ok(row.issues.some(i=>i.id==="No source link"));
 assert.ok(row.issues.some(i=>i.id==="No official website"));
 assert.equal(row.nextAction,"Research a public contact");
 assert.equal(row.details.email,"");
});
test("terminal records are excluded from action and export as empty fit",()=>{
 const rows=qualityRows(prospects,"2026-10-22");
 for(const id of ["d","e"]){
  const row=rows.find(r=>r.id===id);
  assert.equal(row.closed,true);assert.deepEqual(row.issues,[]);assert.equal(row.fitScore,null);
 }
 assert.equal(qualitySummary(rows).excluded,2);
 assert.equal(filterQualityRows(rows).length,3);
});
test("provider-invalid email blocks manual outreach recommendation",()=>{
 const issues=issuesForProspect({companyName:"Invalid",email:"bad@example.com",emailStatus:"invalid"});
 assert.ok(issues.some(i=>i.id==="Email needs review"&&i.severity==="high"));
 assert.equal(nextReviewAction({currentStatus:"NEW"},issues),"Check invalid email before sending");
});
test("reply and compliance gates override ordinary outreach actions",()=>{
 assert.match(nextReviewAction({replyReceived:true}),/Review reply/);
 assert.match(nextReviewAction({doNotRespond:true}),/Do not contact/);
 assert.match(nextReviewAction({currentStatus:"TOUCH 3 GATE",t3Approved:false},[],"2026-10-22"),/Obtain approval/);
});
test("filter by nonprofit and issue, sort priorities deterministically",()=>{
 const rows=qualityRows(prospects,"2026-10-22");
 assert.deepEqual(filterQualityRows(rows,{category:"Nonprofit"}).map(r=>r.id),["c"]);
 assert.deepEqual(filterQualityRows(rows,{issue:"Potential duplicate"}).map(r=>r.id),["a","b"]);
 const priority=filterQualityRows(rows,{mode:"priority"});
 assert.ok(priority[0].fitScore>=priority[1].fitScore);
 assert.equal(filterQualityRows(rows,{query:"Hope"}).length,1);
});
test("rubric uses actual website presence and visible contact, not directory alone",()=>{
 const rows=qualityRows([{id:"x",companyName:"Real",market:"Austin",email:"founder@real.example",
   website:"https://real.example",sourceUrl:"https://some-directory.example/profile"},
   {id:"y",companyName:"Social",market:"Austin",email:"founder@social.example",
   website:"https://linkedin.com/company/social",sourceUrl:"https://some-directory.example/profile2"}]);
 const presence=r=>r.fitFactors.find(f=>f.key==="presence")?.points;
 assert.equal(presence(rows[0]),10);
 assert.equal(presence(rows[1]),5);
 assert.ok(rows[0].fitFactors.find(f=>f.key==="reach").points>0);
});
test("CSV has no personally identifying contact columns and escapes dangerous spreadsheet input",()=>{
 const rows=qualityRows([{
  id:"v",companyName:'=HYPERLINK("https://bad.example","click")',email:"jane@example.org",
  contactName:"Jane Smith",sourceUrl:"https://evidence.example",currentStatus:"NEW"
 }],"2026-10-22");
 const csv=qualityReviewCsv(rows,"2026-10-22");
 assert.match(csv,/"'=HYPERLINK\(""https:\/\/bad.example""/);
 assert.doesNotMatch(csv,/jane@example.org|Jane Smith|Email address/);
 assert.match(csv,/"Report date"/);
});
test("empty data is safe",()=>{
 assert.deepEqual(qualityRows([]),[]);
 assert.equal(qualitySummary([]).needsReview,0);
 assert.equal(filterQualityRows([]).length,0);
 assert.match(qualityReviewCsv([]),/Organization/);
});
