# Design Decision: Planner Composer

**Date:** 2026-06-25  
**Checkpoint:** 11 - Planner Composer and Copy Cleanup

## Current Problems

- The Planner welcome state has too many preset cards, tags, and status words
  before the user has typed a trip.
- The visible `Trail DNA` strip exposes internal-feeling labels and adds height
  above the conversation.
- Report actions sit above the composer as two large buttons, making typing and
  scrolling harder on iOS.
- The ready/build state uses a long support card when the user mainly needs a
  short summary and a clear decision.
- Some visible Planner and report copy uses implementation language or support
  language that should feel more like the product.

## Research Reviewed

- Current Planner implementation in `mobile/app/(tabs)/plan.tsx`.
- Current report sheet in `mobile/components/AiReportModal.tsx`.
- User-provided ChatGPT iOS conversation screenshots in `/tmp`.
- Figma / Mobbin copy board `yP342OKFtUQ1J0RCwnzH6s`:
  - `Home on Wanderlog (iOS)` node `1:2`.
  - `Submitting a report on Waze (iOS)` node `2:2`.
- Prior checkpoint 7 Planner/Copilot structured-card decision.
- PR #12 master live app plan direction that public copy should use Planner and
  Copilot language instead of implementation terms.

## Patterns Extracted

- Keep the main ask visible and direct; put examples below it, not as a wall.
- Use sparse starter prompts as examples, not heavy recommendation cards.
- Keep the composer reachable and let it grow only to a bounded height.
- Hide low-frequency support/report actions behind one compact icon.
- When a route outline is ready, show a short summary with Build and Refine
  actions close together.
- Use product language such as trip, route, notes, and review instead of model,
  admin, setup, or debug wording.

## New Component Tree

```txt
PlanScreen
  Header
  Toasts
  ScrollView
    Resume saved trip card
    PlannerIntro
      headline
      short body copy
      StarterPromptRow
    Message list
      MarkdownText
      OutlineCard
      TripCard
    Thinking indicator
  PlannerComposer
    report icon
    bounded multiline input
    send button
  AiReportModal
```

## First Implementation Slice

- Replace the three recommendation-style welcome examples with two compact
  starter prompts.
- Remove the visible Trail DNA strip from Planner while keeping backend trip
  context behavior unchanged.
- Move Planner reporting to a compact composer icon and clean the report sheet
  copy.
- Reduce the bottom composer footprint and increase message bottom padding only
  to the space it actually needs.
- Shorten Planner stage, ready, toast, login, and placeholder copy.

## Why This Is Better

- The first Planner view becomes a real input-first planning surface instead of
  a set of labels to interpret.
- Typing is easier because report controls no longer occupy an entire row above
  the input.
- The app still keeps reporting, route build, trip cache, history, and planning
  APIs intact.
- The route-ready decision is clearer: review the summary, build it, or refine.

## Future Improvements

- Extract `PlannerIntro` and `PlannerComposer` once the next Planner checkpoint
  broadens beyond copy and layout polish.
- Add a compact trip-source row after backend route context is structured for
  user-facing freshness labels.
- Tune native keyboard offsets on physical iOS hardware after OTA validation.
