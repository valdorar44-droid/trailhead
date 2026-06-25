# Outdoorsy Stage 5-6 Route Builder Rental UI Audit

Date: 2026-06-25

## Scope

This checkpoint adds route-fit logic and the first Route Builder rental placement. It uses provider-neutral offer APIs and hides the module when no normalized offers are returned.

## Research Reviewed

- Mobbin iOS references:
  - Booking.com travel upsell card
  - Qantas ancillary travel card
  - Trip.com travel service card
- Figma references:
  - `7tHUNDl4Dg4UdrpjE8t1Jl`, node `1:2`, Wanderlog questionnaire flow
  - `O8XRegvq3i6WljYoJ3M72g`, node `770:5839`, Nucleus access check
- Local Trailhead references:
  - Route Builder timeline and readiness flow
  - Existing Trailhead colors, spacing, icons, and card rhythm

## Files Changed

- `mobile/lib/outdoorRentals.ts`
- `mobile/components/offers/OfferDisclosure.tsx`
- `mobile/components/offers/OutdoorRentalCard.tsx`
- `mobile/components/trip/RentalSuggestionModule.tsx`
- `mobile/app/(tabs)/route-builder.tsx`
- `docs/design-decisions/route-builder-outdoorsy-rental-suggestions.md`

## Route-Fit Rules

The module searches when:

- the trip has a searchable starting area
- the user has no saved rig, or the trip is camping-heavy, RV/camping/outdoors oriented, or at least four days
- active navigation is not underway
- no safety warning is active
- the suggestion has not been dismissed recently

The module suppresses when:

- the route has no searchable start
- the route is a one-day local trip
- the user has a saved rig and the route does not have a rental signal
- the suggestion was dismissed in the last seven days

## Privacy and Provider Checks

- Route Builder searches only around the route start.
- It does not search around every route point.
- It does not place rental listings on the map.
- It does not expose exact pickup addresses.
- It does not show price or availability claims in the UI.
- It records impression, click, save, redirect, and dismiss events through the provider-neutral API.
- Event context is coarse: route type, surface, trip type, camp nights, and vehicle type.

## Known Limitations

- Production remains hidden until the backend returns normalized offers.
- Saved rental ideas are tracked as an event in this checkpoint; persistent Library saved-rental items are deferred to Stage 8.
- Date-aware rental availability is deferred until Route Builder has trip dates and the provider contract confirms date behavior.
- No external checkout reward or booking state is inferred from clicks.

## Validation

Passed:

- `python3 -m py_compile dashboard/server.py dashboard/provider_registry.py scripts/explore_sources/offers/schema.py scripts/explore_sources/offers/ranking.py scripts/explore_sources/offers/disclosure.py scripts/explore_sources/offers/providers/base.py scripts/explore_sources/offers/providers/outdoorsy.py`
- `npx tsc --noEmit` from `mobile/`
- `python3 -m unittest tests.test_outdoorsy_provider tests.test_outdoor_offers_api`
- `npm run audit:routes` from `mobile/`
- `git diff --check`
- secret/network-id scan over edited files and provider/design docs returned no matches
