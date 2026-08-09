# Sunchaser

"Go to where the good weather is." Sunchaser scores live weather across the
vetted nomad cities from rotation-optimizer (currently 109), ranks them
deterministically, and has an AI model adjudicate and explain the best place
to be right now and for the coming week. See PLAN.md for the full design.

**Live at https://sunchaser.rockofpages.com/** (deployed 2026-07-23; a
systemd timer on the droplet refreshes weather and the verdict hourly).

## Usage

```
node cli.js rank             # fetch (honoring cache TTLs), score, print table
node cli.js rank --all       # full every-city table
node cli.js verdict          # rank + AI verdict (needs FIREWORKS_API_KEY)
node cli.js verdict --deep   # deep model (claude-opus-4-8, needs ANTHROPIC_API_KEY)
node cli.js route --from "Atlanta, GA" [--to "City, ST"] [--ai]
node cli.js fetch --force    # force a refresh, ignoring TTLs
node server/index.js         # web UI at http://127.0.0.1:3005
node --test 'test/**/*.test.js'
```

Zero dependencies; Node 22+. Weather data by Open-Meteo (free tier, batched,
two-tier cadence: active hourly, dormant daily; ~1,200 location-calls/day in
summer). AI verdict via the Fireworks API (DeepSeek V4 Flash default,
~$0.001/verdict; the Anthropic API serves `--deep`), cached on disk and
capped at 40 calls/day across all providers. The scorer precomputes the now/week/combined winners and injects
them into the prompt as ground truth; the model narrates, it never re-derives
them. Copy `.env.example` to `.env` and add dedicated keys.

## Layout

- `data/cities.json` - the gate-passing cities (regenerate with
  `node tools/extract-cities.js` when rotation-optimizer's pool changes)
- `data/rents.json` - typical rents (Zillow city ZORI; refresh monthly-ish
  with `node tools/fetch-rents.js`). Feeds display-only $/$$/$$$ cost chips,
  pool-relative terciles; cost never enters the weather scores.
- `engine/` - config, fetcher (tiering/cache/backoff), scorer (pure,
  tested), verdict (AI adjudication)
- `var/` - runtime state, gitignored: raw weather, snapshot, verdict,
  counters, route cache
- `server/` + `public/` - the web app (local: `node server/index.js`)

## Deployment and reviews

Production deploys are owned by Charles's webmaster AI (hand off via
DEPLOY-PROMPT.md; do not deploy directly). Systemd unit files live in the
reverse-proxy repo under `sunchaser/`, not here. Code review runs against
the frozen rubric in REVIEW-PROMPT.md (two-model pass 1 complete, 21
findings fixed; pass 2 closure pending).
