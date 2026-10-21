import { finderCors, response } from "../_shared/prospectfinder-auth.ts";

// Retired at the user's request. Historical versions may remain in deployment
// history, but this public route no longer invokes paid OpenAI/Anthropic APIs.
Deno.serve((req:Request)=>{
 const headers=finderCors(req);
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 return response({error:"Paid AI search is disabled. Use the free public directory and Wikidata sources in ProspectFinder."},410,headers);
});
