# Trailhead Trails Active Checkpoint

Last updated: 2026-07-27 23:01 CDT (America/Winnipeg)

## Resume protocol

Read this file before every Trails work session and after any context compaction.

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Verify `dashboard/explore_serving_index_v2.json` still hashes to `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
3. Never stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, or unrelated dirty files.
4. Continue from **Next exact packet**. Do not restart completed 1.0.10 crawls, research, or Android Auto work.

## Source and paired preview baseline

- Branch: `feat/trailhead-1.0.10-overhaul`.
- Exact pre-Trails HEAD: `023e27ebaad4bfed0a0a3b9a33bbd2c04430bbac`.
- Native build source: `08debcceff098b2e19542591a6959301ea5b5b93`.
- Android preview: build `68`, build ID `093378cc-0499-4ed7-9460-2db2e44ebe7e`, runtime `native-1.0.10-android.6`, installed on Samsung `RFCR408DA9B`.
- iOS preview: build `60`, build ID `ec7d6add-76eb-4eb0-8006-52d5654f0879`, runtime `native-1.0.10-ios.5`.
- Protected Explore index SHA-256: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- Task-owned background processes: none.
- Open P0/P1 defects entering Trails: none. Audible confirmation for the unrelated Android Auto Co-Pilot cue is parked and is not part of Trails.

## Protected and unrelated worktree state

The following pre-existing user changes are excluded from every Trails commit:

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

Verify the staged file list before every commit.

## Trails product decisions

- One unified Trail Builder supports canonical trails, tap-to-route, free drawing, GPX import, and recording.
- Activities and permitted uses appear only when source-backed. Missing facts are omitted; measured zero values remain valid.
- Trail downloads extend Offline V2 with Mapbox Outdoors and verified Trailhead trail artifacts.
- Starting away from a trail routes to a sourced trailhead before Trail Follow.
- Follow retains the compass and uses visual guidance, haptics/chimes, and optional concise voice.
- Flyovers are short, deterministic, silent, and follow the actual route on the main map.
- Back restores the exact previous trail state. Close exits the trail workflow. Active Follow or recording requires confirmation before stopping.
- Android preview and physical review precede iOS from the exact accepted SHA. Production remains a separate approval.

## T1 baseline findings

- The canonical trail index currently contains `43,296` records, while the bundled Explore geometry file contains only `7` geometries.
- Current discovery can surface raw OSM way fragments, technical road numbers, duplicate sections, partial distances, `Check access`, `Mapped route`, and a generic generated summary. T1 replaces those outputs with canonical trail systems and honest capability states.
- The existing map can identify a candidate through rendered-feature queries, but final selection must resolve the complete canonical geometry before highlighting, saving, previewing, or downloading.
- Selected geometry must remain above labels and POIs, with muted context and one restrained orange selected state. Point-only and partial records must not pretend to be complete routes.
- Exact licensed imagery is optional. When unavailable, use a real route preview or a clean text card; never substitute a generic destination photo.
- Mapbox Search remains fallback inventory for general destinations and POIs. Trailhead owns persistent trail identity and ordering.

## Approved design and behavior sources

- Figma file: `FJUcMWAfsNyjsguCEp2dBe`.
- Trail Peek: `407:162`.
- Trail Full: `520:782`.
- Trailhead Full: `520:872`.
- Trail cards and hub: `514:769`, `518:803`.
- Filters: `518:858`.
- Community/planning: `520:827`.
- Main-map 3D preview: `652:2020`.
- AllTrails trail detail: `https://mobbin.com/flows/b341bd84-4259-49d4-adc8-46f97a676117`.
- AllTrails custom routes: `https://mobbin.com/flows/409abb56-0b6a-4bc7-aeac-a5b939c37c89`.
- AllTrails trail preview: `https://mobbin.com/flows/3da88b77-2782-415b-b7fd-625b5d8332a4`.
- Strava route overview: `https://mobbin.com/flows/4cc0ed37-630d-4ac5-8203-bce848bc5a32`.
- References are behavioral only; no external branding or imagery ships.

## Packet ledger

### T1 - Canonical discovery, cards, and highlighting

- Status: Android accepted from source `ddb5dd320e864a3af3af9f8bf2c253adb9543baf`; paired iOS spot check remains before T2.
- Scope: `TrailSystemV2`, `TrailDiscoveryItemV2`, additive v2 discovery/detail/preview APIs, canonical grouping, honest geometry status, capability-driven cards, complete-route resolution, and selected-route highlighting.
- Design gate completed in Figma section `779:2406`, `25 · Trails T1 — Canonical Discovery + Highlighting — Review 01`:
  - Canonical discovery: `779:2412`.
  - Complete route selected: `779:2459`.
  - Partial route with honest actions: `779:2499`.
  - Trailhead-only result: `779:3027`.
  - Overlapping named-route chooser: `779:3067`.
  - Recovery and dark mode: `779:3107`.
  - Identity/discovery/card/highlight contracts: `780:2934`, `780:2937`, `780:2940`, `780:2943`.
  - Loading/empty/error/stale-selection contract: `780:2946`.
- The visual delta reuses the existing Trail Discovery Card, Place Sheet Header, Sheet Action Button, Trailhead V2 semantic/layout variables, Barlow Condensed editorial headings, and Inter product copy. Approved Peek and Full sheets were not redesigned.
- Visual QA passed: six complete device frames, no inherited placeholders, no section overflow, no unsupported zero metrics, no AI labels, raw enums, provider slugs, confidence copy, generic generated summary, `Extreme`, or `check local rules` wording.
- Final review render: `C:\Temp\trailhead-t1\t1-section-v3.png`, SHA-256 `fd6f5cffa18828c6eaa20a5109fe7b8e2f0b6234a49f9084ecfd76b9b0f238e2`.
- Figma review URL: `https://www.figma.com/design/FJUcMWAfsNyjsguCEp2dBe?node-id=779-2406`.
- Repository checkpoint entering the external Figma review: `3a5530a8c92adcccb0dc3ee204cb6309ec665bbf`; protected Explore index hash remained unchanged and all unrelated worktree changes remained excluded.
- Required evidence after implementation: focused API/model tests, canonical grouping fixtures, stale A-to-B rejection, complete highlight across tile boundaries, clean copy/media fallbacks, Android device delta, then iOS from the same accepted SHA.
- Implementation checkpoint:
  - Added additive `/api/trails/v2/discover`, `/api/trails/v2/{id}`, and `/api/trails/v2/{id}/preview` contracts without changing legacy endpoints.
  - Canonical discovery now keeps distant same-name trails separate, groups only connected fragments, lets authoritative complete geometry suppress only its own nearby fragments, removes generated/technical trail names, omits unsourced uses and facts, preserves measured zero values, and exposes only exact licensed media.
  - Android/iOS shared map code now resolves selection by stable system ID and geometry revision, rejects stale A-to-B detail responses, mounts the complete selected route as a persistent warm-white/orange native line above map labels, and keeps partial/point records on honest `View details` behavior.
  - No generic trail photography, inferred V2 difficulty, raw provider identifiers, AI labels, fabricated access copy, or zero-valued support pills were added.
  - Trail V2 viewport coordinates are redacted from access logs; the in-memory geometry cache is bounded.
  - Focused evidence passed: `9` Trails V2 backend tests; `64` legacy trail-catalog tests plus `4` subtests; `5` mobile V2 tests; existing trail sheet flow, hydration, action registry, Offline catalog/place-pack, TypeScript, copy, and privacy gates.
  - Direct source-backed probes returned `12` clean results for both Moab and Yosemite, with complete/partial/point capability states and no raw way numbers.
  - Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; unrelated worktree files remain excluded; task-owned background processes: none.
  - Railway deployment `1e579fd3-d658-479c-8af9-4604fef97bb0` succeeded from clean backend commit `c1653a047b7ccc616b84a2ff724adf2e70941f9b`; image digest `sha256:4c77c9ecb09113b833eb6fce67bfa9d0b7f22cfcd81e7f91eb4339e25b4d5529`.
  - Canonical geometry artifact revision `sha256:4e4aaab503cec42eedf4cb3762e754b7bb396f779e419295111c00040f595fab` contains all `43,296` published canonical trails in `64` private, hash-verified R2 shards. Railway reads these with its existing private R2 credentials; no public bucket access was added.
  - A sampled shard matched its declared byte size, SHA-256, and `714`-row count. The abandoned nested upload was deleted, and the existing public Offline trail-pack manifest was restored to its original `147` entries with no canonical geometry artifacts mixed into Downloads.
  - Live Moab verification returned `100` systems: `79` complete and `21` partial. A complete system hydrated to the same identity with a version-bound route geometry; a partial system exposed no preview route.
  - Final focused gates passed: `12` backend Trails V2 tests; mobile Trails V2 `5/5`; trail sheet flow `5/5`; trail hydration `4/4`; action registry `6/6`; Offline catalog preservation; TypeScript; copy audit across `165` files; and privacy controls.
  - Guarded preview publication succeeded from `9b0c7dc94ed8e18f6af60f06dc4eb9bb004c0626` on branch `preview-candidate-9b0c7dc94ed8e18f6af60f06dc4eb9bb004c0626-ms44fn9j-57ee2e887938134d4a853e94`; Android update `019fa6df-d091-7ae2-bb8d-dc092fa2f395`, group `1334727a-a122-4dbf-ac5d-2795a30836f8`, runtime `native-1.0.10-android.6`; paired iOS update `019fa6df-d091-7150-a199-52ddb798f1a2`, group `926ad6b1-baab-4882-b54c-74c2131deb63`, runtime `native-1.0.10-ios.5`.
  - Sentry artifact bundles were accepted for Android, iOS, and web before the preview channel moved. The first local wrapper timed out during export but did not move the channel; one guarded retry completed successfully. Do not republish this SHA.
  - Historical device gate at source `9b0c7dc`: Samsung `RFCR408DA9B` was connected but locked, so no acceptance claim was made at that earlier checkpoint. The later `ddb5dd3` evidence below supersedes that gate.
  - Android live acceptance completed from the narrow delta without repeating broad audits. Complete-route selection highlighted the resolved route across the map, expanding the sheet preserved identity, and Back restored the prior map state. Partial route `Above Abyss` correctly used `View details` instead of route preview.
  - Cleanup commits in this accepted packet: `d7545739`, `7f86f0e`, `7d71c19`, `28e52c7`, and final source `ddb5dd320e864a3af3af9f8bf2c253adb9543baf`.
  - Final source-owned fact cleanup omits the legacy generic values `Scout first`, `Check access`, `Unrated`, `Unknown`, `Mapped route`, `Trail route`, and `Point or route` while preserving genuine measured values such as `0.36 mi`. V2 full sheets no longer re-infer difficulty when the source supplies none.
  - Final focused gates passed: Trails V2 backend `14 passed`; mobile Trails V2 `5/5`; mobile TypeScript passed.
  - Railway production deployment `3c0e24f9-e5eb-434f-81b3-aa05595218f3` succeeded with image digest `sha256:b2e0001935037c8f5b863ffff224f2a1334f0c52383ec7102ac06864b83ec91c`. `/api/health` was healthy and live `Above Abyss` returned `geometry_status=partial`, `facts={distance_mi: 0.36}`, and no preview geometry.
  - Final guarded paired preview source: `ddb5dd320e864a3af3af9f8bf2c253adb9543baf` on branch `preview-candidate-ddb5dd320e864a3af3af9f8bf2c253adb9543baf-ms47ysr7-c5a3b8f333f566ed0f6e5561`.
  - Android group `43bedc34-0268-4443-95f0-24237eaaaef5`, update `019fa73a-892e-7c78-8ff5-c486fc32914b`, runtime `native-1.0.10-android.6`; device QA identity matched the complete source SHA and update.
  - Paired iOS group `1ee2b981-82e7-47a7-8944-6706581bbd5d`, update `019fa73a-892e-7a75-a355-6110cbe82b32`, runtime `native-1.0.10-ios.5`; device spot check remains.
  - Evidence directory: `C:\\Users\\User\\Documents\\Codex\\evidence\\trailhead\\trails-t1-28e52c7`. QA identity screenshot `11-ddb-qa.png`, SHA-256 `8e6f71c623fcf3e6f2183f3696db3c33a12e58bf6edc9705b29f598b5a6f7fe5`; partial-route screenshot `10-partial-view-details.png`, SHA-256 `e313c1894be3c04fa08c2e25c0f3e19aedb776910c8b3b901f4c827140cbd6b3`; Back-restoration screenshot `05-back-restored.png`, SHA-256 `67113880792e1a9f86dd138c4f1e4bfc586cefeaab7478ec51374df970acdebb`.
  - Open P2: global Search V2 does not currently return exact canonical trail `Above Abyss`, and the general query `Moab` can rank a canonical trail named `Moab` above the Mapbox city destination. This is recorded for T1 discovery/search integration rather than hidden or pursued through repeated device loops.
  - Checkpoint timestamp `2026-07-28T00:44:07-05:00`; branch `feat/trailhead-1.0.10-overhaul`; protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; task-owned background processes: none after cleanup.

### T2 - Trail and trailhead sheets

- Status: Android-first baseline audit in progress from repository HEAD `8ce8cb81e715b494a9f2a25cf0955ced517d45fb`; the user elected to defer the iOS T1 spot check and continue on Android.
- Pre-change checkpoint:
  - Existing code already uses `TrailheadSnapSheet`, `SheetCoordinator`, and `TrailPlaceSheetPeek` for Trail/Trailhead Peek and Full presentation.
  - Primary hydration is identity and request-generation bound, settles through `Promise.allSettled`, commits atomically, and falls back to a stable partial state after three seconds.
  - Parent trailhead/trail identity, stage, viewport, and scroll restoration already have characterization coverage.
  - Existing parity registry includes photos, route facts, surface/access, weather, nearby support, reports, ratings, Offline, 3D, route building, edits, reporting, sources, linked trails, coordinates, and navigation.
  - No visual or API change is justified before Android evidence. The next action is a narrow device delta of Trail Peek to Full, Trailhead to linked trail to Back, primary/overflow actions, and identity stability. Only a reproducible gap will be changed.
  - Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; `.cursor/` and unrelated dirty files remain excluded.

### T3 - Unified Trail Builder and GPX

- Status: pending T2 acceptance.

### T4 - Complete offline trail pack

- Status: pending T3 acceptance.

### T5 - Drive-to-trailhead, Follow, and recording

- Status: pending T4 acceptance; paired native candidates required.

### T6 - Simple trail flyover

- Status: pending T5 acceptance.

## Next exact packet

1. Open the installed iOS preview online and allow it to load paired update `019fa73a-892e-7a75-a355-6110cbe82b32` from source `ddb5dd320e864a3af3af9f8bf2c253adb9543baf`.
2. Run only the shared T1 spot check: one complete trail selection/highlight, one partial or point result with honest capability actions, Full to Peek Back restoration, and no invented trail facts.
3. Record iOS identity/evidence and mark T1 accepted. Then begin T2 Trail and Trailhead Sheets; do not republish `ddb5dd3` or repeat Android T1.

## Do not repeat

- Memory Gate, Layers audit, Yellowstone city/sheet crawl, NPS research, Originals lifecycle, Android Auto crawl, store screenshots, or the broad 1.0.10 regression.
- Do not redesign approved Peek/Full sheets during T1.
- Do not start T2-T6 before the preceding packet is accepted.
- Do not add speculative modules, generic photography, invented access facts, AI labels, random pills, or display zero for missing facts.
