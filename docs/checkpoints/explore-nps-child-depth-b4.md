# Explore NPS Child Depth Batch 4 Checkpoint

Pre-change checkpoint created `2026-08-02T19:47:09-05:00`
(America/Winnipeg).

## Resume first

- Branch: `feat/explore-nps-child-depth-b4`.
- Isolated registered worktree:
  `/home/sean/.openclaw/worktrees/trailhead-explore-nps-child-depth-b4`.
- Pre-change HEAD: `95ead0b13f5b7a0a3ac2bd1c267024f2e7b2bbc6`.
- Parent checkpoint: accepted internal 693-child preview deployment at the
  same source lineage. Great Smoky Mountains physical admin proof remains one
  bounded device handoff; do not repeat its backend or OTA work.
- This packet is cached-only and internal. It must not fetch NPS data, mutate
  the public catalog or serving index, deploy, publish an OTA, or change a
  feature stage.

## Protected files

Never stage, overwrite, or discard:

- `.cursor/`
- `dashboard/explore_serving_index_v2.json`
- `docs/app-store-copy.md`

The protected main-workspace hashes remain:

- Explore serving index:
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- App Store copy:
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.

## Exact packet

Add one explicit `post-b09-nps-child-depth-b4` cached-only builder preset for:

1. Hot Springs National Park (`hosp`) — expected 24.
2. Hovenweep National Monument (`hove`) — expected 17.
3. Indiana Dunes National Park (`indu`) — expected 26.
4. Jewel Cave National Monument (`jeca`) — expected 11.
5. John Day Fossil Beds National Monument (`joda`) — expected 19.

Expected total: 97 unique children. Final reviewed module distribution: See 46,
Trails 33, Visitor Information 7, Activities 6, and Stay 5. If accepted and
later integrated, the internal preview would move from 693 to 790 children.

## Pinned inputs

- Base catalog:
  `/home/sean/.openclaw/workspace/trailhead/data/explore/audit_candidates/combined/live-20260801-b08-operational-r8/explore_catalog_v3_review.json`
- Base catalog SHA-256:
  `462ab1a8313e84073b2ce5347411b25771c19ebd17079b00227deb922e18a080`.
- Accepted normalized b09 catalog:
  `/home/sean/.openclaw/workspace/trailhead/data/explore/audit_candidates/nps/live-20260802-b09-accepted-v3/explore_catalog_v3.json`
- Normalized catalog SHA-256:
  `8bc319b8b230d4272778671318903c9e0e05844b7c5a5d11d8f81438a1584c80`.
- Read-only source cache:
  `/home/sean/.openclaw/workspace/trailhead/data/explore/source_cache/nps`.
- Fixture hashes:
  - `hosp`: `43110d2d6a2a4ed2f6624baf0810d1b5a0c6649cd74e68c101b13400ec1a0834`
  - `hove`: `8431ba41d5ab0077d96bfa2093310403c85865a6e5068da85dc44779e187c02b`
  - `indu`: `22cfaf65da51c037dc6d1583f00e57bcffb9b6d1fcb111d72ef359615a66b881`
  - `jeca`: `550106bcb79cf9f45e08a12cb02cc613aa5652b665aef3110b0f65d2d92b149b`
  - `joda`: `b80fc6eaff16fd4b18f4671bad7792855cd5c3822559884bc446ddafa68eec3b`
- Provider/network requests allowed: 0.

## Required review decisions

- Retain 86 exact rights-approved images. Keep 11 records text-only; do not
  substitute generic destination imagery.
- Review seven shared-coordinate clusters by stable identity. Shared
  coordinates alone never merge distinct official records.
- Preserve two Indiana walk-in/group campground records using their official
  parent page because the NPS records have no child URL.
- Apply the already-supported HTTPS normalization to two Indiana visitor links.
- Require zero overlap with the current 693 internal children and the 457
  reviewed public child dispositions.

## Verification required

- Candidate and independent rebuild have byte-identical relative-file hashes.
- Exact input and fixture hashes fail closed on drift.
- Schema, coordinates, stable identity, source resolution, licensing, exact
  media, copy, deterministic order, module alignment, and all seven coordinate
  reviews pass.
- Run focused cached-builder, B4 candidate, media-rights, source/link, copy,
  privacy, Python compilation, and whitespace checks.
- Produce an independent read-only audit before integration.

## Exact next action

Add the B4 preset and immutable expected hashes/counts to the existing
conservative builder without changing prior batches. Generate a disposable
candidate first, bind the seven coordinate reviews and URL decisions, then
generate one immutable candidate plus one independent rebuild.

## Do not repeat

- Do not refetch b08, b09, or any source fixture.
- Do not rebuild or alter accepted batches 1–3 or the 693-child preview.
- Do not activate the 157 advisory aliases.
- Do not include Isle Royale or Katahdin until their 36-child cap receives a
  separate completeness/pagination contract.
- Do not spend quota on b10 yet.
- Do not deploy, publish an OTA, or run device crawls from this packet.

## Background processes

No task-owned Metro, Gradle, Maestro, Expo/EAS, Railway-tail, provider-fetch,
candidate-builder, or test process is running at checkpoint creation.

## Cached candidate completion checkpoint

- Recorded: `2026-08-02T20:12:57-05:00` (America/Winnipeg).
- Branch: `feat/explore-nps-child-depth-b4`.
- Baseline checkpoint commit: `96bdcc42aaa81cac192671e22f04c37175ea8be3`.
- Delivery remains cached-only and internal. No provider request, Railway
  deployment, OTA, native build, public catalog/index change, or feature-stage
  change occurred.

### Reviewed result

- Built 97 exact official NPS children: Hot Springs 24, Hovenweep 17,
  Indiana Dunes 26, Jewel Cave 11, and John Day Fossil Beds 19.
- Modules: See 46, Trails 33, Visitor Information 7, Activities 6, Stay 5.
- Reader categories: campground 5, visitor center 7, activity 6, trail 23,
  place 16, waterfall 1, hot spring 4, historic site 11, viewpoint 14, and
  trailhead 10.
- Retained 86 exact rights-approved NPS images. The exact reviewed set of 11
  records remains text-only; no generic media was substituted.
- Preserved 93 exact child links, two reviewed Indiana parent-page fallbacks,
  and two safe HTTP-to-HTTPS NPS upgrades.
- Kept seven identity-reviewed shared-coordinate clusters distinct.
- Confirmed zero identity overlap with the deployed 693-child internal preview
  and the reviewed public child-disposition table.
- Replaced unsafe keyword classifications with identity-bound, source-backed
  decisions for Hot Springs springs/shelters, Hovenweep, Indiana Dunes, and
  John Day interpretive places. Fixed six source paragraph seams and the two
  reviewed Square Tower copy errors.

### Immutable evidence

Candidate:
`data/explore/audit_candidates/internal/post-b09-nps-child-depth-b4-r2`.
Independent rebuild:
`data/explore/audit_candidates/internal/post-b09-nps-child-depth-b4-r2-rebuild`.
Their four artifacts are byte-identical.

- `audit.json`:
  `1e29aa4f1b9e149aaf2d1b0ad61793ce636c1242525f8f560c80b56a592d07e2`
- `manifest.json`:
  `a2c8c0b91f36f88ccf80c08f76ca5b7357fa0f445622a9939c4da55d71a52f4f`
- `nps_child_depth_v1.json`:
  `bff4dbe3fae5a984083c366aa7711e2766bad2c220c71f49367f2d4a1aea247f`
- `review.json`:
  `60ccad3f4bf56f0664a53e4e1c54b175fc664f9dcbc75f629994fedc7cf48e99`

### Verification

- B1-B4 builder and candidate coverage: 22 passed.
- NPS media-rights, link safety, contract, internal-preview, and content-quality
  regression: 46 passed, 7 skipped, and 4 parameterized checks passed. Skips
  are the suite's expected optional-evidence boundaries.
- Direct content-quality audit: PASS; its seven shared-coordinate warnings are
  the same seven explicitly reviewed identity clusters.
- Candidate and rebuild are byte-identical.
- Python compilation and `git diff --check`: passed.
- Exact input and fixture hashes, category/module distributions, reader-link
  decisions, exact text-only identities, and copy repairs fail closed.
- Candidate tests no longer require absolute main-workspace inputs for their
  drift guard and remain portable once the immutable artifacts are tracked.

### Protected state

- Main-workspace Explore index remains
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- Main-workspace App Store copy remains
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- `.cursor/`, the protected Explore index, and App Store copy were not staged
  or changed.
- Task-owned Metro, Gradle, Maestro, Expo/EAS, pytest, Railway-tail, provider,
  and candidate-builder processes: none.

### Exact next action

Finish the independent read-only audit, commit and push only the builder,
candidate/rebuild, focused test, and this checkpoint. Do not integrate B4 yet.
First complete the single signed-in administrator device proof for the already
deployed Great Smoky Mountains pack. Once it passes, integrate this reviewed
97-child pack into a separately checkpointed 693-to-790 internal-preview
update and show one B4 destination before selecting another cached batch.

### Do not repeat after this checkpoint

- Do not rebuild this candidate, refetch NPS data, or rerun broad Explore/NPS
  crawls without new evidence.
- Do not weaken the image, link, classification, coordinate, or input-hash
  locks.
- Do not deploy B4, publish another OTA, activate aliases, or promote children
  publicly before the bounded Great Smoky proof and a separate integration
  checkpoint.
