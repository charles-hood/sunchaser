"use strict";
// Deterministic weather scoring. Pure functions only: no I/O, no clock.
// All tunables live in WEIGHTS so "taste" changes are one-diff reviews.

const cfg = require("./config");

const WEIGHTS = {
  // Ideal daily-high band (deg F). Full marks inside; graceful falloff out.
  HI_IDEAL_LOW: 68,
  HI_IDEAL_HIGH: 82,
  HI_COLD_SLOPE: 1.6,      // pts lost per degree below ideal
  HI_HOT_SLOPE: 2.2,       // pts lost per degree above ideal (heat is worse)
  HI_EXTREME_COLD: 50,     // extra slope kicks in below/above these
  HI_EXTREME_HOT: 95,
  HI_EXTREME_SLOPE: 1.5,   // additional pts per degree beyond extreme

  LO_FLOOR: 40,            // overnight lows below this start to hurt
  LO_SLOPE: 0.8,

  MUGGY_GAP: 3,            // appHi - hi above this = humidity penalty
  MUGGY_SLOPE: 2.5,        // pts per degree of apparent-temp excess

  PRECIP_PROB_SLOPE: 0.25, // pts per % of max precip probability
  PRECIP_SUM_SLOPE: 15,    // pts per inch of rain
  PRECIP_SUM_CAP: 25,
  SNOW_SLOPE: 20,          // pts per inch of snow
  SNOW_CAP: 40,

  WIND_FLOOR: 20,          // sustained mph before penalty
  WIND_SLOPE: 1.2,
  GUST_FLOOR: 35,
  GUST_SLOPE: 0.8,

  SUN_TARGET: 0.6,         // sunshine as fraction of daylight; +/- around this
  SUN_SLOPE: 25,           // (frac - target) * slope, so roughly -15..+10

  UV_FLOOR: 9,
  UV_SLOPE: 1.5,

  NOW_TODAY: 0.6,          // NowScore = today + tomorrow
  NOW_TOMORROW: 0.4,
  NOW_NUDGE_MAX: 3,        // current apparent temp vs band, active tier only
  WEEK_DECAY: [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7],
  COMBINED_NOW: 0.45,
  COMBINED_WEEK: 0.55,
};

const SCORING_VERSION = "1.0.0";

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// One forecast day -> 0..100 comfort score.
// day: {hi, lo, appHi, precipProb, precipSum, snow, wind, gust, uv, sunFrac}
function dayComfort(day, W = WEIGHTS) {
  let s = 100;

  if (day.hi < W.HI_IDEAL_LOW) {
    s -= (W.HI_IDEAL_LOW - day.hi) * W.HI_COLD_SLOPE;
    if (day.hi < W.HI_EXTREME_COLD) s -= (W.HI_EXTREME_COLD - day.hi) * W.HI_EXTREME_SLOPE;
  } else if (day.hi > W.HI_IDEAL_HIGH) {
    s -= (day.hi - W.HI_IDEAL_HIGH) * W.HI_HOT_SLOPE;
    if (day.hi > W.HI_EXTREME_HOT) s -= (day.hi - W.HI_EXTREME_HOT) * W.HI_EXTREME_SLOPE;
  }

  if (day.lo < W.LO_FLOOR) s -= (W.LO_FLOOR - day.lo) * W.LO_SLOPE;

  const muggy = (day.appHi ?? day.hi) - day.hi - W.MUGGY_GAP;
  if (muggy > 0) s -= muggy * W.MUGGY_SLOPE;

  s -= (day.precipProb ?? 0) * W.PRECIP_PROB_SLOPE;
  s -= Math.min((day.precipSum ?? 0) * W.PRECIP_SUM_SLOPE, W.PRECIP_SUM_CAP);
  s -= Math.min((day.snow ?? 0) * W.SNOW_SLOPE, W.SNOW_CAP);

  if ((day.wind ?? 0) > W.WIND_FLOOR) s -= (day.wind - W.WIND_FLOOR) * W.WIND_SLOPE;
  if ((day.gust ?? 0) > W.GUST_FLOOR) s -= (day.gust - W.GUST_FLOOR) * W.GUST_SLOPE;

  if (day.sunFrac != null) s += (day.sunFrac - W.SUN_TARGET) * W.SUN_SLOPE;
  if ((day.uv ?? 0) > W.UV_FLOOR) s -= (day.uv - W.UV_FLOOR) * W.UV_SLOPE;

  return clamp(Math.round(s * 10) / 10, 0, 100);
}

// Open-Meteo daily arrays -> per-day objects.
function extractDays(daily) {
  return daily.time.map((date, i) => ({
    date,
    hi: daily.temperature_2m_max[i],
    lo: daily.temperature_2m_min[i],
    appHi: daily.apparent_temperature_max?.[i],
    precipProb: daily.precipitation_probability_max?.[i] ?? 0,
    precipSum: daily.precipitation_sum?.[i] ?? 0,
    snow: daily.snowfall_sum?.[i] ?? 0,
    wind: daily.wind_speed_10m_max?.[i] ?? 0,
    gust: daily.wind_gusts_10m_max?.[i] ?? 0,
    uv: daily.uv_index_max?.[i] ?? 0,
    sunFrac: daily.daylight_duration?.[i]
      ? (daily.sunshine_duration?.[i] ?? 0) / daily.daylight_duration[i]
      : null,
    code: daily.weather_code?.[i],
  }));
}

// One city's raw record -> scores. Throws on malformed records; callers skip.
function scoreCity(rec, W = WEIGHTS) {
  if (!Array.isArray(rec?.daily?.time) || !Array.isArray(rec.daily.temperature_2m_max)) {
    throw new Error("malformed daily block");
  }
  const days = extractDays(rec.daily)
    .filter((d) => Number.isFinite(d.hi) && Number.isFinite(d.lo))
    .map((d) => ({ ...d, score: dayComfort(d, W) }));
  if (!days.length) throw new Error("no usable forecast days");

  let nudge = 0;
  if (rec.current && Number.isFinite(rec.current.apparent_temperature)) {
    const app = rec.current.apparent_temperature;
    const mid = (W.HI_IDEAL_LOW + W.HI_IDEAL_HIGH) / 2;
    nudge = clamp((15 - Math.abs(app - mid)) / 15, -1, 1) * W.NOW_NUDGE_MAX;
  }
  const now = clamp(
    W.NOW_TODAY * days[0].score + W.NOW_TOMORROW * (days[1]?.score ?? days[0].score) + nudge,
    0, 100);

  const decay = W.WEEK_DECAY.slice(0, days.length);
  const wsum = decay.reduce((a, b) => a + b, 0);
  const week = days.reduce((acc, d, i) => acc + d.score * (decay[i] ?? 0), 0) / wsum;

  const combined = W.COMBINED_NOW * now + W.COMBINED_WEEK * week;
  const r1 = (x) => Math.round(x * 10) / 10;
  return { days, now: r1(now), week: r1(week), combined: r1(combined) };
}

// Full raw snapshot + city metadata -> ranked snapshot object.
function buildSnapshot(raw, cities) {
  const scored = [];
  let skipped = 0;
  for (const c of cities) {
    const rec = raw.cities[c.name];
    if (!rec) continue;
    let s;
    try { s = scoreCity(rec); }
    catch { skipped++; continue; } // one malformed record never sinks the snapshot
    scored.push({
      ...c,
      tier: rec.tier,
      fetched_at: rec.fetched_at,
      current: rec.current,
      scores: { now: s.now, week: s.week, combined: s.combined },
      days: s.days,
    });
  }
  scored.sort((a, b) => b.scores.combined - a.scores.combined);

  const leader = scored[0]?.scores.combined ?? 0;
  const ties = scored
    .filter((c) => leader - c.scores.combined <= cfg.TIE_EPSILON)
    .map((c) => c.name);
  const promotions = scored
    .filter((c) => c.tier === "dormant" && leader - c.scores.combined <= cfg.PROMOTE_EPSILON)
    .map((c) => c.name);
  const shortlist = scored
    .filter((c, i) => i < cfg.SHORTLIST_TOP || leader - c.scores.combined <= cfg.SHORTLIST_EPSILON)
    .map((c) => c.name);

  return {
    _meta: {
      generated_at: raw.updated_at,
      season: raw.season,
      scoring_version: SCORING_VERSION,
      tie_epsilon: cfg.TIE_EPSILON,
      counts: { scored: scored.length, skipped, active: scored.filter((c) => c.tier === "active").length },
    },
    ties,
    promotions,
    shortlist,
    cities: scored,
  };
}

module.exports = { WEIGHTS, SCORING_VERSION, dayComfort, extractDays, scoreCity, buildSnapshot };
