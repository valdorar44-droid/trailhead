# Outdoorsy Stage 4 Provider-Neutral API Audit

Date: 2026-06-25

## Scope

This checkpoint adds provider-neutral offer routes and mobile client wrappers. It does not add live Outdoorsy rental inventory requests because the rental inventory contract remains unconfirmed.

## Files Changed

- `dashboard/server.py`
- `mobile/lib/api.ts`
- `tests/test_outdoor_offers_api.py`

## Backend Routes

- `GET /api/offers/rentals`
- `GET /api/offers/{offer_id}`
- `POST /api/offers/impression`
- `POST /api/offers/click`
- `POST /api/offers/save`
- `POST /api/offers/redirect`
- `POST /api/offers/dismiss`

## Architecture Checks

- Mobile uses provider-neutral `/api/offers/...` routes.
- Mobile does not call Outdoorsy or TUNE directly.
- Outdoorsy credentials remain backend-only.
- Public search responses map disabled, missing, affiliate-only, and unconfirmed contract states to a neutral empty result.
- Public search responses omit internal provider failure reasons.
- Offer event logging uses the existing analytics table through `log_event`.
- Offer event logging stores only privacy-safe offer, provider, placement, route type, session, and coarse context.
- Offer event logging filters precise coordinates, route geometry, email, username, saved place history, and notes.

## Known Limitations

- Detail lookup only works for offers currently returned by the provider adapter, such as fixture mode.
- No external checkout URL construction has been added because documented Outdoorsy rental deep-link rules remain unconfirmed.
- No conversion reporting or booking reward logic has been added because conversion reporting remains unconfirmed.
- Route Builder UI placement is not part of this checkpoint.

## Validation

Passed:

- `python3 -m py_compile dashboard/server.py dashboard/provider_registry.py scripts/explore_sources/offers/schema.py scripts/explore_sources/offers/ranking.py scripts/explore_sources/offers/disclosure.py scripts/explore_sources/offers/providers/base.py scripts/explore_sources/offers/providers/outdoorsy.py`
- `python3 -m unittest tests.test_outdoorsy_provider tests.test_outdoor_offers_api`
- `npx tsc --noEmit` from `mobile/`
- `npm run audit:routes` from `mobile/`
- `git diff --check`
- secret/network-id scan over the edited files and provider docs returned no matches
