import React,{useMemo,useState} from "react";
import {EMPTY_P,VERTICALS} from "../../constants.js";
import {US_STATES,RADII,locationIssue,locationLabel} from "../../lib/usLocation.js";
import {safeWebsite,safeOrganizationWebsite,safeEmail,safePhone,publicDetailsFromOsm} from "../../lib/contactDetails.js";

const DARK="#0B1426", PANEL="#152442", EDGE="rgba(240,244,255,.14)", GOLD="#DBA843", MUTED="#B1BED7";
const inp={width:"100%",boxSizing:"border-box",padding:"10px 11px",border:"1px solid "+EDGE,background:"#1C2B50",color:"#F0F4FF",borderRadius:8,fontSize:13};
const btn={border:0,borderRadius:8,padding:"10px 16px",background:GOLD,color:DARK,cursor:"pointer",fontWeight:750};
const nonProfitCategories=["Nonprofits & Associations","Faith-Based Organizations","Human Services Nonprofits","Community Development Orgs","Religious & Faith-Based Nonprofits","Social Service Agencies","Arts & Cultural Nonprofits","Environmental Nonprofits","Advocacy Organizations","Foundations & Grantmakers","Education & Schools"];
const categories={
 "Construction & Contractors":[["office","construction"],["craft","electrician"],["craft","plumber"],["craft","carpenter"],["craft","painter"]],
 "Childcare & Licensed Group Homes":[["amenity","childcare"],["amenity","kindergarten"]],
 "Education & Schools":[["amenity","school"],["amenity","college"]],
 "Restaurants & Cafes":[["amenity","restaurant"],["amenity","cafe"],["amenity","fast_food"]],
 "Retail Stores":[["shop","clothes"],["shop","convenience"],["shop","supermarket"],["shop","general"]],
 "Beauty Salons & Spas":[["shop","hairdresser"],["shop","beauty"],["leisure","spa"]],
 "Automotive Services":[["shop","car_repair"],["shop","car"],["amenity","car_wash"]],
 "Cleaning & Maintenance":[["office","cleaning"],["craft","cleaner"]],
 "Professional Services":[["office","lawyer"],["office","accountant"],["office","consulting"]],
 "Fitness & Wellness":[["leisure","fitness_centre"],["leisure","sports_centre"]],
 "Hospitality & Lodging":[["tourism","hotel"],["tourism","guest_house"]],
 "Real Estate Services":[["office","estate_agent"]],
 "Light Manufacturing & Logistics":[["man_made","works"],["industrial","factory"],["office","logistics"]],
 "Healthcare Practices":[["amenity","clinic"],["amenity","doctors"]],
 "Home Health / Homecare":[["healthcare","home_care"],["office","healthcare"]]
};
const fallbackTags=[["amenity","restaurant"],["amenity","cafe"],["shop","convenience"]];
const clean=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const idFor=r=>r.ein?"ein:"+r.ein:r.osmId?"osm:"+r.osmId:(r.contactName||r.emailPhone)?"contact:"+clean(r.companyName)+"|"+clean(r.contactName)+"|"+clean(r.emailPhone):clean(r.companyName)+"|"+clean(r.cityMarket);
const fromNonprofit=o=>({
 companyName:o.name||"Unnamed nonprofit",contactName:"",title:"",emailPhone:"",
 website:safeOrganizationWebsite(o.website||o.website_url||""),email:safeEmail(o.email||""),phone:safePhone(o.phone||""),
 cityMarket:locationLabel(o.state,o.city,""),market:locationLabel(o.state,o.city,""),
 sourceUrl:o.ein?"https://projects.propublica.org/nonprofits/organizations/"+o.ein:"",
 sourceType:"ProPublica Nonprofit Explorer",vertical:"Nonprofits & Associations",hrPersonListed:"Unknown",
 verificationNotes:"Listed in IRS-derived nonprofit records. Contact details and current exemption status not independently verified.",
 whyFit:"Nonprofit directory match",ein:o.ein||"",website:""
});
const fromBusiness=(e,fallbackLocation)=>{
 const t=e.tags||{},city=t["addr:city"]||"",state=t["addr:state"]||"";
 const {website,email,phone}=publicDetailsFromOsm(t);
 const osmLink="https://www.openstreetmap.org/"+e.type+"/"+e.id;
 return {companyName:t.name||"Unnamed small business",contactName:"",title:"",
 emailPhone:[email,phone].filter(Boolean).join(" | "),email,phone,cityMarket:city||state?locationLabel(state,city,""):fallbackLocation,market:city||state?locationLabel(state,city,""):fallbackLocation,
 sourceUrl:osmLink,website,sourceType:"OpenStreetMap (Overpass)",vertical:"",
 hrPersonListed:"Unknown",verificationNotes:"Community-contributed location and contact data; email addresses are not independently verified.",
 whyFit:"Business listing matching chosen category",osmId:e.type+":"+e.id};
};
const field=(label,child)=><label style={{display:"flex",flexDirection:"column",gap:5,fontSize:11,color:MUTED,fontWeight:650}}>{label}{child}</label>;
export default function NationwideFinder({onClose,onAddProspects,crmData=[],baseUrl,requestHeaders,embedded=false,canAdmin=false}){
 const [type,setType]=useState("both"),[state,setState]=useState(""),[city,setCity]=useState(""),[zip,setZip]=useState("");
 const [radius,setRadius]=useState(5),[vertical,setVertical]=useState(""),[keyword,setKeyword]=useState("");
 const [busy,setBusy]=useState(false),[adding,setAdding]=useState(false),[rows,setRows]=useState([]),[selected,setSelected]=useState([]);
 const [message,setMessage]=useState(""),[page,setPage]=useState(null),[logs,setLogs]=useState([]),[sourceErrors,setSourceErrors]=useState([]);
 const [diagnostics,setDiagnostics]=useState([]),[checking,setChecking]=useState(false);
 const [apolloEnabled,setApolloEnabled]=useState(false),[hunterEnabled,setHunterEnabled]=useState(false);
 const [geminiEnabled,setGeminiEnabled]=useState(false),[geminiConsent,setGeminiConsent]=useState(false);
 const [geminiPaused,setGeminiPaused]=useState(false);
 const [groqEnabled,setGroqEnabled]=useState(false),[groqConsent,setGroqConsent]=useState(false),[groqPaused,setGroqPaused]=useState(false);
 const [contactTitle,setContactTitle]=useState("Human Resources"),[domain,setDomain]=useState(""),[allowCredits,setAllowCredits]=useState(false);
 const existing=useMemo(()=>new Set(crmData.map(idFor)),[crmData]);
 const shown=useMemo(()=>rows.map(r=>({...r,already:!!r.already||existing.has(idFor(r))})),[rows,existing]);
 const append=items=>setRows(prev=>{const seen=new Set(prev.map(idFor));return [...prev,...items.filter(r=>{const id=idFor(r);if(seen.has(id))return false;seen.add(id);return true;})];});
 const addLog=t=>setLogs(prev=>[...prev,t]);
 const post=async(path,body)=>{
  if(!baseUrl || !baseUrl.startsWith("https://"))throw new Error("Supabase is not configured in this preview.");
  let res;
  try { res=await fetch(baseUrl+"/functions/v1/"+path,{method:"POST",headers:await requestHeaders(),body:JSON.stringify(body),signal:AbortSignal.timeout(path==="prospectfinder-groq"?65000:path==="prospectfinder-gemini"?55000:path==="prospectfinder-wikidata"?30000:path==="prospectfinder-businesses"?25000:18000)}); }
  catch(e) {throw new Error("Cannot contact "+path+". Check the preview URL, login session, and network/CORS configuration.");}
  const data=await res.json().catch(()=>({}));
  if(!res.ok){
   const error=new Error(data.error||"HTTP "+res.status+" on "+path+". Check Edge Function deployment.");
   error.status=res.status;
   error.code=data.code||"";
   error.retryAfterSeconds=data.retryAfterSeconds||null;
   throw error;
  }
  return data;
 };
 const checkConnections=async()=>{
  if(checking||busy)return;
  setChecking(true);setDiagnostics([]);
  // Fixed, read-only sample searches; this diagnostic never modifies CRM records.
  const record=(name,ok,detail)=>setDiagnostics(prev=>[...prev,{name,ok,detail}]);
  let location=null;
  try{
   location=await post("prospectfinder-geocode",{city:"Austin",state:"TX",zip:"78701"});
   record("U.S. ZIP lookup",true,location.source||"Location found");
  }catch(e){record("U.S. ZIP lookup",false,e?.message||"Lookup failed");}
  try{
   const data=await post("prospectfinder-nonprofits",{query:"Austin",state:"TX",page:0});
   record("Nonprofit directory",true,(data.organizations||[]).length+" sample organizations returned");
  }catch(e){record("Nonprofit directory",false,e?.message||"Search failed");}
  try{
   const w=await post("prospectfinder-wikidata",{keyword:"Microsoft",city:"",stateName:"",type:"smb"});
   record("Wikidata (free)",true,(w.organizations||[]).length+" named organization records returned");
  }catch(e){record("Wikidata (free)",false,e?.message||"Lookup unavailable");}
  if(location){
   try{
    const data=await post("prospectfinder-businesses",{
     lat:location.lat,lon:location.lon,radiusMiles:1,tags:[["amenity","restaurant"]]
    });
    record("Local business directory",true,(data.elements||[]).length+" sample locations returned");
   }catch(e){record("Local business directory",false,e?.message||"Search failed");}
  }else record("Local business directory",false,"Not run because ZIP lookup failed");
  setChecking(false);
 };
 // All source requests are started by the SAME Search Prospects button.
 // Free sources run by category; Apollo is optional and Hunter always requires explicit credit consent.
 const run=async(next=false)=>{
  if(busy)return;
  const error=locationIssue(state,city.trim(),zip);
  if(error){setMessage(error);return;}
  if(next&&page==null)return;
  if(!next&&!keyword.trim()&&!vertical&&!state&&!city.trim()&&!zip&&!(hunterEnabled&&domain.trim())){
   setMessage("Enter a keyword, location, industry, or company domain to search.");return;
  }
  if(!next&&groqEnabled&&(!canAdmin||!groqConsent)){
   setMessage(!canAdmin?"Only CRM administrators may use optional Groq search.":"Confirm one Groq Browser Search request against your account's free plan or quota.");
   return;
  }
  if(!next&&geminiEnabled&&(!canAdmin||!geminiConsent)){
   setMessage(!canAdmin?"Only CRM administrators can enable Gemini.":"Approve Gemini Google Search quota usage and possible API charges for this search.");
   return;
  }
  if(!next&&hunterEnabled&&(!canAdmin||!allowCredits)){
   setMessage(!canAdmin?"Admin access is required for Hunter searches.":"Confirm possible Hunter API credit usage before searching.");
   return;
  }
  setBusy(true);setMessage("");
  if(!next&&geminiEnabled)setGeminiConsent(false); // Approval applies to this one search only.
  if(!next&&groqEnabled)setGroqConsent(false);
  if(!next){setRows([]);setSelected([]);setLogs([]);setSourceErrors([]);setPage(null);}
  const loc=locationLabel(state,city.trim(),zip);
  const tasks=[];
  const notes=[];
  const wantNonprofits=(type!=="smb");
  const wantBusinesses=(type!=="nonprofit");
  const nonprofitQuery=keyword.trim()||(city.trim()?city.trim():"foundation");
  const currentPage=next?(page||0):0;
  if(wantNonprofits&&(keyword.trim()||vertical||state||city.trim()||zip)){
   if(zip&&!city.trim()){
    if(!next)notes.push("Nonprofits: ZIP-only searches are not supported. Add a city to include nonprofit directory results.");
   }else{
    tasks.push(["Nonprofit Explorer",async()=>{
     const info=await post("prospectfinder-nonprofits",{query:nonprofitQuery,city:city.trim(),state:state||null,page:currentPage});
     let matches=Array.isArray(info.organizations)?info.organizations:[];
     if(city.trim())matches=matches.filter(o=>clean(o.city)===clean(city));
     return {items:matches.map(fromNonprofit),page:currentPage+1<Number(info.num_pages||0)?currentPage+1:null};
    }]);
    if(!next&&!keyword.trim()&&!city.trim())notes.push("Nonprofits: showing organizations matching 'foundation'. Enter a keyword for other types.");
   }
  }
  if(!next){
   if(wantBusinesses){
    if(!city.trim()&&!zip)notes.push("Local businesses: enter a city or ZIP to search OpenStreetMap.");
    else tasks.push(["Local businesses",async()=>{
     const location=await post("prospectfinder-geocode",{city:city.trim(),state,zip});
     const tags=categories[vertical]||fallbackTags;
     const raw=await post("prospectfinder-businesses",{lat:location.lat,lon:location.lon,radiusMiles:Number(radius),tags});
     let businesses=(raw.elements||[]).filter(e=>e.tags?.name);
     if(keyword.trim())businesses=businesses.filter(e=>clean(e.tags.name).includes(clean(keyword))||clean(Object.values(e.tags).join(" ")).includes(clean(keyword)));
     return {items:businesses.slice(0,60).map(e=>fromBusiness(e,loc))};
    }]);
   }
   if(apolloEnabled){
    const location=[city.trim(),state,zip].filter(Boolean).join(", ");
    if(!keyword.trim()&&!location)notes.push("Apollo: enter a keyword or U.S. location to include people search.");
    else tasks.push(["Apollo People Search",async()=>{
     const info=await post("prospectfinder-contacts",{
      action:"apollo-people",provider:"apollo",keywords:keyword.trim(),location,title:contactTitle.trim()||"Human Resources"
     });
     return {items:(info.people||[]).filter(p=>p.companyName).map(p=>({
      ...p,cityMarket:p.cityMarket||loc,market:p.cityMarket||loc,
      website:safeOrganizationWebsite(p.website||""),email:safeEmail(p.email||p.emailPhone||""),phone:safePhone(p.phone||""),
      emailPhone:p.emailPhone||"",verificationNotes:p.verificationNotes||"Apollo does not provide email/phone in People Search."
     }))};
    }]);
   }
   if(groqEnabled){
    tasks.push(["Groq Browser Search",async()=>{
     const stateName=(US_STATES.find(([code])=>code===state)||[])[1]||"";
     const data=await post("prospectfinder-groq",{
      action:"search",confirmUsage:true,keyword:keyword.trim(),
      city:city.trim(),state:stateName||state,category:vertical,type
     });
     return {items:(data.organizations||[]).filter(p=>p.companyName&&p.sourceUrl).map(p=>({
      ...p,website:safeOrganizationWebsite(p.website||""),
      email:safeEmail(p.email||""),phone:safePhone(p.phone||""),
      emailPhone:[safeEmail(p.email||""),safePhone(p.phone||"")].filter(Boolean).join(" | "),
      sourceUrl:safeWebsite(p.sourceUrl),
      verificationNotes:(p.verificationNotes||"")+" AI-search results and contacts require source verification."
     })),note:data.note||""};
    }]);
   }
   if(geminiEnabled){
    tasks.push(["Gemini + Google Search",async()=>{
     const stateName=(US_STATES.find(([code])=>code===state)||[])[1]||"";
     const data=await post("prospectfinder-gemini",{
       action:"search",confirmUsage:true,keyword:keyword.trim(),city:city.trim(),
       state:stateName||state,category:vertical,type
     });
     return {items:(data.organizations||[]).filter(p=>p.companyName&&p.sourceUrl).map(p=>({
       ...p,website:safeOrganizationWebsite(p.website||""),
       email:safeEmail(p.email||""),phone:safePhone(p.phone||""),
       emailPhone:[safeEmail(p.email||""),safePhone(p.phone||"")].filter(Boolean).join(" | "),
       sourceUrl:safeWebsite(p.sourceUrl),
       verificationNotes:(p.verificationNotes||"")+" Gemini-grounded result; verify against its source before outreach."
     }))};
    }]);
   }
   // Wikidata: free entity search for named organizations; no API key or AI.
   if(keyword.trim().length>=3){
    tasks.push(["Wikidata organizations",async()=>{
     const stateName=(US_STATES.find(([code])=>code===state)||[])[1]||"";
     const info=await post("prospectfinder-wikidata",{keyword:keyword.trim(),city:city.trim(),stateName,type});
     return {items:(info.organizations||[]).filter(p=>p.companyName&&p.sourceUrl).map(p=>({
       ...p,website:safeOrganizationWebsite(p.website||""),
       email:safeEmail(p.email||""),phone:safePhone(p.phone||""),
       emailPhone:[safeEmail(p.email||""),safePhone(p.phone||"")].filter(Boolean).join(" | "),
       sourceUrl:safeWebsite(p.sourceUrl)
     })),note:info.note||""};
    }]);
   }else{
    notes.push("Wikidata: enter a named organization or keyword (3+ characters) to include free organization lookups.");
   }
   if(hunterEnabled&&domain.trim()){
    tasks.push(["Hunter Domain Search",async()=>{
     const info=await post("prospectfinder-contacts",{action:"hunter-domain",provider:"hunter",domain:domain.trim()});
     return {items:(info.people||[]).filter(p=>p.companyName).map(p=>({
      ...p,cityMarket:p.cityMarket||loc,market:p.cityMarket||loc,
      website:safeOrganizationWebsite(p.website||""),email:safeEmail(p.email||p.emailPhone||""),phone:safePhone(p.phone||"")
     }))};
    }]);
   }
  }
  if(!tasks.length){
   setBusy(false);
   setMessage(notes.join(" ")||"No eligible sources. Choose a location or keyword to search.");
   return;
  }
  try{
   // Run the enabled sources concurrently; a failure from one must not hide other results.
   const outcomes=await Promise.all(tasks.map(async ([name,query])=>{
    try{return {name,...await query()};}
    catch(e){return {name,error:e?.message||"Source unavailable",status:e?.status,code:e?.code,retryAfterSeconds:e?.retryAfterSeconds};}
   }));
   const merged=[],seen=new Set(),logsOut=[...notes],failed=[];
   let nextPage=null;
   for(const outcome of outcomes){
    if(outcome.error){
     if(outcome.name==="Groq Browser Search"&&outcome.status===429){
      setGroqEnabled(false);setGroqConsent(false);setGroqPaused(true);
      logsOut.push("Groq paused after its account rate/quota limit. Free directory searches remain active.");
     }
     if(outcome.name==="Gemini + Google Search"&&outcome.status===429){
      setGeminiEnabled(false);
      setGeminiConsent(false);
      setGeminiPaused(true);
      logsOut.push("Gemini automatically turned off for this page session after Google's quota/rate-limit error. Free directory searches remain active.");
     }
     failed.push(outcome.name+": "+outcome.error);
     logsOut.push("✕ "+outcome.name+": "+outcome.error);
     continue;
    }
    const items=outcome.items||[];
    logsOut.push("✓ "+outcome.name+": "+items.length+" result"+(items.length===1?"":"s")+".");
    if(outcome.name==="Groq Browser Search"&&!items.length)logsOut.push("Groq returned no usable, source-linked prospect records. Try a more specific organization, city, or industry. "+(outcome.note||""));
    if(outcome.name==="Wikidata organizations"&&!items.length)logsOut.push("Wikidata covers named, documented organizations, not every small business. Try a specific company name or use local business search. "+(outcome.note||""));
    if(outcome.name==="Nonprofit Explorer")nextPage=outcome.page??null;
    for(const item of items){
     const key=idFor(item);
     if(!seen.has(key)){seen.add(key);merged.push(item);}
    }
   }
   // Optional credit-based enrichment, limited to 3 unique source-listed domains.
   // Never guess a website or silently spend credits. Explicit domain searches
   // are already handled above and are not repeated here.
   if(!next&&hunterEnabled&&!domain.trim()&&allowCredits&&canAdmin){
    const candidates=[],seenDomains=new Set();
    for(const item of merged){
     if(item.email||!item.website)continue;
     try{
      const hostname=new URL(item.website).hostname.toLowerCase().replace(/^www\./,"");
      if(!hostname.includes(".")||seenDomains.has(hostname))continue;
      seenDomains.add(hostname);
      candidates.push({item,hostname});
      if(candidates.length>=3)break;
     }catch{continue;}
    }
    if(!candidates.length)logsOut.push("Hunter: no source-listed websites are available to look up emails.");
    else{
     logsOut.push("Hunter: checking "+candidates.length+" known website domain"+(candidates.length===1?"":"s")+" (may consume up to "+candidates.length+" domain-search credits).");
     const results=await Promise.all(candidates.map(async ({item,hostname})=>{
      try {
       const info=await post("prospectfinder-contacts",{action:"hunter-domain",provider:"hunter",domain:hostname});
       const contacts=(info.people||[]).filter(p=>safeEmail(p.email||p.emailPhone));
       const preferred=contacts.find(p=>/human resources|\bhr\b|people|talent/i.test(p.title||""))||contacts[0];
       return {item,hostname,email:preferred?safeEmail(preferred.email||preferred.emailPhone):""};
      }catch(e){return {item,hostname,error:e?.message||"Request failed"};}
     }));
     let enriched=0;
     for(const result of results){
      if(result.error){failed.push("Hunter "+result.hostname+": "+result.error);continue;}
      if(result.email){
       result.item.email=result.email;
       result.item.emailPhone=[result.email,result.item.phone].filter(Boolean).join(" | ");
       result.item.emailSource="Hunter.io · matched listed domain";
       result.item.verificationNotes=(result.item.verificationNotes||"")+" Hunter.io returned "+result.email+" for the source-listed domain "+result.hostname+"; address not independently verified.";
       enriched++;
      }
     }
     logsOut.push("Hunter: "+enriched+" organization"+(enriched===1?"":"s")+" enriched with a public email.");
    }
   }
   if(next)append(merged);else setRows(merged);
   setPage(nextPage);
   setSourceErrors(failed);
   setLogs(prev=>next?[...prev,...logsOut]:logsOut);
   if(failed.length){
    setMessage(merged.length+" results returned; "+failed.length+" source"+(failed.length===1?"":"s")+" failed. "+failed.join(" • "));
   }else if(!merged.length&&!next){
    setMessage("Search finished. No matching prospects from the selected sources. Try another keyword or a city and a 5-mile radius.");
   }
  }catch(e){
   setSourceErrors(["Search: "+(e?.message||"Unexpected error")]);
   setMessage("Search could not complete: "+(e?.message||"Unexpected error"));
  }finally{setBusy(false);}
 };
 const add=async()=>{
  const items=shown.filter(r=>selected.includes(idFor(r))&&!r.already).map(r=>{
   const {ein,osmId,...cleaned}=r;
   return {...EMPTY_P,...cleaned,emailPhone:[r.email,r.phone].filter(Boolean).join(" | ")||r.emailPhone||"",id:Date.now()+Math.random(),priorityScore:"",currentStatus:"NEW"};
  });
  if(!items.length){setMessage("Select at least one prospect not already in the CRM.");return;}
  setAdding(true);setMessage("");
  try{
    const saved=await onAddProspects(items);
    if(!Array.isArray(saved)||saved.length!==items.length)throw new Error("The CRM did not confirm all selected leads. Check Saved Prospects before trying again.");
    if(embedded){setRows(prev=>prev.map(r=>selected.includes(idFor(r))?{...r,already:true}:r));setSelected([]);setMessage(items.length+" prospect"+(items.length===1?"":"s")+" sent to CRM.");}
    else onClose?.();
  }
  catch(e){setMessage("Could not save: "+(e?.message||"Please try again"));}
  finally{setAdding(false);}
 };
 return <div role={embedded?"region":"dialog"} aria-modal={embedded?undefined:"true"} aria-label="Nationwide ProspectFinder" style={embedded?{position:"relative",background:"transparent",padding:0,color:"#1B2943",width:"100%"}:{position:"fixed",inset:0,zIndex:10000,background:"rgba(5,9,19,.86)",padding:18,overflowY:"auto",color:"#F0F4FF"}}>
  <div style={embedded?{maxWidth:"none",margin:0,background:"#fff",border:"1px solid #E6EAF2",borderRadius:18,padding:23,boxShadow:"0 8px 32px #15213a08"}:{maxWidth:1160,margin:"20px auto",background:DARK,border:"1px solid "+EDGE,borderRadius:16,padding:22,boxShadow:"0 18px 60px #0008"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:12}}>
    <div><h2 style={{margin:"0 0 5px",color:embedded?"#4F42CE":GOLD,fontSize:embedded?19:21}}>{embedded?"U.S. organization search":"ProspectFinder · United States"}</h2>
    <p style={{margin:0,color:embedded?"#60708A":MUTED,fontSize:12}}>One search searches multiple directories and optional APIs. All results appear below in one table.</p></div>
    {!embedded&&<button onClick={onClose} style={{...btn,background:PANEL,color:"#F0F4FF"}} aria-label="Close finder">✕</button>}
   </div>
   <div className={embedded?"pf-native-search":""} style={{background:embedded?"#F6F7FC":PANEL,borderRadius:12,padding:16,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(185px,1fr))",gap:12,marginBottom:16}}>
    {field("Prospect category",<select style={inp} value={type} onChange={e=>setType(e.target.value)}><option value="both">Nonprofits & small businesses</option><option value="nonprofit">Nonprofits only</option><option value="smb">Small businesses only</option></select>)}
    {field("State",<select style={inp} value={state} onChange={e=>setState(e.target.value)}><option value="">All states</option>{US_STATES.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select>)}
    {field("City",<input style={inp} placeholder="e.g. Austin" value={city} onChange={e=>setCity(e.target.value)}/>)}
    {field("ZIP code",<input style={inp} inputMode="numeric" maxLength={5} placeholder="e.g. 78701" value={zip} onChange={e=>setZip(e.target.value.replace(/\D/g,"").slice(0,5))}/>)}
    {field("Local search radius",<select style={inp} value={radius} onChange={e=>setRadius(Number(e.target.value))}>{RADII.map(n=><option key={n} value={n}>{n} miles</option>)}</select>)}
    {field("Industry (optional)",<select style={inp} value={vertical} onChange={e=>setVertical(e.target.value)}><option value="">All industries</option>{VERTICALS.map(v=><option key={v} value={v}>{v}</option>)}{Object.keys(categories).filter(x=>!VERTICALS.includes(x)).map(v=><option key={v} value={v}>{v}</option>)}</select>)}
    <div style={{gridColumn:"1 / -1"}}>{field("Business or organization keyword",<input style={inp} value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!busy)run();}} placeholder="e.g. dental, community center, software, charity"/>)}</div>
    <div style={{gridColumn:"1 / -1",border:"1px solid "+(embedded?"#DDDFF0":EDGE),borderRadius:12,padding:"15px 16px",background:embedded?"#FFFFFF":"#0C1B32",color:embedded?"#26324C":"#F0F4FF"}}>
     <strong style={{fontSize:13}}>One search · multiple sources</strong>
     <p style={{margin:"6px 0 12px",fontSize:11,color:embedded?"#64728A":MUTED,lineHeight:1.5}}>Keyless nonprofit, local-business, and Wikidata organization searches are integrated here. Enter a keyword to include Wikidata. Optional Apollo/Hunter services remain below.</p>
     <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:18}}>
      <span style={{fontSize:11,color:embedded?"#248067":"#7DE5BF",fontWeight:700}}>✓ ProPublica + OpenStreetMap + Wikidata · no key</span>
      <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:"pointer"}}><input type="checkbox" checked={apolloEnabled} onChange={e=>setApolloEnabled(e.target.checked)}/> Apollo people · no search credits</label>
      <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:canAdmin?"pointer":"not-allowed",opacity:canAdmin?1:.6}}><input type="checkbox" checked={hunterEnabled} disabled={!canAdmin} onChange={e=>{setHunterEnabled(e.target.checked);if(!e.target.checked)setAllowCredits(false);}}/> Hunter emails · may use credits {canAdmin?"":"(admin only)"}</label>
      <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:canAdmin?"pointer":"not-allowed",opacity:canAdmin?1:.6}}><input type="checkbox" checked={groqEnabled} disabled={!canAdmin||groqPaused} onChange={e=>{setGroqEnabled(e.target.checked);setGroqConsent(false);}}/> Groq GPT-OSS · Browser Search (free-tier limits) {groqPaused?"(paused after rate limit)":canAdmin?"":"(admin only)"}</label>
      <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:canAdmin?"pointer":"not-allowed",opacity:canAdmin?1:.6}}><input type="checkbox" checked={geminiEnabled} disabled={!canAdmin||geminiPaused} onChange={e=>{setGeminiEnabled(e.target.checked);setGeminiConsent(false);}}/> Gemini + Google Search · optional, may require paid Google Search grounding {geminiPaused?"(paused after quota error)":canAdmin?"":"(admin only)"}</label>
     </div>
     {geminiPaused&&<div role="status" style={{gridColumn:"1 / -1",fontSize:11,marginTop:10,lineHeight:1.65,color:embedded?"#A45A31":"#FFCE8A"}}>
      Google returned a Gemini quota/rate-limit error. Gemini has been paused until this page is refreshed; public directory searches remain available. Check
      {" "}<a href="https://aistudio.google.com/usage" target="_blank" rel="noopener noreferrer" style={{color:embedded?"#5143BF":"#FFE3A1"}}>Google AI Studio usage and billing ↗</a>.
      Gemini model availability is not proof of Google Search grounding quota.
     </div>}
     {(apolloEnabled||hunterEnabled)&&<div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:13}}>
      {apolloEnabled&&<label style={{flex:"1 1 180px",fontSize:11,color:embedded?"#405271":MUTED}}>Apollo target role
       <input style={{...inp,marginTop:5,...(embedded?{background:"#fff",color:"#253451",border:"1px solid #DBE1EE"}:{})}} value={contactTitle} onChange={e=>setContactTitle(e.target.value)} placeholder="Human Resources"/>
      </label>}
      {hunterEnabled&&<label style={{flex:"1 1 200px",fontSize:11,color:embedded?"#405271":MUTED}}>Hunter company domain (optional)
       <input style={{...inp,marginTop:5,...(embedded?{background:"#fff",color:"#253451",border:"1px solid #DBE1EE"}:{})}} value={domain} onChange={e=>setDomain(e.target.value)} placeholder="organization.org"/>
      </label>}
     </div>}
     {groqEnabled&&<label style={{display:"flex",alignItems:"flex-start",gap:8,marginTop:12,fontSize:11,cursor:"pointer"}}>
       <input type="checkbox" checked={groqConsent} onChange={e=>setGroqConsent(e.target.checked)}/>
       I authorize one Groq GPT-OSS 20B Browser Search request using my account's API limits. Charges may apply on paid plans; source and contact information must be checked.
     </label>}
     {groqPaused&&<p role="status" style={{fontSize:11,color:embedded?"#A45A31":"#FFCE8A"}}>Groq paused after an account rate limit. Public sources still work. Review <a href="https://console.groq.com/settings/limits" target="_blank" rel="noopener noreferrer">Groq limits ↗</a> before trying again.</p>}
     {geminiEnabled&&<label style={{display:"flex",alignItems:"flex-start",gap:8,marginTop:12,fontSize:11,cursor:"pointer"}}>
       <input type="checkbox" checked={geminiConsent} onChange={e=>setGeminiConsent(e.target.checked)}/>
       I approve one Gemini Google Search grounding request using my API quota; provider charges may apply. This approval resets after searching.
     </label>}
     {hunterEnabled&&<label style={{display:"flex",alignItems:"flex-start",gap:8,marginTop:12,fontSize:11,cursor:"pointer"}}>
       <input type="checkbox" checked={allowCredits} onChange={e=>setAllowCredits(e.target.checked)}/>
       I authorize Hunter domain searches that may use up to 3 credits for websites found, or one domain search if I entered a domain.
     </label>}
     <p style={{margin:"11px 0 0",fontSize:10,color:embedded?"#63718C":MUTED}}>Free public directories and Wikidata run without API keys. Groq GPT-OSS 20B offers browser research within its free API limits. Gemini can require paid grounding. Groq/Gemini source listings and contact details require independent verification; Hunter uses credits only with consent.</p>
    </div>
    <button style={{...btn,background:embedded?"#6454E8":GOLD,color:embedded?"#FFFFFF":DARK,opacity:busy?.55:1}} disabled={busy} onClick={()=>run(false)}>{busy?"Searching enabled sources…":"Search Prospects · All enabled sources"}</button>
    <button type="button" style={{...btn,background:embedded?"#E9E9FC":"#253454",color:embedded?"#5246AC":"#F0F4FF",opacity:checking?.6:1}} disabled={busy||checking} onClick={checkConnections}>{checking?"Checking data sources…":"Check API connections"}</button>
   </div>
   {diagnostics.length>0&&<div role="status" aria-live="polite" style={{background:embedded?"#F4F5FD":"#182644",padding:13,borderRadius:10,marginBottom:14,fontSize:12,color:embedded?"#33435F":"#F0F4FF"}}>
    <strong>Connection diagnostics (Austin, Texas; read-only test)</strong>
    {diagnostics.map(d=><div key={d.name} style={{marginTop:7}}><span style={{color:d.ok?"#059669":"#dc6458",fontWeight:800}}>{d.ok?"✓":"✕"}</span> {d.name}: {d.detail}</div>)}
   </div>}
   {message&&<div role="alert" style={{background:embedded?"#FFF5F1":"rgba(255,151,101,.12)",border:"1px solid #F9B4A4",borderRadius:10,padding:"12px 14px",color:embedded?"#9F3E33":"#ffd1c7",fontSize:12,marginBottom:14,lineHeight:1.5}}><strong>{sourceErrors.length?"Search service issue":"Search notice"}:</strong> {message}</div>}
   {logs.length>0&&<div style={{background:embedded?"#F5F7FD":"#0E1A30",padding:10,borderRadius:8,marginBottom:14,maxHeight:104,overflowY:"auto",fontSize:11,color:embedded?"#57627A":MUTED}}>{logs.map((s,i)=><div key={i}>{s}</div>)}</div>}
   <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:12}}>
    <div><strong>{shown.length} prospects</strong><span style={{color:MUTED,fontSize:12}}> · {selected.length} selected</span></div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <button style={{...btn,background:"#253454",color:"#F0F4FF"}} onClick={()=>setSelected(shown.filter(r=>!r.already).map(idFor))}>Select new</button>
     <button style={{...btn,background:"#253454",color:"#F0F4FF"}} onClick={()=>setSelected([])}>Clear</button>
     <button style={btn} disabled={adding||!selected.length} onClick={add}>{adding?"Saving…":"Save selected to CRM"}</button>
    </div>
   </div>
   <div style={{overflowX:"auto",border:"1px solid "+(embedded?"#E4E8F1":EDGE),borderRadius:10}}>
    <table style={{width:"100%",minWidth:1180,borderCollapse:"collapse",fontSize:12}}>
     <thead style={{background:embedded?"#F7F7FC":PANEL,color:embedded?"#4F42CE":GOLD}}><tr>{["Select","Organization","Type / Source","Location","Contact person","Website","Email","Phone","Source listing","CRM status"].map(x=><th key={x} style={{padding:12,textAlign:"left"}}>{x}</th>)}</tr></thead>
     <tbody>{shown.map(r=>{
      const key=idFor(r);return <tr key={key} style={{borderTop:"1px solid "+EDGE,opacity:r.already?.55:1}}>
       <td style={{padding:10}}><input type="checkbox" aria-label={"Select "+r.companyName} disabled={r.already} checked={selected.includes(key)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,key]:prev.filter(k=>k!==key))}/></td>
       <td style={{padding:10,fontWeight:650}}>{r.companyName}</td>
       <td style={{padding:10,color:embedded?"#485B80":MUTED}}>{r.sourceType}</td><td style={{padding:10,color:embedded?"#485B80":MUTED}}>{r.cityMarket||locationLabel(state,city,zip)}</td>
       <td style={{padding:10}}>
        {r.contactName?<div style={{fontWeight:700,color:embedded?"#20324F":"#F0F4FF"}}>{r.contactName}</div>:<span style={{fontSize:11,color:embedded?"#71809B":MUTED}}>Not listed</span>}
        {r.title&&<div style={{fontSize:11,color:embedded?"#66758D":MUTED,marginTop:2}}>{r.title}</div>}
       </td>
       <td style={{padding:10}}>{r.website?<a href={r.website} target="_blank" rel="noopener noreferrer" style={{color:embedded?"#5143BF":GOLD}}>Visit website ↗</a>:<span style={{fontSize:11,color:embedded?"#71809B":MUTED}}>Not available</span>}</td>
       <td style={{padding:10}}>{r.email?<a href={"mailto:"+r.email} style={{color:embedded?"#5143BF":GOLD,overflowWrap:"anywhere"}}>{r.email}</a>:<span style={{fontSize:11,color:embedded?"#71809B":MUTED}}>Not available</span>}</td>
       <td style={{padding:10}}>{r.phone?<a href={"tel:"+r.phone.replace(/[^\d+]/g,"")} style={{color:embedded?"#5143BF":GOLD}}>{r.phone}</a>:<span style={{fontSize:11,color:embedded?"#71809B":MUTED}}>Not available</span>}</td>
       <td style={{padding:10}}>{r.sourceUrl&&safeWebsite(r.sourceUrl)?<a href={safeWebsite(r.sourceUrl)} target="_blank" rel="noopener noreferrer" style={{color:embedded?"#5143BF":GOLD}}>View source ↗</a>:<span style={{fontSize:11,color:embedded?"#71809B":MUTED}}>—</span>}</td>
       <td style={{padding:10,color:r.already?"#34d399":MUTED}}>{r.already?"Already in CRM":"New · unverified"}</td>
      </tr>;
     })}
     {!shown.length&&<tr><td colSpan={10} style={{padding:30,textAlign:"center",color:embedded?"#66758D":MUTED}}>{busy?"Searching your selected sources…":"Enter a location or keyword, choose optional APIs, then click Search Prospects once. Errors are reported by source above."}</td></tr>}
     </tbody>
    </table>
   </div>
   {page!=null&&type!=="smb"&&<button onClick={()=>run(true)} disabled={busy} style={{...btn,marginTop:12,background:"#253454",color:"#F0F4FF"}}>Load more nonprofits</button>}
   <p style={{color:embedded?"#66758D":MUTED,fontSize:10,marginBottom:0}}>Nonprofit results: ProPublica Nonprofit Explorer (IRS-derived). City/ZIP centroids: Zippopotam.us / GeoNames. Local businesses: © OpenStreetMap contributors (ODbL). Free organization sources: ProPublica Nonprofit Explorer, OpenStreetMap / Overpass and Wikidata. Organization websites, emails and phone numbers are source-reported and not independently verified; some records have no contact fields. Apollo/Hunter require configured third-party access and Hunter can use credits. ZIP filtering is not available in ProPublica nonprofit results.</p>
  </div>
 </div>;
}
