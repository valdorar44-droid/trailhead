# TrailHead Explore UI Redesign — Codex Directions

Audience: Codex / TrailHead engineering  
Task type: focused mobile Explore redesign  
Primary file to read first: `TRAILHEAD_EXPLORE_CATALOG_RESEARCH_AND_RECOMMENDATIONS.md`

---

## 0. What this task is

Redesign the TrailHead Explore catalog and Explore detail screens so the current seed packs feel richer now, while preparing the UI for the future ExplorePlace v3 catalog.

This is a **UI + display helper + fallback logic task**.

This is **not** a huge data-import task yet.

Do not start importing OSM, RIDB, NPS, USFS, BLM, OpenBeta, Wikidata, or other large datasets in this pass. The research brief defines that long-term direction, but this pass should make the existing 400-ish Explore places look and behave much better.

---

## 1. Required context

Read the research brief first:

```txt
TRAILHEAD_EXPLORE_CATALOG_RESEARCH_AND_RECOMMENDATIONS.md
```

Use it for:

- ExplorePlace v3 direction
- category taxonomy
- search aliases
- smart-card fallback copy
- source/trust/quality labels
- data-source policy rules
- future import architecture
- acceptance tests

Then inspect the current repo.

Important files:

```txt
mobile/app/(tabs)/guide.tsx
mobile/lib/api.ts
scripts/explore_seed_v2.json
scripts/build_explore_catalog.py
scripts/sync_explore_catalog_from_seed.py
dashboard/explore_catalog_v1.json
```

Also inspect existing shared UI/theme files, especially anything like:

```txt
mobile/components/TrailheadUI.tsx
mobile/lib/design.ts
mobile/lib/store.ts
mobile/lib/storage.ts
```

---

## 2. Visual references

Use the attached screenshots/mockups as visual references.

Reference set:

```txt
current_explore_home.jpeg
current_yosemite_detail_summary.png
current_yosemite_detail_hero.jpeg
mock_explore_home.png
mock_yosemite_detail.png
mock_trails_panel.png
mock_waterfall_detail.png
```

Design intent from these references:

- Keep TrailHead’s outdoor/adventure feel.
- Keep the strong hero image style.
- Keep the orange TrailHead accent.
- Make cards feel more useful and less like simple static place names.
- Surface value before the user taps.
- Make the detail screen feel like an Explorer Hub, not a plain info page.
- Make category-specific detail modules possible: campgrounds, trails, waterfalls, huts, climbing, fuel, viewpoints.

---

## 3. Hard constraints

Do not break existing behavior.

Preserve:

```txt
explore_seed_v2.json compatibility
sync_explore_catalog_from_seed.py behavior
build_explore_catalog.py behavior unless small safe changes are needed
current /api/explore/catalog behavior
current /api/explore/places behavior
current audio guide behavior
current Show Area behavior
current nearby campground rail behavior
current bottom nav behavior
current cached catalog behavior
```

Do not remove or rewrite unrelated app areas.

Do not perform large imports.

Do not scrape:

```txt
AllTrails
Hipcamp
Glamping Hub
Mountain Project
iOverlander
WikiCamps
Protected Planet / WDPA
public OSM tiles
public Nominatim
```

Do not invent official facts.

Never invent:

```txt
live open/closed status
exact fee
reservation availability
permit status
road closure status
official safety warning
exact season
```

unless the current API/source data actually provides it.

Use safe wording like:

```txt
Verify access
Check official source
Confirm seasonal status
Use live map results
Offline maps recommended
```

---

## 4. Main product goal

The current Explore cards are underselling the product.

Current card pattern is too weak:

```txt
Yosemite Campgrounds
CA
Wikipedia source pack
```

The user does not care about “Wikipedia source pack” at card level. They care about:

```txt
What is this?
Why should I tap it?
What can I do here?
Can I route to it?
Can I save it?
Are there nearby camps/trails/views/fuel?
Is it official, curated, community, or basic map data?
What should I verify?
```

Redesign Explore so the catalog feels like:

```txt
Outdoor discovery engine
Explorer hubs
Smart cards
Source-aware planning cards
Route/map/audio-ready adventure guide
```

not:

```txt
basic list of campgrounds
```

---

## 5. Explore home redesign requirements

### 5.1 Hero/search

Update the Explore hero/search area so the placeholder teaches users what Explore supports.

Use copy like:

```txt
Search camps, huts, trails, peaks, waterfalls, fuel...
```

or:

```txt
Search camps, trails, huts, waterfalls, fuel...
```

Keep the mountain/adventure hero style.

Avoid crowding the hero with too many controls.

Search should remain obvious and tappable.

### 5.2 Category chips

Replace or expand the current chip row.

New browse chips:

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

Use horizontal scrolling chips with icons.

Keep chip labels short.

Suggested label shortening:

```txt
Camping -> Camp
Huts & Lodging -> Huts
Waterfalls -> Falls if space is tight
Hot Springs -> Springs if space is tight
Public Land -> Land if space is tight
```

Do not require all categories to have current data. Empty categories should not crash.

### 5.3 Featured / Near Me / Trip mode

Keep:

```txt
Featured
Near Me
Trip
```

Improve hierarchy and spacing.

This should feel like a mode switch, not another content row.

### 5.4 Filter/status row

Add a small row below the mode tabs.

Recommended controls:

```txt
417 shown
Official + Community
Sort: Best match
```

These can be light UI controls for now. They do not need advanced filtering yet, but must not crash.

If source filtering is not implemented yet, use a safe static/default label.

### 5.5 Featured card redesign

Redesign Explore catalog cards so they show user value.

Each card should show:

```txt
category pill
image
save/bookmark icon
title
region/state/country
source/trust badge
short value line
quick facts
primary actions
```

Example card:

```txt
Yosemite Campgrounds
CA · Sierra Nevada
Official + community sources
Good for overnight planning near Yosemite NP.

Quick facts:
24 campgrounds nearby
Best May–Oct
Offline ready

Actions:
Area | Save | Route
```

If exact values are missing, use safe fallbacks:

```txt
Verify access
Offline maps recommended
Source details available
Good route anchor
```

### 5.6 Do not lead with “Wikipedia source pack”

Keep source data, but do not make “Wikipedia source pack” the main visible card tagline.

Better labels:

```txt
Curated guide
Official + community
Source details
Planning card
Basic map data
Needs verification
```

Show detailed source/freshness lower in detail screen.

### 5.7 Section naming

Change the feel of the sections.

Better names:

```txt
Featured Explorer Hubs
Popular Categories
Nearby Adventure Types
Campgrounds Near Explore Areas
Trail Areas
Waterfalls & Scenic Stops
Huts & Backcountry Stays
Peaks & Viewpoints
Fuel & Resupply
```

Use current data where available. Use safe empty states where not.

---

## 6. Explore detail redesign requirements

Redesign the detail screen to match the Yosemite and Waterfall mockups.

Keep:

```txt
hero image
close/back action
Play Audio
Show Area
nearby campgrounds
source/freshness info
Full Story / Summary behavior
bottom nav
```

### 6.1 Hero area

Hero should show:

```txt
category + region
large title
optional quality/rating/trust line
save/share buttons if easy and safe
```

Example:

```txt
CAMPING · CA
Yosemite Campgrounds
Great for overnight planning
```

Waterfall example:

```txt
WATERFALLS · CA
Yosemite Falls
Iconic scenic stop
```

### 6.2 Primary actions

Show two large buttons below hero:

```txt
Play Audio
Show Area
```

Keep current audio authorization/paywall behavior.

### 6.3 Tabs

Add segmented tabs:

```txt
Summary
Full Story
Nearby
Sources
```

If four tabs are too much for first pass, implement:

```txt
Summary
Full Story
Nearby
```

and keep Source & Freshness as a section in Summary.

### 6.4 Summary highlight card

Add a large highlight card directly below tabs.

Use category-based copy.

Campground/hub example:

```txt
Good for overnight planning near Yosemite NP.
Use this to check access, fees, closures, and overnight rules before you commit to dates.
```

Waterfall example:

```txt
A must-see waterfall with scenic viewpoints, seasonal flow, and nearby hiking access.
```

Trail example:

```txt
Popular trail area with route planning, difficulty, distance, and nearby scenic stops.
```

Hut example:

```txt
Backcountry stay or shelter anchor. Confirm access, condition, reservations, and weather before relying on it.
```

Climbing example:

```txt
Climbing area or crag. Confirm access, route information, closures, land-manager rules, and current conditions.
```

Fuel/resupply example:

```txt
Useful service stop for route planning. Verify hours, availability, road access, and payment options.
```

Do not invent exact facts.

### 6.5 Quick fact tiles

Inside or below the highlight card, show 3–4 quick fact tiles.

Possible facts:

```txt
24 campgrounds nearby
May–Oct best season
Official + Community sources
Offline ready
7 viewpoints nearby
12 trails nearby
Parking nearby
Fuel 8–15 mi
Verify access
Source details
```

Only show exact numbers when real data exists.

Safe fallback fact tiles:

```txt
Verify access
Offline maps
Source details
Route anchor
Community reports
```

### 6.6 Why this stop matters

Convert long text blocks into cleaner cards.

Example:

```txt
Find a named campground near Yosemite National Park, not just a blank map search. Save time, avoid closures, and plan with confidence.
```

For waterfall:

```txt
This waterfall gives the route planner a scenic anchor with nearby viewpoints, trails, and weather context.
```

For trail:

```txt
This trail area helps turn a destination into a route-ready plan with distance, difficulty, nearby stops, and map context.
```

### 6.7 Source & Freshness

Keep Source & Freshness but make it more visual.

Use compact cards:

```txt
Official + curated sources
Updated June 14, 2026
Basic map data
Needs verification
```

Possible source badges:

```txt
Official source
Curated TrailHead
Wikipedia source pack
OpenStreetMap
Basic map data
Community verified
Needs verification
```

Keep original source text available, but make the visible user-facing label more helpful.

### 6.8 Category-specific nearby rails

Different categories should show different nearby modules.

Campground / camping hub:

```txt
Campgrounds in this area
Trails nearby
Views nearby
Fuel
Water
Weather
```

Waterfall:

```txt
Viewpoints & access nearby
Trails nearby
Parking
Weather
Water safety
```

Trail:

```txt
Trails in this area
Nearby points of interest
Waterfalls
Viewpoints
Add to Planner
```

Hut:

```txt
Huts, cabins & camps nearby
Trails nearby
Access notes
Weather
Offline maps
```

Climbing:

```txt
Climbing areas/routes nearby
Access notes
Weather
Land manager / source
Nearby services
```

Fuel/resupply:

```txt
Nearby services
Hours if known
Distance
Verify status
Route impact
```

For first pass, these can be visual modules powered by existing data + safe fallbacks.

---

## 7. V2/V3-compatible display helpers

Add helper functions so the UI can read both current v2 fields and future v3 fields.

Recommended helper functions:

```ts
getExploreDisplayTitle(place)
getExploreDisplayCategory(place)
getExploreDisplayRegion(place)
getExploreSourceBadge(place)
getExploreTrustBadge(place)
getExploreQuickFacts(place, context?)
getExploreCardSummary(place)
getExploreHighlightCopy(place)
getExploreBestSeason(place)
getExploreNearbyModules(place)
getExploreActions(place)
getExploreSearchText(place)
getExploreCategoryKey(place)
```

These helpers should prefer future v3 fields when present:

```txt
place.card
place.sources
place.quality
place.quality_score
place.search_aliases
place.category
place.subcategories
place.best_season
place.access
place.safety
```

But must fall back to current v2 fields:

```txt
place.summary
place.profile
place.facts
place.source_pack
place.audio_script
place.wiki_extract
```

Do not require backend changes before UI renders.

---

## 8. Category fallback templates

Use these safe templates when the data is sparse.

### Campground

```txt
Good for overnight planning. Verify access, fees, closures, fire restrictions, and overnight rules.
```

### Hut / shelter

```txt
Backcountry shelter or hut. Confirm condition, reservations, weather, and seasonal access before relying on it.
```

### Trail

```txt
Mapped trail or route. Check distance, difficulty, weather, daylight, permits, and closures before starting.
```

### Viewpoint

```txt
Scenic viewpoint. Good for route planning, photography stops, and nearby exploration.
```

### Peak

```txt
Summit or mountain landmark. Verify route, weather, access, and difficulty before attempting.
```

### Waterfall

```txt
Waterfall or cascade. Check trail access, seasonal flow, closures, and slippery terrain.
```

### Hot spring

```txt
Thermal feature. Confirm legality, access, temperature, water safety, and local rules.
```

### Climbing area

```txt
Climbing area or crag. Confirm access, closures, route information, land-manager rules, and current conditions.
```

### Fuel

```txt
Fuel or service stop. Verify hours, availability, road access, and payment options.
```

### Resupply

```txt
Resupply stop. Verify hours, inventory, payment options, and road access before depending on it.
```

---

## 9. Search and category behavior

Improve the current Explore search so it feels broader.

Search should match:

```txt
title
category
state
region
tags
profile summary
why_it_matters
card summary/headline when present
future v3 search_aliases when present
```

Add alias matching.

Alias groups:

```txt
camp -> campground, camping, campsite, tent, RV
dispersed camping -> boondocking, primitive camping, free camping, forest road camping
hut -> shelter, refuge, cabin, backcountry hut
trail -> hike, hiking, trek, trekking
view -> viewpoint, overlook, lookout, scenic view
peak -> summit, mountain
waterfall -> falls, cascade
hot spring -> thermal, soak
climb -> rock climbing, crag, bouldering
fuel -> gas, diesel, petrol
resupply -> grocery, gear, supplies
```

Helpful empty state:

```txt
No exact match. Try camp, trail, viewpoint, waterfall, hut, fuel, or hot spring.
```

Do not crash if a category has no current results.

---

## 10. Component extraction recommendation

If `guide.tsx` is too large, extract reusable components.

Suggested files:

```txt
mobile/components/explore/ExploreHero.tsx
mobile/components/explore/ExploreCategoryChips.tsx
mobile/components/explore/ExploreModeTabs.tsx
mobile/components/explore/ExploreFilterRow.tsx
mobile/components/explore/ExplorePlaceCard.tsx
mobile/components/explore/ExploreDetailSheet.tsx
mobile/components/explore/ExploreInfoTiles.tsx
mobile/components/explore/ExploreRail.tsx
mobile/components/explore/exploreDisplay.ts
```

Do not over-refactor unrelated code.

Keep the change focused.

---

## 11. Acceptance criteria

1. App still loads the current Explore catalog.
2. Existing 400+ places still render.
3. Current Yosemite Campgrounds card looks richer and no longer leads with `Wikipedia source pack`.
4. Tapping a card opens a redesigned detail screen with:
   - hero
   - Play Audio
   - Show Area
   - Summary / Full Story / Nearby tabs or equivalent
   - highlight card
   - quick facts
   - Why this stop matters
   - Source & Freshness
   - nearby rails/cards
5. Waterfall, trail, hut, campground, glamping, viewpoint, peak, climbing, fuel, and resupply categories have safe fallback card copy.
6. These searches do not break:
   - camping
   - trails
   - hiking
   - huts
   - waterfalls
   - fuel
   - glamping
   - viewpoints
   - peaks
   - climbing
   - hot springs
7. Bottom nav still works.
8. Explore remains selected in bottom nav.
9. No TypeScript errors.
10. No iOS safe-area/status-bar overlap.
11. No backend migrations unless strictly necessary for UI compatibility.
12. No large imports or scraping.
13. No invented official facts.

---

## 12. Implementation priority

Step 1: Inspect current Explore implementation.

```txt
mobile/app/(tabs)/guide.tsx
mobile/lib/api.ts
types used by ExplorePlaceProfile / ExploreCatalog
```

Step 2: Add v2/v3-compatible display helpers.

Step 3: Update search alias matching.

Step 4: Redesign category chips and filter/status row.

Step 5: Redesign Explore catalog cards.

Step 6: Redesign detail screen.

Step 7: Add category-specific fallback templates.

Step 8: Add safe empty states.

Step 9: Run available checks.

Examples:

```bash
npm run typecheck
npm run lint
npm test
```

Use the actual commands available in the repo.

Step 10: Return a summary of:

```txt
files changed
UI behavior changed
fallback behavior added
tests/checks run
backend/data import work intentionally skipped
```

---

## 13. Final instruction to Codex

Build the visible Explore redesign first.

The research brief defines the long-term catalog engine, but this task should make the current Explore experience look and feel like that future now.

The result should make a basic existing place like `Yosemite Campgrounds` feel like an Explorer Hub:

```txt
Yosemite Campgrounds
24 campgrounds nearby
official/community/source context
audio guide
show area
route/save actions
quick facts
access verification reminders
nearby trails/views/fuel/weather modules
```

Do this without breaking the existing catalog or requiring a full backend rewrite.
