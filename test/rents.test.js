"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { splitCSV, latest, assignTiers, matchName } = require("../tools/fetch-rents");

test("splitCSV handles quoted fields with embedded commas", () => {
  assert.deepStrictEqual(
    splitCSV('123,"Atlanta-Sandy Springs, GA",NM,1500'),
    ["123", "Atlanta-Sandy Springs, GA", "NM", "1500"]);
  assert.deepStrictEqual(splitCSV('a,"he said ""hi""",b'), ["a", 'he said "hi"', "b"]);
});

test("latest walks back over trailing nulls", () => {
  assert.deepStrictEqual(latest([1000, 1100, null, null]), { v: 1100, i: 1 });
  assert.strictEqual(latest([null, null]), null);
});

test("assignTiers cuts the pool into thirds, cheapest first", () => {
  const tiers = assignTiers({ a: 900, b: 1200, c: 1500, d: 2000, e: 2500, f: 3000 });
  assert.strictEqual(tiers.a.tier, 1);
  assert.strictEqual(tiers.b.tier, 1);
  assert.strictEqual(tiers.c.tier, 2);
  assert.strictEqual(tiers.d.tier, 2);
  assert.strictEqual(tiers.e.tier, 3);
  assert.strictEqual(tiers.f.tier, 3);
  assert.strictEqual(tiers.f.rent, 3000);
});

test("matchName tries Saint/St. variants", () => {
  const idx = new Map([["Saint George, UT", []]]);
  assert.strictEqual(matchName(idx, "St. George, UT"), "Saint George, UT");
  assert.strictEqual(matchName(idx, "Nowhere, XX"), null);
});
