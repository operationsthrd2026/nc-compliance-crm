import test from "node:test"; import assert from "node:assert/strict";
import { validCoords, streetViewUrl, googleMapsUrl, mapsSearchUrl, osmUrl, locationLinks, formatAddress, geoForDb } from "./maps.js";

test("street view link is Google's documented keyless form, at the exact coordinates", () => {
  assert.equal(streetViewUrl(30.2672, -97.7431), "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=30.267200,-97.743100");
  assert.ok(!/key=/.test(streetViewUrl(30.27, -97.74)));          // no API key anywhere
  assert.equal(streetViewUrl("30.2672", "-97.7431"), "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=30.267200,-97.743100");   // stored values may be strings
});
test("no coordinates → no street-view link (never a made-up location)", () => {
  for (const [a, b] of [["", ""], [null, null], [undefined, 1], [30, ""], ["abc", "def"], [91, 10], [10, 181], [0, 0], [NaN, 5], [true, false]]) assert.equal(streetViewUrl(a, b), "", JSON.stringify([a, b]));
  assert.equal(validCoords(30.27, -97.74), true); assert.equal(validCoords("", ""), false);
});
test("map and OpenStreetMap links", () => {
  assert.equal(googleMapsUrl(30.2672, -97.7431), "https://www.google.com/maps/search/?api=1&query=30.267200,-97.743100");
  assert.match(osmUrl(30.2672, -97.7431), /^https:\/\/www\.openstreetmap\.org\/\?mlat=30\.267200&mlon=-97\.743100#map=18\//);
  assert.equal(osmUrl("", ""), "");
});
test("search link is encoded (names with & # ? and spaces cannot break the URL)", () => {
  const u = mapsSearchUrl("Smith & Sons #1?", "Austin, TX"); assert.equal(u, "https://www.google.com/maps/search/?api=1&query=Smith%20%26%20Sons%20%231%3F%2C%20Austin%2C%20TX");
  assert.equal(mapsSearchUrl("", null, undefined), "");
});
test("locationLinks: exact when we have coordinates; otherwise only an honest search link", () => {
  const exact = locationLinks({ companyName: "Cedar Clinic", latitude: 30.27, longitude: -97.74, streetAddress: "10 Main St" });
  assert.equal(exact.exact, true); assert.match(exact.streetView, /map_action=pano/); assert.match(exact.map, /query=30\.270000,-97\.740000/);
  const city = locationLinks({ companyName: "Hope Foundation", cityMarket: "Austin, TX" });
  assert.equal(city.exact, false); assert.equal(city.streetView, ""); assert.match(city.map, /query=Hope%20Foundation%2C%20Austin%2C%20TX/);
  assert.equal(locationLinks({}).map, ""); assert.equal(locationLinks().streetView, "");
});
test("address formatting", () => {
  assert.equal(formatAddress({ street: "10 Main St", city: "Austin", state: "TX", postcode: "78701" }), "10 Main St, Austin, TX 78701");
  assert.equal(formatAddress({ city: "Austin" }), "Austin"); assert.equal(formatAddress({}), ""); assert.equal(formatAddress(), "");
});
test("storing: a coordinate PAIR or nothing — a lone or impossible value is dropped, never guessed", () => {
  assert.deepEqual(geoForDb({ latitude: "30.27", longitude: "-97.74", streetAddress: " 10 Main St " }), { latitude: 30.27, longitude: -97.74, street_address: "10 Main St" });
  assert.deepEqual(geoForDb({ latitude: 30.27, longitude: "" }), { latitude: null, longitude: null, street_address: null });
  assert.deepEqual(geoForDb({ latitude: 95, longitude: 10 }), { latitude: null, longitude: null, street_address: null });
  assert.equal(geoForDb({ streetAddress: "x".repeat(400) }).street_address.length, 300); assert.deepEqual(geoForDb(), { latitude: null, longitude: null, street_address: null });
});
