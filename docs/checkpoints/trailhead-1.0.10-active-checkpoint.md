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

## Checkpoint A.6 — Cold-start P1 closed; memory-cycle debt deferred

- Timestamp: `2026-07-23T11:39:45-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; implementation and paired-preview source HEAD: `81e182ea677941a2582e087b89bb28bc3ab1bda1`. This documentation-only checkpoint is committed afterward and therefore has a different SHA.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remained excluded, unstaged, and untouched.
- Intentional application/harness commits:
  - `9731d2c fix: make trip hydration idempotent and durable`
  - `81e182e test: fail memory gate on live app anr`
- Trip hydration no longer rewrites or emits unchanged compact trips, saved entities, or already-migrated legacy payloads. Legacy migration now stages trips, entities, outbox entries, receipts, and migration keys; a failed storage write exposes nothing and remains retryable after restart.
- Memory Gate V3 now supplements `ApplicationExitInfo` with a bounded pre-launch versus live `dumpsys activity lastanr` comparison. Reports retain only aggregate counters, a surviving live-process ANR fails stability, and raw ANR reasons/timestamps never enter the privacy-minimal report.
- Verification passed on `81e182e`:
  - `npm run test:trip-repository`
  - `npm run test:android-map-memory`
  - `npx tsc --noEmit`
  - `git diff --check`
  - `npm run audit:prepreview` in `547.2` seconds, including Android Auto debug tests, Search V2, Offline V1/V2, Originals, Explore/NPS/Viator/copy/privacy checks, TypeScript, and all `774` backend tests.
- One guarded paired preview OTA published from the exact immutable SHA after Android/iOS/web source maps uploaded to Sentry:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-81e182ea677941a2582e087b89bb28bc3ab1bda1-mrxofq1y-a6b668f764ac0688c5e426e9`, branch ID `019f8fa6-2e84-7e11-b7d1-f6ba71e934b6`.
  - Android runtime `native-1.0.10-android.1`, group `0fb48e0b-dddb-4952-8685-dd06c732257b`, update `019f8fa6-56c7-7ce2-bc93-8c621f873155`.
  - iOS runtime `native-1.0.10-ios.1`, group `cae4e106-ed5f-4c22-bc9a-9159123c7ca4`, update `019f8fa6-56c7-7195-8e83-514da9b39880`.
- Android build `59` loaded the update without clearing the signed-in account. The admin QA screen verified version `1.0.10`, channel `preview`, full source SHA, runtime, update ID, admin role, and `Ready`; no ANR dialog appeared.
- Three isolated cold launches then ran with one user input and 45 seconds without UI-automation polling. Evidence: `output/android-audit/2026-07-23T10-50-00-0500--m1-cold-start-fix/`; manifest SHA-256 `823cade316441d803269a022c52813ed8ba5930d2d56f6b1248d2b087786d97d`.
  - Maximum cold launch: `422` ms.
  - Maximum observed GC/allocation pause: `0.291` seconds, down from the prior `10–20` second stalls.
  - Zero new ANRs, ANR dialogs, fatal/OOM logs, process changes, skipped-frame events, or pauses of at least ten seconds.
- The earlier ANR bundle was re-scrubbed after adding DropBox and screenshot evidence. Sensitive client metadata was removed; the 28-file manifest is `e6259c63814865d6c331a1513f2885d11db2014d0f193171c9bd5bc348926781` and a follow-up token-pattern scan returned zero matches.
- A final exact-candidate Memory Gate V3 attempt ran for about 32 minutes, but the intentionally aborted parent task removed its output consumer. The detached Node process later terminated without writing the atomic report, so the attempt is **inconclusive** and supplies no pass/fail or phase numbers. It is not counted as an app failure and is not repeated now.
- Because the interrupted runner could not prove its own `finally` restoration, a bounded cleanup restored the last verified user choices and a separate read-only post-relaunch capture proved persistence: `3d=true`, `lands=true`, `pois=true`, `trails=true`; `usgs=false`, `fire=false`, `ava=false`, `radar=false`, `mvum=false`.
- M1 decision: the demonstrated cold-start ANR P1 is closed and no current-source P0/P1 is reproduced. M1 may move forward to M2 by explicit user direction. The complete ten-cycle phase/recovery report remains a final pre-production acceptance debt; it does not authorize production and must not be represented as passed.
- Open P0 defects: none. Open P1 defects reproduced on `81e182e`: none. Release-gate debt: current-source ten-cycle memory/recovery evidence and paired iOS device identity/delta remain pending.
- Exact next action: begin M2 Instant Search on the approved Figma treatment, preserving explicit selection, server order, cached/offline immediacy, keyboard state, route context, and Viator separation. Run only M2-specific tests and device deltas.
- Do not repeat: the full pre-preview suite, paired `81e182e` OTA, three cold-start runs, the interrupted long memory attempt, broad layer testing, 33-run Android crawl, NPS research, or completed Figma packets. Schedule one fresh full Memory Gate V3 only against the eventual frozen production candidate.
- Task-owned background processes: none. The interrupted memory process, bounded layer-restoration helper, Gradle daemon, Metro/Expo/EAS publishers, Maestro, and temporary credential/helper files were all stopped or removed. ADB remains available for the connected Samsung and emulator.

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

## Checkpoint M2.1 — Instant-search integration and Android proof

- Timestamp: `2026-07-23T12:39:00-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; implementation and paired-preview source HEAD: `2d48de0e86c2a91fcac118b5d37ca5213e955970`. The checkpoint/test commit follows this source SHA.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- M2 now renders server-ranked `SearchResultV2` rows directly in Map, Route Editor, Explore, and the shared search sheet. Legacy conversion or external resolution happens only after an explicit press. Cached/offline rows, server order, route context, pagination, stale-generation rejection, and separate Viator entry behavior remain intact.
- Map now exposes an explicit `Search this area` action after camera movement. Camera movement alone cannot launch, select, or replace a search result.
- The approved Figma treatment was implemented from node `516:784`: warm white, near-black text, restrained orange, Barlow Condensed heading, shared result rows, stable keyboard, and no provider/developer filler.
- Verification passed on the implementation SHA:
  - Search V2 presentation `9/9`, surface persistence `15/15`, and controller `31/31`.
  - `npx tsc --noEmit`, route audit (`13` cases), selector audit, copy audit (`160` files), profile-map audit, and `git diff --check`.
  - Full `npm run audit:prepreview` in `472` seconds, including native/config drift, Android Auto debug tests, Search V2, Offline V1/V2, Originals, Explore/NPS/Viator/copy/privacy checks, TypeScript, and all `774` backend tests.
- One paired preview OTA was published from the exact immutable implementation SHA after Android/iOS/web Sentry source maps uploaded:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-2d48de0e86c2a91fcac118b5d37ca5213e955970-mrxrlajv-c74b0d6b64372d06abdaf07b`, branch ID `019f8ff6-a8d2-73e3-af55-d32a52ac5925`.
  - Android build `59`, runtime `native-1.0.10-android.1`, group `5520252e-658e-48c6-aa64-219ae0ca2b77`, update `019f8ff6-ceb9-7eca-879a-b1093e431aca`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `39c62c33-aad8-4c89-bbff-1a40330fad0b`, update `019f8ff6-ceb9-734c-990d-180930d44941`.
- The Samsung admin QA screen verified version `1.0.10`, build `59`, channel `preview`, the full implementation SHA, Android runtime, update ID, and `Ready` without clearing account data.
- Android rapid A→B typing passed in `mobile/.maestro/flows/02-search-rapid-typing.yaml`. A new deterministic flow, `mobile/.maestro/flows/05-search-canonical-result.yaml`, clears prior input and proves the returned canonical NPS row `place:nps:yell`, the results list, and absence of the empty state before capturing evidence.
- Canonical-result device proof passed on Samsung `RFCR408DA9B`. Evidence is under `output/maestro/m2-canonical-2026-07-23/`; screenshot SHA-256 is `e400fc3e5eb849730c21c962768916203285f50ebb9766c87a23c5f0ed4dff89`.
- The initial ten-second failure was a test-design error, not missing data: it asserted a park title below earlier Yellowstone trail rows, and a later version accidentally matched input text. UI hierarchy inspection proved real canonical rows; the final test asserts the stable returned result ID. Do not reopen this as a catalog defect without new evidence.
- Memory decision remains unchanged: the cold-start ANR P1 is closed; the interrupted ten-cycle report is inconclusive and intentionally deferred to the frozen production candidate. It is not claimed as passed and is not rerun during M2.
- Open P0/P1 defects reproduced on this candidate: none. Remaining release evidence debt: final frozen-candidate Memory Gate V3, Search V2 production-like latency sampling, paired iOS M2 delta, and later full regression.
- Task-owned background processes: none. Maestro and the Gradle daemon were stopped; only ADB remains intentionally active. The long-lived Codex MCP processes and pre-existing localhost forwarder are not Trailhead test jobs.

## Checkpoint M3.1 — Layer parity and stable Explore module registry

- Timestamp: `2026-07-23T12:52:00-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; implementation HEAD: `9796809387af9d186aa3e48384fc5bbf9bd9651b`. No preview OTA was published for this partial M3 checkpoint.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- The existing, user-verified Layers gallery remains the rendered UI. `mapLayerRegistry.ts` now owns exact ordered descriptors for all 10 base styles, 10 premium styles, 10 overlays, and 5 tools, including internal availability, source/freshness, offline capability, and legend metadata. Dynamic state and handlers bind to that registry instead of duplicating display inventory.
- Exact-key registry tests prevent silently dropping 3D, public land, topo, places, trails, Water Safety, wildfire, avalanche, radar, MVUM, Offline entry, styles, or map tools during the later presentation migration.
- Explore detail modules now use one typed canonical order and a per-place/data-revision registry. Same-revision enrichment may add or improve modules but cannot make an already-visible tab disappear. A genuine new data revision may remove a module; if the selected module is removed, the UI shows `Section unavailable` and an explicit return to overview instead of silently swapping screens.
- No park module is fabricated. Existing adaptive NPS list → detail → map → back behavior, exact-place media policy, source content, and scroll/search/child return state remain unchanged.
- The generic `PlaceSheetShell`, `SheetCoordinator`, stable identity adapters, stale-enrichment generation checks, and campground parity contract were already present before this checkpoint. Their characterization tests pass; do not rewrite them as new work.
- Focused verification passed:
  - Layer registry `2/2` and layers/filters routing `2/2`.
  - Explore module registry `3/3`.
  - NPS preservation/navigation `11/11`.
  - Sheet coordinator `2/2` and place adapters `5/5`.
  - Explore feed audit, TypeScript, copy audit (`160` files), and `git diff --check`.
- Open P0/P1 defects reproduced by this delta: none. The next device delta should focus on the reported hub-tab glitch and unavailable-module presentation; broad Layers and NPS crawls remain unnecessary.
- Task-owned background processes: none. No Gradle, Maestro, Metro, Expo/EAS, Railway, memory gate, or Trailhead test job remains; ADB is intentionally available.

## Next exact actions

1. Review the M2 device screenshot and interaction packet without repeating the broad crawl or memory run.
2. Run the narrow Android hub delta against the next paired preview: list → module → child → map → back, same-revision enrichment, and explicit unavailable-module recovery.
3. Continue sheet migration from the characterized baseline: generic place is already on the shell; audit campground visual/chrome parity next without deleting its independent feature modules.
4. Then audit trail/trailhead, report, and Explore hub shell families. Retire no old surface until its exact parity contract and device return path pass.
5. Preserve campground site types and all existing modules, NPS hub depth, Viator external booking, comments, ratings, edits, reports, Offline, Originals, navigation, and the compass.
6. When the M3 device delta is ready, run the relevant pre-preview gate, publish one paired preview from one immutable SHA, and append the next checkpoint.

## Checkpoint maintenance

Update this file after each implementation checkpoint, deployment, preview publication, or device gate. Record exact SHAs, artifact IDs, evidence paths and hashes, open P0/P1 defects, the next exact action, and task-owned background processes. Keep completed work in place so a future session can distinguish reusable evidence from tests that truly need to be repeated.

Task-owned background-process state at this checkpoint: no Gradle, Metro, Expo, EAS, Maestro, Trailhead test, or audit process was found running in WSL.

## Checkpoint M3.4 device evidence — Trail/trailhead accepted, campground anchor reviewed

- Timestamp: `2026-07-24T00:37:33-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; Trail/Trailhead implementation commit `595cbdaab803766f0495f6e0dd34f75617f44504`; implementation checkpoint/first-preview source `d576c998d698a2166d8897f2dc246472c821bb67`; campground return correction and current exact HEAD `220f1fd14da652f879503a63d29e926184c62f9e`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain user-owned, unstaged, and untouched.
- Approved Figma anchors `407:162`, `520:782`, `520:872`, and `407:174` remain the source of truth. Mobbin AllTrails screens were used only as interaction references; no third-party branding or imagery ships.

### Paired preview evidence

- First Trail/Trailhead paired preview from exact source `d576c998d698a2166d8897f2dc246472c821bb67`:
  - Android runtime `native-1.0.10-android.1`, group `072c60ae-e9f4-4f55-a1c2-6efeec6a039d`, update `019f9287-09db-78b4-bceb-15cf2d7c27dd`.
  - iOS runtime `native-1.0.10-ios.1`, group `74fc1abe-ffe8-4698-becb-85fcd742e97f`, update `019f9287-09db-770b-aa48-82146183739e`.
- The one evidence-backed campground Sites-return correction was committed as `220f1fd` and published once as a new guarded pair:
  - Candidate branch `preview-candidate-220f1fd14da652f879503a63d29e926184c62f9e-mryhxeku-e1848c8344274af58867ef62`.
  - Android group `7da4d7be-e634-4ca0-9b00-efa6e4fa6586`, update `019f929a-3980-7f45-a1f4-3c040d9c68c9`, runtime `native-1.0.10-android.1`.
  - iOS group `8dfe89e7-5d79-474c-bf00-2852d2801747`, update `019f929a-3980-7818-b72c-de3a8bd99520`, runtime `native-1.0.10-ios.1`.
- Samsung `RFCR408DA9B` completed the two-launch OTA handoff without clearing account data. The admin QA screen verified version `1.0.10`, build `59`, channel `preview`, full source SHA `220f1fd14da652f879503a63d29e926184c62f9e`, Android runtime/update above, and delivery status `Ready`.
- The EAS channel points to the exact `220f1fd` candidate for both platforms. A physical iOS sheet interaction delta is not claimed in this Windows session; the matching iOS update record is verified.

### Verification and device results

- Automated characterization remains green: Trail flow `5/5`, hydration `4/4`, place adapters `8/8`, coordinator `2/2`, campground flow `3/3`, Search V2 `68/68`, Offline V2 preservation/runtime, telemetry/privacy, QA diagnostics, copy audit across `162` files, TypeScript, and whitespace.
- Search result → Trail Peek → Full passed on Samsung with the approved Peek-first behavior and Navigate action. Evidence: `output/maestro/2026-07-24T05-14-39-084Z--RFCR408DA9B/run.json`, SHA-256 `135446ef0f490c200cabb80f12dd69985af07ed739c5e600b103882de985278f`.
- Search result → Trailhead Peek → Full passed on Samsung with the approved Directions action. Evidence: `output/maestro/2026-07-24T05-16-14-717Z--RFCR408DA9B/run.json`, SHA-256 `c56727563c80dbe091be0725bd10053914ccdf6ce5d3a2d39ff938530e4e0dc2`.
- The stable device fixture did not expose a source-backed linked trail row, so physical Trailhead → linked trail → Back is not claimed. Its identity/generation and parent-snapshot restoration contracts pass in characterization tests. An actual map-pin path also remains an accessibility-assisted later delta; no random coordinate tapping was introduced.
- The sole allowed rerun of campground → Site A → Back on exact source `220f1fd` failed `^Sites$ is visible`. The app restored the correct Goose Island Group Sites parent and its complete content, but remained at the hero/summary instead of the Sites rail. This is a deterministic return-anchor defect, not an entity swap or blank sheet.
- Failure evidence: `output/maestro/2026-07-24T05-33-57-861Z--RFCR408DA9B/run.json`, SHA-256 `d4d15a0c770847b790eb61f4fb8f743d13cec2383bed9d9eee51aa3011e3b027`; screenshot `output/maestro/2026-07-24T05-33-57-861Z--RFCR408DA9B/artifacts/2026-07-24_003410/screenshot-❌-1784871404912-(Map search opens a complete campground sheet).png`, SHA-256 `27d4c2d5bf4e0c60812dc439124fedd2879dd71d09dc13e538956fdf3d14a906`.

### Disposition

- Trail and Trailhead Peek/Full implementation is accepted by focused automated coverage and the two deterministic Android device paths. No Trail/Trailhead P0/P1 was reproduced.
- Open P0: none.
- User review accepted the campground sheet behavior as visually adequate on `2026-07-24`; the Sites-anchor assertion is no longer a release-blocking P1. Retain its evidence as scroll-polish context and do not reopen it without a new user-visible failure.
- Open P1: none for this Trail/Trailhead packet. Devils Garden's missing rich detail is a catalog coverage gap recorded below, not a sheet identity, navigation, or rendering failure.
- Exact next action: continue with the approved report/Explore-hub sheet packet. Carry the narrow campground visual findings below as copy/data cleanup, not as a reason to repeat this sheet crawl.
- Do not repeat: the broad Android crawl, Layers/NPS research, completed Figma/Mobbin packet, Search V2 baseline, Memory Gate V3, the successful Trail/Trailhead and campground flows, either paired OTA, or the accepted campground anchor assertion.
- Task-owned background processes: none. Maestro and both EAS publishers completed; the Gradle daemon is stopped. ADB remains intentionally available for the connected Samsung and emulator.

## Checkpoint M3.4 baseline — Trail and trailhead sheets

- Timestamp: `2026-07-23T23:55:00-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact pre-change HEAD: `9cf5c50c01f0099d36db43319fb7055f70c904c1`.
- Protected Explore index SHA-256: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain user-owned, unstaged, and excluded from every implementation commit.
- Current installed paired preview source remains `6bdb6ad4f4c62e531c7c62fb11eec6de7627a7ab`: Android update `019f9243-f451-7919-a1cf-593ffc596034`; iOS update `019f9243-f451-7ab2-a175-b28a4b8b9176`; runtimes remain `native-1.0.10-android.1` and `native-1.0.10-ios.1`.
- Commit `2244401` contains the pending measured campground Sites-section return anchor. It is included in the current branch history and must ride with the next trail/trailhead paired preview; do not publish another camp-only update.
- Approved implementation anchors were re-read before code: Trail Peek `407:162`, Trail Full `520:782`, Trailhead Full `520:872`, and behavior contract `407:174`. Mobbin AllTrails references remain behavior references only; no third-party imagery or branding ships.
- Narrow scope: replace the immediate photo-heavy trail card with identity-safe Peek/Full sheets, atomic enrichment readiness, stable linked trail/trailhead return, and preserved route/offline/report/ratings actions. No API, native dependency, Layers, NPS hub, Viator, campground module, navigation-compass, Offline, or Originals rewrite is authorized.
- Focused verification only: adapters/coordinator, new trail sheet characterization, camp return contract, Search V2 sheet selection, Offline preservation, copy/privacy, TypeScript, one paired preview, Android trail/trailhead delta, the pending measured campground anchor assertion, and shared iOS spot checks.
- Loop guard: one deterministic reproduction and one evidence-backed correction per P0/P1. If the same assertion still fails, record it as blocked and stop instead of repeating broad crawls or publishing successive speculative updates.
- Open P0/P1 at baseline: none reproduced. Task-owned background processes: none; ADB remains intentionally available.

## Checkpoint M3.2 — Quick search and multi-sheet drilldown proof

- Timestamp: `2026-07-23T20:22:24-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; final application, automation, and paired-preview source HEAD: `8083f6f79104d1fcab85fbbf35a7167526e85fee`. This documentation-only checkpoint commit follows that source SHA.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remained excluded, unstaged, and untouched.
- Related-place routing now treats official `display_type`, `type`, and `subtype` as authoritative before legacy name heuristics. NPS sights, activities, and visitor centers use the generic place sheet; real campgrounds and trails retain their dedicated sheets. Legacy untyped records retain safe name fallbacks.
- Generic NPS sheets no longer inherit campground reservation treatment from stale canonical metadata. Authored sentence-case labels such as `Place to see` and `Visitor Center` remain intact.
- Visual review of the device evidence removed duplicate type/distance copy, suppresses a shorter summary only in the full stage when the complete Details text extends it, and allows long place names to wrap to two lines. Half sheets retain their useful summary. Campground modules were not flattened or removed.
- Focused verification passed on the final source:
  - Place-sheet adapters `8/8`.
  - NPS preservation `14/14` and Explore-detail return navigation `3/3`.
  - Maestro configuration `12` pinned flows.
  - TypeScript, copy audit across `160` files, and `git diff --check`.
  - Search V2 remained on its previously passing `68/68` regression baseline; this sheet-only polish did not change search ranking or request behavior.
- One guarded JS-only paired preview OTA published from exact source `8083f6f79104d1fcab85fbbf35a7167526e85fee`, after Android/iOS/web Sentry source maps uploaded and both update records validated:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-8083f6f79104d1fcab85fbbf35a7167526e85fee-mry8qp6c-bf4785be4f1de2c2d8345f20`, branch ID `019f91ae-90a5-773a-9938-6ae328e37a1e`.
  - Android build `59`, runtime `native-1.0.10-android.1`, group `747949fb-c30d-4696-acf6-af923ed38322`, update `019f91ae-b6e4-7a4f-b5c2-c5c64664aed0`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `be895b2b-ce0a-454b-9020-8f3cc75d46c0`, update `019f91ae-b6e4-7445-a465-ef3583a5645a`.
- Samsung `RFCR408DA9B` completed the two-launch update handoff without clearing account data. The admin QA screen reported Android `1.0.10`, build `59`, channel `preview`, full source SHA `8083f6f79104d1fcab85fbbf35a7167526e85fee`, runtime `native-1.0.10-android.1`, update `019f91ae-b6e4-7a4f-b5c2-c5c64664aed0`, and status `Ready`.
- Exact-candidate child-sheet device evidence:
  - Things to see → Anderson Cabin → Back → Visitor centers → Big Oak Flat Information Station → Back passed in `output/maestro/2026-07-24T01-15-41-826Z--RFCR408DA9B`. JUnit SHA-256 `f147eed392ffb3d61f458c51712b8e075a876b37cdd2c6099c26d4e6fa35b8a8`; sight screenshot `6d537cbb81ea55399d9179f3f04e2982d27e8ef44260a8165f7aa17786afc643`; visitor-center screenshot `06d3dc3b5bae98b10e6abf4bc876a536339d824b968705d6da52858e65393dd3`.
  - Things to do → Go Skiing at Badger Pass → Back passed in `output/maestro/2026-07-24T01-17-52-054Z--RFCR408DA9B`. JUnit SHA-256 `4e5297df583b7bb283ca73f7e187472a0eae0b403a6e678981890e3de0786362`; drilldown screenshot `21830e40f865d816f4026da3a47142418f945700f948e0f03c5e5c4a600ec4bb`.
  - Campgrounds nearby → Bridalveil Creek Campground → dedicated camp summary → Back passed in `output/maestro/2026-07-24T01-19-22-559Z--RFCR408DA9B`. JUnit SHA-256 `7444ddb6bf21c5c0449e3bf4f8941ff4e1c67e7e8e510eaf984ffe26b60c478c`; campground screenshot `94fb612b4f8f544f30a97d2639a8631396925fc58d6d1e27811bac316d8c782b`.
- Earlier emulator canonical-search fixtures remain useful gap evidence rather than current sheet failures: Yellowstone, Goose Island, and Corona Arch exposed legacy coordinate identities or absent canonical fixture IDs; an unrelated query returned no expected target. Preserve the runs under `output/maestro/2026-07-23T23-30-23-874Z--emulator-5554`, `...23-33-33-130Z`, `...23-36-38-340Z`, `...23-44-32-205Z`, and retry `...23-46-02-008Z` for the later canonical-coverage pass.
- Layers remain user-confirmed working and were not reopened. The broad Android crawl and long Memory Gate V3 were not repeated.
- Open P0/P1 defects reproduced on `8083f6f`: none. Remaining evidence debt: physical iOS sheet delta, formal Search V2 latency sampling, one frozen-candidate Memory Gate V3, and an accessibility-assisted actual map-pin drilldown.
- Exact next action: add one deterministic actual-map-pin path for campground → campsite details and one safe community-report pin → Suggest Update → Cancel path; then continue the characterized trail/trailhead, report, and Explore-hub sheet families without revisiting the completed NPS child chains.
- Do not repeat: the three exact-candidate flows above, broad Layers testing, the 33-run crawl, NPS reference research, Figma packets, the paired `8083f6f` OTA, or the interrupted long memory run.
- Task-owned background processes: none. The paired publisher, Metro, EAS, Maestro, and test processes completed. ADB remains intentionally active for the connected Samsung and emulator.

## Checkpoint M3.3 — Camp peek/full and Explore scroll stability

- Timestamp: `2026-07-23T21:45:58-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; implementation HEAD: `3e8dddca9ffa5e40f8c2864ef5a6c32417012864`; paired-preview source and checkpoint HEAD: `1b9c01076e0768d430da2ff831f773a233d04fc0`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remained excluded, unstaged, and untouched.
- The approved Figma Camp Peek and Camp Full frames (`407:158` and `407:159`) now drive the campground interaction. A map selection opens a compact identity-safe sheet with existing listing essentials, `View sites`, Save, and Close while full detail/photos preload in the background.
- Expanding through the card, primary action, drag, or handle reveals one coherent full-sheet state. If core detail is still loading, the expanded layout remains a full skeleton instead of rendering partially enriched modules. After six seconds it falls back to verified listing data with a concise unavailable state and Retry.
- Enrichment commits only for the current sheet identity and request generation. A new coordinate/name guard rejects a distant response such as the reproduced Yosemite selection resolving to a Michigan campsite.
- Campground → campsite now stays in the shared main-map sheet stack. Back restores the parent campground, its loaded modules, and its previous scroll position instead of exiting to Explore.
- Explore child and main lists no longer use render-controlled `contentOffset`. Scroll positions are recorded in refs and restored imperatively only on real place/module/child navigation transitions, preventing async enrichment from snapping a user back upward mid-scroll.
- Existing campground modules remain intact: exact photos, booking, site types/counts, rig fit, coverage, weather, activities, comments, ratings, source reviews, field reports, edits, reporting, coordinates, official links, and downloaded data. No NPS, Viator, Offline, report, or community capability was removed.
- Focused verification passed:
  - TypeScript and `git diff --check`.
  - Camp identity `5/5` and camp peek/loading/nested-Back contract `3/3`.
  - Place-sheet adapters `8/8` and coordinator `2/2`.
  - NPS preservation `14/14`, Explore navigation `3/3`, and Explore scroll contract `2/2`.
  - Search V2 `68/68` and Map copy audit.
- One guarded paired preview OTA was published from exact immutable source `1b9c01076e0768d430da2ff831f773a233d04fc0`, with Android, iOS, and web Sentry source maps uploaded:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-1b9c01076e0768d430da2ff831f773a233d04fc0-mrycbigw-30a79fc944ad35c6d0cc70f7`, branch ID `019f920a-4e17-73a3-b6aa-cc450c55275a`.
  - Android group `e320fc80-c7c2-4322-be6a-5821ffbe31da`, update `019f920a-7868-79cc-b416-3c3d0e4040dc`, runtime `native-1.0.10-android.1`.
  - iOS group `115d5647-1689-4e50-8618-ae5c096e1fc4`, update `019f920a-7868-7fb1-9968-f72bd7874caa`, runtime `native-1.0.10-ios.1`.
- Samsung `RFCR408DA9B` completed the two-launch update handoff without clearing account data. The admin QA screen proved Android `1.0.10`, build `59`, channel `preview`, full source SHA `1b9c01076e0768d430da2ff831f773a233d04fc0`, runtime `native-1.0.10-android.1`, update `019f920a-7868-79cc-b416-3c3d0e4040dc`, and delivery status `Ready`.
- The exact-candidate mini-sheet deltas passed on Samsung: direct search → Camp Peek → View sites → Camp Full, and NPS hub → related campground Peek → Full → Back to the correct NPS parent. Evidence is under `output/maestro/2026-07-24T02-59-52-685Z--RFCR408DA9B` and `output/maestro/2026-07-24T03-01-44-445Z--RFCR408DA9B`.
- The deeper campsite delta then reproduced a real return-state defect: the code stored a raw campsite/campground ID while the coordinator compares the namespaced stable sheet entity ID. Commit `c17e8aa` now stores `adaptCampgroundSheet(...).identity.entityId` for both the campsite and parent restoration, with focused contract coverage. TypeScript, `git diff --check`, and the camp identity/flow tests (`8/8`) pass; paired preview and device confirmation remain pending for this two-line behavior correction.
- Maestro also exhausted the Windows host drive with repeated temporary APK copies. Only task-generated `tmp*.apk` payloads in the verified Windows Temp root were truncated, recovering approximately `6.4 GB`; named preview APKs, app data, downloads, builds, and user files were not changed.
- The identity correction was published from exact source `2e8035dd19d4de4c1bca54370246c4ed2fe7b1d1` after the guarded suite and Sentry uploads passed: Android group `dd8d2218-8816-4ad1-bc00-872291fb4807`, update `019f922d-f310-74ba-968d-4a8f015a68ad`; iOS group `51df37fa-68ec-416b-98de-d31b55bb03eb`, update `019f922d-f310-7b58-b429-676f8dffb7f8`; runtimes remain `native-1.0.10-android.1` and `native-1.0.10-ios.1`.
- Samsung QA proved source `2e8035dd...`, Android update `019f922d-f310-74ba-968d-4a8f015a68ad`, runtime `native-1.0.10-android.1`, and status `Ready`. Its nested campsite delta confirmed Site A opens full and Back returns to the full Goose Island campground, but exposed a second deterministic issue: the saved scroll was applied before restored content layout and was clamped near the top.
- Commit `ebfe6e4` adds a single navigation-keyed, content-layout restore attempt. It clears immediately after use and expires after 750 ms, so later background enrichment cannot repeatedly snap the sheet. Focused contracts (`8/8`), TypeScript, and `git diff --check` pass; paired preview and final device confirmation are pending.
- The follow-up layout-window change published from exact source `6bdb6ad4f4c62e531c7c62fb11eec6de7627a7ab`: Android group `492522a5-8bf9-4368-ae82-4d8c4f28c3af`, update `019f9243-f451-7919-a1cf-593ffc596034`; iOS group `0f157551-5dd6-44f9-9f58-4c2063c4f89b`, update `019f9243-f451-7ab2-a175-b28a4b8b9176`. Samsung QA identity and delivery status passed.
- That exact-candidate delta proved the correct mini → full → Site A full → parent full state sequence, but final photo/hero measurement still made pixel-only restoration land above the Sites rail. Commit `2244401` replaces the fragile pixel-only return with the measured Sites-section content anchor while retaining the short restore window. Focused contract `3/3`, TypeScript, and `git diff --check` pass. This final anchor should ride with the next planned sheet-family preview rather than consume another standalone OTA cycle.
- Open P0: none. Camp Peek, Camp Full, exact enrichment identity, Site A full, and parent-full Back are device-proven. The measured Sites-anchor result and slow-enrichment child-hub scroll remain the only pending device assertions for this packet.
- Exact next action: continue the characterized trail/trailhead sheet family using the approved Figma/Mobbin foundations. Include commit `2244401` in that paired preview, then run the two pending assertions once alongside the new family delta. Do not publish another camp-only OTA or repeat broad campground/NPS/Layer crawls.
- Do not repeat: broad Layers testing, the completed NPS child chains, the 33-run crawl, Figma/Mobbin research, Search V2 baseline crawl, or the long Memory Gate V3. Layers remain working and memory remains frozen-candidate evidence debt.
- Task-owned background processes: none. No Gradle, Metro, Expo/EAS, Maestro, memory gate, or Trailhead test process remains; ADB is intentionally available. The visible Node processes belong to Codex/MCP infrastructure, not Trailhead work.

## Checkpoint M3.4 implementation — Trail and trailhead sheets

- Timestamp: `2026-07-24T00:01:35-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; implementation HEAD: `595cbdaab803766f0495f6e0dd34f75617f44504`. This documentation checkpoint follows that implementation commit; no preview OTA has been published yet.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain user-owned, unstaged, and untouched.
- Installed paired preview is still source `6bdb6ad4f4c62e531c7c62fb11eec6de7627a7ab`: Android update `019f9243-f451-7919-a1cf-593ffc596034`, iOS update `019f9243-f451-7ab2-a175-b28a4b8b9176`, runtimes `native-1.0.10-android.1` and `native-1.0.10-ios.1`.
- Trail and trailhead selections now open the approved map-first Peek immediately. Geometry-capable trails lead with `Preview route`; other rows lead with `View details`; Save remains secondary. Full uses the shared `TrailheadSnapSheet` and `SheetCoordinator`, preserves the main map, and follows Android Back Full → Peek → dismiss.
- Profile, weather, reports, and report summaries hydrate in one entity/request-generation-bound session. Full renders one complete skeleton until the primary session settles, then commits atomically. After three seconds it exposes a stable partial state with Retry; late reserved rows cannot replace the entity, header, action order, or scroll position.
- Linked trail/trailhead drilldown stores the parent identity, loaded modules, presentation stage, and scroll. Back restores that exact parent snapshot without a second enrichment flash.
- Full-sheet parity remains: navigation/directions, route facts, source-backed access, conditions, route preview, ratings, nearby support, reports, exact attributed photos, official sources, coordinates, Offline V1/V2, 3D Preview, Build route, Report, Share, refresh, and canonical trail edit suggestions. Temporary/map-only rows omit edit actions rather than exposing a broken capability.
- UI-only confidence percentages, generic `check local rules`, and invented parking/transit/restroom values are absent. Missing optional facts are omitted. Existing map geometry, navigation compass, route builder, NPS provenance, comments on supported canonical places, field reports, and campground modules were not removed.
- The pending campground anchor is included. The guarded pre-preview run compiled Android and passed native/config drift, Android Auto unit tests, Originals fixtures, Explore/NPS/Viator/copy/TypeScript checks, and all `784` backend tests. Its only exit failure was the known campground Maestro file's coordinate tap. That flow now uses stable campsite test ID `place-sheet-camp-camp-place-ridb-251841-site-0`; the exact Maestro contract (`12/12`), campground flow (`3/3`), TypeScript, and whitespace rerun pass.
- Additional focused verification passed: trail flow `5/5`, trail hydration `4/4`, place adapters `8/8`, coordinator `2/2`, Search V2 `68/68`, Offline V2 preservation/runtime, Sentry privacy allowlist, QA diagnostics, and copy audit across `162` files.
- Open P0/P1 reproduced by implementation tests: none. Device evidence remains pending; do not claim acceptance until the narrow Android and shared iOS deltas pass.
- Exact next action: publish one guarded paired preview from a clean immutable checkpoint SHA, verify Android/iOS update records, then run only Search → Trail Peek → Full, map pin → Trail Peek → Full, Trailhead → linked trail → Back, failure/Retry/actions/close, and the campground Sites-anchor assertion once.
- Do not repeat: Figma/Mobbin research, broad Layers/NPS/Explore crawls, the 33-run Android crawl, Search V2 baseline crawl, or Memory Gate V3. Do not publish iterative OTAs for a failed device assertion.
- Task-owned background processes: none. The pre-preview process and Gradle daemon are stopped; no Metro, Maestro, Expo/EAS publisher, or Trailhead test job remains. ADB remains intentionally available.

## Continuation handoff — campground diversity delta and next packet

- Timestamp: `2026-07-24T00:52:00-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; app source and installed paired preview remain exact SHA `220f1fd14da652f879503a63d29e926184c62f9e`. The checkpoint commit containing only tests/docs follows this SHA and requires no OTA.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- Current preview identities remain Android update `019f929a-3980-7f45-a1f4-3c040d9c68c9` and iOS update `019f929a-3980-7818-b72c-de3a8bd99520`, with their matching `native-1.0.10-android.1` and `native-1.0.10-ios.1` runtimes.
- Added two pinned, non-destructive canonical-result flows and extended the Maestro config contract from 12 to 14 flows:
  - Developed campground: canonical `place:ridb:234059`, Devils Garden Campground.
  - Dispersed campground: canonical `place:blm:ut-moab-camp-001`, Willow Springs Dispersed Camping.
- Both exact-device flows passed Peek identity, essentials, Full identity, hydration/recovery handling, and clean dismissal on Samsung `RFCR408DA9B` without clearing account data:
  - `output/maestro/2026-07-24T05-46-45-671Z--RFCR408DA9B/run.json`, SHA-256 `eb3601a58c8f9ab3cd903712af96e2418f9e405544ea49404ffcff86f04c8587`.
  - `output/maestro/2026-07-24T05-49-01-410Z--RFCR408DA9B/run.json`, SHA-256 `e445016c5adb0a8ade8fb504b5fe14c3ca884e4e9a2f5f08468e16f7d850d268`.
- Visual evidence hashes:
  - Developed Peek `defd912fde5ee1f5245416ac7e94ee37b25f9441753e84f6fed92ae163e403fa`; Full `a8d822ac226bf35d9fff0929aa1a7898bc7ac99ec7db3d35ef4a594776ef70fb`.
  - Dispersed Peek `f0e5af27eb25869611af02d7fb34469b2785b74b411a3bc30d179b7bb03e2e26`; Full `6bc282945091057e5d574396adb005e697ec6ab6c97237c7118fc08bb91d8282`.
- Visual review found two non-blocking cleanup items that automation did not prove:
  - Devils Garden lacks a rich detail record and reaches the designed stable partial state (`Some details are unavailable`) with verified listing data. Record this for the canonical camp-detail coverage pass; do not treat it as a sheet flash or identity swap.
  - Willow Springs Peek exposes a mojibake separator (`UT Â· BLM`), and its sparse Summary uses generic fallback prose. The next copy-cleanup change should replace the corrupted separator and omit unsourced generic Summary text when no real summary exists. No app-code change for these two items is included in this checkpoint.
- Maestro config contract passes: `PASS: 14 pinned Maestro flows at CLI 2.4.0`.
- Open P0/P1: none for the accepted Trail/Trailhead/camp sheet checkpoint. The two cleanup items above remain visible P2/data-quality work.
- Exact next action after opening the new account: read this section first, confirm HEAD and protected-file hash, then begin the approved report/Explore-hub sheet packet. Preserve comments, ratings, edits, reports, campground modules, NPS depth, Viator, Offline, navigation compass, and the current Map renderer. Apply the two narrow campground copy cleanups with that next compatible JS wave rather than publishing a standalone OTA.
- Do not repeat: the two campground diversity flows, Trail/Trailhead flows, campground Sites-anchor run, full crawl, Layers audit, NPS reference research, Search V2 baseline, Memory Gate V3, Figma/Mobbin research, or either `220f1fd` paired OTA.
- Task-owned background processes: none after checkpoint finalization. Gradle, Maestro, EAS, Metro, and test processes are stopped; ADB may remain available for the connected Samsung and emulator.

## Checkpoint M3.5 baseline — community reports and Explore hubs

- Timestamp: `2026-07-24T01:23:03-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact pre-change HEAD: `2bc2b810e9b933de0546d74283312f8cbf2c91a1`, matching `origin/feat/trailhead-1.0.10-overhaul`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain user-owned and must not be staged, overwritten, or discarded.
- The installed paired preview source remains `220f1fd14da652f879503a63d29e926184c62f9e`: Android build `59`, runtime `native-1.0.10-android.1`, update `019f929a-3980-7f45-a1f4-3c040d9c68c9`; iOS build `54`, runtime `native-1.0.10-ios.1`, update `019f929a-3980-7818-b72c-de3a8bd99520`.
- The two intended uncommitted campground P2 cleanups are isolated to `mobile/app/(tabs)/map.tsx`, `mobile/components/map/CampPlaceSheetPeek.tsx`, and `mobile/lib/__tests__/campSheetFlowContract.test.ts`: normalize corrupted middle-dot separators and omit unsourced generic Summary prose.
- Existing executable-bit changes in Valhalla, Gradle, Android Auto, Maestro, NPS enrichment, and routing helper scripts are Windows/WSL mode-only worktree noise. They are not part of this packet and must remain unstaged.
- Approved report behavior is locked: a community pin opens a shared half sheet; Android Back follows Full → Half → dismiss; trust actions are `Helpful` and `Not accurate`. The existing Trailhead Report/Mission Control Figma checkpoint and saved Waze/Mobbin report references are sufficient; no new visual direction is authorized.
- Explore work is limited to deterministic enrichment/navigation stability and concise empty/error copy. Preserve the existing per-revision module registry, NPS module depth, campground drilldowns, exact-place imagery, main-map returns, and the separate Viator lane.
- Narrow verification only: report identity/generation, half/full/Back, Suggest Update cancellation, private field-check permissions, Explore same-revision enrichment, child-scroll retention, new-revision unavailable recovery, campground/trail/sheet/Search V2/Offline/NPS/Viator/copy/privacy/TypeScript gates, then one Android and shared iOS delta.
- Open P0/P1 at baseline: none. Stop after one deterministic reproduction and one evidence-backed correction if a new P0/P1 appears.
- Do not repeat: broad Android crawls, Layers testing, NPS research, Figma/Mobbin research, Search V2 baseline, Memory Gate V3, campground diversity flows, Trail/Trailhead flows, or the accepted campground Sites-anchor run.
- Task-owned background processes: none. No Trailhead Gradle, Metro, Expo/EAS, Maestro, publisher, or memory-gate process is running; ADB and the Android emulator remain intentionally available.

## Checkpoint M3.5 implementation — community reports and Explore hubs

- Timestamp: `2026-07-24T01:39:34-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; application HEAD: `b15a72a` after intentional commits `78fbd4b` (campground/report sheets) and `b15a72a` (Explore hub states). The baseline checkpoint is `4e2c0de`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. Protected files and all mode-only worktree noise remained unstaged.
- Campground Peek now normalizes corrupted middle-dot separators. Sparse campground Full omits the generic access/rules/fees fallback when no sourced Summary exists.
- Public and private community pins now use one controlled `TrailheadSnapSheet`, `SheetCoordinator`, and `PlaceSheetShell`. Reports open at Half; Android Back cancels an inline update first, then follows Full → Half → dismiss.
- Known report identity, freshness, notes, coordinates, and actions render immediately. Nearby enrichment stays entity/request-generation-bound and uses a reserved loading row so it cannot change the header, action order, identity, or scroll position.
- Report trust copy is concise: `Community report`, `Helpful`, and `Not accurate`. Empty Notes and prior verification filler are omitted. Suggest Update remains inline with Cancel; private field-check Edit, Photo, Checked, Not found, and admin Publish actions remain capability-gated.
- Explore retains its per-place/source-revision module registry and transition-only scroll restoration. Modules and child rows now expose stable selectors. New-revision module removal shows a stable unavailable state with `Back to overview`; empty states no longer use trip-planning filler.
- Existing NPS See/Do/Stay/Visitor Information/trails/fees/alerts/weather/calendar/maps/nearby/source depth, campground drilldowns, exact-place imagery, Viator lane, Offline, comments, ratings, navigation, and main-map return behavior remain present.
- Focused verification passed:
  - Camp sheet `4/4`, Trail sheet `5/5`, Trail hydration `4/4`, adapters `8/8`, coordinator `2/2`, report sheet `5/5`.
  - Explore navigation `3/3`, module registry `3/3`, scroll/state contract `4/4`.
  - Search V2 `68/68`, Offline V2 preservation/runtime, NPS preservation `14/14`, Viator backend `29/29`.
  - User-facing copy audit across `163` files, Sentry/QA privacy allowlists, TypeScript, protected-file hash, staged-scope audit, and whitespace checks.
- Open P0/P1 from implementation gates: none.
- Paired preview OTA has not been published yet. Exact next action: commit this implementation checkpoint, push the three commits, run the guarded preview publisher from one immutable SHA with Sentry source maps, verify both update records, and run only the narrow Android/shared-iOS report and Explore deltas.
- Do not repeat: completed unit baselines, broad crawls, Layers, NPS research, Figma/Mobbin research, Search V2 baseline, Memory Gate V3, camp/trail device flows, or the accepted campground Sites anchor.
- Task-owned background processes: none. ADB and the Android emulator remain intentionally available.

## Checkpoint M3.5 final evidence — paired preview and Android delta

- Timestamp: `2026-07-24T02:31:59-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact application and paired-preview source HEAD: `c1b575d476b14eaa20b05b217a9b388e9589f3a1`. This documentation-only checkpoint commit follows that immutable source SHA.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, and unrelated mode-only script changes remained unstaged and untouched.
- The final source includes one device-evidence correction after the implementation checkpoint: imported GPX report filenames are removed from public Notes while authored notes remain. Focused report presentation/contract tests (`8/8`), TypeScript, and whitespace checks passed before publication.

### Paired preview identity

- Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
- Candidate branch `preview-candidate-c1b575d476b14eaa20b05b217a9b388e9589f3a1-mrylvizr-eb4f1ec7f96c5541b3c12168`, branch ID `019f92fe-e3a2-79bd-9fef-af327eaf8232`.
- Android build `59`, runtime `native-1.0.10-android.1`, group `b7477352-457a-456e-8156-e8506f0fc77f`, update `019f92ff-093c-74ee-aee6-9566e6a1c01c`.
- iOS build `54`, runtime `native-1.0.10-ios.1`, group `419682a1-b03c-4722-9694-9cacc7a2b096`, update `019f92ff-093c-74fb-8823-a419cd82305f`.
- Android, iOS, and web Sentry source-map uploads completed successfully. Samsung `RFCR408DA9B` verified version `1.0.10`, build `59`, preview channel, the full source SHA, Android runtime/update above, and delivery status `Ready`. Identity evidence: `output/qa-RFCR408DA9B-c1b575d.xml`, SHA-256 `536d1e29f99d043574f9eaea8364f725ec3de77ec382856cb2ff0779206cac87`.
- The matching iOS EAS update record is verified. Physical iOS report/Explore interaction evidence is not claimed from this Windows session and remains part of the paired-device acceptance pass.

### Android report delta

- A real existing Moab GPX community pin opened directly at Half with stable identity, vote actions, coordinates, reserved nearby loading, and the cleaned public note. The private import filename was absent while the authored note remained.
- `Suggest Update` opened inline and `Cancel` restored the original action without changing the pin. Full expanded correctly; Android Back followed Full → Half → dismiss.
- Evidence:
  - Half/content: `output/report-c1b.xml`, SHA-256 `d3d3cf62d17e8e7a6308ef093bbf984c6d8baa3dee44388a2087e119a5a7f591`; screenshot `output/report-c1b.png`, SHA-256 `4fe021fc53bbcb92783d780b5b77ddb4650d1a75cf91bb1759b572cb48c31b5b`.
  - Update/Cancel: `output/report-update3-c1b.xml`, SHA-256 `1e9d83bafd6b6585527f12e0ec1b5f125bd29afd3d5d0af236c34bfe28b310ef`; `output/report-cancelled-c1b.xml`, SHA-256 `ba97c7d9e94e34245f46ebc360d42c2ec448bc8cef1b259532e836edb737c4a9`.
  - Full/Back: `output/report-stage-c1b.xml`, SHA-256 `f6091bf4bddb5d7df89066309161487e33f1095b0dc0d0f7650afc3c23779d5e`; `output/report-back-half-c1b.xml`, SHA-256 `6b98e9bb052f67d999dbe9bf6ef71825d71e4eef0c380bb9c2186baf4f675f8f`; `output/report-back-dismiss-c1b.xml`, SHA-256 `406c957f610aa5e0f94d566f8414cfd94720ade35cbc8e2d7ed3442ab574d5a3`.
- The current signed-in map exposed only one usable overlapping report and no private field-check fixture. A physical rapid A→B or private-admin mutation was not fabricated. Identity/generation rejection and capability-gated private actions remain covered by the passing characterization suite.

### Android Explore-hub delta

- Yosemite hub → `What to See` rendered a stable three-child list. After scrolling and six seconds of delayed enrichment, all child bounds were byte-for-byte identical in the two hierarchy dumps; no snap or enrichment-driven reset occurred.
- Glacier Point opened as the exact child detail. Back restored the same module list and scroll position within two layout pixels. The deliberate child → module list → module hero → Overview chain kept the Yosemite hub selected and returned to its real-data overview rather than dismissing or switching entities.
- Evidence:
  - Hub/list: `output/yosemite-hub-c1b.xml`, SHA-256 `96e8c7a3a177e475338a6d2a84b066bfd7fe574b11a874ecd4bb0ddc78e790c9`; `output/yosemite-see-c1b.xml`, SHA-256 `e53f4c75982d9a55679ac0e843387ac81f52bfb1e5a7ad608b4246f701459b55`.
  - Stable scroll: `output/yosemite-see-scroll1.xml` and `output/yosemite-see-scroll2.xml`, matching SHA-256 `43e6ddcb227cfb7263671e335e360cfef6110b5fff635d1755e445ff99818a08`.
  - Child/return: `output/yosemite-glacier-c1b.xml`, SHA-256 `26db89dd0260544157cc5115211c7dbfa0a602c692fa672bd33f43dc21986b33`; `output/yosemite-see-return-c1b.xml`, SHA-256 `945fcd99e99df0b7f264966eb3ce34a5af9eef30904bef316f9d2a7c547f9b9c`.
  - Module/Overview return: `output/yosemite-module-back-c1b.xml`, SHA-256 `0100464fdb61cef14ada67d411020542531e3278988b8b9fd7798040a5e62e10`; `output/yosemite-module-top-c1b.xml`, SHA-256 `e05dd482d611be71190d225ff8501b921d3810f298106b139efa43d4e272381d`; `output/yosemite-overview-c1b.xml`, SHA-256 `f63a29b5cf6d69ae3f060d9f9a7623dfe9688e4343bcf02c882a811cb8e210b4`.
- Existing See/Do/Stay/Visitor Information/map/Viator preservation remains covered by the previously accepted NPS device evidence plus focused NPS (`14/14`) and Viator (`29/29`) tests. It was intentionally not recrawled.

### Disposition and continuation

- Open P0: none. Open P1 reproduced by this packet: none.
- Community reports and Explore-hub stability are accepted for this JS-only packet. The two unavailable physical fixtures are transparent evidence limitations, not passing-device claims.
- Exact next approved packet: Plan, Trips, Downloads, and Originals. Preserve the current Map renderer, all Offline V1/V2 capabilities, route-ready flow, complete End Tour behavior, campground/NPS/Viator/community modules, and the approved Figma system. Use Mobbin only as a behavior reference where the approved Figma packet needs a minor refinement; major visual changes return for user approval.
- Do not repeat: this report/Explore delta, broad Android crawls, Layers testing, NPS research, Search V2 baseline, Memory Gate V3, campground diversity, Trail/Trailhead flows, Figma/Mobbin research already recorded for completed packets, or any paired OTA in this section.
- Release authorization update: the user authorized paired production builds/OTA once the complete 1.0.10 candidate and remaining waves pass. This partial M3.5 packet does not satisfy that gate; production, public-stage changes, advertising, and store assets remain unchanged.
- Task-owned background processes at evidence capture: none. The paired publisher exited successfully; no Gradle, Metro, Expo export, Maestro, audit, or Trailhead test job remains. ADB is intentionally available for the connected Samsung and emulator.

## Checkpoint M4 baseline — Plan, Downloads, and Originals

- Timestamp: `2026-07-24T02:49:08-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact pre-change HEAD: `71b0ce5f48fd9155ae47fbfbb71f6cc98e0413b6`, matching `origin/feat/trailhead-1.0.10-overhaul`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` are the only unrelated worktree changes and must remain unstaged, unmodified, and undiscarded.
- Installed paired preview source remains `c1b575d476b14eaa20b05b217a9b388e9589f3a1`: Android build `59`, runtime `native-1.0.10-android.1`, update `019f92ff-093c-74ee-aee6-9566e6a1c01c`; iOS build `54`, runtime `native-1.0.10-ios.1`, update `019f92ff-093c-74fb-8823-a419cd82305f`.
- Existing Android evidence confirms the real Plan structure is present: `Trip Planner`, `Route Builder`, `Trips`, Draft/Saved/Archived libraries, owned Moab Original, renderer-aware Downloads entry, availability watches, and Saved items. Current Moab artwork/detail is correct and remains the approved visual baseline.
- Review boundary A is Plan and the existing main-map Downloads manager. Review boundary B is owned Originals, detail/download states, main-map playback, Minimize/Resume, and complete End Tour teardown. One paired preview is published only after both boundaries pass.
- Preserve every existing TripRepository operation, Saved/watch surface, Offline V1/V2 store and artifact family, dedicated immutable Originals store, main-map renderer, account ownership boundary, and current feature stages. No public API, schema, native dependency, permission, runtime, second map engine, or production action is authorized by this packet.
- Approved design direction remains the existing Trailhead Figma white/black/orange system and saved Mobbin behavior references. Major visual changes return for user review; this packet is stability, hierarchy, state, and recovery work.
- Narrow verification only: new Plan/Downloads/Originals characterization, existing Plan/TripRepository/Offline/Originals/copy/privacy/TypeScript gates, one Android Checkpoint-A delta, then one guarded paired preview and final Android/shared-iOS delta.
- Open P0/P1 at baseline: none reproduced. Loop guard: one deterministic reproduction and one evidence-backed correction for a new P0/P1, then checkpoint it instead of repeating broad crawls or speculative OTAs.
- Do not repeat: completed Map/Search/sheet/NPS/Explore/report crawls, Layers testing, Figma/Mobbin research already saved for these surfaces, campground/trail deltas, or Memory Gate V3 before the frozen production candidate.
- Task-owned background processes: none. No Trailhead Gradle, Metro, Expo/EAS, Maestro, audit, publisher, or memory-gate process is running; ADB remains intentionally available.

## Checkpoint M4.A implementation — Plan and Downloads

- Timestamp: `2026-07-24T03:00:22-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; baseline checkpoint HEAD: `6ea32a7a4f2548f8535d7c3e87087904aecceb74`. The implementation commit follows this entry; device review and paired OTA remain pending.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, and unrelated executable-bit-only changes in Valhalla, Gradle, Android Auto, Maestro, NPS enrichment, and routing scripts remain excluded and unstaged.
- Plan library refreshes are now owner-scoped and request-generation-bound. The first load or a real account change may show loading; warm Plan returns keep the existing trips, active filter, expanded count, scroll, selected context, watches, Saved items, and Originals visible while refreshing silently.
- A stale load from an earlier account or request cannot replace the current library. Account-scope changes invalidate pending work and reset presentation state only for the new scope.
- Plan now exposes stable automation selectors for workspaces, Draft/Saved/Archived filters, trip rows and actions, Downloads, availability watches, Saved items, and section anchors.
- `Manage offline downloads` still opens the one existing renderer-aware `OfflineModal` over the main map. Plan-origin dismissal returns to Plan at the exact captured scroll offset. Opening a downloaded map intentionally stays on Map; cancelling selected-area setup returns to the manager.
- The existing offline inventory is preserved and contract-tested: MapLibre/RNMapbox packs, regions, selected areas, trips/corridors, offline trip documents, routing graphs, trails, contours, Saved routes, Offline V2 jobs/artifacts/search, and the exact six place families `essentials`, `services`, `outdoors`, `camps`, `water`, and `trek_places`. No V1 store is migrated or deleted.
- Focused verification passed:
  - Plan deep-link authorization and presentation-state tests.
  - Automation selector contract.
  - Offline V2 pretests/runtime/catalog/active-style/account-scope and modal parity.
  - Plan workspace regression audit.
  - Account-storage lifecycle and old-owner isolation.
  - User-facing copy audit across `163` files.
  - TypeScript and `git diff --check`.
- Open P0/P1 from implementation tests: none.
- Exact next action: commit this named-file implementation scope, then run only the Android Checkpoint-A delta: warm Plan/filter/scroll retention, trip actions, watches/Saved items, Plan → Downloads nested views, dismiss return, Open Map behavior, selected-area cancel, and one airplane-mode inventory check. Do not begin Originals until that review is recorded.
- Do not repeat: broad Map/Explore/Layer/NPS crawls, prior campground/trail/report deltas, Figma/Mobbin research, Search V2 baseline, or Memory Gate V3.
- Task-owned background processes: none. Node processes belong to Codex/MCP infrastructure; ADB remains intentionally available for the Samsung and emulator.

## Checkpoint M4.A review and M4.B implementation — Originals

- Timestamp: `2026-07-24T03:17:47-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; Plan/Downloads implementation HEAD: `24b79a74d181f90c519bb434b1233bcfb3a05f9b`, pushed to origin. The Originals implementation commit follows this entry.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. Protected files and unrelated executable-bit-only worktree changes remain excluded and unstaged.
- Checkpoint A code-contract review is accepted with no reproduced P0/P1. Its physical delta is intentionally bundled with the single paired candidate: the emulator's installed debug package is stale `1.0.9`, and one bounded local `installDebug` attempt exceeded ten minutes without installing a new binary. The build and Metro processes were stopped; no repeated local-build loop was started.
- Originals retains the approved Moab artwork/detail, permanent version-pinned ownership, dedicated immutable bundle, local/offline artwork, Explore-only acquisition, Plan ownership-only listing, and the one main Trailhead map for route display, cues, progress, and playback.
- Owner/account presentation is request-generation-bound. Owned-list, detail, restore, entitlement, manifest, and bundle reads already reject stale account epochs. This packet also binds every detail download progress/result to the exact owner scope, pack, version, and UI request generation, preventing an old account or another Original's download from changing the current detail.
- The download service now suppresses progress after account scope changes. Detail presentation no longer consumes unscoped global runtime progress; its local dedicated-bundle progress remains authoritative.
- Stable selectors now cover owned rows, Retry/Restore, detail/back/share/primary, download sheet/progress/retry/update/start, Start disclosure/confirmation/recovery, main-map Minimize/Resume, captions/replay/skip/mute, feedback, and End Tour.
- Existing End Tour behavior remains unchanged and contract-proven: it invalidates trigger work, stops the cold/headless runtime and native location foreground service, clears Android Auto context and the durable active pointer, stops/unloads audio twice after queue drain, releases the audio session, removes the main-map player, preserves the downloaded bundle and completed/skipped/missed story history, and leaves a stopped restore barrier so relaunch cannot restart the tour.
- The background-location disclosure still appears only at Start/recovery. Routine detail, owned rows, resume, and playback do not repeat it. Admin simulation remains isolated from consumer progress, location services, and analytics.
- Focused verification passed:
  - Full Originals suite, including main-map renderer, continuous 46-fix route fixture, bundle/store corruption and scope isolation, download interruption, audio priority, headless runtime, feedback, and stop-race/relaunch teardown.
  - New old-owner progress suppression assertion.
  - Automation selector and user-facing copy audits.
  - TypeScript and whitespace checks.
- Open P0/P1 from implementation tests: none.
- Exact next action: commit this Originals scope, run the remaining focused Plan/TripRepository/Offline/telemetry/privacy/native-drift gates and the complete pre-preview suite once, then publish one paired preview OTA from one immutable SHA with Sentry source maps. Verify update identities before running the combined Android Plan/Downloads/Originals delta and shared iOS proof.
- Do not repeat: the failed local debug build, completed Originals characterization suite, broad Map/Explore/Layer/NPS crawls, prior sheet deltas, Figma/Mobbin research, Search V2 baseline, or Memory Gate V3.
- Task-owned background processes: none. The bounded Gradle and Metro processes are stopped; no EAS, Maestro, audit, or Trailhead test job remains. ADB remains intentionally available.

## Checkpoint M4 device correction — retain the active Plan workspace

- Timestamp: `2026-07-24T03:42:23-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact tested implementation and first paired-preview source: `41bfb9ee0dbaaee0f8581459f68be8f4801af8bb`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain unstaged and untouched.
- The complete guarded pre-preview suite passed once, including Android compile/unit checks, native/config drift, Android Auto, Originals fixtures, Map/Explore/NPS/Viator/copy/TypeScript checks, all `784` backend tests, and whitespace validation.
- The first paired preview published successfully with Sentry source maps:
  - Android build `59`, runtime `native-1.0.10-android.1`, group `e5c83ced-6d88-4652-9475-dbe70e9c93ea`, update `019f9341-c3b7-7590-8ba2-276b67d6b52e`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `c81fae56-e0fc-42d6-8d9c-696e6e70f95e`, update `019f9341-c3b7-7117-96f4-e9fc95814140`.
- Samsung `RFCR408DA9B` verified version `1.0.10`, build `59`, preview channel, full source SHA, matching Android runtime/update, and delivery status `Ready`.
- Downloads manager delta passed before the correction: Plan opened the one main-map manager; Storage Back worked; selected-area Cancel restored the manager; closing restored the exact Plan Downloads scroll anchor. Trip action parity exposed Open, Offline, notes, duplicate, save, archive, GPX export, and delete without performing a destructive action.
- One deterministic P1 was reproduced: after viewing the `Trips` workspace, Map → Plan opened `Trip Planner` instead of restoring `Trips`. The cause was the bottom tab navigating to the visible `plan` route rather than the last active Plan child route.
- One evidence-backed correction now remembers `plan`, `route-builder`, or `trips` while the JS runtime is active. Pressing Plan from another tab returns to that workspace; pressing the already-focused Plan family is a no-op. Pure route-resolution tests, Plan deep-link tests, TypeScript, and whitespace checks pass.
- Exact next action: commit this narrow correction, publish one replacement paired preview from its immutable SHA, apply the Android update, and rerun only Trips → Map → Plan with scroll retention. If it passes, continue the remaining owned-Original delta; do not repeat the complete pre-preview suite or broad device crawls.
- Open P0: none. Open P1: active Plan workspace retention is fixed in code but remains pending exact-candidate device proof.
- Task-owned background processes: none. The first paired publisher and Gradle daemon are stopped; ADB remains intentionally available.

## Checkpoint M4 device evidence — Plan accepted, Originals map handoff blocked

- Timestamp: `2026-07-24T04:04:04-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact application and replacement paired-preview source HEAD: `4f372bb885c050768a1bac1f7e4cb8b5a52af1cf`, pushed to origin.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain unstaged and untouched.
- Replacement paired preview identity:
  - Android build `59`, runtime `native-1.0.10-android.1`, group `56863c2f-fd67-4c3f-a2f7-f0f105d7ffff`, update `019f9350-223f-71f6-98cc-8986ac687fee`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `0e8d32bc-7510-4091-8d63-b214ce0f4598`, update `019f9350-223f-7b0b-805f-76401d7d1a66`.
  - Sentry source-map uploads completed and Samsung `RFCR408DA9B` verified the exact Android source/runtime/update identity.
- Checkpoint A is accepted on the exact corrected candidate. Trips → Map → Plan restored Trips, and the Plan Trips screen plus Downloads anchor retained identical bounds before and after the return. The previously completed manager, nested Back, selected-area Cancel, exact scroll return, and trip-action checks were not repeated.
- Owned Moab opened from Plan → Trips with the approved exact artwork and detail presentation. Evidence: `output/m4-plan-originals/original-detail-4f.png`, SHA-256 `f34cf9ba2fb9c9bde707dcb94da0be73aeb18c4bffcc452aedeBC3696b48dcb1` (case-insensitive digest).
- One deterministic Originals P1 is open. Retrying the interrupted dedicated bundle reached `54%` and remained there for multiple minutes. A 30-second UID network sample recorded `RX_DELTA=0`. Force-stop/relaunch did not automatically restart the Original, confirming the durable stopped/recovery boundary remains intact.
- The evidence isolates the failure to the native offline-map handoff after the immutable narration/assets phase. `expoOriginalOfflineMapAdapter.prepare` currently depends on a native completion callback and has neither installed-pack polling nor a stall bound. A missing callback can strand the detail UI indefinitely even if the pack completes, while a genuinely stalled native pack cannot return a retryable error.
- Authorized one-correction scope: require verified installed-pack completion, poll the exact renderer/name to recover a lost callback, and reject with a bounded retryable map error when no native progress occurs. Do not mark a bundle ready from the callback alone.
- Exact next action: implement the pure watchdog/status contract and the narrow adapter correction, run focused Offline/Originals/TypeScript tests, publish one paired replacement preview from one immutable SHA, and retry Moab once. If download/start still fails, checkpoint the P1 as blocked without another speculative OTA.
- Do not repeat: the complete pre-preview suite, Plan/Downloads device delta, Trips workspace correction, broad Map/Explore/Layer/NPS crawls, Search V2 baseline, Memory Gate V3, or Figma/Mobbin research.
- Task-owned background processes: none. EAS/Expo, Gradle, Metro, Maestro, and audit processes are stopped; ADB remains intentionally available.

## Checkpoint M4 Originals correction — verified native-map completion

- Timestamp: `2026-07-24T04:06:41-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; correction baseline HEAD: `4f372bb885c050768a1bac1f7e4cb8b5a52af1cf`. The implementation commit follows this entry.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- Added a pure, fixed-threshold offline-map watchdog. It records only percentage, byte count, and last-progress time; repeated identical callbacks cannot keep a stalled download alive.
- The Originals map adapter now polls the exact logical pack name on the active renderer every two seconds. A native callback at `100%` records progress but cannot mark the dedicated bundle ready. Readiness requires the installed native pack to report complete.
- A missing completion callback is recovered when installed-pack polling observes completion. No progress for 60 seconds pauses the native pack and returns the retryable message `Offline map download paused. Check your connection and retry.` Abort, error, completion, and timeout all clear the polling timer.
- Focused verification passed: renderer binding, watchdog phase boundaries and duplicate/regressed observations, native offline-pack status, the complete Originals suite, Offline V2 preservation/runtime, telemetry privacy allowlists, user-facing copy audit across `163` files, TypeScript, and whitespace checks.
- Open P0: none. The device P1 is corrected in code and remains pending the one authorized exact-candidate Moab retry.
- Exact next action: commit and push this named scope, publish one paired preview OTA from that immutable SHA with Sentry source maps, verify both update records and Android device identity, then retry the owned Moab download once. If it completes, exercise Start → main map → Minimize → Resume → End and relaunch. If it does not, record the P1 as blocked without another speculative OTA.
- Do not repeat: the complete pre-preview suite, Plan/Downloads device checks, broad crawls, previous Originals retry, Figma/Mobbin research, or prior paired updates.
- Task-owned background processes: none. Tests have exited; ADB remains intentionally available.

## Checkpoint M4 final device evidence — Plan accepted, Originals native map blocked

- Timestamp: `2026-07-24T04:22:29-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact application and paired-preview source HEAD: `c989d8f89adb45c321411da3c496b1977dbbcadf`, pushed to origin.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remained unstaged and untouched.
- Paired preview publication completed with Sentry source maps:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-c989d8f89adb45c321411da3c496b1977dbbcadf-mryq0nlh-7c4c33d38e189c2f82f35c17`, branch ID `019f9368-d1e4-728c-bc1b-002677f470b8`.
  - Android build `59`, runtime `native-1.0.10-android.1`, group `38fa493e-b5fd-4815-98e2-e4e8682d5f2c`, update `019f9368-f847-73d3-88f3-5ca97d14a945`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `b7de5426-15bc-42b6-9fab-bb4a05e5cf21`, update `019f9368-f847-783b-a3a5-aaa05fc8d3b9`.
- Samsung `RFCR408DA9B` verified exact version, build, channel, full SHA, runtime, update ID, and `Ready` delivery state. Evidence: `output/qa-RFCR408DA9B-c989.xml`, SHA-256 `4d7d021c608bbee7b706920131a2a04dae9378dd409446931ce20c7f6c6960fd`.
- Plan/Downloads Checkpoint A remains accepted on the exact paired candidate. The route-family retention correction, exact Plan scroll return, one main-map Offline manager, nested Back, selected-area Cancel, and preserved inventory were not recrawled.
- The one authorized Moab retry reproduced the underlying native-map failure:
  - The exact owned Original and correct detail/artwork loaded.
  - The dedicated bundle reached `54%` at the native-map phase and remained unchanged. Eight-second and thirty-three-second hierarchy captures are byte-identical at SHA-256 `5e6f6323187391c179a330a6e63a45d01f7f8344223e794d1e1f2f955145485e`.
  - At the fixed 60-second no-progress boundary, the adapter paused the native pack and returned `Download interrupted` plus `Offline map download paused. Check your connection and retry.` Evidence: `output/orig-progress68-c989.xml`, SHA-256 `6689558516331d8a80469d05e199c5acf5ab91f96b30714d1b7d46f557f021c2`; screenshot `output/m4-plan-originals/orig-stall-bounded-c989.png`, SHA-256 `fbd03ad139f966ddf6211ba152ad9d34fa9250e619ed44d9ca2f81df964ae958`.
  - Force-stop/relaunch showed no active Original player or automatic restart. The dedicated download and verified story progress remain preserved.
- Correction acceptance: the UI no longer hangs indefinitely, a lost callback cannot falsely mark a bundle ready, installed-pack completion can recover a lost callback, and the error is retryable. The device test proves the native RNMapbox pack itself never begins or reports progress on this candidate.
- Open P0: none. Open P1: Android cannot complete the Moab required map region, so Start → main map → Minimize → Resume → End cannot be truthfully accepted in this packet. The agreed one-correction loop is exhausted; no further speculative OTA was published.
- Physical iOS Plan/Downloads/Originals interaction and locked-screen evidence remain pending. The exact iOS EAS update record is verified, but this Windows session does not claim physical iOS proof.
- Exact next action: begin a dedicated native offline-region diagnosis from this checkpoint. Instrument the RNMapbox pack creation/status boundary on a development candidate, compare it with the working renderer-aware Offline manager, and decide whether Originals should use the modern style-pack/tile-region path already represented by Offline V2. Any native correction must advance and rebuild both platform runtimes; a JS-only correction may use one paired preview after deterministic proof.
- Do not repeat: the M4 Plan/Downloads delta, the Moab retry on `c989d8f`, complete pre-preview suite, broad crawls, Figma/Mobbin research, Layers, NPS, Search V2 baseline, or Memory Gate V3.
- Production remains blocked. This packet has an unresolved P1 and therefore does not satisfy the user's recorded production authorization.
- Task-owned background processes: none. Publisher, Expo export, Sentry upload, EAS, Gradle, Metro, Maestro, and test processes have exited; ADB remains intentionally available.

## Checkpoint M4.C baseline — Originals native offline-region diagnosis

- Timestamp: `2026-07-24T06:23:46-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; baseline HEAD: `3c634f066faebfbe458fabc83a9a2dec6d0754c0`.
- Current paired preview source remains `c989d8f89adb45c321411da3c496b1977dbbcadf`.
  - Android build `59`, runtime `native-1.0.10-android.1`, update `019f9368-f847-73d3-88f3-5ca97d14a945`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, update `019f9368-f847-783b-a3a5-aaa05fc8d3b9`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- Narrow scope: diagnose the confirmed Android RNMapbox zero-progress region at the Moab bundle's `54%` boundary; preserve the verified watchdog, all Offline V1/V2 stores, the one-main-map contract, user map preferences, and End Tour behavior.
- Evidence-backed working hypothesis: the RNMapbox v11 offline path is receiving Trailhead's custom HTTPS vector style through its style-pack/tile-region wrapper and produces no downloadable resources. The correction will bind the Original RNMapbox region to one approved Mapbox style URI and temporarily present that same style through the existing main `NativeMap` while an Original is active. MapLibre/custom Trailhead coverage behavior remains unchanged.
- Planned proof: focused style-selection, renderer-binding, main-map presentation, Originals, Offline V2, copy/privacy, TypeScript, and whitespace tests; then one paired preview OTA and one Android Moab retry. A remaining failure is checkpointed as blocked rather than looped.
- Open P0: none. Open P1: Android Moab required map region cannot complete.
- Exact next action: commit this baseline checkpoint separately, implement the shared Original map-style contract, and add deterministic tests before device delivery.
- Do not repeat: Plan/Downloads deltas, prior Moab retries, broad Map/Explore/NPS/Layer crawls, full pre-preview, Memory Gate V3, or Figma/Mobbin research.
- Task-owned background processes: none. ADB remains intentionally available.

## Checkpoint M4.C implementation — one main-map offline style

- Timestamp: `2026-07-24T06:29:48-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; implementation baseline/checkpoint HEAD: `05840175d10193b41f867dfde3e9867eebceecee`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- The RNMapbox Original adapter now gives the existing native offline manager the approved `mapbox://styles/mapbox/outdoors-v12` style URI and explicitly applies the server-provided access token before pack creation. It no longer asks Mapbox's v11 style-pack/tile-region path to derive resources from Trailhead's custom HTTPS vector style.
- MapLibre and ordinary Trailhead offline downloads are unchanged: they continue using the Trailhead HTTPS style, global-coverage validation before replacement, their existing stores, and their existing resume/delete behavior.
- While a consumer Original owns the main map, presentation props temporarily select the same RNMapbox Outdoors style. The persisted map layer, premium style, and renderer choices are not mutated. Navigation still owns its own presentation, and End Tour reveals the user's prior map choices.
- No second map engine, public API, native dependency, permission, runtime identifier, Offline V1/V2 store, Original ownership record, or playback behavior changed.
- Focused verification passed:
  - Complete Originals suite, including renderer binding, map presentation, installed-pack verification, watchdog, trigger/runtime/audio, account scope, and End Tour race coverage.
  - Offline V2 catalog, preparation/runtime, scope cleanup, active-style, downloaded place, Offline manager, and parity tests.
  - Telemetry/Sentry privacy allowlists and QA diagnostics.
  - User-facing copy audit across `163` files.
  - TypeScript and whitespace checks.
- Open P0: none. The Android Moab P1 is corrected in code but remains pending the one exact-candidate device retry.
- Exact next action: commit and push this named implementation scope, publish one paired preview OTA with Sentry source maps, verify update identities, then retry Moab once on Samsung. On success, test Start → main map → Minimize → Resume → End → relaunch and map-style restoration. On failure, checkpoint the P1 as blocked without another speculative OTA.
- Do not repeat: full pre-preview, Plan/Downloads deltas, previous Moab retries, broad crawls, Memory Gate V3, or completed design research.
- Task-owned background processes: none. Focused tests have exited; ADB remains intentionally available.

## Checkpoint M4.C Android proof and route-fit correction

- Timestamp: `2026-07-24T06:47:22-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact first correction/paired-preview source HEAD: `3dce05337d720c46b1c6f3dc7cc4fadc73a9735a`, pushed to origin.
- Paired preview:
  - Android build `59`, runtime `native-1.0.10-android.1`, group `c652e3b9-8098-4cf9-8ba5-058e66814cda`, update `019f93e9-888e-7cff-9c96-9afcfd35fc55`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `1d689b52-3acb-4af5-8d86-9b128b89c93b`, update `019f93e9-888e-7d50-9a21-bd3cf4d98477`.
  - Channel `preview`; candidate branch `preview-candidate-3dce05337d720c46b1c6f3dc7cc4fadc73a9735a-mryv1bkv-fbf6ba1ef62558e002b10f8f`.
- Samsung `RFCR408DA9B` verified the exact Android source/runtime/update and `Ready` delivery state. Evidence: `output/qa-RFCR408DA9B-3dce.xml`, SHA-256 `ca4e07f8686e7b618728e11ae97ffd74ad2c3e0c6bcf9ab282eb864a386178ea`.
- The previously blocked owned Moab bundle crossed its old `54%` RNMapbox boundary and reported `READY OFFLINE` within 16 seconds. Evidence: `output/m4-plan-originals/orig-ready-3dce.xml`, SHA-256 `399f744e5345b38015cae8efd69ee19c14d8acde9760376fba1b3d4f44019b8a`.
- Start Tour opened the one main Trailhead map and its consumer player. Minimize produced the durable resume pill; reopening it restored the full player; End Tour stopped and removed the player; force-stop/relaunch did not restart it. Evidence:
  - `output/m4-plan-originals/orig-minimized-3dce.png`, SHA-256 `d0437a768f06b22ad8f1ae18c2be7e9527b1205b6dc27cb09e69d30a7ae47d96`.
  - `output/m4-plan-originals/orig-ended-3dce.xml`, SHA-256 `f074291df6543c3333ee7395a5051e0e79b748ecb6f48d24e3227595eb909355`.
  - `output/m4-plan-originals/orig-relaunch-no-resume-3dce.xml`, SHA-256 `7b9b97ab4bbdf99744218a80de7d8efa96e3e28f1117ad9858d80042333accf6`.
- One deterministic correction-related P1 was found: the active Outdoors style finished loading after the existing automatic route fit and reset the camera to the user's location. The route remained available through the Fit Route action, but Start must present it automatically.
- Narrow evidence-backed correction: `NativeMap` now exposes its existing style-loaded event to the Map screen. Only while an Original owns the non-navigation main map, that event invalidates the previous fit signature and schedules the existing route fit again. Ordinary map/style behavior is unchanged.
- Focused renderer, main-map experience, presentation, TypeScript, and whitespace tests pass.
- Open P0: none. Open P1: the post-style-load route fit is fixed in code and pending one replacement-candidate visual proof.
- Exact next action: commit/push this narrow route-fit correction, publish one paired replacement preview, verify Android identity, Start the already-downloaded Moab Original once, and confirm its route is framed after the Outdoors style loads. Reconfirm End Tour/relaunch only if the route-fit path changes session state.
- Do not repeat: the download retry, Plan/Downloads, trigger/audio simulation, broad crawls, full pre-preview, Memory Gate V3, or design research.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; protected files remain excluded and unstaged.
- Task-owned background processes: none. The publisher and focused tests have exited; ADB remains intentionally available.

## Checkpoint M4.C final — offline map accepted, automatic fit blocked

- Timestamp: `2026-07-24T06:58:51-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact replacement source HEAD: `26a14ffa99739eb8456901c2bb6a5ba153d4dc3f`, pushed to origin.
- Replacement paired preview:
  - Android build `59`, runtime `native-1.0.10-android.1`, group `6c6aeb02-a236-4161-9612-a2ea4fc36ae4`, update `019f93f8-6356-7adb-a69e-79216177da16`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `0f269b32-338f-4df3-bd0f-ce5ba2243f2c`, update `019f93f8-6356-7560-99f0-b588e789462c`.
  - Channel `preview`; candidate branch `preview-candidate-26a14ffa99739eb8456901c2bb6a5ba153d4dc3f-mryvm5z5-385e85757f0ee85aa525c714`.
- Samsung `RFCR408DA9B` verified exact source/runtime/update and `Ready` delivery. Evidence: `output/qa-RFCR408DA9B-26a1.xml`, SHA-256 `76058cbaf0249e89192ac75bdeef3e8cbc271a07622d55cad727db65a99ed93f`.
- The required RNMapbox region remains installed and Ready; Start Tour opens the one main Trailhead map using the same Outdoors style. No bundle redownload was needed.
- The style-loaded callback correction did not make automatic route framing deterministic. After Start and style settlement, the camera still showed a broad North American viewport. Evidence: `output/m4-plan-originals/orig-route-fit-26a1.png`, SHA-256 `d14504a879c846e37b91f374fd1e2b7ee4a8fcf5f3519cdde9ba2dda75f925a6`.
- Pressing the existing Fit Route control immediately framed the exact Moab route and all 11 authored cue markers on the same Outdoors map, proving route geometry, cue rendering, and the imperative fit operation are valid. Evidence: `output/m4-plan-originals/orig-manual-fit-26a1.png`, SHA-256 `e5590688c3998d415fcba828aa05de1e5dbe3b089b4b61c7e1c3f83c95babaa4`.
- The remaining cause is a later viewport-restoration race after style load, not the Original bundle, renderer, geometry, or fit API. The agreed single evidence-backed route-fit correction was attempted and its exact assertion rerun. It remains blocked rather than entering another OTA loop.
- The active test tour was ended after evidence capture; the player is absent and no task-owned EAS, Expo, Metro, Maestro, Gradle, publisher, or test process remains.
- Accepted in this packet:
  - Plan and Downloads.
  - Moab dedicated bundle download/verification, including its required map region.
  - One-main-map Start, Outdoors presentation, Minimize, Resume, End Tour, and no restart after relaunch.
  - User map presentation restoration after End Tour.
- Open P0: none.
- Open P1: consumer Start does not automatically frame the Original route after final map viewport restoration. The visible Fit Route recovery works, but production remains blocked until Start frames the route without user intervention.
- Exact next action: in the next map-stability packet, characterize and order `restoreRecentViewportIfNeeded` versus experience-owned camera commands, then give Originals/route review/navigation a single post-restore camera-ownership contract. Do not solve it with repeated arbitrary timers. Rerun only Start → settled main map framing.
- Do not repeat: Moab download, Plan/Downloads, Minimize/Resume/End teardown, broad crawls, full pre-preview, Memory Gate V3, or completed Figma/Mobbin work.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.

## Checkpoint 1 — shared camera ownership accepted

- Timestamp: `2026-07-24T11:42:02-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact implementation and paired-preview source HEAD: `2207b122076f94afc5b2ed26269680a77e669f82`, pushed to origin.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded, unstaged, and untouched.
- Replaced the competing browse, route-builder, and Originals viewport paths with one camera-ownership controller. Priority is `navigation` → `originals` → `route_review`/`preview3d` → `route_build`/`trace` → `browse`.
- Recent viewport persistence and restoration now run only for browse ownership. An active experience gets one idempotent camera claim keyed by experience identity, route revision/content, map-surface generation, and style generation. A real user gesture cancels additional automatic claims for that experience without removing its route.
- Ending an experience releases camera ownership and restores the retained browse camera. The existing compass, manual Fit Route recovery, Android Auto synchronization, route geometry, renderer, and one-main-map architecture are unchanged.
- Focused verification passed:
  - Camera priority, idempotency, style-generation reapplication, gesture cancellation, and ownership release tests.
  - Originals renderer binding and complete Originals suite.
  - Search V2 regression, route-mode contract, copy audit across `163` files, telemetry privacy allowlist, native/config drift, TypeScript, and whitespace checks.
  - The live multi-route network audit was intentionally stopped because it is outside this narrow checkpoint and belongs to the Route Editor packet; it is not recorded as a failure.
- Paired preview publication completed with Sentry source maps:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-2207b122076f94afc5b2ed26269680a77e669f82-mrz5n1mo-dbccc99586c536509df16aa6`, branch ID `019f94f9-749d-7014-9e89-a5d759a5b216`.
  - Android build `59`, runtime `native-1.0.10-android.1`, group `1eac3136-fb31-454d-9657-09c06b724931`, update `019f94f9-981c-78bb-962f-eb5af5a88160`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `a273a2f3-f35e-4d97-93f8-05b4a018d4d7`, update `019f94f9-981c-7bf8-9d38-4d4258418c8f`.
- Samsung `RFCR408DA9B` verified version `1.0.10`, build `59`, preview channel, full source SHA, runtime, update ID, and `Ready` delivery. Evidence: `output/qa-RFCR408DA9B-2207.xml`, SHA-256 `4412a9eb795943291cf4e999d0b9769a1ce36a67a4a984deba580e1828e89898`.
- The exact previously downloaded Moab Original opened from Plan → Trips. Start Tour settled on the complete Moab/Canyonlands route with all authored cue markers. Minimize retained that camera and route without using the manual Fit Route control. Evidence:
  - `output/m4-plan-originals/orig-auto-fit-2207.png`, SHA-256 `2d85985f8e1fee04d95ed1a6c5a3151b3fcaa13bf744b8ba41ab5cffecac9897`.
  - `output/m4-plan-originals/orig-auto-fit-2207.xml`, SHA-256 `fdaedf791d7143762f913fbb8c7d9a5885168c1fff5f580d1801bd9981a4bc1a`.
- End Tour removed the player and Original route, released ownership, and restored the prior broad browse viewport. Evidence:
  - `output/m4-plan-originals/orig-ended-restored-2207.png`, SHA-256 `83ef0980b077a8f958370cd965bf567a31c3633f313b51d82908bedfb544dac3`.
  - `output/m4-plan-originals/orig-ended-restored-2207.xml`, SHA-256 `0143663ce66153236e63c2353fb3e59577d7929623d48923d92448d423ebd915`.
- Android result: accepted. iOS update identity is published and verified in EAS; the shared camera contract is covered by pure tests, while the next physical-iOS delta remains part of the Route Editor/Trip Overview paired review.
- Open P0/P1 for camera ownership: none. The prior automatic Original route-framing P1 is closed.
- Exact next action: implement the approved Route Editor and Trip Overview packet: durable route-ready actions, timeline, departure-aware weather, editable packing, sourced Brief & Backup, full-screen 3D return state, and navigation framing/compass proof.
- Do not repeat: Moab acquisition/download, Plan/Downloads, Minimize/Resume lifecycle, Layers, NPS/Explore crawls, broad Map crawls, completed Figma/Mobbin research, or Memory Gate V3 before the frozen candidate.
- Task-owned background processes: none. Publisher, Expo export, Sentry upload, EAS, Gradle, Metro, Maestro, memory-gate, and Trailhead test processes have exited. ADB remains intentionally available for the connected Samsung and emulator.

## Checkpoint 2 — Route Editor and Trip Overview accepted on Android

- Timestamp: `2026-07-24T12:54:03-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; route implementation commit `7e10a0149f48dc68393d7f53c6ff86bbcfdb132c`; exact corrected paired-preview source HEAD `f7c156018239f894df21a486bf7445b994b6dcc1`, pushed to origin.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded, unstaged, and untouched.
- Assisted and manual route completion now share one durable main-map route-review session. The route-ready state is retained until an explicit Review trip, Edit route, Offline, Options, dismiss, or replacement action. Existing route persistence, keyboard/day context, Viator insertion, navigation, compass, and camera ownership remain unchanged.
- Trip Overview now presents route-weighted drive-time segments, departure-aware forecast dates, exact-place attributed media only, and a clean fallback when no trustworthy image exists. Packing is an editable durable checklist with retained progress; the existing notes and trip actions remain.
- Brief & Backup remains bound to the exact saved trip revision and server-owned evidence. It shows sourced service intervals, exits, backup/hazard availability, evidence times, and `Not checked` when unavailable. The Samsung's selected legacy trip correctly returned the existing revision guard, `This trip changed. Review the latest route before running Brief & Backup.`, instead of generating evidence for stale geometry.
- The full-screen 3D route preview retains play/pause, scrub, speed, recenter, and the one main map. A deterministic Android defect was found during the narrow delta: hardware Back left the Map tab instead of restoring the timeline. One evidence-backed fix now intercepts Back only for an active `trail_builder` flyover and restores the exact expanded/collapsed state, selected day, and scroll offset. Co-Pilot flyovers retain their separate behavior.
- The route timeline's overnight label and missing-photo fallback now use the approved orange/neutral treatment rather than decorative green.
- Focused and guarded verification passed:
  - Route-build session/source, route-ready contract, timeline presentation, packing, exact-media trust, 3D return state, Brief timestamps, route weather, persistence/write barriers, camera ownership/mode transitions, mission briefing smoke, Plan workspace, user-facing copy, TypeScript, and whitespace.
  - One complete `audit:prepreview` run on the implementation SHA, including Android native checks, Explore/NPS/Viator preservation, all `784` backend tests, copy/privacy, TypeScript, and whitespace.
- Final paired preview publication completed with Sentry source maps:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-f7c156018239f894df21a486bf7445b994b6dcc1-mrz8dp8x-cea19f3b33191f9bab3289ef`, branch ID `019f953f-cfb9-754e-b9bd-8116c597282b`.
  - Android build `59`, runtime `native-1.0.10-android.1`, group `b0416155-3a87-4bd2-a361-24122db387f9`, update `019f953f-f207-7ee6-bd6e-d142826db46a`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `f6fa5689-0b00-48cb-8691-5d6323158eec`, update `019f953f-f207-7e22-9059-34fcc9496e07`.
- Samsung `RFCR408DA9B` verified version `1.0.10`, build `59`, preview channel, full source SHA, matching runtime/update, and delivery state `Ready`.
- Narrow Android evidence:
  - QA identity: `output/checkpoint-2-route-overview/qa-f7c.xml`, SHA-256 `5ebea854d94376d0768747fe7ad548a83197db27d8f4d6f1ba1835788a560fd5`.
  - Main-map timeline: `output/checkpoint-2-route-overview/route-overview-f7c.png`, SHA-256 `df4531fd34fd1a981ff2f8ac799442dbfd818cbdf4170d6c635347eb8aebfc72`.
  - 3D preview: `output/checkpoint-2-route-overview/route-preview-3d-f7c.png`, SHA-256 `2e7e8fe749464b9a95bca81ae4891dbab846027aa9859df8d8325a6f04b8c5f6`.
  - Exact Back restoration: `output/checkpoint-2-route-overview/route-overview-after-3d-f7c.xml`, SHA-256 `d0e8f760092b7b51aca185b3f213222f6d1b5d54f159fa19db252fe231009f66`.
  - Editable packing/progress: `output/checkpoint-2-route-overview/packing-edit-7e10.xml`, SHA-256 `7e23ce6eb2f1a4430b0dab840d6723b42fe47ee7b147c47546d5feb40b37f1c7`; `output/checkpoint-2-route-overview/packing-progress-7e10.xml`, SHA-256 `edc0f1b66dd67874b208887b17adb9f8cf07ce96ad952d3f281c14b68660c779`.
- Android result: accepted. Open P0/P1 for this packet: none. The iOS update identity and shared pure contracts are verified; physical iOS interaction remains intentionally deferred to the frozen-candidate iOS pass and is not claimed here.
- Exact next action: implement Checkpoint 3 for Profile and the existing commercial/community features: membership/preferences/vehicle/privacy, referral fallback and Branch guard, prizes/winner inbox/payout workflow, support history/attachments/diagnostic consent, and global Co-Pilot/copy parity.
- Do not repeat: Route Editor or Trip Overview broad crawling, camera/Original download and lifecycle tests, Plan/Downloads, Layers, NPS/Explore research, completed Figma/Mobbin work, the complete pre-preview suite, or Memory Gate V3 before the frozen candidate.
- Task-owned background processes: none. Publisher, Expo export, Sentry upload, Gradle daemon, Metro, Maestro, audits, and tests have exited. The temporary `trailhead-preview-7e10a01` worktree was removed. ADB remains intentionally available.

## Checkpoint 3 baseline — Profile and commercial/community features

- Timestamp: `2026-07-24T12:58:01-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; baseline HEAD `92b695262dadfaa1ca65e87e2376a21d5a2d51e4`.
- Current paired preview remains source `f7c156018239f894df21a486bf7445b994b6dcc1`: Android build `59`, runtime `native-1.0.10-android.1`, update `019f953f-f207-7ee6-bd6e-d142826db46a`; iOS build `54`, runtime `native-1.0.10-ios.1`, update `019f953f-f207-7e22-9059-34fcc9496e07`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- Existing real capabilities are the implementation boundary: account/Explorer, credits, Plan links, vehicle/rig, contributor profile, contest entry/rules/leaderboards, private winner support threads, referral share/manual fallback/privacy control, support history, sanitized attachments, diagnostics opt-in, appearance/units/communication preferences, privacy/legal, and reauthenticated account deletion.
- The approved refinement will organize these real capabilities into clearer Account, Trips & Saved, Rig, Community, Support, and Settings destinations; remove duplicate Account-level Support shortcuts; expose a user's existing prize history/status and winner thread without adding a payout-credential form; and add stable selectors and concise copy. No capability, prize amount, contest rule, Viator booking, referral credit, support privacy guard, or account safeguard may be removed.
- Branch deferred handoff remains server-disabled until branded-domain TLS, fresh-install attribution, opt-out, fallback, and exactly-once credit proof pass. The visible manual referral code remains available regardless of attribution preference.
- Narrow verification only: Profile presentation/state helpers, referrals, contest/prize/support backend tests, attachments/diagnostics privacy, subscription links, account deletion, copy/TypeScript/whitespace, then one Android Profile delta and paired preview. No broad Map, Route, Explore, Layers, NPS, Originals, or Offline crawl.
- Open P0/P1 at baseline: none reproduced. Exact next action: implement the six-section Profile hierarchy and real prize/support presentation, then run the focused gates.
- Task-owned background processes: none. ADB remains intentionally available.

## Checkpoint 3 final — Profile and commercial/community features accepted on Android

- Timestamp: `2026-07-24T13:28:24-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; implementation commit `ac70cab67cf7ff60ec78f45d50387f86c488d607`; exact corrected paired-preview source HEAD `e44b62c85e07867a4dacac03873b511c797f9b7a`, pushed to origin.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded, unstaged, and untouched.
- Profile now has six stable destinations backed by existing capabilities: Account, Trips & Saved, Rig, Community, Support, and Settings. Account keeps Explorer membership, credits, subscription management, referral share/manual code, and attribution privacy. Community keeps contributions, the real contest, entry/rules, prize amounts, user award history when present, and the private winner-message handoff. Support keeps ticket history, sanitized attachments, Report issue, and diagnostics consent off by default.
- No payout credential form was added. Award statuses are limited to `Winner selected`, `Payout coordination`, `Paid`, and `Closed`, and payout coordination opens the exact private support thread when one exists. The connected account has no award record, so the user-award module was correctly omitted instead of fabricating an empty state.
- Co-Pilot is labelled `Co-Pilot voice assistant` with Explorer context and no AI badge. Profile body/control copy uses the system face while Barlow remains limited to editorial headings.
- A narrow Android visual delta found two P2 issues: the selected horizontal section could remain against a clipped edge and the `Contributions` quick action wrapped awkwardly. The one evidence-backed correction now scrolls the active section into view and keeps quick-action labels on one line. No feature ownership or data flow changed.
- Focused verification passed:
  - TypeScript.
  - Profile presentation and selected-section tests.
  - Referral link/native lifecycle tests.
  - Account deletion and support tests.
  - Contest/referral/support backend tests (`12` tests).
  - Telemetry privacy allowlist.
  - Profile/map regression audit.
  - User-facing copy audit across `164` files.
  - Whitespace checks.
- Final paired preview publication completed with Sentry source maps:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-e44b62c85e07867a4dacac03873b511c797f9b7a-mrz9np9h-4fc8711516117f164207ff64`, branch ID `019f9560-4337-7c12-89ef-46190879e3bb`.
  - Android build `59`, runtime `native-1.0.10-android.1`, group `91be4aa7-483d-4d39-a4f6-4dfa41f63053`, update `019f9560-68cb-72d3-a477-b02d24dc9771`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `0315b612-f984-436c-99e4-0caa9177d233`, update `019f9560-68cb-7f15-b86d-4f283363cccd`.
- Samsung `RFCR408DA9B` verified version `1.0.10`, build `59`, preview channel, full source SHA, matching runtime/update, and delivery state `Ready`.
- Narrow Android evidence:
  - QA identity: `output/checkpoint-3-profile/qa-e44b.xml`, SHA-256 `013f6a37920840081ba6ecca7e1f31a507305bc679c3fe845fd4e548961256a9`.
  - Community selected-section and single-line action: `output/checkpoint-3-profile/community-e44b.png`, SHA-256 `34a3ea530d731d2d6c0272109e8a6bd1e23a2d799366414a91f6e88d3d2d0679`; hierarchy SHA-256 `c7504aeeaaf6bf496a9f644df94c7055c2b9081bb68f207f890bad366d6a86ba`.
  - Support selected-section and real support surface: `output/checkpoint-3-profile/support-e44b.png`, SHA-256 `e5ecc46a2e9de4d9ba8d61c751c7863af0b83269bbb2a75790544869eedd00c3`; hierarchy SHA-256 `3255163e1b5553ab5aa694b8c02641951a32a75c5e42bf1b03b12e2aa8c21863`.
  - Support attachment/diagnostic modal: `output/checkpoint-3-profile/support-modal-ac70.xml`, SHA-256 `b57a03ec93f815a1e83bacf516cb85efbf6d4d024018d927fef5bde237b7c240`.
  - Prize presentation and official rules: `output/checkpoint-3-profile/prizes-ac70.png`, SHA-256 `7f13884319e6125dd43b893462e0090c532e90b51320b2fc7eab8154642c7f4c`; official-rule hierarchy SHA-256 `27521fca43cfb9361145c7aa2c2543f007ff3b75c27733693f45e778e843a5d4`.
- Android result: accepted. Open P0/P1 for this packet: none. The iOS paired update is published; physical iOS interaction remains part of the frozen-candidate pass and is not claimed here.
- Branch deferred handoff remains disabled until branded-domain TLS, fresh-install attribution, opt-out, manual fallback, and exactly-once crediting are proven. The visible manual referral code remains available.
- Exact next action: freeze the current feature-complete preview candidate and run the remaining acceptance deltas: Search V2 performance, Memory Gate V3, Android Auto/DHU, Android Originals background/mock-route policy evidence, then the shared and platform-specific physical-iOS checks. Resolve only deterministic P0/P1 defects before producing paired production binaries.
- Do not repeat: broad Profile, Map, Plan, Downloads, Route Editor, Trip Overview, Layers, NPS/Explore, campground/sheet, or Original acquisition/download crawls; completed Figma/Mobbin research; or earlier memory runs.
- Task-owned background processes: none. The publisher, Expo export, Sentry upload, Metro, Maestro, Gradle, and focused tests have exited. ADB remains intentionally available for the Samsung and emulator.

## Frozen-candidate Android delta — search, time-boxed memory, and Originals background proof

- Timestamp: `2026-07-24T14:57:07-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact implementation and paired-preview source HEAD `c33ac03d23aadf34164f94f2125e5da3b97abe32`, pushed to origin.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, and the unrelated Valhalla/Maestro mode-only changes remain excluded and unstaged.
- Canonical Search V2 performance passed against the current `48,486`-document index:
  - One process-start prewarm took `4325.07 ms` and is not counted as indexed request latency.
  - First indexed p95 was `13.36 ms` across ten synthetic queries.
  - Repeated indexed p95 was `13.21 ms` across fifty calls.
  - Responses remained below `100 KB`, and evidence does not retain query text.
  - Evidence: `output/frozen-candidate/search-v2-canonical-performance.json`, SHA-256 `44953c3712efd0c2949063d0069363194c0c8d041955d9a221499e953578ab38`.
- Memory Gate V3 was intentionally time-boxed at the user's request after four complete heavy-layer peak/recovery cycles and the start of cycle five. It was cancelled through the gate's handler, which restored and relaunch-verified the exact original layer state. The report status is therefore `cancelled`, not a memory failure.
  - Explore settled total PSS was approximately `389,478–390,630 KB`; resident estimate `321,782–322,939 KB`; RSS `424,624–425,784 KB`.
  - Map-idle total PSS was approximately `538,883–544,560 KB`; resident estimate `432,980–438,036 KB`; RSS `540,572–545,628 KB`.
  - The highest completed heavy peak was `768,551 KB` total PSS, `566,884 KB` resident estimate, and `673,984 KB` RSS.
  - Cycle four recovered to `647,049 KB` total PSS, `438,548 KB` resident estimate, and `538,244 KB` RSS.
  - All four completed cycles verified both enabled and disabled layer states. The process stayed alive with no observed OOM, LMK, ANR, process death, duplicate renderer, or state loss.
  - Evidence: `output/android-map-memory-gate/2026-07-24T18-31-07-955Z/report.json`, SHA-256 `b5d97029a3d252164e6131ee8ef678f3914947e77d9888e35c50a62c25692e8e`.
  - Do not restart the ten-cycle run in this packet. This is useful stress evidence but is not represented as a complete ten-cycle pass.
- Link infrastructure is healthy:
  - `go.gettrailhead.app` serves valid HTTPS with HSTS.
  - Android association evidence: `output/frozen-candidate/assetlinks.json`, SHA-256 `7dd65b3ef0df1fc512ec132470e60a6bfaa898abda3d18a91eb4d704be425121`.
  - Apple association evidence: `output/frozen-candidate/apple-app-site-association.json`, SHA-256 `e24e05ee50214b67d2017ba6b398d39b0e68a254597cee02cbdc994d3a8474e4`.
  - Branch deferred handoff remains disabled until fresh-install attribution, fallback, opt-out, and exactly-once crediting receive physical proof.
- Android Auto exact-candidate preflight passed for `com.trailhead.app` version `1.0.10` build `59`; the older debug package remains disabled. Evidence: `output/android-auto/2026-07-24T19-24-16Z--RFCR408DA9B/candidate.json`, SHA-256 `02b2f090cef94d92b5901824b18c0bac0ec1c1d9b8588fa5432e05b5d34b641c`. The first DHU launch reached the local tool but the phone Head Unit Server was no longer accepting the forwarded connection. Treat the route/maneuver DHU session as pending setup, not as an app failure, and retry it once only after the server is confirmed active.
- The published Moab Original version `1` was exported read-only from the authenticated production service and pinned to manifest SHA-256 `14cddd021e49310b1001013d7c542616080f848157c5f9b1a1a1b795012f43b7`.
- The real consumer tour, not the admin simulator, passed the Android background trigger delta on the prior feature-complete candidate:
  - The main Trailhead map opened the immutable Moab route and first story.
  - Home/notification shade retained the `Trailhead Original active` foreground-service notification.
  - Twenty-eight continuous OS-level GPS fixes from route progress `300–1700 m` crossed the first authored trigger window.
  - The media session reported `PLAYING`; reopening showed `1/11` complete and story `02` next.
  - End Tour removed the location notification and media session and did not auto-resume.
- That run exposed one deterministic P1: an older active Flagstaff trip's route-alert panel and map annotations remained visible under the Moab Original. The cause was presentation-only mode isolation, not the trigger engine, bundle, ownership, or camera controller.
- The correction gives an active non-navigation Original ownership of map context. It suppresses trip status, camps, gas, generic POIs, community/report pins, and route alerts while preserving those states for restoration. Navigation retains the higher-priority driving context.
- Focused renderer, camera-ownership, map-presentation, TypeScript, copy audit across `164` files, and whitespace checks passed.
- Replacement paired preview publication completed with Sentry source maps:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-c33ac03d23aadf34164f94f2125e5da3b97abe32-mrzcrj8l-84d9dba9fc30c3e3357b7953`, branch ID `019f95af-ff0a-7703-ac73-2636f38a43ce`.
  - Android build `59`, runtime `native-1.0.10-android.1`, group `9df772da-8421-4be6-bdc1-d8ead84546ee`, update `019f95b0-2327-7120-90f1-bde72768af6d`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `e741c2a2-5583-4b8c-b07c-7a9e219c8f5a`, update `019f95b0-2327-7bda-ab59-1ab3ccdcd5b7`.
- Samsung `RFCR408DA9B` verified the exact `c33ac03` Android SHA, version, build, channel, runtime, update ID, and `Ready` status. Evidence: `output/frozen-candidate/qa-c33ac03.xml`, SHA-256 `25da9548fca1b200a742d4db64730b51e731fe4f2b535f86d296a4bdb891574f`.
- The single corrected assertion passed: with the existing Flagstaff trip retained and Moab resumed, the player showed `1/11`, while visible stale Flagstaff text and route-alert/live-traffic content both counted `0`. Evidence:
  - `output/frozen-candidate/original-c33-active.xml`, SHA-256 `64894a8617c45550a9c06be7e8e59a7b0f35ae5ebb32918052a7673a68929bef`.
  - `output/frozen-candidate/original-c33-active.png`, SHA-256 `b9d064dda9c70da19f349993d96b576b1653c953e93fff8839600428cc979cd9`.
  - End Tour again removed the Original notification and media session; post-End screenshot SHA-256 `c3c7682fd2b7eb912e16b929dda0d22c3de2deb45f445b4be51d10bd338a233f`.
- Android app-code P0/P1: none open. Remaining release evidence is one confirmed DHU session and the physical iOS shared/native delta; neither is claimed complete here.
- Exact next action: confirm the Android Auto Head Unit Server is active and run one DHU route/maneuver/reconnect session, then connect and unlock the iPhone for the shared Map/Search/sheets/Plan/Downloads/Originals delta plus Universal Links, background audio/location, Now Playing, interruptions, and durable resume. Run the complete pre-preview suite once at the final freeze, not after every device assertion.
- Do not repeat: Memory Gate V3, canonical Search V2 performance, Moab download/acquisition, the first-story background trigger, Plan/Downloads, Route Editor/Trip Overview, Profile, Layers, NPS/Explore, or completed Figma/Mobbin research.
- Task-owned background processes: none. Publisher, Expo export, Sentry upload, Metro, Maestro, Gradle, memory-gate, and Trailhead test processes have exited. The temporary export worktrees and pulled preview environment file were removed. ADB and the Codex-owned browser runtime remain intentionally available.

## Frozen-candidate Android closeout — DHU transport isolated

- Timestamp: `2026-07-24T15:29:00-05:00`.
- Repository checkpoint base: `41a2fbb`; exact paired mobile source remains `c33ac03d23aadf34164f94f2125e5da3b97abe32`.
- The Samsung remained on the exact Android candidate: version `1.0.10`, build `59`, runtime `native-1.0.10-android.1`, update `019f95b0-2327-7120-90f1-bde72768af6d`.
- Exact-package Android Auto preflight still passes. The phone developer menu reported `Stop head unit server`, and the forwarded Windows port `127.0.0.1:5277` accepted TCP connections.
- The earlier Linux DHU attempts were invalid for this USB layout because the Windows ADB forward and WSL loopback were different hosts. The installed Windows DHU corrected that transport mismatch and logged `[I]: connected.` against the active phone server.
- The phone projection then disconnected before Trailhead's `androidx.car.app` service bound, and the Windows DHU returned to `Waiting for phone`. A clean phone-server reset and a single post-reset attempt reproduced the same host-level handshake result. There was no Trailhead crash, ANR, process death, route-state loss, or car-service exception.
- Evidence:
  - Windows DHU connection log: `output/frozen-candidate/android-auto-windows-dhu-20260724.out.log`, SHA-256 `ae04548587f2d83b79a54ac2d6c3c8154bfee019125aaa52ed93998cae3f0d71`.
  - Windows DHU stderr: `output/frozen-candidate/android-auto-windows-dhu-20260724.err.log`, SHA-256 `31f3f1fac8d2f73ece24ba3ddb94caf5048a5fb4ad0beb1ef4b64338b0a297fe`.
  - Active phone-server UI state: `output/android-auto/aa-state.xml`, SHA-256 `19e3be96699b363f97483132db605f86c15157f05203d7a5d1009a726f8a8787`.
- Android app-code P0/P1 remains none. Android Auto compile/unit/native-drift checks remain green, and no Android Auto or native code changed between the checked build and `c33ac03`.
- The live DHU route/maneuver session is not claimed as passed. It is checkpointed as an external projection-host block and will not be retried in a loop. If release evidence still requires it after the iOS delta, use one actual vehicle/head-unit session or a freshly reset Android Auto host rather than repeating this desktop setup.
- Exact next action: disconnect the Android device, connect and unlock the iPhone preview, then run only the frozen-candidate iOS shared/native delta. Do not repeat Search V2 performance, Memory Gate V3, Moab acquisition/background triggering, broad Android crawls, or this DHU handshake sequence.
- Task-owned DHU, WSL DHU, Metro, Gradle, Maestro, EAS, Expo, publisher, and test processes: none.

## Frozen-candidate iOS delta — Yellowstone destination ranking correction

- Timestamp: `2026-07-24T20:51:00-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact backend correction HEAD `397582b2b9fe828aac7a949d14b7c7be8ebe1467`, pushed to origin. The paired mobile source remains `c33ac03d23aadf34164f94f2125e5da3b97abe32`; this server-only change does not require an OTA or native build.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- The exact iOS preview IPA was installed on physical iPhone `SEAN` and its Expo updates database directly verified build `54`, runtime `native-1.0.10-ios.1`, source `c33ac03d23aadf34164f94f2125e5da3b97abe32`, and update `019f95b0-2327-7bda-ab59-1ab3ccdcd5b7`. The update has one successful launch and zero failed launches. Home/resume completed without a crash, and no Trailhead crash report was found.
- A physical Map search for `yellowstone` deterministically returned exact-name USFS trails before the verified NPS destination. Opening the first row produced the correct stable Trail Peek for that actual trail, proving the blank-sheet path is closed while exposing a server-ranking defect: a broad destination query could be dominated by same-name trails.
- Evidence before correction:
  - Result list: `C:\Users\User\AppData\Local\Temp\trailhead-ios-yellowstone-results.png`, SHA-256 `C78545B8710F759E989B31EDACE3E20FCCC59A28958B78F8DB8AB2CFDBB7ED7A`.
  - Stable trail sheet: `C:\Users\User\AppData\Local\Temp\trailhead-ios-yellowstone-sheet.png`, SHA-256 `439670F6D35B7515E926A0D800DDCB36AFF66EDC84AFD4D6074610E5D214129F`.
  - Live pre-refresh result list: `C:\Users\User\AppData\Local\Temp\trailhead-ios-yellowstone-live.png`, SHA-256 `874D418913111024EE4A7E9F6F1CFC21D2E847C430111C119EA047C32AE9E176`.
- The server now gives a verified, destination-faceted title-prefix match one internal priority class ahead of ambiguous exact-title non-destinations for `intent=any`. The internal marker is private and never serializes into `SearchResultV2`; public match reasons and API contracts are unchanged. Genuine trails remain immediately after the destination rather than being suppressed.
- Regression coverage proves `Yellowstone National Park` ranks ahead of exact Yellowstone-named trails, preserves the trail rows, and does not expose the private ranking marker. The complete Search V2 suite passed: `63` tests. `git diff --check` also passed.
- Railway production deployment `e031ab1c-5d41-4b2b-8b19-eab3cc611540` succeeded from a clean detached worktree at exact `397582b`. The previous deployment was removed only after success. `https://api.gettrailhead.app/api/health` returns `200`; startup and health logs are clean.
- The refreshed physical iOS generation passed: `Yellowstone National Park` is first and correctly labelled `Park`; real Yellowstone trails remain immediately below it. Evidence: `C:\Users\User\AppData\Local\Temp\trailhead-ios-yellowstone-refreshed.png`, SHA-256 `5E6D174CA4E1B93D8601DE8D3B1E142D194B3970FFEA82FC56C866A09767DE54`.
- A non-blocking copy-polish issue remains in the result subtitle: jurisdiction abbreviations need spaces and the park name is repeated. This does not affect entity type, ranking, selection, coordinates, or map synchronization.
- The selected result opened the correct Yellowstone National Park Park/NPS hub sheet with the same identity, real NPS description, Things to do, Things to see, and Visitor centers modules. A second capture after five seconds was pixel-identical, proving enrichment did not swap the entity, sheet family, header, or visible module state.
  - Open sheet: `C:\Users\User\AppData\Local\Temp\trailhead-ios-yellowstone-park-open.png`, SHA-256 `FD4F0A9F97769FB2D01E0A229A83D10AAE4594B5472E609AA2E63891BDB3719A`.
  - Settled sheet: `C:\Users\User\AppData\Local\Temp\trailhead-ios-yellowstone-park-settled.png`, SHA-256 `FD4F0A9F97769FB2D01E0A229A83D10AAE4594B5472E609AA2E63891BDB3719A`.
- Search/sheet P0/P1: none. Minor copy polish remains for the cramped jurisdiction subtitle and `Park · away` when distance is unavailable; this does not reopen ranking or sheet stability.
- Exact next action: continue the remaining focused iOS Plan/Downloads/Originals and background-audio/location delta. Do not repeat the Yellowstone ranking or park-sheet assertion.
- Do not repeat: Search V2 performance, backend diagnosis, broad Map/search/sheet crawls, Android memory work, Android Originals acquisition/background trigger, NPS research, Layers, DHU desktop handshake, or completed Figma/Mobbin work.
- Task-owned background processes: none. Railway deployment and focused tests have exited; no Metro, Expo, EAS, Gradle, Maestro, memory-gate, or publisher process is running.

## Frozen-candidate iOS closeout — Mapbox Original route preview accepted

- Timestamp: `2026-07-24T22:15:00-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact implementation and paired-preview source HEAD `a69397052c9827701551edbe9c6b294796a594ce`, pushed to origin.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, and the unrelated Valhalla/Maestro mode-only changes remain excluded and unstaged.
- The Original detail route preview now uses the existing native RNMapbox renderer with the Mapbox Outdoors style. It is not a static image, custom-topo fallback, or second map engine.
- The embedded map receives the immutable authored-route bounds in its initial camera settings, then retains the existing readiness-gated idempotent fit for style reloads. Ordinary Map screens retain their previous free-camera behavior.
- Focused Originals renderer/camera-ownership tests passed, including `6` camera-ownership cases. TypeScript and whitespace checks passed.
- Replacement paired preview publication completed with Sentry source maps:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Android build `59`, runtime `native-1.0.10-android.1`, group `8f3eda5c-55c9-481d-a611-19062e408733`, update `019f9743-1b1b-79b2-8573-455c079b3aed`.
  - iOS build `54`, runtime `native-1.0.10-ios.1`, group `a74caa64-4045-45ca-88ef-0ddd041b978f`, update `019f9743-1b1b-7ef8-9ed4-d4bf0031e31d`.
- Physical iPhone proof passed: the Published route mini-map rendered the real Mapbox Outdoors style, centered on Moab/Canyonlands, and displayed the orange authored route. Evidence: `C:\Users\User\AppData\Local\Temp\trailhead-ios-a693-original-detail.png`, SHA-256 `caff92024c669dea4a6b605327090fb60e7c487a4dd252a47026dbcba2aa5de5`.
- The broader focused iOS packet already passed Plan warm retention, Plan-origin Downloads return, owned Moab detail and bundle readiness, Start disclosure, real version-pinned GPX background cue triggering, Minimize/Resume, captions/player controls, End Tour teardown, and no automatic restart after reopen.
- iOS app-code P0/P1: none open. Call/system interruption, Bluetooth reconnection, Low Power Mode, and complete Now Playing control evidence remain release-evidence checks and are not claimed by this checkpoint.
- Exact next action: disconnect the iPhone, reconnect Android, confirm the Head Unit Server is active, and run one live Android Auto route/maneuver/reconnect session. Do not repeat the desktop DHU handshake loop. If projection remains externally blocked, checkpoint it once rather than retrying.
- After the Android Auto session: freeze one clean source SHA, run `audit:prepreview` exactly once, and create paired 1.0.10 production candidates only if no P0/P1 remains.
- Do not repeat: Yellowstone search/ranking or Park sheet, Plan/Downloads/Originals acquisition and lifecycle, GPX trigger, mini-map implementation, broad Map/Explore/sheet crawls, Search performance, Memory Gate V3, Layers, NPS research, completed Figma/Mobbin work, or the earlier desktop DHU handshake sequence.
- Task-owned background processes: none. Publisher, Expo export, Sentry upload, Metro, Maestro, Gradle, memory-gate, and focused test processes have exited.

## Frozen-candidate Android closeout — single DHU session remains externally blocked

- Timestamp: `2026-07-24T22:35:35-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; checkpoint base HEAD `e40e0e58c41518275c2327d85e796be8f61294ba`. Exact paired mobile source remains `a69397052c9827701551edbe9c6b294796a594ce`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, and unrelated mode-only changes remain excluded and unstaged.
- Physical Samsung `RFCR408DA9B` was connected and authorized with `com.trailhead.app` version `1.0.10`, build `59`. The emulator remained connected but was not selected.
- Exactly one Windows DHU session was run after the user started the Android Auto Head Unit Server. ADB forwarding selected only the Samsung. The Windows DHU reached `[I]: connected.` on `localhost:5277`, then the projection host closed before Trailhead's `androidx.car.app` service received or bound a session.
- The phone returned to Android Auto's ordinary `Connect a vehicle` screen. The post-session activity-service and relevant logcat filters were empty. Trailhead produced no crash, ANR, process-death, or car-service exception; recorded historical process exits were user-requested/force-stop events.
- This reproduces the previously checkpointed projection-host handshake boundary with no new Trailhead app-code signal. It is not recorded as a passed route/maneuver/reconnect session and will not be retried through this desktop setup.
- Evidence directory: `C:\Users\User\AppData\Local\Temp\trailhead-android-auto-2026-07-24T22-34-18`.
  - DHU stdout SHA-256 `ae04548587f2d83b79a54ac2d6c3c8154bfee019125aaa52ed93998cae3f0d71`.
  - DHU stderr SHA-256 `31f3f1fac8d2f73ece24ba3ddb94caf5048a5fb4ad0beb1ef4b64338b0a297fe`.
  - Phone-state screenshot SHA-256 `e39e0ccdb67bcef18f20d0ce297fb3bec94ea599360d2b0b642e0ff034ae3f6a`.
  - Phone hierarchy SHA-256 `cba78d57a8da57c4a96db645f6a58ec2575ab06d72e8a8fcb6d853dbc9eebcb0`.
  - Evidence manifest SHA-256 `90dac76dc0988d7ddadc3b9fc45f562912e0595184c3912f470b8c4183e114cc`.
- Android app-code P0/P1: none open. Live Android Auto route/maneuver/reconnect evidence remains a production-submission blocker under the approved release plan.
- Exact next action: use one actual vehicle/head unit or a freshly reset Android Auto projection host for the missing live session. Do not repeat this desktop DHU handshake. Once that external proof passes, freeze one clean SHA, run `audit:prepreview` exactly once, and create the paired 1.0.10 production candidates.
- Do not repeat: this Windows DHU session, earlier WSL/Windows DHU handshakes, Android/iOS Originals lifecycle or mini-map proof, Yellowstone search/Park sheet, Search performance, Memory Gate V3, broad crawls, Layers, NPS research, or completed Figma/Mobbin work.
- Task-owned background processes: none. The DHU exited, the ADB forward was removed, and no Metro, EAS, Expo, Gradle, Maestro, memory-gate, publisher, or focused test process remains.

## Android Auto live DHU proof and reconnect correction

- Timestamp: `2026-07-24T23:03:02-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; pre-change HEAD `26cd337a6903c1f969e50cc0bfd42ea2b905fd24`. Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- The earlier DHU block was resolved without a vehicle. DHU 2.1 must retain an interactive console; launching it through a persistent command window completed the phone handshake that redirected/stdin-closed launches had terminated.
- The physical Samsung and Windows DHU completed a real Trailhead Car App Library session:
  - Trailhead appeared in the Android Auto launcher and rendered the Flagstaff-to-Moab route on its car map surface.
  - Start Route opened active guidance with the route, current position, recenter/zoom controls, report action, ETA panel, End control, and navigation compass.
  - The island position correctly produced an off-route state.
  - Android's official `AUTO_DRIVE` command was accepted by `TrailheadCarAppService`; Trailhead acquired navigation audio focus and rendered simulated active-route progress without a vehicle.
  - The projected host negotiated Car App API 8 with Trailhead's Car App Library 1.7.0 service.
- One deterministic P1 was found during the required reconnect assertion: dropping only DHU stopped `TrailheadCarLocationService`; reconnect restored the route but returned to `Start route` instead of active guidance.
- Evidence-backed cause: `TrailheadCarSession` treated host/session destruction as a user End action and unconditionally stopped the phone-owned location foreground service.
- Correction:
  - Explicit End, host stop-navigation, and final arrival still stop guidance.
  - Session destruction while navigation is active leaves the phone-owned foreground service alive so a new car session can resume through the existing active-service path.
  - Added a policy regression test covering active host disconnect and inactive-session cleanup.
- Focused `:app:testDebugUnitTest --tests com.trailhead.app.car.TrailheadCarSessionPolicyTest` passed with `10/10` tests. Native/config drift passed.
- This is a native Android correction. Android and iOS runtimes advance together to `native-1.0.10-android.2` and `native-1.0.10-ios.2`; it cannot ship through OTA to the `.1` binaries.
- Exact next action: commit and push only the reconnect policy, regression test, paired runtime/config updates, and this checkpoint. Build paired `.2` previews from that immutable SHA, install Android first, and rerun only Start Route -> host drop -> reconnect -> active guidance plus explicit End teardown. Do not repeat Map, Search, Layers, NPS, Originals, Offline, memory, or broad Android crawls.
- Open P0/P1: reconnect P1 is corrected in source and unit-tested but remains open until the `.2` Android preview passes the physical DHU assertion.
- Task-owned background processes: DHU PID `24684` and its persistent command host PID `26240` remain intentionally active for the current device session. Gradle, Metro, Maestro, EAS, Expo, publisher, and memory-gate processes have exited.

## Android Auto live DHU closeout - reconnect and End accepted

- Timestamp: `2026-07-25T00:20:32-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact paired-preview source and current HEAD `bced38493f3389d1f75895ad99fe8fe4c0f9f0b8`, pushed to origin.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, and unrelated Valhalla/Maestro mode-only changes remain excluded and unstaged.
- The paired `.2` preview proved the host-disconnect correction:
  - Android build `60`, build ID `ac5b8d0e-1a6d-4f70-8c3a-192fe97e3190`, runtime `native-1.0.10-android.2`.
  - iOS build `55`, build ID `28e32006-ca43-438d-862b-163b20207e26`, runtime `native-1.0.10-ios.2`.
  - Start Route, official `AUTO_DRIVE`, foreground service, host drop, and reconnect all passed. The phone-owned navigation service stayed active and reconnect returned directly to active guidance.
- One final deterministic P1 appeared after reconnect: explicit End stopped the phone-owned location service and navigation notification, but the DHU continued to render the old guidance template.
- Evidence-backed cause: on reconnect, active guidance is the root `Screen`. AndroidX `ScreenManager.popToRoot()` cannot remove the root screen, so the old guidance root remained after the session state ended.
- Correction:
  - End, host `onStopNavigation`, final arrival, phone-ended Original, and phone-closed route all use one `endGuidanceAndReturnHome` path.
  - The controller ends guidance, pops ordinary child screens, and replaces a remaining guidance/arrival root with the real Trailhead route-preview home.
  - Normal home -> guidance stacks still return to the existing home; no duplicate home screen is added.
  - Host disconnect while navigating still preserves the phone-owned service for reconnect.
- Focused car tests passed:
  - `TrailheadCarSessionPolicyTest`
  - `TrailheadCarTemplateTest`
  - `BUILD SUCCESSFUL`; native/config drift passed.
- Final paired `.3` previews were created from the identical immutable SHA:
  - Android build `61`, build ID `093c2d9f-bcf8-49f3-9d91-5c821177c238`, runtime `native-1.0.10-android.3`, artifact SHA-256 `ce75cd3fc39264676873ffd7e24bd12f736f13290746bfa9394867839ac06e93`.
  - iOS build `56`, build ID `9c95c429-d9e9-464c-9823-2f16d610edb2`, runtime `native-1.0.10-ios.3`, artifact SHA-256 `e32e515b524cd14a877bb491fb59ef4edf0f5567ee97ccaae3538195e911c4d9`.
- Physical Samsung `RFCR408DA9B` accepted Android build `61`:
  - Route-ready home rendered the saved Flagstaff-to-Moab route.
  - Start Route opened active off-route guidance with route map, ETA, Report, map controls, and compass.
  - Dropping only DHU left `TrailheadCarLocationService` active as foreground notification `4071`.
  - Reconnecting DHU returned directly to active guidance.
  - Explicit End visibly returned to the Flagstaff-to-Moab route-ready screen.
  - Post-End `TrailheadCarLocationService` was absent and no active `trailhead_navigation` notification remained.
- Android Auto P0/P1: none open. The no-vehicle DHU session is accepted as the live Car App Library route/reconnect/End proof.
- Exact next action: disconnect Android, connect and unlock the registered iPhone, install iOS build `56`, and run only identity plus the remaining platform-native interruption checks. Then run `audit:prepreview` exactly once on the frozen SHA before creating paired production binaries.
- Do not repeat: Android Auto DHU, Map/Search/Yellowstone, Layers, NPS/Explore, Plan/Downloads, Originals acquisition/GPX/background trigger, route mini-map, Route Editor/Trip Overview, Profile, Memory Gate V3, or broad Android/iOS crawls.
- Task-owned background processes after cleanup: none. The ADB forward and temporary `trailhead-preview-bced384` worktree were removed before this checkpoint commit.

## Frozen-candidate iOS closeout - background playback and completed-tour teardown accepted

- Timestamp: `2026-07-25T01:57:15-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact paired-preview source and pre-checkpoint HEAD `9f030b33db44e29a0693a7ad634b494e2111e36f`, pushed to origin.
- Protected Explore index SHA-256 remains `7E59E5E2273DBBE1A26D7BBD4D947FAA20935C51FB79C464EED8A17BABF4D8F4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, and unrelated Valhalla/Maestro changes remain excluded and unstaged.
- The physical iPhone retained version `1.0.10`, build `56`, and runtime `native-1.0.10-ios.3`. It accepted the exact `4696f085c2116ffdaed1aa30e7ecd1c9aa4f35c9` preview before the final correction:
  - iOS update `019f97ec-b765-72fd-a633-c3c5c7bfe49b`.
  - Identity screenshot: `C:\Users\User\AppData\Local\Temp\trailhead-ios56-4696f08-qa-identity.png`, SHA-256 `15DD848286E870F29341284E1184B991D9F66607043DFC27B46207D7F6767ED3`.
- The real consumer Original passed the remaining platform-native playback assertions:
  - A version-pinned continuous GPX replay triggered Story 11 while the phone was locked and Low Power Mode was enabled.
  - Lock Screen metadata showed the exact title `Grand View: Water, Gravity, Time`, artist `Trailhead Originals`, and the real Moab artwork.
  - Lock Screen Pause persisted the exact position. Lock Screen Play resumed from that position and rearmed location delivery.
  - Metadata evidence: `C:\Users\User\AppData\Local\Temp\trailhead-ios56-story11-4696f08-awake-lockscreen.png`, SHA-256 `059898A7C94E8156BDD05234227665AEC8B1C9B37FE2E70A9514E62C5F57ECB4`.
  - Paused session evidence: `C:\Users\User\AppData\Local\Temp\trailhead-ios56-session-story11-4696f08-paused.json`, SHA-256 `10F0797ECBA06C13EFADA89769C91B5EE5E5A7FCE8106F14FEB3A8483676668A`.
  - Resumed session evidence: `C:\Users\User\AppData\Local\Temp\trailhead-ios56-session-story11-4696f08-resumed.json`, SHA-256 `C1B7CB6081896C70373334E04F45F2A3CDC9D83B80CEBDCF4C557A335419E1AB`.
- That run exposed one deterministic P1: a tour completed by the background runtime could leave the foreground provider showing stale active/off-route state, and a manual replay from that stale state could return to `active` after playback finished.
- The correction at `9f030b3` adds identity- and revision-guarded AppState reconciliation for newer background session writes. Terminal completion normalizes to `completed`; completed-tour manual replay returns to `completed`; an explicit stopped session remains a restore barrier.
- Focused Originals store and runtime-race tests, TypeScript, and whitespace checks passed.
- One paired preview OTA was published from exact clean `9f030b3` with Sentry source maps:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-9f030b33db44e29a0693a7ad634b494e2111e36f-ms0073py-89e40e41b83b8c464befac4b`, branch ID `019f9808-7de2-784f-b56d-9e92e2d1da3b`.
  - Android group `75ed8371-99a4-4432-b761-5d10b32ba696`, update `019f9808-a175-758c-9596-07a834810940`, runtime `native-1.0.10-android.3`.
  - iOS group `18819762-4969-45d1-8cef-10c8fc25470a`, update `019f9808-a175-7de6-8457-3196c94ec7bb`, runtime `native-1.0.10-ios.3`.
  - Publisher log: `C:\Users\User\AppData\Local\Temp\trailhead-preview-9f030b3-ota-retry.log`, SHA-256 `BC6D03B5537E80CDB31B4E30285734868E757600574C88E1E57F677423FEAD7E`.
- Physical completion and teardown passed on `9f030b3`:
  - Reopening displayed the truthful Drive Complete recap with `5` heard, `6` missed, and `0` skipped.
  - Recap screenshot: `C:\Users\User\AppData\Local\Temp\trailhead-ios56-9f030b3-completion-recap.png`, SHA-256 `14401D5DDA7931B27B84EC286DAC0A58B7AD6E0A0A4DB1E7EF471220FACB3844`.
  - Completed session: `C:\Users\User\AppData\Local\Temp\trailhead-ios56-session-9f030b3-completion-recap.json`, SHA-256 `3CF82104229922A6EF54D4FECCDA37CCABD410D2EA954EB645AA81EB3D70BF97`.
  - `Close recap` fully stopped the tour. After force-close and reopen, the app returned to Explore; opening Map showed the ordinary map with no Original player or automatic restart.
  - Post-close Map screenshot: `C:\Users\User\AppData\Local\Temp\trailhead-ios56-9f030b3-after-close-map.png`, SHA-256 `F1541C6C16CDF4BC7E9DBF725F25A84D5DD796B367678464FB2322A1B6E5039F`.
  - Stopped session: `C:\Users\User\AppData\Local\Temp\trailhead-ios56-session-9f030b3-after-close.json`, SHA-256 `4C003A31924DD26536894BC21D416AA60CA7C145D27CAC861225053B2A4A3E16`.
- Durable resume remains intentional for an unfinished tour when the app is closed without End Tour. Explicit End Tour or Close recap clears automatic resume while retaining the verified download and completed-story history.
- Simulated location was cleared. Task-owned publisher, GPX, Metro, Expo, EAS, Gradle, Maestro, memory-gate, and test processes: none.
- P0/P1 from this iOS packet: none open.
- Remaining release evidence, if physically available: one call/system-audio interruption and Bluetooth disconnect/reconnect. Universal Link and manual referral fallback may be verified without erasing the current account. Unavailable external hardware is checkpointed rather than retried in a loop.
- Exact next action: commit and push this checkpoint, remove the clean temporary preview worktree, then decide the final focused link/interruption evidence boundary before running `audit:prepreview` exactly once on the frozen source.
- Do not repeat: GPX route replay, Lock Screen metadata, Pause/Play rearm, completion/Close recap teardown, Android Auto, Yellowstone, Search performance, Memory Gate V3, broad Map/Search/sheets, Layers, NPS, Plan/Downloads, Route Editor/Trip Overview, Profile, or completed Figma/Mobbin work.

## Frozen-candidate link and Original-sharing closeout

- Timestamp: `2026-07-25T02:54:09-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact paired-preview source and pre-checkpoint HEAD `2341076b6dc15d96a443947974f2e1be34b19bda`, pushed to origin.
- Protected Explore index SHA-256 remains `7E59E5E2273DBBE1A26D7BBD4D947FAA20935C51FB79C464EED8A17BABF4D8F4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, and unrelated Valhalla/Maestro changes remain excluded and unstaged.
- Android verified links passed after `pm verify-app-links --re-verify com.trailhead.app`: `api.gettrailhead.app`, `gettrailhead.app`, `go.gettrailhead.app`, `zswub.app.link`, and `zswub-alternate.app.link` all report `verified`.
- `go.gettrailhead.app` now presents a valid certificate for its hostname and responds over HTTPS. The canonical referral fallback correctly rejects the nonexistent `QA-LINK-ONLY` code instead of crediting or mutating an account. Real-code fresh-install attribution remains separately gated; the privacy opt-out and manual-code fallback remain available.
- A physical Android cold link to `https://gettrailhead.app/originals/moab-canyons-to-the-sky` exposed one deterministic P1: the Original route preview could mount RNMapbox before the cold path had installed the cached/server Mapbox access token, producing `MapboxConfigurationException` and a blank screen.
- The correction at `1744e3326d3062da94ec6cb9cb3e09d11139e635` prepares the Mapbox token before mounting `OriginalRouteMap`, keeps the route preview on the existing native Mapbox renderer, and provides a stable loading/fallback state. Originals renderer, app-link, referral, TypeScript, and whitespace checks passed.
- The corrected physical cold link opens the actual Moab detail with the Mapbox Outdoors route preview and no fatal exception. Evidence: `C:\Users\User\AppData\Local\Temp\trailhead-android-links-2026-07-25\original-link-open-15s-fixed.png`, SHA-256 `41F58A371AD56E26F7E5E4A544932BD60DFDFF28312EDA34AC390D801A7A9D13`.
- The user then identified a P2 copy/function defect: the Original Share control showed a generic placeholder alert. The correction at `2341076b6dc15d96a443947974f2e1be34b19bda` now opens the native share sheet with the published title, actual summary, and canonical Original landing URL. A deterministic content test is part of `test:originals-renderer`.
- Physical Android sharing passed. The share sheet contains `Moab: Canyons to the Sky`, the real scenic-drive summary, and `https://gettrailhead.app/originals/moab-canyons-to-the-sky`.
  - Screenshot: `C:\Users\User\AppData\Local\Temp\trailhead-android-share-2026-07-25\share-sheet.png`, SHA-256 `E2D2E2573D8D621D44EE9F0FDF743329A08ED9010AB0B60F8DD9E54A2B1EBA2A`.
  - UI hierarchy: `C:\Users\User\AppData\Local\Temp\trailhead-android-share-2026-07-25\share-sheet.xml`, SHA-256 `470A6E2318FFE1AA740C31E596F53B7DE35D5ABEE4976435C42AC43644BEA6D2`.
- Final paired preview OTA for this source was published with Sentry source maps:
  - Channel `preview`, channel ID `019dbc97-3cde-795b-a35d-e6aa985060d3`.
  - Candidate branch `preview-candidate-2341076b6dc15d96a443947974f2e1be34b19bda-ms02ex0b-7e1843164d784e42ee1811b4`.
  - Android group `26c99f19-a978-4a92-bff5-f1c8b5fe13b9`, update `019f9841-9343-7953-bcb3-88a310462831`, runtime `native-1.0.10-android.3`.
  - iOS group `15bbd7be-decc-4f98-88d0-e44c6b08017a`, update `019f9841-9343-7e57-b35e-eb205cbedf91`, runtime `native-1.0.10-ios.3`.
  - Publisher stdout: `C:\Users\User\AppData\Local\Temp\trailhead-preview-2341076-ota.out.log`, SHA-256 `E42B591C402DC833813EA03F153BC1D9D8F94EF29C53709706DBC62C1468B0F3`.
  - Publisher stderr: `C:\Users\User\AppData\Local\Temp\trailhead-preview-2341076-ota.err.log`, SHA-256 `32089852BE8568DDBC2751B82D6448587817250D6BCB2284C018656C501B018E`.
- Physical Samsung build `61`, runtime `native-1.0.10-android.3`, downloaded and restarted onto Android update `019f9841-9343-7953-bcb3-88a310462831`; the next launch reported no newer update.
- iOS call/system interruption and Bluetooth disconnect/reconnect remain unclaimed external physical evidence. The completed iOS locked/Low Power/Now Playing/GPX/teardown packet is not repeated. AASA configuration is hosted; Android App Links cannot substitute for a physical iOS Universal Link assertion.
- Open app-code P0/P1: none. Deferred Branch fresh-install attribution and the two unavailable iOS interruption exercises are release evidence boundaries, not newly reproduced app defects.
- Exact next action: commit and push this checkpoint, freeze the resulting SHA, and run `audit:prepreview` exactly once from a clean detached worktree. If it passes, create paired Android and iOS 1.0.10 production binaries from that same SHA. Publish production OTA only after compatible paired binaries exist; evaluate any iOS 1.0.9 stability/search OTA as a separate runtime-compatible backport.
- Do not repeat: Android App Links, Original cold-link repair, Original share sheet, Android Auto, Yellowstone, Search performance, Memory Gate V3, Plan/Downloads/Originals lifecycle, GPX playback, broad Map/Search/sheets, Layers, NPS, Route Editor/Trip Overview, Profile, or completed Figma/Mobbin work.
- Task-owned background processes: none. OTA publisher, Metro export, Sentry upload, Expo/EAS, Gradle, Maestro, memory-gate, and test processes have exited. Temporary `1744e33` and `2341076` preview worktrees were removed.

## Final release-gate closeout - clean-worktree setup repaired

- Timestamp: `2026-07-25T03:13:26-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; exact gate source and pre-checkpoint HEAD `89b6031f81f880f0182f1abef5e787420fe9a498`, pushed to origin.
- Protected Explore index SHA-256 remains `7E59E5E2273DBBE1A26D7BBD4D947FAA20935C51FB79C464EED8A17BABF4D8F4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- `audit:prepreview` was run exactly once from a clean detached worktree at `89b6031`.
- All application assertions passed. Four assertions failed only because the clean worktree did not inherit local machine setup:
  - Android Auto debug unit tests could not locate the Android SDK because the worktree had no `local.properties`.
  - Explore live audit, Viator audit, and full backend regression opened a temporary SQLite file without initializing its schema.
- The release harness now:
  - Discovers the Android SDK from environment and standard host/WSL locations, then exports both `ANDROID_HOME` and `ANDROID_SDK_ROOT`.
  - Creates an isolated temporary backend database, initializes it through `db.store.init_db()`, and supplies it only to the database-backed audit checks.
  - Removes the isolated database directory after the gate.
  - Includes native-drift assertions that prevent either clean-worktree requirement from being lost.
- Only the four failed assertions were rerun after the harness correction:
  - Android `:app:testDebugUnitTest`: `BUILD SUCCESSFUL` with 999 tasks.
  - Explore live audit: passed with 5,338 catalog records, 144 index records, and 120 bulk details.
  - Viator audit: passed disabled-safe behavior plus Yosemite and Moab fixture cards/details.
  - Backend regression: 785 tests passed in 230.712 seconds.
- Full-gate stdout: `C:\Users\User\AppData\Local\Temp\trailhead-final-gate-89b6031.out.log`, SHA-256 `923627F0E5F0033D31BB7856F6EA1C00DD8AC22944F6E1DA61BB098D5269AE0C`.
- Full-gate stderr: `C:\Users\User\AppData\Local\Temp\trailhead-final-gate-89b6031.err.log`, SHA-256 `183EF0F7290B48FDF0DC9AE35AB37E9F966DDCEA809744F83F96DE67FFABCF12`.
- Focused correction stdout: `C:\Users\User\AppData\Local\Temp\trailhead-final-gate-focused-fix.out.log`, SHA-256 `99925EDA1E19658CF918E77D7FAAC2D597895D270DAC4A746BBA2FF0167C4477`.
- Focused correction stderr: `C:\Users\User\AppData\Local\Temp\trailhead-final-gate-focused-fix.err.log`, SHA-256 `A3A66CCC7D503BA8B3C5FCA257281CD557E6D17940BF4613658424F13C799852`.
- Open app-code P0/P1: none. iOS call/system-audio interruption and Bluetooth disconnect/reconnect remain explicitly unclaimed physical evidence; the completed iOS locked-screen, Low Power Mode, Now Playing, GPX, completion, and teardown packet remains accepted.
- Exact next action: commit and push the release-harness correction and this checkpoint, tag the resulting clean SHA, and create paired Android/iOS 1.0.10 production candidates from that same immutable source.
- Do not repeat: the full pre-preview gate, its four focused assertions, Android App Links, Original cold-link/share checks, Android Auto, GPX playback, Memory Gate V3, Yellowstone/Search, Layers, NPS, Plan/Downloads, Route Editor/Trip Overview, Profile, or completed Figma/Mobbin work.
- Task-owned background processes: none. Gradle daemons, temporary databases, detached gate worktree, publishers, Metro, EAS, Maestro, and test processes were stopped or removed.

## Paired 1.0.10 production build and compatible OTA promotion

- Timestamp: `2026-07-25T04:06:24-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; immutable production source `f90c150d8801d0d2ba73cc6a52277ca9ef5978eb`, pushed to origin.
- Production source tags `v1.0.10-rc1` and `v1.0.10` both resolve to `f90c150d8801d0d2ba73cc6a52277ca9ef5978eb`; `v1.0.10` is pushed.
- Protected Explore index SHA-256 remains `7E59E5E2273DBBE1A26D7BBD4D947FAA20935C51FB79C464EED8A17BABF4D8F4`. `.cursor/` and `dashboard/explore_serving_index_v2.json` remain excluded and unstaged.
- The first paired EAS attempt failed after dependency installation because the EAS production environment did not include the already-configured Branch and Sentry variable names:
  - Android build `62`, ID `e5276969-dc95-4926-92b9-265107c8558e`.
  - iOS build `57`, ID `a71ef58c-4845-4ede-a0e9-3caeb7c398af`.
  - Existing values for `BRANCH_API_KEY`, `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` were extended from preview to production. No secret value was printed or changed.
- The corrected paired production builds finished from the identical immutable SHA:
  - Android build `63`, ID `7ab0f1bb-a742-4043-8a97-4d8986485e12`, runtime `native-1.0.10-android.3`, fingerprint `60af3c45848a22f1ce3173738969ed10746bcff1`.
  - Android AAB: `C:\Users\User\Downloads\Trailhead-1.0.10-Android-build63.aab`, 161,739,412 bytes, SHA-256 `509A771B59B3E20B005184F5E518684C43699466A6D9748B26E78DDED27BFD0C`.
  - Official bundletool `1.18.3` validation exited `0`.
  - iOS build `58`, ID `464207e7-dfdf-47ab-bd36-6b32e97aa362`, runtime `native-1.0.10-ios.3`, fingerprint `5aa15fca809fa2a731b6a7c40f26912d4794de48`.
  - iOS IPA: `C:\Users\User\Downloads\Trailhead-1.0.10-iOS-build58.ipa`, 70,159,516 bytes, SHA-256 `41BC4524BABBC7F33BC436B66ACF470C4EB247F9893E17247765F727424FFD08`.
  - The IPA reports bundle `com.trailhead.app`, marketing version `1.0.10`, build `58`, and background modes `location`, `audio`, and `fetch`. Sentry's debug-symbol build phase ran.
  - The paired-build evidence check verified both build IDs, build numbers, runtime versions, fingerprints, and exact commit.
- Sentry source-map upload completed for the production export:
  - Android bundle debug ID `8ef9671f-5e21-44c5-9e24-f80dda7c05a1`.
  - iOS bundle debug ID `2182a483-1276-4f09-aa7e-e3a4c5814a44`.
- A production OTA was published to an isolated candidate branch from exact `f90c150`:
  - Branch `production-candidate-f90c150d-legacy-20260725035506`, ID `019f9881-6155-7eb7-ac71-26927a0674e2`.
  - Android group `5b65d023-482b-41fe-a142-5a496ec99bda`, update `019f9881-8483-7a60-b226-310c26296705`, runtime `native-1.0.10-android.3`.
  - iOS group `f9963578-597a-4643-aa57-6b919b1382f0`, update `019f9881-8483-7974-8faa-4cc0b01706db`, runtime `native-1.0.10-ios.3`.
- Before promotion, the candidate branch was populated with the latest compatible production group for every legacy runtime:
  - `native-1.0.9-car2-originals1` Android.
  - `native-1.0.9-originals1` iOS.
  - `native-1.0.8-car2-originals1` Android.
  - `native-1.0.8-originals1` iOS.
  - `native-1.0.7` Android and iOS.
  - `native-202607-mission-animator-1` Android and iOS.
  - `native-20260614-sdk54-1` Android and iOS.
- Candidate verification found nine current runtime groups and twelve platform updates. The new 1.0.10 groups report exact source `f90c150`; republished legacy records retain their prior manifests, runtimes, and platform compatibility.
- The production channel `019dc26b-268a-794b-8aa8-3497b4d38487` now points to the verified candidate branch. Existing 1.0.9 and older installs therefore retain their compatible production update instead of being stranded.
- The 1.0.9 runtime predates Search V2 and did not receive incompatible 1.0.10 Search code. Its existing compatible Originals artwork and End Tour stability update remains available.
- OTA evidence:
  - Pre-promotion candidate listing: `\\wsl.localhost\Ubuntu\tmp\trailhead-production-candidate-updates.json`, SHA-256 `97777FD44507E953CB08CD48CF64623F49556B072941D41DE865B7BDE665B972`.
  - Post-promotion candidate listing: `\\wsl.localhost\Ubuntu\tmp\trailhead-production-after-updates.json`, SHA-256 `83EFBA1DB1C38219EB3B63D161C66F56517114D2339128F13016C9709F1F094A`.
  - Production-channel proof: `\\wsl.localhost\Ubuntu\tmp\trailhead-production-channel-after.json`, SHA-256 `9D7A53B58BACCCFF223EDE60317A37AC37943EF3DD4E163522D88126E40FF63E`.
- The live backend required no new deployment for this final mobile-only packet. `https://api.gettrailhead.app/api/health` returned HTTP `200` with service status `ok`; the previously deployed additive compatibility remains active.
- iOS build `58` was scheduled for App Store Connect upload through EAS submission `fb1eddea-1232-48e9-9ad5-120120d945e5`. EAS accepted the request using the configured App Store Connect API key. App Store processing/review remains external and is not claimed complete.
- Android build `63` is intentionally handed off as a validated AAB for the user's manual Play Console upload and Google background-location/media evidence. Google upload/review is not claimed complete.
- Open app-code P0/P1: none.
- Remaining release evidence boundaries:
  - iOS call/system-audio interruption and Bluetooth disconnect/reconnect remain explicitly unclaimed; the accepted locked-screen, Low Power, Now Playing, GPX, completion, and teardown evidence is not repeated.
  - Google Play still requires the real-candidate background-location/media evidence and the user's manual AAB upload.
  - Deferred Branch fresh-install attribution remains disabled until its separate exactly-once/privacy gate passes.
- Production OTA is live only for runtime-compatible binaries. Public Originals-stage changes, advertising, CarPlay claims, and replacement store screenshots remain separate approvals.
- Exact next action: wait for App Store Connect processing, upload the validated Android AAB with the Google policy video/declaration, install-test the resulting store candidates, and coordinate review/release timing.
- Do not repeat: full pre-preview, Android Auto DHU, iOS GPX/lock-screen playback, Android App Links, Original cold link/share, Yellowstone/Search, Memory Gate V3, Layers, NPS, Plan/Downloads, broad app crawls, or completed Figma/Mobbin work.
- Task-owned background processes at checkpoint: none after the temporary clean release worktree is removed.

## Forward packet baseline - opt-in campground planning brief

- Timestamp: `2026-07-26T01:27:32-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; pre-change HEAD `05acb975a10b25b2c31ec205e57492a0a97ca488`.
- Existing paired 1.0.10 preview identity before this packet:
  - Android update `019f9cff-bcbb-77d1-9799-dd087c299934`, runtime `native-1.0.10-android.3`.
  - iOS update `019f9cff-bcbb-7e0a-86a9-e01c12974118`, runtime `native-1.0.10-ios.3`.
- Protected Explore index SHA-256 is `7E59E5E2273DBBE1A26D7BBD4D947FAA20935C51FB79C464EED8A17BABF4D8F4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Android helper mode changes, Valhalla scripts, and unrelated worktree changes remain excluded and unstaged.
- Scope is one forward-only packet:
  - Keep the normal campground sheet and all existing facts/modules unchanged.
  - Replace the automatically rendered duplicative factual brief with one explicit `Show brief` action.
  - Charge exactly 5 credits once per campground, or include access with Explorer.
  - Research the planning brief server-side through the existing Railway OpenAI configuration, using web search and strict structured output.
  - Validate citations server-side, omit unsupported claims, and expose no provider/model or public AI label.
  - Preserve the legacy campsite-insight endpoint for older clients.
- Narrow verification completed before committing:
  - Campground planning-brief, factual-brief, and legacy insight backend tests: `23/23`.
  - Mobile campground contract, sheet-flow, and identity tests: `17/17`.
  - TypeScript, user-facing copy, telemetry/privacy, native/config drift, and whitespace checks passed.
- Exact next action: commit this baseline checkpoint separately, then commit only the named backend/mobile packet files, deploy backend compatibility, publish one paired preview OTA, and run the single Android developed/dispersed campground delta.
- Do not repeat: Memory Gate, broad Map/Search/sheets crawls, Layers, Yellowstone, NPS research, Android Auto, Originals lifecycle, final 1.0.10 release gate, or store screenshot work.
- Open P0/P1: none in source-level focused tests. Live Railway generation and Android presentation remain unverified until the packet preview is deployed.
- Task-owned background processes: none.

## Camp Guide brief completion - layered, grounded planning copy

- Timestamp: `2026-07-26T02:46:16-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; completion HEAD `3ebb84c66059a97eaa51df358a2e7625d6ceed37`, pushed to origin.
- Protected Explore index SHA-256 remains `7E59E5E2273DBBE1A26D7BBD4D947FAA20935C51FB79C464EED8A17BABF4D8F4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Android helper mode changes, Valhalla scripts, and all unrelated worktree changes remain excluded and unstaged.
- The paired mobile preview carrying the opt-in Camp Guide UI remains:
  - Android update `019f9d3a-39f2-7fc2-adc9-ddb54f0b0c9d`, group `3c70d0e0-4f90-4832-ad66-2fbb58e08990`, runtime `native-1.0.10-android.3`.
  - iOS update `019f9d3a-39f2-7733-ba1a-86d2227ed627`, group `2f15d441-fb8b-4c71-8647-17d5d74f9319`, runtime `native-1.0.10-ios.3`.
  - Candidate branch `preview-candidate-b9d4274d554ba43cb52e1da1bb866dd2d144c2ef-ms1g1qje-406f4b9ac1ced1c236033a98`; Sentry source maps were uploaded.
- The ordinary campground sheet remains authoritative and unchanged. `Show brief` is opt-in, costs `5 credits`, is included with Explorer, and retains a permanent user/camp unlock. The brief does not duplicate booking, phone, prices, site counts, amenities, photos, comments, ratings, edits, field reports, weather, or other normal sheet modules.
- The first live Railway request reproduced a `499` after approximately 125 seconds. The evidence-backed correction moved generation into a durable server-side job so closing or timing out a mobile request cannot cancel the work.
- Model evaluation stopped after one bounded comparison:
  - GPT-5.4 nano with reasoning `none` was fast but produced brittle, compressed copy and invalid structured output at the lower output cap.
  - GPT-5.4 mini with reasoning `none`, low web-search context, strict structured output, and a 2,200-token cap completed the live comparisons in approximately 7-10 seconds server-side and produced the stronger field-guide result.
- Final prompt and server policy require distinct roles for Summary, Best Time, Access and Rig, Service and Signal, What to Look Out For, Before You Go, and Nearby. They prohibit model/process/evidence language, generic checklists, off-site app/download instructions, inline domains, provider wording, unsupported assurance, and duplication of ordinary campground facts.
- Server sanitization strips Markdown/inline links, applies sentence-aware truncation, and scopes FCC/mobile evidence to Service and Signal. The source-policy revision `2026-07-26-grounding-3` invalidates older cached copy.
- Final backend deployment:
  - Railway deployment `af9c808c-93ef-4d50-8cd6-19582c8e6d23`.
  - Status `SUCCESS`.
  - Image digest `sha256:4931382560b67cf09d4e05a727839ca5aa33be896bd5afec5078cefaa40fa415`.
  - This was backend-only and required no replacement mobile OTA.
- Final focused verification:
  - `python -m unittest tests.test_campground_planning_briefs tests.test_campground_briefs tests.test_campsite_insight_integrity`: `10/10` passed. The suite includes one deliberate mocked generation failure that verifies refund behavior.
  - `git diff --check`: passed.
  - Earlier mobile campground contracts, sheet identity, TypeScript, copy/privacy, telemetry, and native-drift gates remained passed; they were not repeated after backend-only prompt/sanitizer changes.
- Android build 61 live proof used a source-backed developed campground:
  - The full campground sheet retained photos, weather, comments, ratings, reports, booking, and its normal modules.
  - `Show brief` displayed `5 credits · Included with Explorer`, transitioned through Preparing, and settled in approximately 15 seconds.
  - The final brief included a concise campground orientation, seasonal context, road/rig specifics, an evidence-backed no-service warning, bear/fire considerations, one actionable preparation note, and relevant nearby trailhead/dump-station context.
  - No model, AI, database, evidence-process, provider, inline-domain, or off-site download-app wording appeared.
- Evidence:
  - `C:\Users\User\AppData\Local\Temp\trailhead-camp-brief-qa-b9d4274.xml`, SHA-256 `92E921CEE452330CC3E5892C02901A05E10D78A1050212C46FA115E3BA6AF0BA`.
  - `C:\Users\User\AppData\Local\Temp\trailhead-camp-show-brief-b9.png`, SHA-256 `515F0156A44D5028A7ABD2AD47BCF3F79A3E6B120A2575CE82735CF72AC00C32`.
  - `C:\Users\User\AppData\Local\Temp\trailhead-camp-brief-preparing-b9.png`, SHA-256 `304DC61C6B4F6B3A25BE6AEAF2CAC9F3D784689CDDEFCBC69A1EB915B797B0D2`.
  - `C:\Users\User\AppData\Local\Temp\trailhead-indian-brief-ready.png`, SHA-256 `64223CBC572A4F906D6BD8AB2EF94E7B11B3898884F7F161A316EBA20494893F`.
  - `C:\Users\User\AppData\Local\Temp\trailhead-indian-brief-mid.png`, SHA-256 `7D697D2B800A861537B66C44AF97648BF0E62B6303E09A780D384990587FB298`.
  - `C:\Users\User\AppData\Local\Temp\trailhead-indian-brief-sections.png`, SHA-256 `D294C95AA9B2F82C5D0DCC4DC941ADD9DA0FB2F0DA90F5CFAD24ADDAB10EE332`.
- Sparse generic pins without sufficient authoritative sources now return unavailable and refund the charge instead of fabricating a planning brief.
- Open P0/P1 for this packet: none.
- Deferred P2 observation: selecting the same Recreation.gov campground through one Explore search path can open a generic source hub rather than the canonical campground sheet. This belongs to the later Sheet Action/POI and Explore adapter packet and is not reopened here.
- Exact next action: the user reviews the Android Camp Guide result. On acceptance, promote only the exact compatible preview-tested mobile source as appropriate, or begin the next forward-only `Sheet Action and POI Rabbit-Hole Audit` packet.
- Do not repeat: model comparison, Camp Guide live generation, campground lifecycle, Memory Gate, broad Map/Search/sheet crawls, Layers, Yellowstone, NPS research, Android Auto, Originals lifecycle, production release validation, or store-screenshot work without new evidence.
- Task-owned background processes: none. Temporary Camp Guide Railway deployment worktrees were removed; managed historical preview/deploy worktrees were left intact.

## Camp Guide production OTA and Sheet/POI packet baseline

- Timestamp: `2026-07-26T02:58:01-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; baseline HEAD `0df4859ebeafe157f4b88a3cfccb9c9eefcbe0ac`.
- Accepted implementation: `3ebb84c66059a97eaa51df358a2e7625d6ceed37`; device-tested mobile baseline: `b9d4274d554ba43cb52e1da1bb866dd2d144c2ef`.
- Protected Explore index SHA-256 remains `7E59E5E2273DBBE1A26D7BBD4D947FAA20935C51FB79C464EED8A17BABF4D8F4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Android helper mode changes, Valhalla files, and unrelated worktree changes remain excluded and unstaged.
- Paired store-build evidence remains:
  - Android build `63`, ID `7ab0f1bb-a742-4043-8a97-4d8986485e12`, runtime `native-1.0.10-android.3`, source `f90c150d8801d0d2ba73cc6a52277ca9ef5978eb`.
  - iOS build `58`, ID `464207e7-dfdf-47ab-bd36-6b32e97aa362`, runtime `native-1.0.10-ios.3`, source `f90c150d8801d0d2ba73cc6a52277ca9ef5978eb`.
- Current production channel `019dc26b-268a-794b-8aa8-3497b4d38487` points to `production-candidate-f90c150d-legacy-20260725035506`. Its complete legacy runtime/platform matrix must be copied into any replacement branch before channel promotion.
- The guarded publisher currently requires OTA source SHA equality with the store-build SHA and does not automate legacy-group carry-forward. This packet will replace equality with an audited ancestor/native-compatibility gate and make legacy-matrix preservation mandatory.
- A read-only EAS comparison against the accepted Android preview source reported expected build/local diagnostic differences in Expo release metadata, package scripts, and the local Android directory representation. Git confirms the Android native tree is unchanged between `f90c150` and `b9d4274`; the new gate must explain each fingerprint difference and reject every other native-impacting change.
- Open P0/P1: none. Production remains unchanged until the compatibility and matrix tests pass.
- Exact next action: implement and test the JS-only native-compatibility gate plus production runtime-matrix carry-forward, then publish and verify the Camp Guide production OTA before beginning Sheet/POI code.
- Do not repeat: Camp Guide generation, broad app crawls, Memory Gate, Layers, Yellowstone, NPS research, Android Auto, Originals lifecycle, or store screenshot work.
- Task-owned background processes: none.

## Camp Guide production OTA promotion - complete

- Timestamp: `2026-07-26T03:34:06-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; immutable OTA source and pre-checkpoint HEAD `29e48a82e7c6bd605bfb31185b830f22b5101c83`, pushed to origin and tagged `v1.0.10-camp-guide-ota3`.
- Accepted Camp Guide implementation remains `3ebb84c66059a97eaa51df358a2e7625d6ceed37`; device-tested mobile baseline remains `b9d4274d554ba43cb52e1da1bb866dd2d144c2ef`.
- Protected Explore index SHA-256 remains `7E59E5E2273DBBE1A26D7BBD4D947FAA20935C51FB79C464EED8A17BABF4D8F4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Android helper mode changes, Valhalla scripts, and unrelated worktree changes remain excluded and unstaged.
- Production-build evidence was verified before publication:
  - Android build `63`, ID `7ab0f1bb-a742-4043-8a97-4d8986485e12`, source `f90c150d8801d0d2ba73cc6a52277ca9ef5978eb`, runtime `native-1.0.10-android.3`, fingerprint `60af3c45848a22f1ce3173738969ed10746bcff1`.
  - iOS build `58`, ID `464207e7-dfdf-47ab-bd36-6b32e97aa362`, source `f90c150d8801d0d2ba73cc6a52277ca9ef5978eb`, runtime `native-1.0.10-ios.3`, fingerprint `5aa15fca809fa2a731b6a7c40f26912d4794de48`.
- The guarded publisher proved the build SHA is an ancestor of the OTA SHA, Android/iOS Git native trees are unchanged, dependency fields are unchanged, and runtime identifiers match the paired builds. `eas fingerprint:compare` recorded only explained Expo-config, package-script, and local native-directory representation differences; no native-impacting source change was accepted.
- Sentry source maps were uploaded before publication:
  - Android debug ID `fb623db8-f8fd-4d13-bd3d-0c05f17140d7`.
  - iOS debug ID `2449bdad-2558-4cb5-8ac8-1cef5963d985`.
- The corrected isolated production candidate is:
  - Branch `production-candidate-29e48a82e7c6bd605bfb31185b830f22b5101c83-ms1j9xwy-80ec0e74ff97c651e4fb571a`, ID `019f9d8d-d8b7-76ea-9a19-6a5e31fdd291`.
  - Android group `d2d60b1d-b281-4372-8bc9-37bb41f0dd66`, update `019f9d8e-01e9-7ced-9aeb-d0e9b0ae40f5`, runtime `native-1.0.10-android.3`.
  - iOS group `6687a196-6a4a-4fc6-805b-28b221fcc378`, update `019f9d8e-01e9-759a-bb14-b5a23a39086b`, runtime `native-1.0.10-ios.3`.
- The first candidate attempt (`v1.0.10-camp-guide-ota2`) was rejected after post-publication evidence showed its legacy snapshot relied on the channel summary and carried only the most recently visible legacy group. Production was immediately restored to rollback branch `production-candidate-f90c150d-legacy-20260725035506`. No compatibility gate was weakened.
- The corrected publisher snapshots the mapped production branch with `update:list --limit 50`, replaces only the paired 1.0.10 runtimes, and republishes every other runtime group. Candidate validation passed with exactly twelve platform keys:
  - `native-1.0.10-android.3` Android and `native-1.0.10-ios.3` iOS.
  - `native-1.0.9-car2-originals1` Android and `native-1.0.9-originals1` iOS.
  - `native-1.0.8-car2-originals1` Android and `native-1.0.8-originals1` iOS.
  - `native-1.0.7` Android and iOS.
  - `native-20260614-sdk54-1` Android and iOS.
  - `native-202607-mission-animator-1` Android and iOS.
- Production channel `019dc26b-268a-794b-8aa8-3497b4d38487` now points atomically to the corrected candidate branch. Independent read-back confirmed nine groups containing the expected twelve platform keys. Existing 1.0.9 and older installs retain their prior compatible runtime groups.
- Evidence:
  - Publisher log: `\\wsl.localhost\Ubuntu\tmp\trailhead-camp-guide-production-ota.log`, SHA-256 `8FC7C8747454E3DE7A089579862855860CE024E5B57700CBFD312652AC256410`.
  - Native compatibility summary: `\\wsl.localhost\Ubuntu\tmp\trailhead-release-evidence-29e48a82\native-ota-compatibility.json`, SHA-256 `40F0ABD6D78C52B40D938276D3D7B911B7A6D87A0AF9F6172074FEB19DA3AF90`.
  - Android fingerprint evidence: `\\wsl.localhost\Ubuntu\tmp\trailhead-release-evidence-29e48a82\native-fingerprint-android.json`, SHA-256 `0AC92BE3D675A14351E67ADF84D7A0357801BE1861687E570820468A3CAE796A`.
  - iOS fingerprint evidence: `\\wsl.localhost\Ubuntu\tmp\trailhead-release-evidence-29e48a82\native-fingerprint-ios.json`, SHA-256 `3033A3B97A084C01C3EE3460DEF94C8F8543B37ED91B3689D5EB781F09F15AF9`.
  - Candidate listing: `\\wsl.localhost\Ubuntu\tmp\trailhead-release-evidence-29e48a82\production-candidate-listing.json`, SHA-256 `320CBABFFF06B290440D20B4F04DBF4BA5F5C73C41EA0591F790A8B9B7BBF372`.
  - Independent production channel read-back: `\\wsl.localhost\Ubuntu\tmp\trailhead-release-evidence-29e48a82\production-channel-readback.json`, SHA-256 `51FBE01EF58326A732E822ABD320F26EEC90C216E706BA5AE4CFEFBEFF4D9776`.
  - Independent production update read-back: `\\wsl.localhost\Ubuntu\tmp\trailhead-release-evidence-29e48a82\production-updates-readback.json`, SHA-256 `FA4350337EA0D0051F3AF276B02823078F4284CFBD5FB82070F3F37B3CE57F80`.
- Railway health returned HTTP `200` with `{"status":"ok","service":"trailhead"}` after channel promotion. The already-deployed Camp Guide backend remains deployment `af9c808c-93ef-4d50-8cd6-19582c8e6d23`, digest `sha256:4931382560b67cf09d4e05a727839ca5aa33be896bd5afec5078cefaa40fa415`.
- Open P0/P1: none. Apple review/build replacement was not restarted, and no new native binary was created.
- Exact next action: commit and push this checkpoint, remove the three temporary production worktrees after evidence capture, then create the Sheet Action/POI baseline and implement only the capability registry plus canonical Recreation.gov campground routing before focused tests and one paired preview.
- Do not repeat: Camp Guide generation/model comparison, Memory Gate, Layers, Yellowstone, NPS research, Android Auto, Originals lifecycle, broad Map/sheet crawls, final production-build validation, or store screenshot work.
- Task-owned background processes: the corrected publisher has exited successfully. No Metro, EAS publisher, Sentry upload, Gradle, Maestro, or test process remains.

## Sheet Action and POI packet - pre-change baseline

- Timestamp: `2026-07-26T03:36:00-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; pre-change HEAD `034723af11f065f2c03c2fc4b72609af539294fe`, pushed to origin.
- Protected Explore index SHA-256 remains `7E59E5E2273DBBE1A26D7BBD4D947FAA20935C51FB79C464EED8A17BABF4D8F4`.
- Protected and unrelated worktree changes remain excluded and unstaged:
  - `.cursor/`
  - `dashboard/explore_serving_index_v2.json`
  - `docs/app-store-copy.md`
  - Android helper mode changes
  - Valhalla artifact, probe, publication, and NPS-enrichment scripts
- Production channel `019dc26b-268a-794b-8aa8-3497b4d38487` points to the verified Camp Guide candidate from `29e48a82`; rollback branch remains `production-candidate-f90c150d-legacy-20260725035506`.
- Existing paired preview identity before this packet remains:
  - Android update `019f9d3a-39f2-7fc2-adc9-ddb54f0b0c9d`, group `3c70d0e0-4f90-4832-ad66-2fbb58e08990`, runtime `native-1.0.10-android.3`.
  - iOS update `019f9d3a-39f2-7733-ba1-86d2227ed627`, group `2f15d441-fb8b-4c71-8647-17d5d74f9319`, runtime `native-1.0.10-ios.3`.
- Exact bounded implementation scope:
  - Add the internal `SheetActionDescriptorV1` capability registry and stable action identifiers without materially changing approved sheet layouts.
  - Apply it incrementally to campground, trail, trailhead, fuel/service, generic POI, NPS child, and community-report actions.
  - Route canonical Recreation.gov/RIDB campground Search results, including Explore Search, to the existing main-Map campground sheet.
  - Preserve camera, filters, selected identity, return context, campground modules, NPS modules, Viator, comments, ratings, reports, edits, Offline, booking, and current sheet hydration behavior.
  - Document actual POI ingestion gaps; do not fabricate missing records or modules.
- Exact focused verification scope:
  - Registry visibility/destination/return-state tests.
  - Canonical campground-versus-source-hub routing tests.
  - Existing sheet coordinator, campground, trail/trailhead, community-report, Search V2, Offline preservation, copy/privacy, TypeScript, and whitespace gates.
  - One bounded Android delta across the named safe branches and POI families, stopping before irreversible confirmation.
  - One paired preview OTA and shared high-risk iOS spot checks only.
- Open P0/P1 at baseline: none. The known Recreation.gov Explore-search routing defect is P2 because the same canonical campground remains reachable through the correct Map path.
- Exact next action: commit and push this baseline, then implement only named Sheet/POI files before focused tests.
- Do not repeat: Camp Guide generation, production OTA compatibility work, Memory Gate, Layers, Yellowstone, NPS rabbit-hole research, Android Auto, Originals lifecycle, broad Map/sheet crawls, final 1.0.10 release gate, or store screenshots.
- Task-owned background processes: none.

## Sheet Action and POI packet - implementation ready for preview

- Timestamp: `2026-07-26T03:57:37-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; implementation HEAD `4ea6b1ac57cdd2ca5a7066f001a3e43bde4b2133`.
- Protected Explore index SHA-256 remains `7E59E5E2273DBBE1A26D7BBD4D947FAA20935C51FB79C464EED8A17BABF4D8F4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, and `docs/app-store-copy.md` remain excluded and unstaged.
- Added internal `SheetActionDescriptorV1` coverage for campground, trail, trailhead, fuel/service, generic place, NPS child, and community-report sheets. Each descriptor carries a stable action ID, capability requirement, availability, destination, safe/mutating classification, return context, and expected sheet/map state.
- Existing sheet layouts and feature modules remain intact. Stable action IDs now cover navigation, Save/remove, Add to trip, offline download, 3D preview, official/booking/phone/share, ratings, comments, reports, edits, voting, and private field-review actions.
- Campground Download now reuses the existing selected-area/offline workflow; no second download store or new claim was added.
- Canonical Recreation.gov/RIDB campground Search V2 results, including results whose broad kind is `place`, now open the existing main-Map campground sheet. Temporary provider rows remain clearly temporary and retain the generic source-result flow.
- Selection generation and return context remain controlled by the existing `SheetCoordinator`. The packet does not change sheet hydration, camera ownership, filters, navigation, Offline V1/V2, NPS modules, Viator, ratings, comments, or report backends.
- Focused verification passed:
  - Sheet action/return/coordinator: `8/8`.
  - Search V2 presentation, persistence, canonical campground routing, and client/session behavior: `73/73`.
  - Camp Guide/camp sheet/identity: `18/18`.
  - Trail/trailhead parity: `5/5`.
  - Community-report sheet contract: `5/5`.
  - NPS hub/navigation/scroll preservation: `21/21`.
  - Offline V1/V2 catalog and manager preservation: passed.
  - User-facing copy audit: `165` files passed.
  - Telemetry/privacy, automation selectors, TypeScript, and whitespace: passed.
- Read-only ingestion observation, not a fabricated UI fix: the current protected Explore featured index reports `fuel: 0` and `resupply: 0`. It contains NPS visitor-center and viewpoint content, but the featured index is not the complete Map/Search provider inventory. Fuel, water, groceries, dump stations, repair, parking, visitor centers, and viewpoints remain device-delta assertions; missing inventory will be recorded as an ingestion defect rather than synthesized.
- Existing paired preview before this packet remains:
  - Android update `019f9d3a-39f2-7fc2-adc9-ddb54f0b0c9d`, group `3c70d0e0-4f90-4832-ad66-2fbb58e08990`, runtime `native-1.0.10-android.3`.
  - iOS update `019f9d3a-39f2-7733-ba1a-86d2227ed627`, group `2f15d441-fb8b-4c71-8647-17d5d74f9319`, runtime `native-1.0.10-ios.3`.
- Open P0/P1 before device proof: none.
- Exact next action: commit and push this checkpoint, publish one paired preview OTA from the resulting immutable SHA with Sentry maps, then run only the bounded Android sheet/POI delta and shared high-risk iOS spot checks.
- Do not repeat: Camp Guide generation or production promotion, Memory Gate, Layers, Yellowstone, NPS rabbit-hole research, Android Auto, Originals lifecycle, broad Map/sheet crawls, final production-build validation, or store screenshots.
- Task-owned background processes: none. Focused Node/TypeScript tests have exited; no Metro, Gradle, Maestro, EAS publisher, or Sentry upload remains running.
