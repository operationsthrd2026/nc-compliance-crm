import test from "node:test";
import assert from "node:assert/strict";
import {draftFor,messageEligibility,contactChecklist,verificationActivityDetails,mailtoLink,defaultTemplateFor,OUTREACH_TEMPLATES} from "./outreachTemplates.js";

test("draft uses only CRM values and neutral salutation for missing contact",()=>{
 const d=draftFor({companyName:"Goodwill Charity"},"nonprofit-intro");
 assert.match(d.subject,/Goodwill Charity/);
 assert.match(d.body,/Hi there/);
 assert.equal(d.body.includes("{{company}}"),false);
 const first=draftFor({companyName:"Acme Co",contactName:"Pat Bell"},"business-intro");
 assert.match(first.body,/Hi Pat,/);
 assert.equal(OUTREACH_TEMPLATES.length,4);
});
test("blocked and missing recipients cannot open outbound drafts",()=>{
 assert.equal(messageEligibility({doNotRespond:true,email:"a@b.com"}).canOpenEmail,false);
 assert.equal(messageEligibility({currentStatus:"Do Not Respond",email:"a@b.com"}).blocked,true);
 assert.equal(messageEligibility({companyName:"Missing"}).canOpenEmail,false);
 assert.equal(messageEligibility({email:"info@ngo.org"}).canOpenEmail,true);
});
test("contact checklist shows format, not falsely verified status",()=>{
 const checklist=contactChecklist({email:"info@example.org",website:"https://example.org",phone:"+1 202 555 0199"});
 assert.equal(checklist.length,3);
 assert.match(checklist[1].detail,/does NOT prove delivery/);
 assert.match(verificationActivityDetails({companyName:"Example"},"Reviewed directory"),/does not validate mailbox/);
});
test("mailto is safe and encodes the subject and body",()=>{
 assert.equal(mailtoLink("invalid","s","b"),"");
 const link=mailtoLink("hello@example.org","Hi & bye","One\nTwo");
 assert.match(link,/^mailto:hello%40example\.org\?/);
 assert.match(link,/subject=Hi%20%26%20bye/);
 assert.equal(defaultTemplateFor({vertical:"Foundations & Grantmakers"}),"nonprofit-intro");
});
