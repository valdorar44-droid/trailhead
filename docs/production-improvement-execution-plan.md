# Trailhead Production Improvement Execution Plan

## Purpose

Turn the recent product audit into a working execution plan with checkpoints, review gates, and a running self-audit loop.

This plan is for production improvement work across:

- route trust and alert quality
- screen polish and wording
- information architecture
- search completeness and empty-state handling
- AI planner and copilot differentiation

## Current Read

Trailhead is already broad enough to feel ambitious. The next production pass should not be feature sprawl. It should focus on three things in order:

1. trust
2. structure
3. moat

## Non-Negotiables

- Do not let AI summaries outrun source quality.
- Do not ship route alerts that are merely near a town but not on the traveled path.
- Do not leave first-run or search-heavy surfaces empty without a useful fallback.
- Do not keep adding new surfaces into `profile`, `report`, or `map` without narrowing their jobs.
- Every phase must end with an audit note before moving on.

## Known Hard Problems

### 1. Route alert trust

Current issue:

- `ingestors/conditions.py`
- `ingestors/tomtom_traffic.py`
- `mobile/app/(tabs)/map.tsx`
- `ai/planner.py`

TomTom incidents are fetched by route corridor bbox, then accepted with loose waypoint-box filtering. This can pull in closures and incidents that are in the same town but not on the actual driven path. Those alerts can then contaminate AI route briefs.

### 2. Screen overload

Current high-risk files:

- `mobile/app/(tabs)/profile.tsx` (`2944` lines)
- `mobile/app/(tabs)/report.tsx` (`1374` lines)
- `mobile/app/(tabs)/guide.tsx` (`1620` lines)
- `mobile/app/(tabs)/map.tsx` (`26323` lines)

The issue is not just code size. These files also mix too many product jobs into one surface.

### 3. Moat gap

Trailhead has product breadth, but the current copilot and planner are orchestration and prompting, not a real learning moat. That is usable, but it is not durable differentiation yet.

## Phase Plan

## Phase 0: Baseline And Instrumentation

Goal:

Create a stable before-state so later polish work is measurable.

Tasks:

- define key production flows:
  - search for a camp
  - open a camp card
  - build a route
  - open route brief
  - report a condition
  - open profile and saved trips
- log no-result searches and empty-state hits
- log route-brief opens, saves, and dismissals
- log alert panel opens and which alerts are ignored or expanded
- capture current wording pain points and repeated copy patterns

Checkpoint:

- baseline metrics doc or notes saved
- top empty-state surfaces listed
- top repeated wording templates listed

Exit criteria:

- we can compare before/after on search empties, route-brief quality, and alert relevance

## Phase 1: Route Trust And AI Brief Correctness

Goal:

Fix the part of the product that can most directly damage trust.

Tasks:

- replace loose waypoint-box filtering with route-shape distance filtering
- add stronger provider-specific gating for TomTom incidents
- prefer route-matched road closures and severe incidents over generic nearby traffic
- suppress irrelevant town-wide clutter from route briefs
- tighten the route brief input payload so only high-value alerts reach the model
- show freshness and source on alerts that affect route guidance

Checkpoint:

- a route through a town only shows alerts actually along the traveled road corridor
- AI route brief no longer mentions irrelevant town closures
- route alert summary is shorter and more useful

Exit criteria:

- manual route probes in several dense towns pass
- no obvious false-positive closures in the brief during spot checks

## Phase 2: Search Completeness And Empty-State Hardening

Goal:

Make search feel full even when live sources are sparse.

Tasks:

- audit empty states in Explore, Map, Report, and route-day camp picking
- ensure every major search path falls back to seeded or offline data when live search is thin
- tune result ranking so official/live beats seeded, but seeded prevents dead ends
- add better empty-state copy with an action, not just a dead message
- identify top categories still under-covered in USA and international seed data

Checkpoint:

- no major search surface returns a dead empty state without a next action
- seeded fallback is visible but clearly secondary to live/official data

Exit criteria:

- common user searches have at least a reasonable fallback path

## Phase 3: Profile Restructure

Goal:

Reduce cognitive load and make Profile feel intentional.

Tasks:

- split Profile into clear groups:
  - Account and Plan
  - Rig
  - Trips and Downloads
  - Saved Places
  - Contributions and Support
  - Settings
- move admin-only or rare actions deeper
- tighten labels and remove repeated explanatory copy
- keep support, bug reporting, and contributor tools, but stop letting them dominate the main screen

Checkpoint:

- a new user can find plan, rig, trips, and settings in one scan
- a repeat user can get to saved trips and downloads without scrolling through unrelated controls

Exit criteria:

- Profile has a clearer primary path and fewer competing cards above the fold

## Phase 4: Report Tab Overhaul

Goal:

Make Report useful for travelers, not just for “what is near me” browsing.

Tasks:

- redesign around:
  - On my route
  - Near camp tonight
  - Near me
  - Submit
- demote leaderboard from top-level prominence
- make route-relevant alerts and community reports easier to scan
- improve report detail quality, severity clarity, and TTL visibility
- review notification settings wording and defaults

Checkpoint:

- Report helps a traveler answer “what affects my route or tonight’s stop?”
- leaderboard still exists, but no longer steals primary product real estate

Exit criteria:

- route-context reporting is a first-class surface

## Phase 5: Explore Ranking, Trust, And Detail Polish

Goal:

Make Explore feel editorially strong and practically useful.

Tasks:

- refine category ranking and “featured vs nearby vs trip” behavior
- improve “why this place” context
- tighten summary, hook, and detail wording
- make camp/park/monument/trail context feel more distinct
- add stronger source/freshness language where needed
- ensure selected place detail always has a useful nearby rail or fallback

Checkpoint:

- Explore cards do not sound templated
- selected places feel grounded in nearby context, not just generic prose

Exit criteria:

- Explore feels curated and credible, not AI-padded

## Phase 6: Map Surface Reduction And Modularization

Goal:

Lower product and engineering risk in the biggest file and most important screen.

Tasks:

- split `map.tsx` by product responsibility:
  - routing
  - alerts
  - camp detail
  - nearby places
  - AI surfaces
  - route builder
- remove duplicate search/filter entry points where possible
- standardize panel hierarchy and language
- review which map actions belong in primary chrome versus deep sheets

Checkpoint:

- major map features are easier to reason about in isolation
- visible controls feel more consistent

Exit criteria:

- map product changes stop requiring edits across one giant file for unrelated behaviors

## Phase 7: Moat Features

Goal:

Build features that are harder to copy than a generic AI planner.

Priority candidates:

- legal-stay confidence scoring
- rig-aware camp fit
- rig-aware route feasibility
- route-corridor hazard relevance
- contributor trust scoring
- trip memory across saves, reroutes, downloads, and field reports

Checkpoint:

- at least one moat feature is live in a user-visible form
- at least one moat feature is powered by Trailhead-specific data, not just prompting

Exit criteria:

- the app can answer at least one question competitors usually answer poorly:
  - can I stay here legally tonight?
  - can my rig get there?
  - what on this exact route actually matters?

## Self-Audit Loop

At the end of each phase, save a short audit note with:

- what changed
- what improved
- what still feels weak
- whether the phase met exit criteria
- what should be cut or deferred

Use this template:

```md
## Phase X Audit

Date:

Shipped:

What improved:

What still feels weak:

Metrics or spot checks:

Decision:
- complete
- continue
- cut scope
```

## Checkpoint Board

- [x] Phase 0 complete: baseline and instrumentation
- [x] Phase 1 complete: route trust and AI brief correctness
- [x] Phase 2 complete: search completeness and empty-state hardening
- [x] Phase 3 complete: Profile restructure
- [x] Phase 4 complete: Report overhaul
- [x] Cross-phase checkpoint: remaining Profile/Report weaknesses reduced
- [x] Phase 5 complete: Explore polish and ranking
- [x] Cross-phase checkpoint: offline trip cache controls added
- [x] Phase 6 checkpoint A: route alerts panel extracted from map
- [x] Phase 6 checkpoint B: map drawer extracted from map
- [x] Phase 6 checkpoint C: filter sheet extracted from map
- [x] Phase 6 checkpoint D: route scout panel extracted from map
- [x] Phase 6 checkpoint E: map style sheet extracted from map
- [x] Phase 6 checkpoint F: weather peek extracted from map
- [x] Phase 6 checkpoint G: weather detail sheet extracted from map
- [x] Phase 6 checkpoint H: main layer-sheet content extracted from map
- [x] Phase 6 checkpoint I: camp reviews, comments, and field reports extracted from map
- [x] Phase 6 checkpoint J: camp coordinates and insight extracted from map
- [x] Phase 6 checkpoint K: camp nearby rails extracted from map
- [x] Phase 6 checkpoint L: camp nearby filtering and grouping extracted from map
- [x] Cross-phase checkpoint: profile chrome trimmed, Explore copilot shortcut removed, Campflare evaluation harness added
- [x] Cross-phase checkpoint: Campflare live sandbox evaluation completed and documented
- [x] Cross-phase checkpoint: copilot route-scout intent, clarification, and wording hardened
- [x] Cross-phase checkpoint: copilot replay harness added and run against production snapshots
- [x] Cross-phase checkpoint: copilot replay harness expanded for overnight-confidence and route-session clutter scoring
- [x] Cross-phase checkpoint: copilot route-scout confidence and route-planning visible-context suppression tightened
- [x] Cross-phase checkpoint: copilot route-scout overnight search made progressive and summary trimmed
- [x] Cross-phase checkpoint: AI planner and Co-Pilot reporting flow added with screenshot support and Android review audit saved
- [x] Cross-phase checkpoint: Android permission review completed; background location marked non-defensible as-is for Play submission
- [x] Cross-phase checkpoint: Android background location stack removed for next Play review bundle
- [x] Cross-phase checkpoint: Android release manifest trimmed to scoped photo/report and voice permissions only
- [x] Cross-phase checkpoint: Android production AAB rebuilt after permission cleanup
- [x] Cross-phase checkpoint: Android portrait lock removed from native manifest; 16 KB native-lib issue confirmed as toolchain-level
- [x] Cross-phase checkpoint: Expo SDK 54 / React Native 0.81 Android platform upgrade applied and typechecked
- [x] Cross-phase checkpoint: EAS SDK 54 install failure diagnosed; npm legacy peer resolution pinned for build
- [x] Cross-phase checkpoint: SDK 54 Android JavaScript bundling fixed locally after worklets/Babel dependency additions
- [x] Cross-phase checkpoint: SDK 54 Android Gradle wrapper mismatch fixed after EAS native build gate
- [x] Cross-phase checkpoint: SDK 54 New Architecture requirement enabled after Reanimated native gate
- [x] Cross-phase checkpoint: Android payments upgraded to Nitro-backed IAP API after SDK 54 native build gate
- [x] Cross-phase checkpoint: obsolete IAP patch removed after EAS install gate
- [x] Cross-phase checkpoint: SDK 54 Android production AAB built, manifest-audited, and 16 KB aligned on 64-bit slices
- [x] Cross-phase checkpoint: Play submission attempted; blocked only by missing EAS Google service account key
- [x] Cross-phase checkpoint: Android post-release location recenter, Route Builder media fallback, and keep-awake fixes validated for OTA
- [x] Cross-phase checkpoint: Android map/Route Builder polish OTA published to production (`4d7ec808-b2a8-4197-b761-7e5a96b664dd`) and preview (`5fb45cca-a4ec-4265-9ff3-e2b1f34663ad`)
- [x] Cross-phase checkpoint: Android location snap-back follow-up fixed by moving normal map location rendering off native tracking; OTA published to production (`719eae89-f217-4501-a0db-f00cf5d597a1`) and preview (`14512184-7f85-41fd-9159-654447dac51d`)
- [x] Cross-phase checkpoint: Android camera-follow latch follow-up fixed by separating free/follow camera mounts and remounting the free camera on locate; OTA published to production (`4b46a936-0991-488d-b6fe-4edc0376c704`) and preview (`f4702137-dafe-4c95-a91c-520e91d5f674`)
- [x] Cross-phase checkpoint: Android locate-pan snap follow-up fixed by isolating programmatic camera moves, deferring source/style refresh during user drags, and removing the legacy WebView locate signal from native mode; OTA published to production (`0e584a88-22ed-4d63-bb10-5d78ea77bd4a`) and preview (`94513198-ba45-434d-9b73-c6f40efd76a8`)
- [x] Cross-phase checkpoint: Android map snap-back instrumentation added to admin debug transcripts; OTA published to production (`dc8eeb15-dc36-44e7-b982-f13d6c0e6bce`) and preview (`2370b2c6-ae5d-4bd7-88b5-f62bb77851e4`)
- [x] Cross-phase checkpoint: Route Builder loading MP4 resolution hardened and cropped image fallback replaced; OTA published to production (`ad46dc62-c1a8-46bf-b1b2-bed1bc0ea5ef`) and preview (`f53f7530-252d-4253-b037-5f196f85c7fe`)
- [x] Cross-phase checkpoint: Route Builder loading overlay made light-mode safe, shifted lower, and wording de-duplicated; OTA published to production (`1e9275ec-5015-47f4-a7df-50f2e9d4a854`) and preview (`a49a2f7d-59df-49b9-94bd-78dd6588d775`)
- [x] Cross-phase checkpoint: iOS Route Builder mismatch resolved by building SDK 54 runtime `native-20260614-sdk54-1` as version `1.0.5` build `33` and uploading it to App Store Connect/TestFlight
- [ ] Phase 6 complete: Map modularization and surface cleanup
- [ ] Phase 7 complete: moat feature v1

## Suggested Working Order

Work in this order unless a new blocking bug interrupts:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7

Reason:

- trust fixes need to land before polish
- empty-state and search quality need to land before wider growth
- IA cleanup should happen before more feature additions
- moat work matters most after the base product feels reliable

## Notes For Future Sessions

- Do not restart with another broad brainstorm.
- Resume from the next unchecked phase.
- Audit the previous phase before opening the next one.
- If a new feature idea does not improve trust, structure, or moat, it is probably not phase-critical.
