import test from "node:test"; import assert from "node:assert/strict";
import { buildDeskQueue, suggestedTemplate, draftIssues, recordPlan, touchOf, STATUS_AFTER, isReply, stripLineBreaks } from "./outreachDesk.js";
const NOW = new Date("2026-03-10T12:00:00");
const P = (id, o = {}) => ({ id, companyName: `Co ${id}`, contactName: "Sam Lee", emailPhone: `p${id}@x.org`, currentStatus: "NEW", vertical: "", ...o });
const data = [
  P(1, { companyName: "Granite", currentStatus: "Replied", replyReceived: true }),
  P(2, { companyName: "Oak", currentStatus: "T1 SENT", t2DueDate: "2026-03-01" }),
  P(3, { companyName: "Soon", currentStatus: "T1 SENT", t2DueDate: "2026-03-12" }),
  P(4, { companyName: "Later", currentStatus: "T1 SENT", t2DueDate: "2026-03-17" }),
  P(5, { companyName: "Fresh" }),
  P(6, { companyName: "NoMail", emailPhone: "919-555-0100" }),
  P(7, { companyName: "Stop", doNotRespond: true }),
  P(8, { companyName: "Won", currentStatus: "Converted" }),
];
const sec = (q, id) => q.sections.find(s => s.id === id);

test("queue: replies first, then overdue, due soon, ready — each prospect once", () => {
  const q = buildDeskQueue(data, { now: NOW });
  assert.deepEqual(q.sections.map(s => s.id), ["replies", "overdue", "soon", "ready"]);
  assert.deepEqual(sec(q, "replies").items.map(i => i.p.companyName), ["Granite"]);
  assert.deepEqual(sec(q, "overdue").items.map(i => i.p.companyName), ["Oak"]);
  assert.deepEqual(sec(q, "soon").items.map(i => i.p.companyName), ["Soon"]);
  assert.deepEqual(sec(q, "ready").items.map(i => i.p.companyName), ["Fresh"]);
  const all = q.sections.flatMap(s => s.items.map(i => i.p.id)); assert.equal(new Set(all).size, all.length);
});
test("queue never includes Do Not Respond, converted, far-off or email-less prospects (those are counted instead)", () => {
  const q = buildDeskQueue(data, { now: NOW }); const names = q.sections.flatMap(s => s.items.map(i => i.p.companyName));
  for (const n of ["Stop", "Won", "Later", "NoMail"]) assert.ok(!names.includes(n), n);
  assert.equal(q.needsEmail, 1); assert.equal(q.total, 4);
});
test("template follows the cadence; replies get a personal reply, not a touch", () => {
  assert.equal(suggestedTemplate(P(1, { currentStatus: "T1 SENT" })), "follow-up");
  assert.equal(suggestedTemplate(P(1, { currentStatus: "T2 SENT" })), "final-check-in");
  assert.equal(suggestedTemplate(P(1, { currentStatus: "NEW", vertical: "Nonprofits & Associations" })), "nonprofit-intro");
  assert.equal(suggestedTemplate(P(1, { currentStatus: "Replied", replyReceived: true })), "reply");
  assert.deepEqual([touchOf("business-intro"), touchOf("follow-up"), touchOf("final-check-in"), touchOf("reply")], [1, 2, 3, null]);
  assert.ok(isReply(P(1, { replyReceived: true })));
});
test("issues: Do Not Respond, no email, empty text BLOCK; missing name and placeholders only WARN", () => {
  assert.equal(draftIssues(P(1, { doNotRespond: true }), "s", "b").blocking, true);
  assert.equal(draftIssues(P(1, { emailPhone: "919-555-0100" }), "s", "b").blocking, true);
  assert.equal(draftIssues(P(1), "", "b").blocking, true); assert.equal(draftIssues(P(1), "s", "  ").blocking, true);
  const w = draftIssues(P(1, { contactName: "" }), "Hi {{company}}", "body");
  assert.equal(w.blocking, false); assert.ok(w.items.some(i => /Hi there/.test(i.text))); assert.ok(w.items.some(i => /placeholder/.test(i.text)));
  assert.ok(draftIssues(P(1), "s", "b", { touch: 3 }).items.some(i => /approval/.test(i.text)));
  assert.equal(draftIssues(P(1), "s", "b").items.length, 0);
});
test("issues: warns about failed email checks and over-long mailto text", () => {
  assert.ok(draftIssues(P(1, { emailStatus: "invalid" }), "s", "b").items.some(i => /bounce/.test(i.text)));
  assert.ok(draftIssues(P(1), "s", "x".repeat(3600)).items.some(i => /Too long/.test(i.text)));
});
test("recordPlan describes exactly what will change (and what won't) before anything is saved", () => {
  const apply = (p, st) => ({ ...p, currentStatus: st, t2DueDate: "2026-03-17" });
  const plan = recordPlan(P(1), 1, apply);
  assert.equal(plan.title, "Record Touch 1 as sent"); assert.ok(plan.changes.some(c => /T1 SENT/.test(c))); assert.ok(plan.changes.some(c => /Touch 2 due: 2026-03-17/.test(c))); assert.ok(plan.changes.some(c => /activity log/.test(c)));
  const reply = recordPlan(P(1), null, apply); assert.ok(/stays the same/.test(reply.changes[0])); assert.equal(STATUS_AFTER[3], "NURTURE/T3 SENT");
});
test("line breaks are stripped from header-bound text (no mail-header injection)", () => {
  assert.equal(stripLineBreaks("Hello\r\nBcc: evil@x.com"), "Hello Bcc: evil@x.com"); assert.equal(stripLineBreaks(null), "");
});

test("a prospect whose next touch is a week away is NOT in the queue right after you send (no clutter)", () => {
  const justSent = P(30, { companyName: "JustSent", currentStatus: "T1 SENT", t2DueDate: "2026-03-17" });
  const q = buildDeskQueue([justSent], { now: NOW }); assert.equal(q.total, 0);
  assert.equal(buildDeskQueue([{ ...justSent, t2DueDate: "2026-03-12" }], { now: NOW }).total, 1);   // 2 days away → coming up
});
