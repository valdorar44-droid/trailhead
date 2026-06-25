# Design Decision: Explore Controls

**Checkpoint:** 10 - Explore Control Surface  
**Date:** 2026-06-25

## Current Problems

- `mobile/app/(tabs)/guide.tsx` is still large at roughly 2,900 lines.
- Explore already has a strong hero, smart cards, detail sheets, cached source
  data, and route/map actions, but the full browse category row and the
  compact status/filter row exist as reusable components without being wired
  into the production screen.
- The home feed relies on a small hero category rail and a separate sort glyph,
  which makes category browsing and ranking state less explicit than the
  product brief asks for.
- The previous Explore audits called out the large screen container and the
  need to make browse controls feel more like a destination discovery surface.

## Research Reviewed

- Repository:
  - `docs/explore-ui-redesign/TRAILHEAD_EXPLORE_UI_REDESIGN_CODEX_DIRECTIONS.md`
  - `docs/phase-5-explore-audit.md`
  - `docs/profile-explore-campflare-followup-audit.md`
  - current `guide.tsx` and `mobile/components/explore/*`
- Mobbin copy in Figma:
  - `Home on Wanderlog (iOS)` node `1:2`
  - Waze report frames were reviewed in checkpoint 9 and are not the primary
    reference for Explore.
- Figma Community / libraries:
  - The Mobbin copy file has Material 3, Figma Simple Design System, and iOS
    UI kit libraries available. MCP search did not find directly attached
    Trailhead components in the file.
- Template references:
  - Nucleus UI Lite link opened to accordion documentation, useful only as a
    component-library reference.
  - Public search passes for Figma Community, Envato Elements, Behance, and
    Dribbble were reviewed for travel/explore/onboarding terms. No layout was
    adopted directly.

## Patterns Extracted

- Keep the emotional visual hero, then move into a calm control surface before
  the content feed.
- Use a segmented mode switch first, followed by horizontal categories and a
  compact status row.
- Keep status pills short: count, source quality, and current sort.
- Make sorting discoverable without turning it into a heavy filter sheet.
- Use existing Trailhead outdoor cards and action rows rather than copying a
  travel app layout.

## New Component Tree

```txt
GuideScreen
  ExploreHero
  ExploreHomeControls
    ExploreModeTabs
    ExploreCategoryChips
    ExploreFilterRow
    clear-state buttons
  ExplorePlaceCard
  ExploreDetailSheet
```

## Decision

- Add `ExploreHomeControls` as the production control surface for Explore home.
- Wire the existing full category chip row into the screen below the mode tabs.
- Wire the existing status/filter row with:
  - shown count
  - `Official + community`
  - sort label
- Move the sort toggle from the standalone glyph into the filter row and cycle:
  `Best match` -> `Nearest` -> `Trusted first`.
- Keep all ranking, catalog loading, caching, detail, map, route, and saved
  behavior unchanged.

## Why This Is Better

- The full category taxonomy becomes discoverable without expanding the hero.
- The sort state becomes labeled and tappable instead of hidden behind a lone
  icon.
- `guide.tsx` loses visible-control markup while retaining ownership of data
  and navigation behavior.
- The slice is production-safe: it reuses existing components and does not
  introduce new data contracts.

## Future Improvements

- Extract home feed shelves from `guide.tsx` after the control surface is stable.
- Add a real source filter sheet once the catalog exposes a stable source
  filter contract.
- Give Explore detail `Sources` its own tab after the summary/story/nearby path
  is stable on iOS and Android.
