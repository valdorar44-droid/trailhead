# Explore NPS Child Depth Batch 3 Checkpoint

Pre-change checkpoint created 2026-08-01 23:01 CDT
(America/Winnipeg).

## Resume first

- Branch: `feat/nps-child-depth-b3`
- Isolated registered worktree:
  `/mnt/c/Users/User/Documents/Codex/2026-07-15/awesome-github-plugin-github-openai-curated/trailhead-nps-b3-wt`
- Pre-change HEAD: `186b83c93edf4ed41b528c068704b80e63eda9e7`
- Parent branch at worktree creation: `feat/trailhead-1.0.10-overhaul`
- This packet is cached-only and internal. It must not integrate the preview
  sidecar, deploy, promote a catalog, publish an OTA, or use provider/network
  requests.

## Protected files

Never stage or modify `.cursor/`, `dashboard/explore_serving_index_v2.json`, or
`docs/app-store-copy.md`.

Clean tracked copies in this isolated worktree:

- Explore serving index SHA-256:
  `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`
- App Store copy SHA-256:
  `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`

User-owned dirty copies in the main worktree remain excluded:

- Explore serving index SHA-256:
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- App Store copy SHA-256:
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`

## Exact packet

Build one immutable NPS child-depth Batch 3 from the already cached official
source packs for:

1. Big Bend National Park (`bibe`)
2. Everglades National Park (`ever`)
3. Cuyahoga Valley National Park (`cuva`)
4. Hawaiʻi Volcanoes National Park (`havo`)
5. Buffalo National River (`buff`)

Expected bounded output is 131 children after identity-semantic deduplication
of the two Hawaiʻi Devastation Trail records. Retain the rights-backed
trailhead record unless the cached evidence proves distinct reader value.

Close the named audit findings before acceptance: Camp Lonesome, Brecksville
Station, Boxley Grist Mill, Hōlei Sea Arch, Bobcat Boardwalk, Buffalo Point,
Rush Mine, nine parent-page URL fallbacks, and five shared-coordinate warnings.
Images remain governed by the existing exact-page, NPS-credit rights policy.

## Inputs

- Base catalog:
  `data/explore/audit_candidates/combined/live-20260801-b08-operational-r8/explore_catalog_v3_review.json`
- Base SHA-256:
  `462ab1a8313e84073b2ce5347411b25771c19ebd17079b00227deb922e18a080`
- Read-only source cache:
  `/home/sean/.openclaw/workspace/trailhead/data/explore/source_cache/nps`
- Fixture SHA-256 values:
  - `bibe`: `fe9aac8ce5049f1cc1a00551cc10ccf5bc2ac9253839045e05f68dd05e42a66d`
  - `ever`: `f2b8fe33083fb19c30cecf45010567635d458df37eeca49cd5ee3db7046bc783`
  - `cuva`: `575005f160ad7d4417477d88f6ff19f7f3596c01b83bf142f3ce5021bfe6c6bc`
  - `havo`: `818a748b14a25b7aa4efeb35624b61076d4bcbba79c7bd15b354bb06b7a62985`
  - `buff`: `91e27db7598fa1202e03e2152215545ef0f614afccc13c748f95802891499baf`
- Provider/network requests allowed: `0`

## Verification required

- Candidate and independent rebuild have identical relative-file hashes.
- Schema, identity, source resolution, coordinates, module/category alignment,
  URLs, exact-image identity and rights, copy, ordering, and review metadata
  pass focused tests.
- Each parent-page source fallback and each shared-coordinate cluster is
  explicitly reviewed in immutable diagnostics.
- Run focused tests through `uv run --with pytest --with-requirements
  requirements.txt python -m pytest ...`, Python compilation, and
  `git diff --check`.
- Complete an independent read-only Builder→Auditor handoff before acceptance.

## Background processes

No Metro, Gradle, Maestro, Railway, EAS, provider-fetch, or candidate-build
process was started by this packet at checkpoint time. Existing host processes
belong to other tasks and must not be stopped.

## Exact next action

Add Batch 3 as a selectable cached-only preset without changing Batch 1's
default. Build one disposable candidate to resolve exact stable IDs, then apply
identity-bound classification and copy corrections, generate the immutable
candidate plus byte-identical rebuild, and run the focused audit.

## Do not repeat

- Do not rebuild or refetch Batch 1 or Batch 2.
- Do not spend NPS API quota or use network fallback.
- Do not integrate the internal-preview sidecar in this packet.
- Do not deploy, promote, publish an OTA, or alter public feature stages.
- Do not repeat production, Map, Search, Layers, campground, Trails,
  Originals, Android Auto, Memory, or screenshot work.

## Build checkpoint — 2026-08-02 00:16 CDT

- Frozen implementation commit: `c1a18bcc`
- Candidate:
  `data/explore/audit_candidates/internal/post-b08-nps-child-depth-b3-r5`
- Independent rebuild:
  `data/explore/audit_candidates/internal/post-b08-nps-child-depth-b3-r5-rebuild`
- Candidate and rebuild are byte-identical:
  - `audit.json`: `d811752e6975efd16a4327567340b9c8dcfff2c87130fb3729d982d77dad47a6`
  - `manifest.json`: `565cd7db018ae5f0f7b550b50fd4fade8dd821ae823b91c1719056c63d2fdad4`
  - `nps_child_depth_v1.json`: `db4f0b94bcde127a903f4db9c1ef91b43d98149c72e016c2b47b8a0ce051ced5`
  - `review.json`: `7ae2871be90b5e628e4a719202c45e700eaeb842e8451cbe20cc4893c687d348`

### Accepted output profile

- Total: `131` children with stable, unique identities.
- Destination counts: Big Bend `30`, Everglades `27`, Cuyahoga Valley
  `21`, Hawaiʻi Volcanoes `25`, and Buffalo National River `28`.
- Module counts: Stay `20`, Visitor Information `17`, Activities `13`,
  Trails `52`, and See `29`.
- Media: `131` candidate images, `111` exact-page rights-approved images,
  and `20` conservatively stripped images.
- Provider requests: `0`.
- Live catalog modified: `false`.
- Live serving index modified: `false`.
- Promotion ready: `false`.

### Named audit decisions closed

- Semantically deduplicated the two Hawaiʻi `Devastation Trail` records and
  retained the rights-backed official trailhead record.
- Classified `Camp Lonesome` as Stay/campground, `Brecksville Station` and
  `Boxley Grist Mill` as See/historic sites, and `Hōlei Sea Arch` as an
  activity rather than a named trail.
- Repaired the Bobcat Boardwalk distance, Buffalo Point Recreation.gov copy,
  and Rush Mine distance wording.
- Recorded exactly `9` parent-page URL fallbacks and exactly `5` reviewed
  shared-coordinate clusters in immutable review diagnostics.
- Preserved the exact-page HTTPS NPS media plus unambiguous NPS-credit rights
  policy.

### Compatibility and verification

- Batch 2 rebuild remains byte-identical to its accepted r7 artifacts.
- Batch 3 changes produce no additional Batch 1 drift when compared with the
  current unmodified builder baseline.
- Focused builder/candidate/Batch 2 suite: `18 passed`.
- Broader Explore/NPS/source/search suite after isolated schema initialization:
  `167 passed`, `17 subtests passed`, `15 warnings`.
- Python compilation passed for the builder and both Batch 3 test files.
- `git diff --check` and cached-diff checks passed.
- The staged file set contained only the builder, tests, and final r5/rebuild
  artifacts. Protected-file hashes remain exactly those recorded above.
- Independent read-only audit accepted exact commit `c1a18bcc`:
  - Candidate and rebuild hashes are identical for all four artifacts.
  - All `131` children resolve to their pinned cached source objects.
  - All retained media URLs, credits, and evidence hashes resolve under the
    exact-page NPS-rights policy.
  - The `9` actual missing child URLs exactly match the documented parent-page
    fallbacks.
  - The one semantic dedupe, five coordinate reviews, and every named
    classification/copy fix were independently verified.
  - Requests remain `0`; the artifacts are internal and non-promotable.
  - P0: none. P1: none. P2: none.

### Background processes

No task-owned candidate build, test, auditor, Metro, Gradle, Maestro, EAS,
Railway, or provider-fetch process remains running.

### Exact next action

Integrate the accepted immutable r5 artifacts into a separately checkpointed
internal-preview packet. Bind Batch 3 after Batch 1 and Batch 2, retain the
legacy Batch 1 binding, require authenticated administrator plus internal
preview header, and do not alter the protected serving index.

### Do not repeat after acceptance

- Do not rebuild Batch 3 or spend NPS API quota.
- Do not integrate draft r1–r4 artifacts.
- Do not integrate, deploy, promote, or run device crawls from this branch.
- Do not rerun the complete Explore/NPS suite unless the accepted artifacts or
  builder change.
