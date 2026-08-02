# Explore NPS Child Depth Batch 2 — Internal Preview Integration

Implementation checkpoint created 2026-08-01 22:55 CDT
(America/Winnipeg).

## Resume first

- Branch: `feat/nps-child-depth-b2-integration`
- Isolated registered worktree:
  `/mnt/c/Users/User/Documents/Codex/2026-07-15/awesome-github-plugin-github-openai-curated/trailhead-nps-b2-integration-wt`
- Pre-change HEAD: `7f8546d6363bb6bb262d98ab9d4fdf35213ad2bf`
- This packet changes only the authenticated internal Explore preview. It does
  not modify the public serving index, public feature stage, mobile runtime, or
  production OTA matrix.

## Protected files

Never stage or modify `.cursor/`, `dashboard/explore_serving_index_v2.json`, or
`docs/app-store-copy.md`.

Tracked protected hashes in this isolated worktree:

- Explore serving index:
  `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`
- App Store copy:
  `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`

The user-owned dirty versions remain preserved only in the main worktree:

- Explore serving index:
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- App Store copy:
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`

## Integrated immutable inputs

The builder now accepts exactly two pinned child-depth inputs and concatenates
them in deterministic batch order:

1. Batch 1 r7: 156 accepted official NPS children.
2. Batch 2 r7: 170 accepted official NPS children.

Cross-batch duplicate stable IDs fail the build. Both batches remain
`promotion_ready: false` and cannot be substituted through command-line paths.
The compatibility `candidate.nps_child_depth` binding continues to identify
Batch 1; the complete ordered bindings live in
`candidate.nps_child_depth_batches`.

## Generated internal sidecar

- Path: `dashboard/explore_internal_preview_v1.json`
- SHA-256:
  `b21c1eb0e32960c2c46bb13e9b20beb698074df6efcceb06fa37bab9ae4a0d2a`
- Bytes: 3,990,183
- Proof destination profiles: 13
- Official NPS children: 326
- Child order: exact Batch 1 r7 order followed by exact Batch 2 r7 order
- Public serving index modified: false
- Provider/network requests: 0

An independent `/tmp` rebuild produced the same byte count and SHA-256. Both
the tracked artifact and rebuild passed
`qa_explore_b08_internal_candidate.py`.

## Reader behavior and authorization

- Batch 2 children resolve through the existing shared detail and parent-hub
  systems; no parallel endpoint or mobile store was added.
- Search V2 injects only unique exact stable-ID/title/alias matches within an
  authenticated internal-preview request and retains its existing filter,
  scope, bounds, category, cursor and pagination rules.
- Parent hubs expose source-backed Stay, Trails and Visitor Information rails
  from the accepted children.
- The existing authorization boundary remains mandatory:
  `TRAILHEAD_EXPLORE_DATA_STAGE=internal`, authenticated administrator, and
  `X-Trailhead-Explore-Preview: internal`. The header alone is not a credential.

## Verification

- Batch 2 integration characterization: 10 passed.
- Focused Explore/NPS/serving/source/content/Search suite: 180 passed plus 17
  parameterized subtests.
- Official-place enrichment after normal database initialization: 24 passed.
- Sidecar QA: passed for tracked artifact and independent rebuild.
- Deterministic byte comparison: passed.
- Python compilation: passed.
- `git diff --check`: passed.
- Open P0/P1: none.
- Native or public API changes: none.

The official-place test module assumes the application database schema has
been initialized. A new isolated worktree initially exposed that pre-existing
test-harness dependency; running the normal `db.store.init_db()` startup path
restored its 24/24 baseline without changing application code.

## Intentional files

- `dashboard/explore_internal_preview_v1.json`
- `scripts/build_explore_internal_preview.py`
- `scripts/qa_explore_b08_internal_candidate.py`
- `tests/test_explore_nps_child_internal_preview.py`
- `docs/checkpoints/explore-nps-child-depth-b2-integration.md`

## Background processes

No task-owned Metro, Gradle, Maestro, provider-fetch, candidate-build, EAS, or
Railway process remains running at this checkpoint.

## Exact next action

Commit and push only the intentional files, merge the integration branch into
`feat/trailhead-1.0.10-overhaul`, deploy the backend, verify health and the
authenticated-preview boundary, then run one bounded Android delta through a
Batch 2 park hub, child detail, Search, Map and Back. Stop before public catalog
promotion.

## Do not repeat

- Do not rebuild or refetch Batch 1 or Batch 2.
- Do not repeat production OTA, Map, Layers, campground, Trails, Originals,
  Android Auto, Memory, NPS research or screenshot work.
- Do not publish these children into the public catalog.
- Do not overwrite or stage the user-owned Explore serving index.
