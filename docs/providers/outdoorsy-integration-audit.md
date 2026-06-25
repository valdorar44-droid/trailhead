# Outdoorsy Integration Audit

Date: 2026-06-25
Stage: 0
Branch: `codex/outdoorsy-live-rental-provider`

## Current Repo Architecture

- PR #12 is documentation/planning only. It adds the master live-app upgrade plan and the structured UI reference board. Issue #13 is the execution spec for Outdoorsy.
- `docs/copilot-outdoor-commerce-upgrade-plan.md` is referenced by Issue #13 but is not present in this checkout.
- Travel commerce currently exists as a Viator source pack under `scripts/explore_sources/travel/`. The normalized model is `BookableExperience`, with ranking in `scripts/explore_sources/travel/ranking.py` and a backend-only Viator client in `scripts/explore_sources/travel/viator/client.py`.
- `dashboard/server.py` serves Viator experiences through `/api/explore/places/{place_id}/experiences`, `/api/explore/experiences`, `/api/explore/experiences/refresh`, and `/api/explore/experiences/{experience_id}`.
- `dashboard/provider_registry.py` already registers commercial providers such as Viator and Mapbox with storage, freshness, allowed-surface, and derivative constraints.
- `mobile/lib/api.ts` has typed Explore/experience methods and many guarded Mapbox/search requests, but no provider-neutral `/api/offers/*` methods or `OutdoorOffer` type.
- Route Builder, Planner, Explore, and Profile are large production screens. New commerce UI should be extracted into reusable components instead of growing those screen files.

## Reusable Existing Systems

- Viator source-pack pattern for backend-only live enable flags, safe disabled behavior, fixture import, normalization, and external checkout.
- Provider registry structure for source metadata, allowed surfaces, attribution, storage, and derivative constraints.
- `guardedRequest` in `mobile/lib/api.ts` for bounded mobile request behavior.
- Route Builder smart suggestions/discovery component patterns.
- Profile Library overview and existing offline trip, saved place, saved camp, and GPX import storage.
- Existing place detail, edit suggestion, comment, and photo attachment flows in `PremiumPlaceSheet`.

## Missing Shared OutdoorOffer Pieces

- A provider-neutral `OutdoorOffer` data model separate from `BookableExperience`.
- Offer provider adapter base class and fixture mode.
- Offer ranking for rentals based on route fit, pickup distance, date fit, sleeps/party fit, pet/delivery fit, rating confidence, price freshness, and commercial fatigue.
- Disclosure helper that enforces `Partner booking · Trailhead may earn.`
- Backend-only TUNE/Outdoorsy configuration and no-key disabled behavior.
- Provider-neutral API routes:
  - `GET /api/offers/rentals`
  - `GET /api/offers/{offer_id}`
  - `POST /api/offers/impression`
  - `POST /api/offers/click`
  - `POST /api/offers/save`
- Mobile offer API types and reusable offer cards.
- Library saved-rental model/statuses. A saved rental is not a confirmed booking.

## Exact Files Expected To Change

Stage 0 changed files:

- `docs/providers/outdoorsy-api-contract.md`
- `docs/providers/outdoorsy-integration-audit.md`

Expected later-stage files:

- `.env.example`
- `dashboard/provider_registry.py`
- `dashboard/server.py`
- `mobile/lib/api.ts`
- `scripts/explore_sources/offers/__init__.py`
- `scripts/explore_sources/offers/schema.py`
- `scripts/explore_sources/offers/ranking.py`
- `scripts/explore_sources/offers/disclosure.py`
- `scripts/explore_sources/offers/providers/__init__.py`
- `scripts/explore_sources/offers/providers/base.py`
- `scripts/explore_sources/offers/providers/outdoorsy.py`
- `scripts/explore_sources/offers/fixtures/outdoorsy_empty_sample.json`
- `scripts/explore_sources/offers/fixtures/outdoorsy_partial_sample.json`
- `scripts/explore_sources/offers/fixtures/outdoorsy_search_sample.json`
- `tests/test_outdoorsy_provider.py`
- `mobile/components/offers/OfferDisclosure.tsx`
- `mobile/components/offers/OutdoorRentalCard.tsx`
- `mobile/components/trip/RentalSuggestionModule.tsx`
- Route Builder, Planner, Explore, and Profile only through small integration points after reusable pieces exist.

## Provider State Model

Outdoorsy should support:

- `disabled`
- `fixture_only`
- `configured_affiliate_link`
- `live_read_only`
- `live_external_checkout`
- `future_booking`

Initial intended production state remains `live_external_checkout` only if the rental inventory contract confirms live inventory and external checkout rules. With only TUNE confirmed, the safe state is `configured_affiliate_link` or `disabled`, depending on whether approved offer IDs and tracking parameters are present.

## Design References To Preserve

Use these as reference inputs only. Do not commit paid template files, screenshots, fonts, or copied assets.

- Mobbin-to-Figma Wanderlog questionnaire: https://www.figma.com/design/7tHUNDl4Dg4UdrpjE8t1Jl/Mobbin-%E2%80%94-Copy-to-Figma--Community-?node-id=1-2&t=eysFfUfZgxQV1MgR-1
- Untitled UI variables: https://www.figma.com/design/dAxE1C8nCXtC165yyf5HR3/%E2%9D%96-Untitled-UI-Figma-%E2%80%93-PRO-VARIABLES--v8.0--Copy-?node-id=1480-0
- Untitled UI styles: https://www.figma.com/design/a07B9pTYDR4VXVPNkI7RnW/%E2%9D%96-Untitled-UI-Figma-%E2%80%93-PRO-STYLES--v8.0--Copy-
- Sublima mobile app kit: https://www.figma.com/design/8jYbmt6yU97e7zmFBaMlZi/Sublima-Mobile-App-PRO--v1.0---Copy-?node-id=2967-9663
- Main File Light: https://www.figma.com/design/3UGN07bIPh7yYbYbdz1puG/Main_File_Light?node-id=0-1
- Main File Dark: https://www.figma.com/design/eE8qfGvAZzJ5k2N7V8x0Dn/Main_File_Dark

Patterns extracted during planning:

- Welcome/setup should use a short progressive questionnaire, optional account creation, and `Continue for now`.
- Search should behave as a full-screen task surface with recents, categories, nearby places, grouped results, and save/open actions.
- Camp and POI sheets should prioritize a compact action rail, smooth scroll, edit/report/save sections, and photo/note attachments.
- Library should be a Trailhead Library index, not a raw file explorer. Start inside Profile and read from existing storage before any migration.

## Risks

- The currently confirmed documentation is affiliate tracking, not rental inventory. Building inventory from this alone would require guessing endpoint paths, response fields, pricing, availability, cache rights, and location privacy.
- The user pasted an API key in chat. The key must be rotated before production use.
- `BookableExperience` is Viator/tours-shaped; reusing it directly for rentals would leak tour assumptions into rental flows.
- Mobile must not call TUNE or Outdoorsy directly.
- Commercial status must never override safety, freshness, privacy, or trip fit.
- Route Builder, Planner, Explore, and Profile are already large. New work needs reusable components and small screen-level integration points.

## Staged Implementation Order

1. Stage 0: contract and audit docs. No request code.
2. Stage 1: backend-only env examples and provider registry metadata. Keep live disabled unless the inventory contract is supplied.
3. Stage 2: shared `OutdoorOffer` model, disclosure helper, provider base, fixtures, and tests. No live Outdoorsy inventory calls without confirmed docs.
4. Stage 3: Outdoorsy adapter for confirmed affiliate-link behavior only; add live rental inventory only after endpoint/auth/field/cache/privacy facts are confirmed.
5. Stage 4: provider-neutral `/api/offers/*` routes with safe empty results and privacy-safe tracking.
6. Stage 5: route-fit ranking.
7. Stage 6: Route Builder rental suggestion placement.
8. Stage 7: Planner/Copilot prompt.
9. Stage 8: Library saved-rental item.
10. Stage 9: Explore destination module.

## Stage 0 Audit Result

Stage 0 is successful because the contract boundary is documented and the implementation is prevented from guessing live rental inventory behavior.

Known limitation: implementation beyond affiliate tracking remains blocked until separate Outdoorsy rental inventory documentation, approved partner portal details, or a confirmed feed contract is supplied.
