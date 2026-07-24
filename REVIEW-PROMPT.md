# Sunchaser cross-model review prompt

Paste everything below the line into the reviewing model, along with the code
(see "Getting the code in" at the bottom).

---

You are reviewing **Sunchaser**, a deliberately zero-dependency Node 22
project (~1,800 lines) that: (1) fetches Open-Meteo weather for 108 pre-vetted
US cities on a two-tier cadence, (2) scores them deterministically, (3) has a
capped, cached Anthropic API call adjudicate a shortlist, (4) plans EV road
trips with OSRM + a supercharger database, and (5) serves a vanilla-JS
frontend from a tiny Node http server on localhost. Design constraints that
are NOT defects: zero npm dependencies, single-file frontend, plain `http`
module, hand-rolled SVG/DOM rendering, free-tier public APIs.

**Scope (frozen):** `engine/*.js`, `server/index.js`, `cli.js`,
`tools/*.js`, `public/index.html`, `test/*.js`, `data/*.json` shapes.
**Out of scope:** deployment (not built yet), naming/style/formatting
preferences, suggestions to add dependencies or frameworks, rewrites or new
abstractions, TypeScript, accessibility beyond obvious breakage, test-coverage
expansion except where you can name a concrete bug it would have caught.

**Rubric.** Judge the code against these invariants, answering per item:
meets / gap found. This rubric is the terminating condition of the review.

- R1 **Scoring math**: `dayComfort` applies WEIGHTS as documented; clamps to
  0..100; Now/Week/Combined weighting correct; ties are cities within 2.0 of
  the leader; dormant cities within 10 of the leader get promoted.
- R2 **Tiering and cadence**: Jun-Aug=summer, Dec-Feb=winter, else shoulder;
  active tier gets current+hourly+daily every 3 h, dormant gets daily every
  24 h; a dormant record never satisfies an active slot without refetch;
  promotions expire after 48 h.
- R3 **Batch alignment**: Open-Meteo returns an array per multi-coord
  request; a response index must never be assigned to the wrong city, in any
  batch, including single-city batches and partial failures.
- R4 **Failure survival**: 429/5xx backoff then stale-cache serving; malformed
  or missing upstream fields never crash the scorer; the fetch lock cannot
  permanently wedge the system after a crashed process; concurrent server
  requests cannot stampede a refresh or corrupt files.
- R5 **Spend safety**: every Anthropic call goes through the capped path
  (12/day); verdict is cached by input hash; NO code path lets an anonymous
  web visitor trigger an Anthropic API call or bypass the route throttle.
- R6 **Untrusted input**: static file serving cannot escape `public/`; query
  params are bounded; every upstream-derived string (city names, supercharger
  names, AI-generated markdown, geocoder results) is HTML-escaped before DOM
  insertion; the API key can never be logged, served, or committed.
- R7 **Route math**: haversine/cumulative-distance/route-projection are
  correct; every stopover has a supercharger within 10 mi (or is itself a
  supercharger town); per-day charge stops and trip totals are consistent;
  stopover night weather maps to the correct forecast date; route cache
  respects its TTL.
- R8 **Time handling**: season derivation, TTL comparisons, forecast-day
  indexing, and date labels behave correctly across timezones and around
  midnight; nothing mixes UTC and local time in a way that changes behavior.

**Report format.** For each finding: severity (**blocker** = wrong results,
crash, security hole, or uncapped spend; **should-fix** = real defect with
narrow trigger; **nit** = anything else), `file:line`, a one-sentence claim,
and a concrete failure scenario (inputs/state, then the wrong behavior).
Report everything you find including low-confidence findings, marked with
your confidence; coverage now, filtering later. Then a per-rubric-item
verdict: meets / gaps listed. Do not propose refactors or style changes.

**Process.** This is pass 1 of at most 3. After fixes, any follow-up pass is
limited to: this rubric, and regressions reachable from the fixes. New
territory is out of bounds. The review terminates after two consecutive
clean passes against this rubric.

---

## Getting the code in

- **Codex**: point it at the repo root; the frozen-scope file list above is
  the review set.
- **GLM 5.2 (Fireworks)**: paste a single concatenated file:
  `for f in $(git ls-files 'engine/*' 'server/*' 'tools/*' 'test/*' cli.js public/index.html); do echo "=== $f ==="; cat "$f"; done > /tmp/sunchaser-review.txt`
  (about 1,800 lines; include `data/cities.json` `_meta` and one city entry,
  plus one `superchargers.json` entry, as shape samples if it asks.)
