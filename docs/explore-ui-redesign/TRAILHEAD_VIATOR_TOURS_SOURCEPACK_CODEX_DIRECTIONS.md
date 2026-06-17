# TrailHead Viator Tours Source Pack — Codex Directions

Date: 2026-06-17  
Audience: Codex / TrailHead engineering  
Codex task name: `TRAILHEAD_VIATOR_TOURS_SOURCEPACK_CODEX_DIRECTIONS.md`

---

## 0. Goal

Add a Viator-powered Tours & Experiences source pack to TrailHead Explore.

The goal is to show bookable tours and experiences near TrailHead Explore areas, routes, camps, parks, trails, towns, and map searches.

Initial checkout model:

```txt
TrailHead shows Viator tour cards
User taps Book on Viator
User completes checkout on viator.com
TrailHead uses affiliate/deep link attribution where available
```

Do not build in-app checkout in the first pass. Full + Booking Access can come later after Viator approval/certification.

---

## 1. Read first

Read these repo files before coding:

```txt
docs/explore-ui-redesign/TRAILHEAD_EXPLORE_CATALOG_RESEARCH_AND_RECOMMENDATIONS.md
docs/explore-ui-redesign/TRAILHEAD_EXPLORE_UI_REDESIGN_CODEX_DIRECTIONS.md
docs/explore-ui-redesign/TRAILHEAD_REAL_DATA_TRAIL_SYSTEM_CODEX_DIRECTIONS.md
mobile/components/explore/exploreDisplay.ts
mobile/components/explore/ExplorePlaceCard.tsx
mobile/components/explore/ExploreDetailSheet.tsx
mobile/components/explore/ExploreTrailArea.tsx
mobile/components/explore/curatedExplorePlaces.ts
mobile/app/(tabs)/guide.tsx
mobile/lib/api.ts
scripts/build_explore_catalog.py
scripts/sync_explore_catalog_from_seed.py
scripts/merge_global_explore_catalog.py
scripts/explore_seed_v2.json
dashboard/explore_catalog_v1.json
```

Important current repo context:

- TrailHead already has Explore catalog/place APIs on mobile.
- `mobile/lib/api.ts` already has `getExploreCatalog`, `getExplorePlaces`, `getExplorePlace`, `getExploreCampgrounds`, `getNearbyPlaces`, and nearby place provider plumbing.
- Explore display helpers already support source badges, trust badges, quick facts, safe fallback copy, nearby modules, category aliases, query scoring, and trust scoring.
- This task should add a separate bookable experiences layer, not replace the trail/camp/place catalog.

---

## 2. Product intent

Replace or de-emphasize the old Guide Audio tab/surface with a more useful monetizable travel/action surface:

```txt
Tours & Experiences
Guided trips
Local adventures
Attraction tickets
Rafting / boat / scenic tours
Jeep / 4x4 / off-road tours
Climbing guides
Hiking guides
Wildlife tours
Fishing charters if available
Shuttles / transport experiences if available
Rainy-day backups
Family-friendly experiences
```

These cards should appear in Explore detail screens and relevant route/map contexts:

```txt
Yosemite Explore Hub -> Yosemite tours nearby
Moab Explore Hub -> Jeep, canyon, rafting, climbing tours
Skardu / Hunza -> local experiences when available
Campground detail -> nearby tours and activities
Route day -> bookable activities near that day stop
Town/service search -> nearby tours, food, fuel, resupply
```

---

## 3. Viator source facts to respect

Use the official Viator Partner API / Affiliate API model.

Known Viator access levels:

```txt
Basic Access:
  default / self-service access
  customers checkout on viator.com
  supports product merchandising/search/summaries
  no prior approval or minimum requirements listed by Viator resources

Full Access:
  approval and certification required
  customers still checkout on viator.com
  richer product data, traveler reviews/photos, real-time availability, bulk ingestion, modified-since endpoints

Full + Booking Access:
  approval and certification required
  supports in-app / on-site transaction flows
  payment tools, booking endpoints, cancellations/refunds workflows
```

Initial TrailHead integration should target Basic Access / affiliate redirect.

Do not assume booking endpoints are available unless Viator account access confirms Full + Booking Access.

Important source URLs for future reference:

```txt
https://docs.viator.com/partner-api/
https://partnerresources.viator.com/travel-commerce/levels-of-access/
https://partnerresources.viator.com/travel-commerce/affiliate/
```

---

## 4. Add source-pack architecture

Add a travel/tours source-pack folder.

Recommended structure:

```txt
scripts/explore_sources/travel/
  __init__.py
  schema.py
  normalize.py
  cards.py
  ranking.py
  cache_policy.py

scripts/explore_sources/travel/viator/
  __init__.py
  client.py
  import_viator.py
  normalize_viator.py
  fixtures/
    viator_yosemite_sample.json
    viator_moab_sample.json
```

Optional future providers should be stubbed only if useful:

```txt
scripts/explore_sources/travel/getyourguide/
scripts/explore_sources/travel/amadeus/
scripts/explore_sources/travel/tiqets/
scripts/explore_sources/travel/musement/
scripts/explore_sources/travel/opentripmap/
scripts/explore_sources/travel/rapidapi_research/
scripts/explore_sources/travel/apify_research/
```

Do not overbuild every provider now. Viator is the go-to first provider.

---

## 5. Environment/config

Do not hardcode keys.

Use environment variables such as:

```txt
VIATOR_API_KEY
VIATOR_PARTNER_ID
VIATOR_AFFILIATE_ID
VIATOR_API_BASE_URL
VIATOR_ENABLE_LIVE=false
VIATOR_CACHE_TTL_HOURS=24
```

If the exact Viator auth/header names differ in the current Viator docs/account dashboard, follow the official docs and document the exact env vars used.

Add clear runtime behavior:

```txt
No key configured -> return empty tours rail safely
Key configured + live enabled -> fetch Viator
Fixture mode -> load sample JSON for development/tests
API failure -> do not crash Explore; show no rail or fallback copy
```

---

## 6. Data model

Add a normalized BookableExperience model.

Suggested fields:

```txt
id
source
source_id
source_badge
source_url
booking_url
affiliate_url
cache_policy
fetched_at
expires_at
last_seen_at
title
category
subcategories
lat
lng
region
country
summary
description
highlights
inclusions
exclusions
duration_label
price_from
currency
rating
review_count
hero_image_url
images
cancellation_summary
availability_summary
mobile_ticket
instant_confirmation
languages
supplier_name
attribution
primary_action
secondary_actions
raw
```

Example normalized object:

```json
{
  "id": "viator:PRODUCT_CODE",
  "source": "viator",
  "source_id": "PRODUCT_CODE",
  "source_badge": "Viator",
  "cache_policy": "partner_api_ingest",
  "title": "Half-Day Yosemite Valley Hiking Tour",
  "category": "guided_tour",
  "subcategories": ["hiking", "national_park", "outdoors"],
  "lat": 37.748,
  "lng": -119.588,
  "region": "Yosemite National Park, CA",
  "summary": "Guided outdoor experience near this Explore area.",
  "price_from": "129.00",
  "currency": "USD",
  "duration_label": "4 hours",
  "rating": 4.8,
  "review_count": 231,
  "hero_image_url": "",
  "booking_url": "",
  "affiliate_url": "",
  "attribution": "Source: Viator",
  "primary_action": "Book on Viator",
  "secondary_actions": ["Save", "Add to Planner", "Show Area"]
}
```

---

## 7. Cache policy

Add cache policy support so TrailHead can handle different provider rules later.

Suggested cache policy enum:

```txt
partner_api_ingest
live_only
open_cache
research_snapshot
source_link_only
```

Viator official partner API records can use:

```txt
partner_api_ingest
```

For Basic Access, keep refresh conservative:

```txt
refresh every 24 hours for active regions
refresh every 7 days for inactive regions
refresh immediately when user opens a stale product card if allowed
store source_id and booking_url/affiliate_url
preserve attribution
```

For Google Places / Tripadvisor-like future providers:

```txt
live_only
store only stable provider IDs when terms require it
fetch current display data live when user opens card
```

For Apify/RapidAPI scraper research:

```txt
research_snapshot
internal admin/dev use only until rights are confirmed
not for public app display by default
```

---

## 8. Viator importer behavior

Add:

```txt
scripts/explore_sources/travel/viator/client.py
scripts/explore_sources/travel/viator/import_viator.py
scripts/explore_sources/travel/viator/normalize_viator.py
```

The importer should support:

```txt
search by lat/lng/radius
search by destination/region when coordinate search is unavailable
search by attraction or ExplorePlace name when useful
fixture mode for tests
normalization into BookableExperience
safe dedupe by source/source_id
output JSON for dashboard/API/mobile
```

Initial outputs:

```txt
dashboard/explore_tours_viator_v1.json
dashboard/explore_bookable_experiences_v1.json
```

Do not merge tours into `dashboard/explore_catalog_v1.json` yet. Keep them separate so Explore can display them as a rail/module.

---

## 9. API target

Prepare or add endpoints depending on backend structure:

```txt
GET /api/explore/places/{place_id}/experiences?source=viator&limit=12
GET /api/explore/experiences?lat=&lng=&radius=&source=viator&limit=20
GET /api/explore/experiences/{experience_id}
POST /api/explore/experiences/refresh
```

Response shape:

```json
{
  "source": "viator",
  "place_id": "explore:parks:yosemite-national-park",
  "results": [
    {
      "id": "viator:PRODUCT_CODE",
      "title": "Half-Day Yosemite Valley Hiking Tour",
      "source_badge": "Viator",
      "price_from": "129.00",
      "currency": "USD",
      "duration_label": "4 hours",
      "rating": 4.8,
      "review_count": 231,
      "hero_image_url": "",
      "summary": "Guided outdoor experience near this Explore area.",
      "primary_action": "Book on Viator",
      "booking_url": ""
    }
  ],
  "attribution": "Tours and experiences sourced from Viator.",
  "cache_status": "fresh"
}
```

If backend route files are not obvious, implement the data builder and document the API wiring needed.

---

## 10. Mobile UI target

Add a Tours & Experiences rail to Explore detail screens.

Recommended placement:

```txt
ExploreDetailSheet
  Hero
  Primary actions
  Summary / Full Story / Nearby / Sources tabs
  Highlight / facts
  Nearby modules
  Tours & Experiences rail
  Nearby camps / services / weather
```

If the old Guide Audio tab/surface is still visible and redundant, replace that visible tab/surface with:

```txt
Tours
```

or:

```txt
Experiences
```

Do not remove audio guide backend behavior unless it is unused elsewhere. Just make Tours/Experiences the more prominent tab/rail.

Tour card display:

```txt
[Image]
Source: Viator
Title
From $X · duration · rating/review count if available
Short summary/highlight
Book on Viator
Add to Planner
Show Area
```

Use source-visible CTAs:

```txt
Book on Viator
View on Viator
```

Do not hide the provider/source.

---

## 11. Matching logic

For an ExplorePlace, find tours using:

```txt
place lat/lng + radius
place name / attraction name
region/state/country
category intent
route day stop lat/lng
map center lat/lng
```

Suggested radius defaults:

```txt
urban/town/service area: 10-20 miles
parks/trails: 25-50 miles
remote overland regions: 50-100 miles
route day context: around day stop or destination
```

Ranking formula:

```txt
score =
  text_match * 4
+ distance_score * 3
+ category_intent * 3
+ rating_score * 2
+ review_count_score * 1
+ price_presence_bonus
+ image_presence_bonus
- stale_cache_penalty
```

Category matching examples:

```txt
trail / hiking area -> hiking tours, national park tours, nature walks, shuttles
water / river -> rafting, boat tours, kayaking, fishing, scenic cruises
scenic / park -> sightseeing, photography, wildlife, bus/van tours
climbing -> climbing guide, canyoning, via ferrata where available
Moab/offroad -> jeep, UTV, canyon, rafting, national park tours
family trip -> family-friendly, easy duration, free cancellation if available
rainy-day backup -> museums, attractions, food tours, indoor activities
```

---

## 12. Planner integration

Add support so a user can save a tour into the TrailHead planner.

Planner stop shape:

```txt
type: bookable_experience
source: viator
source_id
name
lat/lng if available
booking_url
day
notes
estimated_duration
price_from
status: saved / booked_external / needs_booking
```

The app should not claim the user booked unless TrailHead receives a confirmed booking flow in a future Full + Booking integration.

For Basic Access:

```txt
status = saved or needs_booking
CTA = Book on Viator
```

---

## 13. Future in-app booking path

Do not implement now, but keep the architecture ready.

Future requirement:

```txt
Viator Full + Booking Access
approval/certification required
payment solution selected
booking endpoints enabled
refund/cancellation flow supported
customer support policy understood
```

Potential future checkout options:

```txt
embedded iFrame if Viator supports it for approved access
custom checkout flow with Viator booking endpoints
```

Until TrailHead has Full + Booking Access, keep all checkout external to Viator.

---

## 14. Other source ideas for later

Keep Viator as first provider. Later source packs can include:

```txt
GetYourGuide: tours/activities, likely gated partner access
Amadeus Tours and Activities: destination experiences, attraction tickets, deep links
Tiqets: attraction tickets and experiences
Musement: experiences/activities with merchant or affiliate models
OpenTripMap: open tourism POI context, not booking-focused
Geoapify: OSM-backed POIs/services, not booking-focused
Tripadvisor official Content API: live enrichment only unless terms allow caching
Google Places: live enrichment only for current hours/ratings/photos/place details; do not use as cached base DB
RapidAPI/Apify scraper sources: internal research/coverage audit only until rights are confirmed
```

---

## 15. Tests and fixtures

Add fixtures:

```txt
tests/fixtures/explore_sources/viator_yosemite_sample.json
tests/fixtures/explore_sources/viator_moab_sample.json
tests/fixtures/explore_sources/viator_empty_sample.json
```

Tests should cover:

```txt
Viator fixture loads
normalization creates BookableExperience records
source badge is Viator
primary action is Book on Viator
booking_url or affiliate_url is preserved
no API key returns empty safely
API failure does not crash
cache policy is partner_api_ingest
expired cache refresh decision works
ranking prefers closer/relevant/rated/image-backed cards
planner save shape is valid
```

Acceptance examples:

```txt
Yosemite Explore detail shows Tours & Experiences rail when fixture has results
Moab Explore detail shows jeep/rafting/canyon-style experiences when fixture has results
Empty results hide the rail or show a small safe empty state
Cards always show source
Cards always send checkout to Viator for Basic Access
No TypeScript errors
No backend crash without API key
```

---

## 16. Implementation priority

1. Add normalized travel/experience schema.
2. Add Viator fixture normalizer.
3. Add Viator client with env-var config and safe no-key behavior.
4. Add builder script outputting `dashboard/explore_bookable_experiences_v1.json`.
5. Add API endpoint or document exact API wiring if backend structure is unclear.
6. Add mobile Tours & Experiences rail in Explore detail.
7. Add planner save shape for external booking cards.
8. Add tests/fixtures.
9. Leave in-app checkout for future Full + Booking Access.

---

## 17. Suggested command shape

Use the actual repo command structure if different.

```bash
python scripts/explore_sources/travel/viator/import_viator.py --fixture tests/fixtures/explore_sources/viator_yosemite_sample.json --out dashboard/explore_tours_viator_v1.json
python scripts/build_explore_catalog_v3.py --include-experiences dashboard/explore_tours_viator_v1.json --out dashboard/explore_catalog_v3.json
python -m pytest tests/test_viator_sourcepack.py
```

If pytest is not configured, add lightweight script-level tests or document the exact manual validation command.

---

## 18. Deliverables

Codex should return:

```txt
files added
files changed
env vars required
sample fixture used
sample output paths
commands run
tests run
known limitations
next steps for Full Access or Full + Booking Access
```

Expected deliverables:

```txt
BookableExperience schema
Viator source-pack folder
Viator client with safe no-key behavior
Viator fixture normalizer
Viator import script
cache policy helper
ranking helper
sample dashboard output
Explore detail Tours & Experiences rail
planner save shape for external booking card
tests/fixtures
```

---

## 19. Final instruction

Build the Viator Tours & Experiences source pack as an external-booking affiliate integration first.

Show the source clearly.

Send users to Viator for checkout.

Do not implement in-app booking until TrailHead has Viator Full + Booking Access and the required approval/certification.
