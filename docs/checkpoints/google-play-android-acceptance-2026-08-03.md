# Trailhead Google Play Android acceptance checkpoint

Timestamp: 2026-08-03 13:45:21 -05:00

Status: **in progress; do not submit the current Android artifact or final Data
Safety form yet**.

## Repository and release identity

- Task worktree:
  `/home/sean/.openclaw/worktrees/trailhead-play-data-audit-c1155793`.
- Branch: `fix/google-play-data-safety-closeout`.
- Starting HEAD: `c115579341fbd68dd61495b18e620cc6992ab0d2`.
- Accepted backend/OTA source at task start:
  `c115579341fbd68dd61495b18e620cc6992ab0d2`.
- Corrected target: Trailhead `1.0.12`.
- Target Android runtime: `native-1.0.12-android.1`.
- Target iOS runtime: `native-1.0.12-ios.1`.
- A native Android/iOS rebuild is required because the SDK/dependency,
  manifest, native resources, and runtime identifiers change.

Protected files at checkpoint start:

| Path | SHA-256 / state |
|---|---|
| `dashboard/explore_serving_index_v2.json` | `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869` |
| `docs/app-store-copy.md` | `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a` |
| `.cursor/` | Absent from this clean task worktree |

Do not stage, overwrite, regenerate, or discard either protected file from this
packet.

## Inspected Android artifact

- Native source: `0f7431d32088405f4c381ed1a220fcb2169ec761`.
- EAS Android build: build `70`, ID
  `723dca56-01a3-416b-a22d-98c838a849ee`.
- App/runtime: `1.0.11` / `native-1.0.11-android.1`.
- AAB:
  `C:\Users\User\Documents\Codex\evidence\trailhead\play-console-audit-2026-08-03\Trailhead-1.0.11-build70.aab`.
- AAB SHA-256:
  `0CC5B90C1722F8A2DF93BE9DD8E8ED7939511395EA8BAEE0D0E40FE8D177C08E`.
- Bundletool manifest:
  `C:\Users\User\Documents\Codex\evidence\trailhead\play-console-audit-2026-08-03\build70-bundletool-manifest.xml`.
- Manifest SHA-256:
  `DC5E0511BEF2D95AF2044D9EB88555217628B68C9FAF374EC123DA3A766FFC83`.
- Bundletool:
  `C:\Users\User\Documents\Codex\evidence\trailhead\play-console-audit-2026-08-03\bundletool-all-1.18.3.jar`.
- Bundletool SHA-256:
  `A099CFA1543F55593BC2ED16A70A7C67FE54B1747BB7301F37FDFD6D91028E29`.
- Phase-0 analytics call-site inventory:
  `C:\Users\User\Documents\Codex\evidence\trailhead\play-console-audit-2026-08-03\phase0-call-sites.txt`.
- Call-site inventory SHA-256:
  `7C653C12D589495887477AA6CD60FCB5E790D9970673ABFA5E03160E88915825`.

The 1.0.11 manifest proves:

- Present: fine/coarse location, foreground-service location, media playback,
  microphone, camera, notifications, billing, Install Referrer, Firebase Cloud
  Messaging, Android Auto, biometrics/fingerprint and badge components.
- Absent: `ACCESS_BACKGROUND_LOCATION`, `AD_ID`, broad storage, contacts, SMS,
  call logs, calendar, health and installed-app access.
- Native Branch initialization and Install Referrer are present. This build is
  therefore not compatible with the desired branchless `Shared: No`
  declaration without separately reconciling Branch and every active track.

## Audit decisions

The exact console matrix and ready-to-paste declarations are in
[`docs/google-play-data-safety-audit-2026-07.md`](../google-play-data-safety-audit-2026-07.md).

Fixed decisions:

- Trailhead does not sell personal data.
- Ads declaration is `No`; `AD_ID` and ads SDKs must remain absent.
- Corrected 1.0.12 removes Branch's native SDK, keys/domains, config plugin,
  Install Referrer, iOS resource, native initialization, backend link creation,
  and server configuration.
- First-party `https://gettrailhead.app/r/{code}` links and manual referral
  codes remain.
- `Collected: Yes` includes data sent to service providers, even when ephemeral.
- Co-Pilot raw audio is declared non-ephemeral until the OpenAI project is
  verified for Zero Data Retention; Trailhead itself does not keep the raw
  recording in the account.
- `Shared: No` is valid only after service-provider/user-action exceptions and
  the complete active-track union are verified.
- Privacy URL: `https://api.gettrailhead.app/privacy`.
- Deletion URL: `https://api.gettrailhead.app/delete-account`.
- Encryption in transit: `Yes`; no end-to-end or unverified encrypted-at-rest
  claim.
- Background behavior is described as GPS-triggered playback during an
  explicitly user-started tour, not general unattended autoplay.
- Corrected foreground-service declarations are `location` and
  `mediaPlayback`; remove the unused Expo audio-recording service.

## Implemented in the working tree, awaiting final verification

- Removed account/stable identifiers, raw search text, location buckets, trip,
  camp, alert and experience IDs from general phase-0 analytics call sites.
- Added a server-side fixed event/field allowlist and rejection of unknown
  phase-0 analytics events.
- Focused analytics result recorded by the implementing agent: `7 passed` in
  `tests/test_originals_analytics.py`.
- Removed Branch mobile dependencies/config/native resources and bumped the
  marketing version/runtime pair to 1.0.12.
- Blocked Install Referrer and removed the unused audio-recording foreground
  service in the target Android manifest.
- Removed the optional backend Branch handoff. Referral landing, store buttons,
  first-party links, manual code, and credit attribution remain without a
  Branch request.
- Completed the account-deletion cascade and replay guards. Focused acceptance:
  `9 passed`; expanded deletion/referral/support/Viator/Originals/privacy
  regression: `96 passed` plus `15` subtests. A later root-focused run passed
  `36` selected tests after the Branch backend removal.
- Native/config drift, privacy controls, first-party referral tests and mobile
  TypeScript all pass for the uncommitted 1.0.12 tree.
- Subscription and entitlement verification now fails closed: forged Apple
  notification payloads cannot mutate access, Apple revocations are rejected,
  and Google grants only active, grace-period, or still-paid canceled states.
- Co-Pilot microphone ownership now closes on every dismissal/background path.
  Narration-only WebRTC uses a receive-only audio transceiver and does not ask
  for microphone capture.
- Navigation and Original background location use one policy-complete
  disclosure. Background work begins only after the user starts the feature;
  foreground navigation remains usable after `Not now`.
- EAS preview and production environments no longer contain Branch keys,
  domains, or enablement flags.
- Final focused source-freeze verification at this checkpoint:
  - `84` backend tests passed, with `13` subscription subtests.
  - `6` Co-Pilot lifecycle tests and `4` location-disclosure tests passed.
  - First-party referral, telemetry allowlist, privacy-control, TypeScript,
    native-drift and whitespace checks passed.
  - The protected Explore-index and App Store-copy hashes remain unchanged.
- The one full `audit:prepreview` run completed its Android/Android Auto build,
  release checks, mobile feature suites, TypeScript and full backend regression:
  `1004` backend tests and `148` subtests passed. It reported two narrow
  release-worktree assertions after those suites: local Expo modules resolved
  through the main checkout's dependency symlink, and the Explore memory guard
  still matched the pre-auth-hydration source shape. The worktree now has an
  isolated hard-linked dependency tree with all six local Expo modules pointed
  at this worktree, and the guard recognizes the bounded authenticated startup
  effect. Both exact assertions, TypeScript and whitespace checks pass; the
  expensive full suite was not repeated.
- The final independent audit found and closed valid monthly/annual store-plan
  transitions, full Google replacement-token traversal, cross-account
  multi-hop replay rejection and canonicalization of legacy same-owner alias
  rows. The final focused result is `13` tests and `13` subtests, with no
  remaining subscription P0/P1.

These source changes are verified and ready to freeze. They remain uncommitted
at this checkpoint. The final implementation SHA, Android/iOS build IDs,
decoded 1.0.12 manifest and Play Console export must be added after the build.

## Open P0/P1 release blockers

1. **P1 — Active artifact/console mismatch.** The inspected 1.0.11 build
   contains Branch and Install Referrer. Every active Play track, including the
   older public Android version, must be inventoried before `Shared: No` is
   saved.
2. **P1 — Corrected native candidate not yet built.** The 1.0.12 merged manifest
   must prove Branch, Install Referrer, `AD_ID`, background-location permission
   and the unused audio-recording service are absent.
3. **P1 — Play App Content draft not yet reconciled.** Data Safety, deletion,
   account-creation methods, Ads, App access, foreground-service declarations,
   background-location evidence, UGC and generative-output reporting must be
   entered and reopened to verify persistence.
4. **P1 — Google review evidence not yet bound to the exact candidate.** The
   <=30-second consumer video must show disclosure, OS permission, explicit
   Start Tour, Home/lock, persistent notification, OS-level mocked route, real
   GPS-triggered narration, media controls and End Tour.

## Exact next action

1. Commit only the named audit/correction files and record the immutable SHA.
2. Build Android first, decode the resulting AAB with bundletool, and compare
   the exact SDK/permission/service set with the audit document.
3. Install and test the Android candidate, then record the policy video.
4. Export the current Play declarations and active-track inventory before
   editing; reconcile all distributed artifacts.
5. Enter and save the corrected form, re-open each page, export evidence, then
   submit only if no mismatch remains.
6. Build iOS from the identical accepted SHA after Android acceptance.

## Do not repeat

- Do not repeat Memory Gate, Layers, Yellowstone, NPS, Explore data-depth,
  Trails, Originals lifecycle, broad Map/sheet, Android Auto or store screenshot
  crawls without new evidence.
- Do not present build 70 as branchless.
- Do not claim that `not sold` automatically means `not shared`.
- Do not claim end-to-end encryption or database/object-store/backup encryption
  without current infrastructure evidence.
- Do not weaken the active-track union, manifest, deletion or evidence gates to
  make the console answer easier.
- Do not publish native-dependent 1.0.12 code to a 1.0.11 runtime.

Task-owned Metro, Gradle, Maestro and test processes still running from this
documentation task: none.
