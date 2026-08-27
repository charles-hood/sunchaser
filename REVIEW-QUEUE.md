# REVIEW-QUEUE: dated review log and change-reachable surfaces

What this is: the "## Reviews" log that used to live in CLAUDE.md, moved here
verbatim on 2026-08-25 (scaffolding audit SC-1). CLAUDE.md now holds only the
four summary lines; this file is the queue of change-reachable surfaces for
the next pass, plus the dated record of what changed and when. The rubric
itself stays frozen in REVIEW-PROMPT.md. Append new entries at the bottom.

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
bad verdict) is reachable from more states. Later on 2026-08-10 the
SYSTEM prompt was reworked (tie claims scoped per-key to the
Deterministic leaders line, fixing the combined-vs-week conflation nit;
selectivity over stat dumps; ~250-word budget; Why = ranking mechanics
only). The prompt text is change-reachable for the next pass alongside
the validation code. 2026-08-23: week-strip icons moved off Open-Meteo's
worst-hour daily weather_code onto `daySky` in engine/score.js (NWS
sky-cover bands over sunFrac, rain glyph at the NWS 30%/60% bands, snow/
thunder/ice always) plus `precipBand` (slight 15%+, chance 30%+, likely
60%+) which only tints the rain percentage; display-only, scores
untouched. Change-reachable: the `sky` and `precipBand` fields on snapshot
days and the SKY/POP tables in public/index.html. Same day, later: daily
social card (engine/og.js builds SVG from the snapshot, engine/ttf.js
measures text from the vendored TTFs, rsvg-convert rasterizes to
var/og.png; `node cli.js og`, also run by `verdict` once per forecast day).
server/index.js serves var/og.png at /og.png and stamps `?d=<date>` into
index.html's og:image; Caddy proxies `/`, `/og.png` and `/api/*` to Node
for that reason. Change-reachable for the next pass: the SVG/text escaping
(city names reach the SVG), the rsvg child-process call, the new Caddy
matcher, and the verdict path now calling refreshOg (wrapped; must never
break a verdict run). 2026-08-24: the leader cards report humidity as a
dew point instead of relative humidity. RH came from the `current` block,
so an 8 am refresh froze coastal cities at 100% (dawn fog: air cooled to
its dew point) on days whose afternoons were merely mild, reading as a
contradiction next to a sunny 79 deg high. Now `dew_point_2m_mean` is
requested in DAILY_FIELDS (both tiers, all 7 days) and `dewBand` in
engine/score.js labels it with the conventional NWS comfort wording;
display only, scores untouched. Change-reachable: the `dew` and `dewBand`
fields on snapshot days and the DEW table plus the card chip in
public/index.html. Note the chip no longer depends on `current`, so it
renders for dormant-tier cities too, and a cached pre-2026-08-24 record
has no dew point until its TTL expires (dewBand null, chip hidden).
2026-08-27: the leader cards no longer show the combined top four. Charles
caught the gap: the verdict opened with "Pittsburgh is the single best city
for today" (now 100) while Pittsburgh sat at combined #10 (week 91.4, heat
building to 95 deg F) and had no card. `buildSnapshot` now publishes
`leaders` (exact top holder(s) of now/week/combined over the shortlist, in
combined order; same rule as `scoreLeaders` in engine/verdict.js, which
still computes its own copy) and `leaderCards` in public/index.html picks
the now-leader, the week-leader, then fills to four from combined order,
deduped; the week strips follow the same set, and a green "best now/week/
combined" badge says why a card is there. A snapshot without `leaders`
degrades to the combined top four. Change-reachable: the `leaders` field,
`leaderCards`/`leadBadge`, the badge and `.cbadges` wrap CSS. Known edge,
pre-existing: leaders are computed over the shortlist (top 10 + 5-point
band), so a city outside it with the top now score is neither named by the
verdict nor carded; the table still shows it. engine/og.js still uses the
combined top three for the social card.
