# Route Builder Outdoorsy Rental Suggestions

Date: 2026-06-25

## Current Problems

- Rental inventory has no reusable Route Builder placement yet.
- Rentals are a trip-start decision, but Route Builder currently centers most suggestions around day stops.
- A generic affiliate banner would feel detached from the route and would not match Trailhead's production architecture.
- Missing dates and unconfirmed live inventory rules mean the UI must not imply confirmed availability, total price, or booking status.

## Research Reviewed

- Mobbin iOS screens:
  - [Booking.com travel upsell screen](https://mobbin.com/screens/3a7b8817-82cc-4574-a1fc-f17693447452)
  - [Qantas Airways ancillary travel card](https://mobbin.com/screens/a62db269-6afd-4420-9dd7-580cac68e4c2)
  - [Trip.com travel service card](https://mobbin.com/screens/18b4decd-7b4f-4c62-a24c-ea93b0de1237)
- Figma reference:
  - `7tHUNDl4Dg4UdrpjE8t1Jl`, node `1:2`, Wanderlog questionnaire flow.
- Current Trailhead implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/*`
  - `mobile/components/TrailheadUI.tsx`

## Patterns Extracted

- Keep the suggestion contextual to the current trip instead of presenting a generic ad.
- Use one strong outbound action and one quiet save action.
- Keep disclosure visible in the module, not hidden behind a menu.
- Avoid map pins for private rental pickup locations.
- Hide the module when the provider returns empty data.
- Do not show price or availability details unless the provider contract confirms they are safe to display.

## New Component Tree

```txt
RouteBuilderScreen
└─ RentalSuggestionModule
   ├─ OfferDisclosure
   └─ OutdoorRentalCard
```

Shared logic:

```txt
mobile/lib/outdoorRentals.ts
```

## Why This Is Better

- The first placement is provider-neutral and reads from `/api/offers/rentals`.
- Route Builder only owns screen state; fit rules live outside the screen.
- The module appears only when the trip shape, camping cadence, and rig context make a rental useful.
- The UI stays production-safe while the live rental inventory contract remains incomplete.

## Future Improvements

- Add date-aware search once trip dates exist in Route Builder.
- Persist saved rental ideas into the unified Trailhead Library.
- Add Planner/Copilot prompt placement after Route Builder proves stable.
- Replace first-offer preview with a bottom sheet once live listing/detail contract is confirmed.
