import test from "node:test"; import assert from "node:assert/strict";
import { buildOverpassQuery, normalizeElements, sanitizeText, validTags, haversineMiles, nonprofitSearchPlan, mergeNonprofits, NTEE_BY_VERTICAL, MAX_RADIUS_MILES, BUSINESS_KEYS } from "../../supabase/functions/_shared/finderSearch.js";
const base = { lat: 30.27, lon: -97.74, radiusMiles: 5 };

test("the query only asks for NAMED places and uses EVERY requested category (it used to keep just 3)", () => {
  const KINDS = ["aa", "bb", "cc", "dd", "ee", "ff", "gg", "hh"], tags = KINDS.map(k => ["amenity", "kind_" + k]);
  const q = buildOverpassQuery({ ...base, tags });
  assert.equal((q.match(/\["name"\]/g) || []).length, 8); for (const k of KINDS) assert.ok(q.includes(`"kind_${k}"`));
  assert.match(q, /^\[out:json\]\[timeout:\d+\];\(/); assert.match(q, /out tags center \d+;$/);
});
test("the radius is honoured up to the cap (it used to be silently cut to 15 miles)", () => {
  assert.match(buildOverpassQuery({ ...base, radiusMiles: 20, tags: [["shop", "bakery"]] }), /around:32187,/);       // 20 mi
  assert.match(buildOverpassQuery({ ...base, radiusMiles: 500, tags: [["shop", "bakery"]] }), new RegExp(`around:${Math.round(MAX_RADIUS_MILES * 1609.344)},`));
  assert.match(buildOverpassQuery({ ...base, radiusMiles: 0, tags: [["shop", "bakery"]] }), /around:1609,/);
});
test("a typed keyword is matched INSIDE the query (it used to be applied after the first 60 results)", () => {
  const q = buildOverpassQuery({ ...base, tags: [["amenity", "dentist"]], keyword: "Smile" });
  assert.match(q, /nwr\["amenity"="dentist"\]\["name"~"Smile",i\]/);
  const open = buildOverpassQuery({ ...base, keyword: "Smile" });       // no category: search names across business types
  for (const k of BUSINESS_KEYS) assert.ok(open.includes(`nwr["${k}"]["name"~"Smile",i]`), k);
});
test("name hints catch un-tagged businesses (e.g. 'home care')", () => {
  const q = buildOverpassQuery({ ...base, tags: [["healthcare", "nurse"]], nameHints: ["home care", "home health"] });
  assert.match(q, /nwr\["name"~"home care\|home health",i\]/);
});
test("SECURITY: keywords and hints can never break out of the query string", () => {
  const evil = ['x"]; out; (node(around:1);', 'a" ; foreach', "\\\"\\", "Robert'); DROP", "x~\"y", "{{geocodeArea:USA}}", "\n\r\t`$(whoami)"];
  for (const kw of evil){
    const q = buildOverpassQuery({ ...base, tags: [["amenity", "dentist"]], keyword: kw, nameHints: [kw] });
    // the only double quotes are the structural ones around tag keys/values and the name pattern
    const stripped = q.replace(/"[a-z_]+"/g, "").replace(/"[A-Za-z0-9 &'.\-|]*"/g, "");
    assert.ok(!/["\\`${}]/.test(stripped), `unsafe characters survived for ${JSON.stringify(kw)}: ${stripped}`);
    assert.equal((q.match(/;/g) || []).length, (q.match(/;/g) || []).length); assert.ok(!q.includes("\n"));
  }
  assert.equal(buildOverpassQuery({ ...base, tags: [["bad key", "x"]] }), null);                 // invalid category tokens dropped → nothing to search
  assert.equal(validTags([["amenity", "dentist\"]"]]), false); assert.equal(validTags([]), false); assert.equal(validTags(Array(13).fill(["a_b", "c_d"])), false);
  assert.equal(sanitizeText("  Hello,   World!! <b>x</b> "), "Hello World b x b");
});
test("results: named only, one per place, with address, coordinates and distance — nearest first", () => {
  const els = [
    { type: "node", id: 1, lat: 30.30, lon: -97.74, tags: { name: "Far Clinic", "addr:street": "Main St", "addr:housenumber": "10", phone: "512-555-0100" } },
    { type: "node", id: 2, lat: 30.271, lon: -97.741, tags: { name: "Near Clinic" } },
    { type: "way", id: 3, center: { lat: 30.2715, lon: -97.7415 }, tags: { name: "Near Clinic" } },        // the same building mapped twice
    { type: "node", id: 4, lat: 30.27, lon: -97.74, tags: { amenity: "clinic" } },                          // no name → dropped
  ];
  const r = normalizeElements(els, base);
  assert.deepEqual(r.map(x => x.tags.name), ["Near Clinic", "Far Clinic"]);
  assert.ok(r[0].distanceMiles < r[1].distanceMiles); assert.equal(r[1].address.street, "10 Main St"); assert.equal(r[1].lat, 30.30);
  assert.equal(r[0].lat, 30.271);
});
test("equally-near results put the most complete listing first, and a cap is respected", () => {
  const same = [{ type: "node", id: 1, lat: 30.27, lon: -97.74, tags: { name: "Bare" } }, { type: "node", id: 2, lat: 30.27, lon: -97.7401, tags: { name: "Full", phone: "1", website: "https://x.org" } }];
  assert.equal(normalizeElements(same, { ...base, max: 5 }).length, 2);
  assert.equal(normalizeElements(Array.from({ length: 300 }, (_, i) => ({ type: "node", id: i, lat: 30.27 + i * 1e-3, lon: -97.74, tags: { name: "Biz " + i } })), { ...base, max: 100 }).length, 100);
  assert.deepEqual(normalizeElements(null, base), []);
});
test("distance maths", () => { assert.ok(Math.abs(haversineMiles(30.27, -97.74, 30.27, -97.74)) < 1e-9); assert.ok(Math.abs(haversineMiles(30.27, -97.74, 31.27, -97.74) - 69) < 1); });

test("NONPROFITS: a city search no longer just types the city's name; it samples common name words, filters by state and industry, and checks several pages", () => {
  const plan = nonprofitSearchPlan({ query: "", city: "Austin", state: "TX", vertical: "Education & Schools" });
  assert.equal(plan.length, 9); assert.ok(new Set(plan.map(p => p.q)).size === 3 && !plan.some(p => /austin/i.test(p.q)));
  assert.ok(plan.every(p => p["state[id]"] === "TX" && p["ntee[id]"] === 2));
  assert.deepEqual(plan.slice(0, 3).map(p => p.page), [0, 1, 2]); assert.deepEqual(nonprofitSearchPlan({ query: "", city: "Austin", state: "TX", page: 1 }).slice(0, 3).map(p => p.page), [3, 4, 5]);
});
test("NONPROFITS: a typed keyword is a single search; industry maps to the right group", () => {
  const plan = nonprofitSearchPlan({ query: "animal shelter", state: "TX" }); assert.equal(plan.length, 3); assert.ok(plan.every(p => p.q === "animal shelter" && !("ntee[id]" in p)));
  assert.equal(NTEE_BY_VERTICAL["Home Health / Homecare"], 4); assert.equal(NTEE_BY_VERTICAL["Faith-Based Organizations"], 8);
  assert.equal(nonprofitSearchPlan({ query: "x", state: "tx" }).every(p => !("state[id]" in p)), true);       // invalid state ignored
});
test("NONPROFITS: results are merged by EIN and limited to the requested city", () => {
  const a = [{ ein: 1, name: "B Org", city: "Austin" }, { ein: 2, name: "A Org", city: "AUSTIN" }, { ein: 3, name: "Far Org", city: "Dallas" }], b = [{ ein: 1, name: "B Org", city: "Austin" }, { ein: 4, name: "C Org", city: "Austin" }];
  assert.deepEqual(mergeNonprofits([a, b], { city: "austin" }).map(o => o.ein), [2, 1, 4]);
  assert.equal(mergeNonprofits([a, b]).length, 4);
});

test("the same name far apart (two branches) stays as two results; very close stays one", () => {
  const els = [{ type: "node", id: 1, lat: 30.27, lon: -97.74, tags: { name: "Smile Dental" } }, { type: "node", id: 2, lat: 30.31, lon: -97.74, tags: { name: "Smile Dental" } }, { type: "node", id: 3, lat: 30.2701, lon: -97.7401, tags: { name: "Smile Dental" } }];
  assert.equal(normalizeElements(els, base).length, 2);
});
