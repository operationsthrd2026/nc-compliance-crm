import test from "node:test"; import assert from "node:assert/strict";
import { localCheck, mxLookup, verifyEmail, mapPool, _clearDnsCache } from "./emailCheck.js";

// Fake Cloudflare DoH
const dns = table => async url => {
  const u = new URL(url); const name = u.searchParams.get("name"), type = u.searchParams.get("type");
  const rec = table[name]; if (rec === "fail") throw new Error("network down");
  const body = !rec ? { Status: 3 } : { Status: 0, Answer: (rec[type] || []).map(d => ({ type: type === "MX" ? 15 : 1, data: d })) };
  return { ok: true, json: async () => body };
};
const table = { "good.org": { MX: ["10 mx.good.org."] }, "webonly.org": { MX: [], A: ["1.2.3.4"] }, "nomail.org": { MX: [], A: [] }, "nullmx.org": { MX: ["0 ."], A: [] }, "down.org": "fail", "gmial.com": { MX: ["10 mx.squatter.example."] } };
const run = (email, extra = {}) => { _clearDnsCache(); return verifyEmail(email, { fetchImpl: dns(table), now: () => "T", ...extra }); };

test("localCheck flags syntax, disposable, no-reply, generic, webmail, typos", () => {
  assert.equal(localCheck("not-an-email").syntaxOk, false);
  assert.equal(localCheck("a..b@x.org").syntaxOk, false);
  assert.ok(localCheck("x@mailinator.com").disposable); assert.ok(localCheck("noreply@x.org").noReply);
  assert.ok(localCheck("info@x.org").generic); assert.ok(localCheck("bob@gmail.com").webmail);
  assert.equal(localCheck("bob@gmial.com").suggestion, "gmail.com");
});
test("valid: domain has MX", async () => { const r = await run("jane@good.org"); assert.equal(r.status, "valid"); assert.equal(r.confirmed, false); });
test("invalid: nonexistent domain, null MX / no A", async () => {
  assert.equal((await run("a@ghost.org")).status, "invalid");
  assert.equal((await run("a@nomail.org")).status, "invalid");
  assert.equal((await run("a@nullmx.org")).status, "invalid");
});
test("risky: no MX but web server exists; typo domain", async () => {
  assert.equal((await run("a@webonly.org")).status, "risky");
  const t = await run("a@gmial.com"); assert.equal(t.status, "risky"); assert.equal(t.suggestion, "gmail.com"); // typo domain that resolves (typosquat)
  const t2 = await run("a@gamil.com"); assert.equal(t2.status, "invalid"); assert.equal(t2.suggestion, "gmail.com"); // typo domain that doesn't exist, suggestion still offered
});
test("unknown (not invalid) when DNS can't be reached", async () => { const r = await run("a@down.org"); assert.equal(r.status, "unknown"); });
test("invalid short-circuits without any DNS call", async () => {
  let calls = 0; const f = async () => { calls++; throw new Error("x"); };
  _clearDnsCache(); const r = await verifyEmail("noreply@good.org", { fetchImpl: f }); assert.equal(r.status, "invalid"); assert.equal(calls, 0);
});
test("generic address stays valid but is flagged", async () => { const r = await run("info@good.org"); assert.equal(r.status, "valid"); assert.ok(r.flags.includes("generic")); });
test("Hunter can confirm or reject the mailbox", async () => {
  assert.equal((await run("a@good.org", { hunterVerify: async () => ({ result: "deliverable" }) })).confirmed, true);
  assert.equal((await run("a@good.org", { hunterVerify: async () => ({ result: "undeliverable" }) })).status, "invalid");
  assert.equal((await run("a@good.org", { hunterVerify: async () => { throw new Error("boom"); } })).status, "valid"); // failure ignored
});
test("DNS results are cached per domain", async () => {
  _clearDnsCache(); let calls = 0; const f = async (...a) => { calls++; return dns(table)(...a); };
  await Promise.all(["a@good.org", "b@good.org", "c@good.org"].map(e => verifyEmail(e, { fetchImpl: f })));
  assert.equal(calls, 1);
});
test("mapPool keeps order and respects the concurrency limit", async () => {
  let active = 0, peak = 0;
  const out = await mapPool([1, 2, 3, 4, 5, 6], 2, async n => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return n * 2; });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]); assert.ok(peak <= 2);
});
