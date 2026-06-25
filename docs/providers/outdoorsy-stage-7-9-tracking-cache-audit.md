# Outdoorsy Stage 7-9 Tracking and Cache Audit

Date: 2026-06-25

## Scope

This checkpoint closes the tracking, checkout limitation, failure, and cache behavior that can be implemented without confirmed live Outdoorsy rental inventory documentation.

## Files Changed

- `dashboard/server.py`
- `mobile/lib/api.ts`
- `tests/test_outdoor_offers_api.py`

## Tracking

Implemented provider-neutral event routes:

- `commerce_offer_impression`
- `commerce_offer_click`
- `commerce_offer_save`
- `commerce_offer_redirect`
- `commerce_offer_dismiss`

Tracked context is privacy-safe:

- offer ID
- provider
- placement
- coarse route type
- pseudonymous session ID
- timestamp
- coarse trip context

Not tracked:

- raw route geometry
- precise route points
- precise user location
- email
- username
- saved-place history
- private trip notes

## Checkout

No backend URL construction was added in this checkpoint because Outdoorsy rental deep-link, affiliate, campaign, and sub-ID rules were unconfirmed at the time. Stage 10 adds only the later-confirmed generic Outdoorsy RV Search affiliate link behavior; individual rental deep links remain unconfirmed.

Route Builder opens only normalized `affiliate_url` or `booking_url` values that the backend has already returned on an `OutdoorOffer`. If no URL is available, it shows a neutral unavailable message.

No booking reward is granted from a click.

## Failure Behavior

- Disabled provider: returns neutral empty response.
- Missing backend credentials: returns neutral empty response.
- Affiliate-only state: returns neutral empty response.
- Unconfirmed rental inventory contract: returns neutral empty response.
- Mobile hides the rental module when no offers are returned.
- User-facing copy does not expose provider errors, sandbox state, tokens, endpoints, or internal contract language.

## Cache Behavior

- Mobile no longer caches rental search responses.
- Backend uses a bounded in-memory cache for normalized public rental responses only.
- Empty results cache for 30 seconds.
- Positive public results cache for at most 5 minutes.
- Raw provider payloads are not cached by the route layer.
- Provider fixtures still preserve `fetched_at` and `expires_at`.

## Known Limitations

- Server cache is process-local and will reset on deploy/restart.
- Live inventory-specific rate limit handling remains blocked by the missing rental inventory API contract.
- External checkout attribution and conversion reconciliation remain blocked by missing contract details.

## Validation

Passed:

- `python3 -m py_compile dashboard/server.py dashboard/provider_registry.py scripts/explore_sources/offers/schema.py scripts/explore_sources/offers/ranking.py scripts/explore_sources/offers/disclosure.py scripts/explore_sources/offers/providers/base.py scripts/explore_sources/offers/providers/outdoorsy.py`
- `python3 -m unittest tests.test_outdoorsy_provider tests.test_outdoor_offers_api`
- `npx tsc --noEmit` from `mobile/`
- `npm run audit:routes` from `mobile/`
- `git diff --check`
- secret/network-id scan over edited files and provider/design docs returned no matches
