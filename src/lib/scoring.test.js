import test from "node:test"; import assert from "node:assert/strict";
import { scoreProspect, priorityFromScore, emailKind, SCORING } from "./scoring.js";
const base = { companyName: "X", vertical: "", orgSize: "", hrPersonListed: "", emailPhone: "", contactName: "", sourceUrl: "", market: "", currentStatus: "NEW" };

test("every point is accounted for by a labelled factor, within each factor's max", () => {
  const s = scoreProspect({ ...base, vertical: "Home Health / Homecare", orgSize: "50-99", hrPersonListed: "No", contactName: "Jane", emailPhone: "jane@sunrise.org 919-555-0100", sourceUrl: "https://sunrise.org", market: "Raleigh" });
  assert.equal(s.factors.reduce((a, f) => a + f.points, 0), s.score);
  s.factors.forEach(f => assert.ok(f.points <= f.max, `${f.key} ${f.points}>${f.max}`));
  assert.equal(s.tier, "hot"); assert.ok(s.score >= 70 && s.score <= 100);
});
test("empty record scores low with a to-do list of what's missing", () => {
  const s = scoreProspect(base);
  assert.equal(s.tier, "low"); assert.ok(s.missing.includes("email") && s.missing.includes("organisation size") && s.missing.includes("industry"));
});
test("a huge org with an HR contact scores lower than a mid-size one without", () => {
  const big = scoreProspect({ ...base, vertical: "Healthcare Practices", orgSize: "500+", hrPersonListed: "Yes" });
  const mid = scoreProspect({ ...base, vertical: "Healthcare Practices", orgSize: "50-99", hrPersonListed: "No" });
  assert.ok(mid.score > big.score + 20);
});
test("Do Not Respond is always excluded (0)", () => {
  assert.deepEqual([scoreProspect({ ...base, doNotRespond: true }).score, scoreProspect({ ...base, currentStatus: "Do Not Respond" }).tier], [0, "excluded"]);
});
test("a failed email gives no email credit; a verified personal email gets the bonus", () => {
  const e = "jane@sunrise.org";
  const bad = scoreProspect({ ...base, emailPhone: e, emailStatus: "invalid" }), ok = scoreProspect({ ...base, emailPhone: e }), ver = scoreProspect({ ...base, emailPhone: e, emailStatus: "valid" });
  assert.equal(bad.factors.find(f => f.key === "reach").points, 0);
  assert.equal(ver.score - ok.score, SCORING.reach.verifiedBonus);
});
test("emailKind", () => { assert.equal(emailKind("info@x.org"), "generic"); assert.equal(emailKind("HR@x.org"), "hr"); assert.equal(emailKind("jane.doe@x.org"), "personal"); });
test("priorityFromScore maps 0-100 to 1-10", () => { assert.deepEqual([0, 5, 10, 55, 100].map(priorityFromScore), [1, 1, 1, 6, 10]); });
test("scores never leave 0..100", () => {
  const max = scoreProspect({ ...base, vertical: "Home Health / Homecare", orgSize: "50-99", hrPersonListed: "No", contactName: "J", emailPhone: "j@x.org 9195550100", emailStatus: "valid", sourceUrl: "x.org", market: "Raleigh", replyReceived: true });
  assert.ok(max.score <= 100 && max.score >= 90);
});

import { explainFit } from "./scoring.js";
test("explainFit gives a short readable reason, and nothing for excluded prospects", () => {
  const s = scoreProspect({ ...base, vertical: "Home Health / Homecare", orgSize: "50-99", hrPersonListed: "No", emailPhone: "j@x.org", contactName: "J" });
  const t = explainFit(s); assert.match(t, /^Fit \d+\/100 \((Hot|Strong)\)/); assert.match(t, /Home Health/); assert.match(t, /No HR person recorded/);
  assert.equal(explainFit(scoreProspect({ ...base, doNotRespond: true })), "");
});

test("Unknown / blank HR status is neutral and asks to be filled in — it is never scored as a proven gap", () => {
  const hr = x => scoreProspect({ ...base, hrPersonListed: x }).factors.find(f => f.key === "hrgap");
  assert.equal(hr("Unknown").points, SCORING.hrGap.unknown); assert.equal(hr("").points, SCORING.hrGap.unknown);
  assert.ok(hr("No").points > hr("Unknown").points && hr("Unknown").points > hr("Yes").points);
  assert.ok(scoreProspect({ ...base, hrPersonListed: "Unknown" }).missing.includes("HR person listed"));
  assert.match(hr("No").note, /confirm/i);
});
