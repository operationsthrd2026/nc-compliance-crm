import { contactReadiness, leadCategory } from "./leadQualification.js";
import { localDateKey, pipelineSnapshot } from "./outreachPlanning.js";
import { summarizeTasks } from "./prospectTasks.js";

export const ANALYTICS_CATEGORIES = ["All organizations", "Nonprofit", "Business / Other"];

export function rankCounts(counts={}) {
  return Object.entries(counts).filter(([,n])=>n>0)
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
    .map(([label,count])=>({label,count}));
}
export function percent(part,total) {
  return total>0?Math.round((part/total)*1000)/10:0;
}
export function filterAnalyticsLeads(leads=[],{category="All organizations",source="All sources"}={}) {
  return leads.filter(p=>
    (category==="All organizations"||leadCategory(p)===category)
    &&(source==="All sources"||String(p.sourceType||"Unknown source").trim()===source)
  );
}
export function analyticsSnapshot(leads=[],visibleTasks=null,asOf=localDateKey()){
  const pipeline=pipelineSnapshot(leads,asOf);
  const contactListed=leads.filter(p=>contactReadiness(p)==="Contact listed").length;
  // Only explicit touch markers count, never a draft or mere contact listing.
  const touchLogged=leads.filter(p=>
    Boolean(p.t1SendDate||p.t2SendDate||p.t3SendDate)
    ||["T1 SENT","T2 SENT","TOUCH 3 GATE","NURTURE/T3 SENT"].includes(p.currentStatus)
  ).length;
  const ids=new Set(leads.map(p=>String(p.id)));
  // Supabase RLS determines which tasks are visible; never infer team-wide totals.
  const scopedTasks=Array.isArray(visibleTasks)?
    visibleTasks.filter(t=>ids.has(String(t.prospect_id))):null;
  const taskCounts=scopedTasks===null?null:summarizeTasks(scopedTasks,asOf);
  return {
    ...pipeline,
    contactListed,touchLogged,
    contactCoveragePct:percent(contactListed,leads.length),
    conversionSharePct:percent(pipeline.converted,leads.length),
    dueNow:(pipeline.followups.Overdue||0)+(pipeline.followups.Today||0),
    taskCounts,
    taskDueNow:taskCounts===null?null:(taskCounts.Overdue||0)+(taskCounts.Today||0),
    statusRows:rankCounts(pipeline.statuses),
    categoryRows:rankCounts(pipeline.categories),
    sourceRows:rankCounts(pipeline.sources),
    readinessRows:rankCounts(pipeline.readiness)
  };
}
function csvCell(value){
  const raw=String(value??"");
  const guarded=/^\s*[=+\-@\t\r]/.test(raw)?"'"+raw:raw;
  return '"'+guarded.replaceAll('"','""')+'"';
}
export function analyticsCsv(snapshot,{category="All organizations",source="All sources",asOf=localDateKey()}={}){
  const rows=[
    ["Section","Metric","Count"],
    ["Report","As of",asOf],
    ["Filter","Organization type",category],
    ["Filter","Source",source],
    ["Summary","Saved prospects",snapshot.total],
    ["Summary","Contact details listed",snapshot.contactListed],
    ["Summary","Touch logged",snapshot.touchLogged],
    ["Summary","Replies flagged",snapshot.replies],
    ["Summary","Converted",snapshot.converted],
    ["Summary","Follow-ups due today or overdue",snapshot.dueNow],
    ["Summary","Contact coverage (%)",snapshot.contactCoveragePct],
    ["Summary","Converted share of saved (%)",snapshot.conversionSharePct],
    ["Tasks","Visible linked tasks",snapshot.taskCounts?.All??"Unavailable"],
    ["Tasks","Visible tasks due today or overdue",snapshot.taskDueNow??"Unavailable"]
  ];
  for(const [section,items] of [
    ["Pipeline stage",snapshot.statusRows],
    ["Organization type",snapshot.categoryRows],
    ["Contact readiness",snapshot.readinessRows],
    ["Discovery source",snapshot.sourceRows],
    ["Follow-ups",rankCounts(snapshot.followups)],
    ["Visible task status",snapshot.taskCounts?rankCounts(snapshot.taskCounts):[]]
  ]) for(const item of items) rows.push([section,item.label,item.count]);
  return rows.map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n";
}
