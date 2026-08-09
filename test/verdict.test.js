"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { buildUserMessage, scoreLeaders, weekSectionOk, cleanMarkdown } = require("../engine/verdict");

// Minimal snapshot with distinct now/week leaders, mirroring the 2026-08-09
// production run where sonnet-5 crowned the wrong week winner.
const city = (name, now, week, combined) => ({
  name, curated: false, scene: 3, services: 3, metro_pop: 100000,
  scores: { now, week, combined },
  days: [{ date: "2026-08-09", score: 96, hi: 72, lo: 61, precipProb: 19, precipSum: 0, snow: 0, wind: 11, sunFrac: 0.63 }],
});

const snap = {
  _meta: { generated_at: "2026-08-09T09:12:47.021Z", season: "summer", tie_epsilon: 2 },
  shortlist: ["Duluth, MN", "San Luis Obispo, CA", "Traverse City, MI"],
  ties: ["Duluth, MN"],
  cities: [
    city("Duluth, MN", 98, 97.8, 97.9),
    city("San Luis Obispo, CA", 91.2, 97.3, 94.6),
    city("Traverse City, MI", 90.7, 97.3, 94.3),
    city("Elsewhere, XX", 100, 100, 100), // not shortlisted; must be ignored
  ],
};

test("scoreLeaders picks the max within the shortlist only", () => {
  assert.deepStrictEqual(scoreLeaders(snap, "week"), { top: 97.8, names: ["Duluth, MN"] });
  assert.deepStrictEqual(scoreLeaders(snap, "now"), { top: 98, names: ["Duluth, MN"] });
});

test("scoreLeaders reports shared maxima as multiple names", () => {
  const s = JSON.parse(JSON.stringify(snap));
  s.cities[1].scores.week = 97.8;
  assert.deepStrictEqual(scoreLeaders(s, "week").names, ["Duluth, MN", "San Luis Obispo, CA"]);
});

test("user message carries the deterministic leaders line", () => {
  const msg = buildUserMessage(snap);
  assert.match(msg, /Deterministic leaders: now = Duluth, MN \(98\); week = Duluth, MN \(97\.8\); combined = Duluth, MN \(97\.9\)\./);
  assert.ok(!msg.includes("Elsewhere"), "non-shortlisted cities must not leak into the prompt");
});

test("weekSectionOk accepts a verdict naming the week leader", () => {
  const md = "## Best right now\nDuluth, MN leads.\n\n## Best for the coming week\nDuluth strings together five great days.\n\n## Why\n...";
  assert.ok(weekSectionOk(md, snap));
});

test("weekSectionOk rejects a verdict crowning the wrong week city", () => {
  const md = "## Best right now\nDuluth, MN leads.\n\n## Best for the coming week\nSan Luis Obispo takes the 7-day crown.\n\n## Why\n...";
  assert.ok(!weekSectionOk(md, snap));
});

test("weekSectionOk rejects a verdict missing the week section", () => {
  assert.ok(!weekSectionOk("## Best right now\nDuluth, MN.", snap));
});

test("cleanMarkdown forces a blank line after headings (DeepSeek shape)", () => {
  const md = "## Best right now\nDuluth leads.\n\n## Why\nNumbers.";
  assert.strictEqual(cleanMarkdown(md),
    "## Best right now\n\nDuluth leads.\n\n## Why\n\nNumbers.");
});

test("cleanMarkdown leaves already-canonical markdown alone and strips narration", () => {
  const md = "Sure! Here is the verdict:\n\n## Best right now\n\nDuluth leads.";
  assert.strictEqual(cleanMarkdown(md), "## Best right now\n\nDuluth leads.");
});
