# Android Originals policy evidence

Use the real 1.0.10 preview candidate. The admin simulator is not valid policy
evidence and this harness does not call it. It injects locations through
Android's OS test-provider command while the production Originals runtime owns
the session, foreground service, notification, trigger persistence, and audio.

Before recording:

1. Install the paired-candidate Android APK and sign in to the approved QA account.
2. Open the Moab Original, finish the offline download, and tap **Start tour**.
3. Record the disclosure, **Agree & continue**, Android permission prompt, and
   the visible user-initiated start. Never pre-grant these for the evidence take.
4. Put Trailhead behind another app or lock the phone and show the persistent
   `Trailhead Original active` notification.
5. Export the fixture from the exact immutable published manifest. The export
   runs the authoritative route-validation matrix and refuses a changed or
   failing manifest:

```powershell
npm run originals:fixture -- --manifest C:\path\to\published-manifest.json `
  --pack-id original_moab_canyons_to_sky --version 1 `
  --output C:\evidence\moab-v1-continuous.json

npm run originals:fixture -- --verify `
  --manifest C:\path\to\published-manifest.json `
  --fixture C:\evidence\moab-v1-continuous.json
```

6. From Windows PowerShell, inject that reviewed, hash-pinned fixture:

```powershell
& .\scripts\android-originals-evidence.ps1 `
  -Serial RFCR408DA9B `
  -FixturePath C:\evidence\moab-v1-continuous.json `
  -ExpectedPackId original_moab_canyons_to_sky `
  -ExpectedVersion 1 `
  -ExpectedManifestSha256 <sha256-from-fixture> `
  -StartProgressM 0 -EndProgressM 3000
```

The approved fixture contains continuous 3.1-second route samples rather than
cue-to-cue jumps, so the trigger's consecutive-fix rule is exercised. Show a
real GPS-triggered story, notification playback, return to the active player,
and **End tour** stopping location and audio.

The optional progress bounds select one continuous evidence segment from the
full validated fixture; they never synthesize cue-to-cue jumps. Use the route
window containing the reviewed story so a policy recording does not need to
replay the entire multi-hour drive in real time.

The script restores the real GPS provider and the shell mock-location app-op in
`finally`, including when injection fails. It does not alter ownership,
progress, production analytics, Android Auto, or the admin simulator.

The fixture contains only the published manifest identity/hash and synthetic
location fixes. It contains no transcript, narration asset, account identifier,
token, ownership record, or saved session progress.
