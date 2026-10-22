import test from "node:test"; import assert from "node:assert/strict";
import { parseLocation, placeOf, placeKey, placeLabel, groupByPlace, jitter } from "./geo.js";
import { STATE_CENTROIDS, CITY_ROWS } from "./usCities.js";
import { US_STATES } from "./usLocation.js";

test("parseLocation reads the state from the text", () => {
  assert.deepEqual(parseLocation("Austin, TX"), { city: "Austin", state: "TX" });
  assert.deepEqual(parseLocation("Austin TX 78701"), { city: "Austin", state: "TX" });
  assert.deepEqual(parseLocation("Austin, TX 78701-1234"), { city: "Austin", state: "TX" });
  assert.deepEqual(parseLocation("Salt Lake City, Utah"), { city: "Salt Lake City", state: "UT" });
  assert.deepEqual(parseLocation("Texas"), { city: "", state: "TX" });
  assert.deepEqual(parseLocation("TX"), { city: "", state: "TX" });
  assert.deepEqual(parseLocation("Raleigh"), { city: "Raleigh", state: "" });
  assert.deepEqual(parseLocation("United States"), { city: "", state: "" });
  assert.deepEqual(parseLocation(""), { city: "", state: "" });
  assert.deepEqual(parseLocation(null), { city: "", state: "" });
});
test("a lower-case word that merely looks like a state code is not treated as one", () => {
  assert.equal(parseLocation("Walk in").state, ""); assert.equal(parseLocation("Fort Wayne, in").state, "");
});

test("REGRESSION: a city named like an NC city but in another state is NOT placed in North Carolina", () => {
  for (const [text, st] of [["Durham, NH", "NH"], ["Charlotte, MI", "MI"], ["Raleigh, MS", "MS"], ["Wilmington, DE", "DE"], ["Greenville, SC", "SC"], ["Fayetteville, AR", "AR"]]){
    const p = placeOf({ market: text, cityMarket: text }); assert.equal(p.state, st, text);
  }
  assert.equal(placeOf({ market: "Wilmington, DE" }).coords[0] > 39, true); // Delaware, not the NC coast (34.2)
  assert.equal(placeOf({ market: "Greenville, SC" }).state, "SC");
});
test("known cities are pinned at the city, unknown ones at their state centre (marked approximate)", () => {
  const austin = placeOf({ market: "Austin, TX" }); assert.equal(austin.precision, "city"); assert.equal(austin.label, "Austin, TX");
  const small = placeOf({ market: "Tiny Town, TX" }); assert.equal(small.precision, "state"); assert.equal(small.label, "Texas"); assert.deepEqual(small.coords, STATE_CENTROIDS.TX);
  assert.equal(placeOf({ market: "Texas" }).precision, "state");
});
test("legacy NC data without a state still works (known NC market names only)", () => {
  assert.equal(placeOf({ market: "Durham" }).state, "NC"); assert.equal(placeOf({ market: "Other", cityMarket: "Cary, NC 27511" }).label, "Cary, NC");
  assert.equal(placeOf({ market: "", cityMarket: "123 Main St, Chapel Hill" }).label, "Chapel Hill, NC");
  assert.equal(placeOf({ market: "Boone" }), null); assert.equal(placeOf({}), null);
});
test("market 'NC' with the city in cityMarket", () => { assert.equal(placeOf({ market: "NC", cityMarket: "Cary" }).label, "Cary, NC"); });
test("St. / Saint spellings resolve to the same city", () => {
  for (const t of ["St. Louis, MO", "Saint Louis, MO", "St Louis, MO"]) assert.equal(placeOf({ market: t }).precision, "city", t);
  assert.equal(placeKey({ market: "St. Louis, MO" }), placeKey({ market: "Saint Louis, MO" }));
});
test("groupByPlace groups by place key and counts unplaced separately", () => {
  const g = groupByPlace([{ market: "Austin, TX" }, { cityMarket: "austin, TX" }, { market: "Texas" }, { market: "Nowhere" }, {}]);
  assert.equal(g.groups.find(x => x.key === placeKey({ market: "Austin, TX" })).rows.length, 2);
  assert.equal(g.groups.find(x => x.key === "TX").rows.length, 1); assert.equal(g.unplaced, 2);
});
test("placeLabel", () => { placeOf({ market: "Austin, TX" }); assert.equal(placeLabel(placeKey({ market: "Austin, TX" })), "Austin, TX"); assert.equal(placeLabel("TX"), "Texas"); });
test("jitter is deterministic; state-level scale spreads wider than city scale", () => {
  const b = [35, -80]; assert.deepEqual(jitter(b, "p1"), jitter(b, "p1")); assert.notDeepEqual(jitter(b, "p1"), jitter(b, "p2"));
  assert.ok(Math.abs(jitter(b, "p1")[0] - 35) < 0.01); assert.ok(Math.abs(jitter(b, "zz", 80)[0] - 35) < 0.5);
});

/* ── data sanity: catches sign errors / swapped lat-lon in the bundled table ── */
const km = ([a, b], [c, d]) => { const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r; return 6371 * Math.hypot(x, y); };
test("every state and DC has a centroid inside the U.S. bounding box", () => {
  for (const [code] of US_STATES){ const c = STATE_CENTROIDS[code]; assert.ok(c, code); assert.ok(c[0] > 18 && c[0] < 72 && c[1] < -66 && c[1] > -170, code); }
});
test("every bundled city is in a real state and near that state's centre", () => {
  assert.ok(CITY_ROWS.length >= 140);
  for (const { city, state, coords } of CITY_ROWS){
    assert.ok(STATE_CENTROIDS[state], `${city}: unknown state ${state}`);
    const limit = state === "AK" || state === "HI" ? 2500 : 900;
    assert.ok(km(coords, STATE_CENTROIDS[state]) < limit, `${city}, ${state} is ${Math.round(km(coords, STATE_CENTROIDS[state]))} km from the state centre — check its coordinates`);
  }
});
test("no duplicate city/state rows", () => { const seen = new Set(); for (const r of CITY_ROWS){ const k = `${r.city}|${r.state}`; assert.ok(!seen.has(k), k); seen.add(k); } });
