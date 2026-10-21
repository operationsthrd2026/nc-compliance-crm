import test from "node:test";
import assert from "node:assert/strict";
import {contactDetails,contactReadiness,leadCategory,filterSavedLeads,readinessCounts} from "./leadQualification.js";

const data=[
 {companyName:"Hope Foundation",vertical:"Nonprofits & Associations",currentStatus:"NEW",website:"https://hope.org"},
 {companyName:"Acme Dental",vertical:"Healthcare Practices",currentStatus:"T1 SENT",email:"hello@acme.com",phone:"+1 202 555 0123"},
 {companyName:"Paused Contact",currentStatus:"Do Not Respond",email:"contact@paused.com",doNotRespond:true},
 {companyName:"Research Needed",currentStatus:"NEW"}
];
test("readiness is grounded in actual fields, not invented contacts",()=>{
 assert.deepEqual(readinessCounts(data),{"Contact listed":1,"Website only":1,"Needs research":1,"Do not contact":1});
 assert.equal(contactReadiness({emailPhone:"hello@example.org | +1 212 555 0101"}),"Contact listed");
 assert.deepEqual(contactDetails({}),{email:"",phone:"",website:""});
});
test("filters work together without changing source records",()=>{
 const a=filterSavedLeads(data,{status:"NEW",readiness:"Website only",category:"Nonprofit"});
 assert.deepEqual(a.map(x=>x.companyName),["Hope Foundation"]);
 assert.equal(filterSavedLeads(data,{query:"acme.com"}).length,1);
 assert.equal(filterSavedLeads(data,{readiness:"Needs research"}).length,1);
 assert.equal(data[0].currentStatus,"NEW");
});
test("respect do not contact and avoid incorrect non-profit classification for Wikidata",()=>{
 assert.equal(contactReadiness({currentStatus:"NEW",doNotRespond:true,email:"ok@example.com"}),"Do not contact");
 assert.equal(leadCategory({vertical:"Healthcare Practices",sourceType:"Wikidata (community records)"}),"Business / Other");
 assert.equal(leadCategory(data[0]),"Nonprofit");
});
