import { finderCors, requireCrmUser, response } from "../_shared/prospectfinder-auth.ts";

// Structured local business search. We build Overpass QL ourselves instead of
// accepting arbitrary QL from the browser. Results are OpenStreetMap data.
const endpoints=[
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const safeTag=/^[a-z_]{2,25}$/;
const jsonType="application/x-www-form-urlencoded";
Deno.serve(async(req:Request)=>{
  const headers=finderCors(req);
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  if(req.method!=="POST") return response({error:"Method not allowed"},405,headers);
  const auth=await requireCrmUser(req,headers);
  if(!auth.ok) return auth.response;
  let body: Record<string,unknown>;
  try {body=await req.json();}catch{return response({error:"Invalid JSON"},400,headers);}
  const lat=Number(body.lat), lon=Number(body.lon), radiusMiles=Number(body.radiusMiles);
  const tags=body.tags;
  if(!Number.isFinite(lat)||lat<18||lat>72||!Number.isFinite(lon)||lon< -180||lon> -65
      ||!Number.isFinite(radiusMiles)||radiusMiles<1||radiusMiles>50
      ||!Array.isArray(tags)||tags.length<1||tags.length>12
      ||!tags.every(t=>Array.isArray(t)&&t.length===2&&t.every(v=>typeof v==="string"&&safeTag.test(v))))
    return response({error:"Invalid or unsupported area/category"},400,headers);
  // One bounded request; no open-ended bulk scraping or editable query strings.
  const meters=Math.round(radiusMiles*1609.344);
  const clauses=tags.map(([key,value])=>
    'node["'+key+'"="'+value+'"](around:'+meters+','+lat+','+lon+');'+
    'way["'+key+'"="'+value+'"](around:'+meters+','+lat+','+lon+');'
  ).join("");
  const query="[out:json][timeout:25];("+clauses+");out center 75;";
  let detail="Search temporarily unavailable";
  for(const endpoint of endpoints) {
    try {
      const result=await fetch(endpoint,{method:"POST",headers:{"Content-Type":jsonType},
        body:"data="+encodeURIComponent(query),signal:AbortSignal.timeout(29000)});
      if(!result.ok){detail="Business directory error ("+result.status+")";continue;}
      const data=await result.json();
      return response({elements:Array.isArray(data.elements)?data.elements.slice(0,75):[]},200,headers);
    } catch { detail="Business directory timed out or unavailable"; }
  }
  return response({error:detail},502,headers);
});