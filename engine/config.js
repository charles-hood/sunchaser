"use strict";
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

module.exports = {
  ROOT,
  CITIES_FILE: path.join(ROOT, "data", "cities.json"),
  VAR_DIR: path.join(ROOT, "var"),
  SNAPSHOT_FILE: path.join(ROOT, "var", "snapshot.json"),
  VERDICT_FILE: path.join(ROOT, "var", "verdict.json"),
  COUNTERS_FILE: path.join(ROOT, "var", "counters.json"),

  OPEN_METEO_URL: "https://api.open-meteo.com/v1/forecast",
  BATCH_SIZE: 22,          // coords per request; keeps URLs short of limits
  BATCH_SLEEP_MS: 1500,    // politeness gap between batches
  ACTIVE_TTL_MS: 3600 * 1000,       // full refresh cadence, active tier (hourly since 2026-08-09)
  DORMANT_TTL_MS: 24 * 3600 * 1000, // light refresh cadence, dormant tier
  BACKOFF_MS: [30_000, 120_000, 600_000], // on HTTP 429 / 5xx

  // Promotion rule: dormant city within this many CombinedScore points of the
  // leader gets active-tier treatment for PROMOTE_HOURS.
  PROMOTE_EPSILON: 10,
  PROMOTE_HOURS: 48,

  TIE_EPSILON: 2.0,        // cities within this of the leader are formal ties
  SHORTLIST_TOP: 10,       // top N by CombinedScore go to the AI...
  SHORTLIST_EPSILON: 5,    // ...plus anything within this of the leader

  // AI verdict layer. Keys come from env/.env only, never from code.
  // provider selects the API shape and key name: anthropic ->
  // ANTHROPIC_API_KEY, fireworks -> FIREWORKS_API_KEY.
  ANTHROPIC_URL: "https://api.anthropic.com/v1/messages",
  ANTHROPIC_VERSION: "2023-06-01",
  FIREWORKS_URL: "https://api.fireworks.ai/inference/v1/chat/completions",
  MODELS: { // allowlist
    default: { provider: "fireworks", id: "accounts/fireworks/models/deepseek-v4-flash-0731" },
    deep: { provider: "anthropic", id: "claude-opus-4-8" },
  },
  VERDICT_MAX_TOKENS: 8192, // DeepSeek spends reasoning tokens inside this budget; a
                            // 4-way tie blew through 4096 on 2026-08-10 (cut mid-"Why")
  VERDICT_DAILY_CAP: 40,   // hard cap on paid calls per day, all providers
                           // (24 hourly timer runs + retries + manual; ~$0.06/day worst case on DeepSeek)

  // Route planner (milestone 5).
  SUPERCHARGERS_FILE: path.join(ROOT, "data", "superchargers.json"),
  OSRM_URL: "https://router.project-osrm.org/route/v1/driving",
  GEOCODE_URL: "https://geocoding-api.open-meteo.com/v1/search",
  ROUTE_CACHE_TTL_MS: 24 * 3600 * 1000,
  VEHICLE: {
    name: "2026 Tesla Model X",
    range_mi: 330,      // rated; correct me if the spec sheet says otherwise
    first_leg_mi: 280,  // morning stretch on a full overnight charge
    leg_cap_mi: 220,    // conservative charge-to-charge planning distance
    max_day_mi: 500,    // driving-day ceiling
    avg_day_hours: 8,   // driving + charging budget per day
  },
  CORRIDOR_MI: 25,      // how far off-route a stopover city may sit
  SC_NEAR_MI: 10,       // stopover must have a supercharger within this
  SC_GAP_WARN_MI: 150,  // warn if consecutive on-route superchargers gap more

  // Month -> season, mirroring rotation-optimizer's buckets.
  seasonForMonth(m /* 1-12 */) {
    if (m >= 6 && m <= 8) return "summer";
    if (m === 12 || m <= 2) return "winter";
    return "shoulder";
  },
};
