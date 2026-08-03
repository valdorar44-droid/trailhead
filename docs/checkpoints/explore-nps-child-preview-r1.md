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
- The first clean detached-checkout rehearsal exposed mixed tracked/local
  evidence aggregation (batches 2/3 are tracked while batch 1 is local-only).
  QA now validates each available batch against its fixed 156/170/131 slice;
  the exact clean-checkout assertion passes without changing the sidecar.
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

## Internal deployment and paired preview checkpoint

- Recorded: `2026-08-02T19:42:28-05:00`.
- Exact source: `3ec05aebe23bc64bf1f321d6b08b274ff927c1ea`.
- Railway deployment: `a6b68aa3-b929-4417-ab6e-dfb568ad5898`, terminal
  `SUCCESS`, image digest
  `sha256:e962674f7a4bfec1e9506478f1079b550899b34c846a0203626f86c470a6d42c`.
- Public health: `https://api.gettrailhead.app/api/health` returned HTTP 200
  with the expected Trailhead service response.
- Internal stage remained `TRAILHEAD_EXPLORE_DATA_STAGE=internal`.
- Header-only authorization remained fail-closed: the preview diagnostics
  endpoint returned HTTP 401 without an authenticated administrator. A public
  Featured request returned byte-identical data with and without the preview
  header, SHA-256
  `e3a4b7aeff7f06a570766c11ae35b6174fae35c5ad06dc98dcb98614a627308e`.

### Paired preview identity

- Preview channel ID: `019dbc97-3cde-795b-a35d-e6aa985060d3`.
- Candidate branch:
  `preview-candidate-3ec05aebe23bc64bf1f321d6b08b274ff927c1ea-mschl80l-e7b0051f2e5313d8c40e0d6f`.
- Android update: `019fc509-66b6-7747-9583-28c8e550eb0f`, group
  `cc48cab0-1bb2-436f-8534-254531c05fcb`, runtime
  `native-1.0.10-android.7`.
- iOS update: `019fc509-bce5-7c32-886c-4019d1b0611d`, group
  `ded30488-001a-4188-b1e6-f78af95a9a25`, runtime
  `native-1.0.10-ios.6`.
- Android Sentry debug ID:
  `437357d5-2e29-432b-8976-3f6be0ac3121`.
- iOS Sentry debug ID: `287a76c0-6c94-4903-8d6a-84d749f8b26b`.
- The guarded publisher validated both update records against the exact source
  and runtime before moving the preview channel.

### Device boundary

- The reusable Android preview APK is accepted build `69`, EAS build
  `3da6ed72-0eff-49f7-9cb5-e192d55a26ce`, SHA-256
  `7e753c2a1233625e7633ed0ac92fe9938cb07e8a85eab66a25c58d1cd3ca63d5`.
- It installed successfully over emulator build 68 without clearing app data.
  The emulator's retained account state was signed out, so the admin-only
  content assertion was not claimed and no access gate was weakened.
- Release exports, the accepted APK, and temporary emulator evidence were moved
  outside the worktree to
  `C:\Users\User\Downloads\TrailheadReleaseArtifacts\3ec05aeb`.
- Task-owned Metro, Gradle, Maestro, Expo/EAS publisher, pytest, and Railway-tail
  processes are none. The temporary emulator was stopped after the signed-out
  boundary was confirmed.

### Exact next action

1. On the signed-in administrator Samsung, apply Android update
   `019fc509-66b6-7747-9583-28c8e550eb0f` and open Great Smoky Mountains.
2. Run only Overview -> Stay -> one reviewed campground -> shared sheet -> Map
   -> Back. Confirm the 13 reviewed Stay campgrounds, exact imagery, stable
   return state, and diagnostics `active` / `ready` with 693 children.
3. After that one visible proof passes, build the zero-network
   `post-b09-nps-child-depth-b4` packet from the already accepted cached inputs:
   Hot Springs 24, Hovenweep 17, Indiana Dunes 26, Jewel Cave 11, and John Day
   Fossil Beds 19 (97 children total; expected preview total 790).

### Do not repeat

- Do not rerun the completed 693-child content audit, public-isolation suite,
  clean-checkout rehearsal, broad NPS crawl, or paired publication.
- Do not spend NPS quota for b10 before the cached B4 packet is reviewed.
- Do not include Isle Royale or Katahdin until their flat 36-child cap is
  replaced with an explicit completeness/pagination contract.
- Do not expose Community routes or internal NPS children publicly.
