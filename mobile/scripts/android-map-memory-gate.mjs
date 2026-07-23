#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findAdb,
  parseDevices,
  parseMeminfo,
  parseUiNodes,
  tapPoint,
} from './android-audit-lib.mjs';
import { fetchEasBuild } from './eas-build-evidence.mjs';

export const MAX_TOTAL_PSS_KB = 512_000;
export const MAX_GROWTH_PERCENT = 10;
export const BASELINE_SETTLE_MS = 90_000;
export const SAMPLE_GAP_MS = 3_000;
export const MAP_LAYER_CYCLE_COUNT = 10;
export const HEAVY_MAP_LAYER_KEYS = Object.freeze([
  '3d',
  'lands',
  'usgs',
  'pois',
  'trails',
  'fire',
  'ava',
  'radar',
  'mvum',
]);
export const APPROVED_TRAILHEAD_ANDROID_PACKAGES = Object.freeze(['com.trailhead.app']);
export const TRAILHEAD_EAS_PROJECT_ID = '92c016d2-6e63-480e-a483-a6898d7e77d5';
export const QA_DIAGNOSTICS_URI = 'trailhead:///qa/telemetry';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');
const evidenceRoot = join(repoRoot, 'output', 'android-map-memory-gate');
const ACTIVE_NAVIGATION_IDS = new Set(['map.navigation.end']);
const ACTIVE_ORIGINAL_IDS = new Set([
  'originals.player.sheet',
  'originals.player.resume-pill',
  'originals.legacy-player.screen',
]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

export class MemoryGateError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'MemoryGateError';
    this.code = code;
  }
}

export function parseMemoryGateArgs(argv) {
  const options = {
    serial: null,
    packageName: 'com.trailhead.app',
    adb: null,
    expectedVersionName: null,
    expectedVersionCode: null,
    expectedCommitSha: null,
    expectedBuildCommitSha: null,
    runtime: null,
    buildId: null,
    updateId: null,
    help: false,
  };
  const args = [...argv];
  while (args.length) {
    const flag = args.shift();
    const take = () => {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new MemoryGateError('invalid_arguments', `${flag} requires a value`);
      return value;
    };
    if (flag === '--serial') options.serial = take();
    else if (flag === '--package') options.packageName = take();
    else if (flag === '--adb') options.adb = take();
    else if (flag === '--expected-version-name') options.expectedVersionName = take();
    else if (flag === '--expected-version-code') options.expectedVersionCode = take();
    else if (flag === '--expected-commit-sha') options.expectedCommitSha = take();
    else if (flag === '--expected-build-commit-sha') options.expectedBuildCommitSha = take();
    else if (flag === '--runtime') options.runtime = take();
    else if (flag === '--build-id') options.buildId = take();
    else if (flag === '--update-id') options.updateId = take();
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new MemoryGateError('invalid_arguments', `Unknown option: ${flag}`);
  }
  if (options.help) return options;
  if (!options.serial || !SAFE_IDENTIFIER.test(options.serial)) {
    throw new MemoryGateError('invalid_serial', '--serial is required and must be an exact safe device identifier');
  }
  if (!APPROVED_TRAILHEAD_ANDROID_PACKAGES.includes(options.packageName)) {
    throw new MemoryGateError('invalid_package', '--package must be an approved Trailhead application ID');
  }
  if (options.expectedVersionCode != null && !/^\d{1,12}$/.test(options.expectedVersionCode)) {
    throw new MemoryGateError('invalid_version_code', '--expected-version-code must contain digits only');
  }
  for (const [flag, value] of [
    ['--expected-version-name', options.expectedVersionName],
    ['--runtime', options.runtime],
    ['--build-id', options.buildId],
    ['--update-id', options.updateId],
  ]) {
    if (value != null && !SAFE_IDENTIFIER.test(value)) {
      throw new MemoryGateError('invalid_identifier', `${flag} contains unsupported characters`);
    }
  }
  if (!options.expectedCommitSha || !/^[a-f0-9]{40}$/i.test(options.expectedCommitSha)) {
    throw new MemoryGateError('invalid_commit_sha', '--expected-commit-sha must be a full Git SHA');
  }
  if (!options.expectedBuildCommitSha || !/^[a-f0-9]{40}$/i.test(options.expectedBuildCommitSha)) {
    throw new MemoryGateError('invalid_build_commit_sha', '--expected-build-commit-sha must be a full Git SHA');
  }
  for (const [flag, value] of [
    ['--expected-version-name', options.expectedVersionName],
    ['--expected-version-code', options.expectedVersionCode],
    ['--runtime', options.runtime],
    ['--build-id', options.buildId],
    ['--update-id', options.updateId],
  ]) {
    if (!value) throw new MemoryGateError('invalid_arguments', `${flag} is required`);
  }
  return options;
}

function usage() {
  console.log(`Trailhead deterministic Android map-memory gate

Usage:
  node scripts/android-map-memory-gate.mjs --serial RFCR408DA9B \\
    --expected-version-name 1.0.10 --expected-version-code 59 \\
    --expected-commit-sha <ota-source-sha> \\
    --expected-build-commit-sha <binary-build-sha> \\
    --runtime native-1.0.10-android.1 --build-id <eas-build-id> --update-id <eas-update-id>

The gate targets one exact authorized device, refuses active navigation or an
active Original, cold-launches without clearing app data, settles for 90 seconds,
captures every original layer value, disables all heavy layers for the baseline,
samples memory, cycles the heavy map layers ten times, restores the exact captured
values, and writes privacy-minimal evidence below ignored output/.

The acceptance limits are fixed and cannot be weakened from the command line:
  total PSS < 512000 KB and median growth < 10%.`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function gitSha() {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  const value = String(result.stdout || '').trim();
  return result.status === 0 && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function assertEvidenceDirectoryIgnored() {
  const result = spawnSync('git', ['-C', repoRoot, 'check-ignore', '-q', 'output/android-map-memory-gate'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.status !== 0) {
    throw new MemoryGateError('evidence_not_ignored', 'output/android-map-memory-gate must remain ignored by Git');
  }
}

function exactArgs(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function approvedPackage(value) {
  return APPROVED_TRAILHEAD_ANDROID_PACKAGES.includes(value);
}

/**
 * The device gate intentionally exposes only this narrow ADB command set. Any
 * future command must be reviewed here first; install, uninstall, pm clear,
 * permission, settings, account, and storage mutation commands are impossible.
 */
export function assertSafeMemoryGateAdbArgs(args) {
  if (exactArgs(args, ['devices', '-l'])) return true;
  if (args[0] !== '-s' || !SAFE_IDENTIFIER.test(args[1] || '')) {
    throw new MemoryGateError('unsafe_adb_command');
  }
  const command = args.slice(2);
  if (command[0] === 'exec-out' && command[1] === 'cat' && /^\/sdcard\/trailhead-memory-gate-[0-9-]+\.xml$/.test(command[2] || '') && command.length === 3) return true;
  if (command[0] !== 'shell') throw new MemoryGateError('unsafe_adb_command');
  const shell = command.slice(1);
  if (shell[0] === 'getprop' && /^ro\.(?:product\.(?:manufacturer|model)|build\.version\.(?:release|sdk))$/.test(shell[1] || '') && shell.length === 2) return true;
  if (shell[0] === 'dumpsys' && ['package', 'meminfo'].includes(shell[1]) && approvedPackage(shell[2]) && shell.length === 3) return true;
  if (shell[0] === 'dumpsys' && exactArgs(shell.slice(1, 3), ['activity', 'services']) && approvedPackage(shell[3]) && shell.length === 4) return true;
  if (shell[0] === 'uiautomator' && shell[1] === 'dump' && /^\/sdcard\/trailhead-memory-gate-[0-9-]+\.xml$/.test(shell[2] || '') && shell.length === 3) return true;
  if (shell[0] === 'rm' && shell[1] === '-f' && /^\/sdcard\/trailhead-memory-gate-[0-9-]+\.xml$/.test(shell[2] || '') && shell.length === 3) return true;
  if (shell[0] === 'cmd' && exactArgs(shell.slice(1, 7), ['package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c'])
    && shell[7] === 'android.intent.category.LAUNCHER'
    && approvedPackage(shell[8])
    && shell.length === 9) return true;
  if (shell[0] === 'am' && exactArgs(shell.slice(1, 3), ['force-stop', shell[2]]) && approvedPackage(shell[2]) && shell.length === 3) return true;
  if (shell[0] === 'am' && exactArgs(shell.slice(1, 3), ['start', '-W']) && shell[3] === '-n'
    && APPROVED_TRAILHEAD_ANDROID_PACKAGES.some(packageName => new RegExp(`^${packageName.replaceAll('.', '\\.')}/\\.?[A-Za-z0-9_.$]+$`).test(shell[4] || ''))
    && shell.length === 5) return true;
  if (shell[0] === 'am' && exactArgs(shell.slice(1, 5), ['start', '-W', '-a', 'android.intent.action.VIEW'])
    && shell[5] === '-d' && shell[6] === QA_DIAGNOSTICS_URI
    && shell[7] === '-p' && approvedPackage(shell[8]) && shell.length === 9) return true;
  if (shell[0] === 'input' && shell[1] === 'tap' && shell.slice(2).length === 2 && shell.slice(2).every(value => /^\d{1,5}$/.test(value))) return true;
  if (shell[0] === 'input' && shell[1] === 'swipe' && shell.slice(2).length === 5 && shell.slice(2).every(value => /^\d{1,5}$/.test(value))) return true;
  throw new MemoryGateError('unsafe_adb_command');
}

function runAdb(adb, args, options = {}) {
  assertSafeMemoryGateAdbArgs(args);
  const result = spawnSync(adb, args, {
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 24 * 1024 * 1024,
    timeout: options.timeout ?? 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new MemoryGateError(options.failureCode || 'adb_command_failed');
  }
  return String(result.stdout || '').replace(/\r\n/g, '\n');
}

function deviceArgs(serial, args) {
  return ['-s', serial, ...args];
}

function getProp(adb, serial, name) {
  return runAdb(adb, deviceArgs(serial, ['shell', 'getprop', name]), { allowFailure: true }).trim();
}

function packageMetadata(adb, serial, packageName) {
  const dump = runAdb(adb, deviceArgs(serial, ['shell', 'dumpsys', 'package', packageName]), {
    allowFailure: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    installed: dump.includes(`Package [${packageName}]`) || /versionName=/.test(dump),
    versionName: dump.match(/versionName=([^\s]+)/)?.[1] ?? null,
    versionCode: dump.match(/versionCode=(\d+)/)?.[1] ?? null,
  };
}

function captureUiXml(adb, serial) {
  const remote = `/sdcard/trailhead-memory-gate-${process.pid}-${Date.now()}.xml`;
  try {
    runAdb(adb, deviceArgs(serial, ['shell', 'uiautomator', 'dump', remote]), {
      failureCode: 'ui_dump_failed',
      timeout: 20_000,
    });
    return runAdb(adb, deviceArgs(serial, ['exec-out', 'cat', remote]), {
      failureCode: 'ui_dump_read_failed',
      maxBuffer: 20 * 1024 * 1024,
    });
  } finally {
    runAdb(adb, deviceArgs(serial, ['shell', 'rm', '-f', remote]), { allowFailure: true });
  }
}

function nodeMatchesTestId(node, testId, packageName) {
  const resourceId = String(node?.['resource-id'] || '');
  return resourceId === testId
    || resourceId === `${packageName}:id/${testId}`
    || resourceId.endsWith(`:id/${testId}`);
}

function nodeForTestId(nodes, testId, packageName, requireBounds = false) {
  return nodes.find(node => nodeMatchesTestId(node, testId, packageName) && (!requireBounds || node.bounds)) ?? null;
}

export function classifyActiveMapSession({ uiXml = '', serviceDump = '', packageName = 'com.trailhead.app' } = {}) {
  if (/\bTrailheadCarLocationService\b/.test(serviceDump)) return 'active_navigation_service';
  if (/\bLocationTaskService\b/.test(serviceDump)) return 'active_original_service';
  const nodes = parseUiNodes(uiXml);
  for (const id of ACTIVE_NAVIGATION_IDS) {
    if (nodeForTestId(nodes, id, packageName) || nodes.some(node => node['content-desc'] === 'End navigation')) {
      return 'active_navigation_ui';
    }
  }
  for (const id of ACTIVE_ORIGINAL_IDS) {
    if (nodeForTestId(nodes, id, packageName)) return 'active_original_ui';
  }
  return null;
}

function activeServiceDump(adb, serial, packageName) {
  return runAdb(adb, deviceArgs(serial, ['shell', 'dumpsys', 'activity', 'services', packageName]), {
    allowFailure: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function assertNoActiveMapSession(adb, serial, packageName, includeUi) {
  const serviceDump = activeServiceDump(adb, serial, packageName);
  const uiXml = includeUi ? captureUiXml(adb, serial) : '';
  const active = classifyActiveMapSession({ uiXml, serviceDump, packageName });
  if (active) throw new MemoryGateError(active);
}

function resolveLaunchComponent(adb, serial, packageName) {
  const output = runAdb(adb, deviceArgs(serial, [
    'shell', 'cmd', 'package', 'resolve-activity', '--brief',
    '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', packageName,
  ]), { failureCode: 'launch_activity_unavailable' });
  const component = output.split(/\r?\n/).map(value => value.trim()).find(value => (
    new RegExp(`^${packageName.replaceAll('.', '\\.')}/\\.?[A-Za-z0-9_.$]+$`).test(value)
  ));
  if (!component) throw new MemoryGateError('launch_activity_unavailable');
  return component;
}

function launchApp(adb, serial, component) {
  runAdb(adb, deviceArgs(serial, ['shell', 'am', 'start', '-W', '-n', component]), {
    failureCode: 'app_launch_failed',
    timeout: 30_000,
  });
}

function forceStopApp(adb, serial, packageName) {
  runAdb(adb, deviceArgs(serial, ['shell', 'am', 'force-stop', packageName]), {
    failureCode: 'app_force_stop_failed',
  });
}

let cancellationSignal = null;

function requestCancellation(signal) {
  cancellationSignal = signal;
  console.warn(`\n${signal} received; restoring the original layer state before exiting...`);
}

function assertNotCancelled() {
  if (cancellationSignal) throw new MemoryGateError('cancelled');
}

async function waitMs(ms, label = null) {
  let remaining = ms;
  while (remaining > 0) {
    assertNotCancelled();
    const step = Math.min(remaining, 30_000);
    if (label && remaining === ms) console.log(`${label} (${Math.ceil(ms / 1000)}s)`);
    await new Promise(resolve => setTimeout(resolve, step));
    remaining -= step;
    if (label && remaining > 0) console.log(`  ${Math.ceil(remaining / 1000)}s remaining`);
  }
  assertNotCancelled();
}

async function waitForTestId(adb, serial, packageName, testId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastNodes = [];
  while (Date.now() < deadline) {
    assertNotCancelled();
    lastNodes = parseUiNodes(captureUiXml(adb, serial));
    const node = nodeForTestId(lastNodes, testId, packageName, true);
    if (node) return { node, nodes: lastNodes };
    await waitMs(600);
  }
  throw new MemoryGateError(`selector_unavailable_${testId.replaceAll('.', '_')}`);
}

function tapNode(adb, serial, node) {
  if (!node?.bounds || node.enabled === 'false') throw new MemoryGateError('tap_target_unavailable');
  const point = tapPoint(node);
  runAdb(adb, deviceArgs(serial, ['shell', 'input', 'tap', String(point.x), String(point.y)]), {
    failureCode: 'tap_failed',
  });
}

export function horizontalCarouselSwipePoints(bounds, direction) {
  if (!bounds || bounds.right - bounds.left < 80 || bounds.bottom - bounds.top < 24) {
    throw new MemoryGateError('carousel_bounds_unavailable');
  }
  const width = bounds.right - bounds.left;
  // Move by less than one phone-sized layer card. A near-full-width swipe can
  // jump from the third card to the fifth card, leaving the fourth card's
  // accessibility node clipped out on both frames and making the gate report
  // a false missing-layer failure.
  const travel = Math.min(240, Math.max(56, Math.floor(width * 0.34)), width - 24);
  const centerX = Math.floor((bounds.left + bounds.right) / 2);
  const left = Math.floor(centerX - travel / 2);
  const right = Math.ceil(centerX + travel / 2);
  const y = Math.floor((bounds.top + bounds.bottom) / 2);
  return direction === 'forward'
    ? [right, y, left, y]
    : [left, y, right, y];
}

function swipeWithin(adb, serial, bounds, direction, durationMs = 220) {
  const points = horizontalCarouselSwipePoints(bounds, direction);
  runAdb(adb, deviceArgs(serial, ['shell', 'input', 'swipe', ...points.map(String), String(durationMs)]), {
    failureCode: 'carousel_swipe_failed',
  });
}

function swipeVerticallyWithin(adb, serial, bounds, direction, durationMs = 300) {
  if (!bounds || bounds.right - bounds.left < 24 || bounds.bottom - bounds.top < 80) {
    throw new MemoryGateError('sheet_bounds_unavailable');
  }
  const inset = Math.max(18, Math.floor((bounds.bottom - bounds.top) * 0.16));
  const top = bounds.top + inset;
  const bottom = bounds.bottom - inset;
  const x = Math.floor((bounds.left + bounds.right) / 2);
  const points = direction === 'forward'
    ? [x, bottom, x, top]
    : [x, top, x, bottom];
  runAdb(adb, deviceArgs(serial, ['shell', 'input', 'swipe', ...points.map(String), String(durationMs)]), {
    failureCode: 'sheet_swipe_failed',
  });
}

function nodeVisibleWithin(node, container) {
  if (!node?.bounds || !container?.bounds) return false;
  const centerX = (node.bounds.left + node.bounds.right) / 2;
  const centerY = (node.bounds.top + node.bounds.bottom) / 2;
  return centerX >= container.bounds.left + 4
    && centerX <= container.bounds.right - 4
    && centerY >= container.bounds.top
    && centerY <= container.bounds.bottom;
}

export function checkedStateFromNode(node) {
  if (!node || node.checkable !== 'true' || !['true', 'false'].includes(node.checked)) {
    throw new MemoryGateError('layer_accessibility_state_missing');
  }
  return node.checked === 'true';
}

function assertCompleteHeavyLayerState(states, expectedState = null) {
  if (!states || typeof states !== 'object') {
    throw new MemoryGateError('layer_state_snapshot_incomplete');
  }
  for (const key of HEAVY_MAP_LAYER_KEYS) {
    if (typeof states[key] !== 'boolean') {
      throw new MemoryGateError(`layer_state_snapshot_incomplete_${key}`);
    }
    if (expectedState != null && states[key] !== expectedState) {
      throw new MemoryGateError(`layer_baseline_not_disabled_${key}`);
    }
  }
  return states;
}

/**
 * Capture the user's exact layer choices before changing any of them, then
 * establish a deterministic all-disabled baseline. `onCaptured` is invoked
 * synchronously before the first toggle so the outer `finally` block can
 * restore a partially changed UI if disabling a later layer fails. Capturing
 * walks the carousel to its final item, so resetting the traversal before the
 * disable pass is a required part of this sequence.
 */
export async function captureAndDisableHeavyLayers({
  captureStates,
  resetBeforeDisable,
  disableLayers,
  onCaptured,
}) {
  const initialStates = { ...assertCompleteHeavyLayerState(await captureStates()) };
  onCaptured(initialStates);
  if (typeof resetBeforeDisable !== 'function') {
    throw new MemoryGateError('layer_traversal_reset_missing');
  }
  await resetBeforeDisable();
  const baselineStates = {
    ...assertCompleteHeavyLayerState(await disableLayers(), false),
  };
  return { initialStates, baselineStates };
}

export async function restoreCapturedHeavyLayers(initialStates, restoreStates) {
  const restorationTarget = {
    ...assertCompleteHeavyLayerState(initialStates),
  };
  const restored = await restoreStates(restorationTarget);
  if (restored !== true) throw new MemoryGateError('layer_restore_failed');
  return true;
}

async function ensureLayerSheet(adb, serial, packageName) {
  let nodes = parseUiNodes(captureUiXml(adb, serial));
  if (nodeForTestId(nodes, 'map.layers.toggle-carousel', packageName, true)) return;

  const mapTab = nodeForTestId(nodes, 'app.tab.map', packageName, true);
  if (!mapTab) throw new MemoryGateError('map_tab_unavailable');
  tapNode(adb, serial, mapTab);
  await waitMs(900);
  const { node: openLayers } = await waitForTestId(adb, serial, packageName, 'map.layers.open');
  tapNode(adb, serial, openLayers);
  await waitMs(700);

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    nodes = parseUiNodes(captureUiXml(adb, serial));
    if (nodeForTestId(nodes, 'map.layers.toggle-carousel', packageName, true)) return;
    const outer = nodeForTestId(nodes, 'map.layers.content', packageName, true);
    if (outer?.bounds) swipeVerticallyWithin(adb, serial, outer.bounds, 'forward', 300);
    await waitMs(450);
  }
  throw new MemoryGateError('layer_carousel_unavailable');
}

async function seekLayerNode(adb, serial, packageName, key, direction) {
  const testId = `map.layers.toggle.${key}`;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const nodes = parseUiNodes(captureUiXml(adb, serial));
    const carousel = nodeForTestId(nodes, 'map.layers.toggle-carousel', packageName, true);
    if (!carousel) throw new MemoryGateError('layer_carousel_unavailable');
    const target = nodes.find(node => nodeMatchesTestId(node, testId, packageName) && nodeVisibleWithin(node, carousel));
    if (target) return target;
    swipeWithin(adb, serial, carousel.bounds, direction);
    await waitMs(250);
  }
  throw new MemoryGateError(`layer_selector_unavailable_${key}`);
}

async function moveCarouselToStart(adb, serial, packageName) {
  for (let index = 0; index < 12; index += 1) {
    const nodes = parseUiNodes(captureUiXml(adb, serial));
    const carousel = nodeForTestId(nodes, 'map.layers.toggle-carousel', packageName, true);
    if (!carousel) throw new MemoryGateError('layer_carousel_unavailable');
    swipeWithin(adb, serial, carousel.bounds, 'reverse', 160);
    await waitMs(120);
  }
}

async function visitLayerStates(adb, serial, packageName, order, desiredState = null) {
  const result = {};
  const direction = order[0] === HEAVY_MAP_LAYER_KEYS[0] ? 'forward' : 'reverse';
  for (const key of order) {
    assertNotCancelled();
    let node = await seekLayerNode(adb, serial, packageName, key, direction);
    let checked = checkedStateFromNode(node);
    result[key] = checked;
    if (desiredState != null && checked !== desiredState) {
      tapNode(adb, serial, node);
      await waitMs(650);
      node = await seekLayerNode(adb, serial, packageName, key, direction);
      checked = checkedStateFromNode(node);
      if (checked !== desiredState) throw new MemoryGateError(`layer_toggle_failed_${key}`);
      result[key] = checked;
    }
  }
  return result;
}

async function restoreLayerStates(adb, serial, packageName, initialStates) {
  if (!initialStates || Object.keys(initialStates).length !== HEAVY_MAP_LAYER_KEYS.length) return false;
  await ensureLayerSheet(adb, serial, packageName);
  await moveCarouselToStart(adb, serial, packageName);
  for (const key of HEAVY_MAP_LAYER_KEYS) {
    let node = await seekLayerNode(adb, serial, packageName, key, 'forward');
    let checked = checkedStateFromNode(node);
    if (checked !== initialStates[key]) {
      tapNode(adb, serial, node);
      await waitMs(650);
      node = await seekLayerNode(adb, serial, packageName, key, 'forward');
      checked = checkedStateFromNode(node);
      if (checked !== initialStates[key]) throw new MemoryGateError(`layer_restore_failed_${key}`);
    }
  }
  return true;
}

function sampleTotalPss(adb, serial, packageName) {
  const dump = runAdb(adb, deviceArgs(serial, ['shell', 'dumpsys', 'meminfo', packageName]), {
    allowFailure: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const totalPssKb = parseMeminfo(dump).totalPssKb;
  if (!Number.isFinite(totalPssKb) || totalPssKb <= 0) throw new MemoryGateError('memory_sample_unavailable');
  return totalPssKb;
}

export function validatePreviewBuildEvidence(build, expected) {
  const checks = [
    [build?.id === expected.buildId, 'build_id_mismatch'],
    [build?.status === 'FINISHED', 'build_not_finished'],
    [build?.platform === 'ANDROID', 'build_platform_mismatch'],
    [build?.distribution === 'INTERNAL', 'build_distribution_mismatch'],
    [build?.buildProfile === 'preview', 'build_profile_mismatch'],
    [build?.channel === 'preview', 'build_channel_mismatch'],
    [build?.gitCommitHash === expected.buildCommitSha, 'build_commit_mismatch'],
    [build?.runtimeVersion === expected.runtimeVersion, 'build_runtime_mismatch'],
    [build?.appVersion === expected.appVersion, 'build_version_mismatch'],
    [String(build?.appBuildVersion || '') === expected.versionCode, 'build_number_mismatch'],
    [build?.project?.id === TRAILHEAD_EAS_PROJECT_ID, 'build_project_mismatch'],
  ];
  const failure = checks.find(([passed]) => !passed);
  if (failure) throw new MemoryGateError(String(failure[1]));
  return {
    id: build.id,
    binary_commit_sha: build.gitCommitHash,
    runtime: build.runtimeVersion,
    build_number: String(build.appBuildVersion),
  };
}

function fetchAndValidatePreviewBuild(options) {
  try {
    return validatePreviewBuildEvidence(fetchEasBuild(options.buildId), {
      appVersion: options.expectedVersionName,
      buildId: options.buildId,
      buildCommitSha: options.expectedBuildCommitSha,
      runtimeVersion: options.runtime,
      versionCode: options.expectedVersionCode,
    });
  } catch (error) {
    if (error instanceof MemoryGateError) throw error;
    throw new MemoryGateError('build_evidence_unavailable');
  }
}

function parseQaReleaseIdentity(nodes, packageName) {
  const node = nodeForTestId(nodes, 'qa.telemetry.release-identity', packageName);
  const text = String(node?.text || node?.['content-desc'] || '').trim();
  if (!text) throw new MemoryGateError('qa_release_identity_unavailable');
  try {
    const identity = JSON.parse(text);
    if (identity?.schema !== 'qa_release_identity_v1') throw new Error('schema');
    return identity;
  } catch {
    throw new MemoryGateError('qa_release_identity_invalid');
  }
}

async function readQaReleaseIdentity(adb, serial, packageName) {
  runAdb(adb, deviceArgs(serial, [
    'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW',
    '-d', QA_DIAGNOSTICS_URI, '-p', packageName,
  ]), { failureCode: 'qa_release_identity_unavailable', timeout: 30_000 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const nodes = parseUiNodes(captureUiXml(adb, serial));
    if (nodeForTestId(nodes, 'qa.telemetry.blocked', packageName)) {
      throw new MemoryGateError('qa_admin_authorization_required');
    }
    if (nodeForTestId(nodes, 'qa.telemetry.release-identity', packageName)) {
      return parseQaReleaseIdentity(nodes, packageName);
    }
    await waitMs(600);
  }
  throw new MemoryGateError('qa_release_identity_unavailable');
}

export function validateQaReleaseIdentity(identity, options) {
  const checks = [
    [identity.platform === 'android', 'qa_platform_mismatch'],
    [identity.appVersion === options.expectedVersionName, 'qa_version_name_mismatch'],
    [identity.buildNumber === options.expectedVersionCode, 'qa_version_code_mismatch'],
    [identity.channel === 'preview', 'qa_channel_mismatch'],
    [identity.commitSha === options.expectedCommitSha, 'qa_commit_mismatch'],
    [identity.runtimeVersion === options.runtime, 'qa_runtime_mismatch'],
    [identity.updateId === options.updateId, 'qa_update_mismatch'],
  ];
  const failure = checks.find(([passed]) => !passed);
  if (failure) throw new MemoryGateError(String(failure[1]));
  return true;
}

async function collectSamples(adb, serial, packageName, count = 3) {
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    samples.push(sampleTotalPss(adb, serial, packageName));
    if (index < count - 1) await waitMs(SAMPLE_GAP_MS);
  }
  return samples;
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0 || values.some(value => !Number.isFinite(value))) {
    throw new MemoryGateError('invalid_memory_samples');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function evaluateMemoryGate({ baselineSamples, cyclePeakSamples, postSamples }) {
  const baselineMedianKb = median(baselineSamples);
  const postMedianKb = median(postSamples);
  const allSamples = [...baselineSamples, ...(cyclePeakSamples || []), ...postSamples];
  const maxObservedPssKb = Math.max(...allSamples);
  const growthPercent = ((postMedianKb - baselineMedianKb) / baselineMedianKb) * 100;
  const pssPassed = maxObservedPssKb < MAX_TOTAL_PSS_KB;
  const growthPassed = growthPercent < MAX_GROWTH_PERCENT;
  return {
    passed: pssPassed && growthPassed,
    pssPassed,
    growthPassed,
    baselineMedianKb,
    postMedianKb,
    maxObservedPssKb,
    growthPercent,
    limits: {
      maxTotalPssKbExclusive: MAX_TOTAL_PSS_KB,
      maxGrowthPercentExclusive: MAX_GROWTH_PERCENT,
    },
  };
}

function writeReport(directory, report) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function safeFailureCode(error) {
  if (error instanceof MemoryGateError && /^[a-z0-9_.-]{1,96}$/.test(error.code)) return error.code;
  return 'unexpected_gate_failure';
}

async function runGate(options) {
  assertEvidenceDirectoryIgnored();
  mkdirSync(evidenceRoot, { recursive: true });
  const output = join(evidenceRoot, timestamp());
  const report = {
    schema_version: 1,
    started_at: new Date().toISOString(),
    completed_at: null,
    candidate: {
      ota_source_git_sha: options.expectedCommitSha,
      binary_build_git_sha: options.expectedBuildCommitSha,
      runtime: options.runtime,
      build_id: options.buildId,
      update_id: options.updateId,
      build_evidence_verified: false,
      device_identity_verified: false,
    },
    device: null,
    app: {
      package_name: options.packageName,
      version_name: null,
      version_code: null,
    },
    safety: {
      exact_device_required: true,
      app_data_cleared: false,
      permissions_changed: false,
      active_navigation_or_tour: 'not_checked',
      raw_ui_or_logs_stored: false,
    },
    layers: {
      tested: [...HEAVY_MAP_LAYER_KEYS],
      initial: null,
      baseline: null,
      restored: false,
    },
    memory: {
      baseline_settle_ms: BASELINE_SETTLE_MS,
      sample_gap_ms: SAMPLE_GAP_MS,
      cycle_count: MAP_LAYER_CYCLE_COUNT,
      baseline_samples_kb: [],
      cycle_peak_samples_kb: [],
      post_samples_kb: [],
      evaluation: null,
    },
    result: 'running',
    failure_code: null,
    privacy: 'No serial, coordinates, route geometry, search text, account identifiers, screenshots, UI hierarchy, logs, support content, attachments, payout data, or credentials are stored.',
  };

  const adb = findAdb(options.adb);
  let initialStates = null;
  let launchComponent = null;
  let serial = options.serial;
  try {
    if (gitSha() !== options.expectedCommitSha) throw new MemoryGateError('local_commit_mismatch');
    fetchAndValidatePreviewBuild(options);
    report.candidate.build_evidence_verified = true;
    const devices = parseDevices(runAdb(adb, ['devices', '-l']));
    const target = devices.find(device => device.serial === serial && device.state === 'device');
    if (!target) throw new MemoryGateError('device_not_authorized');
    report.device = {
      manufacturer: getProp(adb, serial, 'ro.product.manufacturer') || null,
      model: getProp(adb, serial, 'ro.product.model') || null,
      android_release: getProp(adb, serial, 'ro.build.version.release') || null,
      sdk: getProp(adb, serial, 'ro.build.version.sdk') || null,
    };

    const app = packageMetadata(adb, serial, options.packageName);
    if (!app.installed) throw new MemoryGateError('candidate_not_installed');
    report.app.version_name = app.versionName;
    report.app.version_code = app.versionCode;
    if (options.expectedVersionName && app.versionName !== options.expectedVersionName) throw new MemoryGateError('version_name_mismatch');
    if (options.expectedVersionCode && app.versionCode !== options.expectedVersionCode) throw new MemoryGateError('version_code_mismatch');

    // Check foreground services before touching app task state. A second warm
    // foreground check catches a durable session whose service is not running.
    assertNoActiveMapSession(adb, serial, options.packageName, false);
    launchComponent = resolveLaunchComponent(adb, serial, options.packageName);
    launchApp(adb, serial, launchComponent);
    await waitMs(2_000);
    assertNoActiveMapSession(adb, serial, options.packageName, true);
    validateQaReleaseIdentity(
      await readQaReleaseIdentity(adb, serial, options.packageName),
      options,
    );
    report.candidate.device_identity_verified = true;
    report.safety.active_navigation_or_tour = 'absent';

    forceStopApp(adb, serial, options.packageName);
    await waitMs(800);
    launchApp(adb, serial, launchComponent);
    await waitMs(2_000);
    assertNoActiveMapSession(adb, serial, options.packageName, true);
    await ensureLayerSheet(adb, serial, options.packageName);
    await moveCarouselToStart(adb, serial, options.packageName);
    const preparedLayers = await captureAndDisableHeavyLayers({
      captureStates: () => visitLayerStates(
        adb,
        serial,
        options.packageName,
        HEAVY_MAP_LAYER_KEYS,
      ),
      resetBeforeDisable: () => moveCarouselToStart(
        adb,
        serial,
        options.packageName,
      ),
      disableLayers: () => visitLayerStates(
        adb,
        serial,
        options.packageName,
        HEAVY_MAP_LAYER_KEYS,
        false,
      ),
      onCaptured: states => {
        initialStates = states;
        report.layers.initial = states;
      },
    });
    report.layers.baseline = preparedLayers.baselineStates;

    await waitMs(BASELINE_SETTLE_MS, 'Settling the map with heavy layers disabled');
    report.memory.baseline_samples_kb = await collectSamples(adb, serial, options.packageName);

    const reverseOrder = [...HEAVY_MAP_LAYER_KEYS].reverse();
    for (let cycle = 1; cycle <= MAP_LAYER_CYCLE_COUNT; cycle += 1) {
      console.log(`Layer cycle ${cycle}/${MAP_LAYER_CYCLE_COUNT}: enable`);
      await visitLayerStates(adb, serial, options.packageName, reverseOrder, true);
      await waitMs(3_000);
      report.memory.cycle_peak_samples_kb.push(sampleTotalPss(adb, serial, options.packageName));
      console.log(`Layer cycle ${cycle}/${MAP_LAYER_CYCLE_COUNT}: disable`);
      await visitLayerStates(adb, serial, options.packageName, HEAVY_MAP_LAYER_KEYS, false);
      await waitMs(1_200);
    }

    await waitMs(10_000, 'Settling after layer cycles');
    report.memory.post_samples_kb = await collectSamples(adb, serial, options.packageName);
    report.memory.evaluation = evaluateMemoryGate({
      baselineSamples: report.memory.baseline_samples_kb,
      cyclePeakSamples: report.memory.cycle_peak_samples_kb,
      postSamples: report.memory.post_samples_kb,
    });
    if (!report.memory.evaluation.pssPassed) throw new MemoryGateError('total_pss_limit_failed');
    if (!report.memory.evaluation.growthPassed) throw new MemoryGateError('memory_growth_limit_failed');
    report.result = 'passed';
  } catch (error) {
    report.result = 'failed';
    report.failure_code = safeFailureCode(error);
  } finally {
    if (initialStates) {
      try {
        cancellationSignal = null;
        // An OOM can terminate the activity mid-cycle. Relaunching here keeps
        // the promise to restore the user's exact layer state even on failure.
        if (launchComponent) {
          launchApp(adb, serial, launchComponent);
          await waitMs(1_500);
        }
        report.layers.restored = await restoreCapturedHeavyLayers(
          initialStates,
          states => restoreLayerStates(adb, serial, options.packageName, states),
        );
      } catch {
        report.layers.restored = false;
        report.result = 'failed';
        report.failure_code = report.failure_code || 'layer_restore_failed';
      }
    }
    if (initialStates && !report.layers.restored) {
      report.result = 'failed';
      report.failure_code = report.failure_code || 'layer_restore_failed';
    }
    report.completed_at = new Date().toISOString();
    writeReport(output, report);
  }

  console.log(`Privacy-minimal evidence: ${output}`);
  if (report.result !== 'passed') throw new MemoryGateError(report.failure_code || 'memory_gate_failed');
  console.log(`PASS: max PSS ${report.memory.evaluation.maxObservedPssKb} KB; growth ${report.memory.evaluation.growthPercent.toFixed(2)}%.`);
}

async function main() {
  const options = parseMemoryGateArgs(process.argv.slice(2));
  if (options.help) return usage();
  process.once('SIGINT', () => requestCancellation('SIGINT'));
  process.once('SIGTERM', () => requestCancellation('SIGTERM'));
  await runGate(options);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(error => {
    console.error(`Android map-memory gate failed: ${safeFailureCode(error)}`);
    process.exitCode = 1;
  });
}
