# Trailhead Welcome — 1.0.11 Production Checkpoint

## Freeze candidate

- Recorded: `2026-08-05T02:02:50-05:00`
- Branch: `release/trailhead-1.0.11-welcome`
- Release base: `f1b4bd98` (current 1.0.11 release line; live code tag `v1.0.11-b08-ota4` at `b8d9dc8b`)
- Welcome implementation: exact backport of accepted commit `d5ad339a`
- Candidate before this checkpoint: `192c9195`
- Native/config/dependency changes: none
- Runtime targets: `native-1.0.11-android.1` and `native-1.0.11-ios.1`
- Paired binary source: `0f7431d32088405f4c381ed1a220fcb2169ec761`
- Android production build: build 70, `723dca56-01a3-416b-a22d-98c838a849ee`
- iOS production build: build 62, `712109e9-6b7f-4f72-ab51-2aa42a6095da`

## Accepted behavior

- Licensed five-photo tilted collage with separate optimized phone and tablet composites.
- Trailhead orange mark and wordmark.
- Headline: `Plan routes. Find camps. Explore further.`
- Support copy: `Create unforgettable overlanding trips with maps, camps, and routes in one place.`
- `Get started`, `Explore first`, and `Sign in` routes.
- Four-step setup, exclusive `No preference`, optional rig form, and completion into Explore.
- Exact welcome code and asset blobs match the Android-approved preview payload.

## Evidence and gates

- Android-approved preview source: `9a321a1b5b36948d141e04d12842e0ddb7d5e8eb`
- Android-approved update: `019fd0a5-bd3c-7a05-8591-9e8bdffcadee`
- Android screenshot SHA-256: `b6867b9e446e6168c1212181d6285e9418380e4fcaad228b10c3b0a3606893a4`
- Welcome/first-run contract: pass.
- TypeScript: pass.
- User-facing copy audit: pass, 175 files.
- Privacy controls: pass.
- Native-compatible production OTA: pass.
- Production runtime matrix: pass.
- Production publisher CLI: pass.
- Release environment tests: pass.
- EAS build/update evidence tests: pass.
- Local Expo module resolution: pass, 6/6.
- Native/config drift: pass; environment-owned secrets are checked again inside EAS production environment.

## Production preservation

- Current production channel ID: `019dc26b-268a-794b-8aa8-3497b4d38487`.
- Rollback branch: `production-candidate-b8d9dc8b16883f97c6c44b15f33429dc4d4fb737-msbf24qt-6122bfe38d18bcbce0f06c2a`.
- Current 1.0.11 Android group: `875d2507-b754-46d8-b273-6df94c6c7693`.
- Current 1.0.11 iOS group: `eec5cdc9-0ac2-4b30-95b8-eaa5741c146d`.
- The guarded publisher must preserve all 11 groups / 14 runtime-platform pairs and replace only the current 1.0.11 pair.

## Protected state

The user-owned main-worktree files remain unstaged and unchanged:

- `.cursor/`
- `dashboard/explore_serving_index_v2.json` — SHA-256 `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- `docs/app-store-copy.md` — SHA-256 `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`

## Exact next action

Commit this checkpoint, run the production environment/prepreview gate once, tag the clean source, and invoke the guarded paired production publisher. After publication, record the new Android/iOS update IDs, candidate branch, Sentry artifacts, runtime coverage, and rollback command in a post-publish checkpoint.

## Do not repeat

- Do not publish the divergent 1.0.10 preview SHA directly.
- Do not rebuild native binaries.
- Do not rerun broad Map, Explore, NPS, Trails, Originals, Android Auto, Layers, or memory crawls.
- Do not modify the protected Explore index, App Store copy, or `.cursor/`.

## Production completion

- Published: `2026-08-05T02:31:26-05:00`
- Immutable tag/source: `v1.0.11-welcome-ota1` / `20fd29c7b1e9bbf1a8512ef4e7c1c26571fa7c4b`
- Production candidate branch: `production-candidate-20fd29c7b1e9bbf1a8512ef4e7c1c26571fa7c4b-msfrdi6s-2b45a7f107439bb4b4bb9089`
- Candidate branch ID: `019fd0d4-4cf5-7c24-917e-1d706b51e4f5`
- Production channel ID: `019dc26b-268a-794b-8aa8-3497b4d38487`
- Android update: `019fd0d4-67b5-7c2c-9107-00d08304e3db`
- Android group: `90a3a5d2-a7e7-4958-a1e1-39960f87dfda`
- Android runtime: `native-1.0.11-android.1`
- iOS update: `019fd0d4-bff6-7c4c-83ae-194ce98cde8b`
- iOS group: `2017bfc6-9b0b-4a2f-8560-a6f5db7bca1d`
- iOS runtime: `native-1.0.11-ios.1`
- Android Sentry artifact bundle: `13d9c0c7-98f7-5912-9984-fa1c140f63ba`
- iOS Sentry artifact bundle: `e5d08a83-5a09-5af0-aea3-bcb2e627cd42`
- Runtime coverage: exact match, 14 runtime-platform pairs.
- Live channel verification: production resolves to candidate branch ID `019fd0d4-4cf5-7c24-917e-1d706b51e4f5`.
- Previous production branch remains the immediate rollback target: `production-candidate-b8d9dc8b16883f97c6c44b15f33429dc4d4fb737-msbf24qt-6122bfe38d18bcbce0f06c2a`.
- Production publisher outcome: passed build ancestry, source/native-tree review, paired build evidence, sequential exports, Sentry uploads, paired update identity, legacy runtime preservation, and atomic channel promotion.
- Pre-production gate outcome: 980 backend tests, 135 subtests, Android Auto unit tests, TypeScript, native drift, copy/privacy, Explore, Offline, Originals, Trails, and whitespace all passed.
- Open P0/P1 defects: none in this packet.
- Background processes: none.

## Next action

Allow compatible 1.0.11 installs to receive the update on launch/relaunch. Resume the Great Smoky Mountains Original from its existing checkpoint; do not repeat Welcome, broad Explore, Trails, memory, Layers, Android Auto, or Originals lifecycle work without new evidence.

## Production completion ? OTA2 (Trip setup reopen)

- Published: `2026-08-07T02:57:14-05:00`
- Change: cherry-pick `ac0f6b47` of accepted `d10d0ef5` (reopen welcome screen from Profile > Settings > Trip setup); five changed files byte-identical to the feature-branch commit.
- Immutable tag/source: `v1.0.11-welcome-ota2` / `ac0f6b47d8acd6f1efd4415848b0fcdd04abecf8`
- Production candidate branch: `production-candidate-ac0f6b47d8acd6f1efd4415848b0fcdd04abecf8-msimxn3w-9ec984600c11c1f1deb4b648`
- Candidate branch ID: `019fdb31-8981-74cd-869f-db93e338952f`
- Production channel ID: `019dc26b-268a-794b-8aa8-3497b4d38487`
- Android update: `019fdb31-a028-7261-ab0b-78fbdc81258c`
- Android group: `e7bf9c98-b92e-4f03-9ba3-a391f4631fc6`
- Android runtime: `native-1.0.11-android.1`
- iOS update: `019fdb31-f100-7a54-92de-296b06516ca8`
- iOS group: `ec3e976a-5516-46a7-b0ba-580aa4e02a49`
- iOS runtime: `native-1.0.11-ios.1`
- Paired binary source (unchanged): `0f7431d32088405f4c381ed1a220fcb2169ec761` (Android build 70 `723dca56-01a3-416b-a22d-98c838a849ee`, iOS build 62 `712109e9-6b7f-4f72-ab51-2aa42a6095da`)
- Sentry debug IDs: Android `1bc74ad1-69c3-4bd9-a00b-f23c488d4d36`, iOS `cde37c03-626f-4b07-86ea-1482880361c5`
- Runtime coverage: exact match, 14 runtime-platform pairs (12 preserved legacy pairs plus the replaced 1.0.11 pair).
- Live channel verification: production resolves to candidate branch ID `019fdb31-8981-74cd-869f-db93e338952f`.
- Immediate rollback target (OTA1): `production-candidate-20fd29c7b1e9bbf1a8512ef4e7c1c26571fa7c4b-msfrdi6s-2b45a7f107439bb4b4bb9089` (branch ID `019fd0d4-4cf5-7c24-917e-1d706b51e4f5`).
- Pre-publish device evidence: physical Samsung SM-A326U1 (build 69 + preview OTA `019fdb0b`) confirmed signed-in reopen via Trip setup, Get started into setup wizard, and clean Later dismissal; evidence in `C:\Users\User\Documents\Codex\evidence\trailhead\welcome-1.0.11\samsung-physical-2026-08-07`.
- Focused gates in the release worktree: welcome/first-run contract, TypeScript, native-OTA compatibility, production runtime matrix, publisher CLI, and local Expo module resolution all passed. Publisher outcome: ancestry, native-tree equality, paired build evidence, sequential exports, Sentry uploads, paired update identity, legacy runtime preservation, and atomic channel promotion all passed.

## Next action

Allow compatible 1.0.11 installs to receive the update on launch/relaunch. To observe production delivery on the Samsung, install Android production build 70 (1.0.11 runtime) and relaunch. Resume the Great Smoky Mountains Original from its existing checkpoint; do not repeat Welcome, broad Explore, Trails, memory, Layers, Android Auto, or Originals lifecycle work without new evidence.
