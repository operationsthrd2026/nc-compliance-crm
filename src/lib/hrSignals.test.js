import test from "node:test"; import assert from "node:assert/strict";
import { hrFromTitle } from "./hrSignals.js";
test("real HR / people titles are recognised", () => {
  for (const t of ["HR Director", "Director of Human Resources", "Human Resource Manager", "VP, People Operations", "Chief People Officer", "Head of HR", "Talent Acquisition Manager", "People & Culture Lead", "hr generalist"])
    assert.equal(hrFromTitle(t), "Yes", t);
});
test("REGRESSION: words that merely contain 'hr' or 'people' are not HR titles", () => {
  for (const t of ["Three Rivers Director", "Chris Smith, Owner", "Shrink Wrap Operations", "Executive Director", "Owner", "Managing Partner", "People's Pastor", "Throughput Manager", ""])
    assert.equal(hrFromTitle(t), "Unknown", t);
});
test("never claims 'No' — a title can't prove there is no HR contact", () => {
  for (const t of ["Owner", "", null, undefined, "CEO"]) assert.notEqual(hrFromTitle(t), "No");
});
