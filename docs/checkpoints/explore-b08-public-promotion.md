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

Deploy the immutable `explore-b08-top-level-v1` artifacts with all three public-release environment paths, wait for Railway `SUCCESS`, then run only the bounded Release 1 API and device checks.

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
