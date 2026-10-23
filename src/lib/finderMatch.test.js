import test from "node:test"; import assert from "node:assert/strict";
import { annotateFinderRows, finderExtras, asProspect } from "./finderMatch.js";
const clean = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const idFor = r => r.ein ? "ein:" + r.ein : r.osmId ? "osm:" + r.osmId : clean(r.companyName) + "|" + clean(r.cityMarket);
const crm = [
  { id: 1, companyName: "Sunrise Home Care LLC", emailPhone: "jane@sunrisecare.org", market: "Austin, TX", cityMarket: "Austin, TX", website: "https://sunrisecare.org", currentStatus: "NEW" },
  { id: 2, companyName: "Hope Community Foundation", sourceUrl: "https://projects.propublica.org/nonprofits/organizations/111", market: "Boston, MA", cityMarket: "Boston, MA", currentStatus: "NEW" },
];
const run = rows => annotateFinderRows(rows, crm, { idFor, existingIds: new Set(crm.map(idFor)) });
const row = o => ({ companyName: "", email: "", phone: "", website: "", sourceUrl: "", market: "", cityMarket: "", vertical: "", ...o });

test("a name variant of a saved organisation in the same city is 'already in CRM'", () => {
  const [r] = run([row({ companyName: "SUNRISE HOME CARE, INC.", cityMarket: "Austin, TX", market: "Austin, TX" })]);
  assert.equal(r.already, true); assert.equal(r.match.prospect.id, 1); assert.equal(r.match.level, "high");
});
test("the same email or website as a saved prospect is caught even under a different name", () => {
  assert.equal(run([row({ companyName: "Totally Different Name", email: "jane@sunrisecare.org" })])[0].already, true);
  assert.equal(run([row({ companyName: "Another Branch", website: "https://sunrisecare.org/branch2", cityMarket: "Dallas, TX", market: "Dallas, TX" })])[0].match?.prospect.id, 1);
});
test("same name in a DIFFERENT city is only a warning — still selectable", () => {
  const [r] = run([row({ companyName: "Sunrise Home Care", cityMarket: "Denver, CO", market: "Denver, CO" })]);
  assert.equal(r.already, false); assert.equal(r.match?.level, "medium");
});
test("REGRESSION: an unrelated nonprofit from the same listing site is NOT flagged", () => {
  const [r] = run([row({ companyName: "Riverside Animal Shelter", sourceUrl: "https://projects.propublica.org/nonprofits/organizations/222", cityMarket: "Boston, MA", market: "Boston, MA", ein: "222" })]);
  assert.equal(r.already, false); assert.equal(r.match, null);
});
test("exact ids still work, and every row gets a fit score", () => {
  const out = run([row({ companyName: "Hope Community Foundation", cityMarket: "Boston, MA" }), row({ companyName: "Brand New Org", vertical: "Home Health / Homecare", cityMarket: "Austin, TX", market: "Austin, TX" })]);
  const a = out.find(r => /Hope/.test(r.companyName)), b = out.find(r => /Brand New/.test(r.companyName));
  assert.equal(a.already, true); assert.equal(b.already, false);
  assert.ok(typeof b.fit.score === "number" && b.fit.factors.length >= 5);
});
test("what gets stored on add: a 1–10 priority and a readable reason that keeps the source's own note", () => {
  const [r] = run([row({ companyName: "Brand New Org", vertical: "Home Health / Homecare", cityMarket: "Austin, TX", market: "Austin, TX", whyFit: "Nonprofit directory match" })]);
  const x = finderExtras(r); assert.ok(+x.priorityScore >= 1 && +x.priorityScore <= 10); assert.match(x.whyFit, /^Nonprofit directory match · Fit \d+\/100/);
});
test("unknown HR stays unknown when scoring a result (never assumed 'No')", () => { assert.equal(asProspect(row({ companyName: "X" })).hrPersonListed, "Unknown"); });

test("the same organisation from two sources becomes one row, with the other source named and the gaps filled", () => {
  const rows = [
    row({ companyName: "Cedar Family Clinic", sourceType: "ProPublica Nonprofit Explorer", ein: "9", cityMarket: "Austin, TX", market: "Austin, TX", email: "hello@cedarclinic.org" }),
    row({ companyName: "CEDAR FAMILY CLINIC INC", sourceType: "OpenStreetMap (Overpass)", osmId: "node:5", cityMarket: "Austin, TX", market: "Austin, TX", email: "hello@cedarclinic.org", phone: "512-555-0100", website: "https://cedarclinic.org" }),
    row({ companyName: "Unrelated Roofing", sourceType: "OpenStreetMap (Overpass)", osmId: "node:6", cityMarket: "Austin, TX", market: "Austin, TX" }),
  ];
  const out = run(rows); assert.equal(out.length, 2);
  const c = out.find(r => /Cedar/.test(r.companyName)); assert.deepEqual(c.alsoIn, ["OpenStreetMap (Overpass)"]); assert.equal(c.phone, "512-555-0100"); assert.equal(c.website, "https://cedarclinic.org");
});
test("REGRESSION: 30 unrelated listings from the same source are never merged together", () => {
  const rows = Array.from({ length: 30 }, (_, i) => row({ companyName: `Distinct ${["Alpha","Bravo","Cedar","Delta","Ember","Fable"][i % 6]} Org ${i}`, sourceType: "ProPublica Nonprofit Explorer", ein: String(1000 + i), sourceUrl: `https://projects.propublica.org/nonprofits/organizations/${1000 + i}`, cityMarket: "Boston, MA", market: "Boston, MA" }));
  assert.equal(run(rows).length, 30);
});
test("an HR title on a listed contact marks the prospect as having an HR person (and scoring/storing agree)", () => {
  const r = run([row({ companyName: "Brand New Org", contactName: "Dana Cole", title: "HR Director", cityMarket: "Austin, TX", market: "Austin, TX" })])[0];
  assert.equal(finderExtras(r).hrPersonListed, "Yes");
  assert.equal(finderExtras(run([row({ companyName: "Other Org", contactName: "Sam", title: "Owner", cityMarket: "Austin, TX", market: "Austin, TX" })])[0]).hrPersonListed, "Unknown");
});

test("ORDER: new leads before ones already saved, strongest fit first, then nearest", () => {
  const rows = [
    row({ companyName: "Hope Community Foundation", cityMarket: "Boston, MA", market: "Boston, MA", ein: "111" }),                                   // already saved → last
    row({ companyName: "Weak Far Biz", cityMarket: "Austin, TX", market: "Austin, TX", distanceMiles: 9 }),
    row({ companyName: "Strong Biz", vertical: "Home Health / Homecare", email: "a@strong.org", phone: "512-555-0100", website: "https://strong.org", contactName: "Sam", title: "HR Director", cityMarket: "Austin, TX", market: "Austin, TX", distanceMiles: 5 }),
    row({ companyName: "Weak Near Biz", cityMarket: "Austin, TX", market: "Austin, TX", distanceMiles: 1 }),
  ];
  assert.deepEqual(run(rows).map(r => r.companyName), ["Strong Biz", "Weak Near Biz", "Weak Far Biz", "Hope Community Foundation"]);
});
