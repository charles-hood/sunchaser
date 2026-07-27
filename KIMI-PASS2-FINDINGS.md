# Sunchaser: Kimi K3 pass-2 findings and remediation handoff

**Provenance.** Cross-model review pass 2, run by Kimi K3 against the frozen
rubric in `REVIEW-PROMPT.md` (base + addendum 1 + addendum 2), using
`KIMI-PASS2-PROMPT.md`. Prior passes: Codex and GLM 5.2 (pass 1, 21 findings
fixed, regression surface in `test/regressions.test.js`).

**Baseline.** Kimi reported `node --test 'test/**/*.test.js'` green at 14/14 on
HEAD `6d17cce`. Re-confirm before touching anything.

**Kimi's own verdict.** 20/20 rubric items meet at HEAD. Three findings: one
should-fix, two nits, all self-labeled low confidence. No addendum item
regressed.

**Verification status.** Everything below marked "verified" was read directly
against HEAD in the review session by Claude Opus 5, independently of Kimi's
report. Items marked "not re-verified" are Kimi's claims I did not check
myself; treat them as unconfirmed.

---

## Finding 1: unguarded non-numeric upstream fields (should-fix)

**Rubric line:** R6 (untrusted input), secondarily R1/R4.
**Sites:** `engine/score.js:84-101` (source), `public/index.html:190, 192, 216,
239, 250, 288` (sinks).

**Claim.** Numeric daily fields other than `hi`/`lo` are neither type-checked
nor HTML-escaped. A schema-violating upstream payload (a string where a number
belongs) both poisons scores to NaN and reaches `innerHTML` raw.

**Verified.** Two independent halves, both real:

*Half A, NaN poisoning (the more serious half).* `extractDays` uses `?? 0` for
`precipProb`, `precipSum`, `snow`, `wind`, `gust`, `uv` (`score.js:90-95`),
which catches `null`/`undefined` but passes a string straight into arithmetic.
`dayComfort` then produces NaN, and `clamp` propagates it because
`Math.max(0, NaN)` is NaN (`score.js:50, 80`). The record survives the
finiteness filter at `score.js:109` because that filter only covers `hi` and
`lo`. One poisoned city therefore makes `leader` NaN at `score.js:153`, which
silently empties `ties` and `promotions` for the entire snapshot. Snapshot-wide
failure from one bad field.

*Half B, unescaped DOM sinks.* Confirmed raw interpolations of upstream numerics:
`index.html:190` (`d0.precipProb`), `:192` (`cur.relative_humidity_2m`), `:216`
(`d.precipProb`), `:239` and `:250` (`c.days[0].precipProb`), `:288`
(`night.precipProb`). `:287` (`supercharger.stalls`/`.kw`) is the same shape but
sourced from the committed `data/superchargers.json`, so it is lower risk.

**Correction to Kimi's report.** Two of its cited sinks are already safe:
`:187` (`Math.round(cur.apparent_temperature)`) and `:298-299` (night `hi`/`lo`)
pass through `Math.round`, which renders `NaN`, not a payload. Kimi also claims
a NaN comparator makes `sort` order undefined; the spec treats a NaN comparator
result as `+0`, so the sort is not undefined. Neither correction changes the
finding.

**Threat model, honestly.** Half B requires Open-Meteo to serve
attacker-controlled strings, i.e. a compromised or hostile upstream. Kimi rates
the trigger speculative and I agree. Half A needs only a schema violation, no
malice. Fix both anyway: the cost is small and it converts the frontend's
guarantee from "true because upstream has good type discipline" to
unconditional.

**Recommended fix (two layers, defense in depth).**

1. `engine/score.js`: coerce in `extractDays` so a non-finite value can never
   enter scoring. A `num(v, fallback)` helper returning `Number.isFinite(v) ? v
   : fallback` applied to the `?? 0` fields is the minimal change. Decide
   deliberately whether `appHi` and `sunFrac` (currently nullable by design)
   get the same treatment; `sunFrac` already guards its divisor at `:96-98`.
2. `public/index.html`: a `num()` display helper that coerces and renders a
   dash (or `0`) for non-finite input, applied at all seven sinks listed above.
   Do not rely on `esc()` here; these are numeric fields and coercion is the
   more honest fix.

**Regression tests.** In `test/regressions.test.js`, following the existing
naming style (`K1:` for Kimi finding 1):
- string-typed `precipitation_probability_max` yields a finite score, not NaN
- a snapshot containing one such city still produces non-empty `ties`
- (optional, if you want the DOM half covered) a fixture asserting the display
  helper coerces a string payload

**Proposed rubric addendum 3 line.**
> R6b: every upstream-derived numeric field is finiteness-checked before it
> enters scoring, and coerced (not merely escaped) at every DOM sink. A
> schema-violating upstream value can neither produce a NaN score nor reach
> `innerHTML` verbatim.

---

## Finding 2: server-clock fallback for trip-day anchoring (nit)

**Rubric line:** R8b (regression surface; primary fix intact).
**Site:** `engine/route.js:274`.

**Claim.** The `|| localDate(0)` fallback anchors trip days to the server's
local clock when the origin's weather element is unavailable, which R8b's
wording forbids absolutely ("Neither the server clock nor the stopover clock
anchors trip days").

**Verified, and verified unreachable.** The primary R8b invariant is intact:
`departDate` comes from `wx[0]?.daily?.time?.[0]` (`route.js:268-274`, with the
explanatory comment) and is matched per stopover at `:294`. The fallback is
dead in practice because `stopoverWeather` returns `points.map(() => null)` on
every failure path (`route.js:208, 211`). If `wx[0]` is null then every
`wx[i+1]` is null too, the `w?.daily?.time` guard at `:291` fails for every leg,
and `night` stays null. The fallback value is computed but never consumed.
Reaching it requires a count-correct batch with a null at index 0 and valid
elements after it, which Open-Meteo is not known to produce.

**Recommended fix.** Take it anyway; it is about two lines. When the origin
anchor is missing, skip night matching entirely rather than falling back to the
server clock. That makes R8b unconditional instead of true-by-luck, and "no
night data" is more honest output than "night data anchored to the wrong
calendar."

Per Charles's standing rule, nits get read once and not iterated on. This one
is worth taking because it closes a rubric-wording violation at near-zero cost,
not because the scenario matters.

**Regression test.** `K2:` a `stopoverWeather` stub returning `[null, valid,
valid]` produces null nights, and never calls through to the server clock.

**Proposed rubric addendum 3 line.**
> R8c: when the origin's forecast anchor is unavailable, night matching is
> skipped entirely. There is no fallback path on which the server clock anchors
> trip days.

---

## Finding 3: future `generated_at` served as fresh indefinitely (nit)

**Rubric line:** R4 / R4a (freshness).
**Site:** `server/index.js:38-39`.

**Claim.** A future `_meta.generated_at` yields a negative age, `age <
ACTIVE_TTL_MS` is then true, and the snapshot is served as fresh until real
time catches up. The raw layer explicitly rejects a future `fetched_at`
(`fetch.js:113-115`); the snapshot layer does not.

**Verified.** The asymmetry is real and exact. `fetch.js:113-115` uses
`!(Number.isFinite(age) && age >= 0 && age <= ttl)`; `server/index.js:38-39`
uses a bare `age < cfg.ACTIVE_TTL_MS` with no lower bound. Unparseable
timestamps are already handled correctly at both layers, since `NaN < TTL` is
false and forces a refresh. Scenario: host clock jumps forward, a refresh
writes a future `generated_at`, the clock is corrected, and the server then
serves that snapshot without refreshing for the length of the skew.

**Assessment.** This is the cleanest of the three: no preconditions beyond
clock skew, no speculation about upstream behavior, and a one-line fix. It is
also the one both pass-1 models missed, because R4a's fix landed on
`fetched_at` and nobody grep'd for the same pattern elsewhere.

**Recommended fix.** Add the lower bound: `if (age >= 0 && age <
cfg.ACTIVE_TTL_MS) return snap;`. Consider matching `fetch.js`'s full form
(`Number.isFinite(age) && age >= 0 && ...`) for symmetry, even though the NaN
case already works, so the two layers read identically.

**Regression test.** `K3:` a snapshot file with `generated_at` one hour in the
future is treated as stale and triggers a refresh.

**Proposed rubric addendum 3 line.**
> R4d: freshness checks at EVERY layer (raw records and scored snapshots) treat
> a future timestamp as stale, not fresh. The lower bound is not optional.

---

## What was not verified

Kimi's stated limits, carried forward:

- No live calls to Open-Meteo, OSRM, the geocoder, or Anthropic. Whether
  Open-Meteo can emit string-typed numerics (Finding 1) or a count-correct
  batch with null elements (Finding 2) is asserted from schema reputation, not
  observed.
- `verdict.js:100-110` proceeds unlocked if the counter lock is not won within
  ~1s, so a frozen lock-holder could allow a bounded overshoot past the 12-call
  cap. Kimi did not count this against R5b because it is the blessed fix's
  documented tradeoff. Agreed, and it stays out of scope.
- The 10-minute stale-lock reclaim (`fetch.js:96`) could in principle reclaim a
  lock held by a live refresh stuck in repeated backoffs. Impact is wasted free
  Open-Meteo calls and a last-writer-wins write, with promotions merged at
  `fetch.js:157-160`. Not exercised.
- `output_config: { effort: "medium" }` (`verdict.js:147`) and the model IDs in
  `config.js:33` cannot be validated by reading.
- Kimi's empirical containment checks (`/../publicX/secret`, `%2e%2e`, `%2f`
  against `server/index.js:109-112`) were NOT re-verified in the review session.
  R6a is reported as meeting on Kimi's word alone.

## Closure state

Pass 2 stands at zero clean passes. Per the frozen stopping rule, two clean
passes against the frozen rubric terminate. After remediation: fold R6b, R8c,
and R4d into `REVIEW-PROMPT.md` as addendum 3, add the regression tests, then
the next review round counts as pass-2 clean attempt 1.

**Remediation complete (2026-07-27, Fable 5).** All three findings fixed, plus
one sibling found by applying R0 first: the route cache TTL check
(`engine/route.js`, formerly `:230`) had the same missing lower bound as
Finding 3. All freshness layers now share one predicate, `freshAge` in
`engine/fetch.js`. Finding 2's fix extracted night matching into `nightForLeg`
(exported for tests); the dead `localDate` helper was removed. Regression
tests K1, K1b, K2, K3 added; suite green at 18/18. R0, R6b, R8c, R4d folded
into `REVIEW-PROMPT.md` as addendum 3. The next review round counts as pass-2
clean attempt 1.

---

## Assessment of the review itself (Claude Opus 5, for Fable 5 to evaluate)

Recorded because Charles asked for it, and because Fable 5 should feel free to
disagree with any of it. This is an opinion about review quality, not a
remediation instruction.

**"It found something on a twice-reviewed codebase" is the weakest evidence in
the report.** A model asked to review will nearly always produce findings; that
is the mole-generator dynamic the frozen-rubric discipline exists to contain.
Three findings is not by itself a signal. The shape of the output is.

**What is actually strong:**

1. *Calibration.* Part 3 volunteers that Findings 1 and 2 rest on triggers
   "asserted from schema reputation, not observed," declines to count the
   `verdict.js` lock fallback against R5b because that tradeoff was already
   blessed, and states plainly which checks were not run. Marking the boundary
   of what you checked is rarer and harder than producing findings.
2. *Scope discipline.* Every finding maps to an existing rubric line. Not one
   naming opinion, logging opinion, or "I would have structured this
   differently." That is precisely the drift failure mode the frozen scope was
   written to prevent, and it did not occur.
3. *Some empiricism.* It ran actual checks (containment boundary, NaN clamp)
   rather than reasoning purely from reading, and distinguished those from
   reads.

**What deflates it:**

1. *Two of three findings are the same meta-pattern:* an incompletely
   generalized pass-1 fix. R4a fixed the future-timestamp check on
   `fetched_at` and nobody checked `generated_at`. R4b fixed null temps and
   nobody asked what else in `extractDays` lacks a finiteness guard. Kimi names
   this itself for Finding 1 ("the residual case of the same family").
2. *Order advantage.* Kimi reviewed code plus a written list of what had
   recently been patched. Codex and GLM reviewed code. Some of the delta is
   position in the sequence, not model quality.
3. *Uneven rigor.* It verified `Math.max(0, NaN)` empirically but asserted the
   sort-order claim from pattern, and got it wrong. Its DOM sink list includes
   two sinks `Math.round` already neutralizes.

**The most useful takeaway, worth more than the three fixes.** Pass-1 fixes
create their own blind spot: the fix lands where the finding was, and the
rubric line then records the *instance* rather than the *class*. The
high-yield pass-2 question is not "what is wrong" but "was each addendum fix
generalized to its siblings?" Both real findings here came from that question.

Suggested addendum 3 line capturing it, independent of the three fixes:

> R0: every addendum fix is checked for un-generalized siblings. When a fix
> hardens one call site, the same pattern at every other call site is in scope
> by default.

Applying R0 immediately, before remediation, is probably the highest-value
thing Fable 5 can do: grep for the sibling instances of each addendum fix
(especially R4a's timestamp guards and R4b's finiteness guards) rather than
only patching the three sites Kimi named.

**Caveat on generalizing from this test.** This review measured *closure*
aptitude: given a frozen 20-line rubric, does the model stay in scope, tier
honestly, and admit what it did not check. It says close to nothing about
*discovery* aptitude, the open-ended pass that surfaces a bug class nobody
thought to ask about. On this evidence Kimi K3 looks like a credible third seat
for closure. Whether it earns a discovery slot is untested.
