# Trailhead 1.0.10 Active Checkpoint

Last updated: 2026-07-23 05:19:27 CDT (America/Winnipeg)

## Resume protocol

Read this file before resuming the 1.0.10 overhaul after a restart or context compaction. Then:

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Verify `dashboard/explore_serving_index_v2.json` still hashes to `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
3. Keep `.cursor/` and `dashboard/explore_serving_index_v2.json` out of every implementation commit.
4. Continue from **Next exact actions** below. Do not restart the design, NPS research, automated gate, or baseline crawl.

## Source checkpoint

- Branch: `feat/trailhead-1.0.10-overhaul`
- Current committed Memory Gate V3 implementation baseline and remote branch HEAD: `d5d73924dc5a969a66ac9eba2b85acca5db0cc19`
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
- Memory Gate V3 is committed, pushed, and ready. The exact `8328739` Samsung device run is now the next blocking evidence.
- Signed-in Explore/Plan idle remains blocking if it exceeds the light-phase budget. Heavy Map/navigation allowances cannot excuse idle account-hydration retention.
- Navigation, 3D, and Originals are recorded as separate active-experience phases; missing active-phase evidence does not fail ordinary M1 Map acceptance, but those experiences still require their own later acceptance runs.
- Only after that pass should the affected Android delta crawl and iOS shared spot-check run. Do not repeat the 33 baseline crawls.
- EAS preview credentials for Branch, Sentry, Google Maps, and RNMapbox were verified without exposing their values before publication.
- Branch deferred handoff stays disabled until branded-domain TLS and fresh-install attribution pass.

## Deferred M3 evidence — Explore hubs

- Explore hub tabs can shift, disappear, or fall back to Overview while asynchronous data changes the module registry. Two competing navigation states and eager long-list rendering make the behavior visibly glitchy.
- Rich park data is legitimately sparse: the catalog contains `474` NPS hubs but only five current rich per-park cache packs. Missing modules must not be fabricated.
- M3 must use one stable typed module registry per detail revision, explicit loading/ready/empty/error states, deterministic richness-preserving merges, virtualized child lists, and a visible unavailable-module reconciliation while preserving real NPS content.

## Next exact actions

1. Run the exact command in **Checkpoint A** against the installed `8328739` Samsung preview without clearing the signed-in account.
2. Preserve the atomic report, SHA-256, phase table, recovery curves, process/exit evidence, and exact layer-restoration result.
3. If Explore idle fails, profile signed-in hydration and retained repository state; add the backward-compatible compact trip-list contract only if evidence still identifies legacy trip documents as the cause.
4. If Map phases fail, profile renderer duplication, retained sources, images, GeoJSON, subscriptions, and inactive visual work. Fix only demonstrated causes, then rerun the complete gate.
5. After memory passes, run only the affected Android delta and iOS shared spot-check, then assemble Checkpoint B and the M1 review packet. Do not begin M2 with an unresolved P0/P1.

## Checkpoint maintenance

Update this file after each implementation checkpoint, deployment, preview publication, or device gate. Record exact SHAs, artifact IDs, evidence paths and hashes, open P0/P1 defects, the next exact action, and task-owned background processes. Keep completed work in place so a future session can distinguish reusable evidence from tests that truly need to be repeated.

Task-owned background-process state at this checkpoint: no Gradle, Metro, Expo, EAS, Maestro, Trailhead test, or audit process was found running in WSL.
