# Google Play Data Safety audit

Last reviewed: July 26, 2026

This inventory describes the production Trailhead 1.0.10 code and backend. It is
the source of truth for the Google Play Data Safety form and the public privacy
policy. Re-run the audit whenever an SDK, permission, provider, or user-data
flow changes.

Google's form uses `collected` for data transmitted off the device, even when
the data is not retained. Google does not require a transfer to be declared as
`shared` when a contracted service provider processes it only on Trailhead's
behalf, when a user specifically initiates the expected external action, or
when another published exception applies. The provider still belongs in
Trailhead's public privacy disclosure.

## Current Play Console mismatch

The current form declares only `Device or other IDs`. The app also transmits
location, app activity, diagnostics, account information, user content,
purchase history, optional photos, optional support content, and optional voice
audio. The form also needs these corrections:

- Encryption in transit: **Yes**. Production external endpoints use HTTPS.
  Localhost HTTP is used only for the on-device offline tile/router service and
  does not transmit data to another party.
- Account creation: select **Username and password**, **Google OAuth**, and
  **Apple OAuth**.
- Account deletion URL: use
  `https://api.gettrailhead.app/delete-account`, not the generic home page.
- Do not select automatic deletion within 90 days. Account data is retained
  until the user deletes the account, subject to limited legal, security, and
  transaction-record retention described in the privacy policy.

## Conservative Google Play declaration

| Google category | Collected | Shared | Required | Main purposes | Trailhead examples |
|---|---:|---:|---|---|---|
| Name | Yes | No | Optional | App functionality, account management | Profile name and OAuth display name |
| Email address | Yes | No | Optional because guest use is available | App functionality, account management, developer communications | Registration, sign-in, verification, recovery |
| User IDs | Yes | No | Optional because guest use is available | App functionality, account management | Trailhead account ID and OAuth provider subject |
| Other personal info | Yes | No | Optional | App functionality, personalization | Vehicle/rig and camping preferences, referral and prize workflow status |
| Approximate location | Yes | No* | Optional | App functionality, personalization | Nearby Search, maps, weather, layers, routes |
| Precise location | Yes | No* | Optional | App functionality | Navigation, route building, nearby results, Original triggers |
| Purchase history | Yes | No* | Optional | App functionality, account management | Subscription and credit entitlement receipts verified with Apple/Google |
| Other in-app messages | Yes | No | Optional | App functionality | Support tickets and winner inbox messages |
| Photos | Yes | No | Optional | App functionality | Community reports, place photos, support screenshots |
| Voice or sound recordings | Yes | No* | Optional and ephemeral for Co-Pilot | App functionality | Co-Pilot microphone audio sent to OpenAI Realtime when the user starts voice |
| App interactions | Yes | No* | Required while analytics is enabled | App functionality, analytics | Privacy-minimized Trailhead events and provider requests |
| In-app search history | Yes | No* | Optional and operational | App functionality, personalization | Search text sent for Search Box and provider lookup; excluded from Trailhead analytics |
| Other user-generated content | Yes | No | Optional | App functionality | Trips, routes, notes, packing lists, ratings, comments, reports, edits |
| Crash logs | Yes | No* | Required while Sentry is enabled | Analytics | Sentry allowlisted exception type and stack frames |
| Diagnostics | Yes | No* | Required for automatic crash/performance fields; optional for support diagnostics | App functionality, analytics | App/build/runtime and fixed performance/error codes; support diagnostics require consent |
| Device or other IDs | Yes | No* | Required for automatic update/session metadata; push is optional | App functionality, analytics | Push token, Mapbox session identifiers, Expo update installation metadata |

`No*` assumes the current provider agreement and configuration limit the
recipient to service-provider processing on Trailhead's behalf, or the transfer
is the direct result of the user's expected action. Confirm that classification
against each current contract before submitting. If a provider independently
profiles, advertises to, or reuses the data, change that row to `shared` or
remove the provider from the app.

### Data types not currently selected

- Payment card or bank credentials: Trailhead does not receive or store full
  card details. Apple, Google Play, Stripe, PayPal, Cash App, or a bank handles
  credentials in their own approved flows.
- Contacts, SMS/call logs, installed apps, health/fitness, calendar, and general
  web-browsing history: Trailhead does not request these.
- Videos: Trailhead does not currently upload user video in the consumer app.
- Raw traveled routes in analytics: prohibited by Trailhead's telemetry policy.

## Third-party and service-provider transfers

| Provider | Data sent from the app or Trailhead server | Purpose and control |
|---|---|---|
| Mapbox | Map viewport, approximate/precise coordinates, route endpoints, Search Box text/session, and operational SDK/session metadata | Maps, Search, directions, and navigation. Nonessential SDK telemetry is forced off; operational map/Search requests are still required for those online features. |
| Branch | No production collection in the privacy-minimized candidate | Deferred referral attribution remains disabled. Manual referral codes and first-party referral URLs remain available. Do not re-enable Branch until its processing terms, TLS, opt-out, fresh-install and exactly-once behavior are approved, then revise this form if needed. |
| Sentry | Allowlisted stack frames, fixed error codes, platform, app/build/runtime/update, and static performance transaction names | Crash and performance monitoring. Default PII, breadcrumbs, arbitrary messages/URLs, device identifiers, location, routes, searches, support content, attachments, and payout data are removed. Session Replay and native delivery are disabled. |
| OpenAI | Optional Co-Pilot audio, transcript/request context, and server-side planning/brief context | Voice assistant, planning, and briefs. Co-Pilot audio is sent only after the user starts microphone use. |
| Expo, Firebase Cloud Messaging, Apple Push Notification service | Push token, target platform/device token, and notification payload | User-requested notifications, background service communication, and update delivery. |
| Apple and Google | OAuth token/provider subject and purchase receipt/entitlement data | Sign-in, subscriptions, credits, and purchase verification. Trailhead does not receive full payment credentials. |
| Stripe | Checkout/account and transaction identifiers for applicable web payments | Purchase processing. Trailhead does not receive full card details. |
| OpenTopoData and routing providers | Route coordinates | Elevation and route calculation when the selected online feature requires it. |
| RainViewer, Avalanche.org, USFS, USGS, OpenStreetMap and other map/content providers | Requested viewport/tile/layer coordinates plus normal network metadata such as IP address | Weather, avalanche, land, topo, trail, and other requested map layers. |
| NPS, RIDB/Recreation.gov, USFS, BLM, Wikimedia and other official/content sources | Requested place/content identifier and normal network metadata | Destination, campground, trail, official-media, and source information. |
| Anthropic | Server-side trip-planning request and relevant trip/preferences context when configured as the planner | Assisted trip planning. |
| ElevenLabs and Cartesia | Trailhead-authored narration scripts, voice/model configuration | Pre-published Originals narration; normally not consumer personal data. |
| Viator | Destination/tour lookup; booking data after the user chooses the separately labelled external booking flow | Guided-tour inventory and external fulfillment. |
| Railway/CDN/object-storage infrastructure | Data needed to host Trailhead APIs, accounts, content, downloads, and support attachments | Trailhead service operation and delivery. |

## Retention and controls

- Account and saved content remain until the account or item is deleted.
- Ephemeral provider requests can still require Google disclosure even when
  Trailhead does not retain them.
- Community operational reports use their product expiry rules; comments,
  ratings, edits, saved trips, and support records are not covered by that
  short report expiry.
- Purchase, credit-ledger, anti-fraud, security, and legal records may be
  retained only as required for those purposes.
- Users can delete their account in Profile after fresh password, Google, or
  Apple reauthentication. The deletion path removes owned account content.
- Third-party deferred referral attribution is disabled; manual referral codes remain.
- Mapbox telemetry is optional and defaults off in Trailhead.
- Support diagnostic consent defaults off.
- Location, microphone, photos, notifications, and Bluetooth/system-audio
  behavior remain controlled by the operating system and the relevant feature.

## Encryption and minimization roadmap

Current controls:

- External production traffic uses HTTPS with normal platform certificate
  validation. The only HTTP endpoint is a loopback-only tile/router service on
  the same device.
- Passwords are stored as one-way hashes rather than encrypted reversible
  passwords.
- Authentication secrets belong in iOS Keychain/Android Keystore through
  SecureStore, not ordinary preferences, logs, analytics, or URLs.
- Mapbox advertising-style telemetry and Branch deferred attribution are off by
  default. Manual first-party referral codes remain available.
- Sentry receives a fixed allowlist instead of arbitrary event data.

Before claiming encrypted storage beyond platform protections, verify and
record the production database, object storage, and backup provider settings.
The next hardening pass should:

1. Require encrypted managed volumes, object storage, and backups.
2. Use envelope encryption with AES-256-GCM and a managed KMS for particularly
   sensitive support attachments or workflow records; keep keys outside the
   database and support rotation.
3. Keep access and refresh tokens in SecureStore and rotate/revoke them on
   sign-out, account deletion, or suspected compromise.
4. Consider a Keystore/Keychain-backed encrypted local database for private
   trips and notes. Public offline tiles and public-place packs do not need
   field-level encryption, but remain inside the app sandbox.
5. Strip EXIF from uploaded support/community images, use short-lived signed
   attachment URLs, least-privilege service credentials, HSTS, and encrypted
   backup retention/deletion tests.

Do not add certificate pinning casually: it can strand production clients
during certificate rotation. TLS validation, HSTS, scoped tokens, rotation,
and server-side authorization provide a safer baseline unless a maintained
pin-rotation system is introduced.

## Review checklist

- [ ] Compare the production Android manifest, dependency lockfile, and public
      privacy policy with this document.
- [ ] Confirm the Play form lists every collected data type above.
- [ ] Confirm required/optional status matches the feature gate shown to users.
- [ ] Confirm every shared answer and applicable service-provider exception
      with the current contracts before submission.
- [ ] Use the dedicated deletion URL and test the in-app deletion flow.
- [ ] Save screenshots/PDF of the submitted form with the release evidence.
- [ ] Re-run after adding or removing any analytics, attribution, map, voice,
      payment, messaging, or support SDK.
