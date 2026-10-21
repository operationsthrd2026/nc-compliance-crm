import { finderCors, response } from "../_shared/prospectfinder-auth.ts";
import { requireCrmUser, getApiKey } from "../_shared/auth.ts";

// Free-plan-compatible Groq Browser Search with strict source URL filtering.
// Search is always optional and keys never leave the server.
const MODEL="openai/gpt-oss-20b";
const API="https://api.groq.com/openai/v1/";
type Dict=Record<string,any>;
const hits=new Map<string,number[]>();
function clean(input:unknown,length=160){
 return typeof input==="string"?input.replace(/[\x00-\x1f]/g," ").trim().slice(0,length):"";
}
function url(input:unknown){
 const raw=clean(input,480);
 if(!raw||/\s/.test(raw))return "";
 try{
  const parsed=new URL(raw);
  if(!["https:","http:"].includes(parsed.protocol)||!parsed.hostname.includes(".")||parsed.username||parsed.password)return "";
  const h=parsed.hostname.toLowerCase().replace(/^www\./,"");
  if(/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h))return "";
  return parsed.toString();
 }catch{return "";}
}
function organizationUrl(input:unknown){
 const candidate=url(input);
 if(!candidate)return "";
 const host=new URL(candidate).hostname.toLowerCase().replace(/^www\./,"");
 const aggregators=["facebook.com","instagram.com","linkedin.com","x.com","twitter.com",
 "yelp.com","wikipedia.org","wikidata.org","google.com","openstreetmap.org",
 "linktr.ee","projects.propublica.org"];
 return aggregators.some(x=>host===x||host.endsWith("."+x))?"":candidate;
}
function extract(input:string):Dict[]{
 const raw=input.trim().replace(/^\x60{3}(?:json)?\s*/i,"").replace(/\x60{3}\s*$/,"").trim();
 const start=raw.indexOf("{"),end=raw.lastIndexOf("}");
 if(start<0||end<start)return [];
 try {
  const root=JSON.parse(raw.slice(start,end+1));
  return Array.isArray(root.organizations)?root.organizations.slice(0,4):[];
 }catch{return [];}
}
function collect(output:string,scope:string){
 const out:Dict[]=[],seen=new Set<string>();
 for(const item of extract(output)){
  const companyName=clean(item.name,145),sourceUrl=url(item.source_url);
  if(companyName.length<3||!sourceUrl)continue;
  const website=organizationUrl(item.website);
  const foundEmail=clean(item.email,254);
  const email=/^[^\s@<>]+@[^\s@<>]+\.[a-zA-Z]{2,}$/.test(foundEmail)?foundEmail:"";
  const number=clean(item.phone,65);
  const phone=/^\+?[\d\s().\/-]{7,65}$/.test(number)&&number.replace(/\D/g,"").length>=7?number:"";
  const cityMarket=[clean(item.city,60),clean(item.state,45)].filter(Boolean).join(", ")||scope;
  const identity=(companyName+"|"+website+"|"+cityMarket).toLowerCase();
  if(seen.has(identity))continue;
  seen.add(identity);
  out.push({
   companyName,contactName:"",title:"",cityMarket,market:cityMarket,
   website,email,phone,emailPhone:[email,phone].filter(Boolean).join(" | "),
   sourceUrl,sourceType:"Groq GPT-OSS · Browser Search",vertical:"",
   hrPersonListed:"Unknown",whyFit:"Groq browser-search discovery",
   verificationNotes:"Groq's browser-search model reported this web source and these contact fields. Not independently verified; review source website, email and phone before outreach."
  });
 }
 return out;
}
function throttle(id:string){
 const now=Date.now(),recent=(hits.get(id)||[]).filter(t=>now-t<600000);
 if(recent.length>=4)return true;
 if(hits.size>500)hits.clear();
 hits.set(id,[...recent,now]);return false;
}
Deno.serve(async(req:Request)=>{
 const headers=finderCors(req);
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return response({error:"Method not allowed"},405,headers);
 const auth=await requireCrmUser(req,headers,{adminOnly:true});
 if(!auth.ok)return auth.response;
 let body:Dict;
 try{body=await req.json();}catch{return response({error:"Invalid request body"},400,headers);}
 if(!["test","search"].includes(body?.action))return response({error:"Unsupported action"},400,headers);
 if(body.action==="search"&&body.confirmUsage!==true)
  return response({error:"Approve one Groq browser-search request before searching."},400,headers);
 const key=await getApiKey(auth.admin,"groq","GROQ_API_KEY");
 if(!key)return response({error:"Groq API key not configured. Save it under API Integrations."},409,headers);
 if(throttle((auth.email||"user")+"|"+body.action))
  return response({error:"Groq CRM search limit reached: 4 attempts per 10 minutes. Free directory searches remain available."},429,headers);
 try{
  if(body.action==="test"){
   // Lists models only; no inference or browser search.
   const r=await fetch(API+"models",{headers:{Authorization:"Bearer "+key},
    signal:AbortSignal.timeout(10000)});
   if(!r.ok)return response({connected:false,error:"Groq refused this key or model-list access (HTTP "+r.status+")."},502,headers);
   const models=await r.json();
   const included=Array.isArray(models?.data)&&models.data.some((x:Dict)=>x.id===MODEL&&x.active!==false);
   return response({connected:included,model:MODEL,
    message:included?"Groq API key accepted and GPT-OSS 20B is listed. Browser Search access and remaining free allowance are not yet tested.":"Key accepted; GPT-OSS 20B is not listed for this account. Check Groq model permissions."},200,headers);
  }
  const keyword=clean(body.keyword,85),city=clean(body.city,65),state=clean(body.state,55);
  const category=clean(body.category,75);
  const kind=["both","smb","nonprofit"].includes(body.type)?body.type:"both";
  if(!keyword&&!city&&!state&&!category)
   return response({error:"Enter a keyword, city, state or industry."},400,headers);
  const place=[city,state].filter(Boolean).join(", ");
  const target=kind==="nonprofit"?"nonprofits and charities":kind==="smb"?"small businesses and companies":"businesses and nonprofit organizations";
  const system="You are conducting REAL live organization research. Use the browser_search tool. Find up to FOUR US organizations matching the user input. Your final answer must be ONLY a JSON object with key organizations, containing an array of {name,website,email,phone,city,state,source_url}. The source_url MUST be an actual page you found with Browser Search. Do not invent URLs or infer company domains from names. Report only publicly visible contact details from the cited page; otherwise use empty strings. Prefer the primary organization website and provide that URL separately. If the search returns no usable real source pages, respond with {\"organizations\":[]}. No markdown, prose, or invented details.";
  const prompt="Live search for "+target+". Keyword: "+(keyword||"any")+"; industry: "+(category||"any")+"; location: "+(place||"United States")+". Prefer organizations located in the specified city/state. Return up to four real, source-linked matches.";
  const r=await fetch(API+"chat/completions",{
   method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
   body:JSON.stringify({model:MODEL,messages:[{role:"system",content:system},{role:"user",content:prompt}],
    tools:[{type:"browser_search"}],tool_choice:"required",citation_options:"enabled",
    reasoning_effort:"low",max_completion_tokens:2400,stream:false}),
   signal:AbortSignal.timeout(48000)
  });
  if(!r.ok){
   const error=r.status===429?"Groq free-tier rate or token limit reached. Check console.groq.com/settings/limits.":r.status===403?"Groq account cannot use Browser Search with GPT-OSS 20B. Check account and model permissions.":r.status===400?"Groq rejected the browser-search request. This model or tool may not be available for your key.":"Groq Browser Search returned HTTP "+r.status+".";
   return response({error,provider:"groq"},r.status===429?429:502,headers);
  }
  const data=await r.json();
  const answer=clean(data?.choices?.[0]?.message?.content,16000);
  const orgs=collect(answer,place);
  return response({organizations:orgs,source:"Groq Browser Search",
    note:orgs.length?"Groq-reported sources; contact details require independent verification.":"No safely structured and source-linked company records were returned. Try a specific company or city."},200,headers);
 }catch(e){
  return response({error:e instanceof Error&&e.name==="TimeoutError"?"Groq Browser Search timed out.":"Groq request failed; check provider availability."},502,headers);
 }
});