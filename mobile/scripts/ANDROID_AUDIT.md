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

Bind evidence to the exact candidate without storing private data:

```powershell
npm run audit:android -- --serial RFCR408DA9B --label preview-search `
  --runtime native-1.0.10-android.1 `
  --build-id 06142308-0199-46cc-8a4c-fb9d45bca25e `
  --update-id 019f8a0e-c002-75e4-b52b-1f20b9128950 `
  --account-role admin `
  --feature-stage TRAILHEAD_ORIGINALS_STAGE=internal
```

Those values and the parent-repository commit are written to `candidate.json`
for every capture/scenario run. Only allowlisted identifiers and feature-stage
values are accepted; never put coordinates, query text, account IDs, support
content, or credentials in these arguments.

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

## Pinned Maestro smoke flows

The checked-in workspace uses Maestro CLI `2.4.0`; the runner refuses another
version and requires an exact device so a two-device setup cannot be selected at
random.

```powershell
bash scripts/install-maestro.sh
npm run maestro:doctor
npm run maestro:smoke -- --device RFCR408DA9B --app-id com.trailhead.app
```

The smoke suite preserves app data and covers launch, all five tabs, rapid
search typing with no automatic result opening, and a warm Map return. Results
remain under ignored `output/maestro/`. These are safe baseline flows, not paid,
destructive, report-submission, download, or tour-progress tests.

For the exact installed Android Auto candidate, use:

```powershell
npm run android:auto:dhu -- --serial RFCR408DA9B --no-install `
  --expected-version-name 1.0.10 --expected-version-code 59
```

The DHU launcher fails if the expected package/version is missing or another
Trailhead package could be selected. It never installs the debug APK implicitly.

When a screen has no app-owned resource IDs, add stable `testID` values during the reviewed implementation wave before relying on an automated tap scenario.
