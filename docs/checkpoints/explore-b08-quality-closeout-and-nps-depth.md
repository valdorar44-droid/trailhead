# Explore b08 Quality Closeout and NPS Child Depth Checkpoint

Checkpoint created 2026-08-01 19:47 CDT (America/Winnipeg).

## Resume first

- Branch: `feat/trailhead-1.0.10-overhaul`
- Pre-change HEAD: `c121153b3018299f712f009d5e6af670080aecf9`
- Implementation commit: `3544360475df8ce53e7f1a18de673b56eff80eef`
- Protected Explore index SHA-256: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- Protected App Store copy SHA-256: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`
- Never stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, or
  `docs/app-store-copy.md`.

Production OTA and Railway backend delivery are already complete at release
source `c1155793`. Do not repeat that release work or publish another OTA for
this cached-data packet.

## Quality defects closed

- USFS explicit site types now outrank incidental name tokens. `Central Camp
  Springs` is an activity, not a campground, and `Bass Lake Recreation Office
  Info Site` remains a visitor-information place rather than a water stop.
- Concrete short official descriptions for boat launching, boat ramps, and
  trailhead parking remain visible. The general weak/generic-copy rejection
  threshold was not relaxed.
- Facts-only activities and visitor-information records omit weak narrative
  text instead of receiving generic guidance.
- A contradictory `Closed` hours value is suppressed only when the same USFS
  record's authoritative status is `Open`.
- Florence Lake Boating Site and Florence Lake Picnic Site remain distinct,
  source-backed co-located facilities.
- Fisher Towers Hiking Trail remains a separate trailhead identity and now has
  an explicit stable-ID relationship to the official Fisher Towers recreation
  record. Only its reviewed official URL, contact phone, and operating season
  are shared. Fee, climbing activity, and unlicensed Flickr media remain scoped
  to the recreation record and are not copied.
- PR Springs Horse Corral remains sparse because its cached source does not
  provide the missing reader facts. Nothing was inferred from its name.

## Immutable cached candidate

Candidate:
`data/explore/audit_candidates/agencies/post-b08-explore-quality-r3`

Independent rebuild:
`data/explore/audit_candidates/agencies/post-b08-explore-quality-r3-rebuild`

Both builds reused
`live-20260801-b08-operational-r8/source`, used fixed timestamp `1785553072`,
and report `requests_used: 0`, `promotion_ready: true`, and
`live_serving_index_modified: false`.

- Candidate files: 23
- Rebuild files: 23
- Differing relative-file hashes: 0
- Manifest SHA-256: `7acb5147834d5b9f7133fe268f0c5cde19d6239ff032c14b4d7e3d7a463c8018`
- Catalog SHA-256: `a1503e0d5b7cf63c514a334705084671c24c540967971730a3e8661b772a3ea2`
- Places SHA-256: `b7fa5aa66de0a82da8882f919c5da3f2141eddba6e1b7bfbc1f6c7cdd365a07a`
- Accepted cards: 108
- Provider requests: 0

The content-quality gate passes. Six remaining raw weak-description warnings
are intentionally sanitized to facts-only presentation. The single duplicate
coordinate warning is the reviewed Florence Lake boating/picnic co-location,
not an entity duplicate.

## Verification

- Python compilation passed.
- Final combined agency, quality, determinism, combined-candidate, promotion,
  and QA regression suite passed: `57 passed, 4 subtests passed`.
- App-facing content-quality audit: `PASS`.
- `git diff --check` passed for the packet files.
- Open P0/P1: none.
- Task-owned provider fetch, Metro, Gradle, Maestro, EAS, Railway, or recording
  processes: none. A separate cached-only NPS Batch 1 build is active in an
  isolated worktree.

## Next exact packet

Build the immutable internal **NPS Child Depth Batch 1** from existing cached
NPS records only for:

1. Blue Ridge Parkway
2. Sequoia and Kings Canyon National Parks
3. Bryce Canyon National Park
4. Shenandoah National Park
5. Dinosaur National Monument

Apply existing conservative endpoint and per-destination caps. Validate source
URLs, module targets, duplicates, media rights and exact-place identity,
deterministic ordering, and real-data-only copy. Keep the candidate internal;
do not mutate the protected serving index, deploy, fetch NPS data, or promote a
public catalog.

## Do not repeat

- Production OTA/backend release, Memory Gate, Layers, Yellowstone Search,
  NPS rabbit-hole research, Trails T1-T6, Originals, Android Auto, broad Map
  crawls, or screenshot work.
- Historical b06/b08 provider fetches or any provider-quota spend.
- BLM reader-depth r2 or this r3 deterministic build without new evidence.
- Public Explore/catalog promotion, Community-route exposure, Safe Water,
  CarPlay, advertising, or store-asset work.
