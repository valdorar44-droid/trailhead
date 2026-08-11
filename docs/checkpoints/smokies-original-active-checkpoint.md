# Great Smoky Mountains Original — Active Checkpoint

Last updated: 2026-08-10 (S4M SHA-pinned administrator-attestation hardening complete locally; not deployed)

## Resume protocol

Read this file before continuing the Great Smoky Mountains Original. Do not repeat the competitor, Moab pipeline, entitlement, or cleanup audits unless new evidence invalidates them.

1. Run `git status --short --branch` in `/home/sean/.openclaw/worktrees/trailhead-smokies-s2`.
2. Separately verify the protected dirty files and hashes in `/home/sean/.openclaw/workspace/trailhead`.
3. Preserve `.cursor/`, `dashboard/explore_serving_index_v2.json`, and `docs/app-store-copy.md`; do not stage them.
4. Continue from the latest **Next exact action** at the end of this document. Do not buy, record, extract, transcribe, or imitate a competitor audio tour.

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

The runtime keeps a durable ordered pending-story FIFO with a legacy mirrored head for mixed writers. Story timing and trigger spacing must pass the current 15/36/65 mph continuous-route scenarios, the 240-second route-end backlog limit, and the 180-second trigger-to-play limit for every chapter/variant.

## Sources, rights, and cultural review

- Use NPS auto-touring, seasonal-road, closure, fee, history, nature, wildlife, and Cades Cove sources as the operational and factual backbone.
- Review every NPS asset individually. Employee-created material is often public domain, but third-party material may remain copyrighted and the NPS Arrowhead is not available for casual product use.
- Narrow, directly attributed facts from current official public records may be drafted and reviewed internally. This classification is Trailhead policy, not an EBCI exemption or release approval; the Smokies publish path remains blocked until an immutable EBCI CIRB scope determination or approval is recorded.
- Sacred or traditional interpretation, direct EBCI-member research, unpublished or restricted knowledge, culturally supplied pronunciation, and research on EBCI Tribal Lands remain fail-closed. Budget for compensated EBCI participation when any of those scopes is proposed, and require Tribal Resolution evidence before any future on-Tribal-Lands research claim can be approved.
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

## S3E directional adaptation and trigger-spacing completion

- Completed: 2026-08-08 00:17 CDT.
- Branch: `feat/smokies-original-s2`.
- Baseline checkpoint commit: `1cf78889d79fd462f2413bfc1859b9b181f41a90`.
- Directional/runtime implementation commit: `88e6a945b9aad9df5022b7a1710ea5be5873dd26`.
- Roaring Fork evidence commit: `cc6ccfe15ac2e7027909f0122afb4c828203ff0d`.
- Protected main-worktree state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.

### Completed behavior and evidence

- The existing source-locked editorial system now reviews both permanent directions for Mountain Crossing and Foothills Parkway. It does not duplicate shared stories or create a second player.
- Exactly eight short cues carry reviewed reverse-direction transcript overrides:
  - Foothills Parkway east to west: `fp_cue_01`, `fp_cue_05`, `fp_cue_07`.
  - Mountain Crossing North Carolina to Tennessee: `mc_cue_01`, `mc_cue_02`, `mc_cue_04`, `mc_cue_08`, `mc_cue_09`.
- Seven long stories were made direction-neutral so one reviewed narration remains valid in both directions. Direction-neutral source-locked titles now include `Sugarlands and the watershed`, `The Oconaluftee valley`, and `A long view`.
- Manifest V2 now supports selection-bound alternate transcript/title/audio records. Unknown, duplicate, unused, and semantically empty overrides fail closed. Every alternate narration asset is format-checked, and every alternate transcript hash is independently rechecked by the cultural-approval gate.
- The only culturally blocked entries remain `cc_story_04`, `mc_story_15`, and `mc_cue_07`; none is authored or overridden.
- Foreground, background/headless, and validation playback now share one durable ordered FIFO and one promotion helper. Legacy `queued_stop_id` remains a mirrored head for mixed 1.0.11 writers; absent, empty, conflicting, completed, and stale legacy states are reconciled deterministically without dropping the canonical tail.
- Validator V3 is source-controlled as `original-trigger-v3` / `originals_virtual_route_v3`. It rejects publication when route-end audio backlog exceeds 240 seconds or trigger-to-play latency exceeds 180 seconds, even if the FIFO eventually drains every story in order without overlap.
- The Virtual Drive Lab marks every pending FIFO story as queued. Obsolete one-slot `queue_full` diagnostics and consumer wording were removed.
- Current combined reviewed base library:
  - Four chapters, 43 full stories, 31 short cues, and 74 entries.
  - 21,679 base words and 8,970 estimated seconds: about 149 minutes 30 seconds before the three culturally gated entries.
  - Eight reverse-direction cue overrides across the two bidirectional chapters.
  - Combined editorial artifact SHA-256: `0a5d40ea5285da1da78a9d076b049936c4f168fd7010a42487ca76f1225dc672`.
  - Source dossier file SHA-256: `bc1bdbd18a79d7b5e0417d17d149044b97ccc485c068712423f25efec67ab561`.
- Chapter artifact SHA-256 values:
  - Foothills Parkway: `e53effe10f7631dd2e183bae8e2c684fd37780a30e6ad8487106c10ca1415660`.
  - Mountain Crossing: `c685b2fafc11a38c7041174d6fc61cedab54abe39894347a55039d62b7932fb9`.
  - Little River and Cades Cove: `707359658d3aa34856104a945a402577ffb3f7c7de8b2f3adf6920ce3e73cac0`.
  - Roaring Fork: `d61f9e04b943fe7ff2b9a57735b1f515dff0d37f23d5a6c50dcc18fec095162c`.
- `originals/smokies/roaring_fork_trigger_preflight_v1.json` is a deterministic authoring-only placement packet using the checked 8,561.4-m official NPS route geometry and no Mapbox network request. Artifact SHA-256: `063983f3c0d756bceba911744844478272edf36a3c88c9df081e44077dcbb3d4`.
- The preflight binds the exact accepted FIFO runtime commit `88e6a945...` and SHA-256 values for the session, trigger engine, validator, foreground runtime, and headless controller. It no longer describes the obsolete one-pending-slot runtime.

### Verification

- 165 focused Python tests plus seven subtests passed across Manifest V2, cultural review, Studio, editorial, source dossiers, operational readiness, route evidence, official routes, and Roaring Fork placement evidence.
- After the final runtime-evidence rebind, all nine Roaring Fork preflight tests and its deterministic `--check` passed again.
- Complete mobile `npm run test:originals` passed, including Manifest V2, mixed-writer FIFO migration, multi-entry background drain, runtime stop races, validator limits, privacy, V1 Moab compatibility, and the existing map/player lifecycle.
- Strict mobile `npx tsc --noEmit --pretty false` passed.
- Originals Studio JavaScript contract tests, Python compilation, dossier and preflight deterministic builders, and `git diff --check` passed.
- Independent final audits found no unresolved P0/P1 after the exact runtime evidence was rebound.
- No Android/iOS build, runtime, or update identity changed because this packet was not deployed. No preview or production OTA was published.

### Intentional publication blockers

- Roaring Fork remains `blocked_pending_exact_scene_resolution_real_audio_durations_and_fifo_validation`; this is an honest content-timing gate, not a hidden runtime failure.
- The exact Noah Ogle landmark is absent from the checked route evidence, so `rf_cue_02` and `rf_story_03` currently use an entrance proxy and cannot publish.
- Exact-scene clusters remain at the entrance, Thousand Drips, and the route exit. They were not moved away from what the passenger can see merely to manufacture spacing.
- Real rendered audio durations remain unavailable. Authoring estimates show route-end tails of approximately 315 seconds at 15 mph, 953 seconds at 36 mph, 1,189 seconds at 65 mph, and 1,228 seconds at 75 mph. The validator therefore stays fail-closed until the editorial/placement design is resolved and real audio is tested.

### Next exact action after S3E

1. Resolve the Roaring Fork exact-scene timing honestly: add a checked Noah Ogle landmark, then decide which clustered material becomes one consolidated narration, an explicit stopped-vehicle story, or a separately selectable deeper story. Do not scatter exact-scene openings down the road.
2. Rebuild the preflight with the accepted placement design. Keep the 240-second route-end and 180-second trigger-to-play limits unchanged.
3. Superseded by S3F: the three fact-only public-record entries are drafted, but public release remains blocked pending an immutable EBCI CIRB scope determination; sensitive interpretation and pronunciation remain gated.
4. After scripts, pronunciations, and placement are locked, verify Cartesia training opt-out, balance, overage rate, the 225,000-credit cap, and the $15-before-tax cap before generating the three representative auditions.

### Do not repeat after S3E

- The completed first-draft writing, broad source research, route reconstruction, Moab provenance, Manifest V2 ownership, or earned-credit work.
- The directional inventory, eight cue adaptations, FIFO architecture, mixed-writer migration, or one-slot diagnostic cleanup while their tests remain green.
- Broad Map, Explore, Layers, Memory, NPS, Android Auto, Offline, Originals lifecycle, or store-screenshot crawls.
- Cartesia generation, cultural interpretation/pronunciation, media ingestion, deployment, OTA, native build, or public-stage changes before their explicit gates.

## Task-owned background processes at S3E completion

- None. The temporary ignored `mobile/node_modules` verification symlink was removed. No Metro, Gradle, Maestro, pytest, TTS renderer, EAS, Railway, cleanup, or compaction task remains running.

## S3F public-record cultural scope baseline

- Started: 2026-08-08.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `8e193ba0bcee81d5136123cf9c15e1b3712626de`.
- Worktree was clean before this checkpoint.
- Protected main-worktree state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- Official-policy correction: the EBCI Cultural Institutional Review Board explicitly covers research involving EBCI people, Tribal Lands, language, and cultural materials, and requires approval for research on EBCI Tribal Lands. Its public guidance does not state that every narrow factual use of already-published official records requires prior approval.
- Trailhead will therefore distinguish source-attributed public-record facts from review-triggering cultural work. Public-record narration may proceed only within the exact published facts. Sacred or traditional interpretation, direct EBCI-member research, unpublished or restricted knowledge, research on EBCI Tribal Lands, and culturally supplied or otherwise unsupported pronunciation remain fail-closed.
- This boundary is Trailhead's conservative editorial classification, not an EBCI determination. A CIRB scope inquiry remains recommended before public release of the cultural chapter.
- S3F scope is limited to the three previously blocked entries: `cc_story_04`, `mc_story_15`, and `mc_cue_07`; the source/dossier gate; deterministic compiler bindings; focused tests; and checkpoint evidence.
- This packet does not perform interviews or fieldwork, write sacred/traditional interpretation, use unpublished knowledge, generate Cartesia audio, ingest media, deploy, publish an OTA, change native code, or change a public stage.
- Task-owned background processes at start: none.

### Next exact action after this baseline

1. Replace the overbroad all-Cherokee-content block with an explicit public-record factual classification and fixed cultural-review triggers.
2. Author the three entries from current official public records only, without unsupported pronunciation or cultural synthesis.
3. Rebuild the source dossier, editorial bindings, and Roaring Fork preflight deterministically.
4. Run focused source, cultural-gate, editorial, Studio, manifest, privacy/copy, and hash checks once.
5. Stop before narration generation, deployment, OTA, or public release.

### Do not repeat during S3F

- S0-S3E provenance, entitlement, route building, first-draft chapter work, directional adaptation, FIFO runtime, or broad source research.
- Roaring Fork placement redesign or real-audio validation; its existing publication blocker remains separate.
- Broad Map, Explore, Layers, Memory, NPS, Android Auto, Offline, or store-screenshot work.

## S3F public-record cultural scope completion

- Completed: 2026-08-08.
- Branch: `feat/smokies-original-s2`.
- Baseline checkpoint commit: `1b642b63227790d54d6ac54e73d36c9bbbff751b`.
- Implementation commit: `f9cd42904e9450d2efe46a8e3b1f72f3b6d66bef`.
- Protected main-worktree state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.

### Completed behavior and editorial scope

- Replaced the former all-Cherokee-content block with a machine-readable scope contract:
  - `public_record_factual` material must come from `published_public_record` sources and carry no cultural-review trigger.
  - Sacred/traditional interpretation, culturally supplied pronunciation, direct EBCI-member research, unpublished/restricted knowledge, and research on EBCI Tribal Lands require immutable review evidence and remain blocked.
  - TTS rendering of gated content remains prohibited until approval.
- Public-record material can now be drafted, source-checked, and reviewed internally, but `OriginalManifestV2` publication fails closed until the Smokies dossier carries an immutable EBCI scope determination or approval record. The official EBCI CIRB page does not publish a blanket public-record exemption, so internal drafting is not treated as public-release permission.
- Authored the three previously blocked entries as direct, source-attributed factual narration:
  - `cc_story_04` — `Before the farms`.
  - `mc_story_15` — `A living community beside the park`.
  - `mc_cue_07` — `Name with care`.
- Removed the unsupported phonetic pronunciation from the public-record claim. No sacred story, traditional interpretation, member-supplied knowledge, unpublished material, or on-Tribal-Lands research was added.
- Kept both Mountain Crossing directions valid. `mc_story_14` and `mc_story_15` use direction-neutral language, and the public copy no longer claims that a correction guides every traveler.
- Current reviewed base library:
  - Four chapters, 45 full stories, 32 short cues, and 77 entries.
  - 22,737 base words and 9,408 estimated seconds: about 156 minutes 48 seconds.
  - Eight reviewed reverse-direction cue overrides.
- Deterministic evidence:
  - Source dossier SHA-256: `8eb22ca5110f0f9a4287b8f184624348c2a2ca2dbc36e27ef59fc022057ce18f`.
  - Foothills/editorial scripts SHA-256: `28627001d9b3bbd129e812721064e1a0c8fc2122ec9371afa91657026b76d81e`.
  - Mountain Crossing SHA-256: `29491ded766186ac918555bf29cafc432503ae4c1b2d3cb160185645b3e632dc`.
  - Little River/Cades Cove SHA-256: `1fedc6db4944bab671d7cfa0bacd2dda9670133d4165e27b3fe7b63ef8728845`.
  - Roaring Fork SHA-256: `5fe61090ae27dcfae74fd05e8ca464be6aa140c0383d5a339cc60f3096c9cc8f`.
  - Roaring Fork preflight SHA-256: `3c075e90f2ec8a2bec59fd136eaff10628d0246882c19a362b36ca8ed73a2953`.

### Verification

- 165 focused Python tests plus four subtests passed across source dossiers, cultural scope, editorial, Manifest V2, Originals Studio, operational readiness, route evidence, official routes, route specifications, and Roaring Fork preflight.
- After the final fact-bound copy refinement, the 74 directly affected editorial and Manifest V2 tests passed again.
- Originals Studio JavaScript tests, Python compilation, deterministic dossier/preflight checks, and `git diff --check` passed.
- An independent final read-only audit found no remaining P0/P1 in this packet.
- No Cartesia generation, TTS credit spend, media ingestion, backend deployment, OTA, native build, or public-stage change occurred.

### Remaining intentional blockers

- Public release remains blocked until an immutable EBCI CIRB scope determination or approval is recorded. If CIRB says review is not required for this exact fact-only scope, model and bind that written determination explicitly rather than treating silence as permission.
- Any future research on EBCI Tribal Lands additionally requires the applicable Tribal Resolution evidence before its claims can unlock.
- Roaring Fork remains blocked on the separate exact-scene placement and real-audio FIFO validation recorded in S3E. The source and cultural changes did not weaken its 240-second backlog or 180-second latency limits.
- Cartesia rendering remains blocked until the scripts and pronunciations are locked, training opt-out and account terms are confirmed, and the independent 225,000-credit / $15-before-tax caps are active.

### Next exact action after S3F

1. Resolve Roaring Fork's Noah Ogle landmark and dense exact-scene clusters without moving narration away from what passengers can see.
2. Rebuild the Roaring Fork preflight, then validate it with real rendered durations against the existing FIFO limits.
3. Send the exact fact-only cultural scope to EBCI CIRB for a written scope determination before any public release. Do not ask for a blanket endorsement or send sacred/traditional interpretation.
4. Once placement, source, cultural, and pronunciation gates are locked, generate only the three representative Cartesia auditions before batch narration.

### Do not repeat after S3F

- The public-record versus gated-content policy audit, the three restored scripts, the 45/32 editorial count, or the completed direction-neutral copy work while their source hashes remain unchanged.
- S0-S3E provenance, entitlement, route construction, first-draft chapters, directional adaptation, FIFO architecture, or broad source research.
- Broad Map, Explore, Layers, Memory, NPS, Android Auto, Offline, Originals lifecycle, or store-screenshot crawls.
- Paid TTS, deployment, OTA, native builds, or public release before the explicit remaining gates.

## Task-owned background processes at S3F completion

- None. No Metro, Gradle, Maestro, pytest, Cartesia renderer, EAS, Railway, cleanup, or compaction task remains running.

## S3G Roaring Fork exact-scene placement baseline

- Started: 2026-08-08.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `02788a90`.
- Worktree was clean at start.
- Protected main-worktree state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- Scope is limited to the checked Roaring Fork chapter: resolve the Noah Ogle location against authoritative evidence, design honest handling for dense entrance/Thousand Drips/exit narration, rebuild the deterministic preflight, and validate the existing FIFO limits.
- Mapbox geospatial operations are used only where road-network or geometric placement requires them. Checked NPS route and landmark evidence remains authoritative; no result may be placed merely to improve timing.
- Existing 45 stories, 32 cues, cultural-scope contract, other chapter scripts, mobile runtime, public stages, and protected files remain unchanged unless a deterministic Roaring Fork defect proves a narrow correction is required.
- This packet does not generate paid narration, ingest media, deploy, publish an OTA, change native code, or release the Original.
- Task-owned background processes at start: none.

### Next exact action after this baseline

1. Audit the checked route geometry, route anchors, official Noah Ogle evidence, and all 13 Roaring Fork openings.
2. Add the exact landmark only when it can be source-locked and projected onto the accepted route without rerouting the chapter.
3. Consolidate or reclassify dense exact-scene narration honestly; do not scatter it away from visible places.
4. Rebuild the authoring preflight and run the source-controlled backlog and trigger-latency gates at 15, 36, 65, and 75 mph.
5. Stop before Cartesia auditions unless the placement design is deterministic and publication-safe.

### Do not repeat during S3G

- S0-S3F provenance, entitlement, cultural-policy, source dossiers, other chapter drafts, directional adaptation, or FIFO architecture.
- Broad Map, Explore, Layers, Memory, NPS, Android Auto, Offline, Originals lifecycle, or store work.
- Paid narration, media ingestion, deployment, OTA, native builds, or public-stage changes.

## S3G Roaring Fork exact-scene placement completion

- Completed: 2026-08-08.
- Branch: `feat/smokies-original-s2`.
- Baseline checkpoint commit: `7c2d31b7`.
- Implementation commit and exact pre-checkpoint HEAD: `8ee4d8bece1e9b1be97ff026cdffde94fee4f1b3`.
- Protected main-worktree state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.

### Exact landmark and delivery decision

- Replaced the false Noah “Bud” Ogle entrance proxies with the official NPS coordinate `[-83.489714, 35.682841]` from the 2026 Superintendent's Compendium.
- The checked point is before the accepted Roaring Fork motor-trail route: nearest accepted-route progress `0.0 m`, lateral distance `889.5 m`, and nearest route coordinate `[-83.481398, 35.678543]`.
- Preserved the accepted `8,561.4 m` route and its geometry hash. The chapter was not rerouted to force Ogle into an autoplay trigger.
- Ogle is now one source-bound, user-confirmed parked prelude containing `rf_cue_02` followed by `rf_story_03`. Parking availability remains `not_checked`; Trailhead makes no parking promise and never infers parked state from speed alone.
- Every one of the 13 Roaring Fork entries is accounted for exactly once:
  - Five `hard_auto` cues: `rf_cue_01`, `rf_cue_04`, `rf_cue_03`, `rf_cue_05`, and `rf_cue_06`.
  - Four `capacity_deeper` stories: `rf_story_01`, `rf_story_02`, `rf_story_04`, and `rf_story_05`, each falling back to after-route availability when it cannot finish safely before the next hard cue.
  - Three `stopped_deeper` entries: the two-entry Ogle prelude and `rf_story_06` at Thousand Drips. Both contexts require explicit user-confirmed parked state and make no parking promise.
  - One `completion_deeper` story: `rf_story_07`.
- Hard cues can never wait behind optional material. Capacity admission requires the immutable audio duration, a start inside the story's reviewed scene, and a 30-second reserve before the next hard-cue window.

### Timing and Studio evidence

- Authoring-estimate simulations, not publication evidence:
  - 15 mph admits `rf_story_01`, `rf_story_02`, and `rf_story_05`; estimated route-end tail `0.0 s`, maximum trigger-to-play latency `14.8 s`, and maximum pending depth `1`.
  - 36 mph admits no capacity story; tail `6.0 s` and latency `0.0 s`.
  - 65 mph admits no capacity story; tail `13.7 s` and latency `0.0 s`.
  - 75 mph admits no capacity story; tail `16.5 s`, latency `1.6 s`, and maximum pending depth `1`.
- The source-controlled limits remain unchanged at `240 s` route-end audio backlog and `180 s` trigger-to-play latency. The preflight records `gates_weakened=false` and exposes no threshold override.
- Originals Studio now source/hash-binds the checked preflight and labels entries `AUTO CUE`, `DEEPER STORY`, `PLAY WHEN PARKED`, or `AFTER ROUTE`.
- Studio shows five guaranteed cues / `1:57` and eight selectable/deeper entries / `22:45`, explicitly as authoring estimates with publication blocked and parking availability not checked.
- A final independent audit found and closed one P1: a self-consistent edit could initially relabel a parked story as autoplay. The validator now locks the exact 13-entry order, entry-to-mode map, complete per-mode safety objects, blocked runtime/publication states, and the `240/180/30` timing limits.

### Verification and immutable evidence

- Broad focused verification before the final tamper guard: 131 Python tests plus four subtests passed across Roaring Fork preflight, editorial, source dossiers, Manifest V2, cultural review, and official routes.
- After the single evidence-backed correction, 26 directly affected Python tests passed. The independent re-audit passed 29 focused tests and reproduced that parked-to-autoplay tampering is rejected.
- Originals Studio JavaScript tests, Python compilation, deterministic dossier/preflight checks, and `git diff --check` passed.
- No remaining P0/P1 was found. Only the seven intentional S3G files were committed.
- Evidence hashes:
  - Preflight artifact: `4ea71987b8a52dfd9acf2b97b3ec8eb00c6e565d4697560df89c63478c8b1d42`.
  - Preflight builder: `cc70d55f7307de7bf519168abea0f8418b87032d185041111ae2edca47fe7b3c`.
  - Preflight tests: `e5d2644b1b739e6e49581a537dd31ee5366fd0660413fe4c63c9891c87e63d57`.
  - Editorial/Studio loader: `596c8dcdb337423253e2fd2e2c77ff259b23d190a2ee3088ef20d1220ed1e57c`.
  - Studio HTML: `03f81ffb85e8a622c4ea716ec948d3e5b5c62e76c6f8b7ab3781ec8a85c211f9`.
  - Studio JavaScript test: `c2d1fc868c6e976d544cce85bd1302becec71cad4ef8aab2490403d880f64adc`.
  - Editorial tests: `3d2adb2e5b1e4229367197e54619d41f47273c8f25dae8d3aad0aa0451ff9520`.
- No Cartesia credits were spent. No narration, media, backend deployment, OTA, native build, or public-stage change occurred.

### Remaining intentional blockers and next exact action

- Current strict Manifest V2 consumers cannot safely represent optional/deeper stories: existing `cue_refs` become autoplay stops. Do not add these fields to the current V2 contract and call it backward-compatible.
- S3H must add a capability/min-runtime-gated consumer contract for autoplay versus selectable content, a capacity scheduler that preserves hard-cue priority, and player/library UI for parked and after-route stories. The new contract must keep older 1.0.11 clients from parsing or autoplaying the Smokies pack.
- Bind the S3H runtime/source hashes into the checked preflight and run the existing virtual-drive publication validator using immutable rendered durations.
- Only after S3H is green should the three representative Cartesia auditions be generated under the existing 225,000-credit and $15-before-tax caps.
- Public release remains separately blocked pending immutable EBCI CIRB scope determination or approval for the exact fact-only cultural scope.

### Do not repeat after S3G

- Noah Ogle web/location research, route projection, the 13-entry mode decision, or the 15/36/65/75 authoring-estimate analysis while their source and geometry hashes remain unchanged.
- S0-S3F provenance, entitlement, cultural-policy, source dossiers, chapter writing, directional adaptation, or FIFO migration.
- Broad app crawls, Map/Explore/Layers/Memory/NPS/Android Auto/Offline work, paid narration, deployment, OTA, native builds, or public release.

## Task-owned background processes at S3G completion

- None. No Metro, Gradle, Maestro, pytest, Cartesia renderer, EAS, Railway, or cleanup task remains running.

## S3H capability-gated long-form playback baseline

- Started: 2026-08-08.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `8f93a549ff244d317039bc533b9db39b75112c0d`.
- Worktree was clean at start.
- Protected main-worktree state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main worktree.
- Scope is limited to a capability/min-runtime-gated consumer contract for guaranteed autoplay cues, capacity-aware longer stories, explicit parked stories, and after-route stories; durable scheduling; player/library presentation; and deterministic tests.
- Existing Moab V1 behavior, published manifests, other app features, route geometry, scripts, cultural scope, preflight limits, and protected files remain unchanged.
- This packet may add a new internal manifest schema or capability only when older 1.0.11 consumers are filtered before manifest parsing. It must not silently reinterpret the current strict V2 contract.
- No paid narration, media ingestion, deployment, OTA, native build, or public-stage change is included in the baseline.
- Task-owned background processes at start: none.

### Next exact action after this baseline

1. Audit backend/mobile manifest parsing, catalog filtering, runtime scheduling, player state, and validation boundaries.
2. Select the smallest fail-closed schema and minimum-runtime/capability gate that prevents old clients from seeing or autoplaying the Smokies pack.
3. Implement hard-cue priority, immutable-duration capacity admission, explicit parked playback, after-route availability, durable restart, and source/hash binding.
4. Run focused backend/mobile contract, scheduling, parser, catalog, privacy/copy, and deterministic preflight checks once.
5. Stop before paid Cartesia auditions unless the new runtime is complete, source-bound, and independently audited.

### Do not repeat during S3H

- Noah Ogle research, S3G delivery classification/timing analysis, S0-S3F provenance/cultural/editorial work, or FIFO migration.
- Broad Map, Explore, Layers, Memory, NPS, Android Auto, Offline, Originals lifecycle, or store work.
- Paid narration, media ingestion, deployment, OTA, native builds, or public release.

## S3H capability-gated long-form playback completion

- Completed: 2026-08-08.
- Branch: `feat/smokies-original-s2`.
- Worktree: `/home/sean/.openclaw/worktrees/trailhead-smokies-s2`.
- Original S3H baseline: `8f93a549ff244d317039bc533b9db39b75112c0d`.
- S3H baseline checkpoint: `fb268d82bdece96150361acd8fba87a3f5f8faef`.
- Accepted implementation commit: `28c3f5aec9eeead2d9c74e5a254dec389bbd96c0`.
- Lineage: `02788a90` -> `7c2d31b7` -> `8ee4d8be` -> `8f93a549` -> `fb268d82` -> `28c3f5ae`.

### Protected state

- Main-checkout Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- Main-checkout App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- `.cursor/` remains untracked and protected.
- None of the protected files were staged or modified in the S3H worktree.

### Completed contract and behavior

- Added capability-gated `OriginalManifestV3` without changing published Moab V1 or strict V2 semantics.
- Contract: `originals_long_form_delivery_v1`.
- Required capabilities: `originals_capacity_scheduler_v1`, `originals_manifest_v3`, and `originals_selectable_v1`.
- Clients missing those capabilities cannot discover or parse V3. Direct V3 access fails closed before entitlement mutation, credit use, download, or playback.
- Hard autoplay cues remain in the V1-shaped runtime manifest. Capacity, parked, and completion stories stay in the selectable sidecar and never enter the hard FIFO or hard-route progress.
- Hard cues preempt optional stories. Capacity admission requires immutable audio duration, fresh adequate GPS, two-fix dwell, exact scene bounds, and the unchanged 30-second reserve.
- Parked stories require explicit user confirmation. No speed-derived parked state or parking promise was added.
- Optional playback, Ogle's ordered two-part parked experience, replay, exact Now Playing identity, durable restore, completion fallback, and truthful player/detail actions are implemented and covered.
- End Tour disables the independent headless runtime before asynchronous audio work and cannot restart through delayed foreground or headless work.
- Catalog, detail, owned, restore, acquisition, readiness, asset, and admin-preview paths enforce the capability gate before V3 parsing.
- V3 publication validation requires exact route evidence, narration and audio hashes, real probed durations, generator provenance, commercial-license evidence, artwork, citations, current dependency hashes, and exact per-selection trusted evidence.
- Only `great_smoky_mountains_ridges_rivers_living_memory / roaring_fork / one_way` is registered. Every other chapter or variant fails closed until it receives its own checked delivery evidence.

### Verification and immutable evidence

- Roaring Fork preflight SHA-256: `4ea71987b8a52dfd9acf2b97b3ec8eb00c6e565d4697560df89c63478c8b1d42`.
- Cross-language delivery fixture SHA-256: `58016df4ffbd67fc9ff4ef2b9c2ad90dc61a79b981f59b79d91bf1814ecbac41`.
- Delivery-semantics SHA-256: `dca96c14e161c9fe35c2398f27be8d64fd8e35b02716b338dd5c3fbfde35da59`.
- Delivery-readiness artifact SHA-256: `7801841f488b387611254c24830716ceb72166986f73992fe6395137c6526a53`.
- Readiness status: `ready_for_real_audio_validation`; `authoring_estimates_accepted=false`; `real_audio_required=true`.
- Gates remain 240 seconds route-end tail, 180 seconds trigger-to-play latency, a 30-second capacity reserve, and 15/36/65/75 mph fixtures.
- Root verification: 198 focused backend tests plus 10 subtests passed. Existing FastAPI deprecation warnings were the only warnings.
- Mobile verification: Manifest V3, long-form scheduler, headless controller, End Tour race, and Owned Originals UI tests passed; whole-mobile TypeScript passed.
- Python compilation, deterministic readiness `--check`, both affected Originals Studio JavaScript tests, and `git diff --check` passed.
- Independent final read-only audit: safe to commit, with no remaining P0/P1.
- No build IDs or OTA update IDs exist for this packet.
- No native change, deployment, OTA, public-stage change, media ingestion, narration generation, or Cartesia credit spend occurred.

### Remaining intentional blockers

- Smokies V3 production audio has not been generated, so trusted real-audio publication reports do not exist yet.
- Mountain Crossing, Cades Cove, and Foothills Parkway lack registered long-form delivery evidence.
- Public release remains blocked pending an immutable EBCI CIRB scope determination or approval for the exact factual scope.
- Before any OTA, this work must be merged or cherry-picked onto the current 1.0.11 release line and pass native fingerprint and runtime-compatibility checks. This isolated worktree's release configuration is stale and must not publish directly.
- No public catalog or runtime activation occurred.

### Next exact action after S3H

1. Confirm the Cartesia account's training opt-out, current balance, overage rate, commercial terms, and the independent 225,000-credit / $15-before-tax renderer caps.
2. Lock three reviewed audition scripts and their permitted pronunciations.
3. Generate only three representative auditions: scenic/natural history, human history, and a permitted pronunciation-heavy sample.
4. Produce one archival WAV per audition and local 64/96/128 kbps encodes from the same master.
5. Run real-duration validation and Android/iPhone listening review before any batch narration.
6. Keep culturally gated pronunciation or interpretation out of TTS until immutable review evidence exists.

### Do not repeat after S3H

- S0-S3G provenance, entitlement, route construction, source dossiers, cultural-policy research, completed scripts, Noah Ogle location work, or the 13-entry Roaring Fork delivery classification.
- The 15/36/65/75 authoring-estimate analysis while its checked sources and geometry remain unchanged.
- Broad Map, Explore, Layers, Memory, NPS, Android Auto, Offline, Originals lifecycle, or store work.
- Moab provenance export or temporary Railway-key setup without evidence that immutable publication changed.
- Paid batch narration, deployment, OTA, native builds, or public release before the explicit remaining gates.

## Task-owned background processes at S3H completion

- None. No Metro, Gradle, Maestro, pytest, Cartesia renderer, EAS, Railway, or cleanup task remains running.

## S4 Cartesia audition baseline

- Started: 2026-08-08.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `1f93c816fcb2f7088000825452b15350bfeb56cf`.
- Worktree was clean at start.
- Protected main-checkout state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected in the main checkout.
- The user confirmed Cartesia Pro is active. Current official pricing lists 100,000 monthly Pro credits and commercial-use permission.
- The production Railway service has a configured server-only Cartesia API key, API version `2026-03-01`, and public voice `f786b574-daa5-4673-aa0c-cbe3e8534c02` (`Katie - Friendly Fixer`). The current service model is the moving `sonic-3.5` alias; auditions must instead pin `sonic-3.5-2026-05-04`.
- The standard API key can verify the voice but cannot read billing usage; Cartesia's documented usage endpoint requires an admin key. The signed-in Playground is the authoritative balance surface.
- Cartesia moved training controls from its old form to `https://play.cartesia.ai/privacy/data-controls`. The current account setting remains unverified because the browser-control connection is unavailable in this session.
- No script or audio may be sent to Cartesia until the Playground data-control status and current balance are confirmed. This is a data-use gate, not a rendering failure.
- This packet may lock three culturally safe audition scripts and implement the capped, resumable archival renderer while the account gate is pending.
- No batch narration, backend deployment, OTA, native build, public-stage change, or consumer release is included.

### Next exact action after this baseline

1. Lock the source-reviewed scenic, human-history, and culturally safe technical-pronunciation audition scripts.
2. Add a dry-run-first renderer with transcript hashes, immutable model/voice/API version, a 225,000-credit ceiling, a $15-before-tax ceiling, resumable generation, 429 backoff, and real WAV evidence.
3. Add local 64/96/128 kbps encodes from each WAV master and deterministic duration/hash manifests.
4. Confirm the Playground data-control status and current balance before the first paid API call.
5. Generate only the three auditions, run real-duration validation, and stop for Android/iPhone listening review.

### Do not repeat during S4

- S0-S3H provenance, cultural-policy, route, editorial, Ogle, long-form runtime, or trusted-validator work.
- Moab provider provenance, broad Cartesia model research, or competitor-tour research.
- Broad app crawls, deployment, OTA, native builds, public-stage changes, or batch narration.

## S4A Cartesia audition lock and renderer complete

- Completed: 2026-08-08.
- Baseline checkpoint commit: `0b7f7ca78411`.
- Implementation commit: `8cd6036bfdf6`.
- No Cartesia request, credit spend, Studio upload, backend deployment, OTA, native build, or public-stage change occurred.
- The exact internal audition set is locked in this order:
  1. `rf_story_02` — scenic and natural history.
  2. `rf_story_03` — human history and the stopped Noah Ogle experience.
  3. `mc_story_02` — 681-word source-backed geology and permitted technical-pronunciation stress test.
- All three entries remain `draft_review_required`, are source-verified public-record factual material, have `cultural_gate=not_required`, and contain no Cherokee pronunciation or custom phonetic override.
- Generation profile is pinned to Cartesia Katie voice `f786b574-daa5-4673-aa0c-cbe3e8534c02`, model `sonic-3.5-2026-05-04`, API `2026-03-01`, English, speed `0.98`, and 44.1 kHz mono PCM 16-bit WAV masters.
- The immutable lock binds 9,986 normalized characters, 10,007 exact payload characters, and an 11,008-credit conservative reservation including the ten-percent cushion. The packet ceiling remains 12,000 credits.
- The new renderer is network-free by default and requires explicit `--apply`, current redacted account evidence, the immutable lock, the server-only API key, and the pinned local encoder before a provider request is possible.
- Account evidence fails closed unless Pro commercial use, processed training opt-out, current balance, and explicit overage state are all present. Enabled overage also requires its verified rate; disabled overage requires enough evidenced balance.
- Every request reserves conservative cost atomically before network activity. A definitive uncharged 4xx/429/5xx releases the reservation; ambiguous timeout, process termination, invalid 200 audio, and successful audio keep it reserved. Resume and rerender cannot reset the cumulative 12,000-credit or $15-before-tax caps.
- WAV validation requires a complete RIFF container, mono PCM 16-bit at 44.1 kHz, and a broad 75–240 spoken-words-per-minute duration range. Local `imageio-ffmpeg==0.6.0` encodes 64, 96, and 128 kbps derivatives from the same verified master and records package, binary, duration, byte, and SHA-256 evidence without local executable paths or secrets.
- Focused verification: 58 tests passed; deterministic lock `--check`, Python compilation, real pinned-encoder probe/derivative smoke test, and `git diff --check` passed.
- Independent source/lock and renderer audits found no remaining P0/P1/P2.

### S4A evidence hashes

- Audition lock: `5ace6157a7a2698e912ddef8711509994028422178378c82e508ae535e56057a`.
- Lock builder: `9cc4d1edf7aa7a1e97041deec7d46a2b16ea8c403b80f6655c2dfac2d2b6fc17`.
- Renderer: `dd7542048b0ed107caec7265b08fc0c204e22f08fc35e405947ea788cacd0a1c`.
- Lock tests: `5e8d56e2b6aece71579bf4a533b8aa55d6a71cfd743130914fcb3b077bfd7c84`.
- Renderer tests: `45ac56c6b88d46c2212e14bc9fe447bd852ac23e797ccd84fd9311bc649aaa13`.
- Expanded Mountain Crossing editorial packet: `4a7e0acf04075da914ef486b86210167ff4220b8ea901083bd4df75d8fe21c58`.

### Exact next action after S4A

1. Confirm in the signed-in Cartesia Playground that training opt-out is processed/enabled.
2. Record the current remaining credit balance and whether overage is disabled or enabled; if enabled, record the displayed rate.
3. Create the redacted current account-evidence snapshot under ignored output storage.
4. Run one `--apply` invocation for only the three locked auditions through the Railway-held server key.
5. Verify masters, duration plausibility, encoder derivatives, hashes, and ledger totals, then stop for Android/iPhone blind listening review.

### Do not repeat after S4A

- Script selection, geology expansion, source/cultural audit, Cartesia model/voice research, renderer architecture, cap edge-case audit, or local encoder selection while their checked hashes remain unchanged.
- Do not call the existing Originals Studio Cartesia endpoint for these auditions; it lacks this lock, cap, ledger, and archival-master contract.
- Do not generate any fourth sample, batch narration, culturally gated pronunciation, production asset, deployment, OTA, or public release during the audition review packet.

## S4B Cartesia auditions generated and verified

- Completed: 2026-08-08.
- Account gate verified in the signed-in Cartesia Playground before generation:
  - Pro remains active with commercial-use permission.
  - Model-training contribution is disabled and the setting was saved.
  - The user enabled overages, but the available credit balance covered this packet; no paid overage was required.
- The first `rf_story_02` request returned HTTP 200 and consumed 2,844 account credits, but its streamed WAV used an unknown-length RIFF header marker. The renderer failed closed, retained the conservative 3,135-credit ledger reservation, and made no automatic retry.
- Cartesia documents `/tts/bytes` as a streamed response. The renderer now canonicalizes only the explicit `0xFFFFFFFF` RIFF/data length sentinel after the complete body is buffered, then performs the unchanged strict PCM profile, frame completeness, and 75-240 WPM duration checks. Arbitrary mismatches remain rejected.
- The user explicitly approved completing the packet after the failed provider response. A fixed-code recovery gate permits only the exact recorded `rf_story_02` incident, transcript hash, character counts, and one HTTP-200 invalid-audio attempt. It raises the cumulative recovery ceiling to 15,000 credits for this incident only; the 225,000-credit and $15-before-tax lifetime gates remain unchanged.
- One recovery invocation completed the exact three locked auditions. Final account balance was 106,731 credits, matching 12,830 normalized characters consumed from the pre-generation 119,561 balance. The conservative ledger total is 14,143 credits because it retains the ten-percent per-request ceilings and the first failed response.
- All three provider responses required only the documented streamed-header finalization and then passed strict WAV validation:
  - `rf_story_02`: 152.00 seconds; WAV SHA-256 `68f9e9e3539a1e547c41fc6adf02524d42780f69a006a982af6729b4b881f5f6`.
  - `rf_story_03`: 144.64 seconds; WAV SHA-256 `caf157e485d6354d2070f0b561682f4ced2d75410abc51d6eead660398dbf30a`.
  - `mc_story_02`: 242.56 seconds; WAV SHA-256 `6f809b231b1bbcc548c4d33f47f2a290fb3ec3acc0633aa7ac047fb67555b8a6`.
- Each master has locally encoded 64, 96, and 128 kbps derivatives plus redacted provenance. No audio, account screenshot, ledger, API key, invoice data, or billing identity is committed.
- Automated audio inspection found consistent mean volume near -21.8 dB, peaks between -3.7 and -3.1 dB, and no silence interval longer than two seconds at the -50 dB threshold.
- A network-free resume check reports zero projected credits and verifies all master hashes, frame counts, transcripts, and derivatives.
- Renderer SHA-256 after the streamed-WAV/recovery fix: `061a48c99efa22044a3b7a2db366e6cb337d5d36ecdaf190ee4614a9fa87731e`.
- Renderer-test SHA-256: `95411dfedabfd77ccb938b08bf11f825afb6273954abb252c8fad2142edbc7e7`.
- Final focused source, editorial, lock, and renderer verification: 61 tests passed; the lock rebuilt deterministically, Python compilation passed, and `git diff --check` passed.
- No Studio upload, backend deployment, OTA, native build, catalog activation, batch narration, or public release occurred.

### Exact next action after S4B

1. Listen to the three 96 kbps auditions on Android and iPhone, comparing pacing, warmth, pronunciation, fatigue, and whether the 2.5-4 minute story length feels right.
2. Use the existing 64/96/128 encodes to choose one delivery bitrate without regenerating narration.
3. Record accept/revise decisions by exact transcript and audio hash.
4. If revisions are required, change only the affected locked script and rerender only that asset under a new reviewed lock and cost calculation.
5. Do not begin batch narration until these auditions are accepted and the remaining chapter-specific delivery/cultural publication gates are satisfied.

### Do not repeat after S4B

- Do not regenerate these auditions merely to compare compression, volume, or devices; all three bitrates derive from the same verified masters.
- Do not rerun the provider recovery or loosen the normal 12,000-credit packet cap.
- Do not upload to Studio, publish, deploy, or generate culturally gated material during listening review.

## S4C ElevenLabs James comparison auditions generated and verified

- Completed: 2026-08-08.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `628c9ae4fc2c3dd680e233ba7ae8aa1d5a911b13`.
- Accepted implementation commit: `44104a896f34da4979f756cb8ab81849d68b99be`.
- Protected main-checkout state remained unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remained untracked and protected.
- James `EkK5I93UQWFDigLMpZcX` is a new user-selected comparison narrator. It is not recorded as Moab voice continuity; immutable published Moab provenance remains voice `JBFqnCBsd6RMkjVDRZzb` on `eleven_multilingual_v2`.
- The exact Cartesia comparison transcripts were locked in the same order and retained their source, authorization, and cultural boundaries:
  1. `rf_story_02` — scenic and natural history.
  2. `rf_story_03` — human history and the stopped Noah Ogle experience.
  3. `mc_story_02` — the 681-word source-backed geology sample.
- The generation profile is pinned to `eleven_multilingual_v2`, native `mp3_44100_128`, English, and James's authenticated saved settings: stability `0.5`, similarity boost `0.5`, style `0.1`, speaker boost enabled, and speed `1.0`.
- Creator plan and commercial use were verified. Model-training contribution was disabled and saved before generation.
- A dedicated one-day key was limited to 12,000 credits and only Text to Speech, Voices Read, and User access. Auto-disable-if-leaked remained enabled. Both temporary audition keys were deleted after output verification; no key was written to disk or committed.
- The first controlled attempt stopped before TTS because the lock's initial settings did not match James's authenticated saved settings. It created no ledger or audio and consumed no narration credits. The exact settings were then source-locked, independently audited, and the same single packet was rerun.
- One successful invocation rendered all three locked scripts with no retry:
  - `rf_story_02`: 215.118367 seconds; 3,441,937 bytes; 1,568 provider-reported credits; MP3 SHA-256 `a0f70a05d89f2318b3f99b8580bfdb93d5e626cc696dca9614c5bf3bc078006e`.
  - `rf_story_03`: 199.053061 seconds; 3,184,893 bytes; 1,506 provider-reported credits; MP3 SHA-256 `ca7ea9e8cd997ee1cf90cc0b4112f17cb8815754b6a2ccfdc0e1112e3696b1a7`.
  - `mc_story_02`: 324.623673 seconds; 5,194,022 bytes; 2,430 provider-reported credits; MP3 SHA-256 `00fa4d04a1b7469f2be65ffd6438b7275cabdc3825e2277b7a8924b7f314af45`.
- Provider-reported total use was 5,504 of 131,000 included Creator credits. No overage was required.
- Every output independently verified as mono 44.1 kHz / 128 kbps MP3. Mean volume was between -23.9 and -23.6 dB, peaks were between -3.8 and -3.5 dB, and no silence interval longer than two seconds appeared at the -50 dB threshold.
- The immutable James lock SHA-256 is `3e4158c0af16527756c299137ec7fb9c02b33362931300c47d5c0096d57b5f25`; the completed ledger SHA-256 is `15764fe7edc13df78614faecfaae5c3006fb0369735da4e683d378d216ba4465`.
- Friendly listening copies are in `C:\Users\User\Downloads\Trailhead Smokies Auditions - James`. Cartesia comparison copies remain in `C:\Users\User\Downloads\Trailhead Smokies Auditions`.
- Audio, ledgers, account evidence, API keys, account identity, and billing details remain ignored output and are not committed.
- Verification: 45 focused ElevenLabs/Cartesia tests passed; deterministic lock `--check`, ruff, Python compilation, strict 44.1 kHz/128 kbps response validation, independent audio inspection, and `git diff --check` passed. Independent final audit found no remaining P0/P1.
- No Studio upload, backend deployment, OTA, native build, catalog activation, batch narration, or public release occurred.
- Task-owned background processes after completion: none.

### Exact next action after S4C

1. Listen to the three James files beside the same three Cartesia files on Android and iPhone.
2. Compare warmth, pacing, pronunciation, listener fatigue, and whether roughly 3:19-5:25 feels appropriate for full stories.
3. Record one provider/voice decision and accept or revise each exact audio hash.
4. If a script or voice setting changes, create a new immutable lock and rerender only the affected asset under a new reviewed cost calculation.
5. Do not begin batch narration until the narrator is accepted and the remaining chapter-specific delivery and cultural publication gates are satisfied.

### Do not repeat after S4C

- Do not regenerate James or Cartesia merely to compare files already available locally.
- Do not recreate either deleted audition key unless an accepted, source-locked revision requires a new provider call.
- Do not alter immutable Moab narration provenance to claim James was its published voice.
- Do not upload to Studio, batch-generate, deploy, publish, or generate culturally gated material during narrator review.

## S4D Roaring Fork production narration baseline

- Started: 2026-08-08.
- Branch: `feat/smokies-original-s2`.
- Baseline HEAD: `602dfee3799174d2042b79370141fd42c5dbf1d5`.
- Worktree was clean at start.
- Protected main-checkout state remains unchanged:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
  - `.cursor/` remains untracked and protected.
- The user accepted James `EkK5I93UQWFDigLMpZcX` after listening to the exact S4C auditions. The accepted provider/model/settings remain `eleven_multilingual_v2`, native mono `mp3_44100_128`, stability `0.5`, similarity boost `0.5`, style `0.1`, speaker boost enabled, and speed `1.0`.
- The accepted `rf_story_02` and `rf_story_03` audio hashes are immutable inputs to this packet and must be reused without regeneration.
- Because the accepted Creator output is provider-native MP3, S4D treats that exact provider response as the immutable source master and delivery source. It does not claim a lossless WAV master and does not transcode MP3 to a misleading archival WAV.
- Scope is only Roaring Fork's seven stories and six cues. The five unrendered stories and six unrendered cues may be generated only after exact transcript, source, cultural, voice, cost, and delivery locks pass.
- Roaring Fork contains no culturally scoped entry. `cc_story_04`, `mc_story_15`, and `mc_cue_07` remain outside this packet and outside narration generation pending written EBCI CIRB scope determination.
- This packet may build a resumable, capped production lock/renderer, bind the two accepted assets, generate only the eleven missing assets, and run real-duration 15/36/65/75 mph validation.
- No other chapter, Studio upload, backend deployment, OTA, native build, catalog activation, public release, or culturally gated narration is included.

### Exact next action for S4D

1. Perform one bounded final source/copy review of the thirteen Roaring Fork scripts and lock their exact transcript hashes.
2. Bind `rf_story_02` and `rf_story_03` to their accepted MP3 hashes, durations, and provider evidence.
3. Calculate an independent conservative character/key/cost ceiling for only the eleven missing assets.
4. Implement and independently audit a dry-run-first resumable renderer that cannot regenerate the accepted assets.
5. Generate and verify the eleven missing assets once, then run the trusted real-duration delivery validator across all thirteen entries.
6. Stop for Android/iPhone chapter listening review before any other chapter or public action.

### Do not repeat during S4D

- S0-S4C provenance, source, cultural-policy, route, delivery-classification, narrator comparison, or accepted-audition generation.
- Do not regenerate `rf_story_02` or `rf_story_03`, create a fake WAV, weaken the 12,000-key style of provider quota control, or reuse a deleted API key.
- Do not narrate the three culturally relevant public-record entries or begin another chapter.

## S4D Roaring Fork narration generated and internally characterized

- Completed: 2026-08-09.
- Branch: `feat/smokies-original-s2`.
- Pre-change HEAD: `df667cd1fde557a3bd1f28775cf0d1aa6e70b611`.
- Accepted implementation commit: `93200772f7f423c570dcaa040b615ec092fee330`.
- Protected files match that HEAD and were not edited or staged:
  - `dashboard/explore_serving_index_v2.json`: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - `docs/app-store-copy.md`: `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
  - `.cursor/` was not touched.
- Added additive `OriginalNarrationProfileV2` support for the accepted ElevenLabs Creator contract. It records provider-native mono `mp3_44100_128` as the immutable lossy source and byte-identical delivery asset; it does not claim a WAV or lossless master. V1, Moab, Cartesia, signed-access, and public-profile redaction behavior remain compatible.
- Six bounded, source-backed Roaring Fork copy corrections were completed before narration. The accepted `rf_story_02` and `rf_story_03` transcripts and audio hashes did not change. Roaring Fork still contains no culturally scoped entry; `cc_story_04`, `mc_story_15`, and `mc_cue_07` remain outside narration and public release pending written EBCI scope determination.
- The immutable production lock covers all thirteen Roaring Fork entries in delivery order, with five hard-auto cues, four capacity-deeper stories, three stopped-deeper entries, and one completion-deeper story. The Noah Ogle stopped experience remains ordered `rf_cue_02` then `rf_story_03` and never enters the moving-drive FIFO.
- `rf_story_02` and `rf_story_03` were copied from their exact accepted S4C MP3 hashes and verified; the renderer could not send them to the provider. The other five stories and six cues were generated once with James `EkK5I93UQWFDigLMpZcX`, `eleven_multilingual_v2`, the accepted saved settings, and native mono 44.1 kHz / 128 kbps MP3 output.
- The dedicated key was limited to one day, 20,000 credits, Text to Speech, Voices Read, and subscription read; auto-disable-if-leaked remained enabled. After output and account reconciliation, the key was permanently deleted, its API-key row disappeared, and browser clipboard plus the in-memory secret were cleared.
- Provider use reconciled exactly: account usage moved from 5,504 to 14,510 of 131,000 included Creator credits, matching the renderer ledger's 9,006-credit total. No retry, duplicate generation, or paid overage occurred.
- The ignored local chapter contains thirteen verified masters totaling 26,184,875 bytes and 1,636.519183 seconds (27 minutes 16.5 seconds). Every master was re-probed against the immutable ledger for SHA-256, bytes, duration, mono channel count, 44.1 kHz sample rate, 128 kbps frame rate, transcript identity, and 75-240 WPM plausibility.
- A separate internal real-audio characterization invokes the app's existing TypeScript `computeOriginalLongFormDeliveryMetrics` function through a network-free bridge over the full 1,175-point official route geometry. It records exact input hash `08719837a4a5aaf721b1e3735eaec9599b69394218b74ddb1bf56c090d7d9a1c` and result hash `6038b587c8a57fe0cf0aa2780db04e6589b98b4516f4225841bb05a6f0ed0bf0`.
- Exact real-audio timing results:
  - 15 mph: zero route-end tail, 3.1-second maximum latency; admits `rf_story_02` and `rf_story_05`.
  - 36 mph: 8.086852-second route-end tail and zero maximum latency; all capacity stories remain selectable rather than auto-playing.
  - 65 mph: 18.543283-second route-end tail and 2.782518-second maximum latency; all capacity stories remain selectable.
  - 75 mph: 23.078712-second route-end tail and 6.047783-second maximum latency; all capacity stories remain selectable.
  - All fixtures remain below the unchanged 240-second route-tail and 180-second trigger-latency limits. This is an internal characterization only, not a trusted publication report.
- Public release remains fail-closed. `public_release=false`, `trusted_publication_validation=false`, and `validated_delivery_contracts=[]` remain explicit because accepted artwork, a complete publication-grade Manifest V3, verified server uploads, final citations, generator/license attestations, and chapter-specific publication evidence are not yet assembled.
- Independent final audit found no P0/P1 and no new P2. The known fail-closed operational P2 remains: a hard renderer process death can leave the exclusive apply sentinel requiring documented manual removal. It prevents duplicate generation or billing and does not weaken the packet.
- Task-owned background processes after completion: none.

### S4D evidence hashes

- Production narration lock: `4f8b2d9df467de6af3d5622dac10caae7c165d924e36449de30d507812ba7e3b`.
- Renderer: `1c508a5286e9d23955a5552ebcfc11830ab84ae41d65d7f670f097f3f9fe9ca5`.
- Roaring Fork editorial packet: `c3d1622d7f5109fb4632cb74af340f97a3477cd061c326f5e55055e6b074d0e2`.
- S3G trigger preflight: `b7b8412e07cdef5706d814550491f8c28bfadb05d3fbef38369ec7006c3b67f3`.
- S3H delivery readiness: `4a0fc760fd07790785b820af06bac4e5a10e8337ad3f6257a10a3c50464c9b67`.
- Internal real-audio characterization: `f34b7aa8df6c5270f7b93f98a5bb720cf9c95df7fc1751eaeb1c6b6899529d1b`.
- TypeScript timing bridge: `a6fd2bcd4f1551f82b94010f757cb56d69a56c867f4b5ae49d7add78e0f9a5a0`.
- Characterization builder: `0cd16a5759de3b89b1c6e899a3f98877e0bbd7e01ce8862008d538e3e15285af`.
- Characterization tests: `79fbb6ffacc3c3200ea35317d68626a04f5ac572a38ef6c4ebb1b4d92ddc0ee1`.
- Ignored render ledger: `15537c5af0d351d4eb4102139bd6b1a0452075963e305242d1394a59e3db5804`.
- Ignored redacted account source/evidence: `90d963e93f4089acb228e717773ce2504f51c59fe3f4bae11d1dda586e8b31dd` / `66abe3286df521222a936a7b260198352bc22a3c87d1485d172c1e03ca1715f4`.

### S4D verification

- Production lock, historical James lock, historical Cartesia lock, S3G preflight, and internal real-audio characterization deterministic checks passed.
- Strong characterization check re-probed all thirteen ignored masters and executed the actual TypeScript timing path.
- Focused S4D/preflight suite: 48 passed; exact characterization suite: 9 passed; Profile V2 and compatibility audit suite: 139 tests plus 7 subtests passed.
- Mobile `OriginalManifestV2` contract/compiler test and full TypeScript typecheck passed.
- Python compilation, secret scan, ignored-output check, protected-file comparison, and whitespace/diff checks passed.

### Exact next action after S4D

1. Listen through the ordered thirteen-file Roaring Fork chapter on Android and iPhone, checking pacing, transitions, Ogle group continuity, cue clarity, fatigue, interruptions, and resume behavior.
2. Record accept/revise decisions by exact transcript and audio SHA-256. Rerender only a changed asset under a new reviewed lock; do not regenerate accepted files for compression or volume comparison.
3. After audio acceptance, select and ingest licensed story artwork, assemble the complete private Manifest V3 and verified upload/license evidence, then run the trusted server publication validator.
4. Keep public release blocked until artwork, citations, operational readiness, full V3 evidence, device acceptance, and all cultural gates are complete.

### Do not repeat after S4D

- Do not regenerate the thirteen Roaring Fork files, recreate the deleted key, rerun narrator comparison, or reinterpret the internal characterization as publication approval while hashes remain unchanged.
- Do not narrate another chapter, upload to Studio, deploy, publish, build native binaries, or send culturally scoped material before the exact next packet is approved.

## S4E Android standalone chapter listening preparation

- Completed: 2026-08-09.
- Branch: `feat/smokies-original-s2`.
- Source HEAD: `d1a59636c654c3c419a8cb1fad9c5a80a428b1bc`.
- This was a device-evidence packet only. It changed no production code, manifest, backend data, OTA, native binary, provider state, narration master, or public-release state.
- Protected worktree files remained unchanged:
  - `dashboard/explore_serving_index_v2.json`: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - `docs/app-store-copy.md`: `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
  - `.cursor/` was not touched.
- The connected Android review device was a Samsung `SM-A326U1` on Android 13. It had approximately 29.3 GiB free on shared storage after transfer.
- Only the thirteen accepted Roaring Fork MP3 masters and one local playlist were copied to `Music/Trailhead Smokies/Roaring Fork - James`. No ledger, account evidence, provider key, source dossier, route geometry, or private manifest was transferred.
- The thirteen device files contain 26,184,875 bytes. A canonical `filename|bytes|sha256` manifest calculated independently from the ignored local masters and the device copy matched exactly on all thirteen rows: `c6c9000d144d211cf8055916439f745fcb98e686903ebd7ed8bddf861b738585`.
- Android MediaStore indexed all thirteen files and the playlist. Playlist membership was verified in exact `play_order` 1 through 13:
  1. `01-rf_cue_02.mp3`
  2. `02-rf_story_03.mp3`
  3. `03-rf_cue_01.mp3`
  4. `04-rf_story_01.mp3`
  5. `05-rf_cue_04.mp3`
  6. `06-rf_cue_03.mp3`
  7. `07-rf_story_02.mp3`
  8. `08-rf_story_04.mp3`
  9. `09-rf_story_05.mp3`
  10. `10-rf_cue_05.mp3`
  11. `11-rf_story_06.mp3`
  12. `12-rf_story_07.mp3`
  13. `13-rf_cue_06.mp3`
- Samsung My Files was set to `Name` / `Ascending`, and both the first and final visible list segments were checked. The device was left at the top of that ordered list for the user's listening review.
- Direct playback of a short cue and a long story succeeded through Android's installed YouTube Music audio-preview activity with the expected media type and active media audio focus.
- The installed one-file audio-preview activity abandoned playback after returning Home and did not expose a normal playlist queue or durable media session. This is recorded only as a limitation of the standalone review player. It is not a Trailhead runtime defect and does not satisfy background, lock-screen, interruption, queue, or resume acceptance for the future private Manifest V3 flow.
- Trailhead in-app device acceptance remains deliberately untested because the complete private Manifest V3, verified server uploads, licensed artwork, and publication-grade evidence are still absent. No claim was inferred from standalone playback.
- Task-owned background processes after completion: none.

### Exact next action after S4E

1. The user listens to the ordered Android files, beginning with the Noah Ogle pair `01` then `02`, and records accept/revise decisions for pacing, pronunciation, cue clarity, transitions, and fatigue.
2. Bind any revision request to the exact transcript and audio SHA-256. Do not regenerate an accepted file; create a new reviewed lock only for a changed asset.
3. If the Android listening verdict is acceptable, copy the identical thirteen hashes to iPhone for the shared subjective spot check.
4. Only after audio acceptance should the next implementation packet ingest licensed artwork, assemble the complete private Manifest V3 and verified uploads, and run actual Trailhead background, lock-screen, interruption, queue, and resume acceptance.

### Do not repeat after S4E

- Do not recopy, rehash, rescan, or reorder this Samsung packet while the thirteen master hashes and device folder remain unchanged.
- Do not treat YouTube Music audio-preview behavior as Trailhead runtime evidence.
- Do not upload, publish, deploy, create a new provider key, regenerate narration, or begin another chapter during listening review.

## S4F iPhone standalone chapter identity closeout

- Completed: 2026-08-09.
- Branch: `feat/smokies-original-s2`.
- Baseline/source HEAD: `11e935f18c219593c540495c0ead2e00cfbaa214`.
- This remains a device-evidence packet only. It changes no narration master, app code, manifest, backend data, OTA, native binary, provider state, catalog stage, or public-release state.
- Protected files remained unchanged:
  - `dashboard/explore_serving_index_v2.json`: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - `docs/app-store-copy.md`: `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
  - `.cursor/` was not touched.
- The user reported that the accepted ElevenLabs James chapter sounded good and passed the bounded standalone Android audio checks. That subjective Android result remains tied to the unchanged thirteen-file source manifest and is not Trailhead in-app runtime acceptance.
- The connected Apple review device was an iPhone 15 Pro Max on iOS 26.5.2, with 247.96 GB available in Apple Devices at the start of transfer.
- Transfer used Apple Devices 1.1540.23042.0, Files, and the existing Video Saver File Sharing container. No ledger, account evidence, API key, private manifest, route geometry, or source dossier was transferred.
- The final File Sharing container contained only the same thirteen accepted Roaring Fork MP3 masters in numbered order. Two temporary zero-byte picker placeholders were removed or replaced before Apple Devices displayed the final thirteen with nonzero sizes and current timestamps.
- The source set and iPhone-visible set contain thirteen files totaling 26,184,875 bytes and 1,636.519183 seconds. The pre-transfer canonical `filename|bytes|sha256` manifest remains `c6c9000d144d211cf8055916439f745fcb98e686903ebd7ed8bddf861b738585`.
- Strong round-trip verification exported all thirteen iPhone File Sharing copies back to Windows. Every returned filename, byte count, and per-file SHA-256 matched its source exactly; mismatch count was zero and returned bytes were exactly 26,184,875.
- The round-trip comparison's independently calculated lowercase `filename|bytes|sha256` aggregate was identical on both sides: `05d7cb54d0f6963fba1afb0bc3aa25e571fc4e99810a8d5937b1309505e46f6c`. This aggregate uses a different canonicalization from the pre-transfer device-manifest digest above and does not replace it.
- The user accepted the ElevenLabs narration quality after the existing listening checks and elected to proceed without a redundant iPhone listening pass. The round-trip proved the iPhone copies were byte-identical; it did not add subjective or playback evidence. No asset revision or rerender was requested.
- Video Saver decoding, seeking, pause/resume, pacing, clarity, and fatigue were not separately asserted on iPhone. This closeout proves copied-asset identity only. It does not certify Video Saver playback behavior or Trailhead Manifest V3 queueing, background playback, lock-screen controls, interruptions, resume behavior, or route triggering.
- Task-owned background processes after transfer and round-trip verification: none.

### Exact next action after S4F

1. Keep all thirteen narration assets immutable and begin the separate licensed-artwork plus private Manifest V3/verified-upload packet.
2. Test actual Trailhead runtime behavior only after the private V3, verified uploads, artwork, and publication-grade evidence exist.
3. Keep public release fail-closed until the complete source, cultural, operational, artwork, runtime, and device gates pass.

### Do not repeat after S4F

- Do not repeat standalone listening, copying, hashing, reordering, or regeneration while the thirteen hashes remain unchanged.
- Do not interpret this File Sharing identity check as an OTA, native-build, deployment, or Trailhead runtime acceptance.
- Do not upload to Studio, publish, begin another chapter, or narrate culturally gated material during this bounded listening closeout.

## S4G Roaring Fork artwork review candidate

- Completed to review gate: 2026-08-09.
- Branch: `feat/smokies-original-s2`.
- Baseline/source HEAD: `eb71913a552d58034c27ec88592f29f3ac14d459`.
- This packet performs source, rights, identity, and proposed mapping review only. It does not approve, download, ingest, upload, publish, deploy, or expose artwork.
- Protected files remain unchanged:
  - `dashboard/explore_serving_index_v2.json`: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - `docs/app-store-copy.md`: `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
  - `.cursor/` was not touched.
- Visual inspection and the authoritative HAER title proved that the former `media_rf_stream` candidate is a mountain vista at stop three, not a stream scene. Its rights remain valid, but it is now `rejected_identity_mismatch` and cannot be bound to `rf_story_02` or `rf_cue_03`.
- A deterministic, network-free review packet maps all thirteen checked Roaring Fork entries exactly once to seven proposed candidates:
  - narrow Roaring Fork road;
  - generic Roaring Fork stream;
  - generic Roaring Fork forest;
  - exact Noah “Bud” Ogle cabin;
  - generic documented Roaring Fork cabin;
  - exact Grotto Falls destination illustration;
  - exact Place of 1,000 Drips.
- The mapping preserves strict claim limits. The generic Commons photographs cannot be presented as named stops; the forest photograph cannot be labeled old growth; the Highsmith cabin cannot be assigned a structure name or called a mill; and Grotto Falls must be presented as a trail destination that is not visible from the road, with no parking or availability promise.
- Rights evidence is source-backed:
  - Four Sarah Stierch photographs are CC BY 4.0 and require creator credit, license link, and a later change note for any derivative.
  - The Carol M. Highsmith Roaring Fork cabin is under the Library of Congress `No known restrictions on publication` record `LC-DIG-highsm-68373`; final download targets the provider master TIFF, not the review JPEG.
  - Grotto Falls and Place of 1,000 Drips are exact NPS NPGallery records with `Public domain` / `Full` rights, null photographer credit, and the commercial U.S. Government-work notice retained.
- Only the previously downloaded Ogle original has project SHA-256 and byte evidence. The other six exact downloads, original hashes, EXIF-safe derivatives, derivative hashes, and verified uploads remain deliberately absent until visual approval.
- The review packet remains fail-closed: `user_visual_approval=false`, `ingestion_allowed=false`, `private_manifest_v3_artwork_binding_complete=false`, and `public_release=false`.
- Evidence hashes:
  - `docs/originals/smokies-media-rights-v1.md`: `53e515e3f3ce46cb9dd4c9d19be38d008ea5bb603e31a6be53bf5afdb7f0ab15`.
  - `originals/smokies/roaring_fork_artwork_review_v1.json`: `3030dfdf993b8b33cb116263ba9902dfe9e36c637f4ff7a37b11f878f0f082d4`.
  - `scripts/build_smokies_roaring_fork_artwork_review.py`: `a57b1160ae26aaba020440657e90a59bb6f55b547210e5e818c57423f18f7987`.
  - `tests/test_smokies_roaring_fork_artwork_review.py`: `5d42afb9ec72c7500da36e70f240639405148adf1508ff66e9018d11e517a6e0`.
- Verification: deterministic builder check, Python compilation, whitespace check, and 39 focused artwork/source/editorial tests passed.
- Independent review found no P0/P1 after the identity, NPS dimension/credit, Library of Congress master, premature crop-credit, and generic-caption corrections.
- Windows storage remains too full for the six final originals and derivatives, especially the 141,728,100-byte Library of Congress master TIFF. No download was attempted and no lower-quality substitute was silently accepted.

### Exact next action after S4G

1. Obtain explicit visual approval for the seven-candidate contact set.
2. Reclaim enough Windows/WSL storage for the exact originals and derivatives.
3. Download and hash only the approved originals; preserve immutable originals, normalize orientation and strip GPS/device EXIF only in separately hashed PNG derivatives, and carry exact attribution/change records.
4. Build a separate artwork approval overlay bound to the existing dossier hash. Do not edit `source_dossiers_v1.json`, because its hash is already bound into accepted narration evidence.
5. Add a narrow admin-only importer that binds the accepted thirteen MP3s to the checked real-audio characterization and exact ElevenLabs James generator/license provenance; do not regenerate through the narration endpoint.
6. Assemble a one-chapter internal OriginalManifestV3 draft, upload and verify the accepted audio plus approved artwork, then run authenticated admin device preview and trusted validation without calling Publish.

### Do not repeat after S4G

- Do not reconsider the rejected HAER vista as stream artwork or weaken its identity failure because its license is usable.
- Do not download, crop, transcode, ingest, upload, or mark any proposed artwork approved before the explicit visual decision.
- Do not edit the source dossier, regenerate accepted narration, call the narration endpoint, publish a version, expose public assets, or begin another chapter during this review gate.

## S4H Roaring Fork approved-original identity closeout

- Completed: 2026-08-10.
- Branch: `feat/smokies-original-s2`.
- Baseline/source HEAD: `32b372ac8be167363a96cf37560a45484bc9a92f`.
- The project owner explicitly approved all seven candidates from the S4G contact set in continuation task `019fe9fb-cafa-75d3-b663-1e5051731cd5`. The final decision was `approve all` and superseded the earlier candidate-2 revision placeholder.
- This stage downloaded and hashed exact approved originals only. It did not generate a derivative, alter app code, bind Manifest V3, upload, deploy, publish, regenerate narration, edit culturally gated material, or expose a public asset.
- Protected files remain unchanged:
  - `dashboard/explore_serving_index_v2.json`: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - `docs/app-store-copy.md`: `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
  - `.cursor/` was not touched.
- The immutable original set is stored outside the repository at `/home/sean/.openclaw/evidence/roaring-fork-artwork-v1/originals/` and mirrored at `C:\Users\User\Documents\Codex\evidence\trailhead\roaring-fork-artwork-v1\originals\`.
- Both evidence roots contain exactly seven files totaling 174,757,789 bytes. Every WSL and Windows copy matches the overlay's per-file SHA-256.
- Six deferred originals were downloaded after approval. The existing Ogle original was reused only after its 5,281,216-byte identity and `a828bf6c6d7f2650268f67b39669b1958f80c34dd845705f60423d8a0dfea551` SHA-256 were revalidated.
- The three new Commons downloads match their recorded provider byte counts and SHA-1 values. The NPS originals match their exact asset byte counts and dimensions. The Library of Congress candidate is the exact 141,728,100-byte `68373u.tif` provider master, not the review JPEG; it validates as an 8416x5611 TIFF.
- Source EXIF remains untouched in immutable originals. Five originals contain GPS EXIF, and the road and forest JPEGs carry orientation value 6. No original was normalized or sanitized in place.
- A separate deterministic approval overlay binds the unchanged S4G review packet and unchanged source dossier while keeping ingestion and release fail-closed:
  - `originals/smokies/roaring_fork_artwork_approval_v1.json`: `c67111d87bd0bc2aae2cf1b8d763030de2852a1620d61fb38413f54ce54b995f`.
  - `scripts/build_smokies_roaring_fork_artwork_approval.py`: `2937cccd6625518220ea3c3cb20fd2c0d3c7909997b9394a9c9771fcbff7be8f`.
  - `tests/test_smokies_roaring_fork_artwork_approval.py`: `bc0e1a69d53bbc4bfe4d4cbb54ac94991a4336bec4a0d52fdc546fc6fef67fe7`.
- The overlay records `user_visual_approval=true`, `original_downloads_complete=true`, and `original_hashes_complete=true`; it retains `ingestion_allowed=false`, `private_manifest_v3_artwork_binding_complete=false`, and `public_release=false`.
- Verification: both deterministic builders passed `--check`; the approval builder verified both evidence roots; Python compilation, whitespace validation, and eleven focused review/approval assertions passed. The system Python did not include the pytest runner, so the plain assertion functions were executed directly without fixtures.

### Exact next action after S4H

1. Preserve these seven original byte identities unchanged.
2. Create separately hashed PNG derivatives that normalize orientation and remove GPS/device EXIF while retaining the exact attribution and change notices.
3. Review the derivative contact set before any importer, upload, Manifest V3 binding, authenticated device preview, or trusted validation work.
4. Keep public release fail-closed until the complete source, cultural, operational, artwork, runtime, and device gates pass.

### Do not repeat after S4H

- Do not redownload or replace an original while its recorded byte count and SHA-256 remain unchanged.
- Do not edit `source_dossiers_v1.json`, the accepted narration masters, or the immutable S4G review packet.
- Do not upload, bind, deploy, publish, call the narration endpoint, or begin another chapter during the original-identity closeout.

## S4I Roaring Fork sanitized-derivative review gate

- Completed to the derivative visual-review gate: 2026-08-10.
- Branch: `feat/smokies-original-s2`.
- Baseline/source HEAD: `43659fd11d5852d727358f0448af38fc60af71ef`.
- This stage generated and verified identity-preserving derivatives only. It did not ingest, upload, bind Manifest V3, alter app code or backend data, deploy, publish, regenerate narration, edit culturally gated material, or expose a public asset.
- Protected files remain unchanged:
  - `dashboard/explore_serving_index_v2.json`: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - `docs/app-store-copy.md`: `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
  - `.cursor/` was not touched.
- The derivative set is stored outside the repository at `/home/sean/.openclaw/evidence/roaring-fork-artwork-v1/derivatives/` and mirrored at `C:\Users\User\Documents\Codex\evidence\trailhead\roaring-fork-artwork-v1\derivatives\`.
- Both evidence roots contain exactly seven PNG files totaling 213,587,790 bytes. The mirrored copies match by filename, byte count, SHA-256, decoded RGB pixel SHA-256, and dimensions:
  1. `01-rf_art_road.png`: 43,139,412 bytes; `5442a2ee936f0c3a3e54c81a4be0550c2599465494214f5567d2bd1daf481086`.
  2. `02-rf_art_stream.png`: 42,092,795 bytes; `ff2671b29b7a0d2818f4a75c12b092e2640adf0306c9a645f7ed61c765e3d8f5`.
  3. `03-rf_art_forest.png`: 22,742,999 bytes; `b2aeb6ec1d315a2f19bd7871343a5e7ef7b083e61107d6157b2b0a3926a4d266`.
  4. `04-rf_art_ogle.png`: 22,151,291 bytes; `a300ccc802b810b8af3fbd14a1a487413a2c569ae5afe836d07fa1f2da1201b4`.
  5. `05-rf_art_historic_cabin.png`: 73,289,752 bytes; `5ab0ead6c1a826743a883dcba01664aba93848de1e04a5b4a1d3a95b5252ac67`.
  6. `06-rf_art_grotto_falls.png`: 5,016,837 bytes; `bf186d2fd61196ca7ec6196af2668200a1de43f140f5c574642e256a0452682a`.
  7. `07-rf_art_thousand_drips.png`: 5,154,704 bytes; `479650107bf76599950bd05734221e69fcc74066d248b52fce21b5ca19f478b0`.
- Every derivative preserves the complete source frame with no crop or resize, applies recorded EXIF orientation, writes 8-bit RGB PNG, and contains only `IHDR`, `IDAT`, and `IEND` chunks. EXIF, GPS, device, text, timestamp, ICC, and other ancillary metadata are absent.
- The road and forest derivatives apply the recorded orientation-6 clockwise rotation. The four Display P3 sources and the Adobe RGB Library of Congress source were converted to sRGB with LittleCMS perceptual intent; the two untagged NPS RGB sources retain their sample values under the explicit sRGB assumption.
- Generation used Pillow 12.3.0, LittleCMS 2.19, zlib 1.3, and libjpeg-turbo 3.1.4.1. The exact runtime contract is recorded so later library drift fails closed.
- Exact creator credit, license link, claim limit, and a complete change note are carried into every derivative record. The four CC BY 4.0 records explicitly disclose orientation, color, format, and metadata changes; the Library of Congress and NPS claim limitations remain intact.
- A separate deterministic derivative overlay binds the immutable approved-original overlay and remains fail-closed:
  - `originals/smokies/roaring_fork_artwork_derivatives_v1.json`: `3287ba42f4d06a7733787659c8092feae89026a5194a60b9eeb342f57a98a305`.
  - `scripts/build_smokies_roaring_fork_artwork_derivatives.py`: `af28bad01d7e2a81de959704219b3c49c5e5d1e8d1d5358c1e3c40fefd5a4946`.
  - `tests/test_smokies_roaring_fork_artwork_derivatives.py`: `2b762b25c308baf3bf8764ed7d049b401ced7ac9af8b6371ad12650a730af982`.
- The overlay records completed orientation, metadata, hash, license, and mirror gates while retaining `derivative_user_visual_approval=false`, `ingestion_allowed=false`, `private_manifest_v3_artwork_binding_complete=false`, and `public_release=false`.
- Verification: staged and promoted copies passed independent pixel reconstruction and PNG CRC/chunk audits; the deterministic builder passed `--check`; Python compilation and whitespace validation passed; and nine focused derivative assertions passed without pytest fixtures.
- All seven derivatives were visually inspected for gross orientation, framing, decoding, and color failures. This technical inspection is not project-owner visual approval.

### Exact next action after S4I

1. Present the seven sanitized derivatives as a review-only contact set with exact attribution and mapping context.
2. Obtain explicit approve or revise decisions for every derivative.
3. If revisions are requested, preserve the approved originals and create new separately hashed derivative evidence; do not overwrite accepted evidence silently.
4. Keep importer, upload, private Manifest V3 binding, authenticated device preview, trusted validation, and public release blocked until the derivative visual decision is recorded.

### Do not repeat after S4I

- Do not redownload, replace, normalize, or sanitize any immutable original while its recorded identity remains unchanged.
- Do not regenerate these derivatives merely for compression or metadata comparison while their hashes and conversion runtime remain unchanged.
- Do not edit the source dossier, immutable artwork review, accepted narration masters, or culturally gated materials.
- Do not ingest, upload, bind, deploy, publish, call the narration endpoint, or begin another chapter during this derivative review gate.

## S4J Roaring Fork derivative visual-approval closeout

- Completed: 2026-08-10.
- Branch: `feat/smokies-original-s2`.
- Baseline/source HEAD: `443d6d5c59e74aa95adc32469cc1f6b84adf91a8`.
- The project owner explicitly approved all seven verified derivatives in continuation task `019fe9fb-cafa-75d3-b663-1e5051731cd5` with the decision `approve all derivatives`.
- This stage records that decision only. It did not regenerate or alter a derivative or original, ingest media, upload an asset, bind Manifest V3, change app code or backend data, deploy, publish, regenerate narration, or touch culturally gated material.
- Protected files remain unchanged:
  - `dashboard/explore_serving_index_v2.json`: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - `docs/app-store-copy.md`: `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
  - `.cursor/` was not touched.
- The approved decision is bound to immutable derivative record `3287ba42f4d06a7733787659c8092feae89026a5194a60b9eeb342f57a98a305`, preserving all seven file SHA-256 values, decoded-pixel SHA-256 values, dimensions, exact credits, license links, change notes, and claim limits.
- Both external evidence roots still contain exactly seven derivative PNGs totaling 213,587,790 bytes per copy. All fourteen file copies match their bound byte counts and SHA-256 values.
- The derivative record remains immutable with `derivative_user_visual_approval=false`; approval is represented in a separate overlay rather than rewriting the review artifact:
  - `originals/smokies/roaring_fork_artwork_derivative_approval_v1.json`: `e13c39785e90190e0dfb4db5c60c709568b68d3ecbd76910ab00799a721b951a`.
  - `scripts/build_smokies_roaring_fork_artwork_derivative_approval.py`: `e8a2f9dfcaab0adfa0841a3f35aaa65197938b83b76934893832893936fee295`.
  - `tests/test_smokies_roaring_fork_artwork_derivative_approval.py`: `1f20247a9e1208549d85f596c9e770fba8891d21df2883c54db754df1f3cc428`.
- The approval overlay records `derivative_user_visual_approval=true`, but retains `admin_importer_complete=false`, `verified_upload_evidence_complete=false`, `private_manifest_v3_artwork_binding_complete=false`, `authenticated_device_preview_complete=false`, `trusted_publication_validation_complete=false`, `ingestion_allowed=false`, and `public_release=false`.
- Verification: the derivative and approval builders passed deterministic checks; both derivative evidence roots passed exact membership, byte-count, and SHA-256 validation; Python compilation and whitespace validation passed; and seven focused approval assertions passed without pytest fixtures.
- The immutable source dossier, artwork review, original approval, verified derivative record, protected repository files, and thirteen accepted narration masters retained their recorded identities.

### Exact next action after S4J

1. Await explicit authorization for a bounded admin-only importer and private Manifest V3/upload-evidence packet.
2. Before any ingestion, define the exact accepted thirteen audio hashes, seven approved derivative hashes, creator/license/change records, James generator provenance, and fail-closed rollback behavior the importer must enforce.
3. Keep authenticated device preview and trusted publication validation separate from ingestion, and keep public release blocked until all operational, runtime, device, source, artwork, and cultural gates pass.

### Do not repeat after S4J

- Do not repeat derivative visual review, regeneration, copying, or hashing while the approved hashes and evidence roots remain unchanged.
- Do not mutate the immutable derivative record to embed approval; use the separate bound overlay.
- Do not ingest, upload, bind Manifest V3, deploy, publish, regenerate narration, call the narration endpoint, begin another chapter, or touch culturally gated material without a separately authorized packet.

## S4K Roaring Fork private Manifest V3 and importer preflight

- Completed: 2026-08-10.
- Branch: `feat/smokies-original-s2`.
- Baseline/source HEAD: `03ec400a23ec0bf62e7651740a0a75d8c9b3bd9c`.
- The project owner authorized the bounded next stage in continuation task `019fe9fb-cafa-75d3-b663-1e5051731cd5` with the decision `continue` after approving all seven derivatives.
- This stage created a deterministic one-chapter, one-variant private Manifest V3 packet for `roaring_fork/one_way`. It did not change a live database or asset store, upload or expose an asset, issue a preview token, run trusted validation, deploy, publish, regenerate narration, call a narration provider, begin another chapter, or touch culturally gated material.
- Immutable stage outputs:
  - `originals/smokies/roaring_fork_private_ingestion_authorization_v1.json`: `b7198d072604abb6a914378a6759b78f79526781e405f581191e7ec81429582f`.
  - `originals/smokies/roaring_fork_private_manifest_v3.json`: `7e9cab7e0325c6124a2605c83867929780f575e5814c7fdc634c091a9c351467`; canonical manifest SHA-256 `2fb77582811e28ef963f3018a8990a96612cfedee69f3b2329a73b87ac99d33a`.
  - `originals/smokies/roaring_fork_private_import_packet_v1.json`: `15d3a10b3a387cd23e1271e2d07428772d8f60e4568cbd417ef292d627252c1f`.
  - `originals/smokies/roaring_fork_private_import_preflight_v1.json`: `c090b5cbc1dc283c1bb95fcad3262f781f99aca3e1df40a13f102eea28b232b9`.
  - `scripts/build_smokies_roaring_fork_private_packet.py`: `e9dfaae6813c3e1740339890f1904a95fbaa77792fa50cb4c338471f9adb938b`.
  - `scripts/import_smokies_roaring_fork_private.py`: `072ebf038097c7d63695d4b04f7447ce90b30159a841f8dcfcf7af8058b006e3`.
- The packet binds exactly thirteen accepted provider-native narration MP3s and seven approved PNG derivatives, totaling 239,772,665 bytes, with no missing, additional, duplicate, transcoded, resized, or recompressed media. It preserves the accepted delivery order and delivery-contract SHA-256 `9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6`.
- The purpose-built importer validates the 73,289,752-byte historic-cabin derivative without weakening the ordinary 64 MiB upload limit. It verifies exact hashes, byte counts, MP3 probes, PNG CRC/chunk policy, dimensions, decoded-pixel hashes, attribution, and source bindings before any target mutation.
- Apply mode is dry-run-first and fail-closed. It requires the command target to match explicit `TRAILHEAD_DB_PATH`, `TRAILHEAD_ORIGINALS_ASSET_DIR`, and `TRAILHEAD_PRIVATE_IMPORT_TARGET_ID` configuration plus a real admin row. It rejects stale schemas, different drafts or assets, unsafe report destinations, evidence collisions, and protected-file drift before staging.
- Filesystem and database mutation are protected by a cross-process lock, same-volume staging, a recovery journal, one SQLite transaction, reference-aware cleanup, exact-replay idempotency, and post-import byte/database verification. No success report is made visible before every rollback-triggering step completes; an uncertain final report-directory sync keeps the matching import committed for exact replay instead of creating a report/rollback contradiction.
- Narration generator provenance is stored with `license_status=unverified`. The importer has no attestation input and cannot manufacture `license_attestation` or a narration profile. A real signed-in admin must later use the authenticated server-owned attestation endpoint; that separate action supplies reviewed terms while the server owns the attestation time and admin identity.
- Verification: the deterministic builder and exact local-evidence check passed; the dry-run revalidated all twenty source assets and both protected files; Python compilation, Ruff, and whitespace validation passed; eighteen importer/packet tests passed with external evidence, including first apply, exact replay, rollback, stale-journal recovery, concurrent exclusion, target/schema rejection, evidence/report collision rejection, and finalization failures; the broader focused suite passed eighty assertions with fifteen existing deprecation warnings.
- Protected files remain unchanged:
  - `dashboard/explore_serving_index_v2.json`: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - `docs/app-store-copy.md`: `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
- Live private byte import remains false because no configured target identity or real target admin context is available in this workspace. Admin narration-license attestation, authenticated device preview, trusted publication validation, deployment, and public release all remain false.

### Exact next action after S4K

1. Identify and bind the intended private target through the three explicit environment settings and a real admin user; do not substitute an isolated fixture or guessed path.
2. Re-run the exact dry-run, then invoke the bounded importer once against that configured target and preserve its verified transaction report.
3. After byte import, have the signed-in target admin review the exact ElevenLabs terms/version/date and call the server-owned license-attestation endpoint for all thirteen narration records. Do not infer or fabricate that evidence.
4. Stop again before authenticated device preview, trusted validation, deployment, or publication; each remains a separate authorization and evidence gate.

### Do not repeat after S4K

- Do not rebuild the packet, re-probe media, or rerun the disposable transaction while the recorded inputs, target requirements, and implementation hashes remain unchanged.
- Do not resize or recompress the historic-cabin derivative to fit the ordinary upload route, weaken that route's limit, or overwrite any approved derivative.
- Do not add an attested narration profile from account screenshots or caller-authored JSON; only the authenticated server-owned admin flow may create the attestation.
- Do not run device preview, trusted publication validation, deploy, publish, regenerate narration, begin another chapter, or touch Cherokee/EBCI or other culturally gated material from this checkpoint.

## S4L Roaring Fork configured private byte-import closeout

- Completed: 2026-08-10.
- Branch: `feat/smokies-original-s2`.
- Baseline/source HEAD: `9870ed454a858b8c5c5726ba929bbc60e191683f`.
- The project owner authorized this bounded next stage in continuation task `019fe9fb-cafa-75d3-b663-1e5051731cd5` with the decision `continue` after the S4K preflight.
- The intended configured target was verified directly as the Trailhead production service's private draft database and asset volume, then bound as `railway.trailhead.production.private`. This stage did not deploy code or create a public version.
- Before ingestion, a SQLite backup was created and independently verified at `/data/backups/trailhead-20260810T070013Z.sqlite3`: 1,545,113,600 bytes; SHA-256 `8d51e4107c0eeefbb7abb0678b0459ec802b2d2f4e4dc48d2baa695976415eb7`; integrity check `ok`; 91 tables.
- A production-side dry-run revalidated the unchanged packet SHA-256 `15d3a10b3a387cd23e1271e2d07428772d8f60e4568cbd417ef292d627252c1f`, canonical Manifest V3 SHA-256 `2fb77582811e28ef963f3018a8990a96612cfedee69f3b2329a73b87ac99d33a`, delivery-contract SHA-256 `9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6`, all twenty source hashes and probes, and both protected-file hashes before the first target mutation.
- Target preflight proved that the Roaring Fork pack did not exist, its asset-row and published-version counts were zero, the chosen existing Originals operator remained an administrator, the database schema matched the importer contract, and the report destination did not exist.
- The bounded importer committed one private draft at revision 1 plus exactly twenty current content-addressed asset records: thirteen accepted provider-native narration MP3s and seven approved artwork PNGs totaling 239,772,665 bytes. It created twenty new storage files and twenty new rows, required no interrupted-run recovery, and required no rollback.
- Verified transaction ID: `0792c0e78fd54e2066a12b453fbfe11e1bb1f381924e3b95cd7ddeab86115f5a`.
- The exact configured-import receipt is preserved as `originals/smokies/roaring_fork_private_import_receipt_v1.json`: SHA-256 `8890c1e1431654a03feb1aa4ee4376ab50504e9841b4d8a06f0a3c003b0ebefd`.
- Independent post-import readback rehashed every stored file and matched the exact twenty-entry receipt map. It confirmed thirteen narration rows, seven artwork rows, 239,772,665 total bytes, draft revision 1, zero published versions, SQLite `quick_check=ok`, private template visibility, `public_release=false`, and unchanged packet identities.
- Every narration row retains `license_status=unverified` and contains no `license_attestation`. No terms identifier, URL, version, review date, administrator attestation, or narration profile was inferred or manufactured.
- Release-facing gates remain false: `admin_license_attestation_complete`, `verified_private_upload_complete`, `authenticated_device_preview_complete`, `trusted_publication_validation_complete`, and `public_release`. Only `configured_private_byte_import_complete=true`.
- No preview token was issued, no authenticated device preview or trusted validation ran, no deploy or publication occurred, no narration was regenerated, no other chapter was imported, and no Cherokee/EBCI or other culturally gated material was touched.
- Task-scoped cleanup was verified after the final readback: the remote source staging tree, source archive, dependency archive, transfer-test file, and two temporary evidence-mirror trees were removed with zero scoped paths remaining; all twenty imported storage files and the server receipt remained present. Local staging, archives, runner, upload helper, and transfer-test paths were absent. The temporary Railway registration `trailhead-codex-rf-import-20260810` was removed, leaving only the pre-existing registered key; the pre-existing local key material was not deleted or changed.
- Protected files remain unchanged:
  - `dashboard/explore_serving_index_v2.json`: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - `docs/app-store-copy.md`: `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.

### Exact next action after S4L

1. A real signed-in target administrator must review the exact current ElevenLabs terms identifier, HTTPS URL, version, and review date; do not reuse test fixtures or infer missing values from account screenshots.
2. Before making thirteen independent attestation calls, add or use a V3-compatible SHA-pinned and idempotent operator flow, or otherwise freeze asset replacement and verify every response/readback against the accepted narration SHA-256.
3. After all thirteen server-owned attestations are verified, build the attested narration profile and re-evaluate the private-upload gate.
4. Stop again before authenticated device preview, trusted validation, deployment, or publication; each remains a separate authorization and evidence gate.

### Do not repeat after S4L

- Do not rerun the byte import or transfer the approved sources again while the receipt, configured target, and twenty current asset identities remain unchanged.
- Do not alter or replace a current narration asset between administrator review and attestation.
- Do not invent terms metadata, administrator identity, or attestation time, and do not treat byte import as a verified licensed upload.
- Do not run device preview, trusted publication validation, deploy, publish, regenerate narration, begin another chapter, or touch Cherokee/EBCI or other culturally gated material from this checkpoint.

## S4M Roaring Fork administrator-attestation hardening closeout

- Completed locally: 2026-08-10.
- Branch: `feat/smokies-original-s2`.
- Baseline/source HEAD: `003c506a700eb115a8e44355687a0533a06de436`.
- The project owner authorized continuation in task `019fe9fb-cafa-75d3-b663-1e5051731cd5`. This stage implements and tests the operator contract only. It did not deploy code, change the production database or asset volume, perform an administrator attestation, create a narration profile, issue a preview token, run trusted validation, publish, regenerate narration, import another chapter, or touch culturally gated material.
- Each attestation request now binds one exact current narration SHA-256 and the exact saved draft revision. The store rechecks both under `BEGIN IMMEDIATE`, rehashes the stored bytes, rechecks administrator status, and rejects stale draft or asset state without writing.
- An exact retry is a no-op that preserves the first server-owned administrator identity, attestation time, legal record, and asset `updated_at`. Different terms, malformed partial evidence, caller-authored attested metadata, unsupported providers, unrelated provider hosts, future dates, date-times in place of calendar dates, images, missing provenance, and changed bytes all fail closed.
- Replacing an attested narration preserves the historical attestation on the old digest and leaves the new current digest unverified. Same-byte generic upload and the purpose-built Roaring Fork importer preserve a complete server-owned overlay while continuing to reject generator-provenance drift. Database initialization also preserves complete evidence.
- The standalone administrator panel is Manifest V1/V3 compatible. For the exact private Roaring Fork manifest it enumerates all thirteen narration assets from `manifest.stories`—five hard cues and eight selectable stories—binds each to the saved manifest SHA-256 and current uploaded record, keeps every legal field blank, and reports `COMPLETE` only after all thirteen exact records read back with complete server-owned evidence. It cannot derive completion from the five hard cues alone.
- The administrator confirmation explicitly states that the legal action does not approve preview or publication. It links the official non-EEA and EEA/Switzerland/UK ElevenLabs Terms, Voice Library Addendum, Prohibited Use Policy, and Beta Services Addendum, and warns that the applicable contract must come from actual residence/account agreements rather than timezone or server location.
- Current public page dates were checked only to prepare the review surface: both primary Terms pages displayed `31 March 2026`; the Voice Library Addendum displayed `6 March 2026`; the Prohibited Use Policy displayed `3 September 2025`; and the Beta Services Addendum displayed `13 November 2024`. These observations are not a signed-in administrator review, do not choose the applicable contract, and were not written into any production record or prefilled field.
- Implementation identities before this checkpoint edit:
  - `dashboard/admin.html`: `652dfc63dd4b3ca7072df85d715a4b74a62625122ebcf65e29a01c6dfec0ba9c`.
  - `dashboard/admin.originals-license.test.mjs`: `416ee6811e063931512f5b7472bab29fb46e6e26e1b1e32c04174ead03382887`.
  - `dashboard/server.py`: `c737c8c0caf97303988a8a56bf30f3290c91b55c0c8cd06c2c7f7cf9dbc97683`.
  - `db/store.py`: `af186db1b88d1e43474e28e8440d2dcd73d31e50d35c4bbbc18de2fe8bfaafde`.
  - `scripts/import_smokies_roaring_fork_private.py`: `6cac2f3841cf3af12eb48aaba6e2a7108d1aafddbc7b5a4762a194189d6c5bce`.
- Verification passed: 219 focused Python tests plus 17 subtests; three standalone Studio JavaScript contract suites; Python compilation; and whitespace validation. Two environment-gated private-import E2E cases were skipped in this local run; their exact configured production-import path and readback remain represented by the unchanged S4L receipt. Coverage includes strict API parsing, server-owned identity/time, stale SHA and revision conflicts, forced byte rehash, exact replay, conflicting terms, provider-host binding, forged-overlay rejection, asset replacement, `init_db`, same-byte upload, exact importer replay, V1/V2/V3 compatibility, exact thirteen-record Roaring Fork UI membership, and existing Originals regressions.
- The established long-form suite intentionally reports twelve source-drift failures because `roaring_fork_delivery_readiness_v1.json` binds the prior `dashboard/server.py` and `db/store.py` hashes. Those failures are retained as a fail-closed gate: no readiness evidence was rewritten and no trusted validation was run. A separate pre-existing vehicle-binding test also fails identically on untouched baseline `003c506a`; the temporary baseline worktree used to confirm that fact was removed.
- The exact configured-import receipt remains unchanged: `originals/smokies/roaring_fork_private_import_receipt_v1.json` SHA-256 `8890c1e1431654a03feb1aa4ee4376ab50504e9841b4d8a06f0a3c003b0ebefd`. The unchanged S4L readback records thirteen unverified narration records and seven artwork records; this local stage made no production query or mutation and does not claim a fresher production observation.
- Protected files remain unchanged:
  - `dashboard/explore_serving_index_v2.json`: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - `docs/app-store-copy.md`: `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
- Release-facing gates remain false: `admin_license_attestation_complete`, `verified_private_upload_complete`, `authenticated_device_preview_complete`, `trusted_publication_validation_complete`, and `public_release`.

### Exact next action after S4M

1. Review and separately authorize deployment of the hardened server/operator code; a branch commit is not a production deployment.
2. After that exact code is deployed, a real signed-in target administrator must personally determine the applicable ElevenLabs contract and review the exact primary/supporting terms, account agreement, paid-plan status at generation, non-beta status, script/input rights, James voice restrictions, attribution duties, and Trailhead distribution rights. Enter the actual terms identifier, URL, displayed version, and real review date; do not reuse test fixtures.
3. With asset replacement operationally frozen, record and read back all thirteen independent SHA/revision-pinned attestations. Any mismatch or partial completion keeps the overall gate false; do not manufacture a bulk-complete claim.
4. Only after all thirteen exact records verify may a separately reviewed narration profile be built and the private-upload gate be re-evaluated.
5. Stop again before authenticated device preview, trusted validation/readiness regeneration, deployment beyond the separately approved server change, or publication.

### Do not repeat after S4M

- Do not rerun the S4L byte import, transfer the source archives, replace a narration, or rewrite the immutable import receipt while its identities remain unchanged.
- Do not prefill, infer, or copy legal terms from tests, timezone, billing guesses, screenshots, or this checkpoint. Only a real signed-in administrator review may create the production evidence.
- Do not update the checked long-form source hashes merely to make tests green. Regenerate readiness evidence only through the separately authorized trusted-validation gate.
- Do not preview, run trusted validation, publish, regenerate narration, begin another chapter, or touch Cherokee/EBCI or other culturally gated material from this checkpoint.

## S4N safe integrated production deployment closeout

- Completed: 2026-08-10.
- The project owner first requested deployment of S4M source `f7ef122a`, then authorized the safe integration path with `oh, yeah do this saftly` after the production-lineage risk was explained. The `f7ef122a` snapshot was not deployed directly because it did not contain the current production privacy, deletion, subscription-receipt, and 300-second startup safeguards.
- Release branch `release/smokies-s4m-production-20260810` integrates the approved S4M source and the then-current production source in merge commit `fb46c67dafb9e3378d10226b03d908a9343df2aa`, tree `a3236d1a197f09cf8be33a3757f6a3d602ba2fd6`, with exact parents `f7ef122a3f586e9563d784acf4c0af19747fd0e8` and `e8bd03013024f7d43f790d8ee309f2c72b8f1b81`. Both ancestry checks passed; the committed release worktree was clean, pushed, and origin-equal before deployment.
- The integration preserves production's first-party privacy and account-deletion behavior, subscription ownership and receipt safeguards, dynamic foreign-key-on transactional deletion, Nixpacks deployment, `/data` volume, `/api/health`, 300-second health window, and on-failure/three-retry policy. It also preserves S4M's SHA/revision-pinned administrator attestation, exact-replay behavior, forced stored-byte rehash, Manifest V3 operator panel, and stricter delayed legacy Stripe settlement. New delayed Stripe settlements bind `purchase_kind=stripe`.
- Predeployment verification was zero-failure across the integrated security gate (`103 passed, 2 skipped`, with only the two explicitly environment-gated private-import E2E cases skipped), `tests/test_originals.py` (`57 passed`), the production-lineage group (`63 passed`), the historical privacy/affiliate/explore group (`57 passed`), the S4M admin/manifest/private-packet group (`73 passed`), additional Originals validation groups, the three administrator JavaScript contract suites, mobile privacy/referral/telemetry/app-link/Originals checks, native drift, TypeScript, Python compilation, and repository whitespace/conflict checks.
- Two established fail-closed baselines were retained rather than falsified: the long-form suite reported exactly twelve source-drift failures, all rooted at `Checked long-form consumer readiness source drifted: dashboard/server.py`, and one pre-existing vehicle-binding compatibility test retained its baseline `200`-versus-`400` failure while the exact account-deletion vehicle-binding test passed. Readiness evidence was not rewritten.
- Railway production deployment `30cbd377-6496-4959-8eea-5a8c34b23397` completed with status `SUCCESS` and a running instance. Deployment message: `smokies-s4m-integrated-fb46c67d`. Image: `sha256:d7ace9f38fbbee33b6bd8836102c5d6847d1073d12a151586f2e772f613794e8`. The existing `trailhead-volume` remained mounted once at `/data`, ready and not pending deletion. Runtime is V2; build is Nixpacks/build-environment V3; start command is `mkdir -p /data && python run.py`; health path is `/api/health`; timeout is 300 seconds; restart policy is on-failure with three retries.
- Startup completed approximately 130.19 seconds after application startup began, inside the preserved 300-second gate. No traceback, exception, fatal, failed-startup, or migration message appeared. Three later duplicate-operation-ID warnings came from pre-existing dual-method administrator routes during OpenAPI inspection and were not startup or migration failures.
- Three independent cache-busted health reads returned HTTP 200 and the exact 37-byte body `{"status":"ok","service":"trailhead"}`, SHA-256 `52858ba614380466447b9d95121dfd52c150a93c73d757fec852b4dceb093e8f`.
- Two raw `/admin` fetches matched the integrated candidate exactly: 336,549 bytes; SHA-256 `69a37f0f53d4474d1c60373a028d998352453e0d49d6110e7be8323f76a342de`. Live source readback also matched `dashboard/server.py` SHA-256 `8771645974d82a6c2f961b29ca6119a5da1454f7242513c3401f9df6b0cd09ea`, `db/store.py` SHA-256 `b48a1d20d144745b0c8ca1a8769afca6c5bbccd4cebdf0f3e4347c994f030d28`, `railway.toml` SHA-256 `151a66fb8a32ceef088bf8b019cf16c136cc2682fa54bc024cb8be33bb66ed40`, and private importer SHA-256 `6cac2f3841cf3af12eb48aaba6e2a7108d1aafddbc7b5a4762a194189d6c5bce`.
- The live administrator-attestation request schema matched SHA-256 `f014a076893880409cad42399fa573fea80546217f6ae47d9e9d745cfe6ee0c9`: HTTP bearer security, no extra properties, all six required fields, lowercase 64-hex expected SHA, draft revision at least one, and an exact calendar-date `reviewed_at`. The privacy API subset matched SHA-256 `c4b1622cdb59ff5baabb00ab6e60940f3de79efee13a9f00b92bd50c6693a4b0`. After excluding only the six nondeterministic duplicate `operationId` values, the full local/live OpenAPI structures matched SHA-256 `873381ef7b14c1c9290e179c159f63db757a676c698b0769ed703860e604dfb5`.
- Unauthenticated reads of `/api/auth/me`, `/api/admin/originals`, and the exact private Roaring Fork administrator resource each returned 401. Privacy, partial-deletion, account-deletion, and terms pages returned 200 with every required non-email policy marker and no Branch/referral-host link. AASA and assetlinks records matched the approved structures and hashes.
- A read-only production-side SQLite and storage probe was identical before and after cutover: `quick_check=ok`; exact target identity; pack kind `original_drive`; status `draft`; draft revision 1; no current published version; exactly twenty current assets comprising thirteen narrations and seven images; 239,772,665 aggregate bytes; exact import-receipt membership; every storage location under the expected asset root; every stored byte SHA-256 matched; mismatch list empty; thirteen narrations remained unverified; zero license attestations; zero published versions; zero validation reports.
- The exact private-import receipt remains unchanged at `originals/smokies/roaring_fork_private_import_receipt_v1.json`, SHA-256 `8890c1e1431654a03feb1aa4ee4376ab50504e9841b4d8a06f0a3c003b0ebefd`. Protected files remain unchanged: `dashboard/explore_serving_index_v2.json` SHA-256 `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`; `docs/app-store-copy.md` SHA-256 `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
- No POST, DELETE, bearer-authenticated request, administrator attestation, narration profile, preview token, device preview, trusted validation, readiness regeneration, publication, narration regeneration, other-chapter import, or culturally gated action was performed during deployment verification.
- Rollback anchor deployment `1dfb838d-dc4e-4cea-9176-a63aeaa205bc`, image `sha256:21ef69cdfbacf378636bfa42ba95283f9a557a62b96e443c7608b8ac06c04e3f`, remains Railway-eligible for rollback/redeploy. A code rollback would not revert `/data`; any future database drift must be frozen and handled separately rather than auto-restored.
- Task-scoped cleanup completed after the final live readback: Railway registration `trailhead-s4m-deploy-20260810` was removed; all six exact local/WSL private and public key copies were removed; deployment probe, OpenAPI helper, deployment/build log snapshots, polling JSON, and downloaded `/admin` snapshot were removed; and the clean isolated deployment worktree `/tmp/trailhead-deploy-fb46c67d` was unregistered and removed. The pre-existing Railway key and unrelated local key were not changed.
- Release-facing gates remain false: `admin_license_attestation_complete`, `verified_private_upload_complete`, `authenticated_device_preview_complete`, `trusted_publication_validation_complete`, and `public_release`. Only the separately evidenced configured private byte import and this code deployment are complete.

### Exact next action after S4N

1. A real signed-in target administrator must personally identify and review the applicable current ElevenLabs account agreement and terms, paid-plan/commercial-use status at generation, non-beta status, input rights, James voice restrictions, attribution duties, and Trailhead distribution rights.
2. With narration replacement operationally frozen, enter the actual terms identifier, exact ElevenLabs HTTPS URL, displayed version, and real calendar review date, then record and read back thirteen independent SHA/revision-pinned attestations. Any mismatch or partial result keeps the overall gate false.
3. Only after all thirteen exact current narration records verify may a separately reviewed narration profile be built and the private-upload gate be re-evaluated.
4. Stop again before authenticated device preview, trusted validation/readiness regeneration, or publication; each remains a separate authorization and evidence gate.

### Do not repeat after S4N

- Do not redeploy `f7ef122a` directly or bypass the integrated production lineage.
- Do not rerun the S4L byte import, transfer source archives, replace narration assets, or rewrite the immutable import receipt while its identities remain unchanged.
- Do not infer or prefill legal evidence from tests, public page dates, timezone, account screenshots, or this checkpoint. Only the real signed-in administrator review may create production attestations.
- Do not update long-form source hashes merely to make tests green, and do not preview, run trusted validation, publish, regenerate narration, begin another chapter, or touch Cherokee/EBCI or other culturally gated material from this checkpoint.

## S4O Roaring Fork administrator license-attestation completion

- Completed: 2026-08-10.
- Release branch: `release/smokies-s4m-production-20260810`.
- Baseline/source HEAD: `4da49586d93f2c5eb04a5e94f2707d91877bbb43`.
- After the S4N deployment, the project owner authorized the signed-in administrator step with `please proceed` and then personally confirmed that the applicable primary agreement was non-EEA with `Non-EEA, confirmed.` No residence or contract choice was inferred from timezone, server location, tests, account screenshots, or provider metadata.
- The signed-in production administrator used the deployed Manifest V3-compatible Trailhead Admin panel against the existing private Roaring Fork draft at revision 1. No narration or artwork asset was replaced, uploaded, regenerated, transcoded, resized, or recompressed during this stage.
- The administrator supplied the same exact reviewed terms fields for each of the thirteen accepted narration assets:
  - terms identifier: `elevenlabs_terms_of_service_non_eea_2026-03-31`;
  - primary terms URL: `https://elevenlabs.io/terms-of-use`;
  - displayed terms version: `31 March 2026`;
  - actual review date: `2026-08-10`.
- Each of the thirteen requests independently bound draft revision 1 and the exact current narration SHA-256. The server rechecked the current row and stored bytes, supplied the authenticated administrator identity and attestation time, and returned the immutable evidence record. The exact completed set is:
  - `rf_audio_cue_01`: `d3e0796c436e4ffedb748bc08007f0661cea683eda3204df48b3639f70658bed`;
  - `rf_audio_cue_02`: `6c99af44807f3fb78435f04da91ecc234e2c2e8f682df44ed943173a48bff107`;
  - `rf_audio_cue_03`: `97236ccc1148d8f73d6cb20dc5447c9155bdcb4e825fbcae452007af5d12ae6c`;
  - `rf_audio_cue_04`: `673941fe546cd1801e27d6dc9789c30ade0fc2dbe52050944cfa67a7974156c3`;
  - `rf_audio_cue_05`: `a179f23a534976308e4fbfc20f45a428fe7f4e1bc1fd798be84e5e94cae67f1a`;
  - `rf_audio_cue_06`: `0afae81566cf0a1ce1b220dfbe7c87b12d48235f7b3ec4149f5b9fba61a1539b`;
  - `rf_audio_story_01`: `b9f0a21bd1afbfff8a1472e367502d50d931e339214e9cc5da01b7ba12e3e73c`;
  - `rf_audio_story_02`: `a0f70a05d89f2318b3f99b8580bfdb93d5e626cc696dca9614c5bf3bc078006e`;
  - `rf_audio_story_03`: `ca7ea9e8cd997ee1cf90cc0b4112f17cb8815754b6a2ccfdc0e1112e3696b1a7`;
  - `rf_audio_story_04`: `89b8d5bb8c56e2ec15ce2e6ad82cdf298555edce4906bf2c51dcb1b91b26f4e4`;
  - `rf_audio_story_05`: `879442f4087fb7d3fc9bf37f972eb750c17bfe33cd914a3aa9eea91c46985258`;
  - `rf_audio_story_06`: `3bf8872d360e8e1850e7699171ec53944ca8da6f128b14d94bfd7a4613f0f4f6`;
  - `rf_audio_story_07`: `2af7d496eb6aef7b58f585a382ec1deba301a83878c824df5b572dec6009340d`.
- Final live read-only verification found exactly thirteen panel entries, every entry labeled `RECORDED`, and the exact overall state `COMPLETE · 13/13 EXACT`. Selecting each entry displayed exactly one server record bound to its expected SHA-256, terms identifier, terms version, and review date. The successful per-asset write/readback flow also verified each submitted primary terms URL exactly, and all thirteen requests were issued against saved draft revision 1.
- The completed Trailhead Admin page was left open for the project owner. The panel explicitly limits this action to narration-license evidence; it does not approve preview or publication.
- Other than this checkpoint entry, no application source, manifest, narration profile, preview token, device preview, trusted validation, readiness record, published version, imported media byte, deployment, narration generation, other chapter, or Cherokee/EBCI or other culturally gated material was changed during this stage.
- Gate state is now `admin_license_attestation_complete=true`. `configured_private_byte_import_complete=true` remains unchanged. `verified_private_upload_complete`, `authenticated_device_preview_complete`, `trusted_publication_validation_complete`, and `public_release` remain false.

### Exact next action after S4O

1. Separately review and authorize construction of the narration profile from the exact thirteen server-owned attestation records and the already-bound James generator provenance.
2. Re-evaluate `verified_private_upload_complete` only after the profile matches every current narration digest and exact license record.
3. Stop again before authenticated device preview, trusted validation/readiness regeneration, or publication; each remains a separate authorization and evidence gate.

### Do not repeat after S4O

- Do not repeat the thirteen administrator attestations while these exact current narration digests and evidence records remain unchanged; exact retries are no-ops and different terms require the separate replacement flow.
- Do not rerun the S4L byte import, replace or regenerate narration, rewrite the immutable import receipt, or infer a later terms review from this completed record.
- Do not build a narration profile, preview, run trusted validation, publish, begin another chapter, or touch Cherokee/EBCI or other culturally gated material without the separately authorized next gate.

## S4P Roaring Fork verified private narration-profile closeout

- Completed: 2026-08-10.
- Release branch: `release/smokies-s4m-production-20260810`.
- Guarded source commit: `526c2e0b14ae7e247e06b6953f9388329d7c2dbc`; tree: `c185bce662f46084ef416542aed3b80fb43ff2e0`. The worktree was clean, pushed, origin-equal, and descended from the previously deployed integrated production source before deployment.
- The project owner authorized this bounded next gate with `continue .` after the exact thirteen administrator attestations had completed. This stage attached only the reviewed narration profile and re-evaluated the verified-private-upload gate. It did not authorize or perform preview, trusted validation, readiness regeneration, publication, other-chapter work, or culturally gated work.
- The deterministic profile is `originals/smokies/roaring_fork_narration_profile_v2.json`, file SHA-256 `10fd4f5f04cbfbc411a1e7c31061700d17752af61e1501a4b7b4652c0d2ee377`, canonical SHA-256 `f79b386031ca0faf6e07332e53ea037f957eb7d9871c4bbf05d5b0aff09c2af5`. It binds ElevenLabs, voice `EkK5I93UQWFDigLMpZcX`, `eleven_multilingual_v2`, native mono `mp3_44100_128`, the exact common non-EEA terms record, Creator/commercial-use evidence, disabled training contribution, standard provider retention, and `verified_at=2026-08-10T20:19:19Z`, the latest of the thirteen server-owned attestation times.
- The profile evidence overlay distinguishes the production probe's default-JSON digest from the store's canonical normalized manifest digest. The exact profile-absent base manifest is `2fb77582811e28ef963f3018a8990a96612cfedee69f3b2329a73b87ac99d33a`; the exact profiled manifest is `14d83293ba3b09aad00998668311447b5224f5172e641d35163de2865e3c9eb8`. The thirteen-record redacted-attestation set is `465665e7313d661bb1ce6dcc79b3b41e0d89a5385fed204656fab29c126c5003`; administrator IDs are omitted before hashing and are not present in tracked evidence or operator reports.
- Provider-account claims are tracked only through the minimal redacted derivation `originals/smokies/elevenlabs_james_account_claims_redacted_v1.json`, SHA-256 `a25244c99f5a23db859579b59318155a243418f24ad8b5e0e93f268757bdacc1`. It intentionally omits credit balance, billing/overage controls, API-key policy, credentials, and administrator identity.
- The generic full-draft save path and every current-asset write fail closed once a profile is attached. The dedicated store transaction CAS-binds draft revision, validation-metadata hash, normalized base manifest, the complete twenty-asset map with forced stored-byte rehash, and thirteen privacy-redacted attestation hashes. It also revalidates exact narration transcript, duration, media, generator, terms, timestamp, and single-current-administrator bindings under `BEGIN IMMEDIATE`.
- A proposed HTTP apply route was removed before release because it could bypass the durable rollback journal. The only production mutation path is `scripts/apply_smokies_roaring_fork_narration_profile.py`, SHA-256 `d2a28df9b3c9143dbeadbbd40643bd3ec8d46d3f171634dd0fb7f4b57229cc26`. It verifies the configured database/asset-root identity, writes and fsyncs the exact same-volume rollback snapshot before mutation, preserves that snapshot across lost-response replay, and supports an exact monotonic-revision revert without raw SQL.
- Final predeployment verification passed sixty-seven focused profile/store/operator tests, two broader zero-failure regression groups of 140 and 197 tests, all three Originals Studio JavaScript contract suites, deterministic builder check, Python compilation, direct helper invocation, and repository whitespace validation. The established long-form suite retained exactly twelve fail-closed source-drift failures rooted at `dashboard/server.py`, with sixteen passes; readiness evidence was not rewritten.
- Two integrity-checked production SQLite backups were retained before mutation. The predeployment backup is 1,545,691,136 bytes, 92 tables, SHA-256 `0efcf25c5ea0d9ce29e43b25f5c723cb2b934ec6c9e3443fce18c9669f5ce53d`; the immediate pre-apply backup has the same byte/table counts and SHA-256 `ca3449eead9dc425030df18b11b7b8b70a894f910c9144c086271bcf395df67e`. Both reported integrity `ok`.
- Railway deployment `2e087ccf-09f6-4803-86df-4da3b9bced79` completed with status `SUCCESS`, message `smokies-s4p-profile-526c2e0b`, and image `sha256:9ae3bef239a7cce6f72e7c3d8ff1bc01bf5feaa21fc2c036eb262c56294446e8`. It preserved the existing `/data` volume, Nixpacks/build-environment V3, runtime V2, `/api/health`, 300-second health window, start command, and on-failure/three-retry policy. The prior deployment `30cbd377-6496-4959-8eea-5a8c34b23397` became the code rollback anchor.
- Startup completed inside the health window with no traceback or failed-startup message. Three independent cache-busted health reads returned HTTP 200 and `{"status":"ok","service":"trailhead"}`. Production source hashes matched the committed store, operator, builder, and profile bytes exactly.
- The first production operator invocation stopped before database access because Railway SSH selected a bare interpreter without application packages. It performed no mutation. Repeating with the deployed application interpreter completed the read-only dry run and force-rehashed all 239,772,665 media bytes: exactly twenty assets, thirteen narrations, seven images, draft revision 1, zero published versions, zero validation reports, exact receipt SHA-256 `8890c1e1431654a03feb1aa4ee4376ab50504e9841b4d8a06f0a3c003b0ebefd`, and all profile/base/applied identities matched.
- After the second backup, one fresh CAS transaction attached the exact profile and advanced the draft from revision 1 to revision 2. The operation was not a replay and required no revert. The durable application report SHA-256 is `e2ee2f9c69e4824a3a9faca1c02338a39265d66ca8f5b4d4767ab432d9dc5750`.
- Independent post-apply verification rehashed the exact twenty current files again and confirmed revision 2, the exact profiled manifest and profile hashes, thirteen narrations, seven images, 239,772,665 aggregate bytes, zero published versions, zero validation reports, and a single current administrator behind the redacted attestation set. The final live validation-metadata SHA-256 is `38a92cda1974508181ac7c619fdbd53e1729c22bcc8e8a99c250930b107e5568`.
- The historical S4K packet, S4L receipt, source Manifest V3, narration/artwork bytes, generator records, and server-owned license attestations were not rewritten or replaced. No preview token was issued; no device preview, trusted validation, publish call, narration generation, media upload, another chapter, Cherokee/EBCI, or other culturally gated action occurred.
- Gate state at this checkpoint: `admin_license_attestation_complete=true`; `verified_private_upload_complete=true`; `authenticated_device_preview_complete=false`; `trusted_publication_validation_complete=false`; `public_release=false`. The configured private-byte-import fact remains evidenced by the immutable S4L receipt rather than a newly invented live metadata key.
- Task-scoped cleanup completed after final verification: Railway registration `trailhead-codex-s4p-profile-20260810`, the temporary test dependency tree, test logs, helper output, and local preflight probe were removed. The pre-existing Railway key and pre-existing local key files were not changed. The production rollback report and both verified backups were retained intentionally.

### Exact next action after S4P

1. Separately review and authorize an authenticated private device-preview gate for the exact revision-2 Roaring Fork draft; do not infer preview acceptance from byte/profile verification.
2. Keep trusted validation, readiness regeneration, and publication separate. Current long-form readiness evidence is deliberately stale and must remain fail-closed until that later gate is explicitly authorized and rerun from current sources.
3. Stop again after private preview evidence. Do not roll preview, trusted validation, and publication into one action.

### Do not repeat after S4P

- Do not repeat the narration-profile apply, thirteen license attestations, or S4L byte import while the exact current profile, attestations, receipt, and twenty asset identities remain unchanged.
- Do not use the generic full-draft save or replace any current asset while this profile is attached. If rollback is required, use the retained guarded report and exact profile revert before any code rollback; Railway code rollback alone does not revert `/data`.
- Do not update long-form source hashes merely to make tests green, issue a preview token without separate authorization, run trusted validation, publish, regenerate narration, begin another chapter, or touch Cherokee/EBCI or other culturally gated material from this checkpoint.

## S4Q Roaring Fork authenticated Android device-preview closeout

- Completed: 2026-08-10 local time (`2026-08-11T00:02:33Z`).
- Release branch: `release/smokies-s4m-production-20260810`.
- Guarded source commit: `167028e08902ad03787b43b706f67e20ddcefc1b`; tree: `2ee093097104eba9b8fdcceca108d7fcba9fcd82`. The worktree was clean, pushed, origin-equal, and remained a descendant of the S4P production source before deployment.
- The project owner authorized the physical Android gate with `android is unlocked, loptop, whatever you need to do lets do it and get this done.` This stage was limited to the exact private revision-2 Roaring Fork preview and its revision-preserving completion marker. It did not authorize trusted validation, readiness regeneration, publication, another chapter, narration or artwork replacement, or culturally gated work.
- The committed mobile review surface reaches all thirteen exact R2 entries: five hard cues, four capacity stories, three stopped/parked stories, and one after-route story. It resolves the seven approved local artwork identities, uses the existing real narration/caption path, and fails closed on missing or ambiguous artwork.
- Private acquisition and cleanup are owner-, pack-, version-, and manifest-bound. A durable cleanup identity is recorded before the first private write; staging, final, promotion-backup, and native-map work are journaled; Android Back, top close, End test, completion exit, unmount, token loss, and administrator-role loss all converge on the same retryable exact cleanup. The preview token is cleared first and the cleanup marker last.
- The purpose-built server marker has no HTTP route. Its store transaction CAS-binds draft revision 2, profiled/base/preview manifest identities, validation metadata, all twenty current asset rows and forced byte hashes, thirteen redacted license-attestation hashes, exact Android build/runtime/release/update identity, and zero published versions or validation reports. Exact replay is a no-op; a guarded journaled revert exists while downstream gates remain false.
- Verification before release passed the full Originals mobile suite, a fresh TypeScript compile, publisher/native/runtime/release-identity/app-link gates, Android unit tests, 206 focused backend tests, thirty-seven marker/operator tests plus twenty-seven subtests, dashboard contract tests, Python compilation, and whitespace validation. Independent mobile and marker audits found no remaining P0/P1 issue.
- Production deployment `c69faf17-f51a-4845-8c0c-77e2882805fa` completed with `SUCCESS`, message `smokies-s4q-device-review-167028e0`, and image `sha256:08b51e97bc75a0864287bc6499bebda49f4a388b0882dcb3acf172bc0197ec9c`. It preserved Nixpacks, the existing `/data` volume, `/api/health`, the 300-second health window, the established start command, and on-failure/three-retry behavior. Live source hashes matched the committed admin, store, and marker helper. Three final public health reads returned HTTP 200 and the exact healthy service body.
- The predeployment backup `/data/backups/trailhead-20260810T232051Z.sqlite3` is 1,545,691,136 bytes with SHA-256 `b23e371f41e97ddaa2ef307f119bf6b5f7bcd6a77081be71c2d262054083ec2a`, integrity `ok`, and 92 tables. The immediate pre-marker backup `/data/backups/trailhead-20260810T235948Z.sqlite3` is 1,545,691,136 bytes with SHA-256 `42fe0f123f2d9433d8ae99d724d525249763b1bb9f896966ec17d2efd8620e00`, integrity `ok`, and 92 tables.
- Preview-channel update `019fee05-7a92-73bb-b32d-0b743dd7caee`, group `eac37882-d162-4db1-a64f-ccce579f1407`, delivered exact source `167028e08902ad03787b43b706f67e20ddcefc1b` to Android runtime `native-1.0.12-android.1`. The paired iOS record is unreachable because no compatible iOS 1.0.12 build exists; no installed iOS build received it. The production update channel was not changed.
- The connected signed Android release was Trailhead 1.0.12 build 73 on the preview channel and runtime `native-1.0.12-android.1`. Its admin-only release-identity screen showed the exact source and update ID before the preview token was issued.
- The signed-in administrator generated one short-lived exact `roaring_fork` / `one_way` link. The phone downloaded and verified preview version `1000000002`, manifest `original_preview_manifest_great_smoky_mountains_ridges_rivers_living_memory_r2`, all twenty content-addressed assets totaling 239,772,665 bytes, and the private offline map before opening the real player with `DOWNLOADED` and `SYNTHETIC GPS` status.
- Physical checks rejected the poor-accuracy sample and off-route sample without playing a story, then accepted the valid paired fix and triggered `One way from here`. Android reported the Trailhead media session in `PLAYING` state, the media stream unmuted at volume 7/15, and speaker output selected. Caption text was visible.
- Every one of the thirteen exact review rows was opened successfully. The visible device set covered all seven approved artwork identities and their intended story mappings. The local informational route matrix separately passed 13/13 scenarios, including poor-accuracy recovery and off-route rejoin; it did not call Studio trusted validation and did not control release readiness.
- The redacted evidence file has raw file SHA-256 `d5677130e3ef22379831ce0be2a9e81e3fd6e59dde7ea85cad5828d47bd7ff1f` and canonical evidence SHA-256 `f17ac77a29718cef56ccb2556e44e86800d81482fd0e9cca18acb2537722f750`. It binds preview-manifest SHA-256 `6fd609842bd454448548e3690c28c85d0acf77cc1c712c32b447ea4415bd81e2` and delivery-contract SHA-256 `9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6` without a token, link, administrator identity, or device serial.
- The production dry-run force-rehashed the exact twenty current files and found draft revision 2, thirteen narrations, seven images, 239,772,665 bytes, five hard and eight selectable stories, zero published versions, and zero trusted-validation reports. One fresh CAS marker applied the reviewed evidence; read-only verification then returned `verified_authenticated_device_preview_state` with report SHA-256 `8c4eaa210b8004327cad1316eec2eb5f7bf9020b49d85c29371c3857b57ccb06`.
- The marker did not change draft revision, manifest, profile, assets, publication state, or validation-report count. Final identities remain: base manifest `2fb77582811e28ef963f3018a8990a96612cfedee69f3b2329a73b87ac99d33a`; profiled manifest `14d83293ba3b09aad00998668311447b5224f5172e641d35163de2865e3c9eb8`; narration profile `f79b386031ca0faf6e07332e53ea037f957eb7d9871c4bbf05d5b0aff09c2af5`; validation metadata `d236deee4a079a42b4cecc6a07b57448a3ed60c8632fd5a3a6f2075ce9cac2c7`.
- After marker verification, the in-app `End private review` action removed only this R2 credential, private bundle, exact access record, offline map, staging/recovery state, audio, and synthetic-location session. The app returned to the Originals catalog; no Trailhead media session remained. The fifteen-minute stateless-token window had elapsed. No account-wide app data was cleared and the app was not uninstalled.
- Task-scoped cleanup removed all `trailhead-s4q-*` captures from the phone after their local evidence copies were hashed, both temporary APK copies, both temporary export directories, the temporary Railway registration `trailhead-codex-s4q-20260810`, and its exact private/public key files. The pre-existing Railway registration/key and unrelated local key remained unchanged. Production evidence, the marker report, both backups, and the local redacted evidence receipt were retained intentionally.
- Gate state at this checkpoint: `admin_license_attestation_complete=true`; `verified_private_upload_complete=true`; `authenticated_device_preview_complete=true`; `trusted_publication_validation_complete=false`; `public_release=false`.

### Exact next action after S4Q

1. Stop at this gate. Separately review and authorize trusted route/long-form publication validation from the current revision-2 source and exact delivery contract.
2. Treat the existing checked long-form readiness record as stale and fail-closed. Regenerate it only through the trusted validation workflow; do not edit source hashes by hand.
3. Keep public release separate even after trusted validation. Publication still requires every current route, operational, cultural-scope, and consumer-contract gate to pass for this exact manifest.

### Do not repeat after S4Q

- Do not issue another preview token, redownload the R2 private bundle, or repeat the device marker while the exact revision, evidence, and twenty assets remain unchanged.
- Do not rerun the narration-profile apply, thirteen license attestations, or private byte import, and do not replace any current narration or artwork asset while the profiled draft is attached.
- Do not treat the informational Android route matrix as trusted server validation or publication authorization.
- Do not run trusted validation, rewrite readiness evidence, publish, regenerate narration, begin another chapter, or touch Cherokee/EBCI or other culturally gated material without the separately authorized next gate.

## S4R Roaring Fork trusted route and long-form validation closeout

- Completed: 2026-08-10 local time (`2026-08-11T01:33:56Z`).
- Release branch: `release/smokies-s4m-production-20260810`.
- Guarded source commit: `111a4eb7cc8bb21ac1bbdd3418b1dbec4ca90637`; tree: `35bfc44045c479a881f4f58369c6d6805685990d`; parent: `75be5d317ddc9d49d9722cf05575d1bf09a8e30b`. The worktree was clean, pushed, and origin-equal before deployment.
- The project owner authorized this bounded gate with `do it` after S4Q. The scope was one exact trusted route/long-form report for private revision-2 `roaring_fork` / `one_way`. It did not authorize publication, another chapter, narration or artwork replacement, public route readiness, vehicle selection, or culturally gated work.
- Historical readiness V1 remains byte-identical, SHA-256 `4a0fc760fd07790785b820af06bac4e5a10e8337ad3f6257a10a3c50464c9b67`. Deterministic current readiness V2 is SHA-256 `7cf1b601d48845e3bc404a501d33a9f2c1e2567544c03347b99de0524ee923e6`; repeated generation was byte-identical and its complete trusted-source map had zero drift.
- Validation uses the source-controlled Roaring Fork network-target evidence SHA-256 `f29b9900158659dc53c15afe8d403b808b42a3bdef75f1c024232a6c683c5119`. It selects only the existing `south_tn` Valhalla area for this exact private geometry and delivery contract. The URL remains process-only; the durable report contains only the target ID and binding hashes. No access override was used, and the shared/global routing target was not changed.
- The one-chapter operational relationship is represented only through a hash-bound validation projection: the checked `foothills_parkway` alternate is omitted because that chapter is absent from R2. The strict start/publication operational validator is unchanged and still rejects this private one-chapter projection for publication.
- Stale readiness now fails before report insertion. The production operator rehashes every current asset, requires exact revision/manifest/profile/preview/metadata identities, requires zero active reports and zero existing target reports, serializes report creation under `BEGIN IMMEDIATE`, rebuilds the material under that lock, writes a same-volume redacted journal, and can recover only the sole exact target report after a lost connection. Passing evidence requires the trusted engine, empty top-level issues, one exact selection, 13/13 route scenarios, the accepted delivery contract, and the exact redacted `south_tn` target.
- Final local verification passed twenty-four operator/strict/readiness tests, sixty-two route/network/operational tests plus five subtests, and 162 broader Originals/Manifest/profile tests plus thirty-seven subtests. Python compilation, deterministic generation, repository whitespace checks, and an independent P0/P1 audit were green.
- Predeployment production readback reported SQLite `quick_check=ok`; draft revision 2; exactly twenty current assets comprising thirteen narrations and seven images; 239,772,665 aggregate bytes; zero active reports; zero Roaring Fork reports; zero published versions; and no current published version.
- The predeployment backup `/data/backups/trailhead-20260811T012506Z.sqlite3` is 1,545,691,136 bytes, 92 tables, SHA-256 `01107673d909fef244f5c8ba54cc268f2067f87788280f808e8aeab441961f05`, integrity `ok`. The immediate pre-validation backup `/data/backups/trailhead-20260811T013308Z.sqlite3` has the same byte/table counts, SHA-256 `3de196cc4f547950ac6d7c0f4fec87f50b4151e6b16c37a850bfd7f2ef84d381`, integrity `ok`.
- Railway deployment `53edb74d-253c-482a-a687-bfed92b096ff` completed with `SUCCESS`, message `smokies-s4r-trusted-validation-111a4eb7`, and image `sha256:d9352152eb040dc59d3dfb326d65fb43dfb6716736d2945abc9c21e6c513949c`. It preserved Nixpacks/build-environment V3, runtime V2, the existing `/data` volume, `/api/health`, the 300-second health window, the established start command, and on-failure/three-retry behavior. The prior deployment became `REMOVED` only after the new deployment succeeded.
- Startup completed with no traceback or failed-startup message. Five cache-busted health reads across deployment and post-validation returned HTTP 200 with `{"status":"ok","service":"trailhead"}`. Live hashes matched the committed store, validation, operational, operator, readiness V2, target evidence, and Railway configuration bytes exactly.
- The first read-only operator attempt stopped before database access because Railway SSH selected the bare system interpreter. A second read-only attempt stopped before database access because the SSH shell did not carry the explicit target bindings. Neither created a report or changed the database. Repeating with `/opt/venv/bin/python` and explicit reviewed target bindings completed the dry run and force-rehashed the exact 239,772,665 asset bytes.
- After the second backup, the operator created and synchronously executed exactly one append-only report: `original_validation_9df694c93ee9ef3809c33f451d04bf28`. Status is `passed`; `passed=true`; `current=true`; engine `original-trigger-v3`; suite `originals_virtual_route_v3`; draft revision 2; issues are empty. The redacted operator report SHA-256 is `ffbab03a0bdc839cbbdaa422a1b4910eaeb61acdc1d4102dbdc40e8d643fc059`.
- The exact pass contract is selection `roaring_fork_one_way_private_v1:one_way`; thirteen required and thirteen passed route scenarios; zero failed; delivery-contract SHA-256 `9081a647a7df0e59df4bb40506ba9bfa96c750536fb715ee31b3e9ee68ee20d6`; validation target `south_tn`; target-binding SHA-256 `41a00c67ed83bafe7355d4e1858710df38e780c2a514641e269103fdcea9104e`; target-evidence SHA-256 `2fded0c644b73a36c2efe45a0f64e6e0add551b9c5f2b81c42e73fd276a7a703`.
- Independent `--verify` replay returned the identical completed journal without creating or executing another report. Final SQLite readback remained `quick_check=ok`, zero active reports, exactly one passed/current target report, draft revision 2, twenty unchanged current assets and 239,772,665 bytes, zero published versions, and no current published version.
- Base manifest `2fb77582811e28ef963f3018a8990a96612cfedee69f3b2329a73b87ac99d33a`, profiled manifest `14d83293ba3b09aad00998668311447b5224f5172e641d35163de2865e3c9eb8`, narration profile `f79b386031ca0faf6e07332e53ea037f957eb7d9871c4bbf05d5b0aff09c2af5`, device-preview evidence `f17ac77a29718cef56ccb2556e44e86800d81482fd0e9cca18acb2537722f750`, validation metadata `d236deee4a079a42b4cecc6a07b57448a3ed60c8632fd5a3a6f2075ce9cac2c7`, asset count, asset bytes, and publication state were unchanged.
- This report completes the exact trusted private route/long-form validation run only. The live draft flag `trusted_publication_validation_complete` remains false because current-road observation, server-owned vehicle class, strict full operational relationship, route-evidence publication binding, cultural/publication scope, and the remaining publication checks were not performed. `public_release=false` remains unchanged.
- No manifest or validation-metadata write, media upload, narration generation, asset replacement, device preview, public validation, publication call, other chapter, Cherokee/EBCI, or other culturally gated action occurred.
- Task-scoped cleanup removed Railway registration `trailhead-codex-s4r-trusted-validation` and its exact local private/public key files after final readback. The pre-existing Railway registration and unrelated local key were unchanged. Both backups and the redacted production report were retained intentionally.

### Exact next action after S4R

1. Stop at this gate. Do not treat the passed private route/long-form report as publication approval.
2. A separate reviewed publication packet must resolve current official road evidence, the actual account vehicle class, strict route/operational bindings for the publication manifest, cultural/publication scope, and every remaining publication check.
3. Keep any future public-release action separately authorized and fail closed; no publication endpoint has been exercised.

### Do not repeat after S4R

- Do not create another trusted-validation report while the exact current R2 report remains passed and current; validation reports are append-only.
- Do not rewrite readiness V1, hand-edit readiness V2 source hashes, repoint the shared Valhalla service, or copy the validation-only operational projection into a publication manifest.
- Do not repeat the private import, license attestations, narration-profile apply, device preview, or device marker while their exact identities remain unchanged.
- Do not publish, regenerate narration, replace artwork, begin another chapter, or touch Cherokee/EBCI or other culturally gated material without a separately authorized gate.

## S4S Roaring Fork publication-readiness HOLD closeout

- Completed: 2026-08-10 local time. Evidence cutoff: `2026-08-11T01:46:27.738573Z`.
- Release branch: `release/smokies-s4m-production-20260810`.
- Guarded source commit: `8b0a06181d1d76640f43e09df206523e936943e1`; tree: `1d3bab630637061762b693ade16a3e554df812f9`; parent: `41aac223ab691d99ac59ecb29434668abb83426a`. The worktree was clean, pushed, and origin-equal after the evidence slice was committed.
- The project owner authorized continuation with `continue`. This bounded stage assembled and independently audited a deterministic publication-readiness HOLD packet. It did not authorize or perform a backend deployment, database access, manifest mutation, validation rerun, cultural outreach, vehicle/account inspection, or publication.
- The checked packet is `originals/smokies/roaring_fork_publication_readiness_v1.json`, 12,875 bytes, SHA-256 `81317b0bcdb052f1b9396fbe861aec20db3b72a9bd3f745ab5d88618ad58a199`. Its pinned historical-input record is 4,125 bytes, SHA-256 `555c4282a39b7f1affbcd7481645bba14649235df1d693883dd0a461b41879ec`.
- The deterministic builder is `scripts/build_smokies_roaring_fork_publication_readiness.py`, SHA-256 `c2b219489d6a60d94eab83a3fedbbeebe4b09ff73c1f5966bd1ae57ebb853562`. It is network-free and database-free, checks every input hash and publication-contract source hash, and fails closed on drift. The focused test file SHA-256 is `787939699bcca0d5ea8b8fd1903495e7895922b0f9dbb057c8fd95a93806bac1`.
- Historical S4Q/S4R/product facts are not presented as a fresh production readback. They are explicitly classified as historical and bound to immutable checkpoint commit `41aac223ab691d99ac59ecb29434668abb83426a`, checkpoint-file SHA-256 `287539d24483719c62fa5f1833b65a5a46b7512b190ccb427cd3cb113107ed26`, and the exact S4Q/S4R identities.
- The packet preserves the accepted private evidence: revision 2; thirteen narration assets; seven artwork assets; 239,772,665 aggregate bytes; the accepted profile, device-preview, and delivery-contract hashes; and S4R report `original_validation_9df694c93ee9ef3809c33f451d04bf28`, which passed 13/13 private route scenarios with no issues. It explicitly says those facts were not re-read from production and the S4R report must not be reused after any final manifest or source change.
- A bounded official NPS audit observed the alert feed at `2026-08-11T01:44:56.075769Z` and rechecked it at `2026-08-11T01:46:27.738573Z`. The response SHA-256 was `34e08ed1aa172b2ba9319568ea61f577dcf2c808163e9f7d0306d723c30ddd8e`; three active located closures and no unlocated closure were present; none intersected the forty-one exact Roaring Fork source segments. The only permitted statement is: “The current NPS road check does not list a closure for this chapter.” It is not a safety or guaranteed-open claim, expired after 1,800 seconds, is not evergreen evidence, and the response body is not represented as retained or builder-revalidated.
- The official Current Cautions and Closures page was observed with a `2026-08-06` last-updated date, newer than the checked candidate's `2026-07-31` source date and `2026-08-04` review. The existing candidate remains a pinned historical input but is not acceptable for a final publication binding without a new immutable review.
- Publication remains blocked by exactly six recorded gates:
  1. The current artifact is a private one-chapter review manifest with `source_review_required`, no route evidence, zero offline-map byte estimate, private visibility, zero-credit catalog placeholder, and only three of ten generic publication reviews complete.
  2. Official route evidence V1 is blocked and covers six variants; strict publication requires an exact one-variant Roaring-Fork evidence set.
  3. The checked operational candidate requires `foothills_parkway` as an alternate while private R2 contains only Roaring Fork, and S4R's validation-only alternate projection cannot be reused for publication. The official source also needs a new reviewed candidate.
  4. All thirteen Roaring Fork entries and seven claims are `public_record_factual`, `published_public_record`, and claim-level `not_required`; nevertheless the product-wide cultural validator has no truthful passing state for a zero-gated-claim `public_record_only` dossier. No cultural approval or public-record scope determination was invented.
  5. Published Start Tour currently reads trusted road observations only for Manifest schema V2, while this manifest is V3; a real owner-scoped saved-rig binding also remains a Start Tour gate and is intentionally absent from this packet.
  6. The generic publish path lacks the purpose-built atomic release authorization guard required by this workflow. `trusted_publication_validation_complete=false`, `public_release=false`, no separate owner release decision exists, and the publish endpoint was not exercised.
- The prior product contract remains one premium four-chapter Smokies product, Explorer-included with a 900-earned-credit permanent unlock. A standalone Roaring Fork public product is not approved by this packet; changing that scope or price requires a separate product decision.
- The cultural blocker is a product-contract/schema gap, not a request for the owner to self-approve cultural scope. No EBCI contact, reviewer recruitment, compensation discussion, Cherokee language work, culturally supplied pronunciation, or gated-content generation occurred.
- Verification passed nine packet-specific tests, fifty-two combined packet/route/operational/cultural/current-road tests, deterministic byte comparison, Python compilation, repository whitespace validation, and an independent P0/P1 audit. The audit verdict was GO for this HOLD packet and intentional NO-GO for public release.
- Gate state is unchanged: `admin_license_attestation_complete=true`; `verified_private_upload_complete=true`; `authenticated_device_preview_complete=true`; the exact S4R private report remains the historical trusted validation evidence; `trusted_publication_validation_complete=false`; `public_release=false`.

### Exact next decisions after S4S

1. Choose the public product contract: preserve the planned four-chapter, 900-credit, Explorer-included Smokies Original, or separately authorize a standalone Roaring Fork product and its final price/access copy.
2. Separately authorize a public-record publication-scope determination process. This checkpoint does not authorize contacting EBCI or any other external reviewer.
3. Only after those decisions, build the exact reviewed route/operational/cultural records, add Manifest V3 current-road support and an atomic release guard, assemble a final public manifest, and rerun exact trusted validation. Stop again before exercising the publish endpoint.

### Do not repeat after S4S

- Do not rerun the S4R private report, device preview, narration-profile apply, license attestations, or private import while their exact identities remain unchanged.
- Do not reuse the expired NPS observation as current or say Roaring Fork is safe, guaranteed open, or publication-ready.
- Do not weaken the strict alternate, route-evidence, cultural-scope, saved-rig, review, or publication-authorization gates merely to make the draft pass.
- Do not publish, deploy a release change, contact EBCI, begin another chapter, regenerate narration, or replace approved artwork without the corresponding separate authorization.

## S4T Four-chapter direction and Foothills review gate

- Completed: 2026-08-10 local time.
- Release branch: `release/smokies-s4m-production-20260810`.
- Guarded source commit: `7b37de90f8df9a5f9a04e6fda0a6fc276d4e3cd5`; tree: `54ba588148c49a71e32bbb7b30cfd7fb4bce4655`; parent: `f9faddaaba379e55681c35c53f2c39816c2401e5`. The source commit was clean, pushed, and origin-equal before this checkpoint was written.
- In task `019fe9fb-cafa-75d3-b663-1e5051731cd5`, the project owner resolved both S4S decisions: keep one complete four-chapter Smokies product, and do not contact EBCI for the exact checked public-record material. The product remains Mountain Crossing, Little River / Cades Cove, Roaring Fork, and Foothills Parkway; Explorer access is included; permanent ownership costs 900 earned credits; no standalone Roaring Fork or Foothills product is authorized.
- The current source dossier remains byte-identical at SHA-256 `8eb22ca5110f0f9a4287b8f184624348c2a2ca2dbc36e27ef59fc022057ce18f`. It contains forty-seven exact `source_verified` claims across all four chapters, all classified `public_record_factual`, collected from `published_public_record` sources, with `cultural_gate=not_required`, zero review triggers, and zero blocked entries.
- Internal determination `smokies_public_record_scope_2026_v1` is 2,251 bytes with SHA-256 `bea2ed1a3a5df0a54c7369ec3738155a5530cea93f26531959475442b9758f3d`. It binds the exact product, dossier, and sorted forty-seven-claim set. It explicitly records `external_outreach_required=false`, `external_outreach_performed=false`, and `ebci_approval_claimed=false`. It does not weaken the six standing prohibitions. Any future gated, Cherokee-language, pronunciation, sacred/traditional, direct-member, tribal-land, unpublished, or restricted claim still fails closed on the existing immutable approval path.
- Manifest V3 published Start-road observation now follows the existing V2 server-owned route-evidence/current-feed path. Only schema 2 or 3 is accepted; unavailable, stale, mismatched, unknown-variant, or disabled evidence still returns no trusted observation. The rollout default remains off, saved-rig ownership remains server-bound, and no production deployment occurred.
- Historical long-form readiness V1 and trusted-validation readiness V2 remain byte-identical at SHA-256 `4a0fc760fd07790785b820af06bac4e5a10e8337ad3f6257a10a3c50464c9b67` and `7cf1b601d48845e3bc404a501d33a9f2c1e2567544c03347b99de0524ee923e6`. Current readiness V3 is 17,407 bytes with SHA-256 `423866158fc5d1590419076a86f1632717b314c8647adfe6f604342f808abd01`; it preserves the exact thirteen-entry Roaring Fork preflight and delivery semantics while binding 148 current trusted sources, including the internal determination and the V1/V2 artifacts.
- Historical S4S HOLD packet V1 remains byte-identical at SHA-256 `81317b0bcdb052f1b9396fbe861aec20db3b72a9bd3f745ab5d88618ad58a199`. Historical real-audio characterization V1 remains byte-identical at SHA-256 `f34b7aa8df6c5270f7b93f98a5bb720cf9c95df7fc1751eaeb1c6b6899529d1b`. Their tests now treat them as immutable historical evidence and explicitly require current-source drift to fail closed instead of rewriting accepted bytes.
- The complete checked editorial inventory is seventy-seven entries: forty-five stories and thirty-two cues totaling 9,505 seconds, with eight direction overrides. All six planned route variants already have official candidate geometry. No four-chapter Manifest V3 or union offline bundle was created in this stage.
- Foothills Parkway was selected as the smallest unfinished review slice and as Roaring Fork's checked operational alternate. Its deterministic packet is `originals/smokies/foothills_parkway_review_packet_v1.json`, 55,719 bytes, SHA-256 `7a3217f0dc11c503f43ca12d82b339d5537de6365441f607eacfd7c3945ea926`. The human review sheet is 30,948 bytes with SHA-256 `aef724ffa60792be57d2efeed3668c32127518787119f31b44243f211620d240`.
- The Foothills packet binds thirteen exact source-locked scripts comprising six stories and seven cues, six exact public-record claims, seven official sources, both 50,816.7-meter directions, and exactly three reverse-direction overrides. It also binds the full-product contract and the accepted Roaring Fork R2, twenty-asset, narration-profile, device-preview, delivery-contract, and trusted-report identities without changing them.
- The two review candidates remain `candidate_only_user_visual_approval_required`: `media_fp_panorama`, 2,067,676 bytes, SHA-256 `92da599e63f7f2afabd81106d6649441b11b5406e7c94ec3ba448c643e6f19d8`; and `media_fp_engineering`, 1,650,379 bytes, SHA-256 `ed4f3bc69b7fd0f34040e3214a1633f410327c0deb3c0c04412d861760de78af`. Both are source-backed U.S. Government public-domain candidates requiring the recorded commercial notice. Both retain device metadata; the panorama also retains GPS EXIF. Neither is approved or safe for ingestion until an explicit visual decision and a later separately hashed sanitized derivative.
- The review builder is 38,412 bytes with SHA-256 `f158ddc61f3d846ddf0eb08df343eae19e4af320bb3f70e7f31ed8f59b71a655`; its focused test is 12,731 bytes with SHA-256 `f390fd86e99a5ae4121f263d8591af8d10a3ad02dcf0b3a12fbf8f09f83d1796`. The builder is deterministic, database-free, and network-free. Local evidence verification passed against two exact mirrors, while no absolute local path, username, credential, email address, or raw EXIF value is serialized in tracked output.
- Independent verification passed 157 focused checks with two expected ignored-local-audio skips, and 295 full Smokies checks with four expected skips plus four subtests. A separate root integration run passed 207 checks with two expected local-audio skips, and 61 broader Originals/admin/account-deletion checks plus ten subtests. Python compilation, TypeScript syntax, deterministic generation, source-hash checks, privacy scans, and repository whitespace checks were green. The independent P0/P1 verdict was GO for this review-only checkpoint.
- The existing generic V3 publish endpoint remains a known release blocker because it does not atomically bind the exact four-chapter/900-credit/Explorer/no-standalone contract and a separate project-owner release authorization. This branch must not be deployed or published until a dedicated exact-snapshot release guard is implemented and independently authorized.
- No EBCI or other external outreach, deployment, database access, production read, draft mutation, validation run, artwork sanitation or ingestion, narration generation, TTS/render call, upload, manifest assembly, offline-map build, or publication occurred.

### Exact next action after S4T

1. Review the thirteen exact Foothills scripts and both exact artwork candidates in `docs/originals/foothills-parkway-review-sheet-v1.md`.
2. Record explicit approve or revise decisions. Script approval does not authorize narration; artwork approval does not authorize sanitation or ingestion.
3. After those decisions, stop again before separately authorizing sanitized derivatives, a hash-bound and budget-capped James narration render, delivery planning for both directions, private upload, or trusted validation.

### Do not repeat after S4T

- Do not rewrite the public-record determination, readiness V1/V2, S4S packet, real-audio characterization, accepted Roaring Fork R2, or its twenty assets while their identities remain unchanged.
- Do not contact EBCI, invent an EBCI approval, or introduce culturally gated language, pronunciation, sacred/traditional interpretation, direct-member research, tribal-land research, or restricted knowledge under this public-record determination.
- Do not sanitize or ingest either Foothills image, render narration, create the four-chapter manifest, upload media, deploy this branch, run trusted validation, or publish until the corresponding separate gate is explicitly authorized.
