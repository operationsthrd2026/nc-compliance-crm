import { finderCors, response } from "../_shared/prospectfinder-auth.ts";
import { requireCrmUser, getApiKey } from "../_shared/auth.ts";

// Paid AI web research: admin-only and explicit per-search consent.
// Every returned record MUST have a corresponding real web-search citation.
type Provider="openai"|"anthropic";
type Row=Record<string,unknown>;
const tracker=new Map<string,number[]>();
function limited(user:string){
 const now=Date.now(),arr=(tracker.get(user)||[]).filter(n=>now-n<600000);
 if(arr.length>=4)return true;
 if(tracker.size>400)tracker.clear();
 tracker.set(user,[...arr,now]);return false;
}
function plain(v:unknown,len=160){return typeof v==="string"?v.replace(/[\x00-\x1f]/g," ").trim().slice(0,len):"";}
function url(v:unknown){
 if(typeof v!=="string"||v.length>500||/\s/.test(v))return "";
 try{const u=new URL(v);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password&&u.hostname.includes(".")?u.toString():"";}catch{return "";}
}
function parseJson(raw:string):Row[]{
 try{
  raw=raw.trim().replace(/^\x60{3}(?:json)?\s*/i,"").replace(/\x60{3}\s*$/,"").trim();
  raw=raw.slice(raw.indexOf("{"),raw.lastIndexOf("}")+1);
  const parsed=JSON.parse(raw);
  return Array.isArray(parsed.organizations)?parsed.organizations.slice(0,3):[];
 }catch{return [];}
}
function normalize(body:string,citations:string[],provider:Provider){
 const approved=[...new Set(citations.map(url).filter(Boolean))];
 if(!approved.length)return [];
 const collected:Row[]=[];
 const banned=["linkedin.com","facebook.com","instagram.com","google.com","yelp.com","openstreetmap.org","projects.propublica.org"];
 for(const r of parseJson(body)){
  const companyName=plain(r?.name);
  const claimed=url(r?.source_url);
  if(companyName.length<3||!claimed||!approved.includes(claimed))continue;
  const host=new URL(claimed).hostname.replace(/^www\./,"").toLowerCase();
  const site=url(r?.website);
  const siteHost=site?new URL(site).hostname.replace(/^www\./,"").toLowerCase():"";
  const website=site&&host===siteHost&&!banned.some(x=>siteHost===x||siteHost.endsWith("."+x))?site:"";
  const e=plain(r?.email,254),p=plain(r?.phone,70);
  const email=/^[^\s@<>]+@[^\s@<>]+\.[a-zA-Z]{2,}$/.test(e)?e:"";
  const phone=/^\+?[\d\s()./-]{7,70}$/.test(p)&&p.replace(/\D/g,"").length>=7?p:"";
  const cityMarket=[plain(r?.city,75),plain(r?.state,25)].filter(Boolean).join(", ");
  collected.push({companyName,cityMarket,market:cityMarket,website,email,phone,
   emailPhone:[email,phone].filter(Boolean).join(" | "),sourceUrl:claimed,
   sourceType:provider==="openai"?"OpenAI Web Search":"Claude Web Search",
   contactName:"",title:"",hrPersonListed:"Unknown",vertical:"",
   verificationNotes:"AI-extracted from cited web search, NOT independently verified. Review the source before outreach.",
   whyFit:"AI web search with source citation"});
 }
 return collected;
}
const instructions='Search live web sources for up to three REAL U.S. businesses or nonprofits matching the request. Return ONLY a JSON object with an "organizations" array of objects containing name, website, email, phone, city, state, source_url (all strings). Each source_url MUST be the EXACT URL of a cited web-search result. Prefer the actual organization website instead of directories or social profiles. Include website ONLY when the cited source is the organization site. Include contact details ONLY when explicitly public in search results. Never infer emails, domains or numbers; use empty strings. If unsure, output {"organizations":[]} and never fabricate.';

Deno.serve(async(req:Request)=>{
 const h=finderCors(req);
 if(req.method==="OPTIONS")return new Response("ok",{headers:h});
 if(req.method!=="POST")return response({error:"Method not allowed"},405,h);
 const auth=await requireCrmUser(req,h,{adminOnly:true});
 if(!auth.ok)return auth.response;
 let data:Row={};try{data=await req.json();}catch{return response({error:"Invalid JSON"},400,h);}
 const provider=data.provider as Provider,action=plain(data.action);
 if(!["openai","anthropic"].includes(provider)||!["search","test"].includes(action))
  return response({error:"Unknown AI provider or action"},400,h);
 if(action==="search"&&data.confirmPaid!==true)
  return response({error:"Approve possible paid AI web-search charges before searching."},400,h);
 const key=await getApiKey(auth.admin,provider,provider==="openai"?"OPENAI_API_KEY":"ANTHROPIC_API_KEY");
 if(!key)return response({error:(provider==="openai"?"OpenAI":"Claude")+" API key not configured. Add it in API Integrations."},409,h);
 if(limited(action+":"+auth.email+":"+provider))return response({error:"Too many AI requests. Try again later."},429,h);
 try{
  if(action==="test"){
   const endpoint=provider==="openai"?"https://api.openai.com/v1/models":"https://api.anthropic.com/v1/models?limit=1";
   const headers=provider==="openai"?{Authorization:"Bearer "+key}:{"x-api-key":key,"anthropic-version":"2023-06-01"};
   const res=await fetch(endpoint,{headers,signal:AbortSignal.timeout(8000)});
   return response({connected:res.ok,provider,message:res.ok?"API key accepted; billing/web search permissions are untested.":"Provider rejected key or API permission (HTTP "+res.status+")."},res.ok?200:502,h);
  }
  const keyword=plain(data.keyword,90),location=plain(data.location,110),category=plain(data.category,90),kind=plain(data.type,25);
  if(!keyword&&!location&&!category)return response({error:"Specify a location, keyword or industry."},400,h);
  const task="Find up to 3 real U.S. "+(kind==="nonprofit"?"nonprofit organizations":kind==="smb"?"small businesses":"organizations")+"; keyword: "+(keyword||"any")+"; industry: "+(category||"any")+"; location: "+(location||"United States")+". Search live web results, cite sources and return JSON only.";
  let foundText="",cites:string[]=[],searched=false;
  if(provider==="openai"){
   const r=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
    body:JSON.stringify({model:"gpt-5-mini",tools:[{type:"web_search",search_context_size:"low"}],
     tool_choice:"required",include:["web_search_call.action.sources"],max_output_tokens:1200,store:false,instructions,input:task}),
    signal:AbortSignal.timeout(44000)
   });
   if(!r.ok)return response({error:"OpenAI web search unavailable (HTTP "+r.status+"). Check API billing and model/tool access."},502,h);
   const raw=await r.json(),outputs=Array.isArray(raw.output)?raw.output:[];
   searched=outputs.some((x:Row)=>x.type==="web_search_call");
   // Use real search metadata as well as text citation annotations. This avoids
   // discarding a valid source solely because the model returned JSON instead
   // of a prose paragraph with citation markers.
   for(const item of outputs){
    if(item.type==="web_search_call"){
     const sources=Array.isArray(item.action?.sources)?item.action.sources:[];
     for(const source of sources)if(source?.type==="url"&&source.url)cites.push(source.url);
    }
    if(item.type==="message")for(const part of item.content||[]){
     if(part.type==="output_text")foundText+=String(part.text||"");
     for(const cite of part.annotations||[])if(cite.type==="url_citation"&&cite.url)cites.push(cite.url);
    }
   }
  }else{
   const r=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",headers:{"x-api-key":key,"anthropic-version":"2023-06-01","Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-haiku-5-5",max_tokens:1200,system:instructions,
      tools:[{type:"web_search_20250305",name:"web_search",max_uses:1}],
      messages:[{role:"user",content:task+" You must perform web search."}]}),
    signal:AbortSignal.timeout(44000)
   });
   if(!r.ok)return response({error:"Claude web search unavailable (HTTP "+r.status+"). Check API billing and enable web search in the Claude Console."},502,h);
   const raw=await r.json();
   for(const b of raw.content||[]){
    if(b.type==="server_tool_use"&&b.name==="web_search")searched=true;
    if(b.type==="text"){
     foundText+=String(b.text||"");
     for(const cite of b.citations||[])if(cite.url)cites.push(cite.url);
    }
    if(b.type==="web_search_tool_result"&&Array.isArray(b.content))
     for(const hit of b.content)if(hit.url)cites.push(hit.url);
   }
  }
  if(!searched)return response({error:"AI provider did not run live web search. No model-memory results accepted."},502,h);
  return response({provider,organizations:normalize(foundText,cites,provider),citationCount:new Set(cites).size,
   notice:"AI-extracted web results with citations; contact details are not verified. Provider charges may apply."},200,h);
 }catch(e){
  const timedOut=e instanceof Error&&e.name==="TimeoutError";
  return response({error:timedOut?"AI web search timed out.":"AI provider request failed; check network or API permissions."},502,h);
 }
});