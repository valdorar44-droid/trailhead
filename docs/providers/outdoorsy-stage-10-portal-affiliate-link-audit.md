# Outdoorsy Stage 10 Portal Affiliate Link Audit

Date: 2026-06-25
Branch: `codex/outdoorsy-live-rental-provider`

## Scope

This checkpoint follows the authenticated Outdoorsy publisher portal review.
It does not implement live rental inventory. It only enables a backend-only
generic Outdoorsy RV Search link when the configured provider state and backend
tracking settings support it.

## Portal Facts Confirmed

- The approved Outdoorsy affiliate offer is `Outdoorsy Referral - $60/$50`.
- The offer is an affiliate referral offer, not an inventory/search API.
- The portal provides a generic `RV Search` landing page.
- The portal-generated tracking URL uses the network tracking host under
  `go2cloud.org` and `/aff_c`.
- Confirmed tracking parameters include `offer_id`, `aff_id`, `source`,
  `url_id`, `file_id`, `aff_sub` through `aff_sub5`, `aff_click_id`,
  `aff_unique1` through `aff_unique5`, `url`, and custom variable keys.
- The portal code reads generated tracking links from
  `universal_tracking_link`, falling back to `click_url`.
- The offer uses server postback with transaction ID.
- The portal shows no configured pixels/postbacks.
- No live rental search endpoint, listing-detail endpoint, rental pricing
  schema, availability schema, image usage rule, cache rule, or pickup-location
  privacy rule was exposed in the affiliate portal.

## Implementation Decision

Trailhead may show one generic `Search campervans and RVs` offer when:

- the provider is not disabled,
- backend tracking settings can generate a TUNE link, and
- Route Builder route-fit logic says a rental suggestion belongs in the flow.

The generic offer must not claim inventory exists. It has no images, no price,
no availability, no specific vehicle class, no exact pickup point, and external
checkout remains unconfirmed.

## Files Changed

- `.env.example`
- `docs/providers/outdoorsy-api-contract.md`
- `docs/providers/outdoorsy-stage-10-portal-affiliate-link-audit.md`
- `mobile/lib/outdoorRentals.ts`
- `scripts/explore_sources/offers/providers/outdoorsy.py`
- `tests/test_outdoorsy_provider.py`

## Known Limitations

- Individual Outdoorsy rental inventory remains blocked until separate
  approved inventory documentation or feed access is supplied.
- Conversion reconciliation remains read-only/planned. A click is not a booking.
- The first production link uses `source` and optional `url_id` only. More
  attribution parameters require a privacy-reviewed mapping.

## Audit

- No secret values are committed.
- No mobile direct-to-Outdoorsy request is added.
- No fake rental listings, prices, availability, images, or booking status are
  returned.
- The fallback is backend constructed and provider-neutral through the existing
  OutdoorOffer response shape.
