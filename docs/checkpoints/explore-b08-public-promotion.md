# Explore b08 Public Promotion Checkpoint

## Baseline

- Created: 2026-08-02 (America/Winnipeg)
- Branch: `release/explore-b08-public`
- Pinned base: `f1f6a24eccf568665260b44cb76b18e50d7ebd72`
- Current bundled full-catalog SHA-256: `6b77ef3027cb9b5998f1d4ae5ba75095c46d7949b1f48a880929be23f352d702`
- Current bundled serving-index SHA-256: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`
- Protected main-worktree serving-index SHA-256: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- Protected App Store copy SHA-256: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`

Never stage or modify the main-worktree `.cursor/`, `dashboard/explore_serving_index_v2.json`, or `docs/app-store-copy.md`.

## Current production rollback

- Production OTA tag: `v1.0.11-b08-ota4`
- Backend internal-data source: `767dc641de72353a8f1ca2e7865025f11473dabf`
- Railway deployment: `4fb0d22a-b0c4-407a-a7d7-91b57a305c57`
- Public promoted index currently contains 5,336 reviewable items.
- Existing b08 internal preview remains admin-only.

## Active packet

1. Add a hash-pinned, dry-run-first dual-artifact promotion contract.
2. Release the reviewed b08 top-level catalog and 5,435-item index.
3. Verify Railway and bounded Android/iOS Explore flows.
4. Release the 457 reviewed NPS children only after complete identity disposition and hierarchy checks.

## Do not repeat

- Do not refetch NPS/RIDB/USFS/BLM data or spend provider quota.
- Do not repeat broad Map, Search, Layers, Trails, Originals, Android Auto, Memory, or screenshot crawls.
- Do not publish a mobile OTA or create native builds for this backend-only packet.

## Next exact action

Wait for corrected Release 1 deployment `eb9c7a9d-54c1-4f7a-a4df-8f9bce054bf6` to reach Railway `SUCCESS`, verify the 5,421 unique public identities and 19 aliases, then run only the bounded Release 1 Android/iOS checks.

## Release 1 prepared

- Prepared: 2026-08-02 (America/Winnipeg)
- Implementation HEAD before artifact commit: `ac258d20`
- Release ID: `explore-b08-top-level-v1`
- Rich catalog: 993 records, SHA-256 `6b931a389e870cbacaa1b5b3f2f33116192b507b2d9a1e230cbfb33d1fea22ac`
- Public serving index: 5,435 records, SHA-256 `a004cee20e06a37cdcb0f6795112d239bbe19a1a4ea226f224d2f8992947ec25`
- Promotion manifest SHA-256: `e4dba0c247eff3e8c37ae7de620f41353dbbe0a1cf719abbadd37126f376e66b`
- Runtime prebuild: 5,435 served IDs, 5,435 unique IDs, five aliases, no unpinned legacy supplements.
- Focused promotion/runtime suite: 33 passed.
- Wider bounded Explore/source suite: 160 passed; five child-preview tests were not runnable in this clean worktree because their accepted gitignored b1 inputs live only in the preserved source checkout. Release 2 validates those exact files through hash-pinned `--source-root` inputs instead.
- Open P0/P1: none before deployment.
- Protected main-worktree hashes remain unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`
- Task-owned background processes: none.

## Release 1 deployment correction

- Checkpoint HEAD: `8accebef115e91cf4056918fd66ef06e8822c5ea`
- The first configured deployment, `05dfe5dd-6b24-4664-b5c9-27f7aa81c5ff`, reached Railway `SUCCESS` but Explore failed closed because the runtime injected unpinned legacy supplements. The kill switch was set to `0`; recovery deployment `639b7511-6ff9-4167-be64-d9285455a3b6` reached `SUCCESS` and restored the previous catalog.
- Fixed v1 deployment `53708cb8-3539-4da9-a6d2-d9864e8f01bd` reached `SUCCESS`, health passed, all five planned aliases resolved, and Release 2 children remained unavailable.
- Its immutable artifact held 5,435 source identities, while the browse endpoint returned 5,421 because the legacy runtime deduper suppressed 14 real RIDB/Wikidata duplicates in favor of richer NPS, USFS, or government identities.
- A proposed runtime bypass was deployed as `813417c9-7b04-4703-939a-8b94d5bb208a`, but exposing the 14 duplicate cards was rejected during the release audit. The kill switch was set to `0`; recovery deployment `14fce005-1154-434c-bd36-86e2c852139b` reached `SUCCESS` and restored the 5,326-item prior catalog while corrected artifacts were built.
- Corrected immutable release: `explore-b08-top-level-v2`.
- Rich catalog: 991 records, SHA-256 `16c7465fee90e750f0e25c493565b9cedc57235a4dc6454f289db950008eae00`.
- Public serving index: 5,421 unique records, SHA-256 `974805876c1395568bb4ea9f65a8711be7e75b962151a3ce943b12df5c1ef59e`.
- Promotion manifest SHA-256: `5de1d350d667d808e6dc9067107688e0233e3216b2d70a68f99647ddb6a653cb`.
- Alias table: 19 entries: five original USFS replacements plus 14 newly explicit duplicate replacements. Saved items and deep links resolve forward; duplicate source cards are absent from both artifacts.
- Corrected Release 2 expected counts are 1,442 rich records and 5,867 serving records. The difference from the original 5,881 estimate is fully accounted for by these 14 documented replacements.
- Promotion/runtime tests: 34 passed. Bounded Explore/source suite: 210 passed; five tests initially failed because the clean worktree's local SQLite fixture had not run `init_db()`. After initialization, the affected module passed 20/20.
- Protected main-worktree hashes remain unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`
- Open P0/P1 before corrected deployment: none.
- Task-owned background processes: Railway deployment only; no Metro, Gradle, Maestro, or test process remains.

### Do not repeat

- Do not expose reviewed duplicate source identities to satisfy a raw count.
- Do not repeat the failed v1 deployments, broad Explore/NPS crawls, or provider fetches.
- Do not modify the protected serving index; Release 2 must build from the immutable v2 artifacts.

## Release 1 v2 accepted

- Railway deployment: `eb9c7a9d-54c1-4f7a-a4df-8f9bce054bf6`.
- Terminal status: `SUCCESS`.
- Image digest: `sha256:12013c57b4e38467a71f923bdba8b4c0e7a28880533dbb99380f142c0b5dcb60`.
- Public API: health `ok`; Explore total 5,421; all 19 aliases resolved to their reviewed targets with zero failures.
- Internal-preview isolation: adding only `X-Trailhead-Explore-Preview: internal` returned the same 5,421 public records and exposed no `internal_preview` payload.
- Release 2 isolation: the Aspenglen child identity returned `404` before child-depth promotion.
- Android device: Samsung SM-A326U1 (`RFCR408DA9B`), production package `com.trailhead.app`.
- Android bounded delta passed:
  - Exact `Sierra National Forest` search ranked the canonical `CA` destination first.
  - Sierra hub loaded source-backed modules, 120 stays, map pins, child detail, and Back restoration; Viator stayed in its labelled lane.
  - Exact `Moab BLM` search ranked the canonical `UT` destination first and loaded the hub with Trailhead Originals kept separate.
  - `Kirch Flat Group Campground` ranked the richer USFS identity above the older source result, opened a stable campground Peek, then atomically opened the rich Full sheet with exact USFS image and source content.
  - No blank sheet, identity swap, crash, or scroll reset was observed.
- Evidence root: `C:\Users\User\Documents\Codex\evidence\explore-b08-public`.
- Evidence hashes:
  - `android-sierra-results-correct.xml` `1af45c332af3a0f6098ac9063f963287c68628ad326dbef8b9a90f74f59f1066`
  - `android-sierra-hub.png` `0917aabca0dce5c6cabf0f82867477a2b99e8657469bdf2a4b5c84464c5bb424`
  - `android-sierra-modules.xml` `2e6a4dd8493e66c59c460c6221c2d41870c8b6a71fd5ad287e0f1e1a2b272c19`
  - `android-sierra-stay.png` `4c82fd28d899255c68e5b2d7318e6375b0d770e32a8c04b79db65921620f7df4`
  - `android-sierra-child.png` `20280d4db4235285c0cdb5dd9095ebb68cdd8ed9fdb406e4af5267ffb608970b`
  - `android-sierra-back.xml` `0c463863b552205149ae4911fa126a6565e847499bd4fa67e91034a1b95c5d52`
  - `android-moab-hub.png` `e577cf8f101bef515ec90b39a3c68145e6124418c0fc8d963067a825fea5c222`
  - `android-kirch-results.xml` `9e776071f561d671f810357c046a5068d9560c70c7a4c04aec5871a0ca6ecef8`
  - `android-kirch-sheet.png` `77aa31ef96e1be8a4ceffd11170fc251a4d964338bd9641dab13f478f67efc62`
  - `android-kirch-full.png` `b13ef5fe2dc1664cd8cc43152ea5c3f201f52dc94931620bfaee64c615b02591`
- Physical iOS spot check: pending because no Apple device was connected; the shared API contract is unchanged.
- Release 1 open P0/P1: none.
- Next exact action: commit and tag this accepted Release 1 checkpoint, then build Release 2 only from immutable `explore-b08-top-level-v2` inputs.
