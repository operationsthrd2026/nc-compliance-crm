import test from "node:test"; import assert from "node:assert/strict";
import { nextAction, fmtDay } from "./outreach.js";
const NOW = new Date("2026-03-10T12:00:00");
test("NEW needs an email before Touch 1", () => {
  assert.equal(nextAction({ currentStatus: "NEW", emailPhone: "a@b.org" }, NOW).label, "Send Touch 1");
  assert.equal(nextAction({ currentStatus: "NEW", emailPhone: "919-555-0100" }, NOW).tone, "warn");
});
test("T1 SENT flags overdue Touch 2 only when the due date has passed", () => {
  assert.equal(nextAction({ currentStatus: "T1 SENT", t2DueDate: "2026-03-01" }, NOW).overdue, true);
  assert.equal(nextAction({ currentStatus: "T1 SENT", t2DueDate: "2026-03-20" }, NOW).overdue, false);
  assert.equal(nextAction({ currentStatus: "T1 SENT", t2DueDate: "2026-03-10" }, NOW).overdue, false); // due today isn't overdue
});
test("Do Not Respond wins over any status; Touch 3 gate respects approval", () => {
  assert.equal(nextAction({ currentStatus: "T1 SENT", doNotRespond: true }, NOW).tone, "muted");
  assert.equal(nextAction({ currentStatus: "TOUCH 3 GATE", t3Approved: false }, NOW).label, "Awaiting approval");
  assert.equal(nextAction({ currentStatus: "TOUCH 3 GATE", t3Approved: true }, NOW).label, "Send Touch 3");
});
test("fmtDay", () => { assert.equal(fmtDay("2026-03-03"), "Mar 3"); assert.equal(fmtDay(""), ""); assert.equal(fmtDay("garbage"), ""); });
