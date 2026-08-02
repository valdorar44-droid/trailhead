# Explore NPS Child Contract R1

## Baseline checkpoint

- Recorded: `2026-08-02T17:20:49-05:00`.
- Branch: `feat/explore-nps-child-contract-r1`.
- HEAD: `ddccb370a53edb66582d5393fe029e1bd7701e71`.
- Worktree: `/home/sean/.openclaw/worktrees/trailhead-explore-nps-child-r1`.
- Stage: internal audit candidate only.
- Mobile/native/backend delivery: none. No preview OTA, production OTA,
  native build, Railway deployment, or feature-stage change belongs to this
  packet.
- Task-owned builder, test, Gradle, Metro, Maestro, and Expo processes: none.

### Protected user files

The main dirty workspace remains outside this task. Never stage, overwrite, or
discard these files:

- `.cursor/`
- `dashboard/explore_serving_index_v2.json`, SHA-256
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- `docs/app-store-copy.md`, SHA-256
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`

The fresh task worktree is clean apart from this checkpoint file.

### Pinned inputs

- Accepted b08 public-release manifest:
  `79b3a7df32c02376a8e7322bd5c6f53ba417694fb01eb5ceb3afe1d5bb2c77c6`.
- Accepted b08 rich catalog:
  `23f15894e46e381ccbd6df28baa8df0e018844876c68112c5872509211095f06`.
- Accepted b08 compact index:
  `1773805d38537f74c6656165305a86595bb39d53a3e694c328a82ce4f33061ba`.
- Accepted normalized b09 v3 catalog:
  `8bc319b8b230d4272778671318903c9e0e05844b7c5a5d11d8f81438a1584c80`.
- Normalized identity authority:
  `/home/sean/.openclaw/workspace/trailhead/data/explore/audit_candidates/nps/live-20260802-b09-accepted-v3/explore_catalog_v3.json`.
- Raw source caches are provenance/media-rights evidence only. Their hashes are:
  - `acad`: `c3945af89c0ef1364671a1b155491a72fa976782a92dcdbb1ee7263a0c422b20`
  - `grsm`: `8c36b5a68a6469ad9182ebe4fb54578836ea8657832786903b0e78d232a1a898`
  - `grte`: `cf674109de5136be79a8a748f989c3d7440f46492af79a5261909d43496ac065`
  - `grba`: `7b46138b05772bc6b6ee2a1f49d3df6ebe99f65a7086b1e0c53986b8231955f8`
  - `badl`: `eefaf55010fc6e2f603a6d5e59052eed7b0cc6e4446f800adf339f99839701a3`
  - `arch`: `64976f68f01d8c174d6bebcdc306f23d818811950f12fdfa7448102001f7455e`
  - `cany`: `bc3a57cc8f37caea17413cac549fdb7ff8302ef5b93fb88ce9819ef8134371a4`
  - `glca`: `e5a3515def889dac6f3d1c198c11808ee7a79c598ec17a7033ba57c332744e77`

### Exact audited scope

This is a disposition contract, not a promise to publish every row.

- Legacy normalization rows: 157. These are the sorted b08 public places with
  a `parent_hub_id` and without `source_pack.nps_endpoint`.
- New normalized child candidates: 237 from `acad`, `grsm`, `grte`, `grba`,
  `badl`, `arch`, `cany`, and `glca`.
- New module counts: See 112, Do 45, Stay 49, Visitor 31.
- Per-hub counts: Acadia 32, Great Smoky Mountains 39, Grand Teton 34,
  Great Basin 31, Badlands 18, Arches 19, Canyonlands 25, Glen Canyon 39.
- Selection authority is the accepted b09 normalized source pack: take the
  first valid-coordinate, stable-source-ID, HTTP-linked rows in source order,
  capped at 14 See, 8 Do, 14 Stay, and 8 Visitor per selected hub.
- Identity hashes use canonical compact JSON with sorted object keys:
  - Legacy: `8a6dd528b262654e97a4b98625aeb3b1f4a6d77c96bc1fd27f9d6d8052ee33e4`
  - New: `d94ee87a0ca79e476297e44d7cb2f4224599b28749ffcae9ab90c2ede631bc0c`
  - Combined: `fc6ea5fc19cf4ec1b3f794902502e0a30dbc6380ff9fb7cfd5eba9dfa94b6524`

Known review states are one same-parent title pair (`Acadia Gateway Center`),
six candidates without approved imagery, 49 without usable descriptions, and
13 legitimate nonstandard official or partner URLs. Missing descriptions stay
text/list-only; the builder must not create generic prose.

### Intended implementation files

- `scripts/build_nps_child_depth_batch.py`
- `tests/test_nps_child_contract_batch.py`
- This checkpoint

Existing b1, b2, and b3 builder behavior and tests must remain compatible.

## Exact next action

Add the `post-b08-nps-child-contract-r1` cached-only builder preset, pin every
input hash, generate all 394 dispositions plus the reviewed contract/audit
artifacts, prove a deterministic second build, and run only the focused child,
Explore source, copy, privacy, and matrix tests.

## Do not repeat

- Do not call the NPS API or spend provider quota.
- Do not rebuild b06, b08, or accepted b09.
- Do not write the public catalog, protected serving index, or internal-preview
  overlay.
- Do not deploy Railway, publish an OTA, create a native build, or run a device
  crawl in this cached data packet.
- Do not repeat Map, Search, Layers, campground, Trails, Originals, Android
  Auto, Memory, screenshot, or broad NPS testing without new evidence.
- Figma and Mobbin are not required because this packet changes data contracts,
  not an approved interaction or visual pattern.

## Completion checkpoint

- Recorded: `2026-08-02T18:03:13-05:00`.
- Implementation commit: `e7f8eb0d9d6a99a90a4ae2812761b474605fe419`.
- Branch: `feat/explore-nps-child-contract-r1`; implementation is pushed to
  `origin/feat/explore-nps-child-contract-r1`.
- Delivery remains data/audit-only: no Railway deployment, feature-stage
  change, preview or production OTA, native build, or device crawl occurred.
- Task-owned Gradle, Metro, Maestro, Expo, pytest, and candidate-builder
  processes: none.

### Completed contract

- Added cached-only preset `post-b08-nps-child-contract-r1` with pinned b08,
  accepted b09, and raw-cache hashes. It cannot write outside
  `data/explore/audit_candidates/internal`, overwrite an immutable output, or
  fetch source data.
- Accounted for exactly 394 identities: 157 legacy normalization records plus
  237 normalized candidates. Module counts are See 112, Do 45, Stay 49, and
  Visitor 31. One reviewed Acadia duplicate merges into the richer visitor
  center, leaving 236 materialized candidates.
- Added the tracked clean-checkout identity lock
  `tests/fixtures/explore_sources/nps_child_contract_r1_identity.json`, SHA-256
  `d5aad97024b47c4d47fe353e9781391343c8e8fd83f7c9bdab35f7f9b0ed3508`.
  It reproduces all identity hashes, module/destination counts, legacy serving
  coverage, collision checks, and the reviewed duplicate without committing
  the large ignored audit outputs.
- Kept 49 missing source descriptions blank/text-only, kept six source records
  without media text-only, and excluded 47 additional images that lacked the
  strict cached distribution evidence. The resulting 183 images remain bound
  to exact pinned source evidence.
- Removed embedded booking URLs from the visible/search copy of exactly three
  reviewed Glen Canyon campground records. Booking and official links remain
  in their action/source fields; no facts were invented.
- Added an explicit public-promoter rejection for
  `ExploreNpsChildContractV1` and any child payload declaring
  `public_promotion_compatible: false`. The integration test exercises the real
  promotion entry point.

### Evidence

- Identity hashes:
  - Legacy: `8a6dd528b262654e97a4b98625aeb3b1f4a6d77c96bc1fd27f9d6d8052ee33e4`
  - New: `d94ee87a0ca79e476297e44d7cb2f4224599b28749ffcae9ab90c2ede631bc0c`
  - Combined: `fc6ea5fc19cf4ec1b3f794902502e0a30dbc6380ff9fb7cfd5eba9dfa94b6524`
- Current immutable local audit artifacts:
  - `audit.json`: `01e7953e0ac50b51f047872661dd4cb97fe23c82be772c7dcb50ae070674f639`
  - `child_dispositions.json`: `4dc8a35e56774df88fdd2ca0aa557b8f76f91be8b73311784251d9a302591518`
  - `manifest.json`: `89ba6376343c593f978d05061eef47bcd9aac8bae23b0de428286bd562032e6d`
  - `nps_child_contract_v1.json`: `a4a6db4becb705d43351e820c7a61f8bb335dde4244a19adfcce1c384ad0046a`
  - `review.json`: `9166f08cd27aa7f141ea4f460795c891328bb978dd85dced47c8b1cdab3bcdc8`
- Primary and deterministic-rebuild directories are byte-identical.
- Final focused regression: 42 passed. Python compilation and whitespace
  checks passed.
- Broader Explore/source/content regression: 184 passed with only existing
  framework deprecation warnings. The Explore catalog QA matrix passed with no
  dead-end scenarios.
- Independent reviews approved exact scope, source/media lineage, deterministic
  output, visible-copy cleanup, and public-promotion isolation.
- Protected hashes remain unchanged:
  - Explore serving index:
    `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
  - App Store copy:
    `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`

### Open defects and exact next action

- Open P0/P1 defects: none in this internal contract packet.
- The sidecar is deliberately not mounted or promotion-ready. The next packet
  is a reviewed, admin-only internal-preview overlay that consumes these 236
  materialized candidates and 157 identity aliases without modifying the public
  catalog or serving index. Device review follows that mount; public promotion
  remains a later explicit decision.

### Updated do-not-repeat list

- Do not refetch NPS data, rebuild b06/b08/b09, or re-audit the 394 identities.
- Do not repeat broad Map, Search, Layers, Trails, Originals, Android Auto,
  Memory, screenshot, or NPS research work.
- Do not feed this contract directly to the public promoter; it is explicitly
  rejected there.
- Do not stage the ignored local artifact or deterministic-rebuild directories.
