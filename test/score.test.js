"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { dayComfort, scoreCity, buildSnapshot } = require("../engine/score");

const day = (over = {}) => ({
  hi: 75, lo: 55, appHi: 75, precipProb: 5, precipSum: 0, snow: 0,
  wind: 8, gust: 15, uv: 6, sunFrac: 0.8, ...over,
});

test("perfect spring day scores high", () => {
  const s = dayComfort(day());
  assert.ok(s >= 85, `expected >=85, got ${s}`);
});

test("phoenix-in-july scores very low", () => {
  const s = dayComfort(day({ hi: 108, lo: 88, appHi: 110, uv: 11, sunFrac: 0.95 }));
  assert.ok(s <= 35, `expected <=35, got ${s}`);
});

test("hot humid gulf day scores low", () => {
  const s = dayComfort(day({ hi: 94, appHi: 105, lo: 78, precipProb: 45, precipSum: 0.3 }));
  assert.ok(s <= 45, `expected <=45, got ${s}`);
});

test("cold snowy day scores near zero", () => {
  const s = dayComfort(day({ hi: 30, lo: 15, appHi: 22, snow: 3, sunFrac: 0.2 }));
  assert.ok(s <= 10, `expected <=10, got ${s}`);
});

test("heat is punished harder than equal cold offset", () => {
  const cold = dayComfort(day({ hi: 58, appHi: 58 })); // 10 below band
  const hot = dayComfort(day({ hi: 92, appHi: 92 }));  // 10 above band
  assert.ok(hot < cold, `hot ${hot} should be < cold ${cold}`);
});

test("rain probability and amount both hurt", () => {
  const dry = dayComfort(day());
  const wet = dayComfort(day({ precipProb: 80, precipSum: 1.2 }));
  assert.ok(dry - wet >= 25, `expected gap >=25, got ${dry - wet}`);
});

function fakeDaily(days) {
  return {
    time: days.map((_, i) => `2026-07-${23 + i}`),
    temperature_2m_max: days.map((d) => d.hi),
    temperature_2m_min: days.map((d) => d.lo),
    apparent_temperature_max: days.map((d) => d.appHi ?? d.hi),
    precipitation_probability_max: days.map((d) => d.precipProb ?? 0),
    precipitation_sum: days.map((d) => d.precipSum ?? 0),
    snowfall_sum: days.map((d) => d.snow ?? 0),
    wind_speed_10m_max: days.map((d) => d.wind ?? 5),
    wind_gusts_10m_max: days.map((d) => d.gust ?? 10),
    uv_index_max: days.map((d) => d.uv ?? 5),
    sunshine_duration: days.map((d) => (d.sunFrac ?? 0.7) * 50000),
    daylight_duration: days.map(() => 50000),
    weather_code: days.map(() => 1),
  };
}

test("scoreCity: worsening week pulls WeekScore below NowScore", () => {
  const days = [day(), day(), day({ hi: 95 }), day({ hi: 98 }),
    day({ hi: 100 }), day({ hi: 100 }), day({ hi: 101 })];
  const s = scoreCity({ daily: fakeDaily(days), current: null });
  assert.ok(s.week < s.now, `week ${s.week} should be < now ${s.now}`);
});

test("buildSnapshot ranks, ties, and promotes correctly", () => {
  const mk = (days) => ({ tier: "active", fetched_at: "x", current: null, daily: fakeDaily(days) });
  const good = Array(7).fill(day());
  const nearlyGood = Array(7).fill(day({ hi: 76, sunFrac: 0.78 }));
  const bad = Array(7).fill(day({ hi: 104, appHi: 108 }));
  const raw = {
    updated_at: "2026-07-23T00:00:00Z", season: "summer",
    cities: { "A, XX": mk(good), "B, XX": mk(nearlyGood), "C, XX": mk(bad) },
  };
  raw.cities["B, XX"].tier = "dormant";
  const cities = ["A, XX", "B, XX", "C, XX"].map((name) => ({ name, season_tags: [] }));
  const snap = buildSnapshot(raw, cities);
  assert.equal(snap.cities[0].name, "A, XX");
  assert.equal(snap.cities[2].name, "C, XX");
  assert.ok(snap.ties.includes("A, XX"));
  assert.ok(snap.ties.includes("B, XX"), "near-equal city should be a formal tie");
  assert.ok(!snap.ties.includes("C, XX"));
  assert.ok(snap.promotions.includes("B, XX"), "dormant near-leader should promote");
  assert.ok(snap.shortlist.length >= 3);
  // The frontend's "how scores work" panel renders from _meta.weights;
  // dropping it silently breaks the explainer into its fallback text.
  assert.equal(snap._meta.weights.PRECIP_PROB_SLOPE, 0.25);
  assert.equal(snap._meta.weights.HI_IDEAL_LOW, 68);
});

// daySky: NWS-style daytime sky wording from sunFrac, never the worst-hour
// WMO code. A pre-dawn overcast hour (code 3) must not label a sunny day.
const { daySky, precipBand } = require("../engine/score");

test("precipBand follows the NWS PoP wording bands", () => {
  assert.equal(precipBand(0), null);
  assert.equal(precipBand(14), null);
  assert.equal(precipBand(15), "slight");
  assert.equal(precipBand(29), "slight");
  assert.equal(precipBand(30), "chance");
  assert.equal(precipBand(59), "chance");
  assert.equal(precipBand(60), "likely");
  assert.equal(precipBand(NaN), null);
});

test("a slight chance highlights the number but leaves the sky glyph alone", () => {
  assert.equal(daySky(day({ sunFrac: 0.94, precipProb: 23, code: 53 })), "sunny");
  assert.equal(precipBand(23), "slight");
});

test("daySky ignores a worst-hour overcast code on a sunny day", () => {
  assert.equal(daySky(day({ sunFrac: 0.97, code: 3, precipProb: 16 })), "sunny");
  assert.equal(daySky(day({ sunFrac: 0.75, code: 51, precipProb: 1, precipSum: 0.004 })), "mostly-sunny");
});

test("daySky maps sunFrac onto the NWS eighths bands at the edges", () => {
  assert.equal(daySky(day({ sunFrac: 0.875 })), "mostly-sunny"); // cloud 1/8 exactly: NWS band is 0 to <1/8
  assert.equal(daySky(day({ sunFrac: 0.876 })), "sunny");
  assert.equal(daySky(day({ sunFrac: 0.874 })), "mostly-sunny");
  assert.equal(daySky(day({ sunFrac: 0.626 })), "mostly-sunny");
  assert.equal(daySky(day({ sunFrac: 0.624 })), "partly-sunny");
  assert.equal(daySky(day({ sunFrac: 0.376 })), "partly-sunny");
  assert.equal(daySky(day({ sunFrac: 0.374 })), "mostly-cloudy");
  assert.equal(daySky(day({ sunFrac: 0.126 })), "mostly-cloudy");
  assert.equal(daySky(day({ sunFrac: 0.124 })), "cloudy");
  assert.equal(daySky(day({ sunFrac: 0 })), "cloudy");
  assert.equal(daySky(day({ sunFrac: 1.3 })), "sunny"); // clamped, never crashes
});

test("daySky shows rain only from the NWS chance band, regardless of sky", () => {
  assert.equal(daySky(day({ sunFrac: 0.95, precipProb: 29 })), "sunny");
  assert.equal(daySky(day({ sunFrac: 0.95, precipProb: 30 })), "showers");
  assert.equal(daySky(day({ sunFrac: 0.95, precipProb: 59 })), "showers");
  assert.equal(daySky(day({ sunFrac: 0.95, precipProb: 60 })), "rain");
});

test("daySky always surfaces snow, thunder and freezing precipitation", () => {
  assert.equal(daySky(day({ sunFrac: 0.95, precipProb: 5, code: 95 })), "thunder");
  assert.equal(daySky(day({ sunFrac: 0.95, precipProb: 5, code: 71 })), "snow");
  assert.equal(daySky(day({ sunFrac: 0.95, precipProb: 5, code: 66 })), "freezing");
  assert.equal(daySky(day({ sunFrac: 0.95, precipProb: 90, code: 85 })), "snow"); // hazard outranks rain
});

test("daySky is null without sunshine data, and non-finite precipProb is 0", () => {
  assert.equal(daySky(day({ sunFrac: null, code: 3 })), null);
  assert.equal(daySky(day({ sunFrac: undefined })), null);
  assert.equal(daySky(day({ sunFrac: 0.9, precipProb: NaN })), "sunny");
});

test("scoreCity attaches sky to every day without touching the scores", () => {
  const daily = {
    time: ["2026-08-23", "2026-08-24"],
    temperature_2m_max: [72, 72], temperature_2m_min: [60, 56],
    apparent_temperature_max: [71, 71], precipitation_probability_max: [16, 45],
    precipitation_sum: [0, 0], snowfall_sum: [0, 0], wind_speed_10m_max: [11, 10],
    wind_gusts_10m_max: [18, 16], uv_index_max: [6.7, 6.6],
    sunshine_duration: [47000, 43000], daylight_duration: [48600, 48400], weather_code: [3, 3],
  };
  const a = scoreCity({ daily });
  assert.deepEqual(a.days.map((d) => d.sky), ["sunny", "showers"]);
  assert.deepEqual(a.days.map((d) => d.precipBand), ["slight", "chance"]);
  const b = scoreCity({ daily: { ...daily, weather_code: [0, 0] } });
  assert.deepEqual(a.days.map((d) => d.score), b.days.map((d) => d.score));
  assert.equal(a.week, b.week);
});
