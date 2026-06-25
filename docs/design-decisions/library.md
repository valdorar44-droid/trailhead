# Design Decision: Recent / Saved / Downloads Library

**Date:** 2026-06-25  
**Checkpoint:** 5 - Library + Offline Readiness

## Current Problems

- Recent trips, offline copies, GPX imports, saved camps, and saved places are
  split between Profile `Trips` and `Saved`.
- Offline readiness is visible only inside the Trips section, so users have to
  know where downloads live.
- Saved camps and saved locations use simple rows without a higher-level
  readiness summary.
- Profile already owns the data, but the screen needs a Library surface before
  deeper extraction.

## Research Reviewed

- PR #12 master live-app upgrade plan.
- Current Profile implementation in `mobile/app/(tabs)/profile.tsx`.
- Mobbin, authenticated session:
  - Downloads & Available Offline screen pattern: filtered collections, counts,
    selectable item cards, and bulk actions.
  - Saving to Collection flow pattern: task-level saved-state grouping and
    visible counts.
- Figma:
  - Untitled UI styles/variables getting-started nodes: auto-layout discipline,
    clear spacing, and component-library thinking.
  - Nucleus UI Lite Accordion List core: compact row, 16px gap, chevron
    disclosure, divider, and expanded body rhythm.

## Patterns Extracted

- Start with a summary that tells the user what is ready, not just what exists.
- Group library content by task: Recent, Offline Ready, Saved Nearby, Imports.
- Use counts and short status lines so the surface scans quickly.
- Keep primary actions close to the relevant group: open map, open downloads,
  plan trip.
- Avoid copying external layouts; use Trailhead cards, tokens, icons, and copy.

## New Component Tree

```txt
ProfileScreen
  Library section
    ProfileLibraryOverview
      summary metrics
      Library group rows
      route actions into existing Trips/Saved/Map/Plan flows
  existing Trips detail section
  existing Saved detail section
```

## Why This Is Better

- Users get one place to understand recent trips, saved places, and offline
  readiness.
- It reduces the mental split between saved content and downloaded content.
- The first implementation reuses existing Profile data and navigation instead
  of moving persistence logic.
- It creates a safe component boundary for later extraction of trip and saved
  item rows.

## Future Improvements

- Move detailed trip and saved rows into reusable Library components.
- Add expandable groups once the detailed rows are extracted.
- Add Library search and filters after the consolidated section is stable.
- Consider replacing the separate Trips/Saved Profile chips once the Library
  section fully owns those flows.
