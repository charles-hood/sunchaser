#!/usr/bin/env node
// Extract the gate-passing city universe from rotation-optimizer's pool.json
// into data/cities.json. Re-runnable; run whenever the pool changes.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SOURCE = process.argv[2] ||
  "/Users/charles/Projects/seasonal-rotation/rotation-optimizer/data/pool.json";
const DEST = path.join(__dirname, "..", "data", "cities.json");

function pick(c, curated) {
  // seasons_all carries per-season 0-100 factor scores; scene/services are
  // season-invariant in practice, so take them from any season present.
  const anySeason = Object.values(c.seasons_all || c.seasons || {})[0] || {};
  return {
    name: c.name,
    state: c.state,
    lat: c.lat,
    lon: c.lon,
    pop: c.pop,
    metro_pop: c.metro_pop,
    season_tags: c.season_tags,
    warm_winter: !!c.warm_winter,
    no_income_tax: !!c.no_income_tax,
    scene: anySeason.scene ?? null,
    services: anySeason.services ?? null,
    curated,
  };
}

const raw = fs.readFileSync(SOURCE);
const poolData = JSON.parse(raw);
const cities = [
  ...poolData.pool.map((c) => pick(c, true)),
  ...poolData.dropped_eligible.map((c) => pick(c, false)),
].sort((a, b) => a.name.localeCompare(b.name));

const dupes = cities.filter((c, i) => cities.findIndex((x) => x.name === c.name) !== i);
if (dupes.length) throw new Error("duplicate city names: " + dupes.map((c) => c.name));
for (const c of cities) {
  if (!c.name || !Number.isFinite(c.lat) || !Number.isFinite(c.lon) || !Array.isArray(c.season_tags)) {
    throw new Error("bad city record: " + JSON.stringify(c));
  }
}

const out = {
  _meta: {
    source: SOURCE,
    source_sha256: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16),
    source_mtime: fs.statSync(SOURCE).mtime.toISOString(),
    extracted_at: new Date().toISOString(),
    counts: {
      total: cities.length,
      curated: cities.filter((c) => c.curated).length,
      by_season: {
        summer: cities.filter((c) => c.season_tags.includes("summer")).length,
        winter: cities.filter((c) => c.season_tags.includes("winter")).length,
        shoulder: cities.filter((c) => c.season_tags.includes("shoulder")).length,
      },
    },
  },
  cities,
};

fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.writeFileSync(DEST, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${DEST}: ${cities.length} cities`, out._meta.counts);
