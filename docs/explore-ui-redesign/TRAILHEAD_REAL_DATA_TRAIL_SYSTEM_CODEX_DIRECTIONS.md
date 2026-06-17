# TrailHead Real-Data Trail System — Codex Directions

Date: 2026-06-17  
Audience: Codex / TrailHead engineering  
Codex task name: `TRAILHEAD_REAL_DATA_TRAIL_SYSTEM_CODEX_DIRECTIONS.md`

---

## 0. Goal

Build the first real-data trail and outdoor POI pipeline for TrailHead.

TrailHead should feel like a rich trail/explore app, but the production data layer should come from open, official, licensed, user-owned, or TrailHead/community-owned sources.

The output should add a scalable ExplorePlace v3 foundation for trails, trailheads, campgrounds, waterfalls, viewpoints, peaks, huts, climbing areas, fuel, resupply, and nearby points of interest.

---

## 1. Read first

Read these files before coding:

```txt
docs/explore-ui-redesign/TRAILHEAD_EXPLORE_CATALOG_RESEARCH_AND_RECOMMENDATIONS.md
docs/explore-ui-redesign/TRAILHEAD_EXPLORE_UI_REDESIGN_CODEX_DIRECTIONS.md
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

Current repo context:

- TrailHead already has a seeded Explore catalog and build/sync scripts.
- Mobile Explore already has category chips, fallback display helpers, search aliasing, trust scoring, query scoring, nearby rails, audio guide support, and detail card surfaces.
- The missing piece is a scalable source-pack importer that turns real source data into normalized ExplorePlace v3 records and trail geometry records.

---

## 2. Source policy

Use only permitted production sources:

```txt
OpenStreetMap / Geofabrik extracts: global backbone
Overpass API: small targeted refresh/testing only
RIDB / Recreation.gov: official U.S. recreation/campground backbone
National Park Service API: official U.S. national park enrichment
USFS FSGeodata: U.S. forest trails, roads, boundaries, recreation layers
BLM geospatial data: public land, OHV, recreation, land manager context
OpenBeta: open climbing source candidate
Wikidata / Wikipedia: landmarks, aliases, translations, context
Natural Earth: base geography/admin context
TrailHead curated packs: editorial/launch collections
TrailHead user GPX/trail reports: owned/community layer
```

Do not ingest proprietary consumer-app data unless TrailHead has explicit permission, a license, or a partnership agreement.

Do not use public OSM map tiles as a data source. Do not use public Nominatim for autocomplete, bulk geocoding, or systematic POI downloads.

---

## 3. Add source-pack architecture

Add:

```txt
scripts/explore_sources/
  base/
    __init__.py
    schema.py
    normalize.py
    dedupe.py
    quality.py
    cards.py
    aliases.py
    source_policy.py

  osm/
    __init__.py
    tag_mapping.json
    import_geofabrik.py
    import_overpass_region.py

  ridb/
    __init__.py
    import_ridb.py

  nps/
    __init__.py
    import_nps.py

  usfs/
    __init__.py
    import_usfs.py

  blm/
    __init__.py
    import_blm.py

  openbeta/
    __init__.py
    import_openbeta.py

  wikidata/
    __init__.py
    import_wikidata.py

scripts/build_explore_catalog_v3.py
```

Keep all existing v2 files and APIs working. Generate v3 outputs alongside v1 instead of replacing v1.

---

## 4. Data model

Add model types in `scripts/explore_sources/base/schema.py`.

### SourceRecord

Use for every imported raw/source feature.

```txt
id
source
source_id
source_url
license
attribution
fetched_at
last_seen_at
raw
name
category
subcategory
lat
lng
geometry
properties
confidence
```

### TrailGeometry

Use for route/line features. Do not force every line into a POI card.

```txt
id
source_ids
name
geometry_line
representative_lat
representative_lng
distance_mi
elevation_gain_ft
elevation_loss_ft
route_type
activities
difficulty
surface
access
allowed_uses
seasonal_notes
land_manager
source_quality
sources
linked_place_ids
```

### ExplorePlaceV3

Use for cards/search/detail surfaces.

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
linked_trail_ids
linked_place_ids
```

Quality labels:

```txt
basic_map_data
open_community_data
official_source
curated_trailhead
ai_enriched
community_verified
needs_verification
```

---

## 5. OSM / Geofabrik importer

Start with an importer that reads prepared OSM-derived GeoJSON/JSON fixtures. Design it so `.osm.pbf` support can be added later.

Add:

```txt
scripts/explore_sources/osm/import_geofabrik.py
scripts/explore_sources/osm/tag_mapping.json
```

The importer should:

```txt
read a fixture or extracted feature file
map OSM tags into TrailHead categories
preserve source id as node/way/relation id
preserve ODbL attribution fields
create SourceRecord objects
create ExplorePlaceV3 objects for point/card-worthy features
create TrailGeometry objects for route/line features
create representative cards for major trails/routes when useful
write JSONL or JSON output under data/explore/imports/ or dashboard/imports/
```

Core OSM tag mapping:

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
route=foot                     -> trail
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

Geometry rules:

```txt
route relations and line features should be stored separately from POI cards
trails/scenic drives/off-road routes may have both a route geometry and a representative Explore card
do not generate millions of low-quality line-feature cards
trailhead near trail should link to trail; do not merge them into one record
```

---

## 6. Dedupe and linking

Implement in:

```txt
scripts/explore_sources/base/dedupe.py
```

Rules:

```txt
1. Same source + same source_id = same record.
2. Same normalized name + same category + within 150 meters = merge.
3. Same normalized name + compatible category + within 75 meters = merge candidate.
4. Official campground near OSM camp_site = merge sources.
5. Official park + Wikidata landmark with same canonical name = merge enrichment only.
6. Trailhead near trail start = link, not merge.
7. Visitor center inside park = child place, not merge with park.
8. Hut/shelter/cabin near same coordinate = merge only if name/category compatible.
9. Viewpoint/peak/trail with same name may be different entities; do not merge unless geometry/name/category strongly match.
10. Waterfall, trail, and viewpoint with same name should link as related when appropriate, not automatically merge.
```

Keep every source reference with source, source_id, license, url, and attribution.

---

## 7. Smart card generation

Implement in:

```txt
scripts/explore_sources/base/cards.py
```

Every place should have a usable card even when source data is sparse.

Card fields:

```txt
headline
summary
quick_facts
warnings
best_for
source_badge
primary_action
secondary_actions
```

Use safe fallback copy. Do not invent live status, exact fees, reservation availability, permit status, road closures, official safety warnings, exact season, or dog/bike rules unless a source actually provides it.

Safe wording examples:

```txt
Verify access
Check official source
Confirm seasonal status
Use live map results
Offline maps recommended
```

Category fallback examples:

```txt
Trail: mapped trail or route; check current trail conditions, permits, weather, daylight, and navigation before starting.
Trailhead: mapped trail access point; confirm parking, road conditions, closures, daylight, and route details before starting.
Waterfall: mapped waterfall or cascade; check trail access, seasonal flow, closures, and slippery terrain.
Campground: mapped camping location; check access, fees, fire restrictions, reservations, and seasonal road conditions.
Hut/shelter: backcountry shelter or hut; confirm condition, reservations, weather, and seasonal access.
Climbing area: mapped climbing area or crag; confirm access, closures, route information, land-manager rules, and current conditions.
Fuel/resupply: mapped service stop; verify hours, availability, road access, and payment options.
```

---

## 8. Search aliases

Implement in:

```txt
scripts/explore_sources/base/aliases.py
```

Aliases:

```txt
campground: camp, camping, campsite, tent, rv, overnight
dispersed_camp: boondocking, primitive camping, free camping, wild camping, forest road camping
rv_park: rv, motorhome, camper, hookups, dump station
glamping: yurt, dome, safari tent, luxury camping, cabin stay
hut: shelter, refuge, mountain hut, backcountry hut, cabin
shelter: lean-to, backcountry shelter, wilderness shelter
trail: hike, hiking, trek, trekking, walk, route
trailhead: start point, parking, hike start, trail access
viewpoint: overlook, scenic view, lookout, photo spot
peak: summit, mountain, ridge, high point
waterfall: falls, cascade
hot_spring: thermal spring, soak, hot pool
climbing_area: rock climbing, crag, climb, routes
bouldering_area: boulder, bouldering, problems
scenic_drive: road trip, byway, scenic road, drive
offroad_route: 4x4, overland, ohv, jeep trail
water_source: drinking water, water refill, potable
fuel: gas, diesel, petrol, service station
resupply: grocery, outdoor store, gear, supplies
```

Search should match name, category, subcategories, tags, aliases, country, region, admin fields, summary, description, card headline, source names, alternate names, and linked trail names.

---

## 9. Build pipeline

Add:

```txt
scripts/build_explore_catalog_v3.py
```

Pipeline:

```txt
Raw source data
  -> Source-specific importer
  -> SourceRecord candidates
  -> Normalized ExplorePlaceV3 + TrailGeometry candidates
  -> Dedupe / merge / link
  -> Quality scoring
  -> Smart card generation
  -> Search alias + search_blob generation
  -> Catalog pack output
  -> API / mobile cache / offline pack
```

Initial outputs:

```txt
dashboard/explore_catalog_v3.json
dashboard/explore_trail_geometries_v1.json
dashboard/explore_source_records_sample.jsonl
```

---

## 10. First pilot regions

Use one U.S. and one international pilot.

U.S. pilot: Yosemite/Sierra Nevada or Utah/Moab.

Good for:

```txt
trails
trailheads
campgrounds
waterfalls
viewpoints
peaks
climbing
fuel/resupply
official U.S. source testing
```

International pilot: Pakistan/Karakoram/Hunza.

Good for:

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

For Pakistan, start with OSM extraction, Wikidata aliases/famous landmarks, curated manual pack, community reports, and generated guide cards with clear needs-verification badges.

---

## 11. Trail detail target

The app should eventually support rich trail detail screens from defensible sources.

Field strategy:

```txt
Distance: source geometry or computed geometry
Elevation gain: DEM later, or verify until sourced
Route type: inferred from geometry
Difficulty: source-specific if provided; otherwise verify grade
Typical time: computed estimate only, clearly labeled as estimate
Dogs / bikes / OHV: access tags + official restrictions when available
Highlights: nearby waterfalls, viewpoints, peaks, lakes, tags
Nearby POI: spatial query around trail geometry
Source badge: official source, OSM, open community, curated TrailHead, needs verification
```

---

## 12. Tests and fixtures

Add fixtures under:

```txt
tests/fixtures/explore_sources/osm_yosemite_sample.geojson
tests/fixtures/explore_sources/osm_pakistan_sample.geojson
tests/fixtures/explore_sources/ridb_sample.json
tests/fixtures/explore_sources/nps_sample.json
```

Tests should cover:

```txt
OSM tag mapping
source attribution preserved
dedupe same source/source_id
dedupe same name/category/nearby
trailhead near trail links but does not merge
official campground + OSM camp_site merge
peak/viewpoint/trail same name do not auto-merge
smart card fallback for sparse trail
smart card fallback for sparse hut
smart card fallback for waterfall
search aliases for hiking/trail/trailhead/waterfall/fuel/hut
quality score official > OSM-only
```

Acceptance search queries:

```txt
camping
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
Yosemite trails
Mist Trail
Vernal Fall
```

---

## 13. Implementation priority

1. Base schema and utilities.
2. OSM mapping and fixture importer.
3. V3 catalog builder that writes outputs alongside existing v1.
4. Fixture-driven tests.
5. Optional mobile/API compatibility only after builder works.

Do not break current mobile Explore v2 rendering.

---

## 14. Deliverables

Codex should return:

```txt
files added
files changed
new commands to run
sample fixture used
sample output paths
tests run
known limitations
next source pack to implement
```

Expected deliverables:

```txt
ExplorePlace v3 schema module
SourceRecord model
TrailGeometry model
source-pack folder structure
OSM mapping JSON
OSM fixture importer
alias generation
smart card generation
dedupe module
quality scoring module
v3 catalog builder
fixtures/tests demonstrating useful search and cards
```

Suggested command shape:

```bash
python scripts/build_explore_catalog_v3.py --source-fixture tests/fixtures/explore_sources/osm_yosemite_sample.geojson --out dashboard/explore_catalog_v3.json
python -m pytest tests/test_explore_sources.py
```

If pytest is not configured, add lightweight script-level tests or document the exact manual validation command.
