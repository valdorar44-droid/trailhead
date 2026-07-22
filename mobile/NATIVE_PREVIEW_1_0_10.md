# Trailhead 1.0.10 native preview

The checked-in `android/` and `ios/` projects are the native sources for 1.0.10. Do not run a clean Expo prebuild. Android must never be prebuilt because its Android Auto implementation is hand maintained.

## EAS environment

Configure these values in the EAS preview and production environments before building:

- `BRANCH_API_KEY`: Branch live client key.
- `EXPO_PUBLIC_BRANCH_DOMAIN`: `go.gettrailhead.app`.
- `EXPO_PUBLIC_BRANCH_ATTRIBUTION_ENABLED`: `true` unless attribution is disabled for the whole build.
- `EXPO_PUBLIC_SENTRY_DSN`: client DSN.
- `SENTRY_AUTH_TOKEN`: source-map upload token.
- `SENTRY_ORG` and `SENTRY_PROJECT`: source-map destination.
- `GOOGLE_MAPS_API_KEY`: Android-restricted Maps key.

The EAS post-install hook stops a build when a required value is missing and injects the Branch client key into the ephemeral iOS workspace. No secret or live client key is committed.

Run `npm run audit:native-drift` for repository checks. Run `node scripts/native-drift-check.mjs --require-external-config` in a configured build shell before starting the paired preview.

## External readiness

- `gettrailhead.app` and `www.gettrailhead.app` have valid HTTPS and serve the
  current AASA and `assetlinks.json` through the Cloudflare site proxy.
- Branch is configured with NativeLink, Android App Links, the iOS app ID, both
  Android fingerprints, and the `go.gettrailhead.app` CNAME. Branch's custom
  certificate must still be rechecked until its SAN includes
  `go.gettrailhead.app`; the healthy `zswub.app.link` and
  `zswub-alternate.app.link` domains remain in both native projects as preview
  fallbacks.
- Sentry project `trailhead-mobile` is configured for crashes and performance
  only. Session Replay and default PII are disabled, and the preview environment
  contains its source-map credentials.
- The Google Maps key that previously appeared in the tracked Android manifest
  is no longer stored in source. Confirm the EAS replacement is Android-restricted
  to the package and candidate signing certificates before production.

## Local release gates

- Expo Doctor: 17/17.
- Backend: 690 tests.
- Mobile pre-preview audit: passed, including Search V2, Offline V2, Originals,
  Viator, copy, app links, TypeScript, and web/native boundary checks.
- Android native compile: `assembleDebug` passed for `arm64-v8a`.
- Website/Astro export: passed with web-specific offline adapters; browsers do
  not import or claim native RNMapbox/SQLite download support.
- `npm audit --omit=dev --audit-level=high` found no high or critical issue.
  Sixteen transitive moderate advisories remain in Expo build dependencies; the
  automatic fix would force a breaking Expo 57 upgrade and is deferred from the
  1.0.10 candidate.

Do not request the advertising ID permission. Referral attribution uses the Play Install Referrer and a user-controllable device opt-out, with manual referral-code entry as the fallback.

## Candidate record

Fill this only after the worktree is clean, the external gate passes, and both
previews are launched from the same commit. Do not infer remote build numbers.

### Foundation evidence pair (not the final candidate)

The first native 1.0.10 evidence pair was built from the same immutable commit
before the compatible Search/Offline implementation wave. It remains suitable
for preview OTAs on the runtime versions below, but it is not a production
candidate and does not close the final device checklist.

| Field | Android | iOS |
|---|---|---|
| Commit SHA | `cd61f6c3` | `cd61f6c3` |
| EAS build ID | `06142308-0199-46cc-8a4c-fb9d45bca25e` | `7d3c170d-46d2-4bae-b7c7-6fbee63a69c1` |
| Marketing version | 1.0.10 | 1.0.10 |
| Runtime | `native-1.0.10-android.1` | `native-1.0.10-ios.1` |
| Remote build/version code | 59 | 54 |
| Channel | `preview` | `preview` |
| Artifact/install URL | [APK](https://expo.dev/artifacts/eas/-TGjzCjq-htc5edUbuDDsiT7xWzLp654IU0jRPlLOlY.apk) | [IPA](https://expo.dev/artifacts/eas/bQ2t6831lwSIkc8oWTcepiQ9-phk7W2f14wRl_M071k.ipa) |
| Preview update group | Embedded update | Embedded update |

### Final paired candidate

| Field | Android | iOS |
|---|---|---|
| Commit SHA | Pending | Pending |
| EAS build ID | Pending | Pending |
| Marketing version | 1.0.10 | 1.0.10 |
| Runtime | `native-1.0.10-android.1` | `native-1.0.10-ios.1` |
| Remote build/version code | Pending | Pending |
| Channel | `preview` | `preview` |
| Artifact/install URL | Pending | Pending |
| Preview update group | Pending | Pending |

For reference only, the latest completed EAS store builds before this work were
iOS build 53 and Android build 58. Those values do not prove what is currently
public in either store and must not be copied into the 1.0.10 candidate row.
