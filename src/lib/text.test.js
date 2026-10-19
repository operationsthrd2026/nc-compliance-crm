import test from "node:test"; import assert from "node:assert/strict";
import { normalizeName, nameSimilarity, extractEmails, extractPhones, domainOfUrl, domainOfEmail, isFreemail } from "./text.js";

test("normalizeName strips legal suffixes, punctuation, accents, 'the'", () => {
  assert.equal(normalizeName("ACME Home-Care, L.L.C."), "acme home care");
  assert.equal(normalizeName("The Durham Child Care, Inc."), "durham child care");
  assert.equal(normalizeName("Café & Co. Foundation"), "cafe foundation");
  assert.equal(normalizeName(null), "");
});
test("nameSimilarity: identical after normalisation = 1, different cities stay apart", () => {
  assert.equal(nameSimilarity("Acme Home Care LLC", "ACME Home Care, Inc."), 1);
  assert.ok(nameSimilarity("Raleigh Home Health", "Durham Home Health") < 0.78);
  assert.ok(nameSimilarity("Durham Child Care", "Durham Child Care Center") >= 0.78);
  assert.ok(nameSimilarity("Smith Construction", "Zebra Pediatrics") < 0.3);
  assert.equal(nameSimilarity("", "x"), 0);
});
test("extractEmails lowercases, dedupes, trims trailing punctuation", () => {
  assert.deepEqual(extractEmails("Info@Acme.org; Jane <jane@acme.org>. info@acme.org,").sort(), ["info@acme.org", "jane@acme.org"]);
  assert.deepEqual(extractEmails("no email here"), []);
});
test("extractPhones normalises to 10 digits and ignores digits inside emails", () => {
  assert.deepEqual(extractPhones("(919) 555-0100 / +1 919.555.0101 user12345678901@x.com").sort(), ["9195550100", "9195550101"]);
  assert.deepEqual(extractPhones("call 555-0100"), []);
});
test("domain helpers", () => {
  assert.equal(domainOfUrl("https://www.Acme.org/about?x=1"), "acme.org");
  assert.equal(domainOfUrl("acme.org"), "acme.org");
  assert.equal(domainOfUrl("not a url"), "");
  assert.equal(domainOfEmail("A@Sub.Acme.org"), "sub.acme.org");
  assert.ok(isFreemail("Gmail.com")); assert.ok(!isFreemail("acme.org"));
});
