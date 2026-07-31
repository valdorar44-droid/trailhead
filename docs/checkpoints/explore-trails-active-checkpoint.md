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

## E4 private routes implementation-ready checkpoint — 2026-07-30 19:09 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; pre-implementation checkpoint HEAD `e090a5936cf77e6e69ad603414113e0a3fd2429a`.
- Last paired preview remains E3: Android runtime `native-1.0.10-android.7` / update `019fb537-6493-7587-9e87-5aa57178f651`; iOS runtime `native-1.0.10-ios.6` / update `019fb537-6493-70b6-9f45-5ce23fef6504`.
- Protected Explore-index Git object remains `f39f30fdbb33477dacd8fcf5016612a8729dc69e`; working-file SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Valhalla work, Android Auto scripts, Gradle wrappers, and unrelated changes remain excluded.

### Implemented E4 behavior

- Added private owned-route CRUD for Builder, GPX, and explicitly reviewed recordings with canonical geometry, expected revisions, idempotency, owner authorization, rate limits, and `off|internal|public` staging.
- Routes remain private by default. E4 does not submit, publish, verify, expose in Explore, or award contribution credits.
- Unlisted links are revision-pinned and revocable. The 43-character bearer token is returned once, SHA-256 is the only stored form, and the raw value is absent from mutation ledgers, route snapshots, OfflineTrail files, app parameters, logs, and telemetry.
- Anonymous link resolution uses a uniform non-enumerable POST body. The HTTPS/custom-scheme fragment handoff is exact, consume-once, deduplicated, and process-memory-only.
- Privacy review uses the existing local `NativeMap`, shows route context, supports deterministic start/finish cropping, and never places private geometry in a Static Images URL.
- Recording upload copies only valid longitude/latitude. Timestamps, altitude, accuracy, speed, heading, device fields, hidden waypoints, and EXIF cannot enter the sharing payload.
- Owner remote calls bind the captured account token. Local mappings are epoch- and owner-guarded, contain no bearer token, and clear with account scope.
- Recipients open the immutable shared revision in view-only main-map state. Editing requires the explicit `Save a copy` action.
- Account deletion removes private routes, mutation ledgers, and private credits, while approved historical public snapshots are rebuilt through a strict de-identifying allowlist.
- Unreviewed and approved-Community legacy rows are excluded from every verified online reader and from default Offline V2 trail/search artifacts. Boolean trailhead coordinates are rejected.

### Verification

- Backend integration: `40 passed`, `14 subtests passed` across private routes, Explore Community containment, Trails V2, and account-deletion support.
- Mobile sharing gate: `23` focused sharing/security assertions plus Universal/App Link assertions passed.
- `npx tsc --noEmit --pretty false`, Trail Builder, Trail Follow/recording, Explore Trails, privacy controls, Explore copy audit, native-drift audit, Python compile, and `git diff --check` passed.
- Independent final security/privacy audit: P0 none, P1 none, P2 none in E4 scope.
- Native graph/config did not change; E4 remains a backend + JS-compatible preview packet.
- Task-owned Metro, Gradle, Maestro, publisher, and test processes: none after the focused runs complete.

### Exact next action

1. Commit only the named E4 backend, mobile, tests, and this checkpoint; verify the staged list excludes every protected/unrelated file.
2. Push the immutable implementation source.
3. Deploy backend compatibility with `TRAILHEAD_PRIVATE_TRAIL_ROUTES_STAGE=internal` and Community trails still off; verify health and the effective feature gate.
4. Publish Android preview first and run only: private saved Builder/GPX/recording -> privacy map/crop -> create/copy link -> recipient -> view-only Map -> save copy -> rotate/update/revoke -> invalid link.
5. Stop for user review before iOS proof or E5.

### Do not repeat

- Do not repeat E2/E3 discovery, filters, Yellowstone, NPS, Trails T1–T6, Offline inventory, Layers, Memory, Originals, Android Auto, broad Map/sheet crawls, or Figma research.
- Do not begin E5 moderation, Community public discovery, Verified promotion, or contribution credits until the Android E4 packet is accepted.

## E4 Android sharing closeout checkpoint — 2026-07-30 20:57 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; exact current HEAD `da519b373cd06d4467bd36eebc16cf4384699c39`.
- Protected Explore-index Git object remains `f39f30fdbb33477dacd8fcf5016612a8729dc69e`.
- `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, and all unrelated files remained unstaged.
- Backend compatibility remains deployed with private trail routes internal and Community publication off.

### Completed and published

- Client sharing preflight now rejects sparse routes using the server's unchanged 25 km continuity rule and gives the owner a specific Trail Builder recovery action.
- A valid 0.2 mi Builder route created a revision-pinned unlisted link, opened through the HTTPS landing page, resolved anonymously, and displayed the immutable view-only recipient state and main-map route.
- Shared-link delivery is now a process-memory state machine. Duplicate OS delivery coalesces only while pending, resolving, or focused; reopening the same link after leaving the recipient revalidates it. Raw bearer tokens are cleared at consume and are not persisted, routed, logged, or placed in telemetry.
- Preview source `ffe4e6251a17eb00c1163b6c04eeeb3f84368565` is live on Android build 69/runtime `native-1.0.10-android.7` and iOS runtime `native-1.0.10-ios.6`.
- Android update: `019fb5df-72db-7230-bf5d-566d3eff9ffb`, group `7e30c7ba-db35-4468-8b8e-688dcf203d82`.
- iOS update: `019fb5df-72db-7738-99f5-2e41aaf04081`, group `ff176349-52d6-415b-9493-71e12d6b835c`.
- Candidate branch: `preview-candidate-ffe4e6251a17eb00c1163b6c04eeeb3f84368565-ms8a8bja-ccb89fc568711416a6616372`.
- Sentry accepted Android, iOS, and web source maps before channel promotion.

### Focused verification

- `npm run test:trail-sharing`: 37 focused geometry, repository, handoff, contract, Plan, and link assertions passed.
- Shared trail sheet flow, route-plan ownership, TypeScript, and scoped whitespace gates passed.
- Android QA identity exactly matched version 1.0.10, build 69, source `ffe4e62`, preview channel, expected runtime, and update ID.
- Intentional same-link reopen returned the ready recipient instead of `Shared route unavailable`.
- Main Map rendered the exact shared route, title, compass, and view-only route state.

### Deterministic remaining P1 and correction

- On preview source `ffe4e62`, Android Back from the shared route Map returned to Explore instead of the recipient. The route and recipient cache remained correct; explicitly navigating to `/shared-trails` immediately restored the exact ready recipient.
- Cause: the tab navigator reuses its existing Map route, so `router.back()` does not guarantee that the root recipient screen is immediately underneath it.
- Evidence-backed correction `da519b373cd06d4467bd36eebc16cf4384699c39` changes only the matching shared-route Close/Back branch to `router.navigate('/shared-trails')`. The route/revision marker still prevents unrelated trails from returning there.
- The correction passed the complete focused sharing gate, shared sheet flow, TypeScript, and whitespace checks. It is committed and pushed but not republished, honoring the one-correction/no-loop stop rule after the device assertion failed.

### Evidence

- Directory: `C:\Users\User\Documents\Codex\evidence\trailhead\explore-trails-e4-ffe4e62\android`.
- Release identity XML SHA-256: `e91d1cb306bdacda1011e6a47560f52480eb17d8ea87b9cdfe1d63ef9956a482`.
- Recipient reopen XML SHA-256: `3fc6751f2a1ad3f6c893111fa66e13fd7ee8b50689e9de2530f16e6571b37fb2`.
- Shared Map XML SHA-256: `dea766c2e7423941ce46e81aa66dad2ab8607a9447ca90ea499629366de87f5f`.
- Failed Back result XML SHA-256: `ae406ee1d916800194c9c851517d5c9399713d69a0a741bf251050e5c72240cb`.
- Explicit recipient navigation XML SHA-256: `3fc6751f2a1ad3f6c893111fa66e13fd7ee8b50689e9de2530f16e6571b37fb2`.
- Evidence XML contains no raw share token. A temporary Chrome hierarchy containing the URL fragment was deleted and is not retained.

### Exact next action

1. Publish one paired preview OTA from immutable source `da519b3` with Sentry source maps.
2. On Android, rerun only shared recipient → Open on map → one Back. It must restore the exact ready recipient.
3. If that passes, verify Save a copy once, then owner Stop sharing and one revoked-link assertion.
4. Record final Android E4 acceptance and stop for user review before physical iOS proof or E5 moderation.

### Do not repeat

- Do not repeat E2/E3 discovery, Yellowstone, NPS, Trails T1–T6, Offline, Layers, Memory, Originals, Android Auto, broad Map/sheets, Figma research, or the already-passing link creation/opening assertions.
- Do not weaken geometry, authorization, token, revision, or privacy safeguards to make the preview pass.
- Do not begin E5 public Community moderation, promotion, or credits until E4 Android is accepted.
- Task-owned Metro, Gradle, Maestro, publisher, and test processes: none.
## E5 implementation pre-change checkpoint — 2026-07-30 21:14 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; repository HEAD `c93f99a5c7b95c48ec4b30f384ec114174351089`; last mobile implementation source `da519b373cd06d4467bd36eebc16cf4384699c39`.
- Paired preview published from `da519b3`: Android update `019fb5ea-41af-730e-a829-9075ddc641fb` on runtime `native-1.0.10-android.7`; iOS update `019fb5ea-41af-7681-83cf-0d020e55d2d9` on runtime `native-1.0.10-ios.6`.
- Protected Explore-index hash remains `f39f30fdbb33477dacd8fcf5016612a8729dc69e`; unrelated App Store copy hash remains `97c7734c15dde3c4617f69fa391afdbab48a1a23`. `.cursor/`, both protected files, and unrelated work remain unstaged.
- Android E4 closeout is waiting only on the connected Samsung's secure unlock. The device is USB-powered at 1%; no PIN bypass will be attempted. The focused automated sharing gate remains green.

### Accepted design and behavior evidence

- Figma file `FJUcMWAfsNyjsguCEp2dBe`, section `812:3334`, defines 27 connected E4/E5 states. Implementation anchors include Suggest form `813:2885`, Community Peek `818:3182`, Community Full `814:3348`, moderator queue `814:3421`, duplicate comparison `814:3494`, evidence review `814:3567`, decisions `814:3640`, approval `814:3713`, verified promotion `814:3786`, and takedown `814:3859`.
- The approved Community detail uses the existing Trailhead trail sheet, keeps `Community route` visibly separate from Verified, and preserves Preview, Save, Download, Report, ratings, comments, and contributor history without extra explanatory copy.
- Mobbin behavior evidence: AllTrails custom routes remain private saved routes before any contribution flow (`409abb56-0b6a-4bc7-aeac-a5b939c37c89`); concise contribution status is represented as a scannable queue row rather than a decorative success page (`f63dd033-10b3-4cd8-92d1-87e6d2dafc5c`). No Mobbin branding or imagery ships.

### Current code audit

- Existing foundations already include additive ownership, submission, Community publication, and exactly-once award tables; immutable submission snapshots; legacy Community containment; account-deletion anonymization; a `catalog=verified|community|all` discovery contract; Community filter/card styling; and a feature stage defaulting to off.
- Missing production behavior is limited to owner submission/status actions, deterministic diagnostics, moderator decisions, Community publication projection, exactly-once approval credits, takedown/restore, Verified promotion, owner/mobile status UI, and admin moderation UI.
- Public Community discovery and contribution-credit issuance remain off until the E5 authorization, moderation, privacy, idempotency, copy, and device gates pass.

### Exact next action

1. Add backend E5 lifecycle functions and focused tests without changing the native graph or enabling the public feature stage.
2. Add owner/mobile status and admin moderation surfaces by adapting the approved Figma states to existing React Native and dashboard components.
3. Complete the four remaining Android E4 assertions after the user unlocks the device, then run the bounded E5 Android delta and publish one new paired preview only when both packets pass.

### Do not repeat

- Do not repeat E1-E3 discovery, Trails T1-T6, NPS, Layers, Memory, Originals, Android Auto, broad Map/sheet crawls, Figma research, or private-link creation/opening.
- Do not expose private/unlisted geometry, publish an unreviewed route, treat Community as Verified, award credits at submission, or add generated access/safety prose.
- Task-owned Metro, Gradle, Maestro, publisher, and test processes: none.

## E5 implementation completion checkpoint — 2026-07-30 22:00 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; pre-commit repository HEAD `a54d1eb48f4b9f29b9edb499396d47f80d62a8fa`.
- Current paired preview remains the accepted E4 source `da519b373cd06d4467bd36eebc16cf4384699c39`: Android update `019fb5ea-41af-730e-a829-9075ddc641fb` on runtime `native-1.0.10-android.7`; iOS update `019fb5ea-41af-7681-83cf-0d020e55d2d9` on runtime `native-1.0.10-ios.6`.
- Protected Explore-index hash remains `f39f30fdbb33477dacd8fcf5016612a8729dc69e`; unrelated App Store copy hash remains `97c7734c15dde3c4617f69fa391afdbab48a1a23`.
- `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, and unrelated work remain excluded from the E5 commit.

### Completed behavior

- Added immutable owner contribution submissions with draft/submitted/changes-requested/approved-community/rejected/withdrawn/archived presentation, revision binding, resubmission, withdrawal, and stale owner-scope rejection.
- Added deterministic duplicate and access diagnostics, contributor-facing decisions, private moderator findings, approval-only Community publication, exactly-once five-credit awards, takedown/restore, and authoritative-source-gated Verified promotion.
- Contributor approval counts now refresh across all active Community snapshots for the same contributor.
- Owner-facing moderation history strips moderator identity and internal findings; administrators retain both.
- Added the mobile `Suggest as a trail` flow from owned routes through access/photo attestation, immutable review, submission status, changes requested, resubmit, withdraw, and new-revision recovery.
- Community catalog metadata now survives canonical conversion and hydration. Shared trail sheets show `Community route`, `Reviewed route`, `Not source-verified`, contributor handle, and approved-contribution count without treating Community as Verified.
- Added the Trail Review dashboard with queue filters, real submitted-geometry preview, duplicate/access/source evidence, separate public/internal notes, approve/request-changes/reject, Community takedown/restore, and source-gated Verified promotion.
- Public Community publication remains disabled. No native project, dependency, permission, runtime, Offline, navigation, or existing trail capability changed.

### Design and behavior references

- Figma file `FJUcMWAfsNyjsguCEp2dBe`: moderator queue `814:3421`, Community detail `814:3348`, duplicate comparison `814:3494`, evidence review `814:3567`, decision `814:3640`, Verified promotion `814:3786`, and takedown `814:3859`.
- Mobbin references were used only for moderation behavior: Circle moderation `d695963e-5465-44f1-8a86-171fd1f7c121`, Reddit queue `c20fd251-fbfe-471b-b3a4-c0175cf1ada4`, Sprout approvals `acaff017-f7dd-4611-8163-428b099a22d9`, Canny moderation `9cb38c58-98c5-4a87-b11d-19410d2ef4eb`, AllTrails custom routes `409abb56-0b6a-4bc7-aeac-a5b939c37c89`, and Grab contribution queue `f63dd033-10b3-4cd8-92d1-87e6d2dafc5c`. No external branding or imagery ships.

### Focused verification

- E5 backend moderation lifecycle: 7 tests passed, including two-route contributor-count refresh, owner/internal-note privacy, immutable approval, exactly-once credits, takedown/restore, and Verified promotion rules.
- Mobile contribution presentation and repository: 7 tests passed, including owner-scope generation guards and stale-response rejection.
- Explore/Trails focused suite: 25 tests passed.
- Preservation suite: 99 Python tests plus 37 mobile trail-sharing assertions passed across E4 private routes, Explore Community containment, Trails V2, catalog behavior, planner copy safety, and link handling.
- TypeScript, copy audit across 174 user-facing files, privacy controls, dashboard JavaScript syntax, and scoped `git diff --check` passed.
- Browser-control kernel was unavailable after a clean reset; this is a local tooling failure, not a product failure. The Trail Review dashboard still requires one visual pass against the internal deployment.
- Task-owned Metro, Gradle, Maestro, publisher, device-helper, and test processes: none after closeout.

### Open device assertions

- E4 Android closeout remains limited to: recipient Map Back restoration, `Saved to Trails`, owner Stop sharing, and one revoked-link assertion.
- E5 Android delta remains limited to: owner Suggest/submit, admin decision, Community card/sheet trust lane, ratings/comments/report action preservation, takedown unavailable, restore, and no Verified confusion.
- No product P0/P1 is open from automated verification. Device acceptance has not yet been claimed.

### Exact next action

1. Commit and push only the named E5 backend, dashboard, mobile, tests, and this checkpoint.
2. Deploy backend compatibility with `TRAILHEAD_COMMUNITY_TRAILS_STAGE=internal`; verify health and visually inspect Trail Review without enabling public Community discovery.
3. Publish one paired preview OTA from that immutable SHA with Sentry source maps.
4. Run the four remaining E4 Android assertions and the bounded E5 Android delta once, then checkpoint any deterministic failure instead of looping.
5. Stop for user review before physical iOS proof or public Community enablement.

### Do not repeat

- Do not repeat E1-E3 discovery, Yellowstone, NPS, Trails T1-T6, Offline inventory, Layers, Memory, Originals, Android Auto, broad Map/sheet crawls, Figma research, or private-link creation/opening.
- Do not expose private/unlisted geometry, publish an unreviewed route, award credits at submission, mix Community with Verified, or add generated access/safety prose.

## E5 backend deployment and preview credential checkpoint — 2026-07-30 22:40 CDT

- Immutable E5 implementation commit `936438bd350744ff8c6fc6ebe83e6f9596bc6120` is pushed.
- Railway deployment `091e9881-3c55-421a-8cd0-af0508af6128` succeeded from a clean detached `936438b` worktree. Health is green and `TRAILHEAD_COMMUNITY_TRAILS_STAGE=internal`.
- Unauthenticated live checks return `401 Authentication required` for both owner and moderator submission endpoints. Public Community discovery remains disabled.
- First guarded preview run `30601268192` reached the full pre-preview suite. All 859 backend tests and the remaining mobile/copy/privacy gates passed; Android Auto unit dependency resolution alone failed because the GitHub Mapbox Maven credential returned `401 Unauthorized`.
- A single secret-sync attempt proved the non-exportable EAS secret cannot be read outside an EAS builder. The empty GitHub replacement was removed immediately. No token value was printed, persisted, committed, or exposed to telemetry.
- Corrective preview run `30602049498` stopped at the credential presence guard before validation or publication. No EAS update group was created by either failed run.
- Mapbox DevKit confirms two account-side secret tokens with `downloads:read`, but secret values are intentionally unrecoverable. A new least-privilege `downloads:read` token must be created in Mapbox and stored as GitHub repository secret `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` before one final guarded preview run.
- No product P0/P1 was introduced. This is a CI credential blocker; production and public Community remain unchanged.

### Exact next action

1. Create a new Mapbox secret token named `TRAILHEAD_GITHUB_ACTIONS_DOWNLOAD_2026_07_R2` with only `downloads:read`.
2. Store it directly in GitHub Actions as repository secret `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`; do not paste it into chat, source, or a local file.
3. Rerun the guarded paired preview once from `936438b`, then extract Android/iOS update identities and run only the bounded E4/E5 Android delta.

### Do not repeat

- Do not rerun the 859-test gate until the GitHub credential presence and Mapbox Maven authorization are known-good.
- Do not weaken or skip the Android Auto dependency gate, reuse a public `pk.*` token for Maven, or attempt to extract the EAS build secret.

## E2/E5 bounded device audit — actionable gaps (2026-07-30 23:06 CDT)

- Branch `feat/trailhead-1.0.10-overhaul`; exact source HEAD `936438bd350744ff8c6fc6ebe83e6f9596bc6120`.
- Protected Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Valhalla work, Android Auto scripts, and every unrelated dirty file remain excluded.
- Samsung `SM-A326U1` (`RFCR408DA9B`) was connected and unlocked. This was a bounded Trail Discovery → Trail Peek → Full → 3D → Back pass, not a repeat of T1-T6, Layers, Offline, Memory, NPS, Originals, Android Auto, or broad Map testing.
- Nearby discovery truthfully withheld partial/point-only records from the primary list, but its count read `113 trails` while no complete-route card was available. The state needs an honest map-record label rather than implying 113 list-ready routes.
- Query `Yosemite` returned distant trail-name matches such as `Yosemite Border` instead of offering Yosemite as a destination scope. The mobile workspace currently sends only `q`; the existing `destination_ref` contract is not used by the backend. The approved Trail Discovery contract requires explicit destination/park selection without automatically opening a result.
- Selecting complete route `Yosemite Border` opened the shared Peek and Full sheet, and 3D Preview followed the exact route with the yellow finish diamond. Back restored the same Peek. However, the ordinary selection remained over the prior Manitoba/Canada viewport until Preview; the resolved-route focus command is being superseded or missed.
- Peek and Full repeat the generated fact sentence `1.6 miles. Point-to-point. Moderate. Hiking trail.` alongside the same structured metrics; Peek clips it and Full repeats it again under Route facts. This is redundant source-derived filler, not useful trail description.
- Android full-sheet overflow showed only `Build route`, `Download for offline`, and `Preview in 3D`. Source inspection proves the other handlers are constructed after those entries, but React Native Android alerts expose at most three buttons. `Report`, `Suggest edit`, `Official website`, `Share`, and `Refresh details` are therefore unreachable. Replace this native alert with the approved controlled Trailhead action sheet; do not change the action layout concept.
- Evidence SHA-256: Nearby state `e41e87fd5b4dfd5ea4782bf16ce3374c6f32cc2a44a20c55aa3a81e9a8fae523`; Yosemite results `88386e512e0f63a12776c0e0d873b2eb6f252a149f7a9b7973dc7f2fcd9ac429`; Peek `0a144595ed2a4df3c9aaec9aadff53e5b638b186463a54e5595becab3e0cfeb6`; Full `7befe6b482a8e8559742c15f3f039c4ed9fe502da67bf74c64ea68418ff24080`; 3D `305ec2edd6d026543e32357cf85d25cd77901136739e9f245223709134f5e45c`.
- Design authority remains Figma Trail Discovery `779:2412`, Trail Peek `407:162`, Trail Full `520:782`, and Trailhead Full `520:872`. Existing AllTrails/Mobbin references remain behavioral evidence only; no new visual departure or external imagery is planned.

### Exact next action

1. Add explicit Search V2 destination suggestions to Trail Discovery. Selecting a destination freezes its canonical/temporary identity and coordinates for the trail request; typing alone never changes map scope or opens a result.
2. Make the backend honor `destination_ref` and scoped center/bounds, while retaining canonical Trailhead trail ordering and Mapbox suggest/retrieve session rules.
3. Replace the Android three-button alert with a controlled, scrollable Trailhead action sheet containing every available descriptor and stable test ID.
4. Remove fact-only generated trail summaries when they merely repeat structured metrics. Preserve genuine editorial/source description.
5. Fix one resolved-route camera ownership boundary, then run only Yosemite destination → route card → Peek/Full → every available action → 3D Back and map restoration.

### Do not repeat

- Do not reopen accepted Builder, GPX, trail-pack, Follow, recording, flyover playback, yellow finish marker, Trailhead sheets, or broad Search/Map audits.
- Do not fabricate complete geometry, destination facts, access, comments, ratings, or source content. Do not auto-select a destination or trail.
- Do not rerun the guarded 859-test preview gate until the GitHub Mapbox Maven credential is known-good.

## E2/E5 destination and sheet-action completion checkpoint — 2026-07-30 23:35 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; exact implementation commit `3d6305667929ba19840c05192fc4ea8837c18b6f`, pushed to `origin/feat/trailhead-1.0.10-overhaul`.
- Baseline checkpoint commit: `ed1f814e`; previous immutable E5 backend source: `936438bd350744ff8c6fc6ebe83e6f9596bc6120`.
- Current installed paired preview is still the accepted E4 source `da519b373cd06d4467bd36eebc16cf4384699c39`: Android update `019fb5ea-41af-730e-a829-9075ddc641fb` on runtime `native-1.0.10-android.7`; iOS update `019fb5ea-41af-7681-83cf-0d020e55d2d9` on runtime `native-1.0.10-ios.6`.
- Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. User-owned App Store copy SHA-256 is `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. `.cursor/` and both files remain unstaged and untouched.

### Completed behavior

- Trail Discovery now offers explicit Search V2 destination suggestions. Selecting a park, city, or destination freezes its stable identity and coordinates, scopes trail discovery there, preserves server ordering, and never auto-opens a destination or trail.
- Canonical destination references now resolve server-side against Explore profiles before trail discovery. Temporary Mapbox results remain explicit client-selected scope and are not persisted as canonical trails.
- Nearby counts now distinguish complete list-ready routes from honest map-only records instead of labelling every partial record as a trail.
- The Android three-button native overflow is replaced by the controlled, scrollable Trailhead action sheet. Every capability-backed action is reachable: 3D preview, Offline, Add to trip, Build route, Report, Suggest edit, official website, Share, and Refresh.
- Fact-only generated summaries that merely repeat structured distance, route shape, difficulty, or activity are removed. Genuine editorial/source descriptions remain.
- Selecting or clearing a route closes stale action presentation and keeps one identity-bound sheet flow.
- Camera audit correction: `openTrailFeature` already issued the single shared `focusMapSelectionPoint` command. No duplicate camera command was added; the earlier device observation was caused by the older installed preview and remains a narrow post-OTA assertion.
- No visual departure from approved Figma nodes Trail Discovery `779:2412`, Trail Peek `407:162`, Trail Full `520:782`, and Trailhead Full `520:872`. No new Figma approval is required for this behavior-only repair.

### Focused verification

- Backend Trails V2: 22 tests passed, including canonical destination resolution and summary preservation/omission.
- Explore Trails mobile suites passed: discovery helpers 7, destination registry 3, module registry 3, workspace 7, summary presentation 3, sheet flow 8, integration 4, and source panel 4.
- Search V2 suites passed: presentation 11, persistence 19, routing 4, and session behavior 41.
- Sheet action/coordinator tests passed: 6 action assertions and 2 coordinator assertions.
- TypeScript `npx tsc --noEmit`, copy audit across 175 user-facing files, privacy controls, and `git diff --check` passed.
- No native project, dependency, permission, runtime, Offline store, trail geometry, Follow, recording, flyover, or existing sheet capability changed.

### Backend deployment

- Railway production deployment `38ff9b3d-8783-48d1-a032-f2fc2701e137` succeeded from clean detached source `3d6305667929ba19840c05192fc4ea8837c18b6f`.
- Deployed image digest: `sha256:2bfb36a53eec78f694bf37509bbc790d93d09c34a6b20aec4cb5891f0736bcc3`.
- Railway internal health check passed and `https://api.gettrailhead.app/api/health` returned `{\"status\":\"ok\",\"service\":\"trailhead\"}`.
- Public Community publication remains disabled/internal; the additive endpoint change does not expose unreviewed routes.

### Remaining acceptance and exact next action

- Source and backend verification show no open product P0/P1. The new mobile behavior has not yet reached a preview OTA, so device acceptance is not claimed.
- Preview publication remains externally blocked by GitHub repository secret `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`. Create one new Mapbox secret token with only `downloads:read` and store it directly as that GitHub Actions secret; do not paste it into chat, source, logs, or a local file.
- Once the credential is known-good, run the guarded paired preview exactly once from `3d6305667929ba19840c05192fc4ea8837c18b6f`, preserving Sentry source-map publication and the Android Auto dependency gate.
- Android delta after OTA: Explore → Trails → type Yosemite → explicitly select the destination → verify scoped route/map records; open one complete trail through Peek and Full; confirm no duplicated fact summary; scroll through every safe More action; verify 3D Back and resolved-route framing. Then perform the shared iOS spot check from the identical SHA.
- E4/E5 owner/moderator device assertions remain separate and bounded as previously recorded; do not blend them into another broad Trails crawl.

### Do not repeat

- Do not repeat Trails T1–T6, E1/E3 research, broad Search, Yellowstone, NPS, Offline inventory, Layers, Memory, Originals, Android Auto, full Map/sheet crawls, Figma research, or the 859-test gate before the credential is valid.
- Do not weaken the Android Auto/Mapbox Maven gate, use a public `pk.*` token for Maven, auto-select destinations, fabricate complete route geometry, or expose Community as Verified.
- Task-owned Metro, Gradle, Maestro, publisher, test, and device-helper processes: none. Railway deployment is complete and no local process remains running.

## E2/E5 final paired-preview device checkpoint - 2026-07-31 01:44 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; exact tested HEAD `35d8608814097aad38929d9cc001439648970ba7`, pushed to `origin/feat/trailhead-1.0.10-overhaul`.
- Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`. User-owned App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. `.cursor/`, `dashboard/explore_serving_index_v2.json`, and `docs/app-store-copy.md` remain unstaged and untouched.
- The replacement Mapbox token `TRAILHEAD_GITHUB_ACTIONS_DOWNLOAD_2026_07_R2` was created with only `downloads:read` and stored directly as GitHub repository secret `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`. Token metadata ID is `cms8gqmel0dtv2wogun0d5e48`; the token value was never printed, persisted, committed, screenshotted, or added to telemetry.
- Railway remains healthy on deployed backend source `3d6305667929ba19840c05192fc4ea8837c18b6f`. No backend change followed the accepted destination/sheet-action deployment.

### Paired preview identity

- Guarded GitHub preview run `30609257206` passed in 18m36s from immutable source `35d8608814097aad38929d9cc001439648970ba7`.
- Candidate branch: `preview-candidate-35d8608814097aad38929d9cc001439648970ba7-ms8kebwj-7f1121572b8657b593aea91f`.
- Preview channel ID: `019dbc97-3cde-795b-a35d-e6aa985060d3`; promotion branch ID: `019fb6e3-ef8e-7e1a-9b88-309d21d131f1`.
- Android group `7d9cbe9d-0a85-4ab0-8d9d-28413583a4c6`, update `019fb6e4-0703-77b1-9f01-37d2a932cd29`, runtime `native-1.0.10-android.7`.
- iOS group `8c28dbdd-b4f2-45f5-9087-4d2cf01c5bee`, update `019fb6e4-0703-7593-82e7-384144d8798c`, runtime `native-1.0.10-ios.6`.
- Samsung `SM-A326U1` (`RFCR408DA9B`) reported app `1.0.10`, build `69`, preview channel, full source SHA `35d8608814097aad38929d9cc001439648970ba7`, Android runtime `.7`, and the exact final update ID above.

### Focused corrections and verification

- Commit `7197355201f399a73e7c0435382c92c389ea67cc` removes repeated bike-trail metric summaries without removing genuine editorial/source descriptions.
- Commit `a1f3ca39807272e8d8a4807c15a3261bb8c1473e` captures renderer-live viewport bounds before entering 3D instead of relying only on stale React viewport state.
- Commit `35d8608814097aad38929d9cc001439648970ba7` gives an actively selected, identity-matched trail route `route_review` camera ownership while retaining ordinary browse rendering and pins.
- Focused `test:explore-trails`, `test:trail-preview`, and TypeScript `npx tsc --noEmit` passed before final publication. The guarded preview additionally passed the complete protected pre-preview suite and Sentry source-map delivery.
- Android final assertion passed: Explore -> Trails -> explicit `Yosemite National Park` destination -> `Spur From 19E58` immediately framed the actual resolved route, retained the shared Peek/Full sheet, and showed the clean nonduplicated source facts.
- Android final assertion passed: the controlled More sheet exposed Preview in 3D, Download for offline, Build route, Report, Suggest edit, Share, and Refresh details. No native three-button truncation remained.
- Android final assertion passed: 3D used the actual 0.9-mile route, deterministic progress, the approved finish marker, and the existing main-map renderer.
- Android final assertion failed: `Back` from 3D restored the correct Full sheet and trail identity but returned the camera to a broad Wyoming viewport instead of the exact route-framed Yosemite viewport. This is an unresolved P1. Per the bounded no-loop rule, no fourth speculative OTA was created.
- iOS received the exact paired update but has not received this packet's physical spot check. Do not claim iOS acceptance yet.

### Evidence

- QA identity: `C:\\Users\\User\\.codex\\tmp\\qa-35d8608.png`, SHA-256 `5d289a80369cefBDD1c43e24bb658eefc94df22900d1bb3a6fa27e3731f378bd`.
- Resolved-route framing pass: `C:\\Users\\User\\.codex\\tmp\\trail-framed-35d8608.png`, SHA-256 `5d98ba639db77abafB27368e446d4c180e9c1506ac707c7b75259a548c81ace2`.
- Full-sheet pre-preview state: `C:\\Users\\User\\.codex\\tmp\\trail-full-final.png`, SHA-256 `097ae84a271d92d7b5fcf1358cf5b04d9a302859f3304b6e1aec5b6c902f3ba2`.
- Deterministic 3D route: `C:\\Users\\User\\.codex\\tmp\\trail-3d-final.png`, SHA-256 `3d8bce43b642323a6c7cf1cac7f16b3f03cd87870b31c2b98ab650cdbecca372a`.
- 3D Back camera failure: `C:\\Users\\User\\.codex\\tmp\\trail-back-35d8608.png`, SHA-256 `2e5ce692b80f88bb75f8abcc45768fad642a24fd88c8c9c7414e4e0a8257722d`.

### Exact next action

1. Treat 3D Back restoration as one isolated P1. Inspect the captured live bounds and the subsequent camera-owner command sequence once; determine which identity writes the broad Wyoming bounds.
2. Add a deterministic camera-command regression assertion before changing source. Apply one evidence-backed correction, publish one paired preview, and rerun only Preview in 3D -> Back from the already-scoped Yosemite trail.
3. After that assertion passes, perform the shared iOS E2/E5 spot check from the identical SHA and close the packet. Only then begin E4 private-route sharing and E5 moderator-state device assertions.

### Do not repeat

- Do not repeat destination search ranking, route cards, Peek/Full hydration, More-action reachability, Trails T1-T6, Builder, GPX, Offline, Follow, recording, Yellowstone, NPS, Layers, Memory, Originals, Android Auto, broad Map/sheet crawls, Figma research, or the protected suite before source changes.
- Do not auto-select destinations, fabricate geometry/access facts, expose Community as Verified, weaken the Mapbox credential gate, or create another speculative camera OTA.
- Task-owned Metro, Gradle, Maestro, publisher, tests, Railway deploys, and device-helper processes: none. Four Codex-owned MCP `node ./mcp/server.cjs --stdio` processes remain and must not be stopped. The Android ADB server is the only device transport still running.

## Trails production closeout — exact-preview return-context correction (2026-07-31)

- Timestamp: `2026-07-31T11:41:20-05:00`.
- Branch: `feat/trailhead-1.0.10-overhaul`; pre-change HEAD `da8e202402049e23d3a3a80fb97e7e7a0bcb603f`.
- Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. Those files, `.cursor/`, Valhalla work, Android helper mode changes, and unrelated dirty files remain excluded.
- Exact Android preview identity was verified before the bounded assertion: version `1.0.10`, build `69`, source `da8e202402049e23d3a3a80fb97e7e7a0bcb603f`, runtime `native-1.0.10-android.7`, update `019fb77d-5dae-7d10-87f2-e3bf6f365af0`.
- The single manually adjusted Yosemite assertion proved the final camera ownership behavior: `Spur From 19E58` remained selected and the adjusted resolved route viewport returned after 3D. It also exposed one adjacent deterministic return-context defect: opening 3D from Trail Full through the controlled More sheet returned to Peek rather than the invoking Full presentation.
- Evidence: `C:\Users\User\Documents\Codex\trailhead-evidence\release-manual-pan-back-da8e202.png`, SHA-256 `865ae323f3f30e8706d60f8f547924f71b026f015d46dbfb7681e4afce770f6e`.
- Evidence-backed correction: capture the coordinator's current presentation before dismissing the More sheet, pass it into `openTrailPreview`, and store that explicit value in the preview return context. This avoids a modal-dismiss transition rewriting the invoking presentation while preserving every Peek, Builder, camera, and Close path.
- Focused Trail Preview tests pass `7/7`; TypeScript completed without diagnostics. A paired preview OTA and the single Full -> More -> 3D -> Back assertion remain before the production freeze.
- User authorized exactly two new production builds after this assertion: one Android AAB and one iOS IPA. Because Apple production is `1.0.10`, the paired store candidate advances to `1.0.11`; Android may jump from its older public version. No production OTA is published to incompatible older runtimes.

### Exact next action

1. Commit only the map return-context fix, focused test, and this checkpoint.
2. Publish one paired preview OTA from the immutable correction SHA and rerun only Trail Full -> More -> 3D -> Back on Android. Perform the paired iOS spot only if the device is available; automated shared coverage remains required either way.
3. If the exact assertion passes, create a clean `1.0.11` release commit and run the release/native gates once.
4. Start exactly one Android and one iOS production build from that identical SHA. Record build IDs, remote numbers, runtimes, fingerprints, artifact hashes, and store-install evidence before any submission or production OTA.

### Do not repeat

- Do not repeat destination search, Peek/Full hydration, actions, Builder, GPX, Offline, Follow, recording, flyover playback, E4/E5 lifecycle, NPS research, Layers, Memory, Originals, Android Auto, broad Map/sheet crawls, or Figma work.
- Do not build from the dirty feature worktree, weaken native/runtime gates, backport the native-dependent Trails packet to production `.3`, or spend either production build before the exact return assertion passes.

## Trails production closeout — exact preview exposed stale sheet-stage ownership (2026-07-31)

- Paired preview source `1942d06cbf6db4e9de16335286b72070d9c23518` published successfully through the guarded local publisher after isolated dependency installation, Expo export, Sentry source-map upload, server-owned update inspection, and atomic preview-channel promotion.
- Android update `019fb91f-9a69-79cf-bf64-f0944c5057c8`, group `d431e61a-d671-4cd1-b31c-1be623c89958`, runtime `native-1.0.10-android.7`.
- iOS update `019fb91f-9a69-7141-b86b-e820096adab2`, group `132395bc-bf66-4b50-bef0-4b0c45d10f24`, runtime `native-1.0.10-ios.6`.
- Samsung identity passed: app `1.0.10`, build `69`, preview channel, exact source and Android update above.
- The bounded Full -> More -> Preview in 3D -> Back assertion proved that route identity, orange geometry, finish marker, and camera restoration were correct. It also reproduced one remaining P1: the sheet returned to Peek.
- Deterministic cause: the More menu is rendered only from Trail Full, but its preview callback derived the return presentation from a coordinator ref that can lag behind a native drag transition.
- Evidence-backed correction: the More-menu 3D action now records `full` directly as its invoking presentation. Direct Peek preview and Trail Builder preview paths retain their existing independent return semantics.
- Focused Trail Preview tests pass `7/7`; TypeScript and named-file whitespace checks pass.
- Failed preview evidence: `C:\Users\User\Documents\Codex\trailhead-evidence\trail-back-full-1942d06.png`, SHA-256 `452eaac25d7efa9c3826f59a9a3b98847942a98033236e25a7edc22c36bb430a`.

### Exact next action

1. Commit the constant Full return contract, focused regression assertion, and this checkpoint only.
2. Publish one paired preview OTA from that immutable SHA and rerun only Full -> More -> 3D -> Back on Android.
3. If Full, route and camera restore together, freeze the clean paired `1.0.11` release source and run the release/native gates once before the authorized Android AAB and iOS IPA builds.

### Do not repeat

- Do not repeat Trails discovery, destination selection, Peek/Full hydration, action reachability, route resolution, flyover playback, Builder, GPX, Offline, Follow, recording, NPS, Layers, Memory, Originals, Android Auto, or broad Map crawls.
- Do not infer Full from asynchronous sheet state again; the controlled More menu owns that return contract.

## Trails production closeout accepted — Android exact assertion (2026-07-31)

- Accepted source: `c9c81988d14096697eddaf95204eab6e64078b54`, pushed to `origin/feat/trailhead-1.0.10-overhaul`.
- Paired preview publication passed with Sentry source maps and atomic channel promotion.
- Android update `019fb92d-a890-7a24-848c-a73efac5fc7f`, group `be3a56df-fe0f-4962-b6c4-da198a90cd46`, runtime `native-1.0.10-android.7`.
- iOS update `019fb92d-a890-7de3-9aa7-71fb909cc8af`, group `9bca76b5-ac6c-4919-b873-80320a5106c5`, runtime `native-1.0.10-ios.6`.
- Samsung identity passed on app `1.0.10`, build `69`, exact source and update above.
- Bounded Android assertion passed: Trail Full -> More -> Preview in 3D -> Back restored the Full sheet (`1`), no Peek sheet (`0`), the same More action (`1`), the resolved route, camera, and finish marker (`1`).
- Evidence: `C:\Users\User\Documents\Codex\trailhead-evidence\trail-back-full-c9c8198.png`, SHA-256 `5bd9066fc51e02f90686e522b02fb6de04355d8f7bb5a81bb1abc9848743afb4`.
- Open Trails P0/P1: none. Trails are frozen for the paired `1.0.11` store candidate; no completed Trails crawl is reopened before store-candidate smoke testing.

### Exact next action

1. Create a clean `release/trailhead-1.0.11` worktree from this accepted checkpoint.
2. Normalize app version `1.0.11` and paired runtime suffix `.1`, update guarded native-drift expectations, and run the release/native/pre-preview gates once.
3. Commit and tag the immutable release SHA, then start exactly one Android production AAB build and one iOS production IPA build from it.
4. Record EAS build IDs, remote build numbers, runtimes, source SHA, and artifact hashes before resuming NPS/USFS/BLM data-depth work.

### Do not repeat

- Do not repeat the 3D Back assertion, Trail discovery, sheets, Builder, GPX, Offline, Follow, recording, Flyover, Layers, Memory, Originals, or Android Auto before the built-candidate smoke test.
- Do not include uncommitted NPS candidates, the protected Explore serving index, App Store copy, `.cursor/`, or unrelated dirty files in the release source.

## Explore data-depth safety checkpoint — 2026-07-31 12:52 CDT

- Feature branch: `feat/trailhead-1.0.10-overhaul`; exact pre-checkpoint HEAD `bd9a1fbe338491e7ca9910db63cf2fd9071f8f6f`.
- Frozen release branch: `release/trailhead-1.0.11`; immutable tag `v1.0.11`; source `0f7431d32088405f4c381ed1a220fcb2169ec761`.
- Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. Neither file, `.cursor/`, nor unrelated dirty work is part of this packet.
- Task-owned local Metro, Gradle, Maestro, test, and publisher processes: none. Two remote EAS production builds are the only active release jobs.

### Paired 1.0.11 production-build status

- iOS production build `712109e9-6b7f-4f72-ab51-2aa42a6095da` finished from exact release source `0f7431d`. Marketing version `1.0.11`, build `62`, runtime `native-1.0.11-ios.1`.
- Downloaded IPA: `/tmp/trailhead-release-artifacts-1.0.11/trailhead-ios-1.0.11-build62.ipa`; `69,859,852` bytes; SHA-256 `9ca83267c03fc0fafa8664593e98645481b57ac0addd5ea5f9bbcf4861c4b3f1`.
- Android production build `723dca56-01a3-416b-a22d-98c838a849ee` remains in the Expo queue. Marketing version `1.0.11`, version code `70`, runtime `native-1.0.11-android.1`, exact source `0f7431d`.
- Do not start a replacement build, publish a production OTA, or submit either artifact until the Android build finishes and the paired artifacts are checked.

### NPS candidate-safety tooling

- `scripts/run_nps_hourly_enrichment.py` now enforces a source-controlled maximum of 700 NPS HTTP requests per invocation, supports a zero-request cache-only rebuild, and writes only to isolated candidate directories under `data/explore/audit_candidates/nps/`.
- Candidate paths are rejected if they resolve inside `dashboard/`. The live serving index is never written by the enrichment runner; reviewed promotion remains a separate intentional action.
- Candidate audits cover schema, stable IDs, duplicate park codes and name/location pairs, HTTPS official URLs, source licenses, media attribution, freshness, module coverage, artifact byte sizes, and SHA-256 hashes.
- Generic NPS fallback prose is omitted when no official description exists. Nested pass records are parsed instead of discarded.
- `python -m unittest tests.test_nps_hourly_enrichment`: 10 passed. Combined Explore-source and enrichment suite: 43 passed. Named-file whitespace checks passed.

### NPS depth results

- Cache-only baseline candidate `local-20260731-final` passed with 729 total places, 474 NPS places, 500 source records, 7 trail geometries, and 3,097 attributed media items.
- Two live Railway-backed batches completed under the 700-call per-run cap: batch 1 used 339 requests for 28 parks; batch 2 used 308 requests for 27 parks. Cumulative requests were 647, rich-cache coverage increased from 5 to 60 parks, and 414 parks remain.
- Latest isolated candidate `live-20260731-b02` is `promotion_ready: true` with no errors or warnings. It contains 729 places, 474 NPS places, 500 source records, 7 trail geometries, and 3,746 attributed media items.
- Rich modules increased from baseline to latest candidate: Things to See `617 -> 1,783`; Things to Do `263 -> 771`; campgrounds `62 -> 177`; alerts `21 -> 135`; visitor centers `45 -> 151`; events `177 -> 664`; parking `49 -> 167`; guided items `30 -> 132`; passes `5 -> 26`.
- Latest candidate artifact hashes: catalog `5a29390154c8edf6f72eacd97fdc3bb3423a4beeaac1a65397faad0dccb80a7f`; source records `f190d6f61041a05509d8bf31ffeea4e778cd63fc031ddf48b0d8c54976a030f8`; trail geometries `6325f3db6ddea71bcce70fcb91bbc8773a01d3fc11259f2d8d0ee52703a94772`.
- Candidate promotion is intentionally withheld until manual duplicate, exact-image identity, licensing, freshness, and module-coverage review. No candidate data has replaced the user-owned serving index.

### Exact next action

1. Commit and push only the NPS importer, candidate runner, regression tests, and this checkpoint.
2. Audit the existing Sierra/USFS and Moab/BLM fixtures/adapters, then generate isolated pilot candidates with source, duplicate, licensing, imagery, and real-module coverage reports.
3. Continue monitoring the already-running Android build. When it finishes, download the AAB, compute its SHA-256, and record both paired artifacts. Do not spend another build if it fails; checkpoint the exact failure.
4. Keep nationwide NPS continuation resumable. Do not promote the latest candidate until its manual review is complete, and do not exceed the source-controlled API budget.

### Do not repeat

- Do not repeat Trails T1-T6, 3D Back, destination search, shared trail sheets, Builder, GPX, Offline, Follow, recording, Layers, Memory, Originals, Android Auto, broad NPS research, or the protected pre-preview suite without new evidence.
- Do not write candidates into `dashboard/`, auto-stage generated candidate data, fabricate agency modules, merge Community and Verified trails, or start additional native builds.

## Sierra USFS and Moab BLM isolated pilot checkpoint — 2026-07-31 13:21 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; pre-change HEAD `211246ea5acc39c5941b5f293a185e30c3988fe2`.
- Frozen paired release remains `release/trailhead-1.0.11`, tag `v1.0.11`, source `0f7431d32088405f4c381ed1a220fcb2169ec761`.
- Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. Neither file, `.cursor/`, Valhalla work, Android helpers, nor unrelated mode-only changes are part of this packet.

### Paired production-build status

- The single authorized iOS build remains finished: EAS `712109e9-6b7f-4f72-ab51-2aa42a6095da`, version `1.0.11`, build `62`, runtime `native-1.0.11-ios.1`. IPA SHA-256: `9ca83267c03fc0fafa8664593e98645481b57ac0addd5ea5f9bbcf4861c4b3f1`.
- The single authorized Android build remains queued: EAS `723dca56-01a3-416b-a22d-98c838a849ee`, version `1.0.11`, version code `70`, runtime `native-1.0.11-android.1`, fingerprint `04839b31d3b43d2eaaf2348ec46846358b142c3a`.
- No replacement build, store submission, or production OTA was started.

### Agency adapter and candidate work

- Official USFS and BLM ArcGIS fields now import case-insensitively. Dataset-qualified Global/Object IDs preserve feature grain; connected route segments continue through the existing TrailSystem V2 grouping rather than corrupting source identity.
- Unknown permitted use remains empty. The adapters no longer default an unknown route to hiking and no longer generate generic `verify local rules` summaries.
- Exact agency site types now map to supported capabilities: USFS visitor/fee stations, observation and interpretive sites, picnic/boating/fishing/day-use sites, OHV staging, and BLM parking, boat ramps, toilets, visitor centers, trail heads, access points, primitive camps, staging, and scenic sites.
- MultiPolygon representative points are supported for official land-unit and recreation-area boundaries.
- `scripts/build_explore_agency_pilots.py` fetches ArcGIS pages with a source-controlled 60-request ceiling, writes only below `data/explore/audit_candidates/`, supports zero-request rebuilds from captured source fixtures, and refuses dashboard output.
- The builder records reviewed source metadata, exact agency attribution, stable record IDs, artifact sizes and SHA-256 hashes, data-quality findings, and an explicit `live_serving_index_modified: false` assertion.
- Raw route segments are grouped with the existing `build_trail_systems_v2`; no parallel trail identity or discovery engine was created.

### Live candidate and data-quality result

- Live source pull used 10 of 40 allowed requests and captured 1,347 official features: Sierra boundary `1`, Sierra trails `686`, Sierra recreation sites `219`, Moab BLM point sites `108`, polygon sites `11`, mountain-bike opportunities `3`, mountain-bike routes `45`, managed public trails `248`, recreation areas `1`, and featured sites `6`.
- Final isolated candidate: `data/explore/audit_candidates/agencies/live-20260731-b04`.
- Normalized output: 1,281 source records, 1,121 places, 901 source route segments, and 668 TrailSystem V2 route systems.
- Sierra hub candidate: 13 scenic/interpretive places, 38 source-backed activities, 3 visitor-information sites, 120 camp/stay records, and 533 trail systems.
- Moab BLM hub candidate: 27 scenic/interpretive places, 2 source-backed route activities, 5 visitor-information sites, 42 camp/stay records, 18 parking records, and 135 trail systems.
- Data-quality gate reports zero errors and `promotion_ready: true`. Review warnings remain intentionally visible: 10 named `45 CUT OFF` route variants, 17 trails with permitted use not listed, and 2 near-duplicate place pairs. No missing fact was guessed to eliminate a warning.
- Final hashes: source records `28d8bfc75296212b6786e1bfeeec3b67dd825f06b5c79830d0917296273d8730`; places `3eccca40e187d5ef8cab2d68cb944bafa10b251cb6c40ecb554b0cfb631ad7b4`; source route segments `e7fd4c9e52a4a76df92077eaa0ddfbdd9a2596fb1e6abdf0ed66567b8cea394a`; TrailSystem V2 systems `2659df549f807748146feec371208fb3420157286b547eb9596a502982bccd4f`; destinations `06cc747a8192240fbe19b010f7dc0de163209ca741e7de0b5c8f981288ffca73`; audit `ab05affedff86466d7b5c3d68666e497d5c1186bee95a567fb63f88ee8fcd5ab`.

### Focused verification and exact next action

- `tests/test_explore_agency_pilots.py`, `tests/test_explore_sources.py`, and `tests/test_trails_v2.py`: 71 passed. Python compilation and named-file whitespace checks passed.
- Exact next action: commit/push only the two agency adapters, shared MultiPolygon normalization, isolated builder, focused tests, and this checkpoint. Keep the candidate out of the live serving index until the 10 route variants and 2 duplicate place pairs receive an intentional review.
- After that review, merge the accepted agency destination packs through the existing serving-index promotion path, run the bounded Android destination hub → module → child → shared sheet → map → Back delta, and spot-check the identical source on iOS.
- Continue the resumable nationwide NPS batches separately; do not blend NPS promotion with the USFS/BLM pilot review.

### Do not repeat

- Do not repeat Trails T1–T6, 3D Back, Trail Builder, GPX, Offline, Follow, recording, Flyover, broad Search, NPS research, Layers, Memory, Originals, Android Auto, or the protected pre-preview suite.
- Do not auto-promote this candidate, fabricate permitted use or editorial modules, replace TrailSystem V2, stage the protected serving index/App Store copy, or start another native build.
- Task-owned Metro, Gradle, Maestro, publisher, and test processes: none. The remote Android EAS build is the only active task process.

## Agency pilot review closeout — 2026-07-31 13:25 CDT

- Pre-change HEAD `4890dbc8777f48f31b8390b62f85b19c4fd560c8`; protected Explore-index and App Store copy hashes remain unchanged.
- The two candidate duplicate pairs were not duplicate places: each was a named BLM site colocated with its own parking or restroom record. The isolated builder now attaches those agency amenities to the named place and retains both source IDs instead of publishing competing cards.
- Official USFS names such as `45 CUT OFF T1` through `T9` are source-owned branch names, not opaque route numbers. The technical-name check now blocks compact codes such as `21E242` and `Forest Road 5S30` without suppressing those named branches.
- Final candidate is `data/explore/audit_candidates/agencies/live-20260731-b06`: 1,281 source records, 1,117 places, 901 segments, and 668 TrailSystem V2 systems. It reports zero errors and one honest warning group: 17 USFS trail segments whose permitted use is not listed. Those routes retain an empty activity instead of an inferred use.
- Final hashes: source records `b122ff5e8bfbcc425e6d181d0f50d4318e744ca6f869a5e3c20dde1db989710d`; places `091a88e223331b58021d913714d5a81b391a0c8a8090a6b1ba6730c890d2d495`; source segments `e7fd4c9e52a4a76df92077eaa0ddfbdd9a2596fb1e6abdf0ed66567b8cea394a`; TrailSystem V2 systems `2659df549f807748146feec371208fb3420157286b547eb9596a502982bccd4f`; destinations `dadeb0dca343deadccedcd141e8b826c9579619a866958e6b06409d09afb48d1`; audit `8a812c05808acb1569b25e4b7e51e511430d198ff3f502f3a3dbb8f65b163a90`.
- Focused agency test suite: 18 passed after the review correction; the preceding full agency/source/TrailSystem suite passed 71 tests.
- Exact next action: intentionally map this accepted candidate into the existing serving-index promotion inputs without overwriting the user-owned live index, produce a diff/report for Sierra and Moab, then request/perform the bounded Android Explore review before live promotion.
- Do not repeat the source download, adapter audit, duplicate review, route-name review, or any completed Trails packet.
