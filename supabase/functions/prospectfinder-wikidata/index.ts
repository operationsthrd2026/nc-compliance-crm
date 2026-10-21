import { finderCors, requireCrmUser, response } from "../_shared/prospectfinder-auth.ts";

// Free Wikimedia Action API organization lookup. No API key, model or paid
// search provider. Only named, source-listed U.S. organizations are returned.
// Wikimedia is a community-edited knowledge graph, NOT a local business index.
type Entity=Record<string,any>;
const cache=new Map<string,{expires:number,rows:any[]}>();
const calls=new Map<string,number[]>();
const UA="ProspectFinderCRM/1.0 (https://github.com/operationsthrd2026/nc-compliance-crm; public organization lookup)";
const orgRe=/\b(company|business|corporation|enterprise|firm|nonprofit|non-profit|not-for-profit|charit(?:y|able)|foundation|association|organisation|organization|university|college|school|hospital|health system|clinic|church|mosque|temple|museum|library|bank|retailer|restaurant|pharmacy|manufacturer|insurance|institution|cooperative|society|startup|publisher|professional service|charitable trust|healthcare provider)\b/i;
const nonprofitRe=/\b(nonprofit|non-profit|not-for-profit|charit(?:y|able)|foundation|association|ngo|humanitarian|mission|religious organization)\b/i;
const blockedHosts=["facebook.com","linkedin.com","instagram.com","x.com","twitter.com","google.com","yelp.com","wikidata.org","wikipedia.org"];
function safeSite(s:unknown) {
 if(typeof s!=="string"||s.length>450||/\s/.test(s))return "";
 try{
  const u=new URL(s);
  if(!["https:","http:"].includes(u.protocol)||u.username||u.password||!u.hostname.includes("."))return "";
  const host=u.hostname.replace(/^www\./,"");
  if(blockedHosts.some(x=>host===x||host.endsWith("."+x)))return "";
  return u.toString();
 }catch{return "";}
}
function email(s:unknown){
 const v=String(s||"").replace(/^mailto:/i,"").trim();
 return /^[^\s@<>]+@[^\s@<>]+\.[a-zA-Z]{2,}$/.test(v)&&v.length<=254?v:"";
}
function phone(s:unknown){
 const v=String(s||"").trim();
 return /^\+?[\d\s.()/-]{7,60}$/.test(v)&&v.replace(/\D/g,"").length>=7?v:"";
}
function claim(e:Entity,p:string):any[] {
 return (e?.claims?.[p]||[])
   .filter((x:any)=>x.rank!=="deprecated"&&x.mainsnak?.snaktype==="value")
   .sort((a:any,b:any)=>(a.rank==="preferred"?-1:0)-(b.rank==="preferred"?-1:0))
   .map((x:any)=>x.mainsnak.datavalue?.value).filter(Boolean);
}
function values(e:Entity,p:string){return claim(e,p).map(x=>typeof x==="string"?x:"");}
function qids(e:Entity,p:string){return claim(e,p).map(x=>x?.id).filter(x=>/^Q\d+$/.test(x));}
async function getApi(p:Record<string,string>,ms=8500):Promise<any>{
 const url=new URL("https://www.wikidata.org/w/api.php");
 for(const [key,val] of Object.entries({format:"json",...p}))url.searchParams.set(key,val);
 const res=await fetch(url,{headers:{Accept:"application/json","User-Agent":UA},signal:AbortSignal.timeout(ms)});
 if(!res.ok)throw Error("Wikidata unavailable (HTTP "+res.status+")");
 const data=await res.json();
 if(data?.error)throw Error("Wikidata returned an API error");
 return data;
}
Deno.serve(async(req:Request)=>{
 const headers=finderCors(req);
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return response({error:"Method not allowed"},405,headers);
 const auth=await requireCrmUser(req,headers);
 if(!auth.ok)return auth.response;
 let input:Record<string,unknown>;
 try{input=await req.json();}catch{return response({error:"Invalid JSON"},400,headers);}
 const keyword=String(input.keyword||"").trim().slice(0,85);
 const city=String(input.city||"").trim().slice(0,70);
 const stateName=String(input.stateName||"").trim().slice(0,70);
 const type=String(input.type||"both");
 if(keyword.length<3)return response({error:"Enter a named organization or a keyword of 3+ characters for Wikidata."},400,headers);
 if(!/^[\p{L}\p{N} &,.'()/-]{3,85}$/u.test(keyword)||!["both","smb","nonprofit"].includes(type)
  ||(city&&!/^[\p{L} .'-]{2,70}$/u.test(city))
  ||(stateName&&!/^[\p{L} .'-]{2,70}$/u.test(stateName)))
  return response({error:"Unsupported search term or location"},400,headers);
 const k=[keyword.toLowerCase(),city.toLowerCase(),stateName.toLowerCase(),type].join("|");
 const saved=cache.get(k);
 if(saved&&saved.expires>Date.now())return response({organizations:saved.rows,source:"Wikidata (cached)"},200,headers);
 const id=auth.email||"unknown",now=Date.now();
 const recent=(calls.get(id)||[]).filter(t=>now-t<60000);
 if(recent.length>=5)return response({error:"Free Wikidata lookup rate limited. Try again in a minute."},429,headers);
 if(calls.size>400)calls.clear();
 calls.set(id,[...recent,now]);
 try{
  // Wikimedia wbsearchentities: search index first, then batch-fetch claims.
  const find=await getApi({action:"wbsearchentities",search:keyword,language:"en",type:"item",limit:"18"},8500);
  const hits=Array.isArray(find.search)?find.search:[];
  const ids=[...new Set(hits.map((x:any)=>x.id).filter((x:any)=>/^Q\d+$/.test(x)))].slice(0,18);
  if(!ids.length)return response({organizations:[],source:"Wikidata",note:"No matching organization entity found. Search by an organization name."},200,headers);
  const detail=await getApi({action:"wbgetentities",ids:ids.join("|"),props:"claims|labels|descriptions",languages:"en",languagefallback:"1"},8500);
  const entities=detail.entities||{};
  const hqIds=[...new Set(ids.flatMap((id:string)=>qids(entities[id], "P159")))].slice(0,25);
  let locations:Record<string,string>={};
  if((city||stateName)&&hqIds.length){
   try{
    const hq=await getApi({action:"wbgetentities",ids:hqIds.join("|"),props:"labels",languages:"en",languagefallback:"1"},6000);
    locations=Object.fromEntries(Object.entries(hq.entities||{}).map(([id,rec]:[string,any])=>[id,rec?.labels?.en?.value||""]));
   }catch{/* city filter can also use the entity description */}
  }
  const rows:any[]=[];
  for(const id of ids){
   const e=entities[id];if(!e||e.missing)continue;
   const label=String(e.labels?.en?.value||"").trim();
   const descr=String(e.descriptions?.en?.value||"").trim();
   if(!label||!orgRe.test(descr))continue;
   if(type==="nonprofit"&&!nonprofitRe.test(descr))continue;
   const country=qids(e,"P17");
   if(country.length&&!country.includes("Q30"))continue;
   const unitedStates=country.includes("Q30")||/\b(american|united states|u\.s\.|usa)\b/i.test(descr);
   if(!unitedStates)continue; // never present an ungrounded non-US result.
   const hqs=qids(e,"P159").map(x=>locations[x]||"").filter(Boolean);
   const text=[descr,...hqs].join(" ").toLowerCase();
   if(city&&!text.includes(city.toLowerCase()))continue;
   if(stateName&&!city&&!text.includes(stateName.toLowerCase()))continue;
   const website=values(e,"P856").map(safeSite).find(Boolean)||"";
   const publicEmail=values(e,"P968").map(email).find(Boolean)||"";
   const publicPhone=values(e,"P1329").map(phone).find(Boolean)||"";
   // Wikidata is useful when at least one source-listed contact field exists.
   if(!website&&!publicEmail&&!publicPhone)continue;
   const market=hqs[0]|| (city?[city,stateName].filter(Boolean).join(", "):stateName);
   rows.push({companyName:label,contactName:"",title:"",cityMarket:market,market,
    website,email:publicEmail,phone:publicPhone,
    emailPhone:[publicEmail,publicPhone].filter(Boolean).join(" | "),
    sourceUrl:"https://www.wikidata.org/wiki/"+id,
    sourceType:"Wikidata (community records)",vertical:"",hrPersonListed:"Unknown",
    verificationNotes:"Wikidata community-reported organization, location, website and contact data. Not independently verified.",
    whyFit:"Matching Wikidata organization record"});
   if(rows.length>=12)break;
  }
  if(cache.size>200)cache.clear();
  cache.set(k,{expires:Date.now()+3600000,rows});
  return response({organizations:rows,source:"Wikidata",note:"Searches named organizations, not an exhaustive local business directory. Public data may be incomplete."},200,headers);
 }catch(e){
  return response({error:e instanceof Error?e.message:"Free Wikidata lookup unavailable"},502,headers);
 }
});