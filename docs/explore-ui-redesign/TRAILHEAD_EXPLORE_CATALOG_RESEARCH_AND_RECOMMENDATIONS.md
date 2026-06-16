# TrailHead Explore Catalog Research & Recommendations

Date: 2026-06-16  
Audience: Codex / TrailHead engineering  
Purpose: Turn the current basic Explore seed catalog into a large, searchable, trustworthy outdoor discovery system.

---

## 0. Executive Summary

TrailHead already has the foundation for Explore:

- A seeded catalog file: `scripts/explore_seed_v2.json`
- A build/enrichment script: `scripts/build_explore_catalog.py`
- A sync script for curated seed updates: `scripts/sync_explore_catalog_from_seed.py`
- Mobile API methods for Explore catalog/place loading in `mobile/lib/api.ts`
- A mobile Explore/Guide UI in `mobile/app/(tabs)/guide.tsx`

The current system appears optimized around a curated v2 seed with cards, grouping, images, audio summaries, nearby camp rails, and lightweight search/ranking. The next step should **not** be “manually add thousands of places.” The next step should be to build a **multi-source Explorer Catalog pipeline** that can ingest open/official datasets, normalize them into a richer `ExplorePlace` schema, dedupe, score, generate useful cards, and expose better search.

Recommended direction:

1. Preserve backward compatibility with `explore_seed_v2.json`.
2. Add a new normalized `ExplorePlace v3` schema.
3. Add category/alias/search metadata so users can type natural outdoor terms like “hiking,” “glamping,” “K2 huts,” “waterfalls,” “hot springs,” “rock climbing,” “fuel,” or “dispersed camping.”
4. Use OpenStreetMap/Geofabrik as the global backbone, but **do not** bulk scrape OSM public tiles or Nominatim.
5. Add official U.S. source packs: RIDB/Recreation.gov, NPS, USFS, BLM.
6. Add specialized packs: OpenBeta for climbing, Wikidata for famous landmarks/aliases, Natural Earth for base geographic context.
7. Avoid scraping proprietary consumer apps such as AllTrails, Hipcamp, GlampingHub, Mountain Project, and iOverlander unless TrailHead has permission, a license, or a partner agreement.
8. Add smart card generation so even sparse imported POIs become useful cards.

The product goal: TrailHead Explore should become a **universal outdoor search engine**, not only a campground browser.

---

## 1. Current Repo Observations

### 1.1 Current seed shape

`explore_seed_v2.json` is a schema v2 catalog named `Trailhead Explore`. It contains grouped entries such as `camping`, with simple array-style records like place name, base area/park, and state. This is useful for a curated list but too thin for large-scale global search.

Current limitation:
- Entries are mostly destination/group seeds, not rich POIs.
- Search is limited by the fields available in generated summaries/profiles.
- The data model does not yet expose enough category aliases, access metadata, quality tiers, or source IDs for large multi-source merging.

### 1.2 Current build system

`build_explore_catalog.py` currently describes itself as building the seeded Explore catalog from Wikipedia page summaries and outputting JSON so the API can serve it and mobile can cache it as a future downloadable place-pack shape.

This is a strong architecture hint: keep the “downloadable place-pack” idea, but make the builder source-agnostic.

### 1.3 Current sync system

`sync_explore_catalog_from_seed.py` is designed for curated additions without network enrichment. It preserves generated cards, creates missing seed cards from fallback metadata, refreshes rank/group fields, and writes `dashboard/explore_catalog_v1.json`.

Recommendation:
- Keep this as the “small curated update” flow.
- Add a separate import/normalize/build pipeline for large external datasets.

### 1.4 Current mobile Explore surface

`mobile/lib/api.ts` already has methods for:

- `getExploreCatalog()`
- `getExplorePlaces(...)`
- `getExploreCampgrounds(...)`
- `getNearbyCamps(...)`
- `getCampsBbox(...)`
- `getOsmPois(...)`
- `getNearbyPlaces(...)`
- place-card resolving/search-card methods

`guide.tsx` already has:
- Category buttons
- Explore mode state: featured / nearby / trip
- Explore query state
- Cached catalog loading
- Nearby fallback loading
- Trust scoring
- Query scoring
- Distance-based ranking
- Place cards with image, badge, source line, summary, show-area, and audio play
- Nearby campground rails

This means the UI is already close to supporting a bigger catalog. The main missing pieces are richer source data, richer schema, stronger aliases, more category chips, and server-side search.

---

## 2. Product Goal

Build an Explorer Catalog where users can search or browse:

- Campgrounds
- Dispersed camping
- RV parks
- Glamping
- Cabins
- Huts
- Wilderness shelters
- Trails
- Trailheads
- Viewpoints
- Peaks
- Waterfalls
- Hot springs
- Rock climbing
- Bouldering
- Caves
- Lakes
- Rivers
- Beaches
- Scenic drives
- Off-road routes
- Historic sites
- National parks
- State parks
- Public lands
- Wildlife areas
- Boat launches
- Fishing spots
- Picnic areas
- Visitor centers
- Water sources
- Fuel
- Resupply
- Food
- Lodging
- Road closure / danger areas

Users should be able to type natural searches like:

- `camping near Moab`
- `glamping colorado`
- `hiking near me`
- `K2 huts`
- `Hunza viewpoints`
- `Skardu fuel`
- `rock climbing utah`
- `waterfalls near Asheville`
- `hot springs idaho`
- `trailheads around Banff`
- `backcountry shelters`
- `off road routes`
- `visitor center yosemite`
- `dispersed camping forest road`

---

## 3. Recommended Architecture

### 3.1 Split catalog building into source packs

Recommended folder structure:

```txt
scripts/
  explore_sources/
    base/
      schema.py
      normalize.py
      dedupe.py
      quality.py
      cards.py
      aliases.py
      source_policy.py

    osm/
      import_osm_extract.py
      import_overpass_region.py
      tag_mapping.json

    nps/
      import_nps.py

    ridb/
      import_ridb.py

    usfs/
      import_usfs.py

    blm/
      import_blm.py

    openbeta/
      import_openbeta.py

    wikidata/
      import_wikidata.py

    natural_earth/
      import_natural_earth.py

    local/
      pakistan_adventure_pack.json
      karakoram_hunza_seed.json

  build_explore_catalog_v3.py
  sync_explore_catalog_from_seed.py
  explore_seed_v2.json
```

Pipeline:

```txt
Raw source data
  ↓
Source-specific importer
  ↓
Normalized ExplorePlace v3 candidate
  ↓
Dedupe / merge
  ↓
Quality scoring
  ↓
Smart card generation
  ↓
Search alias generation
  ↓
Catalog pack output
  ↓
API / mobile cache / offline pack
```

### 3.2 Keep two flows

#### Flow A: Curated/manual flow

Use for hand-picked TrailHead content, Pakistan/K2/Hunza seed packs, editorial features, and launch collections.

```txt
explore_seed_v2.json or local curated pack
  → sync_explore_catalog_from_seed.py
  → generated cards preserved
```

#### Flow B: Large import flow

Use for OSM, RIDB, NPS, USFS, BLM, OpenBeta, Wikidata, Natural Earth.

```txt
source pack importers
  → normalized v3
  → dedupe
  → cards/search
  → explore_catalog_v3.json
```

---

## 4. ExplorePlace v3 Schema Recommendation

See `explore_place_schema_v3.json` in this package.

Core requirements:

```txt
id
source_ids
name
category
subcategories
lat
lng
geometry
country
region
admin
summary
description
tags
search_aliases
search_blob
difficulty
best_season
access
safety
amenities
reservations
media
card
sources
quality
quality_score
verified
last_seen_at
updated_at
```

### 4.1 Quality levels

Use explicit quality levels so the UI can show trust badges:

```txt
basic_map_data
open_community_data
official_source
curated_trailhead
ai_enriched
community_verified
```

### 4.2 Source badges

Recommended badges:

```txt
Basic map data
OpenStreetMap
Official source
Open climbing data
Curated TrailHead
AI guide
Community verified
Needs verification
```

### 4.3 Sparse-card support

Every place should have a usable card even when the source has only a name/category/coordinate.

For example, an OSM-only wilderness hut:

```txt
Category: Hut
Source badge: Basic map data
Headline: Backcountry shelter or mountain hut
Summary: This mapped hut or shelter can help anchor route planning in the area. Confirm access, condition, reservation rules, and seasonal availability before relying on it.
Quick facts:
- Remote shelter location
- Conditions may change
- Offline maps recommended
Actions:
- Show Area
- Route
- Save
- Download Map
- Ask Trail Guide
- Report Update
```

---

## 5. Category System

Recommended canonical categories:

```txt
campground
dispersed_camp
rv_park
glamping
cabin
hut
shelter
trail
trailhead
viewpoint
peak
waterfall
hot_spring
climbing_area
bouldering_area
cave
lake
river
beach
scenic_drive
offroad_route
historic_site
national_park
state_park
public_land
wildlife_area
boat_launch
fishing_spot
picnic_area
visitor_center
water_source
fuel
resupply
food
lodging
danger_zone
road_closure_area
```

Recommended browse chips:

```txt
All
Camp
Glamping
Huts
Trails
Trailheads
Views
Peaks
Waterfalls
Hot Springs
Climb
Water
Scenic
Parks
Public Land
Fuel
Resupply
Nearby
```

Important UI note:
The current UI groups `water_scenic` into `water` and unknown categories into `parks`. That fallback is useful, but the new taxonomy should reduce overloading of `parks`.

---

## 6. Search Alias System

Search should not require exact category names. Add automatic aliases by category.

Examples:

```json
{
  "campground": ["camp", "camping", "campsite", "tent", "rv", "overnight"],
  "dispersed_camp": ["boondocking", "primitive camping", "free camping", "wild camping", "forest road camping"],
  "rv_park": ["rv", "motorhome", "camper", "hookups", "dump station"],
  "glamping": ["yurt", "dome", "safari tent", "luxury camping", "cabin stay"],
  "hut": ["shelter", "refuge", "mountain hut", "backcountry hut", "cabin"],
  "shelter": ["lean-to", "backcountry shelter", "wilderness shelter"],
  "trail": ["hike", "hiking", "trek", "trekking", "walk", "route"],
  "trailhead": ["start point", "parking", "hike start", "trail access"],
  "viewpoint": ["overlook", "scenic view", "lookout", "photo spot"],
  "peak": ["summit", "mountain", "ridge", "high point"],
  "waterfall": ["falls", "cascade"],
  "hot_spring": ["thermal spring", "soak", "hot pool"],
  "climbing_area": ["rock climbing", "crag", "climb", "routes"],
  "bouldering_area": ["boulder", "bouldering", "problems"],
  "scenic_drive": ["road trip", "byway", "scenic road", "drive"],
  "offroad_route": ["4x4", "overland", "ohv", "jeep trail"],
  "water_source": ["drinking water", "water refill", "potable"],
  "resupply": ["grocery", "outdoor store", "gear", "supplies"]
}
```

Search should match:

```txt
name
category
subcategories
tags
search_aliases
country
region
admin fields
summary
description
card headline
source names
alternate names
```

---

## 7. Ranking Recommendation

The current UI already calculates query score, trust score, and distance-aware ranking. Extend that logic with a server-side ranking endpoint.

Recommended endpoint:

```txt
GET /api/explore/search?q=&lat=&lng=&category=&limit=&source=&quality=
```

Recommended ranking formula:

```txt
final_score =
  text_score * 4.0
+ category_intent_score * 3.0
+ distance_score * 2.5
+ quality_score * 2.0
+ official_verified_bonus
+ popularity_or_importance_score
+ freshness_score
- stale_or_unverified_penalty
```

Text scoring:
- Exact name match
- Prefix name match
- Alias match
- Tag match
- Summary/card match
- Region match
- Fuzzy typo match

Distance scoring:
- If user location or map center is available, nearby results should rank higher.
- For trip mode, rank by distance to route/waypoints.
- For famous global landmarks, allow high quality/popularity to overcome distance when query is exact.

Recommended implementation:
- Short term: in-memory search over cached catalog for mobile plus API filtering.
- Medium term: Postgres `tsvector` + trigram index or SQLite FTS for offline packs.
- Long term: vector/semantic retrieval for broad terms like “quiet lake camping,” but only after the structured catalog is solid.

---

## 8. Data Source Research

### 8.1 OpenStreetMap / Geofabrik

Recommended use: **Primary global backbone.**

What it can provide:
- Campsites
- Caravan/RV sites
- Alpine huts
- Wilderness huts
- Shelters
- Viewpoints
- Peaks
- Waterfalls
- Hot springs
- Trails/routes
- Trailheads
- Climbing areas
- Water sources
- Fuel/resupply
- Visitor information
- Historic sites
- Protected/nature areas

Recommended ingestion method:
- Use Geofabrik `.osm.pbf` extracts for countries/regions.
- Use Overpass only for small targeted regions, testing, and refresh jobs.
- Do not use public OSM tiles as data source or offline tile source.
- Do not use public Nominatim for autocomplete, bulk geocoding, or systematic POI downloads.

Policy notes:
- OSM data is ODbL. TrailHead needs attribution and must track OSM-derived records.
- OSM public tiles have usage restrictions and are not for bulk/offline scraping.
- Nominatim public service is not for autocomplete or bulk/systematic data extraction.
- For complete POI sets, use planet files or regional extracts.

Suggested OSM mapping is in `osm_category_mapping.json`.

### 8.2 RIDB / Recreation.gov

Recommended use: **Official U.S. campground/recreation facility backbone.**

What it can provide:
- Federal recreation facilities
- Campgrounds
- Campsites
- Recreation areas
- Reservation-related data where available

Implementation note:
- TrailHead already has campsite APIs and IDs that look compatible with RIDB-style facility/site detail flows.
- Merge RIDB facilities with OSM campgrounds by normalized name + distance.
- RIDB/official data should generally outrank OSM-only campground records.

### 8.3 National Park Service API

Recommended use: **Official U.S. national park enrichment.**

What it can provide:
- Official NPS park data
- Park metadata
- Official URLs
- Alerts and visitor information, depending on available endpoints

Implementation note:
- Current `build_explore_catalog.py` already references `https://developer.nps.gov/api/v1`.
- Use NPS data to enrich park cards, visitor center cards, official links, alerts, and park-level context.
- Keep NPS as an enrichment layer, not the only source.

### 8.4 USDA Forest Service FSGeodata

Recommended use: **U.S. forest roads, trails, boundaries, recreation assets.**

What it can provide:
- National and regional geospatial datasets
- Forest boundaries
- Roads/trails
- recreation-related GIS layers depending on dataset

Implementation note:
- Use downloadable shapefile/geodatabase services where appropriate.
- Convert to normalized `ExplorePlace` records and route/line layers separately.
- Do not force every line feature into a card. Some should be map layers, not place cards.

### 8.5 BLM Geospatial Data

Recommended use: **Public lands, recreation sites, OHV/scenic/public-land context.**

What it can provide:
- BLM national/state geospatial data
- Public land boundaries
- recreation-related features depending on layer

Implementation note:
- Use as a source pack for public land context and BLM-managed recreation points.
- Add `land_manager = "BLM"` and source metadata.

### 8.6 OpenBeta

Recommended use: **Open climbing source candidate.**

What it can provide:
- Climbing areas
- Routes/crags where available
- Open climbing dataset/API/export options

Implementation note:
- Treat as a specialized climbing pack.
- Verify license for each specific dataset/export before production ingestion.
- Do not import from Mountain Project directly unless TrailHead has a license/permission.

### 8.7 Wikidata

Recommended use: **Global enrichment and aliases.**

What it can provide:
- Famous peaks, waterfalls, parks, lakes, heritage sites
- Alternate names
- Translations
- Coordinates
- External IDs
- Basic facts

Implementation note:
- Wikidata is useful for enrichment, aliases, and landmark discovery.
- Avoid using broad SPARQL queries as a production search API.
- Cache only what is needed and preserve source attribution.
- Use it to improve search for places like `K2`, `Chogori`, `Mount Godwin-Austen`, etc.

### 8.8 Natural Earth

Recommended use: **Base geographic context.**

What it can provide:
- Country/state/province boundaries
- Natural/cultural base layers
- General map context

Implementation note:
- Use for admin context, not detailed POI discovery.
- Good for region labeling, offline map context, and broad geographic hierarchy.

### 8.9 Protected Planet / WDPA

Recommended use: **Research only unless TrailHead obtains permission/license.**

What it can provide:
- Very broad global protected-area data.

Important warning:
- The legal terms restrict commercial use and redistribution without permission.
- Do not ingest WDPA/Protected Planet data into a commercial TrailHead catalog unless TrailHead has the correct permission/license.
- Use OSM, official government open data, Natural Earth, and land-manager sources first.

### 8.10 Proprietary consumer apps and sites

Do not scrape or ingest without permission:
- AllTrails
- Hipcamp
- Glamping Hub
- Mountain Project
- iOverlander
- WikiCamps
- Google Maps/Foursquare/Geoapify data beyond the provider’s allowed API terms

Use these only for:
- Competitive research
- UX inspiration
- Partnership/API discussions
- User-provided links where allowed

---

## 9. OSM Tag Mapping Recommendations

See `osm_category_mapping.json` in this package.

Core mappings:

```txt
tourism=camp_site              -> campground
tourism=caravan_site           -> rv_park
tourism=alpine_hut             -> hut
tourism=wilderness_hut         -> hut
amenity=shelter                -> shelter
tourism=viewpoint              -> viewpoint
natural=peak                   -> peak
waterway=waterfall             -> waterfall
natural=hot_spring             -> hot_spring
sport=climbing                 -> climbing_area
climbing=*                     -> climbing_area
highway=trailhead              -> trailhead
route=hiking                   -> trail
route=mtb                      -> trail
historic=*                     -> historic_site
boundary=protected_area        -> public_land / park candidate
leisure=nature_reserve         -> wildlife_area / public_land
amenity=drinking_water         -> water_source
amenity=fuel                   -> fuel
tourism=information            -> visitor_center
shop=outdoor                   -> resupply
shop=supermarket               -> resupply
shop=convenience               -> resupply
amenity=restaurant             -> food
amenity=cafe                   -> food
```

Important:
- Route relations and line features should be stored differently from point cards.
- For trails/scenic drives/off-road routes, create both:
  - A route/geometry layer
  - A representative card or collection card
- Avoid generating millions of low-quality line-feature cards unless the UI can handle it.

---

## 10. Dedupe and Merge Strategy

Recommended dedupe rules:

```txt
1. Same source + same source_id = same record.
2. Same normalized name + same category + within 150 meters = merge.
3. Same normalized name + compatible category + within 75 meters = merge candidate.
4. Campground from RIDB/Recreation.gov near OSM camp_site = merge sources.
5. NPS park + Wikidata landmark with same canonical name = merge enrichment only.
6. Trailhead near trail start = link, not merge.
7. Visitor center inside park = child place, not merge with park.
8. Hut/shelter/cabin near same coordinate = merge only if name/category compatible.
9. A viewpoint/peak/trail with same name may be different entities; do not merge unless geometry/name/category strongly match.
```

Keep all source references:

```json
"sources": [
  {
    "source": "osm",
    "source_id": "node/123456",
    "license": "ODbL-1.0",
    "url": "https://www.openstreetmap.org/node/123456"
  },
  {
    "source": "ridb",
    "source_id": "facility/9876",
    "license": "verify",
    "url": "..."
  }
]
```

Recommended normalized name helper:

```txt
lowercase
strip punctuation
remove generic suffixes when safe:
  campground, campgrounds, campsite, trailhead, trail, park, national park
collapse whitespace
normalize ampersand/and
normalize accents
```

---

## 11. Smart Card Generation

The biggest quality boost is generating useful cards for sparse records.

### 11.1 Card fields

```json
"card": {
  "headline": "",
  "summary": "",
  "quick_facts": [],
  "warnings": [],
  "best_for": [],
  "source_badge": "",
  "primary_action": "show_area",
  "secondary_actions": ["route", "save", "download_map", "ask_trail_guide", "report_update"]
}
```

### 11.2 Category templates

#### Campground

```txt
Headline: Campground or overnight outdoor stay
Summary: {{name}} is a mapped camping location in {{region}}. Check current access, fees, fire restrictions, reservations, and seasonal road conditions before driving in.
Quick facts:
- Camping / overnight stay
- Confirm availability before arrival
- Good candidate for offline map download
Warnings:
- Conditions, fees, and closures can change
```

#### Hut / shelter

```txt
Headline: Backcountry shelter or mountain hut
Summary: {{name}} is a mapped hut or shelter in {{region}}. Use it as a planning anchor, but confirm current condition, access rules, reservations, and weather before relying on it.
Quick facts:
- Remote shelter location
- Confirm access and condition
- Offline maps recommended
Warnings:
- Do not rely on sparse map data as a safety guarantee
```

#### Trail

```txt
Headline: Hiking or trail route
Summary: {{name}} is a mapped trail or route in {{region}}. Check current trail conditions, permits, weather, daylight, and navigation before starting.
Quick facts:
- Route/trail feature
- Conditions can change seasonally
- Carry offline maps and backup navigation
```

#### Viewpoint

```txt
Headline: Scenic viewpoint
Summary: {{name}} is a mapped scenic viewpoint in {{region}}, useful for route planning, photography stops, or nearby exploration.
Quick facts:
- Scenic stop
- Good for map browsing
- Check access and road conditions
```

#### Peak

```txt
Headline: Summit or mountain landmark
Summary: {{name}} is a mapped peak in {{region}}. Use it for geographic orientation and trip planning. Difficulty and access can vary widely.
Quick facts:
- Mountain or summit
- Weather can change quickly
- Verify route and access before attempting
```

#### Waterfall

```txt
Headline: Waterfall or cascade
Summary: {{name}} is a mapped waterfall in {{region}}. Check trail access, seasonal water flow, closures, and safety conditions before visiting.
Quick facts:
- Scenic water feature
- Flow may be seasonal
- Wet rock and steep terrain can be dangerous
```

#### Hot spring

```txt
Headline: Hot spring or thermal feature
Summary: {{name}} is a mapped hot spring in {{region}}. Confirm legality, access, water safety, temperature, and local rules before visiting.
Quick facts:
- Thermal feature
- Access may be sensitive
- Check safety and local rules
```

#### Climbing area

```txt
Headline: Rock climbing area
Summary: {{name}} is a mapped climbing area in {{region}}. Confirm access, route information, closures, land-manager rules, and current conditions before climbing.
Quick facts:
- Climbing area or crag
- Access rules may change
- Use current guide information
Warnings:
- Climbing is inherently risky
```

---

## 12. Mobile UI Recommendations

The existing Explore UI is already close. Recommended changes:

### 12.1 Expand category chips

Current chips should expand from:

```txt
Camping
Glamping
Huts & Lodging
Trails
Water
Parks
Services
Nearby
```

To:

```txt
All
Camp
Glamping
Huts
Trails
Trailheads
Views
Peaks
Waterfalls
Hot Springs
Climb
Water
Scenic
Parks
Public Land
Fuel
Resupply
Nearby
```

### 12.2 Improve card metadata

Every card should show:

```txt
Category pill
Source badge
Distance
Title
Region/state/country
One-line headline
Summary
Quick facts
Best season, if known
Difficulty, if known
Access note, if known
Trust/freshness line
Actions:
  Show Area
  Route
  Save
  Download Map
  Ask Trail Guide
  Report Update
```

### 12.3 Add empty-state repair

When a user searches and no results appear:

```txt
No exact match. Try:
- camp
- trail
- viewpoint
- waterfall
- hut
- fuel
- hot spring
```

Also show related category buttons and nearby broader results.

### 12.4 Add detail sheet tabs

For rich places:

```txt
Overview
Map
Nearby
Camp / Stay
Guide
Sources
Reports
```

---

## 13. Backend/API Recommendations

Add or extend endpoints:

```txt
GET /api/explore/catalog
GET /api/explore/places?mode=&lat=&lng=&limit=&category=
GET /api/explore/search?q=&lat=&lng=&category=&limit=
GET /api/explore/place/{id}
GET /api/explore/place/{id}/nearby?categories=
POST /api/explore/place/{id}/report-update
POST /api/explore/import/build
```

Search response should return:

```json
{
  "query": "k2 huts",
  "normalized_query": "k2 huts",
  "results": [
    {
      "place": {},
      "match_reason": "alias + region + category",
      "score": 0.91,
      "distance_mi": null,
      "source_badge": "Curated TrailHead"
    }
  ],
  "suggested_categories": ["hut", "trail", "peak"],
  "suggested_queries": ["K2 Base Camp", "Karakoram huts", "Skardu trailheads"]
}
```

---

## 14. Region Strategy

### 14.1 First test regions

Pick one U.S. and one international test region:

```txt
Utah or Colorado:
- Strong OSM + federal data
- Trails/camps/climbing/scenic drives
- Good test for RIDB/NPS/USFS/BLM

Pakistan / Karakoram / Hunza:
- Strong TrailHead differentiator
- OSM/Wikidata/manual curation
- Huts, treks, viewpoints, peaks, camps, fuel/resupply
```

### 14.2 Pakistan Adventure Pack

Recommended manual/curated pack themes:

```txt
K2 Base Camp corridor
Baltoro Glacier
Concordia
Askole
Skardu
Deosai
Fairy Meadows
Nanga Parbat viewpoints
Hunza Valley
Karimabad
Attabad Lake
Khunjerab Pass
Passu Cones
Shandur Pass
Gilgit services/resupply
fuel and road access points
```

For Pakistan, do not wait for an official API. Start with:
- OSM extraction
- Wikidata aliases/famous landmarks
- Curated manual pack
- Community reports
- AI-generated guide cards with clear “needs verification” badges

---

## 15. Implementation Phases

### Phase 0: Safety and compatibility

- Do not break `explore_seed_v2.json`.
- Keep `sync_explore_catalog_from_seed.py` working.
- Add v3 converter that maps existing v2 records into v3.
- Preserve current mobile UI contract or add backward-compatible fields.

### Phase 1: Schema, aliases, smart cards

- Add `ExplorePlace v3` schema.
- Add canonical categories.
- Add alias generation.
- Add smart card generation.
- Add source badges and quality scoring.
- Update mobile cards to show richer metadata when present.

### Phase 2: OSM import pilot

- Use Geofabrik extract for one test region.
- Import only high-value categories first:
  - camp_site
  - caravan_site
  - alpine_hut
  - wilderness_hut
  - shelter
  - viewpoint
  - peak
  - waterfall
  - hot_spring
  - climbing
  - trailhead
  - drinking_water
  - fuel
- Dedupe against existing seed.
- Build catalog pack.

### Phase 3: Official U.S. sources

- RIDB/Recreation.gov campgrounds/facilities.
- NPS parks/enrichment.
- USFS geodata.
- BLM geodata.
- Merge and source-rank official records above basic map data.

### Phase 4: Specialized enrichment

- OpenBeta climbing.
- Wikidata landmark aliases.
- Natural Earth geographic context.
- Region-specific curated packs.

### Phase 5: Community + AI layer

- Add “Report update” for every card.
- Let users improve access notes, closures, photos, water availability, road conditions.
- Give credits/reputation for verified updates.
- Use AI to produce guide summaries only after source data is normalized and attributed.

---

## 16. Acceptance Tests

Use these as Codex tests or manual QA.

### Search behavior

Queries should return useful results:

```txt
camping
rv camping
dispersed camping
glamping
huts
backcountry shelter
hiking
trailhead
views
waterfalls
hot springs
rock climbing
bouldering
fuel
resupply
K2 huts
Hunza viewpoints
Skardu fuel
Moab climbing
Utah scenic drive
Colorado 14ers
```

### Card behavior

Every result should have:

```txt
name
category
source badge
summary or generated fallback
quick facts
coordinates
show area action
source list or source note
quality level
```

### Source behavior

- OSM records show OSM attribution.
- Official records show official source badges.
- Proprietary scraped data is not included.
- Protected Planet/WDPA is not ingested unless license/permission exists.
- All source records retain source IDs.

### Dedupe behavior

- OSM campground + RIDB facility near same location should merge.
- Trailhead near trail should link, not merge.
- Peak and viewpoint with same name should not merge without strong evidence.
- Duplicate same source ID should merge.

---

## 17. Codex Implementation Prompt

Copy this into Codex:

```txt
You are working in the TrailHead repo. Build the next generation Explore Catalog system based on this research brief.

Current known files:
- scripts/explore_seed_v2.json
- scripts/build_explore_catalog.py
- scripts/sync_explore_catalog_from_seed.py
- dashboard/explore_catalog_v1.json
- mobile/lib/api.ts
- mobile/app/(tabs)/guide.tsx

Goal:
Upgrade Explore from a small curated seed into a scalable multi-source outdoor discovery catalog with rich searchable cards.

Requirements:
1. Preserve backward compatibility with schema_version 2 and existing mobile API contracts.
2. Add an ExplorePlace v3 schema and converter from v2 seed entries.
3. Add canonical categories:
   campground, dispersed_camp, rv_park, glamping, cabin, hut, shelter, trail, trailhead, viewpoint, peak, waterfall, hot_spring, climbing_area, bouldering_area, cave, lake, river, beach, scenic_drive, offroad_route, historic_site, national_park, state_park, public_land, wildlife_area, boat_launch, fishing_spot, picnic_area, visitor_center, water_source, fuel, resupply, food, lodging, danger_zone, road_closure_area.
4. Add search aliases by category so natural searches like hiking, huts, K2 huts, glamping, rock climbing, waterfalls, hot springs, fuel, and dispersed camping work.
5. Add smart card generation for sparse source records, including headline, summary, quick_facts, warnings, source_badge, and recommended actions.
6. Add OSM tag mapping in scripts/explore_sources/osm/tag_mapping.json.
7. Add source-pack architecture under scripts/explore_sources/ with base normalize/dedupe/quality/cards modules.
8. Start with an OSM importer that reads regional extracts or prepared GeoJSON/JSON fixtures. Do not scrape OSM public tiles or use public Nominatim for bulk.
9. Add dedupe logic:
   - same source_id merges
   - same normalized name + category + within 150m merges
   - OSM camp_site + RIDB facility near same point merges
   - trailhead near trail links rather than merges
10. Add quality_score and quality labels:
   basic_map_data, open_community_data, official_source, curated_trailhead, ai_enriched, community_verified.
11. Update mobile Explore categories/chips to include Camp, Glamping, Huts, Trails, Trailheads, Views, Peaks, Waterfalls, Hot Springs, Climb, Water, Scenic, Parks, Public Land, Fuel, Resupply, Nearby.
12. Update Explore cards to show richer v3 metadata when present while falling back to existing v2 summary/profile fields.
13. Add or prepare API endpoint /api/explore/search?q=&lat=&lng=&category=&limit= with text/category/distance/quality ranking.
14. Add tests/fixtures for search queries:
   camping, dispersed camping, glamping, huts, hiking, trailhead, viewpoints, waterfalls, hot springs, rock climbing, fuel, K2 huts, Hunza viewpoints.
15. Include source attribution fields for all imported sources.
16. Do not ingest proprietary consumer-app data unless a license/permission is explicitly configured.

Deliverables:
- schema module or JSON schema for ExplorePlace v3
- source-pack folder structure
- OSM mapping JSON
- alias generation
- smart card generation
- dedupe module
- v2-to-v3 conversion
- updated mobile card rendering/fallbacks
- tests/fixtures demonstrating search and card quality
```

---

## 18. Do Not Do

Avoid these mistakes:

```txt
Do not manually add 20,000 raw places before schema/search/cards are ready.
Do not scrape AllTrails, Hipcamp, GlampingHub, Mountain Project, or iOverlander.
Do not use public OSM tiles as a data source or offline tile source.
Do not use public Nominatim for autocomplete or bulk geocoding.
Do not ingest Protected Planet/WDPA into commercial TrailHead without permission/license.
Do not flatten trails/routes, parks, visitor centers, and campgrounds into one undifferentiated card type.
Do not hide source attribution.
Do not let AI invent access, fees, reservations, closures, or safety facts.
```

---

## 19. Source Notes for Engineering Review

These are the important external source notes behind this brief:

- OpenStreetMap data is ODbL. Use attribution and track derived records.
- Geofabrik provides downloadable OSM extracts and is better for bulk import than API scraping.
- OSM public tile servers have usage restrictions and are not for bulk/offline scraping.
- Public Nominatim usage policy forbids autocomplete and systematic/bulk data extraction.
- Overpass is useful for targeted OSM queries but not for country-scale nearly-all data extraction.
- OpenBeta is an open climbing data source candidate, but verify the exact data/export license before production use.
- Wikidata data is CC0 and very useful for aliases and famous landmarks.
- Natural Earth is public-domain base geographic data.
- Protected Planet/WDPA is comprehensive but has commercial-use and redistribution restrictions.
- AllTrails terms are not compatible with scraping/commercial reuse without consent.

Source URLs:
- https://osmfoundation.org/wiki/Licence
- https://operations.osmfoundation.org/policies/tiles/
- https://operations.osmfoundation.org/policies/nominatim/
- https://download.geofabrik.de/
- https://download.geofabrik.de/technical.html
- https://wiki.openstreetmap.org/wiki/Overpass_API
- https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dalpine_hut
- https://wiki.openstreetmap.org/wiki/Tag:sport%3Dclimbing
- https://ridb.recreation.gov/docs
- https://www.nps.gov/subjects/developer/api-documentation.htm
- https://data.fs.usda.gov/geodata/
- https://data.fs.usda.gov/geodata/edw/datasets.php
- https://www.blm.gov/services/geospatial/GISData
- https://docs.openbeta.io/
- https://github.com/OpenBeta
- https://www.wikidata.org/wiki/Wikidata:Data_access
- https://www.naturalearthdata.com/downloads/
- https://www.naturalearthdata.com/about/terms-of-use/
- https://www.protectedplanet.net/en/thematic-areas/wdpa?tab=WDPA
- https://www.protectedplanet.net/en/legal
- https://www.alltrails.com/terms
