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

## Release 2 prepared

- Artifact commit: `a71040a4`.
- Release ID: `explore-b08-child-depth-v1`.
- Rollback release: `explore-b08-top-level-v2`, Railway deployment `eb9c7a9d-54c1-4f7a-a4df-8f9bce054bf6`.
- Rich catalog: 1,442 records, SHA-256 `23f15894e46e381ccbd6df28baa8df0e018844876c68112c5872509211095f06`.
- Public serving index: 5,867 records, SHA-256 `1773805d38537f74c6656165305a86595bb39d53a3e694c328a82ce4f33061ba`.
- Promotion manifest SHA-256: `79b3a7df32c02376a8e7322bd5c6f53ba417694fb01eb5ceb3afe1d5bb2c77c6`.
- All 457 reviewed source children are dispositioned: 448 published, 3 source-ID remaps, 6 canonical merges, 0 rejected.
- Alias table: 24 entries: all 19 Release 1 aliases plus five child-depth RIDB replacements.
- Artifact validation: zero missing parents, zero public alias sources, zero missing alias targets, and every serving child is `hidden_from_featured`.
- Reviewed corrections are exact:
  - Aspenglen uses the approved reservation and summer-season copy from its official source.
  - Kulanaokuaiki is named correctly and categorized as a campground.
- Reviewed exception counts remain pinned: 24 shared-coordinate clusters, 12 parent-page fallbacks, 9 explicit b3 fallbacks, and 89 text-only image fallbacks.
- Focused promotion/runtime/NPS/source suite: 55 passed.
- Active Railway deployment: `36cf126b-34c9-4534-a56c-1cced3713579` (awaiting terminal status at checkpoint write).
- Next exact action: require Railway `SUCCESS`, verify raw count, direct child/search access, parent hierarchy, Featured exclusion, 24 aliases, and bounded Android hub-child Back behavior.

## Release 2 accepted

- Accepted: 2026-08-02 04:48 America/Winnipeg.
- Branch: `release/explore-b08-public`.
- Artifact commit: `a71040a4b2ee6365a330975cb0e81e40276465fa`.
- Final backend source: `73860e01c00f2244474e21be43f326609954f385`.
- Release ID: `explore-b08-child-depth-v1`.
- Initial Railway deployment: `36cf126b-34c9-4534-a56c-1cced3713579`, terminal `SUCCESS`.
- Search-consistency Railway deployment: `89a3e1d2-962b-4174-adc3-2723eab3e6a0`, terminal `SUCCESS`.
- Final image digest: `sha256:ab55a840bc6c31c1fbb09cdc3bcf4df9a80c7763d26e8236bb0a95ea67573527`.
- Rollback target: Release 1 v2 deployment `eb9c7a9d-54c1-4f7a-a4df-8f9bce054bf6`, source `8accebef115e91cf4056918fd66ef06e8822c5ea`.
- Raw public catalog: 5,867 records. Broad browse: 5,416 records. The 451-record difference is the reviewed child set hidden from broad discovery.
- Rich catalog: 1,442 records. Manifest dispositions: 448 published, 3 remapped, 6 canonical merges, 0 rejected.
- All 24 aliases resolve to their exact reviewed canonical targets; no alias source remains public and no target is missing.
- Internal-preview isolation passed: the preview header without authenticated admin access returns the public 5,416-item browse view and no internal payload.
- Aspenglen is directly addressable and searchable under `place:nps:romo`, module `stay`, with the approved reservation/summer copy.
- Kulanaokuaiki is directly addressable under `place:nps:havo`, module `stay`, with the correct campground name and category.
- Railway health is `ok`; the final post-deploy public counts remain 5,867 raw and 5,416 broad browse.

### Android bounded delta

- Device: Samsung SM-A326U1, production package `com.trailhead.app`, app 1.0.10 build 69.
- Aspenglen exact search opened the correct campground Peek, nonblank Full sheet, and restored the Map on Back.
- Kulanaokuaiki exact search opened the correct named campground sheet.
- One deterministic P1 was found: the exact Aniakchak destination initially opened a Campground sheet because Search V2 preferred a stale persistent canonical index over the active promoted index.
- One evidence-backed backend correction now makes Search V2 use the manifest-validated promoted serving index and fingerprints the promoted index plus manifest to invalidate stale documents.
- Focused correction tests: 86 passed and 17 subtests passed. The wider focused run completed with 104 passed and 17 subtests; Python compile and whitespace checks passed.
- After deployment `89a3e1d2-962b-4174-adc3-2723eab3e6a0`, the exact Aniakchak result opened the `Parks & Land` destination hub at `Overview`, with no Campground, Reservable, or View Sites state.
- Evidence root: `C:\Users\User\Documents\Codex\evidence\explore-b08-public\release2-android`.
- Key evidence hashes:
  - `03-aspenglen-child-sheet.png` `f17cba9c014295cdda195f9a50125ec700b924275a72a13777ff63ccc754afc8`
  - `04-aspenglen-full-details.png` `3a833795f7f1d05345620c5f57cfa5b7efe0ea4725d93d02438a21e08f5cf427`
  - `07-kulanaokuaiki-sheet.png` `dfd37ce3f160857c0b6b75f61c25b009df6cf185f69b4b0fa6fd8c84851c0887`
  - `09-aniakchak-hub-entry.png` `7f6274b0b73bd9641dfd14895adee9523eda1ebd91c84f66a1833dadb51827e1`
  - `14-aniakchak-fix-opened.png` `da157b59ac1b65c609991ba64c1290224107fe2d2f8169b1a81cf7672b75e2ed`
  - `14-aniakchak-fix-opened.xml` `8753b6f734b4ec6e75bcdce8a2e1bdbf6c4f3b64281237e0eb1e94b107184341`

### Closeout state

- Protected main-worktree Explore index remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- Protected App Store copy remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Physical iOS spot check is pending because no Apple device was connected. The backend contract and public data require no OTA or native build.
- Open P0/P1: none after the bounded Aniakchak correction.
- Task-owned Metro, Gradle, Maestro, pytest, and Railway polling processes: none.
- Next exact action: perform only the shared iOS hub/child spot check when an iPhone is available; otherwise begin the next untouched Explore data packet from this accepted release.

### Do not repeat

- Do not rerun Release 1, refetch b08 data, repeat broad NPS/Explore crawls, or re-audit passed Aspenglen/Kulana flows without new evidence.
- Do not expose children in Featured or broad discovery.
- Do not modify the protected serving index; future releases continue from these immutable artifacts and manifests.

## Release 2 physical iOS spot check accepted

- Accepted: 2026-08-02 14:50 America/Winnipeg.
- Device: iPhone16,2 (`SEAN`), iOS 26.5.2; production package `com.trailhead.app`, app 1.0.11 build 62.
- Exact Aniakchak search opened the correct `Parks & Land` destination hub with the source-backed Overview rather than campground semantics.
- `What to See` exposed the three reviewed children in deterministic order: Aniakchak Caldera, Surprise Lake, and The Gates.
- Aniakchak Caldera opened with exact NPS imagery, `Scenic View/Photo Spot`, a nonblank directions map, NPS photo attribution, and the shared Map place sheet.
- Closing the Map sheet retained the Aniakchak camera and selected-area context. Returning to Explore restored the exact Aniakchak Caldera detail, and Back restored the same three-item `What to See` list.
- A close gesture briefly opened iOS Control Center; it was cleared without resetting Trailhead. This was a test interaction artifact, not an app defect, and screenshot `07-map-after-close.png` is excluded from acceptance evidence.
- Evidence root: `C:\Users\User\Documents\Codex\evidence\explore-b08-public\release2-ios`.
- Acceptance evidence hashes:
  - `03-aniakchak-opened.png` `d059a30a5c8eb35f17cb2dca925873a4ec74bb6b20c12cc14d4f8b619483d66d`
  - `04-aniakchak-child.png` `e9bd36f834f6dfdd6848aa9bd74ce31fac590eab21d74f87fff68a6ef539aedc`
  - `05-aniakchak-caldera-detail.png` `64e770f8a2dff83dc47ab6aa5b7685c56c083d53fbeccd210d3c04a3164627b6e`
  - `06-aniakchak-caldera-map.png` `a2a89337b4be4878f7a4b1cf0aa541f79c706c06124d32519cb472fe3ef68573`
  - `08-app-after-return.png` `e86e5d3e121c9e48ac9a93cac38b8dca81c1e7d755d71a3f45a39c11b76cd377`
  - `09-explore-return.png` `bbdd0aef5201e39c8287131da65fcd30b4f87e65ba6df39be0004f720d8a0454`
  - `10-child-list-restored.png` `24129e96f35395ced1c96c03866f2a9da38cf57fbf17949749282f6266cbe884`
- Open P0/P1: none.
- Task-owned Metro, Gradle, Maestro, pytest, Railway polling, and iOS tunnel processes: none.
- Release 2 is accepted on both Android and iOS. No mobile OTA or native build is required for this backend-only promotion.
- Next exact action: begin the next untouched Explore data-depth packet from `explore-b08-child-depth-v1`; do not repeat b08 promotion or accepted device checks without new evidence.
