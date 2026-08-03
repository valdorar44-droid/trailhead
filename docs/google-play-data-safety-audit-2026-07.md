# Google Play 1.0.12 Data Safety and App Content audit

Last reviewed: August 3, 2026

This is the console-entry source of truth for the corrected Trailhead 1.0.12
Android candidate. Re-run it whenever an SDK, permission, provider, telemetry
field, account-deletion path, or active Play track changes.

Google defines **collected** as data transmitted off the device, even when it
is used only briefly by a processor. **Not sold** and **not shared** are separate
claims. Trailhead does not sell personal data or use it for cross-context
behavioral advertising. Trailhead does show clearly labelled, contextual
partner booking offers and may earn a commission. The `Shared: No` answers
below rely on recipients processing data
as Trailhead service providers, or on another documented Google exception such
as a user-requested external transaction.

Official references:

- [Data Safety form](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
- [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN)
- [Background location](https://support.google.com/googleplay/android-developer/answer/9799150?hl=en)
- [Prominent disclosure](https://support.google.com/googleplay/android-developer/answer/11150561?hl=en)
- [Foreground-service declarations](https://support.google.com/googleplay/android-developer/answer/13392821?hl=en-EN)
- [Foreground-service policy](https://support.google.com/googleplay/android-developer/answer/16559646?hl=en)

## Release boundary

The corrected declaration applies only after the branchless 1.0.12 candidate
has passed its merged-manifest and dependency audit.

- Target marketing version: `1.0.12`.
- Target Android runtime: `native-1.0.12-android.1`.
- Target iOS runtime: `native-1.0.12-ios.1`.
- Native Branch SDK, Branch keys/domains, and Play Install Referrer integration:
  removed from the corrected candidate.
- Server-side Branch link creation and its Railway configuration: removed. The
  referral landing remains first-party and performs no Branch network request.
- First-party referral URL retained: `https://gettrailhead.app/r/{code}`.
- Manual referral-code entry retained.
- Advertising ID permission and ads SDKs: absent.
- Firebase Analytics and Sentry Session Replay: absent.
- Sentry: crashes and performance only, through a fixed privacy allowlist.

The inspected Android 1.0.11 build 70 is **not** the corrected artifact. It
contains Branch native initialization and Install Referrer. It is retained as
evidence of the mismatch that 1.0.12 corrects.

Google's declaration is the union of every build currently distributed on
Production, Open testing, Closed testing, Internal testing, and any other
active Play track. Before saving `Shared: No`, inspect the active-track matrix
and remove, replace, or separately account for every Branch-enabled artifact,
including the older public Android build. Uploading 1.0.12 to one track does
not erase the data flow of an older artifact that Google still distributes.

## Exact audit evidence

Inspected production candidate:

- Native source: `0f7431d32088405f4c381ed1a220fcb2169ec761`.
- EAS Android build: build `70`, ID
  `723dca56-01a3-416b-a22d-98c838a849ee`.
- App/runtime: `1.0.11` / `native-1.0.11-android.1`.
- AAB:
  `C:\Users\User\Documents\Codex\evidence\trailhead\play-console-audit-2026-08-03\Trailhead-1.0.11-build70.aab`.
- AAB SHA-256:
  `0CC5B90C1722F8A2DF93BE9DD8E8ED7939511395EA8BAEE0D0E40FE8D177C08E`.
- Decoded manifest:
  `C:\Users\User\Documents\Codex\evidence\trailhead\play-console-audit-2026-08-03\build70-bundletool-manifest.xml`.
- Manifest SHA-256:
  `DC5E0511BEF2D95AF2044D9EB88555217628B68C9FAF374EC123DA3A766FFC83`.

The build 70 manifest contains fine/coarse location, foreground-service
location, media playback, microphone, camera, notifications, billing, Install
Referrer, Firebase Cloud Messaging, Android Auto, biometrics, and badge
components. It does not contain `ACCESS_BACKGROUND_LOCATION`, `AD_ID`, broad
storage, contacts, SMS, call logs, calendar, health, or installed-app access.

The corrected 1.0.12 manifest must additionally prove:

- Branch and Install Referrer are absent.
- `ACCESS_BACKGROUND_LOCATION` and `AD_ID` remain absent.
- The unused Expo audio-recording foreground service is removed.
- Only the user-started location and media-playback foreground-service use
  cases remain declared.

## Top-level Data Safety answers

| Console question | Answer for corrected 1.0.12 | Notes |
|---|---|---|
| Does the app collect or share required user data types? | **Yes, collects data** | `Collected` includes service-provider transfers and ephemeral requests. |
| Does the app share user data? | **No**, after active-track reconciliation | Trailhead does not sell data. Service-provider/user-action exceptions are documented below. Do not use this answer while a Branch-enabled artifact is still distributed unless the active artifact's processing is separately reconciled. |
| Is all user data encrypted in transit? | **Yes** | Production external traffic uses HTTPS/TLS. Loopback HTTP for an on-device router/tile service does not leave the device. |
| Can users request account deletion? | **Yes** | In-app Profile flow plus the public web URL below. |
| Is account deletion automatic within 90 days? | **No** | Data remains until deletion or item removal, subject to limited security, transaction, fraud-prevention, and legal retention. |
| Does the app contain ads? | **Yes** | Trailhead includes clearly labelled contextual partner booking offers and may earn a commission. It has no ads SDK or `AD_ID` permission and does not use cross-context behavioral advertising. |

Use these public URLs in App Content:

- Privacy policy: `https://api.gettrailhead.app/privacy`
- Account deletion: `https://api.gettrailhead.app/delete-account`
- Partial data deletion: `https://api.gettrailhead.app/delete-data`

## Exact Data Safety type matrix

`Required` below means the collection occurs automatically whenever the app is
used. `Optional` means the user can avoid that data type by not using the
relevant feature. Co-Pilot microphone audio is not marked ephemeral because
the current OpenAI Realtime API configuration has not been proven to use Zero
Data Retention; a transcript or resulting user action is declared separately
as app activity or user-generated content.

| Google data type | Collected | Shared | Required | Ephemeral | Purposes to select | Trailhead examples |
|---|---:|---:|---|---:|---|---|
| Name | Yes | No | Optional | No | App functionality; Account management; Personalization | Profile/display name and OAuth display name |
| Email address | Yes | No | Optional | No | App functionality; Account management; Developer communications; Fraud prevention, security and compliance | Registration, verification, sign-in and recovery |
| User IDs | Yes | No | Optional | No | App functionality; Account management; Fraud prevention, security and compliance | Trailhead account ID, OAuth provider subject and the stable pseudonymous OpenAI safety identifier used for abuse prevention |
| Other personal info | Yes | No | Optional | No | App functionality; Personalization; Account management; Advertising or marketing | Username/handle, vehicle or rig preferences and referral/prize status; trip/rig context may select a clearly labelled partner booking offer |
| Approximate location | Yes | No | Optional | No | App functionality; Personalization; Advertising or marketing | Nearby Search, map viewport, weather/layer requests, destination context and contextual partner booking inventory |
| Precise location | Yes | No | Optional | No | App functionality; Personalization; Advertising or marketing | Navigation, active Trailhead Original triggers, route building, nearby results, reports, explicitly saved/submitted routes and contextual partner booking inventory |
| Purchase history | Yes | No | Optional | No | App functionality; Account management; Fraud prevention, security and compliance | Subscription, credit and entitlement receipts verified with Apple/Google |
| Other financial info | Yes | No | Optional | No | App functionality; Account management | Preferred prize-payout method label and workflow status; no payout credentials |
| Fitness info | Yes | No | Optional | No | App functionality | A trail recording's selected activity, elapsed time and distance when the user explicitly reviews and saves, shares or submits it |
| Other in-app messages | Yes | No | Optional | No | App functionality; Developer communications; Personalization | Support tickets/replies, private winner messages and saved planner or Co-Pilot chat history |
| Photos | Yes | No | Optional | No | App functionality; Fraud prevention, security and compliance | Community reports/contributions, place photos and support screenshots |
| Voice or sound recordings | Yes | No | Optional | No | App functionality | Co-Pilot audio sent to the configured OpenAI realtime service only after the user starts microphone use; Trailhead does not retain the raw recording in the account, but provider abuse-monitoring retention may apply |
| App interactions | Yes | No | Required | No | App functionality; Analytics; Fraud prevention, security and compliance | Privacy-minimized aggregate events plus first-party operational event types needed for purchases, support, reports, security and administrator audit; normally retained for no more than 90 days and never used to build advertising audiences |
| In-app search history | Yes | No | Optional | No | App functionality; Personalization | Query text sent for Trailhead Search/Mapbox lookup; excluded from Trailhead analytics |
| Other user-generated content | Yes | No | Optional | No | App functionality; Personalization | Trips, routes, notes, packing lists, GPX-derived saved geometry, ratings, comments, reports and edits |
| Other actions | Yes | No | Optional | No | App functionality; Personalization; Advertising or marketing | Tour/download progress, saves, route and trip-planning state, referral/prize workflow actions and contextual partner-offer selection |
| Crash logs | Yes | No | Required | No | Analytics | Sentry allowlisted exception type and symbolicated stack frames |
| Diagnostics | Yes | No | Required for automatic diagnostics; optional for support diagnostics | No | App functionality; Analytics | Fixed error codes, app/build/runtime/update, platform and consented support diagnostics |
| Other app performance data | Yes | No | Required while performance monitoring is enabled | No | Analytics | Static Sentry performance transaction/span measurements |
| Device or other IDs | Yes | No | Required for update/runtime operation; push token is optional | No | App functionality; Developer communications | Expo update installation metadata and notification token; generic promotional push is disabled and delivery history redacts reusable tokens |

### Types to leave unselected

- Physical address and phone number: Trailhead does not request them as user
  profile fields in the audited consumer flow.
- Payment information: Trailhead does not receive or store full card, bank,
  PayPal, or Cash App credentials. Other financial information is selected
  separately for the preferred payout-method label and workflow status. If a
  future flow accepts a payout handle, account number, routing number, card
  data, identity document, or tax record, revise the declaration before launch.
- Health information: no audited collection. Fitness information is selected
  because an explicitly reviewed trail recording can include activity, elapsed
  time and distance when saved, shared or submitted.
- Contacts, emails, SMS/MMS, call logs, calendar, installed apps, and web
  browsing history: no audited collection.
- Videos: the consumer app does not currently upload user video.
- Music and other audio files: generated narration is Trailhead content, not a
  user's personal music/audio library.
- Files and documents: GPX is normalized into explicitly saved/submitted route
  geometry; the audited flow does not upload a general user document library.

## Provider and third-party boundary

These recipients belong in the public privacy policy even when Google's
service-provider or user-action exception supports `Shared: No`.

| Recipient | Data transmitted | Purpose and boundary |
|---|---|---|
| Trailhead API on Railway plus database/object-storage/CDN providers | Account/profile, saved content, routes, support, purchases/credits, app state and hosted media | Trailhead hosting and delivery under developer control. |
| Mapbox | Viewport/location context, route endpoints, Search Box query/session, map/navigation requests and operational network/session metadata | Maps, Search, routing and navigation. Nonessential SDK telemetry is disabled. Keep the processor configuration/contract in the release evidence. |
| Sentry | Fixed exception type/code, symbolicated stack frames, platform, app/build/runtime/update and static performance transaction names | Crash and performance processor. No Session Replay, default PII, arbitrary messages/URLs, breadcrumbs, device identifiers, location, routes, search text, support content, attachments or payout data. |
| OpenAI | Optional user-started Co-Pilot microphone audio, transcript/request context, a stable pseudonymous safety identifier and relevant server-side planning/brief context | Voice, planning and brief processing. Trailhead does not store raw recordings in the account, but the default API configuration may retain inputs temporarily for abuse monitoring; retained Trailhead transcript/actions are declared separately. No advertising use. |
| Anthropic | Relevant trip, campground and user-request context for planner and brief generation | Planning and brief processing; no advertising use. |
| ElevenLabs and Cartesia | Requested/generated guide, direction or Original narration text plus voice/model settings; generated audio may be cached | Text-to-speech processors. Do not describe all TTS as non-personal if user-requested direction/guide text contains trip context. |
| Expo/EAS, Firebase Cloud Messaging and Apple Push Notification service | Update installation/runtime metadata, push token, platform token and notification payload | App delivery, compatible updates and user-requested notifications. |
| Google and Apple OAuth/Billing | OAuth token/provider subject and purchase receipt/entitlement data | Sign-in and purchase verification. Trailhead does not receive full payment credentials. |
| Stripe and an approved prize-payout provider | Checkout/transaction identifiers, or payout method after the user enters the separately controlled flow | User-requested purchase or award completion. Credentials are entered with the provider, not ordinary Trailhead support chat. |
| Transactional email provider | Email address, username and time-limited verification/recovery link | Account verification, recovery and requested account communications. |
| Project OSRM, OpenTopoData and other routing, elevation, weather, avalanche, land, trail and public-content sources | Requested place, route, viewport/tile/layer context and normal network metadata | User-requested online routing, elevation and product data. Direct transfers occur only as part of the feature the user invokes; proxy them where practical and retain source attribution. |
| Viator | Canonical Viator destination ID, dates and nonidentifying tour filters; a user-requested tap opens the separately labelled external booking flow | External fulfillment. Raw search text, route/place names, coordinates, account/device identifiers and route geometry are not sent to Viator. The audited consumer app does not enable an undisclosed Trailhead-side booking mutation. |
| Outdoorsy/TUNE | Fixed offer, source and URL identifiers; a user-requested tap opens the clearly labelled external booking flow | Contextual affiliate inventory and external fulfillment. Trailhead may earn a commission. Route/start-area and rig context are processed by Trailhead only; no account identity, device ID, coordinates, private messages, raw search history or traveled-route history is sent to TUNE or Outdoorsy. |

### Branch removal

The 1.0.11 AAB proves that Branch could initialize in native Android lifecycle
code before the JavaScript privacy setting was applied. The 1.0.12 correction
removes the native SDK, config plugin, keys/domains, Install Referrer, iOS
resource, lifecycle initialization, backend link-creation client, and related
server configuration. Trailhead preserves its first-party referral URL,
platform deep links, store buttons, and manual-code fallback without a Branch
network request.

Do not set `Shared: No` based only on a JavaScript opt-out when an older native
Branch build is still distributed. If Branch is reintroduced, complete a new
contract, SDK, manifest, fresh-install, opt-out and exactly-once audit before
changing the app or console form.

## App Content checklist

### Privacy, deletion and account creation

- [ ] Privacy policy URL is exactly
      `https://api.gettrailhead.app/privacy` and loads without authentication.
- [ ] Deletion URL is exactly
      `https://api.gettrailhead.app/delete-account` and works without first
      launching the app.
- [ ] Partial-data deletion URL is exactly
      `https://api.gettrailhead.app/delete-data` and works without first
      launching the app.
- [ ] The in-app Profile deletion flow supports fresh password, Google or Apple
      reauthentication as applicable.
- [ ] Account creation methods select username/password, Google OAuth and Apple
      OAuth.
- [ ] The deletion test covers a subscribed user, Viator booking, offline
      record, Co-Pilot action, map contributor application, push delivery,
      support thread/attachment and prize/referral history without a foreign-key
      failure.
- [ ] Retention exceptions are limited to transaction, fraud-prevention,
      security and legal records and are explained in the policy.

### Ads, audience, app access and user content

- [ ] Ads declaration: **Yes** because contextual partner booking cards are
      native affiliate content. No ads SDK or advertising identifier is used.
- [ ] Confirm `AD_ID` is absent from the final merged manifest.
- [ ] Health apps declaration: select **Activity and Fitness** because users
      can explicitly save or submit a trail recording with activity, elapsed
      time and distance. Do not select medical/health categories Trailhead does
      not provide.
- [ ] Target audience and content rating match the actual outdoor/navigation,
      community, purchase and contest features; do not market to children.
- [ ] App access includes a reusable, location-independent reviewer account,
      English steps, Explorer entitlement, and no OTP dependence.
- [ ] Reviewer instructions explain how to open an owned Trailhead Original,
      accept the disclosure, start the tour, background/lock the phone and use
      the persistent notification/media controls.
- [ ] UGC controls remain visible: terms, content/user reporting, blocking,
      moderation and account-level enforcement.
- [ ] Co-Pilot/generative output retains an in-app way to report offensive or
      unsafe content; no consumer-facing claim implies guaranteed safety.

### Foreground services and background behavior

The corrected 1.0.12 candidate should declare only these consumer use cases:

| Foreground-service type | Play declaration use case |
|---|---|
| `location` | A user explicitly starts navigation, a Trailhead Original, or trail recording. Trailhead keeps that active experience working after the screen is locked or another app opens, displays a persistent notification, and stops when the user ends it. |
| `mediaPlayback` | During a Trailhead Original explicitly started by the user, downloaded narration begins at a mapped story point and can continue while the screen is locked or another app is open. Android media controls and a persistent notification let the user pause or stop playback; End Tour stops the service. |

Do not declare the unused Expo microphone foreground service after its manifest
component is removed. Co-Pilot microphone capture is a visible, user-started
interaction; verify the final merged manifest and runtime rather than copying
the 1.0.11 service list.

Use this prominent disclosure immediately before the operating-system location
request and at permission recovery—not on every detail/player screen:

> Trailhead collects precise location data to keep navigation, Trailhead Original stories, and active trail recording working in the background, including when the app is closed or not in use. Location access begins only after you start one of these features and stops when you end it. Trailhead does not sell location or use it for cross-app advertising.

Actions: `Agree & continue` and `Not now`.

For the **background-location declaration**, identify one primary feature:
`Trailhead Originals - GPS-triggered audio stories`. Use this text:

> After a user starts a Trailhead Original, Trailhead continues checking location so GPS-triggered stories can play while the screen is locked or another app is open. A persistent notification identifies the active tour, and End Tour stops location and playback.

For the broader **location foreground-service declaration**, use this text:

> After a user starts navigation, a Trailhead Original, or trail recording, Trailhead continues updating the active experience when the screen is locked or another app is open. A persistent notification identifies the running feature, and the user can end it at any time.

Use this media-playback declaration text:

> During a Trailhead Original that the user explicitly starts, downloaded narration begins when the user reaches its mapped story point and continues when the screen is locked or another app is open. Android media controls and a persistent notification let the user pause or stop playback; End Tour stops the service.

Describe the behavior as **GPS-triggered playback during a user-started active
tour**, not general unattended autoplay. The app must not boot-start a tour or
restart one after End Tour.

### Background-location/media evidence video

Keep the video at 30 seconds or less and show the real consumer candidate:

1. Launch Trailhead and open the owned Original.
2. Tap Start Tour and show the full prominent disclosure.
3. Tap `Agree & continue` and show the Android location permission prompt.
4. Start the tour, press Home or lock the screen, and show the persistent
   Trailhead notification.
5. Use OS-level mocked travel on the immutable route so a real mapped cue starts
   downloaded narration.
6. Show lock-screen/notification play-pause controls and End Tour stopping the
   active experience.

The video must not use the admin simulator, debug UI, a second map engine, or a
manually pressed story that bypasses location triggering.

## Security, retention and deletion statements

- External production traffic uses HTTPS/TLS with normal platform certificate
  validation. Do not claim end-to-end encryption.
- Passwords are one-way hashed. Authentication tokens belong in platform
  Keychain/Keystore storage, not logs, analytics, ordinary preferences or URLs.
- Do not claim database, object-storage or backup encryption beyond provider
  controls until their current configuration is recorded.
- Account/saved content remains until deletion or item removal. Short-lived
  operational reports follow their own expiration rules.
- Purchase, credit-ledger, fraud-prevention, security and legally required
  records may have a limited documented retention exception.
- Aggregate product events contain no account or stable session identifier and
  no raw coordinates, traveled route, search text, support content, attachment,
  payout information, photo or arbitrary user-provided string.
- Sentry's fixed allowlist is authoritative. Unknown fields are removed rather
  than passed through.
- Support diagnostic consent defaults off.
- Raw trail-recording coordinates stay on device unless the user explicitly
  saves, exports or submits them.

## Final console sequence

1. Download/export the current Data Safety answers and capture screenshots of
   every App Content page before editing.
2. Inventory every active Play track, version code, dependency set and merged
   manifest. Reconcile the union, especially Branch-enabled artifacts.
3. Build 1.0.12 and verify its exact merged manifest/dependencies against this
   document.
4. Test account deletion against the complete fixture matrix.
5. Enter the top-level answers and each data type exactly as listed above.
6. Enter the two foreground-service explanations and background-location video.
7. Set Privacy, deletion, Ads, account creation, App access, UGC, audience and
   content declarations.
8. Save a draft and re-open every page to verify the values persisted.
9. Export the completed declaration and store it with the AAB, decoded manifest,
   dependency audit, screenshots and video hash.
10. Submit only when the uploaded AAB and active-track union match the form.

Stop submission if any active artifact, generated manifest, SDK scan, provider
agreement, deletion test, or console page contradicts this audit. Correct the
artifact or declare the additional collection/sharing; do not weaken the gate.
