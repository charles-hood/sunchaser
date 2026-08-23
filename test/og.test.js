"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const og = require("../engine/og");
const ttf = require("../engine/ttf");

const FONTS = path.join(__dirname, "..", "tools", "og", "fonts");
const day = (over = {}) => ({ date: "2026-08-23", hi: 73.4, lo: 60, precipProb: 16, sky: "sunny", score: 100, ...over });
const city = (name, week, over = {}) => ({
  name, scores: { now: 100, week, combined: 99 }, days: [day(), day({ date: "2026-08-24" })], ...over,
});
const snapshot = (cities = [city("Pittsburgh, PA", 99.3), city("Grand Rapids, MI", 96.2), city("Coeur d'Alene, ID", 91.9), city("Duluth, MN", 94.1)]) =>
  ({ cities, ties: [], shortlist: [] });
const rents = { "Pittsburgh, PA": { tier: 2 }, "Grand Rapids, MI": { tier: 2 }, "Coeur d'Alene, ID": { tier: 3 } };

test("ttf.measure reads real advances from the vendored fonts", () => {
  const b = path.join(FONTS, "BricolageGrotesque.ttf"), m = path.join(FONTS, "IBMPlexMono-Regular.ttf");
  assert.ok(ttf.measure(b, "WW", 26) > ttf.measure(b, "ii", 26) * 1.5, "proportional font: W wider than i");
  assert.equal(ttf.measure(m, "W", 22).toFixed(3), ttf.measure(m, "i", 22).toFixed(3), "monospace: equal advances");
  assert.equal(ttf.measure(m, "ab", 10), ttf.measure(m, "a", 10) * 2);
  assert.ok(Number.isFinite(ttf.measure(b, "\u{1F600}", 26)), "missing glyph counts as average, never NaN");
});

test("buildSvg names the top three, escapes, dates, and chips", () => {
  const svg = og.buildSvg(snapshot(), rents);
  assert.match(svg, /Pittsburgh, PA/);
  assert.match(svg, /Grand Rapids, MI/);
  assert.match(svg, /Coeur d&#39;Alene, ID/);
  assert.doesNotMatch(svg, /Duluth/);
  assert.match(svg, /4 vetted nomad cities/);
  assert.match(svg, /Leaders for Sun, Aug 23/);
  assert.match(svg, />\$\$\$</);
  assert.match(svg, />73°</);
  assert.match(svg, />99</);
  assert.doesNotMatch(svg, /<script/i);
});

test("buildSvg omits the chip without rent data and survives missing fields", () => {
  const svg = og.buildSvg(snapshot(), null);
  assert.doesNotMatch(svg, />\$+</);
  const bare = snapshot([city("A, AA", NaN, { days: [{ date: "2026-08-23" }] }), city("B, BB", 90), city("C, CC", 90)]);
  const svg2 = og.buildSvg(bare, null);
  assert.match(svg2, />–</);
});

test("buildSvg refuses fewer than three cities", () => {
  assert.throws(() => og.buildSvg(snapshot([city("A, AA", 90), city("B, BB", 90)]), null), /at least 3/);
});

test("nameLayout keeps names that fit, drops the state when not, squeezes last", () => {
  assert.deepEqual(og.nameLayout("Traverse City, MI", 3), { text: "Traverse City, MI", squeeze: null });
  assert.deepEqual(og.nameLayout("Saratoga Springs, NY", 3), { text: "Saratoga Springs", squeeze: null });
  assert.deepEqual(og.nameLayout("Saratoga Springs, NY", 0), { text: "Saratoga Springs, NY", squeeze: null });
  const long = og.nameLayout("Wwwwwwwwwwwwwwwwwwwwwww, WW", 3);
  assert.equal(long.text, "Wwwwwwwwwwwwwwwwwwwwwww");
  assert.ok(long.squeeze > 0 && long.squeeze < 250);
  assert.match(og.buildSvg(snapshot([city("Wwwwwwwwwwwwwwwwwwwwwww, WW", 90), city("B, BB", 90), city("C, CC", 90)]), null), /textLength=/);
});

test("stampOgImage dates the og:image URL and nothing else", () => {
  const html = '<meta property="og:image" content="https://x/og.png">\n<meta property="og:image:width" content="1200">';
  assert.equal(og.stampOgImage(html, "2026-08-23"),
    '<meta property="og:image" content="https://x/og.png?d=2026-08-23">\n<meta property="og:image:width" content="1200">');
  assert.equal(og.stampOgImage(html, null), html);
});

test("cardDate is the leader's first forecast day", () => {
  assert.equal(og.cardDate(snapshot()), "2026-08-23");
  assert.equal(og.cardDate({ cities: [] }), null);
});

const hasRsvg = (() => { try { execFileSync("rsvg-convert", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("renderOg writes a PNG and skips when the day is unchanged", { skip: !hasRsvg && "rsvg-convert not installed" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-test-"));
  try {
    const r1 = og.renderOg(snapshot(), { varDir: dir, rents });
    assert.equal(r1.skipped, false);
    const png = fs.readFileSync(path.join(dir, "og.png"));
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
    assert.equal(og.readMeta(dir).date, "2026-08-23");
    assert.deepEqual(og.renderOg(snapshot(), { varDir: dir, rents, ifStale: true }), { skipped: true, date: "2026-08-23" });
    const next = snapshot(); next.cities[0].days[0].date = "2026-08-24";
    assert.equal(og.renderOg(next, { varDir: dir, rents, ifStale: true }).skipped, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("renderOg reports a missing rasterizer instead of crashing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-test-"));
  const prev = process.env.RSVG_CONVERT;
  process.env.RSVG_CONVERT = path.join(dir, "definitely-not-here");
  try {
    assert.throws(() => og.renderOg(snapshot(), { varDir: dir, rents }), /rsvg-convert not installed/);
    assert.ok(!fs.existsSync(path.join(dir, "og.png")));
  } finally {
    if (prev == null) delete process.env.RSVG_CONVERT; else process.env.RSVG_CONVERT = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
