# Great Smoky Mountains Original — Active Checkpoint

Last updated: 2026-08-04 (S1 routes and operations started)

## Resume protocol

Read this file before continuing the Great Smoky Mountains Original. Do not repeat the competitor, Moab pipeline, entitlement, or cleanup audits unless new evidence invalidates them.

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Confirm HEAD and protected-file hashes below before editing.
3. Preserve `.cursor/`, `dashboard/explore_serving_index_v2.json`, and `docs/app-store-copy.md`; do not stage them.
4. Continue from **Next exact action**. Do not buy, record, extract, transcribe, or imitate a competitor audio tour.

## Baseline and cleanup evidence

- Branch: `feat/trailhead-1.0.10-overhaul`.
- S0 baseline HEAD: `0fedb49adadbe0cdda5880d981709447504f03f6`.
- Intentional baseline-checkpoint file: this document only.
- Existing dirty state, preserved:
  - `M dashboard/explore_serving_index_v2.json`
  - `M docs/app-store-copy.md`
  - `?? .cursor/`
- Protected hashes:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`
- Safe cleanup completed before this checkpoint. Windows C: has about 26 GB free. WSL, Git, Node 22.22.0, Python 3.12.3, Gradle 8.13, and ADB 37.0.0 reopened successfully.
- Removed items were rebuildable caches, inactive native build outputs, old temporary APK/AAB/audit artifacts, a WSL crash dump, and clean registered worktrees. Main dependencies, SDK/emulator, datasets, evidence, dirty worktrees, and source files were preserved.
- No DiskPart/compaction job remains active. A visible PowerShell window is not an active cleanup requirement and can be closed by the user when convenient.

## Existing Originals foundation — verified

- The paid Smokies product will reuse the existing authored pack, immutable version, acquisition, owner-scoped bundle, main-map playback, background location, captions, progress, offline map, validation, and Plan ownership systems. No second tour engine or ownership store is allowed.
- Allowed existing Original prices are `0`, `250`, `500`, and `900` credits. Smokies uses a per-pack policy with `permanent_credit_price: 900` and `explorer_included: true`.
- Explorer access lasts while the subscription is active. Subscription expiry locks playback while preserving progress and downloaded files; resubscription restores access without a redownload. A 900-credit unlock is permanent, and all existing permanent ownership remains permanent.
- Existing acquisition is idempotent; later immutable versions remain available to prior owners.
- Both Cartesia and ElevenLabs generation/provenance are supported. The dedicated Originals Cartesia endpoint exists, while the newer generic Studio path defaults to ElevenLabs. The immutable published Moab asset revisions—not a mutable Studio default—must determine the Smokies baseline provider and voice.
- The trusted Node runner shares the mobile trigger engine and covers 13 continuous-route scenarios. Studio cannot forge a passing result.
- The published Moab product is 65 miles, 4–6 hours, 11 stories, and about 24 MB on the tested device bundle. Only stories 1–2 are present in local UI evidence; each is about one minute. The checked-in ten-stop draft fixture is obsolete and must not be used as production truth.
- Before comparing final Smokies size or pacing to Moab, export a redacted production manifest inventory containing stop IDs, audio durations, byte sizes, hashes, provider/model/voice, and route progress—but no transcript text or secrets.

## Product direction — recommended

Working title: **Great Smoky Mountains: Ridges, Rivers & Living Memory**.

Build one premium product with selectable route chapters:

1. **Mountain Crossing** — Gatlinburg/Sugarlands, Newfound Gap, Kuwohi, Oconaluftee, and Cherokee, authored for both directions.
2. **Little River and Cades Cove** — Sugarlands/Townsend approach plus the one-way Cades Cove loop.
3. **Roaring Fork** — dedicated one-way seasonal chapter with vehicle restrictions enforced operationally.
4. **Foothills Parkway** — an independent scenic bonus chapter, authored for both directions.

Content target:

- 42–48 substantial stories, normally 2.5–5 minutes each.
- 30–45 short scenic, transition, and operational notes, normally 20–75 seconds.
- Concise route directions remain separate from stories.
- Approximately 150–180 minutes of genuine storytelling.
- Honest marketing such as `45 full stories` or `nearly three hours of storytelling`; never inflate directions and short cues into a story count.

Each story follows a human editorial structure: visible-scene hook, sourced fact, human consequence, and connection to what the passenger can observe. Initial arcs include living Cherokee homeland and Kuwohi, geology and blue haze, biodiversity and waterways, Newfound Gap Road and the CCC, logging and forest recovery, park creation and displaced communities, Cades Cove life, Roaring Fork communities, wildlife restoration, and modern conservation pressure.

## Required architecture delta

`OriginalManifestV1` supports one `LineString` with monotonically ordered stops, so it cannot represent this product cleanly. Add a backward-compatible `OriginalManifestV2` rather than splitting the premium experience into unrelated products.

V2 retains one pack, entitlement, version, download, player, map, trigger engine, analytics contract, and feedback model. It adds:

- Shared immutable `stories[]` with transcripts, audio, citations, artwork, provenance, duration, size, and hashes.
- `chapters[]` containing route geometry, direction/variant, availability references, cue references, trigger windows, and offline coverage.
- Directional variants for Mountain Crossing and Foothills Parkway; one-way chapters for Cades Cove and Roaring Fork.
- One chapter selector before Start Tour and one union offline bundle/size estimate.
- Per-chapter authoritative validation compiled through the existing V1-shaped runtime input.
- Dynamic operational readiness sourced separately from immutable narration, so seasonal closures, Cades Cove vehicle-free days, parking requirements, weather, and road restrictions can change without re-recording a story.

The runtime keeps a single queued story; story timing and trigger spacing must pass the current 15/36/65 mph continuous-route scenarios for every chapter/variant.

## Sources, rights, and cultural review

- Use NPS auto-touring, seasonal-road, closure, fee, history, nature, wildlife, and Cades Cove sources as the operational and factual backbone.
- Review every NPS asset individually. Employee-created material is often public domain, but third-party material may remain copyrighted and the NPS Arrowhead is not available for casual product use.
- Cherokee chapters require direct Eastern Band of Cherokee Indians participation. Contact the EBCI Destination Marketing/Commerce office and ask the EBCI Cultural Institutional Review Board whether formal review applies.
- Budget for a compensated EBCI cultural reviewer or storyteller. Do not generate sacred stories, pronunciations, or cultural interpretation from generic web summaries.
- Competitor pages and free demos may inform product expectations, download flow, pacing, silence, interruption, resume, and missed-cue behavior only. Never copy scripts, audio, topic sequence, narration structure, branding, or imagery.

## Audio and bundle targets

- The user confirmed that Cartesia Pro is active. Do not generate production narration until scripts and pronunciations are locked, Cartesia training opt-out is confirmed, the account's actual balance/overage price is checked, and the independent 225,000-credit / $15-before-tax renderer caps are active.
- If the immutable Moab inventory is consistently Cartesia, preserve its exact voice as the baseline and audition it with the pinned `sonic-3.5-2026-05-04` snapshot. If Moab is ElevenLabs or mixed, stop after S0 and present the inventory before selecting the narrator.
- Generate one archival WAV master per approved asset. Locally encode that identical master at 64, 96, and 128 kbps for device listening; do not spend TTS credits to compare compression.
- At the existing 128 kbps default, 150–180 minutes of narration alone is roughly 144–173 MB. Lower bitrates must be chosen by listening tests, not assumption.
- Estimate the final union offline map and asset bundle only after all Mapbox route variants, corridor bounds, zoom ranges, and licensed media are fixed. Initial planning range: 250–500 MB.
- Rerender only changed or failed assets. Preserve provider, voice, model, license, duration, byte size, transcript hash, and audio hash internally.

## Entitlement and credit gate

- Smokies costs `900` earned credits for permanent ownership and is included while Explorer is active. Credits cannot be purchased.
- Disable creation of new public credit packages and checkouts with the stable `credits_earned_only` response. Preserve historical balances, earned sources, refunds, and settlement webhooks for already-open payment sessions.
- Subscription expiry must not delete downloads or progress. Resubscription or permanent ownership restores playback without redownloading.
- Existing permanent Original ownership remains permanent and published Moab V1 manifests remain immutable.

## Implementation packets

1. **S0 — Product contract and provenance**
   - Implement Manifest V2, Explorer-included access, 900 earned-credit permanent ownership, and earned-only checkout behavior.
   - Export the redacted Moab production inventory.
2. **S1 — Routes and operations**
   - Build exact routable variants with Mapbox/road-network validation.
   - Bind current NPS operational sources and chapter availability.
3. **S2 — Source and story dossiers**
   - Create claim-level source notes and media-rights records.
   - Establish EBCI review/participation before Cherokee scripts are finalized.
4. **S3 — Editorial scripts and audio**
   - Write and human-edit 42–48 stories plus short notes.
   - Render reviewed Cartesia auditions only after the provider/voice and data-terms gates pass; A/B local bitrate encodes and pacing on Android and iPhone.
5. **S4 — Bundle and deterministic validation**
   - Validate every chapter and direction against continuous fixtures, trigger spacing, queue drain, map matching, ambiguous geometry, and offline integrity.
6. **S5 — Internal paired preview**
   - Android first, then iOS from the same SHA; test chapter selection, acquisition, download, background playback, interruptions, completion, End Tour, and restore.
7. **S6 — Public rollout**
   - Enable only after entitlement tests, complete cultural/source review, commercial-license evidence, zero P0/P1 defects, and explicit approval.

## Fixed S0 decisions

1. One backward-compatible Manifest V2 product with four selectable chapters.
2. Explorer access while subscribed; permanent ownership costs 900 earned credits.
3. Credits are earned-only; new purchase/checkout creation is disabled while historical settlement remains intact.
4. Cartesia Pro is active, but production rendering stays locked until scripts, pronunciations, data terms, balance/overage price, and hard spend caps are verified.

## S0 completion evidence

- Baseline checkpoint commit: `462fb3eb4095665de22d93d1e00df3df39911b92`.
- Protected hashes remain unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- A query-only exporter was added for immutable published narration evidence. It uses SQLite URI `mode=ro`, `PRAGMA query_only=ON`, and binds each record by pack, asset ID, and the manifest's published SHA-256. Its output allowlist excludes transcripts, paths, credentials, administrator identity, and internal asset/stop IDs.
- The temporary Railway SSH key `trailhead-codex-temp` was removed after the evidence was collected and its absence was verified.
- Published Moab pack `original_e0d3d4de1a9a40fcb01efc7e7a02e3c7`, version `1`, binds exactly 11 narration assets. All 11 use:
  - Provider: `elevenlabs`.
  - Model: `eleven_multilingual_v2`.
  - Voice: `JBFqnCBsd6RMkjVDRZzb`.
  - Output: `mp3_44100_128`.
  - License status: `attested`.
- Redacted local evidence: `output/smokies-original/moab-narration-inventory-v1.json`, SHA-256 `f32f6d1c3c7e595c99f8d971ce88dbbe00a2839528c5d69db27852e08bb380e0`. This evidence is intentionally ignored rather than committed.
- Moab does not establish Cartesia/Katie continuity. Selecting Katie for Smokies is a deliberate new editorial voice decision and remains subject to the three-script audition gate.
- S0 implementation commits:
  - Backend contract and provenance: `e8e57a6f`.
  - Initial mobile access/manifest contract: `08e34875`.
  - Recursive server redaction hardening: `65c6a39b`.
  - Complete mobile V2 selection/runtime path: `9dbe1862`.
- `OriginalManifestV2` now has shared stories, selectable chapters and variants, globally unique validation selections, operational source/readiness contracts, union offline coverage, deterministic V2-to-V1 compilation, strict source rights/review evidence, and server-only narration reproducibility metadata.
- Consumer manifests and public previews do not expose provider, voice, model, license, training-choice, transcripts, route geometry, or other acquired content before access. Both server and client reject unknown nested fields rather than persisting internal notes.
- V1 normalization, published Moab V1 manifests, and the existing trigger engine remain unchanged. V2 publication is fail-closed until S1 supplies authoritative validation for every chapter/variant.
- Mobile stores one verified union bundle by immutable pack/version and keeps progress in bounded, collision-checked chapter/variant session identities. Detail selection, foreground playback, cold/headless restore, admin simulation, force-stop recovery, and player routing all compile the explicit selection into the existing V1 trigger engine without creating another player.
- Same-version Studio revisions replace stale bundles atomically unless manifest ID, schema, and canonical content all match. Approved cross-origin asset hosts receive no account or preview credentials; unapproved origins fail closed.
- Chapter cards distinguish full stories from shorter cues, preserve progress per direction, use accurate grouped seasonal labels, and never display editorial claim IDs as reader copy.
- The per-pack access policy is implemented end to end:
  - Active Explorer access costs zero credits and is temporary.
  - Permanent ownership costs exactly 900 earned credits with no subscription discount.
  - Expiry preserves local download, session, and progress but blocks manifest, asset, foreground, and headless playback access.
  - Renewal or permanent upgrade restores the same owner/pack/version record without redownloading.
  - Explorer access is labelled as included, never permanent, and exposes a confirmed `Keep permanently · 900 credits` action.
  - Policy-bearing Originals cannot enter the legacy monthly featured-claim lane.
- New credit-package listing and checkout creation return stable `credits_earned_only` responses. Delayed historical Stripe sessions settle atomically only when package, credits, USD amount, user, and signed session metadata match the frozen legacy package table.
- Backend acceptance after recursive hardening: 105 passed plus 10 subtests; the V2-focused suite alone has 43 passing tests. Python compilation and whitespace checks pass.
- Complete `npm run test:originals` passes, including V1 Moab, V2 API/redaction, union bundles, foreground/headless playback, access expiry, permanent unlock, stale-bundle replacement, bounded session files, per-selection progress, and asset-header security. Strict `npx tsc --noEmit` and whitespace checks pass.
- A final independent re-audit found no unresolved P0/P1 across the S0 backend/mobile contract.
- No production backend deployment, mobile OTA, binary, public stage change, route generation, script drafting, narration generation, or Cartesia credit spend occurred in S0.
- Open activation work:
  - Server-owned validation reports for every V2 selection.
  - Exact route and operational source construction in S1.
  - A server-authenticated time anchor or signed entitlement receipt before public premium release. Device wall time alone remains an acknowledged P2 because clock rollback can extend offline Explorer access and clock skew can reject a valid review date.

## Next exact action

Implement S1 only: exact Mapbox road variants for Mountain Crossing, Cades Cove/Little River, Roaring Fork, and Foothills Parkway; current official operational sources and readiness rules; a trusted server-time entitlement receipt; and deterministic validation for every chapter/variant. Do not draft Cherokee interpretation or generate narration in S1.

## S1 baseline

- User approval to begin: 2026-08-04.
- Baseline HEAD: `d50b2ad22ff500a2d4ab5eda8cc09f541559ff5b` on `feat/trailhead-1.0.10-overhaul`.
- Protected hashes at start:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Existing dirty state remains limited to the two protected files and `.cursor/`.
- Route policy: Mapbox Directions is authoritative for routable roads. Map Matching may be used only for an authoritative trace that cannot route because of a current seasonal closure. Turf/geometric operations are limited to cue projection, ambiguity checks, bounds, and offline coverage.
- S1 deliberately excludes scripts, pronunciations, cultural interpretation, Cartesia auditions, narration generation, public rollout, mobile OTA, and native builds.

## Do not repeat

- Safe cleanup or VHD compaction.
- Broad Explore, Trails, Layers, Memory, NPS, Originals lifecycle, Android Auto, or store-screenshot crawls.
- Viator/GuideAlong/Shaka product-page research unless pricing/features change materially.
- Buying a competitor tour for extraction.
- Treating the obsolete ten-stop Moab fixture as production content.
- Re-exporting Moab provenance or re-registering the temporary Railway key without new evidence that the immutable publication changed.
- Reworking the completed S0 earned-only, access-policy, or Manifest V2 contract while it remains green.

## Task-owned background processes

- None. No Gradle, Metro, Maestro, EAS, Railway, cleanup, DiskPart, or compaction task remains running.
