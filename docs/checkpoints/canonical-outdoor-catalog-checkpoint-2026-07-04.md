# Canonical Outdoor Catalog Checkpoint

Created: 2026-07-04

## Goal

Trailhead should read Explorer, camps, map pins, trails, and route-builder stays
from one curated catalog layer instead of scattered patches and live provider
fanout. Raw source data can stay large and messy; user-facing records must be
stable, fast, deduped, and clean.

## Current Direction

- Keep the existing official cache as the raw/canonical build cache.
- Keep existing public endpoints compatible while their internals move toward
  generated canonical serving indexes.
- Build compact serving indexes at startup when the source cache is newer than
  the generated files, so production does not depend on ignored local artifacts
  being committed.
- Use `places` as the current lightweight serving table, then add generated
  marts around it instead of breaking the app with a full replacement.
- Treat already-public dispersed records as visible unless classification marks
  them as wrong, duplicate, stale, parking-style, or review-only.

## First Checkpoint Implemented

- Added shared catalog rules in `scripts/data/canonical_catalog_rules.py`.
- Added read-only audit command:
  `npm run data:audit-catalog`
- Fixed official search category generation so trails index as `trail` instead
  of leaking surface values like `NATIVE MATERIAL`, `SNOW`, or `N/A`.
- Tightened RV classification so mixed tent/RV campgrounds do not become RV
  parks unless the primary name/type is truly RV-focused.
- Made camp merge ordering stable by source rank, distance, name, and ID.
- Cleaned Explorer generated fallback copy so cards no longer say "managed
  outdoor area," "official access," informal source notes, or repeated
  ellipsis fragments.
- Added compact generated serving indexes:
  - `data/processed/canonical_serving/camps.candidate.json`
  - `data/processed/canonical_serving/trails.candidate.json`
  - `data/processed/canonical_serving/explore.candidate.json`
- Wired the generated camp index into existing camp reads behind
  `TRAILHEAD_LOCAL_CAMP_INDEX_ENABLED`:
  - `/api/campsites/search`
  - `/api/nearby-camps`
  - `/api/discovery/context`
  - route-builder overnight camp windows
  - `/api/camps/bbox`
- Kept regional camp packs and live providers as fallbacks, with existing dedupe
  still choosing the better card.
- Added a non-overnight guard so day-use areas, test facilities, offices, and
  similar records do not become camp pins.
- Filtered review-only administrative camp-like records during camp merging, so
  records such as ranger districts do not show as campground pins unless the
  name/type also carries a real overnight signal.
- Current generated counts after the Explorer/trail cleanup:
  - 20,461 camp records after removing obvious non-overnight records
  - 49,704 trail records, with 38,731 named trails ahead of 10,973 review-only
    code-like records
- 9,646 Explorer records after removing day-use/admin/test records, cleaning
  short copy, and reclassifying trail/cabin records.

## Second Checkpoint Implemented

- Wired generated Explorer and trail serving indexes into browse/search/nearby
  paths behind:
  - `TRAILHEAD_LOCAL_EXPLORE_INDEX_ENABLED`
  - `TRAILHEAD_LOCAL_TRAIL_INDEX_ENABLED`
- Added exact generated-detail lookup before older official-cache lookup, so
  generated trail cards keep their cleaned distance/category text.
- Added raw prefilters before profile conversion so generated search does not
  convert 50k trail rows for every query.
- Added route-rank generated-catalog merge and fixed an existing missing
  `category` variable in route ranking.
- Tightened Explore category handling:
  - Day-use/dump-only records do not enter camp search.
  - Trail-named records from broad recreation sources normalize as trails, not
    campgrounds.
  - Cabins/lookouts/lodging no longer inherit RV labels from broad upstream
    categories.
  - RV labels stay restricted to true RV parks/resorts.
- Cleaned public source labels and legal-looking source copy for older BLM/FWS
  catalog records.
- Kept existing endpoint response shapes unchanged.

## Third Checkpoint Implemented

- Added startup guard in `run.py`:
  - `TRAILHEAD_ENSURE_CANONICAL_INDEXES` defaults on.
  - `TRAILHEAD_REQUIRE_CANONICAL_INDEXES=1` can make missing/stale serving
    files fatal in stricter environments.
  - Missing or stale serving indexes rebuild from the official cache and
    Explorer candidate file before traffic is accepted.
- Expanded `npm run data:audit-catalog -- --fail-on-findings` so it checks the
  generated camp, Explore, and trail serving files, not only the app DB.
- Made the audit fail on:
  - forbidden public copy
  - rough clipped copy
  - standalone zero-mile trail copy
  - non-overnight camp leakage
  - loose RV labels
  - dispersed records that are really overnight parking
- Tightened official-cache camp profile copy, which is used by live Explorer
  search:
  - visible camp/trail card copy is capped to concise complete sentences
  - `back-drop` normalizes to `backdrop`
  - `Recreation The...` fragments no longer leak into the visible summary
  - tiny trails omit distance instead of showing `0.0 mile trail`
- Added package-safe imports for the catalog builder/audit scripts so direct
  CLI runs and unit tests use the same rules module.
- Added tests for:
  - official-cache camp summaries using compact card copy
  - official-cache tiny trail distance handling
  - serving audit detection of standalone zero-mile copy
  - public copy source artifacts such as `RIDB`, downloaded files, and endpoint
    wording
- Current generated serving counts:
  - camps: 20,461
  - trails: 49,704
  - Explore: 9,646
- Live local probe on `127.0.0.1:8099` passed:
  - Moab camp bbox returned 66 camps
  - King's Bottom Campground labels as `Campground`
  - RV-only Moab bbox returned 1 result, Spanish Trail RV Park
  - West Potomac Park Softball Fields returned no camp Explorer result
  - Sand Flats camp card copy is concise and complete
  - Hidden Valley trail results have no standalone zero-mile copy

## Fourth Checkpoint Implemented

- Cleaned generated public trail records:
  - Generic/code-like trail names such as `ACCESS` and `Ninemile Spur Ai` stay
    review-only.
  - Legitimate uppercase names are title-cased for display instead of being
    hidden.
  - Trail summaries now use complete compact facts: distance, elevation gain,
    difficulty, uses, surface, and season when available.
  - Numeric difficulty, surface codes, and allowed-use strings map to readable
    outdoor labels.
- Added generated trail dedupe by public name and rounded start point, preferring
  longer/better populated records.
- Current generated serving counts after trail dedupe:
  - camps: 20,461
  - trails: 49,218
  - Explore: 9,646
- Added audit coverage for duplicate public trail records in generated serving
  indexes.
- Cleaned map selected-place copy:
  - Replaced `Selected place.` with nearby-search copy.
  - Replaced source-heavy freshness text with `Check current access and
    conditions before you go.`
  - Added backend weak-summary guard so stale selected-place input is cleaned
    server-side.
- Improved web map search behavior:
  - Search submit now has an explicit arrow control when text is entered.
  - Explicit submit can select the top location; passive typing still only
    shows suggestions.
- Rebuilt the exported web app and site output so `/app` serves the updated
  bundle from `dashboard/site/dist/app`.
- Live browser evidence:
  - `http://127.0.0.1:8099/app?probe=moab-row-final-5`
  - Mobile-size browser pass opened the Map tab, searched Moab, selected
    `Moab, Utah, United States`, and opened the place sheet.
  - The final text guard found no page errors, no console errors after filtering
    a known favicon 404, no `Selected place.`, no `official sources`, no `0
    results`, no dev/internal wording, and no `current local conditions with
    current local updates`.
  - Screenshot: `/tmp/trailhead-map-moab-row-final-5.png`

## Fifth Checkpoint Implemented

- Removed review-only trail records from the public trail serving index instead
  of keeping them in the generated file.
- Tightened trail title cleanup:
  - `MT. BIKE` and `MT BIKE` now display as `Mountain Bike`.
  - Slashed titles get readable spacing.
  - `MGRA...` source acronyms stay out of public results until they have a
    complete public-facing name.
- Held source segment names for review:
  - bare single-letter suffixes such as `Pine Ridge A`
  - lettered bike segments such as `Pine Ridge Mountain Bike G`
  - dangling hyphen/tree fragments such as `Cork Ridge - Pine`
- Added regression tests for the public trail title and review-only rules.
- Rebuilt generated serving indexes:
  - camps: 20,388
  - trails: 43,337
  - Explore: 9,470
- Strict catalog audit passed with no findings for:
  - forbidden public copy
  - rough clipped copy
  - non-overnight camp leakage
  - loose RV labels
  - review-only trail leakage
  - duplicate public trail records
- App-serving smoke checked generated trail cards for:
  - `Moab trails`
  - `Yosemite trails`
  - `Glacier trails`
  - `Pine Ridge Trail`
- The smoke found no blocked/internal terms and no weak `MGRA`, `MT. BIKE`,
  `Mount. Bike`, or `Cork Ridge - Pine` trail titles in the returned cards.
- Regression suite passed:
  - `tests.test_canonical_explore_serving`
  - `tests.test_canonical_catalog_rules`
  - `tests.test_canonical_catalog_audit`
  - `tests.test_canonical_camp_serving`
  - `tests.test_trail_catalog`

## Public Label Rules

- `Campground`: normal developed or mixed campgrounds.
- `Dispersed camp`: primitive/dispersed spots, not developed campgrounds.
- `RV park`: true RV parks/resorts only.
- `Overnight parking`: casinos, truck stops, rest areas, lots, and similar
  vehicle overnight stays.

## Copy Rules

Normal app screens must not show internal/source wording such as API, raw data,
database dump, import, endpoint, POI, schema, undefined, null, N/A, 0 results,
rig aware, or offline ready.

## Next Checkpoints

1. Continue Playwright visual passes for Big Sur, Yosemite, Glacier, and Grand
   Canyon across map styles and deep Explorer scroll.
2. Continue replacing thin fallback copy in older hand-curated Explorer records
   with clean facts from the canonical cache.
3. Deduplicate same-place Explorer clusters such as OLD/current permit records
   and same-name trail segment duplicates, without merging different trailheads
   or legitimate route segments.

## Verification

- `python3 -m unittest tests.test_canonical_catalog_rules`
- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_camp_serving tests.test_dispersed_site_leads_import`
- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_camp_serving tests.test_canonical_explore_serving tests.test_dispersed_site_leads_import`
- `npm run data:normalize -- --search-only`
- `npm run data:build-canonical-indexes`
- `npm run data:audit-catalog -- --fail-on-findings`
- `npm run data:validate -- --dry-run`
- `cd mobile && npx tsc --noEmit --pretty false`
- `python3 -m py_compile run.py dashboard/server.py scripts/data/build_canonical_serving_indexes.py scripts/data/audit_canonical_catalog.py scripts/data/canonical_catalog_rules.py`
- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_camp_serving tests.test_canonical_explore_serving tests.test_dispersed_site_leads_import`
- `node /tmp/trailhead_live_probe.mjs`
- `npm run build`
- Disposable Playwright/Chrome browser pass on `127.0.0.1:8099/app`:
  - `/tmp/trailhead-app-mobile.png`
  - `/tmp/trailhead-map-real-mobile.png`
  - `/tmp/trailhead-map-moab-row-final-5.png`
- Local Explorer API probes on `http://127.0.0.1:8099`:
  - `lake powhatan` + camp returns Lake Powhatan as `Campground`, not RV.
  - `tar camp day use` + camp returns an empty place list.
  - Moab nearby trails return trail cards such as Hell's Revenge Trailhead,
    Hidden Valley Trail, Poison Spider Mesa Trailhead, and Corona Arch Trail.
  - Generated exact trail detail keeps `0.7 mile trail` after nearby pack
    attachment.
- Moab local camp probe:
  - 51 local camp records in the Moab viewport
  - King's Bottom Campground labels as `Campground`
  - Spanish Trail RV Park is the only RV result in that local viewport
  - Moab Day Use Sites and BAH venue test records are removed
  - Sand Flats summary no longer ends mid-phrase
  - stale 2020 maintenance notice is not used for William's Bottom
- Browser smoke pass:
  - local web app opened at `http://127.0.0.1:8000/app`
  - Map tab opened without a crash
  - camp-search control opened the camp state and rendered `C`/`D` markers
  - console showed no errors; warnings were existing web/Mapbox warnings
  - caveat: the exported web bundle still calls `api.gettrailhead.app`, so the
    browser pass validates UI behavior, while local backend changes are verified
    through direct local API calls.
- Focused Explorer candidate scan:
  - `managed outdoor area`: 0
  - `This stop is`: 0
  - `Check official access`: 0
  - source-only visible region labels: 0
  - repeated ellipsis/source-note fragments: 0

## Explorer Catalog Live Copy + Section Search Pass

Time: 2026-07-04 afternoon

### Scope

- Tightened public Explore copy cleanup for clipped fallback sentences,
  broken web fragments, unmatched quote marks, route-helper wording, and stale
  source-heavy phrasing.
- Added natural section intent handling so searches like `Moab trails`,
  `Yosemite trails`, and `Glacier campgrounds` prefer the right Explorer
  section without needing users to pick a filter first.
- Tightened camp and trail section filters so non-overnight records, ticket
  pages, shuttle pages, boating/river access, generic activities, and
  trailhead-only abbreviations do not fill campground results.
- Added Moab disambiguation so plain `Moab` does not surface far-away
  `Little Moab` records unless the query asks for Little Moab.
- Added same-title near-point dedupe in ranked Explore cards.
- Rebuilt canonical serving indexes after rule changes.

### Files Touched In This Pass

- `dashboard/server.py`
- `scripts/data/canonical_catalog_rules.py`
- `scripts/explore_sources/base/content_quality.py`
- `tests/test_trail_catalog.py`
- `data/processed/canonical_serving/*`
- `dashboard/site/public/app/_expo/static/js/web/entry-4c4c9039ac9f7e79578d5908a25502c2.js`
- Exported `/app` HTML under `dashboard/site/public/app/`

### Serving Counts After Rebuild

- camps: 20,409
- trails: 49,218
- Explore: 9,470

### Local API Probes

Local server: `http://127.0.0.1:8099`

- `/api/explore/catalog/index?q=moab%20trails&limit=8`
  - Non-empty.
  - Top results were trail/area relevant: Moab, Moab Brands Trailhead, Moab Rim
    Trailhead, Moab Rim Trail, Fins and Things OHV Route, Corona Arch
    Trailhead.
  - No far-away Little Moab record for plain Moab intent.
- `/api/explore/catalog/index?q=yosemite%20trails&limit=8`
  - Non-empty.
  - Top results were trail/area relevant.
  - No generic activity cards such as film pages in the first results.
- `/api/explore/catalog/index?q=glacier%20campgrounds&limit=8`
  - Non-empty.
  - Top results were campground-like records.
  - No hotel, shuttle, ticket, river access, boating, climbing route, sno-park,
    or trailhead abbreviation cards in the first results.
- `/api/explore/catalog/index?q=moab&limit=8`
  - Non-empty.
  - No duplicate title/category pair in the first six cards.

All local API probes checked for missing/dead-state copy, clipped sentence
fragments, broken source text, unmatched quotes, and internal wording.

### Live Browser Evidence

Unauthenticated mobile-sized pass:

- `/tmp/trailhead-live-visual-pass/guide.png`
- `/tmp/trailhead-live-visual-pass/map.png`
- `/tmp/trailhead-live-visual-pass/route-builder.png`

Authenticated mobile-sized pass with the Codex test account:

- `/tmp/trailhead-live-visual-pass-auth/profile-auth.png`
- `/tmp/trailhead-live-visual-pass-auth/guide-auth.png`
- `/tmp/trailhead-live-visual-pass-auth/map-auth.png`
- `/tmp/trailhead-live-visual-pass-auth/route-builder-auth.png`

Observed result:

- Profile showed the signed-in account and Explorer access.
- Guide opened without dead states or banned public copy.
- Map opened without crashing.
- Route Builder opened without the broken blank state.
- Console showed expected web/Mapbox warnings only; no page errors.

### Verification

- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_explore_serving`
- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_camp_serving tests.test_canonical_explore_serving tests.test_trail_catalog`
- `python3 -m py_compile dashboard/server.py scripts/data/canonical_catalog_rules.py scripts/explore_sources/base/content_quality.py`
- `cd mobile && node scripts/user-facing-copy-audit.mjs components/explore/ExploreTrailArea.tsx components/explore/ExploreDetailSheet.tsx app/'(tabs)'/guide.tsx`
- `cd mobile && npx tsc --noEmit --pretty false`
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
- `npm run build`

### Remaining Follow-Up

- Map authenticated screenshot still shows a white Mapbox control area close to
  the top search field on web. This should get a focused map-control layout
  pass, but it did not block this Explore/catalog pass.
- First-run setup can intercept web sign-in until dismissed. This may be
  intended onboarding, but it is worth a later account-flow polish pass.

## Premium Catalog + Trail Facts Pass

Time: 2026-07-04 late afternoon

### Persistent Goal Saved

- Build Trailhead toward a premium outdoor catalog: fast local reads from the
  official/dispersed data cache, strong dedupe, enriched cards first, no dead
  ends, no clipped copy, no internal/source wording in normal screens, and no
  filler labels.
- Explorer should keep moving toward a complete destination catalog with
  official-quality parks, camps, stays, things to do, things to see, and trails.
- Trail work should move toward an AllTrails-like trail experience, but visual
  redesigns must be planned in Figma first with Mobbin/Dribbble reference
  passes before frontend layout changes.

### Implemented

- Improved generated USFS trail titles:
  - Fixed possessives such as `Amy'S Arrived` -> `Amy's Arrived`.
  - Preserved/cleaned common route acronyms such as PCT, MST, ANST, NRT, OHV,
    ORV, ATV, and USFS.
  - Expanded common map abbreviations where safe: Creek, Fork, Mount,
    Mountain, Road, and Campground.
- Added generated trail facts to every trail record:
  - `activity`
  - `fact_labels`
  - `quality_score`
- Added trail activity inference:
  - Hiking trail
  - Bike trail
  - Horse trail
  - OHV route
  - Snowmobile route
  - Water route
- Improved thin trail summaries:
  - Replaced generic `has trail access nearby` fallback with
    `Hiking trail. Check route distance, current conditions, and access before
    you go.`
  - Long trail summaries now include activity when distance is the only hard
    fact, for example `75.3 miles. Hiking trail.`
- Served generated trail profiles now carry:
  - `card.facts`
  - `summary.tags`
  - `facts.distance`
  - `facts.distance_mi`
  - `facts.activity`
  - `facts.surface` when available
  - `trails[0]` with title, route type, distance, description, source label,
    tags, and coordinates.
- Removed the generic `Offline / Recommended` fact from Explore cards.
- Trail plan notes now prefer real explicit trail facts for route, distance,
  difficulty, and surface instead of generic route-line wording.

### Serving Counts After Rebuild

- camps: 20,409
- trails: 49,217
- Explore: 9,470

### Sample Data Checks

- `Amy's Arrived`
  - summary: `Hiking trail. Check route distance, current conditions, and
    access before you go.`
  - facts: `Hiking trail`
- `PCT: Methow Valley N. Terminus`
  - summary: `75.3 miles. Hiking trail.`
  - facts: `75.3 mi`, `Hiking trail`
- `Mccabe Creek - North Fork Blackfoot`
  - summary: `26.7 miles. Hard. Snowmobile route. Snow route.`
  - facts: `26.7 mi`, `Hard`, `Snowmobile route`, `Snow route`
- `Castle Creek Campground Bridge Trail`
  - summary: `Hiking trail. Check route distance, current conditions, and
    access before you go.`
  - facts: `Hiking trail`

Generated trail scan after rebuild:

- `fact_labels` present: 49,217 / 49,217
- `quality_score` present: 49,217 / 49,217
- bad possessive title count: 0
- leftover `Pct` mixed-case title count: 0

### Live/Runtime Evidence

- Local Playwright mobile Guide load:
  - `http://127.0.0.1:8099/app/guide?trailFactsPass=1`
  - Screenshot: `/tmp/trailhead-guide-trail-facts-pass.png`
  - Page errors: none
  - Banned visible text scan: none
- Local server logs showed 200 responses for:
  - `/api/explore/catalog/index?q=PCT%20Methow%20Valley&limit=8`
  - `/api/explore/catalog/index?q=PCT%20Methow%20Valley&limit=3`
  - `/app/guide?trailFactsPass=1`
- Direct generated profile check:
  - `trail:usfs:7800-004574` returns `75.3 miles. Hiking trail.`
  - `trail:usfs:3840010361` returns `Hiking trail. Check route distance,
    current conditions, and access before you go.`

### Verification

- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_explore_serving`
- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_camp_serving tests.test_canonical_explore_serving tests.test_trail_catalog`
- `python3 -m py_compile dashboard/server.py scripts/data/build_canonical_serving_indexes.py scripts/data/canonical_catalog_rules.py`
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
- `cd mobile && npx tsc --noEmit --pretty false`
- `cd mobile && node scripts/user-facing-copy-audit.mjs components/explore/exploreDisplay.ts components/explore/ExploreDetailSheet.tsx app/'(tabs)'/guide.tsx`
- `npm run build`

### Bundle

- Current exported app bundle:
  - `dashboard/site/public/app/_expo/static/js/web/entry-4716817071e1474cb078b1c1459c340d.js`

### Follow-Up

- Trail search over HTTP returned 200 in server logs but was slow enough for a
  15-second client timeout during one probe. Add a focused search-performance
  pass before claiming trail search is premium at scale.
- Next UI work for trail detail/list cards should begin with a Figma design
  checkpoint using Mobbin/Dribbble references before changing layout.

## Explorer Search Performance + Trail Dedupe Pass

Time: 2026-07-04 evening

### Problem Confirmed

- Full `/api/explore/catalog/index?q=PCT%20Methow%20Valley&limit=8` endpoint
  could take about 28 seconds on a cold in-process call.
- Profile evidence showed the stall was mostly `_load_explore_catalog()`:
  - full catalog sanitize and public-label cleanup
  - cache invalidated by age after 120 seconds even when source files were
    unchanged
- Canonical trail search also paid a first-query JSON/tokenization cost because
  the 49k trail serving index was not warmed during startup.

### Implemented

- Changed Explore catalog cache from short age-based reload to file-stat based
  reload. The catalog now stays cached until one of the source files changes.
- Added startup prewarm for canonical serving indexes:
  - Explore serving index
  - Trail serving index
  - Camp serving index
- Added in-memory canonical search parts per item so repeated trail/explore
  searches reuse tokenized search text instead of rebuilding it for every
  request.
- Tightened same-title trail dedupe in ranked results:
  - same-title trail cards within 3.5 km collapse to one card
  - differently named loop/variant cards remain visible

### Timing Evidence

Before this pass:

- Cold in-process endpoint call:
  - `PCT Methow Valley`: about 28,401 ms
- Warm direct canonical search:
  - often 180-300 ms, but first trail search had to load the 27 MB trail index

After this pass, with local server startup prewarm complete:

- `Lolo Forks`: 770.4 ms, 1 result, duplicate collapsed
- `PCT Methow Valley`: 157.0 ms, 1 result
- `Moab trails`: 226.5 ms, 6 results
- `Glacier campgrounds`: 566.4 ms, 41 total, 8 returned
- `Hidden Valley Trail`: 300.7 ms, 20 total, 8 returned

### Live Browser Evidence

- Local Playwright mobile Guide load:
  - `http://127.0.0.1:8099/app/guide?searchPerfDedupePass=1`
  - Screenshot: `/tmp/trailhead-guide-search-perf-dedupe-pass.png`
  - Page errors: none
  - Banned visible text scan: none

### Verification

- `python3 -m unittest tests.test_canonical_explore_serving tests.test_canonical_catalog_rules`
- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_camp_serving tests.test_canonical_explore_serving tests.test_trail_catalog`
- `python3 -m py_compile dashboard/server.py scripts/data/build_canonical_serving_indexes.py scripts/data/canonical_catalog_rules.py`
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`

### Follow-Up

- Startup prewarm still takes roughly 25-30 seconds locally because the full
  Explore catalog sanitize is expensive. It no longer hits normal user searches
  every 120 seconds, but a future build-time sanitized catalog cache would make
  deploy startup cleaner.

## Explore Runtime Cache + Location Ranking Pass

### Scope

- Continued the Explorer catalog performance pass after the in-memory file-key
  cache work.
- Added a generated runtime cache for the fully sanitized Explore catalog so
  process restarts do not repeat the full merge/sanitize pass when source files
  have not changed.
- Kept the cache internal and generated under ignored `data/processed/`.

### Implemented

- Added `EXPLORE_RUNTIME_CACHE_VERSION` and `EXPLORE_RUNTIME_CACHE_PATH`.
- Runtime cache validation now checks:
  - cache version
  - source file stat key
  - catalog payload shape
- Runtime cache writes are atomic via temp file replacement and fail closed if
  the filesystem is unavailable.
- `_load_explore_catalog()` now checks memory first, then disk, then rebuilds
  and persists the sanitized catalog.
- Added query ranking penalty for Explore cards without coordinates so broad
  location searches do not lead with cards that cannot open cleanly on the map.

### Timing Evidence

- In-process cache timing with `/tmp/trailhead-explore-runtime-cache.json`:
  - first full sanitize/write: 24,558.5 ms
  - second load from runtime cache after clearing memory: 105.8 ms
  - place count matched across both loads: 3,943
  - runtime cache size: about 23 MB

### Live API Evidence

- Local server: `http://127.0.0.1:8099`
- `Moab trails`, limit 4:
  - 0.6606s
  - first cards: Moab Brands Trailhead, Moab Rim Trailhead, Fins and Things OHV
    Route, then the coordinate-less Moab trail card
- `PCT Methow Valley`, limit 4:
  - 0.8844s
  - first card: PCT: Methow Valley N. Terminus
- `Glacier campgrounds`, limit 4:
  - 1.4100s
  - first cards: Glacier Campgrounds, Many Glacier Campground, Big Pine Canyon
    Group- Clyde Glacier Cam, Clyde Glacier Group Camp

### Verification

- `python3 -m unittest tests.test_canonical_explore_serving`
- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_camp_serving tests.test_canonical_explore_serving tests.test_trail_catalog`
- `python3 -m py_compile dashboard/server.py`
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`

### Follow-Up

- Fresh deploy startup still waits on the broader index prewarm path. The
  runtime cache removes the expensive sanitized catalog rebuild after the cache
  exists, but the next performance pass should separate startup readiness from
  background index warming or ship a deliberate build artifact strategy.
- Catalog audit still reports non-blocking duplicate clusters in the Explore
  serving index. Blocking copy/category checks pass, but those duplicate
  clusters should be handled in a dedicated dedupe scoring pass.

## Non-Blocking Startup + Runtime Cache Guard Pass

### Scope

- Continued the catalog runtime performance pass.
- Goal was to stop app readiness from waiting on heavy catalog/index warming
  while keeping first live Explorer searches stable.

### Implemented

- `run.py`
  - Canonical serving index rebuilds now default to background mode when stale.
  - Blocking rebuilds are still available with
    `TRAILHEAD_CANONICAL_INDEX_BUILD_MODE=blocking` or
    `TRAILHEAD_BLOCKING_CANONICAL_INDEX_BUILD=1`.
  - `TRAILHEAD_REQUIRE_CANONICAL_INDEXES=1` still forces blocking failure
    behavior.
- `dashboard/server.py`
  - FastAPI startup now schedules catalog prewarm in the background by default.
  - Blocking startup prewarm is still available with
    `TRAILHEAD_CATALOG_PREWARM_MODE=blocking` or
    `TRAILHEAD_BLOCKING_CATALOG_PREWARM=1`.
  - Background prewarm warms the sanitized Explore catalog first, then delays
    larger serving-index prewarm by `TRAILHEAD_SERVING_INDEX_PREWARM_DELAY_SECONDS`
    seconds, default `10`.
  - Added locks around Explore/trail/camp serving index loads so background
    work and live requests do not parse the same large JSON files at once.
  - Runtime Explore cache writes now refuse fixture/non-default catalog paths
    unless `TRAILHEAD_EXPLORE_RUNTIME_CACHE` explicitly points elsewhere.
  - Runtime Explore cache writes also refuse tiny fallback catalogs.
  - Query matching now handles simple singular/plural variants, so searches
    like `Moab trails` match `Trail` and `Trailhead` records.

### Issue Found And Fixed

- A test fixture had written a tiny runtime cache to
  `data/processed/explore_catalog_runtime_cache.json`.
- Because its source key did not match the real catalog, it was not served, but
  it forced the app to rebuild the full sanitized catalog on startup.
- The cache was regenerated from the real catalog:
  - 3,943 places
  - about 23 MB
  - rebuild took 24,609.5 ms

### Live Startup Evidence

- Local startup probe:
  - `python3 run.py --port 8099`
  - application readiness: 707.5 ms
- Immediate Explorer API checks after readiness:
  - `Moab trails`: 1,358.5 ms, count 6
    - first cards: Moab Brands Trailhead, Moab Rim Trailhead, Fins and Things
      OHV Route
  - `PCT Methow Valley`: 395.6 ms, count 1
    - first card: PCT: Methow Valley N. Terminus
  - `Glacier campgrounds`: 602.8 ms, count 41
    - first cards: Glacier Campgrounds, Many Glacier Campground, Big Pine
      Canyon Group- Clyde Glacier Cam

### Verification

- `python3 -m unittest tests.test_canonical_explore_serving tests.test_startup_prewarm`
- `python3 -m unittest tests.test_startup_prewarm tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_camp_serving tests.test_canonical_explore_serving tests.test_trail_catalog`
- `python3 -m py_compile dashboard/server.py run.py scripts/data/build_canonical_serving_indexes.py scripts/data/canonical_catalog_rules.py`
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`

### Follow-Up

- Explore serving index still has non-blocking duplicate clusters from official
  source overlap. The next pass should improve canonical dedupe scoring for
  same-place campground/trailhead variants without hiding genuinely distinct
  nearby assets.
- Fresh deploys without a persisted `data/processed/explore_catalog_runtime_cache.json`
  will still need one full sanitized catalog build. The current behavior keeps
  app readiness fast, but a deliberate build artifact or persistent volume
  policy is still needed for consistent production cold deploys.

## Explore Serving Dedupe + Permit Classification Pass

### Scope

- Continued the canonical catalog polish pass.
- Goal was to stop same-place official records from surfacing as repeated
  Explore cards while keeping exact searches and permit/pass records findable.

### Implemented

- `scripts/data/build_canonical_serving_indexes.py`
  - Added Explore-specific duplicate suppression before writing
    `data/processed/canonical_serving/explore.candidate.json`.
  - Dedupe key uses normalized public title plus rounded location, matching the
    serving audit's duplicate logic.
  - Duplicate scoring now prefers current, richer, non-generic records and
    demotes stale `(OLD)` records and year-marked timed-entry records.
  - Public Explore titles strip `(OLD)` and timed-entry year markers.
  - Sentence cleanup now preserves abbreviations such as `Mt. Whitney` instead
    of clipping to `Mt.`.
  - Timed-entry and permit records now classify under `things` instead of
    `camping`, so they do not pollute camp/stay results.
  - Source spacing cleanup handles source text like `Campgroundis located`.
- `dashboard/server.py`
  - Permit/timed-entry queries now infer the `things` category instead of
    `park`, so exact searches such as `Denali Park Road Timed Entry` surface
    the permit card.
  - Broad-search low-value filtering now treats `timed` and `entry` as explicit
    permit search terms.
- `scripts/data/audit_canonical_catalog.py`
  - Narrowed rough-copy detection so complete phrases like `as a backdrop` are
    not false positives.
- Tests added for:
  - current-vs-old Explore record preference
  - campground name variant collapse
  - mount abbreviation sentence handling
  - timed-entry records leaving camping and remaining searchable
  - rough-copy false positive around complete `as a` phrases

### Generated Data

- Rebuilt canonical serving indexes:
  - camps: 20,409
  - trails: 49,217
  - Explore: 9,446
- Regenerated sanitized Explore runtime cache:
  - 3,943 places
  - cold rebuild: 24,624.6 ms
  - previous warm cache load in this pass: 181.8 ms

### Audit Result

- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  passed after rebuild.
- Serving audit summary:
  - camps: duplicate clusters 0, rough copy 0, forbidden copy 0, loose RV 0,
    non-overnight camps 0
  - Explore: duplicate clusters 0, rough copy 0, forbidden copy 0, loose RV 0,
    non-overnight camps 0
  - trails: duplicate clusters 0, rough copy 0, forbidden copy 0
  - official search bad categories: 0

### Live API Evidence

- Local server: `http://127.0.0.1:8099`
- `Moab trails`, limit 5:
  - 836.6 ms
  - first cards: Moab Brands Trailhead, Moab Rim Trailhead, Fins and Things
    OHV Route, Moab, Corona Arch Trailhead
- `Glacier campgrounds`, limit 5:
  - 649.1 ms
  - first cards: Glacier Campgrounds, Many Glacier Campground, Big Pine Canyon
    Group- Clyde Glacier Cam, Clyde Glacier Group Camp, Exit Glacier Campground
- `Long Branch Campground`, limit 8:
  - 164.2 ms
  - two cards remain because they are different locations; same-location
    Long Branch variants collapsed.
- `Denali Park Road Timed Entry`, limit 5:
  - 327.0 ms
  - first card: Denali Park Road Timed Entry
  - category: Permit Required

### Verification

- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving`
- `python3 -m unittest tests.test_startup_prewarm tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_camp_serving tests.test_canonical_explore_serving tests.test_trail_catalog`
- `python3 -m py_compile dashboard/server.py scripts/data/build_canonical_serving_indexes.py scripts/data/audit_canonical_catalog.py`
- `python3 scripts/data/build_canonical_serving_indexes.py`
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
- Local server smoke checks against `/api/explore/catalog/index`.

### Follow-Up

- The duplicate audit is clean for the generated serving files. Future work
  should focus on richer source descriptions and better region-specific ranking,
  not redoing this same duplicate pass.
- Fresh deploys still need either a persisted runtime cache or a build artifact
  for the first full sanitized Explore cache build.

## Trail Catalog Facts + Acronym Search Pass

### Scope

- Continued the Explorer/catalog work toward richer trail surfaces.
- Goal was to improve the generated trail serving data without doing a visual
  redesign in this pass.

### Implemented

- `scripts/data/build_canonical_serving_indexes.py`
  - Added route-shape detection from official trail geometry.
  - Emits `Loop` only when the line geometry proves the trail closes back near
    its start.
  - Adds `route_shape` to fact labels and summaries when known.
  - Adds `geometry_ref` to every generated trail record so detail/preview
    surfaces have a stable lightweight reference.
  - Fixed motorized trail classification:
    - `Motorcycling` now maps to `OHV route`.
    - raw allowed-use labels now include `Motorcycling`.
  - Known public trail acronyms are no longer hidden as review-only just
    because they are short:
    - AT, AZT, BMT, CDT, JMT, MST, PCT, PNT.
- `dashboard/server.py`
  - Trail cards now pass `route_shape` and `geometry_ref` through to API
    profiles.
  - Trail source attribution now uses the official source label at top level
    instead of falling back to Trailhead.
  - Missing trail difficulty no longer renders a generic filler label.
  - Known trail acronym searches such as `PCT` now infer the trail category,
    so actual trail records lead ahead of permit/place records.
- Tests added for:
  - motorcycling becoming OHV route
  - Loop route-shape detection
  - public trail acronym review behavior
  - route shape and geometry reference pass-through
  - known trail acronym category hinting

### Generated Data

- Rebuilt canonical serving indexes:
  - camps: 20,409
  - trails: 49,217
  - Explore: 9,446
- Trail serving file after rebuild:
  - review-only trails: 2,205
  - Loop facts: 1,304
  - geometry references: 49,217
  - OHV route labels: 7,997
- Regenerated sanitized Explore runtime cache after rebuild:
  - 3,943 places
  - cold rebuild: 24,747.5 ms

### Live API Evidence

- Local server: `http://127.0.0.1:8099`
- `PCT`, limit 5:
  - 1,329.3 ms
  - first cards are all trails:
    - PCT: Methow Valley N. Terminus
    - PCT: Plumas
    - PCT: Cle Elum North
    - PCT: Wenatchee River North
    - PCT: Naches North
- `motorcycle trails`, limit 5:
  - 555.8 ms
  - first cards are motorcycle trailheads.
- `Moab trails`, limit 5:
  - 341.1 ms
  - first cards: Moab Brands Trailhead, Moab Rim Trailhead, Fins and Things
    OHV Route, Moab, Corona Arch Trailhead.

### Verification

- `python3 -m unittest tests.test_canonical_explore_serving tests.test_canonical_catalog_rules`
- `python3 -m unittest tests.test_startup_prewarm tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_camp_serving tests.test_canonical_explore_serving tests.test_trail_catalog`
- `python3 -m py_compile dashboard/server.py scripts/data/build_canonical_serving_indexes.py scripts/data/audit_canonical_catalog.py`
- `python3 scripts/data/build_canonical_serving_indexes.py`
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
- Local server smoke checks against `/api/explore/catalog/index`.

### Follow-Up

- This pass improves trail facts and search behavior, but it does not complete
  the AllTrails-like visual trail detail surface.
- Remaining trail enrichment should target:
  - elevation profiles from DEM data
  - trail photos where license allows
  - better trailhead grouping for nearby segments
  - richer route preview screens using `geometry_ref`

## Generated Trail Detail + Preview Fallback

### Scope

- Fixed generated official trail records opening as dead ends.
- Kept the work backend/API-only because the broader trail visual redesign
  still needs the Figma/Mobbin pass before UI changes.

### Implemented

- `dashboard/server.py`
  - Added a read-only trail detail fallback from
    `data/processed/trailhead_official_data.sqlite`.
  - User/open trail profiles still win first.
  - Generated official trail IDs such as `trail:usfs:7800-004574` now resolve
    through the official cache when the editable profile table has no row.
  - Type-less official route coordinate blobs are normalized into LineString or
    MultiLineString geometry for preview use.
  - Official fallback profiles reuse the same public trail title, difficulty,
    surface, use, route-shape, and summary formatting as the canonical serving
    index.
  - Preview manifests no longer double-prefix generated `trail:` IDs.
- `tests/test_trail_catalog.py`
  - Added a temp SQLite fixture that mirrors the official trail table.
  - Covers generated trail detail and preview fallback against type-less
    MultiLineString geometry.

### Live API Evidence

- Local server: `http://127.0.0.1:8099`
- `/api/trails/trail%3Ausfs%3A7800-004574`
  - id: `trail:usfs:7800-004574`
  - name: `PCT: Methow Valley N. Terminus`
  - source label: `US Forest Service`
  - preview available: true
  - geometry ref: `trail:usfs:7800-004574`
- `/api/trails/trail%3Ausfs%3A7800-004574/preview`
  - status: available
  - route id: `trail:usfs:7800-004574`
  - coordinates: 4,774
  - keyframes: 6

### Verification

- `python3 -m py_compile dashboard/server.py scripts/data/build_canonical_serving_indexes.py tests/test_trail_catalog.py`
- `python3 -m unittest tests.test_trail_catalog`
- `python3 -m unittest tests.test_startup_prewarm tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_camp_serving tests.test_canonical_explore_serving tests.test_trail_catalog`
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
- Local HTTP smoke checks against `/api/trails/{trail_id}` and
  `/api/trails/{trail_id}/preview`.

### Follow-Up

- The generated trail detail/preview dead-end is fixed.
- Next trail work should focus on the designed AllTrails-like screen:
  Figma/Mobbin reference first, then UI implementation.
- Remaining data work can enrich generated trail detail with elevation profiles,
  photos where allowed, and trailhead grouping.

## Explore Stay + Pakistan Trek No-Empty Pass

### Scope

- Continued the catalog/API audit without UI redesign.
- Focused on real empty states found through local API smoke checks.
- No Figma/Mobbin work was done in this pass because no visual changes were
  made.

### Issues Found

- `Big Sur where to stay` with a lodging/stay intent returned no cards even
  though nearby official camp records were available in the canonical camp
  index.
- `K2 Base Camp Trek`, `Laila Peak`, `Mashabrum trek`, and `K7 Charakusa`
  trail searches did not surface the curated Pakistan/Karakoram trek catalog in
  Explore.
- `K2 Base Camp Trek` was category-hinted as camp because of the phrase
  `Base Camp`.
- Generated Pakistan trek cards opened as 404s from Explore detail.
- Canonical camp cards could open through a broader Explore fallback with a
  generic source instead of matching the list card source.

### Implemented

- `dashboard/server.py`
  - Added stay-intent query handling for `where to stay`, lodging, cabins,
    hotels, and related terms.
  - Added stay fallback that:
    - extracts the destination from the query,
    - finds the destination coordinates from existing catalog data,
    - loads nearby canonical camp records,
    - turns them into clean Explore stay/camp cards.
  - Preserves camp source/distance ranking for stay fallback instead of
    re-sorting by generic destination words.
  - Added curated Pakistan/Karakoram trek Explore cards from the existing
    curated trek source.
  - Added ID lookup so generated `pk:*` trek cards open in
    `/api/explore/places/{place_id}`.
  - Added canonical camp ID lookup so camp cards open with the same source and
    copy shown in the list.
  - Adjusted category hinting so trek/trail intent wins over `Base Camp`
    wording.
  - Tightened duplicate removal for exact trek/base-camp/glacier/peak titles.
  - Cleaned all-caps fallback campground source labels into readable sentences.
- `tests/test_trail_catalog.py`
  - Added regression coverage for:
    - K2 Base Camp Trek search hinting to trail.
    - K2 results surfacing curated trek cards.
    - exact K2 title not duplicating.
    - K2 card detail opening successfully.
    - Big Sur stay search falling back to nearby camp cards.
    - Big Sur card/detail source consistency.
    - no visible banned/internal wording in the new stay fallback output.

### Live API Evidence

- Local server: `http://127.0.0.1:8099`
- `Big Sur where to stay`, category `lodging`:
  - count: 19
  - first cards:
    - China Camp Campground
    - White Oaks Campground
    - Arroyo Seco Group Campground
  - first detail opened:
    - id: `place:ridb:273878`
    - title: `China Camp Campground`
    - category: `Campground`
    - source: `Recreation.gov`
- `K2 Base Camp Trek`, category `trail`:
  - count: 9
  - first cards:
    - K2 Base Camp Trek
    - Gondogoro La Trek
    - Passu Glacier View Trek
  - first detail opened:
    - id: `pk:trek:k2-base-camp-trek`
    - title: `K2 Base Camp Trek`
    - category: `Trek`
    - source: `Pakistan trek guide`
    - trail cards: 1
- Additional live checks:
  - `Laila Peak`
  - `Mashabrum trek`
  - `K7 Charakusa`
  - `Moab trails`
  - `Glacier campgrounds`
  - `PCT`

### Verification

- `python3 -m py_compile dashboard/server.py tests/test_trail_catalog.py`
- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_explore_serving`
- `python3 -m unittest tests.test_startup_prewarm tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_camp_serving tests.test_canonical_explore_serving tests.test_trail_catalog`
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
- Fresh local HTTP smoke checks against:
  - `/api/explore/catalog/index`
  - `/api/explore/places/{place_id}`

### Follow-Up

- Remaining Explorer work should continue with live visual/browser passes.
- The trail detail UI still needs the required Figma/Mobbin design-first pass
  before any AllTrails-like screen implementation.

## Checkpoint: Public Copy Boundary Pass

### Scope

- Removed remaining rough route/source fallback wording from Explorer and trail
  surfaces without changing screen structure.
- Kept changes focused on public copy boundaries:
  - Explore profile response cleaning.
  - Canonical trail fallback summaries.
  - Explore source fallback templates.
  - Mobile trail/detail/navigation fallback labels.

### Files Touched

- `dashboard/server.py`
  - Replaced `route details` fallback language with concise access/closure
    guidance.
  - Added `_clean_explore_public_response_profile()` and applied it to
    `/api/explore/places` responses so full profile payloads are cleaned before
    reaching the app.
- `scripts/data/build_canonical_serving_indexes.py`
  - Updated generated trail fallback summaries from `Check route distance...`
    to `Check distance...`.
- `scripts/explore_sources/base/content_quality.py`
  - Removed `mapped` and `route details` phrasing from trail/trailhead/park
    fallback descriptions.
- `scripts/explore_sources/base/cards.py`
  - Removed `Mapped...` tone from category fallback cards.
- `scripts/explore_sources/wikidata/import_wikidata.py`
  - Removed `Wikidata-linked` and `route details` from generated fallback
    summaries.
- `mobile/components/explore/ExploreTrailArea.tsx`
- `mobile/components/explore/ExploreDetailSheet.tsx`
- `mobile/components/explore/exploreDisplay.ts`
- `mobile/app/(tabs)/map.tsx`
  - Cleaned trail/navigation fallback text.
- Tests:
  - `tests/test_trail_catalog.py`
  - `tests/test_canonical_catalog_rules.py`
  - `tests/test_canonical_explore_serving.py`

### Live API Evidence

- Local server: `http://127.0.0.1:8765`
- `/api/explore/places` checks:
  - `Moab trails`, category `trail`: count 8, no banned public wording.
    - Fins and Things now reads:
      `Fins and Things OHV Route. Check current access, seasonal closures, fire restrictions, and local rules before you go.`
  - `Glacier campgrounds`, category `campground`: count 8, no banned public wording.
  - `Big Sur where to stay`, category `lodging`: count 8, no banned public wording.
  - `K2 Base Camp Trek`, category `trail`: count 8, no banned public wording.
  - `Laila Peak`, category `trail`: count 8, no banned public wording.
- Camp endpoint checks around Moab:
  - `/api/campsites/search`: 49 results.
  - `/api/nearby-camps`: 24 results.
  - `/api/camps/bbox`: 47 results.
  - Top Moab mixed-use campgrounds are still labeled `Campground`, not `RV`.

### Verification

- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_explore_serving tests.test_trail_catalog`
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
- Fresh local API smoke against:
  - `/api/explore/places`
  - `/api/campsites/search`
  - `/api/nearby-camps`
  - `/api/camps/bbox`

### Remaining Notes

- Large generated/static files still contain historical strings until the next
  app export/build refresh; source code and live API response paths are clean.
- Some Glacier campground names from source data are still clipped-looking
  (`Big Pine Canyon Group- Clyde Glacier Cam`). That is source-title quality,
  not the route-copy issue fixed in this pass.

## Checkpoint: Clipped Campground Title Repair

### Scope

- Repaired obvious fixed-width campground/source title truncations before they
  reach Explorer, camp search, nearby camp, and map pin payloads.
- Kept stable internal IDs unchanged so detail/selection flows continue to work.
- Applied repair only when surrounding context supports the outdoor meaning:
  `Cam`/`CG` as campground, `Campgroun` as campground, and `Rec` as recreation
  area.

### Files Touched

- `scripts/data/canonical_catalog_rules.py`
  - Added `repair_public_title()` as the shared public title repair helper.
- `scripts/data/build_canonical_serving_indexes.py`
  - Applied title repair while building canonical camp and Explorer serving
    records.
- `dashboard/server.py`
  - Applied title repair at the live Explorer response boundary.
  - Added `_camp_public_name()` and used it for canonical camp conversion and
    lightweight map pin records.
- Tests:
  - `tests/test_canonical_catalog_rules.py`
  - `tests/test_canonical_camp_serving.py`
  - `tests/test_trail_catalog.py`

### Live API Evidence

- Local server: `http://127.0.0.1:8765`
- `/api/explore/places?q=Glacier+campgrounds&category=campground&limit=8`
  - Includes `Big Pine Canyon Group - Clyde Glacier Campground`.
  - No returned visible title ended with `Cam`, `Campgroun`, or `Rec`.
- `/api/nearby-camps` around `37.128632,-118.422588`, mode `light`
  - Includes `Big Pine Canyon Group - Clyde Glacier Campground`.
  - No returned visible name ended with `Cam`, `Campgroun`, or `Rec`.
- `/api/camps/bbox` around the same Big Pine area, mode `light`
  - Includes `Big Pine Canyon Group - Clyde Glacier Campground`.
- Moab `/api/camps/bbox` smoke
  - Returned 39 visible camp records for the test viewport.
  - Visible copy did not include `ridb`, `download`, `api`, `raw data`, or
    `source data`.
  - `King's Bottom Campground` was not mislabeled as `RV Park`.

### Verification

- `python3 -m py_compile dashboard/server.py scripts/data/canonical_catalog_rules.py scripts/data/build_canonical_serving_indexes.py`
- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_explore_serving tests.test_canonical_camp_serving tests.test_trail_catalog`
  - 82 tests passed.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.

### Remaining Notes

- `/api/campsites/search` live smoke hit the local anonymous search limiter
  after repeated test calls. The same camp-name path is covered by unit tests
  and the unauthenticated live `/api/nearby-camps` and `/api/camps/bbox` routes.
- The catalog audit still reports low-quality trail names in review-only data.
  It exits cleanly and reports no rough public copy in serving indexes.

## Checkpoint: Broad Destination Search Cleanup

### Scope

- Fixed `/api/explore/places` so it uses the same broad-destination search
  guard as `/api/explore/catalog/index`.
- This removes far/off-target title-only matches from full Explorer profile
  searches. The concrete failure was `Moab trails` returning `Little Moab`
  records from outside the Moab area.
- No UI redesign was done in this checkpoint; this was a backend/catalog
  stability pass.

### Files Touched

- `dashboard/server.py`
  - Applied `_explore_skip_for_broad_search()` to `/api/explore/places`
    after merging official/canonical results and before sorting.
- `tests/test_trail_catalog.py`
  - Added endpoint-level regression for `Moab trails`, ensuring far
    `Little Moab` matches are removed, real Moab trailheads remain, and visible
    titles are not duplicated.

### Live API Evidence

- Local server: `http://127.0.0.1:8765`
- `/api/explore/places?q=Moab+trails&category=trail&limit=12`
  - Passed: no `Little Moab`.
  - Passed: includes `Moab Brands Trailhead`.
  - Passed: no duplicate visible titles.
  - Returned titles:
    - `Moab Brands Trailhead`
    - `Moab Rim Trailhead`
    - `Fins and Things OHV Route`
    - `Moab`
    - `Corona Arch Trailhead`
    - `Moab Rim Trail`
- Additional visible-copy smokes passed:
  - `Yosemite things to do`
  - `Glacier campgrounds`
  - `Big Sur where to stay`
  - Checked visible summary/title/source fields for banned source/dev wording.

### Verification

- `python3 -m py_compile dashboard/server.py`
- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_explore_serving tests.test_canonical_catalog_rules tests.test_canonical_camp_serving`
  - 83 tests passed.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.

### Remaining Notes

- Client-side Explorer can still receive late detail/enrichment payloads and
  merge them into the local list. The most obvious backend cause of the Moab
  duplicate/off-target result is fixed.

## Checkpoint: Explorer Prefetch Stabilization

### Scope

- Prevented background detail prefetch from appending new cards to the Explore
  feed.
- Prefetch now enriches records already present in the list only. New cards
  still enter through explicit search/filter/category fetches, which keeps late
  background work from shifting the visible feed.

### Files Touched

- `mobile/app/(tabs)/guide.tsx`
  - Removed the fallback that pushed unseen prefetch detail records into
    `explorePlaces`.

### Verification

- `npm --prefix mobile run audit:copy`
  - Passed.

### Remaining Notes

- A future visual/browser pass should still verify the perceived loading flow
  on device-width screens after OTA/export, especially search refinement and
  guided fallback results.

## Checkpoint: Explorer Trail Search Quality Pass

### Scope

- Removed low-detail trail stubs from broad destination trail searches when
  they have no usable point and only generic fallback copy.
- Tightened query prefix matching so long destination terms do not match much
  shorter partial words. Concrete failure fixed: `Switzerland trails` matched
  a US trail named `Trosi - Switzer`.
- Cleaned the generic outdoor-area fallback sentence used by exact low-detail
  records.

### Files Touched

- `dashboard/server.py`
  - Added `_explore_token_matches_variant()` and reused it in public profile
    and raw canonical query matching.
  - Extended `_explore_skip_for_broad_search()` to drop no-location,
    low-detail trail records on broad searches.
  - Repaired `This stop is an outdoor area. Check access, closures, permits.`
    to a cleaner trail-condition sentence.
- `tests/test_trail_catalog.py`
  - Added regressions for:
    - `Switzer` not matching `Switzerland`.
    - `Moab trails` dropping `Little Moab`, plain `Moab`, and no-location
      `Moab Rim Trail` stubs.
    - `Moab Rim Trail` preferring the usable `Moab Rim Trailhead`.
    - Generic outdoor-area fallback copy cleanup.

### Live API Evidence

- Local server: `http://127.0.0.1:8765`
- `/api/explore/places?q=Moab+trails&category=trail&limit=12`
  - Passed: no `Little Moab`, plain `Moab`, or no-location `Moab Rim Trail`.
  - Returned usable results:
    - `Moab Brands Trailhead`
    - `Moab Rim Trailhead`
    - `Fins and Things OHV Route`
    - `Corona Arch Trailhead`
  - Passed: visible descriptions did not include the generic outdoor-area
    fallback.
- `/api/explore/places?q=Switzerland+trails&category=trail&limit=12`
  - Passed: no `Trosi - Switzer` false match.
- `/api/explore/places?q=Moab+Rim+Trail&category=trail&limit=12`
  - Passed: returned `Moab Rim Trailhead`, not the no-location `Moab Rim Trail`
    stub.

### Verification

- `python3 -m py_compile dashboard/server.py`
- `python3 -m unittest tests.test_trail_catalog`
  - 36 tests passed.
- `python3 -m unittest tests.test_canonical_explore_serving tests.test_canonical_catalog_rules tests.test_canonical_camp_serving tests.test_trail_catalog`
  - 87 tests passed.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.

### Remaining Notes

- `Switzerland trails` now correctly avoids the US `Switzer` false positive,
  but the catalog still needs real Switzerland/Europe trail coverage from
  approved sources in a later data-enrichment pass.

## Checkpoint: Explorer Global Seed Fallback Pass

### Scope

- Connected the existing global Explore seed into the default catalog merge so
  existing-data international cards are available during normal Explorer
  search.
- Added a conservative relaxed fallback for discovery categories. If a narrow
  category search has no exact category match, Explorer can return a matching
  destination card instead of an empty state. Camp and stay searches stay
  strict so campground requests do not silently return parks.
- Cleaned older global seed labels and copy:
  - Public cards show `Destination guide` instead of raw source labels.
  - Removed older generated phrasing from visible fields.
  - Added search aliases for backed regions such as Swiss Alps and Norway
    scenic searches without widening unrelated terms.
- Bumped the Explore runtime cache version so code-only label/copy cleanup
  rebuilds the merged catalog instead of reusing stale public cards.

### Files Touched

- `dashboard/server.py`
  - Added `EXPLORE_GLOBAL_SEED` to the default catalog cache key and merge path.
  - Added global seed profile conversion helpers.
  - Added relaxed destination fallback helpers for backed discovery searches.
  - Merged sidecar aliases/subcategories/search text into existing cards.
  - Cleaned public source labels and old generated global copy.
- `tests/test_trail_catalog.py`
  - Added regressions for `Swiss Alps trails`, `Dolomites trails`, and
    `Norway scenic`.

### Live-Style Query Evidence

- `Switzerland trails` returned backed Switzerland mountain/trail-area cards.
- `Swiss Alps trails` returned backed Switzerland cards.
- `Dolomites trails` returned `World Heritage Dolomites` instead of unrelated
  Italy-wide mountain aliases.
- `Iceland waterfalls` returned backed Iceland outdoor destination cards rather
  than an empty response. Exact Iceland waterfall inventory still needs a
  richer source pack.
- `Norway scenic` returned backed Norway national park cards.
- `Yosemite things to do`, `Moab camps`, `K2 Base Camp Trek`, and `Laila Peak`
  still returned expected existing data.
- Visible list fields checked clean for banned/internal wording.

### Verification

- `python3 -m py_compile dashboard/server.py`
- `python3 -m unittest tests.test_trail_catalog`
  - 39 tests passed.
- `python3 -m unittest tests.test_canonical_explore_serving tests.test_canonical_catalog_rules tests.test_canonical_camp_serving tests.test_trail_catalog`
  - 90 tests passed.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.

### Remaining Notes

- The relaxed fallback is intentionally conservative. It avoids dead Explorer
  states where the catalog has backed destination data, but it does not invent
  exact trail/waterfall/camp inventories for countries that have not been
  enriched yet.
- Good next data pass: add richer Europe/Iceland official or high-quality open
  trail/waterfall packs, then replace broad destination fallback results with
  exact category cards.

## Checkpoint: Explorer Web Search And Card Visual Pass

### Scope

- Verified the `/app/guide` web build was being tested against stale
  `dashboard/site/dist/app` output while `npm run export:webapp` only rewrote
  `dashboard/site/public/app`.
- Synced the exporter so FastAPI local preview and the website public app use
  the same exported Expo bundle.
- Confirmed the apparent search-input click blocker was the expected first-run
  welcome gate. Returning-user state makes the Explorer input directly
  clickable.
- Removed the machine-looking `Road-open season` label from curated Yosemite
  trail data and normalized road-season labels to `Check roads`.
- Added stable query tie-breaking in Explorer results so background enrichment
  does not reorder cards as details arrive.
- Removed the small campground tag pills from Explore hub “Where to Stay”
  cards.
- Replaced blank gray Explore card media fallbacks with outdoor fallback images
  for large and rail cards.

### Files Touched

- `scripts/export_website_app.mjs`
  - Keeps `dashboard/site/public/app` and `dashboard/site/dist/app` in sync.
- `mobile/components/explore/ExplorePlaceCard.tsx`
  - Uses local outdoor fallback images instead of gray icon-only placeholders.
- `mobile/components/explore/ExploreHero.tsx`
  - Keeps the hero search row/input above local hero layers.
- `mobile/components/explore/exploreDisplay.ts`
  - Road-season short labels now read `Check roads`.
- `mobile/components/explore/curatedExplorePlaces.ts`
  - Replaced two curated `Road-open season` values.
- `mobile/app/(tabs)/guide.tsx`
  - Removed campground mini tag pills from hub cards.
  - Added stable matched-rank tie-breaks for query result ordering.

### Live Browser Evidence

- Local server: `http://127.0.0.1:8099`
- Returning-user Explorer search:
  - URL: `/app/guide?audit=explore-stable-shot-*`
  - Query: `Yosemite campgrounds`
  - Result: `16 places`
  - Confirmed first result includes `Yosemite Valley Campground`.
  - Confirmed no `Road-open season`, `AI`, `dev`, `API`, `database`,
    `downloaded`, `zero results`, `0 results`, `undefined`, or `null` in the
    visible text scan.
  - Screenshot: `/tmp/trailhead-visual/guide-yosemite-campgrounds-16.png`
- Search input hit test:
  - Top element at the input center is `INPUT`.
  - Typed value persisted as `Yosemite campgrounds`.

### Verification

- `cd mobile && npx tsc --noEmit --pretty false`
- `cd mobile && node scripts/user-facing-copy-audit.mjs`
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
- `npm run export:webapp`

### Remaining Notes

- First-run WelcomeGate is still intentionally shown for signed-out users. Live
  Explorer audits should seed `trailhead_welcome_gate_seen_v1=1` or dismiss the
  gate before testing returning-user flows.

## Checkpoint: Trail Catalog Facts And Public Tags Pass

### Scope

- Improved canonical trail facts so mapped open trail lines get a readable
  route type instead of an empty route-shape slot.
- Re-ranked the canonical trail serving index so normal trail-length records
  outrank giant source route segments when both are otherwise official and
  similarly complete.
- Rebuilt the canonical serving indexes after the rule changes.
- Cleaned public Explore card tags at the API card boundary so source/code
  tokens do not leak into app chips.
- Prioritized true trail/trailhead cards above trail-adjacent attractions for
  explicit trail searches while keeping secondary attractions available.

### Files Touched

- `scripts/data/build_canonical_serving_indexes.py`
  - `public_trail_route_shape()` now returns `Point-to-point` for mapped open
    trail lines over the minimum route length.
  - `trail_sort_key()` now prefers app-length, richer trail records before
    long source segments.
- `dashboard/server.py`
  - Added public tag sanitizing for Explore index cards and source-pack topics.
  - Added requested-category priority for `/api/explore/catalog/index` sorting.
- `tests/test_canonical_catalog_rules.py`
  - Covered `Point-to-point` trail facts and app-length trail ranking.
- `tests/test_trail_catalog.py`
  - Covered clean public tags, Grand Canyon trail ordering, and removal of raw
    Q-id tags from relaxed destination results.
- `data/processed/canonical_serving/*.candidate.json`
  - Rebuilt after the trail fact/ranking changes.

### Local API Evidence

- Canonical serving rebuild:
  - Camps: `20388`
  - Trails: `43337`
  - Explore: `9470`
- Trail index first records now start with normal-length, high-detail trail
  cards instead of 70-160 mile source segments.
- Query checks through local `dashboard.server.explore_catalog_index()`:
  - `Grand Canyon trails`: `Bright Angel Trailhead` ranks before `Havasu Falls`.
  - `Yosemite trails`: no source/code tags in returned public tags.
  - `Moab trails`: source abbreviations removed from public tags.
  - `Dolomites trails`: no raw `Q...` id tags.
  - `K2 Base Camp Trek`: date-range tags remain readable, e.g.
    `June-September`.

### Browser Evidence

- Local server: `http://127.0.0.1:8099`
- Screenshots:
  - `/tmp/trailhead-visual/guide-initial-mobile.png`
  - `/tmp/trailhead-visual/guide-grand-canyon-trails-mobile.png`
  - `/tmp/trailhead-visual/guide-grand-canyon-trails-instrumented.png`
  - `/tmp/trailhead-visual/map-mobile.png`
- Browser smoke found no console errors, page errors, failed requests, or
  blocked visible-copy terms in the loaded Guide and Map shells.
- Important limitation: the exported web app currently calls
  `https://api.gettrailhead.app`, so the browser pass verifies the local app
  shell and production API behavior. The backend changes above were verified
  with direct local API/function calls.

### Verification

- `python3 scripts/data/build_canonical_serving_indexes.py --out-dir data/processed/canonical_serving`
- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving`
  - 92 tests passed.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.
- `cd mobile && node scripts/user-facing-copy-audit.mjs`
  - Passed.

### Remaining Notes

- A deployed or locally re-pointed web bundle is needed for a browser pass that
  proves the new local backend ordering inside the actual Guide UI.
- `Big Sur trails` still has only one canonical trail card in the current
  official cache. That is clean, but not yet rich enough for the final
  AllTrails-like target.

## Local Web API Audit Base Pass

### Scope

- Fixed local exported web builds so browser audits on `localhost` and
  `127.0.0.1` call the same local backend origin instead of production.
- Re-exported the website app bundle after the API base change.
- Re-ran the focused Explorer browser smoke against the local server and
  confirmed a real search request reaches the local Explore catalog endpoint.

### Files Touched

- `mobile/lib/apiBase.ts`
  - Local web now uses `window.location.origin` when available.
  - Explicit `EXPO_PUBLIC_API_URL` still wins.
  - Production web continues to use its deployed origin.
- `dashboard/site/public/app/**` and `dashboard/site/dist/app/**`
  - Refreshed by `npm run export:webapp`.

### Browser Evidence

- Local server: `http://127.0.0.1:8099`
- Search typed in Chromium: `Grand Canyon trails`
- Explorer request observed:
  - `http://127.0.0.1:8099/api/explore/catalog/index?limit=420&cursor=0&q=Grand+Canyon+trails&category=trails`
- Production Explore requests observed: `0`
- Rendered result evidence:
  - `Bright Angel Trailhead`: present
  - `Havasu Falls`: present
  - Welcome gate: not present after local audit storage seed
  - Blocked visible-copy terms checked: none found
- Screenshot:
  - `/tmp/trailhead-visual/guide-grand-canyon-trails-local-search.png`

### Verification

- `cd mobile && npx tsc --noEmit --pretty false`
  - Passed.
- `npm run export:webapp`
  - Passed.
- `cd mobile && node scripts/user-facing-copy-audit.mjs`
  - Passed.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.
- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving`
  - 92 tests passed.

### Remaining Notes

- The long-running catalog goal remains active.
- Next useful pass: continue live visual audits deeper into Explorer, map camp
  pins, route builder states, and trails with the local browser now correctly
  pointed at local backend data.

## Map Camp Marker Parity Pass

### Scope

- Tightened camp marker classification so normal campgrounds that merely allow
  small RVs stay as campground markers instead of being promoted to RV markers.
- Added dominant camp-type labels to native clustered camp bubbles so clustered
  Mapbox views can show `C`, `D`, `RV`, or `P` instead of only a count.
- Changed the web map fallback background to match the light Trailhead basemap
  so slow tile paint does not look like a failed black map.
- Re-exported the website app bundle after the map changes.

### Files Touched

- `mobile/app/(tabs)/map.tsx`
  - `campKind()` now uses stricter primary-RV and primary-dispersed checks.
  - RV markers require an RV-style primary place type/name instead of any RV
    amenity mention.
- `mobile/components/NativeMap/index.tsx`
  - Camp cluster properties now count dominant camp types.
  - Cluster bubbles now receive dominant type color and a type label.
- `mobile/components/NativeMap/index.web.tsx`
  - Web map fallback background now matches the active basemap family.
- `dashboard/site/public/app/**` and `dashboard/site/dist/app/**`
  - Refreshed by `npm run export:webapp`.

### Browser Evidence

- Local server: `http://127.0.0.1:8099`
- Test flow:
  - Opened `/app/map`.
  - Seeded onboarding/location prompt storage.
  - Searched `Moab`.
  - Selected `Moab, Grand County, Utah`.
  - Tapped `Nearby camps`.
  - Closed the place sheet and captured the map.
- Screenshot before fallback color fix:
  - `/tmp/trailhead-visual/map-camp-pins-20260704h/map-camp-pins-visible.png`
- Screenshot after fallback color fix:
  - `/tmp/trailhead-visual/map-camp-pins-20260704i/map-camp-pins-visible.png`
- Local app API requests observed: `13`
- Production app API requests observed: `0`
- Rendered marker text observed in the page:
  - `C C RV C C`
- Console errors: none.
- Page errors: none.

### Verification

- `cd mobile && npx tsc --noEmit --pretty false`
  - Passed.
- `npm run export:webapp`
  - Passed.
- `cd mobile && node scripts/user-facing-copy-audit.mjs`
  - Passed.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.
- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving tests.test_canonical_camp_serving`
  - 99 tests passed.
- `git diff --check -- mobile/app/(tabs)/map.tsx mobile/components/NativeMap/index.tsx mobile/components/NativeMap/index.web.tsx mobile/lib/apiBase.ts`
  - Passed.

### Remaining Notes

- The local browser export did not receive a Mapbox token, so this pass proves
  Trailhead web marker rendering and native Mapbox cluster code, but it does not
  visually prove hosted Mapbox style parity in a browser screenshot.
- Headless Chrome painted the Trailhead vector basemap as a flat background
  while still rendering the camp marker badges. The fallback color fix prevents
  the broken black appearance, but a real-device/native Mapbox pass is still
  needed for final cluster behavior.
- Next useful pass: test actual hosted Mapbox styles with a valid local token or
  a device build, then continue route builder and Explorer deep-flow audits.

## Trail Title And Fact Summary Repair Pass

### Scope

- Repaired confirmed clipped official trail titles coming from the canonical
  serving export.
- Added an audit guard so known clipped suffix patterns fail future catalog
  validation.
- Fixed Explorer card copy so short but valid trail fact summaries are shown
  instead of being replaced by generic trail copy.
- Fixed trail distance pluralization so `13.0 miles` renders as `13 miles`,
  not `13 mile`.
- Re-exported the website app bundle after the Explorer display fix.

### Files Touched

- `scripts/data/build_canonical_serving_indexes.py`
  - Repairs confirmed clipped USFS trail suffixes such as `Branc`, `Trai`,
    `Cree`, `Roa`, and the `Jacks Bra` case.
- `scripts/data/audit_canonical_catalog.py`
  - Adds a clipped-public-name finding and includes it in fail-on-findings.
- `tests/test_canonical_catalog_rules.py`
  - Covers the confirmed title repairs.
- `tests/test_canonical_catalog_audit.py`
  - Covers the new clipped-name audit finding.
- `mobile/components/explore/exploreDisplay.ts`
  - Preserves trail fact summaries with distance plus route/difficulty facts.
  - Prefers real summaries before headline/title fallback copy.
  - Fixes whole-mile pluralization.
- `data/processed/canonical_serving/trails.candidate.json`
  - Rebuilt with repaired trail display names.
- `dashboard/site/public/app/**` and `dashboard/site/dist/app/**`
  - Refreshed by `npm run export:webapp`.

### API Evidence

- Local server: `http://127.0.0.1:8099`
- Catalog search:
  - `/api/explore/catalog/index?limit=12&cursor=0&q=Syllamo%20Bike%20Trail%20Jacks%20Branch&category=trail`
  - Returned title: `Syllamo Bike Trail - Jacks Branch`
  - Returned summary: `13.0 miles. Loop. Moderate. Hiking trail.`
- Catalog search:
  - `/api/explore/catalog/index?limit=12&cursor=0&q=Timber%20Creek%20Deer%20Creek%20Trail&category=trail`
  - Returned title: `Timber Creek / Deer Creek Trail`
  - Returned summary: `11.2 miles. Point-to-point. Moderate. Hiking trail.`
- Place detail:
  - `/api/explore/places/trail%3Ausfs%3A41021010602`
  - `card.summary`, `summary.short_description`, and `profile.summary` all
    carried the trail fact summary.

### Browser Evidence

- Local server: `http://127.0.0.1:8099`
- Test flow:
  - Opened `/app/guide` in headless Chrome.
  - Seeded local API base storage to `http://127.0.0.1:8099`.
  - Searched `Syllamo Bike Trail Jacks Branch`.
  - Captured Explorer results on a mobile-sized viewport.
- Screenshot:
  - `/tmp/trailhead-visual/trail-title-repair-20260704c/guide-syllamo-jacks-branch.png`
- Rendered result evidence:
  - Title present: `Syllamo Bike Trail - Jacks Branch`
  - Summary present: `13 miles. Loop. Moderate. Hiking trail.`
  - Generic fallback absent: `Trail area with distance, difficulty, weather,
    daylight, permit, and closure checks.`
  - Singular-mile bug absent: `13 mile. Loop. Moderate. Hiking trail.`
  - Local app API requests observed: `9`
  - Production app API requests observed: `0`
  - Console errors: none.
  - Request failures: none.

### Verification

- `python3 scripts/data/build_canonical_serving_indexes.py --out-dir data/processed/canonical_serving`
  - Rebuilt camps, trails, and Explore serving exports.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.
- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving tests.test_canonical_camp_serving`
  - 59 tests passed.
- `cd mobile && npx tsc --noEmit --pretty false`
  - Passed.
- `cd mobile && node scripts/user-facing-copy-audit.mjs`
  - Passed.
- `npm run export:webapp`
  - Passed.
- `git diff --check -- mobile/components/explore/exploreDisplay.ts scripts/data/build_canonical_serving_indexes.py scripts/data/audit_canonical_catalog.py tests/test_canonical_catalog_rules.py tests/test_canonical_catalog_audit.py data/processed/canonical_serving/trails.candidate.json dashboard/site/public/app dashboard/site/dist/app`
  - Passed.

### Remaining Notes

- The long-running catalog goal remains active.
- Ambiguous official names that may be clipped but are not confirmed, such as
  `Bald Scrapp`, are left for source review instead of being guessed.
- Next useful pass: continue Explorer visual audits farther down the catalog,
  then run map and route-builder passes against several locations.

## Explorer Placeholder Description Repair Pass

### Scope

- Removed remaining generic RIDB Explore descriptions such as `has overnight
  options around the area` and `managed recreation stop` from the generated
  serving catalog.
- Dropped clearly generic title-only cards such as `State Park` when they had
  no useful description.
- Fixed sentence splitting for official descriptions with initials and
  abbreviations, so cards no longer render fragments such as `Lewis M.`, `Paul
  H.`, or `H.V.`.
- Skipped empty lead-in sentences such as `Attention Campers!`, `Want to camp?`,
  and `Going Camping?` when the source text has a real sentence after them.
- Prefixed very short fee/reservation-only descriptions with the place name so
  cards do not start as floating fragments.

### Files Touched

- `scripts/data/build_canonical_serving_indexes.py`
  - Rejects generic placeholder descriptions before export.
  - Adds clean category fallbacks for named cards with unusable source copy.
  - Skips generic-title cards when the source gives no useful detail.
  - Protects one-letter initials during sentence splitting.
  - Polishes fee/reservation-only descriptions.
- `scripts/data/audit_canonical_catalog.py`
  - Flags the old generic placeholder descriptions as rough public copy.
- `tests/test_canonical_catalog_rules.py`
  - Covers generic placeholder replacement.
  - Covers generic `State Park` removal.
  - Covers initials and empty lead-in handling.
- `data/processed/canonical_serving/explore.candidate.json`
  - Rebuilt from the full processed catalog.

### Data Evidence

- Rebuilt serving export:
  - `camps`: `20388`
  - `trails`: `43337`
  - `explore`: `9456`
- Placeholder scan after rebuild:
  - `has overnight options around the area`: `0`
  - `is a managed recreation stop`: `0`
  - `check current access, fees, fire restrictions, reservations, and seasonal road conditions before you go`: `0`
  - Title `State Park`: `0`
- Repaired examples:
  - `Lewis M. Turner Campground (UT)`: `Lewis M. Turner Campground is about 22 miles northeast of Logan, Utah, at an elevation of 5,900 feet.`
  - `Codorniz Recreation Area Campground`: `Codorniz Campground on H.V. Eastman Lake is a perfect launchpad for activities like fishing, canoeing, birding and hiking.`
  - `Paul H. Douglas Center for Environmental Education`: `The Paul H. Douglas Center for Environmental Education is your gateway to the stunning Paul H. Douglas Trail through Miller Woods.`
  - `Pleasant Valley Pit Campground`: `Pleasant Valley Pit Campground. $7.00 per site per night.`

### Browser Evidence

- Local server: `http://127.0.0.1:8099`
- Test flow:
  - Opened `/app/guide` in headless Chrome.
  - Seeded local API base storage to `http://127.0.0.1:8099`.
  - Searched `Lewis M Turner Campground`.
  - Captured Explorer results on a mobile-sized viewport.
- Screenshot:
  - `/tmp/trailhead-visual/explore-description-repair-20260704a/guide-lewis-m-turner.png`
- Rendered result evidence:
  - Title present: `Lewis M. Turner Campground`
  - Repaired description present: `Lewis M. Turner Campground is about 22 miles northeast of Logan, Utah, at an elevation of 5,900 feet.`
  - Fragment bug absent: `Lewis M.`
  - Generic placeholder absent.
  - Local app API requests observed: `9`
  - Production app API requests observed: `0`
  - Console errors: none.
  - Request failures: none.

### Verification

- `python3 scripts/data/build_canonical_serving_indexes.py --out-dir data/processed/canonical_serving`
  - Rebuilt camps, trails, and Explore serving exports.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.
- `python3 -m unittest tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving tests.test_canonical_camp_serving`
  - 61 tests passed.
- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving tests.test_canonical_camp_serving`
  - 102 tests passed.
- `cd mobile && npx tsc --noEmit --pretty false`
  - Passed.
- `cd mobile && node scripts/user-facing-copy-audit.mjs`
  - Passed.
- `git diff --check -- scripts/data/build_canonical_serving_indexes.py scripts/data/audit_canonical_catalog.py tests/test_canonical_catalog_rules.py data/processed/canonical_serving/explore.candidate.json docs/checkpoints/canonical-outdoor-catalog-checkpoint-2026-07-04.md`
  - Passed.

### Remaining Notes

- The long-running catalog goal remains active.
- Some short but valid source descriptions remain, such as seasonal notices,
  tent-only notes, and closure notes. They are not placeholder copy, but they
  are good candidates for a later enrichment pass.
- Next useful pass: continue deeper Explorer visual checks on far-down list
  entries and start turning richer trail facts into a more complete trail detail
  experience.

## Explorer Non-Camp Category Routing Pass

### Scope

This pass fixed official/RIDB records that were corrected in the canonical
serving file but could still appear in the wrong public bucket or with a generic
app label. The specific target was non-overnight records that had been entering
Explore as camps: museums, nature centers, boat sites, rifle ranges, overlooks,
dump stations, and non-public campground records.

### Files Touched

- `scripts/data/build_canonical_serving_indexes.py`
  - Routes clear non-camp RIDB records before the broad campground fallback.
  - Drops dump-station and non-public-campground records from the public Explore export.
  - Routes boat ramps/sites/areas to Water.
  - Routes shooting/rifle ranges and visitor/nature/contact-center records to Things.
  - Routes standalone overlooks/viewpoints to Viewpoint.
- `scripts/data/audit_canonical_catalog.py`
  - Adds a post-build guard for misrouted camping records in the Explore serving index.
- `dashboard/server.py`
  - Keeps exact-title search results even when the card has short official copy.
  - Merges specific canonical categories into duplicate generic app profiles.
- `mobile/components/explore/exploreDisplay.ts`
  - Recognizes literal Things/activity groups and visitor/nature/range text before falling through to Views or Scenic.
- `tests/test_canonical_catalog_rules.py`
  - Covers Boott Cotton Mills Museum, Bear Gulch Nature Center, Burns Run East Boat Ramp, Ute - Elk #2028, Shepard Branch Shooting Range, Conecuh Shooting/Rifle Range, Lake Andrusia Boat Site, Rainie Falls Overlook, Chickamauga Battlefield Group Campground, dump-station removal, and Lane Cove Campground retention.
- `tests/test_canonical_catalog_audit.py`
  - Covers the new misrouted-camping audit detector.
- `tests/test_trail_catalog.py`
  - Covers exact-title search retention and duplicate category merge.
- `data/processed/canonical_serving/explore.candidate.json`
  - Rebuilt from the corrected serving builder.
- `dashboard/site/public/app` and `dashboard/site/dist/app`
  - Re-exported web app bundle for the Explore display fix.

### Data Evidence

- Rebuilt serving export:
  - `camps`: `20388`
  - `trails`: `43337`
  - `explore`: `11214`
- Exact record checks after rebuild:
  - `place:ridb:10076825` Boott Cotton Mills Museum -> `historic / historic`
  - `place:ridb:10092968` Bear Gulch Nature Center -> `activity / things`
  - `place:ridb:ap22739` Burns Run East Boat Ramp -> `water / water`
  - `place:ridb:10087648` Ute - Elk #2028 -> `trail / trails`
  - `place:ridb:ap2266` Shepard Branch Shooting Range -> `activity / things`
  - `place:ridb:249513` Lake Andrusia Boat Site -> `water / water`
  - `place:ridb:243202` Conecuh Shooting / Rifle Range -> `activity / things`
  - `place:ridb:10038589` Rainie Falls Overlook -> `viewpoint / viewpoint`
  - `place:ridb:258912` Lane Cove Campground stayed `campground / camping`
  - `place:ridb:ap24948` dump-station fee record removed
  - `place:ridb:10299353` non-public campground record removed
- Residual scan after rebuild:
  - Misrouted title patterns in `group=camping`: `0`
  - `not a public campground` in `group=camping`: `0`

### Browser Evidence

- Local server: `http://127.0.0.1:8099`
- Bundle loaded by Chrome: `entry-9ebeebfbc58dc9cafba52c4449281f08.js`
- Mobile-sized Chromium checks:
  - Search `Bear Gulch Nature Center`
    - Result shown.
    - Visible label: `Things`.
    - No page errors or failed requests.
  - Search `Conecuh Shooting Rifle Range`
    - Result shown.
    - Visible label: `Things`.
    - No page errors or failed requests.
  - Search `Lake Andrusia Boat Site`
    - Result shown.
    - Visible label: `Water`.
    - No page errors or failed requests.
- Screenshot:
  - `/tmp/trailhead-guide-smoke-after-ui-category.png`
- Console notes:
  - Expo push-token web warning.
  - Expo AV deprecation warning.
  - No app/page errors.

### Verification

- `python3 scripts/data/build_canonical_serving_indexes.py --out-dir data/processed/canonical_serving`
  - Rebuilt camps, trails, and Explore serving exports.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.
- `python3 -m unittest tests.test_canonical_catalog_rules.CanonicalCatalogRulesTests.test_build_explore_index_routes_non_camp_ridb_records_out_of_camping tests.test_canonical_catalog_audit.CanonicalCatalogAuditTests.test_serving_audit_flags_misrouted_explore_camping_records`
  - Passed.
- `python3 -m unittest tests.test_trail_catalog.TrailCatalogTests.test_explore_merge_uses_specific_category_from_duplicate tests.test_trail_catalog.TrailCatalogTests.test_exact_title_search_keeps_short_official_place_cards tests.test_trail_catalog.TrailCatalogTests.test_moab_search_skips_far_little_moab_without_little_query`
  - Passed.
- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving tests.test_canonical_camp_serving`
  - 106 tests passed.
- `cd mobile && npx tsc --noEmit --pretty false`
  - Passed.
- `cd mobile && node scripts/user-facing-copy-audit.mjs`
  - Passed.
- `node scripts/export_website_app.mjs`
  - Passed and re-exported `/app`.

### Remaining Notes

- The long-running catalog goal remains active.
- The corrected records are no longer camp records and no longer display as generic campsite/card types.
- The browser smoke still shows normal Expo framework warnings on web; no app errors or request failures were observed.

## Trail Short-Access Search And Display Pass

### Scope

This pass tightened the trail serving layer so small legitimate access trails
stay findable without letting tiny low-detail fragments clutter Explore. It also
fixed category routing for named scenic/water trail searches and removed the
old public fallback wording that told users to check distance when no distance
was available.

### Files Touched

- `scripts/data/build_canonical_serving_indexes.py`
  - Adds short-access trail facts.
  - Drops tiny low-detail fragments such as generic connector records.
  - Keeps meaningful short names such as overlooks, falls, springs, bridges,
    arches, and other user-facing landmarks.
  - Replaces the old trail fallback with route/access wording.
- `dashboard/server.py`
  - Lets exact trail-title searches keep the singular `trail` token.
  - Prefers exact title matches over broader partial matches.
  - Allows named trail records to satisfy `views`, `waterfalls`, `water`,
    `peaks`, and `springs` searches when the title/summary proves the match.
  - Keeps generic tiny fragments hidden from public search.
- `mobile/components/explore/exploreDisplay.ts`
  - Treats `Short trail access` with a trail type as valid card copy.
  - Removes the old generic trail fallback sentence.
- `mobile/components/explore/ExploreDetailSheet.tsx`
  - Uses the same cleaned trail fallback in detail copy.
- `mobile/app/(tabs)/guide.tsx`
  - Uses `Check route` instead of the old distance fallback for trail map handoff.
- `mobile/components/explore/curatedExplorePlaces.ts`,
  `mobile/lib/trailEngine.ts`, and `mobile/lib/trailProfileDisplay.ts`
  - Remove the old distance fallback from trail helper output.
- `scripts/explore_sources/base/content_quality.py`
  - Updates generated trail fallback copy.
- `tests/test_trail_catalog.py`,
  `tests/test_canonical_catalog_rules.py`,
  `tests/test_canonical_catalog_audit.py`, and
  `tests/test_canonical_explore_serving.py`
  - Cover exact trail search, visual/water category routing, short-access
    display, tiny-fragment hiding, and fallback copy.
- `dashboard/site/public/app` and `dashboard/site/dist/app`
  - Re-exported web app bundle for the Explore display changes.

### Data Evidence

- Rebuilt serving export:
  - `camps`: `20388`
  - `trails`: `43296`
  - `explore`: `11214`
- Trail serving scan after rebuild:
  - `Check distance` summaries: `0`
  - bounded `0 miles` summaries: `0`
  - duplicate `Hiking trail. Hiking.` summaries: `0`
  - short-access trail cards: `1392`
- Exact record checks:
  - `trail:usfs:2355927010602` Easy Connector: hidden.
  - `trail:usfs:5666-000411` Middle Falls Overlook:
    `Short trail access. Hiking trail.`
  - `trail:usfs:12600010437` Springs Connector:
    `Short trail access. Moderate. Hiking trail. Natural surface.`
  - `trail:usfs:2503010397` Arch Trail:
    `Short trail access. Moderate. Hiking trail. Natural surface.`
- API checks:
  - `Middle Falls Overlook` with `category=views` returns the exact trail.
  - `Springs Connector` with `category=springs` returns the exact trail first.
  - `Easy Connector` with `category=springs` returns no public card.

### Browser Evidence

- Local server: `http://127.0.0.1:8099`
- Bundle loaded by Chrome: `entry-25e52259eaa75a5a9c77520207e1910f.js`
- Mobile-sized Chromium checks:
  - Search `Arch Trail`
    - Exact `Arch Trail` appears before broader arch trail matches.
    - No stale fallback wording.
  - Search `Middle Falls Overlook`
    - Result count shown as `1 place`.
    - Visible card copy: `Short trail access. Hiking trail.`
  - Search `Springs Connector`
    - Exact `Springs Connector` appears first.
    - Visible card copy: `Short trail access. Moderate. Hiking trail. Natural surface.`
- No request failures.
- No browser console errors.
- The smoke did not find `Check distance`, `Hiking trail. Hiking.`, `0 results`,
  `undefined`, `null`, `database`, or `download` in the visible page text.

### Verification

- `python3 scripts/data/build_canonical_serving_indexes.py --out-dir data/processed/canonical_serving`
  - Rebuilt camps, trails, and Explore serving exports.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.
- `cd mobile && npx tsc --noEmit --pretty false && node scripts/user-facing-copy-audit.mjs`
  - Passed.
- `python3 -m unittest tests.test_trail_catalog.TrailCatalogTests.test_visual_trail_names_remain_discoverable_from_inferred_sections tests.test_canonical_explore_serving.CanonicalExploreServingTests.test_generated_trail_detail_omits_tiny_zero_distance tests.test_canonical_explore_serving.CanonicalExploreServingTests.test_official_cache_trail_profile_omits_tiny_zero_distance`
  - Passed.
- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving tests.test_canonical_camp_serving`
  - 110 tests passed.
- `npm run export:webapp`
  - Passed and re-exported `/app`.

### Remaining Notes

- The long-running catalog goal remains active.
- The current pass fixed search/display for short-access trail cards. It did
  not redesign the trail detail screen; the AllTrails-style trail profile work
  is still a larger follow-up.
- Some trail records still have limited source facts. They now use cleaner
  route/access copy instead of stale distance wording, but richer enrichment is
  still a later data pass.

## Trail Profile Direction And Live Explorer Pass

### Scope

This pass moved the trail profile surface closer to an AllTrails-style
experience: image-led trail cards, immediate distance/gain/grade/time stats,
clean route actions, and compact plan rows instead of text-heavy trail panels.
It also fixed the Explore hero filter rail so the first mobile viewport does
not show a cropped category label.

### References

- Mobbin AllTrails trail detail screens:
  - https://mobbin.com/screens/f11a4d58-0448-4ea0-a720-8ee8266d0a47
  - https://mobbin.com/screens/259958ca-0ec5-43a8-8a4e-24019afe9816
  - https://mobbin.com/screens/7b81639a-b6ea-440f-bfe3-32bc1e3520fc
  - https://mobbin.com/screens/d4d336bc-ff44-434c-8afb-0c04d808c180
- Dribbble-style direction used: large route media, short numeric stats,
  primary route/map actions, and compact planning notes.

### Figma Checkpoint

- File: `Trailhead Trail Profile Direction - 2026-07-04`
- URL: https://www.figma.com/design/LyDEiUJ7EicmLu70bvTD8f?node-id=1-2
- Local reference artifact:
  `docs/design/trail-profile-direction-2026-07-04.html`
- Capture note: first remote-image capture hung. Reworked the design artifact
  to use CSS-only scenic shapes and captured successfully with Figma capture
  ID `009bc405-d70e-43f5-b83d-797ea8a33652`.

### Files Touched

- `mobile/components/explore/ExploreTrailArea.tsx`
  - Trail cards now use larger imagery, full title wrapping, a four-metric stat
    strip, route-type overlay, and compact expanded details.
  - Expanded state now includes a route preview panel and plan rows for route,
    season, dogs, bikes, access, or area when present.
  - Replaced weaker fallback text such as `Plan ahead` with tighter outdoor
    copy like `Check pace` and `Check route`.
  - Added copy guards before visible trail detail rows.
- `mobile/components/explore/ExploreHero.tsx`
  - Adjusted hero filter sizing so the initial mobile viewport shows full
    visible labels instead of a cropped trailing category word.
- `docs/design/trail-profile-direction-2026-07-04.html`
  - Design artifact captured into Figma for this pass.
- `dashboard/site/public/app` and `dashboard/site/dist/app`
  - Re-exported web app bundle for the Explore UI changes.

### Verification

- `cd mobile && npx tsc --noEmit --pretty false`
  - Passed.
- `cd mobile && node scripts/user-facing-copy-audit.mjs`
  - Passed.
- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving tests.test_canonical_camp_serving`
  - 110 tests passed.
- `python3 scripts/data/audit_canonical_catalog.py --fail-on-findings`
  - Passed.
- `npm run export:webapp`
  - Passed and re-exported `/app` with
    `entry-4981f4c709ace12e086e63d0034517c2.js`.
- Live browser pass on `http://127.0.0.1:8099/app/guide`
  - Opened welcome gate through `Continue for now`.
  - Explorer landing rendered populated catalog sections with no empty landing
    state.
  - Hero filter rail rendered full visible labels on mobile.
  - `K2 and Baltoro Trek Area` opened into a detail sheet with clean title,
    region, weather, actions, and overview copy.

### Remaining Notes

- The long-running catalog goal remains active.
- Headless Chrome did not scroll the inner detail sheet during the opened K2
  pass, so the lower trail-card section was not screenshot-confirmed in-browser.
  The changed component is TypeScript-clean and included in the exported bundle;
  a manual or Playwright inner-scroll pass should revisit lower sheet content in
  the next visual sweep.

## Explorer Copy Guard Follow-Up

### Timestamp

2026-07-04T23:43:13-05:00

### Scope

This follow-up tightened the Explorer copy guardrail after the live pass exposed
how easy it was to miss Explorer files with the previous single-file audit. It
also removed the intentional `...` suffix from Explorer preview copy so card and
sheet previews do not look clipped when the user can open or expand the full
text.

### Files Touched

- `mobile/scripts/user-facing-copy-audit.mjs`
  - Added `--preset explore` and `--preset map`.
  - Added missing-target reporting so a bad path fails clearly instead of
    crashing with a raw stack trace.
  - Added blocked checks for visible `zero`, `0 results`, `rig ready`, and
    `offline ready` wording.
- `mobile/components/explore/exploreDisplay.ts`
  - Kept sentence-aware preview trimming, but stopped appending artificial
    trailing ellipses.

### Verification

- `cd mobile && npm run audit:copy -- --preset explore`
  - Passed across 12 Explorer files.
- `cd mobile && npm run audit:copy -- --preset map`
  - Passed across 5 map files.
- `cd mobile && npx tsc --noEmit --pretty false`
  - Passed.

### Remaining Notes

- This is a guardrail and small polish fix, not the full catalog completion.
  The broader goal still needs continued live visual passes through Explorer,
  map camps, route builder, and deeper detail sheets.

## Pakistan Trail Hub Media Pass

### Timestamp

2026-07-04T23:53:48-05:00

### Scope

Live Explorer testing opened `K2 and Baltoro Trek Area` successfully, but the
detail hero used the gray fallback instead of destination media. This pass added
real media to the curated Pakistan trail and mountain records so the existing
Explorer cards and detail sheets render like a finished catalog surface.

### References

- K2 image: https://commons.wikimedia.org/wiki/File:K2_8611.jpg
- Baltoro Glacier image: https://commons.wikimedia.org/wiki/File:Baltoro_glacier_from_air.jpg
- Laila Peak image: https://commons.wikimedia.org/wiki/File:Laila_Peak.jpg
- Masherbrum image: https://commons.wikimedia.org/wiki/File:Masherbrum_k1.jpg
- Hushe Valley image: https://commons.wikimedia.org/wiki/File:Hushe_Valley.jpg

### Files Touched

- `mobile/components/explore/curatedExplorePlaces.ts`
  - Added optional image fields to official curated seeds.
  - Added media for K2/Baltoro, Khaplu/Hushe, Laila Peak, Masherbrum, and K7 /
    Charakusa records.
  - Wired official seed images into summary hero fields and source-pack photos.
  - Added image URLs to related Pakistan things-to-do items where useful.
- `dashboard/site/public/app`
  - Re-exported the web app bundle after the media change.

### Live Visual Evidence

- Before fix: `/tmp/trailhead-explorer-live-k2.png`
  - K2 detail sheet rendered a gray fallback hero.
- After fix and web export: `/tmp/trailhead-explorer-live-k2-media-exported.png`
  - K2 detail sheet rendered a full-width mountain hero with the existing
    title, status, weather, search, and action controls intact.

### Verification

- `cd mobile && npx tsc --noEmit --pretty false`
  - Passed.
- `cd mobile && npm run audit:copy -- --preset explore`
  - Passed across 12 Explorer files.
- `cd mobile && npm run audit:copy -- --preset map`
  - Passed across 5 map files.
- `npm run data:audit-catalog -- --fail-on-findings`
  - Passed.
- `npm run export:webapp`
  - Passed and re-exported `/app`.
- `git diff --check`
  - Passed.

### Remaining Notes

- The broader catalog goal remains active. This was one concrete visual/data
  enrichment fix found by live Explorer testing, not full completion of the app
  audit.

## Explorer Official Detail Media And Copy Pass

### Timestamp

2026-07-05T00:09:34-05:00

### Scope

Live Explorer testing around `Big Bend National Park` exposed two official-data
polish gaps:

- Some low-ranked generated records could still show agency names as if they
  were locations, such as a park being described as near an agency instead of a
  real place.
- Search cards had NPS media, but opening the matching official detail profile
  could fall back to the gray hero because the detail lookup returned the
  canonical serving profile before merging the richer Explore catalog profile.

### Files Touched

- `dashboard/server.py`
  - Expanded public-copy cleanup for agency-as-location fallback sentences.
  - Merged matching Explore catalog media/source-pack data into canonical
    serving profiles when opening detail pages by the same ID.
- `tests/test_trail_catalog.py`
  - Added regression coverage for agency-as-location fallback copy.
  - Added regression coverage for Big Bend detail media preservation.

### Live Visual Evidence

- `/tmp/trailhead-explorer-bigend-results-pass.png`
  - Big Bend search results rendered without the rough agency fallback copy.
- `/tmp/trailhead-explorer-bigend-detail-pass.png`
  - Before media merge fix, Big Bend detail used the gray fallback hero.
- `/tmp/trailhead-explorer-bigend-parks-detail-media-pass.png`
  - After fix, selecting `National Parks`, searching `Big Bend National Park`,
    and opening the result rendered the NPS hero image and clean detail copy.

### Verification

- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving`
  - 105 tests passed.
- `cd mobile && npm run audit:copy -- --preset explore`
  - Passed across 12 Explorer files.
- `cd mobile && npm run audit:copy -- --preset map`
  - Passed across 5 map files.
- `npm run data:audit-catalog -- --fail-on-findings`
  - Passed with the current official database and serving indexes.
- Live Chromium pass on `http://127.0.0.1:8099/app/guide`
  - Opened welcome gate through `Continue for now`.
  - Selected `National Parks`.
  - Searched `Big Bend National Park`.
  - Opened the Big Bend detail sheet.
  - Confirmed no bad fallback phrases and confirmed NPS image URLs were loaded.

### Remaining Notes

- The broad catalog goal remains active. This pass removes one visible copy
  failure and one official-detail media failure; it does not complete the full
  Explorer, trails, map, route builder, and guided tours audit.

## Explorer Detail Copy Polish Pass

### Timestamp

2026-07-05T00:18:24-05:00

### Scope

Follow-up live testing on the Big Bend official detail sheet found small
presentation issues after the media fix:

- The hero label could render a dangling separator when no region/state was
  available.
- Public copy could preserve spaced hyphen wording from official text.
- The `Before You Go` body could fall back to a source name instead of useful
  trip-check wording.

### Files Touched

- `dashboard/server.py`
  - Repairs spaced hyphen words during public-copy cleanup.
- `mobile/components/explore/ExploreDetailSheet.tsx`
  - Builds the hero label from non-empty parts only.
  - Treats `Trailhead` as a source-only body value and falls back to travel
    check copy.
- `tests/test_trail_catalog.py`
  - Adds regression coverage for spaced hyphen repair.

### Live Visual Evidence

- `/tmp/trailhead-explorer-bigend-detail-copy-polish-pass-2.png`
  - Opened the Big Bend detail sheet from `/app/guide`.
  - Confirmed the NPS hero image still renders.
  - Confirmed no dangling `Parks` separator, spaced hyphen copy, source-name
    body, agency-as-location fallback, placeholder text, or result-count dead
    state appeared in the checked page text.

### Verification

- `python3 -m unittest tests.test_trail_catalog.TrailCatalogTests.test_explore_public_copy_repairs_spaced_hyphen_words tests.test_trail_catalog.TrailCatalogTests.test_explore_detail_keeps_catalog_media_when_serving_profile_is_first`
  - Passed.
- `cd mobile && npx tsc --noEmit --pretty false`
  - Passed.
- `npm run export:webapp`
  - Passed and re-exported `/app`.
- `python3 -m unittest tests.test_trail_catalog tests.test_canonical_catalog_rules tests.test_canonical_catalog_audit tests.test_canonical_explore_serving`
  - 106 tests passed.
- `cd mobile && npm run audit:copy -- --preset explore`
  - Passed across 12 Explorer files.
- `cd mobile && npm run audit:copy -- --preset map`
  - Passed across 5 map files.
- `npm run data:audit-catalog -- --fail-on-findings`
  - Passed with the current official database and serving indexes.
- Live Chromium pass on `http://127.0.0.1:8099/app/guide`
  - Searched `Big Bend National Park`, opened the detail sheet, confirmed clean
    copy, and confirmed NPS images loaded.

### Remaining Notes

- The broad catalog goal remains active. This pass is ready to ship, but the
  wider app audit still has follow-up areas around Explorer depth, map pins,
  route builder, and guided tours.

## Explorer Stay Search Destination Pass

### Timestamp

2026-07-05T00:53:07-05:00

### Scope

Live Explorer searches exposed a gap where the backend returned useful stay
and camp results, but the mobile/web Explorer client filtered them into an
empty state. This pass focused on destination stay searches and campground
searches around Big Sur and Glacier.

### Files Touched

- `dashboard/server.py`
  - Adds fast stay-search destination anchors for common outdoor regions such
    as Big Sur, Glacier, Yosemite, Moab, Yellowstone, Zion, Grand Canyon, Grand
    Teton, Acadia, and Great Smoky Mountains.
  - Uses the destination stay fallback before the slower generic source sweep
    when it already has real stay cards.
  - Preserves curated catalog matches such as Many Glacier Hotel while keeping
    Big Sur stay search fast.
  - Cleans duplicated `before you go` sentence fragments from mixed source
    descriptions.
- `mobile/app/(tabs)/guide.tsx`
  - Lets current remote stay-search results pass destination identity, inferred
    category, and intent-score gates when the backend already matched the
    active query.
  - Stops the legacy wrapper refinement from redirecting stay searches like
    `Glacier where to stay` toward Glacier Bay.
- `tests/test_trail_catalog.py`
  - Adds regression coverage for Glacier stay/camp destination search and the
    duplicated condition-copy cleanup.
- `dashboard/site/public/app/*`
  - Re-exported the web app bundle after the Explorer client patch.

### Verification

- `python3 -m unittest tests.test_trail_catalog.TrailCatalogTests.test_explore_where_to_stay_falls_back_to_nearby_camps tests.test_trail_catalog.TrailCatalogTests.test_explore_stay_search_uses_destination_before_generic_text_matches tests.test_trail_catalog.TrailCatalogTests.test_explore_public_copy_repairs_generic_outdoor_area_fallback tests.test_canonical_explore_serving tests.test_canonical_camp_serving`
  - 26 tests passed.
- `cd mobile && npx tsc --noEmit --pretty false`
  - Passed.
- `git diff --check`
  - Passed.
- `npm run export:webapp`
  - Passed and re-exported `/app`.
- Backend timing smoke:
  - `Big Sur where to stay` returned real cards in about 1.8s.
  - `Glacier where to stay` returned real cards in about 2.3s.
  - `Glacier campgrounds` returned real cards in about 1.6s.
- Live Chromium mobile pass on `http://127.0.0.1:8099/app/guide`
  - `Big Sur where to stay` showed China Camp Campground and Arroyo Seco cards.
  - `Glacier campgrounds` showed Many Glacier Campground cards.
  - `Glacier where to stay` showed Many Glacier Hotel and no Glacier Bay cabin
    drift.
  - No checked page text contained empty-state copy, forbidden internal wording,
    or the duplicated `before you go` sentence.

### Screenshots

- `/tmp/trailhead-explorer-big-sur-stays-final.png`
- `/tmp/trailhead-explorer-glacier-camps-final.png`
- `/tmp/trailhead-explorer-glacier-stays-final.png`

### Remaining Notes

- Yosemite stay search is now fast, but some lower-quality facility cards still
  appear after the top results. Leave that as a targeted stay-quality cleanup
  instead of reworking the fixed Big Sur/Glacier path.

## Explorer Stay Result Quality Pass

### Timestamp

2026-07-05T02:06:00-05:00

### Scope

Tightened the Explorer `where to stay` backend so lodging searches no longer
surface offices, trailheads, arches, picnic shelters, raw road labels, or other
non-overnight records. Added a stay-specific ranking pass so richer campground
and lodging cards appear before bare recreation-area names.

### Files Touched

- `dashboard/server.py`
  - Adds `_explore_profile_matches_stay_result` to filter false lodging and
    campground matches.
  - Adds `_explore_stay_result_sort_key` to prioritize destination guide,
    National Park Service, Recreation.gov, BLM, and Forest Service stay cards
    with real overnight wording.
  - Keeps fallback stay records near the requested destination before they are
    returned to Explorer.
- `tests/test_trail_catalog.py`
  - Adds regression coverage for Yosemite and Moab stay searches so false
    lodging records do not return.

### Verification

- `python3 -m unittest tests.test_trail_catalog.TrailCatalogTests.test_explore_where_to_stay_falls_back_to_nearby_camps tests.test_trail_catalog.TrailCatalogTests.test_explore_stay_search_uses_destination_before_generic_text_matches tests.test_trail_catalog.TrailCatalogTests.test_explore_stay_search_filters_false_lodging_records tests.test_canonical_explore_serving tests.test_canonical_camp_serving`
  - 26 tests passed.
- `python3 -m py_compile dashboard/server.py`
  - Passed.
- `cd mobile && npx tsc --noEmit --pretty false`
  - Passed.
- `git diff --check`
  - Passed.
- Local API Playwright pass against `http://127.0.0.1:8097/api/explore/catalog/index`
  - `Big Sur where to stay`: first page starts with China Camp Campground,
    White Oaks Campground, Arroyo Seco Group Campground, Escondido Campground,
    and Memorial Campground.
  - `Moab where to stay`: first page starts with Goose Island Group Sites,
    Gold Bar Group Sites, Hunter Canyon Group Site, and Big Bend Group Sites.
  - `Yosemite where to stay`: first page includes Yosemite Valley Lodging,
    Yosemite High Sierra Camps, Yosemite Creek Campground, and Upper Pines
    Campground.
  - `Glacier where to stay`: first page includes Many Glacier Hotel, Many
    Glacier Campground, Avalanche Campground, and Sprague Creek Campground.
  - No checked title list contained office/trail/arch/picnic/internal wording.

### Screenshots

- `output/playwright/explorer-stay-search-ranking-430x932.png`

### Remaining Notes

- Follow-up production smoke showed the generated local camp index is not
  available in deploys. Added a bundled official-only camp serving index as the
  production fallback:
  - `dashboard/canonical_camp_index_v1.json`
  - 20,384 official NPS, Recreation.gov, and USFS camp rows.
  - No community/dispersed lead rows.
- Production-shape local smoke with
  `TRAILHEAD_CANONICAL_SERVING_DIR=/tmp/trailhead-no-generated-index` returned
  real stay results for Big Sur, Moab, Yosemite, and Glacier with no blocked
  title wording.
- Serving-index prewarm now starts immediately and loads the camp index first
  so the first real camp/stay search is less likely to pay the cold index load.
- This pass still has no mobile code change. OTA is not needed.

## Explorer Trail Serving Fallback Pass

### Timestamp

2026-07-05T15:35:00-05:00

### Scope

Added a production-safe official trail fallback so Explorer trail searches do
not depend on the large generated local data folder being present in deploys.
The fallback fills trail result lists from the official serving index while
letting direct catalog matches stay ahead of broader regional trails.

### Files Touched

- `dashboard/canonical_trail_index_v1.json`
  - Bundled official-only trail serving artifact.
  - 43,296 USFS trail rows.
  - No review-only or community lead rows.
- `dashboard/server.py`
  - Loads the bundled trail artifact when the generated trail index is absent.
  - Merges the bundled trail artifact when a generated trail index exists but
    is too sparse to cover normal destination searches.
  - Adds trail destination fallback for nearby trail results.
  - Keeps direct catalog trail cards ahead of fallback rows.
  - Uses visible card fields when matching trail/trailhead categories.
  - Keeps clean destination fallback cards for places without trail rows.
- `tests/test_canonical_explore_serving.py`
  - Covers bundled trail fallback loading when the generated trail file is not
    available.
  - Covers the Railway-shaped case where a small generated trail file exists
    and should be filled by the bundled official trail index.

### Verification

- `python3 -m unittest tests.test_canonical_explore_serving tests.test_trail_catalog tests.test_canonical_camp_serving tests.test_startup_prewarm`
  - 79 tests passed.
- `python3 -m py_compile dashboard/server.py`
  - Passed.
- `git diff --check`
  - Passed.
- Production-shape local smoke with
  `TRAILHEAD_CANONICAL_SERVING_DIR=/tmp/trailhead-no-generated-index`:
  - `Moab trails`: 12 results, starts with Fins and Things OHV Route, Corona
    Arch Trailhead, Moab Brands Trailhead, and Moab Rim Trailhead.
  - `Yosemite trails`: 12 results, starts with Yosemite Valley Trails and
    Yosemite trailheads.
  - `Glacier National Park trails`: 12 results, starts with Apgar Lookout
    Trailhead, Beaver Pond Loop Trailhead, and Forest and Fire Nature Trail.
  - `Grand Canyon trails`: 12 results, starts with Bright Angel Trailhead and
    Havasu Falls.
  - `Sedona trails`: 12 trail results.
  - `Asheville trails`: 12 trail results.
  - `Dolomites trails`: clean destination fallback card.
  - No checked title or description contained internal/source placeholder
    wording.

### Remaining Notes

- The bundled trail index is official but currently USFS-heavy. NPS and BLM
  trail coverage should be added through the canonical outdoor import pipeline
  before treating every national park trail list as complete.
- A fresh process without startup prewarm still pays the catalog/index load on
  the first trail query. The app startup path prewarms Explore, camp, and trail
  serving indexes; production smoke should be run after that prewarm window.
- This pass has no mobile code change. OTA is not needed.

## Explorer Trail Locality Cleanup Pass

### Timestamp

2026-07-05T16:30:00-05:00

### Scope

Tightened trail fallback locality for city searches and cleaned broken
mountain-bike trail titles. This keeps city trail searches closer to the
requested place while still leaving national-park trail searches wide enough to
avoid empty screens.

### Files Touched

- `dashboard/server.py`
  - Adds destination-specific trail radii for Moab, Sedona, Asheville, Pisgah,
    Big Sur, Grand Canyon, Glacier, and Yosemite.
  - Uses the destination radius when filling trail searches from the official
    trail serving index.
  - Cleans broken `Mountain. Bike` trail-title punctuation.
- `tests/test_canonical_explore_serving.py`
  - Adds regression coverage for cleaned mountain-bike trail titles.
- `tests/test_trail_catalog.py`
  - Adds regression coverage so Sedona trail search does not lead with
    Tusayan/Grand Canyon spillover.

### Verification

- `python3 -m unittest tests.test_canonical_explore_serving tests.test_trail_catalog tests.test_canonical_camp_serving tests.test_startup_prewarm`
  - 80 tests passed.
- `python3 -m py_compile dashboard/server.py`
  - Passed.
- `git diff --check`
  - Passed.
- Production-shape local smoke with
  `TRAILHEAD_CANONICAL_SERVING_DIR=/tmp/trailhead-no-generated-index`:
  - `Sedona trails`: 90 results, starts with Lime Kiln and Sunflower Flat
    Mountain Bike.
  - `Moab trails`: 96 results, starts with Fins and Things OHV Route, Corona
    Arch Trailhead, Moab Brands Trailhead, and Moab Rim Trailhead.
  - `Grand Canyon trails`: 90 results, starts with Bright Angel Trailhead and
    Havasu Falls.
  - `Yosemite trails`: 98 results, starts with Yosemite Valley Trails and
    Yosemite trailheads.
  - `Glacier National Park trails`: 96 results, starts with Apgar Lookout
    Trailhead and Beaver Pond Loop Trailhead.
  - No checked title or description contained internal/source placeholder
    wording or broken `Mountain. Bike` punctuation.

### Remaining Notes

- This is still a locality/ranking cleanup, not a replacement for richer
  NPS/BLM trail ingestion. The next data pass should add more official park
  trail geometry/detail so broad trail fills rely less on USFS-only rows.
- This pass has no mobile code change. OTA is not needed.

## Explorer Nearby Catalog Trail Fill Pass

### Timestamp

2026-07-05T17:05:00-05:00

### Scope

Improved trail fallback ordering by using nearby full-catalog trail cards before
the broad official trail serving index. This lets richer park trailheads and
known local trail cards appear before generic regional rows when the catalog
already has a better nearby match.

### Files Touched

- `dashboard/server.py`
  - Adds `_explore_profile_matches_trail_result` to keep trail fallback from
    admitting transit, food, store, or visitor-center records.
  - Adds `_explore_catalog_nearby_trail_profiles` to scan the full Explorer
    catalog near the requested destination.
  - Merges nearby catalog trails before broad official trail rows.
  - Sorts nearby catalog trail cards ahead of broad fallback rows while keeping
    category and distance ranking intact.
- `tests/test_trail_catalog.py`
  - Adds regression coverage so Yosemite keeps Lower and Upper Yosemite Fall
    trailheads ahead of generic trail rows.

### Verification

- `python3 -m unittest tests.test_canonical_explore_serving tests.test_trail_catalog tests.test_canonical_camp_serving tests.test_startup_prewarm`
  - 81 tests passed.
- `python3 -m py_compile dashboard/server.py`
  - Passed.
- `git diff --check`
  - Passed.
- Production-shape local smoke with
  `TRAILHEAD_CANONICAL_SERVING_DIR=/tmp/trailhead-no-generated-index`:
  - `Yosemite trails`: 95 results, starts with Yosemite Valley Trails,
    Bridalveil Fall Trailhead, Cathedral Lakes Trailhead, Chilnualna Falls
    Trailhead, Lower Yosemite Fall Trailhead, Upper Yosemite Fall Trailhead,
    and Yosemite Creek and Ten Lakes Trailhead.
  - `Grand Canyon trails`: 91 results, starts with Bright Angel Trailhead,
    Havasu Falls, Antelope House Ranger - Led Hike, and Old Spanish National
    Historic Trail.
  - `Sedona trails`: 91 results, starts with Lime Kiln and Sunflower Flat
    Mountain Bike.
  - `Moab trails`: 94 results, starts with Fins and Things OHV Route, Corona
    Arch Trailhead, Moab Brands Trailhead, and Moab Rim Trailhead.
  - `Glacier National Park trails`: 91 results, starts with Apgar Lookout
    Trailhead, Beaver Pond Loop Trailhead, and Forest and Fire Nature Trail.
  - No checked title or description contained internal/source placeholder
    wording, broken `Mountain. Bike` punctuation, transit stops, food/store
    records, or visitor-center records.

### Remaining Notes

- This improves ranking from data already in the app. It does not replace the
  need for deeper NPS/BLM trail import, especially line geometry, elevation,
  closures, and official trail detail pages.
- This pass has no mobile code change. OTA is not needed.
