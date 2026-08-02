# Trailhead 1.0.11 Explore return production checkpoint

Pre-device checkpoint created 2026-08-02 (America/Winnipeg).
Device acceptance recorded 2026-08-02T01:07:55-05:00.

## Scope

- Production baseline: `c115579341fbd68dd61495b18e620cc6992ab0d2`
  (`v1.0.11-b08-ota3`).
- Release branch: `release/trailhead-1.0.11-explore-return`.
- Accepted Android preview source:
  `d9e58592ed29d5857236d555bdbd73baadceec87`.
- Backported implementation commit:
  `756d8ef9` (`fix(explore): restore search context from campground map`).
- Intended mobile change: a direct Explore campground search clears an older
  destination-hub return context before opening the Map. Hub-child campground
  flows continue to restore their parent hub.

This packet does not include the internal NPS candidate data, catalog
promotion, native code, app configuration, dependencies, permissions,
entitlements, bundled assets, runtime identifiers, or a new binary.

## Corrected Android evidence

The previously reported post-Back black frame was an evidence-viewer artifact.
The two stored 720 x 1600 PNGs differ in only 127 status-bar pixels (0.011%);
their application content is identical and fully rendered. Focused logcat is
empty. No Mapbox renderer or lifecycle change is warranted.

The Android behavior already accepted on the preview is:

1. Search `Chisos Basin Campground` from Explore.
2. Open the canonical campground Peek and Full sheet.
3. Press Back.
4. Return to Explore home without restoring the older Guadalupe hub.

## Focused automated result

- Explore Search V2 routing: 5 passed.
- Campground identity: 6 passed.
- Campground sheet flow: 9 passed.
- Campground presentation: 8 passed.
- Sheet actions: 6 passed.
- Sheet coordinator: 2 passed.
- TypeScript: passed.
- `git diff --check`: passed.

Open P0/P1 at this checkpoint: none.

## Focused iPhone production-baseline acceptance

The connected iPhone is running the existing public 1.0.11 production binary
and its current production-compatible update. It does not yet contain the
candidate Explore return-context patch, so that exact corrected path will be
checked after publication rather than misreported as pre-publication evidence.

The bounded shared-flow baseline passed:

1. A Map-opened campground closed with X back to the Map, as intended.
2. Plan retained its exact scroll position through Manage offline downloads.
3. The owned `Moab: Canyons to the Sky` Original opened with correct artwork,
   ownership/download state, and no blank or flashing presentation.

No broader iOS crawl, reinstall, account reset, or Originals lifecycle run was
performed.

## Native compatibility evidence

- Approved iOS production build: `712109e9-6b7f-4f72-ab51-2aa42a6095da`,
  runtime `native-1.0.11-ios.1`, source `0f7431d32088405f4c381ed1a220fcb2169ec761`.
- Approved Android production build: `723dca56-01a3-416b-a22d-98c838a849ee`,
  runtime `native-1.0.11-android.1`, source `0f7431d32088405f4c381ed1a220fcb2169ec761`.
- The release candidate changes no Android/iOS native project, application
  config, dependency field, permission, entitlement, plugin, runtime ID, or
  bundled native asset.
- Local EAS fingerprint comparison differs from the binaries only in the
  already-approved package test scripts and platform directory fingerprint
  representation allowed by the guarded publisher. The candidate adds no new
  native-input difference beyond the current production OTA baseline.

## Protected scope

The clean production worktree contains none of the user-owned `.cursor/`,
`dashboard/explore_serving_index_v2.json`, or `docs/app-store-copy.md` changes.
Those paths must not be staged, overwritten, or imported from the primary dirty
worktree.

## Exact next action

Commit this accepted checkpoint, run the release compatibility and pre-preview
gates once, tag the exact clean SHA, and promote it through the guarded 1.0.11
production publisher while preserving every legacy runtime group. After the
iPhone receives the update, verify only the corrected Explore search return.

## Do not repeat

- Do not repeat NPS data generation, broad Explore, Map, Layers, Search,
  Originals, Trails, Memory, Android Auto, or screenshot crawls.
- Do not switch RNMapbox to TextureView for a viewer artifact.
- Do not merge the divergent 1.0.10-overhaul native/config tree into this
  1.0.11 production descendant.
