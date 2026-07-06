# Trailhead UI Template Research + Upgrade Plan

**Date:** 2026-06-24  
**Branch:** `codex/ui-template-research-route-builder-copilot`  
**Goal:** use premium UI/template references to upgrade Trailhead from an overlanding-heavy app into a broader outdoor/travel planning OS.

---

## 0. Executive recommendation

Do **not** buy one travel template and try to skin Trailhead with it. Trailhead is now broader than a generic travel planner and more complex than a typical map app. Use a **template stack**:

1. **Design-system backbone** for clean cards, forms, sheets, chips, menus, empty states, and settings.
2. **Travel/planner inspiration** for itineraries, recent places, destination cards, route day summaries, saved places, and trip folders.
3. **AI/chat/dashboard inspiration** for Copilot, Mission Control, AI trip planning, recommendation reasoning, and readiness summaries.
4. **Outdoor/navigation custom layer** for the parts no marketplace template will solve: route builder, offline readiness, route corridor logic, map pins, hazards, trail/camp/service cards, and field-mode UX.

Recommended purchase/research stack:

```txt
Primary backbone: Untitled UI Figma + Untitled UI Icons
AI/dashboard modules: Setproduct Nocra UI kit + Orion/Figma Charts if needed
Mobile component inspiration: Setproduct Mobile X or Nucleus UI
Envato: use as broad search pool for travel visuals, AI dashboards, mockups, and UX/UI kits
Mobbin: use for real-world mobile patterns/flows, not as a template
Creative Tim React Native: optional implementation reference, not final visual direction
Tailwind Plus: optional web/dashboard/admin/marketing reference, not mobile app core
```

---

## 1. Research findings

### 1.1 Envato Elements

URL checked:

```txt
https://elements.envato.com/
https://elements.envato.com/graphic-templates/ux-and-ui-kits
https://elements.envato.com/ai-startup-dashboard-SW78S3D
```

Useful facts:

- Envato has UX/UI kits under Graphic Templates.
- It supports Figma as a template/tool format.
- It is strong for broad asset coverage: graphic templates, UI kits, mockups, icons, presentations, nature/adventure visuals, and AI/dashboard visual references.
- The `AI Startup Dashboard` item is Figma-supported, layered/vector, and positioned for AI-powered dashboards, analytics, real-time monitoring, and modular admin panels.

Verdict:

```txt
Use Envato as an asset and visual-reference library, not the primary Trailhead app redesign source.
```

Best Envato use cases for Trailhead:

- AI dashboard inspiration for Copilot / Mission Control.
- Mockups and promo assets.
- Travel presentation / landing-page material.
- Extra icon/illustration/3D/adventure visual assets.
- A source for secondary UI patterns if an item has Figma files and clean layers.

Do not rely on Envato alone for route builder, because search results are broad and many assets are not product-grade mobile app systems.

---

### 1.2 Untitled UI

URL checked:

```txt
https://www.untitledui.com/
```

Useful facts:

- Figma product is a full design-system/UI kit.
- React product exists separately.
- Icons product has a large clean neutral icon set.
- It has global styles, variables, components, variants, page examples, icons, and dark-mode support.

Verdict:

```txt
Buy/use Untitled UI as the design-system backbone.
```

Trailhead use cases:

- Route Builder cards, chips, forms, sheets, modals, menus, list rows.
- Recent Places / Saved Places cards.
- Copilot chat UI primitives.
- Settings, account, subscriptions, paywall surfaces.
- Admin/dashboard/web planner surfaces.
- Consistent spacing, radius, typography, and variants.

Important: do not copy its light SaaS look directly. Adapt its component discipline into Trailhead's dark outdoor OS visual language.

---

### 1.3 Setproduct

URL checked:

```txt
https://www.setproduct.com/
```

Useful kits/references found:

- **Nocra UI kit** — design system for AI products.
- **Orion UI kit** — chart/dashboard widgets in light and dark themes.
- **Figma Charts UI kit** — chart templates and data visualization.
- **Nucleus UI** — 1000 components/variants and 500+ mobile screens.
- **Material X** — 1100+ components and app templates.
- **Material You UI kit** — Material Design 3 style variants and dashboard templates.
- **Mobile X UI kit** — iOS/Android design system with many app templates.
- The site also has useful articles on AI chat interfaces, date pickers, data tables, dashboards, and mobile UI patterns.

Verdict:

```txt
Use Setproduct for AI/Copilot and data-dense planner modules.
```

Trailhead use cases:

- Copilot recommendation brief cards.
- Mission Control status grid.
- Route day health / readiness score.
- Data widgets: weather risk, offline pack readiness, source confidence, trip timing, fuel/water/service gaps.
- Mobile app pattern references for complex cards and lists.

Best purchases:

```txt
Nocra UI kit — AI product surfaces
Orion UI kit or Figma Charts — dashboards and readiness widgets
Mobile X or Nucleus — mobile screen pattern library
```

---

### 1.4 Mobbin

URL checked:

```txt
https://mobbin.com/
```

Useful facts:

- Real-world design inspiration library with iOS/web apps and sites.
- Searchable by screens, UI elements, flows, and text in screenshots.
- Useful categories include bottom sheets, tabs, progress indicators, dialogs, searching, chatting, recommending, onboarding, subscription/paywall, and explore flows.
- Has Figma plugin / copy-to-Figma workflow.

Verdict:

```txt
Subscribe/use for UX flow research, not as a purchased template.
```

Trailhead searches to run inside Mobbin:

```txt
route planner
map
navigation
itinerary
trip planner
travel
recent places
saved places
AI chat
chatbot
recommendation
bottom sheet
searching
explore
paywall
subscription
progress
onboarding
```

Use it to study shipped patterns from apps like Airbnb, Uber, Maps-style products, ChatGPT, travel apps, and subscription apps. Do not copy visual designs 1:1.

---

### 1.5 Creative Tim

URL checked:

```txt
https://www.creative-tim.com/templates/react-native
```

Useful facts:

- Has React Native templates and UI kits.
- Useful if we want implementation examples for RN screen layouts.
- The catalog is not Trailhead-specific, but it gives proven RN layout structures.

Verdict:

```txt
Optional implementation reference only.
```

Trailhead use cases:

- React Native screen organization ideas.
- Paywall/account/settings/profile flow references.
- Avoid using the visual style directly; most kits are too generic for Trailhead.

---

### 1.6 Tailwind Plus / Tailwind UI

URL checked:

```txt
https://tailwindui.com/templates
```

Useful facts:

- Strong web templates and application UI blocks.
- Includes application UI categories like tables, feeds, forms, modals, command palettes, dropdowns, buttons, sidebar navigation, and ecommerce blocks.
- Not React Native, but useful for web planner/admin/dashboard patterns.

Verdict:

```txt
Use for web planner/admin/marketing; not mobile app core.
```

Trailhead use cases:

- Dashboard/web route planner.
- Admin partner/operator portal.
- Landing page / pricing / product marketing.
- Internal analytics and partner dashboards.

---

## 2. Current Trailhead UI reality from repo

### 2.1 Route Builder is feature-rich but visually overloaded

The Route Builder imports many major dependencies and handles video loading, route geometry, offline trips, offline trails, store/history, premium sheets, paywalls, gallery, place search, route builder logic, offline readiness, and route units in one large screen. It also defines route stops, discovery results, route day plans, search state, trip build modes, and large place-filter sets.

Key current patterns:

```txt
- route-builder.tsx has many jobs in one screen
- BuilderStop includes start/fuel/waypoint/camp/motel
- Discovery tabs include camps/gas/poi/excursions
- Place filters already include fuel, water, boat ramps, fishing, marinas, showers, laundry, lodging, private stays, food, groceries, mechanics, trailheads, viewpoints, peaks, passes, glaciers, etc.
- There is already loading/status UI with a route-building progress card
```

This means the UI problem is not lack of capability. It is information architecture and hierarchy.

### 2.2 Current design tokens are already Trailhead-specific

Current design system uses dark/light palettes, orange for active navigation/warnings/selected actions, neutral/silver accents, green/red/yellow statuses, glass surfaces, radius tokens, spacing tokens, and mono typography for technical labels.

Keep this identity. The new template work should not turn Trailhead into a bright generic travel app.

---

## 3. Product repositioning for UI

Trailhead should feel like:

```txt
Outdoor Trip OS
```

Not:

```txt
Overlanding-only app
Generic travel planner
Tour marketplace
Map clutter app
AI chatbot toy
```

New core navigation language:

```txt
Plan
Explore
Map
Copilot
Saved
```

Or:

```txt
Today
Explore
Route
Map
Copilot
```

The app should communicate that Trailhead handles:

```txt
Routes
Trails
Camps
Tours
Safaris
Fishing/boating
Gear/rig readiness
Services
Offline navigation
Recent/saved places
AI trip planning
```

---

## 4. Template-to-surface mapping

### 4.1 Route Builder

Primary inspiration:

```txt
Untitled UI: forms, chips, modals, sheets, empty states, buttons
Setproduct Mobile X/Nucleus: mobile card/list/wizard patterns
Mobbin: real route/search/bottom-sheet flows
Tailwind Plus: web planner/admin layout, not mobile core
```

Route Builder should be redesigned around three layers:

#### A. Route command header

```txt
Where are you going?
[Start] -> [Destination] [+ Add stop]
Trip mode chips: Outdoors / Road Trip / Hiking / Water / Safari / City Reset
```

#### B. Day cards / route timeline

Each day card should show:

```txt
Day 1
Drive: 4h 20m / 238 mi
Theme: scenic drive + camp
Status: needs camp / fuel ok / offline partial
Primary stop
Overnight
Suggested activity
Service gap warnings
```

Card actions:

```txt
Map
Edit
Add stop
Find camp
Find activity
Download
```

#### C. Smart suggestions drawer

Instead of tabs scattered everywhere, make suggestions a drawer:

```txt
Suggestions for Day 2
- Camps
- Fuel / water / food
- Things to do
- Tours / safaris / guided trips
- Gear / rig checklist
- Recent nearby places
```

---

### 4.2 Recent Places / Saved Places

Primary inspiration:

```txt
Travel planner templates
Untitled UI cards/chips
Mobbin saved/search/recent flows
```

This should become a first-class surface, not just history.

New sections:

```txt
Recently viewed
Saved for this trip
Downloaded/offline
Near current route
Bookable/saved activities
Gear/rig checklist
Past trips
```

Card design:

```txt
[small map/terrain/photo thumbnail]
Title
Category chip: Trail / Camp / Tour / Service / Gear / City / Water / Safari
Distance/context: 12 mi from route / Day 3 / offline ready
Source/freshness: NPS official / partner / user saved
Actions: Route / Add / Download / Hide
```

This is critical because Trailhead is now more than overlanding. Recent places need to include:

```txt
trails
parks
campgrounds
water access
fishing spots
boat ramps
guided tours
safaris
gear shops
repair shops
luggage storage
restaurants/food
saved AI suggestions
```

---

### 4.3 Copilot / AI Trip Planner

Primary inspiration:

```txt
Setproduct Nocra UI kit
Envato AI Startup Dashboard
Mobbin chat/search/recommend flows
Untitled UI for primitives
```

The Copilot UI should not be a simple chat screen. It needs three stacked layers:

#### A. Conversation

Normal chat with voice and text.

#### B. Structured recommendation cards

Copilot output should include structured cards:

```txt
I found 3 route-fit options
[Wildlife sunrise tour]
[Rain backup]
[Gear checklist]
```

Each card needs:

```txt
Why this appears
Source/freshness
Partner/sponsored disclosure if applicable
Action chips
```

#### C. Staged actions

Actions should appear as confirmation cards:

```txt
Add rafting tour to Day 2?
Download offline route to meeting point?
Hide partner picks for this trip?
Create rain backup plan?
```

Copilot visual direction:

```txt
dark glass cockpit
small route/map context strip
structured cards, not long text
chips for actions
source/freshness badges
orange only for primary action/warning
blue/silver for AI reasoning
green for ready/done
```

---

### 4.4 Explorer / Explore

Explorer already has a direction. Only light work now:

```txt
Reduce generic rails
Make categories clearer
Add source/freshness badges
Add better empty states
Add bookable/partner rails carefully
Keep map/detail sheets calmer
```

Explorer should use:

```txt
Destination hero
Activity DNA chips
Nearby rails
Source/freshness
Recommended route-fit actions
Bookable experiences
Gear/services
Offline pack
```

---

### 4.5 Mission Control

Primary inspiration:

```txt
Setproduct Orion / Figma Charts / AI Startup Dashboard
Untitled UI stats/cards
```

Mission Control should be a compact operational dashboard, not a chat transcript.

Sections:

```txt
Route status
Offline readiness
Weather/fire/air/water
Camps/overnights
Fuel/water/service gaps
Recommended next actions
```

Visual model:

```txt
Status tiles + short explanations + action chips
```

Example:

```txt
READY
✓ Route preview
✓ 2 offline map packs

NEEDS REVIEW
! Day 2 overnight missing
! Rain after 3 PM near trail

ACTIONS
[Find camp] [Rain backup] [Download offline]
```

---

## 5. Concrete visual system direction

### 5.1 Keep Trailhead dark outdoor OS

Use current tokens:

```txt
background: dark charcoal
surface: elevated charcoal / glass
primary: orange reserved for selected/nav/warning/primary CTA
secondary: silver/blue glow for AI and information
success: green
risk: red/yellow/orange
technical labels: mono
```

### 5.2 Add a less overlanding-only activity palette

Use activity chips:

```txt
Trail
Camp
Water
Fish
Boat
Climb
Off-road
Scenic
Safari
City reset
Gear
Service
Tour
Offline
```

These should appear in Route Builder, Recent Places, Explore, Copilot, and Map Sheets.

### 5.3 New component families

Codex should create or refactor toward:

```txt
mobile/components/trip/TripCommandHeader.tsx
mobile/components/trip/RouteDayCard.tsx
mobile/components/trip/RouteTimeline.tsx
mobile/components/trip/RecentPlaceCard.tsx
mobile/components/trip/SavedPlacesRail.tsx
mobile/components/trip/SmartSuggestionDrawer.tsx
mobile/components/copilot/CopilotBriefCard.tsx
mobile/components/copilot/CopilotActionCard.tsx
mobile/components/copilot/CopilotRecommendationRail.tsx
mobile/components/mission/MissionControlCompact.tsx
mobile/components/mission/MissionStatusTile.tsx
mobile/components/offers/OutdoorOfferCard.tsx
mobile/components/offers/OfferDisclosure.tsx
mobile/components/offline/OfflineReadinessStrip.tsx
```

### 5.4 Screen hierarchy

#### New Route Builder screen hierarchy

```txt
Hero / Command Header
  - Search origin/destination
  - Trip mode chips
  - AI Planner CTA

Recent / Saved strip
  - recent places
  - saved stops
  - downloaded areas

Route timeline
  - day cards
  - stops
  - review badges

Smart suggestions drawer
  - camps
  - fuel/services
  - tours/activities
  - gear/rig

Mission mini-card
  - route health
  - offline readiness
  - next action
```

#### New Copilot screen hierarchy

```txt
Context strip
  - current trip/place/route

Conversation
  - short assistant text
  - voice controls

Structured cards
  - recommendations
  - route changes
  - gear checklists
  - offline packs

Action dock
  - confirm/add/save/hide/download
```

---

## 6. What to buy / use first

### Buy/use immediately

```txt
1. Untitled UI Figma
2. Untitled UI Icons
3. Setproduct Nocra UI kit
4. Setproduct Mobile X or Nucleus UI
5. Mobbin subscription for one month during redesign
6. Envato Elements subscription if not already active
```

### Optional after initial design pass

```txt
Setproduct Orion UI kit / Figma Charts
Creative Tim React Native template if Codex needs RN implementation references
Tailwind Plus if working on dashboard/web planner/admin/partner portal
```

### Envato search terms to use manually

```txt
travel planner app ui kit
trip planner figma
itinerary app ui kit
map mobile app ui kit
navigation app ui kit
AI chatbot dashboard figma
AI assistant mobile app
travel booking mobile app
outdoor adventure app
camping app ui kit
fitness route planner
real estate map app ui kit
```

Important: if an Envato item only has PSD/AI and no Figma/Sketch/XD/mobile system, skip it unless it is purely visual inspiration.

---

## 7. Codex implementation plan

### Stage 0 — UI audit

Deliver:

```txt
docs/ui-stage-0-current-surface-audit.md
```

Tasks:

- Inspect `route-builder.tsx`, `guide.tsx`, `map.tsx`, Copilot components, Mission Control, and design tokens.
- List overloaded components and repeated patterns.
- Identify extraction targets.
- No behavior changes.

Validation:

```bash
cd mobile && npx tsc --noEmit
```

---

### Stage 1 — Design token alignment

Deliver:

```txt
docs/ui-stage-1-design-token-upgrade.md
```

Tasks:

- Keep current Trailhead colors.
- Add activity chip color/token map.
- Add shared card/sheet/action styles for trip/copy/recommendation surfaces.
- Add disclosure/status badge primitives.
- Do not restyle everything yet.

Files:

```txt
mobile/lib/design.ts
mobile/lib/activityTheme.ts
mobile/components/TrailheadUI.tsx
```

---

### Stage 2 — Route Builder shell redesign

Deliver:

```txt
docs/ui-stage-2-route-builder-shell.md
```

Tasks:

- Add `TripCommandHeader`.
- Add `RouteDayCard`.
- Add `RouteTimeline`.
- Add `RecentPlacesRail` / `SavedPlacesRail`.
- Keep old logic intact; new shell can wrap existing state.
- Start by moving repeated visual pieces out of `route-builder.tsx`.

Files:

```txt
mobile/components/trip/TripCommandHeader.tsx
mobile/components/trip/RouteDayCard.tsx
mobile/components/trip/RouteTimeline.tsx
mobile/components/trip/RecentPlaceCard.tsx
mobile/components/trip/SavedPlacesRail.tsx
```

Exit:

```txt
Route Builder feels like trip planning for outdoors/travel, not just overlanding/camps.
```

---

### Stage 3 — Smart Suggestions drawer

Deliver:

```txt
docs/ui-stage-3-smart-suggestions.md
```

Tasks:

- Replace scattered discovery UI with a drawer/module pattern.
- Suggestions groups:
  - Camps
  - Fuel/water/services
  - Trails/activities
  - Tours/safaris/guides
  - Gear/rig readiness
  - Recent nearby
- Add source/freshness/disclosure rows where needed.

Files:

```txt
mobile/components/trip/SmartSuggestionDrawer.tsx
mobile/components/trip/SuggestionGroup.tsx
mobile/components/trip/SuggestionCard.tsx
```

---

### Stage 4 — Recent/Saved Places as first-class product

Deliver:

```txt
docs/ui-stage-4-recent-saved-places.md
```

Tasks:

- Recent places support all place/offer types.
- Add category chips.
- Add route/day/offline context.
- Add CTA row.
- Add empty states with useful next actions.

Surfaces:

```txt
Route Builder
Explore
Profile/Saved
Copilot action cards
```

---

### Stage 5 — Copilot structured UI

Deliver:

```txt
docs/ui-stage-5-copilot-structured-ui.md
```

Tasks:

- Add Copilot context strip.
- Add structured recommendation cards.
- Add action staging cards.
- Add recommendation rail.
- Add source/freshness/disclosure footer.
- Keep long chat text secondary.

Files:

```txt
mobile/components/copilot/CopilotContextStrip.tsx
mobile/components/copilot/CopilotBriefCard.tsx
mobile/components/copilot/CopilotActionCard.tsx
mobile/components/copilot/CopilotRecommendationRail.tsx
```

---

### Stage 6 — Mission Control visual dashboard

Deliver:

```txt
docs/ui-stage-6-mission-control-dashboard.md
```

Tasks:

- Convert Mission Control into compact status tiles.
- Add route/offline/weather/fuel/camp/report states.
- Add next-action chips.
- Do not turn it into a giant dashboard.

Files:

```txt
mobile/components/mission/MissionControlCompact.tsx
mobile/components/mission/MissionStatusTile.tsx
mobile/components/mission/MissionActionBar.tsx
```

---

### Stage 7 — Explorer light polish

Deliver:

```txt
docs/ui-stage-7-explorer-polish.md
```

Tasks:

- Keep current Explore direction.
- Add clearer category chips.
- Add better source/freshness badges.
- Add “Recommended for this route” row.
- Add bookable/partner rail but keep it calm.
- Avoid map clutter.

---

## 8. Visual acceptance criteria

A redesigned Trailhead screen should pass these checks:

```txt
Can the user tell what mode they are in within 2 seconds?
Can they see the next best action without reading a paragraph?
Is the screen useful for hiking/travel/water/safari/city reset, not only overlanding?
Are recent/saved places obvious and actionable?
Are partner/commercial items clearly labeled?
Is orange reserved for selected/primary/warning?
Does every map pin/card have a source/freshness/context line?
Can the UI degrade gracefully when no API/provider results exist?
Can the screen be used one-handed on mobile?
Does the map remain the main object when the user is navigating?
```

---

## 9. Codex kickoff prompt

Use this prompt with Codex:

```txt
You are working in the Trailhead repo.

Read first:
1. AGENT_WORKFLOW.md
2. docs/adventure-app-production-readiness-plan.md
3. docs/copilot-outdoor-commerce-upgrade-plan.md
4. docs/trailhead-ui-template-research-and-upgrade-plan.md
5. mobile/lib/design.ts
6. mobile/components/TrailheadUI.tsx
7. mobile/app/(tabs)/route-builder.tsx
8. mobile/app/(tabs)/guide.tsx
9. mobile/app/(tabs)/map.tsx
10. mobile/components/explore/ExploreExperiencesRail.tsx
11. mobile/components/map/MapLayerSheetContent.tsx

Goal:
Upgrade Trailhead UI toward an Outdoor Trip OS using the design direction in this doc.

Rules:
- Do not dump more logic into map.tsx or route-builder.tsx.
- Extract reusable components.
- Preserve existing behavior unless the task explicitly changes it.
- Keep Trailhead's dark outdoor OS identity.
- Do not copy templates 1:1; translate patterns into Trailhead components.
- Make the app feel broader than overlanding: trails, camps, tours, safaris, water, gear, services, offline.
- Every partner/commercial UI element needs disclosure.
- Add an audit note after each stage.
- Run mobile typecheck before concluding.

Start with Stage 0 UI audit, then Stage 1 design token alignment.
```

---

## 10. Final design direction in one sentence

Trailhead should feel like a **dark, premium outdoor mission-control app** with the planning clarity of a travel app, the utility of a navigation app, and the structured intelligence of an AI assistant — not a generic travel template and not an overlanding-only dashboard.
