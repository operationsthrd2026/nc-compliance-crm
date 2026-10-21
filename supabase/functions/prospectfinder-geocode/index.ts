import { finderCors, requireCrmUser, response } from "../_shared/prospectfinder-auth.ts";

// US ZIP and city lookup using the public Zippopotam.us postal-data API.
// Avoids public Nominatim, whose usage policy is unsuitable for generic CRM geocoding.
// References: https://docs.zippopotam.us/docs/v1/
// City coordinates are an approximate centroid of associated ZIP locations.
type Location = {lat:number,lon:number,source:string};
const cache = new Map<string,{expires:number,data:Location}>();
const validState=/^[A-Z]{2}$/;
const validCity=/^[\p{L} .'-]{2,80}$/u;
const validZip=/^\d{5}$/;

Deno.serve(async (req:Request) => {
  const headers=finderCors(req);
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  if(req.method!=="POST") return response({error:"Method not allowed"},405,headers);
  const auth=await requireCrmUser(req,headers);
  if(!auth.ok) return auth.response;

  try{
    const data=await req.json();
    const city=String(data?.city||"").trim().slice(0,80);
    const state=String(data?.state||"").trim().toUpperCase();
    const zip=String(data?.zip||"").trim();
    if(!zip&&!city) return response({error:"Enter a city or ZIP code"},400,headers);
    if(city&&!validCity.test(city))return response({error:"Invalid city"},400,headers);
    if(state&&!validState.test(state))return response({error:"Invalid U.S. state"},400,headers);
    if(zip&&!validZip.test(zip))return response({error:"ZIP must have five digits"},400,headers);
    if(!zip&&!state)return response({error:"Select a U.S. state with your city"},400,headers);

    const key=[city.toLowerCase(),state,zip].join("|");
    const hit=cache.get(key);
    if(hit&&hit.expires>Date.now())return response(hit.data,200,headers);

    // ZIP is authoritative when supplied. For city-only lookup, state is required.
    const url=zip
      ? "https://api.zippopotam.us/us/"+encodeURIComponent(zip)
      : "https://api.zippopotam.us/us/"+encodeURIComponent(state.toLowerCase())+"/"+encodeURIComponent(city.toLowerCase());
    const upstream=await fetch(url,{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(11000)});
    if(upstream.status===404)return response({error:"No postal coordinates for this ZIP/city. Try a nearby ZIP code."},404,headers);
    if(!upstream.ok)return response({error:"Postal location service unavailable ("+upstream.status+")"},502,headers);
    const result=await upstream.json();
    const records=Array.isArray(result?.places)?result.places:[];
    const expectedState=state;
    const matching=records.filter((p:Record<string,unknown>)=>
      (!expectedState||String(p["state abbreviation"]||"").toUpperCase()===expectedState)
      &&Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude)));
    if(!matching.length)return response({error:"No matching U.S. location found; check the state and ZIP"},404,headers);

    // City queries often contain multiple ZIPs, use an average centre rather
    // than first ZIP; ZIP lookups use the exact postal centroid.
    const lat=matching.reduce((v:number,p:Record<string,unknown>)=>v+Number(p.latitude),0)/matching.length;
    const lon=matching.reduce((v:number,p:Record<string,unknown>)=>v+Number(p.longitude),0)/matching.length;
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<18||lat>72||lon< -180||lon> -65)
      return response({error:"Location coordinates outside supported U.S. area"},422,headers);

    const location:Location={lat,lon,source:"Zippopotam.us / GeoNames postal centroids"};
    if(cache.size>300)cache.clear();
    cache.set(key,{expires:Date.now()+86400000,data:location});
    return response(location,200,headers);
  }catch(e){
    return response({error:e instanceof Error&&e.name==="TimeoutError"?"Postal location lookup timed out":"Postal location lookup failed"},502,headers);
  }
});