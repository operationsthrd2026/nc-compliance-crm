import test from "node:test"; import assert from "node:assert/strict";
import { buildToday, pipelineStats, topPlaces } from "./todayActions.js";
import { setupSteps } from "./setupSteps.js";
import { fuzzyScore, rank } from "./fuzzy.js";
import { applyFilters, BUILTIN_VIEWS } from "./filters.js";
const NOW = new Date("2026-03-10T12:00:00");
const P = (id, o = {}) => ({ id, companyName: `Co ${id}`, emailPhone: "", currentStatus: "NEW", market: "", ...o });
const data = [
  P(1, { companyName: "Sunrise Care", emailPhone: "jane@sunrise.org", vertical: "Home Health / Homecare", orgSize: "50-99", hrPersonListed: "No", market: "Austin, TX" }),
  P(2, { companyName: "Oak Kids", emailPhone: "o@oak.com", currentStatus: "T1 SENT", t2DueDate: "2026-03-01" }),
  P(3, { companyName: "Granite", emailPhone: "g@granite.org", currentStatus: "Replied", replyReceived: true }),
  P(4, { companyName: "No Email Co", emailPhone: "919-555-0100" }),
  P(5, { companyName: "Stop Me", emailPhone: "s@stop.org", doNotRespond: true, replyReceived: true }),
  P(6, { companyName: "Won Org", emailPhone: "w@won.org", currentStatus: "Converted", replyReceived: true }),
];
const byId = (r, id) => r.actions.find(a => a.id === id);

test("builds the right actions, most urgent first", () => {
  const r = buildToday(data, { now: NOW, dupGroups: 2 });
  assert.deepEqual(r.actions.map(a => a.id).slice(0, 3), ["replies", "overdue", "ready"]);
  assert.equal(byId(r, "replies").count, 1); assert.equal(byId(r, "overdue").count, 1); assert.equal(byId(r, "duplicates").count, 2);
});
test("never suggests Do Not Respond or already-converted prospects", () => {
  const r = buildToday(data, { now: NOW });
  const mentioned = r.actions.flatMap(a => a.sample); assert.ok(!mentioned.includes("Stop Me")); assert.ok(!mentioned.includes("Won Org"));
  assert.equal(byId(r, "replies").count, 1);
});
test("one overdue follow-up → straight to writing it; several → a filtered list", () => {
  assert.deepEqual(byId(buildToday(data, { now: NOW }), "overdue").target, { type: "email", id: 2 });
  const many = [...data, P(7, { emailPhone: "x@y.org", currentStatus: "T2 SENT", t3DueDate: "2026-02-01" })];
  assert.deepEqual(byId(buildToday(many, { now: NOW }), "overdue").target, { type: "view", viewId: "overdue" });
});
test("'ready' starts with the best-fit prospect and offers See all", () => {
  const ready = [P(10, { companyName: "Low", emailPhone: "l@l.org" }), P(11, { companyName: "High", emailPhone: "h@h.org", vertical: "Home Health / Homecare", orgSize: "50-99", hrPersonListed: "No", contactName: "Sam", sourceUrl: "x.org", market: "Raleigh" })];
  const a = byId(buildToday(ready, { now: NOW }), "ready");
  assert.deepEqual(a.target, { type: "email", id: 11 }); assert.match(a.cta, /High/); assert.equal(a.secondary.target.viewId, "ready");
});
test("a prospect that already replied is not also called an overdue follow-up", () => {
  const r = buildToday([P(20, { emailPhone: "a@b.org", currentStatus: "T1 SENT", t2DueDate: "2026-01-01", replyReceived: true })], { now: NOW });
  assert.ok(!byId(r, "overdue")); assert.ok(byId(r, "replies"));
});
test("email-check suggestion only when that feature exists; honest empty state", () => {
  assert.ok(byId(buildToday(data, { now: NOW }), "verify"));
  assert.ok(!byId(buildToday(data, { now: NOW, tagsEnabled: false }), "verify"));
  const none = buildToday([], { now: NOW }); assert.equal(none.allClear, true); assert.deepEqual(none.actions, []);
});
test("limits the list and reports how many were left out", () => {
  const r = buildToday(data, { now: NOW, dupGroups: 3, max: 2 }); assert.equal(r.actions.length, 2); assert.ok(r.more >= 2);
});
test("pipeline and place summaries", () => {
  const s = pipelineStats(data); assert.equal(s.total, 6); assert.equal(s.stages.find(x => x.status === "NEW").count, 3);
  const pl = topPlaces([P(1, { market: "Austin, TX" }), P(2, { market: "Austin, TX" }), P(3, { market: "Texas" }), P(4, {})], 5);
  assert.deepEqual(pl.map(x => [x.label, x.count]), [["Austin, TX", 2], ["Texas", 1]]);
});
test("setup checklist is derived from real activity", () => {
  assert.equal(setupSteps([]).done, 0); assert.equal(setupSteps([]).next.id, "add");
  const s = setupSteps([P(1, { emailStatus: "valid", currentStatus: "T1 SENT", replyReceived: true })]); assert.equal(s.complete, true);
});
test("fuzzy search: contiguous beats scattered; start-of-word wins; non-matches excluded", () => {
  assert.ok(fuzzyScore("sun", "Sunrise Care") > fuzzyScore("sun", "Reunion Sun"));
  assert.ok(fuzzyScore("sc", "Sunrise Care") >= 0); assert.equal(fuzzyScore("xyz", "Sunrise Care"), -1); assert.equal(fuzzyScore("", "anything"), 0);
  assert.deepEqual(rank("oak", ["Granite", "Oak Kids", "Soak Co"], x => x), ["Oak Kids", "Soak Co"]);
  assert.ok(fuzzyScore("café", "Cafe Latte") >= 0);
});
test("overdue filter + built-in view", () => {
  const f = BUILTIN_VIEWS.find(v => v.id === "overdue").filters;
  assert.deepEqual(applyFilters(data, f).map(p => p.id), [2]);
});
