#!/usr/bin/env node
"use strict";
// Sunchaser CLI.
//   node cli.js fetch [--force]     refresh weather (honors TTLs)
//   node cli.js rank  [--all]       fetch if due, score, print ranking table
//   node cli.js verdict [--force] [--deep]   rank + AI verdict
const fs = require("node:fs");
const cfg = require("./engine/config");
const { refresh, loadCities, setPromotions } = require("./engine/fetch");
const { buildSnapshot } = require("./engine/score");
const { getVerdict } = require("./engine/verdict");

const args = process.argv.slice(2);
const cmd = args[0] || "rank";
const flag = (f) => args.includes(f);

async function makeSnapshot() {
  const raw = await refresh({ force: flag("--force") });
  const snapshot = buildSnapshot(raw, loadCities());
  fs.mkdirSync(cfg.VAR_DIR, { recursive: true });
  fs.writeFileSync(cfg.SNAPSHOT_FILE, JSON.stringify(snapshot));
  if (snapshot.promotions.length) {
    setPromotions(snapshot.promotions);
    console.error(`promoted to active for ${cfg.PROMOTE_HOURS}h: ${snapshot.promotions.join("; ")}`);
  }
  return snapshot;
}

function printRanking(snapshot, limit) {
  const rows = snapshot.cities.slice(0, limit);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("#", 4) + pad("City", 24) + pad("Now", 7) + pad("Week", 7) +
    pad("Comb", 7) + pad("Hi/Lo", 9) + pad("Rain%", 7) + pad("Tier", 9) + "Cur");
  rows.forEach((c, i) => {
    const d0 = c.days[0];
    const tie = snapshot.ties.includes(c.name) ? "=" : " ";
    console.log(
      pad(`${i + 1}${tie}`, 4) + pad(c.name, 24) +
      pad(c.scores.now, 7) + pad(c.scores.week, 7) + pad(c.scores.combined, 7) +
      pad(`${Math.round(d0.hi)}/${Math.round(d0.lo)}`, 9) +
      pad(d0.precipProb + "%", 7) + pad(c.tier, 9) + (c.curated ? "*" : ""));
  });
  console.log(`\nseason=${snapshot._meta.season}  ties: ${snapshot.ties.join("; ") || "none"}` +
    `\nshortlist for AI: ${snapshot.shortlist.join("; ")}`);
}

(async () => {
  if (cmd === "fetch") {
    await refresh({ force: flag("--force") });
  } else if (cmd === "rank") {
    printRanking(await makeSnapshot(), flag("--all") ? 108 : 20);
  } else if (cmd === "verdict") {
    const snapshot = await makeSnapshot();
    printRanking(snapshot, 10);
    const v = await getVerdict(snapshot, {
      model: flag("--deep") ? "deep" : "default",
      force: flag("--force"),
    });
    console.log(`\n--- Sunchaser verdict (${v.model}, ${v.generated_at}) ---\n`);
    console.log(v.markdown);
  } else {
    console.error("usage: node cli.js fetch|rank|verdict [--force] [--all] [--deep]");
    process.exit(2);
  }
})().catch((e) => { console.error("error:", e.message); process.exit(1); });
