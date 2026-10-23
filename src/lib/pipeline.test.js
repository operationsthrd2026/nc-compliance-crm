import test from "node:test"; import assert from "node:assert/strict";
import { PIPE_STAGES, buildBoard, canMove, movePlan, cardInfo, daysSince, lastTouch, stageById, isDNR } from "./pipeline.js";
const NOW = new Date("2026-03-10T12:00:00");
const P = (id, o = {}) => ({ id, companyName: `Co ${id}`, contactName: "Sam", emailPhone: `p${id}@x.org`, currentStatus: "NEW", vertical: "", market: "Austin, TX", ...o });
// the same cadence rule the app uses (stamps dates the first time a send stage is entered)
const apply = (p, s) => { const o = { ...p, currentStatus: s }; if (s === "T1 SENT" && !p.t1SendDate){ o.t1SendDate = "2026-03-10"; o.t2DueDate = "2026-03-17"; } if (s === "T2 SENT" && !p.t2SendDate){ o.t2SendDate = "2026-03-10"; o.t3DueDate = "2026-03-24"; } return o; };

test("eight active stages, in outreach order; Do Not Respond is not a column", () => {
  assert.deepEqual(PIPE_STAGES.map(s => s.id), ["NEW", "T1 SENT", "T2 SENT", "REVIEW", "TOUCH 3 GATE", "NURTURE/T3 SENT", "Replied", "Converted"]);
  assert.equal(stageById("Do Not Respond"), null); assert.equal(stageById("T1 SENT").touch, 1);
});
test("each card signals the right next step", () => {
  assert.deepEqual(cardInfo(P(1, { currentStatus: "T1 SENT", t2DueDate: "2026-03-01" }), NOW).chip, { tone: "red", text: "Touch 2 overdue · 9 days" });
  const soon = cardInfo(P(2, { currentStatus: "T1 SENT", t2DueDate: "2026-03-12" }), NOW); assert.equal(soon.chip.tone, "amber"); assert.equal(soon.urgency, 2);
  assert.equal(cardInfo(P(3, { currentStatus: "T1 SENT", t2DueDate: "2026-04-20" }), NOW).chip.tone, "blue");
  assert.equal(cardInfo(P(4, { currentStatus: "Replied", replyReceived: true }), NOW).chip.text, "Replied — answer them");
  assert.equal(cardInfo(P(5), NOW).chip.text, "Send Touch 1"); assert.equal(cardInfo(P(6, { emailPhone: "919-555-0100" }), NOW).chip.tone, "amber");
  assert.equal(cardInfo(P(7, { currentStatus: "Converted", replyReceived: true }), NOW).chip.text, "Converted");
  assert.equal(cardInfo(P(8, { doNotRespond: true }), NOW).chip.text, "Do not contact");
});
test("a column sorts overdue first, then replies, then strongest fit", () => {
  const data = [P(1, { currentStatus: "T1 SENT", t2DueDate: "2026-04-20", companyName: "Calm" }), P(2, { currentStatus: "T1 SENT", t2DueDate: "2026-03-01", companyName: "Late" }), P(3, { currentStatus: "T1 SENT", replyReceived: true, t2DueDate: "2026-04-20", companyName: "Answered" })];
  assert.deepEqual(buildBoard(data, { now: NOW }).columns.find(c => c.stage.id === "T1 SENT").cards.map(c => c.p.companyName), ["Late", "Answered", "Calm"]);
});
test("filters: search, industry, market, 'needs action', and Do Not Respond hidden by default", () => {
  const data = [P(1, { companyName: "Sunrise Care", vertical: "Home Health / Homecare" }), P(2, { companyName: "Oak Kids", market: "Raleigh, NC" }), P(3, { companyName: "Stop", doNotRespond: true }),
    P(4, { companyName: "Late", currentStatus: "T1 SENT", t2DueDate: "2026-03-01" })];
  const n = o => buildBoard(data, { now: NOW, ...o }).total;
  assert.equal(n({}), 3); assert.equal(n({ hideDNR: false }), 4); assert.equal(n({ query: "sunrise" }), 1); assert.equal(n({ query: "p2@x" }), 1);
  assert.equal(n({ vertical: "Home Health / Homecare" }), 1); assert.equal(n({ market: "Raleigh, NC" }), 1); assert.equal(n({ needsAction: true }), 1);
});
test("column summary: counts, overdue, replies, average fit", () => {
  const data = [P(1, { currentStatus: "T1 SENT", t2DueDate: "2026-03-01" }), P(2, { currentStatus: "T1 SENT", replyReceived: true }), P(3, { currentStatus: "T1 SENT", t2DueDate: "2026-05-01" })];
  const board = buildBoard(data, { now: NOW }), c = board.columns.find(x => x.stage.id === "T1 SENT");
  assert.deepEqual([c.count, c.overdue, c.replies], [3, 1, 1]); assert.ok(c.avgFit >= 0); assert.deepEqual([board.total, board.overdue, board.replies], [3, 1, 1]);
});
test("REGRESSION: a move uses the cadence logic (the board used to save a bare status and skip the dates)", () => {
  const plan = movePlan(P(1), "T1 SENT", apply);
  assert.equal(plan.title, "Record Touch 1 as sent?"); assert.ok(plan.lines.some(l => /Touch 1 sent: 2026-03-10/.test(l))); assert.ok(plan.lines.some(l => /Touch 2 due: 2026-03-17/.test(l)));
  assert.equal(movePlan(P(1), "REVIEW", apply).title, "Move to Under review?"); assert.equal(movePlan(P(1), "REVIEW", apply).lines.length, 1);
});
test("moving into a 'sent' stage that has NOT been recorded asks first; other moves don't", () => {
  assert.deepEqual(canMove(P(1), "T1 SENT", { canEdit: true }), { ok: true, needsConfirm: true, skips: false });
  assert.equal(canMove(P(1), "REVIEW", { canEdit: true }).needsConfirm, false);
  assert.equal(canMove(P(1), "Replied", { canEdit: true }).needsConfirm, false);
  assert.equal(canMove(P(1, { currentStatus: "T2 SENT", t1SendDate: "2026-01-01", t2SendDate: "2026-01-08" }), "T1 SENT", { canEdit: true }).needsConfirm, false);   // moving back: that send is already on record
});
test("skipping a touch is flagged (NEW → Touch 2 sent leaves Touch 1 empty)", () => {
  assert.equal(canMove(P(1), "T2 SENT", { canEdit: true }).skips, true); assert.equal(canMove(P(1, { t1SendDate: "2026-01-01" }), "T2 SENT", { canEdit: true }).skips, false);
});
test("PROTECTION: Do Not Respond and view-only accounts cannot move cards; same-stage drops are ignored", () => {
  const dnr = canMove(P(1, { doNotRespond: true, companyName: "Stop Co" }), "T1 SENT", { canEdit: true }); assert.equal(dnr.ok, false); assert.match(dnr.reason, /Stop Co is marked Do Not Respond/);
  assert.equal(canMove(P(1), "T1 SENT", { canEdit: false }).ok, false); assert.match(canMove(P(1), "T1 SENT", { canEdit: false }).reason, /view-only/);
  assert.deepEqual(canMove(P(1), "NEW", { canEdit: true }), { ok: false, silent: true, reason: "Already in this stage." });
  assert.equal(canMove(P(1), "Do Not Respond", { canEdit: true }).ok, false);
});
test("small helpers", () => { assert.equal(daysSince("2026-03-01", NOW), 9); assert.equal(daysSince(""), null); assert.equal(lastTouch(P(1, { t1SendDate: "a", t2SendDate: "b" })), "b"); assert.ok(isDNR({ currentStatus: "Do Not Respond" })); });
