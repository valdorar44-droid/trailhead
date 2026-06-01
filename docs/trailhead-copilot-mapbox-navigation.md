# Trailhead Co-Pilot Mapbox Navigation Plan

Status: research/design only. Ship Private Stays first. Keep Trailhead's MapLibre, Valhalla, Trailhead tiles, and offline stack as the durable base; add Mapbox as a paid guided-navigation layer later, not as a replacement for the main map.

## Direction

- Keep base Trailhead on MapLibre, Trailhead tiles, Route Builder, offline packs, Valhalla/offline routing, camps, private stays, trails, water, public-land context, and community reports.
- Keep current Explorer benefits intact.
- Add a higher paid plan later for Trailhead Co-Pilot.
- Use Mapbox Navigation only for explicit paid Guided Nav sessions.
- Do not migrate the main Explore map to Mapbox in this pass.
- Do not paywall current 3D terrain. Current 3D remains Trailhead Terrain.
- Do not use Mapbox data to build Trailhead offline packs unless a separate commercial agreement explicitly allows it.

## Product Shape

User-facing feature name: Trailhead Co-Pilot.

Possible paid plan names:

- Extreme Explorer
- Explorer Co-Pilot

Initial store product ids:

- `com.trailhead.extreme.monthly.v1`
- `com.trailhead.extreme.annual.v1`

Backend entitlement:

- Existing Explorer remains `has_active_plan(user)`.
- Co-Pilot surfaces require a future `has_extreme_plan(user)` check.

User-facing copy should use:

- Co-Pilot
- Guided Nav
- Live Route
- Trip Memory
- Checkpoints

Avoid app UI copy such as:

- AI
- framework
- provider
- SDK
- Mapbox stack
- route spine

## Co-Pilot Features

### Trip Memory

Store Trailhead-owned per-trip intent:

- vehicle
- range
- comfort level
- preferred stays
- avoid rules
- public/private camp preference
- offline readiness
- risk notes
- recent user edits

Trip Memory should support plain-language actions such as "why this route?", "make day 2 shorter", "find fuel ahead", "where was tonight's camp?", and "what do I still need before leaving service?"

### Checkpoints

Create route-aware checkpoints for:

- fuel
- water
- camp
- private stay
- trailhead
- risk area
- offline boundary
- bailout town

Checkpoint fields:

- checkpoint type
- title
- lat/lng
- day
- status
- source stop id when derived from a camp, fuel stop, or place
- short note

Show checkpoints as plain-language milestones such as "Fuel before the remote stretch", "Tonight's camp", "Last reliable signal", and "Private stay to review". Co-Pilot can mark checkpoints complete, skipped, or needs review without changing the saved trip unless the user confirms.

### Guided Nav

- Android-first native Mapbox Navigation SDK pilot.
- Start Mapbox billing only when a paid user taps `Start Guided Nav`.
- Never call `startTripSession` during normal browsing, route preview, or background map use.
- Stop sessions cleanly when navigation ends or the user exits the guided surface.
- Use stable Mapbox Navigation SDK GA first; avoid alpha releases for production.
- Keep Trailhead Valhalla/offline route as fallback when Mapbox cannot represent the route cleanly.

### Trailhead Actions

Initial command actions should stay Trailhead-owned:

- Add fuel ahead.
- Find legal camp near the day endpoint.
- Find a private stay near the route.
- Shorten today.
- Avoid highways, sand, or technical roads.
- Download offline packs for this trip.
- Explain next checkpoint.
- Reroute to nearest safe overnight.

## Integration Phases

### Phase 1: Android Guided Nav Beta

- Add a native Android Guided Nav screen beside existing `NativeMap`.
- Use the stable Mapbox Navigation SDK line.
- Use the normal OpenGL renderer first.
- Include route line, navigation camera, voice, trip progress, speed/road context where supported, reroute, and traffic/incidents for road legs.
- Require active Extreme/Co-Pilot entitlement before initializing Mapbox Navigation.

### Phase 2: Co-Pilot Command Bar

- Start text-first in Map and Route Builder.
- Use the Trailhead planner and Trailhead data as the decision layer.
- Add Mapbox Search/Navigation context only for premium live guidance.

### Phase 3: Voice/MapGPT Pilot

- Android only until access, pricing, and terms are clear.
- Use MapGPT-style location/nav conversation only if it can respect Trailhead action boundaries and privacy rules.
- Keep Trailhead knowledge in Trailhead: camps, private stays, public land, route readiness, offline packs, trails, water, reports, and trip context.

### Phase 4: Vulkan Test Lane

- Server-side flag only.
- Android 12+ and `arm64-v8a` only.
- Crash/performance telemetry required.
- Automatic fallback must be implemented at Trailhead level before any wider rollout.
- Vulkan is an internal performance option, not a premium promise.

## Cost Guardrails

- Extreme/Co-Pilot users only can initialize Mapbox Navigation.
- No Mapbox Navigation session during free browsing.
- No passive Free Drive for free users.
- Backend returns a scoped Mapbox public token only for authorized Co-Pilot sessions.
- Log intended session start before the native screen opens.
- Add a server-side usage ledger with user id, plan type, platform, session start/end, route id, active guidance vs free drive, and estimated billable units.
- Add monthly safety limits, heavy-use warnings, admin cost reporting, and a remote kill switch for Co-Pilot Guided Nav.

## Test Plan

Private Stays release:

- `git diff --check`
- Python compile for backend/planner/ingestors
- Mobile TypeScript no-emit
- Route Builder audit
- Railway deploy
- Expo OTA
- Smoke `/api/config`, private-stay camp filters, Route Search `Private Stays`, Route Builder private-stay preference, and confirm 3D toggle is not paywalled.

Native Co-Pilot beta:

- Android physical-device tests for route start, pause, resume, and end.
- Reroute after off-course.
- No signal, weak GPS, background, and foreground behavior.
- Billing session stops when user exits.
- Non-Extreme user cannot launch Guided Nav.
- Fallback to Trailhead nav when the route is not Mapbox-safe.
- Copy QA confirms no visible "AI", "SDK", "provider", "framework", or developer wording in premium surfaces.
