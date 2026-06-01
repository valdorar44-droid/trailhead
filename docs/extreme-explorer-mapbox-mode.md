# Extreme Explorer Mapbox Mode

Status: product and technical plan. Private Stays ships first. Extreme Explorer becomes its own premium Mapbox-powered mode with a different map, guided navigation, Co-Pilot, Mapbox places/search, weather, route-aware checkpoints, and high-polish map interaction. Base Trailhead remains MapLibre + Valhalla/offline.

## Updated Direction

Extreme Explorer is not just a button that starts navigation. It is a separate premium mode:

- A distinct Mapbox map surface beside the existing Trailhead map.
- Mapbox Standard, Standard Satellite, 3D, traffic, and route-guidance visuals.
- Mapbox Search/Places for the premium place-discovery experience.
- Mapbox Navigation SDK for Active Guidance, reroute, voice, route line, trip progress, navigation camera, traffic, incidents, closures, and alternatives.
- Mapbox Weather for current, hourly, daily, and route-based forecasts when available.
- MapGPT / UX Framework as the "over the top" pilot lane once beta terms, cost, customization, and privacy are acceptable.
- Trailhead-owned Co-Pilot memory, checkpoints, private stays, camps, offline readiness, trails, water, and public-land context layered into the premium mode.

Base Trailhead stays durable and affordable:

- MapLibre map.
- Trailhead tiles and offline packs.
- Valhalla/offline routing.
- Camps, private stays, water, trails, public land, reports, Route Builder.
- Current 3D terrain stays included and is not paywalled.

## Current Mapbox Source Notes

Researched June 1, 2026:

- Navigation SDK Android current guide shows `v3.24.3` and NDK 27 artifact `com.mapbox.navigationcore:android-ndk27:3.24.3`.
- Navigation SDK supports raw location enhancement, online/offline routing and rerouting, traffic/incidents/closures avoidance, continuous alternatives, route line, nav camera, and voice.
- Maps SDK Android current guide shows `v11.24.3`; it supports Mapbox Standard, Standard Satellite, custom Studio styles, runtime sources/layers, camera, querying, and interactions.
- Search SDK Android current guide shows `v2.24.3`; it supports name/category/coordinate search, offline address search, prebuilt UI, generic search engine, category search, and Place Autocomplete.
- Navigation pricing docs define billing around `startTripSession`: Active Guidance starts when a route is set; Free Drive starts when no route is set. This is the hard cost boundary.
- Navigation UX Framework is Public Preview. It offers a complete Android experience from exploration/search to active guidance, plus fuel prices, weather, voice assistant, regular/traffic/3D/satellite styles, and custom layers. Treat it as a premium pilot, not the first production dependency.
- MapGPT docs say the feature is enabled by default in UX Framework and can be configured, disabled, and observed through events. It requires microphone permission and beta/evaluation terms.

Primary docs:

- https://docs.mapbox.com/android/navigation/guides/
- https://docs.mapbox.com/android/navigation/guides/pricing/
- https://docs.mapbox.com/android/navigation/guides/turn-by-turn-navigation/
- https://docs.mapbox.com/android/navigation/guides/turn-by-turn-navigation/route-progress/
- https://docs.mapbox.com/android/navigation/guides/turn-by-turn-navigation/rerouting-and-refresh/
- https://docs.mapbox.com/android/navigation/guides/ui-components/camera/
- https://docs.mapbox.com/android/navigation/guides/ui-components/route-line/
- https://docs.mapbox.com/android/navigation/guides/weather/conditions/
- https://docs.mapbox.com/android/maps/guides/
- https://docs.mapbox.com/android/maps/guides/styles/
- https://docs.mapbox.com/android/search/guides/
- https://docs.mapbox.com/android/search/guides/search/
- https://docs.mapbox.com/android/navigation/ux/guides/
- https://docs.mapbox.com/android/navigation/ux/installation/
- https://docs.mapbox.com/android/navigation/ux/configuration/map-styles/
- https://docs.mapbox.com/android/navigation/mapgpt/get-started/

## Product Architecture

### Mode Split

Trailhead mode:

- Default map-first experience.
- Low-cost browsing and planning.
- Offline-first.
- Trailhead-owned routing and data.

Extreme Explorer mode:

- Separate tab/screen/surface launched from Map, Route Builder, or trip view.
- Requires `extreme` entitlement.
- Shows a premium Mapbox map from the first frame.
- Includes a command bar and voice entry.
- Can start Free Drive only for paid Extreme users.
- Can start Guided Nav only after explicit user action.
- Keeps a visible Trailhead fallback route and offline readiness state.

### Entitlements

- `has_active_plan(user)` keeps Explorer.
- Add `has_extreme_plan(user)`.
- Extreme products:
  - `com.trailhead.extreme.monthly.v1`
  - `com.trailhead.extreme.annual.v1`
- Backend issues scoped Mapbox public tokens only to Extreme users.
- Token endpoint should include session intent: map exploration, search, free drive, active guidance.

### Billing Boundary

Rules:

- No Mapbox Navigation SDK initialization for free users.
- No `startTripSession` in default Trailhead mode.
- No passive Free Drive for Explorer-only users.
- Extreme map browsing may use Maps/Search billing; Navigation billing starts only in Extreme mode.
- Active Guidance starts only after a clear `Start Guided Nav` action.
- Stop and destroy sessions on exit, trip end, app background timeout, or entitlement loss.

Ledger fields:

- user id
- entitlement
- platform
- app version
- session intent
- map style
- search count
- weather count
- free drive start/end
- active guidance start/end
- route id
- route legs started
- estimated billable units
- kill switch state

## Premium Experience

### Current Implementation Chunk

The first implementation chunk is Premium Map Demo only:

- Hidden beta config and entitlement endpoints.
- Demo session authorization/end/ledger for non-navigation browsing.
- Trailhead-owned checkpoint and trip-memory contracts.
- Mobile entry points from Map and Route Builder when the server allows the beta surface.
- A separate Extreme Explorer preview screen with a premium map loading moment, animated route line, popping places/checkpoints, style choices, and text-only Co-Pilot tray.

This chunk still excludes:

- Real guided navigation billing sessions.
- Free Drive.
- `startTripSession`.
- Production MapGPT calls.
- Permanent Co-Pilot trip mutations without explicit confirmation.

### Map Loading Moment

Target the polished demo feel:

- Full-bleed Mapbox Standard / Satellite / 3D surface.
- Route preview animates in as a drawn line.
- Checkpoints appear in sequence along the line.
- Places pop in around the route in clusters: fuel, private stays, camps, food, repair, viewpoints, weather risk.
- Co-Pilot tray explains what it found in one short sentence.
- User can tap any popped place and immediately add, skip, save, or route.

### Map Styles

Offer Extreme-only styles:

- Live Road.
- Satellite Trail.
- 3D Terrain.
- Night Drive.
- Weather Watch.
- Traffic + Incidents.

Implementation:

- Start with Maps SDK + custom Trailhead overlays.
- Build branded Mapbox Studio styles later.
- UX Framework default styles can be a fast prototype for the full premium mode.

### Co-Pilot Command Bar

Commands:

- "Draw the best route."
- "Show private stays tonight."
- "Add fuel before the remote stretch."
- "What weather will hit the pass?"
- "Find legal camp near day 2."
- "Avoid highways."
- "Avoid sand."
- "Make today shorter."
- "Show bailout towns."
- "Download this trip."
- "Start Guided Nav."

Co-Pilot remains Trailhead-owned:

- It can ask Mapbox for map/search/nav/weather context.
- It uses Trailhead data for camps, private stays, public-land rules, route readiness, offline packs, trails, water, and reports.
- It writes trip memory and checkpoint state to Trailhead, not Mapbox.

### Follow-On: Voice Co-Pilot

Next add-on set should make Co-Pilot voice activated, similar to the MapGPT demo lane, but overland-specific and Trailhead-owned:

- Wake/press-to-talk entry from Extreme Explorer, Guided Nav, and route review.
- Speech recognition with visible listening/thinking/confirming states.
- Spoken responses for route decisions, weather risk, fuel gaps, overnight planning, and trail/road conditions.
- Command routing that can use Mapbox map/search/nav/weather context where licensed, while keeping overland memory, camps, private stays, public-land rules, offline readiness, reports, trails, and water context in Trailhead.
- Confirmation gates for every permanent action: add stop, replace stay, change route, mark checkpoint, download trip, or start guidance.
- Overland commands beyond generic navigation:
  - "Find legal camp before dark."
  - "Add fuel before the remote stretch."
  - "Avoid shelf roads with the trailer."
  - "Show bailout towns."
  - "Warn me before last reliable signal."
  - "Download everything for this route."
  - "Switch to public land only."
  - "Find repair within 30 miles."
- A server-side command ledger for cost, safety, entitlement, and action audit.
- A customization dashboard for enabled commands, voice personality, confirmation strictness, preferred providers, overland constraints, and kill switches.

Guardrail for this follow-on: MapGPT/UX Framework can be piloted, but Trailhead should retain the source of truth for trip state, private selections, checkpoints, memory, and user-confirmed mutations.

### Checkpoints

Checkpoint types:

- fuel
- water
- private stay
- camp
- trailhead
- weather risk
- traffic/closure
- last reliable signal
- offline boundary
- bailout town
- border/permit
- technical road
- repair/tire

Checkpoint statuses:

- upcoming
- complete
- skipped
- needs review
- confirmed
- blocked

Checkpoint source:

- Trailhead route stop
- Trailhead camp/private stay
- Mapbox Search result
- Mapbox route/weather/nav event
- user-created
- Co-Pilot suggestion

Rules:

- Co-Pilot can mark checkpoints complete/skipped/needs review.
- Co-Pilot cannot permanently mutate the saved trip until the user confirms.
- Weather and traffic checkpoints expire and refresh.
- Offline boundary checkpoints must remain Trailhead-owned.

### Weather

Use Mapbox Weather where licensed/available:

- Current conditions at user, camp, pass, and destination.
- Hourly forecast at arrival time.
- Daily forecast per overnight.
- Weather Along Route for route checkpoints.
- Warnings Along Route for risk flags.

Trailhead UI:

- "Storm at pass near 4 PM."
- "Camp arrival: 42 F, rain likely."
- "High wind checkpoint."
- "Snow risk before the summit."

Fallback:

- Continue Open-Meteo/Trailhead weather where Mapbox Weather access is unavailable or too costly.

## Native Build Prep

Native Mapbox rendering is prepared for the next binary build:

- React Native package pinned to `@rnmapbox/maps@10.2.7`.
- The latest `10.3.x` line requires React Native `>=0.79`; Trailhead is currently on React Native `0.76.3`, so do not upgrade this package until the Expo/RN upgrade lands.
- Expo config plugin added with `RNMapboxMapsImpl: mapbox`.
- Native Maps SDK version pinned through `RNMapboxMapsVersion`, defaulting to `11.16.0`.
- iOS microphone usage text added for the future voice Co-Pilot path.
- Android already includes `RECORD_AUDIO`.

Build secrets:

- EAS native builds must provide `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` with Mapbox `DOWNLOADS:READ` scope.
- Do not commit the downloads token to `app.config.js`, `eas.json`, or source control.
- The public runtime map token remains server-issued by `GET /api/extreme/config`.
- Railway Mapbox variables do not automatically satisfy EAS native build credentials; mirror the downloads token into EAS build environment before starting Android/iOS rebuilds.

Scope boundary:

- This only prepares native Mapbox Maps rendering.
- Mapbox Search SDK, Navigation SDK, Weather, UX Framework, and MapGPT still need their native bridge/build slices.
- Do not start `startTripSession`, Free Drive, or Active Guidance from this prep.

## MapGPT / UX Framework Access Request

Request Mapbox pilot/production clarification before building the voice-first stack around MapGPT:

- Product: Trailhead Extreme Explorer hidden beta.
- Surfaces: iOS and Android, selected accounts only, no public launch until terms, cost, and privacy are approved.
- Use case: voice Co-Pilot for overland route planning, route review, guided navigation, fuel gaps, legal camp discovery, private stays, weather risk, offline readiness, bailout towns, vehicle constraints, and checkpoint management.
- Trailhead-owned data: trip memory, camps, private stays, public/private preference, public-land context, saved places, reports, offline packs, route-builder changes, checkpoints, and user-confirmed trip mutations.
- Mapbox context requested: map state, search results, route state, navigation progress, traffic/incidents, Weather Along Route, and UX Framework assistant events where licensed.
- Customization request: custom assistant name/persona, optional voice/face settings if available, command allowlist, confirmation strictness, dashboard controls, and kill switches.

Questions for Mapbox:

- Is MapGPT available for consumer mobile apps outside Mapbox Dash, and under what approval terms?
- Can Trailhead register custom action handlers for fuel, stay review, camp review, weather, route changes, offline download, checkpoint marking, and guidance start?
- Can MapGPT call into Trailhead-owned private data without Mapbox retaining or training on that data?
- What data retention, privacy, logging, and deletion controls apply to voice transcripts and assistant events?
- What production SLA, pricing, metering, rate limits, and session billing apply?
- Can the UX Framework assistant coexist with custom native layers, private Trailhead overlays, and separate Trailhead entitlement gates?
- Can the assistant be configured or disabled remotely per account, platform, and beta surface?

Pilot guardrail:

- MapGPT and UX Framework stay behind server flags.
- All permanent actions require visible user confirmation.
- The backend command ledger must record command intent, proposed action, confirmation state, cost category, and kill-switch state.
- If MapGPT terms or customization are not acceptable, build the Trailhead voice Co-Pilot with lower-level speech, LLM/tool routing, Maps/Search/Navigation/Weather SDK context, and Trailhead-owned action handlers.

### Places / Search

Use Mapbox Search SDK for Extreme mode:

- Place Autocomplete for destination/search.
- Category Search for fuel, food, repair, lodging, EV/charging if relevant, viewpoints, parks, and POIs.
- Reverse geocoding for tapped map context.
- Offline Search where useful for addresses.

Trailhead still owns:

- private-stay review rules
- legal camp confidence
- public/private camp preference
- avoid rules
- saved places
- partner/private-stay metadata

### Guided Nav

Phase 1 production base:

- Android native screen.
- Maps SDK + Navigation SDK, not UX Framework.
- Stable Navigation SDK GA.
- Route line and alternatives.
- Navigation camera following/overview.
- Voice instructions.
- Trip progress.
- Speed and road context where supported.
- Reroute and route refresh.
- Traffic/incidents/closures for road legs.

Phase 2 full premium:

- Free Drive for Extreme users.
- Route-aware place popups while moving.
- Checkpoint completion from route progress.
- Weather/risk prompts before arrival.
- Co-Pilot voice/text.

Phase 3 UX Framework pilot:

- Prototype the full demo-like experience with the Public Preview framework.
- Evaluate customization, resource conflicts, app size, beta terms, cost, privacy, and how much Trailhead control remains.
- Keep behind server flag.

## Technical Implementation Plan

### Backend

Add:

- `has_extreme_plan(user)`.
- `GET /api/extreme/config`.
- `POST /api/extreme/session/authorize`.
- `POST /api/extreme/session/start`.
- `POST /api/extreme/session/end`.
- `POST /api/extreme/ledger`.
- `GET /api/extreme/kill-switch`.
- `POST /api/trips/{id}/memory`.
- `POST /api/trips/{id}/checkpoints`.

The authorization endpoint returns:

- scoped Mapbox public token
- enabled products
- max session minutes
- style URIs
- feature flags
- required attribution/telemetry copy
- backend session id

### Android Native

Add:

- `ExtremeExplorerActivity` or native module screen.
- Mapbox Maven credentials and dependencies.
- Maps SDK.
- Search SDK.
- Navigation SDK.
- Optional Weather package/module if available under current SDK access.
- UX Framework only in an experimental product flavor or feature branch first.

Bridge to React Native:

- launch Extreme mode
- pass trip/route/checkpoints
- receive selected place
- receive route changes
- receive checkpoint state updates
- receive session metrics
- stop session

### React Native

Add:

- Extreme entry point from Map and Route Builder.
- Paywall gate.
- Extreme session preflight.
- Trip Memory editor/reader.
- Checkpoint model in saved trip and builder state.
- Fallback UI when native Mapbox mode is unavailable.

### Data Models

Trip Memory:

- vehicle
- range
- clearance / trailer / off-road capability
- comfort level
- preferred stays
- avoid rules
- public/private preference
- offline readiness
- risk notes
- recent user edits

Checkpoint:

- id
- trip id
- route id
- type
- title
- note
- lat
- lng
- day
- sequence
- status
- source
- source id
- expires at
- confidence

## Checkpoints For Delivery

### Checkpoint A: Current Release

- Private Stays release verified.
- Backend Railway production deploy.
- Expo OTA production and preview.
- Smoke tests complete.

### Checkpoint B: Extreme Product Spec

- Finalize Extreme Explorer mode UX.
- Finalize billing boundaries.
- Finalize store pricing and entitlement names.
- Finalize UI copy: use Co-Pilot, Guided Nav, Live Route, Trip Memory, Checkpoints.
- Confirm no user-facing developer wording.

### Checkpoint C: Native Feasibility Spike

- Add Mapbox dependencies in a branch.
- Build Android with EAS development profile.
- Render Mapbox Standard in a separate native screen.
- Confirm attribution and telemetry controls.
- Measure app size and cold start.

### Checkpoint D: Premium Map Demo

- Load Extreme map.
- Draw a route line.
- Pop in Mapbox places along route.
- Show Trailhead private stays/camps as overlays.
- Add checkpoint markers.
- Tap place to add/review/save.

### Checkpoint E: Guided Nav Beta

- Start Active Guidance only after user tap.
- Stop session reliably.
- Voice, camera, progress, reroute, refresh, alternatives.
- Ledger every session.
- Non-Extreme blocked.

### Checkpoint F: Weather + Risk

- Current weather at route start, camp, destination.
- Arrival forecast.
- Weather Along Route / Warnings Along Route if enabled.
- Weather checkpoints with expiry.

### Checkpoint G: Co-Pilot

- Text command bar.
- Trip Memory answers.
- Checkpoint explain/mark complete.
- Find fuel/private stay/camp ahead.
- Shorten day.
- Reroute to safe overnight.

### Checkpoint H: UX Framework / MapGPT Pilot

- Separate experimental branch.
- Test prebuilt exploration/search/active guidance.
- Test weather/fuel/voice assistant features.
- Test custom Trailhead map layers.
- Decide whether to adopt, wrap, or copy patterns using lower-level SDKs.

### Checkpoint I: Pre-Rebuild Controls

- Add dashboard-backed Extreme config overrides.
- Keep Railway `EXTREME_ENABLED` and `EXTREME_KILL_SWITCH` as master safety gates.
- Add admin beta grants for `extreme_beta` accounts without public products.
- Show recent Extreme sessions, ledger events, and 24h activity.
- Keep Navigation, Weather, Voice, MapGPT, Atlas, and Native Mode separately switchable.
- Verify dashboard switches cannot enable features while the master kill switch is on.

## Open Questions

- Mapbox Weather product access and pricing for mobile Navigation SDK customers.
- Whether Search SDK category access covers all desired place types without private beta access.
- Whether UX Framework can be commercially used in production or remains evaluation/public-preview only.
- How much MapGPT event/action control is exposed for Trailhead commands.
- Whether Mapbox Search place data can be stored, cached, or mixed with Trailhead partner/private-stay listings under current terms.
- iOS timing after Android pilot.

## Hard Guardrails

- Base Trailhead cannot depend on Mapbox billable navigation sessions.
- Current Trailhead Terrain stays included.
- Mapbox data cannot be repackaged into Trailhead offline packs without explicit commercial rights.
- Extreme mode must have a remote kill switch.
- Session billing must be observable before public launch.
- UX Framework and MapGPT stay behind a server flag until terms, cost, stability, and customization are proven.
