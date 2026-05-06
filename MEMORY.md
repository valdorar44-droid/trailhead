# Trailhead Mobile Handoff Memory

Use this after a Codex restart:

1. Read `CLAUDE.md`.
2. Read this `MEMORY.md`.
3. Continue in `/home/sean/.openclaw/workspace/trailhead`.

## Current Focus

We are improving the Trailhead mobile app, especially Route Builder, offline state packs, My Rig persistence, camp cards, and Explorer purchase handling.

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
