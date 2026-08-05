# Trailhead Welcome + First Run — Active Checkpoint

Last updated: 2026-08-05 (approved implementation checkpoint)

## Resume protocol

Read this file before continuing the Welcome/first-run packet. Do not repeat the production-screen audit, Figma exploration, licensed-photo selection, or responsive design work unless new evidence invalidates it.

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Confirm HEAD and protected hashes below before editing.
3. Never stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, or `docs/app-store-copy.md`.
4. Continue from **Next exact action**.

## Source and protected state

- Branch: `feat/trailhead-1.0.10-overhaul`.
- Baseline checkpoint commit: `c569e83d65d2210ee53641c335b4626dd7250fce`.
- Approved welcome implementation: `d5ad339a` (`feat(onboarding): rebuild first-run welcome`).
- Release-guard correction: `65964b7d` (`test(release): align drift guard with staged exports`).
- Smokies S2 remains checkpointed at `4e8b98da` and is not part of this packet.
- Existing protected dirty state remains intentionally unstaged:
  - `M dashboard/explore_serving_index_v2.json`
  - `M docs/app-store-copy.md`
  - `?? .cursor/`
- Protected hashes:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`

## Accepted implementation

- The welcome screen preserves the production character: full-screen, slightly tilted editorial photo tiles with no visible card.
- Actual Trailhead orange mark and Barlow Condensed wordmark.
- Approved copy:
  - `Plan routes. Find camps. Explore further.`
  - `Create unforgettable overlanding trips with maps, camps, and routes in one place.`
- Action order: `Get started`, `Explore first`, `Sign in`.
- Primary action is white; secondary is a restrained translucent outline; all targets are at least 48 dp.
- Four primary setup questions remain, with the full rig form as an optional grouped step.
- Added Suspension options: Stock, Leveling Kit, Lift Kit, Coilovers, and Long Travel.
- The visible no-op Offline preference is removed while old stored `downloads` values remain compatible.
- Profile replay opens setup directly and Back/Later preserves an already completed setup.
- The Profile-only walkthrough now describes current Explore, Map, Plan, Offline, and Profile ownership accurately.
- No native dependency, permission, runtime, config, public API, or schema changed.

## Licensed assets and Figma

- Figma file: `FJUcMWAfsNyjsguCEp2dBe`.
- Page: `Welcome + First Run — 1.0.11`.
- Approved masters:
  - Phone `845:2666`
  - Compact `848:2682`
  - Tablet `848:2666`
- Shipping composites:
  - `mobile/assets/onboarding-welcome-production-phone.jpg`
    - 1050×2272, 237240 bytes
    - SHA-256 `c34ec1a79aec567e95846ba48fa01ef18b045b07f22aacad5cafc48cb944c67b`
  - `mobile/assets/onboarding-welcome-production-tablet.jpg`
    - 1440×2062, 307599 bytes
    - SHA-256 `bfc32eb1268f82b2d5c57d30072d0aca8a913a1382eadbc8f768cbdfc0c71d4a`
- Five Envato certificates, item IDs, source URLs, dimensions, and hashes are recorded under `docs/licenses/envato/welcome-1.0.11/`.
- Combined shipping payload is about 545 KB, substantially below the prior 2.73 MB collage.

## Completed verification

- Final independent visual/code audit: no P0/P1/P2 findings.
- `node --import tsx lib/__tests__/welcomeGate.test.ts`: pass.
- `npx tsc --noEmit --pretty false`: pass.
- `npm run audit:copy`: pass for 175 files.
- `npm run test:privacy-controls`: pass.
- `npm run test:local-expo-modules`: pass, 6/6.
- `npm run test:native-ota-compatibility`: pass.
- `npm run test:production-publisher-cli`: pass.
- `npm run audit:native-drift`: pass with only expected missing local secret warnings.
- `git diff --check`: pass.
- The native-drift check was stale after the safer sequential publisher refactor. It now validates separate `dist-android`/`dist-ios` exports, one worker, per-stage Sentry uploads, and publication only after both uploads.

## Preview compatibility and device rule

- Connected Samsung build 73 uses `native-1.0.12-android.1`; do not send this 1.0.10 update to it.
- Compatible Android preview target:
  - Build 69
  - Build ID `3da6ed72-0eff-49f7-9cb5-e192d55a26ce`
  - AVD `TrailheadCapture1080x1920`
- Compatible iOS preview target after Android acceptance: build 61, from the identical accepted SHA.
- Publish only from a clean detached worktree after fingerprint compatibility evidence passes.

## Do not repeat

- Do not redesign the welcome again unless device evidence reveals a specific defect.
- Do not repeat the production welcome audit, licensed-photo search, Figma masters, Smokies, Trails, Explore/NPS, Memory Gate, Layers, Originals lifecycle, Android Auto, or store screenshots.
- Do not use the incompatible Samsung build 73 for this OTA.
- Do not add a native dependency or change permissions/runtime identifiers.

## Next exact action

Push this checkpoint, create a clean detached worktree at its immutable SHA, compare its native fingerprint to Android build 69, and run the pre-preview gate once. If compatible, publish the Android preview, install/reset build 69 on `TrailheadCapture1080x1920`, and verify the real first-run welcome, setup, Explore-first, Sign-in, optional rig/Suspension, and Profile replay. Stop for Android acceptance before publishing the identical SHA to iOS build 61.
