# Design Decision: Route Builder Discovery Candidate Cleanup

**Date:** 2026-06-25
**Checkpoint:** 26 - Route Builder Discovery Candidate Cleanup

## Current Problems

- `mobile/app/(tabs)/route-builder.tsx` still contains stale candidate row and
  camp candidate card styles.
- Live inline discovery results already render through
  `mobile/components/routeBuilder/RouteBuilderInlineResults.tsx`.
- Leaving dead styles in the screen makes future extraction work noisier and
  conflicts with the no-dead-components validation rule.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderInlineResults.tsx`
- Prior Checkpoint 19 inline discovery-result extraction.
- Checkpoint 26 audit confirmed no live references to:
  - `candidateRow`
  - `candidateIcon`
  - `campCandidateCard`
  - `campCandidatePhotoWrap`
  - `campCandidatePhoto`
  - `campCandidatePlaceholder`
  - `campCandidateBody`
  - `campCandidateTags`
  - `candidateName`
  - `candidateMeta`
- Mobbin/Figma discovery-card research remains covered by Checkpoints 24 and
  25; no new UI pattern is introduced by this cleanup.

## Mobbin References

- Existing discovery-result UI already follows the route-day result patterns
  extracted in Checkpoint 19.

## Patterns Extracted

- Keep live discovery results in the reusable inline-results component.
- Remove stale screen-local styles that no longer have render references.

## New Component Tree

```txt
RouteBuilderScreen
  RouteBuilderInlineResults
    RouteBuilderInlineCampCard
    RouteBuilderInlineResultRow
```

## Why The Cleanup Is Better

- It removes dead style surface from the large Route Builder screen.
- It keeps discovery-result ownership clear.
- It reduces confusion before the next real discovery-sheet extraction.

## Future Improvements

- Extract route discovery sheet state once result rendering and search helpers
  are fully stabilized.
- Add component-level tests for inline discovery result rows if route discovery
  behavior expands.
