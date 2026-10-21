import { finderCors, response } from "../_shared/prospectfinder-auth.ts";
import { requireCrmUser, getApiKey } from "../_shared/auth.ts";

// The browser never handles saved Hunter / Apollo keys. Tests call zero-credit
// provider health endpoints. Only an explicit Hunter domain action spends credits.
const allowedProvider = ["hunter", "apollo"];
type Body = {action?:string,provider?:string,domain?:string,keywords?:string,location?:string,title?:string};
const domainRe=/^(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const attempts=new Map<string,number[]>();
const limited=(id:string,limit=5,window=600000)=>{
  const now=Date.now(),old=(attempts.get(id)||[]).filter(t=>now-t<window);
  if(old.length>=limit){attempts.set(id,old);return true;}
  if(attempts.size>500)attempts.clear();
  attempts.set(id,[...old,now]);return false;
};
const fetchJSON=async(url:string,options:RequestInit,timeout=12000)=>{
  const res=await fetch(url,{...options,signal:AbortSignal.timeout(timeout)});
  let data:Record<string,any>={};
  try{data=await res.json();}catch{}
  return {res,data};
};
const header=(key:string)=>({"Accept":"application/json","x-api-key":key});
const reason=(code:number,provider:string)=>code===401||code===403
  ? provider+" rejected the saved key or the API endpoint is not permitted on your plan ("+code+")."
  : code===429?provider+" rate limit reached."
  : provider+" API returned HTTP "+code+".";

Deno.serve(async(req:Request)=>{
  const cors=finderCors(req);
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return response({error:"Method not allowed"},405,cors);
  // All calls require a real Supabase user that maps to an active CRM account.
  const auth=await requireCrmUser(req,cors);
  if(!auth.ok)return auth.response;
  let input:Body={};
  try{input=await req.json();}catch{return response({error:"Invalid JSON"},400,cors);}
  const {action,provider}=input;
  if(!allowedProvider.includes(provider||"")||!["test","apollo-people","hunter-domain"].includes(action||""))
    return response({error:"Unsupported provider or action"},400,cors);
  if(action==="apollo-people"&&provider!=="apollo"||action==="hunter-domain"&&provider!=="hunter")
    return response({error:"Provider/action mismatch"},400,cors);
  // Admin permissions required for connection tests and any credit-consuming lookup.
  if((action==="test"||action==="hunter-domain")&&!["superadmin","admin"].includes(auth.role))
    return response({error:"Admin access required to test keys or spend Hunter credits"},403,cors);
  const key=await getApiKey(auth.admin,provider!,provider==="hunter"?"HUNTER_API_KEY":"APOLLO_API_KEY");
  if(!key)return response({error:provider+" API key not configured; add it in API Integrations."},409,cors);
  try{
    if(action==="test"){
      if(limited("test:"+auth.email+":"+provider,8))return response({error:"Too many connection checks. Try again later."},429,cors);
      const upstream=provider==="apollo"
        ? await fetchJSON("https://api.apollo.io/api/v1/auth/health",{headers:header(key)},9000)
        : await fetchJSON("https://api.hunter.io/v2/account",{headers:header(key)},9000);
      if(!upstream.res.ok)return response({error:reason(upstream.res.status,provider!),provider,connected:false},upstream.res.status===429?429:502,cors);
      if(provider==="apollo"){
        const healthy=upstream.data.healthy===true&&upstream.data.is_logged_in===true;
        return response({provider,connected:healthy,message:healthy?"Apollo key is valid":"Apollo health check did not confirm an active API login."},200,cors);
      }
      const account=upstream.data.data||{};
      const credits=account.requests?.credits?.remaining??account.requests?.searches?.remaining??null;
      return response({provider,connected:!!(account.id||account.plan_name||account.email),message:"Hunter account reached",plan:account.plan_name||"Unknown",remaining:typeof credits==="number"?credits:null},200,cors);
    }

    if(action==="apollo-people"){
      const keywords=String(input.keywords||"").trim().slice(0,100);
      const location=String(input.location||"").trim().slice(0,90);
      const title=String(input.title||"human resources").trim().slice(0,70);
      if(!keywords&&!location)return response({error:"Enter a company, industry keyword, or U.S. location."},400,cors);
      if(!title)return response({error:"Specify a job title to target."},400,cors);
      if(limited("apollo:"+auth.email,15))return response({error:"Too many people searches. Try again later."},429,cors);
      // Apollo documents People API Search under /api/v1/mixed_people/api_search.
      // This search does not return emails or phones; never claim verified contact info.
      const filters:Record<string,unknown>={page:1,per_page:10,person_titles:[title]};
      if(keywords)filters.q_keywords=keywords;
      if(location)filters.organization_locations=[location];
      const {res,data}=await fetchJSON("https://api.apollo.io/api/v1/mixed_people/api_search",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":key},
        body:JSON.stringify(filters)
      });
      if(!res.ok)return response({error:reason(res.status,"Apollo"),status:res.status},502,cors);
      const people=(Array.isArray(data.people)?data.people:[]).slice(0,10).map((p:any)=>({
        companyName:String(p.organization?.name||p.organization_name||"").slice(0,160),
        contactName:[p.first_name,p.last_name].filter(Boolean).join(" ").slice(0,160),
        title:String(p.title||"").slice(0,150),
        cityMarket:[p.organization?.city||p.city,p.organization?.state||p.state].filter(Boolean).join(", ").slice(0,150),
        sourceUrl:typeof p.linkedin_url==="string"&&p.linkedin_url.startsWith("https://")?p.linkedin_url:"",
        website:String(p.organization?.website_url||p.organization?.website||p.organization?.primary_domain||p.organization?.domain||""),
        email:"",phone:"",
        sourceType:"Apollo.io (People Search)",
        verificationNotes:"Apollo People Search: email and phone not provided. Research contact details before outreach.",
        whyFit:"Apollo people search for "+(keywords||location),
        hrPersonListed:/hr|people|talent|human resources/i.test(String(p.title||""))?"Yes":"Unknown",
      })).filter((p:any)=>p.companyName);
      return response({provider,people,count:people.length,contactDetailsIncluded:false},200,cors);
    }

    // Hunter Domain Search consumes credits. Only explicit admin click, never auto-trigger.
    const domain=String(input.domain||"").trim().toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/.*$/,"");
    if(domain.length>180||!domainRe.test(domain))
      return response({error:"Enter a valid company domain such as example.org"},400,cors);
    if(limited("hunter:"+auth.email,5))
      return response({error:"Hunter domain lookup limit reached; try again later."},429,cors);
    const url=new URL("https://api.hunter.io/v2/domain-search");
    url.searchParams.set("domain",domain);
    url.searchParams.set("limit","10");
    const {res,data}=await fetchJSON(url.toString(),{headers:header(key)});
    if(!res.ok)return response({error:reason(res.status,"Hunter"),status:res.status},502,cors);
    const info=data.data||{};
    const org=String(info.organization||domain).slice(0,160);
    const people=(Array.isArray(info.emails)?info.emails:[]).slice(0,10).map((e:any)=>({
      companyName:org,
      contactName:[e.first_name,e.last_name].filter(Boolean).join(" ").slice(0,160),
      title:String(e.position||"").slice(0,150),
      emailPhone:String(e.value||"").slice(0,150),
      email:String(e.value||"").slice(0,150),
      phone:String(e.phone_number||e.phone||"").slice(0,70),
      website:"https://"+domain,
      cityMarket:"",
      sourceUrl:"",
      sourceType:"Hunter.io (Domain Search)",
      verificationNotes:"Hunter email found for "+domain+". Verification status: "+String(e.verification?.status||"not verified")+". Confirm before outreach.",
      whyFit:"Domain search of "+domain,
      hrPersonListed:/hr|people|talent|human resources/i.test(String(e.position||""))?"Yes":"Unknown",
    })).filter((p:any)=>p.emailPhone);
    return response({provider,people,count:people.length,domain,mayConsumeCredits:true},200,cors);
  }catch(e){
    // Do not echo a provider error body: it might include keys or private data.
    return response({error:e instanceof Error&&e.name==="TimeoutError"?"The provider timed out.":"Provider could not be reached. Check availability."},502,cors);
  }
});