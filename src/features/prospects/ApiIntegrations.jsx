import React, { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Manage server-side API credentials from the new ProspectFinder UI.
 * Only public service IDs and configured flags are read by the browser.
 * Secret values are write-only via the existing admin-checked Supabase RPC.
 * Saving a key does not automatically add a search-source integration.
 */

const builtin = [
  { id: "apollo", label: "Apollo.io", kind: "B2B company and people discovery", link: "https://docs.apollo.io/", note: "People Search is available in Find Prospects when the account has API access. It does not include email or phone." },
  { id: "hunter", label: "Hunter.io", kind: "Domain search and email contacts", link: "https://hunter.io/api-documentation/v2", note: "Domain Search is available in Find Prospects for admins. It can consume Hunter credits." },

];
const noKey = [
  { label: "ProPublica Nonprofit Explorer", detail: "Public nonprofit filings and organization records" },
  { label: "OpenStreetMap / Overpass", detail: "Community-contributed local business listings" },
  { label: "Wikidata · Free Organization Search", detail: "Search known organizations by name; official websites, emails and phones if recorded. No API key or paid AI search." },
  { label: "Zippopotam.us", detail: "City and ZIP centroid lookup" },
];
const servicePattern = /^[a-z][a-z0-9_-]{0,39}$/;
const styles = {
  panel: { background:"#fff", border:"1px solid #E6EAF3", borderRadius:16, padding:22 },
  note: { color:"#6D7A92",fontSize:12,lineHeight:1.65 },
  small: { color:"#62718B",fontSize:11,lineHeight:1.55 },
  control: { border:"1px solid #DAE1ED", background:"#fff",borderRadius:9,padding:"11px 12px",fontSize:13,color:"#1C2944",minWidth:0,width:"100%",boxSizing:"border-box" },
  primary: { background:"#6454E8",color:"#fff",border:0,borderRadius:9,padding:"11px 16px",fontWeight:750,fontSize:12,cursor:"pointer" },
  secondary: { background:"#F5F4FE",color:"#5042B8",border:"1px solid #D8D2FB",borderRadius:9,padding:"10px 14px",fontWeight:700,fontSize:12,cursor:"pointer" },
};
const recordName = id => builtin.find(p=>p.id===id)?.label || id.replaceAll("_"," ").replaceAll("-"," ");

export default function ApiIntegrations({ canAdmin=false, isConnected=false, onLoad, onSave, onOpenAdmin, baseUrl, requestHeaders }) {
  const [configured,setConfigured] = useState({});
  const [loading,setLoading] = useState(true);
  const [pending,setPending] = useState("");
  const [drafts,setDrafts] = useState({});
  const [message,setMessage] = useState(null);
  const [customName,setCustomName] = useState("");
  const [customKey,setCustomKey] = useState("");
  const [customBusy,setCustomBusy] = useState(false);
  const [showCustom,setShowCustom] = useState(false);
  const [reveal,setReveal] = useState({});
  const [tests,setTests] = useState({});
  const [testing,setTesting] = useState("");
  const refresh=useCallback(async()=>{
    if(!isConnected){setConfigured({});setLoading(false);return;}
    setLoading(true);
    try {
      const result=await onLoad();
      setConfigured(result||{});
      setMessage(null);
    }catch(e){
      setMessage({error:true,text:"Could not retrieve saved key status: "+(e?.message||"Request failed")});
    }finally{setLoading(false);}
  },[isConnected,onLoad]);

  useEffect(()=>{refresh();},[refresh]);
  const others=useMemo(()=>Object.keys(configured).filter(x=>!["anthropic","openai"].includes(x)&&!builtin.some(p=>p.id===x)).sort(),[configured]);
  const notice=(text,error=false)=>setMessage({text,error});
  const saveKey=async id=>{
    const key=String(drafts[id]||"").trim();
    if(!canAdmin){notice("Only administrators can update API credentials.",true);return;}
    if(!isConnected){notice("Connect to Supabase first; API keys cannot be saved in demo mode.",true);return;}
    if(!key){notice("Enter a new API key before saving.",true);return;}
    if(key.length>4096){notice("This key exceeds the supported length.",true);return;}
    setPending(id);setMessage(null);
    try{
      await onSave(id,key);
      setDrafts(old=>({...old,[id]:""}));
      const status=await onLoad();
      setConfigured(status||{});
      setTests(old=>({...old,[id]:undefined}));
      notice(recordName(id)+" credential stored on the server. Use Test connection to check whether the provider accepts it.");
    }catch(e){notice("Could not save "+recordName(id)+": "+(e?.message||"Request failed"),true);}
    finally{setPending("");}
  };
  const addCustom=async()=>{
    const id=customName.trim().toLowerCase();
    if(!servicePattern.test(id)){notice("Provider ID must start with a letter and use lowercase letters, numbers, _ or - (maximum 40 characters).",true);return;}
    if(!customKey.trim()){notice("Enter your custom provider's API key.",true);return;}
    if(configured[id]){notice("This provider ID already has a saved credential. Update it in the list instead.",true);return;}
    setCustomBusy(true);
    try{
      await onSave(id,customKey.trim());
      setCustomKey("");setCustomName("");setShowCustom(false);
      setConfigured(await onLoad()||{});
      notice(id+" credential stored. A backend adapter is required before this custom API can supply search results.");
    }catch(e){notice("Could not store custom credential: "+(e?.message||"Request failed"),true);}
    finally{setCustomBusy(false);}
  };
  const testProvider=async id=>{
    if(!isConnected||!canAdmin||!["apollo","hunter"].includes(id))return;
    setTesting(id);
    setTests(old=>({...old,[id]:{busy:true}}));
    try{
      const res=await fetch(baseUrl+"/functions/v1/prospectfinder-contacts",{
        method:"POST",headers:await requestHeaders(),body:JSON.stringify({action:"test",provider:id}),
        signal:AbortSignal.timeout(16000)
      });
      const data=await res.json().catch(()=>({}));
      setTests(old=>({...old,[id]:{ok:res.ok&&data.connected===true,text:res.ok?(data.message||"Check completed")+(data.plan?" · Plan: "+data.plan:"")+(typeof data.remaining==="number"?" · Remaining credits: "+data.remaining:""):(data.error||"HTTP "+res.status)}}));
    }catch(e){
      setTests(old=>({...old,[id]:{ok:false,text:"Connection test failed. Check your login session and network."}}));
    }finally{setTesting("");}
  };
  const provider = (p) => (
    <div key={p.id} style={{border:"1px solid #E7EBF4",borderRadius:13,padding:17,marginTop:11,background:"#FBFCFF"}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div><div style={{fontWeight:800,fontSize:14}}>{p.label}</div><div style={{...styles.note,marginTop:3}}>{p.kind}</div></div>
        <span style={{background:configured[p.id]?"#E4F8EF":"#F0F2F7",color:configured[p.id]?"#107E58":"#69748A",borderRadius:40,padding:"6px 11px",fontSize:11,fontWeight:750}}>
          {configured[p.id]?"Key stored":"No key stored"}
        </span>
      </div>
      <div style={{...styles.small,marginTop:10}}>{p.note}</div>
      {p.link&&<a href={p.link} target="_blank" rel="noopener noreferrer" style={{display:"inline-block",fontSize:11,color:"#6250CE",marginTop:8}}>Provider documentation ↗</a>}
      {canAdmin&&isConnected&&configured[p.id]&&["apollo","hunter"].includes(p.id)&&
        <div style={{marginTop:12,display:"flex",alignItems:"center",gap:9,flexWrap:"wrap"}}>
          <button type="button" disabled={!!testing} style={styles.secondary} onClick={()=>testProvider(p.id)}>
            {testing===p.id?"Checking…":"Test key · no web search"}
          </button>
          {tests[p.id]&&!tests[p.id].busy&&<span role="status" style={{fontSize:11,color:tests[p.id].ok?"#157858":"#B34943"}}>
            {tests[p.id].ok?"✓ API responding":"✕ Check failed"} — {tests[p.id].text}
          </span>}
        </div>}
      {canAdmin&&isConnected&&<div style={{display:"flex",gap:9,alignItems:"center",flexWrap:"wrap",marginTop:14}}>
        <div style={{flex:"1 1 240px",position:"relative"}}>
          <input aria-label={"API key for "+p.label} style={styles.control} type={reveal[p.id]?"text":"password"} autoComplete="off" placeholder={configured[p.id]?"Enter replacement key":"Paste API key"} value={drafts[p.id]||""}
            onChange={e=>setDrafts(x=>({...x,[p.id]:e.target.value}))}/>
        </div>
        <button type="button" style={styles.secondary} onClick={()=>setReveal(x=>({...x,[p.id]:!x[p.id]}))}>{reveal[p.id]?"Hide":"Show"}</button>
        <button type="button" style={styles.primary} disabled={!!pending} onClick={()=>saveKey(p.id)}>{pending===p.id?"Saving…":"Save key"}</button>
      </div>}
    </div>
  );
  return <div style={{display:"grid",gap:17}}>
    <div style={styles.panel}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:13,flexWrap:"wrap"}}>
        <div><h2 style={{fontSize:17,fontWeight:850,margin:0}}>API Integrations & Credentials</h2>
          <p style={{...styles.note,margin:"7px 0 0"}}>Add provider keys securely, review their saved status, and manage free directory sources.</p></div>
        <button type="button" onClick={refresh} disabled={loading} style={styles.secondary}>{loading?"Checking…":"Refresh status"}</button>
      </div>
      {message&&<div role="status" aria-live="polite" style={{marginTop:15,padding:"12px 14px",background:message.error?"#FFF0EE":"#F0F9F4",border:"1px solid "+(message.error?"#EFBEBA":"#B8E2CA"),borderRadius:10,color:message.error?"#9E3E3B":"#236B4F",fontSize:12,lineHeight:1.6}}>{message.text}</div>}
      {!isConnected&&<div style={{...styles.note,color:"#A15B31",marginTop:14}}>Supabase must be connected to store and manage credentials. Demo mode cannot persist API keys.</div>}
      {!canAdmin&&<div style={{...styles.note,marginTop:14}}>Read-only access: only CRM administrators can add or change provider credentials.</div>}
      <p style={{...styles.small,marginBottom:0,marginTop:14}}>Keys are submitted to the existing admin-authorized Supabase credential function. Previously saved key values are never returned to this page. A stored key is <strong>not</strong> proof that the provider works or is integrated with nationwide search.</p>
    </div>

    <section style={styles.panel}>
      <h3 style={{fontSize:14,fontWeight:820,margin:0}}>Public sources · no API key needed</h3>
      <p style={{...styles.note,margin:"7px 0 11px"}}>These free services power ProspectFinder organization searches without requiring API credentials or AI subscriptions. Coverage varies and they have public usage limits.</p>
      {noKey.map(p=><div key={p.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,borderBottom:"1px solid #EFF1F7",padding:"11px 0"}}>
        <div><strong style={{fontSize:12}}>{p.label}</strong><div style={styles.small}>{p.detail}</div></div>
        <span style={{color:"#2B8770",fontSize:11,fontWeight:750,whiteSpace:"nowrap"}}>No key</span>
      </div>)}
    </section>

    <section style={styles.panel}>
      <h3 style={{fontSize:14,fontWeight:820,margin:0}}>Optional contact-data APIs (not needed for free search)</h3>
      <p style={{...styles.note,margin:"7px 0 12px"}}>Apollo and Hunter remain optional contact-data services. The free organization lookup works without them; Hunter may consume credits if enabled.</p>
      {builtin.map(provider)}
      {others.map(id=>provider({id,label:recordName(id),kind:"Custom provider",note:"Credential stored only. This custom provider cannot return search results until an API adapter is implemented."}))}
      {canAdmin&&isConnected&&<div style={{marginTop:17,borderTop:"1px solid #EDF0F6",paddingTop:17}}>
        <button type="button" onClick={()=>setShowCustom(x=>!x)} style={styles.secondary}>{showCustom?"Cancel custom provider":"+ Add custom API provider"}</button>
        {showCustom&&<div style={{padding:16,background:"#F7F8FD",borderRadius:12,marginTop:12,display:"grid",gap:11}}>
          <label style={{fontSize:12,fontWeight:700}}>Provider identifier
            <input style={{...styles.control,marginTop:5}} placeholder="e.g. google_places" value={customName} onChange={e=>setCustomName(e.target.value.toLowerCase())} autoComplete="off"/>
          </label>
          <label style={{fontSize:12,fontWeight:700}}>API key
            <input style={{...styles.control,marginTop:5}} type="password" placeholder="Paste provider API key" value={customKey} autoComplete="off" onChange={e=>setCustomKey(e.target.value)}/>
          </label>
          <div style={styles.small}>Adding a custom key saves the credential securely on the server. It does not automatically connect the provider, configure billing, or make its data appear in search.</div>
          <div><button type="button" onClick={addCustom} disabled={customBusy} style={styles.primary}>{customBusy?"Saving…":"Save provider key"}</button></div>
        </div>}
      </div>}
      <p style={{...styles.small,marginBottom:0,marginTop:15}}>Need the original CRM plugin settings? <button type="button" style={{border:0,background:"none",fontWeight:800,cursor:"pointer",color:"#5746C9",padding:0}} onClick={onOpenAdmin} disabled={!canAdmin}>Open classic admin settings →</button></p>
    </section>
  </div>;
}
