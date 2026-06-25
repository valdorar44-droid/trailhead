# Live Upgrade Checkpoint 26 Audit: Route Builder Discovery Candidate Cleanup

**Date:** 2026-06-25
**Commit target:** Route Builder stale discovery candidate style cleanup.

## Scope Planned

- Add `docs/design-decisions/route-builder-discovery-candidate-cleanup.md`
  before implementation.
- Audit stale candidate-row and camp-candidate style references.
- Remove dead candidate styles from `mobile/app/(tabs)/route-builder.tsx`.
- Keep live inline discovery result rendering, search behavior, camp
  replacement, add-place behavior, selected camp sheets, and route calculations
  unchanged.

## Research Reviewed

- Current implementation:
  - `mobile/app/(tabs)/route-builder.tsx`
  - `mobile/components/routeBuilder/RouteBuilderInlineResults.tsx`
- Prior Checkpoint 19 inline discovery-result extraction.
- Existing Mobbin/Figma discovery-card references from Checkpoints 24 and 25.

## Implementation Notes

- Removed the following stale style entries from
  `mobile/app/(tabs)/route-builder.tsx`:
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
- Confirmed live inline discovery results still render through
  `RouteBuilderInlineResults`, `RouteBuilderInlineCampCard`, and
  `RouteBuilderInlineResultRow`.
- No discovery filtering, add-place, camp replacement, selected camp sheet, or
  route calculation behavior was changed.

## Files Changed

- `mobile/app/(tabs)/route-builder.tsx`: 6095 lines after cleanup.
- `docs/design-decisions/route-builder-discovery-candidate-cleanup.md`
- `docs/live-upgrade-checkpoint-26-route-builder-discovery-candidate-cleanup-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`
- `docs/live-upgrade-refresh-handoff.md`

## Playwright Evidence

- Local Expo web route: `http://127.0.0.1:8100/route-builder`
- Reloaded after cleanup with no current browser console errors.

## Validation

- `cd mobile && npx tsc --noEmit` passed.
- `cd mobile && npm run audit:copy` passed.
- `cd mobile && npm run audit:routes` passed 12 cases.
- `rg "candidateRow|candidateIcon|campCandidate|candidateName|candidateMeta" "mobile/app/(tabs)/route-builder.tsx"`
  returned no matches.
- `git diff --check` passed.

## Release

- Pending commit, push, and OTA.
