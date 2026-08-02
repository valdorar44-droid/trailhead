# Trailhead Explore and Community Trails Active Checkpoint

Last updated: 2026-08-01 19:47 CDT (America/Winnipeg)

## Current continuation pointer

Read [`explore-b08-quality-closeout-and-nps-depth.md`](./explore-b08-quality-closeout-and-nps-depth.md)
first. Production OTA and matching Railway backend deployment are complete at
release source `c1155793`. The cached b08 agency quality packet is closed with
no P0/P1 and no provider requests. Continue only with NPS Child Depth Batch 1;
do not repeat release work, candidate rebuilds, or completed crawls.

## Resume protocol

Read this file before every Explore and Community Trails work session and after any context compaction.

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Verify the protected Explore index remains untouched. The current Git object is `f39f30fdbb33477dacd8fcf5016612a8729dc69e`; the accepted pre-existing file SHA-256 remains recorded in the parent Trails checkpoint.
3. Never stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, the Valhalla/Railway work, Android Auto scripts, or other unrelated dirty files.
4. Continue from **Next exact packet**. Do not restart completed Trails T1-T6, broad Map/Search/Offline crawls, NPS research, Layers, Memory Gate, Originals, Android Auto, or screenshot work.

## Implementation checkpoint — b08 operational r8 internal candidate — 2026-08-01 13:38 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; implementation commit `d79ecf121e2abeeffd93b2738492e3b01fd03bb9` (`feat(explore): validate b08 operational preview`). Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. `.cursor/` and both protected files remain unstaged.
- This packet used only cached accepted source objects. It made zero NPS, RIDB, USFS, BLM, Mapbox, or other provider requests and did not overwrite the public serving index.
- Accepted agency candidate: `live-20260801-b08-operational-r8`, manifest SHA-256 `5be23a802d14e17be42ad779b9fee2dc7367ec91a56191464f147401c5a5dcc2`. Accepted combined candidate: `combined/live-20260801-b08-operational-r8`, manifest SHA-256 `c0bb0cb923ff1879f4fac76a68cd6ea60dfc46fbf22aa86ac4b16a01e1b627fe`.
- The combined review contains 993 catalog records and 5,435 serving records. Five spatially matched RIDB campground records were replaced by richer USFS records while preserving both source identities; match distances are 8.4 to 43.4 meters. The internal preview sidecar contains 13 reviewed records at SHA-256 `0ce3990f83178c980d740d55c139164070804166f8e40a56f698df5fc9d3656a`.
- Source-backed USFS facts now preserve site type, people capacity, fee, operating season and hours, water, restrooms, rules, phone, official source, and only direct Recreation.gov campground booking links. People capacity remains distinct from campsite count; missing facts remain absent.
- The cached NPS media gate reviewed 133 selected images. Eighty-six exact, traceable NPS-credited images are approved for the internal candidate and 47 third-party, restricted, ambiguous, AI-modified, or insufficiently evidenced images are stripped. Text fallback remains valid when media rights are not proven.
- Promotion remains structurally closed: `catalog_gate_passed` records deterministic schema/source/media checks, while `promotion_ready` remains false. The internal sidecar still requires internal stage, authenticated administrator access, and `X-Trailhead-Explore-Preview: internal`; the header alone is never a credential.
- Verification passed: 179 focused backend/data tests, 15 expected warnings, four subtests; Python compilation; TypeScript; copy/privacy/NPS preservation audits; deterministic r8 rebuild/hash comparison; and `git diff --check`. An independent code audit found no P0/P1 blocker.
- Existing mobile preview identities are unchanged because this is backend/data-only: Android update `019fbc54-2510-7741-9c6b-b2e00c5be503`, runtime `native-1.0.10-android.7`; iOS update `019fbc5c-65fe-721a-ab3a-02b5d0d35d77`, runtime `native-1.0.10-ios.6`.
- Open P0/P1: none in automated validation. Internal backend deployment, live authorization-boundary proof, and the bounded Android destination/campground delta remain pending. P2: the combined candidate retains a cosmetic historical `r2` catalog label even though all authoritative revision/hash bindings are r8.
- Task-owned Metro, Gradle, Maestro, test, EAS, Railway, and recording processes: none.

### Next exact action

1. Commit and push this checkpoint without staging protected or unrelated files.
2. Deploy exact committed backend/data source to the internal environment and verify terminal deployment state, `/api/health`, authenticated admin plus preview-header access, and rejection of header-only access.
3. Run one bounded Android delta: Sierra National Forest, Moab BLM, one rich NPS destination, one sparse NPS destination, and the five reviewed campgrounds through hub -> module -> child -> shared sheet -> map -> Back.
4. If Android passes, perform only the equivalent shared iOS spot check. Stop after internal b08 acceptance; do not promote publicly or fetch b09.

### Do not repeat

- Do not refetch b06 or b08, spend provider quota, rebuild historical candidates, repeat broad NPS/Explore/Map/Trails crawls, or reopen closed campground crash work without new evidence.
- Do not publish an OTA or native build for this data-only packet. Do not change public Explore stages, production catalogs, Community-route exposure, advertising, or store assets.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, or unrelated worktree files.

## Forward checkpoint — b08 operational depth and promotion safety — 2026-08-01 11:23 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; starting HEAD `e6c145fa7ee13ffc78497b7541b5d8013a54129b`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. `.cursor/` and both protected files remain unstaged.
- Accepted inputs remain NPS `live-20260731-b08`, agency `live-20260731-b08-quality-r2`, and combined `combined/live-20260731-b08`. No NPS, RIDB, USFS, BLM, Mapbox, or other source request is authorized in this packet.
- The existing 13-place internal sidecar passes its deterministic QA at SHA-256 `875d8da7f90563b2c6103e3b129667645463b14f24642b9f9b87a6649a5fe804`. The five RIDB-to-USFS campground replacements are spatially consistent within 44 meters and retain both source identities.
- The read-only data audit found one concrete operational loss boundary: the cached USFS records contain site type, people capacity, fee text, operating season, water, restroom, official-page, and Recreation.gov booking facts, but the importer does not carry those fields into `ExplorePlaceV3`. `build_planning_facts()` also reads `reservations.reservation_url` while current records write `reservations.url`.
- The wider combined candidate still references the older `live-20260731-b08-quality` agency revision. It is not eligible for promotion until rebuilt immutably from `b08-quality-r2` and checked for reader-facing region/status/copy parity.
- Media remains internal unless rights are explicit. NPS states that material credited to an entity other than NPS must not be presumed public domain; RIDB terms also require source integrity. This packet adds promotion evidence rather than treating blanket placeholder licenses as approval.

### Exact packet

1. Preserve source-backed campground operational facts through the USFS importer, generic enrichment facts, stored campground detail, and the existing sheet contract. Keep people capacity distinct from campsite count.
2. Align internal-preview defaults and a new immutable combined review with `b08-quality-r2`; never overwrite the protected serving index.
3. Add deterministic gates for source revision/hash parity, nested HTTPS/host safety, exact media-rights state, AI-modified-media exclusion, and reader-facing agency geography/copy.
4. Rebuild only from cached accepted inputs, run focused backend/mobile/data-quality tests, and use one bounded Android campground/destination delta if automated gates pass.

### Do not repeat

- Do not refetch NPS batches 1-8, Recreation.gov, USFS, BLM, Mapbox, or any provider. Do not repeat the closed Devils/Watchman/Kirch/Portal crash crawls.
- Do not change public Explore stages, promote the candidate, publish production OTA, expose Community routes, or touch store submissions in this packet.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, or unrelated files.

## Current continuation — campground gallery P1 closed on Android

- Branch: `feat/trailhead-1.0.10-overhaul`; implementation commit `2b12925f1e805fe6e4ce37694cd581cb67369e64` is pushed. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. `.cursor/` and both protected files remain unstaged.
- The existing signed-in Sentry event `TRAILHEAD-MOBILE-2` supplied the decisive symbolicated stack. `TypeError` originated at `mediaUrl()` in `mobile/app/(tabs)/map.tsx:645`, called from the legacy campground photo gallery at source line `30470`. Recreation.gov supplies photo records as objects, while that gallery passed each record to a string-only URL helper and invoked `startsWith()` on the object. The fixed phase `map_camp_peek_render` was coarse because the hidden legacy Full modal rendered alongside Peek.
- The correction routes campground gallery values through the existing `campPhotoUrl(unknown)` boundary in both Map and Route Builder. This is the same demonstrated unsafe expression in both flows; no Mapbox renderer, style, camera, native project, API, schema, catalog, or permission change was needed. A source-contract regression test prevents either gallery from returning to the unsafe call.
- Focused verification passed: `test:campground-brief` (29 subtests across its four files), `test:sheet-actions`, `test:search-v2`, `test:telemetry`, `test:privacy-controls`, `audit:copy`, `npx tsc --noEmit`, and `git diff --check`.
- Android preview update `019fbc54-2510-7741-9c6b-b2e00c5be503`, group `d57d36f8-3dde-4f10-aa80-a9b3e46515f7`, runtime `native-1.0.10-android.7`, Sentry debug ID `d3704ddd-c591-4bfe-b657-f5da743fe7df`, is bound to exact source `2b12925f1e805fe6e4ce37694cd581cb67369e64`. Samsung `SM_A326U1`, app `1.0.10`, build `69`, verified that exact identity.
- The bounded Android delta passed. Canonical RIDB `Devils Garden Campground` and `Watchman Campground` each opened a stable Peek and Full sheet, displayed their real Recreation.gov photo and source content, retained the selected identity, and produced zero React Native JS errors. No `Map unavailable`, blank frame, sheet swap, or retry flash occurred.
- Paired iOS preview update `019fbc5c-65fe-721a-ab3a-02b5d0d35d77`, group `d8d21749-54b3-4df4-aeb7-5ae72c43a763`, runtime `native-1.0.10-ios.6`, Sentry debug ID `1cc4edc1-2c64-4ad9-a316-b22a49e4f7c3`, was published from the identical source. The physical iOS shared assertion remains pending until an iPhone is attached; no republish is required.
- Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\camp-devils-2b12925f`. Key SHA-256 values: QA identity `f2db3cb8b5a808e0229a8ce1cd47b955e81fbada0233abaf0f0f6118d4b24edf`; Devils Peek hierarchy `79b7b033d314e2e58f60bafad2d5ce443f2dca844df08ea25d07942943c921d1`; Devils Full screenshot `cd2947d80c57429ef845807d1f410e99515c1829ca7b9f562345a846ceb564d0`; Watchman Peek hierarchy `061c962ed9abafa67755ae8a25c24961eb0cf5f17edb300f7a078db4ba1f95bb`; Watchman Full screenshot `f44d01a1b08126c5780529c1c0cc1e69516d51881d750a29701ae0d474860c50`.
- Open P0/P1 for this campground packet: none on Android. Task-owned EAS, Expo, Metro, Gradle, Maestro, test, Railway, and recording processes: none after publication.

### Next exact packet

1. Run the single shared Devils Garden Peek-to-Full assertion on the already-published iOS update when an iPhone is attached; do not publish again.
2. Resume the separate Explore data-depth/data-gap queue from accepted b08 artifacts. Audit missing campground fields and destination-module coverage without refetching completed NPS batches or changing the protected serving index.
3. Keep production OTA, public catalog promotion, Community-route exposure, and public feature stages separate until the next packet is accepted.

### Do not repeat

- Do not repeat the Sentry diagnosis, primitive Peek extraction, nullable-array normalization, Devils/Watchman Android delta, Portal/Kirch crawl, broad Explore/Map/Trails work, Memory, Layers, NPS research, Originals, Android Auto, or store work without new evidence.
- Do not change Mapbox code for this closed defect: the symbolicated stack proved it was a media-shape boundary, not a renderer/camera/style failure.
- Do not overwrite or stage `dashboard/explore_serving_index_v2.json`, `.cursor/`, `docs/app-store-copy.md`, or unrelated worktree files.

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

## Agency destination-hub serving candidate — 2026-07-31 13:43 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; pre-change HEAD `5de1b746f3c714599b21ba8b96ac0e3d76b4e239`.
- Frozen paired store source remains `0f7431d32088405f4c381ed1a220fcb2169ec761`, tag `v1.0.11`.
- Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. Neither file nor `.cursor/` is staged or modified by this packet.

### Paired production-build status

- iOS build `712109e9-6b7f-4f72-ab51-2aa42a6095da` remains finished: version `1.0.11`, build `62`, runtime `native-1.0.11-ios.1`, source `0f7431d`. IPA SHA-256 `9ca83267c03fc0fafa8664593e98645481b57ac0addd5ea5f9bbcf4861c4b3f1`.
- Android build `723dca56-01a3-416b-a22d-98c838a849ee` is `IN_PROGRESS`: version `1.0.11`, version code `70`, runtime `native-1.0.11-android.1`, source `0f7431d`, fingerprint `04839b31d3b43d2eaaf2348ec46846358b142c3a`.
- Exactly two authorized builds exist. No replacement build, store submission, production OTA, or public feature-stage change was started.

### Serving candidate and child-sheet integration

- Deterministic zero-request rebuild: `data/explore/audit_candidates/agencies/live-20260731-b08`; official fixtures reused from accepted `b06` source capture.
- The public standalone catalog contains only records that pass both reusable enrichment and canonical serving gates: 106 agency places plus Sierra National Forest and Moab BLM destination hubs. Serving rejections: `0`.
- The 1,011 sparse/source-only place records remain available inside typed destination modules instead of receiving generated summaries or competing as organic cards. Missing permitted use remains unknown.
- Trail data remains in the existing TrailSystem V2 path: 901 source segments grouped into 668 stable trail systems.
- Sierra hub: 13 scenic/interpretive items, 38 source-backed activities, 3 visitor-information sites, 120 camps/stays, and 533 trails.
- Moab BLM hub: 27 scenic/interpretive items, 2 source-backed route activities, 5 visitor-information sites, 42 camps/stays, 16 parking items after amenity reconciliation, and 135 trails.
- Hub summaries and planning facts are sourced from the official USDA Forest Service Sierra recreation page and BLM Moab Field Office page. The former generic `verify local rules` Sierra copy is replaced in the isolated candidate only.
- Source-pack sanitization now omits weak or missing child descriptions instead of manufacturing generic instructions. Exact IDs are reconciled before name/location deduplication, allowing the official Sierra hub revision to replace its existing compatibility ID.
- Explore destination campground children now hand off to the shared campground sheet with stable identity, source, official/reservation URLs, site type, amenities and exact media. Other source-pack children retain the shared place handoff.

### Candidate evidence

- Candidate catalog SHA-256 `49ff9be12f10469ef0ccc7b0d64e4c8e5fe46d73ed5fa5573259b286cc66cc08`.
- Candidate serving-index SHA-256 `57b21166af6252ec57486b5dc3a981cf3ce0c9e5ee04b184dc6491fb56f2d716`.
- Merged serving review SHA-256 `1a2d294ac577b6939be119cda92135355480972e95ff97f7fca31a675e349190`.
- Promotion review: current `5,336`; candidate `108`; merged `5,435`; `107` added, `1` replaced (`place:usfs:9006`); gate passed; live index untouched.
- Focused backend/data tests: `54` passed. Mobile child-handoff tests: `2` passed. Full Explore Trails tests passed. TypeScript completed without diagnostics. Named-file whitespace check passed.

### Exact next action

1. Commit and push only the named agency serving, content-quality, child-handoff, tests and this checkpoint.
2. When the running Android build finishes, download the AAB, hash it, and record paired artifact evidence. Do not start another build.
3. Stage the `b08` catalog and TrailSystem artifacts for an internal backend/data preview without modifying the protected bundled serving index. Run Sierra/Moab hub -> module -> child -> campground/place/trail sheet -> map -> Back on Android.
4. Promote only the device-accepted catalog revision through the intentional serving-index process; keep Community trails internal and keep NPS continuation separate.

### Do not repeat

- Do not repeat Trails T1-T6, 3D Back, Builder, GPX, Offline, Follow, recording, Flyover, Layers, Memory, Originals, Android Auto, source downloads, duplicate review, broad NPS research, or the protected pre-preview suite.
- Do not weaken the organic serving gate, generate descriptions for sparse agency records, expose raw route segments, overwrite the protected serving index automatically, submit stores, or start another native build.
- Task-owned Metro, Gradle, Maestro, publisher and local test processes: none. The remote Android EAS build is the only active task process.

## Nationwide NPS resumable batch 3 — 2026-07-31 13:48 CDT

- Starting point: 60 rich-cache parks and 414 remaining. One bounded batch selected 28 new park codes and used 327 of the hard 700-request cap.
- Candidate: `data/explore/audit_candidates/nps/live-20260731-b03`; 88 parks now have rich cached source packs and 386 remain.
- Candidate audit: `promotion_ready: true`, zero errors, zero warnings. The Explore QA matrix passed and 57 focused official-place tests passed.
- Module growth from NPS candidate `b02` to `b03`: Things to See `1,783 -> 2,386`; Things to Do `771 -> 977`; campgrounds `177 -> 212`; alerts `135 -> 164`; visitor centers `151 -> 204`; events `664 -> 935`; parking `167 -> 193`; guided items `132 -> 175`; passes `26 -> 30`.
- Artifact hashes: catalog `ba8fac2f133ccc3defb953ecbc165f60ee90b40255f3aa2a579cb82d609d7309`; source records `c380e34f1d33a99b0cedf8b6a9a31a39d01c730760e98347ee1a5180ce0ffda9`; trail geometries `75f1a22791d1d644d9f101eab4e9a4aef0249984fbb8b87d0bec4e6d9b94e9c4`; audit `734304af4c911f1800974a0bf3de3ff3deb454271326bdf6b23c1cd28788cd99`.
- The NPS key was read into process memory from the already-authenticated Railway production environment, passed only to WSL for this command, and was not printed or stored in the repository.
- Live Explore catalogs and serving index remain unchanged. Continue from this cache in the next bounded batch; do not refetch the completed 88 parks.

## Paired 1.0.11 production artifacts complete — 2026-07-31 14:03 CDT

- Frozen release source remains `0f7431d32088405f4c381ed1a220fcb2169ec761` on `release/trailhead-1.0.11`, tagged `v1.0.11`. Both store artifacts were built from this identical source.
- Android production build `723dca56-01a3-416b-a22d-98c838a849ee` finished successfully: version `1.0.11`, version code `70`, runtime `native-1.0.11-android.1`, fingerprint `04839b31d3b43d2eaaf2348ec46846358b142c3a`.
- Downloaded AAB: `/tmp/trailhead-release-artifacts-1.0.11/trailhead-android-1.0.11-vc70.aab`; `161,466,191` bytes; SHA-256 `0cc5b90c1722f8a2df93be9dd8e8ed7939511395ea8baee0d0e40fe8d177c08e`.
- iOS production build `712109e9-6b7f-4f72-ab51-2aa42a6095da` remains finished: version `1.0.11`, build `62`, runtime `native-1.0.11-ios.1`.
- Downloaded IPA: `/tmp/trailhead-release-artifacts-1.0.11/trailhead-ios-1.0.11-build62.ipa`; `69,859,852` bytes; SHA-256 `9ca83267c03fc0fafa8664593e98645481b57ac0addd5ea5f9bbcf4861c4b3f1`.
- Exactly the two authorized production builds were consumed. No replacement build, store submission, production OTA, public feature-stage change, or live data promotion was started.

## Nationwide NPS resumable batch 4 — 2026-07-31 14:03 CDT

- Starting point: 88 rich-cache parks and 386 remaining. One bounded batch selected 28 previously untouched park codes and used 325 of the hard 700-request cap.
- Candidate: `data/explore/audit_candidates/nps/live-20260731-b04`; 116 parks now have rich cached source packs and 358 remain.
- Candidate audit: `promotion_ready: true`, zero errors, and zero warnings. The Explore QA matrix passed and 57 focused official-place tests passed.
- Module growth from NPS candidate `b03` to `b04`: Things to See `2,386 -> 2,982`; Things to Do `977 -> 1,136`; campgrounds `212 -> 276`; alerts `164 -> 196`; visitor centers `204 -> 239`; events `935 -> 1,088`; parking `193 -> 269`; guided items `175 -> 218`; passes `30 -> 37`.
- Candidate now contains 4,387 attributed media items. Artifact hashes: catalog `f02b211bbf4d7e9d51c41de55ed1d5499a55713be90a3a77e80ae232e0534cd3`; source records `7460ec22a0e8b3873688729c1776a0da7b565c0a3d333751e0cddd6386ce7f0b`; trail geometries `793d73b462a84418426de39b3babf3b644eaf09b9e601ca2e4715fbfc19bcb4b`.
- The NPS key was read into process memory from the authenticated Railway production environment and was neither printed nor written to the repository.
- Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Live Explore catalogs and the serving index remain unchanged. Do not refetch the completed 116 parks.

### Exact next action

1. Commit and push this checkpoint only; keep protected and unrelated files unstaged.
2. Stage the accepted Sierra/USFS and Moab/BLM `b08` catalog plus the NPS candidate behind an internal backend/data-preview path without mutating the bundled serving index.
3. Run one bounded Android destination flow for Sierra and Moab and a sparse/newly enriched NPS park: hub -> module -> child -> shared sheet -> map -> Back.
4. Promote only device-accepted data through the intentional serving-index process. Keep Community trails internal.

### Do not repeat

- Do not start another native build, submit stores, publish a production OTA, or refetch the 116 completed NPS parks.
- Do not repeat Trails T1-T6, 3D Back, Builder, GPX, Offline, Follow, recording, Flyover, Layers, Memory, Originals, Android Auto, or broad Explore/NPS research without new evidence.
- Task-owned Metro, Gradle, Maestro, publisher, test, and enrichment processes: none.

## Internal Explore data-preview implementation — 2026-07-31 14:28 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; pre-change HEAD `ea672d9`. Protected Explore-index and App Store copy hashes remain unchanged.
- Added a bounded reviewed sidecar, `dashboard/explore_internal_preview_v1.json`, containing exactly five proof destinations: Sierra National Forest, Moab BLM, Carlsbad Caverns, Catoctin Mountain Park, and Channel Islands National Park.
- Sidecar size is `1,446,869` bytes; SHA-256 `7592f36bf3ec656075b69381d8ac00a45ed0c4bdae267b2d4abd1484258e838a`. It is reproducible from accepted agency candidate `b08` and NPS candidate `b04` through `scripts/build_explore_internal_preview.py`.
- Backend preview data is request-scoped. It activates only when `TRAILHEAD_EXPLORE_DATA_STAGE=internal`, the request carries `X-Trailhead-Explore-Preview: internal`, and its bearer token resolves to an administrator. The header is not a credential; non-admin and unsigned requests continue to receive the ordinary catalog.
- The mobile preview header is compiled only when `EXPO_PUBLIC_EXPLORE_DATA_PREVIEW=internal`. It is attached only to authenticated `/api/explore/` calls, not other APIs.
- The public catalog cache, bundled serving index, Community-trails stage, normal clients, and production binaries are unchanged.
- Real-artifact smoke passed: Sierra ranked first for its exact query, and the Moab BLM hub exposed 27 scenic items, 42 camps/stays, and 135 stable TrailSystem routes.
- Focused verification passed: 30 Python Explore/NPS tests, 20 agency tests, 4 preview/handoff mobile tests, full Explore Trails, full NPS hub preservation, TypeScript, Python compilation, and whitespace checks.
- No P0/P1 is open in the internal-preview implementation.

### Exact next action

1. Commit and push only the server, mobile header, reviewed sidecar, builder, focused tests, and this checkpoint.
2. Deploy the backend compatibility change from a clean exact-source worktree and enable only `TRAILHEAD_EXPLORE_DATA_STAGE=internal`.
3. Publish one Android preview OTA from that exact source with `EXPO_PUBLIC_EXPLORE_DATA_PREVIEW=internal`; do not publish iOS yet.
4. Run the bounded Samsung Sierra, Moab BLM, and one NPS proof-park flow. If accepted, publish the identical source to iOS preview and then consider intentional data promotion.

### Do not repeat

- Do not mutate or stage `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, `.cursor/`, or unrelated work.
- Do not submit the 1.0.11 artifacts, publish a production OTA, enable public Community routes, or promote the data sidecar before Android review.
- Do not repeat completed Trails, Layers, Memory, Originals, Android Auto, or broad NPS/search crawls.

## Internal Explore device-preview blocker — 2026-07-31 15:29 CDT

- Branch target: `feat/trailhead-1.0.10-overhaul`; exact mobile source `365bc78e04fb6b0359fd82589f8f126262f3bc6e`.
- Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. Neither file nor `.cursor/` was staged.
- Railway deployment `7e8e65ea-4abf-4b2b-b038-2305d9bb2757` is healthy with `TRAILHEAD_EXPLORE_DATA_STAGE=internal`; the deployed sidecar exists at `1,446,869` bytes.
- A temporary Railway SSH key was registered solely to inspect the running container and was removed immediately after the probe.
- An in-container authenticated HTTP probe proved the server path works: catalog `trailhead-explore-serving-v2-internal-preview`, total `5,327`, with `place:blm:moab-field-office` first.
- Android preview build `69` installed update `019fb9d9-6fd4-7134-9e14-c1f8dd069d16`, group `2e895ab4-1832-47bc-9fca-cb3f132589f1`, runtime `native-1.0.10-android.7`, exact source `365bc78`.
- The mobile fixes wait for auth hydration, pass the active token explicitly, make the first server page authoritative, prevent internal review data from entering the ordinary cache, and recognize the verified Expo `preview` channel. Focused preview, Explore Trails, NPS preservation, account-scope, copy, and TypeScript checks pass.
- The Samsung still renders the ordinary `416 places` Parks & Land catalog. Because the exact update, admin-only backend response, server artifact, and feature stage are all independently proven, the remaining internal mobile handoff is checkpointed as unresolved rather than retried again.
- No public catalog, production OTA, store submission, public feature stage, or Community-trails stage changed. iOS remains on update group `9bca76b5-ac6c-4919-b873-80320a5106c5`; it was not advanced to an unaccepted source.
- Frozen production artifacts remain complete and unchanged: Android AAB build `723dca56-01a3-416b-a22d-98c838a849ee` (version code `70`, SHA-256 `0cc5b90c1722f8a2df93be9dd8e8ed7939511395ea8baee0d0e40fe8d177c08e`) and iOS IPA build `712109e9-6b7f-4f72-ab51-2aa42a6095da` (build `62`, SHA-256 `9ca83267c03fc0fafa8664593e98645481b57ac0addd5ea5f9bbcf4861c4b3f1`). Exactly two production builds were used.
- Task-owned Metro, Gradle, Maestro, publisher, enrichment, and test processes: none.

### Exact next action

1. Do not publish this source to iOS while Android internal-data visibility is unaccepted.
2. Continue nationwide NPS enrichment from the existing 116-park rich cache with one new bounded batch and no refetch of completed parks.
3. Keep every generated catalog in the isolated audit directory. Do not overwrite the protected serving index or promote data publicly.
4. Return to the internal-preview blocker only with new request-level evidence, such as a safe fixed-code client/server diagnostic; do not publish another speculative OTA.

### Do not repeat

- Do not repeat the three Android preview publications, cold-launch identity checks, Railway sidecar/env verification, or authenticated server probe.
- Do not start another native build, submit either store artifact, publish a production OTA, expose Community routes, or promote agency/NPS candidates without the required acceptance.
- Do not repeat Trails T1-T6, 3D Back, Builder, GPX, Offline, Follow, recording, Flyover, Layers, Memory, Originals, Android Auto, or broad Explore/NPS crawls.

## Nationwide NPS resumable batch 5 — 2026-07-31 15:39 CDT

- Starting point: 116 rich-cache parks and 358 remaining. One bounded run selected 28 previously untouched park codes and used 320 of the hard 700-request cap.
- Candidate: `data/explore/audit_candidates/nps/live-20260731-b05`; 144 parks now have rich cached source packs and 330 remain.
- Candidate audit is `promotion_ready: true` with zero errors and zero warnings. The Explore QA matrix passed and 57 focused official-place tests passed.
- Module growth from NPS candidate `b04` to `b05`: Things to See `2,982 -> 3,512`; Things to Do `1,136 -> 1,334`; campgrounds `276 -> 326`; alerts `196 -> 248`; visitor centers `239 -> 273`; events `1,088 -> 1,241`; parking `269 -> 291`; guided items `218 -> 243`; passes `37 -> 44`.
- Attributed media increased from `4,387` to `4,739`. The fixed 729-place catalog, 474 NPS place identities, 500 source records, and 7 existing trail geometries remain stable while source packs become richer.
- Artifact hashes: catalog `8c512d4ce902cd7383463d7d35dd7827c9ebb62d06ab6ded84a8136891ec8efe`; source records `b44530cd6922a46fd4cfe89b0bfe91216e6500c46babf1160583c09a4aea293f`; trail geometries `fc854e0490b72584636c9990896ffbcf5e161cd3207c37d49fd4ae6e44e3d3e4`; audit `273b5ab516fcd24745a7dfcc98f927297536f1c74079a72d4ff3ec4c18d8839c`.
- The NPS key was supplied from the authenticated Railway environment to the process only and was not printed or stored in the repository.
- Protected Explore-index and App Store copy files remain unchanged. Live Explore catalogs and serving index remain untouched.

### Exact next action

1. Continue from the 144-park rich cache with the next bounded NPS batch; never refetch the completed park codes.
2. Keep candidates isolated until the internal Android data-preview blocker has new request-level evidence and the candidate receives device review.
3. Do not promote or stage the generated candidate into the user-owned serving index automatically.

### Do not repeat

- Do not rerun batch 5, its 28 park codes, or its 57-test/QA matrix.
- Do not restart the internal-preview device loop, start another native build, submit stores, publish production OTA, expose Community routes, or promote candidates without acceptance.

## Nationwide NPS resumable batch 6 — 2026-07-31 15:45 CDT

- Starting point: 144 rich-cache parks and 330 remaining. One bounded run selected 28 new park codes and used 312 of the hard 700-request cap.
- Candidate: `data/explore/audit_candidates/nps/live-20260731-b06`; 172 parks now have rich cached source packs and 302 remain.
- Candidate audit is `promotion_ready: true` with zero errors and zero warnings. The Explore QA matrix and 57 official-place tests passed.
- Module growth from `b05` to `b06`: Things to See `3,512 -> 3,955`; Things to Do `1,334 -> 1,461`; campgrounds `326 -> 330`; alerts `248 -> 283`; visitor centers `273 -> 303`; events `1,241 -> 1,396`; parking `291 -> 317`; guided items `243 -> 276`; passes `44 -> 48`.
- Attributed media increased from `4,739` to `5,107`; stable catalog/source/trail identity counts remain unchanged.
- Artifact hashes: catalog `ccc9e87d9209927a48285764e76a5abb886284b875b8caf74410221489b577b6`; source records `c01998e55f63435b7d396b24c9afa13510d8045a28e3a20efdbec5e59f4c06d8`; trail geometries `1b236917e333d508bf8207f0c8b1857f59e357752ea21b47dc0d20ac21a49f85`; audit `1cc3011dc5e63c5c34115e2a597e9cd415c063f9788039cfd6c0a11690ca91cf`.
- The authenticated Railway key remained process-only. Live catalogs, the protected serving index, public stages, production artifacts, and preview channel were unchanged.

### Exact next action

1. Resume at 172 rich parks and 302 remaining. Run only a new untouched-code batch.
2. Keep `b06` isolated pending internal device-preview acceptance and manual image/module review.
3. Do not refetch batches 1-6 or promote generated data automatically.

## iOS 1.0.11 App Store Connect upload — 2026-07-31 16:31 CDT

- User explicitly authorized iOS submission and will handle Android submission independently. No Android Play Console action, Android OTA, or replacement build was performed.
- Submitted the exact frozen iOS production build by EAS build ID `712109e9-6b7f-4f72-ab51-2aa42a6095da`: Trailhead `1.0.11`, build `62`, runtime `native-1.0.11-ios.1`, source `0f7431d32088405f4c381ed1a220fcb2169ec761`.
- EAS submission `ea91a45b-e545-4492-89b6-7b98e6bbfcfa` finished successfully for App Store Connect app `6763677349`. This confirms the binary upload; App Store Connect processing and the separate App Review state must be checked in Apple's console.
- No new native build was started. The release worktree's build-generated native metadata changes were left untouched rather than staged, reset, or used as submission source.
- Neither available browser had an authenticated App Store Connect session, so no unsupported claim was made that Apple's separate `Submit for Review` action had completed.
- Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Task-owned EAS submit, Metro, Gradle, Maestro, publisher, enrichment, and test processes: none.

### Exact next action

1. Continue isolated Explore/NPS data-depth work from candidate `b06` without touching the live serving index.
2. Use non-network data-quality review first; only start a new NPS fetch batch after the hourly API window is safe.
3. Keep the internal Android Explore-preview blocker checkpointed until new request-level evidence exists; do not publish another speculative OTA.

### Do not repeat

- Do not resubmit build `62`, start another production build, submit Android, publish a production OTA, or modify App Store review/release settings without new authorization/evidence.
- Do not rerun NPS batches 1-6, completed Trails/3D/Builder/Offline/Follow work, broad Map/Layer/Memory crawls, or the Android internal-preview loop.

## NPS candidate b06 data-depth quality gate — 2026-07-31 16:45 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; pre-change HEAD `1f3f2e0`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Rebuilt the existing `b06` cache without network requests into `data/explore/audit_candidates/nps/live-20260731-b06-quality`; the live serving index, public feature stages, production artifacts, and preview channels remain untouched.
- Candidate audit is `promotion_ready: true` with zero errors and zero warnings: 729 Explore places, 474 stable NPS identities, 500 source records, 7 existing trail geometries, and 5,107 attributed media records.
- Data depth is now explicit in the audit: 172 rich-cache parks, of which 170 expose at least one destination module; 302 parks remain, of which only 13 retain any destination module from base data. The remaining queue is therefore the primary source of visible Explore gaps.
- Replaced the missing NPS designation fallback `national_park` with the honest reader-facing `Park`. Candidate-level validation now rejects raw snake_case NPS subcategories, and the rebuilt candidate contains zero such NPS labels.
- Non-NPS sources still contain 29 raw subcategory tokens such as `camp_site`, `wilderness_hut`, `forest_road`, `national_forest`, and `ohv_route`. This is recorded as a separate cross-agency cleanup; it was not folded into the NPS change.
- Candidate hashes: catalog `fe9fb3473c72f49a5214e47901d96a476f7c57f498ec669be53710131b26e630`; source records `0e738e8a0ab4803c05b14aec7374e450dd9f9a7b9f600faaa2a6ac9d2702e0cf`; trails `ca7e9644eef0d8e413fc6b3460b4eb02625298957a8fc1410c3b6635027c9354`; audit `086ceda028b438d5ee8876402e478ff23ea35c876638445cc8bc9f8a5d28bbb3`.
- Verification passed: 45 focused NPS/Explore unit tests, Python compilation, cache-only rebuild, candidate promotion audit, and zero-network confirmation.
- The durable `Explore NPS Data Depth — Candidate b06` analytical report was validated and rendered with module coverage, enrichment-depth comparison, recommendations, and caveats.
- Task-owned EAS submit, Metro, Gradle, Maestro, publisher, enrichment, and test processes: none.

### Exact next action

1. Commit and push only the four named NPS source/test files plus this checkpoint; keep protected and unrelated work unstaged.
2. After the rolling NPS API window is safely reset, run one new bounded batch from the 172-park rich cache. Do not refetch completed park codes.
3. Keep every generated catalog isolated until the internal Android data-preview handoff has new request-level evidence and device acceptance.
4. Review exact image identity and the two legitimately sparse rich-cache parks before any intentional serving-index promotion.

### Do not repeat

- Do not rerun the b06 network fetch, the b06 cache-only quality rebuild, App Store submission, or the Android internal-preview loop.
- Do not submit Android, publish a production OTA, promote candidates, expose Community routes, or modify public feature stages.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, or unrelated dirty files.

## Nationwide NPS resumable batch 7 — 2026-07-31 16:50 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; starting HEAD `012cc7bd`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Starting point: 172 rich-cache parks and 302 remaining. One bounded run selected 28 untouched park codes and used 328 of the source-controlled 700-request cap.
- Candidate: `data/explore/audit_candidates/nps/live-20260731-b07`; 200 parks now have rich cached source packs and 274 remain.
- Candidate audit is `promotion_ready: true` with zero errors and zero warnings. The Explore QA matrix passed and 58 focused official-place tests passed.
- Module growth from `b06-quality` to `b07`: Things to See `3,955 -> 4,603`; Things to Do `1,461 -> 1,617`; campgrounds `330 -> 336`; alerts `283 -> 317`; visitor centers `303 -> 346`; events `1,396 -> 1,616`; parking `317 -> 352`; guided items `276 -> 327`; passes `48 -> 50`.
- Attributed media increased from `5,107` to `5,505`. Stable identity counts remain 729 Explore places, 474 NPS park identities, 500 source records, and 7 existing trail geometries.
- Data-depth audit now reports 200 rich-cache parks with only 2 legitimately sparse destination packs, while 12 of the 274 remaining parks retain some base destination content.
- Artifact hashes: catalog `8d7c4567034e9aa6229de5e91814170f3f134be46e7ce952665c496514132e0f`; source records `90fb7c05c132381da4307f6aaf4e4e85d324a1609b5e0320f57ef8fb3449d90c`; trail geometries `08aeb659b98b0933de5e2277e3ba4bcb711993f61da2fa733ed9ee2dfe8c8d53`; audit `70352d31e51f82a744ea026d04a640cd57fc2add6c6d24c131d9629019fa3add`.
- The NPS key was supplied through the authenticated Railway environment to the WSL process only. It was not printed by the enrichment command or written to the repository.
- Live catalogs, the protected serving index, production/preview channels, public feature stages, Community-trails stage, and store state remain unchanged.
- Task-owned Railway, enrichment, test, EAS submit, Metro, Gradle, Maestro, and publisher processes: none.

### Exact next action

1. Commit and push this checkpoint only; keep protected and unrelated work unstaged.
2. Do not start batch 8 until a new hourly API window. Use the time before then for isolated image-identity and module-coverage review of the 28 newly enriched parks.
3. Keep `b07` isolated until the Android internal-data handoff has new request-level evidence and device acceptance.
4. After data preview is visible and accepted, intentionally assemble a serving candidate from the accepted NPS and USFS/BLM artifacts without overwriting the protected index automatically.

### Do not repeat

- Do not rerun batch 7, its 28 park codes, its QA matrix, App Store upload, or the Android internal-preview loop.
- Do not submit Android, publish a production OTA, promote candidate data, expose Community routes, or modify public stages.
- Do not repeat completed Trails, 3D, Builder, GPX, Offline, Follow, recording, Layers, Memory, Originals, or Android Auto work without new evidence.

## NPS batch 7 media-identity closeout — 2026-07-31 17:02 CDT

- Starting HEAD `d37a3778`. The review was limited to the 28 newly enriched parks and a cache-only rebuild; no additional NPS request, mobile publication, backend deployment, or serving-index change occurred.
- All 28 new parks expose at least one real destination module. Their lead images are unique across the batch, carry park-specific NPS captions and attribution, and use official NPS source records.
- The review found one real renderer defect: NPS event images may be returned as relative `/common/uploads/...` URLs. Fourteen relative media entries were present across Fort Union National Monument, Frederick Douglass National Historic Site, and George Rogers Clark National Historical Park.
- Added one NPS URL resolver for park, child, event, and aggregated media links. Relative paths now resolve against `https://www.nps.gov/`; already absolute links remain unchanged.
- Candidate audits now reject non-HTTPS top-level or destination-module media URLs so broken relative links cannot silently re-enter an accepted catalog.
- Cache-only candidate `data/explore/audit_candidates/nps/live-20260731-b07-quality` is `promotion_ready: true` with zero errors, zero warnings, and zero relative media URLs across all 474 NPS identities.
- Verification passed: 47 focused NPS/Explore unit tests, 59 official-place/QA tests, Python compilation, cache-only candidate rebuild, Explore QA matrix, and whitespace checks.
- Quality-candidate hashes: catalog `4de80fb200b10a673ae3b569539e41429402e6fed62ceee416c99e8106359305`; source records `c92c4233612c96815fb748242569376e010956fe497a22a14385a8f81d09b139`; trail geometries `5f8f3161823fddad1d76eaa074e85cd76ee3fc19c763d5033e82bdbcfadfb2a5`; audit `782cc0c91216d914f12fed836b3d76211be9bb38a1bc2d15bd680afb8ebc18fc`.
- One upstream credit typo (`NPS Pnoto`) remains preserved as source attribution rather than silently rewriting a credit line. It is a copy-review note, not an image-identity failure.
- Protected Explore-index and App Store copy hashes remain unchanged. Task-owned test, enrichment, Railway, EAS, Metro, Gradle, Maestro, and publisher processes: none.

### Exact next action

1. Commit and push only the NPS importer, audit, focused tests, and this checkpoint.
2. Keep `b07-quality` isolated. Do not promote it until the internal Android data-preview handoff is visible and accepted.
3. The next implementation task is a fixed-code request-path diagnostic for the existing Android internal-preview handoff, not another speculative OTA or broad crawl.
4. Batch 8 remains blocked until a new hourly API window and should not begin while the internal preview handoff is being diagnosed.

### Do not repeat

- Do not repeat the 28-park media review, batch 7, the cache-only quality rebuild, or the prior three Android preview publications.
- Do not stage or overwrite protected/user-owned files, submit Android, publish production OTA, or promote the catalog.

## Internal Explore request-path diagnostic implementation — 2026-07-31 17:18 CDT

- Starting HEAD `6af5ab2f`. This packet adds fixed-code, privacy-minimal diagnostics only; it does not change catalog selection, data ranking, public stages, or production behavior.
- The Explore preview middleware now records one bounded request code: `active`, `header_missing`, `server_stage_off`, `admin_required`, or `not_applicable`. It retains no token, account identifier, URL parameters, search text, coordinates, route, or response content.
- Added admin-only `GET /api/explore/qa/preview-status`. It returns the request code, a sidecar code (`ready`, `sidecar_missing`, `sidecar_empty`, or `unchecked`), and only the bounded profile count.
- The existing QA screen now performs that exact Explore-scoped request and displays Request, Data, and Profiles values. Because the endpoint path starts with `/api/explore/`, it proves whether the normal authenticated preview-header path is active on the installed update.
- Verification passed: 7 backend preview tests, 5 mobile request-path contract tests, Python compilation, and full mobile TypeScript with no diagnostics.
- No public API contract, native dependency, permission, runtime, mobile catalog cache, Offline store, production OTA, or store state changed.
- Protected Explore-index and App Store copy hashes remain unchanged. Task-owned test, enrichment, Railway, EAS, Metro, Gradle, Maestro, and publisher processes: none.

### Exact next action

1. Commit and push only the middleware, internal endpoint, mobile QA surface, focused tests, and this checkpoint.
2. Deploy backend compatibility first from the exact source while retaining `TRAILHEAD_EXPLORE_DATA_STAGE=internal`.
3. Publish one Android-only diagnostic preview OTA from that exact source. Open the admin QA screen once and record the three fixed values.
4. Correct only the evidenced boundary. Do not publish iOS or another Android update until this diagnostic identifies the cause.

### Do not repeat

- Do not repeat previous speculative Explore preview publications, catalog research, NPS fetches, media review, or broad Android crawls.
- Do not submit Android, touch Apple review, publish production OTA, expose Community routes, or promote candidate data.

## Internal Explore agency handoff closeout - 2026-07-31 17:43 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; implementation source `6b69014145a767319d064ace1bcd7906d5bd219e`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- The fixed-code device diagnostic on source `76d8bb5c` proved the request was authenticated and the Railway sidecar was ready (`active`, `ready`, `5`). The remaining defect was downstream: compact responses dropped the internal marker, existing NPS identities lost their internal preview ranks during enrichment, and the visible `Parks & Land` lane excluded forest/public-land identities.
- The correction preserves preview rank and identity through enrichment and compact serialization, forwards the bounded top-level preview marker so internal data is never persisted into the public cache, and aligns server/mobile `Parks & Land` matching for parks, forests, public land, land, recreation areas, and wilderness records.
- Verification passed: 8 internal-preview backend tests, 24 Explore serving/filter tests, 5 mobile request-path tests, 4 destination-registry tests, full mobile TypeScript, Python compilation, and whitespace checks. The optional agency-pilot module could not start in the system Python because `pytest` is not installed; no product assertion failed and no dependency was installed solely to rerun it.
- Railway deployment `cd32d0a7-aa88-4f7e-b116-52b0ed9d3659` succeeded from the exact clean source and `https://api.gettrailhead.app/api/health` returned healthy.
- Android preview update `019fba50-2c27-79bf-a966-a46190152155`, group `20be7872-fda7-4fc7-80bf-958d11d6a8fa`, runtime `native-1.0.10-android.7`, and iOS preview update `019fba58-5fe3-7769-a553-c1a92a14b5ff`, group `8d8b21f6-fb43-4414-a261-7b93e7f83c68`, runtime `native-1.0.10-ios.6`, are both bound to exact source `6b690141` on preview channel `019dbc97-3cde-795b-a35d-e6aa985060d3`. Sentry source maps uploaded for both platforms.
- The Samsung `SM_A326U1` retained its account and installed binary `1.0.10` build `69`. Two-launch OTA handoff succeeded. On-device QA reports exact source/update identity plus `Request: active`, `Data: ready`, and `Profiles: 5`.
- The Android `Parks & Land` delta passed. The lane displayed 415 real matching places and the bounded scroll found all five proof destinations: Sierra National Forest, Moab BLM, Carlsbad Caverns National Park, Catoctin Mountain Park, and Channel Islands National Park. No broad Explore crawl was repeated.
- Evidence: `C:\Users\User\AppData\Local\Temp\trailhead-qa6-6b690141.xml` SHA-256 `2ed8f7f5c349987f89311e782afba1d814e9f4e38d19c8cc9589f6738d1b5c30`; `C:\Users\User\AppData\Local\Temp\trailhead-parksland-6b690141.xml` SHA-256 `1c3a16ac1625abec70b03c6a4dc5665e94ad273cdbbd47629a3f8e1581b590ae`; `C:\Users\User\AppData\Local\Temp\explore-parks-land-6b690141.png` SHA-256 `97a0a12000b0563d75a7b855e6492b02025ddd6fd95831c4bf6189e41cff1d77`; `C:\Users\User\AppData\Local\Temp\explore-parks-land-cards-6b690141.png` SHA-256 `176b07ec9964a8c5d16a5f811660a3a1e5a24a3ea0e5ad4179079342a50f618c`.
- The first local Android publisher process hit its 120-second wrapper timeout before any EAS update existed. Server evidence confirmed no update was created; the single actual publication completed under the normal guarded publisher with update `019fba50...`.
- No Android production build, Play Console action, production OTA, public serving-index promotion, Community-trails exposure, or feature-stage change occurred. Android store submission remains user-owned. The previously uploaded iOS 1.0.11 App Store Connect binary was not rebuilt or resubmitted.
- Task-owned Railway, EAS, Expo, Metro, Gradle, Maestro, test, and enrichment processes: none.

### Exact next action

1. Keep `b07-quality` isolated and begin the approved Explore data-depth continuation without touching the protected live serving index.
2. Audit the remaining 274 NPS parks by module coverage and run only the next untouched-code resumable batch when the NPS request window permits.
3. In parallel with non-network review, prepare the Sierra/USFS and Moab/BLM pilot candidate merge under the audit directory, retaining agency attribution and deterministic deduplication.
4. Any catalog promotion remains an intentional later step after candidate QA and device review.

### Do not repeat

- Do not repeat the internal-preview diagnostic, the two preview exports, the five-destination Android delta, NPS batches 1-7, the batch-7 media review, or broad Explore/Trails/Map crawls.
- Do not submit Android, rebuild/resubmit iOS, publish production OTA, expose Community routes, overwrite the protected serving index, or change public feature stages without separate authorization.

## NPS batch 8 and agency-candidate quality closeout - 2026-07-31 17:57 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; starting HEAD `eb0c09da5704bb30cea241df692dcf14186f3961`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- The next untouched NPS batch selected 28 park codes: `glca`, `glec`, `glde`, `goga`, `gosp`, `gois`, `para`, `grpo`, `grte`, `grko`, `grba`, `greg`, `grfa`, `grsa`, `grsp`, `gree`, `gumo`, `guco`, `guis`, `hafo`, `hagr`, `hamp`, `haha`, `hafe`, `hart`, `hatu`, `hstr`, and `heho`.
- The bounded run used 326 of the source-controlled 700-request cap and produced isolated candidate `data/explore/audit_candidates/nps/live-20260731-b08`. Rich NPS coverage increased from 200 to 228 parks; 246 parks remain. The candidate is `promotion_ready: true` with zero errors and zero warnings. The Explore QA matrix passed and 59 focused official-place tests passed.
- Module growth from `b07-quality` to `b08`: Things to See `4,603 -> 5,223`; Things to Do `1,617 -> 1,893`; campgrounds `336 -> 390`; alerts `317 -> 363`; visitor centers `346 -> 388`; events `1,616 -> 1,731`; parking `352 -> 408`; guided items `327 -> 388`; passes `50 -> 58`. Fees remain `441` across 120 parks.
- Attributed NPS media increased from 5,505 to 5,809. Media-identity review of the 28 new parks found 28 lead images, 28 unique lead URLs, zero duplicate leads, zero missing captions, zero missing credits, and zero non-HTTPS URLs across all 5,809 NPS media records.
- Stable intended-grain counts remain 729 Explore places, 474 NPS identities, 500 source records, and 7 existing trail geometries. Candidate hashes: catalog `4711b9ace48e4dbfdb5434c1543e6292c1ade307c49cbaeaa56dc2012ab5629b`; source records `95e1c0e8559e49ca4336c8c2c87489a10df7a2196b507b10c1f99c3b9c4c047c`; trail geometries `974326332df4757f2d6aa0269490b11aeb9243e42bd00e31f23aaf2a99e09d6b`.
- Rebuilt the existing Sierra/USFS and Moab/BLM pilot cache without network requests into `data/explore/audit_candidates/agencies/live-20260731-b08-quality`. Deterministic intended-grain counts match the prior candidate: 1,281 source records, 1,117 places, 901 source route segments, 668 grouped trail systems, 106 reviewable places, and 2 destination hubs. The candidate is promotion-ready with zero errors and one intentional warning: 17 trails have unknown permitted use and remain unlabeled rather than guessed.
- Agency-candidate hashes: source records `dc9731d7be7cad949de1137a9356695122ca7ca0360beff4467e853f03a30626`; places `d3be51d20b0195ce081b17a94f70f7686ed39225d8edf4335465766ead703115`; route segments `e7fd4c9e52a4a76df92077eaa0ddfbdd9a2596fb1e6abdf0ed66567b8cea394a`; trail systems `2659df549f807748146feec371208fb3420157286b547eb9596a502982bccd4f`; destinations `7afcec1581565332f46b08f97e057c735962fec54127f45e1726f29ba1f01784`; Explore catalog `472e456956a90bd3727b1d9e4435abc856c284d2bb6f32a5abe95302b61a6a46`; serving review `022854b8613d813dff81aaddbfb68a6fb6572b2be8fa1f8b2df6042a15382e1d`; promotion review `d693cf62b943949f20143aa1c3bd741500a11acba4ba45af8cb1acb7b5898451`; audit `9b77d6e67c420ff0c865c638b33b7499f2e2f74674c99dfee72004c14d984623`; merged serving review `dc3c6472c72b4b7d4a0b3f3bb08bb945520891b8c6d45d3d24a71a3106c842ac`. Generated files remain isolated and unstaged.
- The agency audit preserved empty editorial summaries rather than generating filler. It did not fabricate permitted uses or NPS-style modules for geospatial-only records.
- The authenticated NPS key remained process-only and was not printed or stored. Generated candidates remain isolated. No live serving-index change, public promotion, production OTA, Android production action, Community-trails stage change, or store action occurred.
- Current preview remains Android `019fba50-2c27-79bf-a966-a46190152155` / group `20be7872-fda7-4fc7-80bf-958d11d6a8fa` / runtime `native-1.0.10-android.7` and iOS `019fba58-5fe3-7769-a553-c1a92a14b5ff` / group `8d8b21f6-fb43-4414-a261-7b93e7f83c68` / runtime `native-1.0.10-ios.6`, both on exact source `6b69014145a767319d064ace1bcd7906d5bd219e`.
- Task-owned Railway, NPS enrichment, EAS, Expo, Metro, Gradle, Maestro, publisher, and test processes: none expected at checkpoint creation.

### Exact next action

1. Review and assemble an isolated, intentional serving candidate from accepted NPS `b08` plus the agency `b08-quality` artifacts without overwriting `dashboard/explore_serving_index_v2.json`.
2. Audit the cross-agency reader-facing wrapper copy exposed on the Android Sierra card; remove legacy generic phrases only when source-backed modules can replace them.
3. Run no new NPS network batch until a new request window and an explicit forward checkpoint. Keep the next untouched codes resumable.
4. Promote data only after schema, source, license, freshness, image identity, duplicate, module-coverage, and device review pass.

### Do not repeat

- Do not rerun NPS batch 8, its 28 codes, media audit, agency cache rebuild, internal-preview handoff, App Store upload, or existing Android proof.
- Do not submit Android, publish production OTA, promote candidates, expose Community routes, overwrite protected files, or change public stages without separate authorization.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, or unrelated worktree changes.

## Internal Explore compact-card closeout - 2026-07-31 19:03 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; implementation HEAD `539342ff083b8c03f5df434fb9f5d657e05fc9ea`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Railway deployment `961af141-c031-4ecf-9262-acf7e8ccdd54` remains healthy. The internal sidecar SHA-256 is `f408cdae5aacf1220fc83bf510d12169daccb3ce54170d36eb38b46cdc057977` and contains eight reviewed profiles. Public Explore data and the protected serving index remain unchanged.
- The backend compact response was verified locally under the internal request context: `place:usfs:9006` returns the reviewed Sierra National Forest summary, region `CA`, and `internal_preview: true`. The mobile preview remains authenticated and reports `Request: active`, `Data: ready`, and `Profiles: 8`.
- One evidenced mobile merge defect was corrected: when a reviewed internal profile arrives for an already-present stable ID, `mergeMatchedExplorePlaces` now refreshes its display fields while retaining existing hydrated modules and the best matched rank. The same-title curated dedupe also continues to prefer reviewed internal records.
- Focused verification passed: seven internal-preview mobile contract tests and full mobile TypeScript. No native project, dependency, permission, runtime, public API, production channel, or store state changed.
- Android-only preview update `019fba9c-b38c-742f-a85c-2cb062b97fc5`, group `a7c45085-19d8-437d-b24f-df2be5d9c578`, runtime `native-1.0.10-android.7`, is bound to exact source `539342ff083b8c03f5df434fb9f5d657e05fc9ea`. The paired iOS preview remains group `8d8b21f6-fb43-4414-a261-7b93e7f83c68`, runtime `native-1.0.10-ios.6`; no iOS preview was replaced for a failed Android assertion. Sentry source maps uploaded for the Android update.
- The Samsung `SM_A326U1`, binary `1.0.10` build `69`, applied the exact Android update. QA identity, request state, and sidecar state passed. Moab BLM rendered the reviewed agency summary and attribution.
- One deterministic internal-preview P1 remains: before opening Sierra detail, the compact `Parks & Land` card still renders the older generic catalog sentence and legacy area label. Opening the detail hydrates the reviewed source-backed profile correctly. The single evidence-backed correction did not clear the compact-card assertion, so this packet stops here under the no-loop rule. Public users are unaffected because the sidecar is internal/admin-only and no candidate data was promoted.
- Evidence: `C:\Users\User\AppData\Local\Temp\qa-539342ff-top.png` SHA-256 `eba94114ae5e715ebd3b1c0244023fb71695f604fbf962d920a222d5a7b2ac90`; `C:\Users\User\AppData\Local\Temp\qa-539342ff-mid.png` SHA-256 `04040f519a2bb101a0db7c2c2ee2ed5185fc0915362db732478b288531072293`; `C:\Users\User\AppData\Local\Temp\explore-539342ff-visible.png` SHA-256 `87ada548c65e5f715f7b6f0bfb9e6d9ae9d21a9bfd5dd95d4670e8b8fde3fd48`; `C:\Users\User\AppData\Local\Temp\explore-539342ff-visible.xml` SHA-256 `e73ffc1b14c1ddf953230420ee84969539bf0ebb39aaa8f9f7b150049b7cce9f`.
- The iOS 1.0.11 build 62 was already uploaded successfully to App Store Connect through EAS submission `ea91a45b-e545-4492-89b6-7b98e6bbfcfa`; it was not rebuilt or resubmitted in this packet. Android production submission, production AAB, and Android production OTA remain entirely user-owned and untouched.
- Task-owned Railway, EAS, Expo, Metro, Gradle, Maestro, test, publisher, and enrichment processes: none.

### Exact next action

1. Commit and push this checkpoint only, leaving every protected and unrelated worktree file unstaged.
2. Treat the compact Sierra card as a bounded internal-preview P1. The next diagnostic must inspect the final rendered-card selector/input identity rather than alter auth, backend sidecar merge, or public data.
3. Continue non-promoting data-depth work only where it does not hide this defect: audit the next untouched NPS coverage batch and agency module gaps under the isolated candidate directory.
4. Do not promote the combined serving candidate until the compact-card identity path is resolved and the bounded Android sample passes.

### Do not repeat

- Do not repeat the authenticated request diagnostic, backend sidecar merge proof, reviewed same-title priority fix, current Android OTA, NPS batches 1-8, agency cache build, or broad Explore/Trails/Map crawls.
- Do not submit Android, publish an Android production OTA/build, rebuild/resubmit iOS, overwrite the protected serving index, promote candidate data, expose Community routes, or change public stages.

## Combined NPS and agency serving-candidate gate - 2026-07-31 18:10 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; implementation HEAD `a6430b0848f24e5053d09790fbcb3f6722fc08cb`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Rebuilt the Sierra/USFS and Moab/BLM candidate from its cached official sources with zero network requests after correcting the Sierra hub sentence. The reader-facing summary now stays intact through public-copy cleanup: `Sierra National Forest supports camping, hiking, biking, horseback riding, fishing, winter travel and motorized routes across its mountain landscape.`
- The first combined audit correctly exposed two candidate-construction defects before promotion: the 729-place NPS wrapper also carried unrelated OSM/BLM seed records, and the child-copy auditor treated intentionally omitted descriptions as failures. NPS input is now scoped to the 474 stable `place:nps:*` identities, and the audit uses the same category/group precedence as the shared sanitizer. Sparse child records retain their official title, map point, source and action without invented prose.
- Isolated combined artifacts are under `data/explore/audit_candidates/combined/live-20260731-b08`. The full catalog review contains 993 unique profiles: 886 live profiles, 474 exact NPS replacements, one exact agency replacement, and 107 new agency profiles. It contains 633 source packs and 831 profiles with media.
- The compact serving review contains 5,435 unique reviewable items and passes the unchanged 4,000-item gate. Relative to the protected live index it adds 104 accepted agency identities. Five older RIDB campground cards are deterministically displaced by higher-quality USDA Forest Service identities for the same places; no record is silently deleted from source artifacts.
- Serving-quality checks report zero invalid coordinates, missing titles, missing descriptions, non-HTTPS images, developer copy, newly added generic `Check...` copy, missing source URLs, or missing provenance. Fuel and resupply remain known pre-existing filter gaps and were not fabricated in this packet.
- Combined artifact hashes: full catalog `22d68ba8bc676ff5c29a2282a7c3d4908d87530dd41bcc4c4e1ec02e75ccb884`; serving review `60dc1969c38dcaa05ed0d5320cc2725f973caa7491a641ea8a7f488c80d684f8`; promotion review `d572a29ed8590389b983f60b39a8cd8f2f485c2f01713a2bc448f8a71e997c72`; manifest `1bf4f2f8c041b4c3383ebde0380a0dbde7ada7e60613208d610e91ade3a316ae`. Rebuilt agency manifest SHA-256 is `cb6cde869220151af587f7e1d99640d5f6886ca8b8d20367ca49244b6e25558e`.
- Verification passed: 22 focused agency/content-quality tests, 72 NPS/Explore serving/source tests, Python compilation, whitespace checks, the app-facing content-quality audit, and the Explore scenario matrix. The matrix has no dead ends; the only warning is pre-existing Iceland coverage that still uses seed context and lacks current freshness metadata.
- This packet changed only the agency summary generator, the catalog-quality audit alignment, and their focused regression tests. No mobile code, backend deployment, preview/production OTA, serving-index write, public data promotion, Community stage change, or Android production action occurred.
- Task-owned Railway, NPS enrichment, EAS, Expo, Metro, Gradle, Maestro, publisher, and test processes: none.

### Exact next action

1. Keep the combined candidate isolated and prepare a bounded internal preview artifact from the accepted 993-profile/5,435-item pair; do not replace the protected live catalog or index.
2. Review the five RIDB-to-USFS campground replacements and a small Android destination sample before intentional promotion.
3. Record Iceland freshness as a separate future source-expansion packet rather than weakening this U.S. agency gate.
4. Continue with the next untouched NPS batch only after a new request window and a fresh forward checkpoint.

### Do not repeat

- Do not repeat NPS batch 8, the agency cache rebuild, combined candidate construction, child-copy failure flood, media audit, or previous internal handoff proof.
- Do not submit Android, publish production OTA, overwrite the protected serving index or catalog, promote data, expose Community routes, or change public stages without separate authorization.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, or unrelated worktree changes.

## Forward checkpoint — b08 internal acceptance continuation — 2026-07-31 21:42 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; starting HEAD `dcf9f607bac648d518abd57ec43161cbbf2f0182`.
- Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Historical NPS candidate `b06` is complete and superseded. This packet uses accepted NPS `live-20260731-b08`, agency `live-20260731-b08-quality`, and combined `combined/live-20260731-b08` artifacts with zero new source requests.
- The existing isolated `internal_preview_review.json` contains eight reviewed profiles sourced explicitly from b08: Sierra National Forest, Moab BLM, Carlsbad Caverns, Catoctin Mountain Park, Channel Islands, Golden Gate, Grand Teton, and Guadalupe Mountains. No live serving index has been changed.
- System cleanup completed before this packet. Standard DiskPart compaction increased Windows C free space from `1,351,360,512` to `34,758,172,672` bytes. Ubuntu, Git, Node, Python, Gradle, and the preserved Android SDK/ADB were verified afterward; protected hashes are unchanged.
- The remaining bounded P1 is the compact Sierra card. Existing request, authentication, sidecar, stable-ID replacement, backend detail, and Android preview evidence are accepted and will not be repeated.
- Evidence-backed cause to verify: `enrichedExplorePlaces` and sheet-open paths may select a stale `exploreTrailAreasById[place.id]` object wholesale after the reviewed profile has replaced the base catalog record. The cached trail-area data must enrich the current reviewed identity, not replace it.
- Task-owned NPS, Railway, EAS, Expo, Metro, Gradle, Maestro, publisher, and test processes: none.

### Exact next action

1. Add a characterization test for reviewed-profile precedence when a stale same-ID trail-area cache exists.
2. Merge cached trail modules into the current reviewed profile at the final selector and sheet-open boundary; do not alter backend auth, sidecar construction, public data, or catalog ranking.
3. Run focused Explore/internal-preview tests, TypeScript, copy/privacy checks, then one Android internal delta covering Sierra, Moab, representative NPS profiles, and the five RIDB-to-USFS replacements.
4. Stop after one evidence-backed correction if the compact-card assertion remains unresolved.

### Do not repeat

- Do not refetch NPS batches 1-8, rebuild accepted agency/NPS caches, repeat authenticated request diagnostics, change public stages, overwrite the protected serving index, or promote candidate data.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Valhalla work, Android helper-script work, or unrelated files.

## Database-first campground detail and isolated Map P1 — 2026-07-31 23:11 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; current HEAD `42444b1fc427c9d0793d5b2a736be3838d0530df`.
- Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. `.cursor/`, the protected files, Valhalla work, and Android helper-script work remain unstaged.
- System cleanup is complete and preserved in `C:\Users\User\Documents\Codex\evidence\trailhead\system-clean-2026-07-31-baseline.md`. Windows C free space increased by approximately 32.4 GB and the Ubuntu VHD compacted from approximately 154.6 GB to 130.24 GB; Ubuntu, Git, Node, Python, Gradle, and ADB reopened successfully.
- Accepted b08 data remains isolated. No serving-index write, source refetch, public data promotion, production OTA, Community-stage change, or store action occurred.
- Commit `39168b33` added database-first campground resolution. Exact reviewed campground identities are now served synchronously from the stored Explore catalog with preserved USFS attribution, RIDB booking/media licensing, amenities, facts, and access data. Live RIDB/context enrichment is skipped when the reviewed record is complete.
- The mobile full-detail contract now commits that reviewed database record as the first stable layout. It does not intentionally render a placeholder sheet and replace it with another sheet family. Later same-identity content may fill reserved rows only; it cannot change the header, actions, identity, or scroll position.
- Railway deployment `25d3f93f-dc1c-4d3c-b6a3-d4ffa2b8f910` succeeded and `/api/health` is healthy. Internal campsite detail authorization requires both authenticated admin access and the internal-preview header.
- Commit `01caa053` carries the internal-preview header on both `/api/explore/*` and `/api/campsites/*`. Focused preview-contract tests and TypeScript passed.
- Android preview update `019fbb71-d012-7367-a0ef-fbdbf707e6e0`, group `101111a1-0353-4eb3-a2d2-481c5f788665`, first proved the corrected request boundary on runtime `native-1.0.10-android.7`.
- The exact `Kirch Flat Group Campground` flow exposed a separate full-screen `MAP ERROR — undefined is not a function` before a campground sheet could render. This is a Map render/handoff P1, not a database retry or campground enrichment flash.
- Commit `42444b1f` safely guards the candidate `NativeMap.flyTo` handoff and adds a contract test. Fifteen focused subtests, TypeScript, and whitespace checks passed. Android preview update `019fbb81-4ad2-700a-be1c-66915ae0ebb4`, group `2cd2c1c9-dc7d-4136-928c-161d5cb5a1b3`, runtime `native-1.0.10-android.7`, is bound to exact source `42444b1fc427c9d0793d5b2a736be3838d0530df`; Sentry source maps uploaded.
- Device identity passed on app `1.0.10`, build `69`, preview channel, exact source `42444b1f...`, and update `019fbb81...`. The single bounded Kirch Flat replay still produced the same Map error, proving the guarded camera call was not the root cause.
- Evidence: `C:\Users\User\Documents\Codex\evidence\trailhead\b08-424-camp-stable-failed.mp4` SHA-256 `a9401b7748cdf24d1687eccd73323bdcf42107f793215c99b4f375c1c200e874`; `C:\Users\User\Documents\Codex\evidence\trailhead\b08-424-camp-peek.png` SHA-256 `4c68265ae41de8e18d483745c2cffdab9fff556490a6d54c766be20a7af6bc1`; `C:\Users\User\Documents\Codex\evidence\trailhead\b08-android-qa-42444b1f.xml` SHA-256 `c94908d258b207d2b8f23f346da83e20419a154ee0356598a45617507d3b84d3`.
- The paired iOS preview was intentionally not published because Android still has this P1. iOS remains group `8d8b21f6-fb43-4414-a261-7b93e7f83c68`, runtime `native-1.0.10-ios.6`.
- The no-loop rule was honored: one deterministic reproduction and one evidence-backed correction were completed; there was no third replay, broad Explore crawl, data refetch, or speculative OTA.
- Task-owned Railway, EAS, Expo, Metro, Gradle, Maestro, publisher, screen-recording, and test processes: none. The ADB server and Codex/MCP Node processes are environment-owned and remain available.

### Open defects

- **P1 — selected reviewed campground crashes the Map before sheet presentation.** Exact path: internal Explore → Parks & Land → Sierra National Forest → Where to Stay → Kirch Flat Group Campground. The reviewed database response is accepted; the remaining failure is in the selected-camp Map render/handoff path.
- The b08 internal candidate is not accepted on device and iOS publication remains blocked until this assertion passes.

### Exact next action

1. Add narrow preview-safe Map-error diagnostics with fixed error codes and component-phase markers; do not collect coordinates, route geometry, search text, or arbitrary exception messages.
2. Isolate the first failing selected-camp render phase from the existing evidence or one instrumented replay, then correct only that demonstrated call site.
3. Rerun only Kirch Flat selection and stable sheet presentation. Require no full-screen Map error, no skeleton-to-different-sheet swap, no Retry/header flash, and no identity or scroll change.
4. If Android passes, publish the identical SHA to iOS and run only the shared campground assertion. Then close b08 acceptance with one paired checkpoint.

### Do not repeat

- Do not repeat system cleanup, NPS b08 fetching, combined-candidate construction, database/auth/header proof, broad Explore/NPS/Map crawls, Memory, Layers, Yellowstone, Trails, Originals, Android Auto, or campground retry loops.
- Do not weaken the nonflashing database-first contract or reintroduce a live network dependency into initial campground presentation.
- Do not overwrite or stage `dashboard/explore_serving_index_v2.json`, `.cursor/`, `docs/app-store-copy.md`, Valhalla changes, Android helper-script changes, or unrelated worktree files.
- Do not publish iOS, production OTA, catalog promotion, public stage changes, or store actions while the P1 remains.

## Campground sheet stability and Map P1 closeout — 2026-08-01 00:06 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; implementation HEAD `c3bf45c468f15ffb714c1865d4a3c87962a15969`. The protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. `.cursor/` and both protected files remain unstaged and unchanged by this packet.
- Added fixed-code `MapCampSelectionPhaseV1` diagnostics for selection receipt, camera handoff, sheet identity, Peek rendering, detail commit, and Full rendering. Preview telemetry is gated to authenticated administrators and carries only the fixed phase/error code through the existing Sentry allowlist; campground identity, coordinates, route data, search text, arbitrary exception messages, and user/request payloads remain excluded.
- Replaced the raw `MAP ERROR` boundary with `Map unavailable` and a reliable `Return to map` recovery action. The recovery clears the failed selection and returns to ordinary Browse without exposing exception text.
- Added the pure `campgroundSheetPresentationV1` model and exact Kirch Flat fixture. Peek and Full now derive stable title, source, site type, inventory, fee, photos, summary, features, activities, tags, and safe arrays from one normalized snapshot. Expanding before primary readiness stays inside the same sheet with one reserved skeleton; same-identity late modules cannot replace the header or sheet family.
- Focused verification passed: campground brief/presentation and Kirch fixture, telemetry/privacy allowlist, shared sheet actions/coordinator, Explore trails/handoff, NPS preservation, copy, privacy controls, TypeScript, and whitespace. The malformed-array fixture confirms non-array provider values cannot invoke array methods during Map rendering.
- Android preview update `019fbba4-a4c0-77b8-86ab-ccfd2db13eef`, group `8753242f-9d6d-4e2c-96cc-b2a5279c72cd`, runtime `native-1.0.10-android.7`, is bound to exact source `c3bf45c468f15ffb714c1865d4a3c87962a15969`. Samsung app `1.0.10` build `69` verified the exact source and update on the preview channel.
- The bounded Android delta passed for Kirch Flat Campground and Portal Dispersed Camp. Both displayed a stable Map Peek, expanded to complete content, produced no `MAP ERROR`, blank frame, entity swap, fatal log, or React exception, and restored the prior Explore child/list context through Back. The previous campground Map P1 is closed.
- Paired iOS preview update `019fbbb2-acb3-712f-8256-f18da5f461f2`, group `647bb540-bfb8-49b7-aa80-50fbcbcd0797`, runtime `native-1.0.10-ios.6`, was published from the identical source SHA with Sentry source maps. No iPhone was attached at closeout, so the physical shared-flow smoke check remains a bounded follow-up; it does not require another publication.
- Two nonblocking data/polish gaps are assigned to the next Explore data-quality packet rather than patched speculatively here: Portal Dispersed Camp is classified generically as `Campground`, and its stored Full payload exposes the source-state phrase `Report full`. Kirch Flat also lacked a deliverable exact photo/booking row in this device payload despite source-candidate media. None caused a sheet crash or live-provider dependency.
- Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\camp-p1-c3bf45c4`. Key SHA-256 values: Kirch Peek `ED7C14EA4C5DA0A41CBDE78E16795D85177709E51167250F0379ADCE0740418D`; Kirch Full `9C16BDAE4F816D9014AAF76A6B3874B515008AF9CFD665ACFA1BC65E16D99DAC`; Kirch video `65F14759B2612908CB66A3D7C24D007153D75DDE0E0EED628FD750C1F6828013`; Portal Peek `F13EE973437EDD78B10FC0B854A7649F40E72C4DFB79AA5E9CE14D004D991ABE`; Portal Full `2671E90125E1F15AC042C621DAC2FDDC65671AC74D63155C71D9E0B407363D12`; Portal video `99CEEB43A96D64FF751539C3E26F9D2D7D2F072804005F6D4073D6198AD9E5AB`; Portal error log `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` (empty).
- No public catalog promotion, public feature-stage change, production OTA, native build, NPS refetch, serving-index write, Community-route exposure, or store action occurred. Task-owned EAS, Expo, Metro, Gradle, Maestro, test, screen-recording, Railway, and NPS enrichment processes: none.

### Exact next action

1. Begin the separate Explore data-gap packet from accepted b08 artifacts: correct campground type/source-state presentation and audit why licensed image/booking fields do not reach the stored device payload.
2. Run the single iOS campground smoke assertion when a preview iPhone is next attached; do not republish this identical update.
3. Continue destination/module coverage work from the next untouched candidate. Keep all data isolated until schema, licensing, duplicate, image-identity, copy, and bounded device checks pass.

### Do not repeat

- Do not repeat the Kirch/Portal Android delta, Map diagnostic instrumentation, database/auth/header proof, NPS b08 fetch, combined-candidate construction, system cleanup, or broad Explore/Map/Trails crawls.
- Do not weaken database-first rendering, restore a live initial-detail dependency, overwrite the protected serving index, publish production OTA, promote catalog data, expose Community routes, or change public stages in the next data-only packet.

## 1.0.11 campground polish and OTA baseline — 2026-08-01 00:43 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; starting HEAD `d0a73cd013187b1f6f92ce32aa9275ad74bc7d95`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Frozen store binaries remain exact source `0f7431d32088405f4c381ed1a220fcb2169ec761`: Android EAS `723dca56-01a3-416b-a22d-98c838a849ee`, version code `70`, runtime `native-1.0.11-android.1`; iOS EAS `712109e9-6b7f-4f72-ab51-2aa42a6095da`, build `62`, runtime `native-1.0.11-ios.1`.
- Current production channel contains preserved legacy and 1.0.10 runtime groups but no `native-1.0.11-*` group. The 1.0.11 binaries therefore use their embedded release source until a matching update is safely published.
- Source inspection corrected the prior shorthand: `Report full` is a real, confirmation-gated availability contribution, not a source-status leak. Preserve the capability and use clearer sheet copy. Kirch Flat Campground has no exact licensed photo in the accepted record; retaining its clean placeholder is correct. The plumbing must still deliver exact licensed media when a record actually supplies it.
- Bounded fixes for this packet: source-backed dispersed-type classification, clear availability-report copy, correct booking-link priority, and regression proof that exact media/booking fields remain available through the database-first presentation. No invented image, source fetch, public catalog promotion, or native change is authorized.
- Task-owned EAS, Expo, Metro, Gradle, Maestro, test, Railway, NPS enrichment, and screen-recording processes: none.

### Exact next action

1. Add pure presentation/action tests for Portal Dispersed Camp, exact Kirch licensed media, and booking URL selection.
2. Apply the minimal mobile/backend-safe corrections and run focused campground, sheet, privacy, copy, TypeScript, and backend tests.
3. Publish Android preview, run only the affected campground delta, then publish the identical SHA to iOS if Android passes.
4. Create a clean descendant of the frozen 1.0.11 release source, prove native-input/fingerprint compatibility, and publish one paired 1.0.11 production OTA while preserving all existing runtime groups.

### Do not repeat

- Do not rerun broad Explore, Map, Trails, Memory, Layers, NPS, Originals, Android Auto, or store-screenshot work.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, or unrelated changes. Do not fabricate media or weaken exact-place licensing.

## Canonical campground follow-up blocked after bounded correction — 2026-08-01 01:19 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; exact HEAD `55845fdf39a5c7c51ef38989d39c28b0eabb72b4`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Campground presentation polish from commits `8d5c52d5`, `460f3ad5`, and `496a0a82` passed the bounded Portal Dispersed Camp device assertion. `Dispersed Camping` wraps without truncation, the raw `poi` fallback label is omitted, and the availability action reads `Report availability`. These are presentation fixes, not TypeScript source appearing in the UI.
- A second developed-camp assertion exposed a separate P1: selecting the canonical Search V2 result `Devils Garden Campground` reaches the caught `Map unavailable` boundary before the campground sheet is usable.
- Live source evidence for `/api/campsites/234059/detail` returned valid optional nulls including `provider_notices: null`, `campsites: null`, and `reviews: null`. The raw Full renderer calls `.slice()` on provider notices, while `normalizeCampDetailArrays` previously omitted that field. Commit `55845fdf` added the missing normalization plus an exact Devils Garden regression fixture. Campground tests, TypeScript, and whitespace checks passed.
- Android preview update `019fbbf5-9959-798e-a5df-7044ebaf1c9d`, group `decc4f58-e64d-41f8-a23f-7db5da8a7470`, runtime `native-1.0.10-android.7`, was published from exact source `55845fdf39a5c7c51ef38989d39c28b0eabb72b4`; Sentry debug ID `20d429c8-5a70-4ff2-a767-51431debcd15`. Samsung build `69` verified that source, runtime, and update.
- The single allowed Devils Garden rerun still produced `TypeError: undefined is not a function` in `MapScreen` and the `Map unavailable` recovery UI. The normalization was therefore necessary but not sufficient. Per the no-loop rule, no second speculative correction, paired iOS publication, production OTA, backend deployment, catalog promotion, or public-stage change was attempted.
- Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\camp-devils-55845fdf`. QA XML SHA-256 `a134ba133fa1a9e79668e869a21245b421763a964e17c2b5ca6c702d0cd2fe61`; QA screenshot `79d00dacc9c6b2eb8358e286d943de38e9528f56e1d4fe29d49c9a00c68014a5`; failed Devils hierarchy `83dfcc308d84c8c6cbeef0a56778d89cff7a7dbf9a14cea7f814d98da2bdf8d5`; failed Devils screenshot `6158beb726e280bbba10b3b49f194a569723f2003a2d1a82fd8545e5d2ca7c49`.
- Open P0/P1: **P1 — canonical Recreation.gov campground selection can still crash Map before the shared campground sheet appears.** Production promotion is blocked.
- Task-owned EAS, Expo, Metro, Gradle, Maestro, test, Railway, and screen-recording processes: none. The preview publisher and focused tests exited.

### Exact next action

1. Read the fixed phase code from the existing Sentry event or add a locally observable fixed phase only if Sentry access remains unavailable; do not include identity, coordinates, route geometry, search text, or arbitrary exception text.
2. Use that phase to isolate the next unguarded optional-array/function call in the canonical Search V2 camp path. Add the exact Devils Garden resolved-result/detail fixture before changing code.
3. Apply one evidence-backed correction in a new packet, then rerun only canonical Devils Garden selection. If it passes, publish the identical SHA to iOS and perform one shared assertion before reconsidering production.

### Do not repeat

- Do not rerun Portal Dispersed Camp, Kirch Flat, broad Camp/Explore/Map crawls, Memory, Layers, NPS, Trails, Originals, Android Auto, or store work without new evidence.
- Do not weaken database-first rendering, change the serving index, refetch NPS, publish production, or expose public stages while this P1 remains.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Valhalla work, Android helper-script changes, or unrelated files.

## Active continuation pointer — 2026-08-01 02:32 CDT

- The newest completed packet is `Primitive-only campground Peek tested; broader render P1 remains` at source `4cf74da1483389e9c2fd3397ba0a13d32a3eb9c2`, not the older `22d0b603` section that follows earlier in this append-only history.
- Android update `019fbc37-48c5-7794-9208-c94ecfb33fe9` reproduced `map_camp_peek_render` for canonical Devils Garden after the primitive-only boundary. Production remains blocked.
- Exact next action: obtain the symbolicated Sentry stack using Android debug ID `648a7aa7-3266-43ce-8e4c-43ab88021401`, then fix only the proven failing expression. Do not repeat another model/sheet guess or broad crawl.

## Primitive-only campground Peek tested; broader render P1 remains — 2026-08-01 02:31 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; exact implementation HEAD `4cf74da1483389e9c2fd3397ba0a13d32a3eb9c2`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. `.cursor/` and both protected files remain unstaged.
- Commit `4cf74da1` added `CampPeekPresentationV1`, an explicit primitive-only boundary containing stable identity, test ID, title, metadata, site type, inventory, fee, and saved state. `CampPlaceSheetPeek` no longer accepts `PlaceSheetModel`, `CampsitePin`, `SearchResultV2`, provider metadata, media, arrays, or the raw canonical result.
- The exact canonical Devils Garden Search V2 result, its resolved campground pin, nullable stored detail, and hostile null/object/array values now have focused fixtures. Nested source values are omitted rather than stringified into React children.
- `npm run test:campground-brief`, `npm run test:sheet-actions`, `npm run test:search-v2`, `npm run test:telemetry`, `npm run test:privacy-controls`, `npx tsc --noEmit`, and `git diff --check` passed. The only test adjustment was correcting the fixture's sourced tent classification from the mistaken expected `Campground` to the actual `Tent Sites`.
- Paired preview published from exact source `4cf74da1483389e9c2fd3397ba0a13d32a3eb9c2`: Android update `019fbc37-48c5-7794-9208-c94ecfb33fe9`, group `ae554ae3-1804-4bc8-b82d-3b0326b63d9c`, runtime `native-1.0.10-android.7`; iOS update `019fbc37-48c5-7055-899c-2f8ebdd68a0d`, group `316e9e9f-76ee-4eac-ba70-035ad0543dfd`, runtime `native-1.0.10-ios.6`. Android and iOS Sentry source maps uploaded with debug IDs `648a7aa7-3266-43ce-8e4c-43ab88021401` and `9407b75c-0e4c-4dc1-a5c2-274561b826bd`.
- Samsung `SM_A326U1` build `69` verified the exact source, preview channel, Android runtime, and update ID. One canonical search replay selected `place:ridb:234059`; it still reached the recovery boundary with fixed code `map_camp_peek_render`. Because the Peek subtree now receives primitives only, raw/nested provider data in `CampPlaceSheetPeek` is disproven as the cause. The phase code is broader than the component and still covers the shared snap-sheet wrapper and sibling selected-camp calculations.
- Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\camp-devils-4cf74da1`. QA identity XML SHA-256 `878a03ef1a43900f32e8e5b0e8b837e85dc39baf8641cf497ad7078814021900`; search-results hierarchy `2c2496546c028c94edf5c39fefd3c73bb22d7d03f0ed79f0d04b491985badf1b`; failed Peek hierarchy `2160684ea7256de4cecd81081624f9c8f793da20130bbf439ef04b421454b47b`; failed recovery screenshot `f68be7a05c5daf78bdbea22931af98310b90382b072853643e019bed3f2244f4`.
- Open P0/P1: **P1 — canonical Recreation.gov campground selection still throws inside the wider selected-camp render boundary before a usable Peek appears.** The identical iOS update was published but not spot-checked because Android did not pass. Production OTA, catalog promotion, and public-stage changes remain blocked.
- Task-owned EAS, Expo, Metro, Gradle, Maestro, test, Railway, and screen-recording processes: none. The paired publisher and focused tests exited.

### Exact next action

1. Use the already-uploaded Android source map and update/debug identity to read the symbolicated Sentry stack for this single reproduction. Do not make another UI-model guess.
2. Narrow the fixed phase around the shared `TrailheadSnapSheet` construction and the pre-sheet selected-camp action calculations only if the symbolicated stack remains unavailable.
3. Add the exact failing expression to the Devils Garden fixture, apply one evidence-backed correction, and rerun only Devils Garden. Test one different canonical developed campground only after Devils passes.
4. Publish/verify iOS from the identical accepted SHA before reconsidering production.

### Do not repeat

- Do not repeat primitive Peek extraction, provider-array normalization, hidden-Full deferral, Portal/Kirch crawls, broad Explore/Map/Trails work, Memory, Layers, NPS, Originals, Android Auto, or store work.
- Do not publish production, promote b08, refetch providers/NPS, weaken database-first rendering, or change public stages while this P1 remains.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Valhalla work, Android helper-script changes, or unrelated files.

## Canonical campground Peek boundary isolated — 2026-08-01 02:06 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; exact implementation HEAD `22d0b6031d9574e769284a9af6fcc452a5532414`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. `.cursor/` and both protected files remain unstaged.
- Commit `b3936c1d` made the existing privacy-safe phase code locally observable only for an authenticated preview administrator. No campground identity, coordinates, route geometry, search text, arbitrary exception text, or user/request data is logged or transmitted.
- Diagnostic paired preview: Android update `019fbc0a-b113-7067-bf65-3cb6c645d067`, group `f0db6f97-9f98-473f-9e44-bd79a9210116`, runtime `native-1.0.10-android.7`; iOS update `019fbc0a-b113-7eba-a04c-a033f3398711`, group `09dffb0e-e67e-42bf-9a66-663bc69c345e`, runtime `native-1.0.10-ios.6`.
- The exact canonical Search V2 selection `place:ridb:234059` deterministically reported `map_camp_peek_render`. This proves the exception happens before stored detail commit and Full rendering; the valid Recreation.gov detail payload and its nullable campsite/review/provider-notice arrays are not the immediate failing boundary.
- Commit `22d0b603` stopped the Peek state from eagerly constructing the hidden Full sheet tree. Fifteen focused campground, presentation, telemetry/privacy, and sheet-contract tests passed, as did TypeScript and whitespace checks. This is retained because it removes unnecessary hidden work for every campground and preserves the intended Peek-first contract.
- Corrected paired preview: Android update `019fbc1f-d994-7ea6-82c9-691b0a9baa87`, group `69de7f8c-1045-4c22-9914-fa5da11bbf97`, runtime `native-1.0.10-android.7`; iOS update `019fbc1f-d994-7d7b-ad74-b2307d59a373`, group `9b404e1a-14ee-4d25-a518-5db3f6f00990`, runtime `native-1.0.10-ios.6`. Samsung build `69` verified exact source `22d0b6031d9574e769284a9af6fcc452a5532414` and the Android update ID.
- The one allowed corrected Devils Garden replay still failed with `map_camp_peek_render`. The remaining P1 is therefore confined to the canonical Peek presentation/header/model path, not the hidden Full tree. Per the packet rule, no second speculative correction, second replay, different-camp crawl, production OTA, catalog promotion, or public-stage change was attempted.
- Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\camp-devils-22d0b603`. QA identity XML SHA-256 `692b586f76d8f9bdfdc75a2673ef6547ad8a6c64cdbbd6fa1ca737b9f9b8af13`; failed Peek screenshot `dcce56f5a3e9d6134ecba11a14bf619d7926b9d2bf0a0f8fb9363d70a935f084`; failed Peek hierarchy `c94887e585a3f837f2972c2fbe4eb6480ee1861cf50d511650def7be8843b065`; fixed-code log `8619aac57832e706e24bd75f7a9c5430e453f225e25a1a5426aa542b1247b212`.
- Open P0/P1: **P1 — a canonical Search V2 campground can fail while constructing the immediate shared Peek.** Confirmed for Devils Garden. Portal Dispersed Camp and Kirch Flat use different source/selection shapes and previously passed; no claim is made that every developed campground fails.
- Task-owned EAS, Expo, Metro, Gradle, Maestro, test, Railway, and screen-recording processes: none. The preview publishers and focused tests exited.

### Exact next action

1. Add the exact resolved Search V2 result-to-camp-pin fixture for `place:ridb:234059`, not only its stored detail fixture.
2. Extract a pure primitive-only `CampPeekPresentationV1` from the selected camp, including stable identity, saved state, title, metadata, site type, inventory and fee. The Peek subtree must not receive or inspect the raw canonical result object.
3. Unit-render that Peek model and test null/object/array variations before changing the Map call site. Apply one bounded correction, then replay only Devils Garden Peek → Full and one different canonical developed campground if Devils passes.
4. Keep production blocked until Android passes and the identical iOS SHA receives the shared assertion.

### Do not repeat

- Do not repeat the phase instrumentation, nullable-detail normalization, hidden-Full deferral, Portal/Kirch crawls, broad Explore/Map/Trails work, Memory, Layers, NPS, Originals, Android Auto, or store work.
- Do not refetch providers, weaken database-first behavior, overwrite the serving index, publish production, or change public feature stages while this P1 remains.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Valhalla work, Android helper-script changes, or unrelated files.

## Active continuation pointer — 2026-08-01 02:32 CDT

- The newest completed packet is `Primitive-only campground Peek tested; broader render P1 remains` at source `4cf74da1483389e9c2fd3397ba0a13d32a3eb9c2`, not the older `22d0b603` section immediately above in this append-only history.
- Android update `019fbc37-48c5-7794-9208-c94ecfb33fe9` reproduced `map_camp_peek_render` for canonical Devils Garden after the primitive-only boundary. Production remains blocked.
- Exact next action: obtain the symbolicated Sentry stack using Android debug ID `648a7aa7-3266-43ce-8e4c-43ab88021401`, then fix only the proven failing expression. Do not repeat another model/sheet guess or broad crawl.
## b08 campground source hydration remains blocked - 2026-08-01 14:47 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; exact implementation HEAD `3309b29ce913de18f3930f853f17dfe38ce18b55`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. `.cursor/` and both protected files remain unstaged.
- Backend source `d79ecf121e2abeeffd93b2738492e3b01fd03bb9` is deployed in Railway deployment `841d4e87-78f6-418e-ada3-3910db4e5762`, which reached terminal `SUCCESS`; `/api/health` returned `status=ok`. `TRAILHEAD_EXPLORE_DATA_STAGE` remains `internal`, and the live authorization boundary still requires an authenticated administrator plus `X-Trailhead-Explore-Preview: internal`.
- Commit `3309b29c` accepts durable reviewed agency place IDs in the campground detail identity adapter and separates Inventory from Fee. Focused campground, sheet-action, Search V2, copy, privacy, TypeScript, and whitespace checks passed.
- Android preview update `019fbed7-830d-7364-95b8-db68d32131b8`, group `a9105c31-7eec-4344-aef2-0fb43fe4064a`, runtime `native-1.0.10-android.7`, was published from exact source `3309b29ce913de18f3930f853f17dfe38ce18b55`; Android Sentry source maps uploaded successfully.
- Samsung `SM_A326U1`, app version `1.0.10`, build `69`, verified the exact source, preview channel, Android runtime, and update ID. Exact Search V2 selection `place:ridb:10182463` opened Kirch Flat Group Campground without a Map crash, blank frame, sheet-family swap, or identity flash. Peek now shows `Inventory: Not listed` and `Fee: Not listed`; the former duplicated `Reservable` fee is fixed.
- The Full sheet still remains bound to `Recreation.gov` and does not hydrate the reviewed US Forest Service identity or official fee text. The b08 RIDB-to-USFS replacement therefore is not reaching the canonical Search-to-detail path. This is a deterministic remaining P1, not a rendering failure.
- Per the one-correction/no-loop rule, no second campground correction, different-camp crawl, iOS publication, production OTA, catalog promotion, serving-index mutation, NPS refetch, or public-stage change was attempted.
- Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\explore-b08-camp-fix-3309b29c`. QA/Map identity hierarchy SHA-256 `9efcc55262752a4b91b081a5fa0d8cf2cf4d659c3d38c7e61e89d71f1cab5d96`; Kirch result hierarchy `505b588690a3c7dfabbe4e277e8c0fe2c2dddfb31e9f35f1d186905d4e4352fc`; Peek hierarchy `ac560fb13e409c7c85f3db3a50839c247a1c60351c0f3313971349efc29ef582`; Full hierarchy `9634440d363d43dc2b9912638e09d465304cd5c8f2d28bb8d806e496a471c8ea`; Peek screenshot `9bdc0c926f652e3d955f2cae97af51a5c29b86f49103d502949908c0df9553fe`; Full screenshot `0d00f6b51d2fb94f510f8db83d8561224a2eed54a5fc7e62e71e77a8edeb9549`.
- Open P0/P1: **P1 - reviewed b08 campground replacement data is bypassed by the canonical Search V2 detail path.** iOS remains on the previous accepted preview until Android passes this assertion.
- Task-owned EAS, Expo, Metro, Gradle, Maestro, test, Railway, and screen-recording processes: none.

### Exact next action

1. Trace `place:ridb:10182463` through the Search V2 canonical resolver and internal-preview merge to the reviewed b08 replacement identity. Prove where the replacement is lost before changing presentation code.
2. Add an exact Kirch Search result plus internal-preview replacement fixture and require one source-preserving canonical ID/detail response.
3. Apply one backend/data-selection correction, deploy compatibility first, then rerun only Kirch Peek to Full. Test one other reviewed replacement only after Kirch passes.
4. Publish the identical accepted SHA to iOS and perform one shared assertion before marking b08 accepted.

### Do not repeat

- Do not repeat the Camp Peek fee correction, earlier canonical camp crash work, broad campground/Explore/Map crawls, Memory, Layers, Trails, NPS fetch/research, Originals, Android Auto, or store work.
- Do not weaken database-first rendering, fabricate fee/source facts, overwrite the protected serving index, publish production, or change public stages while this P1 remains.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Valhalla work, Android helper-script changes, or unrelated files.

## b08 canonical campground alias implementation checkpoint - 2026-08-01 16:53 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; pre-change HEAD `33d81ffff1b2f5634d22d8f639ae62731ad18de8`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Baseline backend remains source `d79ecf121e2abeeffd93b2738492e3b01fd03bb9`, Railway deployment `841d4e87-78f6-418e-ada3-3910db4e5762`, terminal `SUCCESS`. Baseline Android preview remains update `019fbed7-830d-7364-95b8-db68d32131b8`, group `a9105c31-7eec-4344-aef2-0fb43fe4064a`, runtime `native-1.0.10-android.7`, exact mobile source `3309b29ce913de18f3930f853f17dfe38ce18b55`.
- Root cause is proven: Search V2 returned the public RIDB canonical identity `place:ridb:10182463`; campground detail then selected that earlier public record before the appended reviewed b08 USFS alias. No presentation or live-provider fallback caused this P1.
- Implemented request-local authenticated preview remapping for Search V2 suggest, results, and resolve. It changes only the returned model after the shared service/cache page is built; the process-global Search index, page cache, public order, and public catalog remain unchanged.
- Internal campground detail now preserves the historical first public match, selects one unique reviewed alias, and fails closed to public data when multiple reviewed records claim the same upstream identity. Public detail exits on its first match and does not scan the remaining catalog.
- Search remapping derives identity, source, title, and coordinates directly from the bounded reviewed profile rather than scanning/deep-copying the full catalog per result. Request-local Explore merges deep-copy both cached input graphs before applying legacy wrapper metadata, preventing future sidecars from mutating shared public or preview caches.
- Mobile Search sends the internal-preview header only when an Authorization header exists and the build is explicitly internal/preview. Search controllers are recreated and stale visible state is suppressed when the account-storage epoch changes, so admin-only rows cannot survive an account transition.
- Exact fixtures now match accepted b08 data. Kirch Flat is Forest Service-led, non-reservable, has no approved photo, uses the official Forest Service URL, and carries the reviewed fee, capacity, water, restroom, phone, and season facts. Mammoth Pool covers the complementary source-backed reservable path and retains its Recreation.gov booking URL while Forest Service remains primary.
- Focused verification passed: 95 backend tests plus 17 subtests across internal preview, Search V2, campground operational depth, and canonical serving; campground brief/presentation; Search V2 mobile contracts; functional preview-header rules; account-scope cache isolation contract; privacy controls; copy audit; TypeScript; and scoped whitespace checks.
- Intentional implementation files: `dashboard/server.py`, `tests/test_explore_internal_preview.py`, `tests/test_search_v2.py`, `mobile/lib/api.ts`, `mobile/lib/explorePreviewAuth.ts`, `mobile/lib/searchV2/appClient.ts`, `mobile/lib/searchV2/react.ts`, `mobile/lib/__fixtures__/kirchFlatCampground.ts`, `mobile/lib/__tests__/campSheetPresentation.test.ts`, and `mobile/lib/__tests__/exploreInternalPreview.test.ts`. This checkpoint is the only additional intentional file.
- Open P0/P1: the original P1 remains open only until the committed backend and Android preview pass the exact Kirch Flat and Mammoth Pool device assertions. No iOS publication, production OTA, catalog promotion, NPS refetch, or public-stage change has occurred.
- Task-owned Railway, EAS, Expo, Metro, Gradle, Maestro, pytest, screen-recording, or NPS-enrichment processes: none. The connected ADB server remains available for the bounded Android delta.

### Exact next action

1. Commit only the named implementation/checkpoint files and push the branch.
2. Deploy that immutable SHA from a clean detached worktree. Require Railway terminal `SUCCESS`, public health `status=ok`, and the unchanged authenticated-admin-plus-header boundary.
3. Publish one Android preview OTA from the same clean SHA with Sentry source maps. Verify source, runtime, group, and update identity.
4. Run Search -> Kirch Flat Peek -> Full once, then Mammoth Pool once. Require stable identity, Forest Service primary source, exact reviewed facts, no fabricated media, and the valid Mammoth booking action.
5. If Android passes, publish the identical SHA to iOS and perform the shared spot check. Otherwise record the one deterministic remaining assertion and stop.

### Do not repeat

- Do not repeat broad campground, Explore, Map, Search, NPS, Trails, Memory, Layers, Originals, Android Auto, or store crawls.
- Do not refetch b08/NPS data, mutate the serving index, fabricate media or fees, reintroduce a live initial-detail dependency, or promote any public stage.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Valhalla files, Android helper scripts, or unrelated dirty worktree files.

## b08 canonical campground aliases accepted on Android — 2026-08-01 17:22 CDT

- Branch: `feat/trailhead-1.0.10-overhaul`; exact implementation and preview source `2d5f9de6c461904e4667b3b9dba6aff538ac30c4`. Protected Explore-index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`; App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`. `.cursor/` and both protected files remain unstaged.
- Backend deployment `e3e37ed2-00a7-4eaa-81c9-2c186516033e` reached Railway terminal `SUCCESS`; `/api/health` returned `status=ok`. A request with the preview header but no bearer token returned `401`, preserving the authenticated-admin authorization boundary.
- Android preview update `019fbf59-81ed-7890-babc-065de79576a8`, group `7fe3e423-8126-4f11-b888-956a523d268d`, runtime `native-1.0.10-android.7`, build `69`, loaded exact source `2d5f9de6c461904e4667b3b9dba6aff538ac30c4` on Samsung `SM_A326U1`. The admin QA screen reported internal Explore request `active`, data `ready`, and `13` reviewed profiles.
- Kirch Flat passed the bounded device assertion. Search returned stable canonical ID `place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8`; Peek and Full remained `US Forest Service`, the reviewed fee rendered exactly, no booking action or fabricated photo appeared, the official-site and phone actions remained available, and no blank frame, identity swap, family swap, Map recovery boundary, or Retry flash occurred.
- Mammoth Pool passed the complementary assertion. Search returned stable canonical ID `place:usfs:usfs-sierra-sites-5f618db8-3fe8-4011-a735-18a738acfb43`; Peek and Full remained `US Forest Service`, the reviewed fee rendered exactly, no fabricated photo appeared, and the source-backed Recreation.gov `Booking` action remained available.
- The bounded device log contained no `FATAL EXCEPTION`, React Native JavaScript error, `MAP ERROR`, `TypeError`, `ReferenceError`, or unhandled-JS match during either flow.
- iOS preview update `019fbf6a-0717-73e6-9149-730a5242e957`, group `1c4725f5-0da6-4c1a-aba3-0a621f9ab882`, runtime `native-1.0.10-ios.6`, was published from the identical source. iOS Sentry source maps uploaded with debug ID `862b5bb6-fe37-48fe-a8b4-13154aa408b0`. The physical shared-flow spot-check remains pending because no iPhone was available to the desktop tooling.
- Evidence directory: `C:\Users\User\Documents\Codex\evidence\trailhead\explore-b08-alias-2d5f9de6`. QA preview screenshot SHA-256 `eb9913b42e08b416605b94b118c54c6df878453932ede5dfce4c957711fd4448`; Kirch search `2bb4b17f14ef5b8f060442ea08b8397f591bf20d48c40b1833e50fa25572fb47`; Kirch Peek `987f2fa9a74e56af02e235149a7e783ef3fb3c22009e8a3d4e7c56c08f6d242d`; Kirch Full `cc5eab8de31902b74144c58d1b7c8ec677717d6a9b00bf003a553103d3cfb5b5`; Mammoth search `a7d93da22fe98fd6786287f90ca8b2985123a401ee59c0ea03e274fe68056f22`; Mammoth Peek `e0dbe6834e651d41643cc4c9d2229a38fcc0116942e2cb52ba16594c2c236398`; Mammoth Full top `ef593b441f59403f51ebb81e27cabb96e83980a6e215a42559e6b3e96963b895`; Mammoth Full bottom `69084f687ff1423a2b161b75966e0bd1167a71ecb0e9466a3c9e4d25860fba17`.
- Open P0/P1: none for this Android packet. Remaining acceptance item: one shared Kirch or Mammoth iOS spot-check on the published identical SHA.
- Task-owned EAS, Expo, Metro, Gradle, Maestro, pytest, Railway-tail, screen-recording, and NPS-enrichment processes: none after publication completed.

### Exact next action

1. When an iPhone is available, load iOS update `019fbf6a-0717-73e6-9149-730a5242e957` and spot-check one reviewed campground from Search to Full; do not repeat Android or backend work.
2. After that shared assertion, mark b08 internally accepted and start the separate Explore data-gap packet from the existing b08 audit artifacts. Do not refetch b08 or overwrite the protected serving index.

### Do not repeat

- Do not repeat Kirch/Mammoth Android, broad campground, Explore, Map, Search, NPS, Trails, Memory, Layers, Originals, Android Auto, or store crawls without new evidence.
- Do not refetch b08/NPS data, mutate the serving index, fabricate media or facts, publish production, promote a public catalog/stage, or reopen the resolved alias path.
- Do not stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, `docs/app-store-copy.md`, Valhalla files, Android helper scripts, or unrelated dirty files.
