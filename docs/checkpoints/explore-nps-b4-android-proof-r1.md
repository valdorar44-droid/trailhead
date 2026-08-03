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
