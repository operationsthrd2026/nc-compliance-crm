import { finderCors, response } from "../_shared/prospectfinder-auth.ts";
import { requireCrmUser, getApiKey } from "../_shared/auth.ts";

// Optional Gemini search grounded in Google Search results. Keys never leave
// Supabase; requests are authorized CRM admin sessions and explicitly opted in.
const MODEL="gemini-2.5-flash";
const endpoint="https://generativelanguage.googleapis.com/v1beta/models/";
type Json=Record<string,any>;
const requests=new Map<string,number[]>();
const max=3;
function text(v:unknown,n=180) {
 return typeof v==="string"?v.replace(/[\x00-\x1F]/g," ").trim().slice(0,n):"";
}
function safeUrl(input:unknown){
 const s=text(input,500);
 if(!s||/\s/.test(s))return "";
 try {
  const u=new URL(s);
  if(!["https:","http:"].includes(u.protocol)||!u.hostname.includes(".")||u.username||u.password)return "";
  if(/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname))return "";
  return u.toString();
 }catch{return "";}
}
function norm(v:unknown){return text(v,180).toLowerCase().replace(/[^a-z0-9]/g,"");}
function parse(jsonText:string):Json[]{
 try{
  const raw=jsonText.trim().replace(/^\x60{3}(?:json)?\s*/i,"").replace(/\x60{3}\s*$/,"").trim();
  const opening=raw.indexOf("{"),closing=raw.lastIndexOf("}");
  if(opening<0||closing<opening)return [];
  const obj=JSON.parse(raw.slice(opening,closing+1));
  return Array.isArray(obj.organizations)?obj.organizations.slice(0,max):[];
 }catch{return [];}
}
function sourceInfo(candidate:Json){
 const md=candidate?.groundingMetadata||{};
 const chunks=Array.isArray(md.groundingChunks)?md.groundingChunks:[];
 return chunks.filter((x:Json)=>x?.web?.uri).map((x:Json)=>({
  uri:safeUrl(x.web.uri),title:text(x.web.title,220)
 })).filter((x:{uri:string,title:string})=>x.uri).slice(0,16);
}
function rowsFor(answer:string,sources:{uri:string,title:string}[],scope:string){
 const out:Json[]=[];
 const blocked=["google.com","linkedin.com","facebook.com","instagram.com","yelp.com","wikipedia.org","wikidata.org","openstreetmap.org"];
 for(const item of parse(answer)){
  const companyName=text(item.name,150);
  if(companyName.length<3)continue;
  const wanted=safeUrl(item.source_url);
  // Citations MUST originate from the API's groundingMetadata, not the model's memory.
  let actual=sources.find(x=>wanted&&x.uri===wanted);
  if(!actual){
   const cleanName=norm(companyName);
   actual=sources.find(x=>{
    const t=norm(x.title);
    return t.length>3&&cleanName.length>3&&(t.includes(cleanName)||cleanName.includes(t));
   });
  }
  if(!actual)continue;
  const requested=safeUrl(item.website);
  const requestedHost=requested?new URL(requested).hostname.replace(/^www\./,"").toLowerCase():"";
  const actualHost=new URL(actual.uri).hostname.replace(/^www\./,"").toLowerCase();
  // A search redirect or directory listing is not proof of an official website.
  const isDirectory=blocked.some(x=>requestedHost===x||requestedHost.endsWith("."+x));
  const website=requested&&requestedHost===actualHost&&!isDirectory?requested:"";
  const foundEmail=text(item.email,254);
  const email=/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(foundEmail)?foundEmail:"";
  const number=text(item.phone,70);
  const phone=/^\+?[\d\s()./\-]{7,70}$/.test(number)&&number.replace(/\D/g,"").length>=7?number:"";
  const cityMarket=[text(item.city,70),text(item.state,40)].filter(Boolean).join(", ")||scope;
  out.push({
   companyName,contactName:"",title:"",cityMarket,market:cityMarket,website,email,phone,
   emailPhone:[email,phone].filter(Boolean).join(" | "),sourceUrl:actual.uri,
   sourceType:"Gemini + Google Search (grounded)",vertical:"",hrPersonListed:"Unknown",
   verificationNotes:"AI-extracted from a cited Google Search result; website, email and phone are not independently verified. Review source before contacting.",
   whyFit:"Gemini live Google Search result with source citation"
  });
 }
 return out;
}
function rateLimit(identity:string){
 const now=Date.now();
 const hits=(requests.get(identity)||[]).filter(v=>now-v<600000);
 if(hits.length>=4)return true;
 if(requests.size>300)requests.clear();
 requests.set(identity,[...hits,now]);return false;
}
const guide='Find up to 3 genuine U.S. companies or nonprofits using LIVE Google Search. Return only a JSON object with an organizations array. Each item has name, website, email, phone, city, state, source_url. Supply only public information visible in Google Search results. Prefer search results from an organization own website. Copy an actual cited source URL when available; do not invent sources or domains. Never invent emails or phone numbers; use empty strings if absent. If no reliably grounded organization is found return {"organizations":[]}.';

Deno.serve(async(req:Request)=>{
 const h=finderCors(req);
 if(req.method==="OPTIONS")return new Response("ok",{headers:h});
 if(req.method!=="POST")return response({error:"Method not allowed"},405,h);
 const auth=await requireCrmUser(req,h,{adminOnly:true});
 if(!auth.ok)return auth.response;
 let payload:Json;
 try{payload=await req.json();}catch{return response({error:"Invalid request body"},400,h);}
 if(!["test","search"].includes(payload?.action))return response({error:"Unsupported Gemini action"},400,h);
 if(payload.action==="search"&&payload.confirmUsage!==true)
  return response({error:"Confirm use of Gemini search quota and possible provider charges."},400,h);
 const key=await getApiKey(auth.admin,"gemini","GEMINI_API_KEY");
 if(!key)return response({error:"Gemini API key not configured. Add it in API Integrations."},409,h);
 if(rateLimit(String(auth.email||"crm")+":"+payload.action))
  return response({error:"Gemini request limit reached. Try later."},429,h);
 try{
  if(payload.action==="test"){
   // No model inference or Google Search invocation: no search quota consumed.
   const check=await fetch(endpoint+MODEL,{headers:{"x-goog-api-key":key},signal:AbortSignal.timeout(9000)});
   return response({connected:check.ok,provider:"gemini",
    message:check.ok?"Gemini API key accepted. Search grounding and billing are not tested.":"Gemini key or model access denied (HTTP "+check.status+")."},
    check.ok?200:502,h);
  }
  const keyword=text(payload.keyword,90);
  const city=text(payload.city,70),state=text(payload.state,45),industry=text(payload.category,85);
  const kind=["both","smb","nonprofit"].includes(payload.type)?payload.type:"both";
  if(!keyword&&!city&&!state&&!industry)
   return response({error:"Enter a city, state, industry or keyword."},400,h);
  const prompt="Research "+(kind==="nonprofit"?"nonprofit organizations":kind==="smb"?"small businesses or companies":"companies and nonprofits")+" in the United States. Keyword: "+(keyword||"any")+". City: "+(city||"unspecified")+". State: "+(state||"unspecified")+". Industry: "+(industry||"any")+". "+guide;
  const r=await fetch(endpoint+MODEL+":generateContent",{
   method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},
   body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],
     tools:[{google_search:{}}],generationConfig:{temperature:0.1,maxOutputTokens:1500}}),
   signal:AbortSignal.timeout(42000)
  });
  if(!r.ok){
   const msg=r.status===429?"Gemini rate limit or quota reached.":r.status===400?"Gemini Google Search grounding may not be available on this key/model.":r.status===403?"Gemini key does not have permission for this model or search.":"Gemini service returned HTTP "+r.status+".";
   return response({error:msg},r.status===429?429:502,h);
  }
  const data=await r.json();
  const candidates=Array.isArray(data.candidates)?data.candidates:[];
  let all:Json[]=[],sourceCount=0;
  const loc=[city,state].filter(Boolean).join(", ");
  for(const c of candidates.slice(0,1)){
   const sources=sourceInfo(c),parts=Array.isArray(c?.content?.parts)?c.content.parts:[];
   const answer=parts.filter((x:Json)=>typeof x.text==="string").map((x:Json)=>x.text).join("\n");
   sourceCount+=sources.length;
   if(sources.length)all.push(...rowsFor(answer,sources,loc));
  }
  const seen=new Set();
  all=all.filter((x:Json)=>{const k=norm(x.companyName)+"|"+norm(x.website)+"|"+norm(x.cityMarket);if(seen.has(k))return false;seen.add(k);return true;}).slice(0,max);
  return response({organizations:all,source:"Gemini Google Search",groundedSources:sourceCount,
   note:sourceCount?"Results require source review; source-listed contacts are unverified.":"Google Search grounding returned no source citations; no ungrounded leads were accepted."},200,h);
 }catch(e){
  return response({error:e instanceof Error&&e.name==="TimeoutError"?"Gemini search timed out.":"Gemini search could not be completed."},502,h);
 }
});