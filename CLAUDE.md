# Sunchaser: notes for Claude sessions

Live at https://sunchaser.rockofpages.com/. Scores live Open-Meteo weather
across 108 vetted nomad cities, ranks deterministically, Claude adjudicates a
shortlist, plans Tesla road trips. History: PLAN.md (original design),
README.md (current usage).

## Hard constraints

- **Zero npm dependencies, by design.** Plain Node 22+, no package.json. Do
  not add packages; the frontend is a single self-contained page.
- **Zero per-visitor AI spend.** The web server never calls Anthropic; only
  the CLI does, through `callClaude` (12-call/day cap enforced in
  `var/counters.json`). Keep it that way.
- **Determinism first.** The scorer ranks; the AI only adjudicates a
  shortlist and must present ties as ties. All scoring weights live in the
  `WEIGHTS` const in `engine/score.js`.

## Commands

- `node cli.js rank | verdict | route --from "City, ST"` (see README)
- `node server/index.js` then http://127.0.0.1:3005
- Tests: `node --test 'test/**/*.test.js'` (a bare `node --test test/`
  misreports a failure; always use the quoted glob)

## Secrets

`ANTHROPIC_API_KEY` via `.env` (gitignored; sourced from
`~/anthropic-api-key.txt`, never echo values). Production:
`/etc/sunchaser.env` on the droplet, sharing lotcheck-pro's key.

## Deployment

Charles's webmaster AI owns all droplet deployments (consistency). Never
deploy directly from here: update DEPLOY-PROMPT.md if the shape changes and
hand off. Systemd units live in the reverse-proxy repo under `sunchaser/`.

## Reviews

Cross-model review rubric is frozen in REVIEW-PROMPT.md (base + two
addenda). Pass 1 (Codex + GLM 5.2) complete, 21 findings fixed with
regression tests in `test/regressions.test.js`. Pass 2 closure pending: new
findings are only valid if in-rubric or regressions from fixes; two clean
passes terminate. Confirmed findings get fixed, folded into the rubric, and
regression-tested.

## Data provenance

- `data/cities.json`: regenerate with `node tools/extract-cities.js` when
  rotation-optimizer's `data/pool.json` changes (108 gate-passers).
- `data/superchargers.json`: refresh monthly-ish with
  `node tools/fetch-superchargers.js`.
