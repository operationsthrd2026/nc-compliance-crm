import { finderCors, response } from "../_shared/prospectfinder-auth.ts";
import { requireCrmUser, getApiKey } from "../_shared/auth.ts";

// Optional Gemini search grounded in Google Search results. Keys never leave
// Supabase; requests are authorized CRM admin sessions and explicitly opted in.
// Gemini 2.5 is restricted on newer API projects and can return 404 even
// when visible in Google model listings. Prefer newer search-capable models.
const PREFERRED_MODELS=["gemini-3.5-flash-lite","gemini-3.6-flash","gemini-3.8-flash","gemini-3.1-flash-lite","gemini-3-flash-preview","gemini-2.5-flash"];
const API="https://generativelanguage.googleapis.com/v1beta/";
const endpoint=API+"models/";
async function listAvailableModels(key:string):Promise<string[]>{
 const supported=new Set<string>();
 let pageToken="";
 for(let index=0;index<2;index++){
  const qs=new URLSearchParams({pageSize:"100"});
  if(pageToken)qs.set("pageToken",pageToken);
  const r=await fetch(API+"models?"+qs.toString(),{
   headers:{"x-goog-api-key":key},signal:AbortSignal.timeout(9500)
  });
  if(!r.ok){
   const reason=r.status===400||r.status===401||r.status===403
    ?"Google rejected the Gemini key or model-list access (HTTP "+r.status+")."
    :"Could not list Gemini models (HTTP "+r.status+").";
   throw Error(reason);
  }
  const info=await r.json();
  for(const item of info.models||[]){
   const id=String(item.name||"").replace(/^models\//,"");
   if((item.supportedGenerationMethods||[]).includes("generateContent"))supported.add(id);
  }
  pageToken=String(info.nextPageToken||"");
  if(!pageToken)break;
 }
 return PREFERRED_MODELS.filter(m=>supported.has(m));
}
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
  if(!actual&&item.source_title){
   const title=norm(item.source_title);
   actual=sources.find(x=>title.length>3&&norm(x.title)===title);
  }
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
const guide='Find up to 3 genuine U.S. companies or nonprofits using LIVE Google Search. Return only a JSON object with an organizations array. Each item has name, website, email, phone, city, state, source_url and source_title (all strings). Supply only public information visible in Google Search results. Prefer search results from an organization own website. Copy the title of the actual cited web search result into source_title and its URL into source_url when available; do not invent sources or domains. Never invent emails or phone numbers; use empty strings if absent. If no reliably grounded organization is found return {"organizations":[]}.';

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
   // Query the actual models visible to this key rather than probing retired
   // Gemini 2.5 and mistaking an unavailable model for an invalid credential.
   const models=await listAvailableModels(key);
   if(!models.length)return response({connected:false,provider:"gemini",
    message:"Key accepted, but Google lists no supported Flash search model for this API project. Check your Google AI Studio model permissions."},200,h);
   return response({connected:true,provider:"gemini",model:models[0],
    message:"Key accepted. Preferred available model: "+models[0]+". Live Google Search grounding, quota and billing have not yet been tested."},200,h);
  }
  const keyword=text(payload.keyword,90);
  const city=text(payload.city,70),state=text(payload.state,45),industry=text(payload.category,85);
  const kind=["both","smb","nonprofit"].includes(payload.type)?payload.type:"both";
  if(!keyword&&!city&&!state&&!industry)
   return response({error:"Enter a city, state, industry or keyword."},400,h);
  const prompt="Research "+(kind==="nonprofit"?"nonprofit organizations":kind==="smb"?"small businesses or companies":"companies and nonprofits")+" in the United States. Keyword: "+(keyword||"any")+". City: "+(city||"unspecified")+". State: "+(state||"unspecified")+". Industry: "+(industry||"any")+". "+guide;
  // Model selection is based on Google's current models.list for this key.
  // A 404 may still occur for a listed model; only then try the next known
  // supported option. Never retry quota, billing, or permission errors.
  const models=await listAvailableModels(key);
  if(!models.length)return response({error:"No supported Gemini Flash model is available to this API key. Check available models in Google AI Studio."},409,h);
  const body=JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],
    tools:[{google_search:{}}],generationConfig:{temperature:0.1,maxOutputTokens:1800}});
  let data:Json|null=null,modelUsed="",last404=false;
  const totalTimeout=AbortSignal.timeout(44000);
  for(const model of models.slice(0,3)){
   const r=await fetch(endpoint+model+":generateContent",{
    method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},
    body,signal:totalTimeout
   });
   if(r.status===404){last404=true;continue;}
   if(!r.ok){
    // Google returns 429 both for transient rate limits and permanent zero
    // free-tier grounding quota. Inspect only documented quota metadata;
    // never return Google's raw response or any secret-bearing request data.
    if(r.status===429){
     let details:Json={};
     try{details=await r.json();}catch{}
     const googleError=details?.error||{};
     const items=Array.isArray(googleError.details)?googleError.details:[];
     const violations=items.flatMap((d:Json)=>Array.isArray(d.violations)?d.violations:[]);
     const quotaZero=violations.some((q:Json)=>String(q.quotaValue)==="0")
       ||/limit:\s*0(?:\s|,|$)/i.test(String(googleError.message||""));
     const retryInfo=items.find((d:Json)=>typeof d.retryDelay==="string");
     const retryMatch=String(retryInfo?.retryDelay||"").match(/^(\d+(?:\.\d+)?)s$/);
     const retryAfterSeconds=retryMatch?Math.min(3600,Math.ceil(Number(retryMatch[1]))):null;
     const code=quotaZero?"GEMINI_QUOTA_ZERO":"GEMINI_RATE_LIMIT";
     const msg=quotaZero
      ?"Google reports zero available quota for this Gemini model or Google Search grounding. The API free tier may not include grounding. Check Google AI Studio usage and billing; free CRM sources remain available."
      :"Google returned HTTP 429 (quota or rate limit). Check Gemini project quota and billing in Google AI Studio. A temporary rate limit may reset; zero quota will not.";
     return response({error:msg,code,model,retryAfterSeconds},429,h);
    }
    const msg=r.status===400?"Google rejected this grounding request (HTTP 400). Check model/tool availability and API configuration.":r.status===403?"Gemini model or Google Search tool access denied (HTTP 403); check this API key's project.":"Gemini returned HTTP "+r.status+".";
    return response({error:msg,model},502,h);
   }
   data=await r.json();
   modelUsed=model;
   break;
  }
  if(!data)return response({error:last404?"Google returned HTTP 404 for the Flash models available to this project. Check your Google AI Studio model access; older 2.5 models may be restricted.":"No usable Gemini model was found.",attemptedModels:models.slice(0,3)},502,h);
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
  return response({organizations:all,source:"Gemini Google Search",model:modelUsed,groundedSources:sourceCount,
   note:sourceCount?"Results require source review; source-listed contacts are unverified.":"Google Search grounding returned no source citations; no ungrounded leads were accepted."},200,h);
 }catch(e){
  const description=e instanceof Error?e.message:"";
  const problem=e instanceof Error&&e.name==="TimeoutError"?"Gemini search timed out.":description.startsWith("Google rejected")||description.startsWith("Could not list")?description:"Gemini request could not be completed.";
  return response({error:problem},502,h);
 }
});