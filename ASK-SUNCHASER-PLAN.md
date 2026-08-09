# Draft plan: "Ask Sunchaser" grounded Q&A bot

**Status: DRAFT, not approved, not scheduled.** Assessed 2026-08-09 at
Charles's request; parked for future consideration. Do not build until
Charles green-lights it and the open questions at the bottom are answered.

**Decision 2026-08-09 (Charles): wait for a demand signal.** The site was
announced on Facebook the same day; if friends' comments start asking
questions the site can't answer itself ("does it know about Boise?"), that
is the trigger to revisit this plan. No signal, no bot.

## What it is

A small chat box on the site ("Ask Sunchaser") that answers visitor
questions about the current results, the 109 cities, each city's weather,
and the scoring assumptions. Strictly scoped to the site's own data; it
declines everything else. Modeled on the proven AI-for-HR tutor
(`reverse-proxy/tutor-proxy/server.js`), which has run publicly with the
same open-but-bounded posture.

## Why it might be worth it

The verdict covers only the top 10; the popup covers methodology. The bot
covers the long tail: "How's Asheville looking?", "Why is Phoenix dead
last?", "What would it take for San Diego to win the week?" Every byte it
needs is already public through /api endpoints; the bot is a conversational
view over data the site already serves.

## Architecture (decided in draft)

- **One service, not two**: an `/api/ask` POST route inside the existing
  sunchaser server. Reads snapshot/verdict/rents/WEIGHTS off disk; reuses
  the route planner's per-IP throttle pattern. No new daemon, no Caddy
  change.
- **Server-side grounding** (stronger than the tutor, which trusts the page
  to send chapter text): client sends the question only; the server builds
  the context. Digest: one compact line per city for all 109, full 7-day
  detail for the shortlist, current verdict markdown, WEIGHTS with their
  meanings, and the site-taste/assumptions paragraph. ~6k input tokens,
  stable between hourly refreshes so Fireworks prompt caching applies.
- **Model**: same DeepSeek V4 Flash the verdict uses. Streaming SSE
  passthrough, tutor-style (`Readable.fromWeb(upstream.body).pipe(res)`).
- **Fixed server-side system prompt**; client can never supply a prompt,
  pick a model, or inject context. Scope rule: answer only about
  Sunchaser's cities/weather/scores/assumptions; one-sentence decline for
  anything else; instruction to describe the model only as "a small
  open-weight model" (soft guarantee, see risks).

## Guardrails (tutor pattern, tuned down)

| Bound | Value (draft) |
|---|---|
| max output tokens | ~600 |
| question length | 2,000 chars |
| history kept | 4 turns |
| per-IP rate | 6/min (matches route planner) |
| global daily breaker | 300-500 questions/day |
| ultimate backstop | dedicated PREPAID no-auto-reload Fireworks key |

Daily ask-counter kept separate from the verdict's 40-call cap (tutor uses
in-memory day counter; that simplicity is acceptable here too).

## Costs

~$0.001 per uncached question (6k in / ~500 out at $0.14/$0.28 per M);
prompt caching cuts repeats well below that. Realistic (50 q/day):
~$1.50/month. Capped worst case: ~$0.50/day. Absolute worst case: the
prepaid key balance, then the tap runs dry.

## Constraint amendment required (deliberate, not incidental)

Sunchaser CLAUDE.md's hard rule "zero per-visitor AI spend; the web server
never calls an AI API" must be amended, not ignored. Proposed wording: page
views stay spend-free forever; AI spend occurs only on an explicit visitor
question, through the one `/api/ask` chokepoint, capped daily, on a
dedicated prepaid key. Same posture AI-for-HR and lotcheck already run.

## Risks accepted / flagged

- **Jailbreaks**: prompt-only scope enforcement is beatable by determined
  users (same as the HR tutor). Mitigation is worthlessness of the prize: a
  600-token DeepSeek reply costing a tenth of a cent, no secrets in
  context (all grounding data is already public JSON).
- **Model identity**: asked directly, the bot may name DeepSeek despite the
  prompt. Note the site already prints the full model id in the verdict
  footer, so the "never say DeepSeek" rule is about Charles's own posts,
  not the site. Charles must be comfortable with this staying blurry.
- **New public POST endpoint** = new attack surface: in scope for the next
  frozen-rubric review pass as change-reachable code (endpoint-hardening
  rubric lines apply: body caps, throttles, no reflection, JSON-only).

## UX sketch

Small "Ask Sunchaser" box under the verdict card. Three seeded example
questions as clickable chips ("Why not Phoenix?", "How's Asheville
looking?", "What's the catch in Duluth?"). Streaming answer renders in the
same markdown-lite style as the verdict. Screen-only (hidden in print).

## Effort estimate

Roughly a half-day session: endpoint + grounding compactor + prompt +
frontend widget + caps + tests (compactor and cap logic are pure and
testable) + docs in both repos + deploy.

## Open questions for Charles

1. Dedicated prepaid Fireworks key (recommended; absolute blast-radius cap)
   or reuse the main key with the software cap as the only guard?
2. Daily breaker value: 300? 500?
3. Should answers cite which data they used (e.g. "per the 08-12 forecast
   row"), or stay conversational?
4. Launch quietly, or with a follow-up FB post?
