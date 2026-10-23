import { finderCors, requireCrmUser, response } from "../_shared/prospectfinder-auth.ts";
import { nonprofitSearchPlan, mergeNonprofits } from "../_shared/finderSearch.js";

// Independent, authenticated nationwide nonprofit search (ProPublica Nonprofit Explorer, IRS-derived).
// ProPublica can filter by STATE and industry group but not by city, and its search text matches organisation NAMES.
// So a city or industry search with no keyword samples several common name words (and a few pages each), then keeps
// only organisations whose city matches — rather than searching for the city's name, which only finds organisations
// that happen to have it in their name.
// Does not replace the legacy guidestar-search function used by the classic CRM.
const PAGES_PER_REQUEST = 2;

Deno.serve(async (req: Request) => {
  const headers = finderCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405, headers);
  const auth = await requireCrmUser(req, headers);
  if (!auth.ok) return auth.response;
  try {
    const input = await req.json();
    const query = String(input?.query || "").trim().slice(0, 100);
    const city = String(input?.city || "").trim().slice(0, 80);
    const state = String(input?.state || "").toUpperCase().trim();
    const vertical = String(input?.vertical || "").slice(0, 60);
    const page = Number(input?.page || 0);
    if (!query && !city && !vertical) return response({ error: "Enter an organization name, nonprofit keyword, industry or city" }, 400, headers);
    if (state && !/^[A-Z]{2}$/.test(state)) return response({ error: "Invalid state" }, 400, headers);
    if (!Number.isInteger(page) || page < 0 || page > 25) return response({ error: "Invalid page" }, 400, headers);

    const plan = nonprofitSearchPlan({ query, city, state, vertical, page, pagesPerRequest: PAGES_PER_REQUEST });
    const fetchOne = async (params: Record<string, string | number>) => {
      const url = new URL("https://projects.propublica.org/nonprofits/api/v2/search.json");
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
      try {
        const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
        if (!r.ok) return { ok: false as const, status: r.status };
        const d = await r.json();
        return { ok: true as const, orgs: Array.isArray(d.organizations) ? d.organizations : [], numPages: Number(d.num_pages || 0), total: Number(d.total_results || 0) };
      } catch { return { ok: false as const, status: 0 }; }
    };
    const results = await Promise.all(plan.map(fetchOne));
    const good = results.filter((r) => r.ok) as { ok: true; orgs: unknown[]; numPages: number; total: number }[];
    if (good.length === 0) return response({ error: "Nonprofit directory unavailable", status: (results[0] as { status?: number })?.status ?? 0 }, 502, headers);

    const considered = good.reduce((n, r) => n + r.orgs.length, 0);
    const organizations = mergeNonprofits(good.map((r) => r.orgs), { city });
    const upstreamPages = Math.max(0, ...good.map((r) => r.numPages));
    return response({
      organizations, considered, pages_checked: good.length,
      num_pages: Math.ceil(upstreamPages / PAGES_PER_REQUEST), total_results: Math.max(0, ...good.map((r) => r.total)),
      search_query: query || city || vertical,
    }, 200, headers);
  } catch (err) {
    const msg = err instanceof Error && err.name === "TimeoutError" ? "Nonprofit directory timed out" : "Nonprofit search could not be completed";
    return response({ error: msg }, 502, headers);
  }
});
