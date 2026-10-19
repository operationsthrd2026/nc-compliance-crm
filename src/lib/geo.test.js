import test from "node:test"; import assert from "node:assert/strict";
import { placeOf, groupByPlace, jitter, coordsOf } from "./geo.js";
test("placeOf prefers the market, falls back to scanning the city text", () => {
  assert.equal(placeOf({ market: "Durham", cityMarket: "Cary" }), "Durham");
  assert.equal(placeOf({ market: "Other", cityMarket: "Cary, NC 27511" }), "Cary");
  assert.equal(placeOf({ market: "", cityMarket: "123 Main St, Chapel Hill" }), "Chapel Hill");
  assert.equal(placeOf({ market: "", cityMarket: "Boone, NC" }), null);
  assert.equal(placeOf({}), null);
});
test("groupByPlace counts unplaced separately", () => {
  const g = groupByPlace([{ market: "Raleigh" }, { market: "Raleigh" }, { cityMarket: "Boone" }, {}]);
  assert.equal(g.places.get("Raleigh").length, 2); assert.equal(g.unplaced, 2);
});
test("jitter is deterministic and small", () => {
  const base = coordsOf("Raleigh"); const a = jitter(base, "p1"), b = jitter(base, "p1"), c = jitter(base, "p2");
  assert.deepEqual(a, b); assert.notDeepEqual(a, c);
  assert.ok(Math.abs(a[0] - base[0]) < 0.01 && Math.abs(a[1] - base[1]) < 0.01);
});
