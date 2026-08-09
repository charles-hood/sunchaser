# Mobile design findings

**Status: findings only, 2026-08-09. Nothing acted on. Discuss with Charles
before building.** Evidence gathered on the live site at 390x844 (iPhone
14-ish), dark scheme, via headless inspection and screenshots. Frame: the
site is responsive-by-accident (one column falls out of the grid), not
mobile-first. Nothing is broken; several things are unconsidered.

## The reframe that should drive any fixes

On a phone, the page's job narrows: glance the verdict, scan the leaders,
maybe check one city. The desktop analyst posture (a 109-row, 11-column
sortable table; a pannable continental map) doesn't survive the transfer.
Mobile-first here doesn't mean shrinking those artifacts; it means letting
each section collapse to the form that serves the glance, and the site
already owns the right vocabulary for it: the card and the chip.

## Blockers (real usability losses)

- **B1. The table silently amputates its right half.** Table content is
  711px wide in a 343px container: six of eleven columns (Hi, Lo, Rain%,
  Tier, Curated, Rent) sit off-screen with zero affordance that horizontal
  scroll exists; the visible slice ends flush at "Combined" and looks
  complete. A reader never learns the rent column exists. Prescription
  (for discussion): at narrow widths, render ranked list rows instead:
  rank, city, combined score, rent chip, with tap to expand a detail
  panel (the data is all client-side already). Alternative minimum: hide
  low-value columns responsively and add a scroll affordance (edge fade +
  "swipe for more"), but the list-row rework is the mobile-first answer.
- **B2. Rent-chip tooltips are effectively unreachable on touch.** The
  dollar amount and source live in a hover-only ::after on a
  non-focusable span. Field-tested by Charles (2026-08-09): iOS's
  long-press hover emulation DOES fire the bubble, but he found it "quite
  by accident": there is no affordance suggesting press-and-hold, and no
  user performs it unprompted. Functionally hidden. Prescription
  unchanged: make chips tappable (tap toggles the bubble, or opens the
  city detail from B1) and focusable for keyboards while at it.

## Should-fix

- **S1. Map is a 440px scroll trap.** Fixed height regardless of
  viewport, and Leaflet captures the drag: a thumb swiping up the page
  pans the Great Lakes instead. Common cures: shorter height on mobile,
  and Leaflet's `dragging: false` on touch until a tap activates the map
  (or `gestureHandling`-style two-finger pan). Dots are also sub-44px
  tap targets, but the popup content is a bonus, not a primary path.
- **S2. Header chip row wraps awkwardly.** At 390px the utils chips
  wrap below the updated-line and float right as an orphan row between
  meta and tagline. Fine functionally, unconsidered visually.
  Prescription: at narrow widths, pin the chips to the same row as the
  h1 (title left, chips right) and let the meta line wrap below.
- **S3. Tap targets are under-sized across the chrome.** Theme chip 22px
  tall, rent chips 18.5px, table sort headers ~30px: Apple/Android
  guidelines want ~44px. Padding, not font-size, is the lever.

## Nits

- N1. The verdict card is a long unbroken wall on mobile (nine
  paragraphs before the next section). Acceptable; a sticky mini-nav or
  collapsed sections would be over-design. Read once, leave alone.
- N2. 22 visible rows of table before the route planner makes the page
  bottom feel distant; the B1 rework largely dissolves this.
- N3. Print chip is near-useless on phones (mobile Safari/Chrome print
  flows exist but nobody's laminating from an iPhone). Harmless; leave.

## Verified fine (no action)

- No horizontal page overflow (document 375px in a 390px viewport).
- Route form wraps cleanly; the 109-city select stays in-viewport.
- "How scores work" dialog fits (calc(100vw - 40px)) and scrolls.
- Week strips fill the column width correctly.
- Cards grid collapses to one column as intended; chips and badges hold.

## Suggested order if/when acted on

B1 (table rework) is 80% of the win and the only structural change; B2
rides along free if chips open the same detail panel. S1-S3 are an hour
combined. The frozen review rubric's endpoint/DOM lines don't apply here
(no new surface); a visual pass on a real phone before deploy is the only
QA beyond the usual.
