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
  ACTIVE_TTL_MS: 3 * 3600 * 1000,   // full refresh cadence, active tier
  DORMANT_TTL_MS: 24 * 3600 * 1000, // light refresh cadence, dormant tier
  BACKOFF_MS: [30_000, 120_000, 600_000], // on HTTP 429 / 5xx

  // Promotion rule: dormant city within this many CombinedScore points of the
  // leader gets active-tier treatment for PROMOTE_HOURS.
  PROMOTE_EPSILON: 10,
  PROMOTE_HOURS: 48,

  TIE_EPSILON: 2.0,        // cities within this of the leader are formal ties
  SHORTLIST_TOP: 10,       // top N by CombinedScore go to the AI...
  SHORTLIST_EPSILON: 5,    // ...plus anything within this of the leader

  // Anthropic (verdict layer). Key comes from env only, never from code.
  ANTHROPIC_URL: "https://api.anthropic.com/v1/messages",
  ANTHROPIC_VERSION: "2023-06-01",
  MODELS: { default: "claude-sonnet-5", deep: "claude-opus-4-8" }, // allowlist
  VERDICT_MAX_TOKENS: 2000,
  VERDICT_DAILY_CAP: 12,   // hard cap on paid calls per day

  // Month -> season, mirroring rotation-optimizer's buckets.
  seasonForMonth(m /* 1-12 */) {
    if (m >= 6 && m <= 8) return "summer";
    if (m === 12 || m <= 2) return "winter";
    return "shoulder";
  },
};
