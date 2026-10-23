import test from "node:test"; import assert from "node:assert/strict";
import { prospectExportRows } from "./exportRows.js";
const P = (o = {}) => ({ id: 1, companyName: "Sunrise Care", contactName: "Jane", title: "Director", emailPhone: "jane@sunrise.org | 512-555-0100", market: "Austin, TX", cityMarket: "Austin, TX", vertical: "Home Health / Homecare", currentStatus: "T1 SENT", tags: ["q4", "home-health"], emailStatus: "valid", ...o });
test("REGRESSION: building export rows works (it used to throw on every export)", () => {
  assert.doesNotThrow(() => prospectExportRows([P()]));
  const rows = prospectExportRows([P(), P({ id: 2, companyName: "Oak Kids" })]);
  assert.equal(rows.length, 2); assert.equal(rows[0]["Company Name"], "Sunrise Care"); assert.equal(rows[1]["Company Name"], "Oak Kids");
});
test("export includes the newer columns: tags, email status and fit score", () => {
  const r = prospectExportRows([P()])[0];
  assert.equal(r["Tags"], "q4; home-health"); assert.equal(r["Email Status"], "valid"); assert.ok(typeof r["Fit Score"] === "number" && r["Fit Score"] >= 0 && r["Fit Score"] <= 100);
});
test("an empty list and records with missing fields do not crash", () => {
  assert.deepEqual(prospectExportRows([]), []); assert.deepEqual(prospectExportRows(), []);
  assert.doesNotThrow(() => prospectExportRows([{ id: 9 }]));
});
