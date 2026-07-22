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
5. From Windows PowerShell, inject the reviewed evidence fixture:

```powershell
& .\scripts\android-originals-evidence.ps1 `
  -Serial RFCR408DA9B `
  -FixturePath C:\path\to\approved-moab-evidence-trace.json
```

The approved fixture must be exported from the immutable published manifest and
must include continuous route samples, not cue-to-cue jumps. Use at least a
3.5-second interval so the trigger's consecutive-fix rule is exercised. Show a
real GPS-triggered story, notification playback, return to the active player,
and **End tour** stopping location and audio.

The script restores the real GPS provider and the shell mock-location app-op in
`finally`, including when injection fails. It does not alter ownership,
progress, production analytics, Android Auto, or the admin simulator.
