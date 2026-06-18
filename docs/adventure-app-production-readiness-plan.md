# Trailhead Adventure App Production Readiness Plan

**Codex destination:** `docs/adventure-app-production-readiness-plan.md`  
**Date:** 2026-06-18  
**Working title:** **Trailhead Adventure OS**

This is the next-stage plan after the Co-Pilot / Mission Control work. Treat it as a production program for turning Trailhead into a polished, smooth, full adventure app that can compete directionally with Gaia GPS, onX Offroad, AllTrails, The Dyrt, Waze, and Viator-style experiences without copying proprietary data or UI.

---

## 0. Executive Direction

Trailhead is no longer just a camping or trip-planning app. It is becoming an **Adventure OS**:

- Gaia/onX lane: topo/offroad/public-land/offline map utility.
- AllTrails lane: trail discovery, trail profiles, trail conditions, trail reviews, snap-to-trail planning.
- The Dyrt lane: camps, public land stays, private stays, trip stops, offline trip packs.
- Waze lane: community road/trail/camp reports, confirmation/“not there,” decay, on-route relevance.
- Viator lane: bookable experiences and activities near destinations, towns, parks, and route stops.
- Trailhead moat: Co-Pilot/Mission Control that fuses legal stay confidence, rig fit, route hazards, weather/fire/air/water risk, offline readiness, and community reliability into a route-aware brief.

The winning product does **not** need to clone competitors. It needs to become the app that answers:

1. **Can I legally go/stay here?**
2. **Can my rig get there?**
3. **What is actually relevant to this route tonight?**
4. **What do I need to download before signal dies?**
5. **What changed since people last went there?**
6. **What can I do around this stop?**

---

## 1. Current Repo Reality Check

The repo already has the foundation for this production program.

### 1.1 Existing production improvement doctrine

`docs/production-improvement-execution-plan.md` already says the next production work should focus on **trust, structure, and moat**, not feature sprawl. It also lists Phase 7 moat candidates:

- legal-stay confidence scoring
- rig-aware camp fit
- rig-aware route feasibility
- route-corridor hazard relevance
- contributor trust scoring
- trip memory across saves, reroutes, downloads, and field reports

Phase 7 is still unchecked. That is where this plan lands.

### 1.2 Map modularization is underway

Phase 6 has extracted major map UI surfaces:

- `RouteAlertsPanel`
- `MapDrawerSheet`
- `MapFilterSheet`
- `RouteScoutPanel`
- `MapStyleSheet`
- `MapWeatherPeek`
- `MapWeatherSheet`
- `MapLayerSheetContent`
- camp detail/review/nearby components

This means the next map polish should work **inside extracted components** instead of dumping more logic into `map.tsx`.

### 1.3 Filter sheet exists but needs a visual layer

`MapFilterSheet.tsx` already has sections for:

- Map Content
- Camps
- Places
- Water
- Camps & Stays
- Explore & Services
- Community Pins
- Weather & Layers

The missing production polish is:
- better visual “what this does” previews
- clearer legends
- map-mode presets that change filters/layers together
- fewer text-only rows
- better source/freshness/trust labels
- route-aware defaults

### 1.4 Report tab has been restructured but not matured

`docs/phase-4-report-audit.md` shows the Report tab now has Route, Tonight, Near Me, and Submit modes. That is the right structure. The next pass should make it feel like a Waze-style adventure report system:

- quicker report flow
- confidence/decay
- “still there / not there”
- on-route weighting
- offline report queue
- photo-first field reports
- moderator/admin review lanes
- contributor trust score

### 1.5 Native readiness

`mobile/app.config.js` shows:
- Expo SDK 54 / RN 0.81 runtime
- iOS location background modes: location, audio, fetch
- iOS microphone/camera/photo descriptions
- Android background location and foreground-service permissions are currently blocked
- Mapbox native package is configured via `@rnmapbox/maps`
- MapLibre also exists
- custom offline/routing modules exist (`expo-tile-server`, `expo-valhalla-routing`)

This matters:
- iOS Live Activities / Dynamic Island / CarPlay will require native work and possibly entitlements.
- Android Auto / Android lock-screen navigation will require a separate Android native lane and Play-policy care.
- The app can still ship a lot of polish via OTA before native rebuilds.

---

## 2. Competitive Research: What to Learn, Not Copy

### 2.1 Gaia GPS

Gaia wins on:
- many map layers
- offline maps
- basemap/overlay mental model
- CarPlay support
- active map layers on the vehicle screen
- MVUM/public/private land/slope overlays
- serious outdoor credibility

User pain points Trailhead can beat:
- layer complexity
- snap-to-trail inconsistency
- offline authentication/download confusion
- not enough adventure intelligence
- weak “what should I do next?” guidance

Trailhead opportunity:
- make layer complexity approachable with **visual mode presets** and **Co-Pilot explanations**
- verify offline readiness with a pre-trip “airplane mode test”
- put Mission Control above map-layer chaos

### 2.2 onX Offroad

onX wins on:
- simple offroad trail color ratings
- vehicle-type filters
- open/closed/seasonal access clarity
- CarPlay/Android Auto
- 3D planning
- guided trail details
- recreation points

Trailhead opportunity:
- use onX-style simplicity: green/blue/black/red trail difficulty and open/closed/seasonal states
- add Trailhead-specific **rig fit** and **legal stay confidence**
- avoid clutter by showing only what matches the current mission

### 2.3 AllTrails

AllTrails wins on:
- trail search/filtering
- approachable trail cards
- community reviews/photos
- trail activity recording
- conditions from recent users
- simple difficulty/time/elevation/distance presentation

Important boundary:
- Do **not** scrape or ingest AllTrails proprietary trail data, reviews, photos, or GPX at scale.
- Use it as product inspiration only.
- Build Trailhead’s own trail dataset from public/open/official sources and user/contributor submissions.

Trailhead opportunity:
- create AllTrails-like trail profiles from USGS Digital Trails, OSM, NPS/USFS/BLM/state data, community reports, and Trailhead-generated confidence scoring
- make “recent conditions” more useful than star ratings
- combine trails with camps, route planning, hazards, and trip logistics

### 2.4 The Dyrt

The Dyrt wins on:
- camp discovery
- campground database
- offline trip maps
- public-land maps
- RV trip planning
- free camping collection

Trailhead opportunity:
- Trailhead can beat The Dyrt when camps are fused with route risk, legal stay confidence, rig fit, reports, trails, and experiences

### 2.5 Waze

Waze wins on:
- fast report capture
- automatic report expiry
- other-user confirmation / “not there”
- route-affecting report priority
- voice reporting
- CarPlay/Android Auto reporting patterns

Trailhead opportunity:
- adapt Waze mechanics to adventure travel:
  - washout
  - gate closed
  - bad road
  - snow/ice/mud
  - campsite full
  - sketchy access
  - water source dry
  - bear activity
  - fire/smoke
  - avalanche/slope risk
  - trail closure
  - dispersed-camp restriction
  - last reliable signal
  - dump/water/fuel status

### 2.6 Viator

Viator adds:
- bookable experiences
- tours/activities
- product photos/reviews/pricing/availability
- affiliate or merchant pathways

Trailhead opportunity:
- add “Do something near this stop” rails:
  - guided tours
  - rafting
  - canyoneering
  - climbing
  - scenic tours
  - tickets
  - local experiences
- keep Viator out of core navigation clutter
- place it in Explore and place-detail rails, not primary map pins by default

---

## 3. Production Program Overview

This plan is designed for Codex to run in multiple passes.

### Work lanes

1. **Smoothness and app shell polish**
2. **Map filters, visuals, legends, and modes**
3. **Explore catalog polish**
4. **Community reports 2.0**
5. **Trail system / AllTrails-like profiles**
6. **Snap-to-trail and route graph**
7. **Adventure data integrations**
8. **Mission Control / Co-Pilot fusion**
9. **CarPlay / Android Auto / Live Activities**
10. **QA, audits, and release gates**

Do not start all lanes at once. Codex should implement in staged passes with audit notes after each stage.

---

## 4. Stage 1 — Smoothness and Polish Baseline

### Goal

Make the current app feel smoother before adding more power.

### Tasks

#### 4.1 Performance audit

Add or update a lightweight performance checklist:

- cold start time
- map tab first render
- Explore tab first render
- filter sheet open/close smoothness
- route builder load overlay
- camp card open time
- report submit time
- map pan jank
- search debounce behavior
- image loading failures
- offline map pack list time

#### 4.2 Map performance

Codex should inspect `mobile/app/(tabs)/map.tsx` and extracted map components for:

- expensive computations in render
- missing `useMemo`/`useCallback`
- large arrays rendered without clipping/virtualization
- repeated API calls during pan/zoom
- map source/layer recreation instead of diffing
- markers that could become GeoJSON sources/layers
- unnecessary state writes during drag
- duplicated image/icon parsing
- repeated style reloads

#### 4.3 Explore performance

Inspect `mobile/app/(tabs)/guide.tsx` and Explore components for:

- oversized first load
- uncached computed category rails
- heavy image use without thumbnail fallback
- cards rerendering on filter/search changes
- list virtualization issues
- too much editorial text above the fold

#### 4.4 Skeletons and progress states

Add consistent loading states:
- map rail skeleton
- Explore card skeleton
- report feed skeleton
- place detail skeleton
- route scout phase skeleton

Use Trailhead tone:
- “Checking route context”
- “Loading nearby options”
- “Ranking official sources”
- “Preparing offline pack”

### Exit criteria

- no obvious jank opening filter/legend/sheets
- common screens render with skeletons instead of blank panels
- no major repeated network calls on simple pan/tap
- audit note saved to `docs/adventure-readiness-stage-1-audit.md`

---

## 5. Stage 2 — Map Filter Pictures, Modes, and Better Legend

### Goal

Make the map easier to understand at a glance.

### Current issue

The filter sheet is text-heavy. Users need to know what a mode does before toggling it. Competitors win because their visual language is obvious: public/private land, offroad trails, topo, snow, camps, hazards, etc.

### 5.1 Create a visual filter preset gallery

Add a component:

```txt
mobile/components/map/MapModeGallery.tsx
```

Each preset should have:
- mini illustrated map preview
- title
- one-line purpose
- visible icons
- “best for” label
- source/trust indicator when relevant

Recommended presets:

1. **Tonight**
   - camps, stays, water, food, reports near tonight’s stop
2. **Remote Route**
   - fuel, water, repair, offline, signal, hazards
3. **Overland**
   - MVUM, public land, dispersed camps, 4WD/road condition, closures
4. **Trail Day**
   - trails, trailheads, parking, bathrooms, water, recent trail reports
5. **Family Easy**
   - easy trails, picnic, parking, restrooms, visitor centers, short drives
6. **Weather Risk**
   - radar/weather, fire, smoke, air quality, flood/water gauges
7. **Water/Fish**
   - rivers, lakes, launches, gauges, safe water, marinas
8. **Town Reset**
   - groceries, food, medical, parts, lodging, wifi, dump/water/fuel
9. **Scenic**
   - viewpoints, historic, monuments, photo stops, scenic drives

### 5.2 Better legend

Add:

```txt
mobile/components/map/MapLegendSheet.tsx
mobile/lib/mapLegend.ts
```

Legend categories:

#### Camps and stays

| Symbol | Meaning |
|---|---|
| green tent | public/developed camp |
| teal campfire | dispersed/public land candidate |
| purple cabin | private stay/glamping |
| gray RV | RV park |
| amber review marker | needs legal/access review |

#### Trails

| Color | Meaning |
|---|---|
| green | easy |
| blue | moderate |
| black | hard |
| red | closed/no access/high risk |
| dashed | uncertain/imported/community |
| dotted | snap-to unavailable / low confidence |

#### Offroad / access

| Symbol | Meaning |
|---|---|
| brown line | dirt/forest road |
| orange line | 4WD/high-clearance likely |
| red slash | closed/blocked |
| calendar | seasonal access |
| gate | gate/check access |
| tire | technical section |

#### Reports

| Color | Meaning |
|---|---|
| red | hazard/blocker |
| orange | caution |
| blue | information |
| green | confirmed good |
| gray | expired/unconfirmed |

#### Weather / risk

| Symbol | Meaning |
|---|---|
| flame | fire hotspot/perimeter |
| smoke | smoke/air risk |
| wind | high wind |
| snowflake | snow/ice |
| wave | flood/water risk |
| lightning | severe storm |

### 5.3 Contextual legend

Legend should be context-aware:
- if user is in Weather mode, open directly to weather legend
- if Trail Day, open trails legend
- if Overland, open MVUM/public land legend
- if report selected, show report TTL and confidence explanation

### 5.4 “Why am I seeing this?” source cards

For every major layer and filter result, add a source/trust line:

```txt
Source: NPS official alert · updated 2h ago
Source: Trailhead report · 3 confirmations · expires in 4h
Source: OSM trail geometry · difficulty inferred
Source: USFS MVUM · legal motorized access map, not live gate status
```

### Exit criteria

- filter sheet has visual preset cards
- legend explains all major colors/symbols
- user can understand a pin/line/layer without guessing
- audit note saved to `docs/adventure-readiness-stage-2-map-legend-audit.md`

---

## 6. Stage 3 — Explore Catalog Polish

### Goal

Make Explore feel curated, fast, and adventure-specific.

### Problems to solve

- catalog can feel generic or editorially thin
- photos/placeholders need better consistency
- categories need better hierarchy
- Viator should enrich, not clutter
- trails and activities should feel first-class
- source/freshness should be obvious

### 6.1 Explore IA

Recommended top sections:

1. **For this trip**
2. **Near me**
3. **Trails**
4. **Parks & public land**
5. **Camps & stays**
6. **Water & fishing**
7. **Scenic drives**
8. **Bookable experiences**
9. **Town services**
10. **Saved / downloaded**

### 6.2 Explore card upgrades

Each card should show:
- category icon
- source line
- freshness
- distance
- trust signal
- action chips:
  - Map
  - Route
  - Save
  - Nearby
  - Download
  - Report

Trail cards:
- distance
- elevation gain
- route type
- difficulty
- surface/terrain
- dog/bike/horse/motorized access where known
- recent condition score
- land manager
- warning tags

Camp cards:
- legal confidence
- rig fit
- road access
- reservation/first-come/unknown
- source
- reports
- water/toilet/trash/cell if known

Viator/activity cards:
- “Bookable experience”
- price/from if allowed
- availability freshness
- duration
- cancellation/terms handoff
- affiliate/partner disclosure where required

### 6.3 Explore source/freshness panel

Add a source card to every detail view:

```txt
SOURCE & FRESHNESS
Official NPS data · updated May 2026
Trailhead community reports · 3 recent
OSM geometry · attribution required
Viator product content · live partner data
```

### 6.4 Place clusters

Cluster detail should show:
- camps nearby
- trails nearby
- reports nearby
- weather nearby
- bookable experiences
- services
- offline pack availability

### 6.5 Explore QA matrix

Add a script or manual checklist:

```txt
scripts/qa_explore_catalog_matrix.py
```

Scenarios:
- Moab
- Yosemite
- Zion
- Smoky Mountains
- Big Bend
- Glacier
- Olympic
- New Zealand trail area
- Canadian Rockies
- Iceland route town
- sparse rural area
- no-service/offline pack only

Expected:
- no dead end
- at least one useful fallback
- source/freshness shown
- no AI-padding copy
- map/route actions work

### Exit criteria

- Explore feels like a real adventure guide, not a content dump
- Viator is integrated as a route/place rail, not map clutter
- trails are visually distinct from parks/camps
- audit note saved to `docs/adventure-readiness-stage-3-explore-audit.md`

---

## 7. Stage 4 — Community Reports 2.0

### Goal

Turn the early-stage reporting system into the adventure equivalent of Waze.

### 7.1 Report types

Expand and normalize:

#### Road / route

- road closed
- gate closed
- construction
- washout
- mud
- snow/ice
- high clearance needed
- 4WD needed
- shelf road / exposure
- deep sand
- low bridge / clearance issue
- ferry/bridge issue

#### Camp / stay

- camp full
- camp closed
- fee changed
- water unavailable
- toilet/trash issue
- noisy/unsafe
- access road issue
- reservation issue
- private stay issue

#### Trail

- trail closed
- washed out
- downed trees
- snow
- muddy
- crowded
- wildlife
- water crossing
- parking full
- dog/bike/horse restriction
- route finding issue

#### Weather / environmental

- fire/smoke
- flood
- avalanche/slope
- heat
- high wind
- water source dry
- algae/unsafe water

#### Services

- fuel unavailable
- propane unavailable
- dump closed
- water fill closed
- repair/tire service
- medical
- wifi/cell good/bad

### 7.2 Waze-like mechanics

Implement:
- one-tap confirmation: **Still there**
- one-tap dismissal: **Not there**
- “I saw this” vs “I heard this” source confidence
- report TTL by type
- route-distance relevance
- reporter reputation
- photo bonus
- offline queue
- rate limit/spam guard
- duplicate clustering
- severity decay
- automatic “needs review” after conflicting votes

### 7.3 Report card design

Report cards should show:
- severity
- type
- distance from route/current/camp
- created age
- expires in
- confirmations
- reporter trust tier
- source
- photo if available
- action buttons:
  - Still there
  - Not there
  - Route around
  - Save
  - Report more

### 7.4 Voice reporting later

Keep initial implementation touch-first. Then add Co-Pilot:

```txt
"Report gate closed"
"Road is washed out"
"Camp is full"
"Water fill is closed"
"Trail has downed trees"
```

All voice reports should stage a confirmation card before upload when driving safety allows.

### 7.5 Car mode report subset

In CarPlay/Android Auto:
- only safe report types
- big buttons
- voice-first
- no photo upload
- no free-text typing
- no map segment selection beyond current location/route

### Exit criteria

- Report system feels trustworthy and alive
- route/today/tonight report surfaces show meaningful TTL and confirmation state
- offline report queue exists
- audit note saved to `docs/adventure-readiness-stage-4-report-system-audit.md`

---

## 8. Stage 5 — Real Trail System

### Goal

Build the Trailhead trail graph and profiles so the app can move toward an AllTrails-like experience using legal, open, official, and Trailhead-owned data.

### 8.1 Legal data boundary

Do not ingest AllTrails proprietary data, scraped pages, reviews, photos, GPX, or trail details.

Use:
- USGS Digital Trails
- OSM/Overpass
- NPS API
- USFS trails/MVUM/roads where available
- BLM geospatial services
- state/provincial/local open data
- user-submitted tracks and field reports
- Trailhead curated packs
- official trail system APIs where available

### 8.2 Trail profile model

Add/normalize:

```ts
type TrailheadTrailProfile = {
  id: string;
  name: string;
  geometry: GeoJSON.LineString | MultiLineString;
  trailheads: TrailheadPoint[];
  distance_mi: number | null;
  elevation_gain_ft: number | null;
  difficulty: 'easy' | 'moderate' | 'hard' | 'expert' | 'unknown';
  difficulty_reason: string[];
  route_type: 'loop' | 'out_back' | 'point_to_point' | 'network' | 'unknown';
  activities: string[];
  access: {
    foot?: string;
    bicycle?: string;
    horse?: string;
    motor_vehicle?: string;
    dog?: string;
    seasonal?: string;
    closure_status?: string;
  };
  surface?: string;
  slope?: string;
  land_manager?: string;
  source: {
    primary: string;
    official_url?: string;
    last_checked?: number;
    license?: string;
    attribution?: string;
  };
  confidence: {
    geometry: number;
    difficulty: number;
    access: number;
    trailhead: number;
  };
  stats: {
    saves: number;
    completions: number;
    reports_recent: number;
    photos: number;
  };
  recent_conditions: TrailConditionSummary;
};
```

### 8.3 Difficulty scoring

Do not rely only on user stars.

Use:
- distance
- elevation gain
- steepness
- surface
- `sac_scale`
- `mtb:scale`
- trail visibility
- route finding risk
- recent reports
- weather/season
- official difficulty where available

### 8.4 Trail conditions

Add recent condition tags:
- dry
- muddy
- snow
- icy
- overgrown
- downed trees
- washed out
- crowded
- bugs
- water crossing
- parking full
- wildlife
- closed/no access

### 8.5 Trail Explore pages

Trail pages should include:

- hero photo or generated terrain/map preview
- stats strip
- route/elevation profile
- difficulty explanation
- permitted activities
- recent condition reports
- trailhead parking
- nearby camps/stays
- weather at trailhead
- download offline
- report condition
- add to trip
- route to trailhead
- snap-to-trail planning

### 8.6 Trail QA

Test:
- popular official park trails
- obscure OSM trails
- missing trail geometry
- trailheads without parking
- multiple overlapping trails
- closed/private/no-access trails
- trails with no difficulty tags
- long routes requiring segmentation
- trails crossing private/public boundaries

### Exit criteria

- Trailhead has a legal first-party trail profile system
- trail cards feel comparable to AllTrails at a glance
- source/confidence always shown
- audit note saved to `docs/adventure-readiness-stage-5-trail-system-audit.md`

---

## 9. Stage 6 — Snap-to-Trail and Route Graph

### Goal

Route on trails/offroad more reliably than generic road routing.

### 9.1 Problem

Snap-to-trail fails when the displayed map line and routing graph differ. This is a known pain point across outdoor route planners.

### 9.2 Trail graph design

Build a Trailhead routing graph:

```txt
nodes:
- trail junctions
- trailheads
- route endpoints
- crossings
- access gates
- parking anchors

edges:
- trail segment geometry
- activity access
- difficulty
- surface
- slope
- seasonality
- legal access
- source confidence
- last checked
```

### 9.3 Snap modes

Offer:

- **Snap to Trail** — foot/hike/trail graph
- **Snap to Road** — vehicle road graph
- **Snap to Dirt/4WD** — offroad/MVUM/track graph
- **Straight Line** — fallback
- **Hybrid** — trail + road connectors

### 9.4 UX

When snap fails:
- do not silently draw wrong line
- show reason:
  - “No trail graph here yet”
  - “Gap between trail segments”
  - “Trail access unknown”
  - “Offline routing data missing”
- offer:
  - straight-line segment
  - add manual point
  - download routing data
  - report missing trail
  - contribute GPX

### 9.5 Offline routing

For offline:
- downloaded map tiles are not enough
- need downloaded routing graph
- show separate readiness:
  - map tiles downloaded
  - trail graph downloaded
  - road routing downloaded
  - camps/places downloaded
  - weather cached
  - reports cached

### Exit criteria

- route builder can distinguish visible map tiles from routable graph availability
- snap-to-trail has graceful failure
- offline readiness explains missing routing graph
- audit note saved to `docs/adventure-readiness-stage-6-snap-trail-audit.md`

---

## 10. Stage 7 — Adventure Data Integration Matrix

### 10.1 Priority data sources

| Source | Use | Priority | Notes |
|---|---:|---:|---|
| NPS API | parks, alerts, campgrounds, road events, things to do | High | official, strong trust |
| RIDB / Recreation.gov | federal rec areas, facilities, campsites, permits, tours | High | official/federal |
| USFS MVUM | legal motorized access | High | legal designations, not live gate status |
| USGS Digital Trails | public-domain trail data | High | trails foundation |
| OSM / Overpass | trail/road/POI geometry | High | attribution + ODbL compliance |
| NWS API | weather alerts and forecasts | High | U.S. official |
| AirNow | AQI/smoke context | High | U.S./Canada/Mexico |
| NASA FIRMS / WFIGS | fire hotspots/perimeters | High | risk layer |
| USGS Water | streamflow/gage/water risk | Medium-high | water/flood/fishing |
| Viator | bookable experiences | Medium | affiliate/merchant constraints |
| Mapbox Search | premium search/places | Medium-high | temporary-use restrictions |
| Mapbox Weather | premium weather along route | Medium | gated behind Extreme |
| Mapbox Navigation | guided nav, CarPlay, reroute | Medium-high | cost-gated |
| state/provincial open data | parks/trails/camps | High long-term | catalog density |
| Mapillary / street imagery | access/gate/road context | Medium | licensing/availability check |
| community reports | current conditions | Moat | Trailhead-owned |

### 10.2 Provider registry

Add:

```txt
dashboard/provider_registry.py
```

or similar.

Provider metadata should include:
- name
- source type
- official/community/commercial/open
- update cadence
- storage rules
- attribution text
- license URL
- freshness label
- confidence default
- allowed surfaces
- offline-allowed?
- derivative-data constraints

### 10.3 Source-confidence scoring

Every pin/card/route risk should have:

```ts
source_quality:
  official: +40
  recent: +20
  multiple_sources: +15
  community_confirmed: +15
  stale: -20
  inferred: -20
  unknown_access: -30
```

Use this in:
- map ranking
- Explore ranking
- Mission Control
- Co-Pilot explanations

### Exit criteria

- data source rules are explicit
- no hidden provider dependencies
- Co-Pilot can cite why a recommendation is trusted
- audit note saved to `docs/adventure-readiness-stage-7-data-sources-audit.md`

---

## 11. Stage 8 — Mission Control v2

### Goal

Fuse the map/trail/report/explore data into one adventure intelligence layer.

Mission Control should answer:

```txt
Route status: ready / needs review / blocked
Overnights: confirmed / candidate / review area / missing
Rig fit: safe / caution / not recommended / unknown
Legal stay: high / medium / low / unknown
Fuel risk: safe / watch / warning
Weather/fire/air/water: clear / watch / warning
Offline readiness: complete / partial / missing
Reports: current / stale / conflicting
Next actions: staged, not mutated
```

### 11.1 UI

Add a compact card:
- top of Extreme Explorer
- Route Scout panel
- route builder summary
- trip detail

Example:

```txt
MISSION CONTROL
Moab → Big Sur · 5 days · wild but safe

Ready
✓ Route preview
✓ 3 named overnight candidates
✓ Fuel gap within rig range

Needs review
! Day 2 stay is a review area
! Fire/smoke watch near Day 4
! Offline trail graph missing

Actions
[Fix Day 2 Stay] [Download Route] [Add Fuel] [Show Safer Route]
```

### 11.2 Co-Pilot behavior

Co-Pilot should not just chat. It should:
- summarize mission state
- explain source confidence
- stage map actions
- route the user to the right surface
- ask for missing input
- avoid overclaiming
- require confirmation for changes

### Exit criteria

- Mission Control returns deterministic brief without LLM
- LLM/voice can narrate it later
- audit note saved to `docs/adventure-readiness-stage-8-mission-control-audit.md`

---

## 12. Stage 9 — CarPlay, Android Auto, Live Activities, Dynamic Island

### Goal

Move Trailhead from phone-only to adventure navigation surfaces.

### 12.1 iOS CarPlay

Reality:
- Requires Apple CarPlay entitlement.
- Navigation apps use CarPlay templates and a map window.
- Mapbox iOS Navigation SDK has CarPlayManager building blocks, but `startFreeDriveAutomatically` must be disabled to avoid unintentional billable Free Drive sessions.
- Needs real hardware testing.

Phases:

#### CarPlay A — entitlement and prototype shell

- request Apple CarPlay navigation entitlement
- add native iOS CarPlay scene
- create a read-only Trailhead CarPlay mode:
  - saved drivable routes
  - route preview
  - current location
  - map layers
  - no free drive by default
  - no Mapbox trip session by default

#### CarPlay B — route preview

- list closest saved drivable routes
- preview route
- show ETA/distance if authorized
- show Mission Control warnings
- show only safe action buttons

#### CarPlay C — active guidance

- explicit Start Guidance
- Mapbox Navigation session authorization
- ledger
- turn-by-turn
- reroute
- voice
- end session reliably

#### CarPlay D — reports

- limited Waze-like report set:
  - hazard
  - road closed/gate closed
  - camp full
  - fuel unavailable
  - not there
- voice-first where possible

### 12.2 Android Auto

Phases:
- use Android for Cars Car App Library
- declare `androidx.car.app.category.NAVIGATION`
- use navigation templates
- use Mapbox Android Auto SDK or custom Android Auto surface
- Play review lane separate from normal mobile
- avoid foreground/background location policy mistakes

### 12.3 Live Activities and Dynamic Island

Use case:
- active navigation
- route scout running
- trip download progress
- approaching checkpoint
- severe route hazard
- offline readiness progress

Constraints:
- Live Activity extension cannot access network or location directly.
- Dynamic/static payload is small.
- Updates come from app or APNs.
- Needs WidgetKit/ActivityKit native extension.

Recommended Live Activity:

```txt
Trailhead Navigation
Next: Fuel before remote stretch
ETA: 42 min
Risk: Smoke watch
Offline: ready
```

Dynamic Island compact:
- next turn/checkpoint icon
- ETA/distance
- risk badge

Lock Screen:
- next maneuver/checkpoint
- ETA
- route risk
- end/open app action

### 12.4 Android lock-screen navigation

Android path requires:
- foreground service/location if true background navigation
- Play policy review
- clear in-app value and disclosure
- ongoing notification with turn/checkpoint
- likely deferred until Android Auto/native nav lane is clean

Current repo blocks Android background location and foreground service, so do not promise Android lock-screen nav in OTA.

### Exit criteria

- CarPlay entitlement request package prepared
- iOS Live Activity technical spike planned
- native work separated from OTA work
- no accidental Mapbox billing sessions
- audit note saved to `docs/adventure-readiness-stage-9-navigation-surfaces-audit.md`

---

## 13. Stage 10 — QA and Audit Agents

Create lightweight “agents” as Codex prompt files.

### 13.1 Product Polish Agent

Checks:
- too much text
- missing source/freshness
- dead-end states
- duplicated copy
- tiny touch targets
- unclear icon meaning
- no route-aware next step

### 13.2 Map Performance Agent

Checks:
- render thrash
- repeated API calls
- too many markers
- slow sheet open
- style reloads
- map pan jank
- memory pressure

### 13.3 Data Trust Agent

Checks:
- source shown
- license/attribution respected
- no AllTrails/proprietary data ingestion
- no AI claim without data
- freshness present
- confidence score sensible

### 13.4 Community Safety Agent

Checks:
- report spam guard
- PII risk
- home-location privacy for recorded trails
- public activity defaults
- photo moderation
- excessive reporting blocks
- sensitive locations hidden if needed

### 13.5 Car Platform Agent

Checks:
- CarPlay entitlement assumptions
- Android Auto manifest/templates
- driver distraction rules
- no unsafe free text in car
- no accidental navigation session billing
- real hardware test plan

---

## 14. Suggested GitHub Issues

Create these issues or Codex tasks.

### Issue 1 — Map visual filter cards and legend

**Title:** `Map polish: add visual filter preset gallery and contextual legend`

Scope:
- `MapModeGallery.tsx`
- `MapLegendSheet.tsx`
- `mapLegend.ts`
- wire into `MapFilterSheet`
- add image-like vector preview cards
- no network dependencies

Exit:
- filter presets visually explain themselves
- legend covers camps/trails/offroad/weather/reports
- typecheck passes

### Issue 2 — Explore catalog polish pass

**Title:** `Explore polish: source/freshness, better trail/camp/activity cards, no dead ends`

Scope:
- source/freshness component
- card hierarchy cleanup
- category rails
- Viator rail placement
- trail card formatting

Exit:
- no generic prose-only cards
- map/route/save/download actions visible
- no blank rails without action

### Issue 3 — Community Reports 2.0

**Title:** `Reports: Waze-like confirmation, decay, TTL, offline queue`

Scope:
- report model updates
- still there/not there
- TTL display
- duplicate clustering
- route relevance
- offline queue
- contributor score hooks

Exit:
- route/tonight reports feel alive and trustworthy

### Issue 4 — Trail profile system v1

**Title:** `Trails: build Trailhead trail profile model and legal/open data ingestion plan`

Scope:
- trail profile types
- source registry
- USGS/OSM/NPS path
- trail detail UI
- recent conditions
- report condition

Exit:
- AllTrails-like cards without AllTrails data

### Issue 5 — Snap-to-trail graph spike

**Title:** `Routing: snap-to-trail graph spike with graceful failure states`

Scope:
- trail graph design
- route modes
- fail reasons
- offline graph readiness
- route builder integration

Exit:
- no silent snap failures

### Issue 6 — Mission Control v2

**Title:** `Co-Pilot: Mission Control v2 adventure readiness brief`

Scope:
- backend deterministic brief
- UI card
- action staging
- source/confidence explanation

Exit:
- route status is deterministic and useful before voice

### Issue 7 — Native navigation surface research

**Title:** `Native: CarPlay, Android Auto, Live Activities research + entitlement prep`

Scope:
- entitlement packet
- native file plan
- Mapbox billing guardrails
- APNs ActivityKit path
- Android Auto manifest plan

Exit:
- native work scoped and safe

---

## 15. Codex Kickoff Prompt

Use this with Codex:

```txt
You are working in the Trailhead repo. Read:

1. MEMORY.md
2. docs/production-improvement-execution-plan.md
3. docs/phase-6-map-modularization-audit.md
4. docs/copilot-route-scout-hardening-audit.md
5. docs/copilot-replay-harness-audit.md
6. docs/adventure-app-production-readiness-plan.md

Do not start with broad brainstorming. Implement the next smallest shippable stage from the plan.

Rules:
- Preserve current production behavior unless the task explicitly changes it.
- Prefer OTA-safe React Native work before native rebuild work.
- Keep all Mapbox Navigation billing behind explicit confirmation.
- Do not scrape or ingest AllTrails proprietary data.
- Always show source/freshness/confidence when surfacing adventure recommendations.
- Add an audit note after each stage.
- Run typecheck and diff checks before concluding.

Start with Stage 1 or Stage 2 unless a blocking issue exists.
```

---

## 16. Validation Commands

Backend:

```bash
python3 -m py_compile dashboard/server.py
python3 -m unittest tests.test_extreme_explorer
python3 scripts/replay_copilot_debug.py --limit 50
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

Optional QA:

```bash
python3 scripts/qa_route_matrix.py --skip-context
python3 scripts/qa_route_matrix.py --limit 3
```

---

## 17. Immediate Recommended Order

1. **Stage 2 Map Visuals and Legend**  
   This directly addresses the user-visible polish gap and uses extracted map components.

2. **Stage 3 Explore Catalog Polish**  
   Makes the app feel less generic and supports Viator/trails/camps/tours.

3. **Stage 4 Reports 2.0**  
   Turns early reporting into Waze-like adventure trust.

4. **Stage 5 Trail Profiles**  
   Starts the AllTrails-like surface legally and defensibly.

5. **Stage 8 Mission Control v2**  
   Fuses route/camp/report/trail/weather/offline into a moat.

6. **Stage 9 Native Navigation Surfaces**  
   CarPlay/Android Auto/Live Activities after the base product is polished and logic is trustworthy.

---

## 18. Non-Negotiables

- Do not overclaim legal camping unless official or high-confidence.
- Do not show Mapbox Search data as cached first-party data unless terms allow.
- Do not scrape AllTrails or clone proprietary content.
- Do not enable CarPlay/Navigation sessions without entitlement and cost controls.
- Do not restart Android background location without Play policy plan.
- Do not make the map noisier; every new layer needs a mode, a legend, and a source.
- Do not let Co-Pilot mutate trips without confirmation.
- Do not ship adventure safety features without fallback language and source freshness.

---

## 19. What “Production Ready” Means

Trailhead is production-ready as an Adventure OS when:

- the map is understandable without tutorial text
- filters are visual and mode-based
- Explore feels curated and source-grounded
- reports have confidence, TTL, and confirmation
- trails have first-party profiles and recent conditions
- route planning knows offline readiness
- Co-Pilot can explain route risk deterministically
- CarPlay/Live Activities are scoped behind native entitlement gates
- every recommendation has source, freshness, and confidence
- the app remains smooth on common phones
