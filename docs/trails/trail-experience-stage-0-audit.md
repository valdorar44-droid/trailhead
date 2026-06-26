# Trail Experience Stage 0 Audit

Date: 2026-06-26

## Summary

This Stage 0 audit covers the current Trailhead trail stack before any full Trail Experience production changes. The active camp discovery work changes camp loading and discovery behavior only; it does not change trail APIs, trail models, trail packs, selected-trail behavior, or offline trail storage.

The trail design package direction is valid: build on the existing Trailhead trail graph, profile, map, camera, terrain, API, and offline systems. Do not create a second trail database or competing trail profile API.

## Current APIs And Model Shapes

- Backend trail APIs already present:
  - `GET /api/trails/discover`
  - `GET /api/trails/{trail_id}`
  - `POST /api/trails/{trail_id}/suggest-edit`
  - `POST /api/trails/community`
  - `POST /api/trails/{trail_id}/field-report`
  - `GET /api/trails/{trail_id}/field-reports`
  - `GET /api/trails/{trail_id}/field-report-summary`
- Mobile trail API client already exposes discovery, profile detail, edit suggestions, and field reports from `mobile/lib/api.ts`.
- `TrailProfile` remains the primary mobile profile response shape. It includes trail stats, activities, geometry refs, photos, source pack metadata, reports, access/current context, and related places.
- `mobile/lib/trailProfileDisplay.ts` normalizes profile display into `TrailheadTrailProfile` with distance, elevation, difficulty basis, route type, activities, access, source, confidence, stats, and recent conditions.
- `mobile/lib/trailEngine.ts` defines lightweight `TrailFeature` cards and support counts for nearby camps, water, fuel, reports, and offline readiness.

## Current Selected-Trail And Navigation Behavior

- `NativeMap` exposes `highlightTrail`, `clearTrailHighlight`, `getTrailHighlight`, and `captureTrailAt`.
- Trail tap/highlight currently uses rendered features plus `buildOfflineTrailGraphSelection` where possible, with rendered-feature system building as fallback.
- Map selected-trail UI already shows normalized stats, source/freshness/confidence rows, difficulty basis, condition pills, nearby context, route/download/follow actions, and route-plan controls.
- Trail navigation currently bridges into existing route/navigation state. The next Trail Experience stage should reuse `flyToCamera`, `highlightTrail`, route follow state, and existing navigation panels instead of adding a second map implementation.

## Current Offline Compatibility

- `mobile/lib/offlineTrails.ts` saves `OfflineTrail` objects as `{ id, trail, geometry, savedAt, source }`.
- Current source values are `highlight`, `graph_pack`, and `manual`.
- Existing saved trails must remain readable. Future versioned offline trail packs should extend this object rather than replacing it.
- `NativeMap` already checks downloaded trail PMTiles and can load local trail files through the native tile server path.

## Overlap And Conflicts

- Active camp work increases camp/stay density and changes camp discovery payloads. It should only affect trails indirectly through nearby camp support counts and related context.
- Do not add large trail business logic to `mobile/app/(tabs)/map.tsx`; next stages should move trail preview/profile orchestration into trail-specific modules/components.
- Do not copy proprietary trail app data, colors, branding, photos, reviews, routes, or text. Screenshots are interaction references only.
- Mapbox can remain an online basemap/navigation provider, but trail graph extraction and offline trail identity must come from open, official, Trailhead-curated, community-owned, or user-owned sources.

## Proposed Next-Stage Files

- Extend existing trail profile types in `mobile/lib/api.ts` compatibly.
- Add Trail Experience orchestration outside `map.tsx`, likely under `mobile/lib/trailExperience.ts` and `mobile/components/trails/`.
- Extend `mobile/lib/offlineTrails.ts` with a versioned pack wrapper while preserving current saved trails.
- Extend `scripts/extract_trail_graph.py` or add adjacent scripts for canonical routes/zones only after the Stage 0 audit is reviewed.
- Add tests to `scripts/qa_trail_system_matrix.py` and `tests/test_trail_catalog.py` for any new model fields or generated manifests.

## Stage 0 Validation Targets

- `python3 scripts/qa_trail_system_matrix.py`
- `cd mobile && npx tsc --noEmit`
- Confirm no trail behavior changes are bundled with the camp discovery hotfix.
