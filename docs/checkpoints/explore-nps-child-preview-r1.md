# Explore NPS Child Internal Preview R1

## Baseline checkpoint

- Recorded: `2026-08-02T18:10:00-05:00`.
- Branch: `feat/explore-nps-child-preview-r1`.
- HEAD: `7e0ec3e927295008d152b99708741d18f20712ca`.
- Parent contract: `post-b08-nps-child-contract-r1`, implementation
  `e7f8eb0d9d6a99a90a4ae2812761b474605fe419`.
- Scope: add the accepted 236 materialized NPS child candidates to the existing
  authenticated, admin-only Explore preview sidecar. Existing 157 public legacy
  child IDs remain authoritative; their proposed aliases are advisory in this
  packet and must not replace working saved/deep-link identities.
- Delivery: backend/internal preview only. No public catalog/index mutation,
  public feature-stage change, OTA, native build, or broad device crawl.
- Task-owned Gradle, Metro, Maestro, Expo, test, and builder processes: none.

### Protected user files

Never stage, overwrite, or discard:

- `.cursor/`
- `dashboard/explore_serving_index_v2.json`, SHA-256
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- `docs/app-store-copy.md`, SHA-256
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`

### Pinned contract evidence

- Contract manifest:
  `89ba6376343c593f978d05061eef47bcd9aac8bae23b0de428286bd562032e6d`
- Contract places:
  `a4a6db4becb705d43351e820c7a61f8bb335dde4244a19adfcce1c384ad0046a`
- Contract audit:
  `01e7953e0ac50b51f047872661dd4cb97fe23c82be772c7dcb50ae070674f639`
- Contract review:
  `9166f08cd27aa7f141ea4f460795c891328bb978dd85dced47c8b1cdab3bcdc8`
- Dispositions:
  `4dc8a35e56774df88fdd2ca0aa557b8f76f91be8b73311784251d9a302591518`
- Tracked identity lock:
  `d5aad97024b47c4d47fe353e9781391343c8e8fd83f7c9bdab35f7f9b0ed3508`

## Exact next action

Extend the existing `explore_internal_preview_v1.json` builder with one
strictly hash-pinned contract loader. Append the 236 nonduplicate records after
the existing 457 child records, keep every child hidden from Featured, preserve
parent/module identity, and expose them only when the existing request context
has both authenticated admin authorization and
`X-Trailhead-Explore-Preview: internal`.

## Do not repeat

- Do not refetch or rebuild b06, b08, or b09 source data.
- Do not re-audit the 394 contract identities or the existing 457 child records.
- Do not activate the 157 advisory aliases in the public catalog.
- Do not alter public ranking, Viator, Originals, Offline, ratings, comments,
  Trails, campground behavior, or native/mobile code.
- Do not deploy or run a device delta until the sidecar, public-isolation tests,
  deterministic build, and content checks pass.
