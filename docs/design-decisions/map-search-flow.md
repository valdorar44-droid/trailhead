# Map Search Flow Checkpoint

## Current Problems

- The compact map search is useful, but it tries to act as both quick search and full search.
- The drawer search action currently routes users back into the compact overlay instead of a richer search surface.
- Search results can feel thin because the UI only shows a few rows, even though the app already has Mapbox, Explore, nearby, offline, and route-search paths.
- Android keyboard handling is fragile when the small map search owns the whole flow.

## Research Reviewed

- Mobbin: [Google Maps search flow](https://mobbin.com/flows/fe70e635-ae6d-4fca-a522-7718ea42a735), [Apple Maps search flow](https://mobbin.com/flows/335660ac-4374-4a08-b194-8e8c40d6775e), [Apple Maps gas stations flow](https://mobbin.com/flows/7464747e-f674-40db-bc2d-4e6db72be5cb).
- Mobbin screens: travel/map search sheets and result-list examples including Google Maps result sheet.
- Figma: Untitled UI variables/styles, Nucleus Lite, Main Light. Design-system searches did not expose reusable search components.
- Trailhead: compact inline map search, `RouteSearchModal`, Explore catalog search, Mapbox context search, offline route-builder search.

## Patterns Extracted

- Keep a search field anchored at the top of the sheet with immediate keyboard focus.
- Show a small number of useful categories, not a wall of chips.
- Separate recent/suggested searches from actual results.
- Results should include title, source/context, distance when available, and quick route/open affordances.
- Selecting a result should close the sheet, focus the map, and open the existing Trailhead place card.

## Implementation Scope

- Keep the compact map search on the map.
- Add a full `MapSearchSheet` for drawer/search-tool entry.
- Reuse existing `searchQuery`, `searchResults`, `searchMap`, `selectSearchResult`, and scoped search logic.
- Avoid new backend routes in this checkpoint.
- Avoid provider-specific or implementation wording in user-facing copy.

## New Component Tree

- `MapSearchSheet`
  - search header
  - quick category row
  - results list
  - recent/suggested section
  - loading/empty states

## Why This Is Better

- Compact search remains fast for map-first use.
- Drawer search becomes a real search flow with enough room for results.
- Existing Mapbox/Explore/offline logic is reused instead of duplicated.
- Android keyboard risk is reduced because the larger sheet owns the text input.

## Future Improvements

- Move search orchestration out of `map.tsx` into a shared hook.
- Feed the same full search component into Route Builder and Planner.
- Add saved Library results once the unified Library index exists.
- Add screenshot baselines for empty, loading, results, scoped nearby, and selected result states.
