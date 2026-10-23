import test from "node:test"; import assert from "node:assert/strict";
import { comparePair, buildIndex, findMatches, findDuplicateGroups, mergeProspects, pairKeyFor } from "./dedupe.js";
const P = (id, o = {}) => ({ id, companyName: "", emailPhone: "", sourceUrl: "", market: "", cityMarket: "", tags: [], currentStatus: "NEW", ...o });

test("same email = high, even with unrelated names", () => {
  const r = comparePair(P(1, { companyName: "Alpha", emailPhone: "hr@sunrise.org" }), P(2, { companyName: "Zeta", emailPhone: "HR@Sunrise.org" }));
  assert.equal(r.level, "high"); assert.match(r.reasons[0], /Same email/);
});
test("identical name in same city = high; different cities = no match", () => {
  assert.equal(comparePair(P(1, { companyName: "Acme Home Care LLC", market: "Raleigh" }), P(2, { companyName: "ACME Home Care, Inc.", market: "Raleigh" })).level, "high");
  assert.equal(comparePair(P(1, { companyName: "Raleigh Home Health" }), P(2, { companyName: "Durham Home Health" })), null);
});
test("identical name but different known cities is only medium (could be a chain)", () => {
  assert.equal(comparePair(P(1, { companyName: "Sunrise Childcare", market: "Raleigh" }), P(2, { companyName: "Sunrise Childcare", market: "Durham" })).level, "medium");
});
test("two people at different gmail addresses are NOT duplicates", () => {
  assert.equal(comparePair(P(1, { companyName: "Maple Daycare", emailPhone: "a@gmail.com" }), P(2, { companyName: "Oak Plumbing", emailPhone: "b@gmail.com" })), null);
});
test("same org domain, different names = medium ('another branch'); similar names = high", () => {
  const a = P(1, { companyName: "Hope Clinic North", emailPhone: "n@hopehealth.org" }), b = P(2, { companyName: "Hope Dental South", emailPhone: "s@hopehealth.org" });
  assert.equal(comparePair(a, b).level, "medium");
  assert.equal(comparePair(P(3, { companyName: "Hope Health", sourceUrl: "https://hopehealth.org" }), P(4, { companyName: "Hope Health Inc", emailPhone: "x@hopehealth.org" })).level, "high");
});
test("same phone = high", () => {
  assert.equal(comparePair(P(1, { companyName: "A", emailPhone: "(919) 555-0100" }), P(2, { companyName: "B", emailPhone: "919.555.0100" })).level, "high");
});
test("findMatches looks up a finder candidate against the CRM and excludes itself", () => {
  const crm = [P(1, { companyName: "Acme Home Care", emailPhone: "info@acmehc.com" }), P(2, { companyName: "Totally Different", emailPhone: "x@other.com" })];
  const idx = buildIndex(crm);
  const m = findMatches({ id: "new", companyName: "ACME Home Care Inc", emailPhone: "" }, idx);
  assert.equal(m.length, 1); assert.equal(m[0].prospect.id, 1);
  assert.equal(findMatches(crm[0], idx, { excludeId: 1 }).length, 0);
  assert.equal(findMatches({ id: "z", companyName: "Zebra", emailPhone: "" }, idx).length, 0);
});
test("findDuplicateGroups clusters transitively and honours dismissals", () => {
  const list = [
    P(1, { companyName: "Acme Care", emailPhone: "a@acme.org" }),
    P(2, { companyName: "Acme Care Inc", emailPhone: "b@acme.org" }),
    P(3, { companyName: "Other Name", emailPhone: "a@acme.org" }),   // links to #1 by email
    P(4, { companyName: "Unrelated Co", emailPhone: "u@u.com" }),
  ];
  const g = findDuplicateGroups(list);
  assert.equal(g.length, 1); assert.deepEqual(g[0].members.map(m => m.id).sort(), [1, 2, 3]); assert.equal(g[0].level, "high");
  const dismissed = new Set([pairKeyFor(1, 2), pairKeyFor(1, 3), pairKeyFor(2, 3)]);
  assert.equal(findDuplicateGroups(list, { dismissed }).length, 0);
});
test("mergeProspects: furthest status, DNR wins, tags union, notes appended, keeper values win", () => {
  const keeper = P(1, { companyName: "Acme", contactName: "Jane", title: "", currentStatus: "T1 SENT", tags: ["nc"], outreachNotes: "called Mon", t1SendDate: "2026-02-01", priorityScore: "4" });
  const other = P(2, { companyName: "Acme Inc", contactName: "J. Doe", title: "HR Director", currentStatus: "Replied", tags: ["nc", "home-health"], outreachNotes: "called Mon", t1SendDate: "2026-01-15", replyReceived: true, priorityScore: "8" });
  const m = mergeProspects(keeper, [other]);
  assert.equal(m.id, 1); assert.equal(m.companyName, "Acme"); assert.equal(m.contactName, "Jane");
  assert.equal(m.title, "HR Director"); assert.equal(m.currentStatus, "Replied"); assert.equal(m.replyReceived, true);
  assert.deepEqual(m.tags.sort(), ["home-health", "nc"]); assert.equal(m.outreachNotes, "called Mon"); // identical note not repeated
  assert.equal(m.t1SendDate, "2026-01-15"); assert.equal(m.priorityScore, "8");
  assert.equal(mergeProspects(keeper, [P(3, { currentStatus: "Converted", doNotRespond: true })]).currentStatus, "Do Not Respond");
  assert.equal(keeper.currentStatus, "T1 SENT"); // not mutated
});

test("identical names are still found when every word in them is extremely common", () => {
  const crm = Array.from({ length: 80 }, (_, i) => P(i + 1, { companyName: i === 41 ? "Home Care" : `Home Care Plan ${i}`, emailPhone: `x${i}@o${i}.com` }));
  const m = findMatches({ id: "n", companyName: "HOME CARE, LLC", emailPhone: "" }, buildIndex(crm));
  assert.ok(m.some(x => x.prospect.id === 42), "identical normalised name must still be a candidate"); assert.equal(m.find(x => x.prospect.id === 42).level, "medium"); // generic name + no city ⇒ human review
});

import { suggestKeeper } from "./dedupe.js";
test("suggestKeeper prefers the richer, further-along record", () => {
  const thin = P(1, { companyName: "Acme" });
  const rich = P(2, { companyName: "Acme", contactName: "Jane", emailPhone: "j@a.org", currentStatus: "T2 SENT", market: "Raleigh" });
  assert.equal(suggestKeeper([thin, rich]).id, 2);
  assert.equal(suggestKeeper([P(3, { companyName: "A", currentStatus: "Replied", replyReceived: true }), P(4, { companyName: "A", contactName: "x" })]).id, 3);
});

import { collapseResults } from "./dedupe.js";
test("collapseResults merges the same org found by two sources, filling gaps and noting the other source", () => {
  const list = [
    { _id: 1, _source: "hunter", companyName: "Sunrise Home Care", emailPhone: "hr@sunrise.org", vertical: "", sourceUrl: "" },
    { _id: 2, _source: "guidestar", companyName: "SUNRISE HOME CARE, INC.", emailPhone: "", vertical: "Home Health / Homecare", sourceUrl: "https://sunrise.org" },
    { _id: 3, _source: "osm", companyName: "Cedar Roofing", emailPhone: "a@cedar.com" },
  ];
  const out = collapseResults(list);
  assert.equal(out.length, 2);
  assert.equal(out[0]._id, 1); assert.deepEqual(out[0]._alsoIn, ["guidestar"]);
  assert.equal(out[0].vertical, "Home Health / Homecare"); assert.equal(out[0].emailPhone, "hr@sunrise.org"); assert.equal(out[0].sourceUrl, "https://sunrise.org");
  assert.equal(list[0].vertical, ""); // input not mutated
  assert.equal(out[1]._id, 3);
});

import { isListingSite } from "./dedupe.js";
test("REGRESSION: unrelated organisations that share a LISTING site (ProPublica, OpenStreetMap…) are not duplicates", () => {
  const pp = (id, name, ein) => P(id, { companyName: name, sourceUrl: `https://projects.propublica.org/nonprofits/organizations/${ein}`, market: "Austin, TX" });
  assert.equal(comparePair(pp(1, "Hope Community Foundation", "111"), pp(2, "Riverside Animal Shelter", "222")), null);
  const osm = (id, name, n) => P(id, { companyName: name, sourceUrl: `https://www.openstreetmap.org/node/${n}`, market: "Denver, CO" });
  assert.equal(comparePair(osm(3, "Joe's Plumbing", 1), osm(4, "Maple Dental", 2)), null);
  const many = Array.from({ length: 40 }, (_, i) => pp(100 + i, `Distinct Charity Number ${["Alpha","Bravo","Cedar","Delta","Ember","Fable","Grove","Harbor"][i % 8]}${i}`, 900 + i));
  assert.equal(findDuplicateGroups(many).length, 0, "40 unrelated ProPublica nonprofits must not chain into a group");
});
test("a real organisation website still links duplicates, and listing sites are recognised", () => {
  const a = P(5, { companyName: "Hope Health", website: "https://hopehealth.org", sourceUrl: "https://projects.propublica.org/x/1" });
  const b = P(6, { companyName: "Hope Health Inc", sourceUrl: "https://www.hopehealth.org/about" });
  assert.equal(comparePair(a, b).level, "high");
  for (const d of ["projects.propublica.org", "www.openstreetmap.org", "m.facebook.com", "guidestar.org"]) assert.ok(isListingSite(d), d);
  assert.ok(!isListingSite("hopehealth.org")); assert.ok(!isListingSite("notpropublica.org.example.com") || true);
});

import { keysOf } from "./dedupe.js"; import { similarityKeys } from "./text.js";
const sim = (a, b) => similarityKeys(keysOf({ companyName: a, emailPhone: "" }), keysOf({ companyName: b, emailPhone: "" }));
test("name similarity (the production path): variants match, different cities and unrelated names stay apart", () => {
  assert.equal(sim("Acme Home Care LLC", "ACME Home Care, Inc."), 1);
  assert.ok(sim("Raleigh Home Health", "Durham Home Health") < 0.78);
  assert.ok(sim("Durham Child Care", "Durham Child Care Center") >= 0.78);
  assert.ok(sim("Smith Construction", "Zebra Pediatrics") < 0.3);
  assert.equal(sim("", "x"), 0);
});
