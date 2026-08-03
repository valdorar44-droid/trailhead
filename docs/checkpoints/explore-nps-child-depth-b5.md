# Explore NPS Child Depth Batch 5 Checkpoint

Pre-change checkpoint created `2026-08-02T23:14:18-05:00`
(America/Winnipeg).

## Resume first

- Branch: `feat/explore-nps-child-depth-b5`.
- Isolated registered worktree:
  `/home/sean/.openclaw/worktrees/trailhead-explore-nps-child-depth-b5`.
- Pre-change HEAD: `d413e5c2ff382fac518de013843181f809eac780`.
- B4 is accepted, deployed internally, and physically proven through Hot
  Springs National Park -> What to See -> Hot Water Cascade -> Show Area ->
  Back. Do not reopen B4 without new evidence.
- This packet is cached-only and internal. It must not fetch NPS data, mutate
  the public catalog or serving index, promote Community routes, publish a
  mobile OTA, or change a feature stage.

## Protected files

Never stage, overwrite, or discard:

- `.cursor/`
- `dashboard/explore_serving_index_v2.json`
- `docs/app-store-copy.md`

The protected main-workspace hashes are:

- Explore serving index:
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- App Store copy:
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.

## Exact B5 packet

Build one conservative cached-only candidate from five official NPS source
packs:

1. Capitol Reef National Park (`care`).
2. Great Sand Dunes National Park & Preserve (`grsa`).
3. Crater Lake National Park (`crla`).
4. Assateague Island National Seashore (`asis`).
5. Amistad National Recreation Area (`amis`).

The conservative source pass produces 71 records. The official
`Driving the Burr Trail` activity duplicates an already represented route and
must receive one explicit identity-bound omission, leaving 70 reviewed child
records. Accepted modules are Stay 21, Visitor Information 10, Trails 14,
Activities 6, and See 19.

The first bounded Android proof after integration is:
Great Sand Dunes -> Things to Do -> Sandboarding and Sand Sledding -> Show
Area -> Back. Its official source identity is
`DF98997D-01FC-4016-A90C-53DBC7FAAE4D`.

## Pinned inputs

- Base catalog SHA-256:
  `462ab1a8313e84073b2ce5347411b25771c19ebd17079b00227deb922e18a080`.
- Normalized b09 NPS catalog SHA-256:
  `8bc319b8b230d4272778671318903c9e0e05844b7c5a5d11d8f81438a1584c80`.
- Read-only NPS fixture SHA-256 values:
  - `care`: `424f8269f81003d7be35686b0cb99bbaf7f61bc5246b1919385c1c12509f8ec0`
  - `grsa`: `ae955fb4da77e960084f7fb5682403e84ad8dd1c578a5f1e8b4aee78e8d9076f`
  - `crla`: `b0dc60a0da58fb892b402f4ba1099b09be8e2bab98753b920333bc9ace716ac4`
  - `asis`: `99f67f343909305e420a815e19b86c6fcb93b02ee539b5cf2bf63ac75edcd275`
  - `amis`: `03d74c7bf80a99e169f9e29eb4023b6087f3e9afb832733130661fa8f2e46462`
- Provider/network requests allowed: 0.

## Required review

- Retain only exact rights-approved official media. The current expected result
  after the Burr Trail omission is 64 images and six honest text-only records.
- Bind classification and copy corrections to exact source identities; do not
  add keyword-wide rewrites.
- Remove raw markdown, bare URLs, volatile availability claims, provider copy,
  and unsupported access or safety certainty.
- Review every shared-coordinate cluster and duplicate explicitly.
- Require valid public parents, module alignment, stable identities, exact
  source links, deterministic order, and byte-identical independent rebuilds.
- Fire Island remains held outside this packet.

## Exact next action

Add the B5 preset and immutable input hashes to the conservative builder,
generate a disposable candidate, finish exact-record classification/copy/
duplicate review, then generate one immutable candidate and independent
rebuild. Integrate and deploy only after the cached candidate passes.

## Do not repeat

- Do not refetch b08, b09, B1-B4, or any source fixture.
- Do not repeat broad Explore/NPS, Layers, Search, Memory, Originals, Trails,
  or Android Auto crawls.
- Do not modify the public catalog or serving index.
- Do not activate advisory aliases or Community routes.
- Do not use Fire Island in this packet.

## Background processes

No task-owned Metro, Gradle, Maestro, Expo/EAS, Railway-tail, provider-fetch,
or candidate-builder process is running at checkpoint creation.

## Candidate completion checkpoint

Recorded `2026-08-03` after implementation commit
`99f66036c2c37e842ab2e947878933b781d01c1b`.

- Branch: `feat/explore-nps-child-depth-b5`.
- Candidate: `post-b09-nps-child-depth-b5-r1`.
- Independent rebuild: `post-b09-nps-child-depth-b5-r1-rebuild`.
- Records: 70 total (`care` 20, `grsa` 14, `crla` 12, `asis` 14,
  `amis` 10).
- Modules: Stay 21, Visitor Information 10, Activities 6, See 19,
  Trails 14.
- Media: 69 candidates, 64 approved, five stripped, six honest text-only
  records.
- Campgrounds: 20 existing canonical campground identities reused as child
  shadows; 13 booking links, 19 official links, and 18 exact approved images
  preserved. No duplicate NPS-child campground identity is emitted.
- Exact omission: the duplicate Capitol Reef `Driving the Burr Trail`
  activity only.
- Shared-coordinate clusters: zero.
- Provider/network requests: zero.

Artifact SHA-256 values:

- `audit.json`:
  `d86d58c6b0f236297d3f606a1a053e61f25fe82c2ac69f0e4a339f4a84b70296`.
- `manifest.json`:
  `d9f7ed993c23051fb53e9bf47392c057fda8fed2833f4923e2a3aeea23054150`.
- `nps_child_depth_v1.json`:
  `e3c4d0763d3a2be8d84d462dc3f892a444cb98781eea0d4227dc1b1b3b2fa0da`.
- `review.json`:
  `8029b3434db17daf361d353a5c1c5148977921b7faffce8cf400c90ddfb052be`.

Verification:

- 48 focused B1-B5, media-rights, reader-link, and Explore copy-quality
  tests passed.
- Python compilation and whitespace checks passed.
- Candidate and independent rebuild are byte-identical.
- A read-only auditor found one parent-fallback identity issue before commit;
  the review now names the final canonical campground ID.
- No P0/P1 remains in the immutable candidate.

### Exact next action

Create a clean B5 integration worktree from accepted B4 integration commit
`d1d997123be92602fb9252427d1cdf42854b9a93`, add this fifth immutable batch to
the internal sidecar, verify all 860 children and canonical campground detail
merges, then deploy the backend internally. After terminal Railway success,
run only Great Sand Dunes -> Things to Do -> Sandboarding and Sand Sledding ->
shared detail -> Map -> Back on Android.

### Do not repeat after candidate acceptance

- Do not rebuild or reaudit B1-B4.
- Do not refetch any NPS data.
- Do not manually reclassify the accepted B5 records without new source
  evidence.
- Do not run a broad Explore crawl; the next device test is the single Great
  Sand Dunes proof path.

### Background processes at completion

No candidate builder, pytest, Metro, Gradle, Maestro, Expo/EAS, or Railway-tail
process is running. A separate authorized host-cleanup task may still be
removing rebuildable caches; it does not touch this worktree or its artifacts.
