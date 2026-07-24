# Sunchaser

"Go to where the good weather is." Sunchaser scores live weather across the
108 vetted nomad cities from rotation-optimizer, ranks them deterministically,
and has Claude adjudicate and explain the best place to be right now and for
the coming week. See PLAN.md for the full design.

## Usage

```
node cli.js rank             # fetch (honoring cache TTLs), score, print table
node cli.js rank --all       # full 108-city table
node cli.js verdict          # rank + AI verdict (needs ANTHROPIC_API_KEY)
node cli.js verdict --deep   # use the deep model (claude-opus-4-8)
node cli.js fetch --force    # force a refresh, ignoring TTLs
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
- `var/` - runtime state, gitignored: raw weather, snapshot, verdict, counters
- Milestones 5-7 (route planner, frontend, droplet deploy) are planned in
  PLAN.md and not yet built.
