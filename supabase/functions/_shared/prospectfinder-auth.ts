// CORS and authentication specific to the new ProspectFinder endpoints.
// Unlike the legacy CRM functions, these endpoints can be previewed on the known
// Vercel feature-branch URL without exposing the API to arbitrary websites.
export { requireCrmUser } from "./auth.ts";
const knownOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://nc-complianc-git-16f2a7-operations-thehrondemand2026-s-projects.vercel.app",
];

export function finderCors(req: Request): Record<string,string> {
  const configured = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",").map(x=>x.trim()).filter(Boolean);
  const allowed = new Set([...knownOrigins, ...configured]);
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string,string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export const response = (data: unknown, status: number, headers: Record<string,string>) =>
  new Response(JSON.stringify(data), {status, headers});