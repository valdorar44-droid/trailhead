#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actionSafety,
  findAdb,
  findNode,
  parseArgs,
  parseDevices,
  parseMeminfo,
  parseUiNodes,
  sanitizeSegment,
  sha256,
  summarizeUi,
  summarizeLogcat,
  swipePoints,
  tapPoint,
} from './android-audit-lib.mjs';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');

function usage() {
  console.log(`Trailhead Android audit harness

Read-only discovery (default; captures every authorized device):
  node scripts/android-app-audit.mjs capture [--serial RFCR408DA9B] [--label baseline]

Preview a safe scenario without executing actions:
  node scripts/android-app-audit.mjs scenario --serial RFCR408DA9B --scenario scripts/audit-scenarios/example.safe.json

Execute only guarded navigation/scroll actions:
  node scripts/android-app-audit.mjs scenario --serial RFCR408DA9B --scenario <file> --execute-safe-actions

Options:
  --package <id>             Default: com.trailhead.app
  --output <directory>       Default: <repo>/output/android-audit
  --adb <path>               Explicit Android platform-tools adb
  --record-seconds <0..30>   Optional screen recording; disabled by default
  --log-lines <100..10000>   Default: 2000
  --allow-text-actions       Permit exact-text scenario selectors (testID/resource-id preferred)
  --runtime <safe-id>        Expected EAS runtime for this candidate
  --build-id <safe-id>       EAS build ID for this candidate
  --update-id <safe-id>      EAS update ID for this candidate
  --account-role <role>      guest, account, explorer, or admin
  --feature-stage FLAG=value Repeatable non-sensitive feature-stage evidence

The harness never installs, launches, force-stops, clears data, clears logcat, changes
permissions, submits reports, makes purchases, deletes content, or mutates accounts.`);
}

function gitSha() {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  const value = String(result.stdout || '').trim();
  return result.status === 0 && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function candidateEvidence(options) {
  return {
    schema_version: 1,
    git_sha: gitSha(),
    runtime: options.runtime,
    build_id: options.buildId,
    update_id: options.updateId,
    account_role: options.accountRole,
    feature_stages: Object.fromEntries(options.featureStages.map(value => value.split(/=(.*)/s).slice(0, 2))),
    privacy: 'No coordinates, route geometry, search text, support content, payout data, credentials, or account identifiers.',
  };
}

function run(adb, serial, args, options = {}) {
  const result = spawnSync(adb, ['-s', serial, ...args], {
    encoding: options.binary ? null : 'utf8',
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    timeout: options.timeout ?? 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr;
    throw new Error(`adb ${args.join(' ')} failed (${result.status}): ${String(stderr || '').trim()}`);
  }
  return options.binary ? result.stdout : String(result.stdout || '').replace(/\r\n/g, '\n');
}

function runHost(adb, args) {
  const result = spawnSync(adb, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 15_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`adb ${args.join(' ')} failed: ${String(result.stderr || '').trim()}`);
  return String(result.stdout || '').replace(/\r\n/g, '\n');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return path;
}

function getProp(adb, serial, name) {
  return run(adb, serial, ['shell', 'getprop', name], { allowFailure: true }).trim();
}

function parseWmSize(text) {
  const override = String(text).match(/Override size:\s*(\d+)x(\d+)/i);
  const physical = String(text).match(/Physical size:\s*(\d+)x(\d+)/i);
  const match = override || physical;
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function captureUi(adb, serial, directory, stem = 'ui') {
  const remote = `/sdcard/trailhead-audit-${process.pid}-${Date.now()}.xml`;
  let xml = '';
  try {
    run(adb, serial, ['shell', 'uiautomator', 'dump', remote], { allowFailure: false, timeout: 20_000 });
    xml = run(adb, serial, ['exec-out', 'cat', remote], { maxBuffer: 20 * 1024 * 1024 });
  } finally {
    run(adb, serial, ['shell', 'rm', '-f', remote], { allowFailure: true });
  }
  write(join(directory, `${stem}.xml`), xml);
  const nodes = parseUiNodes(xml);
  const summary = summarizeUi(nodes);
  write(join(directory, `${stem}-summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
  return { nodes, summary };
}

function captureScreenshot(adb, serial, path) {
  const png = run(adb, serial, ['exec-out', 'screencap', '-p'], { binary: true, maxBuffer: 40 * 1024 * 1024 });
  if (!png?.length || png.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error('adb screencap did not return a PNG');
  write(path, png);
  return png;
}

function captureRecording(adb, serial, path, seconds) {
  if (!seconds) return null;
  const remote = `/sdcard/trailhead-audit-${process.pid}-${Date.now()}.mp4`;
  let video;
  try {
    run(adb, serial, ['shell', 'screenrecord', '--time-limit', String(seconds), remote], { timeout: (seconds + 10) * 1000 });
    video = run(adb, serial, ['exec-out', 'cat', remote], { binary: true, maxBuffer: 256 * 1024 * 1024, timeout: 30_000 });
  } finally {
    run(adb, serial, ['shell', 'rm', '-f', remote], { allowFailure: true });
  }
  write(path, video);
  return video;
}

function collectMetadata(adb, serial, packageName) {
  const wmSizeText = run(adb, serial, ['shell', 'wm', 'size'], { allowFailure: true });
  const packageDump = run(adb, serial, ['shell', 'dumpsys', 'package', packageName], { allowFailure: true, maxBuffer: 16 * 1024 * 1024 });
  const pidText = run(adb, serial, ['shell', 'pidof', packageName], { allowFailure: true }).trim();
  const pid = pidText.split(/\s+/).find((part) => /^\d+$/.test(part)) || null;
  const versionName = packageDump.match(/versionName=([^\s]+)/)?.[1] ?? null;
  const versionCode = packageDump.match(/versionCode=(\d+)/)?.[1] ?? null;
  const currentFocus = run(adb, serial, ['shell', 'dumpsys', 'window', 'windows'], { allowFailure: true, maxBuffer: 12 * 1024 * 1024 });
  const resumed = run(adb, serial, ['shell', 'dumpsys', 'activity', 'activities'], { allowFailure: true, maxBuffer: 24 * 1024 * 1024 });
  return {
    metadata: {
      capturedAt: new Date().toISOString(),
      serial,
      manufacturer: getProp(adb, serial, 'ro.product.manufacturer'),
      model: getProp(adb, serial, 'ro.product.model'),
      product: getProp(adb, serial, 'ro.product.name'),
      androidRelease: getProp(adb, serial, 'ro.build.version.release'),
      sdk: getProp(adb, serial, 'ro.build.version.sdk'),
      buildFingerprint: getProp(adb, serial, 'ro.build.fingerprint'),
      locale: getProp(adb, serial, 'persist.sys.locale') || getProp(adb, serial, 'ro.product.locale'),
      screen: parseWmSize(wmSizeText),
      density: run(adb, serial, ['shell', 'wm', 'density'], { allowFailure: true }).trim(),
      fontScale: run(adb, serial, ['shell', 'settings', 'get', 'system', 'font_scale'], { allowFailure: true }).trim(),
      packageName,
      installed: packageDump.includes(`Package [${packageName}]`) || Boolean(versionName),
      versionName,
      versionCode,
      pid,
      focusedActivity: currentFocus.match(/mCurrentFocus=([^\n]+)/)?.[1]?.trim()
        ?? resumed.match(/mCurrentFocus=([^\n]+)/)?.[1]?.trim()
        ?? null,
      resumedActivity: resumed.match(/(?:topResumedActivity=|mResumedActivity:|ResumedActivity:)\s*([^\n]+)/)?.[1]?.trim() ?? null,
    },
    packageDump,
    currentFocus,
    resumed,
  };
}

function filterLogcat(logcat, packageName, pid) {
  const lines = String(logcat).split(/\r?\n/);
  const appNeedles = [packageName, 'ReactNativeJS', 'ReactNative', pid].filter(Boolean);
  const alertPattern = /FATAL EXCEPTION|AndroidRuntime:\s+FATAL|ANR in |SIG(?:ABRT|SEGV)|OutOfMemory|Application Not Responding|E\/ReactNativeJS|Unhandled JS Exception/i;
  return {
    app: lines.filter((line) => appNeedles.some((needle) => line.includes(String(needle)))).join('\n'),
    alerts: lines.filter((line) => alertPattern.test(line)).join('\n'),
  };
}

function artifactManifest(directory, names) {
  const artifacts = [];
  for (const name of names) {
    const path = join(directory, name);
    try {
      const data = readFileSync(path);
      artifacts.push({ name, bytes: data.length, sha256: sha256(data) });
    } catch {
      // Optional artifacts are omitted from the manifest.
    }
  }
  return artifacts;
}

function captureDevice(adb, device, options, root, candidate, suffix = '') {
  const serial = device.serial;
  const directory = join(root, `${sanitizeSegment(device.attributes.model || serial)}--${sanitizeSegment(serial)}`, `${sanitizeSegment(options.label)}${suffix}`);
  mkdirSync(directory, { recursive: true });
  const { metadata, packageDump, currentFocus, resumed } = collectMetadata(adb, serial, options.packageName);
  write(join(directory, 'device-app-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  write(join(directory, 'package.txt'), packageDump);
  write(join(directory, 'window-focus.txt'), currentFocus);
  write(join(directory, 'activity-state.txt'), resumed);
  const memoryText = run(adb, serial, ['shell', 'dumpsys', 'meminfo', options.packageName], { allowFailure: true, maxBuffer: 16 * 1024 * 1024 });
  const memory = parseMeminfo(memoryText);
  write(join(directory, 'memory.txt'), memoryText);
  const screenshot = captureScreenshot(adb, serial, join(directory, 'screenshot.png'));
  const { summary } = captureUi(adb, serial, directory);
  const logcat = run(adb, serial, ['logcat', '-d', '-v', 'threadtime', '-t', String(options.logLines)], { allowFailure: true, maxBuffer: 64 * 1024 * 1024 });
  const logs = filterLogcat(logcat, options.packageName, metadata.pid);
  const appLogcat = metadata.pid
    ? run(adb, serial, ['logcat', '-d', '-v', 'threadtime', '-t', String(options.logLines), `--pid=${metadata.pid}`], { allowFailure: true, maxBuffer: 64 * 1024 * 1024 })
    : logs.app;
  const logFindings = summarizeLogcat(appLogcat);
  write(join(directory, 'logcat-app.txt'), `${appLogcat}\n`);
  write(join(directory, 'logcat-alerts.txt'), `${logs.alerts}\n`);
  write(join(directory, 'logcat-tail.txt'), logcat);
  write(join(directory, 'logcat-findings.json'), `${JSON.stringify(logFindings, null, 2)}\n`);
  if (options.recordSeconds) captureRecording(adb, serial, join(directory, 'screen-recording.mp4'), options.recordSeconds);
  const summaryFile = {
    capturedAt: metadata.capturedAt,
    captureMode: 'read-only-current-state',
    mutationsPerformed: false,
    appForeground: Boolean(metadata.focusedActivity?.includes(options.packageName) || metadata.resumedActivity?.includes(options.packageName)),
    screenshotBytes: screenshot.length,
    ui: summary,
    memory,
    logFindings,
    logAlertLineCount: logs.alerts ? logs.alerts.split(/\r?\n/).filter(Boolean).length : 0,
    candidate,
    notes: [
      'No app launch, force-stop, install, permission change, data clear, tap, swipe, back action, or logcat clear was performed.',
      'A UIAutomator dump temporarily written to shared storage was removed immediately after capture.',
    ],
  };
  write(join(directory, 'capture-summary.json'), `${JSON.stringify(summaryFile, null, 2)}\n`);
  const artifactNames = [
    'device-app-metadata.json', 'package.txt', 'window-focus.txt', 'activity-state.txt', 'memory.txt',
    'screenshot.png', 'ui.xml', 'ui-summary.json', 'logcat-app.txt', 'logcat-alerts.txt', 'logcat-tail.txt', 'logcat-findings.json',
    'screen-recording.mp4', 'capture-summary.json',
  ];
  write(join(directory, 'manifest.json'), `${JSON.stringify({ artifacts: artifactManifest(directory, artifactNames) }, null, 2)}\n`);
  return { directory, metadata, summary: summaryFile };
}

function resolveScenarioPath(value) {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function loadScenario(path) {
  const scenario = JSON.parse(readFileSync(resolveScenarioPath(path), 'utf8'));
  if (!Array.isArray(scenario.actions)) throw new Error('scenario JSON must contain an actions array');
  if (scenario.actions.length > 100) throw new Error('scenario may contain at most 100 actions');
  return scenario;
}

function currentScreenSize(adb, serial) {
  const size = parseWmSize(run(adb, serial, ['shell', 'wm', 'size'], { allowFailure: true }));
  if (!size) throw new Error('unable to determine device screen size');
  return size;
}

function scenarioStep(adb, device, options, directory, action, index) {
  const step = `${String(index + 1).padStart(2, '0')}-${sanitizeSegment(action.label || action.type)}`;
  const beforeDir = join(directory, step, 'before');
  mkdirSync(beforeDir, { recursive: true });
  captureScreenshot(adb, device.serial, join(beforeDir, 'screenshot.png'));
  const { nodes, summary } = captureUi(adb, device.serial, beforeDir);
  let node = null;
  if (action.type === 'tap') node = findNode(nodes, action.selector, options.packageName, options.allowTextActions);
  const safety = actionSafety(action, node);
  const plan = { index, action, selectorMatch: node, safety, executed: false };
  write(join(directory, step, 'action-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  if (!safety.safe) throw new Error(`step ${index + 1} blocked: ${safety.reason}`);
  if (!options.executeSafeActions) return { ...plan, uiSummary: summary };
  if (action.type === 'wait') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(action.ms ?? 500));
  } else if (action.type === 'tap') {
    const point = tapPoint(node);
    run(adb, device.serial, ['shell', 'input', 'tap', String(point.x), String(point.y)]);
  } else if (action.type === 'swipe') {
    const size = currentScreenSize(adb, device.serial);
    const points = swipePoints(action.direction, size.width, size.height);
    run(adb, device.serial, ['shell', 'input', 'swipe', ...points.map(String), String(action.durationMs ?? 350)]);
  } else if (action.type === 'back') {
    run(adb, device.serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  }
  if (action.type !== 'capture' && action.type !== 'wait') {
    const settleMs = Math.max(0, Math.min(Number(action.settleMs ?? 700) || 700, 3000));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, settleMs);
  }
  const afterDir = join(directory, step, 'after');
  mkdirSync(afterDir, { recursive: true });
  captureScreenshot(adb, device.serial, join(afterDir, 'screenshot.png'));
  captureUi(adb, device.serial, afterDir);
  plan.executed = true;
  write(join(directory, step, 'action-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

function runScenario(adb, device, options, root, candidate) {
  const scenario = loadScenario(options.scenario);
  const directory = join(root, `${sanitizeSegment(device.attributes.model || device.serial)}--${sanitizeSegment(device.serial)}`, `${sanitizeSegment(options.label)}-scenario`);
  mkdirSync(directory, { recursive: true });
  const results = [];
  for (let index = 0; index < scenario.actions.length; index += 1) {
    results.push(scenarioStep(adb, device, options, directory, scenario.actions[index], index));
  }
  const report = {
    name: scenario.name || null,
    serial: device.serial,
    dryRun: !options.executeSafeActions,
    actionCount: results.length,
    candidate,
    results,
  };
  write(join(directory, 'scenario-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { directory, report };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help') return usage();
  if (!['capture', 'scenario'].includes(options.command)) throw new Error(`Unknown command: ${options.command}`);
  const adb = findAdb(options.adb);
  const root = resolve(options.output || join(repoRoot, 'output', 'android-audit'), `${timestamp()}--${sanitizeSegment(options.label)}`);
  mkdirSync(root, { recursive: true });
  const candidate = candidateEvidence(options);
  write(join(root, 'candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`);
  const devices = parseDevices(runHost(adb, ['devices', '-l']));
  const unavailable = devices.filter((device) => device.state !== 'device');
  if (unavailable.length) console.warn(`Ignoring unavailable devices: ${unavailable.map((device) => `${device.serial} (${device.state})`).join(', ')}`);
  let targets = devices.filter((device) => device.state === 'device');
  if (options.serials.length) targets = targets.filter((device) => options.serials.includes(device.serial));
  const missing = options.serials.filter((serial) => !targets.some((device) => device.serial === serial));
  if (missing.length) throw new Error(`Requested devices are not authorized/connected: ${missing.join(', ')}`);
  if (!targets.length) throw new Error('No authorized Android devices are connected.');
  const results = [];
  for (const device of targets) {
    console.log(`${options.command === 'scenario' ? 'Auditing scenario on' : 'Capturing'} ${device.serial} (${device.attributes.model || 'unknown model'})...`);
    results.push(options.command === 'scenario'
      ? runScenario(adb, device, options, root, candidate)
      : captureDevice(adb, device, options, root, candidate));
  }
  write(join(root, 'run-summary.json'), `${JSON.stringify({
    command: options.command,
    dryRun: options.command === 'capture' || !options.executeSafeActions,
    packageName: options.packageName,
    candidate,
    adb,
    devices: results.map((result) => ({ directory: result.directory, metadata: result.metadata, summary: result.summary, report: result.report })),
  }, null, 2)}\n`);
  console.log(`Evidence saved to ${root}`);
}

main().catch((error) => {
  console.error(`Android audit failed: ${error?.message || error}`);
  process.exit(1);
});
