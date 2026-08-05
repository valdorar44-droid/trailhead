# Great Smoky Mountains Original — Active Checkpoint

Last updated: 2026-08-04 (S1 routes and operations checkpointed)

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

Review the accepted S1 packet, then begin S2 with claim-level source and media-rights dossiers plus compensated EBCI outreach. Before any consumer Start Tour or internal device preview, add a trusted current-road reader and bind the user's selected vehicle/rig class. Do not draft Cherokee interpretation, create pronunciations, or generate narration before those editorial/cultural gates are approved.

## S1 baseline

- User approval to begin: 2026-08-04.
- Baseline HEAD: `d50b2ad22ff500a2d4ab5eda8cc09f541559ff5b` on `feat/trailhead-1.0.10-overhaul`.
- Protected hashes at start:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Existing dirty state remains limited to the two protected files and `.cursor/`.
- Route policy: Mapbox Directions is authoritative for routable roads. Map Matching may be used only for an authoritative trace that cannot route because of a current seasonal closure. Turf/geometric operations are limited to cue projection, ambiguity checks, bounds, and offline coverage.
- S1 deliberately excludes scripts, pronunciations, cultural interpretation, Cartesia auditions, narration generation, public rollout, mobile OTA, and native builds.

## S1 completion evidence

- Baseline checkpoint: `0948b8292860bc4a270a7ef77f509901fcbcdd76`.
- Route candidate commit: `75a32e64b72bfe6c5aec814b091413c20df484dc`.
- S1 readiness/validation/access commit: `0d3388ce0aeaa3abad7947fd38e3da357c52b649`.
- Six exact candidate variants were generated through Mapbox Directions with `driving` provenance:
  - Mountain Crossing, Tennessee to North Carolina: 75.44 km.
  - Mountain Crossing, North Carolina to Tennessee: 74.53 km.
  - Little River and Cades Cove: 59.71 km.
  - Roaring Fork one-way: 8.20 km.
  - Foothills Parkway west to east: 50.88 km.
  - Foothills Parkway east to west: 50.88 km.
- The two independent live route builds produced identical geometry per variant. The ignored redacted route-evidence artifact SHA-256 is `2220dc9a1bfca4eaa63386c40946fbbebf9a2a6a2dd3f4f16ea31c1800a1c2dd`; no token or provider request URL is persisted.
- Route evidence is explicitly `candidate_only` and `temporary_use_only`. It has no publication ingestion path. Before S4, add a compiler-enforced rights gate rather than copying this candidate geometry into a permanent/offline manifest.
- Operational candidate `smokies-operational-readiness-2026-v1` is bound by canonical SHA-256 `17b9eea045ac2369e7679f5fbec3291cca46374b004165f15087ceb4bded7a21` and expires on 2026-09-03. Its official NPS projection covers route, access, fees, closures, surface, season, safety, vehicle restrictions, parking, vehicle-free days, and chapter alternates.
- Every V2 chapter carries that candidate ID/hash. Authoritative validation input and publication metadata bind the same values; missing, altered, untrusted, or expired candidates fail publication.
- Every chapter/variant compiles independently into the trusted V1-shaped validator. Publication requires the exact complete set of passing selection keys; a failed direction cannot be hidden by another passing variant. Published Moab V1 remains unchanged.
- The consumer Start action calls the server-owned readiness endpoint before notification permission, location, or playback. Missing/stale/incomplete observations and unknown vehicle class return `check_required`. The backend no longer assumes every user drives a passenger vehicle.
- A trusted live NPS current-road reader is intentionally not implemented in this packet. Until it supplies explicit fresh candidate-bound states for every required road, all Smokies starts remain blocked. Absence from a closure page is never treated as proof that a road is open.
- Temporary V2 Explorer access uses an Ed25519 receipt bound to entitlement, keyed non-enumerable owner subject, pack, version, and exact immutable manifest. The offline receipt defaults to 72 hours and never exceeds subscription expiry.
- Monotonic elapsed time advances receipt expiry even if the wall clock is frozen. Wall-clock rollback or a monotonic reset locks temporary playback until a fresh authenticated receipt; download and progress remain intact. Permanent ownership and V1 access are unchanged.
- Receipt activation requires backend `TRAILHEAD_ORIGINALS_RECEIPT_PRIVATE_KEY`, `TRAILHEAD_ORIGINALS_RECEIPT_KEY_ID`, `TRAILHEAD_ORIGINALS_RECEIPT_OWNER_BINDING_KEY`, optional bounded `TRAILHEAD_ORIGINALS_RECEIPT_TTL_SECONDS`, and mobile `EXPO_PUBLIC_ORIGINALS_ENTITLEMENT_RECEIPT_KEYS`. Missing or mismatched configuration fails temporary V2 playback closed.
- Residual hardening before public activation:
  - Bind the selected server/profile vehicle class instead of leaving Start blocked on unknown.
  - Add the trusted current-road reader and explicit observation provenance.
  - Consider binding canonical manifest content SHA in the receipt in addition to immutable manifest ID and verified bundle hash.
  - A JS runtime whose monotonic origin resets on process restart may require an authenticated refresh more often; native attestation remains future hardening for rooted-device tampering.
- Final backend evidence: 140 passed plus 13 subtests across V1/V2 manifests, Originals APIs, network validation, receipts, operations, and route candidates. The vehicle-class correction then passed 70 focused backend tests.
- Complete mobile `npm run test:originals`, focused API/Main Map regressions, strict `npx tsc --noEmit`, Python compilation, and whitespace checks pass.
- Two independent audits found no remaining P0. The final vehicle-class P1 was corrected fail-closed and its focused tests pass.
- Protected hashes remain unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- No backend deployment, preview/production OTA, native build, public stage change, script drafting, cultural interpretation, audio generation, or Cartesia credit spend occurred.

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

## S2 source-dossier baseline

- Started: 2026-08-05.
- Isolated worktree: `/home/sean/.openclaw/worktrees/trailhead-smokies-s2`.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `8dc6a4bd959f98e4baa328ff3cd8bc3d224f6e76`.
- The S2 worktree was clean at creation. The main worktree's protected user changes remain outside this worktree and retain their checkpointed hashes:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- This packet is limited to a deterministic claim/source dossier, a fail-closed media-rights ledger, a 45-story/32-cue editorial map, and an EBCI cultural-review brief.
- This packet does not write narration scripts, choose pronunciations, contact outside parties, generate audio, spend Cartesia credits, deploy a backend, publish an OTA, or change any public stage.
- Existing S0/S1 contracts, Moab provenance, route candidates, entitlements, and operational readiness will not be rebuilt.
- Task-owned background processes at start: none.

## S2 source-dossier completion candidate

- Completed locally: 2026-08-05 on branch `feat/smokies-original-s2` from baseline `8dc6a4bd959f98e4baa328ff3cd8bc3d224f6e76`.
- Generated artifact: `originals/smokies/source_dossiers_v1.json`, SHA-256 `4f81200308052c3f3fba227434d5372a8a0fd5504354839448e13e2b69338011`.
- The deterministic dossier contains 28 reviewed official sources, 47 claim records, 45 full-story outlines, 32 shorter cues, and eight media leads.
- Three entries remain deliberately blocked for compensated EBCI participation and review: `mc_story_15`, `mc_cue_07`, and `cc_story_04`. The checked-in EBCI brief is a draft only; it was not sent and contains no private reviewer information.
- Every culturally approved claim must bind one immutable approval record ID, date, SHA-256, and the exact complete set of reviewed claim IDs. Manifest V2 citations now preserve that approval provenance through optional strict fields; partial evidence fails in both backend and mobile validators.
- Every media candidate remains unavailable. Approval requires an exact asset URL, displayed credit, documented subject/location identity match, rights basis, license/permission record, dimensions, and downloaded-file SHA-256. No image was downloaded or licensed in this packet.
- Exact NPS sources now support the Cable Mill water-power claim and Foothills Parkway Missing Link engineering claim. The elk story and cue are tied to the Oconaluftee scene, and one-way Cades Cove/Roaring Fork entries are route-monotonic.
- The official NPS Great Smoky Mountains road-centerline dataset, updated March 2026, is the preferred next candidate for durable park-road geometry. The S1 Mapbox geometry remains temporary candidate evidence and cannot enter an offline or published manifest.
- The Cades Cove candidate still needs a route-permanence rebuild that keeps the driving line on the loop and projects landmarks as cue anchors. A separate Townsend-start decision and an approved public-road source for the short Cherokee extension remain open.
- Start Tour remains fail-closed. A trusted, timestamped road observation and server-owned vehicle/rig binding remain required before an internal consumer preview.
- Verification:
  - 87 focused backend tests passed across the dossier, Manifest V2, operational readiness, and route candidate contracts.
  - Complete mobile `npm run test:originals` passed, including the new cultural-approval citation contract.
  - Strict mobile `npx tsc --noEmit` passed.
  - Deterministic builder `--check`, Python compilation, and whitespace checks passed.
  - Independent audit found no P0; all reported P1 source, scene, media-identity, and provenance findings were corrected before this candidate was checkpointed.
- Protected main-worktree state remains unchanged:
  - `dashboard/explore_serving_index_v2.json`: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - `docs/app-store-copy.md`: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- No narration script, pronunciation guide, audio, Cartesia request, external outreach, backend deployment, OTA, native build, or public-stage change occurred.
- Task-owned background processes at completion: none. The temporary ignored `node_modules` symlink used for mobile verification was removed.

### Next exact action after S2 commit

1. Build the permanent route-evidence packet from official NPS road centerlines, keeping landmarks separate from the drive line and resolving Townsend/Cherokee coverage.
2. Prepare the trusted current-road observation and saved-rig binding required by Start Tour.
3. Ask the user before sending the draft EBCI scope/participation outreach; do not draft Cherokee interpretation or pronunciation while review is pending.
4. Begin full scripts and Cartesia auditions only after route, cultural, media-rights, and editorial review gates are locked.

### Do not repeat after this checkpoint

- S0 Manifest V2, earned-credit, access-policy, or Moab provenance work.
- S1 Mapbox route-candidate generation or broad operational-source research.
- The 28-source S2 official-page sweep unless a source becomes stale or a claim changes.
- Narrator selection or paid rendering before scripts and pronunciations are approved.
