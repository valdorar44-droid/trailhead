# Design Decision: Planner + Copilot Structured Cards

**Date:** 2026-06-25  
**Checkpoint:** 7 - Planner/Copilot Structured Cards

## Current Problems

- Planner has good route-building behavior, but the ready/build state is still
  rendered as a chat-era outline card with inline styles.
- The welcome examples behave like recommendations, but they do not expose why
  a user should choose one or what action will happen next.
- Copilot confirmation in the map sheet is a plain warning row instead of a
  reusable action card with title, reason, and confirmation actions.
- The codebase has `MissionControlPanel`, but the Planner/Copilot card layer is
  not yet extracted into reusable components.
- User-facing Planner/Copilot copy still needs to avoid implementation wording
  and focus on trip outcomes.

## Research Reviewed

- PR #12 master live-app upgrade plan, especially section 8 and Stage G.
- Current `mobile/app/(tabs)/plan.tsx` Planner implementation.
- Current map Copilot sheet in `mobile/app/(tabs)/map.tsx`.
- Current `mobile/components/copilot/MissionControlPanel.tsx`.
- Figma:
  - Untitled UI styles/variables files for token discipline.
  - Nucleus UI Lite node `2802:306` for compact row spacing, disclosure rhythm,
    and clear dividers.
- Mobbin:
  - Authenticated session was available in earlier checkpoints for saved,
    offline, and map/filter patterns.
  - For this checkpoint, Mobbin redirected to the public landing page, so new
    authenticated Planner/Copilot examples were unavailable.
  - Prior extracted patterns still apply: compact task-first cards, clear
    counts/status, and actions kept close to the relevant item.
- Template references:
  - Creative Market Trip Planner Mobile App UI Kit by Betush:
    https://creativemarket.com/betush/7242770-Trip-Planner-Mobile-App-UI-Kit
  - Envato UX/UI Kits and AI Startup Dashboard:
    https://elements.envato.com/graphic-templates/ux-and-ui-kits
    https://elements.envato.com/ai-startup-dashboard-SW78S3D
  - Setproduct Nocra/Orion/Nucleus references:
    https://www.setproduct.com/
  - Dribbble travel planner search:
    https://dribbble.com/search/travel-planner-mobile-app

## Patterns Extracted

- Use cards for route-ready, recommendation, and confirmation states.
- Each card should answer:
  - what is ready
  - why it appears
  - what source/freshness/status supports it
  - what the next action is
- Use compact action chips/buttons instead of long helper text.
- Keep chat/help available below structured planning, not as the only surface.
- Avoid copying travel template layouts; Trailhead cards should stay operational
  and route/offline/readiness focused.

## New Component Tree

```txt
PlanScreen
  welcome examples
    CopilotRecommendationCard
  message list
    CopilotBriefCard
      CopilotActionCard
    TripCard
    MarkdownText fallback

MapScreen Copilot sheet
  pending action
    CopilotActionCard (future wire)
```

## First Implementation Slice

- Add `CopilotActionCard`, `CopilotBriefCard`, and
  `CopilotRecommendationCard`.
- Wire `CopilotBriefCard` into Planner's route-ready/retry outline state.
- Wire `CopilotRecommendationCard` into Planner's welcome examples.
- Keep existing Planner API calls, trip building, offline saving, and history
  behavior unchanged.
- Defer map Copilot confirmation wiring until the Planner card shape is
  validated in production.

## Why This Is Better

- Planner starts presenting route state as a production planning system instead
  of a chat transcript.
- Cards are reusable by Copilot and Mission Control without moving backend
  planning logic.
- The first slice is fully wired to real Planner states, so it does not add dead
  or placeholder components.
- The implementation keeps `plan.tsx` from accumulating more inline card styles.

## Future Improvements

- Reuse `CopilotActionCard` for pending Copilot map actions.
- Add source/freshness badges to trip recommendations once backend data is
  structured for that.
- Add a Mission Control mini brief inside Planner after trip build.
- Expand copy auditing from Planner text sanitizer to all Planner/Copilot
  surfaces.
