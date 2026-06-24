# Trailhead Copilot Outdoor Commerce + Adventure Logic Upgrade Plan

**Date:** 2026-06-24  
**Branch:** `codex/copilot-outdoor-commerce-upgrade-plan`  
**Codex target:** implement in staged passes, with audit notes after each stage.  
**Working name:** **Trailhead Copilot Adventure Commerce OS**

---

## 0. Executive direction

Trailhead should not become a generic tour affiliate app. The product should become the outdoor operating layer between:

```txt
Outdoor intent -> route/day context -> conditions/safety -> bookable things -> gear/rig readiness -> offline navigation -> rewards/unlocks
```

The Copilot upgrade should make Trailhead feel like a field-aware outdoor assistant:

```txt
"You're spending two days near Moab, have off-road trails saved, and tomorrow is clear.
I found a UTV tour, a river rafting option, and a gear/air-compressor stop that fit your route.
Want me to show the best three?"
```

This plan uses everything already discussed:

- Viator sandbox/Basic first, Full Access later.
- Tours, safaris, guided hikes, fishing charters, rafting, Jeep/UTV, boat, kayak/SUP, climbing, shuttles.
- Gear and rig recommendations: hiking gear, water filters, dry bags, recovery boards, compressors, tire repair, roof/rack parts.
- Contextual partner recommendations and sponsored pins, but never hidden ads.
- Adventure DNA and intent logic so Copilot does not need manual rules for every destination.
- Offline meeting-point/routing packs as Trailhead's unique advantage.
- Mission Control / route scout / map / Explore integration.

---

## 1. Current repo anchors

Before coding, Codex must inspect and preserve the current architecture.

### Existing relevant files

```txt
docs/adventure-app-production-readiness-plan.md
docs/explore-ui-redesign/TRAILHEAD_VIATOR_TOURS_SOURCEPACK_CODEX_DIRECTIONS.md
dashboard/server.py
dashboard/provider_registry.py
dashboard/adventure_intelligence.py
scripts/explore_sources/travel/schema.py
scripts/explore_sources/travel/ranking.py
scripts/explore_sources/travel/viator/client.py
scripts/explore_sources/travel/viator/normalize_viator.py
mobile/lib/api.ts
mobile/app/(tabs)/guide.tsx
mobile/app/(tabs)/map.tsx
mobile/components/explore/ExploreExperiencesRail.tsx
mobile/components/map/MapLayerSheetContent.tsx
mobile/components/NativeMap/routing.ts
mobile/modules/valhalla-routing/
mobile/modules/tile-server/
```

### Current scaffolding to reuse

- `BookableExperience` already exists in `scripts/explore_sources/travel/schema.py`.
- Viator env parsing already exists in `scripts/explore_sources/travel/viator/client.py`.
- Experience ranking already exists in `scripts/explore_sources/travel/ranking.py`.
- `ExploreExperiencesRail.tsx` already displays bookable cards.
- `mobile/lib/api.ts` already has client methods for Explore experiences.
- `provider_registry.py` already has provider metadata, confidence, source freshness, offline rules, and prohibited systematic sources.
- The app already has Valhalla/offline tile modules and map layer UI patterns.

### Major constraint

Do not add more large business logic to `mobile/app/(tabs)/map.tsx`. New logic should live in extracted modules/components and backend providers.

---

## 2. Product principles

### 2.1 Copilot should narrate deterministic logic, not invent the business logic

The LLM should not guess which tour, gear item, or operator is best. Backend deterministic systems should calculate:

```txt
place DNA
user intent
route context
weather/conditions
nearby inventory
gear/rig needs
ranking score
commercial disclosure
safe next action
```

Copilot then explains the result in natural language.

### 2.2 Never hide commercial relationships

Use clear labels:

```txt
Partner pick
Sponsored
Paid link
Explore may earn
Operator-sponsored unlock
Checkout with partner
```

Never make paid pins look like official agency data, safety alerts, route hazards, or community reports.

### 2.3 No place-by-place manual world database

Do not teach Copilot:

```txt
Moab -> Jeep tour
Yellowstone -> wildlife tour
Hunza -> glacier trek
Serengeti -> safari
```

Instead teach it a reusable framework:

```txt
classify destination DNA
infer trip/user intent
match nearby inventory
rank using context
ask only when useful
```

### 2.4 Offline navigation is the moat

Any saved/booked external activity should be converted into a Trailhead offline readiness pack:

```txt
meeting point
parking note
route to meeting point
arrival buffer
offline map/routing availability
what to bring
operator contact
bad-signal warning
```

---

## 3. Core data models

### 3.1 Destination / Place DNA

Add a backend model that classifies any place, route stop, park, camp, trail, city, or user search.

```ts
type AdventureDNA = {
  place_id: string;
  title: string;
  lat?: number;
  lng?: number;
  source_ids: string[];

  scores: {
    hiking: number;
    trekking: number;
    trail_running: number;
    camping: number;
    overlanding: number;
    offroad: number;
    rv: number;
    wildlife: number;
    safari: number;
    fishing: number;
    boating: number;
    paddling: number;
    climbing: number;
    snow: number;
    scenic: number;
    photography: number;
    family_easy: number;
    culture: number;
    urban_reset: number;
    beach_island: number;
    desert: number;
    mountain: number;
    forest: number;
    water: number;
  };

  evidence: Array<{
    source: string;
    reason: string;
    confidence: number;
    freshness?: string;
  }>;

  warnings: string[];
  confidence: number;
  updated_at: number;
};
```

### 3.2 User / Trip Intent

This should be session/trip-specific, not permanent profiling by default.

```ts
type AdventureIntent = {
  session_id?: string;
  trip_id?: string;
  current_mode: 'planning' | 'driving' | 'camping' | 'hiking' | 'exploring' | 'town_reset' | 'unknown';

  scores: {
    hiking: number;
    camping: number;
    overlanding: number;
    offroad: number;
    rv: number;
    fishing: number;
    boating: number;
    climbing: number;
    wildlife: number;
    photography: number;
    family: number;
    luxury: number;
    budget: number;
    gear_ready: number;
    rental_needed: number;
  };

  signals: Array<{
    kind: 'query' | 'saved_place' | 'route' | 'map_layer' | 'copilot_message' | 'planner_stop' | 'weather' | 'profile';
    value: string;
    weight: number;
  }>;

  confidence: number;
  updated_at: number;
};
```

### 3.3 Outdoor Offer

Generalize `BookableExperience` into a wider commerce/recommendation object.

```ts
type OutdoorOfferType =
  | 'tour'
  | 'activity'
  | 'safari'
  | 'guide'
  | 'camping'
  | 'rv_rental'
  | 'vehicle_rental'
  | 'luggage_storage'
  | 'gear'
  | 'rig_part'
  | 'shuttle'
  | 'permit'
  | 'pass'
  | 'food'
  | 'rental'
  | 'operator_deal'
  | 'service';

type DisclosureKind =
  | 'organic'
  | 'affiliate'
  | 'partner'
  | 'sponsored'
  | 'operator_sponsored_unlock';

type OutdoorOffer = {
  id: string;
  provider: string;
  provider_offer_id: string;
  type: OutdoorOfferType;

  title: string;
  subtitle?: string;
  description?: string;
  image_url?: string;

  lat?: number;
  lng?: number;
  region?: string;
  distance_mi?: number;
  route_distance_mi?: number;

  price_from?: string;
  currency?: string;
  rating?: number;
  review_count?: number;

  booking_url?: string;
  affiliate_url?: string;
  canonical_url?: string;

  disclosure_kind: DisclosureKind;
  disclosure_label: string;
  commission_model?: 'cpa' | 'revshare' | 'flat' | 'unknown';
  estimated_commission_cents?: number;

  activity_tags: string[];
  condition_tags: string[];
  gear_tags: string[];
  rig_tags: string[];

  placement_rules: {
    allow_map_pin: boolean;
    allow_route_brief: boolean;
    allow_explore_rail: boolean;
    allow_gear_checklist: boolean;
    max_impressions_per_trip?: number;
  };

  why_recommended?: string;
  source_freshness?: string;
  fetched_at?: number;
  expires_at?: number;
  raw?: unknown;
};
```

### 3.4 Copilot Recommendation Brief

This is what backend returns to Copilot.

```ts
type CopilotRecommendationBrief = {
  context_id: string;
  trip_id?: string;
  route_id?: string;
  place_id?: string;

  should_suggest: boolean;
  suggestion_timing: 'silent' | 'ask_now' | 'show_chip' | 'route_brief_only' | 'defer';
  reason: string;

  destination_dna: AdventureDNA;
  intent: AdventureIntent;

  sections: Array<{
    title: string;
    kind: 'tours' | 'gear' | 'rig' | 'storage' | 'rental' | 'services' | 'safety' | 'offline';
    summary: string;
    offers: OutdoorOffer[];
    max_visible: number;
  }>;

  spoken_prompt?: string;
  chips: string[];
  warnings: string[];
  disclosures: string[];
};
```

---

## 4. Logic engine

### 4.1 Destination DNA classification

Use source data, category words, nearby POI density, trail/water/public-land layers, and official sources.

Suggested backend file:

```txt
dashboard/adventure_dna.py
```

Pseudocode:

```py
def build_adventure_dna(place, nearby_features, provider_context):
    scores = empty_scores()
    evidence = []

    text = normalize_text([
        place.title,
        place.category,
        place.explore_group,
        place.region,
        place.tags,
        place.source_pack_titles,
    ])

    # Text/category signals
    add_if(text, ['trail', 'hike', 'trek'], 'hiking', 35, 'place text')
    add_if(text, ['jeep', '4x4', 'offroad', 'ohv'], 'offroad', 45, 'place text')
    add_if(text, ['river', 'lake', 'marina', 'boat'], 'boating', 30, 'place text')
    add_if(text, ['fish', 'fly fishing', 'angler'], 'fishing', 35, 'place text')
    add_if(text, ['safari', 'wildlife', 'game reserve'], 'safari', 55, 'place text')
    add_if(text, ['glacier', 'mountain', 'pass', 'peak'], 'mountain', 30, 'place text')

    # Nearby feature density
    scores.hiking += min(35, nearby_features.trails_count * 3)
    scores.camping += min(30, nearby_features.camps_count * 2)
    scores.water += min(35, nearby_features.water_features_count * 2)
    scores.urban_reset += min(30, nearby_features.services_count)

    # Official source boosts
    if provider_context.has_nps_or_public_land:
        scores.hiking += 10
        scores.scenic += 10
    if provider_context.has_mvum_or_ohv:
        scores.offroad += 25
        scores.overlanding += 20

    # Normalize 0..100, preserve evidence, calculate confidence
    return AdventureDNA(...)
```

### 4.2 Intent inference

Suggested backend file:

```txt
dashboard/adventure_intent.py
```

Signals:

```txt
user query
current route stops
saved places
selected map mode
active filters
recent Copilot messages
planner day type
rig profile
weather/season
location movement pattern
```

Pseudocode:

```py
def infer_adventure_intent(query, route, saved_places, map_state, rig_context):
    scores = empty_intent_scores()
    signals = []

    if query_contains(query, ['camp', 'campground', 'boondock']):
        bump('camping', 40, 'query')
    if query_contains(query, ['trail', 'hike', 'trek']):
        bump('hiking', 45, 'query')
    if query_contains(query, ['jeep', 'offroad', '4x4', 'trail ride']):
        bump('offroad', 50, 'query')
    if query_contains(query, ['fish', 'charter', 'fly shop']):
        bump('fishing', 50, 'query')
    if route_has_unpaved_or_remote_context(route):
        bump('overlanding', 30, 'route')
        bump('gear_ready', 20, 'route')
    if rig_context:
        bump('rv' if rig_context.kind == 'rv' else 'overlanding', 20, 'profile')

    # saved places also contribute
    for place in saved_places:
        dna = place.adventure_dna
        merge_scores(scores, dna.scores, weight=0.25)

    return AdventureIntent(...)
```

### 4.3 Offer ranking

Suggested backend file:

```txt
scripts/explore_sources/offers/ranking.py
```

Ranking formula:

```txt
final_score =
  4.0 * intent_match
+ 3.0 * place_dna_match
+ 3.0 * route_relevance
+ 2.0 * distance_score
+ 1.5 * weather_match
+ 1.0 * time_fit
+ 1.0 * rating_review_confidence
+ 0.8 * image_price_completeness
+ 0.8 * offline_pack_value
+ 0.5 * partner_quality
- 2.5 * safety_conflict
- 1.5 * stale_price_or_availability
- 1.0 * commercial_fatigue
- 4.0 * hidden_or_missing_disclosure
```

Important: sponsored placement can break ties but must not beat a clearly safer or more relevant recommendation.

```py
def rank_outdoor_offers(offers, dna, intent, route_context, weather_context, user_state):
    ranked = []
    for offer in offers:
        score = 0
        score += 4.0 * match_offer_to_intent(offer, intent)
        score += 3.0 * match_offer_to_dna(offer, dna)
        score += 3.0 * route_relevance(offer, route_context)
        score += 2.0 * distance_score(offer, route_context.center)
        score += 1.5 * weather_fit(offer, weather_context)
        score += 1.0 * time_fit(offer, route_context.day_window)
        score += 1.0 * rating_review_confidence(offer)
        score += 0.8 * completeness_bonus(offer)
        score += 0.8 * offline_pack_bonus(offer)
        score -= 2.5 * safety_conflict(offer, weather_context, route_context)
        score -= 1.5 * stale_offer_penalty(offer)
        score -= 1.0 * fatigue_penalty(offer, user_state)
        score -= 4.0 if missing_required_disclosure(offer) else 0
        ranked.append((score, offer))
    return sorted(ranked, reverse=True)
```

### 4.4 When Copilot should ask

Suggested backend file:

```txt
dashboard/copilot_recommendation_policy.py
```

Rules:

```txt
Do ask when:
- user finishes a route plan
- user opens a destination/Explore hub
- user saves a place/trail/camp
- user has a route day with empty time
- user is near check-in/check-out gap
- user asks "what should we do"
- user asks about gear/prep
- user opens Mission Control and there is a useful action

Do not ask when:
- active turn-by-turn navigation is demanding attention
- safety alert is active
- user has dismissed this category recently
- confidence is low
- there are no real offers or useful gear/service suggestions
- it would appear as a hidden ad rather than a useful recommendation
```

Pseudocode:

```py
def should_copilot_suggest(context, top_offers, user_state):
    if context.active_navigation and context.maneuver_imminent:
        return ('silent', 'Do not interrupt navigation')
    if context.safety_critical_alert_active:
        return ('route_brief_only', 'Safety first')
    if user_state.dismissed_category_recently(context.category):
        return ('defer', 'User dismissed recently')
    if not top_offers and not context.gear_recommendations:
        return ('silent', 'No useful inventory')
    if context.confidence < 0.55:
        return ('show_chip', 'Low confidence; passive chip only')
    if context.just_finished_planning or context.opened_destination_detail:
        return ('ask_now', 'High-intent planning moment')
    return ('show_chip', 'Useful but not urgent')
```

---

## 5. Routing logic and offline packs

### 5.1 Route corridor context

Suggested backend/mobile shared concept:

```ts
type RouteCommerceContext = {
  route_id?: string;
  trip_id?: string;
  corridor_polyline?: GeoJSON.LineString;
  corridor_radius_mi: number;
  day_windows: Array<{
    day: number;
    start_lat?: number;
    start_lng?: number;
    end_lat?: number;
    end_lng?: number;
    overnight_lat?: number;
    overnight_lng?: number;
    free_time_hours?: number;
    drive_hours?: number;
  }>;
  route_tags: string[];
  unpaved_likely?: boolean;
  low_signal_likely?: boolean;
  weather_risk_tags: string[];
  service_gaps: string[];
};
```

### 5.2 Offer-to-route matching

An offer can be relevant if any are true:

```txt
within X miles of route corridor
within X miles of day stop
near overnight/camp
near destination hub
near trailhead/start/end
fills service gap: fuel, water, storage, repair, rental
solves weather issue: rainy-day backup, heat, smoke, tide window
solves gear issue: water, rain, recovery, snow, dry bag
```

Default radii:

```txt
urban/town: 5-15 mi
trail/park: 20-50 mi
remote overland route: 50-100 mi
route-day stop: 10-40 mi
service gap: along route + next safe detour
```

### 5.3 Offline meeting-point pack

Any saved external tour/activity/operator/rental should create an optional offline pack.

```ts
type OfflineMeetingPointPack = {
  offer_id: string;
  provider: string;
  title: string;
  meeting_lat?: number;
  meeting_lng?: number;
  meeting_address?: string;
  parking_note?: string;
  arrival_buffer_min: number;
  download_state: {
    map_tiles: 'missing' | 'partial' | 'ready';
    road_routing: 'missing' | 'partial' | 'ready';
    trail_graph: 'missing' | 'partial' | 'ready';
    place_details: 'missing' | 'partial' | 'ready';
    weather_cache: 'missing' | 'stale' | 'ready';
  };
  what_to_bring: string[];
  operator_contact?: string;
  bad_signal_warning?: string;
};
```

### 5.4 Navigation safeguards

- External booking card should never claim the user is booked unless Trailhead has a real booking confirmation.
- Status values:

```txt
saved
needs_booking
booking_external_opened
booked_unverified
booked_confirmed_future_api
cancelled_future_api
```

- If provider access is sandbox/Basic, use `needs_booking` and `Book with partner`.
- Offline pack is a Trailhead feature, not a claim about provider availability.

---

## 6. Copilot behavior design

### 6.1 Copilot prompt style

Good prompt:

```txt
"Since you're spending 2 days near Moab and saved off-road trails, I found a few route-fit options: a UTV tour, a rafting trip, and a 4x4 outfitter stop. Want to see the top three?"
```

Bad prompt:

```txt
"Buy a tour now."
```

### 6.2 Copilot action chips

```txt
Show top 3
Add to Day 2
Save for later
Gear checklist
Hide partner picks
Only free/official options
Download offline pack
```

### 6.3 Copilot commands

```txt
"Find tours near this route"
"Any safaris near our stop?"
"What gear do I need for this hike?"
"Find a shuttle to this trailhead"
"Show things to do if it rains"
"Any guided fishing near here?"
"Find rig parts before the dirt road"
"Add this tour to day 3"
"Download offline route to the meeting point"
```

### 6.4 Copilot must explain why

Every recommendation needs one sentence:

```txt
"This is 4.2 mi from your Day 2 stop and matches your off-road route."
"This is a rainy-day backup near your current town."
"This gear is recommended because the hike is exposed, 8.7 mi, and has no water refill after the trailhead."
"This storage option fits your 5-hour gap before check-in."
```

### 6.5 Copilot commercial disclosure examples

```txt
"This is a partner booking; Trailhead may earn from the referral."
"This is sponsored by the operator."
"Paid link. Trailhead may earn from purchases."
"Checkout happens with Viator. I can still save the meeting point and offline route here."
```

---

## 7. App surfaces

### 7.1 Explore detail

Upgrade `ExploreExperiencesRail` into a generalized recommendation module:

```txt
Recommended nearby
Bookable experiences
Gear for this stop
Rig and outdoor services
Storage and transport
Operator deals
```

Do not remove existing Viator rail behavior; wrap it in generalized `OutdoorOfferRail` once the backend is ready.

Suggested files:

```txt
mobile/components/offers/OutdoorOfferRail.tsx
mobile/components/offers/OutdoorOfferCard.tsx
mobile/components/offers/OfferDisclosure.tsx
mobile/components/offers/GearChecklistCard.tsx
mobile/components/offers/OfflineMeetingPointCard.tsx
```

### 7.2 Route Builder / Planner

Add a section per day:

```txt
Day 2 suggestions
- Morning wildlife tour
- Rain backup
- Trailhead shuttle
- Gear/rig readiness
- Offline meeting-point pack
```

### 7.3 Mission Control

Add only as next actions, never as noise.

```txt
MISSION CONTROL
Ready:
- Route preview
- Offline map pack

Needs review:
- Day 2 has 5-hour open window near park entrance
- Rain after 3 PM

Useful next actions:
[Show route-fit activities]
[Gear checklist]
[Download offline]
```

### 7.4 Map pins

Add a new map layer group:

```txt
Recommended
Partner places
Sponsored deals
Gear & rig
Tours
Rentals
Storage
Services
```

Density caps:

```txt
max_sponsored_pins_per_viewport = 1
max_partner_pins_per_viewport = 3
hide_sponsored_below_zoom = 10
never_cover_route_line = true
never_style_as_safety_alert = true
```

Pin visual rules:

```txt
Recommended: compass/sparkle icon
Partner pick: ticket/handshake icon
Sponsored: sponsor chip in sheet, muted marker on map
Gear/rig: backpack/wrench icon
Tour: ticket icon
Storage: bag icon
Rental: key/car/boat/bike icon
```

### 7.5 Gear/Rig checklist

Checklist categories:

```txt
Hiking/Trekking
- water capacity
- water filter
- poles
- sun/rain layer
- headlamp
- offline map

Water/Paddling
- dry bag
- PFD
- water shoes
- roof straps
- tide/current note

Overland/Rig
- air compressor
- tire repair kit
- recovery boards
- tow strap
- spare tire check
- water/fuel

Winter/Snow
- traction spikes
- insulated layer
- avalanche context where relevant
- shovel/probe/beacon only for proper backcountry context

City/travel gap
- luggage storage
- airport transfer
- walking tour
- food/indoor backup
```

### 7.6 Partner/admin later

Add a simple admin/provider tool later:

```txt
Partner operator record
Partner deal record
Sponsored budget/cap
Coupon code
Commission type
Sponsored Explore unlock
Meeting point data
What-to-bring list
Operator support contact
```

---

## 8. Provider and API strategy

### 8.1 Viator

Use current sandbox/Basic-style architecture first.

Env vars:

```txt
VIATOR_API_KEY=
VIATOR_PARTNER_ID=
VIATOR_AFFILIATE_ID=
VIATOR_API_BASE_URL=https://api.viator.com/partner
VIATOR_ENABLE_LIVE=false
VIATOR_CACHE_TTL_HOURS=24
VIATOR_SANDBOX_MODE=true
```

Implementation rule:

```txt
No key or live disabled -> safe empty rail
Sandbox -> fixture/sandbox response
Basic -> external checkout only
Full Access -> richer metadata, still external checkout
Full + Booking -> future only, after approval/certification
```

Links:

```txt
https://docs.viator.com/partner-api/
https://partnerresources.viator.com/travel-commerce/levels-of-access/
https://partnerresources.viator.com/travel-commerce/affiliate/
```

### 8.2 Other travel/activity partners

Add provider stubs first, live access later.

```txt
GetYourGuide: https://api.getyourguide.com/
Klook partners: https://www.klook.com/en-US/partner/
FareHarbor API partners: https://fareharbor.com/scale/affiliate-api-partners/
Rezdy Agent API: https://developers.rezdy.com/rezdyapi/index-agent.html
Bókun: https://www.bokun.io/
```

### 8.3 Outdoor monetization partners

Start as affiliate/deep-link/offline config providers, not live product APIs.

```txt
Bounce: luggage storage
RVshare: RV rentals
Outdoorsy: camper/RV rentals
The Dyrt: PRO referral
Outdooractive: subscription/referral
REI / outdoor retailers: gear
Backcountry / specialty gear: gear
Rig/overland stores: recovery gear, roof racks, compressors, tire repair, cargo systems
Local operators: direct tracked links/codes
```

### 8.4 Open/official data providers

Keep using provider registry rules. Add no scraping.

```txt
NPS API
RIDB/Recreation.gov
USFS / BLM / USGS
NWS
NOAA Tides/Currents
NASA FIRMS / WFIGS
AirNow / OpenAQ where applicable
OSM / Overture / OpenTripMap / Geoapify / Foursquare where terms allow
```

---

## 9. Reward and unlock system

### 9.1 Reward model

```ts
type OfferReward = {
  id: string;
  offer_id?: string;
  provider: string;
  trigger:
    | 'click'
    | 'booking_pending'
    | 'booking_completed'
    | 'operator_code_redeemed'
    | 'manual_admin_approved';
  min_order_value_cents?: number;
  reward_type:
    | 'explore_pro_days'
    | 'offline_pack'
    | 'trip_pass'
    | 'credits'
    | 'route_pack';
  reward_value: number;
  status: 'available' | 'pending' | 'granted' | 'expired' | 'rejected';
};
```

### 9.2 Reward tiers

```txt
Completed partner booking over $50  -> 7 days Explore Pro
Completed partner booking over $100 -> 1 month Explore Pro
Completed partner booking over $200 -> 3 months Explore Pro
Completed partner booking over $400 -> 6 months Explore Pro
2+ completed trip bookings          -> Trip Pass unlock
Operator-sponsored deal             -> operator funds unlock
```

### 9.3 Important rule

Do not grant high-value unlocks solely on click unless it is intentionally a marketing promo. For affiliate networks, prefer completed booking/conversion reporting or coupon-code redemption.

---

## 10. Tracking and attribution

Add commerce telemetry before scaling partners.

Events:

```txt
commerce_offer_impression
commerce_offer_click
commerce_offer_save
commerce_offer_redirect
commerce_offer_dismiss
commerce_offer_reward_pending
commerce_offer_reward_granted
commerce_map_pin_seen
commerce_map_pin_tapped
copilot_recommendation_prompted
copilot_recommendation_accepted
copilot_recommendation_declined
```

Payload:

```ts
type CommerceEvent = {
  event_id: string;
  user_id?: string;
  session_id?: string;
  trip_id?: string;
  route_id?: string;
  place_id?: string;
  offer_id: string;
  provider: string;
  placement:
    | 'copilot'
    | 'mission_control'
    | 'explore_detail'
    | 'map_pin'
    | 'route_brief'
    | 'gear_checklist'
    | 'planner';
  disclosure_kind: DisclosureKind;
  activity_context?: string[];
  route_distance_mi?: number;
  sub_id: string;
  created_at: number;
};
```

Sub-ID pattern:

```txt
th_{placement}_{provider}_{activity}_{geo_hash}_{session_short}
```

Examples:

```txt
th_copilot_viator_offroad_9q8yy_ab12
th_map_bounce_citywalk_drs5r_92bd
th_gear_rei_desert_hike_9q9j3_1ff0
```

---

## 11. Codex implementation stages

### Stage 0 — Audit and route mapping

Deliverable:

```txt
docs/copilot-outdoor-commerce-stage-0-audit.md
```

Tasks:

- Confirm whether backend Explore experience endpoints exist.
- Map current Viator sourcepack state.
- Confirm mobile usage of `ExploreExperiencesRail`.
- Identify safe integration points in `guide.tsx`, Mission Control, route builder, and map components.
- Do not change behavior yet.

Validation:

```bash
python3 -m py_compile dashboard/server.py
cd mobile && npx tsc --noEmit
```

### Stage 1 — Complete Viator sandbox/external checkout path

Deliverable:

```txt
docs/copilot-outdoor-commerce-stage-1-viator.md
```

Tasks:

- Add env vars to `.env.example` and `config/settings.py` if missing.
- Add or verify endpoints:
  - `GET /api/explore/places/{place_id}/experiences`
  - `GET /api/explore/experiences`
  - `GET /api/explore/experiences/{experience_id}`
- Ensure no API key/live disabled returns safe empty state.
- Add fixture/sandbox support.
- Keep checkout external.
- Add tracking for click/save/redirect.
- Ensure source/disclosure shown.

Validation:

```bash
python3 -m unittest tests.test_viator_sourcepack
python3 -m py_compile dashboard/server.py
cd mobile && npx tsc --noEmit
```

### Stage 2 — OutdoorOffer core model

Deliverable:

```txt
docs/copilot-outdoor-commerce-stage-2-offers.md
```

Tasks:

- Add `scripts/explore_sources/offers/schema.py`.
- Add provider base interface.
- Add `BookableExperience -> OutdoorOffer` adapter.
- Add disclosure helper.
- Add ranking helper.
- Add backend response shape.
- Add tests.

Suggested files:

```txt
scripts/explore_sources/offers/__init__.py
scripts/explore_sources/offers/schema.py
scripts/explore_sources/offers/ranking.py
scripts/explore_sources/offers/disclosure.py
scripts/explore_sources/offers/providers/base.py
scripts/explore_sources/offers/providers/viator.py
tests/test_outdoor_offers.py
```

### Stage 3 — Adventure DNA + intent engine

Deliverable:

```txt
docs/copilot-outdoor-commerce-stage-3-dna-intent.md
```

Tasks:

- Add `dashboard/adventure_dna.py`.
- Add `dashboard/adventure_intent.py`.
- Reuse provider registry confidence.
- Make deterministic outputs for place, route, trip, and query contexts.
- Add tests with fixtures for:
  - Moab/offroad/desert
  - Yellowstone/wildlife/park
  - Hunza/trekking/glacier
  - Tanzania/safari/wildlife
  - coastal/water/paddling
  - urban reset/check-in gap

### Stage 4 — Copilot recommendation brief

Deliverable:

```txt
docs/copilot-outdoor-commerce-stage-4-copilot.md
```

Tasks:

- Add backend endpoint:
  - `POST /api/copilot/recommendations`
  - or fold into existing Extreme Copilot/Mission Control route if cleaner.
- Return `CopilotRecommendationBrief`.
- Add policy: ask now/show chip/silent/defer.
- Add Copilot action staging:
  - show offers
  - save offer
  - add to day
  - download offline pack
  - hide partner picks
- Ensure LLM narrates deterministic data only.

### Stage 5 — Gear and rig checklist

Deliverable:

```txt
docs/copilot-outdoor-commerce-stage-5-gear-rig.md
```

Tasks:

- Add rules engine.
- Add affiliate-safe product slots.
- Add "already owned" toggles on mobile.
- Add `GearChecklistCard`.
- Add paid link disclosure.
- Start with static affiliate links/config, not live shopping APIs.

### Stage 6 — Recommended/sponsored map pins

Deliverable:

```txt
docs/copilot-outdoor-commerce-stage-6-map-pins.md
```

Tasks:

- Add `CommercePinLayer` and `CommercePinSheet`.
- Use existing layer sheet pattern.
- Add density caps.
- Add disclosure labels.
- Never style as safety/official/community pins.
- Add map legend entries.

Suggested files:

```txt
mobile/components/map/CommercePinLayer.tsx
mobile/components/map/CommercePinSheet.tsx
mobile/components/map/commercePinStyles.ts
mobile/lib/commercePins.ts
```

### Stage 7 — Reward/unlock system

Deliverable:

```txt
docs/copilot-outdoor-commerce-stage-7-rewards.md
```

Tasks:

- Add pending reward model.
- Add reward display.
- Add manual/admin redeem path.
- Do not auto-grant from click unless promo.
- Support future affiliate conversion reports/webhooks.

### Stage 8 — Provider expansion stubs

Deliverable:

```txt
docs/copilot-outdoor-commerce-stage-8-provider-expansion.md
```

Tasks:

- Add disabled/configured providers:
  - GetYourGuide
  - Klook
  - FareHarbor
  - Rezdy
  - Bókun
  - Bounce
  - RVshare
  - Outdoorsy
  - The Dyrt
  - Outdooractive
  - gear affiliate
  - rig parts affiliate
- Keep them disabled unless keys/config exist.
- Add provider metadata entries.
- Add contact links and env names.

### Stage 9 — Partner/operator admin

Deliverable:

```txt
docs/copilot-outdoor-commerce-stage-9-partner-admin.md
```

Tasks:

- Add admin data model for direct operator deals.
- Add coupon/link support.
- Add sponsored budget/caps.
- Add offline meeting point fields.
- Add operator-sponsored Explore unlock.

---

## 12. Codex kickoff prompt

Use this prompt with Codex:

```txt
You are working in the Trailhead repo.

Read first:
1. AGENT_WORKFLOW.md
2. docs/adventure-app-production-readiness-plan.md
3. docs/explore-ui-redesign/TRAILHEAD_VIATOR_TOURS_SOURCEPACK_CODEX_DIRECTIONS.md
4. docs/copilot-outdoor-commerce-upgrade-plan.md
5. dashboard/provider_registry.py
6. dashboard/server.py
7. mobile/lib/api.ts
8. mobile/components/explore/ExploreExperiencesRail.tsx
9. mobile/components/map/MapLayerSheetContent.tsx

Implement the next smallest shippable stage.

Rules:
- Do not add more business logic to map.tsx unless there is no alternative.
- Keep checkout external for Viator sandbox/Basic.
- No in-app booking until provider Full + Booking approval exists.
- Every commercial recommendation must show source/disclosure.
- Never make paid/sponsored content look like official data, safety alerts, or community reports.
- LLM should narrate deterministic recommendations, not invent them.
- Preserve provider registry source/freshness/confidence behavior.
- Add tests and an audit note after each stage.
- Run backend compile and mobile typecheck before concluding.

Start with Stage 0, then Stage 1.
```

---

## 13. Validation commands

Backend:

```bash
python3 -m py_compile dashboard/server.py
python3 -m py_compile dashboard/provider_registry.py
python3 -m unittest tests.test_viator_sourcepack
python3 -m unittest tests.test_outdoor_offers
```

Mobile:

```bash
cd mobile
npx tsc --noEmit
npm run audit:routes
```

Repo hygiene:

```bash
git diff --check
```

Manual QA locations:

```txt
Moab, UT
Yosemite National Park
Yellowstone National Park
Hunza / Skardu
Serengeti / Arusha
Banff / Canadian Rockies
Iceland route town
Florida Keys / coastal water
Sparse rural route with no offers
Urban check-in gap scenario
```

---

## 14. Example end-to-end flows

### 14.1 Moab off-road

Input:

```txt
User plans 2 days in Moab, saves Hell's Revenge, Fins & Things, and dispersed camp candidates.
```

Backend:

```txt
DNA: offroad 95, desert 85, scenic 80, camping 70
Intent: offroad 90, overlanding 75, gear_ready 65
Offers: Jeep/UTV, rafting, 4x4 outfitter, compressor/recovery gear
```

Copilot:

```txt
"Since you saved off-road routes near Moab, I found a few route-fit options: a UTV tour, a rafting trip, and a 4x4 outfitter stop. Want to see the top three?"
```

### 14.2 Yellowstone wildlife

Input:

```txt
User plans 3 days near Yellowstone and saves Lamar Valley.
```

Backend:

```txt
DNA: wildlife 95, scenic 85, hiking 65, photography 80
Intent: wildlife 70, photography 60, family_easy maybe 30
Offers: wildlife safari, photo tour, guided hike, bear-safety gear checklist
```

Copilot:

```txt
"Lamar Valley is a strong wildlife area. I found a sunrise wildlife tour and a photo-friendly route option near your Day 2 stop. Want to compare them?"
```

### 14.3 Hunza / glacier trekking

Input:

```txt
User searches Hunza and adds Passu / Attabad / Khunjerab.
```

Backend:

```txt
DNA: mountain 95, trekking 90, culture 70, scenic 85
Intent: trekking 70, scenic 70, logistics 55
Offers: glacier trek, lake boat, cultural guide, high-altitude gear checklist
```

Copilot:

```txt
"This route has mountain and trekking signals. I can show glacier guides, Attabad Lake options, and a gear checklist for cold/high-altitude days."
```

### 14.4 Safari region

Input:

```txt
User plans Arusha to Serengeti.
```

Backend:

```txt
DNA: safari 100, wildlife 100, scenic 70
Intent: safari 80, lodging/transport 60
Offers: 1-day safari, 3-day safari, balloon safari, transfer, luggage storage if needed
```

Copilot:

```txt
"You're near safari inventory for this route. I found day safaris, multi-day safaris, and a balloon option. Want me to show only ones that fit your dates?"
```

### 14.5 City check-in gap

Input:

```txt
User arrives in Lisbon at 9 AM; lodging check-in is 3 PM.
```

Backend:

```txt
Intent: urban_reset 80, walking 60
Offers: luggage storage, walking tour, food tour, transit/transfer
```

Copilot:

```txt
"You have a few hours before check-in. I found luggage storage and a walkable local experience near your route. Want to add one?"
```

---

## 15. Non-negotiables

- Do not scrape AllTrails, Hipcamp, Mountain Project, iOverlander, WikiCamps, or other prohibited systematic sources.
- Do not make paid placements look organic without disclosure.
- Do not show stale pricing/availability as live/current.
- Do not claim a booking is confirmed when checkout happened externally.
- Do not recommend unsafe activities during active weather/fire/water risk without warning.
- Do not interrupt active driving/navigation with commerce prompts.
- Do not bury official safety, closure, route, or weather signals below commercial offers.
- Do not add noisy map clutter; commerce pins must have layer toggles, density caps, and legends.

---

## 16. Definition of done

The upgrade is successful when:

```txt
Copilot can infer place/activity intent without manual per-destination rules.
Explore shows useful bookable experiences and gear/service recommendations.
Route Builder can suggest activities/services by day and route context.
Mission Control can include offers as next actions, not noise.
Map can show recommended/partner/sponsored pins with clear labels and caps.
Gear/rig checklist is useful without purchase links and monetizable with paid links.
External booking flow is honest and safely tracked.
Offline meeting-point packs make Trailhead more valuable than a normal affiliate click.
Provider registry defines source/freshness/disclosure rules for every partner.
All recommendations have a why, source, freshness, and confidence/disclosure line.
```
