# Design Decision: Route Builder Deeper Redesign

**Date:** 2026-06-25
**Checkpoint:** 13 - Route Builder Deeper Redesign

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` is still 6,662 lines and owns too much
  visible UI, route orchestration, saved-route library UI, detail sheets, copy,
  and search behavior in one screen.
- Checkpoint 4 extracted only the wizard progress header. The hub, recent/saved
  route cards, route workspace header, insert guidance, readiness card, and
  route timeline rows still live inside the screen.
- The hub reads like a card-heavy landing page instead of a dense route command
  surface.
- The workspace repeats action chips, search, readiness, timeline, and footer
  controls in one long scroll. Users have to scan too much before they can tell
  what is route status, what is a day action, and what is a saved item.
- A targeted copy audit found visible wording that should not ship:
  `Provider`, `Endpoint`, raw coordinate display in search results, and older
  credit/pass wording.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteWizardProgressHeader.tsx`
  - `mobile/lib/routeBuilder/session.ts`
  - `mobile/lib/routeBuilder/readiness.ts`
  - `mobile/lib/routeBuilder/geometry.ts`
- Mobbin route/travel references:
  - Wanderlog trip screen:
    `https://mobbin.com/screens/47c63178-6212-4cbe-aaa0-0cfc5b7f4f25`
  - Wanderlog trip screen:
    `https://mobbin.com/screens/a9e14927-a81a-4255-88bf-cbc54a2f2538`
  - Google Maps saved/travel screen:
    `https://mobbin.com/screens/a5e909b4-f470-44bc-af8d-24746479f5d3`
  - Google Maps route search screen:
    `https://mobbin.com/screens/3d16a316-0986-42fe-a322-0b5a6672b12f`
  - Google Maps directions screen:
    `https://mobbin.com/screens/c57f30ee-4659-4baf-a4e6-3d0d5fcc1798`
  - Pangea travel planning screen:
    `https://mobbin.com/screens/1417b5e5-fd19-49db-abca-eaf283124ee5`
- Mobbin flows:
  - Wanderlog saving a location to a list:
    `https://mobbin.com/flows/609c277f-7cba-45a8-83c3-9e26d0a921bc`
  - Tripadvisor creating an itinerary:
    `https://mobbin.com/flows/59d1b040-2c70-4210-b21b-61a02bdb026e`
  - Pangea adding a spot to a trip:
    `https://mobbin.com/flows/fe41dc0c-bc2c-4d13-8387-338b75497188`
  - Wanderlog adding a place:
    `https://mobbin.com/flows/23c441df-12a9-46ab-a60e-19b43fcc65dd`
- User-provided Figma files:
  - Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`, page `0:1`, which includes
    Wanderlog reference frames.
  - Sublima Mobile App PRO `Tdhl14DvNzqK1wNNac1ikj`, node `2967:9663`, for
    mobile list rows, button dock, detail page, search, and compact topbar
    structure.
  - Nucleus UI Lite `O8XRegvq3i6WljYoJ3M72g`, node `770:5839`, reviewed but
    the provided node is cover/upsell content rather than production route
    components.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble searches were
    attempted for mobile trip planner, route planner, itinerary, and travel app
    UI patterns. The environment did not return reliable directly inspectable
    design pages, so they were not used as concrete component references.

## Patterns Extracted

- Route creation should start from a command surface: clear start/destination
  fields, recent routes nearby, and one obvious build action.
- Recent/saved items should behave like a library strip or list, not a visual
  hero wall.
- Route workspaces need a persistent summary header with distance, drive time,
  days, camps, and readiness state.
- Add-stop actions should sit near the timeline/day they affect.
- Search results should name places and intent, not expose raw map coordinates
  unless the user explicitly opens map details.
- Readiness works best as a compact checklist with short labels and concrete
  next actions.

## New Component Tree

```txt
RouteBuilderScreen
  RouteBuilderHub
    RouteBuilderHeroCommand
    RouteBuilderRigSummary
    RouteBuilderRecentRoutes
    RouteBuilderSavedTrails
  RouteWizardProgressHeader
  RouteBuilderWorkspaceHeader
  RouteBuilderTimelineActions
  RouteBuilderInsertNotice
  RouteBuilderReadinessCard
  RouteBuilderTimeline
    RouteBuilderStopRow
    RouteBuilderLegActions
  RouteBuilderFooterDock
```

## Why This Is Better

- It reduces the route screen by moving visible surfaces into reusable
  route-builder components without touching route math, Mapbox routing,
  campsite scoring, save contracts, or trip payloads.
- It makes the first route-builder view feel like a working route command
  center instead of a promotional screen.
- It keeps recent/saved routes, route setup, and active route editing visually
  separate.
- It removes implementation wording from visible route-builder copy.
- It creates component boundaries needed for later Mapbox bridge work.

## First Implementation Slice

- Extract hub UI into `mobile/components/routeBuilder/RouteBuilderHub.tsx`.
- Extract active workspace summary/readiness surfaces only if the hub extraction
  stays low risk.
- Clean visible copy audit hits in `route-builder.tsx`.
- Do not change route computation, Mapbox bridge calls, saved geometry, camp
  scoring, credit charging, or API payloads.

## Future Improvements

- Build a Figma checkpoint frame for Route Builder once the first component
  extraction is committed.
- Add a dedicated route timeline component after the hub is stable.
- Add a shared saved/recent library row that can be reused by Profile Library.
- Move camp detail sheets into route-builder-specific components in a later
  checkpoint.
