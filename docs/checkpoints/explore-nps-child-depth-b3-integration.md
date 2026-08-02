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

## Post-merge deployment and Android evidence — 2026-08-02

### Internal backend deployment

- Integrated backend HEAD:
  `767dc641de72353a8f1ca2e7865025f11473dabf`
- Railway deployment:
  `4fb0d22a-b0c4-407a-a7d7-91b57a305c57`
- Terminal status: `SUCCESS`
- Image digest:
  `sha256:f2b99e1d5b2ea4c441f8cbd6024f98920e228a82c33150392f3d89f053adaa88`
- Production API health: `ok`
- Header-only internal-preview request: `401`
- Public catalog or serving-index promotion: none

The initial Samsung proof found that a Search V2 campground selection could
restore an older mounted destination hub after returning from the Map. The
evidence-backed cause was reuse of the hub-child handoff for a direct search
selection. Commit `d2b8b4501d9a3c99cc99aac4c34178e7a3a496a6` added an explicit
`hub|search` origin: hub children still preserve their parent, while search
selections synchronously clear stale hub navigation before opening the Map.

### Paired preview correction

- Merged preview source:
  `d9e58592ed29d5857236d555bdbd73baadceec87`
- Preview branch:
  `preview-candidate-d9e58592ed29d5857236d555bdbd73baadceec87-msbcovpp-e9291d4a7edd3ad500215609`
- Preview channel ID:
  `019dbc97-3cde-795b-a35d-e6aa985060d3`
- Android update:
  `019fc0f0-c167-7adb-8574-927d3bc26e1a`
- Android group:
  `68a56093-0e2e-43fd-a55f-9615e56f2c86`
- Android runtime: `native-1.0.10-android.7`
- iOS update:
  `019fc0f1-18c5-7b67-84c2-ebe924081b29`
- iOS group:
  `a3982087-4039-4747-bebb-fd2043cc38fc`
- iOS runtime: `native-1.0.10-ios.6`
- Android and iOS Sentry source maps: uploaded

Focused automated coverage passed: Search V2 76/76, NPS hub/return 22/22,
sheet actions 8/8, campground 31/31, copy scan 175 files, privacy, telemetry,
TypeScript, and `git diff --check`.

### Bounded device result

On Samsung SM-A326U1, the newly integrated `Chisos Basin Campground` exact
result searched correctly, opened the stable campground Peek, expanded to the
full detail, and no longer restored Guadalupe Mountains after Back. It reached
the correct Explore home context. Focused logcat contained no fatal, React,
Map, or ANR error.

Open P1: the first post-Back screenshot, taken after four seconds, contained a
black content frame even though its UI hierarchy already described the correct
Explore home. Five seconds later the same hierarchy rendered normally. Per the
one-correction rule, no second speculative fix was applied and this preview is
not promoted to production.

Evidence directory:
`C:\Users\User\Documents\Codex\evidence\trailhead\explore-nps-child-b3-d9e58592`

- Black-frame evidence:
  `6f70b8c52e83ccb100ff91bb9f65111871aa17d204abad8bd9fcd2236c6b0c81`
- Settled correct Explore home:
  `15cf29cd0e026641eb7e2263ddfff5db87e5f98a44721a5509c600c7037b3751`
- Shared UI hierarchy for both captures:
  `a81bbfe18ac384d5859f31a802b4f066325a909ec12a309c53c69545806747d1`
- Empty focused error log:
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

Exact next action: diagnose the render-only warm-return black frame from this
single evidence set before promoting the JS correction. Do not refetch or
rebuild the accepted NPS batches, and do not repeat the broader Explore crawl.

## Evidence correction — 2026-08-02

The reported render-only black frame was a viewer artifact, not an application
frame. Both saved PNG files decode as the same complete Explore home:

- `04-back.png` and `05-back-settled.png` are both 720 x 1600 RGB captures.
- Only 127 of 1,152,000 pixels differ (0.011%).
- The difference bounds are `(558, 16, 589, 36)`, entirely inside the Android
  status bar.
- The mean absolute RGB difference is `(0.0022, 0.0030, 0.0042)`.
- The saved SHA-256 values still match the hashes recorded above.
- Focused logcat remains empty.

The source review also found no Explore visibility suppression: the Explore
root remains mounted with an explicit background, screen activity pauses work
without hiding the UI, and the direct-search campground handoff clears the
stale hub before opening Map. The prior black rectangle appeared only while the
second PNG was being rendered by the evidence viewer.

Open P0/P1 after evidence correction: none. No Mapbox, lifecycle, or mobile
code change is warranted, and no corrective OTA should be published for this
false positive.

Exact next action: run the bounded shared-flow checks on the iPhone, then apply
the already tested direct-search return-context correction to a clean
1.0.11-production descendant. Prove native-input compatibility before moving
the production channel. Do not repeat the NPS batches, Explore crawl, Mapbox
lifecycle work, or the Android return-context investigation.
