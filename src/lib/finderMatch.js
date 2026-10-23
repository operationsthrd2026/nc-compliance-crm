/* Glue between finder SEARCH RESULTS and the CRM: the same duplicate detection and fit score used everywhere else.
   Pure and tested; the finder screen only calls these. */
import { buildIndex, findMatches, collapseResults } from "./dedupe.js";
import { hrFromTitle } from "./hrSignals.js";
import { scoreProspect, priorityFromScore, explainFit } from "./scoring.js";

/** "Yes" only when a listed contact's TITLE shows an HR/people role; otherwise whatever the source said, else Unknown (never assumed "No"). */
const hrOf = r => (r.hrPersonListed === "Yes" || hrFromTitle(r.title) === "Yes") ? "Yes" : (r.hrPersonListed || "Unknown");

/** Shape a search result like a saved prospect so the shared logic applies to it. */
export const asProspect = r => ({
  ...r,
  companyName: r.companyName || "", contactName: r.contactName || "",
  emailPhone: [r.email, r.phone].filter(Boolean).join(" | ") || r.emailPhone || "",
  website: r.website || "", sourceUrl: r.sourceUrl || "", market: r.market || "", cityMarket: r.cityMarket || "",
  vertical: r.vertical || "", hrPersonListed: hrOf(r), currentStatus: "NEW",
});

/**
 * @param rows   finder results
 * @param crm    prospects already saved
 * @param idFor  the finder's own exact-id function (EIN / OSM id / name+city)
 * Adds: already (exact id OR a near-certain duplicate), match (best possible duplicate), fit (fit score + reasons).
 * A MEDIUM match (e.g. same name in another city) is shown as a warning but stays selectable.
 */
export function annotateFinderRows(rows, crm, { idFor, existingIds }){
  const index = buildIndex(crm);
  // The same organisation found by several sources becomes ONE row (gaps filled from each; `alsoIn` names the other sources).
  const merged = collapseResults(rows.map(r => ({ ...r, emailPhone: r.emailPhone || [r.email, r.phone].filter(Boolean).join(" | "), _source: r.sourceType || "" })));
  const annotated = merged.map(r => {
    const cand = asProspect(r);
    const match = findMatches(cand, index, { limit: 1 })[0] || null;
    const exact = !!r.already || existingIds.has(idFor(r));
    return { ...r, already: exact || match?.level === "high", match, fit: scoreProspect(cand), alsoIn: r._alsoIn || [] };
  });
  // Best NEW leads first: not-yet-saved before already-saved, then the strongest fit, then the nearest.
  return annotated.map((r, i) => ({ r, i })).sort((a, b) =>
    (a.r.already ? 1 : 0) - (b.r.already ? 1 : 0) || b.r.fit.score - a.r.fit.score ||
    (a.r.distanceMiles ?? 1e9) - (b.r.distanceMiles ?? 1e9) || a.i - b.i).map(x => x.r);
}

/** What to store when a result is added: a priority from the fit score and a readable reason (keeps the source's own note). */
export function finderExtras(r){
  const fit = r.fit || scoreProspect(asProspect(r));
  return { hrPersonListed: hrOf(r), priorityScore: String(priorityFromScore(fit.score)), whyFit: [r.whyFit, explainFit(fit)].filter(Boolean).join(" · ") };
}
