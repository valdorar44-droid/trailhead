# Great Smoky Mountains Original — Active Checkpoint

Last updated: 2026-08-03 21:27 CDT (America/Winnipeg)

## Resume protocol

Read this file before continuing the Great Smoky Mountains Original. Do not repeat the competitor, Moab pipeline, entitlement, or cleanup audits unless new evidence invalidates them.

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Confirm HEAD and protected-file hashes below before editing.
3. Preserve `.cursor/`, `dashboard/explore_serving_index_v2.json`, and `docs/app-store-copy.md`; do not stage them.
4. Continue from **Next exact action**. Do not buy, record, extract, transcribe, or imitate a competitor audio tour.

## Baseline and cleanup evidence

- Branch: `feat/trailhead-1.0.10-overhaul`.
- Baseline HEAD: `f1f6a24eccf568665260b44cb76b18e50d7ebd72`.
- Intentional checkpoint file: this document only.
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
- Allowed existing Original prices are `0`, `250`, `500`, and `900` credits.
- Existing behavior gives ordinary Explorer members a 20% discount. A featured monthly Original may be claimed for zero credits and remains permanently owned.
- Existing acquisition is idempotent; later immutable versions remain available to prior owners.
- ElevenLabs generation and provenance are already supported. Publishing verifies the reviewed transcript hash, provider, model, voice, license attestation, probed duration, artwork, citations, operational scope, and route validation.
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

- Keep the approved ElevenLabs voice initially, then run an actual device A/B of 64 kbps and 96 kbps spoken-word output before choosing the final format.
- At the existing 128 kbps default, 150–180 minutes of narration alone is roughly 144–173 MB. Lower bitrates must be chosen by listening tests, not assumption.
- Estimate the final union offline map and asset bundle only after all Mapbox route variants, corridor bounds, zoom ranges, and licensed media are fixed. Initial planning range: 250–500 MB.
- Rerender only changed or failed assets. Preserve provider, voice, model, license, duration, byte size, transcript hash, and audio hash internally.

## Entitlement and store-policy gate

- Recommended catalog price: `900` credits. Existing Explorer discount becomes `720` credits outside the featured month.
- Recommended Explorer launch offer: make Smokies the featured monthly Original, allowing Explorer members to claim it free and keep it permanently. This reuses existing entitlement semantics.
- Do not unlock this digital tour through an in-app Stripe/browser credit purchase in the released apps. Apple and Google treat premium in-app content and sold virtual credits as store-billing territory unless a specific eligible external/alternative-billing program applies.
- Before public paid acquisition, implement StoreKit/Google Play Billing for the relevant product or credit packs, or explicitly choose a compliant consumption-only/external-program model by storefront. Preserve earned/referral/prize credits separately from purchased-credit receipts.
- This billing gate does not block route work, source dossiers, scripts, audio previews, bundle preparation, validation, or internal acquisition tests.

## Implementation packets

1. **S0 — Product and compliance specification**
   - Approve Manifest V2, featured-month Explorer semantics, 900-credit price, and store-billing approach.
   - Export the redacted Moab production inventory.
2. **S1 — Routes and operations**
   - Build exact routable variants with Mapbox/road-network validation.
   - Bind current NPS operational sources and chapter availability.
3. **S2 — Source and story dossiers**
   - Create claim-level source notes and media-rights records.
   - Establish EBCI review/participation before Cherokee scripts are finalized.
4. **S3 — Editorial scripts and audio**
   - Write and human-edit 42–48 stories plus short notes.
   - Render ElevenLabs previews; A/B bitrate and pacing on Android and iPhone.
5. **S4 — Bundle and deterministic validation**
   - Validate every chapter and direction against continuous fixtures, trigger spacing, queue drain, map matching, ambiguous geometry, and offline integrity.
6. **S5 — Internal paired preview**
   - Android first, then iOS from the same SHA; test chapter selection, acquisition, download, background playback, interruptions, completion, End Tour, and restore.
7. **S6 — Paid rollout**
   - Enable only after compliant store billing/entitlement tests, complete cultural/source review, zero P0/P1 defects, and explicit approval.

## Open decisions

1. Confirm Manifest V2 with selectable chapters rather than separate V1 products.
2. Confirm the current Explorer model: one featured Original claimed free permanently, then a 20% discount on other Originals. A different `all Originals included while subscribed` model would require new subscription entitlement and revocation semantics.
3. Confirm 900 credits as the first premium price before storefront product configuration.

## Next exact action

After the user approves the three defaults above, implement S0 only: add the versioned manifest/schema/compiler tests and the redacted production-inventory export. Stop for review before route sourcing or story drafting.

## Do not repeat

- Safe cleanup or VHD compaction.
- Broad Explore, Trails, Layers, Memory, NPS, Originals lifecycle, Android Auto, or store-screenshot crawls.
- Viator/GuideAlong/Shaka product-page research unless pricing/features change materially.
- Buying a competitor tour for extraction.
- Treating the obsolete ten-stop Moab fixture as production content.

## Task-owned background processes

- None. No Gradle, Metro, Maestro, EAS, Railway, cleanup, DiskPart, or compaction task remains running.
