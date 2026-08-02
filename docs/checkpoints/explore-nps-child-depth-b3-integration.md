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

