#!/usr/bin/env node
"use strict";
/*
 * fetch-rents.js — regenerate data/rents.json from Zillow's free research data
 * (ZORI, city level). Refresh monthly-ish, like fetch-superchargers.js.
 *
 * Pattern and parsing adapted from lotcheck's vetted market pipeline
 * (reverse-proxy/site-report/tools/build-market-data.js): bulk CSV download,
 * quote-aware splitting, trailing-null walk-back for thinly sampled rows.
 * Zillow research data is free for non-commercial use with attribution; the
 * frontend credits Zillow in the footer.
 *
 * Cost NEVER enters the weather scores. rents.json feeds display-only chips:
 * tier 1/2/3 = cheapest/middle/priciest third of the covered pool ($/$$/$$$),
 * recomputed at every refresh so the tiers drift with the market, not with
 * anyone's opinion.
 *
 *   node tools/fetch-rents.js
 *   ZORI_FILE=/path/city_zori.csv node tools/fetch-rents.js   # reuse a download
 */

const fs = require("node:fs");
const path = require("node:path");

const ZORI_URL = "https://files.zillowstatic.com/research/public_csvs/zori/City_zori_uc_sfrcondomfr_sm_month.csv";
const CITIES = path.join(__dirname, "..", "data", "cities.json");
const OUT = path.join(__dirname, "..", "data", "rents.json");

// Quote-aware CSV line splitter (from lotcheck): metro names like
// "Atlanta-Sandy Springs, GA" are quoted and contain commas.
function splitCSV(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// Latest non-null value walking back from the end (from lotcheck): thin rows
// have trailing nulls, so "the latest number" isn't always the final column.
function latest(vals) {
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return { v: vals[i], i };
  return null;
}

// Zillow spells some names differently; try a few normalizations before
// giving up. Returns the matching key from `index` or null.
function matchName(index, name) {
  if (index.has(name)) return name;
  const alts = [
    name.replace(/^St\. /, "Saint "),
    name.replace(/^Saint /, "St. "),
    name.replace(/'/, "’"),
    name.replace(/’/, "'"),
  ];
  for (const a of alts) if (index.has(a)) return a;
  return null;
}

// tier 1 = cheapest third, 3 = priciest third of the covered cities.
function assignTiers(rents /* {name: rent} */) {
  const entries = Object.entries(rents).sort((a, b) => a[1] - b[1]);
  const n = entries.length;
  const out = {};
  entries.forEach(([name, rent], i) => {
    out[name] = { rent: Math.round(rent), tier: i < n / 3 ? 1 : i < (2 * n) / 3 ? 2 : 3 };
  });
  return out;
}

async function main() {
  const cities = JSON.parse(fs.readFileSync(CITIES, "utf8")).cities.map((c) => c.name);

  let csv;
  if (process.env.ZORI_FILE) {
    csv = fs.readFileSync(process.env.ZORI_FILE, "utf8");
  } else {
    console.error(`downloading ${ZORI_URL} ...`);
    const res = await fetch(ZORI_URL);
    if (!res.ok) throw new Error(`zillow HTTP ${res.status} — source may have moved; see lotcheck's probe-market-sources.js for the re-discovery drill`);
    csv = await res.text();
  }

  const lines = csv.split("\n").filter((l) => l.trim());
  const header = splitCSV(lines[0]);
  const iName = header.indexOf("RegionName");
  const iState = header.indexOf("State");
  const iFirstDate = header.findIndex((h) => /^\d{4}-\d{2}/.test(h));
  if (iName < 0 || iState < 0 || iFirstDate < 0) throw new Error("unexpected ZORI header shape: " + header.slice(0, 10));
  const months = header.slice(iFirstDate);

  // "City, ST" -> row values
  const index = new Map();
  for (let i = 1; i < lines.length; i++) {
    const f = splitCSV(lines[i]);
    index.set(`${f[iName]}, ${f[iState]}`, f.slice(iFirstDate).map((v) => (v === "" ? null : parseFloat(v))));
  }

  const raw = {}, monthsUsed = {}, unmatched = [];
  for (const name of cities) {
    const key = matchName(index, name);
    const hit = key && latest(index.get(key));
    if (!hit) { unmatched.push(name); continue; }
    raw[name] = hit.v;
    monthsUsed[name] = months[hit.i].slice(0, 7);
  }

  const tiers = assignTiers(raw);
  for (const name of Object.keys(tiers)) tiers[name].as_of = monthsUsed[name];

  const out = {
    _meta: {
      source: "Zillow Observed Rent Index (ZORI), city level, smoothed, all homes+multifamily",
      url: ZORI_URL,
      fetched_at: new Date().toISOString(),
      latest_month: months[months.length - 1].slice(0, 7),
      covered: Object.keys(tiers).length,
      cities: cities.length,
      unmatched,
      tiers: "1/2/3 = cheapest/middle/priciest third of covered cities, recomputed each refresh",
    },
    rents: tiers,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.error(`wrote ${OUT}: ${out._meta.covered}/${cities.length} covered` +
    (unmatched.length ? `; no ZORI row for: ${unmatched.join("; ")}` : ""));
}

if (require.main === module) main().catch((e) => { console.error("error:", e.message); process.exit(1); });
module.exports = { splitCSV, latest, assignTiers, matchName };
