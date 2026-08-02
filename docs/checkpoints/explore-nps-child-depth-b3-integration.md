# Explore NPS Child Depth Batch 3 — Internal Preview Integration

Pre-change checkpoint created 2026-08-01 23:37 CDT
(America/Winnipeg).

## Resume first

- Branch: `feat/nps-child-depth-b3-integration`
- Isolated registered worktree:
  `/mnt/c/Users/User/Documents/Codex/2026-07-15/awesome-github-plugin-github-openai-curated/trailhead-nps-b3-integration-wt`
- Pre-change HEAD: `5158ef7cf30ba1e0da17b31989a4ef70a1e49652`
- Scope: add the accepted Batch 3 r5 children to the authenticated internal
  Explore sidecar after Batch 1 and Batch 2.

## Protected scope

`.cursor/`, `dashboard/explore_serving_index_v2.json`, and
`docs/app-store-copy.md` are outside this packet. They must not be read,
modified, staged, or committed.

## Accepted immutable Batch 3 input

- Directory:
  `data/explore/audit_candidates/internal/post-b08-nps-child-depth-b3-r5`
- Logical batch ID: `post-b08-nps-child-depth-b3`
- Records: 131
- Audit SHA-256:
  `d811752e6975efd16a4327567340b9c8dcfff2c87130fb3729d982d77dad47a6`
- Manifest SHA-256:
  `565cd7db018ae5f0f7b550b50fd4fade8dd821ae823b91c1719056c63d2fdad4`
- Child artifact SHA-256:
  `db4f0b94bcde127a903f4db9c1ef91b43d98149c72e016c2b47b8a0ce051ced5`
- Review SHA-256:
  `7ae2871be90b5e628e4a719202c45e700eaeb842e8451cbe20cc4893c687d348`
- Provider/network requests: 0
- Promotion ready: false

## Required integration behavior

- Preserve exact child order: Batch 1, then Batch 2, then Batch 3.
- Require 457 unique child identities.
- Keep compatibility `candidate.nps_child_depth` bound to Batch 1.
- Add all three immutable bindings to `candidate.nps_child_depth_batches`.
- Keep every child hidden from Featured and available only through the
  authenticated internal-preview request context.
- Do not add a public endpoint, public catalog entry, mobile change, or native
  change.

## Exact next action

Pin the four accepted Batch 3 paths and hashes in the internal-preview builder,
extend sidecar QA and the existing integration characterization, regenerate the
sidecar atomically, prove an independent rebuild is byte-identical, and run the
focused Explore suite after normal database initialization.

## Do not repeat

- Do not rebuild or refetch Batch 1, Batch 2, or Batch 3.
- Do not rerun broad mobile, Map, Layers, Trails, Originals, Memory, Android
  Auto, or screenshot work.
- Do not deploy or promote this packet publicly.

## Completion checkpoint

Completed 2026-08-02 00:12 CDT (America/Winnipeg) from branch
`feat/nps-child-depth-b3-integration`.

- Baseline checkpoint commit: `c6cfebaee97298cf6334a4b9da83c73d0695fdaa`.
- Accepted Batch 3 was appended after Batch 1 and Batch 2 without refetching or
  rebuilding any accepted input.
- The compatibility field `candidate.nps_child_depth` remains bound to Batch 1.
- `candidate.nps_child_depth_batches` is exactly ordered Batch 1, Batch 2,
  Batch 3 and contains each immutable accepted binding.
- The combined child list contains 457 unique records in accepted source order.
- Duplicate child identities fail the pure combine step.
- Generated sidecar:
  - Path: `dashboard/explore_internal_preview_v1.json`
  - Bytes: `4742342`
  - SHA-256:
    `98d23649e54d4ab02cf5a0f2193f30e826dd17527271b5ef6429667a91b28b62`
  - Proof hubs: 13
  - NPS proof hubs: 6
  - Reviewed replacements: 5
  - Children: 457
- An independent build at `/tmp/explore_internal_preview_b3_rebuild.json`
  produced the same byte count and SHA-256 and passed `cmp` byte-for-byte.
- Sidecar QA passed with exact accepted paths, hashes, order, and counts.
- Authorization remains unchanged: internal data stage, authenticated admin,
  and the internal-preview header are all required. The header alone is not a
  credential. Search/detail/parent rails remain absent outside that context.
- Focused integration tests: 14 passed.
- Focused Explore/Search/source/promotion-gate suite: 199 passed plus 21
  subtests.
- Python compile and `git diff --check`: passed.
- Read-only audit found no P0/P1. Its single P2 was closed before commit:
  standalone QA now independently hashes every accepted manifest, artifact,
  audit, and review file for all three batches; a drift fixture proves failure.
- Open P0/P1/P2: none at checkpoint time.
- Task-owned background processes: none.
- Protected files were not opened for this packet; their hashes were
  intentionally not recomputed. Git status contains no protected path.

## Exact next action after merge

Review and merge the isolated branch. A later, separately authorized packet may
deploy the authenticated internal sidecar and run a bounded Android proof. This
checkpoint does not authorize deployment, public promotion, serving-index
mutation, native work, or mobile code changes.
