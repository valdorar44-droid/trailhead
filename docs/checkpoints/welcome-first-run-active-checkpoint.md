# Trailhead Welcome + First Run — Active Checkpoint

Last updated: 2026-08-04 23:15 CDT (pre-change baseline)

## Resume protocol

Read this file before continuing the Welcome/first-run packet. Do not repeat the current-screen audit, the original Figma-page inventory, or the downstream-preference audit unless new evidence invalidates them.

1. Run `git status --short --branch` in `/home/sean/.openclaw/workspace/trailhead`.
2. Confirm HEAD and protected hashes below before editing.
3. Never stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, or `docs/app-store-copy.md`.
4. Continue from **Next exact action**.

## Baseline

- Branch: `feat/trailhead-1.0.10-overhaul`.
- Pre-change HEAD: `4e8b98daec327f88eef6dd187c938a8e034524ec`.
- Smokies S2 remains checkpointed separately and is not part of this packet.
- Existing protected dirty state, preserved:
  - `M dashboard/explore_serving_index_v2.json`
  - `M docs/app-store-copy.md`
  - `?? .cursor/`
- Protected hashes:
  - Explore serving index: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
  - App Store copy: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`
  - Smokies checkpoint: `83001339027887d9f3c4a46ea0f864561dfe71fc143b781d4bc3ba5909246476`
  - Current welcome collage: `28d8487215693de143c0d6bd09b353dc71b7ba57dfe915ce69e53b221ceb2637`
- Connected Android: Samsung SM-A326U1, serial `RFCR408DA9B`, installed `versionName=1.0.12`, `versionCode=73`.
- Repo app config remains version `1.0.10` with runtimes `native-1.0.10-android.7` and `native-1.0.10-ios.6`; this packet must not change native/config inputs.
- Task-owned Metro, Gradle, Maestro, Jest, pytest, and Expo processes: none. The shared ADB server remains active.

## Accepted product decisions

- Use a licensed whole-journey collage: one road/vehicle scene plus camp, trail/hiker, campground/RV, and scenic destination imagery.
- Welcome action order: `Get started`, `Explore first`, then `Sign in`.
- Keep the detailed rig form, but make it an explicitly optional grouped step.
- Use the existing Trailhead Figma file and preserve every original page.
- Use warm white, near-black, and restrained orange; remove hard-coded setup blue, oversized pills, filler, and AI-style wording.
- Remove the visible `Offline` preference because no deterministic mobile behavior consumes it; retain stored-value compatibility.

## Verified current behavior

- The real first-run screen uses `mobile/assets/onboarding-hero-overland.png`, not Figma node `728:2343`.
- The current image is 854×1842, 2.73 MB, repeats near-identical vehicles, and has no repository attribution/license record.
- Current first-run order: welcome → camp types → party → vehicle → optional rig form → Extras → Explore.
- `WelcomeGate` receives working create-account and sign-in callbacks, but no longer renders them.
- Current selection feedback totals every previous step instead of the active step.
- Camp, party, towing, rental, and rig answers feed real planning context. `Offline` does not. Pets remains a planning-context signal.
- `WelcomeOnboardingModal` is Profile-only; its Profile copy incorrectly claims ownership of Trips, Saved, and Downloads.

## Figma and research anchors

- File: `FJUcMWAfsNyjsguCEp2dBe`.
- Preserve and reference:
  - `Trailhead UI Kit`
  - `Trailhead Screens`
  - `Trailhead Refinement / Onboarding + Trails`
  - `Packet 23 · System Completion`, including `23.01 · Welcome` (`728:2343`)
- New page requested: `Welcome + First Run — 1.0.11`.
- Mobbin is a behavior reference only. Envato photographs require item URL, author, item ID, certificate, dimensions, usage, and SHA-256 before shipping.

## Do not repeat

- Do not re-audit Smokies, Trails, Explore/NPS, Memory Gate, Layers, Originals lifecycle, Android Auto, or store screenshots.
- Do not treat the unused topo welcome concept as the shipped screen.
- Do not generate destination imagery or use Mobbin/competitor imagery.
- Do not add a native dependency or change permissions/runtime identifiers.

## Next exact action

Create the Figma research/contact-sheet section and screen skeleton from the accepted decisions, then present the licensed-photo shortlist before downloading final assets. After visual approval, implement the JS/layout/copy changes, focused tests, Android preview OTA, and identical-SHA iOS preview.
