# Great Smoky Mountains Original — Active Checkpoint

Last updated: 2026-08-06 (S2D media-rights record and EBCI outreach packet complete)

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
- Accepted S2 implementation commit: `d862abf986276e6ce097e5454e7b1ab53c7189ee`.
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

## S2B permanent-route baseline

- Started: 2026-08-05.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `298784692261e905bd2c16eb5e8da22d372cf961`.
- Scope is limited to official road-source inspection, deterministic chapter-road extraction, landmark-to-route projection, and explicit coverage gaps.
- Mapbox remains temporary validation/runtime navigation data. It will not be copied into a permanent or offline Original bundle.
- No narration, cultural interpretation, media download, Cartesia request, deployment, OTA, public stage, trusted-road readiness, or saved-rig behavior is included.
- The main worktree protected hashes remain the accepted S2 values. Task-owned background processes at start: none.

## S2B permanent-route completion

- Completed locally: 2026-08-05 on branch `feat/smokies-original-s2`.
- Baseline checkpoint commit: `4a45a310d985cbc8c0d95df1971b5abb705f508a`.
- Accepted implementation commit: `c833018b2eb69e38178cfb3f62f42b52c608bfa2`.
- Provenance hardening commit: `b5a8710677653ae7c4f006a32cd95a6909b8196f`.
- The permanent authoring evidence now comes from the official National Park Service `NPS Public Roads Geographic` layer. Mapbox remains the runtime maneuver engine and its temporary S1 route geometry is not persisted in this packet.
- The source reader is deterministic and fail-closed:
  - It retrieves sorted GRSM object IDs first, then exact 500-record batches.
  - It pins the selected fields, geometry flags, service/schema hashes, source CRS, transformation, coordinate precision, and one-metre endpoint tolerance.
  - Every selected feature must remain an extant, unrestricted, publicly displayed GRSM road with the reviewed accuracy, maintainer, class, stable IDs, and geographic envelope.
  - Source refresh, local rebuild, and no-network deterministic check are separate explicit commands.
- Checked source/evidence counts and hashes:
  - GRSM source features: 1,926.
  - Reviewed chapter-road features: 639.
  - Snapshot canonical SHA-256: `667962182156619a6f24b836d5fc8d036bff8117b93a0137956e902d9b702027`.
  - Snapshot file SHA-256: `e287c702a0c47b18abaa9593079bbd8d5822b459a17d845e5dec16cf7e4be118`.
  - Route-spec SHA-256: `025db561e9cd1cc77e65f6a738e96548943a031d0f14d90b0fc1d6685af1a65b`.
  - Compiler version/source SHA-256: `1.1.0` / `2da05e38dccd52b5d4198523fa14d3d5c6c35b015456e5c638676087ed95b137`.
  - Algorithm-contract SHA-256: `a616137a9637fa7649f22325ff0e6ab65655030806e50501d6762d21c91eab22`.
  - Route-evidence canonical SHA-256: `ce9e35b42f60d0eaa02b501dbc70a0d3973be0e4b49b0332ae761a75ceeeb9f2`.
  - Route-evidence file SHA-256: `97b2207674c7229b7b5ea6b1320fbe679aa3b875f44ba9426624414e13af2374`.
- Chapter results:
  - Mountain Crossing TN to NC: 69,101.1 m. Sugarlands, Fighting Creek, Newfound Gap, Morton Mountain Tunnel, Kuwohi, and Oconaluftee are represented through source-directed geometry. It remains blocked because NPS coverage ends before Cherokee and the incomplete line is below the reviewed full-chapter distance.
  - Mountain Crossing NC to TN: 68,831.7 m. It is independently resolved through the directed graph rather than mechanically reversing one-way lanes. It carries the same Cherokee and distance blockers.
  - Little River and Cades Cove: 56,937.5 m. Landmarks are projected as cues instead of route detours, but five exact NPS geometry records conflict with the declared one-way direction, so the chapter remains blocked for source review. The exact anomaly set is pinned; any source refresh that changes it fails compilation until separately reviewed.
  - Roaring Fork: 8,561.4 m. Static reference geometry passed; seasonal/current readiness remains a separate Start Tour gate.
  - Foothills Parkway: 50,816.7 m in each direction. The reviewed Missing Link and Wears Valley access records are included; the two variants are exact geometry reverses because the source supplies no one-way conflict.
- `route_variants_v1.json` lowers the reviewed Cades Cove minimum from 57,000 m to 56,500 m because the corrected official route no longer detours through off-route story landmarks.
- Verification:
  - Deterministic `--check` passed without network access and reproduced both canonical hashes.
  - Python compilation and whitespace checks passed.
  - 37 focused tests plus four subtests passed across S0/S1/S2 route, dossier, and official-source contracts.
  - Tests cover source/query drift, per-feature public provenance, geometry integrity, directed traversal, boundary joins, route controls versus cue landmarks, distance/road-name contracts, Cades conflicts, reverse variants, and deterministic output.
  - Two independent final audits found no unresolved P0/P1 after the exact Cades anomaly set and route-spec/compiler provenance were hash-bound. No credentials/private data or persisted Mapbox geometry were found.
  - Mobile sources did not change in S2B. The accepted S2 complete `npm run test:originals` and strict TypeScript result remain the current mobile evidence and were not repeated.
- Protected main-worktree state remains unchanged:
  - `dashboard/explore_serving_index_v2.json`: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - `docs/app-store-copy.md`: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- No narration, pronunciation work, media download, Cartesia request, external outreach, backend deployment, OTA, native build, or public-stage change occurred.
- Task-owned background processes at completion: none.

### Next exact action after S2B

1. Resolve the short Cherokee extension using an approved authoritative EBCI or NCDOT public-road source, or obtain product/editorial approval to end Mountain Crossing at the NPS extent.
2. Resolve the five enumerated Cades Cove source-direction conflicts without silently rewriting official data.
3. Implement the trusted current-road observation reader and bind the server-owned saved rig before any consumer Start Tour.
4. Ask the user before sending the prepared compensated EBCI participation/review request. Cherokee interpretation and pronunciation remain blocked until that review exists.
5. Begin full script drafting and Cartesia auditions only after route, cultural, media-rights, and editorial gates are locked.

### Do not repeat after S2B

- Do not refetch the NPS road snapshot unless its service metadata or accepted source policy changes.
- Do not regenerate the temporary S1 Mapbox candidates or redo S0/S1/S2.
- Do not repeat broad app, Explore, Map, Layers, memory, Originals lifecycle, or Android Auto crawls for this data-only packet.
- Do not generate paid narration or contact outside reviewers without the remaining approvals.

## S2C route gaps and Start Tour readiness baseline

- Started: 2026-08-05.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `f2bdbf6fc1ec4948f74305d28e2276f240637d7e`.
- The worktree is clean. Protected main-worktree state remains unchanged:
  - `dashboard/explore_serving_index_v2.json`: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - `docs/app-store-copy.md`: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- This packet will reuse the existing Originals Builder/Studio rather than create a second authoring system. The audit will map permanent route evidence, sources, cue review, operational observations, and publication validation onto existing Studio contracts before any UI change.
- Source work is limited to authoritative EBCI/NCDOT geometry for the Cherokee extension and official resolution evidence for the five pinned Cades Cove direction anomalies. No Mapbox candidate geometry will be persisted as permanent evidence.
- Start Tour work is limited to a trusted, timestamped current-road observation contract and server-owned selected-rig binding. Missing, stale, incomplete, or incompatible evidence remains fail-closed.
- This packet does not contact EBCI or another outside party, draft cultural interpretation or pronunciation, generate narration, spend Cartesia credits, deploy, publish an OTA, change a public stage, or modify Moab V1.
- Existing task-owned background processes at start: none. Long-running host Node/Python processes predate this packet and are not owned or stopped by it.

## S2C route gaps, Start Tour readiness, and Studio completion candidate

- Completed locally: 2026-08-05.
- Branch: `feat/smokies-original-s2`.
- Implementation baseline HEAD: `e037f2ecee52c9e87c698141ec27b7c5d6d8da27`.
- Accepted implementation commit: `6977c289243109732cbbf7c44eb0f1e601e8421a`.
- Protected main-worktree state remains unchanged:
  - `dashboard/explore_serving_index_v2.json`: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - `docs/app-store-copy.md`: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- The existing Originals Builder/Studio was extended rather than replaced:
  - V2 device previews expose exact Chapter and Route selectors from the saved manifest.
  - Generated internal links bind the exact pack, chapter, variant, and short-lived preview token.
  - Incomplete or stale selections fail before a token is persisted; V1 preview links remain unchanged.
- Permanent route gaps are resolved without persisting Mapbox candidate geometry:
  - Mountain Crossing uses the reviewed NPS public-road lineage plus an exact 23-segment NC OneMap EBCI-boundary connector.
  - Little River/Cades Cove uses an exact five-record NPS official-map direction override instead of silently rewriting the source.
  - All six chapter variants are `official_geometry_candidate`, have empty geometry blockers, and are ready for editorial cue placement.
  - Route-evidence canonical SHA-256: `95f199551ac949b081f0a8a55d46e0bf261987b211be08835f93387258844159`.
  - NPS snapshot canonical SHA-256: `667962182156619a6f24b836d5fc8d036bff8117b93a0137956e902d9b702027`.
  - Official source-supplement SHA-256: `64e4617f24c2c22908dbfee4b4da8b8d80500e25edf5326d21e6adcc44d20684`.
  - The publication gate binds the product, route spec, source snapshot, checked evidence hash, exact six-variant coverage, geometry/distance tolerance, source authority, license policy, and root blocker state.
- Start Tour now has a server-owned, fail-closed readiness path:
  - A bounded NPS Great Smoky Mountains alert reader pins HTTPS host/path, content type, response size, schema, park identity, record count, current dates, exact road-segment identities, ETag/Last-Modified, and a five-minute single-flight cache.
  - Network, schema, date, identity, classification, or source ambiguity returns the existing `check_required` state; absence from the feed is never described as proof that a road is safe.
  - The blocking reader runs off the async request loop. An omitted route variant resolves to the chapter default before observation construction.
  - Active information records carrying road IDs or closure dates fail closed.
  - `TRAILHEAD_ORIGINALS_ROAD_READINESS_ENABLED` defaults to `off`; `internal` requires an authenticated administrator. Public activation was not enabled.
  - NPS-only routes can use the current NPS observation when the internal gate is enabled. Mountain Crossing remains `check_required` until a separately trusted current source covers its cross-agency Cherokee extension.
- Start Tour also uses an owner-scoped minimal vehicle binding:
  - Only vehicle kind, restriction-relevant length, towing state, and the server-derived restriction class leave the device.
  - Make, model, year, nickname, and unrelated rig details remain local.
  - Relevant changes rotate the opaque binding. Account deletion removes it. A legacy client-supplied class is accepted only for transport compatibility and is never trusted as authority.
  - Profile synchronizes the minimal projection; Start fetches the current binding immediately before readiness and rejects stale account/session generations.
- Cultural review is now bound to immutable reviewed work, not reusable labels:
  - Smokies stories must match the exact checked-in dossier story-to-claim registry.
  - Any future EBCI approval must match the exact product, dossier SHA-256, approved claim set, normalized story transcript SHA-256 map, pronunciation-bundle SHA-256, approval record SHA-256, and approval date.
  - A changed dossier, script, pronunciation bundle, product, claim scope, or approval record fails closed.
  - The approval registry remains empty. No Cherokee interpretation or pronunciation is approved or generated.
- Product publication deliberately remains blocked. The checked evidence still lists `trusted_current_road_observation`, `server_owned_vehicle_class`, and `editorial_and_cultural_review` as root blockers until the final authored product is assembled, current sources are activated for every selected route, the user has a valid saved rig binding, and editorial/cultural review is complete.
- Verification:
  - 112 focused backend tests passed across current roads, cultural review, route evidence, vehicle binding, operational readiness, and Manifest V2.
  - The broad Originals/Smokies backend run produced 242 passes plus 24 passing subtests. Its only initial failure was the isolated worktree lacking `tsx`; the exact trusted-validator contract then passed against the already-installed main dependency tree.
  - Complete `npm run test:originals` passed, including renderer ownership, V1/V2 access, Studio preview links, route projection, trigger simulation, vehicle binding, background/headless runtime, audio, offline packs, analytics privacy, and stop-race coverage.
  - Strict mobile `npx tsc --noEmit`, Python compilation, deterministic route builder `--check`, and `git diff --check` passed.
  - A final independent read-only safety audit found no remaining P0/P1 in the async reader, information-row handling, default-variant resolution, or immutable cultural approval contract; its separate focused run passed 88 tests.
- No backend deployment, preview or production OTA, native build, public stage change, narration script, pronunciation guide, media download, Cartesia request/credit spend, or external outreach occurred.
- Task-owned background processes at completion: none. The temporary ignored `mobile/node_modules` test symlink was removed.

### Next exact action after S2C

1. Review this S2C packet, then begin S3 editorial production inside the existing Originals Studio.
2. Draft and source-lock the non-gated scenic, ecology, engineering, and general-history stories first; keep the three EBCI-gated entries blocked.
3. Obtain explicit approval before sending the prepared compensated EBCI participation/review request. Do not draft Cherokee interpretation or pronunciations while that review is pending.
4. Establish a trusted current source for the Cherokee extension before Mountain Crossing can leave `check_required`.
5. Lock all reviewed scripts and pronunciations before any Cartesia audition or production rendering. Enforce the existing 225,000-credit and $15-before-tax caps.

### Do not repeat after S2C

- S0/S1/S2 Moab provenance, entitlement, Manifest V2, Mapbox route-candidate, or 28-source dossier work.
- S2B NPS road snapshot fetching or broad permanent-route reconstruction unless accepted source metadata changes.
- Broad Map, Explore, Layers, Memory, Originals lifecycle, Android Auto, or store-screenshot crawls.
- Paid narration, competitor-tour extraction, cultural interpretation, or external outreach before the corresponding review gate.

## S2D media-rights and EBCI outreach baseline

- Date: 2026-08-06. Branch: `feat/smokies-original-s2`. Baseline HEAD: `83638e587f682cee59f2975a7a17184369ec85f9`. Worktree: `/home/sean/.openclaw/worktrees/trailhead-smokies-s2`.
- Main checkout at the same moment: `feat/trailhead-1.0.10-overhaul` at `8dc6a4bd959f98e4baa328ff3cd8bc3d224f6e76`, carrying only the three protected dirty entries.
- Protected hashes unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`
- Scope locked with the user: docs-only packet — no code, audio, narration, or Studio work. EBCI compensation stays OPEN: the letters propose paid participation and invite the EBCI to set terms; no figure is named. Vehicle-class and current-road hardening already shipped in S2C and was not revisited.

## S2D media-rights and EBCI outreach completion

- `docs/originals/smokies-media-rights-v1.md` records all eight dossier media candidates, each carrying the seven required rights fields (`asset_url`, `dimensions`, `exact_credit`, `identity_match`, `license_record`, `rights_basis`, `sha256`), with access date 2026-08-06 and hashes re-verified at completion.
- Asset mix: six public domain (two NPS staff photos via Commons, three LOC HABS/HAER scans via Commons, one FHWA photo via Commons) and two CC BY 4.0 (Kuwohi tower by APK; Noah Ogle cabin by Sarah Stierch). The CC BY rows are flagged non-public-domain and require product attribution if ever approved.
- Originals live outside the repository at `/home/sean/.openclaw/evidence/smokies-media-s2/originals/`, mirrored to `C:\Users\User\Documents\Codex\evidence\trailhead\smokies-s2-media\`.
- NPS disclaimer (`https://www.nps.gov/aboutus/disclaimer.htm`, accessed 2026-08-06) reviewed verbatim: NPS-created works are public domain; commercial republication must carry "No claim to original U.S. Government works" (17 U.S.C. § 403); the Arrowhead trademark is excluded and appears in no candidate; third-party NPS-hosted assets require individual review — none used.
- Envato: three Elements candidates (GPCYQEB, QMBV2WR, AD54PH5) remain `pending_membership_download` because browser automation was unavailable this session. `docs/licenses/envato/smokies-1.0/README.md` placeholder records the deferral; certificates and SHA-256 are pending. No Envato asset is licensed or ingested.
- `docs/originals/smokies-ebci-outreach-packet-v1.md` holds two paste-ready letters (Division of Commerce / Destination Marketing participation request; Cultural IRB scope determination), shared commitments, timeline, attachment list, and a decision-log stub. Status: draft — Sean sends; the agent never sends.
- EBCI contact paths verified 2026-08-06: `/cultural-institutional-review-board/` HTTP 200 (`CIRB@ebci-nsn.gov`, (828) 359-1500), `/division-of-commerce/` HTTP 200 (contains Destination Marketing; main line 828-497-7000, `info@ebci.gov`), `/enrollment/` HTTP 200, `/contact/` HTTP 200; slugs `/commerce/`, `/destination-marketing/`, `/tourism/` return 404.
- Gates held: `scripts/build_smokies_source_dossiers.py` and the fail-closed media-rights test are unchanged — zero approved media. Studio builder, Cartesia, narration, pronunciations, and Start Tour remain blocked. No EBCI outreach was sent and no Cherokee interpretation was drafted.

### Next exact action after S2D

1. Sean reviews `docs/originals/smokies-ebci-outreach-packet-v1.md`, fills the signature/contact fields, and sends both letters if approved; responses are recorded in the packet's decision log.
2. When browser automation is available, download the three Envato candidates through the active Elements membership, store certificate PDFs and SHA-256s under `docs/licenses/envato/smokies-1.0/`, and update the media-rights record.
3. Begin S3 editorial production for non-gated scenic, ecology, engineering, and general-history stories inside the Originals Studio; keep the three EBCI-gated entries blocked until cultural review completes.
4. No media asset may be ingested; the builder gate stays fail-closed until an exact asset is explicitly approved with matching hash and credit.

### Do not repeat after S2D

- Media candidate selection, download, hashing, or Commons/LOC metadata verification for the eight dossier slots unless an asset is swapped.
- EBCI page or contact re-verification unless a letter bounces or the EBCI site structure changes.
- S2/S2B/S2C dossier, route evidence, current-road reader, and vehicle-binding work.
- Any Cherokee interpretation, pronunciation, narration, or outreach send before the corresponding gate approval.

## S3A Foothills editorial and Studio V2 baseline

- Started: 2026-08-07.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `e7f70a4c8fd5de8f47cd8e13aae2925ed4e46887`.
- Worktree: `/home/sean/.openclaw/worktrees/trailhead-smokies-s2`; clean at start.
- Protected main-worktree hashes remain unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Other-agent reconciliation is complete: S2C route/readiness hardening and S2D media-rights/EBCI outreach preparation are accepted at `e7f70a4c`. They will not be repeated.
- Scope is the first bounded S3 editorial packet:
  - Add proper Manifest V2 story/chapter editing to the existing Originals Studio instead of creating another authoring system.
  - Draft and source-lock the six non-gated Foothills Parkway feature stories and seven short cues.
  - Feature stories target approximately 3–5 minutes each and must read as complete scene-led narratives, not one-minute fact summaries.
  - Keep operational facts outside immutable narration, and keep all EBCI-gated entries blocked.
  - Add deterministic word-count, claim/source, cultural-gate, copy-quality, and Studio rendering checks.
- Current official NPS pages for Foothills Parkway, the Missing Link, geology, vegetation, and air quality were rechecked before drafting. No broad 28-source refresh was performed.
- No Cartesia request, credit spend, narration audio, media ingestion, external outreach, deployment, OTA, native build, or public-stage change is included.
- Task-owned background processes at start: none.

### Next exact action after this baseline

1. Implement the Studio V2 story/chapter presentation and source-locked editorial artifact.
2. Draft the Foothills Parkway feature stories and cues, then run focused editorial and Studio tests.
3. Stop for script review before any Cartesia audition or the next chapter batch.

### Do not repeat during S3A

- S0/S1/S2 provenance, routes, source dossiers, media-rights research, or Moab inventory.
- Envato downloads, EBCI outreach, Cherokee interpretation/pronunciation, or paid narration.
- Broad app, Map, Explore, Layers, Originals lifecycle, Android Auto, memory, or store-screenshot tests.

## S3A Foothills editorial and Studio V2 completion

- Completed: 2026-08-07.
- Baseline checkpoint commit: `f9b3a2e3701bb404e6f047a74f320957ad159277`.
- Accepted implementation commit: `f640c226a2de25ab6af2de25e292c3009c3e76a3`.
- Added the first source-locked editorial artifact at `originals/smokies/editorial_scripts_v1.json`:
  - Artifact SHA-256: `cef28e80ac91018f18cccdbdab53321db81e454f2a6f2b1dee305068f877e33b`.
  - Six Foothills Parkway feature stories and seven short road cues.
  - 3,257 total words and 1,346 seconds estimated at 145 words per minute (about 22 minutes 26 seconds).
  - Feature stories range from 453 to 490 words and approximately 3:07 to 3:23 each.
  - Short cues range from 59 to 64 words and approximately 24 to 26 seconds each.
- Every entry is bound to its exact dossier ID, chapter, kind, sequence, claim IDs, and reviewed NPS source IDs. The loader derives immutable normalized transcript hashes, word counts, duration estimates, source records, and the artifact hash.
- Validation fails closed for dossier hash drift, mismatched claims/sources, blocked cultural entries, duplicate IDs, undersized or oversized scripts, provider labels, external-app instructions, generic safety filler, and unsupported certainty.
- The existing Originals Studio now includes an administrator-only source-locked editorial review panel with:
  - Long-story and short-cue separation.
  - Word and estimated-duration labels.
  - Visible-scene and editorial-purpose context.
  - Full transcript reading.
  - Reviewed source links and short hash evidence.
- The panel reads through `GET /api/admin/originals-editorial/smokies`, protected by the existing administrator requirement. It does not create a second ownership, manifest, playback, or narration system.
- Source audit corrections made before acceptance:
  - Removed facts that were supported only by an unregistered supplemental NPS page.
  - Kept current closures and route availability outside immutable narration.
  - Replaced a seasonal forest inference with facts from the reviewed vegetation source.
  - Kept air-quality interpretation within the reviewed NPS air-quality source.
- Verification:
  - 104 focused backend tests passed across editorial, Studio, source dossiers, cultural review, Manifest V2, route evidence, and operational readiness.
  - Both Studio JavaScript contract tests passed and the complete inline admin JavaScript parsed successfully.
  - Python compilation, source-copy scan, deterministic loader/hash checks, protected-file hashes, and `git diff --check` passed.
- Protected main-worktree hashes remain unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- No Cartesia request, credit spend, audio, media ingestion, EBCI outreach, deployment, OTA, native build, or public-stage change occurred.
- Task-owned background processes at completion: none.

### Next exact action after S3A

1. Review the six Foothills feature scripts and seven cues in the Originals Studio.
2. Apply one bounded editorial revision pass if requested.
3. After acceptance, draft the non-gated Mountain Crossing entries while keeping `mc_story_15` and `mc_cue_07` blocked.
4. Do not generate a Cartesia audition until the script batch is accepted and the provider terms, training opt-out, account balance, overage price, and hard caps are confirmed.

### Do not repeat after S3A

- Foothills NPS source research, S0/S1/S2 work, media-rights inventory, or route reconstruction unless a source or script claim changes.
- Broad app crawls or completed Originals lifecycle testing.
- EBCI outreach, Cherokee interpretation/pronunciation, media ingestion, or paid narration before their explicit gates.

## S3B Mountain Crossing editorial baseline

- Started: 2026-08-07.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `fa47fe5479d21b495aa0a78902b93daabb37661c`.
- Worktree: `/home/sean/.openclaw/worktrees/trailhead-smokies-s2`; clean at start.
- The user accepted the long-form direction and explicitly asked to continue. Mountain Crossing therefore proceeds as the next bounded source-locked chapter packet.
- Protected main-worktree state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- Scope is the 17 non-cultural Mountain Crossing feature stories and nine non-cultural road cues already defined in the checked source dossier.
- `mc_story_15` and `mc_cue_07` remain blocked for compensated EBCI participation and cultural review. No substitute cultural interpretation, sacred story, or pronunciation will be drafted.
- Feature stories continue to target approximately 3–5 minutes each. Short cues remain brief scene/location transitions and are not counted as full stories.
- Operational availability, closures, weather, parking, and route restrictions remain outside immutable narration and use the existing Start Tour readiness path.
- The existing Originals Studio and source-lock validator will be extended for chapter-aware review; no second Studio, manifest, player, entitlement, or map system will be created.
- No Cartesia request, credit spend, audio, media ingestion, external outreach, deployment, OTA, native build, or public-stage change is included.
- Task-owned background processes at start: none.

### Next exact action after this baseline

1. Add chapter-aware source-locked editorial packets to the existing Studio.
2. Draft the 17 approved Mountain Crossing stories and nine cues against their exact reviewed claim and source IDs.
3. Run focused editorial, cultural-gate, Studio, Manifest V2, and route-evidence checks.
4. Stop for script review before Cartesia narration or the next chapter batch.

### Do not repeat during S3B

- Foothills editorial/source research, S0/S1/S2 provenance, route construction, media-rights inventory, or Moab validation.
- EBCI outreach, Cherokee interpretation/pronunciation, Envato work, or narration generation.
- Broad app, Map, Explore, Layers, Originals lifecycle, Android Auto, memory, or store-screenshot testing.

## S3B Mountain Crossing editorial and chapter-aware Studio completion

- Completed: 2026-08-07.
- Baseline checkpoint commit: `2f36a2e3`.
- Accepted implementation commit: `8bca4c4c1854801e0b188527dec3c558214d2d2b`.
- Added `originals/smokies/editorial_mountain_crossing_v1.json`:
  - Artifact SHA-256: `d030bcd884d1ccfe4774eea1e83a7c7075f7aa691f14b00a24af28c076760f4d`.
  - Seventeen non-cultural feature stories and nine short road cues.
  - 8,421 words and 3,484 estimated seconds at 145 words per minute: about 58 minutes 4 seconds.
  - Feature stories range from 450 to 493 words and approximately 3:06 to 3:24 each.
  - Short cues range from 57 to 66 words and approximately 24 to 27 seconds each.
- `mc_story_15` and `mc_cue_07` remain absent and fail-closed for compensated EBCI participation and cultural review. The factual public record of the 2024 Kuwohi name restoration is covered without adding pronunciation, sacred tradition, or substitute cultural interpretation.
- Source-lock corrections applied during audit:
  - The biodiversity count uses the registered Nature source rather than a newer unbound statistics value.
  - CCC exclusion history remains in the separately sourced segregation story instead of leaking into the stonework entry.
  - An unbound park-creation lease detail and an unbound logging-timeline date were removed.
  - The haze story stays within the reviewed NPS air-quality distinction rather than adding an unregistered atmospheric explanation.
- The existing Originals Studio is now chapter-aware:
  - One administrator-only source-locked review surface covers both Foothills Parkway and Mountain Crossing.
  - Chapter names appear in the list and transcript review context.
  - Per-chapter hashes and counts are preserved while the endpoint returns one combined product review packet.
  - No second Studio, manifest, player, map, ownership, download, or entitlement system was introduced.
- Current combined reviewed draft library:
  - Two chapters, 23 full stories, and 16 short cues.
  - 11,678 words and 4,830 estimated seconds: about 80 minutes 30 seconds.
  - Combined editorial artifact SHA-256: `116b0f9b7c7c3da97011af268c36c81281b675e0829c227928c4447108d9231c`.
- Verification:
  - 135 focused backend tests plus four subtests passed across editorial, Studio, source dossiers, cultural review, Manifest V2, route evidence, operational readiness, and official route fixtures.
  - Originals Studio JavaScript parsed and its chapter-aware contract test passed.
  - Python compilation, JSON parsing, source/copy scan, deterministic loader/hash checks, protected-file hashes, and `git diff --check` passed.
  - No open P0/P1 defect was found in this packet.
- Protected main-worktree hashes remain unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- No Cartesia request, credit spend, narration audio, media ingestion, EBCI outreach, deployment, OTA, native build, or public-stage change occurred.
- Task-owned background processes at completion: none.

### Next exact action after S3B

1. Review the Mountain Crossing chapter in the existing Originals Studio and apply one bounded editorial revision pass if requested.
2. After acceptance, begin the non-cultural Little River and Cades Cove stories and cues while keeping `cc_story_04` blocked.
3. Author direction-specific transition/cue adaptations before final chapter compilation; no audio asset is locked until both route directions read naturally.
4. Continue to keep current closures, vehicle-free days, fees, weather, and restrictions in live Start Tour readiness rather than immutable narration.
5. Do not generate a Cartesia audition until the reviewed scripts and pronunciations are locked and the provider terms, training opt-out, balance, overage rate, 225,000-credit cap, and $15-before-tax cap are confirmed.

### Do not repeat after S3B

- Mountain Crossing or Foothills source research and first-draft writing unless a reviewer identifies a specific claim or editorial issue.
- S0/S1/S2 provenance, routes, route evidence, media-rights work, or Moab validation.
- Broad app crawls, completed Originals lifecycle tests, paid narration, or public release work.
- Cultural interpretation, pronunciation, or the blocked entries before EBCI participation and approval.

## S3C Little River and Cades Cove editorial baseline

- Started: 2026-08-07.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `ce789c21820425bf9dd7d66f1b6c93105130f037`.
- Worktree: `/home/sean/.openclaw/worktrees/trailhead-smokies-s2`; clean at start.
- The user accepted the next chapter action and explicitly asked to proceed.
- Protected main-worktree state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- Scope is the 13 non-cultural Little River and Cades Cove feature stories plus nine short road cues already defined in the checked source dossier.
- `cc_story_04` remains blocked for compensated EBCI participation and cultural review. No substitute account of Cherokee history or place relationships will be drafted.
- Feature stories continue to target approximately 3–5 minutes. Cues remain short transitions and are not counted as full stories.
- Current road access, vehicle-free days, closures, weather, fees, and wildlife notices remain live Start Tour readiness data rather than immutable narration.
- The chapter will use the existing chapter-aware Originals Studio and source-lock validator. No parallel Studio, manifest, player, map, ownership, entitlement, or download system will be introduced.
- No Cartesia request, credit spend, narration audio, media ingestion, external outreach, deployment, OTA, native build, or public-stage change is included.
- Task-owned background processes at start: none.

### Next exact action after this baseline

1. Recheck only the registered official NPS sources used by the Little River and Cades Cove claims.
2. Draft and source-lock the 13 approved feature stories and nine cues.
3. Extend the existing Studio/loader/tests for the third chapter and run focused safeguards.
4. Stop for script review before Roaring Fork or narration generation.

### Do not repeat during S3C

- Foothills or Mountain Crossing research and first-draft work.
- S0/S1/S2 provenance, routes, route evidence, media-rights inventory, Moab validation, or broad app testing.
- EBCI outreach, Cherokee interpretation/pronunciation, Envato work, or paid narration.

## S3C Little River and Cades Cove editorial completion

- Completed: 2026-08-07.
- Baseline checkpoint commit: `8b96cf14`.
- Accepted implementation commit: `2ba38455a05cad9b53733e260b0e69fa156b05bd`.
- Added `originals/smokies/editorial_cades_cove_v1.json`:
  - Artifact SHA-256: `a0c4bafda0b593160d27dfc3d86df9150084f1d2a7039d6ba5cd378de610677a`.
  - Thirteen source-locked non-cultural feature stories and nine short road cues.
  - 6,423 words and 2,660 estimated seconds at 145 words per minute: about 44 minutes 20 seconds.
  - Feature stories remain within the enforced 450–725-word range; cues remain within the enforced 50–120-word range.
- `cc_story_04` remains absent and fail-closed for compensated EBCI participation and cultural review. No substitute Cherokee history, place relationship, sacred tradition, or pronunciation was drafted.
- Official NPS source pages rechecked for this packet:
  - Cades Cove planning and one-way loop: `https://www.nps.gov/grsm/planyourvisit/cadescove.htm`.
  - Cades Cove settlement, community labor, acquisition, life leases, schools, and post office: `https://www.nps.gov/grsm/learn/historyculture/cades-cove-history.htm`.
  - Cable Mill: `https://www.nps.gov/places/cable-mill-historic-area.htm`.
  - General stores: `https://www.nps.gov/grsm/learn/historyculture/stores.htm`.
  - Geology, natural features, people, timeline, and black bears remain bound through the existing reviewed dossier records.
- Operational separation is preserved:
  - Vehicle-free periods, closures, congestion, fees, trail conditions, water hazards, weather, wildlife distances, and active notices remain live Start Tour readiness data.
  - Immutable narration makes no promise of access, safety, wildlife sightings, or current conditions.
- The existing chapter-aware Originals Studio now exposes `Little River & Cades Cove`; no second Studio, manifest, player, map, ownership, entitlement, or download system was introduced.
- Current combined reviewed draft library:
  - Three chapters, 36 full stories, and 25 short cues.
  - 18,101 words and 7,490 estimated seconds: about 124 minutes 50 seconds.
  - Combined editorial artifact SHA-256: `fdb51d911a6c6944f18b23753b28d0f89a18f947bf1b1c93d13a50a52025aeb2`.
- Verification:
  - 136 focused backend tests plus four subtests passed across editorial, Studio, source dossiers, cultural review, Manifest V2, route evidence, operational readiness, and official route fixtures.
  - Originals Studio JavaScript contract test passed.
  - Python compilation, JSON parsing, public-copy/encoding scan, source-lock validation, protected-file hashes, and `git diff --check` passed.
  - No open P0/P1 defect was found in this packet.
- Protected main-worktree hashes remain unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- No Cartesia request, credit spend, narration audio, media ingestion, EBCI outreach, deployment, OTA, native build, or public-stage change occurred.
- Task-owned background processes at completion: none.

### Next exact action after S3C

1. Review the Little River and Cades Cove chapter in the existing Originals Studio and apply one bounded editorial revision pass if requested.
2. Draft the seven source-cleared Roaring Fork feature stories and six short road cues; `rf_story_03` is the factual Noah Ogle farmstead entry and is not culturally blocked in the authoritative dossier.
3. Author direction-specific transition/cue adaptations for bidirectional chapters before final compilation.
4. Complete the cultural and pronunciation gates before any blocked script or narration asset.
5. Lock all accepted scripts, then verify Cartesia training opt-out, balance, overage rate, 225,000-credit cap, and $15-before-tax cap before generating the three representative auditions.

### Do not repeat after S3C

- Foothills, Mountain Crossing, or Cades Cove first-draft research unless a reviewer identifies a specific claim or editorial issue.
- S0/S1/S2 provenance, routes, route evidence, media-rights inventory, Moab validation, or completed app lifecycle testing.
- Broad app crawls, paid narration, deployment, public release, or store work.
- Cultural interpretation, pronunciation, or blocked entries before compensated EBCI participation and approval.

## S3D Roaring Fork editorial baseline

- Started: 2026-08-07.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `299f78b8cc6991ae30915a2d14ffec8cdc46c0ee`.
- Worktree: `/home/sean/.openclaw/worktrees/trailhead-smokies-s2`; clean at start.
- The user accepted the next exact action and explicitly asked to proceed.
- Protected main-worktree state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- Scope is the seven source-cleared Roaring Fork feature stories and six short road cues already defined in the checked source dossier.
- Baseline audit correction: `rf_story_03` is the factual Noah Ogle farmstead entry, its sole claim `rf_ogle_farm` is explicitly `cultural_gate: not_required`, and it is not in `cultural_review.blocked_entry_ids`. The only blocked entries remain `cc_story_04`, `mc_story_15`, and `mc_cue_07`; no cultural interpretation or pronunciation will be added to Roaring Fork.
- Feature stories continue to target approximately 3–5 minutes. Cues remain short scene/location transitions and are not counted as full stories.
- Current one-way/seasonal access, vehicle restrictions, closures, weather, trail conditions, wildlife notices, and congestion remain live Start Tour readiness data rather than immutable narration.
- The chapter will use the existing chapter-aware Originals Studio and source-lock validator. No parallel Studio, manifest, player, map, ownership, entitlement, or download system will be introduced.
- No Cartesia request, credit spend, narration audio, media ingestion, external outreach, deployment, OTA, native build, or public-stage change is included.
- Task-owned background processes at start: none.

### Next exact action after this baseline

1. Recheck only the registered official NPS sources used by the Roaring Fork claims.
2. Draft and source-lock the seven approved feature stories and six cues.
3. Extend the existing Studio/loader/tests for the fourth chapter and run focused safeguards.
4. Stop for script review before directional adaptation, final compilation, or narration generation.

### Do not repeat during S3D

- Foothills, Mountain Crossing, or Cades Cove research and first-draft work.
- S0/S1/S2 provenance, routes, route evidence, media-rights inventory, Moab validation, or broad app testing.
- EBCI outreach, Cherokee interpretation/pronunciation, Envato work, or paid narration.

## S3D Roaring Fork editorial completion

- Completed: 2026-08-07.
- Baseline checkpoint commit: `fada34d7`.
- Accepted implementation commit: `2c57d2138e2f95b4da7f2ebf3e9a3d44315f3414`.
- Baseline correction is durable:
  - Roaring Fork contains seven source-cleared stories, not six.
  - `rf_story_03` is the factual Noah “Bud” Ogle farmstead entry and its `rf_ogle_farm` claim is explicitly `cultural_gate: not_required`.
  - The only culturally blocked entries remain `cc_story_04`, `mc_story_15`, and `mc_cue_07`.
- Added `originals/smokies/editorial_roaring_fork_v1.json`:
  - Artifact SHA-256: `85f4912276338e48ecd5a46971fada986a67965f833afacff4af6e750c00b7fb`.
  - Seven source-locked feature stories and six short road cues.
  - 3,581 words and 1,480 estimated seconds at 145 words per minute: about 24 minutes 40 seconds.
  - Feature stories range from 452 to 478 words and approximately 3:07 to 3:18 each.
  - Short cues range from 55 to 61 words and approximately 23 to 25 seconds each.
- Official NPS source pages rechecked for this packet:
  - Roaring Fork route, Noah Ogle farmstead, stream, old-growth glimpses, Grotto Falls access, historic structures, and Place of a Thousand Drips: `https://www.nps.gov/grsm/planyourvisit/roaringfork.htm`.
  - Park history and cultural-resource framing: `https://www.nps.gov/grsm/learn/historyculture/index.htm`.
  - Forest, elevation, rainfall, humidity, biodiversity, and park-wide old growth: `https://www.nps.gov/grsm/learn/nature/index.htm`.
  - Streams, rainfall, elevation gradient, and waterfalls: `https://www.nps.gov/grsm/learn/nature/naturalfeaturesandecosystems.htm`.
  - Resistant rock, mountain building, erosion, and waterfall formation: `https://www.nps.gov/grsm/learn/nature/geology.htm`.
  - Settlement, mills, logging, displacement, forest retention, and preserved structures: `https://www.nps.gov/grsm/learn/historyculture/people.htm`.
- Source-depth audit corrections applied before acceptance:
  - Rewrote the community story to remove invented household tasks, neighbor relationships, missing property features, and unsupported seasonal details.
  - Reworked the route introduction to replace repetition and unsupported design intent with the sourced 5.5-mile route and documented stream, old-growth, cabin, and mill sequence.
  - Locked the exact one-way story/cue order in tests, including the dossier’s intentional `01, 03, 02` story and `01, 02, 04, 03` cue ordering.
- Operational separation is preserved:
  - The live 2026 seasonal dates, current closure status, parking pressure/tag availability, vehicle restrictions, weather, and trail conditions remain Start Tour readiness data.
  - Permanent narration makes no promise of road availability, parking, trail access, waterfall flow, or vehicle compatibility.
- Media remains gated:
  - Roaring Fork media records remain `exact_asset_not_selected`/candidate-only.
  - No public-domain or attributed candidate was treated as approved, downloaded, ingested, or bundled.
- The existing chapter-aware Originals Studio now exposes `Roaring Fork`; no second Studio, manifest, player, map, ownership, entitlement, or download system was introduced.
- Current combined reviewed draft library:
  - Four route chapters, 43 full stories, and 31 short cues.
  - 21,682 words and 8,970 estimated seconds: about 149 minutes 30 seconds.
  - Combined editorial artifact SHA-256: `180ec7c0fff35eec2379a1a1b72336b050223f17dda54771c0ff98e69dc588fa`.
  - The three culturally gated entries account for the difference from the planned 45 stories and 32 cues.
- Verification:
  - 137 focused backend tests plus four subtests passed across editorial, Studio, source dossiers, cultural review, Manifest V2, route evidence, operational readiness, and official route fixtures.
  - Originals Studio JavaScript contract test passed.
  - Python compilation, JSON parsing, public-copy/encoding scan, exact sequence assertion, independent source-depth audit, protected-file hashes, and `git diff --check` passed.
  - No open P0/P1 defect remains in this packet.
- Protected main-worktree hashes remain unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- No Cartesia request, credit spend, narration audio, media ingestion, EBCI outreach, deployment, OTA, native build, or public-stage change occurred.
- Task-owned background processes at completion: none.

### Next exact action after S3D

1. Review all four completed chapters in the existing Originals Studio and apply one bounded editorial revision pass to any specifically identified story.
2. Build direction-specific transition and cue adaptations for Mountain Crossing and Foothills Parkway while preserving the one-way Cades Cove and Roaring Fork sequences.
3. Run queue-spacing and route-speed fixtures for the clustered Roaring Fork entrance, upper corridor, Thousand Drips, and exit anchors before any audio lock.
4. Complete compensated EBCI scope/review before drafting or voicing the three culturally blocked entries.
5. Lock accepted scripts and pronunciations, then verify Cartesia training opt-out, balance, overage rate, 225,000-credit cap, and $15-before-tax cap before generating the three representative auditions.

### Do not repeat after S3D

- First-draft research or wholesale rewriting for any of the four completed chapters without a specific editorial/source finding.
- S0/S1/S2 provenance, route construction, media-rights inventory, Moab validation, or completed app lifecycle testing.
- Broad app crawls, paid narration, deployment, public release, or store work.
- Cultural interpretation, pronunciation, or blocked scripts before compensated EBCI participation and approval.

## S3E directional adaptation and trigger-spacing baseline

- Started: 2026-08-07.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `5e7ece92ef4d3393af5268b833dc364519bfeb89`.
- Worktree: `/home/sean/.openclaw/worktrees/trailhead-smokies-s2`; clean at start.
- Protected main-worktree state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- Scope is limited to direction-specific transition/cue adaptations for Mountain Crossing and Foothills Parkway plus route-progress trigger spacing and deterministic queue-drain evidence.
- Mountain Crossing and Foothills Parkway remain the only bidirectional chapters. Little River/Cades Cove and Roaring Fork preserve their accepted one-way sequence and transcript library.
- Geometric projection and trigger comparisons use the checked official route evidence in-process. No Mapbox request, route regeneration, temporary-use geometry persistence, or API credit spend is included.
- Roaring Fork validation must cover clustered entrance, upper-corridor, Thousand Drips, and exit anchors at 15, 36, and 65 mph, including jitter, poor accuracy, rejoin, restart, and complete queue drainage.
- This packet does not rewrite accepted first drafts, draft blocked cultural entries, create pronunciations, generate narration, spend Cartesia credits, ingest media, deploy, publish an OTA, change native code, or change a public stage.
- Task-owned background processes at start: none.

### Next exact action after this baseline

1. Inventory every dossier entry marked for directional adaptation and the exact permanent route variants it binds to.
2. Extend the existing source-locked editorial/runtime compilation contract rather than creating duplicate stories or another player.
3. Add route-progress trigger-spacing and queue-drain fixtures for the clustered Roaring Fork anchors.
4. Run focused editorial, route, trigger, Studio, privacy/copy, and deterministic-hash checks.
5. Stop for review before any cultural drafting, narration audition, media ingestion, deployment, or public release.

### Do not repeat during S3E

- First-draft writing or broad source research for the four accepted chapters.
- S0/S1/S2 provenance, entitlement, route construction, media-rights, Moab inventory, or app lifecycle work.
- Broad Map, Explore, Layers, Memory, NPS, Android Auto, Offline, or store-screenshot tests.
- Cartesia generation, EBCI interpretation/pronunciation, Envato work, deployment, OTA, or native builds.
