# Outdoorsy Stage 2 Offer Scaffold Audit

Date: 2026-06-25
Commit: recorded by this checkpoint

## Files Changed

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

## What Changed

- Added provider-neutral `OutdoorOffer` schema for rental and outdoor commerce cards.
- Added required commercial disclosure helper.
- Added rental ranking helpers based on pickup distance, party fit, vehicle fit, pet/delivery fit, ratings, freshness, and fatigue signals.
- Added provider base types for rental search queries and public search results.
- Added an Outdoorsy adapter that supports disabled, affiliate-only, fixture-only, and unconfirmed-contract states.
- Added fixtures for test-only normalization. These are not production inventory and are not wired to user-facing surfaces.

## Validation

- `python3 -m py_compile dashboard/server.py dashboard/provider_registry.py scripts/explore_sources/offers/schema.py scripts/explore_sources/offers/ranking.py scripts/explore_sources/offers/disclosure.py scripts/explore_sources/offers/providers/base.py scripts/explore_sources/offers/providers/outdoorsy.py`
- `python3 -m unittest tests.test_outdoorsy_provider`
- `git diff --check`
- Secret/network-id scan for the pasted key prefix and literal network ID.

## Test Coverage

- Disabled/no credentials.
- Fixture normalization.
- Empty result.
- Partial result.
- Missing images.
- Duplicate listings.
- Pagination limits.
- Timeout/config bounds.
- Authentication failure.
- Rate limit.
- Transient service failure.
- Malformed response.
- Invalid dates.
- Sleeps/party filtering.
- Price freshness.
- Location privacy.
- Required disclosure.
- No raw payload or secret fields returned to mobile-shaped output.
- External checkout remains unconfirmed.

## Audit Result

- No direct mobile-to-Outdoorsy path exists.
- No live rental inventory request code exists.
- No TUNE or Outdoorsy secret is present in fixtures, tests, docs, or provider code.
- The adapter fails closed when the inventory contract is unconfirmed.

## Known Limitations

- Live rental search, listing detail, exact affiliate URL construction, conversion reconciliation, image usage, pricing display, availability display, and pickup-location rules remain blocked until the missing Outdoorsy rental inventory contract is supplied.
- Provider-neutral `/api/offers/*` routes and mobile UI are not added in this stage.
