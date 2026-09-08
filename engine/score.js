"use strict";
// Deterministic weather scoring. Pure functions only: no I/O, no clock.
// All tunables live in WEIGHTS so "taste" changes are one-diff reviews.

const cfg = require("./config");

const WEIGHTS = {
  // Daily high (deg F): a peaked curve, not a flat band. Comfort indices
  // (UTCI "no thermal stress" ~48-79F; Mieczkowski's Tourism Climate Index
  // optimum ~68-80F for light outdoor activity) all peak once and fall off
  // both ways; a flat 68-82 band asserted that 68 and 76 are equally
  // pleasant, which let a 68/34 day tie a 76/61 day (2026-09-07). Full
  // marks only at HI_PEAK; gentle loss inside the band, the steeper slopes
  // outside it stack on top so the curve stays continuous.
  HI_PEAK: 78,             // warm end of the published optimum: this app chases sun, not shade
  HI_BAND_SLOPE: 0.5,      // pts per degree from the peak, inside the band
  HI_IDEAL_LOW: 68,        // band edges: the steeper slopes begin here
  HI_IDEAL_HIGH: 82,
  HI_COLD_SLOPE: 1.6,      // pts lost per degree below the band
  HI_HOT_SLOPE: 2.2,       // pts lost per degree above the band (heat is worse)
  HI_EXTREME_COLD: 50,     // extra slope kicks in below/above these
  HI_EXTREME_HOT: 95,
  HI_EXTREME_SLOPE: 1.5,   // additional pts per degree beyond extreme

  // Overnight low: free at LO_IDEAL and above (the UTCI comfort zone bottoms
  // out near 48-50F), a soft slope down to LO_FLOOR, then steep. Until
  // 2026-09-07 lows above 40 were free and a 34F night cost 5 pts, which
  // the uncapped sun bonus paid back.
  LO_IDEAL: 50,
  LO_SOFT_SLOPE: 0.5,      // pts per degree from LO_IDEAL down to LO_FLOOR
  LO_FLOOR: 40,            // steep slope begins here (stacks on the soft loss)
  LO_SLOPE: 1.5,
  LO_EXTREME_COLD: 36,     // frost territory: extra slope below this
  LO_EXTREME_SLOPE: 1.5,

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
  SUN_SLOPE: 25,           // (frac - target) * slope, so roughly -15..+10 before the cap
  SUN_BONUS_CAP: 5,        // sun is a tiebreaker among comfortable days, not a refund for cold nights

  UV_FLOOR: 9,
  UV_SLOPE: 1.5,

  NOW_TODAY: 0.6,          // NowScore = today + tomorrow
  NOW_TOMORROW: 0.4,
  NOW_NUDGE_MAX: 3,        // current apparent temp vs band, active tier only
  WEEK_DECAY: [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7],
  COMBINED_NOW: 0.45,
  COMBINED_WEEK: 0.55,
};

const SCORING_VERSION = "1.2.0";

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// One forecast day -> 0..100 comfort score.
// day: {hi, lo, appHi, precipProb, precipSum, snow, wind, gust, uv, sunFrac}
function dayComfort(day, W = WEIGHTS) {
  let s = 100;

  // Inside the band the loss is measured from the peak; outside it the band
  // loss is frozen at the edge and the steeper slopes add to it.
  const bandHi = clamp(day.hi, W.HI_IDEAL_LOW, W.HI_IDEAL_HIGH);
  s -= Math.abs(bandHi - W.HI_PEAK) * W.HI_BAND_SLOPE;
  if (day.hi < W.HI_IDEAL_LOW) {
    s -= (W.HI_IDEAL_LOW - day.hi) * W.HI_COLD_SLOPE;
    if (day.hi < W.HI_EXTREME_COLD) s -= (W.HI_EXTREME_COLD - day.hi) * W.HI_EXTREME_SLOPE;
  } else if (day.hi > W.HI_IDEAL_HIGH) {
    s -= (day.hi - W.HI_IDEAL_HIGH) * W.HI_HOT_SLOPE;
    if (day.hi > W.HI_EXTREME_HOT) s -= (day.hi - W.HI_EXTREME_HOT) * W.HI_EXTREME_SLOPE;
  }

  if (day.lo < W.LO_IDEAL) {
    s -= (W.LO_IDEAL - Math.max(day.lo, W.LO_FLOOR)) * W.LO_SOFT_SLOPE;
    if (day.lo < W.LO_FLOOR) {
      s -= (W.LO_FLOOR - day.lo) * W.LO_SLOPE;
      if (day.lo < W.LO_EXTREME_COLD) s -= (W.LO_EXTREME_COLD - day.lo) * W.LO_EXTREME_SLOPE;
    }
  }

  const muggy = (day.appHi ?? day.hi) - day.hi - W.MUGGY_GAP;
  if (muggy > 0) s -= muggy * W.MUGGY_SLOPE;

  s -= (day.precipProb ?? 0) * W.PRECIP_PROB_SLOPE;
  s -= Math.min((day.precipSum ?? 0) * W.PRECIP_SUM_SLOPE, W.PRECIP_SUM_CAP);
  s -= Math.min((day.snow ?? 0) * W.SNOW_SLOPE, W.SNOW_CAP);

  if ((day.wind ?? 0) > W.WIND_FLOOR) s -= (day.wind - W.WIND_FLOOR) * W.WIND_SLOPE;
  if ((day.gust ?? 0) > W.GUST_FLOOR) s -= (day.gust - W.GUST_FLOOR) * W.GUST_SLOPE;

  if (day.sunFrac != null) s += Math.min((day.sunFrac - W.SUN_TARGET) * W.SUN_SLOPE, W.SUN_BONUS_CAP);
  if ((day.uv ?? 0) > W.UV_FLOOR) s -= (day.uv - W.UV_FLOOR) * W.UV_SLOPE;

  return clamp(Math.round(s * 10) / 10, 0, 100);
}

// A schema-violating upstream value (a string where a number belongs) falls
// back instead of entering arithmetic: one bad field must never NaN a score
// and, through the leader, empty the whole snapshot's ties.
const num = (v, fb) => (Number.isFinite(v) ? v : fb);

// Open-Meteo daily arrays -> per-day objects. hi/lo stay raw on purpose:
// scoreCity's finiteness filter drops those days entirely.
function extractDays(daily) {
  return daily.time.map((date, i) => ({
    date,
    hi: daily.temperature_2m_max[i],
    lo: daily.temperature_2m_min[i],
    appHi: num(daily.apparent_temperature_max?.[i], null),
    dew: num(daily.dew_point_2m_mean?.[i], null),
    precipProb: num(daily.precipitation_probability_max?.[i], 0),
    precipSum: num(daily.precipitation_sum?.[i], 0),
    snow: num(daily.snowfall_sum?.[i], 0),
    wind: num(daily.wind_speed_10m_max?.[i], 0),
    gust: num(daily.wind_gusts_10m_max?.[i], 0),
    uv: num(daily.uv_index_max?.[i], 0),
    sunFrac: num(daily.daylight_duration?.[i], 0) > 0
      ? num(daily.sunshine_duration?.[i], 0) / daily.daylight_duration[i]
      : null,
    code: daily.weather_code?.[i],
  }));
}

// Day-summary label for display. Open-Meteo's daily weather_code is the
// MOST SEVERE hour of the 24, so one overcast hour before dawn labels a
// sunny day "Overcast"; that is not what a day glyph means to a reader.
// Instead, mirror how NWS words a daytime period: sky from the fraction of
// daylight with direct sun (the same sunFrac the scorer uses), mapped onto
// the NWS sky-cover bands in eighths of cloud (sunny 0-1/8, mostly sunny
// 1/8-3/8, partly sunny 3/8-5/8, mostly cloudy 5/8-7/8, cloudy 7/8-8/8);
// rain shown at the NWS "chance" band (30%+) and "likely" band (60%+);
// snow, thunder and freezing precipitation always shown, since a hazard at
// any hour is worth the whole day's glyph. Nothing here feeds the scores.
// NWS probability-of-precipitation wording bands: slight chance 15-29%,
// chance 30-59%, likely 60%+. "slight" never changes the sky glyph (the
// daily PoP is a 24 h max and would paint dry days wet); the UI highlights
// the percentage instead, so a slight-chance day does not read as flawless.
function precipBand(pop) {
  const p = num(pop, 0);
  if (p >= 60) return "likely";
  if (p >= 30) return "chance";
  if (p >= 15) return "slight";
  return null;
}
// Humidity as a reader can act on it. Relative humidity is a ratio against a
// temperature that moves all day, so a fine 79 deg F afternoon reads 100% at
// dawn purely because the air cooled to its dew point (that is fog, not
// misery) and 54% by 2 pm with the same moisture in the air. Dew point is the
// moisture itself: it barely moves between morning and afternoon, so one
// number describes the whole day honestly. Open-Meteo's daily mean tracks the
// noon-to-6 pm median within ~2 deg F across the field, while the daily MAX
// carries exactly the pre-dawn saturation spike this replaces. Bands are the
// conventional NWS comfort wording. Display only: nothing here feeds a score,
// which still reads humidity through the apparent-temp gap (MUGGY_GAP).
function dewBand(dew) {
  if (!Number.isFinite(dew)) return null;
  if (dew < 50) return "very dry";
  if (dew < 60) return "comfortable";
  if (dew < 65) return "noticeable";
  if (dew < 70) return "sticky";
  if (dew < 75) return "oppressive";
  return "miserable";
}

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const FREEZING_CODES = new Set([56, 57, 66, 67]);
function daySky(d) {
  const code = d.code;
  if (code === 95 || code === 96 || code === 99) return "thunder";
  if (SNOW_CODES.has(code)) return "snow";
  if (FREEZING_CODES.has(code)) return "freezing";
  const band = precipBand(d.precipProb);
  if (band === "likely") return "rain";
  if (band === "chance") return "showers";
  if (!Number.isFinite(d.sunFrac)) return null;
  const cloud = 1 - clamp(d.sunFrac, 0, 1);
  if (cloud < 1 / 8) return "sunny";
  if (cloud < 3 / 8) return "mostly-sunny";
  if (cloud < 5 / 8) return "partly-sunny";
  if (cloud < 7 / 8) return "mostly-cloudy";
  return "cloudy";
}

// One city's raw record -> scores. Throws on malformed records; callers skip.
function scoreCity(rec, W = WEIGHTS) {
  if (!Array.isArray(rec?.daily?.time) || !Array.isArray(rec.daily.temperature_2m_max)) {
    throw new Error("malformed daily block");
  }
  const days = extractDays(rec.daily)
    .filter((d) => Number.isFinite(d.hi) && Number.isFinite(d.lo))
    .map((d) => ({
      ...d,
      sky: daySky(d),
      precipBand: precipBand(d.precipProb),
      dewBand: dewBand(d.dew),
      score: dayComfort(d, W),
    }));
  if (!days.length) throw new Error("no usable forecast days");

  let nudge = 0;
  if (rec.current && Number.isFinite(rec.current.apparent_temperature)) {
    const app = rec.current.apparent_temperature;
    nudge = clamp((15 - Math.abs(app - W.HI_PEAK)) / 15, -1, 1) * W.NOW_NUDGE_MAX;
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
  const leaders = scoreLeaders(scored, shortlist);

  return {
    _meta: {
      generated_at: raw.updated_at,
      season: raw.season,
      scoring_version: SCORING_VERSION,
      tie_epsilon: cfg.TIE_EPSILON,
      counts: { scored: scored.length, skipped, active: scored.filter((c) => c.tier === "active").length },
      // The frontend's "how scores work" panel renders from these live
      // values so the explainer can never drift from the actual weights.
      weights: WEIGHTS,
    },
    ties,
    promotions,
    shortlist,
    leaders,
    cities: scored,
  };
}

// Exact top holder(s) of each score key, over the shortlist, in combined
// order (so [0] is the highest-ranked among exact ties). The same rule the
// verdict narrates from (engine/verdict.js scoreLeaders), published on the
// snapshot so the leader cards can show the same three cities the verdict
// leads with: a now-leader with a weak week can sit outside the combined
// top four, and a reader who has just been told "X is best right now" then
// finds no card for X.
function scoreLeaders(scored, shortlist) {
  const pool = scored.filter((c) => shortlist.includes(c.name));
  const out = {};
  for (const key of ["now", "week", "combined"]) {
    const top = Math.max(...pool.map((c) => c.scores[key]));
    out[key] = pool.filter((c) => c.scores[key] === top).map((c) => c.name);
  }
  return out;
}

module.exports = { WEIGHTS, SCORING_VERSION, dayComfort, daySky, precipBand, dewBand, extractDays, scoreCity, buildSnapshot };
