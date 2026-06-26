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
- Authenticated Outdoorsy publisher portal, reviewed 2026-06-25:
  - `Offers -> All Offers`
  - `Outdoorsy Referral - $60/$50`
  - `Tools -> Pixels/Postbacks`

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
| Portal tracking domain and path | The portal-generated click URL uses the network tracking host under `go2cloud.org` and path `/aff_c`. Account-specific IDs must come from backend secrets/config. |
| Confirmed Outdoorsy affiliate offer | The authenticated portal shows the approved offer `Outdoorsy Referral - $60/$50`, offer ID `2`. This is an affiliate referral offer, not an inventory API. |
| Confirmed landing pages | The offer exposes landing pages for default URL, random URL, List Your RV Page, RV Search, UK List Your RV Landing Page, and UK Site Homepage. The RV Search landing page has portal URL ID `51` and preview URL `https://www.outdoorsy.com/rv-search`. |
| Confirmed tracking params from portal UI | Source uses `source`; creative uses `file_id`; sub IDs use `aff_sub`, `aff_sub2`, `aff_sub3`, `aff_sub4`, and `aff_sub5`; click ID uses `aff_click_id`; unique values use `aff_unique1` through `aff_unique5`; deep link uses `url`; offer URL selection uses `url_id`; random URL uses `random_url`. |
| Confirmed tracking link response fields | The portal code maps generated-link responses from `universal_tracking_link` first, falling back to `click_url`. It also receives `impression_pixel`. |
| Website/direct-link settings | The offer allows website/deep links, does not allow direct links, and shows custom variables. |
| Offer protocol | The authenticated portal lists `Server Postback w/ Transaction ID`. |
| Offer targeting | The authenticated portal shows no advanced targeting rules for this offer. |
| Offer expiration | The authenticated portal shows this offer expiring April 2, 2039 at 11:59 PM CST. |
| Offer session window | The portal offer metadata exposes `session_hours = 672`. |
| Offer goals | Portal goals include Outdoorsy Referral, Booking Complete, Booking Request, Listing Complete, Listing Start, Booking Departed, Listing Depart, and Booking Cancelled. Payout values are commercial/account terms and should not be shown in the app. |
| Portal postback state | `Tools -> Pixels/Postbacks` currently shows no configured pixel/postback rows. The offer page supports HTML/JavaScript Code, Image Pixel, and Postback URL creation, but Trailhead should not create postbacks automatically without an approved conversion reconciliation design. |
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
| Rental-specific affiliate/deep-link format | confirmed only for generic Outdoorsy website/RV-search landing pages through TUNE; unconfirmed for individual rental listings or checkout pages |
| Campaign or sub-ID support for rental checkout | confirmed only for TUNE generic params/sub fields; unconfirmed for individual rental checkout |
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
- TUNE may be used for backend-only generic RV Search tracking links when the backend has the approved offer ID, affiliate/account configuration, and optional RV Search URL ID.
- A generic RV Search link is not inventory. Do not display fake rental cards, fake availability, fake prices, fake images, exact pickup locations, or booking confirmation from this link.
- Use `source` and optional `url_id` only for the first production link. Add `aff_sub*`, `aff_click_id`, `aff_unique*`, custom variables, or deep links only when there is a privacy-reviewed attribution design.
- A click is not a booking. Do not grant booking rewards from link clicks alone.
- If no inventory contract exists, Route Builder, Planner, Copilot, Explore, and Library must hide rental inventory modules or show only approved generic fallback copy/linking.
