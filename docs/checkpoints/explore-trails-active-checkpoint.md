# Trailhead Explore and Community Trails Active Checkpoint

Last updated: 2026-07-30 17:54 CDT (America/Winnipeg)

## Resume protocol

Read this file before every Explore and Community Trails work session and after any context compaction.

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Verify the protected Explore index remains untouched. The current Git object is `f39f30fdbb33477dacd8fcf5016612a8729dc69e`; the accepted pre-existing file SHA-256 remains recorded in the parent Trails checkpoint.
3. Never stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, the Valhalla/Railway work, Android Auto scripts, or other unrelated dirty files.
4. Continue from **Next exact packet**. Do not restart completed Trails T1-T6, broad Map/Search/Offline crawls, NPS research, Layers, Memory Gate, Originals, Android Auto, or screenshot work.

## Baseline

- Branch: `feat/trailhead-1.0.10-overhaul`.
- Exact pre-E1 HEAD: `f12bcf0c5b05c5d205ccda184a8c642885cdd560`.
- Accepted Trail Builder source: `582d6b714f0520dfccbf60d45ad5250d9eed47d2`.
- Android paired preview: runtime `native-1.0.10-android.7`, update `019fb2a4-f690-71bd-814c-ed80e3e90cac`.
- iOS paired preview: runtime `native-1.0.10-ios.6`, update `019fb2a4-f690-7345-9dc9-7511d75b9afb`.
- Task-owned background processes: none.
- Open P0/P1 entering E1: none.

## Protected and unrelated worktree state

The following pre-existing changes are excluded from every Explore Trails commit:

- `.cursor/`
- `dashboard/explore_serving_index_v2.json`
- `docs/app-store-copy.md`
- `docker/valhalla-artifact/start.sh`
- `mobile/android/gradlew`
- `mobile/scripts/android-auto-dhu.sh`
- `mobile/scripts/install-maestro.sh`
- `mobile/scripts/maestro-config.test.mjs`
- `scripts/build_valhalla_artifact.sh`
- `scripts/build_valhalla_region_artifacts.sh`
- `scripts/probe_routing_50_states.py`
- `scripts/publish_valhalla_artifact.py`
- `scripts/run_nps_hourly_enrichment.py`
- `scripts/valhalla_artifact_bootstrap.py`

Verify `git diff --cached --name-only` before every commit.

## Fixed product decisions

- Explore exposes five primary destinations: `Trails`, `Camps`, `Parks & Land`, `Scenic`, and `Guided`. The legacy `things` key remains an internal compatibility alias and is not a visible destination.
- `Explore -> Trails` is the global trail-discovery workspace. It reuses TrailSystem V2, shared cards and sheets, Trail Builder, GPX, recording, Follow, Offline V2, and 3D preview.
- Nearby is the default when location is available. Along Trip is an authenticated route-corridor scope. Search This Area remains explicit.
- Main-list trail cards require complete source-backed geometry. Partial or point-only records remain honestly labelled map candidates.
- User routes are private by default. Unlisted sharing is revocable. Public discovery requires moderation.
- Approved community routes remain visibly separate from verified agency/Trailhead routes. Credits are awarded exactly once after approval.
- No module or destination fact is fabricated when source data is missing.

## Design references

- Figma file `FJUcMWAfsNyjsguCEp2dBe`, page `0:1`.
- Trail Discovery `779:2412`; Trail cards `514:769`; Filters `518:858`; Trail Peek `407:162`; Trail Full `520:782`; Trailhead Full `520:872`.
- Mobbin behavior references used for E1/E2: AllTrails Home `912653a9-cc16-41ff-9118-da80954e81c9`, Filtering trails `f1bb1e90-f816-4b32-a6bc-08ababeadb43`, and custom-route flows `bb422f42-4ace-4532-a3ce-54bd98c0a423`, `83bea6a7-b67c-43c7-b81d-5dff6b0189c6`.
- Figma additions must reuse the Trailhead semantic variables, Barlow Condensed headings, Inter body type, existing trail cards, condition cards, and sheet components. Remove internal design explanations, invented access copy, and generic filler.

## Baseline audit

- TrailSystem V2 and canonical discovery already exist and remain authoritative.
- Explore currently exposes a visible `Things` category in both the hero and chip row. It must become an internal alias rather than be deleted from search/data compatibility.
- Existing destination detail modules already use a source-revision registry. E1 extends this typed model instead of replacing it.
- Legacy `POST /api/trails/community` currently creates a public profile, supplies fallback prose/access values, and awards five credits immediately. It is unsafe and must become a pending-submission compatibility adapter before community discovery can ship.
- Existing Trail Builder/GPX/recording geometry is reused. No second route model or map renderer is introduced.

## E1 completion checkpoint

- Implementation commit: `9f3af8b283bf9e3cc373b8afdf52e791e937119b`.
- Protected Explore-index Git object remains `f39f30fdbb33477dacd8fcf5016612a8729dc69e`.
- Figma section `804:2554` contains the connected E1-E5 flow. Phone frames include Explore home, Nearby, Along Trip, filters, Community discovery, private route, submission status, moderation, and dark recovery. Responsive proofs are small phone `804:3690` and tablet `804:3749`.
- Explore exposes exactly five primary destinations. The legacy `things` key remains an internal alias to Scenic.
- The legacy instant-public community endpoint now creates a private owned route and immutable submitted review snapshot. It no longer inserts a public trail profile, invents access prose, or awards submission credits.
- Additive tables separate owned routes, submissions, public Community routes, and idempotent approval-credit awards.
- Existing `Trailhead community` profiles are preserved and idempotently queued for moderation. Unreviewed profiles are excluded from public verified discovery.
- Focused evidence:
  - `npm run test:explore-trails`: 6 passing tests.
  - `python -m unittest tests.test_explore_community_trails tests.test_trails_v2`: 19 passing tests.
  - `python -m unittest tests.test_backend_v110_contracts`: 17 passing tests.
  - `npx tsc --noEmit`, `npm run audit:explore`, Python compile, and whitespace checks passed.
- Open P0/P1: none in E1.
- Task-owned background processes: none.

## Next exact packet

### E2 — Trail Discovery review boundary

1. Extend TrailSystem V2 discovery with query, cursor, sort, source-backed filters, catalog lane, bounds, Nearby, and authenticated Along Trip corridor scope.
2. Implement the approved Explore → Trails list/map workspace using shared trail cards and sheets.
3. Preserve explicit Search this area, selected-route highlighting, return state, and complete-geometry list eligibility.
4. Run focused API/mobile tests and publish one Android-first preview.
5. Stop for user review before iOS or production.

## Do not repeat

- Do not rework or retest Trail Builder route shapes, Follow, recording, Offline trail packs, flyover, shared trail sheets, complete route highlighting, or accepted Android/iOS Trails behavior without new evidence.
- Do not re-open Layers, Memory Gate, Yellowstone, NPS research, Originals lifecycle, Android Auto, Camp Guide, screenshot work, or broad app crawls.
- Do not publish community routes, award submission credits, or expose unlisted/private geometry before authorization and moderation tests pass.

## E2 Android review checkpoint

- Branch: `feat/trailhead-1.0.10-overhaul`.
- Final mobile source: `926f288ecbdc5bd338ddb56150a70c4c80053d36`.
- E2 implementation source: `4e79feae81dcecdf7918aaf8ecb14b38fd97f6de`.
- Backend filter correction: `73823fa0d239c87658dd24b24743667af00ce0d3`.
- Protected Explore-index Git object remains `f39f30fdbb33477dacd8fcf5016612a8729dc69e`.
- Intentional commits exclude `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, and all unrelated files.

### Delivered behavior

- `Explore -> Trails` is a dedicated list/map workspace using the approved Trailhead system and shared TrailSystem V2 identity.
- Nearby, authenticated Along Trip, explicit Map/Search this area handoff, pagination, stable server ranking, stale-response rejection, and complete-geometry list eligibility are implemented.
- Activity, difficulty, route-shape, permitted-use, downloadable, and Verified/Community catalog filters use one full filter sheet.
- Query results use exact verified media or a clean route fallback, never generic destination photography.
- Partial and point-only records remain map candidates and do not compete in the primary trail list.
- Selecting a result opens the existing main Map, complete orange trail highlight, Trail Peek, and Trail Full sheet. No second renderer or duplicate sheet model was introduced.
- The Map handoff keeps the Explore Trails workspace mounted and focus-gates its modal, so query, filters, result identity, and workspace state return when Explore is reopened.
- Canonical query ranking no longer mixes unrelated nearby trails into a typed destination/trail search.
- Backend activity and route-shape filters normalize sourced labels such as `Hiking trail` and `Out-and-back` without rewriting the displayed source wording.

### Backend and preview identities

- Railway E2 deployment `6f46dd6a-d473-4ece-b5f3-76b5b6f80ce7` succeeded from exact clean source `4e79fea`; image digest `sha256:5ffacb2a8357aa47bee5c5260fe6bae4d428c1fc4f893b886fcbb6f0627dbdb5`.
- Railway normalization deployment `9dc5d8c7-6401-439a-ac87-62d05114b280` succeeded from exact clean source `73823fa`; image digest `sha256:e316d4a94d01ae739f015151e80fecc2336b271ca432a44ff0a646803048e5fc`.
- `https://api.gettrailhead.app/api/health` returned `ok`; Nearby pagination and map candidates passed live, Yellowstone returned canonical results, and unauthenticated Along Trip returned `401`.
- Final preview branch `preview-candidate-926f288ecbdc5bd338ddb56150a70c4c80053d36-ms7z5qhm-5a105f019dc7b9058806316f`.
- Android group `0eb68960-2100-42bd-80a9-1a494984c2dd`, update `019fb4c3-8d91-7197-b264-d74b893bafa0`, runtime `native-1.0.10-android.7`.
- Paired iOS group `e8f6a55c-3b7f-4581-81c1-cb5805d37d6f`, update `019fb4c3-8d91-76d3-919d-1936aa9ddacd`, runtime `native-1.0.10-ios.6`.
- Samsung `SM-A326U1`, build `69`, reported exact Android source/runtime/update identity. Sentry accepted Android, iOS, and web source maps before preview promotion.

### Focused verification

- Backend: 40 focused Explore Community, Trails V2, and 1.0.10 contract tests passed.
- Mobile: 10 Explore/Trail workspace tests, four Explore handoff tests, six Trail sheet-flow tests, TypeScript, copy, privacy, Explore, and whitespace gates passed.
- Android delta passed: Explore -> Trails, Yellowstone query, filter presentation, normalized Hiking results, result -> main Map -> Trail Peek -> Trail Full, canonical identity, route facts, and no blank or swapped sheet.
- Query, filters, and result state restore after returning from Map.
- No P0/P1 remains in the implemented E2 paths.

### Evidence

- Directory: `C:\Users\User\Documents\Codex\evidence\trailhead\explore-trails-e2-926f288\android`.
- Identity XML SHA-256: `6023acfd83d74e2b8e7b9b536e9bf1f74258507f4d7e13441c22aaec3ae040ae`.
- Workspace screenshot SHA-256: `5f67c3b327b0b5c4407290a36232936bd46b4356274437412f563982d90d9e2c`.
- Filter screenshot SHA-256: `35f04ed7b3c4dc85d87c2f58452f075fa2c49e50df084e61a7f68367ca3d811f`.
- Hiking correction screenshot SHA-256: `fc0f5ad2cda5b989d768c12975c3ff57cbfd95d368250263a07d84678097a1fa`.
- Trail Peek screenshot SHA-256: `d3e2c0073c8046e1bd6fa63e748267c931b269278a809ddf3416b290ab406d50`.
- Trail Full screenshot SHA-256: `d16712e72710dbe7e0b04acd9341d35718645785f6204c8f331999e5ef87a8eb`.
- Return-state screenshot SHA-256: `7f5f8b130ac0a86e7113e934aa24950e20eb04c0dd8d73adb230975eec2af0d5`.

### Open review detail and next exact action

- P2: returning from Map restores the query, filters, selected result context, and list contents, but the native modal remount currently returns the list to its first row instead of the exact prior pixel offset. It does not block discovery or sheets, but it misses the approved exact-scroll detail.
- Task-owned Metro, Gradle, Maestro, and test processes: none.
- Stop here for user review. Do not begin iOS E2 proof, E3 destination integration, private routes, moderation, production, or another OTA until the user accepts E2 or explicitly asks for the one focused exact-scroll correction.
- If accepted with the P2 deferred, next packet is E3 destination integration. If correction is requested, change only the focus-gated list restoration assertion and publish one replacement paired preview; do not repeat search, filters, sheets, Trails T1-T6, NPS, Layers, Memory, Originals, Android Auto, or broad crawls.

## E2 exact-scroll correction — 2026-07-30 16:07 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`.
- Current source: `99b00a1c1d5935bd18c2ce3e193a01afc39a53e8`.
- Protected Explore-index Git object remains `f39f30fdbb33477dacd8fcf5016612a8729dc69e`.
- Intentional commits:
  - `52f7da5ca8bb1762763220965ef9fcfe6e7e8322` protects the saved offset while the Trails workspace is hidden and retries restoration after content layout.
  - `99b00a1c1d5935bd18c2ce3e193a01afc39a53e8` retains the offset as the native list's `contentOffset` so a recreated Android Modal list starts at the saved position.
- `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, and unrelated work remained excluded.

### Replacement preview and Android evidence

- Preview source `52f7da5ca8bb1762763220965ef9fcfe6e7e8322` published successfully with Sentry source maps.
- Android group `dafd2c79-da60-454a-8a09-7c64eb7ff3dc`, update `019fb4d3-fcd2-78c6-b1fc-08772686eeaa`, runtime `native-1.0.10-android.7`.
- iOS group `b12ab6a3-1626-4afd-b706-d1159233994a`, update `019fb4d3-fcd2-7fd5-a7c8-ec4664452b16`, runtime `native-1.0.10-ios.6`.
- Samsung build 69 reported the exact source, runtime, and update identity.
- The focused Android assertion proved that query, results, and selection still restore, but the imperative scroll fired before the recreated native list had a usable content size: `Yellowstone Shortline` at `[30,522][690,846]` before Map returned to the first result afterward.
- Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\explore-trails-e2-52f7da5\android`.
- Before XML SHA-256: `23aab98a8e170c44431c41f6ce0131a6fd6deb49e4c00ef80e83092de9083752`.
- Before screenshot SHA-256: `0223bce15646019ec64a18f9ef42f12c048f1ba40cf3bf1cef002ead97ea0272`.
- After XML SHA-256: `6019a7e0e930b6e832515a06fcb51b15a3cad36c67e4267f6c4cbcde28f9769f`.
- After screenshot SHA-256: `4112159c28235123710d80afd63c523283e796ebcaf166a05f8ea507e7d41c41`.

### Current verification and forward action

- The retained native-offset correction passes Explore Trails, handoff, trail-sheet, TypeScript, copy, privacy, Explore, and whitespace gates.
- No P0/P1 is open. Exact Android scroll restoration remains pending device proof from source `99b00a1`; it will be verified once in the E3 paired preview rather than creating another isolated OTA loop.
- Task-owned Metro, Gradle, Maestro, and test processes: none.
- Next packet: E3 destination integration. Replace hub-specific trail rows with canonical Trail Discovery identities and shared Peek/Full sheets while preserving NPS, RIDB, camps, Viator, ratings, comments, reports, edits, Offline, Follow, Builder, and Flyover.
- E3 preview must include one exact-scroll regression assertion for `99b00a1` before acceptance.

## E3 destination integration checkpoint — 2026-07-30 17:54 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`.
- E3 canonical destination integration and source-panel source: `27ce8d4eebbdd505a5c02f10547c24282a72dda6`.
- Focused Android Back/source correction: `7bbcd4da00fae3d4061bf065d97ef6f5d41f6e6e`.
- Protected Explore-index Git object remains `f39f30fdbb33477dacd8fcf5016612a8729dc69e`.
- `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Valhalla work, Android Auto scripts, and every unrelated dirty file remained unstaged.

### Delivered behavior

- Destination hubs request verified canonical TrailSystem V2 items and reuse the shared Trail Discovery card, main-map highlight, Trail Peek, and Trail Full flow.
- Legacy sourced trail-area rows remain a data-parity fallback for one preview cycle and are not promoted above complete canonical routes.
- Yellowstone Overview preserves its official NPS content and 24 separately labelled guided trips.
- Yellowstone Trails opened verified canonical routes; `Boundary Trail (Xc)` opened the main Map, complete route highlight, Trail Peek, and Trail Full without a blank or swapped sheet.
- Returning to Explore restored the exact Yellowstone Trails destination context instead of opening a parallel trail surface.
- The public source panel now omits generic access/details/website/season instructions and keeps only factual publisher, checked-date, season, and source-note values.
- Android system Back now follows child detail → module → Overview → close. The explicit Close action still exits the entire hub.

### Focused verification

- `npm run test:explore-trails`: 18 passing tests across destination registry, module registry, discovery workspace, destination integration, and source-panel coverage.
- `npm run test:nps-hub-preservation`: 22 passing tests across NPS hierarchy, navigation, scroll, and explicit empty/unavailable states.
- `npm run audit:copy -- --preset explore`, `npx tsc --noEmit`, and `git diff --check` passed.
- Android Samsung `SM-A326U1`, build `69`, verified exact source `7bbcd4d`, runtime `native-1.0.10-android.7`, and update `019fb537-6493-7587-9e87-5aa57178f651`.
- Android system Back from Yellowstone Trails returned to Overview while retaining the Yellowstone hub. The prior direct-close P1 is fixed.
- Paired iOS update is published from the same source with runtime `native-1.0.10-ios.6` and update `019fb537-6493-70b6-9f45-5ce23fef6504`; physical iOS spot proof remains deferred until the iPhone is connected.
- Sentry accepted Android, iOS, and web source maps before preview promotion.

### Preview identities

- Candidate branch: `preview-candidate-7bbcd4da00fae3d4061bf065d97ef6f5d41f6e6e-ms83nrsx-b2f5ecc095bcce96a82c97e5`.
- Android group: `b97157cb-c793-4a7e-8de8-2761e16505c7`.
- Android update: `019fb537-6493-7587-9e87-5aa57178f651`.
- iOS group: `457fc663-8a23-4257-97ac-5089d75f88d5`.
- iOS update: `019fb537-6493-70b6-9f45-5ce23fef6504`.

### Evidence and defects

- Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\explore-trails-e3-7bbcd4d\android`.
- Identity XML SHA-256: `910ad659fea73998d4e140fefee2a0c80f782d659f90cf728fc12637a7467db3`.
- Trails module XML SHA-256: `6027e0595383d74b49a50ac012f74fef9bec272a7d5eaf729c275562cd6ae268`.
- Back-to-Overview XML SHA-256: `67aa8194b82f8751c7db66eac9435d5e83afe4e1ae2200f8f4243adbe09d0ddb`.
- No open P0/P1 in E3.
- P2: the Yellowstone source panel still exposes one internal `Source · Trailhead` row in the native render even though the pure presentation filter passes. Keep the evidence-backed public-source filter, remove this row at the final UI boundary in the next accepted JS packet, and verify that single assertion once. Do not publish another isolated E3 OTA for cosmetic copy.
- P2 data gap: Yosemite exact canonical boundary coverage remains incomplete; the legacy parity fallback remains enabled for one preview cycle rather than fabricating a complete route.
- Task-owned Metro, Gradle, Maestro, publisher, and test processes: none.

### Next exact packet

1. Repair the existing E4/E5 Figma prototype before implementation. Current Share and Suggest hotspots incorrectly reuse status screens, and Community/moderation cards incorrectly open the generic verified Trail Peek.
2. Add and connect the required private-route, privacy-review, unlisted-link, recipient, submission-status, Community-detail, moderator-decision, approval-credit, promotion, and takedown states using the existing warm-white/near-black/orange system.
3. Present the focused Figma delta for user approval. Do not implement E4/E5 backend or mobile flows until that design gate is accepted.
4. After approval, implement E4 private routes/sharing first, publish Android preview, and stop for review before E5 moderation.

### Do not repeat

- Do not repeat E2/E3 discovery, filter, Yellowstone search, destination trails, broad sheets, NPS research, Trails T1–T6, Offline, Layers, Memory, Originals, Android Auto, or screenshot crawls without new evidence.
- Do not expose private or unlisted geometry, publish Community routes, or award contribution credits before the E4/E5 authorization, privacy, moderation, and idempotency gates pass.
- Do not repeat E2 search ranking, filters, broad trail sheets, Trails T1–T6, NPS research, Layers, Memory, Originals, Android Auto, or broad Map crawls without new evidence.

## E4/E5 Figma design gate — 2026-07-30 18:13 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`.
- Repository checkpoint source before this documentation update: `d3d11d13e6cd502493fce5940a0d4797eb5c2e01`.
- Protected Explore-index working-file Git object remains `f39f30fdbb33477dacd8fcf5016612a8729dc69e`; its tracked baseline is `1b33aa4dee09df19a22a8a2c0134345f30881b99`.
- `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Valhalla work, Android Auto scripts, and every unrelated dirty file remained unstaged and unchanged by this packet.
- No mobile, backend, public API, native project, runtime, preview OTA, production update, entitlement, credit, or public-discovery behavior changed.

### Figma delta

- File: `FJUcMWAfsNyjsguCEp2dBe`.
- New section: `E4–E5 · Private to Published · Flow Delta` (`812:3334`).
- Added 27 connected phone states covering:
  - Private-route privacy review, start/finish cropping, unlisted link creation, immutable shared revisions, link updates, and revocation.
  - Valid, signed-out, offline, expired, and revoked recipient states.
  - Suggestion form, review, under-review, changes-requested, resubmitted, approved, rejected, withdrawn, and archived outcomes.
  - Community-route Peek (`818:3182`) and Full (`814:3348`) variants with contributor and moderation context, never a Verified label.
  - Moderator queue, duplicate comparison, access/source/photo review, decision reasons, approval confirmation, exactly-once credit receipt, Verified promotion, and takedown review.
- Repaired the existing entry points so `Share` and `Suggest as a trail` no longer jump to the same recycled status screen.
- Community discovery now follows card → Community Peek → Community Full instead of opening the generic Verified Trail Peek.
- Moderator entry points now route through queue, duplicate/evidence review, decision, and confirmation states rather than generic Trail Full.
- All new prototype hotspots were rebuilt with explicit destinations; no new frame is unlinked.
- Small-screen visual QA removed wrapped top actions, clipped filter labels, and overlapping condition-card copy.
- Copy audit found no AI labels, provider wording, confidence percentages, `safe route`, `verified access`, or generic `check local rules` text.

### References and evidence

- Approved Trailhead sources reused: Trail Discovery `779:2412`, cards `514:769`, filters `518:858`, Trail Peek `407:162`, Trail Full `520:782`, and Trailhead Full `520:872`.
- Mobbin/behavior references: AllTrails custom routes, explicit `Suggest as a trail`, Strava privacy cropping, Komoot contribution evidence, and AllTrails moderation guidance. No external branding or imagery was copied.
- Visual evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\figma-e4-e5-delta`.
- Representative screenshots cover privacy review, link ready, suggestion, submission review, approval, Community detail, Community Peek, moderator queue, duplicate/evidence review, approval confirmation, Verified promotion, and link revocation.

### Gate and next exact action

- E3 remains accepted with no open P0/P1. The native-only `Source · Trailhead` copy row remains the recorded P2 for the next accepted JS packet.
- The E4/E5 design blocker is resolved. Stop here for user review of the focused Figma delta.
- After explicit approval, implement E4 private routes and unlisted sharing first: contain legacy exposure, repair account-deletion cleanup, add rollout flags, harden geometry/revision/idempotency, implement token hashing/revocation/privacy review, then add the approved mobile flow.
- E4 receives focused tests and one Android-first paired preview. Do not begin E5 public moderation or award contribution credits until E4 is accepted.
- Task-owned Metro, Gradle, Maestro, publisher, and test processes: none.

### Do not repeat

- Do not repeat E2/E3 discovery, Yellowstone, NPS, Trails T1–T6, Offline, Layers, Memory, Originals, Android Auto, broad Map crawls, or Figma research without new evidence.
- Do not expose private or unlisted geometry, enable Community discovery from unreviewed records, create a Verified route, or issue contribution credits before the corresponding authorization, moderation, and idempotency tests pass.

## E4 private routes implementation baseline — 2026-07-30 18:21 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; exact baseline HEAD `50181933842409270897190df6e05ecaf1881c54`.
- Last paired preview remains source `7bbcd4da00fae3d4061bf065d97ef6f5d41f6e6e`, Android runtime `native-1.0.10-android.7` / update `019fb537-6493-7587-9e87-5aa57178f651`, and iOS runtime `native-1.0.10-ios.6` / update `019fb537-6493-70b6-9f45-5ce23fef6504`.
- Protected Explore-index working-file Git object is `f39f30fdbb33477dacd8fcf5016612a8729dc69e`; tracked baseline `1b33aa4dee09df19a22a8a2c0134345f30881b99`.
- Before implementation, no task-owned backend or mobile E4 file differed from HEAD. Existing `.cursor/`, Explore-index, app-store copy, Valhalla, Android Auto, and Gradle/script changes remain unrelated and excluded.
- Figma design-to-code was read from privacy review `812:3335` and link ready `812:3408`. Implementation must reuse Trailhead V2 tokens, Barlow Condensed display type, Inter body type, existing map/builder/sheet/button/card primitives, and the approved 12/16/20 radii rather than importing generated web/Tailwind code.
- Geospatial rule: privacy cropping, geometry validation, hashing, impossible-jump checks, and bounds are deterministic in-process geometric operations. No routing API is used to guess or rewrite a submitted route.

### Narrow E4 scope

1. Contain unreviewed legacy trail exposure and repair account-deletion cleanup before adding sharing.
2. Add private owned-route CRUD with owner authorization, expected revisions, idempotency, canonical geometry validation/hash, and privacy-review invalidation.
3. Add high-entropy unlisted links whose raw token is returned once, whose SHA-256 alone is stored, and whose resolver is non-enumerable and revision-pinned.
4. Add explicit privacy review, start/end cropping, metadata stripping, create/copy/update/revoke, and recipient recovery states on mobile without another map or ownership store.
5. Keep routes private by default. Do not add them to Explore, submit them for moderation, publish Community routes, create Verified routes, or award credits in E4.

### Required proof before preview

- Backend: ownership and enumeration resistance, token hashing/revocation, revision conflicts, idempotency, invalid geometry/jumps, metadata stripping contract, account deletion, legacy containment, rate limits, and feature flags.
- Mobile: local-route compatibility, privacy-review invalidation, deterministic crop, stale owner/generation rejection, signed-in/signed-out/offline/expired/revoked states, exact Back/Close restoration, and clean copy.
- Run focused backend/mobile tests, TypeScript, copy/privacy, native drift, and whitespace checks. This is expected to remain JS/backend-compatible; any discovered native requirement stops the packet before publication.
- Publish Android preview first and run only the private → privacy review → link → recipient → update/revoke delta. Publish the paired iOS update from the exact accepted SHA afterward.

### Do not repeat

- Do not repeat E2/E3 discovery, NPS, Yellowstone, Trails T1–T6, Offline, Layers, Memory, Originals, Android Auto, broad sheets, or Figma research.
- Do not weaken privacy, authorization, deletion, idempotency, or geometry checks to make a preview pass.
