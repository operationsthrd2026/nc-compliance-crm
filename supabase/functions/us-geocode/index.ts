import { corsFor, requireCrmUser } from "../_shared/auth.ts";

// Restricted U.S. geocoding for the prospect finder; no API keys are exposed to the browser.
// Public Nominatim is rate-limited, so a licensed provider or self-hosting is necessary at scale.
const cache = new Map<string,{expires:number,data:{lat:number,lon:number}}>();
Deno.serve(async (req: Request) => {
  const headers={...corsFor(req),"Content-Type":"application/json"};
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers});
  const auth=await requireCrmUser(req,headers);
  if(!auth.ok)return auth.response;
  try{
    const body=await req.json();
    const city=String(body.city||"").trim().slice(0,80);
    const state=String(body.state||"").trim().toUpperCase();
    const zip=String(body.zip||"").trim();
    if(!city&&!zip)return new Response(JSON.stringify({error:"Choose a city or ZIP for local business searches"}),{status:400,headers});
    if(state&&!/^[A-Z]{2}$/.test(state))return new Response(JSON.stringify({error:"Invalid state"}),{status:400,headers});
    if(zip&&!/^\d{5}$/.test(zip))return new Response(JSON.stringify({error:"ZIP must contain five digits"}),{status:400,headers});
    const key=[city.toLowerCase(),state,zip].join("|");
    const hit=cache.get(key);
    if(hit&&hit.expires>Date.now())return new Response(JSON.stringify(hit.data),{headers});
    const contact=Deno.env.get("NOMINATIM_CONTACT_EMAIL")||"";
    if(!contact.includes("@"))return new Response(JSON.stringify({error:"Configure NOMINATIM_CONTACT_EMAIL on this function before use"}),{status:503,headers});
    const url=new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format","jsonv2");
    url.searchParams.set("limit","1");
    url.searchParams.set("countrycodes","us");
    url.searchParams.set("q",[zip,city,state,"USA"].filter(Boolean).join(", "));
    url.searchParams.set("email",contact);
    const res=await fetch(url.toString(),{headers:{"Accept":"application/json","User-Agent":"ProspectFinderCRM/1.0 ("+contact+")"}});
    if(!res.ok)return new Response(JSON.stringify({error:"Geocoding provider unavailable",status:res.status}),{status:502,headers});
    const data=await res.json();
    const match=data?.[0];
    if(!match)return new Response(JSON.stringify({error:"Location not found in the United States"}),{status:404,headers});
    const value={lat:Number(match.lat),lon:Number(match.lon)};
    if(!Number.isFinite(value.lat)||!Number.isFinite(value.lon))throw new Error("Invalid coordinates");
    if(cache.size>500)cache.clear();
    cache.set(key,{expires:Date.now()+86400000,data:value});
    return new Response(JSON.stringify(value),{headers});
  }catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:"Geocoding error"}),{status:500,headers});}
});
