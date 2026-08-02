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

## NPS Child Depth Batch 1 accepted — 2026-08-01 20:23 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`
- Pre-fix batch HEAD: `29ec461d`
- Accepted implementation commit: `ed27248cd7ef670b8bee3619594facf2f82e73c4`
- Protected Explore-index SHA-256 remains
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- Protected App Store copy SHA-256 remains
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- `.cursor/` and both protected files remain unstaged and unmodified by this
  packet.

Accepted cached-only candidate:
`data/explore/audit_candidates/internal/post-b08-nps-child-depth-b1-r7`

Independent rebuild:
`data/explore/audit_candidates/internal/post-b08-nps-child-depth-b1-r7-rebuild`

- Official NPS child records: 156
- Destination counts: Blue Ridge 36, Sequoia/Kings Canyon 36, Bryce Canyon
  25, Shenandoah 28, Dinosaur 31
- Module counts: Stay 36, Visitor Information 21, Activities 12, Trails 42,
  See 45
- Approved exact-page images: 104; conservatively stripped images: 52
- Provider requests: 0
- Promotion ready: false; live catalog and serving index modified: false
- Candidate/rebuild differing file hashes: 0 of 4
- Manifest SHA-256:
  `6956e4b8bdc238501feee49215470e6d0a8785be31188fbddcc2abe7c196266d`
- Sidecar SHA-256:
  `66abda311a4734cc05bf3b4d9c99834cd5d3ec119e5a295e68b6cb7a3199ade9`
- Audit SHA-256:
  `b5fc24c29e376a20d694c339d23c636c3937092669e52d998795a0981d251923`
- Review SHA-256:
  `8ecfe03c074dd0da8a753693db801651d73b08610af82a009a7fcde1b376aee1`

### Defects closed

- NPS stable item IDs now own canonical child identity. Same-name records are
  deduplicated only within the same park and endpoint, so the separate Sequoia
  and Bryce `Sunset Campground` records both survive.
- Trail classification now uses endpoint, structured activities/tags, explicit
  trailheads, and strong place semantics. Ranger walks, gazebos, waysides,
  trail stops, petroglyph exhibits, waterfalls, and overlooks no longer enter
  the trail lane because of incidental title or hiking words.
- Page-scoped imagery requires approved rights evidence from that exact NPS
  page. Reused-image approval from a different page is rejected.
- Rejected third-party URLs are absent from search data and all reader-facing
  summary/description/card/source-pack copy. `Aspen Hollow Campground` now uses
  its useful cached body facts without the malformed external-link sentence.
- Candidate outputs are restricted below `data/explore/audit_candidates`, and
  manifests use stable logical input references rather than checkout paths.

### Verification

- Final focused Explore/NPS/source/internal-preview suite: `85 passed`.
- Identity/media/batch suite: `25 passed`.
- Content-quality QA: `PASS`; nine reviewed coordinate clusters are distinct
  official records sharing access points, not duplicate identities.
- Python compilation and `git diff --check`: passed.
- Independent read-only final audit: no P0/P1/P2 blockers.
- Open P0/P1 for this candidate: none.
- Task-owned provider fetch, Metro, Gradle, Maestro, EAS, Railway-tail, test,
  or recording processes: none.

### Exact next action

Wire the accepted r7 sidecar into the existing authenticated internal Explore
preview boundary, then run one bounded Android destination flow across a rich
park and a sparse child. Preserve the requirement for internal stage,
authenticated administrator, and `X-Trailhead-Explore-Preview: internal`.
Do not mutate the protected serving index or public catalog.

### Do not repeat

- Do not rebuild r1-r6, refetch NPS data, spend provider quota, or repeat the
  completed b08/agency quality audits without new evidence.
- Do not repeat broad Map, Search, Layers, campground, Trails, Originals,
  Android Auto, Memory, or screenshot work.
- Do not publish or promote this candidate publicly until the authenticated
  internal preview and device delta are separately accepted.

## NPS child-depth authenticated preview ready — 2026-08-01 21:00 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`
- Implementation commit: `11e7b84a9c7efc037e7fe7eb59ced90f9d43ad40`
- Accepted child candidate: `post-b08-nps-child-depth-b1-r7`
- Internal sidecar SHA-256:
  `b93d785f346ac6b1b730a3778d60ac6e72fc9cc124174fb416e6bb45727ce27b`
- Sidecar contents: 13 reviewed proof hubs and 156 parent-bound NPS children.
- Protected Explore-index SHA-256 remains
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- Protected App Store copy SHA-256 remains
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- `.cursor/` and both protected files remain unstaged.

### Accepted behavior

- Reviewed children are available only inside the existing request-local
  internal-preview boundary. Ordinary Featured/category browse and facet
  counts exclude them.
- The boundary still requires internal stage, authenticated administrator,
  and `X-Trailhead-Explore-Preview: internal`; the header alone is not a
  credential.
- Parent modules preserve source-backed classifications for trails,
  trailheads, campgrounds, activities, visitor information, and scenic
  places. Endpoint type is only a fallback.
- Search injection is first-page exact-only. Stable IDs always match; titles
  and aliases match only when unique across the accepted batch. Category,
  intent, filters, bounds, nearby/route scope, offline mode, and cursor rules
  reuse Search V2 contracts.
- Internal enrich and bulk hydration skip shared public response caches, so a
  reviewed child cannot leak into a later public request.
- The builder hard-binds all four immutable r7 artifacts by exact path, hash,
  batch ID, audit result, and non-promotable state.

### Verification

- Final focused backend suite: `132 passed, 21 subtests passed`.
- Independent read-only audit: no P0/P1/P2 blockers; all 330 normalized exact
  identity tokens had no multi-result collision.
- Candidate QA: 13 proof hubs, 156 children, pass.
- Deterministic rebuild matched the sidecar byte for byte.
- Python compilation and `git diff --check`: passed.
- Open P0/P1: none before deployment.
- Task-owned provider fetch, Metro, Gradle, Maestro, EAS, Railway, or recording
  processes: none.

### Exact next action

Deploy exact commit `11e7b84a` from a clean detached worktree. Require Railway
terminal `SUCCESS`, health `status=ok`, header-only denial, and authenticated
internal diagnostics showing 13 hubs plus 156 children. Then run one bounded
Android rich-parent child flow and one sparse-child return assertion. No mobile
OTA or public catalog promotion is required for this backend/data-only packet.

### Do not repeat

- Do not rebuild r1-r7, refetch NPS, spend provider quota, or repeat the b08
  agency/campground audits.
- Do not repeat broad Map, Search, Layers, campground, Trails, Originals,
  Android Auto, Memory, or screenshot work.
- Do not stage the protected serving index, App Store copy, or `.cursor/`.

## NPS child-depth internal deployment and Android acceptance — 2026-08-01 21:22 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; deployed implementation commit
  `11e7b84a9c7efc037e7fe7eb59ced90f9d43ad40`; checkpoint HEAD before this
  append: `c03f5091082cad95ea180794057ed81e236418ca`.
- Railway deployment `b2fbc963-fe48-40ac-855b-6cc72c1ea081` reached terminal
  `SUCCESS` with image digest
  `sha256:111fc629df7685c8c9bea8527b2f2a2fc9ea612f790145830c0000ee8f83a9e9`.
  `https://api.gettrailhead.app/api/health` returned `status=ok`, and the
  internal-preview header without a bearer token returned `401`.
- The protected Explore-index SHA-256 remains
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`;
  the protected App Store copy SHA-256 remains
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  `.cursor/` and both protected files remain unstaged.
- Samsung `SM_A326U1`, app `1.0.10` build `69`, loaded preview source
  `2d5f9de6c461904e4667b3b9dba6aff538ac30c4`, runtime
  `native-1.0.10-android.7`, update
  `019fbf59-81ed-7890-babc-065de79576a8`. The admin QA screen reported the
  internal request active, data ready, and all 13 reviewed profiles available.
- Exact internal Search V2 resolved `Fossil Discovery Trail - Visitor Center
  Trailhead` as a Trailhead child of Dinosaur National Monument. Selection
  opened a nonblank detail with the exact NPS image and source-backed copy.
- The existing rich-destination path also passed on device: Carlsbad Caverns
  hub -> What to See -> Accessibility child -> main Map shared sheet. The map
  retained the exact child identity and image, exposed the existing actions,
  and produced no fatal/JavaScript error match.
- Evidence directory:
  `C:\Users\User\Documents\Codex\evidence\trailhead\explore-nps-child-11e7b84a`.
  Key SHA-256 values: QA status
  `b16f475c58dddc7c683f4ab91096cb3c80b0ce5850a7885a53e61846898b62d9`;
  Fossil search
  `01f4e11832692a924178e87b8f96a0d8901f1849da345f42f1845668bb90cbdc`;
  Fossil detail
  `7063be9cfd6302a8b52eeaa47eb5529d7c6a6c37274a0b90df311d74ab196ca2`;
  Carlsbad module list
  `7470a10273b952c5099c2f6ad1ebf4fe721fc78e64442daf4aece92c07c385cc`;
  child detail
  `3a76f10188e3183d6fc33846021f704be15914e7b7ed4b37c486de8b7e1abe39`;
  shared Map sheet
  `10397c0a44a735b9c0936a270304a0ac916fd8ce0f4e13b26e72ecc013318deb`;
  filtered error summary
  `19eafe0accf1abb6772cb163ce10d481264f1c2a85b4b633b736bb6d9c0cee36`.
- Open P0/P1: none. Two bounded P2 presentation items are recorded rather
  than reopened in this data packet: direct child detail can display the
  legacy `Things` kicker instead of its source-backed trailhead category, and
  direct-search/Map Back does not always restore the prior child-list/search
  state. Neither changes identity, source data, or internal authorization.
- No mobile OTA or native rebuild was required. No provider request, public
  catalog promotion, serving-index mutation, or public-stage change occurred.

### Next exact packet

Build cached-only NPS Child Depth Batch 2 for Guadalupe Mountains, Olympic,
Death Valley, Joshua Tree, and Rocky Mountain. The read-only coverage audit
found 171 eligible source-backed children across all five rails: See 38,
Activities 15, Stay 53, Trails 42, and Visitor Information 23, with 151
exact-page media approvals. Keep the candidate immutable and internal, use the
accepted r7 identity/media/link gates, rebuild deterministically, and do not
refetch NPS or modify the serving index.

### Do not repeat

- Do not repeat the Batch 1 build, deployment, Android exact-child flow, broad
  Explore/Map/Search crawls, campground work, Trails, Layers, Memory,
  Originals, Android Auto, or production OTA work without new evidence.
- Do not include C&O Canal until its media gap is reviewed, Glen Canyon until
  child-specific URLs improve, or Great Smoky Mountains until its cached
  Things-to-Do classification gap is resolved.
