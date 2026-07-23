# Trailhead 1.0.10 Active Checkpoint

Last updated: 2026-07-23 09:51:01 CDT (America/Winnipeg)

## Resume protocol

Read this file before resuming the 1.0.10 overhaul after a restart or context compaction. Then:

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Verify `dashboard/explore_serving_index_v2.json` still hashes to `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
3. Keep `.cursor/` and `dashboard/explore_serving_index_v2.json` out of every implementation commit.
4. Continue from **Next exact actions** below. Do not restart the design, NPS research, automated gate, or baseline crawl.

## Source checkpoint

- Branch: `feat/trailhead-1.0.10-overhaul`
- Current implementation/release HEAD before this checkpoint-only commit: `62e40b1519e7a53061dd4cac02a2db96edf0be0a`.
- Exact source now published to the paired preview: `62e40b1519e7a53061dd4cac02a2db96edf0be0a`. The checkpoint commit that records this evidence is documentation/test-only and does not require another OTA.
- Memory Gate V3 implementation baseline: `d5d73924dc5a969a66ac9eba2b85acca5db0cc19`; current evidence harness/checkpoint HEAD before this documentation-only commit: `aec820449c835aef38f0d86ecd9c1dda84db56a3`.
- Previous installed-preview source `83287394ce41f1100bd980c9249f20d364b51db7` is superseded by the paired `62e40b1` preview below; Android installation and exact QA identity are verified.
- M1 commit series created from the verified tree:
  - `4fa0379 feat(api): harden fire and explore delivery`
  - `d44618b feat(mobile): preserve explore context and map state`
  - `e6f5811 test(release): gate preview memory and telemetry`
  - `0b14624 docs: checkpoint 1.0.10 stability work`
  - `e6468bd fix(release): verify preview identity diagnostics`
  - `4958884 fix(release): traverse every map layer card`
  - `e15b8fe test(release): harden layer carousel reset`
  - `083535008c7ccf5e2edced19ae1cde14a48095d8 fix(mobile): batch signed-in trip hydration`
  - `a67d242a0aff12698f52c2932a20edd7940f9e53 fix(mobile): pause hidden map visual work`
  - `2750138e616c76ac891d785ba391368483384072 test(release): isolate map memory diagnostics`
  - `831b4d7 docs: checkpoint M1 stability fixes`
  - `5f5ec52 fix(mobile): guard QA cold-start access`
  - `8328739 fix(mobile): bound trip sync persistence`
  - `bd75229 docs: checkpoint phase-aware memory gate`
  - `d5d7392 test(android): add phase-aware memory gate`
- The full `8328739` source passed `npm run audit:prepreview`, was pushed intentionally, and was published to the paired preview channel with Sentry source maps.
- No production build, OTA, submission, public feature-stage change, advertising action, or store-asset change was made.
- Production OTA, AAB/IPA submission, public Originals rollout, advertising, and store screenshot replacement remain blocked.

## Checkpoint A — Memory Gate V3 Ready

- Implementation subject under test: `d5d73924dc5a969a66ac9eba2b85acca5db0cc19`. This document is committed immediately afterward as a documentation-only checkpoint, so the checkpoint commit itself necessarily has a different SHA.
- Protected Explore index SHA-256: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and the Explore index remain unstaged and untouched.
- `AndroidMemoryGateReportV3` now records authoritative total PSS and RSS, SwapPSS separately, PSS-minus-SwapPSS as a diagnostic only, native/graphics/GL/Unknown memory, Android object counts, process identity, exit evidence, phase budgets, cycle growth, recovery, and exact layer restoration.
- Source-controlled stress-device budgets are phase-aware: Explore/Plan idle, ordinary Map idle, heavy-layer peaks, and separately recorded Navigation/3D/Original active phases. Ordinary budget failures do not truncate the ten diagnostic cycles unless the app dies or crosses the active-experience safety cap.
- Growth and recovery checks cover post-cycle medians, early/late disabled valleys, early/late heavy peaks, retained slope, and return-to-Explore recovery. Object-count detection requires continuing late-cycle floor growth, so bounded jitter and staged initialization are not misclassified as leaks.
- The runner fails closed on process death, every new `ApplicationExitInfo` record, missing foreground/lifecycle proof, incomplete duplicate-renderer or state-loss evidence, incomplete object counts, and failed layer restoration. Reports are privacy-validated and written atomically.
- Deterministic coverage includes parser output, swap-heavy samples (including SwapPSS greater than PSS), exact phase boundaries, inclusive/exclusive growth edges, retained slope, periodic jitter, staged initialization, staircase leaks, process death, cancellation order, foreground proof, independent PSS/RSS extrema, harness provenance, strict report privacy, atomic writes, and exact layer restoration.
- Verification passed on 2026-07-23:
  - `npm run test:android-map-memory`
  - `git diff --check`
  - `npm run audit:prepreview` in 474.7 seconds, including native/config drift, pinned Maestro and stable-selector contracts, Android Auto debug unit tests, Search V2, Offline preservation, Originals, Explore/NPS/Viator, copy/privacy/image guards, TypeScript, and all 761 backend tests.
- Evidence is bound to committed source. Key SHA-256 values:
  - `mobile/scripts/android-map-memory-gate.mjs`: `dff0a9c6171d034d5fdf78b74e04fbabcffb21f9d88af923ebb6f34c2d913c9b`
  - `mobile/scripts/android-memory-gate-v3.mjs`: `c9a20ebce6fb17c34ea39f10b16e2213317e02b946fae6729a3b8afb5c882ff0`
  - `mobile/scripts/android-map-memory-gate.test.mjs`: `8c69ee832cf219326de7790ab8bc53dfe5f25ba68eba9bb053c73938a390590a`
  - `mobile/scripts/android-memory-gate-v3.test.mjs`: `86d6bf8e29f46b1f6062ac66bd5128b69c01930ee02fb8bae0a5e6a3d2e32a69`
- Open P0/P1 defects in the gate implementation: none. M1 acceptance is still pending the exact-device result; active Navigation/3D/Original phase evidence remains a separate later acceptance item and does not inflate ordinary Map budgets.
- Exact Samsung command from `mobile/`:

  ```powershell
  npm run audit:android-map-memory -- --serial RFCR408DA9B `
    --expected-version-name 1.0.10 `
    --expected-version-code 59 `
    --expected-commit-sha 83287394ce41f1100bd980c9249f20d364b51db7 `
    --expected-build-commit-sha cd61f6c3dbf9d176bc49b2d96a2c13fc9470dcaf `
    --runtime native-1.0.10-android.1 `
    --build-id 06142308-0199-46cc-8a4c-fb9d45bca25e `
    --update-id 019f8e05-bad8-7925-8d46-54d2627b76b8
  ```
- Do not repeat: Figma/research packets, the 33-run Android crawl, NPS research, broad layer toggling, the already-passed cold QA proof, or the full pre-preview suite before the exact Samsung run unless source changes invalidate it.
- Task-owned background processes at Checkpoint A: none; the Gradle daemon was explicitly stopped after verification.

## Interim device evidence — first V3 run

- Evidence subject/harness HEAD: `65451cf7bab0eed23a1f50c212cb084ff78031f8`; installed OTA source remained `83287394ce41f1100bd980c9249f20d364b51db7` with the Android build/runtime/update identity recorded above.
- Atomic report: `output/android-map-memory-gate/2026-07-23T10-21-20-418Z/report.json`.
- Report SHA-256: `f2140b20b8a0ae3d3297a4f41052e9bad694c87f9826b4c27469be9ec408867a`.
- Run window: `2026-07-23T10:21:20.419Z` through `2026-07-23T11:14:19.694Z` (about 53 minutes). The external 30-minute command wrapper expired, but the original bounded runner continued to finalization; no second run was started.
- Result: failed with `layer_toggle_failed_ava` while disabling the Avalanche layer in cycle 5. Four complete peak/recovery cycles and the fifth heavy peak were captured before the interruption. This is an automation/workload interruption, not a reopened Layers product defect: the user had already verified Layers on Android and iPhone, the app stayed alive, and exact saved layer choices were restored and verified across relaunch.
- Safety evidence: zero new exit records, OOMs, LMKs, ANRs, process deaths, or state loss; process identity remained stable. Restoration returned exactly to `3d=true`, `lands=true`, `pois=true`, `trails=true`, with `usgs`, `fire`, `ava`, `radar`, and `mvum` false.
- Explore idle failed the light-screen budget:
  - Total PSS samples: `835357`, `662421`, `662344` KB; median `662421` KB versus `650000` KB budget.
  - RSS samples: `768080`, `595792`, `595748` KB; median `595792` KB versus `550000` KB budget.
  - The first sample's native-heap PSS was `237466` KB and then settled near `73` MB, while Unknown PSS stayed near `226` MB. This is evidence for profiling, not permission to weaken the source-controlled budget.
- Ordinary Map idle passed: median/max total PSS `637924`/`652941` KB and median/max RSS `597388`/`612820` KB.
- The four complete heavy peaks passed their phase cap: median/max total PSS `1138611.5`/`1194264` KB and median/max RSS `936788`/`964052` KB.
- The four complete disabled valleys passed the ordinary Map cap: median/max total PSS `671825.5`/`680068` KB and median/max RSS `631776`/`638332` KB.
- The partial curve showed no demonstrated ratchet: disabled PSS growth `0%`, heavy PSS growth about `0.60%`, heavy RSS growth about `5.71%`, and retained total-PSS slope about `1771` KB/cycle. These four cycles are useful diagnostic evidence but cannot satisfy the required ten-cycle acceptance or post-Map/Explore recovery checks.
- Open P1s: Explore idle over budget; complete-cycle evidence unavailable because the layer-workload automation aborted. No Map phase budget, app-lifecycle, saved-layer, OOM, ANR, or process-death P1 was demonstrated.
- Exact next action: make a bounded retry/continuation change that records workload-integrity failures but does not end diagnostic cycling unless the app dies or crosses the phase safety cap; profile the Explore idle allocation/retention path; rerun the full exact-candidate gate afterward.
- Do not repeat: the 33-run crawl, NPS research, Figma packets, broad manual layer audit, cold QA proof, or first V3 run without the continuation/profile fix.
- Task-owned background processes after report finalization: none.

## Checkpoint A.1 — Diagnostic continuation and compact trip hydration ready

- Timestamp: `2026-07-23T08:00:30-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`.
- Implementation HEAD before this checkpoint-only commit: `c84f844ae7c6bcf329b2005270f841ee97494d43`.
- Intentional commits:
  - `f5ca0b3fed6abb3213201c6b5d065a06f8f08cee test(android): complete memory diagnostics after layer errors`
  - `37dba293380db5100a5ebbe6e1509686d4388d26 feat(api): add compact compatible trip listing`
  - `c84f844ae7c6bcf329b2005270f841ee97494d43 fix(mobile): hydrate compact trip summaries safely`
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- Installed candidate identity is unchanged because these commits are not deployed yet:
  - Android build `59`, runtime `native-1.0.10-android.1`, source `83287394ce41f1100bd980c9249f20d364b51db7`, update `019f8e05-bad8-7925-8d46-54d2627b76b8`.
  - iOS runtime `native-1.0.10-ios.1`, source `83287394ce41f1100bd980c9249f20d364b51db7`, update `019f8e05-bad8-745d-bc46-1ef41615d7cb`.
- Memory Gate V3 now records recoverable enable/disable workload failures as incomplete attempts and continues all ten diagnostic attempts after proving process, foreground, renderer, and safety-cap health. Incomplete attempts never enter authoritative curves or satisfy the ten-cycle requirement. Fatal ADB/measurement/process/foreground/cancellation/safety failures still stop the run. Layer-state convergence now polls for 15 seconds without a blind second tap, post-cycle recovery requires the exact all-disabled baseline, and final saved choices remain fail-closed and relaunch-verified.
- The server now supports `GET /api/trips/v2?include_legacy_v1=false` while defaulting to the complete legacy response for released clients. Compact pages return canonical card/timeline/route fields plus an availability marker, emit tombstone-only deletions, and keep individual trip reads complete.
- Compact V2 writes preserve server-owned legacy data, synchronize existing old-client rows, retain rich matched campground/fuel/day/builder fields, and treat explicit empty summary, regions, days, stops, route, camps, and fuel as authoritative. Occurrence-aware identity prevents repeated or nearby places from inheriting another stop's reservations/site data. Inbound client documents remain capped at 2 MiB; trusted preservation of already-stored legacy data has a fixed 8 MiB cap and transactional rollback.
- Mobile hydration now stores the compact marker once instead of repeatedly serializing full legacy payloads. Opening a non-downloaded compact trip fetches its full individual detail lazily, rejects a changed remote revision, preserves actionable offline copy, and merges rich legacy detail without overriding canonical V2 membership or explicit clear states. Existing downloaded trips remain the offline-first detail source.
- Verification passed on the implementation HEAD:
  - `python3 -m unittest tests.test_trip_graph_v2`: 37/37.
  - `npm run test:trip-repository`.
  - `npm run test:android-map-memory`.
  - `npx tsc --noEmit`.
  - `git diff --check`.
  - `npm run audit:prepreview`: passed in 489.9 seconds, including native/config drift, Android Auto debug tests, Search V2, Offline V1/V2, Originals, Explore/NPS/Viator/copy/privacy checks, TypeScript, and 773 backend tests.
- The earlier pre-preview attempt was not counted: it exposed a brittle source assertion after `legacy_v1_available` was added. The guard was corrected to verify both server-owned fields and the complete suite was rerun successfully.
- Independent regression review found and closed explicit-clear resurrection, stale old-client mirrors, compact updates over 2 MiB, changed-day camp/fuel placement, distinct-ID collisions, repeated-place occurrence matching, and sparse-mirror data loss. Code-level P0/P1 defects for this change: none.
- Rollout precaution: query production for authoritative legacy trip documents already exceeding the trusted 8 MiB cap before deployment. No document contents should be logged; record counts and maximum byte size only.
- Existing evidence remains `/home/sean/.openclaw/workspace/trailhead/output/android-map-memory-gate/2026-07-23T10-21-20-418Z/report.json` with SHA-256 `f2140b20b8a0ae3d3297a4f41052e9bad694c87f9826b4c27469be9ec408867a`. No new device result exists yet.
- Open P0/P1 defects: none in the committed gate/compact hydration implementation. M1 acceptance remains pending backend deployment, one paired preview OTA, exact identity proof, and a complete Samsung Memory Gate V3 result.
- Exact next action: run the count/max-size production legacy preflight, deploy backend compatibility, verify health/default/compact/individual contracts, publish one paired preview OTA from one clean immutable SHA with Sentry source maps, then run the exact Samsung gate without clearing account data.
- Do not repeat: Figma packets, NPS research, the 33-run Android crawl, broad manual Layers testing, the first incomplete V3 run, or the just-passed full pre-preview suite unless source changes invalidate it.
- Task-owned background processes: none. The Gradle daemon was explicitly stopped after the successful pre-preview run; no Metro, Expo, Maestro, memory-gate, or test process remains.

## Checkpoint A.2 — Production compatibility and paired preview published

- Timestamp: `2026-07-23T08:50:00-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; implementation/release HEAD: `62e40b1519e7a53061dd4cac02a2db96edf0be0a`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain unstaged and untouched.
- The aggregate-only production preflight passed against `/data/trailhead.db`: 47 authoritative legacy documents, zero documents over the 8 MiB trusted-preservation limit, zero invalid legacy or V2 JSON documents, and maximum serialized size `6001565` bytes. No IDs, titles, or contents were logged.
- Backend compatibility was deployed from the immutable source. The first deployment, `14dd0c37-3f94-4782-8035-01cfb9d5da62`, exposed an ignored legacy Railway health configuration and was superseded without changing application behavior.
- `62e40b1` moves Railway's health gate to the supported `[deploy]` keys and adds `tests/test_railway_config.py`. `python3 -m unittest tests.test_railway_config` and `git diff --check` passed.
- Replacement deployment `a124975b-cd66-44b6-b730-5aa5943cdd70` succeeded. Railway probed `/api/health` with `200`; `https://api.gettrailhead.app/api/health` returned `200`; the deployed image digest is `sha256:cd74175fd117b3b5748f2557fc4b947a8e5fb2b3d4e319806a0a401c764ef992`; sanitized startup/runtime logs contained no warnings or errors. Both default and compact trip-list routes are live and auth-protected; signed-in semantics remain a device check.
- The first guarded preview publish attempt failed before Sentry upload, EAS publication, or channel movement because a clean-worktree `node_modules` symlink caused local `file:` Expo modules to resolve outside Metro's project root. Installing the lockfile into the clean worktree fixed release setup without a source or dependency-graph change.
- One paired preview OTA then published from exact SHA `62e40b1519e7a53061dd4cac02a2db96edf0be0a`, with Android/iOS/web Sentry bundles and source maps uploaded before channel movement:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-62e40b1519e7a53061dd4cac02a2db96edf0be0a-mrxk3nu2-d964f9e0b33abcd4487720c8`, branch ID `019f8f37-588f-7a4c-85d9-bfd49db43c1f`.
  - Android build `59`, runtime `native-1.0.10-android.1`, group `341d8a01-ffb5-4782-9e95-8388af2cd150`, update `019f8f37-81ed-7366-86bc-59e977335e08`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `dfbb32a2-d69b-4f8c-82b7-f74dfa26c890`, update `019f8f37-81ed-71a8-886f-6f4768560f4e`.
- The known `react-native-webrtc` export fallback, Sentry URL/token-format warning, and EAS CLI patch-version notice were non-blocking; no native dependency or runtime change was made.
- Memory Gate V3 gained a deterministic coverage case for a recoverable heavy-layer enable failure: heavy sampling is skipped, disable/recovery still run, all attempts finish, only complete attempts enter the curve, and nine valid cycles cannot pass. `npm run test:android-map-memory` and `git diff --check` passed; production gate semantics did not change.
- Layers remain user-confirmed working on Android and iPhone. Their toggles are only a deterministic memory workload and must not be reopened without new evidence.
- Current device evidence still points to `/home/sean/.openclaw/workspace/trailhead/output/android-map-memory-gate/2026-07-23T10-21-20-418Z/report.json`, SHA-256 `f2140b20b8a0ae3d3297a4f41052e9bad694c87f9826b4c27469be9ec408867a`; no `62e40b1` Memory Gate V3 report exists yet.
- Open P0 defects: none. Open/pending P1 acceptance: prove the Samsung loaded the new update, rerun all ten Memory Gate V3 attempts, verify Explore recovery and signed-in compact hydration, then run only the affected Android/iOS delta. M1 is not accepted yet.
- Exact next action: cold-load the paired update on Samsung without clearing the account; verify version/build/channel/source/runtime/update and the QA deep-link; then run the exact candidate-bound Memory Gate V3 command recorded below.
- Do not repeat: Figma/research packets, the 33-run Android crawl, NPS research, a broad manual Layers audit, the first incomplete V3 run, production preflight, backend deployment, paired OTA, or the full pre-preview suite unless a relevant source change invalidates them.
- Task-owned process state: no WSL Gradle, Metro, Expo, EAS, Railway, Maestro, test, or memory-gate process remains. The obsolete Windows Trailhead Originals static preview server that had listened on port `8085` since July 16 was stopped. The ADB daemon remains intentionally active for the connected Samsung and emulator.

## Checkpoint A.3 — Exact identity, compact hydration, and slow-sheet evidence

- Timestamp: `2026-07-23T09:18:14-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; harness-fix HEAD: `898ddc485c524ffb427ddede3645069c8f1ee9b6`; installed OTA source remains `62e40b1519e7a53061dd4cac02a2db96edf0be0a`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain unstaged and untouched.
- The Samsung completed the two-launch update handoff without clearing app data. The cold admin QA deep link reported Android `1.0.10`, build `59`, channel `preview`, source `62e40b1519e7a53061dd4cac02a2db96edf0be0a`, runtime `native-1.0.10-android.1`, update `019f8f37-81ed-7366-86bc-59e977335e08`, account role `admin`, and status `Ready`.
- Signed-in compact hydration completed against the deployed backend. The local trip repository retained `13` trips and `5` saved entities while its state file fell from `19266625` to `9977305` bytes. The allowlisted QA counters recorded three pages, 178 items inspected, 17 applied, 161 skipped, and zero outbox items; no trip IDs, titles, content, searches, coordinates, or routes were logged.
- The first exact `62e40b1` candidate-bound rerun is preserved at `/home/sean/.openclaw/workspace/trailhead/output/android-map-memory-gate/2026-07-23T14-01-25-429Z/report.json`, SHA-256 `4e9a35509a1ba8747e95a5e459b618b8a6558e97587555e3a6f2ec3d50d1bf93`.
- That run stopped before layer-state capture or any memory cycle with `layer_carousel_unavailable`. The app stayed alive in the same process, produced 13 foreground proofs, and had zero new exit, OOM, LMK, ANR, or process-death records. `layers.initial` remained null and cycle count remained zero, proving the harness had not toggled or changed the user's saved layers.
- The signed-in Explore phase now passes the source-controlled light-screen budgets:
  - Total PSS samples `457432`, `445761`, and `445741` KB; median `445761` KB versus the `650000` KB limit.
  - RSS samples `515548`, `503888`, and `503868` KB; median `503888` KB versus the `550000` KB limit.
  - Median SwapPSS was `40593` KB. PSS-minus-SwapPSS remains a labelled diagnostic only and does not override the authoritative PSS/RSS pass.
- The exact `map.layers.toggle-carousel` was visibly present shortly after the 20-second harness deadline. Layers therefore remain working/not reproduced; this report is evidence of slow sheet readiness on the older Samsung, not a product Layers regression.
- Harness commit `898ddc4` replaces the 20-second interaction loop with a source-controlled 60-second readiness window. It passively waits for 30 seconds, never taps an already-open sheet a second time, and only then performs a bounded reveal swipe at most once every five seconds. It still requires the exact visible carousel and leaves memory budgets, checked-state capture, ten valid cycles, and durable exact-state restoration unchanged.
- Deterministic tests cover a carousel appearing after 25 seconds with zero reveal swipes, an already-open sheet with no second open action, bounded timeout failure, and invalid-configuration fail-closed behavior. `npm run test:android-map-memory` and `git diff --check` pass.
- Open P0 defects: none. Open/pending P1 acceptance: a complete ten-cycle Memory Gate V3 result and the affected Android/iOS M1 delta. M1 is not accepted yet.
- Exact next action: advance the clean detached harness worktree to `898ddc485c524ffb427ddede3645069c8f1ee9b6`, rerun the same exact `62e40b1` Samsung command without clearing account data, and preserve the complete atomic report and recovery curves.
- Do not repeat: production preflight/deployment, paired OTA, Figma/research packets, the 33-run Android crawl, NPS research, broad Layers testing, or the partial `layer_carousel_unavailable` run.
- Task-owned process state: no Gradle, Metro, Expo, EAS, Railway, Maestro, test, or memory-gate process remains. Only the ADB daemon is intentionally active for the connected Samsung and emulator.

## Checkpoint A.4 — Transient carousel read isolated

- Timestamp: `2026-07-23T09:39:11-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; harness-fix HEAD: `adbef769902a8eb7d4d2001de86d338555237b16`; installed OTA source remains `62e40b1519e7a53061dd4cac02a2db96edf0be0a`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain unstaged and untouched.
- The second exact candidate-bound report is preserved at `/home/sean/.openclaw/workspace/trailhead/output/android-map-memory-gate/2026-07-23T14-19-59-003Z/report.json`, SHA-256 `550d2d4f69c2bffed85bef824bd51ea1797e1ce9f5124344f7cd2f9fc3c0aa74`.
- It again stopped before layer-state capture or cycle one with the shared `layer_carousel_unavailable` code, while the process remained alive/unchanged with 13 foreground proofs and zero exit, OOM, LMK, ANR, or process-death records. No layer had been toggled.
- Explore passed again and improved: median total PSS `393288` KB with maximum `485552` KB; median RSS `437972` KB with maximum `530232` KB. This independently confirms the compact-hydration fix closed the earlier Explore idle P1.
- Direct timing proved `map.layers.toggle-carousel` is visible two seconds after opening the sheet. A read-only reproduction of the gate's exact horizontal traversal found all nine stress cards and their checked states without a missing selector or state change: `3d`, `lands`, `pois`, and `trails` true; `usgs`, `fire`, `ava`, `radar`, and `mvum` false.
- The shared failure therefore came from a transient UI-tree frame during the later traversal, not sheet readiness or product functionality. Commit `adbef76` now passively reacquires the exact visible carousel for at most 15 seconds whenever a traversal read temporarily lacks it. It performs no tap or swipe while missing and still fails closed if the exact node does not return.
- Deterministic tests cover transient reacquisition, exact 15-second timeout, and invalid-snapshot fail-closed behavior. `npm run test:android-map-memory` and `git diff --check` pass; memory budgets, required cycle count, checked-state capture, and durable restoration are unchanged.
- Open P0 defects: none. Open/pending P1 acceptance: one complete ten-cycle gate and the affected Android/iOS M1 delta. M1 is not accepted yet.
- Exact next action: advance the clean detached harness worktree to `adbef769902a8eb7d4d2001de86d338555237b16`, rerun the same exact Samsung command, then preserve the complete report and recovery curves.
- Do not repeat: the two partial carousel reports, manual Layers functionality checks, production/deployment/OTA work, Figma/NPS research, or the 33-run crawl.
- Task-owned process state: no Gradle, Metro, Expo, EAS, Railway, Maestro, test, or memory-gate process remains. Only ADB is intentionally active.

## Checkpoint A.5 — Cold Explore ANR captured

- Timestamp: `2026-07-23T09:51:01-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact evidence-harness HEAD before this checkpoint-only commit: `aec820449c835aef38f0d86ecd9c1dda84db56a3`; installed OTA source remains `62e40b1519e7a53061dd4cac02a2db96edf0be0a`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- The third exact-candidate gate stopped before sampling with `explore_retained_tree_not_ready`. Its atomic report is `output/android-map-memory-gate/2026-07-23T14-40-56-655Z/report.json`, SHA-256 `8ada8d5783b7c2974bf5ba0a0648b5221a7595c6766878b145f16ae6cf1c3d6c`.
- This failure revealed a real Android ANR rather than a Layers defect. Android reported that `MainActivity` had not answered a `MotionEvent` for `10010` ms. The system dialog offered `Close app` and `Wait`; QA selected `Wait`. The same process, PID `5476`, recovered after about eight seconds with Explore and the five-tab shell still mounted.
- The read-only evidence bundle is `output/android-audit/2026-07-23T14-43-52-626Z--m1-explore-anr/`. Its sanitized manifest SHA-256 is `ff791bbdf34d621fa430a4af4110cd7c23963f6923319d041ee48d5dfb154de1`; sanitized `lastanr.txt` SHA-256 is `290e3056c3f128cb3572fbe62fc0b56fdceef68b9a2a4274c0e6c810163fdf1e`. Sensitive client metadata was scrubbed and the retained evidence contains no matching key/token patterns.
- At capture the still-live process used total PSS `505583` KB, RSS `546616` KB, and SwapPSS `68620` KB. The host was under high aggregate load and Trailhead consumed about half a CPU over the preceding interval. This may amplify the older Samsung stress result, but it does not excuse a ten-second main-thread input stall.
- `ApplicationExitInfo` reported no new record because the process did not die. The gate must supplement exit-info with live ANR detection so a recoverable ANR cannot be misreported as stable.
- Layers remain user-confirmed working and were never reached by this attempt. Do not reopen Layers or repeat its manual audit.
- Open P0 defects: none. Open P1: cold signed-in Explore can block Android input long enough to show an ANR dialog. M1 is not accepted and M2 must not begin.
- Exact next action: correlate the sanitized ANR window with cold signed-in hydration and Explore startup work; add a deterministic regression for the demonstrated stall; repair only the evidenced hot path; teach the gate to fail on a live ANR; publish a paired preview OTA only if application source changes; then rerun identity and the complete ten-cycle gate.
- Do not repeat: Figma/NPS research, the 33-run crawl, broad Layers testing, the two carousel-only reports, backend deployment, or the paired OTA before the ANR cause is fixed.
- Task-owned process state: no Gradle, Metro, Expo, EAS, Railway, Maestro, Trailhead test, or memory-gate process remains. ADB remains intentionally active for the Samsung and emulator.

## Verified completed work

- The final frozen source tree passed `npm run audit:prepreview`:
  - 761 backend tests passed.
  - Android native unit/build boundary passed.
  - Originals, Explore, adaptive NPS hubs, Viator fixture/disabled behavior, TypeScript, copy audits, image guards, telemetry/privacy policy, and whitespace checks passed.
- Backend changes now cover bounded wildfire viewport queries, fresh/stale/partial/unavailable semantics, exact-media provenance, compact derivatives, and associated regression tests.
- Mobile changes now cover bounded wildfire loading, consistent map/fire status styling, exact-place media fallbacks, adaptive NPS hub navigation/return state, and image downsampling.
- Figma NPS contract: `https://www.figma.com/design/FJUcMWAfsNyjsguCEp2dBe?node-id=757-2406`.
- NPS reference evidence is under `output/nps-reference-audit/2026-07-22/`.
- Backend compatibility deployment `99dbcd8f-f0ca-417d-9123-fd812d5ae384` succeeded on Railway from the immutable source above. `https://api.gettrailhead.app/api/health` returned `200`, and the bounded fire query plus Explore catalog/home endpoints were verified live.
- Paired preview OTA published successfully from the same immutable source with Sentry source maps:
  - Preview channel ID: `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch: `preview-candidate-0b146242bfbed7fad8310beefc26b6a4e61eeeb0-mrwylb7f-ea5a0195e25ed95d0ed9b9c7`.
  - Android runtime `native-1.0.10-android.1`, group `db674e38-39ec-4a84-918a-5da5457c0587`, update `019f8d10-53f3-7635-932f-93b042500bad`.
  - iOS runtime `native-1.0.10-ios.1`, group `20cf645a-890f-4834-b813-949268db5c97`, update `019f8d10-53f3-7978-b181-53a8350ab8e8`.
- Current paired `8328739` preview with uploaded Sentry source maps:
  - Candidate branch: `preview-candidate-83287394ce41f1100bd980c9249f20d364b51db7-mrx86bsl-b127533fd2b5fd093f65b17e`.
  - Android runtime `native-1.0.10-android.1`, group `58dda7fe-67bd-46a6-a046-4c355f661e7c`, update `019f8e05-bad8-7925-8d46-54d2627b76b8`.
  - iOS runtime `native-1.0.10-ios.1`, group `72798e00-1697-46a4-8813-7c72842ab163`, update `019f8e05-bad8-745d-bc46-1ef41615d7cb`.
  - Samsung identity verified: version `1.0.10`, build `59`, channel `preview`, source `83287394ce41f1100bd980c9249f20d364b51db7`, and the Android runtime/update above.
  - Cold QA deep-link proof passed at `2026-07-23 03:31` local: cold launch completed in `1001` ms, the new process remained alive/top-resumed for more than 60 seconds, and the new launch window contained no app crash, ANR, or process-death event. The earlier `assertIsReady` crash predates this proof.
- The user manually verified that the full Layers sheet works on both Android and iPhone. The earlier automated missing-layer result was a carousel traversal false positive, not a product regression. Do not reopen Layers as a defect without new evidence.
- The exact `e15b8fe` Samsung memory gate failed the strict baseline before layer cycles with samples `938399`, `980191`, and `896221` KB. Evidence: `/tmp/trailhead-deploy-0b14624/output/android-map-memory-gate/2026-07-23T05-21-05-616Z/report.json`.
- A later old-source `831b4d7` run also stopped before cycles with samples `861106`, `814990`, and `843504` KB. Evidence: `/home/sean/.openclaw/worktrees/trailhead-deploy-831b4d7/output/android-map-memory-gate/2026-07-23T07-19-00-533Z/report.json`.
- Those reports gated on Android `TOTAL PSS` alone and also captured a separate high `SwapPss` value. Official Android diagnostics define PSS and RSS as the authoritative memory signals; subtracting SwapPSS from PSS is not a resident-memory measurement and is retained only as a labeled diagnostic. The former `512000` KB fail-fast therefore did not provide phase, recovery, or leak evidence because it stopped before the ten cycles.
- Read-only isolation proved the cold signed-in Explore process can climb above 1 GB without mounting Map. The primary evidence-backed cause was repeated per-record trip-repository hydration, with every item reserializing, rereading, and reparsing the complete account state.
- The successful cold QA proof independently observed signed-in process PSS rising from about `342` MB to `783` MB and then `1.298` GB while the QA screen remained open. This reinforces that the blocking light-screen issue is account hydration/retention, not Layers or an active map workload.
- M1 now batches each remote repository page into one transaction, rolls back failed reads/writes, emits one committed snapshot, and records count/byte-only QA diagnostics. The QA screen no longer parses full legacy offline place packs.
- Retained Map tabs now keep semantic state mounted while pausing hidden visual sources, viewport work, image work, and stale async commits. One coordinator deduplicates native region events against the refocus fallback; navigation and Originals runtimes remain independent.
- Memory Gate V3 restores captured layer choices durably, retries only a verified persisted-state mismatch once, records primary and restoration failures separately, and completes diagnostic cycles under phase-specific safety limits.
- The complete post-M1 `npm run audit:prepreview` run passed on 2026-07-23: native/config drift, Android Auto debug unit boundary, Search V2, Offline V1/V2 preservation, Explore/NPS/Viator/copy/privacy checks, TypeScript, and all 761 backend tests.

## Existing crawl evidence — do not repeat as baseline work

- 33 Android audit runs.
- 240 Trailhead Android screenshots and 219 UI hierarchy dumps.
- 10 Maestro runs covering warm Map/search and related flows.
- Android Auto evidence under `output/android-auto/`.
- NPS reference crawl: 103 UI hierarchy dumps and 94 PNGs including Figma exports.
- Existing Trailhead runs cover onboarding, Explore pagination/stress, Map/search, layers/weather, sheet/review paths, navigation, Samsung captures, and emulator flows.
- The installed evidence candidate is Android 1.0.10 build 59 with runtime `native-1.0.10-android.1`; several runs are tied to OTA/source SHA `90b8124`, while earlier emulator runs are tied to `b0c7696`.

## Known unresolved blockers

- The cold direct QA deep-link crash fix is verified on `8328739`; retain its regression test but do not reopen it without new evidence.
- Memory Gate V3 is committed and pushed; its first exact `8328739` Samsung run is preserved in **Interim device evidence** and identified the two blockers below.
- The first exact-device run proved Map idle and the observed heavy/disabled phases stayed inside their phase budgets, but it captured only four complete cycles before `layer_toggle_failed_ava`. The runner must finish all ten attempts and recovery phases without weakening exact state/restoration checks.
- Signed-in Explore/Plan idle is blocking: median total PSS was `662421` KB and median RSS was `595792` KB. Heavy Map/navigation allowances cannot excuse idle account-hydration retention.
- Navigation, 3D, and Originals are recorded as separate active-experience phases; missing active-phase evidence does not fail ordinary M1 Map acceptance, but those experiences still require their own later acceptance runs.
- Only after that pass should the affected Android delta crawl and iOS shared spot-check run. Do not repeat the 33 baseline crawls.
- EAS preview credentials for Branch, Sentry, Google Maps, and RNMapbox were verified without exposing their values before publication.
- Branch deferred handoff stays disabled until branded-domain TLS and fresh-install attribution pass.

## Deferred M3 evidence — Explore hubs

- Explore hub tabs can shift, disappear, or fall back to Overview while asynchronous data changes the module registry. Two competing navigation states and eager long-list rendering make the behavior visibly glitchy.
- Rich park data is legitimately sparse: the catalog contains `474` NPS hubs but only five current rich per-park cache packs. Missing modules must not be fabricated.
- M3 must use one stable typed module registry per detail revision, explicit loading/ready/empty/error states, deterministic richness-preserving merges, virtualized child lists, and a visible unavailable-module reconciliation while preserving real NPS content.

## Next exact actions

1. Diagnose the cold signed-in Explore ANR captured in `output/android-audit/2026-07-23T14-43-52-626Z--m1-explore-anr/`, using bounded log/timestamp reads that do not expose scrubbed metadata.
2. Add deterministic characterization for the demonstrated startup stall and live-ANR gate detection. Fix only the correlated application hot path; keep phase budgets and Layers behavior unchanged.
3. Run focused unit/type/copy/privacy tests. If application source changes, run the relevant pre-preview gates, publish one paired preview OTA from one immutable SHA with Sentry source maps, and verify both identities.
4. Rerun the complete Samsung Memory Gate V3 without clearing the signed-in account. Preserve the atomic report, hashes, ten-cycle curves, recovery, live/exit evidence, and exact saved-layer restoration.
5. Only after the gate passes, run the affected Android delta and paired iOS M1 spot checks already listed in Checkpoint B scope.
6. Commit/push Checkpoint B and assemble the M1 review packet. Do not begin M2 while any P0/P1 remains.

## Checkpoint maintenance

Update this file after each implementation checkpoint, deployment, preview publication, or device gate. Record exact SHAs, artifact IDs, evidence paths and hashes, open P0/P1 defects, the next exact action, and task-owned background processes. Keep completed work in place so a future session can distinguish reusable evidence from tests that truly need to be repeated.

Task-owned background-process state at this checkpoint: no Gradle, Metro, Expo, EAS, Maestro, Trailhead test, or audit process was found running in WSL.
