import { safeOrganizationWebsite, safeEmail, safePhone } from "./contactDetails.js";

export const LEAD_STAGES=["NEW","T1 SENT","T2 SENT","REVIEW","TOUCH 3 GATE","NURTURE/T3 SENT","Replied","Do Not Respond","Converted"];

export function contactDetails(prospect={}) {
 const legacy=String(prospect.emailPhone||"");
 const legacyEmail=legacy.match(/[^\s|,;<>]+@[^\s|,;<>]+\.[A-Za-z]{2,}/)?.[0]||"";
 const email=safeEmail(prospect.email||legacyEmail);
 const phone=safePhone(prospect.phone||legacy.split("|").map(x=>x.trim()).find(x=>/^[+()\d\s./-]{7,}$/.test(x))||"");
 const website=safeOrganizationWebsite(prospect.website||"");
 return {email,phone,website};
}
export function contactReadiness(prospect={}) {
 if(prospect.doNotRespond || prospect.currentStatus==="Do Not Respond")
  return "Do not contact";
 const {email,phone,website}=contactDetails(prospect);
 if(email||phone)return "Contact listed";
 if(website)return "Website only";
 return "Needs research";
}
export function leadCategory(prospect={}) {
 const source=[prospect.vertical,prospect.sourceType].join(" ");
 return /nonprofit|non-profit|foundation|charit|faith|social service|human service|advocacy|community development|environmental|cultural|grantmaker|propublica|wikidata \(community records\)/i.test(source)
   &&!/wikidata \(community records\)/i.test(source)
  ? "Nonprofit" : "Business / Other";
}
export function filterSavedLeads(leads=[],{query="",status="all",readiness="all",category="all"}={}) {
 const q=String(query).toLocaleLowerCase().trim();
 return leads.filter(p=>{
  if(status!=="all"&&String(p.currentStatus||"NEW")!==status)return false;
  if(readiness!=="all"&&contactReadiness(p)!==readiness)return false;
  if(category!=="all"&&leadCategory(p)!==category)return false;
  if(!q)return true;
  const d=contactDetails(p);
  return [p.companyName,p.contactName,p.title,p.vertical,p.market,p.cityMarket,p.sourceType,d.email,d.phone,d.website]
   .some(x=>String(x||"").toLocaleLowerCase().includes(q));
 });
}
export function readinessCounts(leads=[]) {
 const counts={"Contact listed":0,"Website only":0,"Needs research":0,"Do not contact":0};
 for(const p of leads)counts[contactReadiness(p)]++;
 return counts;
}