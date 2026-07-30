# Trailhead Explore and Community Trails Active Checkpoint

Last updated: 2026-07-30 15:05 CDT (America/Winnipeg)

## Resume protocol

Read this file before every Explore and Community Trails work session and after any context compaction.

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Verify the protected Explore index remains untouched. The current Git object is `f39f30fdbb33477dacd8fcf5016612a8729dc69e`; the accepted pre-existing file SHA-256 remains recorded in the parent Trails checkpoint.
3. Never stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, the Valhalla/Railway work, Android Auto scripts, or other unrelated dirty files.
4. Continue from **Next exact packet**. Do not restart completed Trails T1-T6, broad Map/Search/Offline crawls, NPS research, Layers, Memory Gate, Originals, Android Auto, or screenshot work.

## Baseline

- Branch: `feat/trailhead-1.0.10-overhaul`.
- Exact pre-E1 HEAD: `f12bcf0c5b05c5d205ccda184a8c642885cdd560`.
- Accepted Trail Builder source: `582d6b714f0520dfccbf60d45ad5250d9eed47d2`.
- Android paired preview: runtime `native-1.0.10-android.7`, update `019fb2a4-f690-71bd-814c-ed80e3e90cac`.
- iOS paired preview: runtime `native-1.0.10-ios.6`, update `019fb2a4-f690-7345-9dc9-7511d75b9afb`.
- Task-owned background processes: none.
- Open P0/P1 entering E1: none.

## Protected and unrelated worktree state

The following pre-existing changes are excluded from every Explore Trails commit:

- `.cursor/`
- `dashboard/explore_serving_index_v2.json`
- `docs/app-store-copy.md`
- `docker/valhalla-artifact/start.sh`
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

Verify `git diff --cached --name-only` before every commit.

## Fixed product decisions

- Explore exposes five primary destinations: `Trails`, `Camps`, `Parks & Land`, `Scenic`, and `Guided`. The legacy `things` key remains an internal compatibility alias and is not a visible destination.
- `Explore -> Trails` is the global trail-discovery workspace. It reuses TrailSystem V2, shared cards and sheets, Trail Builder, GPX, recording, Follow, Offline V2, and 3D preview.
- Nearby is the default when location is available. Along Trip is an authenticated route-corridor scope. Search This Area remains explicit.
- Main-list trail cards require complete source-backed geometry. Partial or point-only records remain honestly labelled map candidates.
- User routes are private by default. Unlisted sharing is revocable. Public discovery requires moderation.
- Approved community routes remain visibly separate from verified agency/Trailhead routes. Credits are awarded exactly once after approval.
- No module or destination fact is fabricated when source data is missing.

## Design references

- Figma file `FJUcMWAfsNyjsguCEp2dBe`, page `0:1`.
- Trail Discovery `779:2412`; Trail cards `514:769`; Filters `518:858`; Trail Peek `407:162`; Trail Full `520:782`; Trailhead Full `520:872`.
- Mobbin behavior references used for E1/E2: AllTrails Home `912653a9-cc16-41ff-9118-da80954e81c9`, Filtering trails `f1bb1e90-f816-4b32-a6bc-08ababeadb43`, and custom-route flows `bb422f42-4ace-4532-a3ce-54bd98c0a423`, `83bea6a7-b67c-43c7-b81d-5dff6b0189c6`.
- Figma additions must reuse the Trailhead semantic variables, Barlow Condensed headings, Inter body type, existing trail cards, condition cards, and sheet components. Remove internal design explanations, invented access copy, and generic filler.

## Baseline audit

- TrailSystem V2 and canonical discovery already exist and remain authoritative.
- Explore currently exposes a visible `Things` category in both the hero and chip row. It must become an internal alias rather than be deleted from search/data compatibility.
- Existing destination detail modules already use a source-revision registry. E1 extends this typed model instead of replacing it.
- Legacy `POST /api/trails/community` currently creates a public profile, supplies fallback prose/access values, and awards five credits immediately. It is unsafe and must become a pending-submission compatibility adapter before community discovery can ship.
- Existing Trail Builder/GPX/recording geometry is reused. No second route model or map renderer is introduced.

## Next exact packet

### E1 — Explore foundations

1. Add the approved Figma Explore/Community Trails branches and states without changing the approved Trail sheet or Builder visuals.
2. Introduce a typed five-category registry and destination capability registry. Hide visible `Things` while preserving its internal alias and search behavior.
3. Stabilize category/navigation identity and source-revision module rendering with focused tests.
4. Add moderation-safe persistence and convert the legacy community endpoint into a pending adapter with no publication and no approval credit.
5. Audit existing `Trailhead community` profiles into a deterministic moderation report; do not delete owner data.
6. Commit only named E1 files, update this checkpoint, and push.

### E2 review boundary

After E1, implement Trail Discovery Nearby/Along Trip/filter/pagination/map-list synchronization, publish the Android-first preview, and stop for user review before iOS/production.

## Do not repeat

- Do not rework or retest Trail Builder route shapes, Follow, recording, Offline trail packs, flyover, shared trail sheets, complete route highlighting, or accepted Android/iOS Trails behavior without new evidence.
- Do not re-open Layers, Memory Gate, Yellowstone, NPS research, Originals lifecycle, Android Auto, Camp Guide, screenshot work, or broad app crawls.
- Do not publish community routes, award submission credits, or expose unlisted/private geometry before authorization and moderation tests pass.
