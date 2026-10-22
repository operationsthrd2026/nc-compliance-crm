/* ════════════════════════════════════════════════════════════════
   Shared constants, brand colors and tiny helpers.
   Extracted verbatim from App.jsx so new screens/libs can import them.
   (Pure JS — no React — so it is also usable from unit tests.)
════════════════════════════════════════════════════════════════ */

export const N="#0B1426";
export const NL="#111E38";
export const NC="#162040";
export const NB="#1C2B50";
export const G="#C9963A";
export const GL="#DBA843";
export const W="#F0F4FF";
export const WM="rgba(240,244,255,0.55)";
export const WD="rgba(240,244,255,0.28)";
export const BR="rgba(240,244,255,0.08)";
export const ROLES={
  superadmin:{label:"Super Admin",color:"#e879f9",bg:"rgba(232,121,249,0.13)",icon:"🔱",canAdmin:true,canManageUsers:true,canDelete:true,canEditSystem:true,canEdit:true},
  admin:     {label:"Admin",      color:"#DBA843",bg:"rgba(219,168,67,0.13)", icon:"⚡",canAdmin:true,canManageUsers:true,canDelete:true,canEditSystem:true,canEdit:true},
  manager:   {label:"Manager",   color:"#34d399",bg:"rgba(52,211,153,0.13)", icon:"📋",canAdmin:false,canManageUsers:false,canDelete:false,canEditSystem:false,canEdit:true},
  user:      {label:"User",      color:"#60a5fa",bg:"rgba(96,165,250,0.13)", icon:"👤",canAdmin:false,canManageUsers:false,canDelete:false,canEditSystem:false,canEdit:true},
  viewer:    {label:"Viewer",    color:"#94a3b8",bg:"rgba(148,163,184,0.1)", icon:"👁",canAdmin:false,canManageUsers:false,canDelete:false,canEditSystem:false,canEdit:false},
};
export const STATUSES=["NEW","T1 SENT","T2 SENT","REVIEW","TOUCH 3 GATE","NURTURE/T3 SENT","Replied","Do Not Respond","Converted"];
export const VERTICALS=["Home Health / Homecare","Childcare & Licensed Group Homes","Construction & Contractors","Healthcare Practices","Light Manufacturing & Logistics","Nonprofits & Associations","Faith-Based Organizations","Education & Schools","Human Services Nonprofits","Community Development Orgs","Religious & Faith-Based Nonprofits","Social Service Agencies","Arts & Cultural Nonprofits","Environmental Nonprofits","Advocacy Organizations","Foundations & Grantmakers"];
export const MARKETS=["Raleigh","Durham","Chapel Hill","Greenville","Cary","Wilmington","Charlotte","Asheville","Fayetteville","Greensboro","Winston-Salem","High Point","Rocky Mount","Goldsboro","Other"];
export const ORG_SIZES=["1-9","10-49","50-99","100-249","250-499","500+"];
export const SRC_TYPES=["Apollo.io","Hunter.io","LinkedIn","Nonprofit Directory","Charity Navigator","GuideStar / Candid","Google Maps","IRS 990 Database","State Registry","Referral","Website","Claude AI","ChatGPT","Gemini","Other AI","Manual Research"];
export const SC={
  "NEW":            {bg:"rgba(201,150,58,0.15)",c:"#DBA843",b:"rgba(201,150,58,0.4)"},
  "T1 SENT":        {bg:"rgba(96,165,250,0.12)",c:"#60a5fa",b:"rgba(96,165,250,0.35)"},
  "T2 SENT":        {bg:"rgba(139,92,246,0.12)",c:"#a78bfa",b:"rgba(139,92,246,0.35)"},
  "REVIEW":         {bg:"rgba(251,191,36,0.12)",c:"#fde047",b:"rgba(251,191,36,0.35)"},
  "TOUCH 3 GATE":   {bg:"rgba(236,72,153,0.12)",c:"#f472b6",b:"rgba(236,72,153,0.35)"},
  "NURTURE/T3 SENT":{bg:"rgba(20,184,166,0.12)",c:"#2dd4bf",b:"rgba(20,184,166,0.35)"},
  "Replied":        {bg:"rgba(52,211,153,0.12)",c:"#34d399",b:"rgba(52,211,153,0.35)"},
  "Do Not Respond": {bg:"rgba(239,68,68,0.12)", c:"#f87171",b:"rgba(239,68,68,0.35)"},
  "Converted":      {bg:"rgba(168,85,247,0.12)",c:"#c084fc",b:"rgba(168,85,247,0.35)"},
};
export const EMPTY_P={id:null,companyName:"",contactName:"",title:"",emailPhone:"",cityMarket:"",market:"",sourceUrl:"",sourceType:"",verificationNotes:"",whyFit:"",vertical:"",hrPersonListed:"Unknown",hrPeopleContact:"",orgSize:"",t1SendDate:"",t1DueDate:"",t2SendDate:"",t2DueDate:"",t3SendDate:"",t3DueDate:"",leadPainPoint:"",melissaReview:"",t3Approved:false,replyReceived:false,flagToMelissa:false,doNotRespond:false,currentStatus:"NEW",outreachNotes:"",priorityScore:"",remarks:"",tags:[],emailStatus:"",emailCheckedAt:""};
export const uid=()=>Date.now()+Math.random();
export const today=()=>new Date().toISOString().split("T")[0];
export const isPast=d=>d&&new Date(d+"T23:59:59")<new Date();
export const hasEM=p=>!!(p.emailPhone&&p.emailPhone.includes("@"));
export const initials=n=>n.split(" ").map(x=>x[0]||"").join("").slice(0,2).toUpperCase();
export const addDays=(dateStr,n)=>{const d=dateStr?new Date(dateStr+"T00:00:00"):new Date();d.setDate(d.getDate()+n);return d.toISOString().split("T")[0];};
export const inp=()=>({background:"rgba(255,255,255,0.06)",border:"1.5px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"9px 12px",color:W,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box",fontFamily:"inherit",transition:"border-color 0.2s"});
export const LBL={display:"block",fontSize:10,color:WD,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:700};
export const B={
  gold:   {background:`linear-gradient(135deg,${G},${GL})`,color:"#0B1426",border:"none",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:800,cursor:"pointer"},
  ghost:  {background:"rgba(255,255,255,0.06)",color:WM,border:"1px solid rgba(255,255,255,0.12)",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:600,cursor:"pointer"},
  danger: {background:"rgba(239,68,68,0.1)",color:"#f87171",border:"1px solid rgba(239,68,68,0.28)",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:700,cursor:"pointer"},
  green:  {background:"rgba(52,211,153,0.12)",color:"#34d399",border:"1px solid rgba(52,211,153,0.28)",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:700,cursor:"pointer"},
  purple: {background:"rgba(168,85,247,0.12)",color:"#c084fc",border:"1px solid rgba(168,85,247,0.28)",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:700,cursor:"pointer"},
  blue:   {background:"rgba(96,165,250,0.12)",color:"#60a5fa",border:"1px solid rgba(96,165,250,0.28)",borderRadius:9,padding:"9px 20px",fontSize:12,fontWeight:700,cursor:"pointer"},
};
export const NC_CITY_COORDS = {
  "Raleigh":[35.7796,-78.6382], "Durham":[35.9940,-78.8986], "Chapel Hill":[35.9132,-79.0558],
  "Greenville":[35.6127,-77.3664], "Cary":[35.7915,-78.7811], "Wilmington":[34.2257,-77.9447],
  "Charlotte":[35.2271,-80.8431], "Asheville":[35.5951,-82.5515], "Fayetteville":[35.0527,-78.8784],
  "Greensboro":[36.0726,-79.7920], "Winston-Salem":[36.0999,-80.2442], "High Point":[35.9557,-80.0053],
  "Rocky Mount":[35.9382,-77.7905], "Goldsboro":[35.3849,-77.9928],
};
export const DEFAULT_NC_COORDS = [35.7596,-79.0193];
