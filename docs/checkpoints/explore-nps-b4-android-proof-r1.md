# Explore NPS B4 Android Proof R1

## Pre-change checkpoint

- Timestamp: `2026-08-02T22:29:39-05:00`
- Branch: `fix/explore-camp-map-camera-handoff-r1-win`
- HEAD: `d26aae28ff00163879f1310e8368de5b957aa68b`
- Installed Android candidate:
  - App `1.0.10` / build `69`
  - Runtime `native-1.0.10-android.7`
  - Source `cefc92f2c1036b3864f9a290ce4913191e436865`
  - Update `019fc565-c11d-745f-a727-678a675c9a28`
- B4 backend deployment:
  - Source `d1d997123be92602fb9252427d1cdf42854b9a93`
  - Railway deployment `208ba0e9-c9d3-40f9-9320-bc03969289a7`
  - Status `SUCCESS`
  - Health `/api/health` `200`
  - Internal diagnostics `active / ready / 13 profiles / 790 children`
  - Header without admin authorization returns `401`
- User-owned protected files in the main checkout remain untouched:
  - `dashboard/explore_serving_index_v2.json` SHA-256 `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
  - `docs/app-store-copy.md` SHA-256 `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`
  - `.cursor/` remains untracked and excluded.

## Bounded Android evidence

Completed path:

`Explore -> Hot Springs National Park -> What to See -> Hot Water Cascade -> detail -> Map`

Accepted observations:

- Hot Springs exposes 13 source-backed See places.
- Hot Water Cascade uses the exact official NPS image and place-specific description.
- The child detail is nonblank and stable, with semantic category `Waterfall`.
- Main Map centers the selected Arkansas place and preserves exact identity.

Open defects from the single run:

- P1: Android Back from the generic place sheet is consumed by `PremiumPlaceSheet`; it dismisses to ordinary Map instead of restoring the suspended child detail/list.
- P2: the map handoff prefers generic `kind=place` over semantic `category=Waterfall`.
- P2: the populated See list appends the park-level `Why Go` block beneath child cards.

Evidence:

- `C:\Users\User\AppData\Local\Temp\hosp-see6.png`
  - SHA-256 `dd890d4f33debc3c809ba8ddf027877433ef3946395f7534121efb6582d881dd`
- `C:\Users\User\AppData\Local\Temp\hwc-detail.png`
  - SHA-256 `1b64ff367da50d5630b3588c3be0c7dac7a15d42f2c0b52e0eee2a332471c51d`
- `C:\Users\User\AppData\Local\Temp\hwc-map2.png`
  - SHA-256 `f86e5e7624d1c564ff505b27fc20b6f0bc51e3f4f57e5aa1eec7b8dab264d144`
- `C:\Users\User\AppData\Local\Temp\hwc-back.png`
  - SHA-256 `ed8059c8536d32d50a28dfe314b993af955829995eeccec5a18680c9850c478f`

## Exact next action

Apply one JS-only, identity-bound Explore return-context correction and the two observed copy/category corrections. Run only focused unit/copy/type gates, publish one paired preview OTA, and repeat the Hot Water Cascade Map/Back assertion once.

## Do not repeat

- Great Smoky/Abrams Creek accepted camera crawl.
- Broad NPS research or refetch.
- Memory, Layers, Yellowstone, Originals, Trail Builder, Offline, or Android Auto crawls.
- B4 data generation or deterministic rebuild.

Task-owned background processes: none.

## Completion — B4 accepted

- Timestamp: `2026-08-02T23:06:00-05:00`
- Implementation commit: `50f0f2b07302c2f7f4d32af8e762017f1be70883`
- Branch: `fix/explore-camp-map-camera-handoff-r1-win`
- Backend remains the accepted B4 deployment:
  - Source `d1d997123be92602fb9252427d1cdf42854b9a93`
  - Railway deployment `208ba0e9-c9d3-40f9-9320-bc03969289a7`
  - Terminal status `SUCCESS`; `/api/health` returned `200`
- Paired preview publication:
  - Preview candidate branch `preview-candidate-50f0f2b07302c2f7f4d32af8e762017f1be70883-mscoqo9y-cd597c66c9980558ff226602`
  - Android runtime `native-1.0.10-android.7`
  - Android update `019fc5c1-4ffb-7712-9094-47ee93872fdb`
  - Android group `7835dc26-ce4d-4121-aaca-808e6bb5b6ad`
  - iOS runtime `native-1.0.10-ios.6`
  - iOS update `019fc5c1-b044-7e10-a744-eb6cef1d19b6`
  - iOS group `891f109e-c176-4707-8480-3d9596731de0`
  - Both source maps uploaded to Sentry before channel promotion.
- Installed Android identity was verified through the admin QA screen:
  - App `1.0.10`, build `69`, channel `preview`
  - Full source `50f0f2b07302c2f7f4d32af8e762017f1be70883`
  - Update `019fc5c1-4ffb-7712-9094-47ee93872fdb`

Focused Android assertion completed once:

`Explore -> Hot Springs National Park -> What to See -> Hot Water Cascade -> Show Area -> hardware Back`

Accepted results:

- Map sheet displays semantic type `Waterfall`, not generic `place`.
- Hardware Back restores the exact Hot Water Cascade child detail and retained child/list context.
- Explicit Close remains dismiss-to-Map behavior.
- Populated What to See no longer appends parent-level `Why Go` copy.
- No blank frame, crash, identity swap, sheet-family swap, or stale selection occurred.

Evidence:

- `C:\Users\User\AppData\Local\Temp\b4-hwc-map-fixed.png`
  - SHA-256 `ebd173f7295fe79bba372b2d3defa874b2e1309d03b0c20447354abb24618a9b`
- `C:\Users\User\AppData\Local\Temp\b4-hwc-back-fixed.png`
  - SHA-256 `a36fa01b23438bf69885e57fa9427050dbdfd8bce4ce0937e646f44c562e636e`
- `C:\Users\User\AppData\Local\Temp\b4-hwc-map.xml`
  - SHA-256 `ab14919ae274d5026e4f77ab1ad326125429e78ea77e7af70b6f6e18db6bab8f`
- `C:\Users\User\AppData\Local\Temp\b4-hwc-back-fixed.xml`
  - SHA-256 `6a4b7363aed98424a3e3e1b472b43695d3b273a8681aaada730ba14e28723f43`

Focused gates passed:

- `explorePlaceMapReturn.test.ts`: 2/2
- `test:nps-hub-preservation`: 23/23 across its three files
- `test:sheet-actions`: 8/8 across its two files
- `audit:copy`: 175 files
- `npx tsc --noEmit`
- `git diff --check`
- Independent read-only patch audit: no blockers

Protected main-checkout files remain unchanged:

- `dashboard/explore_serving_index_v2.json` SHA-256 `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- `docs/app-store-copy.md` SHA-256 `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`
- `.cursor/` remains excluded.

Open P0/P1 defects: none for B4.

Exact next action: prepare and audit B5 from its already-inspected 70-candidate set, beginning with Great Sand Dunes and the real `Sandboarding and Sand Sledding` child path. Keep B5 internal until its own deterministic data audit and Android proof pass.

Do not repeat:

- Hot Springs/Hot Water Cascade B4 proof.
- B4 backend generation or Railway deployment.
- Broad NPS refetch, Memory, Layers, Yellowstone, Originals, Trail Builder, Offline, Android Auto, or store screenshot work.

Task-owned background processes: none after removing the temporary release worktree.
