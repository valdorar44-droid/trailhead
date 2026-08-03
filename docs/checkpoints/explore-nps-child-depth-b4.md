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

Expected total: 97 unique children. Expected module distribution: See 47,
Trails 32, Visitor Information 7, Activities 6, and Stay 5. If accepted and
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
