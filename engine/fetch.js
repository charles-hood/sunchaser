"use strict";
// Batched Open-Meteo fetcher with seasonal two-tier cadence.
// Active tier (season-matched cities): current + hourly + 7-day daily, 3 h TTL.
// Dormant tier (everyone else): daily block only, 24 h TTL.
// All responses land in var/snapshot-raw.json; fetch() is single-flight and
// honors TTLs, so repeated CLI runs within the window cost zero API calls.

const fs = require("node:fs");
const path = require("node:path");
const cfg = require("./config");

const RAW_FILE = path.join(cfg.VAR_DIR, "snapshot-raw.json");

const DAILY_FIELDS = [
  "weather_code", "temperature_2m_max", "temperature_2m_min",
  "apparent_temperature_max", "apparent_temperature_min",
  "precipitation_sum", "precipitation_probability_max", "snowfall_sum",
  "wind_speed_10m_max", "wind_gusts_10m_max", "uv_index_max",
  "sunshine_duration", "daylight_duration", "sunrise", "sunset",
].join(",");
const HOURLY_FIELDS = [
  "temperature_2m", "dew_point_2m", "precipitation_probability", "cloud_cover",
].join(",");
const CURRENT_FIELDS = [
  "temperature_2m", "apparent_temperature", "relative_humidity_2m",
  "weather_code", "wind_speed_10m", "wind_gusts_10m", "is_day",
].join(",");
const UNITS =
  "temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch" +
  "&timezone=auto&forecast_days=7";

function loadCities() {
  return JSON.parse(fs.readFileSync(cfg.CITIES_FILE, "utf8")).cities;
}

function loadRaw() {
  try { return JSON.parse(fs.readFileSync(RAW_FILE, "utf8")); }
  catch { return { cities: {}, promotions: {} }; }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function buildUrl(cities, full) {
  const lat = cities.map((c) => c.lat).join(",");
  const lon = cities.map((c) => c.lon).join(",");
  let url = `${cfg.OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}` +
    `&daily=${DAILY_FIELDS}&${UNITS}`;
  if (full) url += `&current=${CURRENT_FIELDS}&hourly=${HOURLY_FIELDS}&forecast_hours=48`;
  return url;
}

async function fetchBatch(cities, full, log) {
  const url = buildUrl(cities, full);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "sunchaser/0.1" } });
    if (res.ok) {
      const body = await res.json();
      return Array.isArray(body) ? body : [body]; // single-coord responses aren't arrays
    }
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= cfg.BACKOFF_MS.length) {
      throw new Error(`open-meteo HTTP ${res.status} (batch of ${cities.length})`);
    }
    const wait = cfg.BACKOFF_MS[attempt];
    log(`HTTP ${res.status}, backing off ${wait / 1000}s`);
    await sleep(wait);
  }
}

// Lower-bounded freshness: a corrupt, missing, or FUTURE timestamp is stale,
// never fresh. Every TTL layer (raw records, scored snapshot, route cache)
// shares this one predicate.
const freshAge = (iso, ttlMs, now = Date.now()) => {
  const age = now - Date.parse(iso);
  return Number.isFinite(age) && age >= 0 && age <= ttlMs;
};

// Decide each city's tier for this run. `promoted` names get active treatment.
function tierCities(cities, now, promotions) {
  const season = cfg.seasonForMonth(now.getUTCMonth() + 1);
  const promoted = new Set(
    Object.entries(promotions)
      .filter(([, until]) => Date.parse(until) > now.getTime())
      .map(([name]) => name),
  );
  const active = [], dormant = [];
  for (const c of cities) {
    (c.season_tags.includes(season) || promoted.has(c.name) ? active : dormant).push(c);
  }
  return { season, active, dormant };
}

// Refresh anything past its TTL. Returns the merged raw snapshot.
async function refresh({ force = false, log = console.error } = {}) {
  fs.mkdirSync(cfg.VAR_DIR, { recursive: true });
  const lockFile = path.join(cfg.VAR_DIR, "fetch.lock");
  let lockFd;
  try {
    lockFd = fs.openSync(lockFile, "wx"); // single-flight
  } catch {
    // A crashed process can orphan the lock; reclaim it once it is older
    // than any plausible in-flight refresh.
    let stale = true;
    try { stale = Date.now() - fs.statSync(lockFile).mtimeMs > 10 * 60 * 1000; } catch {}
    if (!stale) throw new Error("another fetch is in progress (var/fetch.lock exists)");
    try { fs.unlinkSync(lockFile); } catch {}
    lockFd = fs.openSync(lockFile, "wx"); // still throws if we lost the reclaim race
  }
  try {
    const cities = loadCities();
    const raw = loadRaw();
    const now = new Date();
    const { season, active, dormant } = tierCities(cities, now, raw.promotions || {});

    const due = (c, ttl) => {
      const prev = raw.cities[c.name];
      if (force || !prev) return true;
      // A dormant record satisfies an active slot only if it also has current
      // data; tier upgrades therefore force a refetch.
      if (ttl === cfg.ACTIVE_TTL_MS && !prev.current) return true;
      // A corrupt or future timestamp must mean "refetch", never "fresh forever".
      return !freshAge(prev.fetched_at, ttl, now.getTime());
    };
    const activeDue = active.filter((c) => due(c, cfg.ACTIVE_TTL_MS));
    const dormantDue = dormant.filter((c) => due(c, cfg.DORMANT_TTL_MS));

    let calls = 0;
    for (const [list, full] of [[activeDue, true], [dormantDue, false]]) {
      for (let i = 0; i < list.length; i += cfg.BATCH_SIZE) {
        const batch = list.slice(i, i + cfg.BATCH_SIZE);
        if (calls > 0) await sleep(cfg.BATCH_SLEEP_MS);
        log(`fetching ${full ? "active" : "dormant"} batch: ${batch.length} cities`);
        const results = await fetchBatch(batch, full, log);
        if (results.length !== batch.length) {
          throw new Error(`expected ${batch.length} results, got ${results.length}`);
        }
        batch.forEach((c, j) => {
          // A null or daily-less element skips just that city (keeping any
          // stale record) instead of crashing the whole refresh.
          if (!results[j]?.daily) return;
          raw.cities[c.name] = {
            tier: full ? "active" : "dormant",
            fetched_at: now.toISOString(),
            utc_offset_seconds: results[j].utc_offset_seconds,
            current: results[j].current || null,
            hourly: results[j].hourly || null,
            daily: results[j].daily,
          };
        });
        calls++;
      }
    }

    // Keep stored tier labels in sync with the current season and promotions
    // even for cities that weren't due this run. Data richness is tracked by
    // the presence of `current`, not by this label.
    for (const c of active) if (raw.cities[c.name]) raw.cities[c.name].tier = "active";
    for (const c of dormant) if (raw.cities[c.name]) raw.cities[c.name].tier = "dormant";

    raw.season = season;
    raw.updated_at = now.toISOString();
    // Merge promotions written by another process while we were fetching,
    // so a slow refresh can't clobber them.
    try {
      const disk = JSON.parse(fs.readFileSync(RAW_FILE, "utf8"));
      raw.promotions = { ...disk.promotions, ...raw.promotions };
    } catch {}
    fs.writeFileSync(RAW_FILE, JSON.stringify(raw));
    log(`season=${season} active=${active.length} dormant=${dormant.length} ` +
        `fetched=${activeDue.length + dormantDue.length} requests=${calls}`);
    return raw;
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lockFile);
  }
}

// Record promotions (called by the scorer once scores exist).
function setPromotions(names, hours = cfg.PROMOTE_HOURS) {
  const raw = loadRaw();
  raw.promotions = raw.promotions || {};
  const until = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const kept = {};
  for (const [name, ts] of Object.entries(raw.promotions)) {
    if (Date.parse(ts) > Date.now()) kept[name] = ts; // drop expired
  }
  for (const n of names) kept[n] = until;
  raw.promotions = kept;
  fs.writeFileSync(RAW_FILE, JSON.stringify(raw));
  return kept;
}

module.exports = { refresh, loadCities, loadRaw, setPromotions, tierCities, freshAge, RAW_FILE };
