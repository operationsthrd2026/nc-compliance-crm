import { finderCors, requireCrmUser, response } from "../_shared/prospectfinder-auth.ts";

// Independent, authenticated nationwide nonprofit search.
// Does not replace the legacy guidestar-search function used by the classic CRM.
Deno.serve(async (req: Request) => {
  const headers=finderCors(req);
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  if(req.method!=="POST") return response({error:"Method not allowed"},405,headers);
  const auth=await requireCrmUser(req,headers);
  if(!auth.ok) return auth.response;
  try {
    const input=await req.json();
    const query=String(input?.query||"").trim().slice(0,100);
    const city=String(input?.city||"").trim().slice(0,80);
    const state=String(input?.state||"").toUpperCase().trim();
    const page=Number(input?.page||0);
    if(!query&&!city) return response({error:"Enter an organization name, nonprofit keyword, or city"},400,headers);
    if(state&&!/^[A-Z]{2}$/.test(state)) return response({error:"Invalid state"},400,headers);
    if(!Number.isInteger(page)||page<0||page>50) return response({error:"Invalid page"},400,headers);
    const url=new URL("https://projects.propublica.org/nonprofits/api/v2/search.json");
    url.searchParams.set("q",query||city);
    if(state) url.searchParams.set("state[id]",state);
    url.searchParams.set("page",String(page));
    const upstream=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(10000)});
    if(!upstream.ok) return response({error:"Nonprofit directory unavailable",status:upstream.status},502,headers);
    const data=await upstream.json();
    return response({organizations:Array.isArray(data.organizations)?data.organizations:[],num_pages:data.num_pages||0,total_results:data.total_results||0,search_query:query||city},200,headers);
  } catch(err) {
    const msg=err instanceof Error&&err.name==="TimeoutError"?"Nonprofit directory timed out":"Nonprofit search could not be completed";
    return response({error:msg},502,headers);
  }
});