# Explore NPS Child Depth Batch 4 — Internal Preview Integration

Completed 2026-08-02 21:53 CDT (America/Winnipeg).

## Resume first

- Branch: `feat/explore-nps-child-b4-integration-r1`
- Isolated worktree:
  `/home/sean/.openclaw/worktrees/trailhead-explore-nps-child-b4-integration-r1`
- Source HEAD: `2abe8008c86a30b78feb62e0bcce220b004bb148`
- Scope: mount the already-reviewed 97-record Batch 4 candidate in the
  authenticated internal Explore sidecar after Batch 3 and before the existing
  materialized contract records.
- This packet did not refetch NPS data, deploy, commit, push, publish an OTA,
  or change a public catalog or feature stage.

## Protected scope

- `.cursor/` was not staged or modified.
- `dashboard/explore_serving_index_v2.json` was not staged or modified; its
  protected main-workspace SHA-256 remains
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- `docs/app-store-copy.md` was not staged or modified; its protected
  main-workspace SHA-256 remains
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- The Git index is empty for this packet; no file is staged.

## Accepted immutable Batch 4 input

- Directory:
  `data/explore/audit_candidates/internal/post-b09-nps-child-depth-b4-r2`
- Logical batch ID: `post-b09-nps-child-depth-b4`
- Records: 97
- Parent hubs: `place:nps:hosp`, `place:nps:hove`, `place:nps:indu`,
  `place:nps:jeca`, and `place:nps:joda`
- Audit SHA-256:
  `1e29aa4f1b9e149aaf2d1b0ad61793ce636c1242525f8f560c80b56a592d07e2`
- Manifest SHA-256:
  `a2c8c0b91f36f88ccf80c08f76ca5b7357fa0f445622a9939c4da55d71a52f4f`
- Child artifact SHA-256:
  `bff4dbe3fae5a984083c366aa7711e2766bad2c220c71f49367f2d4a1aea247f`
- Review SHA-256:
  `60ccad3f4bf56f0664a53e4e1c54b175fc664f9dcbc75f629994fedc7cf48e99`
- Provider/network requests: 0
- Promotion ready: false

## Completed integration

- `scripts/build_explore_internal_preview.py` pins and validates all four B4
  inputs and appends Batch 4 after B1/B2/B3 and before the contract records.
- `scripts/qa_explore_b08_internal_candidate.py` verifies exact paths, hashes,
  counts, order, ordered-identity hashes, public-parent coverage, and the exact
  five-parent Batch 4 set.
- `dashboard/server.py` fails closed unless the internal sidecar has the new
  canonical payload hash, 13 profiles, 790 children, and four accepted depth
  bindings.
- `tests/test_explore_nps_child_internal_preview.py` characterizes the complete
  790-record mount, internal-only search/detail/parent rails, Featured
  exclusion, and the Batch 4-before-contract boundary.
- `tests/test_nps_child_depth_batch4_candidate.py` now verifies the accepted
  candidate is mounted exactly once in positions 457 through 553, is the fourth
  depth binding, and remains disjoint from public child dispositions. This
  replaces the obsolete pre-integration expectation that it must be absent
  from the internal preview.
- Every Batch 4 child has a publicly resolvable parent hub and remains
  `hidden_from_featured`.
- Public and header-only requests remain unchanged. Internal data still
  requires the internal stage, an authenticated administrator, and
  `X-Trailhead-Explore-Preview: internal`; the header alone is not a
  credential.

## Generated sidecar and determinism

- Path: `dashboard/explore_internal_preview_v1.json`
- Profiles: 13
- Children: 790 = 554 reviewed depth children + 236 contract children
- Immutable depth bindings: 4, exactly B1, B2, B3, B4
- Bytes: 6,546,470
- File SHA-256:
  `ebcc92fac3a6fa7b80feb84d070fb30220ad0b783f656c2b5c38569382fc910b`
- Canonical compact-payload SHA-256 used by the server guard:
  `55e1a26ba8c70514eff995575a047bbccd4a159a58c4dcfa346d4407c4aa9ad0`
- Accepted depth identity SHA-256 for B1 through B4 (554 IDs):
  `44eb88b7f4447a194b8164910b2369baf101cbc38ad0faef9c8fed672ceb63f5`
- Contract identity SHA-256 (236 IDs):
  `ea23a5e4f3925195febc232f76ad7bd49ecc065437c970d25b7c8735e876f76e`
- Combined ordered identity SHA-256 (790 IDs):
  `0f78c91b55cd1392a30182582bf2e378b2530e66b422e0e100135715c0e156fe`
- Independent rebuild:
  `/tmp/trailhead-explore-internal-preview-b4-rebuild.json`
- The independent rebuild has the same byte count and SHA-256 and passed
  `cmp` byte-for-byte.

Ignored immutable base inputs were made available through same-filesystem
hardlinks from the main read-only evidence rather than duplicated onto the
nearly full Windows host. Builder and QA paths only read them. The generated
sidecar and independent output are ordinary files. At checkpoint time the C:
drive had approximately 0.62 GB free; no byte-copy or native build was
attempted.

## Verification

- Python compilation passed for the builder, QA, and server modules.
- Direct sidecar QA passed with 13 profiles, 790 children, exact immutable
  paths/hashes/order, six NPS proof hubs, and five reviewed replacements.
- Integration characterization:
  `28 passed`, with `4 subtests passed`.
- Additional Explore/internal-candidate/Batch 4 run: `27 passed`; its only
  failure was the obsolete pre-integration absence assertion described above.
- Targeted corrected assertion rerun: `1 passed`.
- Independent deterministic rebuild and `cmp`: passed.
- Open P0/P1: none.
- Task-owned background processes: none.

## Intentional changed files

- `dashboard/explore_internal_preview_v1.json`
- `dashboard/server.py`
- `scripts/build_explore_internal_preview.py`
- `scripts/qa_explore_b08_internal_candidate.py`
- `tests/test_explore_nps_child_internal_preview.py`
- `tests/test_nps_child_depth_batch4_candidate.py`
- `docs/checkpoints/explore-nps-child-depth-b4-integration-r1.md`

## Exact next action

Review and intentionally commit this isolated integration packet. A later,
separately authorized release may deploy the authenticated internal sidecar and
show one reviewed Batch 4 destination on Android. That proof should verify a
hub module, child sheet, map handoff, Back restoration, exact imagery or clean
text fallback, and no exposure in Featured or unauthenticated Explore.

## Do not repeat

- Do not refetch or rebuild accepted B1, B2, B3, B4, or contract evidence.
- Do not rerun broad Explore, NPS, Map, Layers, Memory, Trails, Originals,
  Android Auto, or screenshot crawls without new evidence.
- Do not overwrite or stage the protected serving index.
- Do not promote Batch 4 publicly from this checkpoint.
