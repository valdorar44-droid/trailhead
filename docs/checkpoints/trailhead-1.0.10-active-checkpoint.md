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
