# Zero-state and AI-wording audit — 2026-07-05

## Goal

Broad pass over the mobile app (map, guide, route builder, profile, report,
plan, extreme explorer, and shared explore/route-builder components) to find
and fix:

- Zero states that render blank, unhelpful, or generic filler copy.
- Raw/awkward AI-generated wording that leaked into user-facing text
  (grammar bugs, internal jargon like "beta"/"staged"/"build slice", mislabeled
  alerts, broken pluralization).

Work was split across parallel subagents per tab/module, then reviewed and
applied by hand.

## Fixes by area

**`mobile/app/(tabs)/map.tsx`** — "ready for a scan" zero-state titles replaced
with "No trails found here yet" / "No trail places loaded yet" / "No nearby
places found. Try a wider search area."; generic `'Explore area'` / `'Saved
location'` / `'Trailhead trail card'` summary fallbacks replaced with
descriptive text (or `undefined` so a better downstream fallback kicks in).

**`mobile/app/(tabs)/guide.tsx`** — pluralization bugs fixed via
`exploreCountLabel` (narrations, nearby options/campgrounds); weather
placeholder now shows `--` / "Loading forecast" instead of the literal words
"Loading" / "Forecast"; `'Explore area'` fallback fixed.

**`mobile/app/(tabs)/route-builder.tsx`** — `builderResultSummary` pluralizes
correctly and orders modifiers naturally ("...camps with photos near this
area" instead of "...camps near this areawith photos"); "Camp cards are ready
for a wider scan." style zero-states replaced with "No camps found here yet"
(and per-tab equivalents); "shares the next camp window" replaced with an
accurate day-range description; saved-route card falls back to "Saved route"
instead of an empty stats line.

**`mobile/components/routeBuilder/RouteBuilderHub.tsx`** — added a subtitle
to the empty "Start your first route" card.

**`mobile/app/(tabs)/profile.tsx`** — generic `Alert.alert('Error', e.message)`
replaced with a specific title + friendly fallback; GPX open failure no longer
shows `unknown error`; stale "Rules are loading." replaced with an accurate
message when rules are actually unavailable; referral code placeholder shows
"Generating..." instead of `...`; loading spinner now has a label.

**`mobile/app/(tabs)/report.tsx`** / **`mobile/app/(tabs)/plan.tsx`** — generic
error alert fixed; bare `?` in shared-trip mileage text removed (omits the
miles clause entirely when the value is missing, instead of showing `?`).

**`mobile/app/extreme-explorer.tsx`** — `coPilotSummary()` grammar bug fixed
(was always saying "and several stay options" even when there were zero, and
mishandled singular counts); replaced "staged"/"beta slice"/"build slice"
internal jargon with plain language; `Alert.alert('Map Styles', ...)` mislabeled
dialogs retitled to match their actual action (Saved / Added to route / Routed
through / Explorer / Weather).

**Shared components** — `PremiumPlaceSheet.tsx` and `CampReviewsSection.tsx`
now show "No reviews yet — be the first to add one." instead of rendering
nothing; `RouteBuilderSearchSurface.tsx` shows "No results found. Try a
different search." on a zero-result query instead of a blank box;
`MissionControlPanel.tsx` "unknown" badge text changed to "not checked";
`AiReportModal.tsx` no longer renders an em-dash placeholder for empty
messages (filters them out instead).

## Deeper bug: anchored regex vs. multi-sentence paragraphs

`mobile/components/explore/exploreDisplay.ts` (`cleanExploreCopy`) and
`mobile/components/explore/ExploreDetailSheet.tsx` (`cleanDetailStoryCopy`)
both clean up templated backend copy using regexes anchored with `^` — i.e.
they only fire when the known-bad phrase is the *entire* string.

That works fine for short fields (card `summary`/`hook`, one sentence), but
`place.profile.story` (rendered in the "About" section of the detail sheet)
is a multi-sentence paragraph assembled server-side as
`"{title}. {summary} {story_core}..."`. When a known-bad phrase like `"Use it
as a stop when the drive needs more than mileage. Check access, fees,
closures, and overnight rules."` is *embedded* mid-paragraph (after the title
sentence), the anchored check never matches and the raw templated phrase
leaked straight to users — e.g. Banff National Park's About text read "...Use
it as a stop when the drive needs more than mileage. Check access, fees,
closures, and overnight rules...".

Fix: added non-anchored `.replace()` passes ahead of the anchored checks in
both files so these known phrases get cleaned up wherever they appear in the
string, not just when they're the whole string:

- `"Use it as a(n) [real/day] anchor/stop when the drive needs more than
  mileage."` → `"It's worth a proper stop, not just a drive-through. Check
  access, fees, closures, and overnight rules before you go."`
- `"Use this as a(n) protected-area anchor/stop"` → `"{title} is a
  protected-area anchor"` (keeps the rest of the original sentence, e.g. "for
  K2, Baltoro, and Concordia planning...", intact).

A subagent audit found several more anchored-only checks in the same two
functions with the same theoretical risk (waterfall/fuel/supply/trail-target
templates). Those weren't confirmed to have live embedded occurrences in the
production catalog, so they were left as-is for now — worth revisiting if
similar leaks are spotted.

## Validation

- `npx tsc --noEmit` — clean, run after each round of edits.
- `node scripts/user-facing-copy-audit.mjs` — passed.
- `node scripts/route-builder-audit.mjs` — passed (13 cases).
- Playwright spot checks against the Expo web dev server
  (`http://127.0.0.1:8082`):
  - `/guide` Featured Places: Banff National Park card now reads "Banff
    National Park is a worthwhile stop. Check access, fees, closures, and
    overnight rules before you go." (was showing the raw templated phrase).
  - Banff detail sheet "About" section confirmed fixed after a full dev-server
    restart (Metro's file watcher didn't reliably pick up edits mid-session in
    this environment; a `--clear` restart was needed to get a truly fresh
    bundle for verification).
  - Central Karakoram National Park card and detail sheet "About" section
    both confirmed fixed against live production API data (protected-area
    anchor phrase).

## Files changed

- `mobile/app/(tabs)/guide.tsx`
- `mobile/app/(tabs)/map.tsx`
- `mobile/app/(tabs)/plan.tsx`
- `mobile/app/(tabs)/profile.tsx`
- `mobile/app/(tabs)/report.tsx`
- `mobile/app/(tabs)/route-builder.tsx`
- `mobile/app/extreme-explorer.tsx`
- `mobile/components/AiReportModal.tsx`
- `mobile/components/PremiumPlaceSheet.tsx`
- `mobile/components/copilot/MissionControlPanel.tsx`
- `mobile/components/explore/ExploreDetailSheet.tsx`
- `mobile/components/explore/GuidedTripDetailModal.tsx`
- `mobile/components/explore/exploreDisplay.ts`
- `mobile/components/map/CampReviewsSection.tsx`
- `mobile/components/routeBuilder/RouteBuilderHub.tsx`
- `mobile/components/routeBuilder/RouteBuilderSearchSurface.tsx`
