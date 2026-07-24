#!/usr/bin/env node
// Snapshot open US Superchargers from supercharge.info into
// data/superchargers.json. Re-run monthly-ish; the network changes slowly.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const URL = "https://supercharge.info/service/supercharge/allSites";
const DEST = path.join(__dirname, "..", "data", "superchargers.json");

(async () => {
  const res = await fetch(URL, { headers: { "User-Agent": "sunchaser/0.1 (personal trip planner)" } });
  if (!res.ok) throw new Error(`supercharge.info HTTP ${res.status}`);
  const sites = await res.json();
  const open = sites
    .filter((s) => s.status === "OPEN" && s.address?.country === "USA" && s.gps)
    .map((s) => ({
      name: s.name,
      city: s.address.city || "",
      state: s.address.state || "",
      lat: s.gps.latitude,
      lon: s.gps.longitude,
      stalls: s.stallCount ?? null,
      kw: s.powerKilowatt ?? null,
    }))
    .sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

  const out = {
    _meta: { source: URL, fetched_at: new Date().toISOString(), count: open.length },
    sites: open,
  };
  fs.writeFileSync(DEST, JSON.stringify(out));
  console.log(`wrote ${DEST}: ${open.length} open US sites`);
})().catch((e) => { console.error(e.message); process.exit(1); });
