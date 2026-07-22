# Android audit harness

`android-app-audit.mjs` collects reproducible evidence from an installed Trailhead app without changing app or account state.

## Read-only baseline

```powershell
npm run audit:android -- --serial RFCR408DA9B --label explore-baseline
```

Run commands from the WSL repository path (`/home/sean/.openclaw/workspace/trailhead/mobile`) rather than a Windows UNC working directory. The harness detects WSL and uses the Windows SDK `adb.exe` so it can see USB devices and Windows emulators.

Omit `--serial` to capture every connected, authorized target. Evidence is written below the ignored repository directory `output/android-audit/<timestamp>-<label>/` and includes:

- PNG screenshot and UIAutomator accessibility hierarchy
- visible text, accessibility copy flags, and available resource/test IDs
- current/resumed activity and complete activity/window snapshots
- device, OS, screen, package version, PID, and font-scale metadata
- PSS/RSS/swap, view/activity counts, and the raw `dumpsys meminfo` result
- app-process logcat, bounded system tail, crash/ANR filter, and focused log findings
- SHA-256 and byte count for each evidence artifact

The baseline command does not launch, restart, stop, tap, swipe, install, clear data, clear logcat, change permissions, or make network/account mutations. UIAutomator uses one temporary XML file in shared storage and removes it after capture.

Evidence can include a username, notification text, URLs, or other on-screen/log data. Keep the ignored output private and redact it before attaching it to a public issue.

## Guarded scenarios

Scenario mode is a dry run unless `--execute-safe-actions` is present:

```powershell
node scripts/android-app-audit.mjs scenario `
  --serial emulator-5554 `
  --scenario scripts/audit-scenarios/example.safe.json
```

Supported actions are `capture`, bounded `wait`, stable-selector `tap`, deterministic `swipe`, and `back`. Taps prefer `testID` or exact Android `resourceId`; exact accessibility descriptions are also supported. Exact text requires the separate `--allow-text-actions` acknowledgement. Raw coordinate taps are not supported.

Even in execute mode, the harness blocks targets whose copy suggests purchase, booking, payout, subscription, deletion, logout, submission, publishing, prize claiming, referral sending, or account mutation. Paid/destructive/report-submission paths should use fixtures or mocks instead.

## Optional recording

Pass `--record-seconds 1..30` for a bounded MP4. Recording is disabled by default. It records the current device state and does not navigate by itself.

## Verification

```powershell
npm run test:android-audit
```

When a screen has no app-owned resource IDs, add stable `testID` values during the reviewed implementation wave before relying on an automated tap scenario.
