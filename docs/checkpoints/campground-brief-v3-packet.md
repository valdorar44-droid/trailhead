# Trailhead Campground Brief V3 Packet

## Baseline

- Timestamp: `2026-07-25T23:41:35-05:00`
- Branch: `feat/trailhead-1.0.10-overhaul`
- Starting HEAD: `663fc05661f8c3290f10e8a87d5cdf44980f4ee0`
- Protected Explore index SHA-256: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- Current paired preview source: `2341076`
  - Android update: `019f9841-9343-7953-bcb3-88a310462831`
  - iOS update: `019f9841-9343-7e57-b35e-eb205cbedf91`
- Current production source: `f90c150d`
  - Android build: `63`
  - Android runtime: `native-1.0.10-android.3`
  - iOS build: `58`
  - iOS runtime: `native-1.0.10-ios.3`
- Apple is reviewing the current 1.0.10 binary. Production promotion for this packet remains blocked until review finishes and the exact preview-tested commit is accepted.

## Protected and unrelated work

The following existing changes are not part of this packet and must not be staged, edited, or discarded:

- `.cursor/`
- `dashboard/explore_serving_index_v2.json`
- `docker/valhalla-artifact/start.sh`
- `docs/app-store-copy.md`
- `mobile/android/gradlew`
- `mobile/scripts/android-auto-dhu.sh`
- `mobile/scripts/install-maestro.sh`
- `mobile/scripts/maestro-config.test.mjs`
- `scripts/build_valhalla_artifact.sh`
- `scripts/build_valhalla_region_artifacts.sh`
- `scripts/probe_routing_50_states.py`
- `scripts/publish_valhalla_artifact.py`
- `scripts/run_nps_hourly_enrichment.py`
- `scripts/valhalla_artifact_bootstrap.py`

Task-owned background processes: none.

## Packet scope

Implement only the source-backed `CampgroundBriefV3` packet:

- Add a free factual brief keyed by a server-resolved campground identity.
- Keep `/api/ai/campsite-insight` compatible for released clients.
- Keep personalized synthesis behind the existing Explorer or credit path.
- Render factual campground, site, rig/access, amenity, booking/contact, live condition, nearby-service, nearby-place, source, freshness, and unavailable-field information without AI labels.
- Preserve every existing campground sheet module, including photos, site types, campsite rows, rig information, coverage, weather, booking, comments, ratings, edits, reports, official sources, and Offline data.
- Verify developed, dispersed, NPS/Recreation.gov, RV/private, and sparse records.

## Evidence and known cause

- The current `campsite-insight-v2` validator correctly removes unsupported generated assertions.
- When too little generated content survives, the legacy UI falls back to one generic planning sentence.
- Rich source-owned campground facts already exist in `CampsiteDetail`; they should be assembled deterministically rather than generated.
- Nearby service categories already exist in the server context model and include fuel, water, grocery, repairs, medical help, trailheads, viewpoints, parking, dump stations, and related road-trip services.

## Do not repeat

- Memory Gate or broad Map crawls.
- Layers, Yellowstone Search, NPS rabbit-hole, Android Auto, Originals lifecycle, or screenshot work.
- Campground sheet redesign research; this packet changes data presentation inside the accepted sheet.
- Any later queue item before this packet receives focused Android acceptance.

## Exact next action

Add the pure brief builder and source-owned campground brief endpoint, then integrate the free factual section into the existing campground sheet while retaining the legacy personalized planning request as a separate, explicitly requested action.
