// Normalize only contact details actually supplied by a public directory.
// A source listing/LinkedIn page must never be passed off as an official website.
export function safeWebsite(input) {
  const raw=String(input??"").trim();
  if(!raw||/\s/.test(raw)||raw.length>500) return "";
  try{
    const withScheme=/^https?:\/\//i.test(raw)?raw:"https://"+raw;
    const u=new URL(withScheme);
    if(!["http:","https:"].includes(u.protocol)||u.username||u.password||!u.hostname.includes("."))
      return "";
    if(/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname))return "";
    return u.toString();
  }catch{return "";}
}

export function safeEmail(input) {
  const raw=String(input??"").trim().split(/[;,\s]+/)[0]||"";
  return /^[^\s@<>]+@[^\s@<>]+\.[a-zA-Z]{2,}$/.test(raw)&&raw.length<=254?raw:"";
}
export function safePhone(input) {
  const raw=String(input??"").trim().split(";")[0].trim();
  if(raw.length>70||!/^\+?[\d\s().\-/xextEXT]+$/.test(raw))return "";
  const numbers=raw.replace(/\D/g,"");
  return numbers.length>=7&&numbers.length<=17?raw:"";
}

export function publicDetailsFromOsm(tags={}) {
  const website=safeWebsite(tags["contact:website"]||tags.website||tags["website:official"]||tags.url);
  const email=safeEmail(tags["contact:email"]||tags.email);
  const phone=safePhone(tags["contact:phone"]||tags.phone||tags["contact:mobile"]||tags.mobile);
  return {website,email,phone};
}

export function publicDetailsFromApollo(organization={}) {
  // Apollo People Search does not supply a person's verified email/phone.
  const site=organization.website_url||organization.website||organization.primary_domain||organization.domain;
  return {website:safeWebsite(site),email:"",phone:""};
}
