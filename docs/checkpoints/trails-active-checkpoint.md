# Trailhead Trails Active Checkpoint

Last updated: 2026-07-28 02:08 CDT (America/Winnipeg)

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

- Status: Android T2 is checkpointed with one unresolved P1; do not begin T3 or repeat the broad Trails crawl.
- Pre-change checkpoint:
  - Existing code already uses `TrailheadSnapSheet`, `SheetCoordinator`, and `TrailPlaceSheetPeek` for Trail/Trailhead Peek and Full presentation.
  - Primary hydration is identity and request-generation bound, settles through `Promise.allSettled`, commits atomically, and falls back to a stable partial state after three seconds.
  - Parent trailhead/trail identity, stage, viewport, and scroll restoration already have characterization coverage.
  - Existing parity registry includes photos, route facts, surface/access, weather, nearby support, reports, ratings, Offline, 3D, route building, edits, reporting, sources, linked trails, coordinates, and navigation.
  - No visual or API change is justified before Android evidence. The next action is a narrow device delta of Trail Peek to Full, Trailhead to linked trail to Back, primary/overflow actions, and identity stability. Only a reproducible gap will be changed.
  - Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; `.cursor/` and unrelated dirty files remain excluded.
- Android implementation and evidence:
  - Baseline checkpoint commit `8d86640` recorded the exact narrow scope. The first Android run on paired source `42b035cfe96351e6c6b324412cfb8a9b2b5d5858` found one deterministic Explore P1: `Yosemite Trails` advertised six trails but opened its Yosemite parent without carrying the trail list.
  - Commit `42b035cfe96351e6c6b324412cfb8a9b2b5d5858` fixed the parent handoff, retained same-revision trail richness, and forced source-backed trail hydration when the active Trails module had no records. Focused Explore, sheet, Search V2, Offline, NPS/Viator, copy, privacy, and TypeScript gates passed.
  - Guarded paired preview from `42b035c`: Android group `09e276c9-8eb2-4e91-b143-213beb56dc00`, update `019fa772-6605-7114-aafb-b14f34d9e3dc`, runtime `native-1.0.10-android.6`; iOS group `bbdd88f2-8cc3-477e-8800-54487c8563a3`, update `019fa772-6605-7dab-8f00-086778836515`, runtime `native-1.0.10-ios.5`.
  - Device proof confirmed that Yosemite now opens with all six real trail records and that Mist Trail reaches the shared Trail Peek/Full flow. It also exposed one P1: the Explore-to-Map handoff opened Mist Trail over the restored world viewport and replaced its known `Easy` fact with the legacy `Scout first` fallback.
  - One evidence-backed correction was made in commit `b64910a1b25db3e2c5d078b6543fdec1dda1a64b`: carry source-backed trail context through the handoff, defer consuming a cross-tab selection until the Map is active and ready, and remove the generic `Pick by distance...` hub sentence. New handoff contract tests passed `3/3`; Trail sheet flow passed `6/6`; Trail hydration passed `4/4`; TypeScript passed.
  - Guarded paired preview from `b64910a`: candidate branch `preview-candidate-b64910a1b25db3e2c5d078b6543fdec1dda1a64b-ms4b26bo-22a72ce331ebde5aad9ff833`, branch ID `019fa789-ec76-7f03-b0f7-f1d2a92c28a7`; Android group `eb39b76d-39ad-4471-ab65-0eb26e72479d`, update `019fa78a-126e-7b09-8456-7cbbd7a09e79`, runtime `native-1.0.10-android.6`; iOS group `e06c36ac-aa45-46a8-b8cb-349bb7947f0d`, update `019fa78a-126e-7308-9792-583a732ea6a3`, runtime `native-1.0.10-ios.5`. Sentry accepted Android, iOS, and web source maps before the preview channel moved.
  - Android QA identity matched build `68`, full source `b64910a1b25db3e2c5d078b6543fdec1dda1a64b`, and update `019fa78a-126e-7b09-8456-7cbbd7a09e79`.
  - The single retest passed fact/copy preservation: Mist Trail Peek shows `Easy`, `3.2 mi`, and `Out & Back`; the generic hub sentence is gone. The map is still restored to the North America/world viewport instead of framing Yosemite, so the camera P1 remains after the one permitted correction. No second speculative OTA was published.
  - Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\trails-t2-b64910a`. QA XML `01-qa.xml`, SHA-256 `b9f48d021ca3c244122a1e01cf949d723e4be033751f0890e15ee7215aa42ca8`; Yosemite hub XML `06-yosemite.xml`, SHA-256 `32406b6ae175241895caca076140249b986209d8eadf38e74c2af6c7f1a34679`; failed framing screenshot `09-mist-peek.png`, SHA-256 `c8b656b3f4df666eec59c0a50f27c961cec9b722cc99e698740ab0a4c756539b`.
  - Live `/api/trails/v2/discover` returned no canonical system within the tested eight-mile Mist Trail query, so no complete geometry or Preview action was fabricated. The point selection and trusted curated facts remain valid while the catalog gap is handled separately.
  - Open P1: determine which camera command follows the valid Trail selection focus and restores the world viewport. Capture one internal, coordinate-free command-order trace keyed by selection identity and map/style generation, fix the demonstrated owner, and rerun only Explore -> Yosemite Trails -> Mist Trail -> Map -> Peek/Full plus Back restoration.
  - iOS T1/T2 spot checks remain deferred by the user's Android-first direction. Task-owned Metro, Expo export, publisher, Gradle, and Maestro processes: none.

### T3 - Unified Trail Builder and GPX

- Status: Android accepted from source `dbb22f2fb5f2d0dad30a57632e9e5ba56ed86b78`; iOS remains deferred by explicit Android-first direction. The recorded T2 viewport P1 remains parked and is not being reopened in this packet.
- Pre-change checkpoint (2026-07-28):
  - Branch `feat/trailhead-1.0.10-overhaul`; exact HEAD `480c0783db0d7423bf0d23da70003e428c9a732c`.
  - Android Samsung `RFCR408DA9B` is connected and unlocked with Trailhead `1.0.10` build `68`; airplane mode was `off` before testing.
  - Installed preview identity remains Android runtime `native-1.0.10-android.6`, update `019fa78a-126e-7b09-8456-7cbbd7a09e79`, source `b64910a1b25db3e2c5d078b6543fdec1dda1a64b` until this packet publishes a replacement.
  - Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; `.cursor/` and every unrelated dirty file listed above remain excluded.
  - Characterization found one existing main-map builder with canonical-trail seeding, tap-to-route, free drawing, graph/online/manual fallbacks, route review, elevation, save, follow, and flyover. The existing `gpxImport` parser validates coordinates and persists imported route geometry, but its UI entry lives in Profile rather than Trail Builder.
  - Demonstrated T3 gaps: no Trail Builder GPX entry/review, no redo after point undo, no unsaved-exit decision, and visible builder copy still contains broken separators and engine-oriented phrasing. These are the only initial implementation targets; recording remains T5.
  - Focused T3 proof: pure builder-session and GPX validation tests, existing route-builder/Trail sheet/Offline preservation/copy/privacy/TypeScript gates, then one Android delta covering known trail, pins, draw, GPX, undo/redo, exit recovery, save, and reopen.
  - Task-owned background processes: none.
- T3 implementation checkpoint:
  - The existing main-map Trail Builder now has one launcher for route points, free drawing, and local GPX import; known trails continue entering the same builder from their sheet.
  - GPX parsing was split into a pure shared parser so Profile import and Trail Builder use the same validation. Trail Builder keeps imported coordinates local until explicit Save, omits timestamps/waypoint descriptions from its saved route, rejects empty, oversized, malformed, invalid-coordinate, and over-50,000-point tracks, and opens the longest valid track for review.
  - Point building now has deterministic undo/redo. New edits clear redo. Back and Close protect unsaved work with Keep editing, Save draft, and Discard.
  - Source-backed permitted uses constrain activity selection. Unsupported uses cannot build; missing permissions show an explicit review warning. Hike, bike, horse, OHV/4WD, and mixed-use selections choose matching route profiles without claiming legal access.
  - Route review adds Reverse, Out & back, and Close loop transformations. Saved manual routes retain builder mode, activity, anchors, and redo history through the existing Offline Trail store; older saves remain compatible.
  - The launcher and builder use the approved warm-white/near-black/orange system. No second renderer, provider label, AI label, generic photo, public GPX pin, native dependency, public API, or duplicate storage system was added.
  - Focused gates passed: Trail Builder session/GPX `5/5`; Trail sheet flow `6/6`; mission/flyover smoke; sheet actions/coordinator; Offline V1/V2 preservation/runtime; copy audit across `166` files; privacy controls; and full TypeScript.
  - Android preview publication and live device evidence remain next. Task-owned background processes: none.
  - Implementation source `486ef1f40acd5cad1ef853549c16fb696e5087ea` published to Android update `019fa7cc-8cbc-792e-ad15-705a86381437`, group `f8b1af08-5d1d-4e9a-9666-95bc71c9a1e0`, runtime `native-1.0.10-android.6`; paired iOS update `019fa7cc-8cbc-7411-bb57-43eae342d8b8`, group `ef32a2fa-4b90-480a-8a9c-c16bf17fe4a2`, runtime `native-1.0.10-ios.5`. Samsung QA identity matched build `68`, full source, runtime, and Android update.
  - Android delta passed the unified launcher, point placement, route metrics, undo/redo, build/review, Save draft guard, GPX picker/import, exact route framing, and Reverse transform using the local five-point `Moab short trail check` fixture. No navigation or Follow session was started.
  - One deterministic T3 P1 was captured: Discard closed the GPX builder but left the unsaved imported `selectedTrail` active, allowing the next touch to open a normal Trail sheet with unavailable preview. The evidence-backed correction now snapshots the invoking trail selection/collapse state, restores it on Discard/launcher close, and exposes the three route transforms from finalized point routes through one compact Route options action. Characterization coverage increased to `6/6`; Trail sheet `6/6`, Offline V1/V2, copy, and TypeScript gates pass. One corrected Android assertion remains before T3 acceptance.
  - Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\trails-t3-486ef1f`. Task-owned background processes: none.
  - Corrected source `dbb22f2fb5f2d0dad30a57632e9e5ba56ed86b78` published to Android update `019fa7e1-f78c-74de-b95b-6111d116c71a`, group `708f3226-1b55-4e9d-a2ef-1b00a9392486`, runtime `native-1.0.10-android.6`; paired iOS update `019fa7e1-f78c-7cf0-9ec8-9f5f07becbff`, group `97640ef8-059d-47bf-a817-ea5bb2b782d8`, runtime `native-1.0.10-ios.5`.
  - Samsung QA identity matched the corrected source and Android update. The one permitted retest passed GPX import -> route transform -> Discard: the builder closed, the unsaved selection was cleared, and the normal Map returned without a blank or stale Trail sheet.
  - Corrected evidence: `C:\Users\User\Documents\Codex\evidence\trailhead\trails-t3-dbb22f2-discard.png`; QA hierarchy `C:\Users\User\Documents\Codex\evidence\trailhead\trails-t3-dbb22f2-qa.xml`; GPX review `C:\Users\User\Documents\Codex\evidence\trailhead\trails-t3-dbb22f2-gpx.png`.
  - Android T3 acceptance timestamp: `2026-07-28`; protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; airplane mode was restored off; task-owned background processes: none.

### T4 - Complete offline trail pack

- Status: Android accepted at the completion checkpoint below. The first-attempt RNMapbox lifecycle, immutable trail artifact, support-place inventory, offline search, downloaded campground sheet, and route/map behavior now pass on the connected Samsung. Earlier blocked notes remain as historical evidence only.
- Pre-change scope:
  - Extend the existing Offline V2 prepare/materialize/runtime path with a version-bound canonical trail scope; do not create another downloader or ownership store.
  - Keep all existing V1 region, selected-area, trip/corridor, PMTiles/vector, routing, trail, contour, saved-route, and six-family place downloads untouched.
  - A complete pack must include the Mapbox Outdoors style/tile region plus exact canonical trail geometry/profile, trailheads/access, nearby camps/services/support, routing graph edges, contours/elevation context, and local SQLite trail/place search. Optional media is shown offline only when a licensed hashed artifact exists.
  - Android proof is limited to two small canonical trail packs: one normal, one interrupted and resumed; then airplane-mode map, search, sheet, geometry, and support-place checks. Existing downloads are inventoried before and after and are never cleared.
  - The recorded T2 camera/world-viewport P1 remains parked and cannot expand this packet.
- Implementation and deployment:
  - Source `526a26354112943c58382daf21bcf380ca28d745` added an optional trusted canonical-trail scope to Offline V2 without changing legacy bundle identity when the scope is absent.
  - The server resolves the exact canonical trail and geometry revision, rejects stale revisions, derives a trusted 1.2 km corridor from complete geometry, and binds the pack to Mapbox Outdoors. The worker re-resolves the trail before materialization.
  - Mobile uses the existing Offline V2 coordinator and existing regional routing/contour/trail repositories. Trail Download saves the local trail, requires complete canonical V2 geometry, creates or resumes the scoped V2 job, and starts the existing regional support pack. No V1 download is migrated or deleted.
  - Focused backend and mobile Offline/Trails/sheet/copy/privacy/TypeScript gates passed before publication. Railway deployment `4b3c126f-538f-4b1d-8942-6c1589afc3fd` succeeded with image digest `sha256:b5bbd1f96f1ee20b9bc43adbd998be5889fe03c6c187300cfef4a29e13bd1753`.
  - The implementation preview published Android update `019fa818-ac77-75b4-8752-288b7d6ac366`, group `edb758aa-c85c-4db4-ad5a-95bc15560eb5`, runtime `native-1.0.10-android.6`; paired iOS update `019fa818-ac77-766e-824d-7dcba61adf77`, group `2b726c34-830a-4b83-921f-3380d2b4ac26`, runtime `native-1.0.10-ios.5`.
- Android evidence and blocking defect:
  - Samsung `RFCR408DA9B`, Trailhead `1.0.10` build `68`, successfully discovered authoritative V2 trails through Map -> Search -> Trails. Complete trail `Brumley Arch (Sz)` opened the shared full sheet and exposed the capability-driven Download action.
  - The existing manager retained the same inventory and showed the scoped trail plus the required Utah regional support pack. Utah reached `Directions saved` at `623.8 MB`; the trail pack reached `Verifying` at `4.8 MB`. No pre-existing download was cleared.
  - The first run crashed natively at `2026-07-28 05:14:49 -05:00` with `SIGSEGV` in Android HWUI/EGL/Mali RenderThread code while the full-screen Offline manager covered the active map; exit evidence recorded approximately `713 MB` PSS and `729 MB` RSS.
  - One evidence-backed JS correction, source `31148fea593405ade8a7fe27b8eb3644b10515e1`, suspended map visual work behind the full-screen Offline manager while preserving map/controllers and background navigation/audio. Focused lifecycle tests passed `9/9`, TypeScript passed, and the clean commit was pushed.
  - Guarded paired correction preview: candidate branch `preview-candidate-31148fea593405ade8a7fe27b8eb3644b10515e1-ms4ihq1f-95bacb48543c95d3394b831a`; Android group `a9500255-9a46-46bc-bf91-e35c2da783a7`, update `019fa849-16d0-7277-9bb0-e7026476d6be`, runtime `native-1.0.10-android.6`; iOS group `e821aacf-3d1e-4342-8a45-35bc5222b043`, update `019fa849-16d0-7e58-80d5-b2a6e29395a6`, runtime `native-1.0.10-ios.5`. Sentry source maps were accepted before the preview channel moved.
  - QA identity matched full source `31148fea593405ade8a7fe27b8eb3644b10515e1`, build `68`, runtime, and Android update. Reopening the persisted manager kept the process alive at approximately `528 MB` PSS and preserved both downloads.
  - The single permitted corrected assertion still failed: after the scoped pack remained at `Verifying`, pausing and resuming it produced another native `SIGSEGV` at `2026-07-28 05:39:20 -05:00`, approximately `588 MB` PSS/RSS. The second stack is in Android HWUI display-list destruction (`SkPaint`, `RenderNode::destroyHardwareResources`), not a JavaScript exception or a simple memory-cap crossing.
  - Per the no-loop rule, no second speculative correction, OTA, second trail download, or airplane-mode acceptance run was attempted. T4 remains blocked until the covered-map rendering/lifecycle interaction is corrected and this one assertion passes.
  - Evidence directory: `C:\\Users\\User\\Documents\\Codex\\evidence\\trailhead\\trails-t4-526a263`. QA identity XML SHA-256 `140d1619664d34b04738a0c45b4929cdf5f98a5ca34dc2ab056d137217a98f16`; corrected manager screenshot SHA-256 `e6dfe9f8fcdd08314efc9659c5dc976b96f68a9ea293d9e64017a8123374a238`; verifying/paused evidence SHA-256 `e018a959431c32fdcb39f1264d4d4c62703baf254a36f54f5b7b39b0583d4031`; crash log SHA-256 `bab4f9fd8d08bdd95d6aedf39310ed218ac14f17be9f1fb9b5b4266765f00051`; exit-info SHA-256 `b24a81dbec4cd946fc0ad98d5cd2026144ad6fd4f3543082324599bc0964259f`.
  - Checkpoint timestamp `2026-07-28T05:40:48-05:00`; branch `feat/trailhead-1.0.10-overhaul`; exact HEAD `31148fea593405ade8a7fe27b8eb3644b10515e1`; protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; airplane mode is `off`; task-owned Metro, Expo, Gradle, Maestro, and publisher processes: none.

- Forward continuation and final block (2026-07-28):
  - Renderer lifecycle source `c4e500a31f00498bcd5b4f059050ffae8ee66b9a` separated paused visual work from mounted map state. Canonical trail identity source `2731a202ef1681aa56a96dbaf723d45043583b89` preserved `system_v2_id`, hydrated the exact Trail System after explicit selection, and exposed the real Preview/Download capabilities for `Brumley Arch (Sz)`.
  - The canonical identity preview proved Search -> Trail Peek -> Full -> Download without a blank sheet or provider fallback. Android update `019faa0f-0197-7925-a71e-397d5dd3679c`, group `65a73596-152b-47ff-b5a7-a6c51c0d6b30`; paired iOS update `019faa0f-0197-7dc0-8517-e0fbfe7b0522`, group `ba9695b2-44e5-4729-bbae-26f3d4993ba8`.
  - That emulator run found a deterministic Expo SQLite FTS close abort in `libexpo-sqlite.so`/`exsqlite3_finalize`. Source `495ff7e29f988b33cc4686091efc13d9d678c6ef` applies Expo's documented FTS workaround, `finalizeUnusedStatementsBeforeClosing: false`, with a regression assertion. Offline V2, Trails V2, Trail Builder, Search V2, and TypeScript gates passed. Its paired preview used Android update `019faa24-3d49-778c-b669-2b76a32317e6`, group `fa3b6fbb-b67e-47d4-9126-d01dd5472446`; iOS update `019faa24-3d49-7fc5-ba63-68e39fa0e212`, group `b04e584e-86b3-4303-98aa-b509af862a12`.
  - The SQLite signature did not recur. Opening Downloads then exposed a different deterministic native abort: MapLibre `FileSource.initialize` received an invalid tile-server object because the manager enumerated MapLibre and RNMapbox packs concurrently even though only one renderer was mounted.
  - Final source `2b86400a5b2dc2d86f8271683a614b92631fc43c` inventories only `activeNativeRenderer`. Inactive V1 packs remain on disk and are enumerated when their renderer is active; no pack is migrated or deleted. Offline parity, map lifecycle, Offline V2, and TypeScript gates passed.
  - Final guarded paired preview: Android update `019faa31-5877-740b-9c58-0e5e02731acf`, group `dce1e4d7-e96e-406f-89e6-f4957606cf88`, runtime `native-1.0.10-android.6`; iOS update `019faa31-5877-700a-bf22-4b0e52873db5`, group `70d38a66-ff09-4231-8b21-d88423210609`, runtime `native-1.0.10-ios.5`. Emulator identity exactly matched Android build `68`, source, runtime, and update.
  - The final assertion no longer crashes: Downloads opened, the original Utah support download remained visible at `Directions saved · 623.8 MB`, and Brumley remained present at `Verifying · 4.8 MB`. The app stayed alive for the complete two-minute bounded window. Brumley never advanced to `Ready`, so the second interrupted pack and airplane-mode map/search/sheet/geometry/support assertions were not run or claimed.
  - Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\trails-t4-c4e500a`. Exact identity XML SHA-256 `3472c6cc4b26e57e7fe3003508573612acf7e9c0e27c3008943f69860354bd98`; initial final-manager screenshot SHA-256 `bb2b69a98b55be93bca862bbf6cd8eed1f0dfb27dbd029c0a8b2105f32586148`; two-minute hierarchy SHA-256 `56f029b73b7b9e4a29af0f93c0d79a3990e598589ff7067601e4acd70c1b771a`; two-minute screenshot SHA-256 `b87e2a049301c7e727c46f4ed8e76e8d7094b6013bb1c50b9e80162f8ab64eb0`.
  - Open P1: trace the Offline V2 verification state machine once, using fixed job/error codes and artifact-state transitions only, to identify which consumer never settles. Add one deterministic regression, make one evidence-backed correction, then create one fresh scoped pack and run Ready -> interruption/resume -> airplane-mode acceptance. Do not reopen Search, Trail sheets, renderer lifecycle, or the two resolved native crash signatures without new evidence.
  - Cleanup completed: the temporary QA account and its owned test records were deleted, its Railway SSH key and local credential/key files were removed, task worktrees were pruned, airplane mode was restored off, and the task-owned emulator was stopped.
  - Checkpoint timestamp `2026-07-28T14:39:33-05:00`; branch `feat/trailhead-1.0.10-overhaul`; exact HEAD `2b86400a5b2dc2d86f8271683a614b92631fc43c`; protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; task-owned Metro, Expo, Gradle, Maestro, publisher, and emulator processes: none.

- RNMapbox persisted-pack recovery continuation (2026-07-28):
  - Source `fa456a0` replaced the non-settling verification phases with bounded, observable RNMapbox readiness; source `8e08acd14920819c1e03d801ef312378d7e50539` repaired atomic promotion into a missing destination parent. Brumley Arch (Sz) then completed at `Ready offline · 5.2 MB`; Adit Extension recovered after a cold relaunch and completed at `Ready offline · 5.3 MB`. The existing Utah regional support download remained present at `Directions saved · 623.8 MB`.
  - Source `d41a93165f3918a684eadbd4dfc4111dcccfbde2` added a pure native-pack recovery helper and immutable metadata validation. Guarded paired preview branch `preview-candidate-d41a93165f3918a684eadbd4dfc4111dcccfbde2-ms57f803-67a9c1be889684d22961b570`: Android group `97c948b8-1346-4629-ba82-2cd17af94014`, update `019faac7-54f2-7833-a5d3-b707d24a1af7`, runtime `native-1.0.10-android.6`; iOS group `f1248851-44ed-471d-9a84-1dcdcdc5512f`, update `019faac7-54f2-7d0b-8824-7b11bbed8fa4`, runtime `native-1.0.10-ios.5`.
  - Android QA identity matched `1.0.10` build `68`, full source `d41a93165f3918a684eadbd4dfc4111dcccfbde2`, runtime and update. A new Brumley Creek Climbing Access pack first exposed `Download incomplete · 4.9 MB` with fixed code `RNMBXOfflineModule`; one explicit retry in the same process recovered the exact persisted pack to `Ready offline · 5.3 MB`, with all earlier downloads retained.
  - Source `fad527c35f228eba42cf5929b32e7a109e94c1c8` added bounded registry polling without recreating the native pack and clears only the stale bootstrap error once the exact immutable pack is queryable. Offline V2, TypeScript, copy across `166` files, privacy, and whitespace gates passed. The clean three-file commit was pushed.
  - Guarded paired preview branch `preview-candidate-fad527c35f228eba42cf5929b32e7a109e94c1c8-ms580kpk-76918bffd4a079009a99f647`: Android group `e52830bf-011a-404e-a79d-630728a79b36`, update `019faad6-8387-7df9-95e9-3ab413d758b4`, runtime `native-1.0.10-android.6`; iOS group `644d57f7-647a-47a1-90fd-c81fdacbf762`, update `019faad6-8387-746a-8948-0991b0decd92`, runtime `native-1.0.10-ios.5`. Android QA identity matched the full source and update.
  - The one permitted fresh assertion still failed: new complete trail Brumley Loop reached `Download incomplete · 5.0 MB` with the same fixed `RNMBXOfflineModule` code after the initial Download action. The process remained alive and the prior four downloads were retained. This proves the native callback error arrives after the helper observes the pack or otherwise survives that bootstrap boundary; another speculative retry was not published.
  - Per the no-loop rule, pause/resume and airplane-mode acceptance were not claimed. Airplane mode remains `off`, Wi-Fi remains enabled, and no current-candidate OOM/ANR/native crash occurred.
  - Evidence: exact QA identity XML `C:\Users\User\Documents\Codex\evidence\trailhead\trails-t4-fad527c-qa.xml`, SHA-256 `2197e4de740dd0f40e89dd424384c07862f4446363314f4949017644dfa7d60d`; failed fresh-pack hierarchy `C:\Users\User\Documents\Codex\evidence\trailhead\trails-t4-fad527c-loop-download.xml`, SHA-256 `e3101887d8335e8ef8bb80fa19ac004d6ec64111ca627bfde1b40a96e5f89057`; screenshot SHA-256 `d405a3cd6cbe678bd7ca510dfc456ca62cd07d7b37a199921b7be58b572763ba`; prior same-process recovery hierarchy SHA-256 `950087a5aa855a7ac9bfc3beb03e0683c6cf049356091844fbbe26946a6fed31`.
  - QA cleanup: the temporary operator account was demoted successfully, so it no longer has admin access. Its normal account-deletion request returned HTTP 500 and the account still exists; this narrow cleanup failure is recorded rather than hidden. The local Railway private/public test key files were deleted, leaving no usable local credential. Remove the now-orphaned remote public key and remaining non-admin QA account through Railway before the next device run. Task-owned publisher/Metro/test processes and the two T4 preview worktrees were removed.
  - Exact next action: add a fixed, privacy-safe transition trace around create callback, registry visibility, immutable metadata, status percentage/progress and terminal callback ordering for one new pack. Treat a creation callback as transient only while the exact pack exists and makes forward progress; otherwise preserve the real error. Add one deterministic clock/state regression, make one correction, then run one new initial Download assertion. Only if that reaches `Ready` may T4 continue to pause/resume and airplane-mode map/search/sheet/geometry/support checks.
  - Do not repeat the `d41a931` immediate-registry or `fad527c` bootstrap-clear approaches, broad Trails/Search/sheet crawls, resolved native crash signatures, or previously completed packs. Do not begin T5.
  - Checkpoint timestamp `2026-07-28T17:29:00-05:00`; branch `feat/trailhead-1.0.10-overhaul`; exact HEAD `fad527c35f228eba42cf5929b32e7a109e94c1c8`; protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.

  - RNMapbox forward-progress correction checkpoint (2026-07-28): source `89c7e10` replaces immediate callback failure with a deterministic exact-pack lifecycle. It records only fixed phase codes and numeric progress buckets, never pack identity, bounds, routes, search text, account data, or raw native messages. A callback error remains transient only if the same registered pack advances; completion wins, while a missing or eight-second-stalled pack returns a fixed terminal code.
  - Deterministic coverage now includes canceled/native error classification, callback-before-progress recovery, exact-pack disappearance, no-progress stall, completion, and abort/pause. The full Offline V2 suite passed, including account isolation, V1 catalog preservation, active renderer, preparation/runtime, scope cleanup, place search, Offline manager parity, and trail-pack requests. TypeScript, copy audit across `166` files, privacy controls, and whitespace checks passed.
  - The only next assertion is a fresh complete trail Download on Android from the paired preview of `89c7e10`: it must reach `Ready` on the initial action without restart or manual retry. If it passes, run one pause/resume and one radio-disabled offline map/search/sheet/geometry/support check, restore radios, and accept T4. If it fails, record the fixed lifecycle code and stop without another speculative correction.
  - Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; unrelated dirty files remain excluded; task-owned background processes: none.

### T5 - Drive-to-trailhead, Follow, and recording

- Status: pending T4 acceptance; paired native candidates required.

### T6 - Simple trail flyover

- Status: pending T5 acceptance.

## Next exact packet

1. Resume from `fad527c35f228eba42cf5929b32e7a109e94c1c8`; verify the protected Explore-index hash before staging anything.
2. Add one fixed, privacy-safe RNMapbox transition trace for create callback, registry visibility, immutable identity, status progress and terminal ordering. Do not log bounds, routes, searches or account data.
3. Add a deterministic fake-clock regression for a callback error that precedes a queryable, progressing exact pack. Make one state-machine correction: the callback remains transient only while that pack makes progress and becomes terminal when it stalls or disappears.
4. Run focused Offline V2/runtime/parity/TypeScript/copy/privacy gates, publish one paired preview, and create one new complete trail pack. Require initial Download -> `Ready` without restart or manual retry.
5. Only after that assertion passes, test pause/resume and airplane-mode map/search/sheet/geometry/support, restore device radios, record exact inventory parity, and accept or block T4. Keep iOS device testing and T5 deferred until Android T4 passes.

## Do not repeat

- Memory Gate, Layers audit, Yellowstone city/sheet crawl, NPS research, Originals lifecycle, Android Auto crawl, store screenshots, or the broad 1.0.10 regression.
- Do not redesign approved Peek/Full sheets during T1.
- Do not start T2-T6 before the preceding packet is accepted.
- Do not republish `42b035c` or `b64910a`, rerun the six-trail hub fix, or perform another speculative camera retry.
- Do not add speculative modules, generic photography, invented access facts, AI labels, random pills, or display zero for missing facts.
- Do not reopen the accepted T3 flow or the parked T2 camera defect while implementing T4.
- Do not repeat the two failed `526a263`/`31148fe` covered-map download runs or publish another speculative visual-work-only correction. Use the captured native stacks to choose the next renderer-safe change.
- Do not repeat the resolved SQLite FTS-close or inactive-renderer crash runs. The only remaining T4 investigation is the non-settling `Verifying` transition on a fresh scoped pack.
- Do not repeat the immediate registry-reload recovery from `d41a931` or the bootstrap-clear/poll correction from `fad527c`; the remaining boundary is callback-versus-forward-progress ordering.

### Mapbox Outdoors style-switch P1 (2026-07-28T19:08:31-05:00)

- User-reported issue was reproduced once on Samsung `RFCR408DA9B`, Trailhead `1.0.10` build `68`, source `e3ffd3e96d22c3cc906dea2a577b0bbeb7337b54`, Android update `019fab0e-9b86-7ae1-a1ee-038bb896a568`, runtime `native-1.0.10-android.6`.
- Standard displayed correctly. Selecting Outdoors produced a blank white native map. Logcat showed `RNMBXLineLayerManager.setSlot` failing while the mounted layer changed from the Mapbox Standard `top` slot to no slot, followed by missing-source errors. This is a renderer placement-transition fault, not a missing layer or slow style download.
- Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\trails-t4-e3ffd3e`; primary screenshot `35-outdoors-selected.png`; deterministic log `35-outdoors-logcat.txt`.
- Functional fix commit `01ae928056e467689a44156014fc701f4923203d` classifies Mapbox styles as `standard-slots` or `classic` and remounts the RNMapbox surface only when crossing those placement families. Styles inside one family still update in place. The camera, layer registry, compass, Offline systems, Trails, and Originals contracts are unchanged.
- Focused gates passed: Mapbox placement transition `2/2`; layer registry parity `2/2`; Trails V2 `6/6`; Originals/map-camera renderer suite; and full mobile TypeScript.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. Only the five named functional/test files were staged. Existing unrelated dirty files and `.cursor/` remain excluded.
- Exact next action: publish one paired preview from the clean checkpoint SHA; on Android test Standard -> Outdoors -> Standard once, verify map/camp/trail overlays and camera retention, then resume the single fresh T4 trail-pack assertion. Do not rerun the broad Layers audit.
- Task-owned Metro, Expo export, publisher, Gradle, Maestro, and test processes: none. The shared ADB server remains available for the connected device.

- Android acceptance completed at `2026-07-28T19:25:32-05:00`. Guarded paired preview source `016299200f4a81e11186a2a093af550a28442945`: Android group `e9cd2560-5532-48b5-b5e0-e31a7b54d4ea`, update `019fab3e-3c28-77cc-9973-ae7e3860baf4`, runtime `native-1.0.10-android.6`; iOS group `c6cc9346-9058-48fd-a34f-6e18c9b0e51e`, update `019fab3e-3c28-72da-bd33-a0f5b4e525dd`, runtime `native-1.0.10-ios.5`. Sentry accepted Android, iOS, and web artifact bundles before the preview channel moved.
- On Samsung build `68`, Standard -> Outdoors rendered the Outdoors basemap rather than a white surface, kept the process alive, and emitted none of the prior `setSlot`, missing-source, fatal-exception, or native-crash signatures. Outdoors -> Standard also rendered correctly with no matching renderer error. Camera bounds remained stable across both family changes.
- Acceptance evidence: `C:\Users\User\Documents\Codex\evidence\trailhead\trails-style-0162992\06-outdoors-valid.png`, SHA-256 `c5ee485242d50d8743ddcdb8820e1afe406dc1d52603fd3d45e4e9e486dac69e`; `06-outdoors.xml`, SHA-256 `d2d9be4d2d30110da1835f61982816cc4992c69db100fd20b5aa7df0927bcfc6`; `07-standard-return.png`, SHA-256 `d5695e9989b7b33b6385cb0bc7dfc22640f94ef9ed3ddf898aaedb4add25a5c9`.
- The first publication attempt stopped before channel promotion because a detached-worktree `node_modules` symlink could not resolve the local Valhalla package. A clean `npm ci` in that task worktree corrected only the export environment; one guarded retry succeeded. Do not repeat either publication.
- Style-switch P1 is accepted and closed. Exact next action returns to T4: create one fresh complete trail pack and require initial Download -> Ready; only then run one pause/resume and one radio-disabled offline map/search/sheet/geometry/support check. Do not perform another style or Layers crawl.

### T4 fresh-pack acceptance stop (2026-07-28T22:22:51-05:00)

- Checkpoint branch `feat/trailhead-1.0.10-overhaul`; exact HEAD `795f0dd859cf941a7b7ae47a4af6c0e2473a0796`. The paired preview under test remains source `016299200f4a81e11186a2a093af550a28442945`, Android build `68`, runtime `native-1.0.10-android.6`, group `e9cd2560-5532-48b5-b5e0-e31a7b54d4ea`, update `019fab3e-3c28-77cc-9973-ae7e3860baf4`; paired iOS runtime `native-1.0.10-ios.5`, group `c6cc9346-9058-48fd-a34f-6e18c9b0e51e`, update `019fab3e-3c28-72da-bd33-a0f5b4e525dd`.
- Before the fresh assertion, the existing Offline manager showed `5 downloads · 644.6 MB`: three Ready trail packs, one earlier incomplete Brumley Loop pack, and the retained Utah regional routing/support pack at `Directions saved · 623.8 MB`.
- New authoritative complete trail `Dory Canyon` (`6.4 mi`, USFS) was selected through the canonical Trail flow. The first and only `Download for offline` action added the pack to the existing manager; after the bounded wait the inventory showed `6 downloads · 650.6 MB` and Dory Canyon remained `Download incomplete · 5.9 MB`.
- The process remained alive with no crash or ANR. No restart, retry, pause/resume, second pack, or airplane-mode acceptance was attempted. Existing packs remained present.
- The internal QA snapshot matched the installed candidate and showed only the three Ready immutable bundle revisions. It did not expose Dory Canyon or Brumley Loop as terminal preparation jobs. The fixed RNMapbox lifecycle code could not be read because `getLastRnMapboxOfflineLifecycleTrace()` is not wired into QA diagnostics or privacy-safe logging. The observed UI state is therefore authoritative, but no unobserved terminal code is claimed.
- Open P1: the initial RNMapbox trail-pack lifecycle still ends as incomplete and the diagnostics surface omits the fixed transition trace needed to identify whether failure occurs at native create callback, registry visibility, immutable metadata, progress, or promotion. Before another device download, expose only the fixed lifecycle phases/codes and numeric progress in the internal QA snapshot, add a deterministic regression for the observed terminal path, and make one evidence-backed correction.
- Evidence directory remains `C:\Users\User\Documents\Codex\evidence\trailhead\trails-style-0162992`. All-download hierarchy `18-all-downloads.xml`, SHA-256 `88ca39dd3cd42a7a7b462d6499ef807cf89a2da9e020d180be4deadb3862e7a8`; Dory screenshot `19-dory-incomplete.png`, SHA-256 `e4b6ca5230c4932589f75166cdd02cccbaa672fe3e7a8529dda7b67d76132c04`; QA hierarchy `21-t4-qa.xml`, SHA-256 `6fa1ab80f11661ec9432b13a247630f2c6cdc52ff6b89751a0ea41bbbdeca4f4`; QA continuation `22-t4-qa-scroll.xml`, SHA-256 `ef3dae2553b03c3529755c1c16aca6ed0a1f20a0532643309d45ad6c1cb326ab`.
- The temporary QA operator account is verified `USER` again and the Admin console reports `Admin access removed`. Public Offline/Originals feature stages were not changed.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; `.cursor/`, the protected index, and all unrelated dirty files remain excluded. Task-owned Metro, Expo export, publisher, Gradle, Maestro, and test processes: none. The shared MCP/Computer Use runtime remains open and is not task-owned.

#### Next exact action after this checkpoint

1. Wire the existing privacy-safe RNMapbox lifecycle trace into the internal/admin-only QA diagnostics snapshot. Do not add pack IDs, bounds, routes, search text, account content, or raw native messages.
2. Use that trace plus the existing state-machine tests to identify one actual terminal transition. Add one deterministic regression and one correction only.
3. Publish one paired preview and test one new complete trail pack on Android. Require first-action `Ready`; if it fails, record the fixed code and stop. If it passes, run one pause/resume and one airplane-mode map/search/sheet/geometry/support assertion, restore radios, and accept T4.
4. Do not repeat Dory Canyon, Brumley packs, resolved style switching, native crash signatures, broad Trail/Search/Sheet crawls, or earlier immediate-registry/bootstrap-clear experiments. Do not begin T5 while T4 is blocked.

### T4 privacy-safe lifecycle diagnostics preview (2026-07-28)

- Checkpoint source `0b7ed854edfa9fa15aa427bd17d9b0c37970f68e` exposes only allowlisted RNMapbox lifecycle phase codes, a fixed terminal code, elapsed milliseconds and ten-percent progress buckets through the existing internal/admin QA snapshot. Pack identity, bounds, route geometry, account data, searches and raw native messages remain excluded.
- Deterministic lifecycle coverage confirms successful completion clears the terminal code and a stalled native callback records its exact fixed terminal code. Offline V2, telemetry/QA allowlist, copy audit across `166` files, privacy controls, TypeScript and whitespace checks pass.
- Guarded paired preview branch `preview-candidate-0b7ed854edfa9fa15aa427bd17d9b0c37970f68e-ms5j1ftc-3dd8f2ab76eaa76d87cbe2b2`: Android group `2b0e6463-d3bf-4bf4-bf4c-8e5639bc8538`, update `019fabf2-2393-7483-8c1e-15c1a0323584`, runtime `native-1.0.10-android.6`; iOS group `f4f3792e-cff6-43f3-a288-86b3e2c00164`, update `019fabf2-2393-7dfa-ac59-8263fc6f5f80`, runtime `native-1.0.10-ios.5`. Sentry accepted Android, iOS and web source maps before the preview channel moved.
- The Samsung downloaded and relaunched the preview. Opening `trailhead:///qa/telemetry` redirected to Profile because the disposable operator is correctly non-admin. The admin-only guard remains intact; no role or feature-stage bypass was added and no new download was started without an observable diagnostic surface.
- Exact next action is unchanged: temporarily authorize the disposable QA operator, refresh the internal snapshot, run one fresh complete trail-pack download, record the fixed lifecycle result, and remove the temporary authorization. If initial Download is still incomplete, stop with the exact code; if it reaches Ready, continue once through pause/resume and radio-disabled offline acceptance.

### T4 Android acceptance and support-place completion (2026-07-28T23:48:38-05:00)

- This section supersedes every earlier T4 `blocked` or `next action` note. Branch `feat/trailhead-1.0.10-overhaul`; functional backend HEAD `82141c2f3c6e7ec813d19e9acdbaf280b8e31d90`; protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, and unrelated worktree changes remained excluded.
- The accepted paired mobile preview remains source `e7e7ed68d10fd04c86f4d814c236b155bb89d0d9`: Android build `68`, runtime `native-1.0.10-android.6`, group `f064b16b-c07f-4727-811c-f6a80935a543`, update `019fac0c-d0b8-78cb-8dcb-c3c64115c515`; paired iOS runtime `native-1.0.10-ios.5`, group `f637e384-6205-4c65-86aa-3b7fffe7659f`, update `019fac0c-d0b8-75fe-b676-6c402aded4b5`. The support-place correction is backend-only, so no replacement mobile OTA was required.
- `Z9 To Pace Lake` proved the corrected first-action native lifecycle: initial Download reached `Ready offline · 5.4 MB`; the map, exact orange trail geometry, exact offline trail search, and nonblank Trail sheet worked with radios disabled. The privacy-safe lifecycle showed registered-pack forward progress, transient native-error recovery, and completion without restart or manual retry.
- That assertion exposed one bounded T4 data P1: the immutable trail bundle contained one trail/search row but no nearby support places because the existing 1.2 km tile corridor was also being used as the place-selection boundary. Source-pack inspection found verified water at `6.89 km` and a campground at `10.9 km`; no fuel pack exists for that source region, so fuel was not fabricated or claimed.
- Backend commit `82141c2` separates the narrow Mapbox tile/route corridor from a deterministic 25 km practical support-place boundary, limits trail support inventory to source-backed camp, water, access, parking, fuel, food, service, medical, repair, restroom, shower, visitor-center and trailhead categories, caps the result, binds the wider immutable selection into the manifest, and adds a trail-support content revision so previously cached zero-place preparations cannot be reused. Ordinary area/V1 cache identity and tile coverage remain unchanged.
- Railway production deployment `38d09ef9-cba7-40a4-892d-34ed130bd6ae` succeeded from exact commit `82141c2`; image digest `sha256:1526b64448cca4fa34906b82ca12381e10ce381342be9508d9f22cbd17a6908e`. `https://api.gettrailhead.app/api/health` returned `{status: ok, service: trailhead}`.
- Focused tests passed: Offline V2 backend `34/34`; combined Offline V2 plus 1.0.10 backend contracts `51/51`; mobile Offline V1/V2 catalog, runtime, scope cleanup, active style, trail-pack, and manager-parity suites; `git diff --check`.
- One fresh untouched canonical trail, `Short Point`, downloaded on the initial action and completed without retry. Its internal QA snapshot reported the newest immutable bundle `state=ready`, `placeRecords=11`, `trailRecords=1`, and `searchRecords=12`; RNMapbox lifecycle completed at 100% in `2647 ms` after forward progress and transient-error recovery.
- In true Android airplane mode with Wi-Fi disabled, exact local search returned `Divide Forks Campground` from the new bundle and opened the correct nonblank campground Peek sheet with `Downloaded`, source-backed summary, site type, inventory/fee unavailable states, `View sites`, and `Save`. No network result, fabricated service, or second map engine was used. Airplane mode was then disabled and Wi-Fi returned to a validated connection.
- New evidence: QA screenshot `C:\Users\User\Documents\Codex\trails-t4-82141c2-shortpoint-qa.png`, SHA-256 `4a17528ed532b8aebc1d99d5f739f74306dff0549be5a0478867e9e46e85ded7`; QA hierarchy SHA-256 `9c9d226ee57d6a042df9763899be71cdaa345cedbadba2d75fe256ac4562f6d0`; airplane-mode support search hierarchy SHA-256 `ade584a6de688016f2e910438f66cd06ef73ccb1b810288c02266fb73f3247d6`; downloaded campground hierarchy SHA-256 `b2030daa5beac94d02dbfb64cd34b50678234e2eb089d9bfe4ac204786dab90a`; downloaded campground screenshot `C:\Users\User\Documents\Codex\trails-t4-82141c2-air-support-sheet.png`, SHA-256 `7e121cea82dcf3284afa1614d0598ac9dad4194afb10a1c72ea1bd4aadb010f9`.
- Earlier Z9 evidence remains valid: QA Ready hierarchy SHA-256 `bcc6bd0d3290723d9e165d18edb994666d7e88a6c3105b130f8e8bdf001ba922`; downloads hierarchy `add6a2423dea01fc30ba987b4d90fe99040119dad81a2af6bb7ac2d4d4b09d3b`; airplane-mode route screenshot `a7463554168614fc6deffe1719d32eede7eb48c9e72fa09f22e98ec5868117b2`; offline trail search `04986614a71d7ec4f144034e55d3e2a5bccd12dd884af7ba07c5412dfb58d778`; offline Trail sheet `f764f9633d2c2e1a85ef942c7d0a454094b722e73b9edb92886ba7a1fe6b094c`.
- T4 is accepted on Android. Existing V1/V2 downloads were retained. No broad crawl, Layers audit, style-switch audit, memory gate, NPS research, Originals lifecycle, Android Auto, or iOS packet was repeated. Task-owned Metro, Gradle, Maestro, Expo publisher, test, Railway login, and emulator processes: none.
- Temporary QA admin access was still active when the device assertion finished and must be removed during cleanup before T5 device work. Do not delete the user’s downloads merely to clean QA state.
- Exact next packet: remove temporary QA admin access, commit and push this checkpoint, then begin T5 design/implementation only after the approved Follow/recording Figma states are confirmed. T5 is a paired native packet; Android build and physical test remain first, with iOS from the identical accepted SHA afterward.

### T5 Figma design gate ready (2026-07-29T00:14:57-05:00)

- Branch `feat/trailhead-1.0.10-overhaul`; exact repository HEAD `f105e448f6b02d4ff4fa64d42e28ad573312d987`. Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- Added the focused Figma section `26 · Trails T5 — Follow + Recording — Review 01` in file `FJUcMWAfsNyjsguCEp2dBe`, section node `786:2438`. It reuses the approved map, navigation, trail-detail and three-needle-compass language instead of creating a second trail UI.
- Review screens: drive-to-trailhead handoff `788:2438`; on-trail Follow `788:2507`; Follow plus local recording `788:2527`; GPS recovery `788:2551`; End trail session `788:2572`. The implementation contract is node `790:2677`.
- The handoff uses a source-backed trailhead and ordinary navigation before Follow. Follow keeps the exact route and compass visible. Recording is explicit and local-only. Weak GPS pauses confident guidance without discarding the route. End offers `Keep going`, `End & save`, and `End Follow only`.
- Visual evidence: `C:\Users\User\Documents\Codex\trails-t5-figma-review-v2.png`, SHA-256 `088c49368fdb092d55f1ba61617f2c9d306f18d3dcbe2e16c9dd192af5dbce54`; End-state proof `C:\Users\User\Documents\Codex\trails-t5-end-review.png`, SHA-256 `7d660e26df7e11ba73e60cfeffa41b68d55a8875cbdd3e27d8d75c9cd2fa686e`.
- No repository implementation, native project, permission, runtime, preview OTA or production change was made during this design gate. T4 remains accepted; its backend and mobile evidence are not reopened.
- Open review gate: obtain user approval for the T5 packet before implementation. T5 then requires paired native candidates: Android build and physical background/lock test first, iOS from the identical SHA afterward.
- Temporary disposable QA admin access remains elevated from the T4 diagnostic step. Do not change that permission without explicit user confirmation; remove it before T5 device work.
- Task-owned Metro, Gradle, Maestro, Expo publisher, Railway login, test and emulator processes: none. The shared ADB and MCP runtimes are not task-owned.

#### Next exact action after T5 design approval

1. Create `TrailRecordingSessionV1` and the shared Trail Follow state controller around the existing `NativeMap`; do not create another renderer or progress store.
2. Route distant Starts to the best source-backed trailhead, then transition to Follow only after arrival or an explicit nearby action.
3. Add concise chime/haptic guidance, optional voice, GPS/off-route confidence gates, durable local pause/resume, explicit End semantics and user-initiated GPX export.
4. Update the Android foreground-service and iOS location-purpose disclosure only as required for explicit trail recording, increment both runtime suffixes, and build Android first from one immutable SHA.
5. Do not repeat T1-T4, Layers, Memory Gate, NPS, Originals, Android Auto, Camp Guide, Search or store-screenshot work.

### T5 implementation ready for Android candidate (2026-07-29T01:10:26-05:00)

- Branch `feat/trailhead-1.0.10-overhaul`; implementation parent HEAD `c6d4d5f6808eda9e2ccfee7e23bb8e06a51d3061`. Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4` and remains excluded with `.cursor/` and every unrelated dirty file.
- The consumer Follow, recording, recovery and handoff UI remains on the existing `NativeMap`. There is no second renderer or trail map. The shared route, main-map compass, Mapbox style, offline artifacts and Android Auto state remain authoritative.
- Added a pure source-backed start resolver and Follow state evaluation. Starts near the canonical route enter Follow; distant Starts route to a sourced trailhead; absent sourced access produces an honest unavailable state. Good GPS is required for confident fork/off-route cues.
- Added one map HUD for handoff, Follow, weak-GPS recovery and recording-only states. It provides the approved compact route cue, compass, progress, concise haptic/chime guidance, optional voice, Record/Pause/Resume, Route, Report and explicit End choices.
- Added local-only `TrailRecordingSessionV1` storage using Expo SQLite. Raw track points never enter APIs or telemetry, are cleared by the existing private-storage cleanup, and leave the device only through an explicit GPX export. The explicit Android recording task uses a foreground notification; iOS requests background access only after the recording disclosure and action.
- Durable recovery preserves canonical route revision and recording status. `End Follow only` persists `follow_active=0`, so a reopened app remains recording-only rather than silently restarting Follow. `End & save` stops recording/location and completes the local track.
- Fixed the active-trip handoff boundary: while the Follow controller owns handoff, its sourced trailhead destination takes precedence over trip waypoints and arrival transitions once into Follow.
- Native/runtime inputs now target Android `native-1.0.10-android.7` and iOS `native-1.0.10-ios.6`; background-use strings include active trail recording. The existing installed paired preview remains Android build `68`, runtime `.6`, update `019fac0c-d0b8-78cb-8dcb-c3c64115c515`, and iOS runtime `.5`, update `019fac0c-d0b8-75fe-b676-6c402aded4b5`; it cannot receive this native packet through OTA.
- Focused verification passed: Follow/recording/map contract; Trails V2 `6/6`; Trail sheet flow `6/6`; Trail hydration `4/4`; Trail Builder `6/6`; TypeScript; native drift; privacy controls; whitespace; Android `testDebugUnitTest`; Android `assembleDebug`. Missing external build values in the local privacy run were warnings only and are required in EAS. Debug APK SHA-256 `b8aebb5863a39b0299b9c4d2fb4ad138152dea2ca221e48d31737c71c88c2ccd`.
- Connected Android device is Samsung `SM-A326U1`, serial `RFCR408DA9B`. Task-owned Metro, Gradle, Maestro, Expo publisher, emulator and test processes: none. Shared Codex/MCP/ADB processes are not task-owned.
- Open gate: commit and push only the named T5 files, create the Android `.7` preview build from that immutable SHA, install it without clearing the user's data, and run the bounded physical delta: sourced handoff, explicit Nearby transition, Follow compass/cues, weak GPS, Record/Home/lock/notification, pause/resume, End Follow only recovery, End & save, GPX export, and process survival. iOS `.6` is built from the exact accepted SHA only after Android passes.

#### Do not repeat after this checkpoint

- Do not reopen T1-T4, Offline acceptance, style switching, Layers, Memory Gate, Yellowstone, NPS, Originals, Android Auto, Camp Guide, Search or store screenshots without new evidence.
- Do not introduce another map, renderer, progress store or cloud track sync. Do not log coordinates, route geometry, search text or recording points.
- Do not publish an OTA to the old `.6`/`.5` runtimes. T5 is a paired native packet.

- Implementation commit created: `eacf397e064fac45c21e09ee03e151e1b25d71ee`. The Android candidate and later paired iOS candidate must be built from this commit or a descendant containing checkpoint documentation only; no functional amend is permitted between platform candidates.
