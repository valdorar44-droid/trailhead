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

## Implementation checkpoint

- Recorded: `2026-08-02T19:01:32-05:00`.
- Branch: `feat/explore-nps-child-preview-r1`.
- Pre-implementation checkpoint commit: `0cd5845c525c496bb9e02a3b5b9a90955200630d`.
- Delivery remains internal preview only. No public catalog/index mutation,
  production OTA, native build, public stage, or NPS refetch occurred.

### Completed

- Mounted the accepted 236 nonduplicate contract children after the existing
  457 reviewed children. The sidecar now contains 13 proof destinations and
  693 unique child records in immutable source order.
- Projected reviewed children into their parent hub modules without mutating
  public cached parents. All 13 Great Smoky Mountains Stay records remain
  reachable; the Acadia parent-title clone is omitted from the parent module
  and exact search while its direct identity remains addressable.
- Preserved exact child photo caption, credit, license, source page, and rights
  state when projecting hub modules.
- Added exact internal-preview support for Map-card resolution. The client sends
  the preview header only for the exact resolver path and only under the
  existing authenticated preview-build guard; the server still requires an
  administrator account and internal stage.
- Bypassed the process-global mobile request cache for Map-card and Along Trip
  ranking in internal-preview builds, preventing admin preview responses from
  surviving logout/account switches or masking the reverse transition.
- Isolated preview Map-card reads/writes from shared caches and now reports
  `uncached` with a zero TTL for preview responses.
- Bound runtime loading to the exact reviewed canonical sidecar digest. Any
  parseable change to a parent, child, parent relationship, ordering, or batch
  binding fails closed and clears cached preview data.
- Made QA clean-checkout-safe: tracked sidecar plus tracked identity lock is
  sufficient, while locally present ignored evidence receives the stronger
  exact-file hash audit. Partial local evidence fails closed.

### Evidence

- Sidecar SHA-256:
  `5944e40499ec7d07cf3ef129aa1f6aec2a0923a82b171023105cc709017a360e`.
- Canonical runtime content SHA-256:
  `6f25c74687e694b3c39832cd77b58cb687491551924ce47d98133ca5b5b8c784`.
- Sidecar QA: 13 proof destinations, 693 children, five reviewed replacements,
  six NPS proof hubs, passed.
- Internal-preview and child integration: 44 passed plus four parameterized
  mutation checks.
- Promotion/Search regression: 110 passed plus 21 parameterized checks. Two
  legacy fixture assertions initially lacked the now-required explicit
  non-promotable flag; the fixture was corrected and both assertions passed.
- NPS/source/serving regression: 93 passed directly. Five database-backed
  assertions initially ran before test-schema initialization; after normal
  `init_db()` setup, all five passed.
- Copy/content quality: 13 passed.
- Mobile preview-header contract: 9 passed.
- Full mobile TypeScript: passed.
- Python compilation and `git diff --check`: passed.
- Independent review findings for exact Map-card header scope, canonical
  content binding, preview cache isolation, and media-rights preservation are
  implemented and covered.

### Protected state

- Main-workspace Explore index SHA-256 remains
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- Main-workspace App Store copy SHA-256 remains
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- `.cursor/`, the protected Explore index, and App Store copy were not staged
  or changed.
- Task-owned Gradle, Metro, Maestro, Expo, pytest, Railway-tail, and builder
  processes: none.

## Exact next action

Commit and push only the named implementation and checkpoint files, verify the
commit from a clean checkout, deploy the backend with internal stage only, wait
for Railway terminal `SUCCESS`, verify health plus public/header/admin isolation,
then publish one paired JS-only preview update for the exact Map-card header and
run only the bounded admin Explore child-to-sheet-to-map delta.

## Do not repeat after this checkpoint

- Do not refetch b06, b08, b09, or the accepted contract data.
- Do not rerun broad NPS research, Map, Layers, Search, Trails, Originals,
  Android Auto, Memory, or screenshot crawls.
- Do not activate the 157 advisory aliases or expose children in Featured.
- Do not promote this sidecar to a public catalog or production channel.
