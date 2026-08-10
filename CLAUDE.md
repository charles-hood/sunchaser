# Sunchaser: notes for Claude sessions

> **Forked or cloned this repo?** These are the original operator's
> (Charles's) environment-specific notes: his deploy target, his key file
> locations, his review process. None of it binds your copy. Start from
> README.md, especially "Forking / hacking on it".

Live at https://sunchaser.rockofpages.com/. Scores live Open-Meteo weather
across the vetted nomad cities (109 since 2026-08-09), ranks
deterministically, an AI model
adjudicates a shortlist (DeepSeek V4 Flash on Fireworks by default,
claude-opus-4-8 via `--deep`), plans Tesla road trips. History: PLAN.md
(original design), README.md (current usage).

## Hard constraints

- **Zero npm dependencies, by design.** Plain Node 22+, no package.json. Do
  not add packages; the frontend is a single self-contained page.
- **Zero per-visitor AI spend.** The web server never calls an AI API; only
  the CLI does, through `callModel` (40-call/day cap enforced in
  `var/counters.json`, all providers combined). Keep it that way.
- **Determinism first.** The scorer ranks; the AI only adjudicates a
  shortlist and must present ties as ties. All scoring weights live in the
  `WEIGHTS` const in `engine/score.js`. The now/week/combined winners are
  precomputed and injected into the prompt as ground truth; `getVerdict`
  rejects (and retries once) a verdict that is truncated at max_tokens,
  breaks the five-section contract, or contradicts them in its week section.

## Commands

- `node cli.js rank | verdict | route --from "City, ST"` (see README)
- `node server/index.js` then http://127.0.0.1:3005
- Tests: `node --test 'test/**/*.test.js'` (a bare `node --test test/`
  misreports a failure; always use the quoted glob)

## Secrets

`FIREWORKS_API_KEY` (default verdict model) and `ANTHROPIC_API_KEY`
(`--deep` only) via `.env` (gitignored; sourced from
`~/fireworks-ai-api-key.txt` and `~/anthropic-api-key.txt`, never echo
values). Production: `/etc/sunchaser.env` on the droplet; the Anthropic key
is shared with lotcheck-pro.

## Deployment

The deploy procedure lives in the reverse-proxy repo
(`/Users/charles/projects/reverse-proxy`, CLAUDE.md "Update Sunchaser"
section): pre-deploy test gate, rsync from `main` HEAD, chown/chmod,
restart, verify /api/health. Per Charles (2026-08-09) sessions here may
deploy by following that procedure exactly. Keep DEPLOY-PROMPT.md accurate
as the standalone description of the app's deploy shape, and keep the
reverse-proxy docs in sync when the shape changes (env vars, egress hosts,
units). Systemd units live there under `sunchaser/`, not here.

## Reviews

Cross-model review rubric is frozen in REVIEW-PROMPT.md (base + three
addenda). Pass 1 (Codex + GLM 5.2) complete, 21 findings fixed. Kimi K3
pass 2 complete: 3 findings plus 1 sibling found via R0, all fixed
(addendum 3, K* tests in `test/regressions.test.js`, see
KIMI-PASS2-FINDINGS.md). Closure stands at zero clean passes: new findings
are only valid if in-rubric or regressions from fixes; two consecutive
clean passes against the frozen rubric terminate the review. 2026-08-09:
the verdict layer moved to Fireworks/DeepSeek with precomputed winners
(engine/verdict.js, engine/config.js); that surface is in scope for the
next pass as change-reachable code. 2026-08-10: same surface changed again
(production truncation fix): truncated/contract-breaking verdicts now
rejected with one retry (sectionsOk, truncated flag in callModel,
unterminated-<think> strip), VERDICT_MAX_TOKENS 4096 -> 8192. Still in
scope for the next pass as change-reachable code; note the retry path can
now fire on three conditions, so the daily-cap interaction (2 calls per
bad verdict) is reachable from more states.

## Parked plans

- ASK-SUNCHASER-PLAN.md: draft plan for a grounded visitor Q&A bot
  (tutor-proxy pattern). Not approved; do not build unless Charles says go.

## Data provenance

- `data/cities.json`: regenerate with `node tools/extract-cities.js` when
  rotation-optimizer's `data/pool.json` changes (the gate-passers; 109
  after the auto-theft hard gate was dropped 2026-08-09).
- `data/superchargers.json`: refresh monthly-ish with
  `node tools/fetch-superchargers.js`.
- `data/rents.json`: refresh monthly with `node tools/fetch-rents.js`
  (Zillow city-level ZORI, pattern borrowed from lotcheck's market
  pipeline). Display-only $/$$/$$$ chips: cost never enters the scores.
  A launchd agent on Charles's Mac (`com.charles.sunchaser-rent-refresh`,
  fires the 18th monthly, installed from `tools/launchd/`) pops a dialog
  when Zillow has a newer month; the refresh itself stays manual: fetch,
  commit, deploy.
