# Trailhead 1.0.10 Active Checkpoint

Last updated: 2026-07-23 08:00:30 CDT (America/Winnipeg)

## Resume protocol

Read this file before resuming the 1.0.10 overhaul after a restart or context compaction. Then:

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Verify `dashboard/explore_serving_index_v2.json` still hashes to `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
3. Keep `.cursor/` and `dashboard/explore_serving_index_v2.json` out of every implementation commit.
4. Continue from **Next exact actions** below. Do not restart the design, NPS research, automated gate, or baseline crawl.

## Source checkpoint

- Branch: `feat/trailhead-1.0.10-overhaul`
- Memory Gate V3 implementation baseline: `d5d73924dc5a969a66ac9eba2b85acca5db0cc19`; current evidence harness/checkpoint HEAD before this documentation-only commit: `65451cf7bab0eed23a1f50c212cb084ff78031f8`.
- Exact source installed on the paired preview remains `83287394ce41f1100bd980c9249f20d364b51db7`; the gate-only commit is an approved harness delta and is not a new OTA.
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

1. Push the intentional implementation commits plus this checkpoint; keep `.cursor/` and the Explore index unstaged.
2. Run a count/max-size-only production preflight for authoritative legacy trip documents above 8 MiB. Do not log document contents.
3. Deploy backend compatibility first and verify health, default full-list compatibility, compact-list redaction/projection, individual full detail, and a non-destructive compact update fixture.
4. Publish one paired preview OTA from the same clean immutable SHA with Sentry source maps and verify Android/iOS source, runtime, and update identities.
5. Rerun the exact **Checkpoint A** Samsung command without clearing the signed-in account. Preserve the atomic report, SHA-256, ten-cycle curves, recovery, exit evidence, QA counts, and exact layer restoration.
6. After memory passes, run only the affected Android delta and iOS shared spot-check, then assemble Checkpoint B and the M1 review packet. Do not begin M2 with an unresolved P0/P1.

## Checkpoint maintenance

Update this file after each implementation checkpoint, deployment, preview publication, or device gate. Record exact SHAs, artifact IDs, evidence paths and hashes, open P0/P1 defects, the next exact action, and task-owned background processes. Keep completed work in place so a future session can distinguish reusable evidence from tests that truly need to be repeated.

Task-owned background-process state at this checkpoint: no Gradle, Metro, Expo, EAS, Maestro, Trailhead test, or audit process was found running in WSL.
