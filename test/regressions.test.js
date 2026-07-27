"use strict";
// Regression tests for confirmed review findings (F*/B* pass 1, K* Kimi pass 2).
const { test } = require("node:test");
const assert = require("node:assert");
const { scoreCity, buildSnapshot } = require("../engine/score");
const { cumulative, pointAtMile, projectOntoRoute, addDays, nightForLeg } = require("../engine/route");
const { freshAge } = require("../engine/fetch");

const goodDaily = (n = 7) => ({
  time: Array.from({ length: n }, (_, i) => `2026-07-${23 + i}`),
  temperature_2m_max: Array(n).fill(75),
  temperature_2m_min: Array(n).fill(55),
  apparent_temperature_max: Array(n).fill(75),
  precipitation_probability_max: Array(n).fill(5),
  precipitation_sum: Array(n).fill(0),
  snowfall_sum: Array(n).fill(0),
  wind_speed_10m_max: Array(n).fill(8),
  wind_gusts_10m_max: Array(n).fill(15),
  uv_index_max: Array(n).fill(6),
  sunshine_duration: Array(n).fill(40000),
  daylight_duration: Array(n).fill(50000),
  weather_code: Array(n).fill(1),
});

test("F1: malformed daily record throws (and buildSnapshot skips it)", () => {
  assert.throws(() => scoreCity({ daily: { time: null }, current: null }));
  const raw = {
    updated_at: "2026-07-23T00:00:00Z", season: "summer",
    cities: {
      "Good, XX": { tier: "active", fetched_at: "x", current: null, daily: goodDaily() },
      "Bad, XX": { tier: "active", fetched_at: "x", current: null, daily: {} },
    },
  };
  const cities = [
    { name: "Good, XX", season_tags: [] },
    { name: "Bad, XX", season_tags: [] },
  ];
  const snap = buildSnapshot(raw, cities);
  assert.equal(snap.cities.length, 1);
  assert.equal(snap._meta.counts.skipped, 1);
});

test("F1b: null temps in daily arrays are filtered, not scored", () => {
  const d = goodDaily();
  d.temperature_2m_max[2] = null;
  d.temperature_2m_min[2] = null;
  const s = scoreCity({ daily: d, current: null });
  assert.equal(s.days.length, 6);
  assert.ok(Number.isFinite(s.combined));
});

test("F2: current object without apparent_temperature never yields NaN", () => {
  const s = scoreCity({ daily: goodDaily(), current: {} });
  assert.ok(Number.isFinite(s.now), `now=${s.now}`);
  assert.ok(Number.isFinite(s.combined), `combined=${s.combined}`);
});

test("F12: on-route point projects near zero even with sparse vertices", () => {
  // Two vertices 5 degrees of longitude apart at the equator; the old
  // vertex-sampling code reported ~69 mi off-route for a point at lon 4.
  const coords = [[0, 0], [5, 0]];
  const cum = cumulative(coords);
  const p = projectOntoRoute({ lat: 0, lon: 4 }, coords, cum);
  assert.ok(p.offMi < 1, `offMi=${p.offMi}`);
  assert.ok(Math.abs(p.mile - cum[1] * 0.8) < 3, `mile=${p.mile}`);
});

test("B1: addDays is pure calendar arithmetic across month/year/DST edges", () => {
  assert.equal(addDays("2026-07-31", 1), "2026-08-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-11-01", 1), "2026-11-02"); // US DST fall-back day
  assert.equal(addDays("2026-07-23", 0), "2026-07-23");
});

test("F12b: pointAtMile interpolates instead of snapping to a vertex", () => {
  const coords = [[0, 0], [2, 0]];
  const cum = cumulative(coords);
  const mid = pointAtMile(coords, cum, cum[1] / 2);
  assert.ok(Math.abs(mid.lon - 1) < 0.02, `lon=${mid.lon}`);
});

test("K1: string-typed upstream numerics are coerced, never NaN a score", () => {
  const d = goodDaily();
  d.precipitation_probability_max = Array(7).fill("35");
  d.wind_speed_10m_max = Array(7).fill("forty");
  d.sunshine_duration = Array(7).fill("oops");
  const s = scoreCity({ daily: d, current: null });
  assert.ok(Number.isFinite(s.now), `now=${s.now}`);
  assert.ok(Number.isFinite(s.week), `week=${s.week}`);
  assert.ok(Number.isFinite(s.combined), `combined=${s.combined}`);
});

test("K1b: one poisoned city cannot empty ties for the whole snapshot", () => {
  const bad = goodDaily();
  bad.snowfall_sum = Array(7).fill("heavy");
  const raw = {
    updated_at: "2026-07-23T00:00:00Z", season: "summer",
    cities: {
      "Good, XX": { tier: "active", fetched_at: "x", current: null, daily: goodDaily() },
      "Poisoned, XX": { tier: "active", fetched_at: "x", current: null, daily: bad },
    },
  };
  const cities = [
    { name: "Good, XX", season_tags: [] },
    { name: "Poisoned, XX", season_tags: [] },
  ];
  const snap = buildSnapshot(raw, cities);
  assert.ok(snap.ties.length >= 1, `ties=${JSON.stringify(snap.ties)}`);
  assert.ok(snap.cities.every((c) => Number.isFinite(c.scores.combined)));
});

test("K2: missing origin anchor yields null nights, never the server clock", () => {
  const w = {
    daily: {
      time: ["2026-07-23", "2026-07-24", "2026-07-25"],
      temperature_2m_max: [80, 82, 84],
      temperature_2m_min: [60, 62, 64],
      precipitation_probability_max: [10, 20, 30],
    },
  };
  // stopoverWeather failed for the origin: no anchor, so no night, even
  // though the stopover element itself is valid and today's date would match.
  assert.equal(nightForLeg(w, null, 0), null);
  // With a real anchor the same element matches by calendar date.
  const night = nightForLeg(w, "2026-07-23", 1);
  assert.equal(night.date, "2026-07-24");
  assert.equal(night.hi, 82);
});

test("K3: freshness has a lower bound; a future timestamp is stale at every layer", () => {
  const now = Date.parse("2026-07-27T12:00:00Z");
  const ttl = 3 * 3600 * 1000;
  assert.equal(freshAge("2026-07-27T11:00:00Z", ttl, now), true);  // 1h old: fresh
  assert.equal(freshAge("2026-07-27T13:00:00Z", ttl, now), false); // 1h ahead: stale
  assert.equal(freshAge("2026-07-27T07:00:00Z", ttl, now), false); // past TTL: stale
  assert.equal(freshAge("garbage", ttl, now), false);
  assert.equal(freshAge(undefined, ttl, now), false);
});
