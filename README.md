# Sunchaser

"Go to where the good weather is." Sunchaser scores live weather across the
108 vetted nomad cities from rotation-optimizer, ranks them deterministically,
and has Claude adjudicate and explain the best place to be right now and for
the coming week. See PLAN.md for the full design.

**Live at https://sunchaser.rockofpages.com/** (deployed 2026-07-23; a
systemd timer on the droplet refreshes weather and the verdict every 3 h).

## Usage

```
node cli.js rank             # fetch (honoring cache TTLs), score, print table
node cli.js rank --all       # full 108-city table
node cli.js verdict          # rank + AI verdict (needs ANTHROPIC_API_KEY)
node cli.js verdict --deep   # use the deep model (claude-opus-4-8)
node cli.js route --from "Atlanta, GA" [--to "City, ST"] [--ai]
node cli.js fetch --force    # force a refresh, ignoring TTLs
node server/index.js         # web UI at http://127.0.0.1:3005
node --test 'test/**/*.test.js'
```

Zero dependencies; Node 22+. Weather data by Open-Meteo (free tier, batched,
two-tier seasonal cadence, ~350 location-calls/day in summer). AI verdict via
the Anthropic API (claude-sonnet-5 default), cached on disk and capped at 12
calls/day. Copy `.env.example` to `.env` and add a dedicated key.

## Layout

- `data/cities.json` - the 108 gate-passing cities (regenerate with
  `node tools/extract-cities.js` when rotation-optimizer's pool changes)
- `engine/` - config, fetcher (tiering/cache/backoff), scorer (pure,
  tested), verdict (Claude adjudication)
- `var/` - runtime state, gitignored: raw weather, snapshot, verdict,
  counters, route cache
- `server/` + `public/` - the web app (local: `node server/index.js`)

## Deployment and reviews

Production deploys are owned by Charles's webmaster AI (hand off via
DEPLOY-PROMPT.md; do not deploy directly). Systemd unit files live in the
reverse-proxy repo under `sunchaser/`, not here. Code review runs against
the frozen rubric in REVIEW-PROMPT.md (two-model pass 1 complete, 21
findings fixed; pass 2 closure pending).
