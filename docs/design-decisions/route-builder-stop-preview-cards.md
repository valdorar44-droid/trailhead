# Design Decision: Route Builder Stop Preview Cards

**Date:** 2026-06-25
**Checkpoint:** 25 - Route Builder Stop Preview Cards

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still renders camp, fuel, start, route
  stop, and place preview card markup inline.
- The preview helpers own UI styling plus action buttons while the screen also
  owns stop labels, source badges, camp feature summaries, and callbacks.
- The preview styles are screen-local, which makes Route Builder extraction
  harder to continue without moving unrelated route logic.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderActiveDayStopList.tsx`
  - `mobile/components/routeBuilder/RouteBuilderTimelineDayCard.tsx`
- Mobbin screens:
  - Wanderlog place detail in itinerary:
    `https://mobbin.com/screens/767217bc-b0c5-48a7-a959-abd598bb8ced`
  - Wanderlog compact route-place card:
    `https://mobbin.com/screens/1efa9f56-3b91-4bcc-8e6f-85f160f1f5aa`
  - Wanderlog related place card reference:
    `https://mobbin.com/screens/91f9f4ff-7387-48d8-9024-d91c17a9374f`
- Mobbin flows:
  - Pangea accommodation editing:
    `https://mobbin.com/flows/1e4d7c7f-4909-4106-9b92-4f8b7cef117a`
  - Wanderlog location detail:
    `https://mobbin.com/flows/44f1e299-b07e-4399-9d4b-f5874ac2a26b`
- Figma design-system search:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile itinerary place card stop preview photo tags action buttons route stop component`.
  - No matching reusable preview-card component, variables, or styles were
    returned.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble searches were broad
    and did not change the implementation plan.

## Mobbin References

- Itinerary place cards keep media, tags, details, and local actions attached to
  the stop context.
- Accommodation cards use image-led previews with local action affordances.
- Route detail actions should be compact and close to the relevant card.

## Patterns Extracted

- Preview components should own card layout and visual treatment.
- The screen should keep route labels, source labels, camp feature text, and
  callback closures.
- Camp preview actions should remain hidden in compact timeline previews.

## New Component Tree

```txt
RouteBuilderScreen
  RouteBuilderActiveDayStopList
    RouteBuilderCampPreviewCard
    RouteBuilderFuelPreviewCard
    RouteBuilderPlacePreviewCard
```

## Why The Redesign Is Better

- It moves another UI-heavy render surface out of the large Route Builder
  screen.
- It keeps preview card layout reusable for both active-day stop lists and
  timeline day cards.
- It preserves camp detail loading, swap/stay actions, labels, source badges,
  and route calculations.

## Future Improvements

- Add richer photo handling once route stop media is centralized.
- Reuse preview cards in saved-route editing and trip library detail screens.
- Move stop preview data shaping into a route-builder adapter after component
  boundaries are stable.
