import test from "node:test"; import assert from "node:assert/strict";
import { applyFilters, sortList, countActive, filtersEqual, BUILTIN_VIEWS, allTags, cleanTag, EMPTY_FILTERS } from "./filters.js";
const P = (id, o = {}) => ({ id, companyName: `Co ${id}`, emailPhone: "", vertical: "", market: "", currentStatus: "NEW", tags: [], ...o });
const data = [
  P(1, { companyName: "Sunrise Home Care", emailPhone: "hr@sunrise.org", vertical: "Home Health / Homecare", market: "Raleigh", tags: ["q4"], emailStatus: "valid" }),
  P(2, { companyName: "Oak Plumbing", emailPhone: "", market: "Durham", currentStatus: "T1 SENT" }),
  P(3, { companyName: "Maple Kids", emailPhone: "a@maple.org", market: "Raleigh", tags: ["q4", "childcare"], doNotRespond: true, currentStatus: "Do Not Respond" }),
];
const score = p => ({ score: p.id * 30, tier: p.id === 3 ? "hot" : "low" });

test("text search matches every token across fields incl. tags", () => {
  assert.deepEqual(applyFilters(data, { q: "raleigh q4" }).map(p => p.id), [1, 3]);
  assert.deepEqual(applyFilters(data, { q: "sunrise durham" }).map(p => p.id), []);
});
test("multi-select, email, DNR and score filters combine with AND", () => {
  assert.deepEqual(applyFilters(data, { market: ["Raleigh"], hideDNR: true }).map(p => p.id), [1]);
  assert.deepEqual(applyFilters(data, { hasEmail: "no" }).map(p => p.id), [2]);
  assert.deepEqual(applyFilters(data, { tags: ["childcare"] }).map(p => p.id), [3]);
  assert.deepEqual(applyFilters(data, { emailStatus: [""] }, score).map(p => p.id), [2, 3]);
  assert.deepEqual(applyFilters(data, { minScore: 60 }, score).map(p => p.id), [2, 3]);
  assert.deepEqual(applyFilters(data, { tier: ["hot"] }, score).map(p => p.id), [3]);
});
test("built-in views run and 'Ready for Touch 1' excludes DNR/no-email", () => {
  const ready = BUILTIN_VIEWS.find(v => v.id === "ready");
  assert.deepEqual(applyFilters(data, ready.filters).map(p => p.id), [1]);
  assert.equal(applyFilters(data, BUILTIN_VIEWS[0].filters).length, 3);
});
test("countActive / filtersEqual ignore order and case", () => {
  assert.equal(countActive({}), 0); assert.equal(countActive({ q: "x", market: ["A"], hideDNR: true }), 3);
  assert.ok(filtersEqual({ market: ["B", "A"], q: " X" }, { market: ["A", "B"], q: "x" }));
  assert.ok(!filtersEqual({ market: ["A"] }, {}));
});
test("sortList: asc/desc, empties last in both directions, stable", () => {
  const l = [P(1, { contactName: "b" }), P(2), P(3, { contactName: "a" })];
  assert.deepEqual(sortList(l, "contactName", "asc").map(p => p.id), [3, 1, 2]);
  assert.deepEqual(sortList(l, "contactName", "desc").map(p => p.id), [1, 3, 2]);
  assert.deepEqual(sortList(data, "score", "desc", score).map(p => p.id), [3, 2, 1]);
});
test("tags helpers", () => {
  assert.deepEqual(allTags(data), [["q4", 2], ["childcare", 1]]);
  assert.equal(cleanTag("  Q4,  Home  Health;; "), "q4 home health"); assert.equal(cleanTag("x".repeat(50)).length, 32);
  assert.ok(Object.isFrozen(EMPTY_FILTERS));
});
