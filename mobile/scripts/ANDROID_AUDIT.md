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

## Deterministic Map memory gate

Run the physical-device memory gate only after installing the exact candidate.
It requires one explicit device, verifies the EAS preview build and the
admin-only on-device release identity, and refuses to proceed while navigation
or a Trailhead Original is active.

```powershell
npm run audit:android-map-memory -- --serial RFCR408DA9B `
  --expected-version-name 1.0.10 `
  --expected-version-code 59 `
  --expected-commit-sha 83287394ce41f1100bd980c9249f20d364b51db7 `
  --expected-build-commit-sha cd61f6c3dbf9d176bc49b2d96a2c13fc9470dcaf `
  --runtime native-1.0.10-android.1 `
  --build-id 06142308-0199-46cc-8a4c-fb9d45bca25e `
  --update-id 019f8e05-bad8-7925-8d46-54d2627b76b8
```

The OTA/source SHA must match the identity reported by the running update and
must be an ancestor of the checked-in harness. The harness SHA is recorded
separately so a test-only gate improvement can measure an already-installed
candidate. The binary-build SHA may be older for a compatible JS-only OTA; it
must match the server-owned EAS build identified by `--build-id`.

The gate never installs, uninstalls, clears app data, changes permissions, or
changes account state. It brings the current app to the foreground for a safety
check, force-stops and cold-launches it, and continuously requires the device to
remain awake with Trailhead visible and top-resumed during measurement. It then
measures signed-in Explore, an idle Map with the stress layers disabled, both
the enabled peak and disabled recovery valley for ten cycles, post-Map recovery,
and Explore recovery. Every layer is restored to its exact starting value even
when a check fails or the run is interrupted. Layer toggling is a deterministic
memory workload, not a duplicate functional Layers audit.

`AndroidMemoryGateReportV3` records PSS, SwapPSS, RSS, a clearly labelled
PSS-minus-SwapPSS diagnostic, selected native/graphics/unknown categories,
object counts, cycle slopes, recovery, and numeric process-exit evidence.
Android defines PSS and RSS as the authoritative memory signals; the subtraction
is retained only to explain older vendor output and is never called resident
PSS or used as a pass condition. Explore, idle Map, heavy Map, and active
navigation/3D/Original experiences have separate source-controlled budgets that
cannot be changed through CLI flags. Active experience phases are measured by
their dedicated fixture/device tests rather than being started by this
non-destructive Map gate. The ignored JSON evidence does not store the serial,
screenshots, UI hierarchy, logs, coordinates, routes, search text, account
identifiers, or support/payout data.

The pre-preview and CI suites run only the pure gate contract test; they never
connect to a device or execute the physical memory gate:

```powershell
npm run test:android-map-memory
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
