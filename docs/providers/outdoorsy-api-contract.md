# Outdoorsy API Contract Audit

Date: 2026-06-25
Stage: 0
Status: contract audit only

This document contains no secret values. A TUNE affiliate API key was pasted in chat during planning; treat that key as exposed and rotate it before production use. Store the rotated value only in backend secrets. Do not commit it, log it, send it to mobile, or expose it through `EXPO_PUBLIC_*`.

## Sources Reviewed

- TUNE Affiliate API overview: https://developers.tune.com/affiliate
- TUNE Affiliate API getting started: https://developers.tune.com/affiliate-docs/getting-started-with-the-hasoffers-affiliate-api/
- TUNE `Affiliate_Offer::generateTrackingLink`: https://developers.tune.com/affiliate/affiliate_offer-generatetrackinglink/
- TUNE `Affiliate_Offer::findAll`: https://developers.tune.com/affiliate/affiliate_offer-findall/
- TUNE `Affiliate_Report::getConversions`: https://developers.tune.com/affiliate/affiliate_report-getconversions/
- GitHub Issue #13: Integrate Outdoorsy API as first live rental provider

No separate Outdoorsy rental inventory/search API documentation has been supplied yet.

## Confirmed Facts

| Area | Confirmed fact |
| --- | --- |
| Official API name and version | TUNE / HasOffers Affiliate API. TUNE sample calls use `Apiv3/json`. |
| Base URL pattern | `https://{network_id}.api.hasoffers.com/Apiv3/json` for Affiliate API calls. The real network ID must come from backend secrets. |
| Authentication method | TUNE calls require `NetworkId` and `api_key`. The docs show `api_key` as a request parameter, not a mobile header. |
| Backend credential variables | Use backend-only settings such as `OUTDOORSY_TUNE_NETWORK_ID`, `OUTDOORSY_TUNE_API_KEY`, `OUTDOORSY_TUNE_API_BASE_URL`, `OUTDOORSY_ENABLE_LIVE`, `OUTDOORSY_REQUEST_TIMEOUT_SECONDS`, and `OUTDOORSY_CACHE_TTL_SECONDS`. |
| Offer lookup | TUNE `Affiliate_Offer::findAll` returns offer objects and supports `limit`, `page`, and `contain` values such as `OfferUrl`, `TrackingLink`, `Thumbnail`, and `GeoTargeting`. |
| Tracking link generation | TUNE `Affiliate_Offer::generateTrackingLink` requires `offer_id`; supports `params` and `options`; `params.url` may be treated specially if website links are enabled by the network; other `params` fields are appended to the resulting link as query key/value pairs. |
| Conversion reporting | TUNE `Affiliate_Report::getConversions` returns conversion report rows. It exposes fields such as `Stat.offer_id`, `Stat.conversion_status`, `Stat.sale_amount`, `Stat.currency`, `Stat.source`, and affiliate sub fields including `Stat.affiliate_info1` through `Stat.affiliate_info5`. Availability of some fields depends on network settings. |
| Pagination | TUNE report and offer endpoints support `limit` and `page`. |
| Response shape | TUNE getting-started sample shows top-level `request` and `response`; `response` includes `status`, `httpStatus`, `data`, `errors`, and `errorMessage`. |
| Disclosure requirement | Trailhead surfaces must show `Partner booking · Trailhead may earn.` for Outdoorsy commercial recommendations. |

## Unconfirmed Rental Inventory Contract

The TUNE Affiliate API confirms affiliate offers, tracking links, and conversion reporting. It does not confirm live rental inventory search. The following remain `unconfirmed` and must not be guessed:

| Required contract item | Status |
| --- | --- |
| Outdoorsy rental search endpoint | unconfirmed |
| Outdoorsy listing/detail endpoint | unconfirmed |
| Rental API base URL separate from TUNE | unconfirmed |
| Rental API authentication headers | unconfirmed |
| Location search inputs | unconfirmed |
| Date inputs | unconfirmed |
| Supported filters | unconfirmed |
| Vehicle categories | unconfirmed |
| Inventory pagination limits | unconfirmed |
| Rate limits | unconfirmed |
| Timeout expectations | unconfirmed |
| Listing response fields | unconfirmed |
| Pricing fields | unconfirmed |
| Fee/tax behavior | unconfirmed |
| Availability behavior | unconfirmed |
| Rental-specific affiliate/deep-link format | unconfirmed |
| Campaign or sub-ID support for rental checkout | unconfirmed beyond TUNE generic params/sub fields |
| Image/content usage rules | unconfirmed |
| Caching/storage rules | unconfirmed |
| Pickup-location privacy rules | unconfirmed |
| Cancellation fields | unconfirmed |
| Insurance fields | unconfirmed |
| Conversion postback/webhook options | unconfirmed beyond TUNE conversion reporting |
| Required Outdoorsy attribution/disclosures | unconfirmed beyond Trailhead commercial disclosure |
| Error response shapes for rental inventory API | unconfirmed |

## Contract Decisions

- Do not build live rental inventory calls until separate Outdoorsy rental inventory docs, portal configuration, or approved partner materials confirm endpoints and terms.
- Do not display rental prices, availability, exact pickup addresses, vehicle categories, images, cancellation details, or insurance details unless the inventory contract confirms the source fields and display rights.
- TUNE may be used later for backend-only offer discovery, tracking-link generation, and conversion reconciliation once the offer ID and approved parameters are confirmed.
- A click is not a booking. Do not grant booking rewards from link clicks alone.
- If no inventory contract exists, Route Builder, Planner, Copilot, Explore, and Library must hide rental inventory modules or show only approved generic fallback copy.
