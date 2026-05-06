# Trailhead Product Design Direction

## Goal

Trailhead should feel like an overland navigation and trip-building tool, not a SaaS dashboard. The UI should be calm, tactile, map-first, and card-driven, with one obvious next action per screen.

## Reference Read

The Dyrt trip planner screenshots show why the flow feels polished:

- Each wizard screen asks one question.
- Inputs are large and plain.
- The bottom action is persistent and predictable.
- Trip overview is a vertical itinerary, not a dashboard.
- Camp cards use photos as the main signal.
- Stops sit directly on the trip timeline, so the route feels tangible.

Flaws to avoid:

- The flow is campground-first and less trail/navigation aware.
- It hides too much route intelligence behind generic "Ta-Dah" language.
- It can feel white-label if copied directly.
- It does not expose enough overland readiness: fuel gaps, offline readiness, public land, road/trail risk, rig fit.

onX/Gaia/iOverlander patterns worth borrowing:

- Map is the primary workspace.
- Tap a map feature, get a bottom card with actions.
- Offline status should be visible before navigation, not buried.
- Trail/road details need a clear source and confidence signal.

## Trailhead Direction

Trailhead should use:

- **Map-first surfaces:** the map stays visible whenever practical.
- **Expedition cards:** photos, route support, offline readiness, and rig-fit badges.
- **Single-question wizard screens:** route builder asks one thing at a time, then lands in a trip workspace.
- **Timeline itinerary:** start -> fuel/POI -> camp -> next day from camp.
- **Navigation-first hierarchy:** speed, next maneuver, distance, and locate/follow beat secondary route details.
- **Rugged but restrained palette:** pine, sage, rust, charcoal, parchment. Avoid bright SaaS blues/purples except for semantic map layers.

## Component Rules

- Card radius: 12-16 for modal/detail cards, 8-12 for dense rows.
- Buttons: one filled primary per screen; secondary buttons are bordered.
- Typography: prose and titles should use system sans where possible; mono should be reserved for labels, stats, coordinates, and technical badges.
- Sheet actions: icon + short verb, no crowded sentences.
- Route Builder: no dashboard-like clusters before the base route is built.
- Trip overview: every stop should be a visible row/card, and camps should include photo space when available.

## Figma Setup

Figma MCP is configured and OAuth-authenticated:

```bash
codex mcp add figma --url https://mcp.figma.com/mcp
```

This running Codex session does not expose the Figma tool namespace after hot-add. In the next session, use the Figma skills to create:

- `Trailhead UI Kit`
- `Route Builder Wizard`
- `Navigation Mode`
- `Trail Discovery`
- `Trip Overview`
- `Offline Downloads`

The screens should be designed from the tokens above and then implemented back into the Expo app.

## Figma Build

Created file:

- `Trailhead Product Design System`
- https://www.figma.com/design/FJUcMWAfsNyjsguCEp2dBe

Built:

- `Trailhead UI Kit` page with local Trailhead tokens, dark/light modes, text styles, and reusable component specimens for buttons, route fields, expedition camp cards, timeline rows, trail detail cards, offline region cards, and navigation HUD.
- `Trailhead Screens` page with five mobile screens:
  - `Route Builder Wizard / Destination`
  - `Trip Overview / Timeline Workspace`
  - `Trail Discovery / Detail Sheet`
  - `Navigation Mode / Active Guidance`
  - `Offline Downloads / Region Packs`

Figma MCP validation note:

- The file and screens were created successfully.
- Screenshot/metadata validation was blocked afterward by the Figma Starter plan MCP call limit.

## Expanded Figma Screens

Added a new `Trailhead Expanded Screens` page in the same Figma file for:

- `AI Planning / Trail DNA Chat`
- `Profile / My Rig + Trips`
- `Map Layers / Controls`
- `Route Engine / Decision Model`
- `Route Candidate Cards / Camp Fuel POI`
- `Route Failure / No Drawable Route`
- `Route Rebalance Warning`
- `Route Briefing / Readiness`

Use the same file for future iterations:

- https://www.figma.com/design/FJUcMWAfsNyjsguCEp2dBe

Route engine design is now tracked in:

- `docs/trailhead-route-engine-design.md`

Validation:

- Figma metadata returned the expected page and eight frame structure.
- Figma screenshot render succeeded for the expanded page.
