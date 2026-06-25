# Live Upgrade Checkpoint 25 Audit: Route Builder Stop Preview Cards

**Date:** 2026-06-25
**Commit target:** Route Builder stop preview card extraction.

## Scope Planned

- Add `docs/design-decisions/route-builder-stop-preview-cards.md` before
  implementation.
- Review Mobbin itinerary place-card, place-detail, and accommodation-card
  references.
- Search the user-provided Figma board for reusable route stop preview-card
  components before coding.
- Extract camp, fuel, and place/start/route stop preview card composition from
  `mobile/app/(tabs)/route-builder.tsx`.
- Keep camp detail loading, selected camp sheets, replacement flow, stay-next
  actions, stop labels, source badges, route calculations, and footer behavior
  unchanged.

## Research Reviewed

- Mobbin:
  - `https://mobbin.com/screens/767217bc-b0c5-48a7-a959-abd598bb8ced`
  - `https://mobbin.com/screens/1efa9f56-3b91-4bcc-8e6f-85f160f1f5aa`
  - `https://mobbin.com/screens/91f9f4ff-7387-48d8-9024-d91c17a9374f`
  - `https://mobbin.com/flows/1e4d7c7f-4909-4106-9b92-4f8b7cef117a`
  - `https://mobbin.com/flows/44f1e299-b07e-4399-9d4b-f5874ac2a26b`
- Figma:
  - Board/file `yP342OKFtUQ1J0RCwnzH6s`, search term:
    `mobile itinerary place card stop preview photo tags action buttons route stop component`.
  - No matching reusable preview-card component, variables, or styles were
    returned.
- External template search:
  - Figma Community, Envato Elements, Behance, and Dribbble searches were broad
    and did not change the implementation plan.

## Implementation Notes

- Added
  `mobile/components/routeBuilder/RouteBuilderStopPreviewCards.tsx`.
- Extracted reusable preview card components:
  - `RouteBuilderCampPreviewCard`
  - `RouteBuilderFuelPreviewCard`
  - `RouteBuilderPlacePreviewCard`
- Updated `mobile/app/(tabs)/route-builder.tsx` so `renderCampPreview` and
  `renderStopPreview` now pass shaped props into the reusable cards.
- Kept screen-owned route behavior unchanged:
  - camp feature summary text
  - land color selection
  - stop labels and source labels
  - camp detail open callback
  - camp replacement callback
  - stay-next-day and basecamp callbacks
  - fuel/place/start/route stop descriptions
- Removed moved preview-card styles from the large screen.

## Files Changed

- `mobile/app/(tabs)/route-builder.tsx`: 6105 lines after extraction.
- `mobile/components/routeBuilder/RouteBuilderStopPreviewCards.tsx`: 339
  lines.
- `docs/design-decisions/route-builder-stop-preview-cards.md`
- `docs/live-upgrade-checkpoint-25-route-builder-stop-preview-cards-audit.md`
- `docs/live-upgrade-execution-checkpoints.md`

## Figma Evidence

- File: `yP342OKFtUQ1J0RCwnzH6s`
- Frame: `34:2`, `Checkpoint 25 - Route Builder Stop Preview Cards`
- Screenshot:
  `/tmp/trailhead-checkpoint-25-route-builder-stop-preview-cards-figma.png`

## Playwright Evidence

- Local Expo web route: `http://127.0.0.1:8100/route-builder`
- Seeded a two-day Moab to Big Sur draft through
  `trailhead_copilot_route_builder_draft_v1`.
- Verified the active-day start/route-stop preview card renders through the
  extracted component with no current browser console errors.
- Screenshot:
  `/tmp/trailhead-route-builder-checkpoint-25-stop-preview-card-web.png`

## Validation

- `cd mobile && npx tsc --noEmit` passed.
- `cd mobile && npm run audit:copy` passed.
- `cd mobile && npm run audit:routes` passed 12 cases.
- `cd mobile && node scripts/user-facing-copy-audit.mjs "app/(tabs)/route-builder.tsx" components/routeBuilder/RouteBuilderStopPreviewCards.tsx`
  passed.
- `git diff --check` passed.

## Release

- Pending commit, push, and OTA.
