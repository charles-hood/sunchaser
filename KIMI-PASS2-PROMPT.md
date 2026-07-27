# Sunchaser review — pass 2 (Kimi K3 test run)

Paste everything below the line into the `kimi` agent in OpenCode, with the
sunchaser repo as the working directory so it has file access.

---

You are performing **pass 2** of a frozen-scope code review of **Sunchaser**, a
deliberately zero-dependency Node 22 project (~1,800 lines) that: (1) fetches
Open-Meteo weather for 108 pre-vetted US cities on a two-tier cadence, (2) scores
them deterministically, (3) has a capped, cached Anthropic API call adjudicate a
shortlist, (4) plans EV road trips with OSRM plus a supercharger database, and
(5) serves a vanilla-JS frontend from a tiny Node http server.

Design constraints that are **NOT defects**: zero npm dependencies, single-file
frontend, plain `http` module, hand-rolled SVG/DOM rendering, free-tier public
APIs.

## Your rubric

Read `REVIEW-PROMPT.md` in this repo. Its rubric (base items R1-R8, plus
"Rubric addendum" and "Rubric addendum 2") is the complete and terminating
definition of this review. Do not review against anything else.

**Scope (frozen):** `engine/*.js`, `server/index.js`, `cli.js`, `tools/*.js`,
`public/index.html`, `test/*.js`, and the shapes of `data/*.json`.

**Out of scope, and reporting these counts against you:** deployment, naming,
style, formatting, suggestions to add dependencies or frameworks, refactors, new
abstractions, TypeScript, test-coverage expansion except where you can name a
concrete bug the missing test would have caught, and any concern outside the
rubric. New territory is out of bounds in pass 2.

## What has already happened

Pass 1 was run by two other models (Codex and GLM 5.2). It produced **21
findings, all of which are already fixed** at the current HEAD, and all of which
have regression tests in `test/regressions.test.js`. Every one of those 21 is
described in the two rubric addenda in `REVIEW-PROMPT.md` (items R4a, R4b, R2a,
R5a, R7a, R7b, R7c, R8a, R3a, R8b, R5b, R6a, R4c and the base items they
attach to).

Those addenda are now **regression surface**, not open findings. Reporting one
of them as if it were still broken is a false positive and is worse than
reporting nothing. Before you report anything that resembles an addendum item,
read the current code and confirm the defect is actually present at HEAD.

The baseline is green: `node --test 'test/**/*.test.js'` passes 14/14 on a clean
tree. Use a quoted glob; a bare `node --test test/` misreports a failure.

## What to produce

**Part 1 — Findings.** For each finding:

- Severity: **blocker** (wrong results, crash, security hole, or uncapped
  spend), **should-fix** (real defect with a narrow trigger), or **nit**.
- `file:line`.
- Which rubric item it violates. A finding that maps to no rubric item is out
  of scope; do not report it.
- A one-sentence claim.
- A concrete failure scenario: specific inputs and state, then the wrong
  behavior that results. Not "this could be a problem" — show the path.
- Your confidence, and whether you verified it by reading the code at HEAD or
  are inferring it.

Report low-confidence findings too, marked as such. Coverage now, filtering
later. If you find nothing, say so plainly; a clean pass is a valid and
expected result here.

**Part 2 — Rubric verdict, all items.** Walk every rubric item: base R1 through
R8, then each addendum item. For each one give:

- `meets` or `gap`, and
- the specific `file:line` where the invariant is enforced, plus one sentence
  naming the actual mechanism that enforces it.

A "meets" with no citation, or a citation that does not correspond to real code
at HEAD, is a failed answer. This part is not optional and is the main thing
being asked of you.

**Part 3 — Honest limits.** Name anything in the rubric you could not verify by
reading the code, and say what you would have needed (running it, upstream API
behavior, a specific input) to settle it. Do not paper over gaps in your own
coverage.

## Stopping rule

This review terminates after two consecutive clean passes against this rubric.
Do not propose refactors or style changes. Do not expand the rubric.
