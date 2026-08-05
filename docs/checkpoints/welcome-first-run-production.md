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
