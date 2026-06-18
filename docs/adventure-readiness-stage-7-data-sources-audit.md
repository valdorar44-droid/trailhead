# Adventure Readiness Stage 7 - Data Sources Audit

Date: 2026-06-18

## Scope

Stage 7 made provider/source rules explicit and reusable. The goal was to stop provider assumptions from living only in importer code or UI copy, and to give Explore, Mission Control, and Co-Pilot a deterministic confidence basis.

## Implemented

- Added `dashboard/provider_registry.py` with provider metadata for official, open, commercial partner, first-party, and community sources.
- Captured update cadence, storage rules, attribution, license URL, freshness label, default confidence, allowed surfaces, offline permission, and derivative constraints per provider.
- Added prohibited systematic sources to the registry boundary, including AllTrails, Hipcamp, Glamping Hub, Mountain Project, iOverlander, Wikicamps, public OSM tiles, and public Nominatim.
- Added `source_quality_summary()` with explicit factors:
  - official
  - recent
  - multiple sources
  - community confirmed
  - stale
  - inferred
  - unknown access
- Wired `scripts/explore_sources/base/source_policy.py` to use the registry instead of a disconnected allowlist.
- Wired `scripts/explore_sources/base/quality.py` to emit `source_quality` on ExplorePlace v3 records.
- Added `source_quality` to the ExplorePlace v3 dataclass and mobile API type.
- Added `mobile/lib/sourceConfidence.ts` for OTA-safe source confidence display.
- Updated Explore display rows to show confidence score and plain-language factors.
- Added `/api/providers/registry` for read-only provider metadata.
- Added `scripts/qa_provider_registry_matrix.py` to verify registry coverage and wiring.

## Current Provider Coverage

- Official: NPS, RIDB/Recreation.gov, USFS, BLM, USGS, NWS, AirNow, NASA FIRMS/WFIGS.
- Open/community data: OSM, Geofabrik, Overpass, OpenBeta, Wikidata, Wikipedia/Commons, Natural Earth.
- Commercial/partner: Viator, Mapbox.
- Trailhead-owned: curated records and community reports.

## Verification

- `python3 scripts/qa_provider_registry_matrix.py`
- `python3 -m py_compile dashboard/server.py dashboard/provider_registry.py scripts/explore_sources/base/quality.py scripts/explore_sources/base/source_policy.py`
- `npx tsc --noEmit`
- `npm run audit:routes`
- `git diff --check`

## Remaining Gaps

- Mission Control still needs to consume `source_quality` directly in its deterministic brief.
- Existing v1 Explore catalog records do not all have registry-backed `source_quality`; v3/imported records do.
- Provider-specific live cache windows should be enforced per API client where partner terms require it.
- Map pin and route-risk ranking can now use the helper, but not every callsite has been migrated yet.
