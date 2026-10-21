import { finderCors, requireCrmUser, response } from "../_shared/prospectfinder-auth.ts";

// Small-volume U.S. location lookup for the feature-branch preview.
// Public Nominatim: rate-limit and cache. Move to a licensed/self-hosted
// geocoder for production-scale searching.
const cache=new Map<string,{expires:number,lat:number,lon:number}>();
let lastRequestTime=0;
Deno.serve(async(req:Request)=>{
  const headers=finderCors(req);
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return response({error:"Method not allowed"},405,headers);
  const auth=await requireCrmUser(req,headers);
  if(!auth.ok)return auth.response;
  try{
    const input=await req.json();
    const city=String(input?.city||"").trim().slice(0,80);
    const state=String(input?.state||"").trim().toUpperCase();
    const zip=String(input?.zip||"").trim();
    if(!city&&!zip)return response({error:"Enter a city or ZIP for local business searches"},400,headers);
    if(city&&!/^[\p{L} .'-]{2,80}$/u.test(city))return response({error:"Invalid city"},400,headers);
    if(state&&!/^[A-Z]{2}$/.test(state))return response({error:"Invalid state"},400,headers);
    if(zip&&!/^\d{5}$/.test(zip))return response({error:"Invalid ZIP"},400,headers);
    const cacheKey=[city.toLowerCase(),state,zip].join("|");
    const old=cache.get(cacheKey);
    if(old&&old.expires>Date.now())return response({lat:old.lat,lon:old.lon},200,headers);
    // At most one upstream request per second per warm function instance.
    const delay=Math.max(0,1100-(Date.now()-lastRequestTime));
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    lastRequestTime=Date.now();
    const url=new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format","jsonv2");
    url.searchParams.set("countrycodes","us");
    url.searchParams.set("limit","1");
    url.searchParams.set("q",[zip,city,state,"United States"].filter(Boolean).join(", "));
    const contact=Deno.env.get("NOMINATIM_CONTACT_EMAIL")||"";
    if(contact.includes("@"))url.searchParams.set("email",contact);
    const res=await fetch(url.toString(),{
      headers:{"Accept":"application/json","User-Agent":"ProspectFinderCRM/1.0 (https://github.com/operationsthrd2026/nc-compliance-crm)"},
      signal:AbortSignal.timeout(13000)
    });
    if(!res.ok)return response({error:"Location lookup temporarily unavailable ("+res.status+")"},502,headers);
    const data=await res.json();
    const hit=data?.[0];
    if(!hit)return response({error:"No matching U.S. location found"},404,headers);
    const lat=Number(hit.lat),lon=Number(hit.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return response({error:"Invalid location response"},502,headers);
    if(cache.size>300)cache.clear();
    cache.set(cacheKey,{lat,lon,expires:Date.now()+24*60*60*1000});
    return response({lat,lon},200,headers);
  }catch{return response({error:"Location lookup unavailable"},502,headers);}
});