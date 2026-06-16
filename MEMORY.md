# Trailhead Mobile Handoff Memory

Use this after a Codex restart:

1. Read `CLAUDE.md`.
2. Read this `MEMORY.md`.
3. Continue in `/home/sean/.openclaw/workspace/trailhead`.

## Current Focus

We are improving Trailhead production quality and expanding the outdoor catalog internationally.

Immediate reminder from June 15, 2026:

- Keep pushing the Pakistan/K2 work from mixed-source search into a live routing/confidence product.
- Pakistan is already live for mixed-source K2/Hunza/Skardu camp/stay search through curated fallback + OSM outdoor stays.
- New backend work added GDACS global disaster alerts into the live conditions pipeline and added `/api/route-confidence/pakistan` as the conservative API scaffold.
- Next Pakistan infrastructure checkpoint is the Valhalla artifact:
  - build from `https://download.geofabrik.de/asia/pakistan-latest.osm.pbf`
  - publish as `routing/valhalla/pakistan.tar.zst`
  - deploy/wire a Pakistan Valhalla runtime only after probes pass
  - then replace the confidence scaffold with OSM road-class/surface/slope/router-agreement scoring
- Continue researching and adding official/free country sources. Current best next leads:
  - New Zealand DOC API for campsites/huts/tracks
  - Canada Yukon government campgrounds and parks/protected areas
  - Australia Tasmania `Campground/site` and cautious Noosa GeoJSON/WFS
  - France data.gouv.fr camping/camping-car WFS/CSV/KML datasets
  - Switzerland swisstopo/geo.admin hiking, closures, protected-area layers; SAC huts are useful but not government
  - Norway UT.no/DNT cabins are strong hut data, but not government; treat as partner/free-source candidate
  - Pakistan GDACS + NDMA advisories + HOTOSM roads + Geofabrik PBF remain the main live-alert/routing stack

## Current Production Plan

- The saved execution plan for the next production pass is:
  - `docs/production-improvement-execution-plan.md`
- Resume from the next unchecked phase in that doc.
- Do not restart from a broad brainstorm unless the product direction materially changes.
- Audit the previous completed phase before moving into the next one.

## Valhalla US Expansion Checkpoint - June 16, 2026

User asked to finish the US Valhalla state expansion, then pause on Alaska/Hawaii.

Completed artifact publishing to R2:

- `routing/valhalla/il_in_oh.tar.zst` size `608250932`, sha256 `d3653d6df8dc115646cfd094f9f47cc22b43581c207e8d2ed7c6319039c25c1a`
- `routing/valhalla/mi_wi.tar.zst` size `391642469`, sha256 `891b0372bc46724e5dd8c2c15c8d7a65cadea2cfb1ac30876447fdef8637bcb9`
- `routing/valhalla/ia_mn.tar.zst` size `215838623`, sha256 `43d2f97d636f6828905162d1227f6464ed6cdc2e2484153cb435f9d3232728c7`
- `routing/valhalla/nd_sd_ne.tar.zst` size `134753959`, sha256 `18ed78378a2477705060cc58cdb3a06165989b6160d77e0e50ce5ed03e1c0640`
- `routing/valhalla/al_ms_tn_ky.tar.zst` size `383748709`, sha256 `167c8300f80feff9a1abec4f537177ca20c47b7415c209894e95267436c951a1`
- `routing/valhalla/la.tar.zst` size `66166074`, sha256 `9109f29b0f31e96d9a935dd61039bd2283e8f8fd729d64c60b27c923bb462b07`
- `routing/valhalla/fl_ga.tar.zst` size `517062964`, sha256 `8a83802542d96b405f51e6e92d62752083c0e5e98f2b033977645e993e9e4b8a`
- `routing/valhalla/tx.tar.zst` size `996120281`, sha256 `c8ca11670d4c505bdff2f6b8a4b8a8c5180b4aacd0ec00bf81a592016c37d96c`

Railway/API state:

- Existing services already pointed at the correct artifacts for Midwest, Great Lakes, Upper Midwest, Plains, South, Louisiana, and Southeast.
- Created new service `trailhead-valhalla-texas` with volume `trailhead-valhalla-texas-volume`.
- Added API selector entry `texas_tx` to `VALHALLA_AREA_URLS`, pointing at `http://trailhead-valhalla-texas.railway.internal:8002`; API deployment `5a5b4427-79a6-43b4-a429-0fb7d2c520c9` succeeded.
- `/api/route/health` saw `texas_tx` before the Texas service restart attempt.

Texas status:

- The local Texas artifact in `/home/sean/valhalla-region-builds/tx/tx-valhalla.tar.zst` was published, but it was bad: the local `valhalla_tiles` contained temporary builder `.bin` files only, not a real `0/1/2` tile hierarchy. Production probes returned Valhalla `171 No suitable edges near location`.
- Rebuilt Texas inside `trailhead-valhalla-texas` Railway volume using `/custom_files/tx-rebuild-work/texas-latest.osm.pbf`.
- Final tmux rebuild succeeded: `/custom_files/tx-rebuild2.log` ended with `VALHALLA_BUILD_EXIT=0`; rebuilt graph was `/custom_files/valhalla_tiles_rebuild2` with `0`, `1`, and `2` tile directories.
- Swapped rebuilt graph into `/custom_files/valhalla_tiles`, regenerated `/custom_files/valhalla.json`, and moved the bad R2 extraction to `/custom_files/valhalla_tiles_bad_r2`.
- Removed `VALHALLA_ARTIFACT_KEY` and `VALHALLA_ARTIFACT_SHA256` from `trailhead-valhalla-texas` so future boot should use the mounted graph, not re-extract the bad R2 artifact.
- Blocker at pause: after `railway service restart --service trailhead-valhalla-texas --yes`, production health showed `texas_tx` as connection failed (`All connection attempts failed`). Logs showed old R2 extraction entries and then a fresh `Mounting volume...` line, but no confirmed post-restart `Mounted Valhalla graph ready` or successful `/status`.
- Per user instruction, stop here if Texas service restart/probe fails again and move to another task. Do not start Alaska/Hawaii now.

Recommended next Texas recovery:

- Since Docker is available again locally, consider rebuilding Texas locally with Docker from scratch and publishing a clean R2 artifact, or patch/redeploy `docker/valhalla-artifact/valhalla_artifact_bootstrap.py` to prefer a valid mounted graph when `VALHALLA_ARTIFACT_KEY` is absent.
- First quick check: `railway variables --service trailhead-valhalla-texas --environment production --kv | rg '^VALHALLA_|^PORT='`; expected only `PORT=8002` and `VALHALLA_DATA_DIR=/custom_files`.
- Then check `railway logs --service trailhead-valhalla-texas --environment production --lines 120` and `curl -sS https://api.gettrailhead.app/api/route/health`.
- Remaining states intentionally paused: `AK`, `HI`. Texas is built on volume but not yet verified live.

## Route QA Matrix Checkpoint - June 16, 2026

User asked for QA across wild/balanced routes, cross-USA, there-and-back, same route with different camp windows/hours/day counts, and POI insertion.

Added repeatable QA script:

- `scripts/qa_route_matrix.py`
- Hits production-style endpoints:
  - `/api/route`
  - `/api/route/camp-windows`
  - optional `/api/planner/context`
- Scenarios include:
  - wild Moab to Big Sur with POI side stops
  - balanced Moab to Big Sur with same camp window
  - balanced Denver to Asheville cross-USA with Badlands side stop
  - wild there-and-back Moab to Big Sur
  - same route with 3 days / 9h max and 7 days / 4h max
  - PNW wild route
  - Rockies balanced same-window route

Production QA result before backend deploy:

- `python3 scripts/qa_route_matrix.py --skip-context`
  - 7 of 8 scenarios passed.
  - Camp-window endpoint returned all requested windows for all scenarios.
  - Different day/hour/camp-window combinations produced expected different window counts.
  - POI side stops did not break successful Valhalla routes.
  - Failure: `balanced_cross_usa_7d` returned a usable OSRM fallback route, but because it came from stale fallback cache, `_trailhead.repair=dropped_optional_points` metadata was missing.
- `python3 scripts/qa_route_matrix.py --limit 3`
  - Same cross-USA metadata failure.
  - Planner context returned provider notes like `{'places': ''}` in some live-provider cases; route/camp behavior still completed.

Backend fix implemented locally:

- `dashboard/server.py`
  - stale cached OSRM fallback responses now preserve optional side-stop repair metadata:
    - `repair=dropped_optional_points`
    - `dropped_optional_points`
    - user-facing message that optional side stops are saved as pins, not navigation stops
- `tests/test_route_leg_places.py`
  - added coverage for cached OSRM fallback with dropped optional side stops.

Verification:

- `python3 -m unittest tests.test_route_leg_places tests.test_route_camp_windows` passed, but took 300s due async executor shutdown warning.
- `python3 -m py_compile dashboard/server.py scripts/qa_route_matrix.py` passed.
- `git diff --check -- dashboard/server.py tests/test_route_leg_places.py scripts/qa_route_matrix.py MEMORY.md` passed.
- `npx tsx mobile/lib/routeBuilder/__tests__/routeBuilder.test.ts` is currently blocked by an existing `react-native/index.js` transform error under Node 22 / tsx, not by this backend patch.

Deploy note:

- Deployed API fix to Railway production service `trailhead` with deployment `225a5697-a600-4b08-86bf-d12ca6925e25`.
- `python3 scripts/qa_route_matrix.py --skip-context` passed 8 of 8 scenarios after deploy.
- `python3 scripts/qa_route_matrix.py --limit 3` passed 3 of 3 scenarios with planner context enabled.
- Cross-USA still routes through `osrm-fallback`, but now preserves the expected optional side-stop repair metadata.

## Explore Mobile Web Phone Audit - June 16, 2026

User asked to audit the Explore web app at a 6.5-6.9 inch phone reference size and clean up the Yosemite-heavy/cut-off/dev-ish wording.

Follow-up trail expansion checkpoint:

- User liked the Yosemite trail-card treatment and wants the app closer to AllTrails over time.
- Implemented the first OTA-safe curated expansion path:
  - Existing Explore trail-area records can now be upgraded by id/title/state with curated `trails` arrays instead of staying generic catalog cards.
  - Added Yosemite-style rich trail packs for Zion Canyon, Grand Canyon corridor, Glacier high country, Rocky Mountain alpine, Grand Teton, Great Smoky Mountains, and Acadia.
  - These seven new areas add 28 individual trail cards with distance, route type, elevation gain, time, difficulty, access/safety notes, coordinates, source URLs, tags, highlights, and map/route actions.
  - The map handoff now supports a `trail` pending selection. Opening an individual Explore trail on the map calls the existing native `highlightTrail(lat, lng, name)` flow so the loaded trail/path layer is highlighted instead of only centering a generic pin.
- Follow-up direction:
  - Fill the remaining generic trail catalog areas next: Olympic, Mount Rainier, Shenandoah, Arches, Bryce Canyon, Canyonlands, Joshua Tree, Sequoia, Death Valley, North Cascades, Big Bend, and Redwood.
  - Longer term, move curated trail packs into the backend Explore/catalog build so mobile is not carrying all trail editorial data.

Implemented OTA-safe mobile/web changes:

- Installed missing web dependency `@lottiefiles/dotlottie-react` so Expo web can bundle `lottie-react-native`.
- Added curated `Yosemite Trails` data with six detailed trail cards: Mist Trail, Half Dome, Mirror Lake Loop, Upper Yosemite Fall Trail, Taft Point & The Fissures, and Mariposa Grove.
- Added `ExploreTrailArea` so opening Yosemite shows a trail list with photos, distance, route type, elevation gain, time, difficulty, season, dog/bike notes, highlights, and Route/Map actions.
- The trail filter pill now cycles All/Easy/Hard instead of looking like a dead control.
- Fixed Explore category matching so category rails do not bleed unrelated cards into Camp/Trails/etc.
- Removed/replaced confusing UI copy:
  - `Timing notes` -> short season labels like `Book early`, `Road-open season`, `Check hours`.
  - `Official + Community` -> `Checked details` / `Multiple sources`.
  - route-planner/dev-ish card copy -> plain trip-facing descriptions.
- Wired `Near this stop` actions in the Explore detail sheet:
  - Weather now calls `/api/weather` and renders a `WEATHER AT THIS STOP` card.
  - Trails switches to the Summary trail list.
  - Route/Map/services buttons now call existing map/route actions instead of doing nothing.
- Skipped the curated Explore campground endpoint for local `explore:trails:*` IDs so opening Yosemite does not log a 404; it uses nearby-camp fallback by coordinates.

Verification:

- `cd mobile && npx tsc --noEmit` passed.
- `cd mobile && npx expo export --platform web --output-dir /tmp/trailhead-explore-phone-check` passed; only existing `react-native-webrtc` export warning.
- Playwright Chromium at `430x932`:
  - Explore loaded with 0 console errors.
  - Trails filter showed `Yosemite Trails`.
  - Search for `Yosemite Trails` opened the detail sheet.
  - Mist Trail expanded with `3.2 mi`, `Out & Back`, `700 ft`, `2-3 hrs`.
  - Trail filter switched to `EASY` and reduced the list to four easy trails.
  - Weather `Forecast` button rendered `WEATHER AT THIS STOP` with hi/lo, wind, and precip.
  - Screenshot saved at `mobile/.playwright-cli/page-2026-06-16T05-03-48-520Z.png`.
- `git diff --check` passed.

Notes:

- Mariposa Grove now uses a verified Grizzly Giant / Mariposa Grove Wikimedia image URL.
- Pre-OTA follow-up:
  - Ran `npm audit fix --omit=dev`; high/low advisories were cleared and the remaining audit output is 22 moderate advisories.
  - The remaining audit fixes require forced major upgrades through Expo 56 / React Native 0.86, so do not apply those before an OTA-only publish.
  - The web export warning is from `react-native-webrtc@124.0.7` importing `event-target-shim/index` while its pinned `event-target-shim@6.0.2` only exports the package root. Expo export still completes, so leave this as a dependency warning unless doing a native/dependency pass.
  - OTA still needs to be published with explicit `--message` flags because the `npm run ota` package script previously failed in non-interactive mode.

OTA follow-up:

- Source commits: `b671727 Fix Explore phone web audit` and `28aa26f Resolve Explore OTA preflight notes`.
- Published with explicit message `Fix Explore phone web audit`.
- Production update group: `008c96d8-8fb8-479e-b85b-b4614d91cc2f`.
- Preview update group: `52519bef-0347-4a7e-bc34-63be30abc0c7`.
- Runtime version: `native-20260614-sdk54-1`.

## Current Design Direction

- The user wants a broader premium redesign direction because the map feels confusing and some pages are inconsistent.
- Chosen baseline: **Sublima Mobile App Pro + Opex**.
  - Sublima copied Figma file: `https://www.figma.com/design/8jYbmt6yU97e7zmFBaMlZi/Sublima-Mobile-App-PRO--v1.0---Copy-`
  - Useful Sublima nodes: Cards `923:2970`, Button Dock `21047:2548`, Bottom Navigation `21042:22`, Searchbar `21150:659`, Top Navigation `21118:1101`.
  - Opex stays the map/navigation inspiration because the user already bought/imported it.
- First implementation priority: clean up the map and trail route builder before doing the full app-wide redesign.
- Trail builder target UX: dedicated mode, no Drop Pin button, tap near trail segments to auto-snap anchors, live snapped preview, explicit BUILD step, then name/save/cache/start the route.
- Later redesign pass should revisit map search/filter duplication, navigation panel, bottom navigation, profile/settings/paywall consistency, and place/trail cards using Sublima-style surfaces.

The user wants Route Builder to feel closer to The Dyrt's smooth road-trip planner, but still unique to Trailhead:

- Ask where the user is going.
- Use current location/start point and final destination.
- Let user choose number of days, daily drive hours, and route style.
- Lay out the full route first.
- Let users pick fuel stops, POIs, and camps by day/leg.
- Show camps along the route line on the map, not random nationwide or only near current location.
- Make camp cards look like the app's normal camp cards.
- Selecting/replacing a camp should update that day's overnight anchor and rebalance following days.
- If Day 2 camp is earlier than planned, Day 2 becomes shorter and Day 3 becomes longer.
- If user only has 14 days, app should warn if selected hours/rest days make the route impossible in 14 days.
- Important clarification: hours per day is the user's maximum preferred drive time for a day, not a goal to fill. Shorter days are good; the app should warn/rebalance when a day exceeds that max.

## Latest OTA Navigation, Map Labels, Nearby Search, And Foursquare Work

Date/context:

- Work happened May 13-14, 2026.
- User explicitly wanted everything possible to stay OTA-safe for both Android and iOS preview/production builds because Apple review delays are tiring.
- Do not start a full native build for the remaining offline highway shield/tile-decoder work unless the user explicitly approves it.

Navigation/offline-online route handler:

- Fixed route fetching/cache behavior so online/offline/online handoff does not keep using stale keyed cached geometry while online.
- `mobile/components/NativeMap/routing.ts` now checks connectivity before keyed route cache; keyed cache is offline-only.
- Route fetch/reroute now clears transient route progress/off-route streak while a route is being refreshed.
- `mobile/components/NativeMap/index.tsx` and `mobile/app/(tabs)/map.tsx` ignore stale native progress while rerouting and reset progress on reroute/route-ready.
- Purpose: stop frozen/flashing remaining distance and "miles to turn/total miles left" uncertainty after online-offline-online transitions.

Navigation instruction quality and map labels:

- Mapbox routing parser now preserves provider instruction/verbal fields and roundabout exit data in `mobile/components/NativeMap/routing.ts`.
- Navigation HUD/speech in `mobile/app/(tabs)/map.tsx` prefers provider instructions before synthetic step text.
- Added current-road glass pill in native navigation.
- `mobile/components/NativeMap/mapStyle.ts` gained road label improvements:
  - highway shield/ref label layer,
  - better highway names,
  - major-road labels,
  - minor-road line-following labels.
- Remaining limitation: full offline shield completeness may require native iOS/Android tile decoder expansion because native offline decoders currently expose limited road fields. This is not OTA-safe.

Nearby/category search:

- Added `GET /api/places/nearby` in `dashboard/server.py`.
- Added OSM service discovery in `ingestors/osm.py` for practical road-trip categories:
  - fuel, propane, water, dump, shower, laundromat, lodging, food, grocery, mechanic, parking, attraction, trailhead, viewpoint, peak, hot spring, hardware, camping, medical, parts, wifi.
- Added `api.getNearbyPlaces()` in `mobile/lib/api.ts`.
- `mobile/components/RouteSearchModal.tsx` now:
  - radius-scopes offline/local packs before showing "nearby",
  - merges live server results instead of skipping live lookup when stale/far local results exist,
  - dedupes and sorts by distance,
  - keeps category radius bounded.
- Map search in `mobile/app/(tabs)/map.tsx` uses the server geocode API instead of direct device Nominatim.

Foursquare provider:

- Added `ingestors/foursquare.py` as an optional backend-only enrichment layer for `/api/places/nearby`.
- Railway variable `FOURSQUARE_API_KEY` is set.
- Important migration detail: legacy V3 host `https://api.foursquare.com/v3/places/search` returned `401 Invalid request token` with the new service key.
- Correct endpoint from Foursquare upcoming-changes/new docs is:
  - `https://places-api.foursquare.com/places/search`
  - `Authorization: Bearer <FOURSQUARE_API_KEY>`
  - `X-Places-Api-Version: 2025-06-17`
- Railway direct probe with the new endpoint returned `200` for a basic search.
- Explicit field-expanded Foursquare requests triggered account credit enforcement (`429`, no credits remaining), so the implementation avoids explicit `fields` expansion and uses the default Search response.
- Live `/api/places/nearby?lat=38.5733&lng=-109.5498&radius=10&categories=food` now returns Foursquare results mixed with OSM fallback.
- Foursquare enrichment is capped and conservative:
  - business-like categories only,
  - max three category lookups per user action,
  - no mobile key exposure,
  - OSM fallback on failure/rate-limit/credit problems.

Deployments and OTA:

- Railway successful backend deployments during this work:
  - `f5366194-0798-4d17-ac5e-ba369de14875`: initial nearby route/search backend deploy.
  - `366c5367-ee4a-44a7-829d-c119d6bad416`: optional Foursquare backend path before key activation.
  - `3599709c-19b0-45f5-8a5d-bf95e73586fa`: safer Foursquare code/no persistent attribute caching.
  - `6dae432a-af79-43ee-a6ce-3f5e1420a2c3`: restored backend route after dashboard/env deploy temporarily served code without `/api/places/nearby`.
  - `616b0d50-e602-4824-abe8-1a384dbb2441`: provider diagnostic logging.
  - `eb235dc1-1e7d-47da-84b4-ac7eba1bad8d`: correct new Foursquare Places API host/version/Bearer auth; live Foursquare results confirmed.
- Expo OTA production:
  - Update group `7d112aff-73d0-4877-a206-01390d0cdf1a`
  - Android update `019e2430-0198-7746-a3f8-24145b3ab5c9`
  - iOS update `019e2430-0198-7c27-840b-9dd798a0d0f7`
  - Message: `Improve route handoff, map labels, and nearby search`
- Expo OTA preview:
  - Update group `753d949b-6f37-4afa-a271-5c2036e75b8f`
  - Android update `019e2430-d19f-76a4-af56-73c2c5fb0c3d`
  - iOS update `019e2430-d19f-7615-bba3-46520dd8f145`
  - Message: `Improve route handoff, map labels, and nearby search`

Verification:

- `cd mobile && npx tsc --noEmit` passed.
- `python3 -m py_compile dashboard/server.py ingestors/osm.py ingestors/nrel.py ingestors/foursquare.py` passed across the relevant changes.
- `git diff --check` passed.
- Expo web export and Playwright checked Plan/Map surfaces; no app-breaking console errors, only favicon/RN-web warnings.

Figma:

- Attempted to create a Figma page for the navigation labels/search work using `figma-use` and `figma-generate-design`.
- Figma connector refused external file modification without explicit confirmation despite user request, so no Figma canvas changes were made for this pass.

## Latest Trail System iOS Preview

Latest EAS iOS preview build finished:

- Build ID: `f86353f5-8bd6-49c9-a3df-2640e568e233`
- Install link: `https://expo.dev/accounts/danub44/projects/trailhead/builds/f86353f5-8bd6-49c9-a3df-2640e568e233`
- Channel/profile: `preview`
- App build version: `18`
- Completed: `2026-05-06T05:54:25Z`
- Superseded/canceled build: `ad9bac2f-77a6-4b81-8455-0051c9771db1`

Context:

- User closed Codex while waiting for this build.
- The current test target is trail follow/select not working because downloaded trail overlay packs were not being found/loaded from existing on-device data.

What changed:

- Offline map, routing, contour, and trail pack storage now prefers persistent `FileSystem.documentDirectory` paths instead of purgeable cache paths.
- Existing cache-directory files are migrated into persistent storage on hook mount.
- Trail pack state now detects existing `.pmtiles` files, marks them complete, validates them against the published manifest, and downloads/repairs missing sidecar graph files.
- NativeMap now searches both persistent and legacy/cache locations for offline maps, contours, and trail packs.
- Native tile server exposes dedicated `/api/trails/{z}/{x}/{y}.pbf` and `setTrails/clearTrails`, so trail overlays survive state/base map switches.
- Map style switches the trail source to the local tile server when a downloaded trail pack is active.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

## Online Valhalla State Expansion Checkpoint - East, Ozarks, NY/NJ/CT

Production routing was expanded beyond the default West graph.

Live Valhalla targets now configured on `trailhead` via `VALHALLA_AREA_URLS`:

- `east_vt_nh` -> `trailhead-valhalla-west`, bounds for VT/NH overlap.
- `east_pa_md_de_va` -> `trailhead-valhalla-west`.
- `east_wv` -> `trailhead-valhalla-west`.
- `east_nc` -> `trailhead-valhalla-west`.
- `east_sc` -> `trailhead-valhalla-west`.
- `ny_nj_ct` -> `trailhead-valhalla-west2`.
- `east_new_england` -> `trailhead-valhalla-west`.
- `ozarks` -> `trailhead-valhalla`.
- default remains `trailhead-valhalla-us`.

New NY/NJ/CT artifact:

- Local artifact: `/home/sean/valhalla-region-builds/ny_nj_ct/ny_nj_ct-valhalla.tar.zst`
- R2 key: `routing/valhalla/ny_nj_ct.tar.zst`
- Size: `399707852`
- SHA-256: `727ce43fe67d88e9f6b09d913327b88da39cafb359174be6f81cc9ed7d6a6a6b`
- Deployed to `trailhead-valhalla-west2` with artifact bootstrap deployment `67ba94b6-b077-4e99-86ec-a257fbe0317f`.

Railway/API deployments:

- `trailhead-valhalla-west2` artifact deployment succeeded after adding R2 env vars.
- `trailhead` API deployment with final target rename succeeded: `cd9a848a-ebc0-4621-9762-220283d77d55`.
- `/api/route/health` returned `ok: true` for all nine targets.

Verification:

- Direct west2 probes passed:
  - NY: NYC -> Albany, Valhalla status `0`, length `149.8507 mi`.
  - CT: Hartford -> New Haven, Valhalla status `0`, length `38.5962 mi`.
  - NJ: Newark -> Philadelphia, Valhalla status `0`, length `84.1135 mi`.
- API targeted probes passed:
  - NY/CT/NJ use `ny_nj_ct`.
  - PA uses `east_pa_md_de_va`.
  - NC uses `east_nc`.
  - SC uses `east_sc`.
  - VT uses `east_vt_nh`.
  - RI uses `east_new_england`.
  - GA no longer gets caught by the east graph; it falls back through `default`.
- Final `scripts/probe_routing_50_states.py --api https://api.gettrailhead.app/api/route --timeout 45`:
  - total `50`
  - Valhalla `30`
  - OSRM fallback `20`
  - failed `[]`
  - remaining fallback states: `AL, AK, FL, GA, HI, IA, IL, IN, KY, LA, MI, MN, MS, ND, NE, OH, SD, TN, TX, WI`

Next sane online routing chunks:

- Great Lakes / Midwest: split small to avoid memory failures, likely `IL,IN,OH` and `MI,WI,MN,IA` or smaller.
- South: split `AL,MS,TN,KY`, `LA`, `FL`, `GA` separately or in small groups.
- Texas likely should be its own graph because of size.

## Native Map Locate Camera Fix Checkpoint

Issue addressed:

- Android could still snap back to the user's location after pressing locate, especially when trying to pan immediately afterward.
- iOS locate sometimes moved only a small amount instead of clearly recentering.

Code change:

- `mobile/components/NativeMap/index.tsx`
- Native map imperative camera moves now update the free-camera default before calling `setCamera`.
- Locate no longer remounts the Camera through `freeCameraRevision`; it applies one direct `flyTo` camera update.
- Real map touches now mark a user camera gesture and cancel the programmatic camera window, so panning right after locate wins over any in-flight locate animation.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

OTA shipped:

- Production update group: `220af3d1-f653-4360-b351-680805399ed7`
- Production Android update: `019ecd4b-1d74-740d-b5af-cc270aed268e`
- Production iOS update: `019ecd4b-1d74-7393-839c-67524f6c4877`
- Preview update group: `aad6065f-8e5b-4c2a-ad66-fabebc45ca56`
- Preview Android update: `019ecd4b-c5fb-798a-a492-7c79e10e10c8`
- Preview iOS update: `019ecd4b-c5fb-708f-b4b7-529ece8331f3`

## Ozarks Valhalla Online Routing Checkpoint

Date: 2026-06-15.

Reason:

- Screenshot showed `St. Louis to SMORR Technical Loop` drawing as a near-straight cross-state line.
- Production `/api/route` was healthy but only pointed at expanded-West `trailhead-valhalla-us`; Missouri routes fell through to fallback instead of Trailhead Valhalla.

Backend routing findings:

- Before this pass, 50-state production probe was:
  - `valhalla: 11`
  - `osrm_fallback: 39`
  - `failed: []`
- R2 already had per-state routing packs for all 50 states, including `mo.tar`, `ar.tar`, `ok.tar`, and `ks.tar`.
- Full Plains connected build for `ND,SD,NE,KS,OK,IA,MO,AR` was killed during final validation/binning, likely memory pressure. Do not use that failed artifact.
- Smaller connected Ozarks build for `MO,AR,OK,KS` succeeded:
  - Local artifact: `/home/sean/valhalla-region-builds/ozarks/ozarks-valhalla.tar.zst`
  - R2 key: `routing/valhalla/ozarks.tar.zst`
  - Size: `418,563,671`
  - SHA-256: `01aeff23d344989e05fd13646d4faa7aff241b3dabc5313a6c645831652986f9`

Railway changes:

- `trailhead-valhalla` was redeployed with the artifact bootstrap image from `docker/valhalla-artifact`.
- Deployment: `841f0028-7d02-41ec-b6e6-58fc167bcde9`.
- `trailhead-valhalla` variables:
  - `VALHALLA_ARTIFACT_KEY=routing/valhalla/ozarks.tar.zst`
  - `VALHALLA_ARTIFACT_SHA256=01aeff23d344989e05fd13646d4faa7aff241b3dabc5313a6c645831652986f9`
  - old `VALHALLA_ARTIFACT_KEYS` was deleted.
- `trailhead` API `VALHALLA_AREA_URLS` now includes only:
  - `id=ozarks`
  - `url=http://trailhead-valhalla.railway.internal:8002`
  - bounds `s=33.0,w=-102.2,n=40.8,e=-89.0`
  - states `MO,AR,OK,KS`
- API deployment after env change: `ebac8f81-01dd-4e02-9344-e7e734a3ce7d`.

Validation:

- Direct Ozarks Valhalla probes passed:
  - St. Louis -> SMORR area: `215.9414 mi`, shape chars `17074`
  - St. Louis -> Columbia: `124.8712 mi`
  - Kansas City -> Columbia: `125.9952 mi`
  - Little Rock -> Ouachita probe: `55.0865 mi`
  - Tulsa -> OKC: `107.6207 mi`
  - Wichita -> Topeka: `144.8184 mi`
- Production `/api/route` now returns:
  - St. Louis -> SMORR area: `engine=valhalla`, `target=ozarks`, `215.9414 mi`, shape chars `17074`
  - Moab -> Big Sur still uses `engine=valhalla`, `target=default`
- 50-state production probe after wiring Ozarks:
  - `valhalla: 15`
  - `osrm_fallback: 35`
  - `failed: []`
  - Newly Valhalla-backed states: `AR`, `KS`, `MO`, `OK`.

Route Builder fix:

- `mobile/app/(tabs)/route-builder.tsx` now passes the known-good provider spine geometry directly into `commitTrip` during auto-build.
- This prevents a race where the builder fetched a valid provider route, then saved before React state held the geometry, causing saved trips to fall back to waypoint/straight-line geometry.
- OTA shipped:
  - Production update group: `8a1362a5-373e-4157-b7ea-ce13139441d8`
  - Production Android update: `019ecaa1-d1a7-7624-9741-a64d016c7cd3`
  - Production iOS update: `019ecaa1-d1a7-706a-b44d-c4123ae01484`
  - Preview update group: `dd3ec76b-8114-459b-b64d-e0c532791981`
  - Preview Android update: `019ecaa2-99ab-7c03-bbf2-9c5d730f040c`
  - Preview iOS update: `019ecaa2-99ab-7778-b53b-361a0b5f30d7`
- Verification:
  - `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
  - `git diff --check` passed.

Remaining routing work:

- Build/deploy more connected regional artifacts, not runtime-merged per-state tar packs.
- Next candidates:
  - `great_lakes`: `MN,WI,IL,IN,MI,OH`
  - `south_central`: likely split smaller than `TX,LA,MS,AL,TN,KY` if memory pressure appears.
  - `southeast`: `FL,GA,SC,NC,VA,WV`
  - `northeast`: still needs special handling for the old `NY,NJ,CT` multi-PBF crash.

## Valhalla Regional Build Resume Note

Goal:

- Get Route Builder and Co-Pilot using Valhalla across all 50 states without a single giant full-US Valhalla build.
- R2 already has all 50 per-state routing packs under `routing/{state}.tar`, but those cannot be safely runtime-merged into one connected Valhalla service.
- Correct fix is true connected regional Valhalla builds from grouped state PBFs, then deploy/wire regional Valhalla services.

What happened:

- Production baseline after stabilizing:
  - `/api/route` returns routes in all 50 state smoke tests.
  - Only 11/50 states are currently Valhalla.
  - 39/50 states use `osrm-fallback`.
  - No route failures in baseline.
- Temporarily tested expanded Midwest service by extracting multiple per-state `routing/*.tar` packs together.
  - Bootstrap worked, but the graph was not valid enough.
  - Several states returned `No suitable edges near location`.
  - API `VALHALLA_AREA_URLS` was reset to `[]` so production does not use that broken regional target.
- Added and pushed tooling in commit `8ea5355`:
  - `docker/valhalla-artifact/valhalla_artifact_bootstrap.py`
  - `scripts/build_valhalla_region_artifacts.sh`
  - `scripts/probe_routing_50_states.py`

Current state after WSL crash recovery:

- The WSL terminal crash killed the original regional build.
- The survived west `valhalla_tiles` output was preserved manually:
  - Plain tar: `/home/sean/valhalla-region-builds/west/west-valhalla.tar` (`18G`)
  - Compressed artifact: `/home/sean/valhalla-region-builds/west/west-valhalla.tar.zst` (`3.1G`)
  - Published R2 key: `routing/valhalla/west.tar.zst`
  - SHA-256: `e1323f1b862ed421adb327c8a9f352110d540f8d943f48cd9ce401c6222b1605`
- Docker is still not visible from Ubuntu:

```text
docker: command not found
```

- `/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe --version` also fails from WSL with `UtilBindVsockAnyPort`, so Docker Desktop WSL integration still needs to be fixed before remaining regional builds can run.
- User is installing/enabling Docker Desktop WSL integration and may need to log out of Windows and back in for Docker to appear in Ubuntu.

Resume after Windows logout/login:

```bash
cd /home/sean/.openclaw/workspace/trailhead
docker --version
docker run --rm hello-world
```

If Docker works:

```bash
cd /home/sean/.openclaw/workspace/trailhead
railway run --service trailhead bash
export VALHALLA_REGION_WORKDIR=/home/sean/valhalla-region-builds
scripts/build_valhalla_region_artifacts.sh great_lakes plains south_central southeast northeast alaska hawaii
```

Notes:

- Do not use `/mnt/nvme`; it failed with permission denied on this WSL machine.
- Use `/home/sean/valhalla-region-builds`.
- West is already published; do not rerun `all` unless you intentionally want to rebuild and republish west.
- Do not paste literal `...` into `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, or `R2_SECRET_ACCESS_KEY`.
- Prefer `railway run --service trailhead bash` so R2 secrets come from Railway and are not pasted manually.

After regional artifacts finish:

1. Confirm R2 has:
   - `routing/valhalla/west.tar.zst`
   - `routing/valhalla/great_lakes.tar.zst`
   - `routing/valhalla/plains.tar.zst`
   - `routing/valhalla/south_central.tar.zst`
   - `routing/valhalla/southeast.tar.zst`
   - `routing/valhalla/northeast.tar.zst`
   - `routing/valhalla/alaska.tar.zst`
   - `routing/valhalla/hawaii.tar.zst`
2. Deploy/wire regional Valhalla services to those true regional artifacts.
3. Set API `VALHALLA_AREA_URLS` with regional bounds only after each service passes direct probes.
4. Run:

```bash
scripts/probe_routing_50_states.py
```

Success target:

- `valhalla: 50`
- `osrm_fallback: 0`
- `failed: []`

## Valhalla Rolling GA/FL Build

Date: 2026-06-08.

Built and validated a rolling Southeast GA/FL Valhalla artifact on `trailhead-valhalla` only. Live production services were not changed.

States in this artifact:

- Georgia
- Florida

Build notes:

- Downloaded current Geofabrik PBFs locally, staged them through R2 signed URLs, and copied them onto the Railway volume using `valhalla-volume-helper-nginx`.
- Moved prior South-Central active PBFs to `.hold` and preserved `/custom_files/south-central-valhalla_tiles.tar`.
- Built from `/custom_files/georgia-260608.osm.pbf` and `/custom_files/florida-260608.osm.pbf`.
- Build completed successfully and loaded `647` tiles.
- Saved named artifact: `/custom_files/southeast-ga-fl-valhalla_tiles.tar` (`1.6G`).

Validation probes passed:

- Atlanta -> Miami: `663.3648 mi`
- Atlanta -> Jacksonville: `346.103 mi`
- Tampa -> Tallahassee: `277.2222 mi`

Final rolling service settings:

- `force_rebuild=False`
- `use_tiles_ignore_pbf=True`
- `build_admins=False`
- `build_time_zones=False`
- `server_threads=2`

Restart validation showed `Jumping directly to the tile loading!` and `Tile extract successfully loaded with tile count: 647`.

Cleaned helper temp URL variables `TEMP_URL_GA` and `TEMP_URL_FL`, plus local temp files under `/tmp`.

## Valhalla Rolling Texas Build

Date: 2026-06-08.

Built and validated a rolling Texas-only Valhalla artifact on `trailhead-valhalla` only. Live production services were not changed.

States in this artifact:

- Texas

Build notes:

- Downloaded current Geofabrik Texas PBF locally, staged it through R2 signed URL, and copied it onto the Railway volume using `valhalla-volume-helper-nginx`.
- Moved GA/FL active PBFs to `.hold` and preserved `/custom_files/southeast-ga-fl-valhalla_tiles.tar`.
- Built from `/custom_files/texas-260608.osm.pbf`.
- Build completed successfully and loaded `1303` tiles.
- Saved named artifact: `/custom_files/texas-valhalla_tiles.tar` (`1.5G`).

Validation probes passed:

- Dallas -> Houston: `239.4144 mi`
- Austin -> San Antonio: `79.9105 mi`
- El Paso -> Dallas: `636.1428 mi`
- Houston -> Big Bend: `652.9315 mi`

Final rolling service settings:

- `force_rebuild=False`
- `use_tiles_ignore_pbf=True`
- `build_admins=False`
- `build_time_zones=False`
- `server_threads=2`

Restart validation showed `Jumping directly to the tile loading!` and `Tile extract successfully loaded with tile count: 1303`.

Cleaned helper temp URL variable `TEMP_URL_TX`, plus local temp files under `/tmp`.

## Valhalla Rolling Central Plains Build

Date: 2026-06-08.

Built and validated a rolling Central Plains Valhalla artifact on `trailhead-valhalla` only. Live production services were not changed.

States in this artifact:

- North Dakota
- South Dakota
- Nebraska
- Kansas
- Iowa
- Missouri

Build notes:

- Downloaded current Geofabrik PBFs locally, staged them through R2 signed URLs, and copied them onto the Railway volume using `valhalla-volume-helper-nginx`.
- Moved Texas active PBF to `.hold` and preserved `/custom_files/texas-valhalla_tiles.tar`.
- Built from:
  - `/custom_files/north-dakota-260608.osm.pbf`
  - `/custom_files/south-dakota-260608.osm.pbf`
  - `/custom_files/nebraska-260608.osm.pbf`
  - `/custom_files/kansas-260608.osm.pbf`
  - `/custom_files/iowa-260608.osm.pbf`
  - `/custom_files/missouri-260608.osm.pbf`
- Build completed successfully and loaded `2368` tiles.
- Saved named artifact: `/custom_files/central-plains-valhalla_tiles.tar` (`1.4G`).
- Valhalla emitted the standard multi-PBF warning and duplicate warnings during validation; they were not fatal.

Validation probes passed:

- Fargo -> Kansas City: `601.3471 mi`
- Omaha -> Des Moines: `134.3189 mi`
- Sioux Falls -> Bismarck: `430.9984 mi`
- Wichita -> St Louis: `441.5893 mi`

Final rolling service settings:

- `force_rebuild=False`
- `use_tiles_ignore_pbf=True`
- `build_admins=False`
- `build_time_zones=False`
- `server_threads=2`

Restart validation showed `Jumping directly to the tile loading!` and `Tile extract successfully loaded with tile count: 2368`.

Cleaned helper temp URL variables `TEMP_URL_ND`, `TEMP_URL_SD`, `TEMP_URL_NE`, `TEMP_URL_KS`, `TEMP_URL_IA`, and `TEMP_URL_MO`, plus local temp files under `/tmp`.

## Valhalla Rolling Midwest/Great Lakes Build

Date: 2026-06-08.

Built and validated a rolling Midwest/Great Lakes Valhalla artifact on `trailhead-valhalla` only. Live production services were not changed.

States in this artifact:

- Minnesota
- Wisconsin
- Illinois
- Indiana
- Michigan
- Ohio

Build notes:

- Downloaded current Geofabrik PBFs locally, staged them through R2 signed URLs, and copied them onto the Railway volume using `valhalla-volume-helper-nginx`.
- Moved Central Plains active PBFs to `.hold` and preserved `/custom_files/central-plains-valhalla_tiles.tar`.
- Built from:
  - `/custom_files/minnesota-260608.osm.pbf`
  - `/custom_files/wisconsin-260608.osm.pbf`
  - `/custom_files/illinois-260608.osm.pbf`
  - `/custom_files/indiana-260608.osm.pbf`
  - `/custom_files/michigan-260608.osm.pbf`
  - `/custom_files/ohio-260608.osm.pbf`
- Build completed successfully and loaded `1972` tiles.
- Saved named artifact: `/custom_files/midwest-great-lakes-valhalla_tiles.tar` (`3.6G`).
- Valhalla emitted the standard multi-PBF warning plus density/duplicate warnings; they were not fatal.

Validation probes passed:

- Chicago -> Detroit: `283.0 mi`
- Minneapolis -> Milwaukee: `337.0 mi`
- Indianapolis -> Columbus: `175.6 mi`
- Cleveland -> Grand Rapids: `299.7 mi`

Final rolling service settings:

- `force_rebuild=False`
- `use_tiles_ignore_pbf=True`
- `build_admins=False`
- `build_time_zones=False`
- `server_threads=2`

Restart validation showed `Jumping directly to the tile loading!` and `Tile extract successfully loaded with tile count: 1972`.

Cleaned helper temp URL variables `TEMP_URL_MN`, `TEMP_URL_WI`, `TEMP_URL_IL`, `TEMP_URL_IN`, `TEMP_URL_MI`, and `TEMP_URL_OH`, plus local temp files under `/tmp`.

Current rolling `trailhead-valhalla` active artifact is Midwest/Great Lakes. This supersedes the older note that the rolling service was Connecticut-only during the lower-Hudson investigation.

## Route Builder Copilot And Valhalla South-Central

Backend Route Builder copilot fix:

- Fixed `_route_builder_draft_from_text` / `_is_route_builder_request` so command-style trip prompts are treated as Route Scout drafts:
  - `create a route from Moab to Big Sur` -> `startRouteScout`
  - `Build Moab to Big Sur` -> `startRouteScout`
  - `Route from Moab to Big Sur` -> `startRouteScout`
- Kept point-to-point preview behavior intact:
  - `preview a route to the Eiffel Tower` still -> `buildRoute`
- Added regression assertions in `tests/test_extreme_explorer.py`.
- Verification passed:
  - `python3 -m unittest tests.test_extreme_explorer`
- Deployed API service `trailhead` with Railway deployment:
  - `c9583158-d240-49cc-a475-464a43dcf53b`
  - Status: `SUCCESS`

Valhalla South-Central rolling build:

- Service used: `trailhead-valhalla` only. This is the rolling/test builder, not the live production Valhalla target used by the API.
- Built local-file batch:
  - `AL, AR, KY, LA, MS, OK, TN`
- Railway direct Geofabrik downloads failed from the Valhalla container with `curl: (7)` to `download.geofabrik.de`, so the PBFs were downloaded locally, staged to R2, then copied into the rolling Valhalla volume via temporarily attaching `trailhead-valhalla-volume` to `valhalla-volume-helper-nginx`.
- Important helper gotcha:
  - `railway ssh` does not forward stdin reliably here; `cat > file < local.pbf` and remote `tee` created zero-byte files.
  - The reliable copy path was R2 signed URL variables + helper-side `wget`, after temporarily attaching the rolling volume to the helper.
  - Helper BusyBox command quoting needs literal quotes around the remote `sh -c` command.
- Build result:
  - Successfully built `/custom_files/alabama-260607.osm.pbf /custom_files/arkansas-260607.osm.pbf /custom_files/kentucky-260607.osm.pbf /custom_files/louisiana-260607.osm.pbf /custom_files/mississippi-260607.osm.pbf /custom_files/oklahoma-260607.osm.pbf /custom_files/tennessee-260607.osm.pbf`
  - `1875` tiles loaded
  - Active artifact: `/custom_files/valhalla_tiles.tar`
  - Named saved artifact: `/custom_files/south-central-valhalla_tiles.tar` (`1.9G`)
- Validation from inside the Valhalla container passed:
  - `/status` healthy, Valhalla `3.5.1-49b40b7f2`, `route` action available
  - Birmingham -> Nashville: `191.8 mi`
  - Little Rock -> Oklahoma City: `339.5 mi`
  - New Orleans -> Jackson: `186.3 mi`
  - Louisville -> Memphis: `386.7 mi`
- Final rolling service variables:
  - `force_rebuild=False`
  - `use_tiles_ignore_pbf=True`
  - `build_admins=False`
  - `build_time_zones=False`
  - `server_threads=2`
  - no `tile_urls`
  - temporary signed URL vars deleted
- Restart after setting no-rebuild loaded the completed tile extract directly:
  - `INFO: Jumping directly to the tile loading!`
  - `Tile extract successfully loaded with tile count: 1875`

Next Valhalla areas:

- South-Central succeeded; next candidates are `GA/FL`, then `TX`, then remaining Midwest/East gaps.
- For large batches or repeated multi-PBF issues, use the same area strategy and circle back rather than blocking on one state.
- `TX` and `FL` are large but locally downloadable; direct Railway Geofabrik download should not be assumed to work.

## Valhalla Area Graph Rollout

Date/context:

- June 6, 2026.
- User clarified Trailhead is not using Foursquare for this pass; focus is Valhalla routing.
- Full-US Valhalla build/service had issues, so routing graphs should be built and validated by areas.

Current live state:

- Production API `VALHALLA_URL` now points at `http://trailhead-valhalla-us.railway.internal:8002`.
- `trailhead-valhalla-us` is healthy and contains the expanded West area:
  - California
  - Nevada
  - Utah
  - Arizona
  - New Mexico
  - Colorado
  - Wyoming
  - Montana
  - Idaho
  - Oregon
  - Washington
- `trailhead-valhalla-west2` remains available as the older CA/NV/UT-only service.
- `/api/route/health` confirmed the live API can reach `trailhead-valhalla-us`; the old `/api/admin/routing-coverage-diagnostic` endpoint currently returns 404.

Per-state R2 routing packs:

- R2 `routing/manifest.json` contains all 50 states plus Canada, Mexico, and Finland as individual `routing/*.tar` packs.
- There is no published `routing/valhalla/manifest.json` for the newer combined artifact path.

Expanded-West build:

- Repurposed unhealthy `trailhead-valhalla-us` service as the expanded-West candidate builder so the live `west2` service stays online.
- Removed stale full-US volume files from `trailhead-valhalla-us`:
  - old `us-260528.osm.pbf`
  - old `valhalla_tiles`
  - old `valhalla.json`
  - old tile/tar/hash leftovers
- Set `trailhead-valhalla-us` `tile_urls` to:
  - CA, NV, UT, AZ, NM, CO, WY, MT, ID, OR, WA
- Supporting variables on `trailhead-valhalla-us`:
  - `force_rebuild=True`
  - `build_admins=False`
  - `build_time_zones=False`
  - `server_threads=2`
- Clean redeploy downloaded all 11 state PBFs, built `valhalla_tiles`, created `valhalla_tiles.tar`, and started Valhalla.
- `https://trailhead-valhalla-us-production.up.railway.app/status` returned Valhalla `3.5.1-49b40b7f`, tile extract `6120`, and `available_actions` including `route`.
- Direct probes against `trailhead-valhalla-us` passed for:
  - Seattle -> Spokane
  - Portland -> Eugene
  - Seattle -> Boise
  - Boise -> Missoula
  - Salt Lake City -> Denver
  - Phoenix -> Albuquerque
  - Cheyenne -> Denver
  - Moab -> Big Sur
  - Las Vegas -> Moab
  - San Francisco -> Los Angeles

East-safe build:

- Repurposed old crashed `trailhead-valhalla-west` service as the East builder so `trailhead-valhalla-us` can keep serving production.
- Cleared stale/broken CA volume files after the first redeploy crashed on `california-latest.osm.pbf` with `PBF error: unexpected EOF`.
- Initial 15-state East build with `ME,NH,VT,MA,RI,CT,NY,NJ,PA,DE,MD,VA,WV,NC,SC` repeatedly failed during tile generation:
  - failing tile: `2/754983/0`
  - error: `vector::_M_range_check`
  - approximate tile area: lower Hudson / NY-NJ-CT
- Removed `NY`, `NJ`, and `CT` from this build to avoid the deterministic Valhalla tile crash.
- Final `trailhead-valhalla-west` `tile_urls` are:
  - ME, NH, VT, MA, RI, PA, DE, MD, VA, WV, NC, SC
- Build completed successfully:
  - `valhalla_tiles.tar` created
  - tile extract loaded with `1525` tiles
  - `valhalla_tiles.tar` size is about `3.5G`
  - volume size after cleanup is about `5.6G`
- Supporting variables on `trailhead-valhalla-west`:
  - `force_rebuild=False`
  - `build_admins=False`
  - `build_time_zones=False`
  - `server_threads=2`
- Validation from inside the Railway container passed:
  - `/status` healthy, Valhalla `3.5.1-49b40b7f2`, `route` action available
  - Boston -> Portland, ME: `106.7 mi`
  - Philadelphia -> Pittsburgh: `305.3 mi`
  - Washington, DC -> Richmond: `107.1 mi`
  - Asheville -> Charleston: `267.5 mi`
- Restart after setting `force_rebuild=False` loaded the completed tile extract directly and did not rebuild.
- Do not switch production API to this service as a replacement for expanded West. Backend currently has a single `VALHALLA_URL`; using West plus East together needs either area-aware backend routing or a later combined artifact.
- Combined `NY,NJ,CT` still needs a separate fix; do not retry that same separate-PBF multi-state build blindly.

Lower-Hudson follow-up:

- Used `trailhead-valhalla` as an isolated lower-Hudson test service with volume `trailhead-valhalla-volume` at `/custom_files`.
- Railway could not download directly from Geofabrik inside the Valhalla service, so the three dated PBFs were downloaded locally, uploaded to R2, then copied into the volume through `valhalla-volume-helper-nginx`.
- The direct three-state local-file build `CT,NJ,NY` still reproduced the same crash:
  - failing tile: `2/754983/0`
  - error: `vector::_M_range_check: __n (which is 0) >= this->size() (which is 0)`
- Individual state builds all succeeded:
  - `NY` only: built `353` tiles, saved artifact as `/custom_files/ny-valhalla_tiles.tar`, validated NYC -> Albany and Buffalo -> Rochester.
  - `NJ` only: built `67` tiles, saved artifact as `/custom_files/nj-valhalla_tiles.tar`, validated Newark -> Camden.
  - `CT` only: built `55` tiles, active artifact remains `/custom_files/valhalla_tiles.tar` and was also copied to `/custom_files/ct-valhalla_tiles.tar`, validated Hartford -> New Haven.
- `trailhead-valhalla` is currently a Connecticut-only test service with:
  - `force_rebuild=False`
  - `use_tiles_ignore_pbf=True`
  - `build_admins=False`
  - `build_time_zones=False`
  - `server_threads=2`
- Conclusion: `NY`, `NJ`, and `CT` are individually buildable; the deterministic failure is in combining those separate extracts. Next lower-Hudson attempt should try a merged PBF or separate area routing services, not the same multi-PBF `CT,NJ,NY` build.

Next area builds:

- Do not start a full-US graph again until area services are stable.
- Suggested next candidate areas:
  - South: `TX,OK,AR,LA,MS,AL,GA,FL,TN,KY`
  - Midwest/Central: `ND,SD,NE,KS,MN,IA,MO,WI,IL,IN,MI,OH`

## Route Builder / Auth Product Rules

- Keep Google auth hidden until the Google OAuth client, redirect URI, and mobile callback have been configured and tested. Apple Sign In is the active social sign-in path.
- Route Builder needs to distinguish true loops from there-and-back returns. A there-and-back mode should reuse the outbound path and camps instead of pretending to discover a new loop.
- Basecamp trips are first-class: users may stay at the same camp for multiple days and build day excursions from it.
- Side-trip/excursion cards must come from real sources and keep source labels visible: Trailhead/community, OSM/OpenStreetMap, NPS, BLM, Wikipedia, Recreation.gov/RIDB, and other official land-manager feeds where available.
- Excursion scans must stay route-aware/radius-aware. Do not let national Explore catalog entries leak into local map scans unless they are within the requested radius or near supplied route points.

## Offline Contour Pipeline Rollout Pause

Date/context:

- May 15, 2026.
- User wanted the owned contour pipeline expanded, then asked to find a good stopping point for the night after New York state and make sure the next session can resume cleanly.

What was built/deployed:

- Added owned Copernicus DEM contour tooling:
  - `scripts/build_contours_from_dem.py`
  - `scripts/publish_contour_packs.py`
  - `scripts/start_dem_contour_queue.py`
  - `docs/offline-contour-pipeline.md`
- Railway/Nixpacks now includes `gdal` and `tippecanoe`.
- `dashboard/server.py` has admin contour endpoints:
  - `GET /api/admin/contour-packs-status`
  - `POST /api/admin/build-contour-pack/{code}`
  - `POST /api/admin/build-contour-batch`
- Batch endpoint runs one region at a time with an in-process lock and can skip already-published packs by reading `https://tiles.gettrailhead.app/api/contours/manifest.json`.
- Latest Railway deployment used to stop the queue cleanly after NY:
  - `1130fee1-0b4b-4e7b-88ed-282245410dec`

Published contour packs verified in the live manifest:

- US/state: `co`, `ks`, `ri`, `de`, `ct`, `ma`, `nh`, `vt`, `me`, `nj`, `pa`, `md`, `ny`
- Country: `fi`
- Notable sizes:
  - `ny.pmtiles` 763,666,742 bytes
  - `fi.pmtiles` 701,976,377 bytes
  - `pa.pmtiles` 380,827,469 bytes
  - `me.pmtiles` 272,358,533 bytes

Nightly stopping point:

- Queue is intentionally stopped/idle after New York published.
- West Virginia briefly started after NY because the batch auto-advanced, but the service was restarted before WV got far; there is no published `wv.pmtiles`.
- Live status after restart showed:
  - `queue.status = idle`
  - `jobs = {}`
  - local `/data/contours` includes `ny.pmtiles` and earlier published packs.

How to resume:

- In `/home/sean/.openclaw/workspace/trailhead`, first check:
  - `curl -s 'https://trailhead-production-2049.up.railway.app/api/admin/contour-packs-status'`
  - `curl -s 'https://tiles.gettrailhead.app/api/contours/manifest.json'`
- Resume the remaining east batch with:
  - `curl -s -X POST 'https://trailhead-production-2049.up.railway.app/api/admin/build-contour-batch' -H 'Content-Type: application/json' -d '{"preset":"east","skip_published":true,"force":false,"continue_on_error":true}'`
- Because `skip_published=true`, the batch should skip `md` and `ny` and resume at `wv`, then continue:
  - `wv`, `va`, `oh`, `nc`, `sc`, `ga`, `fl`, `tn`, `ky`, `al`, `ms`, `la`, `ar`, `mo`, `il`, `in`, `mi`, `wi`, `ia`, `mn`
- After east finishes, run `central`, then `west`. Do not start Mexico/Canada until the US state queue is stable.

Device test checklist:

- Install build `f86353f5-8bd6-49c9-a3df-2640e568e233`.
- Open Offline Downloads for a state with a trail pack already on device; it should show `TRAILS ON DEVICE` without redownloading the PMTiles.
- Open the map in that state; trail systems should render from the local trail overlay.
- Tap/select a trail line, confirm the trail sheet opens, then start follow mode and verify it uses the downloaded trail graph instead of failing as unavailable.

## Latest Navigation And Contour OTA

Native iOS navigation module preview build:

- EAS iOS preview build: `6ec43653-e838-495c-a23f-265d77f53b0e`
- Install link: `https://expo.dev/accounts/danub44/projects/trailhead/builds/6ec43653-e838-495c-a23f-265d77f53b0e`
- Canceled superseded build: `d577083c-0487-403e-a852-5fa1195a14a2`

Context:

- User confirmed every OTA nav patch still left navigation broken. Camera froze, app/nav buttons did not work, and the old blue dot/compass follow behavior stopped working.
- Stop trying OTA touch-layer/camera patches for this generation of the nav stack.

What changed in this preview binary:

- Added `TrailheadNavigationModule` to the existing `expo-valhalla-routing` native package and registered it in `expo-module.config.json`.
- Added `TrailheadNavigationEngine.swift`, which owns an iOS native nav session:
  - route geometry ingestion,
  - route cumulative distance,
  - GPS projection onto route segments,
  - remaining route distance,
  - deviation/off-route warning state,
  - follow/free-pan state snapshots,
  - native event emission through `onNavigationState`.
- JS wrapper in `mobile/modules/valhalla-routing/src/index.ts` now exposes:
  - `hasNativeNavigationEngine`,
  - `startNavigationSession`,
  - `stopNavigationSession`,
  - `setNavigationFollow`,
  - `updateNavigationLocation`,
  - `addNavigationStateListener`.
- `map.tsx` uses the native nav engine on iOS only. Android/web stay on the old path for now.
- NativeMap's old internal route-progress/off-route loop is disabled when the iOS native nav engine is active.
- MapLibre camera follow now uses built-in native `Camera` user tracking (`followUserLocation`, course/heading mode, follow zoom/pitch) instead of repeated JS `setCamera` calls.
- Map gestures remain enabled during nav; user gesture disables follow, and the nav locate button re-enables follow.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

## Route Engine Design And Expanded Figma Screens

User asked to point Figma at more areas before another OTA:

- AI planning
- Profile screen
- Map layers/buttons functionality
- Route engine design

Figma:

- Re-loaded `figma-use` and `figma-generate-design`.
- Figma account was upgraded to Pro / Full seat.
- Added a new `Trailhead Expanded Screens` page to `Trailhead Product Design System`:
  - `AI Planning / Trail DNA Chat`
  - `Profile / My Rig + Trips`
  - `Map Layers / Buttons Functionality`
  - `Route Engine / Decision Model`
  - `Route Candidate Cards / Camp Fuel POI`
  - `Route Failure / No Drawable Route`
  - `Route Rebalance Warning`
  - `Route Briefing / Readiness`
- Figma metadata returned the expected page and eight frame structure.
- Figma screenshot render succeeded for the expanded page.

Docs:

- Added `docs/trailhead-route-engine-design.md`.
- Updated `docs/trailhead-product-design-direction.md` with the expanded Figma page and validation status.

Route engine code change:

- `dashboard/route_enrichment.py` now annotates enriched camps, fuel stops, and POIs with route-position metadata:
  - `route_progress`
  - `route_progress_mi`
  - `route_segment_index`
- Existing `route_distance_mi`, `route_fit`, and `recommended_day` behavior is preserved.
- `mobile/lib/api.ts` types now include these fields on camps, camp pins, gas stations, and OSM POIs.

Why it matters:

- Server-enriched trip cards can now support the same early/mid/late leg labels as Route Builder's local leg search.
- The product route engine contract is explicit: intent → geometry → day anchors → durable stops → verified enrichment → navigation session.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `python3 -m py_compile dashboard/route_enrichment.py ai/planner.py` passed.
- `git diff --check` passed.

No OTA was pushed.
- EAS iOS preview build completed successfully.

Navigation camera-control rebuild OTA pushed:

- Production update group: `27bc8e95-6abe-421d-acb5-dfd11bac6c82`
- Preview update group: `82149e77-efb8-4e21-beb3-64b0e273c955`
- Message: `Rebuild navigation camera controls`

Context:

- Treat all previous "fixed" nav notes as attempted fixes only. User confirmed navigation is still broken: starting nav freezes camera, nav buttons do not work, and app buttons do not respond.
- Claude memory file `/home/sean/.claude/projects/-home-sean/memory/trailhead_maplibre_nav_patterns.md` contains contradictory findings. Do not trust any statement there that says navigation is fixed.

What changed:

- Native map gestures now stay enabled during navigation (`scrollEnabled`, `zoomEnabled`, `rotateEnabled`, `pitchEnabled` are no longer disabled by `navMode`).
- Removed leftover NativeMap overlay-children path from the previous attempt; nav HUD remains a normal sibling outside `NativeMap`.
- Replaced forced camera behavior with explicit `navCameraFollow` state:
  - starting nav / tapping locate enables follow,
  - user map gesture disables follow,
  - route progress, reroute, and off-route math continue independently.
- Native GPS-follow camera updates now use zero-duration camera updates and are rate-limited, avoiding repeated animated `setCamera` calls that can lock iOS MapLibre touch handling.
- The nav locate/follow button is visible during nav because the normal map controls are hidden during nav.
- Fixed typed Expo Router literals from `/(tabs)/` to `/(tabs)` after Expo web regenerated route types.

Research basis:

- MapLibre RN `MapView` exposes `scrollEnabled`, `zoomEnabled`, `rotateEnabled`, `pitchEnabled`, `onRegionWillChange`, and `RegionPayload.isUserInteraction`.
- Mapbox Navigation SDK camera docs model navigation camera as explicit states such as following, overview, and idle; this matches the Trailhead follow/free-pan/locate requirement.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.
- Playwright web shell opened at `http://localhost:8090`; page loaded with no console errors, only RN-web warnings. Screenshot saved to `output/playwright/nav-foundation-web.png`.
- Important: Playwright web cannot prove the iOS native MapLibre touch bug. TestFlight validation is still required.

Navigation native-map overlay OTA pushed:

- Production update group: `1bfcd249-4f5a-4217-8ce5-85179dbcf2ca`
- Preview update group: `b1287635-66a4-4268-b1f0-8d2cea2920ae`
- Message: `Move navigation panel into native map overlay`

What changed:

- `NativeMap` now accepts overlay children and renders them inside the native map root after `MapLibreGL.MapView` and the debug overlay.
- The live navigation panel is now passed into `NativeMap` as an in-map overlay, so it sits in the same native view stack as the map instead of being a parent sibling fighting MapLibre touch arbitration.
- The old parent-level navigation HUD is kept only for the WebView fallback path.
- Gesture Handler `Pressable` controls and `focusNavigationCamera()` remain in place.

Why:

- The previous OTA was still too reactive. Code inspection showed the native map component owns a full-screen root and its own overlays, so the navigation HUD needed to live inside that root to make the touch/view hierarchy coherent on iOS.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

Navigation gesture-control OTA pushed:

- Production update group: `4da130b8-d8fd-458d-8967-ff442e8db694`
- Preview update group: `5ffa06e8-fe25-4d84-b485-86d3e100ae82`
- Message: `Use gesture controls for navigation panel`

What changed:

- Wrapped the app in `GestureHandlerRootView`.
- Switched nav panel buttons (`END`, `TURNS`, `REROUTE`, `REPORT`) to `react-native-gesture-handler` `Pressable`.
- Kept the nav panel as a plain conditional `View`, not a transformed/animated touch container.
- Raised the nav panel above native map overlays with high `zIndex`/`elevation`.
- Added `focusNavigationCamera()` and call it on nav start with an immediate and delayed camera command, so the map should snap to user location even when route/map state is busy.

Research basis:

- React Native `View.pointerEvents` docs: `box-none` allows children to receive touches while the parent is not the target.
- React Native `Pressable` docs: `hitSlop` expands the hit target and press retention for fingers.
- MapLibre React Native docs/issues show native map/annotation touch handling can differ by platform; app overlay controls should be normal React Native siblings above the map rather than marker/annotation touchables.
- Gesture Handler `Pressable` is commonly used when core touchables fight scroll/map/native gesture responders.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

Navigation panel stabilization OTA pushed:

- Production update group: `fe60da3f-b4d6-45d4-b0d1-868a75566a20`
- Preview update group: `266e5173-ae77-4b61-b7bb-5b3bab7c7188`
- Message: `Stabilize navigation panel controls`

What changed:

- Replaced the transformed `Animated.View` nav touch container with a plain conditional `View`.
- Removed the separate forced/fallback action rail.
- The nav panel now only exists while `navMode` is true, and owns normal touch handling.
- This should avoid invisible/transformed hitbox bugs while keeping the panel feeling like a real navigation panel.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

Navigation HUD touch-layer hotfix OTA pushed:

- Production update group: `ba961d91-390c-4466-b4cf-1d25f2848352`
- Preview update group: `c895d660-cb5e-43e9-9be8-accee86bfa75`
- Message: `Fix navigation HUD touch layer`

What changed:

- Fixed `pointerEvents` usage on the nav HUD and map controls. It was incorrectly inside style objects, which React Native ignores.
- Hidden map controls now actually stop receiving touches during navigation.
- Nav HUD now has explicit `zIndex`/`elevation` so END/REROUTE/TURNS sit above the map.
- Added a fallback "Route active / Waiting for route details" nav row so the END button remains visible even if route steps/target are missing during startup.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

Navigation restart hotfix OTA pushed:

- Production update group: `50153069-de3a-4e8e-94d4-87b0fe8e7fcc`
- Preview update group: `bd57bc4d-2577-49d4-bacf-70180e7dd4b4`
- Message: `Fix navigation restart after ending route`

What changed:

- Red END now uses a dedicated `endNavigation()` cleanup path.
- Ending trip navigation no longer destroys the trip route geometry; it clears nav target, breadcrumb, off-route/reroute state, speech, and timers.
- Single-destination navigation still clears the temporary route/search route on end.
- NativeMap now has `stopNavigation()` to clear nav overlays without clearing the route.
- Removed the expensive full-route HUD fallback scan that could run every GPS tick on long routes after restart.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

Navigation route-progress OTA pushed:

- Production update group: `1a0c8f77-5507-457e-a372-247b37374fd9`
- Preview update group: `f90b8068-d52c-4bdb-bfe0-3a559ba0005f`
- Message: `Improve navigation route progress math`

What changed:

- Native route tracking now projects GPS onto the nearest route segment instead of nearest route vertex.
- WebView fallback route tracking uses the same segment projection logic.
- Passed-route dimming includes the projected point for smoother progress instead of jumping vertex-to-vertex.
- Native route progress reports remaining route metres, total route metres, current deviation, and segment index.
- HUD remaining miles now prefers route-geometry remaining distance instead of straight-line waypoint distance.
- Maneuver countdown and step advancement now prefer route progress to the maneuver point when route geometry is available.
- Off-route detection uses segment distance and speed/accuracy-aware thresholds in native, with less aggressive WebView fallback thresholds.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

Navigation/contour OTA pushed:

- Production update group: `31aa3ed7-5731-4220-83cf-c9d3870d7c45`
- Preview update group: `0363e372-97f6-4c65-8150-639edd7cdd82`
- Message: `Fix native navigation reroute and contour downloads`
- Cloudflare Worker version: `b7d7d63a-3c76-4c55-9984-4707d48bff64`

What changed:

- Native off-route events now call the native map reroute path directly instead of only posting to the WebView bridge.
- Native route cache matching now validates the saved route start, preventing stale cached routes from a different origin.
- Native camera follow no longer applies heading/pitch while stopped or crawling, reducing low-speed jitter.
- Cloudflare Worker now serves `/api/contours/manifest.json` and `/api/contours/{region}.pmtiles` with range support.
- Added `scripts/extract_contours_pmtiles.py` for contour-only PMTiles extraction from OSM US `contours-feet` vector tiles.
- Generated and uploaded a Kansas contour proof pack: `data/contours/ks.pmtiles`, 1,486,521 bytes, z8-z10.

Verified:

- Public manifest returns `{ "ks.pmtiles": { "size": 1486521 } }`.
- Public PMTiles endpoint responds at `https://tiles.gettrailhead.app/api/contours/ks.pmtiles` with `200`, `Accept-Ranges: bytes`, and `Content-Length: 1486521`.
- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `python3 -m py_compile dashboard/server.py ai/planner.py scripts/extract_contours_pmtiles.py` passed.
- `git diff --check` passed.

Navigation audit notes:

- Best-practice navigation should separate raw GPS, filtered location, and navigation/snapped location.
- Use GPS course while moving and avoid compass/heading rotation below roughly walking speed.
- Off-route detection should move toward segment projection plus accuracy/speed gates; current pass fixed the native reroute no-op first.
- Distance/ETA/maneuver names should increasingly derive from route geometry and provider maneuvers, not straight-line waypoint math.
- Fuel planning should remain reserve-aware and pessimistic, with future work to dedupe/normalize gas markers.

## Latest Map Filter Persistence OTA

Offline download redesign OTA pushed:

- Production update group: `8a344e7d-4b47-4407-a1f9-a4017723da41`
- Preview update group: `e0d05962-9df3-4746-a950-6e639f5f822d`
- Message: `Redesign offline region downloads`
- Backend deployed with Railway after adding the `state_contours` offline asset type.

What changed:

- Offline Regions no longer use one long mixed horizontal list.
- Canada and Mexico are surfaced at the top as dedicated cross-border cards.
- U.S. states are grouped into West, Central, Southeast, and Northeast/Midwest sections.
- Region cards show map, routing, contour/topo, and places readiness in one glance.
- Added a separate contour/topo download lane in the offline region model and UI.
- Contours are intentionally separate from base map packs, using `/api/contours/{region}.pmtiles` plus `/api/contours/manifest.json`.
- Contour buttons stay as planned/unavailable until actual contour PMTiles are published, so this OTA prepares the UX without bloating current base maps.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `python3 -m py_compile dashboard/server.py ai/planner.py` passed.
- `git diff --check` passed.

Topo direction:

- Start with vector contour-only PMTiles per state/country, not hillshade/DEM.
- Keep base map packs lean; users can add/remove contours independently.
- Good first target is major/index contours plus minor contours and labels at higher zoom.

Trip overview gesture OTA pushed:

- Production update group: `2be8f6a5-9f02-4d62-aae2-0e09a905feba`
- Preview update group: `16038e87-457e-42e2-bdac-23f3ac01a0cb`
- Message: `Fix trip overview swipe gestures`

Follow-up change:

- Moved trip overview pan responders from `TouchableOpacity` onto plain `View` grab areas so iOS/RN does not treat the interaction as tap-only.
- Added responder capture, lowered the drag threshold, and prevented responder termination while dragging the sheet handle/peek.

Previous OTA:

- Production update group: `758181f4-cac8-40a8-905d-8e2d7d77f12a`
- Preview update group: `35ed69d8-91e7-4252-8943-b8057bf827a0`
- Message: `Improve trip overview sheet gestures`

What changed:

- Map trip overview collapsed peek can be tapped or swiped up to expand.
- Expanded trip overview handle can be tapped or swiped down to collapse.
- Removed the redundant chevron collapse button from the expanded overview header.
- Enlarged the visible grabber area so the existing sheet tab is the interaction target.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

Follow-up OTA pushed:

- Production update group: `d0d129aa-9d6b-4dec-ab58-ed5f42000e84`
- Preview update group: `f3cdb188-5118-4128-9ab6-ce921ce26fb0`
- Message: `Clarify map filters and widen camp search`

What changed:

- Community pin filters now behave like downloaded place filters: selected chips are the visible pin types.
- Default community pins are explicit selected chips, with GPX imports still hidden unless selected.
- Camps remain a search-narrowing filter because campsite type chips are constraints, not visibility layers; the sheet now says that directly.
- The filter sheet count now shows changed filter groups instead of counting every default community chip as active.
- The Search This Area button now only advertises camp filters when camp filters are actually selected.
- Freecam campsite search can run one zoom level farther out and uses a wider capped search radius.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `python3 -m py_compile dashboard/server.py ai/planner.py` passed.
- `git diff --check` passed.

OTA pushed:

- Production update group: `22169e31-16da-4c22-9492-88c14a800495`
- Preview update group: `510ae485-dd99-4103-b00f-5f7a4d7d7f40`
- Message: `Persist map filter preferences`

What changed:

- Map filter preferences now persist on-device across app closes/reopens.
- Saved preferences include map mode (`topo`/`hybrid`/`satellite`), camp filters, downloaded place filters, community pin filters, public land/USGS/POI overlays, and condition layers.
- Filter sheet now says preferences are saved on this device.
- Added `RESET ALL` in the filter sheet to return to the calm default filter setup.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `python3 -m py_compile dashboard/server.py ai/planner.py` passed.
- `git diff --check` passed.

## Latest App Audit / Polish Pass

OTA pushed:

- Production update group: `e27db777-2f30-445a-a3a6-0f08cfcda2da`
- Preview update group: `5beff0e2-d670-4552-bb0f-5906f7a0d22e`
- Message: `App audit polish and geocode fix`
- Backend deployed with Railway build `d5954189-e64a-4c4e-ac89-a4de0eed1df3`.

What changed:

- Fixed backend `/api/geocode` route-builder destination search bug by replacing `httpx.utils.quote` with standard `urllib.parse.quote`.
- Verified live geocode endpoint after deploy: `GET /api/geocode?q=Moab&limit=1` returned Moab coordinates.
- Removed negative `letterSpacing` from main Plan/Profile/Route/Map text styles for cleaner iOS rendering and fewer squeezed headings.
- Polished Route Builder insert helper copy so it no longer cuts off as easily.
- Fixed web Route Builder map preview empty state: no more fake diagonal orange route line before the user adds route stops; it now shows an intentional "Build the base route" prompt.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `python3 -m py_compile dashboard/server.py ai/planner.py` passed.
- `git diff --check` passed.
- `npx expo export --platform web --output-dir dist-app-audit-polish-2` passed.
- Playwright opened the exported app, dismissed onboarding, opened Route Builder, and screenshot-verified the empty map preview.
- Railway logs after deploy showed clean startup and no matching error logs for the checked filter.

## Latest Explorer/TestFlight Restore Fix

OTA pushed:

- Production update group: `b0ad04a3-e443-438e-9a15-c148a66a9103`
- Preview update group: `91ffd09b-8dce-4fa8-8910-f41cb266608a`
- Message: `Fix TestFlight Explorer restore`
- Backend deployed with Railway build `780daf8f-f3f1-4b2d-b534-78c7e38e4233`.

What changed:

- Apple StoreKit/TestFlight can report "already subscribed" while Trailhead plan state is inactive if activation was interrupted or an existing Apple transaction row did not reactivate the account.
- Mobile now persists active Explorer entitlement locally in `trailhead_plan`, clears it on logout/expiry, and restores it on cold launch.
- Purchase activation now stores a pending IAP transaction before calling the backend, keeps local Explorer active if the backend call fails, and clears the pending transaction only after backend activation/status succeeds.
- Startup subscription sync retries `trailhead_iap_pending` activation if the backend reports inactive.
- Backend `/api/subscription/activate` now rejects blank Apple transaction IDs and reactivates the user's plan when a transaction ID already exists but the user no longer has an active plan. The app is using Apple IAP here, not Stripe checkout; the legacy `stripe_purchases` table is only being reused as the transaction idempotency ledger.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `python3 -m py_compile dashboard/server.py` passed.
- `git diff --check` passed before this memory entry.

## Latest Route Builder Redesign Pass

Latest Dyrt-inspired OTA pushed:

- Production update group: `d86bbd1b-463c-4b52-a21c-e90c40a62b3a`
- Preview update group: `4c5b627c-ff36-4515-b52f-36796fe4fea4`
- Message: `Fix route briefing and map overview peek`

What changed:

- Route Brief on the Map tab now normalizes backend AI responses and replaces blank/`unknown` fallback fields with a useful local route briefing derived from the saved trip.
- If the AI route brief call fails for non-paywall reasons, the user still gets a practical in-app route briefing instead of a broken/empty modal.
- The Map trip overview is now collapsible into a short visible bottom peek with the trip title and handle, so users can inspect/pan the map and still know the overview can be pulled back up.
- Opening a new active trip resets the overview to expanded; entering navigation still hides the overview.

Verification:

- `npx tsc --noEmit`, `git diff --check`, and `npx expo export --platform web --output-dir dist-routebrief-panel-fix` passed.

Previous Dyrt-inspired OTA:

- Production update group: `1f739f12-acb3-4bb7-bb03-85c00f231740`
- Preview update group: `fa7fa8ac-4d3d-4d7f-ba70-437328b24d43`
- Message: `Fix route builder loops and camp placement`

What changed:

- Loop route framework no longer rebalances future generated targets after selecting the first camp. This fixes the bug where Day 2/3 collapsed into tiny same-area hops after a camp choice.
- Wild/adventure base routes now create curved scenic day anchors instead of straight interpolation; loop routes use opposite offsets on outbound vs return legs so the return path is not the exact same line back.
- Camp/fuel/place inline search results render directly under the selected overview day card after a base route exists, instead of appearing far below in the active itinerary area.
- Selected camp pins are fed back into the mini map camp layer, so the mini map summary stays consistent after the search drawer closes.

Verification:

- Playwright static web pass built San Jose, CA to Big Sur, CA as a 6-day Wild Round route.
- Verified Day 2 camp search opened directly below Day 2.
- Verified selecting `PINNACLES CAMPGROUND` kept the camp card under Day 2, changed Day 3 to start from that camp, and kept both mini map and footer camp counts at 1.
- `npx tsc --noEmit`, `git diff --check`, and `npx expo export --platform web --output-dir dist-routebuilder-current2` passed.

Previous Dyrt-inspired OTA:

Backend-only deploy after user reported 14-day Kansas-to-Moab route took ~3 minutes then failed:

- Railway deploy started successfully and logs showed app startup complete.
- Long/complex trips now skip the blocking Sonnet judge pass after the fast draft.
- 10+ day trips or plans with 28+ waypoints now return the normalized fast draft instead of waiting on the heavier judge.
- Long trips now cap geocoding at 25s and enrichment at 10s; if those layers time out, the usable AI route still returns with empty/partial camps, gas, or POIs instead of failing.
- Rationale: users should see a usable route quickly, then refine/select verified camps/fuel in Route Builder instead of waiting several minutes for all enrichment to finish.

Previous Dyrt-inspired OTA:

- Production update group: `e01ec974-5f53-44f2-88f2-4519c0047fad`
- Preview update group: `0cdb53bd-1f2f-4587-bce8-9be3a8ddc5e8`
- Message: `Show retry button for failed AI route builds`

What changed:

- Fixed Plan chat failed-build UX: all route build failures that say retry now render the actual `RETRY` action card instead of only a plain chat bubble.
- Retry card copy now says `ROUTE NEEDS ANOTHER PASS` and explains it will rebuild from the same conversation.

Previous Dyrt-inspired OTA:

- Production update group: `4a904960-b27a-4936-a4f4-0dc4677ee333`
- Preview update group: `694c8cde-4e8f-4546-98ee-e424cdd0f395`
- Message: `AI planning polish and long route hardening`

Backend deployed with Railway after this OTA.

What changed:

- Mobile AI chat/planning thinking messages now sound more like a calm Trailhead guide and less like generic loading text.
- Mobile planning failure copy no longer says "Planning hit a snag"; retry guidance is more natural.
- Planner output is normalized before downstream processing so long routes with messy JSON fields are less likely to fail.
- Plan jobs now return the usable AI trip even if geocoding or route enrichment has a timeout/error; camps/gas/POIs can be empty instead of failing the entire plan.
- Product direction: Claude is not "trained" in-app by changing model weights. Trailhead should teach it via durable Trail DNA, rig profile, saved preferences, curated overland knowledge, and retrieval/tool context.

Previous Dyrt-inspired OTA:

- Production update group: `39746915-b618-4ee2-a0aa-71c2146cac0f`
- Preview update group: `1cb4a94a-4e4c-4e72-8d6d-4d7406cd77ea`
- Message: `Route builder cleanup and saved trip controls`

What changed:

- Removed the duplicate old `ROUTE PLAN` day list and bottom `DISCOVER NEAR ROUTE` scanner from Route Builder.
- Route Builder now keeps the single active `DAY N ITINERARY` section as the main editing surface; leg search results render inline inside that day.
- Profile `MY TRIPS` rows now have a delete button that removes the trip from local history and offline cache.
- Active trips no longer restore automatically after a cold app restart; they stay for the current app session and come back only when opened from Profile saved trips.

Previous Dyrt-inspired OTA:

- Production update group: `21c372ff-9f17-4f68-a35b-027a1cd99a6a`
- Preview update group: `b9518d99-4cb2-4c93-b916-6a6b60cc2004`
- Message: `Route builder planning anchor navigation fix`

Previous Dyrt-inspired OTA:

- Production update group: `a7d3db68-c7c1-4340-aa91-93d3738598c7`
- Preview update group: `e42d00b8-f88d-4b6b-92d4-86a91fceb6a0`
- Message: `Route builder fuel and place leg search fixes`

What changed in latest follow-up:

- Generated purple `Day N target area` pins are now treated as planning anchors only, not saved GPS destinations.
- New Route Builder saves `plan.waypoints` from real stops only, so selected camps/fuel/POIs/final destination define the navigation legs.
- Map navigation defensively filters legacy saved target-area waypoints, so old routes do not route to random generated purple pins.
- Picking a camp from the Map camp picker replaces that day's planning target if one exists, instead of inserting a camp after it.
- Wizard now has an explicit `START` input plus a `CURRENT` button, so users can choose start location/current location before destination/days/max-hours.
- Selected camps now stay embedded under the matching day in the `ROUTE PLAN` as a persistent `OVERNIGHT CAMP` visual card with photo/placeholder, metadata, and swap action.
- Fuel/place rows selected into a day also show as compact visual pills under that day in route order.
- Day card fuel search now merges backend gas, OSM fuel/propane, offline place-pack fuel/propane, and bounded Nominatim fallback around route sample points.
- Day card places search now uses broader route POI types plus offline place packs and bounded Nominatim fallback.
- Playwright verified Denver, CO to Flagstaff, AZ 5-day route:
  - Day 2 fuel returned 8 inline fuel stops.
  - Day 2 places returned 17 inline places.
  - Selecting a camp keeps the camp visible under the day card.

Previous Dyrt-inspired OTA:

- Production update group: `5f361dc5-fab5-4997-8694-5b66bd196af4`
- Message: `Route builder wizard start and camp cards`

Previous Dyrt-inspired OTA:

- Production update group: `7076f74e-e623-4a80-ad65-fd1d299563ad`
- Preview update group: `87ed0b8f-569d-4857-b557-a6d6d9fd218b`
- Message: `Route builder daily drive max wording`

Previous Dyrt-inspired OTA:

- Production update group: `1e964105-27b4-48bf-849a-e01820168a70`
- Preview update group: `6045a0ce-725f-4d5e-846e-6d1bcfe834df`
- Message: `Route builder Dyrt-style base route redesign`

What changed in the Dyrt-inspired pass:

- Reviewed 14 user-supplied Dyrt screenshots from `/tmp` covering trip setup, hours/distance pacing, route preferences, vehicle/MPG details, loading/success states, map overview, and day-by-day itinerary cards.
- Route Builder top flow now has a base-route builder card: Recommended Trip vs Blank Trip, destination, days, max hours/day or miles/stop, Balanced/Direct/Wild trip shape, Hours/Miles pace controls, route stats, and primary build/rebuild CTA.
- Building a route now shows a success modal summarizing miles, hours, and days before users explore the route.
- Recommended mode creates generated day target areas between start and destination; Blank mode leaves the route ready for hand-building.
- Distance mode can derive the day count from target miles between stops.
- The map trip overview day chips and start-day modal now use the same previous-camp/start-to-finish logic as the vertical timeline, avoiding confusing labels after a target is replaced with a camp.
- Follow-up clarification applied: UI copy now says daily drive `max`/`cap` instead of `target` where the user is setting preferred hours.

Verification:

- Built Denver, CO to Flagstaff, AZ as a 5-day trip in Playwright web preview.
- Verified the base route success modal opened.
- Verified Day 2 `CAMPS` opened candidates inline directly under Day 2.
- Verified selecting `USE` collapsed the candidate drawer and replaced Day 2 target with `AMPHITHEATER (CO)`.
- Verified `SAVE & OPEN` reached the Map tab trip overview and rendered the route timeline.
- Console noise observed in web preview: missing favicon, React Native web animation fallback, AAA gas-price CORS fallback, and unauthenticated route guide `401`; none blocked the tested route-builder flow.

Verification commands passed:

```bash
cd mobile
npx tsc --noEmit
git diff --check
npx expo export --platform web --output-dir dist-routebuilder-dyrt-pass
```

Latest OTA pushed:

- Production update group: `3e75844d-6cf5-4266-92c1-eb268d85cf6f`
- Preview update group: `2a461205-f5ec-43c3-be6a-42339584ae8a`
- Message: `Route builder inline itinerary redesign`

What changed:

- Route Builder day-card actions now open inline result drawers directly under the selected day.
- Day camp searches auto-run and show options such as `Choose an overnight near Day 2 endpoint`.
- Selecting `USE` closes the inline results and replaces that day target with the chosen camp.
- Later generated day targets rebalance from the newly selected camp, so the next day starts from the camp.
- Fuel/place day searches use the same inline drawer pattern, including empty states under the selected day.
- Shared `DISCOVER NEAR ROUTE` no longer becomes the hidden place users must scroll to; it points back to the active day drawer while inline results are open.
- Route Builder map auto-fit now only runs on initial map readiness, and inline day searches avoid forcing the map focus, reducing unwanted zoom snap-back.
- Map trip overview was redesigned into a vertical route timeline: start location, drive leg mileage, fuel/POI rows when present, camp/finish row with photo/placeholder, then the next day starts from the previous camp.
- Added `mobile/components/NativeMap/offlineManager.web.ts` so Expo web can render the Map tab without importing native MapLibre offline manager code.

Playwright verification:

- Built route: Denver, CO to Flagstaff, AZ, 5 days.
- Verified Day 2 camp search opened inline under Day 2 with 41 camp candidates.
- Verified selecting a Day 2 camp closed the candidate drawer and changed Day 2 to `Day 1 target area to AMPHITHEATER (CO)`.
- Verified Day 3 then started from `AMPHITHEATER (CO)`, opened inline camp candidates, and selecting `MCPHEE RECREATION COMPLEX` changed Day 4 to start from that camp.
- Verified a Day 4 places search opened inline under Day 4 with an empty-state result.
- Fixed the previous Expo web Map blank-screen crash; `SAVE & OPEN` now reaches `/map` and renders the new `ROUTE TIMELINE`.

Verification commands passed:

```bash
cd mobile
npx tsc --noEmit
git diff --check
npx expo export --platform web --output-dir dist-routebuilder-redesign-test-2
```

## Important Recent Work

Latest OTA pushed:

- Production update group: `24469ec6-67b9-40c5-a2fd-ef9d16e40ddb`
- Preview update group: `318f534b-7a28-469c-8b2d-3492afcbd12d`
- Message: `Route builder visual pass fixes`

Previous OTA from same session:

- Production update group: `1b6d6cce-fde2-406f-8fc8-98ea07db4cf9`
- Preview update group: `5ba21656-1c5f-4419-a022-0b22de7ecaab`
- Message: `Route builder route plan polish`

Earlier OTA:

- Production update group: `c180f453-76ef-432e-b00b-6cddaa196a86`
- Preview update group: `a7052c92-021f-40ba-aeb8-5c2be4490c59`
- Message: `Route builder leg search and day balancing`

Previous OTA also included:

- Production: `258263f0-16e2-4e87-9e6e-26601facc1b2`
- Preview: `584995e1-d813-42c2-8470-63901749ecbd`
- Message: `Route builder guided framework and camp profile fallback`

TypeScript passed before publishing:

```bash
cd mobile
npx tsc --noEmit
```

## Files Recently Modified

These files are currently dirty and contain the recent working changes:

- `mobile/app/(tabs)/route-builder.tsx`
- `mobile/app/(tabs)/map.tsx`
- `mobile/app/(tabs)/profile.tsx`
- `mobile/components/NativeMap/OfflineModal.tsx`
- `mobile/lib/store.ts`
- `mobile/lib/storage.ts`
- `mobile/lib/useSubscription.ts`
- `mobile/components/NativeMap/index.web.tsx`
- `mobile/package.json`
- `mobile/package-lock.json`

Do not revert them unless explicitly asked.

## Route Builder State

Key changes already made in `mobile/app/(tabs)/route-builder.tsx`:

- Added trip framework controls:
  - destination/end location
  - number of days
  - route style: balanced, direct, scenic
  - hours/day
  - per-day drive-hour override
  - rest day toggle
- Framework build now lays out generated day target areas between start and destination.
- Generated target areas are named like `Day N target area`.
- `isFrameworkTarget(stop)` identifies generated target areas.
- Camp selection can replace a generated target area with the selected camp.
- `dayMileage` now includes the drive from the previous day's overnight anchor to the current day's first stop.
- `daily_itinerary` in `buildTrip()` now also includes previous-day-to-current-day mileage.
- Leg discovery now samples multiple points along the leg using `legSamplePoints()` instead of only querying the midpoint.
- Results are deduped with `uniqueByGeo()`.
- Search CTA now says `SEARCH LEG` or `SEARCH AREA`.
- `discoverySummary` shows result counts.
- Full profile fallback: if `api.getCampsiteDetail()` fails for sub-camps/loops, it opens a fallback detail sheet instead of showing an alert.
- Camp preview card is vertical with full-width top photo instead of skinny side photo.
- Added an explicit `ROUTE PLAN` strip above discovery:
  - each day shows from/to, miles, estimated time, and target/overnight status
  - each day has visible `FUEL`, `CAMPS`/`SWAP CAMP`, and `PLACES` actions
  - tapping a day focuses that day and map target
  - day actions search the inter-day leg from previous overnight to that day's target
- Same-day itinerary leg actions now show text labels (`FUEL`, `CAMP`, `POI`) instead of icon-only buttons.
- Selecting/replacing a generated camp target now rebalances later generated framework target areas toward the final destination.
- Installed Expo web dependencies for visual testing: `react-native-web`, `react-dom`, `@expo/metro-runtime`.
- Added a web-only `NativeMap` fallback so Route Builder can render under Playwright without loading native MapLibre.
- Added web/localStorage fallback in storage helpers so Expo web does not crash on `expo-secure-store`.
- Playwright screenshot pass found and fixed mobile map overlay collision:
  - moved place filter pill to top-right of the map
  - capped the bottom map hint width
  - increased route builder bottom scroll padding

Known remaining UX issue:

- Route Builder still needs a bigger design pass. The interaction works better, but the search/discover section and day-leg workflow still feel clunky.
- Route Plan now makes day/leg search more obvious, but visual polish still needs device testing.
- Need possibly move toward a stronger "route overview" screen: scroll Day 1, fuel stops, camp choices, Day 2, etc., with map pins updating.

## My Rig / Fuel

Key changes:

- `mobile/lib/store.ts` no longer wipes `rigProfile` on `setAuth()`.
- Added file fallback for rig persistence: `rig_profile.json`.
- `clearAuth()` deletes rig only on explicit logout.
- `RigProfile` now has `fuel_mpg?: string`.
- `mobile/app/(tabs)/profile.tsx` has a `REAL-WORLD MPG` input.
- Route Builder estimates MPG from rig profile, using real MPG first.
- Route Builder fetches AAA state average gas prices by route state where possible, with fallback manual gas price.

## Offline State Packs

Recent offline pack work:

- Live place pack manifest had all 50 states x essentials/services/outdoors = 150.
- Kansas routing pack was missing; prod build endpoint was triggered and live routing manifest now includes `ks.tar`.
- `mobile/components/NativeMap/OfflineModal.tsx` was patched so state place packs remain visible/downloadable even if map/routing readiness flags are incomplete.
- A local zero-byte `data/place_packs/nh-services.json` was removed earlier.

## Explorer / Purchase Handling

Key changes in `mobile/lib/useSubscription.ts`:

- Added `isUserCancelledIap()`.
- `E_USER_CANCELLED` now displays `User cancelled`.
- Explorer purchase path looked structurally okay:
  - IAP initializes only when paywall opens.
  - Product IDs:
    - `com.trailhead.explorer.monthly`
    - `com.trailhead.explorer.annual`
  - Paywall has retry/restore.
- Apple "not available in App Store" was probably StoreKit sandbox/product propagation/review weirdness, not an obvious hard-broken app path.

## Map Start Trip Panel

`mobile/app/(tabs)/map.tsx` has a new trip overview strip before the Start Trip CTA:

- Camp cards with photos/placeholders.
- Fuel mini cards.
- POI mini cards.

User said the Start Trip view should show all camps, pictures, POIs, and then allow Start Trip/resume later. This is partially done but still needs polish.

Latest follow-up pass:

- Reworked the active trip bottom sheet into a cleaner trip overview with day-by-day cards, camp photos/placeholders, day route metadata, fuel/place counts, and start/swap-camp actions.
- Tapping a day card that has a camp now sets that camp as the selected camp so the camp card opens immediately.
- Raised the camp quick card above the trip overview (`zIndex`/`elevation`) so it no longer appears behind the overview sheet.
- Converted the map camp quick card from a side-photo row into a photo-led, scrollable bottom card so camp photos feel like the camp cards in the overview.
- Added web/test fallbacks for `NativeMap`, `WebView`, and secure storage so Route Builder visual checks can run under Expo web.

Latest OTA:

- Production: `a67644c0-544e-43e5-8830-4a6f371037cb`
- Preview: `c8578e58-188d-4d3c-acea-0983f408a519`
- Message: `Route builder leg search fixes`

Route Builder follow-up from hands-on Playwright pass:

- Tested a custom Denver, CO to Moab, UT 3-day route.
- Fixed new routes defaulting manual search results to `waypoint`; they now default to `start`, then switch to waypoint after adding a start.
- Added target-day context for leg searches. Day 2 searches now say `adds to Day 2` instead of looking like Day 1 insertion.
- Added route progress metadata to leg results (`early leg`, `mid leg`, `late leg`).
- Day-card camp search now ranks camps for the overnight/day endpoint and says `near Day N endpoint`; generic leg search spreads fuel/POI results across the leg.
- Verified selecting a Day 2 camp replaces the Day 2 target and rebalances later framework targets.

Verification:

- `cd mobile && npx tsc --noEmit` passed.
- `git diff --check` passed.
- `npx eas update` export/publish succeeded for production and preview.
- Browser visual pass works for Route Builder. Map tab still hits a web-only native-module crash under Expo web, so verify the Map overview/camp-card layering on device/native.
- Save & Open from Route Builder still hits the same web-only Map crash: `TypeError: Object prototype may only be an Object or null: undefined`.

## Installed Skills

These were installed into `/home/sean/.codex/skills`, but Codex must be restarted to pick them up:

- `screenshot`
- `playwright`
- `playwright-interactive`
- `figma-use`
- `figma-implement-design`
- `figma-generate-design`

After restart, use these for the deeper route-builder UX/Figma pass.

## Suggested Next Pass

After restart:

1. Read `CLAUDE.md` and this file.
2. Use the new screenshot/Playwright/Figma skills if available.
3. Do not immediately OTA. First inspect and design Route Builder flow.
4. Focus on:
   - Better Day/Leg selection UI.
   - Stronger "Search camps/fuel/places along this leg" affordance.
   - Map/list sync for candidates.
   - Auto-fill suggestions per day:
     - gas between overnight anchors
     - camp choices near day endpoint
     - POIs along route
   - Better route feasibility warnings:
     - not enough days/hours
     - rest day impact
     - fuel range from My Rig
   - Make search results feel less SaaS-like and more outdoor route-planning-native.

## Useful Commands

## Latest Backend Prompt Update

- Taught the Trailhead chatbox how the current Route Builder flow works:
  - chat gathers trip intent and signals `_ready`
  - AI planner returns a strong base route, not a fully polished final route
  - Route Builder is where users refine exact camps, fuel, and POIs by active day
  - day search results appear inside the selected day's itinerary, not in a hidden area
  - temporary purple `Day N target area` pins are planning anchors only
  - selected camps replace those anchors, become the overnight endpoint, and the next day starts from that camp
- Added the same contract to trip edit prompts so rebuilds keep clean day/waypoint structure.
- Added planner JSON guidance for long/complex routes: use reliable geocodeable anchors and fewer fragile stops rather than overloading 10-14 day plans.

Verification:

- `python3 -m py_compile ai/planner.py` passed.
- `git diff --check` passed.

## Latest OTA

- Production: `95e5b055-9f8e-498a-b09b-4142fc3e676f`
- Preview: `e7f24691-33f9-4c81-b885-d6b2268c1419`
- Message: `Polish route builder insert copy`

Route Builder UI copy polish:

- Reworded the insert-context card from `Next stop goes at day finish` to `Add to active day`.
- Reworded selected-stop state to `Insert after selected stop`.
- Helper copy now wraps to two lines instead of being truncated.
- Insert card icon/top alignment adjusted for wrapped copy.

Verification:

- `cd mobile && npx tsc --noEmit` passed.
- `git diff --check` passed.

Previous OTA:

- Production: `1e662f07-54d6-40e5-b46a-aa5248c2c303`
## 2026-05-03 Route Builder wizard/camp refinement

Latest backend deploy:

- Railway deployment: `eb753445-56a2-4ace-8c19-90b9c8b2a3d8`
- Added public `/api/geocode?q=&limit=` endpoint backed by Mapbox with Nominatim server-side fallback so Route Builder start/destination search no longer depends on browser-direct Nominatim requests.
- Verified `https://api.gettrailhead.app/api/geocode?q=Moab&limit=1` returns Moab coordinates.

Latest OTA:

- Production: `353b10cc-d322-4d5f-9816-984c1224a9bf`
- Preview: `b8e760e1-22ea-4195-8a39-7cc58b398d73`
- Message: `Refine route builder wizard and camps`

Route Builder changes:

- Added a Dyrt-inspired setup wizard: Start, Destination, Style, Pace. Hours/day copy clarifies it is a max drive preference, not a required daily drive.
- Added an in-builder trip overview timeline with per-day mileage, camp/fuel action buttons, and visible camp cards once selected.
- Camp cards now stay visible under itinerary stops and include swap plus `STAY NEXT DAY`, which clones the same camp to the following day and marks that day as a rest day.
- Rest-day toggle now reuses the same-day or previous overnight camp when possible, instead of creating a confusing day with no camp anchor.
- Camp searches now recover from broken/missing legs by falling back to the current/previous day area instead of only alerting "add a day target first."
- Overnight camp search has endpoint fallback around the day finish when sampled leg search returns zero camps.
- Active-day CAMP leg button now uses overnight endpoint search, matching the day overview camp button.
- Round-trip framework now creates an explicit turnaround/return-to-start shape instead of only adding invisible loop mileage.
- Alerts on saved/opened routes no longer auto-open for every long-route alert. The panel auto-opens only for high/critical road-related reports within 25 miles of current location or the route start.

Verification:

- `cd mobile && npx tsc --noEmit` passed.
- `python3 -m py_compile dashboard/server.py` passed.
- `git diff --check` passed.
- Playwright static web pass built `mobile/dist-routebuilder-current`, opened Route Builder, completed Kansas City to Moab wizard, built a 4-day route, verified the new trip overview timeline appears, and verified camp search results render inline under Day 1.
- Expo dev server still fails locally under Node 22 with Expo/freeport probing port `65536`; static export + `python3 -m http.server` was used for the browser pass.

- Preview: `eba3d3bd-5830-4a7f-a3f0-7a64a81a06e2`
- Message: `Fix route builder setup search`

Route Builder setup fix:

- `CURRENT` start button now requests foreground location permission from Route Builder itself, gets a balanced current-position fix, stores it in the global user location, and creates the start stop. Users no longer need to visit Map first just to populate location.
- If a user leaves start blank but enters a destination, `BUILD MY ROUTE` / keyboard Search now requests location and uses current location as the start.
- Destination keyboard Search now calls `buildRouteFramework` instead of only adding a destination point.
- Added a visible `GO` button beside Destination as a fallback for keyboards that do not fire submit reliably.

Verification:

- `cd mobile && npx tsc --noEmit` passed.
- `git diff --check` passed.

Previous OTA:

- Production: `d54a338d-5a7c-41a8-9ca7-c5f8c405f712`
- Preview: `aa868375-a2e5-4165-8ced-b8924d68d408`
- Message: `Fix map camp route edits`

Map camp route-edit follow-up:

- Could not get Expo web to bind in the sandbox for a full Playwright AI-trip pass; continued from the Map tab code path behind the reported behavior.
- Camp selection in "View on Map" now replaces the last overnight waypoint for that day, not the first matching camp.
- Old camp cards for that day are removed by `recommended_day`, id, name, or close coordinate match so stale Day 1/old-camp cards do not keep appearing.
- Day mileage for the edited day and following day is recalculated from the current waypoint list.
- Trip overview cards now display mileage calculated from current waypoints, not stale original AI `daily_itinerary.est_miles`.
- Cached active route geometry is cleared after a camp edit so the map redraws from edited waypoints instead of restoring the old AI route line.

Verification:

- `cd mobile && npx tsc --noEmit` passed.
- `git diff --check` passed.

Previous OTA:

- Production: `ea0338b5-285a-472b-945b-25d450ba33e2`
- Preview: `c07acd78-89db-4dd0-a6c9-8f14e297371b`
- Message: `Fix map day camp picker`

Map post-AI camp picker fix:

- Fixed "View on Map" camp selection after AI planning. The camp picker no longer includes all trip stops as search anchors, which was causing Day 2/3/4 to keep showing Day 1 camps.
- Camp picker now searches from the selected day's end-of-day anchor only, using previous day camp only for leg-distance scoring.
- Results prefer camps near the day endpoint: local trip camps within 35 mi, API search around the endpoint, final candidate cap 45 mi.
- Selecting a camp tags it with `recommended_day`, removes the old camp for that day from `activeTrip.campsites`, and replaces the day's camp waypoint.

Verification:

- `cd mobile && npx tsc --noEmit` passed.
- `git diff --check` passed.

Previous OTA:

- Production: `8b35f474-01f5-45df-a97a-067082c1878a`
- Preview: `817e1090-b2e6-4f26-98d1-be95739849ea`
- Message: `Fix route builder day camp search`

Route Builder camp search fix:

- Overnight camp search now scopes results around the selected day endpoint. It prefers camps within 30 miles of the end of that day's leg, falls back to 45 miles only if needed, then sorts by endpoint distance.
- Replacing an existing AI-planned camp now searches from the previous stop to that camp/day endpoint, instead of accidentally searching toward the next day's stop.
- After selecting a camp, Route Builder clears the previous insert context so Day 2/3/4 searches do not inherit Day 1's leg.
- The selected camp remains the overnight endpoint, and later framework targets rebalance from that camp so the next day starts from the new camp.

```bash
cd /home/sean/.openclaw/workspace/trailhead
git status --short
cd mobile
npx tsc --noEmit
```

Publish OTA only when user asks:

```bash
cd /home/sean/.openclaw/workspace/trailhead/mobile
npx eas update --channel production --message "..."
npx eas update --channel preview --message "..."
```

## Navigation Polish And Trail Discovery OTA

Preview OTA pushed:

- Preview update group: `d46cb3f6-e696-47bb-a2c0-3f77934ef9fb`
- iOS update ID: `019df64b-293c-7f2c-949a-fde1da94f66a`
- Android update ID: `019df64b-293c-7565-8239-70835ed129a2`
- EAS Dashboard: `https://expo.dev/accounts/danub44/projects/trailhead/updates/d46cb3f6-e696-47bb-a2c0-3f77934ef9fb`
- Message: `Polish navigation and trail discovery`

What changed:

- Moved the navigation locate/follow button higher on the map (`top: 142`) so it is not cramped against the bottom nav HUD.
- Detached the native turn list from the nav HUD into its own floating panel above the nav sheet, with a header and close button. This avoids the turn list jamming into the active maneuver/speed/ETA controls.
- Ending navigation now also closes the turn list.
- Added `mobile/lib/trailEngine.ts`, a first-pass trail discovery engine that normalizes OSM/offline trailheads, viewpoints, peaks, hot springs, map-tile trails, and MVUM-style roads into `TrailFeature` cards.
- Trail features score and display nearby support: camps within 12 mi, fuel within 20 mi, water within 8 mi, reports nearby, and offline readiness.
- Map trail/POI taps now open the unified trail engine sheet for trailheads/viewpoints/peaks/hot springs instead of the older plain POI sheet.
- Layer sheet now has a Trail Discovery entry that opens a scrollable discovery list.
- Fixed a web/dev wake-lock crash where `deactivateKeepAwake('navigation')` could reject before navigation had activated the wake lock.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.
- Expo web map shell loaded through Playwright with 0 console errors after the wake-lock fix.

Notes:

- This is JS/TS only, so it was shipped as a preview OTA against the already-working native preview binary `6ec43653-e838-495c-a23f-265d77f53b0e`.
- Native iOS still needs TestFlight validation for actual MapLibre touch/camera behavior, turn panel placement, and trail-card tapping on device.

## Figma Setup And Product Design Direction

Figma MCP was added and OAuth-authenticated:

```bash
codex mcp add figma --url https://mcp.figma.com/mcp
codex mcp list
```

`codex mcp list` shows:

- `figma  https://mcp.figma.com/mcp  enabled  OAuth`

Current session did not hot-load a `use_figma` tool namespace after adding the MCP server. The next Codex session should expose Figma tools. Before any Figma write/read requiring JS execution, load the `figma-use` skill; for screen creation, also load `figma-generate-design`.

Created design direction doc:

- `docs/trailhead-product-design-direction.md`

Reference conclusions:

- The Dyrt flow feels polished because it uses one-question wizard screens, plain large inputs, one persistent action, and photo-forward trip cards.
- onX/Gaia patterns reinforce that Trailhead should be map-first, use bottom info cards for tapped map features, make layers/offline readiness obvious, and keep location/follow controls clear.
- Trailhead should avoid copying campground-only generic flows; it should lean navigation/overland/trail readiness: fuel gaps, public land, rig fit, offline state, road/trail risk.

Route Builder design OTA pushed:

- Preview update group: `af8813db-db24-414f-ac8a-f47a05e7cd11`
- iOS update ID: `019df655-2092-74f9-ac2c-b6029dbd7c2a`
- Android update ID: `019df655-2092-7727-8941-c7a10a8e67f3`
- EAS Dashboard: `https://expo.dev/accounts/danub44/projects/trailhead/updates/af8813db-db24-414f-ac8a-f47a05e7cd11`
- Message: `Polish route builder design system`

What changed:

- Added shared design constants `RADIUS`, `SPACE`, and `TYPE` in `mobile/lib/design.ts`.
- Route Builder wizard now uses a cleaner header with `STEP x OF 4`, a progress rail, larger plain inputs, and fewer SaaS-style segmented cards.
- Route Builder header/background/radii/input styles were tightened to feel more like a consumer trip-planning flow.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.
- Expo web route-builder shell loaded through Playwright with 0 console errors.

## Figma Screens And Route Timeline Follow-Up

Figma tools are available in this Codex session. Loaded skills before Figma calls:

- `figma-use`
- `figma-generate-design`

Created Figma file:

- `Trailhead Product Design System`
- https://www.figma.com/design/FJUcMWAfsNyjsguCEp2dBe

What was built in Figma:

- `Trailhead UI Kit` page with local Trailhead Tokens, dark/light modes, text styles, and component specimens for primary/secondary buttons, route search fields, expedition camp cards, timeline stop rows, trail detail cards, offline region cards, and navigation HUD.
- `Trailhead Screens` page with five mobile screens:
  - `Route Builder Wizard / Destination`
  - `Trip Overview / Timeline Workspace`
  - `Trail Discovery / Detail Sheet`
  - `Navigation Mode / Active Guidance`
  - `Offline Downloads / Region Packs`

Figma validation note:

- File and canvas writes succeeded.
- Metadata/screenshot validation was blocked by the Figma Starter plan MCP call limit immediately after creation.

Code follow-up:

- Route Builder trip overview copy now reinforces camp-first day building.
- Each Route Builder timeline day now shows a status pill:
  - over daily max,
  - overnight needed,
  - overnight set,
  - finish day.
- Day cards now expose explicit `CAMP`, `FUEL`, and `PLACES` actions instead of hiding fuel/camp behind two small icon-only buttons.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

## Native Locate Camera And Midwest Valhalla Checkpoint

Date: 2026-06-15

Native locate/camera work:

- Fixed a native map camera issue where tapping locate could fight the free-camera remount path.
- `mobile/components/NativeMap/index.tsx` now remembers programmatic camera destinations for `flyTo`, `flyToCamera`, zoom changes, locate, and trail highlight so style/source refreshes do not snap back to stale coordinates.
- Locate now uses one direct camera animation and no longer queues a free-camera remount.
- Real touch/region gestures clear the programmatic-camera guard, with Android touch-start handling added so panning after locate is treated as user intent sooner.

Locate verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.
- Production OTA shipped:
  - update group `220af3d1-f653-4360-b351-680805399ed7`
  - Android update `019ecd4b-1d74-740d-b5af-cc270aed268e`
  - iOS update `019ecd4b-1d74-7393-839c-67524f6c4877`
  - dashboard `https://expo.dev/accounts/danub44/projects/trailhead/updates/220af3d1-f653-4360-b351-680805399ed7`
- Preview OTA shipped:
  - update group `aad6065f-8e5b-4c2a-ad66-fabebc45ca56`
  - Android update `019ecd4b-c5fb-798a-a492-7c79e10e10c8`
  - iOS update `019ecd4b-c5fb-708f-b4b7-529ece8331f3`
  - dashboard `https://expo.dev/accounts/danub44/projects/trailhead/updates/aad6065f-8e5b-4c2a-ad66-fabebc45ca56`

Midwest Valhalla rollout:

- Built IL/IN/OH Valhalla artifact locally:
  - `/home/sean/valhalla-region-builds/il_in_oh/il_in_oh-valhalla.tar.zst`
  - size `608250932`
  - sha256 `d3653d6df8dc115646cfd094f9f47cc22b43581c207e8d2ed7c6319039c25c1a`
- Published to R2:
  - `routing/valhalla/il_in_oh.tar.zst`
- Created Railway service:
  - service `trailhead-valhalla-midwest`
  - service id `e085e46e-7a6f-4649-9f75-ed5905531ba6`
  - public domain `https://trailhead-valhalla-midwest-production.up.railway.app`
  - volume `trailhead-valhalla-midwest-volume`
  - volume id `5e2fbdec-075f-4985-afe8-ee24c1b5156f`
  - mount `/custom_files`
- Deployed artifact bootstrap:
  - deployment `945226bb-269c-4329-aed8-f8a85afaee3b`
  - message `Load IL IN OH Valhalla artifact from R2`
- Wired production API `VALHALLA_AREA_URLS` with tight state boxes:
  - `midwest_il`
  - `midwest_in`
  - `midwest_oh`
- Production API deployment:
  - `304430ab-cb93-42af-b494-9e0ad27a9578`

Midwest verification:

- Direct Midwest service probes passed for:
  - Chicago to Springfield, IL
  - Indianapolis to Fort Wayne, IN
  - Columbus to Cleveland, OH
- API `/api/route/health` passed all Valhalla targets.
- API route probes selected the expected targets:
  - IL -> `valhalla` / `midwest_il`
  - IN -> `valhalla` / `midwest_in`
  - OH -> `valhalla` / `midwest_oh`
- Michigan neighbor probe stayed out of the Midwest service and used `osrm-fallback` / `default`, which confirms the boxes are not over-catching nearby states.
- 50-state probe result after rollout:
  - total `50`
  - Valhalla `33`
  - OSRM fallback `17`
  - failed `0`
  - remaining fallback states: `AL, AK, FL, GA, HI, IA, KY, LA, MI, MN, MS, ND, NE, SD, TN, TX, WI`

Next routing chunks to consider:

- `MI,WI` or `IA,MN` for another Midwest/north chunk.
- `AL,MS,TN,KY` for the next South/Appalachia expansion.
- `TX` should likely be its own graph.
- `AK` and `HI` should stay isolated because their routing geography is separate and artifact shape/cost is different.

## Great Lakes MI/WI Valhalla Checkpoint

Date: 2026-06-15

Built and shipped the Michigan/Wisconsin online Valhalla target.

Artifact:

- Built with:
  - `VALHALLA_THREADS=4 scripts/build_valhalla_artifact.sh --workdir /home/sean/valhalla-region-builds/mi_wi --states MI,WI --label mi_wi`
- Local artifact:
  - `/home/sean/valhalla-region-builds/mi_wi/mi_wi-valhalla.tar.zst`
- Compression result:
  - `1.21 GiB => 373 MiB`
- Size:
  - `391642469`
- SHA-256:
  - `891b0372bc46724e5dd8c2c15c8d7a65cadea2cfb1ac30876447fdef8637bcb9`
- Build stats:
  - `3139269 routable ways`
  - `21699966 nodes contained in routable ways`
  - `7716784 graph edges`
  - `5841099 graph nodes`
  - `689 tiles`
  - `15433568 directed edges`
  - tile build took `226s`

R2:

- Published key:
  - `routing/valhalla/mi_wi.tar.zst`
- Manifest label:
  - `mi_wi`

Railway:

- Created service:
  - `trailhead-valhalla-greatlakes`
  - service id `ee5b39b6-0539-4299-85b6-cd5800272e27`
- Created volume:
  - `trailhead-valhalla-greatlakes-volume`
  - id `a065a949-1ace-45b1-8331-459a3ff24dab`
  - mount `/custom_files`
  - size `50000 MB`
- Public direct-probe domain:
  - `https://trailhead-valhalla-greatlakes-production.up.railway.app`
- First artifact deployment crashed because `R2_BUCKET` resolved empty through a variable reference.
- Fixed by setting `R2_BUCKET=trailhead-tiles` directly on the service, then redeployed.
- Successful deployment:
  - `82eddcde-2e2e-4f15-a41a-c1e334cbb69c`
  - logs confirmed R2 download, extraction, config generation, and `Valhalla R2 artifacts extracted: 1`.

Direct service verification:

- `/status` returned Valhalla `3.5.1-49b40b7f2` with route action available.
- Detroit to Grand Rapids routed successfully:
  - length `158.1872`
- Milwaukee to Madison routed successfully:
  - length `80.0048`

Production API wiring:

- Added a combined target instead of separate MI/WI targets because Michigan's Upper Peninsula bbox overlaps Wisconsin. The first per-state version worked, but Wisconsin matched `greatlakes_mi`, so the final config uses one honest target:
  - `greatlakes_mi_wi`
  - URL `http://trailhead-valhalla-greatlakes.railway.internal:8002`
  - bounds `{s:41.6,w:-92.9,n:48.5,e:-82.0}`
  - states `["MI","WI"]`
  - priority `17`
- Production API deployment for the final combined target went live after the variable update.

Production verification:

- `/api/route/health` passed all targets, including `greatlakes_mi_wi`.
- Final 50-state probe:
  - total `50`
  - Valhalla `35`
  - OSRM fallback `15`
  - failed `0`
  - MI target `greatlakes_mi_wi`
  - WI target `greatlakes_mi_wi`
- Remaining fallback states:
  - `AL, AK, FL, GA, HI, IA, KY, LA, MN, MS, ND, NE, SD, TN, TX`

Next routing chunks to consider:

- `IA,MN` or `ND,SD,NE` for Upper Midwest / Plains.
- `AL,MS,TN,KY` for a South/Appalachia chunk.
- `FL,GA` can be a Southeast coastal chunk.
- `TX` should stay standalone.
- `AK` and `HI` should stay isolated.

## iOS Locate Camera Settle Checkpoint

Date: 2026-06-15

Issue reported:

- Android locate/pan was working better after the previous native map camera fix.
- iOS locate still moved only a few inches toward the GPS point per tap; repeated taps eventually reached the user location.

Fix:

- Updated `mobile/components/NativeMap/index.tsx`.
- Added an iOS-specific locate camera path that uses Camera `moveTo` and `zoomTo` with a short direct `setCamera` instead of relying on one longer animated `setCamera`.
- Added two iOS settle passes after locate (`180ms` and `460ms`) that snap to the requested GPS point unless the user has started a gesture.
- Deferred source refreshes during programmatic camera movement so map style/source changes do not interrupt the iOS locate animation mid-flight.
- Kept the Android locate path on the existing longer `flyTo` behavior because Android had improved.

Verification:

- `cd mobile && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` passed.
- `git diff --check` passed.

OTA:

- Production:
  - update group `4e45d895-e727-4978-b58e-8938f19b8c52`
  - Android update `019ecd8d-bcca-79b8-bde9-11b9dbd869ad`
  - iOS update `019ecd8d-bcca-7a92-8435-0c13b0de4e3d`
  - dashboard `https://expo.dev/accounts/danub44/projects/trailhead/updates/4e45d895-e727-4978-b58e-8938f19b8c52`
- Preview:
  - update group `22f4c1b6-b39a-4de6-adb2-d664a01a2194`
  - Android update `019ecd8e-7fb7-7537-8572-c15d6ef68749`
  - iOS update `019ecd8e-7fb7-7125-bf71-f7b2b9ff3377`
  - dashboard `https://expo.dev/accounts/danub44/projects/trailhead/updates/22f4c1b6-b39a-4de6-adb2-d664a01a2194`

Device follow-up:

- Have Sean confirm iOS locate now jumps/settles to the GPS point in one tap.
- If it still inches toward location, next step is to remount the free camera only on iOS locate with a monotonic `freeCameraRevision`, but avoid that unless this settle path is insufficient.

## IA/MN Upper Midwest Valhalla Checkpoint

Date: 2026-06-15

Purpose:

- Continue replacing online route fallback states with self-hosted Valhalla coverage.
- Add Iowa and Minnesota without making nearby states hit the wrong service first.

Local artifact:

- Workdir:
  - `/home/sean/valhalla-region-builds/ia_mn`
- Artifact:
  - `/home/sean/valhalla-region-builds/ia_mn/ia_mn-valhalla.tar.zst`
- Compression result:
  - `671 MiB => 206 MiB`
- Size:
  - `215838623`
- SHA-256:
  - `43d2f97d636f6828905162d1227f6464ed6cdc2e2484153cb435f9d3232728c7`
- Build stats:
  - `1716123 routable ways`
  - `12000294 nodes contained in routable ways`
  - `4091050 graph edges`
  - `3096730 graph nodes`
  - `775 tiles`
  - `8182100 directed edges`
  - tile build took `115s`

R2:

- Published key:
  - `routing/valhalla/ia_mn.tar.zst`
- Manifest label:
  - `ia_mn`

Railway:

- Created service:
  - `trailhead-valhalla-uppermidwest`
  - service id `f4233e2a-5e29-4aab-9f8a-254e83ec7723`
- Created volume:
  - `trailhead-valhalla-uppermidwest-volume-A7Y5`
  - id `05b0d422-c78d-4261-be4c-548a9018ac8b`
  - mount `/custom_files`
- Public direct-probe domain:
  - `https://trailhead-valhalla-uppermidwest-production.up.railway.app`
- Successful artifact deployment:
  - `e95acb6e-1736-4781-b228-d38daba9dcce`

Direct service verification:

- `/status` returned Valhalla `3.5.1-49b40b7f2` with route action available.
- Des Moines to Cedar Rapids routed successfully.
- Minneapolis to Duluth routed successfully.

Production API wiring:

- First used one combined `uppermidwest_ia_mn` target.
- Audit found that box was too broad: Nebraska correctly fell back to OSRM, but it tried the IA/MN target first.
- Replaced it with two tighter targets on the same Railway service:
  - `uppermidwest_ia`
  - `uppermidwest_mn`

Production verification:

- `/api/route/health` passed all targets, including `uppermidwest_ia` and `uppermidwest_mn`.
- Final 50-state probe:
  - total `50`
  - Valhalla `37`
  - OSRM fallback `13`
  - failed `0`
  - IA target `uppermidwest_ia`
  - MN target `uppermidwest_mn`
  - NE target `default` OSRM fallback, as expected until the Plains service is added

Remaining fallback states:

- `AL, AK, FL, GA, HI, KY, LA, MS, ND, NE, SD, TN, TX`

Next routing chunks:

- `ND,SD,NE` for Plains.
- `AL,MS,TN,KY` for South/Appalachia.
- `FL,GA` for Southeast coastal.
- `TX` standalone.
- `AK` and `HI` isolated.

## ND/SD/NE Plains Valhalla Checkpoint

Date: 2026-06-15

Purpose:

- Move North Dakota, South Dakota, and Nebraska from OSRM fallback to Trailhead-owned Valhalla routing.
- Keep the boxes tight enough that Kansas/Ozarks routes are not pulled into the Plains service.

Local artifact:

- Workdir:
  - `/home/sean/valhalla-region-builds/nd_sd_ne`
- Artifact:
  - `/home/sean/valhalla-region-builds/nd_sd_ne/nd_sd_ne-valhalla.tar.zst`
- Compression result:
  - `404 MiB => 129 MiB`
- Size:
  - `134753959`
- SHA-256:
  - `18ed78378a2477705060cc58cdb3a06165989b6160d77e0e50ce5ed03e1c0640`
- Build stats:
  - `994212 routable ways`
  - `10190214 nodes contained in routable ways`
  - `2411953 graph edges`
  - `1807898 graph nodes`
  - `1205 tiles`
  - `4823906 directed edges`
  - tile build took `74s`

R2:

- Published key:
  - `routing/valhalla/nd_sd_ne.tar.zst`
- Manifest label:
  - `nd_sd_ne`

Railway:

- Created service:
  - `trailhead-valhalla-plains`
  - service id `3e9ef8db-08e7-43ab-a89d-0f121f1c83e8`
- Created volume:
  - `trailhead-valhalla-plains-volume`
  - id `251dd798-18ef-4808-a2ce-ec118c14481a`
  - mount `/custom_files`
- Public direct-probe domain:
  - `https://trailhead-valhalla-plains-production.up.railway.app`
- Deployment:
  - `3e274783-d016-4c8b-9c7f-9483519654e9`
  - logs confirmed R2 download, extraction, config generation, and `Valhalla R2 artifacts extracted: 1`.

Direct service verification:

- `/status` returned Valhalla `3.5.1-49b40b7f2` with route action available.
- Bismarck to Fargo routed successfully.
- Sioux Falls to Rapid City routed successfully.
- Omaha to Lincoln routed successfully.

Production API wiring:

- Added three separate targets on the same service:
  - `plains_nd`
  - `plains_sd`
  - `plains_ne`
- Set Nebraska south bound to `40.0` to avoid catching Kansas/Ozarks routes through a rectangular bbox overlap.
- First API health check did not show the Plains targets because the API had not restarted onto the new variable.
- Forced a production API redeploy with `railway deployment redeploy --service trailhead --yes`.

Production verification:

- `/api/route/health` passed all targets, including `plains_nd`, `plains_sd`, and `plains_ne`.
- Final 50-state probe:
  - total `50`
  - Valhalla `40`
  - OSRM fallback `10`
  - failed `0`
  - ND target `plains_nd`
  - SD target `plains_sd`
  - NE target `plains_ne`

Remaining fallback states:

- `AL, AK, FL, GA, HI, KY, LA, MS, TN, TX`

Next routing chunks:

- `AL,MS,TN,KY` for South/Appalachia.
- `FL,GA` for Southeast coastal.
- `TX` standalone.
- `AK` and `HI` isolated.

## AL/MS/TN/KY South Valhalla Checkpoint

Date: 2026-06-15

Purpose:

- Move Alabama, Mississippi, Tennessee, and Kentucky from OSRM fallback to Trailhead-owned Valhalla routing.
- Keep western Tennessee/Kentucky ahead of the Ozarks target so those routes do not select the older Ozarks bundle first.

Local artifact:

- Workdir:
  - `/home/sean/valhalla-region-builds/al_ms_tn_ky`
- Artifact:
  - `/home/sean/valhalla-region-builds/al_ms_tn_ky/al_ms_tn_ky-valhalla.tar.zst`
- Compression result:
  - `1.09 GiB => 366 MiB`
- Size:
  - `383748709`
- SHA-256:
  - `167c8300f80feff9a1abec4f537177ca20c47b7415c209894e95267436c951a1`
- Build stats:
  - `2897067 routable ways`
  - `28500885 nodes contained in routable ways`
  - `6538050 graph edges`
  - `5254142 graph nodes`
  - `861 tiles`
  - `13076099 directed edges`
  - tile build took `232s`

R2:

- Published key:
  - `routing/valhalla/al_ms_tn_ky.tar.zst`
- Manifest label:
  - `al_ms_tn_ky`

Railway:

- Created service:
  - `trailhead-valhalla-south`
  - service id `593ed672-72b7-4576-b1f1-df5a6dd96eb1`
- Created volume:
  - `trailhead-valhalla-south-volume`
  - id `004b3c0d-d504-4715-b1ac-7c67ea35d6b6`
  - mount `/custom_files`
- Public direct-probe domain:
  - `https://trailhead-valhalla-south-production.up.railway.app`
- Deployment:
  - `75f441f5-0db2-4664-a63f-5f89a196fa3b`
  - logs confirmed R2 download, extraction, config generation, and `Valhalla R2 artifacts extracted: 1`.

Direct service verification:

- `/status` returned Valhalla `3.5.1-49b40b7f2` with route action available.
- Birmingham to Montgomery routed successfully.
- Jackson to Tupelo routed successfully.
- Nashville to Memphis routed successfully.
- Louisville to Lexington routed successfully.

Production API wiring:

- Added four separate targets on the same service:
  - `south_al`
  - `south_ms`
  - `south_tn`
  - `south_ky`
- The variable update triggered an API deployment; manual redeploy was rejected because the latest deployment was already active.

Production verification:

- `/api/route/health` passed all targets, including `south_al`, `south_ms`, `south_tn`, and `south_ky`.
- Final 50-state probe:
  - total `50`
  - Valhalla `44`
  - OSRM fallback `6`
  - failed `0`
  - AL target `south_al`
  - MS target `south_ms`
  - TN target `south_tn`
  - KY target `south_ky`

Remaining fallback states:

- `AK, FL, GA, HI, LA, TX`

Next routing chunks:

- `FL,GA` for Southeast coastal.
- `TX` standalone.
- `LA` could be standalone or paired with TX if service size allows, but standalone is safer for clean target boxes.
- `AK` and `HI` isolated.

## FL/GA Southeast Valhalla Checkpoint

Date: 2026-06-16

Purpose:

- Move Florida and Georgia from OSRM fallback to Trailhead-owned Valhalla routing.
- Reduce the Florida panhandle overlap risk from the Alabama target by giving Florida its own target ahead of South.

Local artifact:

- Workdir:
  - `/home/sean/valhalla-region-builds/fl_ga`
- Artifact:
  - `/home/sean/valhalla-region-builds/fl_ga/fl_ga-valhalla.tar.zst`
- Compression result:
  - `1.56 GiB => 493 MiB`
- Size:
  - `517062964`
- SHA-256:
  - `8a83802542d96b405f51e6e92d62752083c0e5e98f2b033977645e993e9e4b8a`
- Build stats:
  - `4428249 routable ways`
  - `28661263 nodes contained in routable ways`
  - `9877591 graph edges`
  - `7617761 graph nodes`
  - `568 tiles`
  - `19755182 directed edges`
  - tile build took `345s`

R2:

- Published key:
  - `routing/valhalla/fl_ga.tar.zst`
- Manifest label:
  - `fl_ga`

Railway:

- Created service:
  - `trailhead-valhalla-southeast`
  - service id `873b6692-1ffa-4249-8cf9-b5b3fc289af5`
- Created volume:
  - `trailhead-valhalla-southeast-volume`
  - id `7b8b42b5-bede-4b23-bd04-a7d0bb35d876`
  - mount `/custom_files`
- Public direct-probe domain:
  - `https://trailhead-valhalla-southeast-production.up.railway.app`
- Deployment:
  - `bacddea8-bca9-4ff5-bb4b-5eaa9f23a69c`
  - logs confirmed R2 download, extraction, config generation, and `Valhalla R2 artifacts extracted: 1`.

Direct service verification:

- `/status` returned Valhalla `3.5.1-49b40b7f2` with route action available.
- Miami to Orlando routed successfully.
- Atlanta to Savannah routed successfully.

Production API wiring:

- Added two separate targets on the same service:
  - `southeast_fl`
  - `southeast_ga`
- Target-order audit:
  - `southeast_fl` priority `12`, ahead of `south_al`, so Florida panhandle routes prefer the Florida service.
  - `southeast_ga` priority `9`, behind `east_sc`, so existing South Carolina routes keep selecting the SC target.
- First health check after the variable update did not show Southeast targets, so the API was forced to redeploy with `railway deployment redeploy --service trailhead --yes`.

Production verification:

- `/api/route/health` passed all targets, including `southeast_fl` and `southeast_ga`.
- Final 50-state probe:
  - total `50`
  - Valhalla `46`
  - OSRM fallback `4`
  - failed `0`
  - FL target `southeast_fl`
  - GA target `southeast_ga`

Remaining fallback states:

- `AK, HI, LA, TX`

Next routing chunks:

- `LA` standalone.
- `TX` standalone.
- `AK` standalone.
- `HI` standalone.

Known routing-target weakness:

- Regional routing targets still use rectangular bounds, not state polygons.
- Border areas can select a neighboring target before fallback if both endpoints sit in a rectangular overlap.
- Current ordering avoids the obvious FL/AL and GA/SC regressions for common cases, but the more durable production fix is polygon-aware target selection or a state/country hint in route requests.

## Louisiana Valhalla Checkpoint

Date: 2026-06-16

Purpose:

- Move Louisiana from OSRM fallback to Trailhead-owned Valhalla routing.
- Keep Louisiana standalone so TX and Gulf Coast target boxes can be tuned independently.

Local artifact:

- Workdir:
  - `/home/sean/valhalla-region-builds/la`
- Artifact:
  - `/home/sean/valhalla-region-builds/la/la-valhalla.tar.zst`
- Compression result:
  - `199 MiB => 63.1 MiB`
- Size:
  - `66166074`
- SHA-256:
  - `9109f29b0f31e96d9a935dd61039bd2283e8f8fd729d64c60b27c923bb462b07`
- Build stats:
  - `523296 routable ways`
  - `3759352 nodes contained in routable ways`
  - `1179524 graph edges`
  - `928553 graph nodes`
  - `238 tiles`
  - `2359048 directed edges`
  - tile build took `29s`

R2:

- Published key:
  - `routing/valhalla/la.tar.zst`
- Manifest label:
  - `la`

Railway:

- Created service:
  - `trailhead-valhalla-louisiana`
  - service id `6d52e566-cc86-423b-b481-ac70528cc41c`
- Volume:
  - mount `/custom_files`
  - `railway volume add` timed out, then retry confirmed a volume was already mounted; volume id was not captured in the console output.
- Public direct-probe domain:
  - `https://trailhead-valhalla-louisiana-production.up.railway.app`
- Deployment:
  - `289e786a-f4e5-4702-adf0-a7b02e939dff`
  - logs confirmed R2 extraction and `Valhalla R2 artifacts extracted: 1`.

Direct service verification:

- `/status` returned Valhalla `3.5.1-49b40b7f2` with route action available.
- New Orleans to Baton Rouge routed successfully.

Production API wiring:

- Added target:
  - `louisiana_la`
  - service URL `http://trailhead-valhalla-louisiana.railway.internal:8002`
  - priority `12`
  - state hint `LA`

Production verification:

- `/api/route/health` passed all targets, including `louisiana_la`.
- Final 50-state probe:
  - total `50`
  - Valhalla `47`
  - OSRM fallback `3`
  - failed `0`
  - LA target `louisiana_la`

Remaining fallback states:

- `AK, HI, TX`

Next routing chunks:

- `TX` standalone.
- `AK` standalone.
- `HI` standalone.

## Explore UI Redesign Checkpoint

Date: 2026-06-16

Purpose:

- Implement the Explore UI redesign package from `/tmp/trailhead_explore_ui_redesign_codex_package`.
- Keep the work OTA-safe: JS/TS, styles, docs, and remote image references only.

Source package preserved:

- Copied redesign docs and mock/current screenshots into `docs/explore-ui-redesign/`.
- Skipped Windows `:Zone.Identifier` metadata files.

Implemented:

- New Explore component set in `mobile/components/explore/`.
- Redesigned Explore hero/search, category chips, mode tabs, filter row, cards, and detail sheet.
- Local saved Explore IDs via `trailhead_saved_explore_places_v1`.
- Explore card Area/Save/Route actions wired to existing map/navigation state.
- Future v3 Explore catalog typing added in `mobile/lib/api.ts`.
- Search/category scoring tightened so direct category queries like `waterfalls`, `hiking`, and `fuel` filter by actual Explore card type.
- Added a curated waterfall fill-in pack with 9 named waterfall cards and verified Wikimedia image URLs:
  - Multnomah Falls
  - Yosemite Falls
  - Havasu Falls
  - Shoshone Falls
  - Tahquamenon Falls
  - Cumberland Falls
  - Amicalola Falls
  - Palouse Falls
  - Taughannock Falls
- Waterfall detail sheets now show a `Waterfalls plan` panel with drop, access, best flow, and safety.
- Trail detail sheets now show a `Trails plan` panel with route type, distance, difficulty, and trail-line map hints.
- Curated waterfall cards bypass the backend `/api/explore/places/:id/campgrounds` endpoint and use nearby-camp fallback directly, avoiding expected 404s for local-only IDs.

Verification:

- `cd mobile && npx tsc --noEmit` passed.
- `git diff --check` passed.
- `cd mobile && npx expo export --platform web --output-dir dist-explore-redesign` passed.
- Playwright static web smoke on `http://127.0.0.1:8094`:
  - Explore home rendered redesigned hero/cards.
  - `waterfalls` search returned 9 unique waterfall cards only.
  - Multnomah Falls detail rendered `Waterfalls plan`, source details, camp fallback rail, and related modules.
  - `hiking` search returned 39 trail/trailhead-style cards.
  - Yosemite Valley Trails detail rendered `Trails plan` with route type, distance, difficulty, and trail-line hints.

Known benign smoke warnings:

- Static Python server has no SPA fallback, so direct `/guide` reload 404s; root navigation works.
- Static server requests `/favicon.ico` and gets 404.
- Expo web warnings remain for notifications listener and `expo-av` deprecation.
- Expo export still emits the existing `react-native-webrtc` / `event-target-shim` package-exports warning.

OTA:

- Source checkpoint commit:
  - `2004d57 Redesign Explore discovery UI`
- First attempted `cd mobile && npm run ota` after the clean commit.
- That package-script OTA did not upload. EAS failed immediately with:
  - `Must supply --message or use --auto when in non-interactive mode and VCS is available`
- The package script invokes:
  - `eas update --channel production --auto && eas update --channel preview --auto`
- Retried with explicit EAS messages after user approval:
  - `npx eas update --channel production --message "Redesign Explore discovery UI"` published.
  - Production update group: `d0cf5460-0696-4905-bacf-c6e25a166133`
  - `npx eas update --channel preview --message "Redesign Explore discovery UI"` published.
  - Preview update group: `243f15e3-76d6-44c1-9399-967ef2ab992a`
  - Runtime version: `native-20260614-sdk54-1`

Follow-up:

- Move the curated waterfall fill-in pack into the backend Explore seed/catalog pipeline when rebuilding Explore v3, so the API owns these records.
- True graph-backed trail loop geometry still belongs in the trail graph/detail workflow; the Explore detail panel currently exposes inferred planning hints and sends users to the map for exact segments.
