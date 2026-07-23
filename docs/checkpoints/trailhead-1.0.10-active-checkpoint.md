# Trailhead 1.0.10 Active Checkpoint

Last updated: 2026-07-23 03:33 (America/Winnipeg)

## Resume protocol

Read this file before resuming the 1.0.10 overhaul after a restart or context compaction. Then:

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Verify `dashboard/explore_serving_index_v2.json` still hashes to `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
3. Keep `.cursor/` and `dashboard/explore_serving_index_v2.json` out of every implementation commit.
4. Continue from **Next exact actions** below. Do not restart the design, NPS research, automated gate, or baseline crawl.

## Source checkpoint

- Branch: `feat/trailhead-1.0.10-overhaul`
- Current immutable source and remote branch HEAD: `83287394ce41f1100bd980c9249f20d364b51db7`
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
- The full `8328739` source passed `npm run audit:prepreview`, was pushed intentionally, and was published to the paired preview channel with Sentry source maps.
- No production build, OTA, submission, public feature-stage change, advertising action, or store-asset change was made.
- Production OTA, AAB/IPA submission, public Originals rollout, advertising, and store screenshot replacement remain blocked.

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
- Those reports used accounted Android `TOTAL PSS` only. On this Samsung, that value includes substantial `SwapPss`; one captured `909593` KB total contained `437247` KB swap and about `472346` KB resident PSS. The former `512000` KB fail-fast therefore neither proves an `861` MB live working set nor provides leak evidence, because it prevented the ten cycles from running.
- Read-only isolation proved the cold signed-in Explore process can climb above 1 GB without mounting Map. The primary evidence-backed cause was repeated per-record trip-repository hydration, with every item reserializing, rereading, and reparsing the complete account state.
- The successful cold QA proof independently observed signed-in process PSS rising from about `342` MB to `783` MB and then `1.298` GB while the QA screen remained open. This reinforces that the blocking light-screen issue is account hydration/retention, not Layers or an active map workload.
- M1 now batches each remote repository page into one transaction, rolls back failed reads/writes, emits one committed snapshot, and records count/byte-only QA diagnostics. The QA screen no longer parses full legacy offline place packs.
- Retained Map tabs now keep semantic state mounted while pausing hidden visual sources, viewport work, image work, and stale async commits. One coordinator deduplicates native region events against the refocus fallback; navigation and Originals runtimes remain independent.
- The existing memory gate restores captured layer choices durably, retries only a verified persisted-state mismatch once, and records primary and restoration failures separately. Its obsolete single total-PSS cap is the next implementation target.
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
- The memory harness must be upgraded to phase-aware resident-PSS, RSS, swap, accounted-PSS, cycle-slope, and post-use recovery checks before the exact `8328739` Samsung result can be classified.
- Signed-in Explore/Plan idle remains blocking if it exceeds the light-phase budget. Heavy Map/navigation allowances cannot excuse idle account-hydration retention.
- Only after that pass should the affected Android delta crawl and iOS shared spot-check run. Do not repeat the 33 baseline crawls.
- EAS preview credentials for Branch, Sentry, Google Maps, and RNMapbox were verified without exposing their values before publication.
- Branch deferred handoff stays disabled until branded-domain TLS and fresh-install attribution pass.

## Deferred M3 evidence — Explore hubs

- Explore hub tabs can shift, disappear, or fall back to Overview while asynchronous data changes the module registry. Two competing navigation states and eager long-list rendering make the behavior visibly glitchy.
- Rich park data is legitimately sparse: the catalog contains `474` NPS hubs but only five current rich per-park cache packs. Missing modules must not be fabricated.
- M3 must use one stable typed module registry per detail revision, explicit loading/ready/empty/error states, deterministic richness-preserving merges, virtualized child lists, and a visible unavailable-module reconciliation while preserving real NPS content.

## Next exact actions

1. Replace the obsolete `512000` KB gate with the approved phase-aware `AndroidMemoryGateReportV3`, add deterministic tests, and checkpoint the gate before device execution.
2. Run the exact `8328739` Samsung candidate through Explore idle, Map idle, ten enabled/recovery cycles, post-Map recovery, and process-exit checks while restoring the user's exact layer choices.
3. Profile and fix the verified signed-in light-screen hydration/retention failure; deploy backend compatibility first if the compact legacy-trip contract is required.
4. Rerun the gate, then run the affected Android delta and iOS shared spot-check.
5. Assemble the M1 review packet and final M1 checkpoint. Do not begin M2 with an unresolved P0/P1.

## Checkpoint maintenance

Update this file after each implementation checkpoint, deployment, preview publication, or device gate. Record exact SHAs, artifact IDs, evidence paths and hashes, open P0/P1 defects, the next exact action, and task-owned background processes. Keep completed work in place so a future session can distinguish reusable evidence from tests that truly need to be repeated.

Task-owned background-process state at this checkpoint: no Gradle, Metro, Expo, EAS, Maestro, Trailhead test, or audit process was found running in WSL.
