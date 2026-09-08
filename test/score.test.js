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
  // A and B both cap at 100, so the leaders line lists both, A first.
  assert.equal(snap.leaders.combined[0], "A, XX");
  // The frontend's "how scores work" panel renders from _meta.weights;
  // dropping it silently breaks the explainer into its fallback text.
  assert.equal(snap._meta.weights.PRECIP_PROB_SLOPE, 0.25);
  assert.equal(snap._meta.weights.HI_IDEAL_LOW, 68);
});

// Snapshot leaders: exact top holder of each key over the shortlist, in
// combined order. A city can lead "now" (two perfect days) while a hot back
// half of the week keeps it off the combined podium; the leader cards need
// the now/week/combined winners the verdict is built on, not the combined
// top four, so the reader finds a card for the city the verdict just named.
test("buildSnapshot leaders: now-leader with a weak week is still the now-leader", () => {
  const mk = (days) => ({ tier: "active", fetched_at: "x", current: null, daily: fakeDaily(days) });
  const steady = Array(7).fill(day({ precipProb: 40 })); // 95 every day, never the cap
  const spike = [day(), day(), day({ hi: 96 }), day({ hi: 98 }), day({ hi: 100 }), day({ hi: 100 }), day({ hi: 101 })];
  const raw = {
    updated_at: "2026-08-27T00:00:00Z", season: "summer",
    cities: { "Steady, XX": mk(steady), "Spike, XX": mk(spike) },
  };
  const cities = ["Steady, XX", "Spike, XX"].map((name) => ({ name, season_tags: [] }));
  const snap = buildSnapshot(raw, cities);
  assert.equal(snap.cities[0].name, "Steady, XX", "combined leader is the steady city");
  assert.deepEqual(snap.leaders.now, ["Spike, XX"]);
  assert.deepEqual(snap.leaders.week, ["Steady, XX"]);
  assert.deepEqual(snap.leaders.combined, ["Steady, XX"]);
});

test("buildSnapshot leaders: exact ties list every holder in combined order", () => {
  const mk = (days) => ({ tier: "active", fetched_at: "x", current: null, daily: fakeDaily(days) });
  const perfect = Array(7).fill(day());
  const raw = {
    updated_at: "2026-08-27T00:00:00Z", season: "summer",
    cities: { "B, XX": mk(perfect), "A, XX": mk(perfect) },
  };
  const cities = ["B, XX", "A, XX"].map((name) => ({ name, season_tags: [] }));
  const snap = buildSnapshot(raw, cities);
  const order = snap.cities.map((c) => c.name);
  for (const key of ["now", "week", "combined"]) {
    assert.deepEqual(snap.leaders[key], order, `${key} ties follow combined order`);
  }
});

// daySky: NWS-style daytime sky wording from sunFrac, never the worst-hour
// WMO code. A pre-dawn overcast hour (code 3) must not label a sunny day.
const { daySky, precipBand, dewBand } = require("../engine/score");

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

// dewBand: the leader cards report humidity as a dew point, not as relative
// humidity, because RH is a ratio against a temperature that swings all day.
test("dewBand follows the conventional comfort bands at the edges", () => {
  assert.equal(dewBand(49.9), "very dry");
  assert.equal(dewBand(50), "comfortable");
  assert.equal(dewBand(59.9), "comfortable");
  assert.equal(dewBand(60), "noticeable");
  assert.equal(dewBand(64.9), "noticeable");
  assert.equal(dewBand(65), "sticky");
  assert.equal(dewBand(69.9), "sticky");
  assert.equal(dewBand(70), "oppressive");
  assert.equal(dewBand(74.9), "oppressive");
  assert.equal(dewBand(75), "miserable");
  assert.equal(dewBand(-10), "very dry"); // a Yukon January is still a band
});

// The card hides the chip rather than rendering "NaN deg" or "null": a
// dormant-tier record from before dew_point_2m_mean was requested, or one
// upstream field arriving as a string, must degrade to no chip at all.
test("dewBand is null for a missing or non-numeric dew point", () => {
  assert.equal(dewBand(null), null);
  assert.equal(dewBand(undefined), null);
  assert.equal(dewBand(NaN), null);
  assert.equal(dewBand("64"), null);
});

// The Portland, ME case that prompted this: dawn fog put relative humidity at
// 100% on a day whose 79F afternoon was merely a touch humid. The dew point
// the card shows must land in a band that matches the afternoon, not the fog.
test("a fogged-in dawn does not label the day muggy", () => {
  const daily = {
    time: ["2026-08-24"],
    temperature_2m_max: [79.4], temperature_2m_min: [64.7],
    apparent_temperature_max: [82.5], dew_point_2m_mean: [62.5],
    precipitation_probability_max: [5], precipitation_sum: [0], snowfall_sum: [0],
    wind_speed_10m_max: [7], wind_gusts_10m_max: [12], uv_index_max: [6],
    sunshine_duration: [31600], daylight_duration: [48600], weather_code: [45],
  };
  const s = scoreCity({ daily });
  assert.equal(s.days[0].dew, 62.5);
  assert.equal(s.days[0].dewBand, "noticeable");
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
  const a = scoreCity({ daily: { ...daily, dew_point_2m_mean: [51, 68] } });
  assert.deepEqual(a.days.map((d) => d.sky), ["sunny", "showers"]);
  assert.deepEqual(a.days.map((d) => d.precipBand), ["slight", "chance"]);
  assert.deepEqual(a.days.map((d) => d.dewBand), ["comfortable", "sticky"]);
  const b = scoreCity({ daily: { ...daily, weather_code: [0, 0] } });
  assert.deepEqual(a.days.map((d) => d.score), b.days.map((d) => d.score));
  assert.equal(a.week, b.week);
  // Dew point is display context only: swapping it must not move a score.
  const c = scoreCity({ daily: { ...daily, dew_point_2m_mean: [78, 30] } });
  assert.deepEqual(a.days.map((d) => d.score), c.days.map((d) => d.score));
  // A record predating the field still scores, it just has no chip.
  assert.deepEqual(b.days.map((d) => d.dewBand), [null, null]);
});

// 2026-09-07: Klamath Falls won "best all three" on a 68/34 day. The old
// 0.8/deg low penalty (-5.1) was smaller than the uncapped sun bonus (+8.8),
// so a frosty clear day clamped to a perfect 100. Both halves are pinned here.
test("a near-freezing night cannot score a perfect day, however sunny", () => {
  const frosty = dayComfort(day({ hi: 68, lo: 34, appHi: 64, precipProb: 0, sunFrac: 0.95 }));
  const mild = dayComfort(day({ hi: 68, lo: 48, appHi: 64, precipProb: 0, sunFrac: 0.95 }));
  assert.ok(frosty <= 93, `frosty day should lose real points, got ${frosty}`);
  assert.ok(mild - frosty >= 7, `mild ${mild} vs frosty ${frosty}: gap too small`);
});

test("sun bonus is capped: full sun cannot erase a moderate penalty", () => {
  const overcast = dayComfort(day({ precipProb: 40, sunFrac: 0.6 })); // exactly at target
  const brilliant = dayComfort(day({ precipProb: 40, sunFrac: 1.0 }));
  assert.equal(brilliant - overcast, 5, "bonus above target is capped at SUN_BONUS_CAP");
  const gloomy = dayComfort(day({ precipProb: 40, sunFrac: 0.0 }));
  assert.equal(overcast - gloomy, 15, "penalty side is not capped");
});

// 1.2.0: the ideal band is a peak, not a plateau. Under 1.1.0 a dry sunny
// 68/41 day and a dry sunny 76/61 day both clamped to 100, so the scale
// could not say which was nicer; every published comfort index can.
test("peaked curve: a mild 76/61 day outscores a 68/41 day, both clear", () => {
  const mild = dayComfort(day({ hi: 76, lo: 61, appHi: 76, precipProb: 0, sunFrac: 0.95 }));
  const crisp = dayComfort(day({ hi: 68, lo: 41, appHi: 66, precipProb: 0, sunFrac: 0.95 }));
  assert.equal(mild, 100);
  assert.ok(mild - crisp >= 2.5 && crisp >= 93, `68/41 should trail by a few points, got ${crisp}`);
});

test("peaked curve is continuous at the band edges", () => {
  const eps = 0.01;
  for (const edge of [68, 82]) {
    const inside = dayComfort(day({ hi: edge, appHi: edge, precipProb: 40 }));
    const outside = dayComfort(day({ hi: edge + (edge === 68 ? -eps : eps), appHi: edge, precipProb: 40 }));
    assert.ok(Math.abs(inside - outside) < 0.1, `jump at hi=${edge}: ${inside} vs ${outside}`);
  }
  const at50 = dayComfort(day({ lo: 50, precipProb: 40 }));
  const under50 = dayComfort(day({ lo: 50 - eps, precipProb: 40 }));
  const at40 = dayComfort(day({ lo: 40, precipProb: 40 }));
  const under40 = dayComfort(day({ lo: 40 - eps, precipProb: 40 }));
  assert.ok(Math.abs(at50 - under50) < 0.1 && Math.abs(at40 - under40) < 0.1, "no jump in the low curve");
});
