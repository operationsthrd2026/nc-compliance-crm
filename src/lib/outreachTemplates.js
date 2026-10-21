import {contactDetails,leadCategory} from "./leadQualification.js";

// Built-in drafts only. No external LLM, search, SMTP, Gmail API, or automated sending.
export const OUTREACH_TEMPLATES=[
 {id:"nonprofit-intro",label:"Nonprofit · introduction",subject:"HR compliance support for {{company}}",body:"Hi {{contact}},\n\nI'm reaching out from HR On Demand. We help organizations review HR practices, employee classifications, policies and compliance needs.\n\nI'd welcome the opportunity to learn about {{company}} and see whether a brief introductory conversation would be useful.\n\nWould you be open to connecting?\n\nBest,\nHR On Demand"},
 {id:"business-intro",label:"Small business · introduction",subject:"HR support for {{company}}",body:"Hi {{contact}},\n\nI'm reaching out from HR On Demand. We support small businesses with practical HR processes, employee policies and compliance reviews.\n\nI thought it could be helpful to introduce our team and learn about the priorities at {{company}}.\n\nWould you be available for a brief introductory call?\n\nBest,\nHR On Demand"},
 {id:"follow-up",label:"First follow-up",subject:"Following up — {{company}}",body:"Hi {{contact}},\n\nI wanted to follow up on my previous message about HR support for {{company}}.\n\nIf HR compliance or employee policy support is a priority, I'd be happy to share more information and coordinate a short conversation.\n\nThank you for your time.\n\nBest,\nHR On Demand"},
 {id:"final-check-in",label:"Gentle final check-in",subject:"Checking in — {{company}}",body:"Hi {{contact}},\n\nI'm checking in once more in case HR compliance support is something {{company}} may want to explore.\n\nIf the timing isn't right, no action is needed. I appreciate your time and consideration.\n\nBest,\nHR On Demand"}
];
const clamp=(text,n)=>String(text??"").replace(/[\r\n\t]+/g," ").replace(/\s+/g," ").trim().slice(0,n);
export function draftFor(prospect={},templateId="business-intro"){
 const preset=OUTREACH_TEMPLATES.find(t=>t.id===templateId)||OUTREACH_TEMPLATES[0];
 const company=clamp(prospect.companyName,110)||"your organization";
 // An empty contact name must never be invented; use a neutral salutation.
 const contact=clamp(prospect.contactName,90).split(" ")[0]||"there";
 const tokens={company,contact};
 const render=(s)=>s.replace(/{{(company|contact)}}/g,(_whole,token)=>tokens[token]);
 return {templateId:preset.id,label:preset.label,subject:render(preset.subject),body:render(preset.body)};
}
export function messageEligibility(prospect={}){
 const contacts=contactDetails(prospect);
 const blocked=!!prospect.doNotRespond || prospect.currentStatus==="Do Not Respond";
 return {blocked,email:contacts.email,hasEmail:!!contacts.email,
  canOpenEmail:!blocked&&!!contacts.email,
  warning:blocked?"This prospect is marked Do Not Respond. Do not send outreach.":!contacts.email?"No valid email is listed. Research and confirm an email before contacting.":"Email format is valid but delivery and ownership have not been verified."};
}
export function contactChecklist(prospect={}){
 const details=contactDetails(prospect);
 return [
  {key:"website",name:"Official website format",value:details.website,
   detail:details.website?"Organization website listed. Confirm it belongs to the business.":"No valid organization website stored."},
  {key:"email",name:"Email format",value:details.email,
   detail:details.email?"Email syntax is valid. This does NOT prove delivery or identity.":"No format-valid email stored."},
  {key:"phone",name:"Phone format",value:details.phone,
   detail:details.phone?"Phone number has a plausible format. It has NOT been dialed or validated.":"No plausible phone number stored."},
 ];
}
export function verificationActivityDetails(prospect={},evidence=""){
 const fields=contactChecklist(prospect).filter(x=>x.value).map(x=>x.name+": "+x.value);
 return "Manual source review only; does not validate mailbox delivery, phone ownership or organization identity.\n"
   +"Organization: "+clamp(prospect.companyName,140)+"\n"
   +"Listed: "+(fields.join("; ")||"No contact fields")+".\n"
   +"Evidence or review notes: "+String(evidence||"").trim().slice(0,2000);
}
export function mailtoLink(to,subject,body){
 if(!/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(String(to||"")))return "";
 return "mailto:"+encodeURIComponent(to)+"?subject="+encodeURIComponent(String(subject||"").slice(0,300))
  +"&body="+encodeURIComponent(String(body||"").slice(0,3500));
}
export function defaultTemplateFor(prospect={}){
 return leadCategory(prospect)==="Nonprofit"?"nonprofit-intro":"business-intro";
}
