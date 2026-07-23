# Trailhead 1.0.10 Active Checkpoint

Last updated: 2026-07-22 (America/Winnipeg)

## Resume protocol

Read this file before resuming the 1.0.10 overhaul after a restart or context compaction. Then:

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Verify `dashboard/explore_serving_index_v2.json` still hashes to `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
3. Keep `.cursor/` and `dashboard/explore_serving_index_v2.json` out of every implementation commit.
4. Continue from **Next exact actions** below. Do not restart the design, NPS research, automated gate, or baseline crawl.

## Source checkpoint

- Branch: `feat/trailhead-1.0.10-overhaul`
- Remote baseline before the current local checkpoint: `90b8124f701a8bb9f6f2119f67bb7cceecc80267`
- Local commits created from the verified tree:
  - `4fa0379 feat(api): harden fire and explore delivery`
  - `d44618b feat(mobile): preserve explore context and map state`
  - `e6f5811 test(release): gate preview memory and telemetry`
- Nothing has been published to production from these commits.
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

## Existing crawl evidence — do not repeat as baseline work

- 33 Android audit runs.
- 240 Trailhead Android screenshots and 219 UI hierarchy dumps.
- 10 Maestro runs covering warm Map/search and related flows.
- Android Auto evidence under `output/android-auto/`.
- NPS reference crawl: 103 UI hierarchy dumps and 94 PNGs including Figma exports.
- Existing Trailhead runs cover onboarding, Explore pagination/stress, Map/search, layers/weather, sheet/review paths, navigation, Samsung captures, and emulator flows.
- The installed evidence candidate is Android 1.0.10 build 59 with runtime `native-1.0.10-android.1`; several runs are tied to OTA/source SHA `90b8124`, while earlier emulator runs are tied to `b0c7696`.

## Known unresolved blockers

- The current fire/media/NPS/layers changes have not yet been delivered to the devices as one exact clean SHA.
- A prior uncontrolled Samsung Explore snapshot reached `1,014,606 KB` total PSS. It is evidence of a memory problem, but it is not the corrected controlled gate for the new candidate.
- The corrected Samsung memory gate must prove total PSS below 500 MB and less than 10% growth over ten heavy-layer cycles.
- External preview credentials/build values for Branch, Sentry, and Google Maps must be verified before publishing the paired preview.
- Branch deferred handoff stays disabled until branded-domain TLS and fresh-install attribution pass.

## Next exact actions

1. Recheck `git diff --check`, protected hash, staged files, branch ahead/behind, and absence of orphaned test processes.
2. Push the clean branch checkpoint.
3. Deploy backend compatibility/internal behavior and verify health plus the new fire/media endpoints.
4. Publish one paired **preview-only** OTA from the same immutable SHA with Sentry source maps.
5. Verify exact build/runtime/update identity on Samsung and emulator.
6. Run the corrected controlled Samsung memory gate first.
7. If memory passes, run only the affected delta crawl: Map, Explore, layers/fire, NPS return state, and exact-place media. Reuse prior evidence for unchanged areas.
8. Continue Map-first redesign implementation only after the stability delta passes.

## Checkpoint maintenance

Update this file after each commit, deployment, preview publication, or device gate. Record exact SHAs and artifact IDs. Keep completed work in place so a future session can distinguish reusable evidence from tests that truly need to be repeated.
