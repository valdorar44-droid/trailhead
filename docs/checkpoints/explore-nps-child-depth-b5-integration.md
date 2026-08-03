# Explore NPS Child Depth Batch 5 — Internal Preview Integration

Recorded 2026-08-03 00:30 CDT (America/Winnipeg).

## Resume first

- Branch: `feat/explore-nps-child-depth-b5-integration`.
- Isolated worktree:
  `/home/sean/.openclaw/worktrees/trailhead-explore-nps-child-b5-integration`.
- Pre-integration HEAD: `d5d90e8f4a33916c4f7de763867a260af3ed4fc3`.
- Accepted implementation commit:
  `3137d9bcff9cab71dc10f09e941325f03ca91bde`.
- Accepted B4 integration base:
  `d1d997123be92602fb9252427d1cdf42854b9a93`.
- Scope: append the immutable 70-record B5 candidate after the 554 accepted
  B1-B4 depth records and before the 236 accepted contract records.
- This checkpoint has not deployed Railway, published a mobile OTA, changed a
  public catalog, changed a feature stage, or refetched NPS data.

## Protected scope

The following remain unstaged, unmodified by this packet, and must not be
discarded or overwritten:

- `.cursor/`
- `dashboard/explore_serving_index_v2.json`
- `docs/app-store-copy.md`

Current protected SHA-256 values in this integration checkout:

- Explore serving index:
  `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
- App Store copy:
  `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.

## Accepted input and forward-only rebuild

- Candidate: `post-b09-nps-child-depth-b5-r1`.
- Records: 70 across Capitol Reef, Great Sand Dunes, Crater Lake,
  Assateague Island, and Amistad.
- Modules: Stay 21, Visitor Information 10, Activities 6, See 19, Trails 14.
- Media: 64 approved exact assets and six reviewed text-only records.
- Canonical campground shadows: 20 unique identities; 13 reviewed
  Recreation.gov handoffs, including the Great Sand Dunes backpacking permit.
- Provider/network requests: 0.

The safe host cleanup removed old clean worktree checkouts that had exposed
ignored historical evidence. No accepted data was rebuilt or refetched. The
integration builder instead starts from the exact tracked B4 sidecar and fails
closed on its file hash, canonical content hash, record boundary, batch count,
and ordered identity hashes before appending the exact tracked B5 candidate.

Accepted B5 artifact SHA-256 values:

- `audit.json`:
  `d86d58c6b0f236297d3f606a1a053e61f25fe82c2ac69f0e4a339f4a84b70296`.
- `manifest.json`:
  `d9f7ed993c23051fb53e9bf47392c057fda8fed2833f4923e2a3aeea23054150`.
- `nps_child_depth_v1.json`:
  `e3c4d0763d3a2be8d84d462dc3f892a444cb98781eea0d4227dc1b1b3b2fa0da`.
- `review.json`:
  `8029b3434db17daf361d353a5c1c5148977921b7faffce8cf400c90ddfb052be`.

## Mounted sidecar

- Path: `dashboard/explore_internal_preview_v1.json`.
- Profiles: 13.
- Children: 860 = 624 reviewed depth children + 236 contract children.
- Immutable depth bindings: 5, exactly B1 through B5.
- File SHA-256:
  `278cd7fd74c17e432e44f80342d01e603944194cf6afc37396bfb0c4d0c87df3`.
- Canonical compact-payload SHA-256 pinned by the server:
  `8ada0d9d2eeca36b4f6a2d2d470f37dea0c93e5ea25c751cecdedc621f6f3ac2`.
- B5 ordered identity SHA-256:
  `88bda430a02369c51a533225c037bdfe17247ae4c14cbc096f92dba370aad6ac`.
- Accepted depth identity SHA-256 for B1 through B5:
  `b7f961ba1c07ce13c1742c4aeebeca641c294970d16aba1381b386b750c4ea9e`.
- Contract identity SHA-256:
  `ea23a5e4f3925195febc232f76ad7bd49ecc065437c970d25b7c8735e876f76e`.
- Combined ordered identity SHA-256:
  `a9e540ae649f3644dff5240d984a069b306d268ed44c1374a501a49b5c53aa75`.
- Two independent append builds were byte-identical.

## Runtime behavior

- The server fails closed unless the exact canonical payload hash, 13 parent
  profiles, 860 children, and five immutable depth bindings match.
- Public and header-only requests remain unchanged. Internal children still
  require the internal stage, an authenticated administrator, and
  `X-Trailhead-Explore-Preview: internal`.
- Canonical campground records retain their stored full sheets while the
  sidecar supplies exact parent/module, media, official link, and reservation
  context.
- Reviewed Recreation.gov campground and permit handoffs are accepted through
  a strict host/path allowlist. Other hosts and paths are rejected.
- Source-pack official URLs take precedence over stale top-level CMS links.
- Source-backed child records no longer receive generic access, season, nearby,
  or safety filler when the source did not supply those facts.
- B5 children remain hidden from Featured.

The bounded Android proof item is:

- `place:nps-child:grsa:thingstodo:df98997d-01fc-4016-a90c-53dbc7faae4d`
- `Sandboarding and Sand Sledding`
- Great Sand Dunes -> Activities
- Exact official source:
  `https://www.nps.gov/thingstodo/sandboarding-and-sand-sledding.htm`

## Verification

- Direct sidecar QA passed: 13 profiles, 860 children, five replacement
  records, six NPS proof parents.
- Data-quality audit passed uniqueness, parent integrity, module validity,
  booking allowlists, source links, media rights, copy, and deterministic
  ordering.
- Candidate and rebuild artifacts remain byte-identical.
- Focused integration suite: 68 passed, 3 skipped, 44 subtests passed.
- Additional campground operational-depth, official-enrichment, and internal
  preview regressions: 44 passed.
- Python compilation passed.
- Whitespace check passed.
- Open P0/P1 before deployment: none.

## Intentional files

- `dashboard/explore_internal_preview_v1.json`
- `dashboard/server.py`
- `scripts/build_explore_internal_preview.py`
- `scripts/qa_explore_b08_internal_candidate.py`
- `tests/test_explore_nps_child_internal_preview.py`
- `docs/checkpoints/explore-nps-child-depth-b5-integration.md`

## Exact next action

Commit and push only the intentional files. Deploy that exact clean commit to
the existing Railway production service while retaining the internal Explore
gate. Wait for terminal `SUCCESS`, verify `/api/health`, confirm header-only
access is rejected, and confirm authenticated diagnostics report 13 profiles,
860 children, and five bindings. Then run only this connected-Android proof:

Great Sand Dunes -> Things to Do -> Sandboarding and Sand Sledding -> shared
detail -> Show Area/Map -> Back.

## Do not repeat

- Do not refetch or rebuild B1-B5 or contract evidence.
- Do not repeat broad Explore/NPS, Search, Layers, Memory, Trails, Originals,
  Android Auto, or screenshot crawls.
- Do not modify the public catalog or protected serving index.
- Do not publish a mobile OTA for this backend/data-only packet.
- Do not begin another cached depth batch until B5 internal proof is accepted.

## Background processes

No task-owned Metro, Gradle, Maestro, Expo/EAS, Railway-tail, provider-fetch,
candidate-builder, pytest, or cleanup process remains running at checkpoint
creation.

## Forward checkpoint — Android module projection correction

Recorded 2026-08-03 01:03 CDT (America/Winnipeg).

- Starting HEAD: `0325639bcf85eebe59d86d9991982e9c24d92b21`.
- Railway deployment `30ca5144-8916-4d50-a588-c80e307c41fd` reached terminal
  `SUCCESS`; `/api/health` returned 200, a header-only preview request returned
  401, and the signed-in Android admin diagnostics reported `ready`, 13
  profiles, 860 children, and five bindings.
- Android evidence identity: app 1.0.10, build 69, preview runtime
  `native-1.0.10-android.7`, source `50f0f2b07302c2f7f4d32af8e762017f1be70883`,
  update `019fc5c1-4ffb-7712-9094-47ee93872fdb`.
- One bounded P1 was reproduced: Great Sand Dunes -> Things to Do showed cached
  trail rows while the valid semantic `activity` rows were filtered through
  keyword guessing. The accepted Sandboarding record and its backend parent
  projection were both present.
- The correction accepts canonical activity kinds without keyword guessing and
  keeps cached trail rows in the dedicated Trails module instead of relabelling
  them as Things to Do. No candidate data, public catalog, serving index, API,
  native input, permission, or runtime changed.
- Focused backend projection tests: 2 passed.
- NPS hub and internal-preview client tests: 24 passed.
- TypeScript: passed.
- User-facing copy audit: passed for 175 files.
- Whitespace check: passed.
- Protected hashes remain unchanged:
  - Explore serving index: `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - App Store copy: `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
- No task-owned background process remains running.

### Exact next action

Commit and push only the six correction/test files plus this checkpoint. Publish
one Android preview OTA, verify its source/update identity, and run only Great
Sand Dunes -> Things to Do -> Sandboarding and Sand Sledding -> detail -> Map ->
Back. If that passes, publish the identical SHA to iOS and record the paired
update IDs. Do not repeat broad Explore, NPS, Search, Layers, Memory, Trails,
Originals, Android Auto, or screenshot crawls.

## Completion checkpoint — reviewed child module ownership

Recorded 2026-08-03 02:13 CDT (America/Winnipeg).

- Starting HEAD: `912cb3f5c7501ba68b84cf7255a620fb9f9d8523`.
- Accepted correction commit: `f89c411e` (`fix(explore): honor reviewed child
  module ownership`).
- Installed Android identity used for the bounded proof:
  - App 1.0.10, build 69.
  - Runtime `native-1.0.10-android.7`.
  - Source `f968e40f8c910abbe12042e7dcf4b3da120c2249`.
  - Update `019fc644-adf9-7dab-b4ed-43cb3518ba06`.
  - Group `fe6d46a3-d2b4-43a4-8b89-3152283a7b55`.
- Railway deployment `6212afae-f9c0-448d-8f45-4d35726e81ff` reached terminal
  `SUCCESS`. `/api/health` returned 200 and a preview-header-only request
  returned 401.

### Evidence-backed cause and correction

The remaining eight-row live result did not come from Redis or Map Card. The
Explore detail endpoint projected the reviewed five Activities correctly, then
retained three legacy NPS `thingstodo` rows whose exact UUIDs had been reviewed
into the Trails module. The projector deduplicated only inside the current
module.

The correction now treats exact reviewed child identity as authoritative across
all modules. A legacy row assigned to a different reviewed module is removed;
unmatched official parent content remains. Cross-module title guessing is not
used. The empty-current-module edge is also covered so a park with reviewed
Trails and no reviewed Activities cannot retain the same legacy
misclassification.

Focused backend verification passed: 57 tests, 3 skipped, 44 subtests. Python
compilation and whitespace checks passed. An independent bounded review passed
privacy and over-filtering checks after the empty-module edge was added.

### Android result

Great Sand Dunes now renders:

- `Things to Do · 5 options`.
- `Explore the Dunes`.
- `Sandboarding and Sand Sledding`.
- `Experience the Night`.
- `4WD Medano Pass Primitive Road`.
- `Splash in Medano Creek`.

The three reviewed Hike records no longer appear in Things to Do. The earlier
bounded Sandboarding detail, exact NPS image/credit, Show Area, shared Map
sheet, and Back restoration proof remains accepted and was not repeated.

Evidence SHA-256 values:

- `trailhead-b5-fixed-hub-mid.png`:
  `9224169548774C2819A2A6DF40061062EEA0E1218AA3FF77FF17C9A213ABCE94`.
- `trailhead-b5-fixed-hub-mid.xml`:
  `107E0A09232AD3217652019AA90CD5DCBA5C9C367B35CE234491CC660C287EA1`.
- `trailhead-b5-fixed-do.png`:
  `31B5DF818BE3633FBF3C79301F7F16C7127CAC2E8182A4945F614699031FE7DC`.
- `trailhead-b5-fixed-do.xml`:
  `39F016C963F841B03646ABE6693F4EB6D8727DD9E013AC2473440B4C4663823B`.
- Final bounded list scan:
  `D7F9DF0910C9BAFFB63FBD8F5F3257EE4EFD754F8CA77B483AC1DDCD7D67C353`.

Protected hashes remain unchanged:

- Explore serving index:
  `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
- App Store copy:
  `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.

Open B5 P0/P1 defects: none. A separate cold-first-search Retry state was seen
before this backend proof and is deferred to the Search packet; the bounded
post-deployment search completed normally and it does not reopen this accepted
data packet.

### Exact next action

Publish the unchanged accepted mobile source as one paired preview update so
the existing Android client correction also reaches the iOS preview runtime.
Verify both update identities, record the update IDs, and stop. The next Explore
depth batch remains separate and must begin from this accepted checkpoint
without refetching or rebuilding B1-B5.

### Do not repeat

- Do not repeat Great Sand Dunes detail, Show Area, Map, or Back.
- Do not refetch or rebuild B1-B5.
- Do not repeat broad Explore/NPS, Search, Layers, Memory, Trails, Originals,
  Android Auto, or screenshot crawls.
- Do not modify the public catalog or protected serving index.

No task-owned Metro, Gradle, Maestro, provider-fetch, candidate-builder,
pytest, Railway-tail, or cleanup process remains running.

## Paired preview completion checkpoint

Recorded 2026-08-03 02:31 CDT (America/Winnipeg).

- Publication source and current HEAD:
  `b4d1d96c311789a288620c60ca108d86495b8740`.
- Guarded preview publication completed successfully after sequential Android
  and iOS exports, Sentry source-map uploads, paired runtime validation, and
  server-owned update evidence checks.
- Preview channel `019dbc97-3cde-795b-a35d-e6aa985060d3` now points to branch:
  `preview-candidate-b4d1d96c311789a288620c60ca108d86495b8740-mscwjfnp-6ff8d80356055ca71de4820b`.
- Branch ID: `019fc687-8f49-7874-b062-c00c2ab7e897`.
- Android preview update:
  - Runtime `native-1.0.10-android.7`.
  - Update `019fc687-ab97-7567-80d0-f62f03d00a85`.
  - Group `3b255b9f-c5c4-4c6f-85b0-42e47f42d9ec`.
- iOS preview update:
  - Runtime `native-1.0.10-ios.6`.
  - Update `019fc688-032d-7809-ba53-138ef4d13ef0`.
  - Group `6478d4ec-5063-4934-888e-04d9555e63ed`.
- Both update records report Git commit
  `b4d1d96c311789a288620c60ca108d86495b8740`.
- Android and iOS Sentry artifact bundles uploaded successfully. The Android
  bundle was already present; the iOS bundle was uploaded in this run.
- Protected hashes remain unchanged:
  - Explore serving index:
    `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`.
  - App Store copy:
    `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`.
- Open B5 P0/P1 defects: none.
- The cold-first-search Retry state remains deferred to its separate Search
  packet; it does not reopen this accepted data-depth packet.
- Generated export directories were removed after publication. No task-owned
  Metro, Gradle, Maestro, Expo/EAS, Railway-tail, provider-fetch,
  candidate-builder, pytest, or cleanup process remains running.

### Exact next action

Stop at this accepted B5 boundary. Begin the next Explore depth batch from
`b4d1d96c` in a separate checkpoint; do not refetch, rebuild, or re-audit B1-B5.
The next packet should add only a newly reviewed bounded batch and retain the
same internal-preview isolation until its data and device proof pass.

### Do not repeat

- Do not repeat the Great Sand Dunes module, detail, Show Area, Map, or Back
  proof.
- Do not repeat broad Explore/NPS, Search, Layers, Memory, Trails, Originals,
  Android Auto, or screenshot crawls.
- Do not modify the public catalog or protected serving index as part of this
  completed checkpoint.
