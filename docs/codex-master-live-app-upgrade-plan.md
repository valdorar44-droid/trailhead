# Trailhead Master Live-App Upgrade Plan for Codex

**Date:** 2026-06-25  
**Branch:** `codex/master-live-app-upgrade-plan`  
**Audience:** Codex / Trailhead engineering  
**Status:** planning + implementation brief for a live app.  
**Primary goal:** unify the recent Trailhead direction into one staged build plan: UI refresh, Route Builder, Recent/Saved/Downloads, Splash/Auth, Copilot, AI Planner, Viator readiness, Outdoor Offers, and template/Figma workflow.

---

## 0. Non-negotiable build rules

This app is live. Codex must treat every change as production-facing.

```txt
No throwaway builds.
No temporary UI.
No dead-end screens.
No hidden commercial placements.
No hardcoded paid API assumptions.
No dumping more logic into map.tsx or route-builder.tsx.
No committing premium template files, font files, paid asset exports, or copied screenshots into the public repo.
```

### Public-copy rule: zero jargon

User-facing copy must not sound like implementation text. Keep it direct, useful, and calm.

Avoid user-facing words like:

```txt
AI
LLM
model
prompt
provider
sandbox
debug
internal
lat/lng
geocode
schema
endpoint
payload
partner API
affiliate attribution
cache miss
route provider failed
```

Use user-facing language like:

```txt
Planner
Copilot
Trip ideas
Route-ready
Saved nearby
Offline-ready
Partner booking
Trailhead may earn
Checkout with partner
Source updated
Map data missing
Try a nearby stop
```

The code can use technical names. The app copy cannot.

---

## 1. Current repo reality

### 1.1 Existing architecture to preserve

Important current files:

```txt
AGENT_WORKFLOW.md
docs/adventure-app-production-readiness-plan.md
docs/copilot-outdoor-commerce-upgrade-plan.md
docs/trailhead-ui-template-research-and-upgrade-plan.md
docs/explore-ui-redesign/TRAILHEAD_VIATOR_TOURS_SOURCEPACK_CODEX_DIRECTIONS.md
mobile/app/_layout.tsx
mobile/app/(tabs)/_layout.tsx
mobile/app/(tabs)/plan.tsx
mobile/app/(tabs)/route-builder.tsx
mobile/app/(tabs)/guide.tsx
mobile/app/(tabs)/map.tsx
mobile/app/(tabs)/profile.tsx
mobile/components/TrailheadLaunchLoader.tsx
mobile/components/WelcomeOnboardingModal.tsx
mobile/lib/design.ts
mobile/lib/api.ts
mobile/lib/offlineTrips.ts
mobile/lib/offlineRoutes.ts
mobile/lib/offlineTrails.ts
mobile/lib/offlinePlacePacks.ts
scripts/explore_sources/travel/viator/client.py
scripts/explore_sources/travel/schema.py
scripts/explore_sources/travel/ranking.py
dashboard/provider_registry.py
dashboard/server.py
dashboard/adventure_intelligence.py
```

### 1.2 Route Builder already has the product surface; it needs hierarchy

Route Builder is not missing outdoor/travel features. It already handles a lot:

```txt
- camps
- gas
- POIs
- excursions
- fuel
- propane
- water fill
- boat ramps
- paddle launches
- fishing access
- marinas
- docks
- shore access
- dump stations
- showers
- laundry
- lodging
- private stays
- farms/ranches/wineries/glamping
- food
- grocery
- mechanics
- parking
- attractions
- trailheads
- viewpoints
- peaks
- passes
- glaciers
- bridges/checkposts/settlements
```

The UI issue is hierarchy, not capability. Codex should reorganize, extract, and clarify.

### 1.3 Current splash/onboarding state

Current launch flow has:

```txt
mobile/app/_layout.tsx
- restores auth/session
- checks OTA updates
- shows TrailheadLaunchLoader
- auto-shows WelcomeOnboardingModal on first open
- requests foreground location after launch loader

mobile/components/TrailheadLaunchLoader.tsx
- animated dark route/contour loading overlay
- brand lockup
- progress bar

mobile/components/WelcomeOnboardingModal.tsx
- first-run bottom-sheet onboarding
- pages for Explore, Route, Map, Ready
- last CTA goes to Profile / rig setup
```

New direction: keep the native/animated launch loader, replace the first-run modal with a full welcome gate, and move onboarding into Profile as optional help.

### 1.4 Current Plan / AI Planner state

`mobile/app/(tabs)/plan.tsx` is the current AI trip planner surface. It already has:

```txt
- message thread
- trip result cards
- examples: wild trip, rig, field brief
- loading stages
- location resolution
- user-facing text filter that strips lat/lng/debug/geocode/internal wording
- offline trip save/load hooks
```

This is good scaffolding, but the surface should become a structured planner with cards and staged actions, not just a chat transcript.

### 1.5 Current tabs

Current tab layout:

```txt
PLAN
MAP
ROUTE
REPORT
EXPLORE
PROFILE
```

Short-term: keep this to avoid destabilizing navigation.  
Next pass: consider replacing `REPORT` with `SAVED` or moving Reports under Map/Today if telemetry shows low direct tab usage.

---

## 2. Product direction

Trailhead is now:

```txt
Outdoor Trip OS
```

Not:

```txt
Overlanding-only app
Generic travel app
Tour marketplace
Map clutter app
Chatbot toy
```

Trailhead should clearly support:

```txt
Routes
Trails
Camps
Tours
Safaris
Fishing/boating
Water access
Gear and rig readiness
Services
Offline navigation
Recent/saved places
AI-assisted trip planning, but not AI-sounding copy
```

Product promise:

```txt
Plan the trip, find what fits the route, save what matters, and stay ready offline.
```

---

## 3. Template strategy: reference, not overhaul

### 3.1 Do not skin Trailhead with one travel template

A generic travel planner template will not understand:

```txt
route corridors
offline route graphs
map layers
camp legality
rig fit
water/fuel gaps
hazards
source/freshness
community reports
partner/sponsored disclosure
Viator sandbox vs Full Access
```

So templates should be used as **reference and component discipline**, not as a full overhaul.

### 3.2 Template stack to use

Use this stack:

```txt
Design backbone:
- Untitled UI Figma
- Untitled UI Icons

Copilot / Planner / Mission Control references:
- Setproduct Nocra UI kit
- Setproduct Orion or Figma Charts if we need status/data tiles
- Envato AI Startup Dashboard as a dashboard composition reference

Mobile screen reference:
- Setproduct Mobile X or Nucleus
- Mobbin subscription for real shipped patterns

Travel planner reference:
- Creative Market Trip Planner Mobile App UI Kit by Betush
- Envato travel planner / travel onboarding / itinerary UI searches

Implementation reference only:
- Creative Tim React Native templates
- Tailwind Plus for web/admin/partner portal, not mobile core
```

### 3.3 Research notes / URLs

```txt
Envato UX/UI Kits:
https://elements.envato.com/graphic-templates/ux-and-ui-kits

Envato AI Startup Dashboard:
https://elements.envato.com/ai-startup-dashboard-SW78S3D

Untitled UI:
https://www.untitledui.com/

Setproduct:
https://www.setproduct.com/

Mobbin:
https://mobbin.com/

Creative Tim React Native templates:
https://www.creative-tim.com/templates/react-native

Tailwind Plus templates:
https://tailwindui.com/templates

Creative Market Trip Planner Mobile App UI Kit:
https://creativemarket.com/betush/7242770-Trip-Planner-Mobile-App-UI-Kit
```

### 3.4 How to use templates safely

Codex must not paste a template into the app.

Use templates like this:

```txt
1. Identify the pattern.
2. Translate it into Trailhead components.
3. Use current Trailhead colors/tokens.
4. Preserve existing data and behavior.
5. Add source/freshness/disclosure where Trailhead needs it.
6. Typecheck.
7. Save an audit note.
```

Do not commit:

```txt
paid Figma files
paid template exports
font files
premium icons
screenshots from paid libraries unless license explicitly allows it
```

---

## 4. Figma workflow for Codex

### 4.1 Required Figma file structure

Create one Figma file:

```txt
Trailhead Outdoor Trip OS - 2026 Refresh
```

Pages:

```txt
00 README / Rules
01 Reference Board
02 Tokens
03 Core Components
04 Splash + Welcome Gate
05 Auth + Profile Access
06 Route Builder
07 Recent / Saved / Downloads Library
08 Copilot + Planner
09 Mission Control
10 Explore Polish
11 Map Pins + Sheets
12 Prototype Flows
13 Handoff Specs
```

### 4.2 What goes in Reference Board

Reference Board must include:

```txt
- source URL
- screenshot or thumbnail only if license permits
- what to learn from it
- what not to copy
- target Trailhead surface
- component names to create
```

Use `docs/reference/trailhead-ui-reference-board.json` as the structured manifest.

### 4.3 Figma-to-Codex handoff

Preferred process:

```txt
1. Build or adapt the design in Figma using Trailhead tokens.
2. Name frames exactly after component targets.
3. Add redline/spec notes in Figma.
4. Export only approved local reference screenshots to design/reference/*.png if license permits.
5. Add component mapping in docs/reference/trailhead-ui-reference-board.json.
6. Give Codex either:
   - Figma link + exact frame names
   - exported screenshots + JSON specs
   - copied Figma CSS/layout values
```

### 4.4 Figma MCP / Dev Mode guidance

If Figma Dev Mode MCP is available in the user's editor, use it as context, not authority. The goal is to let Codex read exact design values instead of guessing from images.

Rules:

```txt
- Prefer official Figma MCP / Dev Mode paths over third-party MCP packages.
- Do not use untrusted MCP packages with shell execution.
- Codex must map Figma components to existing React Native components instead of generating isolated one-off UI.
- Every generated component must use Trailhead tokens from mobile/lib/design.ts or new token maps.
- Run TypeScript after every stage.
```

Source note:

```txt
Figma MCP / Dev Mode context is useful because it can expose design data to coding agents instead of relying only on screenshots. Remote/IDE access and Make MCP support were reported in 2025. Treat this as optional tooling; the build must still work from screenshots + specs if MCP is unavailable.
```

---

## 5. Splash, Welcome Gate, auth, and optional onboarding

### 5.1 Keep native splash short

The native splash should be only:

```txt
Trailhead icon
single dark background
brief fade
no extra copy
```

Use Expo splash config/plugin properly. Expo's SplashScreen docs say the module controls native splash visibility, config plugin is recommended for properties requiring a new build, and splash should hide as soon as possible after app readiness.

### 5.2 Keep TrailheadLaunchLoader as the branded transition

`TrailheadLaunchLoader` is already good. It has the right direction:

```txt
dark gradient
contour motion
route line
pins
brand lockup
loading maps and places
```

Refine copy to be broader:

```txt
Loading your trip space
Preparing maps and places
Checking saved trips
```

Avoid:

```txt
Loading AI
Loading providers
Geocoding
Syncing debug data
```

### 5.3 Replace automatic onboarding modal with Welcome Gate

Current first-run `WelcomeOnboardingModal` should no longer auto-pop after 900ms. It should remain accessible from Profile as **App walkthrough**.

New first-run gate:

```txt
Welcome to Trailhead
Plan routes. Find places. Stay ready offline.

[Create account]
[Log in]
[Continue for now]

Small hint:
Need the walkthrough later? Open Profile → App walkthrough.
```

Buttons:

```txt
Create account -> Profile auth/register or dedicated auth route
Log in -> Profile auth/login or dedicated auth route
Continue for now -> Explore tab
```

Storage keys:

```txt
trailhead_welcome_gate_seen_v1
trailhead_profile_walkthrough_hint_seen_v1
```

### 5.4 Auth route plan

Short-term, safest live path:

```txt
- Keep current Profile auth implementation.
- Add WelcomeGate buttons that deep-link to Profile with a param:
  /(tabs)/profile?auth=register
  /(tabs)/profile?auth=login
- Profile reads auth param and sets view to register/login.
```

Longer-term:

```txt
mobile/app/(auth)/welcome.tsx
mobile/app/(auth)/login.tsx
mobile/app/(auth)/register.tsx
```

Do not block app usage behind login unless a feature truly requires an account.

### 5.5 Splash / welcome visual references

Use these as reference only:

```txt
- bold simple brand splash with Sign in/Register: Wanderly-style travel login
- image-led travel sign-in: Trip Planner / TripLane style
- dark teal travel onboarding: Comfort-style dark theme
- illustrated travel onboarding: good for ideas, not Trailhead identity
```

Trailhead final direction:

```txt
dark topo/route background
logo centered
one confident headline
three action buttons
small walkthrough hint
no carousel unless opened from Profile
```

---

## 6. Route Builder rework

### 6.1 Product goal

Route Builder should feel like a trip workspace, not a long form.

New mental model:

```txt
Command -> Timeline -> Suggestions -> Save/Download
```

### 6.2 Screen hierarchy

```txt
Route Command Header
  - Start
  - Destination
  - Add stop
  - Trip mode chips
  - Planner button

Recent + Saved Strip
  - recently viewed
  - saved stops
  - downloaded areas
  - imported GPX

Route Timeline
  - day cards
  - stops
  - overnight
  - drive time/miles
  - status chips

Smart Suggestions Drawer
  - camps
  - services
  - things to do
  - tours/safaris/guides
  - gear/rig
  - recent nearby

Mission Mini Card
  - route health
  - offline readiness
  - next action
```

### 6.3 Components to create

```txt
mobile/components/trip/TripCommandHeader.tsx
mobile/components/trip/TripModeChips.tsx
mobile/components/trip/RouteTimeline.tsx
mobile/components/trip/RouteDayCard.tsx
mobile/components/trip/RouteStopPill.tsx
mobile/components/trip/RecentPlacesRail.tsx
mobile/components/trip/RecentPlaceCard.tsx
mobile/components/trip/SmartSuggestionDrawer.tsx
mobile/components/trip/SuggestionGroup.tsx
mobile/components/trip/SuggestionCard.tsx
mobile/components/offline/OfflineReadinessStrip.tsx
mobile/components/mission/MissionMiniCard.tsx
```

### 6.4 Trip modes

Use chips:

```txt
Outdoors
Road Trip
Hike
Water
Fish
Safari
City Reset
Overland
```

These are not just labels. They influence suggestions:

```txt
Outdoors -> parks, trails, camps, views, weather, offline
Road Trip -> fuel, food, lodging, sights, storage, route comfort
Hike -> trailheads, shuttles, gear checklist, weather, water
Water -> launches, marinas, tides, dry bags, boat/kayak rentals
Fish -> access, charters, fly shops, water levels, permits
Safari -> tours, wildlife, transfers, multi-day operator options
City Reset -> luggage storage, food, showers, laundry, indoor/rain backup
Overland -> fuel, water, mechanics, recovery gear, legal camps, MVUM/offroad
```

### 6.5 Route day cards

Each day card should show:

```txt
Day 2
238 mi · 4h 20m
Theme: scenic drive + trail
Status chips: Camp needed · Fuel OK · Offline partial
Primary stop
Overnight
Suggestion preview
Actions: Map · Edit · Add stop · Find camp · Ideas · Download
```

### 6.6 Smart Suggestions drawer

A drawer should replace scattered discovery tabs.

Sections:

```txt
Camps
Fuel / water / food
Trails / things to do
Tours / safaris / guides
Gear / rig checklist
Recent nearby
Offline downloads
```

Every suggestion card needs:

```txt
title
category chip
distance/context
why this appears
source/freshness
CTA
commercial disclosure if applicable
```

### 6.7 Recent places in Route Builder

Route Builder should immediately show recent/saved items so it feels like an ongoing workspace.

Rows:

```txt
Recently viewed
Saved for this trip
Downloaded nearby
Imported GPX
```

Cards support:

```txt
Trail
Camp
Tour
Safari
Gear
Service
Water
Fish
Boat
City
Offline
```

---

## 7. Recent / Saved / Downloads Library

### 7.1 Should offline downloads be reworked like a filesystem?

Yes, but only as a mobile-friendly library, not a desktop file explorer.

Use a **Library** model:

```txt
Trips
Places
Downloads
Imports
Activity Packs
Gear Lists
```

This gives users a place to understand what is saved, what is offline, what is stale, and what can be deleted or updated.

### 7.2 Why this matters

Offline-first navigation apps organize saved/downloaded data around regions, map files, favorites/bookmarks, tracks/routes, and downloaded guide data. Google Maps uses downloaded areas and saved lists; OsmAnd organizes offline maps by region/map files and supports favorites/POIs/routes; Google Maps offline flow requires users to download areas before offline use and supports offline search/place info/driving directions for downloaded areas.

Trailhead should combine:

```txt
Google Maps-style simple offline areas
OsmAnd-style downloaded regions/routes/favorites
Trailhead-specific trip packs and meeting-point packs
```

### 7.3 New data model

```ts
type TrailheadLibraryItem = {
  id: string;
  kind:
    | 'trip'
    | 'place'
    | 'camp'
    | 'trail'
    | 'route'
    | 'offline_pack'
    | 'map_area'
    | 'activity'
    | 'gear_list'
    | 'gpx_import';
  title: string;
  subtitle?: string;
  category_tags: string[];
  lat?: number;
  lng?: number;
  trip_id?: string;
  route_id?: string;
  source?: string;
  source_freshness?: string;
  offline_state: 'none' | 'partial' | 'ready' | 'stale' | 'failed';
  last_opened_at?: number;
  saved_at?: number;
  updated_at?: number;
  size_bytes?: number;
};

type TrailheadCollection = {
  id: string;
  title: string;
  kind: 'trip' | 'manual' | 'download' | 'auto_recent' | 'import';
  item_ids: string[];
  created_at: number;
  updated_at: number;
};
```

### 7.4 Library surfaces

Short-term:

```txt
Profile -> Saved section becomes Library
Route Builder -> Recent/Saved strip
Explore -> Save/Open/Downloaded labels
Map -> selected item can Save/Add/Download
```

Longer-term:

```txt
New tab: Saved or Library
```

If replacing a tab, consider replacing Report with Saved only if Report usage is low. Reports can remain accessible from Map/Mission Control.

### 7.5 Offline pack states

Each downloaded item should show:

```txt
Map tiles
Road routing
Trail graph
Places
Weather cache
Reports cache
Partner meeting point
```

States:

```txt
Missing
Partial
Ready
Stale
Failed
```

User copy:

```txt
Ready offline
Needs map download
Route graph missing
Weather cached yesterday
Update available
```

Avoid:

```txt
tile server missing
provider stale
valhalla artifact missing
cache invalid
```

---

## 8. Copilot + Planner theme and logic

### 8.1 User-facing position

The app can use AI internally, but the user-facing product should be:

```txt
Planner
Copilot
Trip ideas
Route brief
Mission Control
```

Avoid making screens sound like:

```txt
AI Chat
LLM planner
Prompt builder
Model thinking
Generated output
```

### 8.2 AI Planner should become structured planning

Current Plan screen should evolve into:

```txt
Planner command box
Trip draft card
Route timeline preview
Mission Control mini brief
Suggested next steps
Chat/help underneath
```

Pipeline:

```txt
1. Understand request
2. Resolve places
3. Build route spine
4. Create day windows
5. Find camps/services/stops
6. Find route-fit activities and partner options if available
7. Build offline readiness checklist
8. Produce user-facing brief
9. Stage actions for confirmation
```

Only step 8 needs natural language. All earlier steps should be deterministic where possible.

### 8.3 Copilot recommendation behavior

Copilot should ask only at high-intent moments:

```txt
- user finishes a plan
- user opens a destination hub
- user saves a place/trail/camp
- user has open time on a day card
- user asks what to do
- user asks what to bring
- route has weather/service/offline gaps
```

Never ask during:

```txt
- active turn-by-turn guidance near a maneuver
- active safety alert
- low confidence
- no real useful suggestions
- after recent dismissal
```

Good prompt:

```txt
You have a few hours open near the park entrance. I found a guided wildlife option, a rain backup, and a gear checklist that fit this day. Want to see them?
```

Bad prompt:

```txt
I used AI to find affiliate offers from providers. Want to buy tours?
```

### 8.4 Copilot card structure

Cards should show:

```txt
title
why this appears
source/freshness
partner/sponsored disclosure if needed
action chips
```

Action chips:

```txt
Show top 3
Add to Day 2
Save for later
Gear checklist
Hide partner picks
Only free/official options
Download offline
```

### 8.5 Suggested components

```txt
mobile/components/copilot/CopilotContextStrip.tsx
mobile/components/copilot/CopilotBriefCard.tsx
mobile/components/copilot/CopilotRecommendationCard.tsx
mobile/components/copilot/CopilotActionCard.tsx
mobile/components/copilot/CopilotActionDock.tsx
mobile/components/copilot/CopilotMessageBubble.tsx
mobile/components/copilot/CopilotTripDraft.tsx
```

### 8.6 Backend planning changes

Codex should review:

```txt
ai/planner.py
dashboard/adventure_intelligence.py
dashboard/server.py
mobile/app/(tabs)/plan.tsx
mobile/lib/api.ts
```

Target backend split:

```txt
request parser
place resolver
route compiler
day-window builder
context gatherer
Mission Control brief
offer/recommendation brief
safe copy composer
```

No one function should own all of this long term.

---

## 9. Viator, providers, and API reality

### 9.1 Current reality

Viator access is currently sandbox / starter. That is normal.

Do not wait for Full Access to build the product experience.

Build:

```txt
sandbox fixtures
safe empty fallback
external checkout placeholder
click/impression tracking
save to planner
meeting-point/offline pack shape
Full Access request readiness
```

### 9.2 Viator path

Short-term:

```txt
- Add/verify env vars
- Use sandbox or fixtures
- Build endpoint wrappers
- Show source and checkout handoff
- Track clicks/saves
- Do not claim booking confirmed
```

Future:

```txt
- Apply for Full Access after app can show traffic/conversion
- Add richer product data after approval
- Full + Booking only after approval/certification
```

### 9.3 Missing APIs are okay

Codex must understand that not all providers are available yet. Bridge with adapters.

Provider states:

```txt
disabled
configured_affiliate_link
fixture_only
sandbox
live_read_only
live_external_checkout
live_booking_future
```

User-facing copy should never say:

```txt
provider not configured
API unavailable
sandbox mode
```

User-facing fallback:

```txt
No partner options here yet.
Try nearby trails, camps, and official places.
```

### 9.4 Provider categories

Prepare adapters for:

```txt
Viator
GetYourGuide
Klook
FareHarbor
Rezdy
Bókun
Bounce
RVshare
Outdoorsy
The Dyrt
Outdooractive
gear affiliate links
rig parts affiliate links
direct local operators
```

But only Viator needs to be production-shaped first.

---

## 10. Outdoor offers and sponsored recommendations

### 10.1 Offer types

```txt
tour
safari
guide
activity
rv rental
vehicle rental
luggage storage
gear
rig part
shuttle
permit
pass
food
rental
operator deal
service
```

### 10.2 Commercial labels

Every commercial item must show one:

```txt
Partner booking
Sponsored
Paid link
Trailhead may earn
Operator-sponsored
```

### 10.3 Map pin rules

```txt
max 1 sponsored pin per viewport
max 3 partner pins per viewport
hide sponsored pins at low zoom
never cover route line
never style as safety/official/community pins
always show why this appears
always show disclosure
```

### 10.4 Offer ranking

Use this logic:

```txt
intent match
place DNA match
route relevance
distance
weather fit
time fit
rating/review confidence
source/freshness
offline pack value
commercial fatigue penalty
safety conflict penalty
missing disclosure penalty
```

Sponsored can break close ties, not override safety or relevance.

---

## 11. Explorer light polish

Explorer is already moving in the right direction. Do not overhaul first.

Polish:

```txt
clearer category chips
source/freshness rows
route-fit recommendation rows
bookable/partner rail kept calm
better empty states
less generic text
stronger save/download actions
```

Explorer hero should show:

```txt
Title
Activity chips
Source/freshness
Map / Route / Save / Download
Route-fit ideas
Nearby rails
```

---

## 12. Profile and onboarding cleanup

### 12.1 Profile stays the account/control center

Profile should own:

```txt
Account
Rig / vehicle
Library / saved
Downloads
Imports
Support
Settings
App walkthrough
```

### 12.2 Move onboarding into Profile

`WelcomeOnboardingModal` becomes:

```txt
Profile -> App walkthrough
```

No first-run auto-popup unless user asks.

### 12.3 Auth surface

Short-term:

```txt
WelcomeGate -> Profile with auth param
Profile displays login/register cleanly
Skip goes to Explore
```

Long-term:

```txt
separate auth route group
```

---

## 13. Reference board for screenshots and templates

Codex cannot rely on glancing at screenshots. Use structured extraction.

### 13.1 Reference manifest location

```txt
docs/reference/trailhead-ui-reference-board.json
```

Each entry should include:

```json
{
  "id": "travel-onboarding-photo-card",
  "source_url": "...",
  "source_type": "public_visual_reference",
  "target_surfaces": ["welcome_gate", "auth"],
  "extract_patterns": ["..."],
  "do_not_copy": ["..."],
  "codex_component_targets": ["..."]
}
```

Allowed `source_type` values should match the structured reference board,
including `paid_figma_design_system`, `paid_figma_ai_ui_kit`,
`paid_figma_dashboard_kit`, `paid_mobile_figma_pattern_library`,
`subscription_reference_library`, `paid_envato_figma_dashboard_template`,
`paid_travel_planner_mobile_ui_kit`, `public_visual_reference`,
`official_technical_docs`, `official_product_help_reference`,
`product_docs_reference`, `current_repo_surface`, and
`official_tooling_reference`.

### 13.2 Public reference examples already identified

```txt
Behance ExploreTrip onboarding/login
- use for welcome/login button hierarchy only
- do not copy bright blue travel identity

Behance / Dribbble travel onboarding examples
- use for photo/illustration + short headline pattern
- do not use multi-slide forced onboarding by default

Creative Market Trip Planner UI Kit
- use for itinerary/list/calendar inspiration
- do not overhaul Trailhead with pastel travel styling

Envato AI Startup Dashboard
- use for status-card/dashboard composition
- not mobile core and not final dark Trailhead styling

Untitled UI
- use for component discipline
- not final aesthetic

Setproduct Nocra/Orion/Mobile X/Nucleus
- use for structured cards, data tiles, mobile layout discipline
- translate into Trailhead tokens

Mobbin
- use for real login, bottom sheet, saved, search, chat, recommend, onboarding, paywall, and explore flows
- do not copy shipped screens directly
```

---

## 14. Implementation plan for tonight and tomorrow

### Stage A — Tonight: audit and low-risk structural docs

Deliver:

```txt
docs/live-upgrade-stage-a-audit.md
```

Tasks:

```txt
1. Confirm route-builder overloaded areas.
2. Confirm current WelcomeOnboardingModal auto-show path.
3. Confirm Plan screen messages/stages and userFacingAiText filter.
4. Confirm saved/offline modules and Profile saved/downloads state.
5. Confirm Viator routes are missing or present.
6. List exact component extraction targets.
```

Validation:

```bash
cd mobile && npx tsc --noEmit
python3 -m py_compile dashboard/server.py
```

### Stage B — Tonight: copy/tone guardrail

Deliver:

```txt
mobile/lib/userFacingCopy.ts
docs/live-upgrade-stage-b-copy-guardrail.md
```

Tasks:

```txt
- centralize forbidden public-copy terms
- add sanitizeUserFacingCopy helper
- apply first to Plan/Copilot response surfaces only
- ensure no visible lat/lng/debug/internal/geocode/provider/sandbox wording leaks
```

### Stage C — Tonight: Welcome Gate plan + component shell

Deliver:

```txt
mobile/components/welcome/WelcomeGate.tsx
mobile/lib/welcomeGate.ts
docs/live-upgrade-stage-c-welcome-gate.md
```

Tasks:

```txt
- build component behind feature flag or storage gate
- no auto onboarding modal on first launch
- buttons: Create account, Log in, Continue for now
- hint: Profile -> App walkthrough
- keep WelcomeOnboardingModal callable from Profile
```

Do not change auth architecture deeply tonight.

### Stage D — Tomorrow: design tokens and activity theme

Deliver:

```txt
mobile/lib/activityTheme.ts
docs/live-upgrade-stage-d-activity-theme.md
```

Tasks:

```txt
- activity chip tokens for Trail/Camp/Water/Fish/Boat/Climb/Off-road/Scenic/Safari/City Reset/Gear/Service/Tour/Offline
- shared badge/disclosure/status primitives
- no full restyle yet
```

### Stage E — Tomorrow: Route Builder shell extraction

Deliver:

```txt
mobile/components/trip/TripCommandHeader.tsx
mobile/components/trip/RouteDayCard.tsx
mobile/components/trip/RouteTimeline.tsx
mobile/components/trip/RecentPlaceCard.tsx
mobile/components/trip/RecentPlacesRail.tsx
docs/live-upgrade-stage-e-route-builder-shell.md
```

Tasks:

```txt
- extract visual shell components
- keep existing logic and data
- wrap old route day plan data in new cards
- add broader trip mode chips
- show recent/saved strip
```

### Stage F — Tomorrow: Viator readiness pass

Deliver:

```txt
docs/live-upgrade-stage-f-viator-readiness.md
```

Tasks:

```txt
- confirm sandbox config
- add missing env vars if needed
- verify or add safe empty endpoints
- add fixture route if live disabled
- ensure source/disclosure/external checkout only
- no in-app booking
```

### Stage G — Tomorrow: Planner/Copilot structured-card spike

Deliver:

```txt
mobile/components/copilot/CopilotBriefCard.tsx
mobile/components/copilot/CopilotActionCard.tsx
mobile/components/copilot/CopilotRecommendationCard.tsx
docs/live-upgrade-stage-g-copilot-cards.md
```

Tasks:

```txt
- build cards with mock/static data first
- wire only after component shape is stable
- public copy uses Planner/Copilot, not AI/model language
```

---

## 15. Codex kickoff prompt

Use this with Codex:

```txt
You are working in the Trailhead repo.

Read first:
1. AGENT_WORKFLOW.md
2. docs/adventure-app-production-readiness-plan.md
3. docs/copilot-outdoor-commerce-upgrade-plan.md
4. docs/trailhead-ui-template-research-and-upgrade-plan.md
5. docs/codex-master-live-app-upgrade-plan.md
6. docs/reference/trailhead-ui-reference-board.json
7. mobile/app/_layout.tsx
8. mobile/components/TrailheadLaunchLoader.tsx
9. mobile/components/WelcomeOnboardingModal.tsx
10. mobile/app/(tabs)/_layout.tsx
11. mobile/app/(tabs)/plan.tsx
12. mobile/app/(tabs)/route-builder.tsx
13. mobile/app/(tabs)/profile.tsx
14. mobile/lib/design.ts
15. mobile/lib/api.ts
16. scripts/explore_sources/travel/viator/client.py
17. dashboard/provider_registry.py
18. dashboard/server.py

This is a live app. Do not make throwaway UI or temporary half-builds.

Rules:
- Preserve production behavior unless the task explicitly changes it.
- Do not dump more logic into route-builder.tsx or map.tsx.
- Extract reusable components.
- Keep Trailhead's dark outdoor OS identity.
- Make the app feel broader than overlanding: trails, camps, tours, safaris, water, gear, services, offline.
- Use templates as reference, not as overhaul source.
- Do not commit premium template files, screenshots, paid assets, or font files.
- User-facing copy must avoid AI/model/provider/sandbox/debug/lat-lng/dev wording.
- Viator is sandbox/starter right now; build fixtures/safe empty/external checkout only.
- Not all provider APIs exist yet; use adapter states and graceful fallbacks.
- Every commercial recommendation needs visible disclosure.
- Every recommendation needs a why/source/freshness/context line.
- Add an audit note after each stage.
- Run mobile typecheck and backend compile where relevant.

Start with Stage A audit. Then Stage B copy guardrail. Then Stage C Welcome Gate.
```

---

## 16. Validation commands

Mobile:

```bash
cd mobile
npx tsc --noEmit
npm run audit:routes
```

Backend:

```bash
python3 -m py_compile dashboard/server.py
python3 -m py_compile dashboard/provider_registry.py
python3 -m unittest tests.test_viator_sourcepack
```

Repo hygiene:

```bash
git diff --check
```

Live-app manual QA:

```txt
Fresh install, signed out
Fresh install, skip account
Fresh install, create account
Fresh install, log in
Existing user with active trip
Existing user with offline trip
No network on launch
No location permission
Profile -> App walkthrough
Plan tab route creation
Route Builder existing trip
Route Builder recent/saved strip
Explore detail with no partner offers
Explore detail with Viator fixture
Map tab no commerce clutter
Offline download list/update/delete
```

---

## 17. Definition of done

This master upgrade is on track when:

```txt
The first screen feels premium and clear.
Users can create account, log in, or continue without friction.
Onboarding is optional from Profile, not forced.
Route Builder feels like a broad outdoor/travel workspace.
Recent/Saved/Downloads feel like a library.
Planner and Copilot use structured cards and staged actions.
User-facing copy has no AI/dev/provider/sandbox wording.
Viator sandbox path is ready without pretending Full Access exists.
Missing APIs degrade gracefully.
Templates inform components but do not replace Trailhead identity.
Figma handoff is structured enough for Codex to implement without guessing.
All changes are production-safe and typechecked.
```
