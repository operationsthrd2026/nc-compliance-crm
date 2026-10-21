import React,{useMemo,useState} from "react";
import {EMPTY_P,VERTICALS} from "../../constants.js";
import {US_STATES,RADII,locationIssue,locationLabel} from "../../lib/usLocation.js";

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
const fallbackTags=[["shop","yes"],["office","company"],["shop","convenience"],["amenity","restaurant"],["amenity","cafe"],["shop","hairdresser"],["craft","electrician"],["craft","plumber"]];
const clean=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const idFor=r=>r.ein?"ein:"+r.ein:r.osmId?"osm:"+r.osmId:clean(r.companyName)+"|"+clean(r.cityMarket);
const fromNonprofit=o=>({
 companyName:o.name||"Unnamed nonprofit",contactName:"",title:"",emailPhone:"",
 cityMarket:locationLabel(o.state,o.city,""),market:locationLabel(o.state,o.city,""),
 sourceUrl:o.ein?"https://projects.propublica.org/nonprofits/organizations/"+o.ein:"",
 sourceType:"ProPublica Nonprofit Explorer",vertical:"Nonprofits & Associations",hrPersonListed:"Unknown",
 verificationNotes:"Listed in IRS-derived nonprofit records. Contact details and current exemption status not independently verified.",
 whyFit:"Nonprofit directory match",ein:o.ein||"",website:""
});
const fromBusiness=(e,fallbackLocation)=>{
 const t=e.tags||{},city=t["addr:city"]||"",state=t["addr:state"]||"";
 const website=t.website||t["contact:website"]||"",email=t.email||t["contact:email"]||"",phone=t.phone||t["contact:phone"]||"";
 const osmLink="https://www.openstreetmap.org/"+e.type+"/"+e.id;
 return {companyName:t.name||"Unnamed small business",contactName:"",title:"",
 emailPhone:[email,phone].filter(Boolean).join(" | "),cityMarket:city||state?locationLabel(state,city,""):fallbackLocation,market:city||state?locationLabel(state,city,""):fallbackLocation,
 sourceUrl:website||osmLink,website,sourceType:"OpenStreetMap (Overpass)",vertical:"",
 hrPersonListed:"Unknown",verificationNotes:"Community-contributed location and contact data; email addresses are not independently verified.",
 whyFit:"Business listing matching chosen category",osmId:e.type+":"+e.id};
};
const field=(label,child)=><label style={{display:"flex",flexDirection:"column",gap:5,fontSize:11,color:MUTED,fontWeight:650}}>{label}{child}</label>;
export default function NationwideFinder({onClose,onAddProspects,crmData=[],baseUrl,requestHeaders,embedded=false}){
 const [type,setType]=useState("both"),[state,setState]=useState(""),[city,setCity]=useState(""),[zip,setZip]=useState("");
 const [radius,setRadius]=useState(15),[vertical,setVertical]=useState(""),[keyword,setKeyword]=useState("");
 const [busy,setBusy]=useState(false),[adding,setAdding]=useState(false),[rows,setRows]=useState([]),[selected,setSelected]=useState([]);
 const [message,setMessage]=useState(""),[page,setPage]=useState(null),[logs,setLogs]=useState([]);
 const existing=useMemo(()=>new Set(crmData.map(x=>clean(x.companyName)+"|"+clean(x.cityMarket||x.market))),[crmData]);
 const shown=useMemo(()=>rows.map(r=>({...r,already:existing.has(clean(r.companyName)+"|"+clean(r.cityMarket||r.market))})),[rows,existing]);
 const append=items=>setRows(prev=>{const seen=new Set(prev.map(idFor));return [...prev,...items.filter(r=>{const id=idFor(r);if(seen.has(id))return false;seen.add(id);return true;})];});
 const addLog=t=>setLogs(prev=>[...prev,t]);
 const post=async(path,body)=>{
  if(!baseUrl)throw new Error("Supabase is not configured.");
  const res=await fetch(baseUrl+"/functions/v1/"+path,{method:"POST",headers:await requestHeaders(),body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||"HTTP "+res.status+" on "+path+". Check Edge Function deployment.");
  return data;
 };
 const run=async(next=false)=>{
  const error=locationIssue(state,city.trim(),zip);
  if(error){setMessage(error);return;}
  if(!keyword.trim()&&!vertical&&!state&&!city&&!zip){setMessage("Choose an area, category, or keyword to begin.");return;}
  setBusy(true);setMessage("");
  if(!next){setRows([]);setSelected([]);setLogs([]);setPage(null);}
  const loc=locationLabel(state,city.trim(),zip);
  try{
   if(type!=="smb"){
    try{
     if(zip&&!city){addLog("Nonprofit Explorer does not support exact ZIP-only filtering. Choose city and state for a targeted nonprofit search.");}
     else{
      const q=keyword.trim()||(nonProfitCategories.includes(vertical)?vertical:"nonprofit");
      const currentPage=next?(page||0):0;
      const info=await post("prospectfinder-nonprofits",{query:q,state:state||null,page:currentPage});
      let organizations=info.organizations||[];
      if(city.trim())organizations=organizations.filter(o=>clean(o.city)===clean(city));
      append(organizations.map(fromNonprofit));
      setPage(currentPage+1<Number(info.num_pages||0)?currentPage+1:null);
      addLog("Nonprofits: "+organizations.length+" results from page "+(currentPage+1)+" in "+loc+".");
     }
    }catch(e){addLog("Nonprofit source: "+e.message);}
   }
   if(!next&&type!=="nonprofit"){
    if(!city.trim()&&!zip){addLog("Small businesses need a city or ZIP. Nationwide bulk OSM searches are not supported.");}
    else{
     try{
      const location=await post("prospectfinder-geocode",{city:city.trim(),state,zip});
      const tags=categories[vertical]||fallbackTags;
      const raw=await post("prospectfinder-businesses",{lat:location.lat,lon:location.lon,radiusMiles:Number(radius),tags});
      let businesses=(raw.elements||[]).filter(e=>e.tags?.name);
      if(keyword.trim())businesses=businesses.filter(e=>clean(e.tags.name).includes(clean(keyword))||clean(Object.values(e.tags).join(" ")).includes(clean(keyword)));
      append(businesses.slice(0,75).map(e=>fromBusiness(e,loc)));
      addLog("Small businesses: "+businesses.length+" matched near "+loc+". OSM coverage varies.");
     }catch(e){addLog("Small business source: "+e.message);}
    }
   }
  }finally{setBusy(false);}
 };
 const add=async()=>{
  const items=shown.filter(r=>selected.includes(idFor(r))&&!r.already).map(r=>{
   const {ein,osmId,website,...cleaned}=r;
   return {...EMPTY_P,...cleaned,id:Date.now()+Math.random(),priorityScore:"",currentStatus:"NEW"};
  });
  if(!items.length){setMessage("Select at least one prospect not already in the CRM.");return;}
  setAdding(true);setMessage("");
  try{
    await onAddProspects(items);
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
    <p style={{margin:0,color:MUTED,fontSize:12}}>Discover nonprofits and small businesses. Contact verification is separate from directory discovery.</p></div>
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
    <button style={{...btn,background:embedded?"#6454E8":GOLD,color:embedded?"#FFFFFF":DARK,opacity:busy?.55:1}} disabled={busy} onClick={()=>run(false)}>{busy?"Searching live directories…":"Search Prospects"}</button>
   </div>
   {message&&<p role="alert" style={{color:embedded?"#BA3E52":"#fca5a5",fontSize:12}}>{message}</p>}
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
    <table style={{width:"100%",minWidth:750,borderCollapse:"collapse",fontSize:12}}>
     <thead style={{background:embedded?"#F7F7FC":PANEL,color:embedded?"#4F42CE":GOLD}}><tr>{["Select","Organization","Type / Source","Location","Contact","Website / Profile","CRM status"].map(x=><th key={x} style={{padding:12,textAlign:"left"}}>{x}</th>)}</tr></thead>
     <tbody>{shown.map(r=>{
      const key=idFor(r);return <tr key={key} style={{borderTop:"1px solid "+EDGE,opacity:r.already?.55:1}}>
       <td style={{padding:10}}><input type="checkbox" aria-label={"Select "+r.companyName} disabled={r.already} checked={selected.includes(key)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,key]:prev.filter(k=>k!==key))}/></td>
       <td style={{padding:10,fontWeight:650}}>{r.companyName}</td>
       <td style={{padding:10,color:MUTED}}>{r.sourceType}</td><td style={{padding:10,color:MUTED}}>{r.cityMarket||locationLabel(state,city,zip)}</td>
       <td style={{padding:10}}>{r.emailPhone||<span style={{color:MUTED}}>Not listed</span>}</td>
       <td style={{padding:10}}>{r.sourceUrl?<a href={r.sourceUrl} target="_blank" rel="noreferrer" style={{color:GOLD}}>{r.website?"Website":"View listing"} ↗</a>:"—"}</td>
       <td style={{padding:10,color:r.already?"#34d399":MUTED}}>{r.already?"Already in CRM":"New · unverified"}</td>
      </tr>;
     })}
     {!shown.length&&<tr><td colSpan={7} style={{padding:30,textAlign:"center",color:MUTED}}>Choose your location and click Search Prospects. Results come from public directories, not demo data.</td></tr>}
     </tbody>
    </table>
   </div>
   {page!=null&&type!=="smb"&&<button onClick={()=>run(true)} disabled={busy} style={{...btn,marginTop:12,background:"#253454",color:"#F0F4FF"}}>Load more nonprofits</button>}
   <p style={{color:embedded?"#66758D":MUTED,fontSize:10,marginBottom:0}}>Nonprofit results: ProPublica Nonprofit Explorer (IRS-derived). Local businesses: © OpenStreetMap contributors (ODbL). Nationwide bulk business crawling and verified decision-maker contacts are not included in this phase. ZIP filtering is not available in ProPublica nonprofit results.</p>
  </div>
 </div>;
}
