#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findAdb,
  parseDevices,
  parseUiNodes,
  tapPoint,
} from './android-audit-lib.mjs';
import {
  ANDROID_MEMORY_GATE_V3_POLICY,
  evaluateAndroidMemoryGateV3,
  evaluateExitInfoDiffV3,
  evaluateObjectCountRatchetV3,
  evaluatePhaseBudgetV3,
  parseAndroidMeminfoV3,
  parseExitInfoV3,
} from './android-memory-gate-v3.mjs';
import { fetchEasBuild } from './eas-build-evidence.mjs';

export const BASELINE_SETTLE_MS = 90_000;
export const POST_MAP_SETTLE_MS = 90_000;
export const EXPLORE_RECOVERY_SETTLE_MS = 90_000;
export const CYCLE_PHASE_SETTLE_MS = 5_000;
export const SAMPLE_GAP_MS = 3_000;
export const FOREGROUND_PROOF_INTERVAL_MS = 10_000;
export const LAYER_STATE_CONVERGENCE_TIMEOUT_MS = 15_000;
export const LAYER_STATE_POLL_INTERVAL_MS = 350;
export const LAYER_SHEET_READY_TIMEOUT_MS = 60_000;
export const LAYER_SHEET_PASSIVE_GRACE_MS = 30_000;
export const LAYER_SHEET_REVEAL_INTERVAL_MS = 5_000;
export const LAYER_SHEET_POLL_INTERVAL_MS = 500;
export const LAYER_CAROUSEL_REACQUIRE_TIMEOUT_MS = 15_000;
export const LAYER_CAROUSEL_REACQUIRE_POLL_MS = 500;
export const LAST_ANR_PARSE_PREFIX_MAX_CHARS = 64 * 1024;
export const LAYER_PERSISTENCE_SETTLE_MS = 2_000;
export const FINAL_LAYER_REPAIR_MAX_ATTEMPTS = 2;
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
export const MEMORY_GATE_REPORT_PRIVACY_STATEMENT = 'No serial, coordinates, route geometry, search text, account identifiers, screenshots, UI hierarchy, logs, support content, attachments, payout data, or credentials are stored.';
export const MEMORY_GATE_HARNESS_ALLOWED_CHANGED_PATHS = Object.freeze([
  'docs/checkpoints/trailhead-1.0.10-active-checkpoint.md',
  'mobile/package.json',
  'mobile/scripts/ANDROID_AUDIT.md',
  'mobile/scripts/android-audit-lib.mjs',
  'mobile/scripts/android-map-memory-gate.mjs',
  'mobile/scripts/android-map-memory-gate.test.mjs',
  'mobile/scripts/android-memory-gate-v3.mjs',
  'mobile/scripts/android-memory-gate-v3.test.mjs',
  'mobile/scripts/eas-build-evidence.mjs',
  'mobile/scripts/pre-preview-check.mjs',
]);
export const MEMORY_GATE_HARNESS_REQUIRED_PATHS = Object.freeze([
  'mobile/package.json',
  'mobile/scripts/ANDROID_AUDIT.md',
  'mobile/scripts/android-audit-lib.mjs',
  'mobile/scripts/android-map-memory-gate.mjs',
  'mobile/scripts/android-map-memory-gate.test.mjs',
  'mobile/scripts/android-memory-gate-v3.mjs',
  'mobile/scripts/android-memory-gate-v3.test.mjs',
  'mobile/scripts/eas-build-evidence.mjs',
  'mobile/scripts/pre-preview-check.mjs',
]);

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

The source-controlled phase budgets cannot be weakened from the command line.
The report separates accounted PSS, SwapPSS, diagnostic PSS-minus-swap, RSS,
ten-cycle retention, and post-use recovery for this 4 GB stress device.`);
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

function candidateIsAncestor(candidateSha) {
  const result = spawnSync('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', candidateSha, 'HEAD'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  return result.status === 0;
}

function gitCommand(args) {
  return spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function gitOutputLines(result) {
  if (result.status !== 0) throw new MemoryGateError('harness_git_inspection_failed');
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function validateMemoryGateHarnessProvenance({
  candidateGitSha,
  harnessGitSha,
  candidateAncestor,
  changedPaths,
  trackedPaths,
  dirtyPaths,
  fileHashes,
}) {
  if (!/^[a-f0-9]{40}$/.test(String(candidateGitSha || ''))
    || !/^[a-f0-9]{40}$/.test(String(harnessGitSha || ''))) {
    throw new MemoryGateError('harness_commit_unavailable');
  }
  if (candidateAncestor !== true) {
    throw new MemoryGateError('candidate_not_ancestor_of_harness');
  }

  const approved = new Set(MEMORY_GATE_HARNESS_ALLOWED_CHANGED_PATHS);
  const normalizedChanged = uniqueSorted(changedPaths || []);
  if (normalizedChanged.some(path => !approved.has(path))) {
    throw new MemoryGateError('harness_candidate_delta_unapproved');
  }

  const tracked = new Set(trackedPaths || []);
  if (MEMORY_GATE_HARNESS_REQUIRED_PATHS.some(path => !tracked.has(path))) {
    throw new MemoryGateError('harness_file_untracked');
  }
  if ((dirtyPaths || []).length > 0) {
    throw new MemoryGateError('harness_worktree_dirty');
  }

  const hashEntries = Object.entries(fileHashes || {});
  if (hashEntries.length !== MEMORY_GATE_HARNESS_REQUIRED_PATHS.length
    || MEMORY_GATE_HARNESS_REQUIRED_PATHS.some(path => !/^[a-f0-9]{64}$/.test(fileHashes?.[path] || ''))
    || hashEntries.some(([path]) => !MEMORY_GATE_HARNESS_REQUIRED_PATHS.includes(path))) {
    throw new MemoryGateError('harness_file_hash_unavailable');
  }

  return {
    candidate_is_ancestor: true,
    approved_candidate_delta: normalizedChanged,
    harness_file_sha256: Object.fromEntries(
      MEMORY_GATE_HARNESS_REQUIRED_PATHS.map(path => [path, fileHashes[path]]),
    ),
  };
}

export function collectMemoryGateHarnessProvenance(candidateGitSha) {
  const harnessGitSha = gitSha();
  if (!harnessGitSha) throw new MemoryGateError('harness_commit_unavailable');
  const candidateAncestor = candidateIsAncestor(candidateGitSha);
  const changedPaths = gitOutputLines(gitCommand([
    'diff', '--name-only', '--diff-filter=ACDMRTUXB', `${candidateGitSha}..${harnessGitSha}`, '--',
  ]));
  const trackedPaths = MEMORY_GATE_HARNESS_REQUIRED_PATHS.filter(path => (
    gitCommand(['ls-files', '--error-unmatch', '--', path]).status === 0
  ));
  const dirtyStatus = gitCommand([
    'status', '--porcelain=v1', '--untracked-files=all', '--',
    ...MEMORY_GATE_HARNESS_REQUIRED_PATHS,
  ]);
  if (dirtyStatus.status !== 0) throw new MemoryGateError('harness_git_inspection_failed');
  const dirtyPaths = String(dirtyStatus.stdout || '').trim() ? ['harness_dirty'] : [];
  const fileHashes = {};
  for (const path of MEMORY_GATE_HARNESS_REQUIRED_PATHS) {
    try {
      fileHashes[path] = createHash('sha256')
        .update(readFileSync(join(repoRoot, path)))
        .digest('hex');
    } catch {
      throw new MemoryGateError('harness_file_hash_unavailable');
    }
  }
  const provenance = validateMemoryGateHarnessProvenance({
    candidateGitSha,
    harnessGitSha,
    candidateAncestor,
    changedPaths,
    trackedPaths,
    dirtyPaths,
    fileHashes,
  });
  return { harnessGitSha, ...provenance };
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
  if (shell[0] === 'dumpsys' && shell[1] === 'power' && shell.length === 2) return true;
  if (shell[0] === 'dumpsys' && ['package', 'meminfo'].includes(shell[1]) && approvedPackage(shell[2]) && shell.length === 3) return true;
  if (shell[0] === 'dumpsys' && exactArgs(shell.slice(1, 3), ['activity', 'services']) && approvedPackage(shell[3]) && shell.length === 4) return true;
  if (shell[0] === 'dumpsys' && exactArgs(shell.slice(1, 3), ['activity', 'exit-info']) && approvedPackage(shell[3]) && shell.length === 4) return true;
  if (shell[0] === 'dumpsys' && exactArgs(shell.slice(1), ['activity', 'lastanr'])) return true;
  if (shell[0] === 'dumpsys' && exactArgs(shell.slice(1, 3), ['activity', 'activities']) && approvedPackage(shell[3]) && shell.length === 4) return true;
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

export function hasPositiveVisibleBounds(node) {
  const bounds = node?.bounds;
  return Boolean(
    bounds
    && Number.isFinite(bounds.left)
    && Number.isFinite(bounds.top)
    && Number.isFinite(bounds.right)
    && Number.isFinite(bounds.bottom)
    && bounds.right > bounds.left
    && bounds.bottom > bounds.top
    && node?.['visible-to-user'] !== 'false',
  );
}

function nodeForTestId(nodes, testId, packageName, requireBounds = false) {
  return nodes.find(node => (
    nodeMatchesTestId(node, testId, packageName)
    && (!requireBounds || hasPositiveVisibleBounds(node))
  )) ?? null;
}

export function inspectRecognizedActiveServiceDump(text, packageName = 'com.trailhead.app') {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  const headerRecognized = /^ACTIVITY MANAGER SERVICES \(dumpsys activity services\)\s*$/m.test(source);
  const bodyRecognized = /^\s*User \d+ active services:\s*$/m.test(source)
    || /^\s*(?:No active services|No services found|\(nothing\))\s*$/mi.test(source);
  const serviceRecords = source.split('\n').filter(line => /\bServiceRecord\{/.test(line));
  const recordsScopedToPackage = serviceRecords.length === 0
    || serviceRecords.every(line => line.includes(packageName));
  if (!headerRecognized || !bodyRecognized || !recordsScopedToPackage) {
    throw new MemoryGateError('active_service_dump_unrecognized');
  }
  return { recognized: true };
}

export function parseRecognizedExitInfoDump(text, packageName = 'com.trailhead.app') {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  const escapedPackage = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerRecognized = /^ACTIVITY MANAGER PROCESS EXIT INFO \(dumpsys activity exit-info\)\s*$/m.test(source);
  const packageRecognized = new RegExp(`^\\s*package:\\s*${escapedPackage}\\s*$`, 'm').test(source);
  const historyRecognized = packageRecognized
    && /^\s*Historical Process Exit for uid=\d+\s*$/m.test(source);
  const emptyHistoryRecognized = !/^\s*package:\s*/m.test(source)
    && !/^\s*ApplicationExitInfo #\d+:/m.test(source)
    && /^Last Timestamp of Persistence Into Persistent Storage:\s*.+$/m.test(source);
  if (!headerRecognized || (!historyRecognized && !emptyHistoryRecognized)) {
    throw new MemoryGateError('exit_info_dump_unrecognized');
  }
  try {
    return parseExitInfoV3(source);
  } catch {
    throw new MemoryGateError('exit_info_unavailable');
  }
}

/**
 * Parse only the bounded header of `dumpsys activity lastanr`. Android appends
 * broad process metadata after these fields, so none of that content is
 * retained or returned. The raw reason is transient and must never be written
 * to the privacy-minimal gate report.
 */
export function parseRecognizedLastAnrDump(text) {
  const prefix = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .slice(0, LAST_ANR_PARSE_PREFIX_MAX_CHARS);
  if (!/^ACTIVITY MANAGER LAST ANR \(dumpsys activity lastanr\)\s*$/m.test(prefix)) {
    throw new MemoryGateError('last_anr_dump_unrecognized');
  }
  const lines = prefix.split('\n');
  const timeLines = lines.filter(line => /^\s*ANR time:\s*/.test(line));
  const reasonLines = lines.filter(line => /^\s*Reason:\s*/.test(line));
  if (timeLines.length === 0 && reasonLines.length === 0) {
    if (/^\s*<?no\s+(?:last\s+)?anrs?\b[^\n>]*>?\s*$/im.test(prefix)) return null;
    throw new MemoryGateError('last_anr_dump_unrecognized');
  }
  if (timeLines.length !== 1 || reasonLines.length !== 1) {
    throw new MemoryGateError('last_anr_dump_unrecognized');
  }
  const anrTime = timeLines[0].replace(/^\s*ANR time:\s*/, '').trim();
  const reason = reasonLines[0].replace(/^\s*Reason:\s*/, '').trim();
  if (!anrTime || anrTime.length > 128 || !reason || reason.length > 1_024) {
    throw new MemoryGateError('last_anr_dump_unrecognized');
  }
  return { anrTime, reason };
}

function validateLastAnrSnapshot(snapshot) {
  if (snapshot == null) return;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || Object.keys(snapshot).sort().join(',') !== 'anrTime,reason'
    || typeof snapshot.anrTime !== 'string' || !snapshot.anrTime
    || typeof snapshot.reason !== 'string' || !snapshot.reason) {
    throw new MemoryGateError('last_anr_snapshot_invalid');
  }
}

function lastAnrFingerprint(snapshot) {
  return snapshot == null ? null : `${snapshot.anrTime}\n${snapshot.reason}`;
}

function lastAnrTargetsPackage(snapshot, packageName) {
  if (snapshot == null) return false;
  const escapedPackage = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escapedPackage}(?:/|\\s|$)`).test(snapshot.reason);
}

/**
 * Compare the device-wide last-ANR record with the pre-launch baseline while
 * deduplicating repeated terminal checks. Only aggregate counters leave this
 * monitor; the ANR time and reason remain transient in the closure.
 */
export function createLiveAnrMonitorV3({ baseline, packageName = 'com.trailhead.app' } = {}) {
  if (!APPROVED_TRAILHEAD_ANDROID_PACKAGES.includes(packageName)) {
    throw new MemoryGateError('last_anr_package_invalid');
  }
  validateLastAnrSnapshot(baseline);
  const baselineFingerprint = lastAnrFingerprint(baseline);
  const observedNewFingerprints = new Set();
  let observationCount = 0;
  return {
    observe(current) {
      validateLastAnrSnapshot(current);
      observationCount += 1;
      const fingerprint = lastAnrFingerprint(current);
      const newAnrDetected = Boolean(
        fingerprint
        && fingerprint !== baselineFingerprint
        && lastAnrTargetsPackage(current, packageName)
        && !observedNewFingerprints.has(fingerprint),
      );
      if (newAnrDetected) observedNewFingerprints.add(fingerprint);
      return {
        baseline_captured: true,
        observation_count: observationCount,
        new_anr_count: observedNewFingerprints.size,
        newAnrDetected,
      };
    },
  };
}

export function promoteLiveAnrFailureV3(report) {
  const count = report?.process?.live_anr_evidence?.new_anr_count;
  if (!Number.isInteger(count) || count <= 0) return false;
  const liveAnrCode = 'live_process_anr_observed';
  const previousCode = report.failure_code;
  if (previousCode && previousCode !== liveAnrCode) {
    if (!Array.isArray(report.execution_failure_codes)) report.execution_failure_codes = [];
    if (report.execution_failure_codes.length < 32
      && !report.execution_failure_codes.includes(previousCode)) {
      report.execution_failure_codes.push(previousCode);
    }
  }
  report.failure_code = liveAnrCode;
  report.result = 'failed';
  return true;
}

export function combineAnrCountV3(exitInfoAnrCount, liveAnrCount) {
  if (!Number.isInteger(exitInfoAnrCount) || exitInfoAnrCount < 0
    || !Number.isInteger(liveAnrCount) || liveAnrCount < 0) {
    throw new MemoryGateError('live_anr_count_invalid');
  }
  return Math.max(exitInfoAnrCount, liveAnrCount);
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
  const dump = runAdb(adb, deviceArgs(serial, ['shell', 'dumpsys', 'activity', 'services', packageName]), {
    failureCode: 'active_service_query_failed',
    maxBuffer: 16 * 1024 * 1024,
  });
  inspectRecognizedActiveServiceDump(dump, packageName);
  return dump;
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

export function inspectAwakePowerDump(text) {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  const headerRecognized = /^POWER MANAGER \(dumpsys power\)\s*$/m.test(source);
  const wakefulness = source.match(/^\s*mWakefulness=(\S+)\s*$/m)?.[1] ?? null;
  if (!headerRecognized || !wakefulness) {
    throw new MemoryGateError('power_dump_unrecognized');
  }
  if (wakefulness !== 'Awake') throw new MemoryGateError('device_not_awake');
  return { recognized: true, awake: true };
}

export function inspectTopResumedVisibleActivityDump(text, packageName = 'com.trailhead.app') {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  if (!/^ACTIVITY MANAGER ACTIVITIES \(dumpsys activity activities\)\s*$/m.test(source)) {
    throw new MemoryGateError('activity_dump_unrecognized');
  }
  const packageActivity = `${packageName}/`;
  const topResumed = source.split('\n').some(line => (
    /(?:topResumedActivity=|m?ResumedActivity:)\s*ActivityRecord\{/.test(line)
    && line.includes(packageActivity)
  ));
  const visible = source.split('\n').some(line => (
    line.includes(packageName)
    && /\bvisible=true\b/.test(line)
    && /\bvisibleRequested=true\b/.test(line)
  ));
  if (!topResumed || !visible) {
    throw new MemoryGateError('app_not_top_resumed_visible');
  }
  return { recognized: true, topResumed: true, visible: true };
}

export async function waitWithContinuousProof({
  durationMs,
  prove,
  intervalMs = FOREGROUND_PROOF_INTERVAL_MS,
  waitFor = waitMs,
  label = null,
}) {
  if (!Number.isFinite(durationMs) || durationMs < 0
    || !Number.isFinite(intervalMs) || intervalMs <= 0
    || typeof prove !== 'function' || typeof waitFor !== 'function') {
    throw new MemoryGateError('foreground_proof_contract_invalid');
  }
  if (label) console.log(`${label} (${Math.ceil(durationMs / 1000)}s)`);
  let proofCount = 0;
  await prove();
  proofCount += 1;
  let remaining = durationMs;
  while (remaining > 0) {
    assertNotCancelled();
    const step = Math.min(remaining, intervalMs);
    await waitFor(step);
    remaining -= step;
    await prove();
    proofCount += 1;
    if (label && remaining > 0) console.log(`  ${Math.ceil(remaining / 1000)}s remaining`);
  }
  assertNotCancelled();
  return proofCount;
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
  const travel = Math.min(220, Math.max(48, Math.floor(width * 0.25)), width - 24);
  const centerX = Math.floor((bounds.left + bounds.right) / 2);
  const left = Math.floor(centerX - travel / 2);
  const right = Math.ceil(centerX + travel / 2);
  const y = Math.floor((bounds.top + bounds.bottom) / 2);
  return direction === 'forward'
    ? [right, y, left, y]
    : [left, y, right, y];
}

function swipeWithin(adb, serial, bounds, direction, durationMs = 450) {
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

/**
 * A layer tap may persist through React state, native map work, and storage
 * before its accessibility state changes. Tap at most once, then reacquire and
 * poll the node until it converges. Blindly tapping again can undo a delayed
 * successful transition and corrupt the user's saved layer choices.
 */
export async function convergeLayerState({
  initialState,
  desiredState,
  tapOnce,
  readState,
  waitFor = waitMs,
  now = Date.now,
  timeoutMs = LAYER_STATE_CONVERGENCE_TIMEOUT_MS,
  pollIntervalMs = LAYER_STATE_POLL_INTERVAL_MS,
  failureCode = 'layer_toggle_failed',
}) {
  if (typeof initialState !== 'boolean' || typeof desiredState !== 'boolean') {
    throw new MemoryGateError('layer_state_snapshot_incomplete');
  }
  if (initialState === desiredState) return desiredState;
  if (typeof tapOnce !== 'function' || typeof readState !== 'function' || typeof waitFor !== 'function') {
    throw new MemoryGateError('layer_convergence_contract_invalid');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new MemoryGateError('layer_convergence_contract_invalid');
  }

  await tapOnce();
  const deadline = now() + timeoutMs;
  while (true) {
    const observed = await readState();
    if (typeof observed !== 'boolean') throw new MemoryGateError('layer_accessibility_state_missing');
    if (observed === desiredState) return observed;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await waitFor(Math.min(pollIntervalMs, remaining));
  }
  throw new MemoryGateError(failureCode);
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

function assertLayerSubsetState(states, keys, expectedState, failurePrefix) {
  if (!states || typeof states !== 'object') throw new MemoryGateError(`${failurePrefix}_snapshot_incomplete`);
  for (const key of keys) {
    if (states[key] !== expectedState) throw new MemoryGateError(`${failurePrefix}_${key}`);
  }
  return states;
}

export function assertExactLayerState(states, target, failurePrefix) {
  assertCompleteHeavyLayerState(states);
  assertCompleteHeavyLayerState(target);
  for (const key of HEAVY_MAP_LAYER_KEYS) {
    if (states[key] !== target[key]) throw new MemoryGateError(`${failurePrefix}_${key}`);
  }
  return states;
}

/**
 * Restore in two deterministic phases, then prove persistence across a second
 * process restart. This function returns a structured outcome instead of
 * throwing so the report can retain both the gate's primary failure and the
 * independent restoration failure/recovery evidence.
 */
async function attemptDurableLayerRestoration({
  initialStates,
  relaunch,
  setLayers,
  captureStates,
  waitForPersistence,
}) {
  const target = { ...assertCompleteHeavyLayerState(initialStates) };
  const targetFalseKeys = HEAVY_MAP_LAYER_KEYS.filter(key => target[key] === false);
  const targetTrueKeys = HEAVY_MAP_LAYER_KEYS.filter(key => target[key] === true);
  const recovery = {
    attempted: true,
    target_false_keys: targetFalseKeys,
    target_true_keys: targetTrueKeys,
    pre_restore_relaunch_completed: false,
    target_false_observed: null,
    target_true_observed: null,
    verified_before_relaunch: null,
    persistence_wait_ms: LAYER_PERSISTENCE_SETTLE_MS,
    persistence_wait_completed: false,
    post_restore_relaunch_completed: false,
    verified_after_relaunch: null,
    failure_observed_state: null,
  };

  try {
    await relaunch('before_restore');
    recovery.pre_restore_relaunch_completed = true;

    recovery.target_false_observed = {
      ...await setLayers(targetFalseKeys, false),
    };
    assertLayerSubsetState(
      recovery.target_false_observed,
      targetFalseKeys,
      false,
      'layer_restore_disable_failed',
    );

    recovery.target_true_observed = {
      ...await setLayers(targetTrueKeys, true),
    };
    assertLayerSubsetState(
      recovery.target_true_observed,
      targetTrueKeys,
      true,
      'layer_restore_enable_failed',
    );

    recovery.verified_before_relaunch = {
      ...assertExactLayerState(
        await captureStates(),
        target,
        'layer_restore_verification_failed',
      ),
    };

    await waitForPersistence(LAYER_PERSISTENCE_SETTLE_MS);
    recovery.persistence_wait_completed = true;
    await relaunch('after_restore');
    recovery.post_restore_relaunch_completed = true;
    recovery.verified_after_relaunch = {
      ...assertExactLayerState(
        await captureStates(),
        target,
        'layer_restore_persisted_mismatch',
      ),
    };
    return { restored: true, failureCode: null, recovery };
  } catch (error) {
    try {
      recovery.failure_observed_state = {
        ...assertCompleteHeavyLayerState(await captureStates()),
      };
    } catch {
      // Best-effort booleans only. The original restoration error remains the
      // authoritative failure when the UI cannot be captured during recovery.
    }
    return {
      restored: false,
      failureCode: safeFailureCode(error),
      recovery,
    };
  }
}

function restorationOutcomeWithAttempts(outcomes) {
  const finalOutcome = outcomes[outcomes.length - 1];
  const attempts = outcomes.map((outcome, index) => ({
    attempt: index + 1,
    restored: outcome.restored,
    failure_code: outcome.failureCode,
    ...outcome.recovery,
  }));
  return {
    restored: finalOutcome.restored,
    failureCode: finalOutcome.failureCode,
    recovery: {
      ...finalOutcome.recovery,
      attempt_count: attempts.length,
      max_attempts: FINAL_LAYER_REPAIR_MAX_ATTEMPTS,
      retry_reason: attempts.length > 1 ? attempts[0].failure_code : null,
      recovered_after_retry: finalOutcome.restored && attempts.length > 1,
      attempts,
    },
  };
}

/**
 * Perform one durable restoration and, only when the post-relaunch persisted
 * state differs, make one final bounded repair attempt. Selector/access errors
 * are not blindly retried because another tap could alter an unknown state.
 */
export async function durablyRestoreCapturedHeavyLayers(dependencies) {
  const outcomes = [];
  for (let attempt = 1; attempt <= FINAL_LAYER_REPAIR_MAX_ATTEMPTS; attempt += 1) {
    const outcome = await attemptDurableLayerRestoration(dependencies);
    outcomes.push(outcome);
    if (outcome.restored) return restorationOutcomeWithAttempts(outcomes);
    const persistedMismatch = String(outcome.failureCode || '').startsWith(
      'layer_restore_persisted_mismatch_',
    );
    if (!persistedMismatch || attempt >= FINAL_LAYER_REPAIR_MAX_ATTEMPTS) {
      return restorationOutcomeWithAttempts(outcomes);
    }
  }
  return restorationOutcomeWithAttempts(outcomes);
}

export function applyLayerRestorationOutcome(report, outcome) {
  report.layers.restored = outcome?.restored === true;
  report.layers.recovery = outcome?.recovery ?? null;
  report.restoration_failure_code = report.layers.restored
    ? null
    : (outcome?.failureCode || 'layer_restore_failed');
  const persistedMismatchObserved = String(outcome?.failureCode || '').startsWith(
    'layer_restore_persisted_mismatch_',
  );
  const persistedSuccessObserved = report.layers.restored
    && outcome?.recovery?.post_restore_relaunch_completed === true
    && outcome?.recovery?.verified_after_relaunch != null;
  report.safety.layer_state_retention_check_completed = persistedMismatchObserved
    || persistedSuccessObserved;
  report.safety.layer_state_loss_observed = persistedMismatchObserved
    ? true
    : persistedSuccessObserved
      ? false
      : null;
  if (!report.layers.restored) report.result = 'failed';
  return report;
}

export async function awaitLayerCarouselReady({
  readState,
  revealContent,
  waitFor = waitMs,
  now = Date.now,
  timeoutMs = LAYER_SHEET_READY_TIMEOUT_MS,
  passiveGraceMs = LAYER_SHEET_PASSIVE_GRACE_MS,
  revealIntervalMs = LAYER_SHEET_REVEAL_INTERVAL_MS,
  pollIntervalMs = LAYER_SHEET_POLL_INTERVAL_MS,
}) {
  if (typeof readState !== 'function'
    || typeof revealContent !== 'function'
    || typeof waitFor !== 'function'
    || typeof now !== 'function'
    || !Number.isFinite(timeoutMs)
    || !Number.isFinite(passiveGraceMs)
    || !Number.isFinite(revealIntervalMs)
    || !Number.isFinite(pollIntervalMs)
    || timeoutMs <= 0
    || passiveGraceMs < 0
    || passiveGraceMs >= timeoutMs
    || revealIntervalMs <= 0
    || pollIntervalMs <= 0) {
    throw new MemoryGateError('layer_sheet_readiness_contract_invalid');
  }

  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let nextRevealAt = startedAt + passiveGraceMs;
  let revealCount = 0;
  while (true) {
    assertNotCancelled();
    const state = await readState();
    if (!state
      || typeof state.carouselReady !== 'boolean'
      || typeof state.sheetOpen !== 'boolean') {
      throw new MemoryGateError('layer_sheet_readiness_contract_invalid');
    }
    if (state.carouselReady) {
      return {
        revealCount,
        waitedMs: Math.max(0, now() - startedAt),
      };
    }

    const current = now();
    if (current >= deadline) break;
    if (current >= nextRevealAt && state.sheetOpen && state.contentBounds) {
      await revealContent(state.contentBounds);
      revealCount += 1;
      nextRevealAt = current + revealIntervalMs;
    }
    const remaining = deadline - now();
    if (remaining > 0) await waitFor(Math.min(pollIntervalMs, remaining));
  }
  throw new MemoryGateError('layer_carousel_unavailable');
}

export async function ensureLayerSheetReady({
  readState,
  openSheet,
  revealContent,
  waitFor = waitMs,
  now = Date.now,
  timeoutMs = LAYER_SHEET_READY_TIMEOUT_MS,
  passiveGraceMs = LAYER_SHEET_PASSIVE_GRACE_MS,
  revealIntervalMs = LAYER_SHEET_REVEAL_INTERVAL_MS,
  pollIntervalMs = LAYER_SHEET_POLL_INTERVAL_MS,
}) {
  if (typeof readState !== 'function' || typeof openSheet !== 'function') {
    throw new MemoryGateError('layer_sheet_readiness_contract_invalid');
  }
  const initial = await readState();
  if (!initial
    || typeof initial.carouselReady !== 'boolean'
    || typeof initial.sheetOpen !== 'boolean') {
    throw new MemoryGateError('layer_sheet_readiness_contract_invalid');
  }
  if (initial.carouselReady) return { revealCount: 0, waitedMs: 0 };
  if (!initial.sheetOpen) await openSheet();
  return awaitLayerCarouselReady({
    readState,
    revealContent,
    waitFor,
    now,
    timeoutMs,
    passiveGraceMs,
    revealIntervalMs,
    pollIntervalMs,
  });
}

async function ensureLayerSheet(adb, serial, packageName) {
  const readState = async () => {
    const nodes = parseUiNodes(captureUiXml(adb, serial));
    const carousel = nodeForTestId(nodes, 'map.layers.toggle-carousel', packageName, true);
    const sheet = nodeForTestId(nodes, 'map.layers.sheet', packageName, true);
    const content = nodeForTestId(nodes, 'map.layers.content', packageName, true);
    return {
      carouselReady: Boolean(carousel),
      sheetOpen: Boolean(carousel || sheet || content),
      contentBounds: content?.bounds ?? null,
    };
  };
  await ensureLayerSheetReady({
    readState,
    openSheet: async () => {
      const nodes = parseUiNodes(captureUiXml(adb, serial));
      const mapTab = nodeForTestId(nodes, 'app.tab.map', packageName, true);
      if (!mapTab) throw new MemoryGateError('map_tab_unavailable');
      tapNode(adb, serial, mapTab);
      await waitMs(900);
      const { node: openLayers } = await waitForTestId(
        adb,
        serial,
        packageName,
        'map.layers.open',
      );
      tapNode(adb, serial, openLayers);
      await waitMs(700);
    },
    revealContent: async bounds => {
      swipeVerticallyWithin(adb, serial, bounds, 'forward', 300);
    },
  });
}

export function inspectMapRendererReadiness(nodes, packageName) {
  const rootCount = nodes.filter(node => (
    nodeMatchesTestId(node, 'map.screen', packageName) && hasPositiveVisibleBounds(node)
  )).length;
  const stableControlCount = nodes.filter(node => (
    nodeMatchesTestId(node, 'map.layers.open', packageName) && hasPositiveVisibleBounds(node)
  )).length;
  const rendererLoading = nodes.some(node => (
    nodeMatchesTestId(node, 'map.renderer-loading', packageName) && hasPositiveVisibleBounds(node)
  ));
  const rootReady = rootCount === 1;
  const stableControlReady = stableControlCount === 1;
  const duplicateRendererObserved = rootCount > 1 || stableControlCount > 1;
  return {
    ready: rootReady && !rendererLoading && stableControlReady && !duplicateRendererObserved,
    rootReady,
    rendererLoading,
    stableControlReady,
    rootCount,
    stableControlCount,
    duplicateRendererObserved,
  };
}

export function inspectRetainedTreeReadiness(nodes, packageName, rootTestId) {
  if (!['explore.screen', 'map.screen'].includes(rootTestId)) {
    throw new MemoryGateError('retained_tree_contract_invalid');
  }
  if (rootTestId === 'map.screen') return inspectMapRendererReadiness(nodes, packageName);
  const rootCount = nodes.filter(node => (
    nodeMatchesTestId(node, rootTestId, packageName) && hasPositiveVisibleBounds(node)
  )).length;
  return {
    ready: rootCount === 1,
    rootReady: rootCount === 1,
    rendererLoading: false,
    stableControlReady: true,
    rootCount,
    stableControlCount: null,
    duplicateRendererObserved: false,
  };
}

function proveForegroundMeasurementState(adb, serial, packageName, rootTestId) {
  const powerDump = runAdb(adb, deviceArgs(serial, ['shell', 'dumpsys', 'power']), {
    failureCode: 'power_query_failed',
    maxBuffer: 16 * 1024 * 1024,
  });
  inspectAwakePowerDump(powerDump);
  const activityDump = runAdb(adb, deviceArgs(serial, [
    'shell', 'dumpsys', 'activity', 'activities', packageName,
  ]), {
    failureCode: 'activity_query_failed',
    maxBuffer: 24 * 1024 * 1024,
  });
  inspectTopResumedVisibleActivityDump(activityDump, packageName);
  const readiness = inspectRetainedTreeReadiness(
    parseUiNodes(captureUiXml(adb, serial)),
    packageName,
    rootTestId,
  );
  if (readiness.duplicateRendererObserved) {
    throw new MemoryGateError('duplicate_map_renderer_observed');
  }
  if (!readiness.ready) {
    throw new MemoryGateError(rootTestId === 'map.screen'
      ? 'map_renderer_not_ready'
      : 'explore_retained_tree_not_ready');
  }
  return readiness;
}

async function navigateToTab(adb, serial, packageName, routeName) {
  const testId = `app.tab.${routeName}`;
  const { node } = await waitForTestId(adb, serial, packageName, testId, 30_000);
  tapNode(adb, serial, node);
  const rootTestId = routeName === 'guide'
    ? 'explore.screen'
    : routeName === 'map'
      ? 'map.screen'
      : null;
  const deadline = Date.now() + 30_000;
  let stableReadyReads = 0;
  while (Date.now() < deadline) {
    const nodes = parseUiNodes(captureUiXml(adb, serial));
    const tab = nodeForTestId(nodes, testId, packageName);
    const rootReady = !rootTestId || nodeForTestId(nodes, rootTestId, packageName, true);
    const rendererReady = routeName !== 'map'
      || inspectMapRendererReadiness(nodes, packageName).ready;
    if (tab?.selected === 'true' && rootReady && rendererReady) {
      stableReadyReads += 1;
      if (stableReadyReads >= 2) return;
    } else {
      stableReadyReads = 0;
    }
    await waitMs(500);
  }
  throw new MemoryGateError(routeName === 'map'
    ? 'map_renderer_not_ready'
    : `tab_transition_failed_${routeName}`);
}

export function inspectLayerSheetCloseState(nodes, packageName) {
  const sheetOpen = [
    'map.layers.sheet',
    'map.layers.content',
    'map.layers.toggle-carousel',
  ].some(testId => nodeForTestId(nodes, testId, packageName, true));
  const closeNode = nodeForTestId(nodes, 'map.layers.close', packageName, true);
  if (sheetOpen && !closeNode) throw new MemoryGateError('layer_close_unavailable');
  return { sheetOpen, closeNode };
}

async function closeLayerSheet(adb, serial, packageName) {
  const nodes = parseUiNodes(captureUiXml(adb, serial));
  const { sheetOpen, closeNode } = inspectLayerSheetCloseState(nodes, packageName);
  if (!sheetOpen) return false;
  tapNode(adb, serial, closeNode);
  await waitMs(700);
  await waitForTestId(adb, serial, packageName, 'map.layers.open', 20_000);
  const afterNodes = parseUiNodes(captureUiXml(adb, serial));
  if (inspectLayerSheetCloseState(afterNodes, packageName).sheetOpen) {
    throw new MemoryGateError('layer_close_failed');
  }
  return true;
}

export async function awaitLayerCarouselSnapshot({
  readSnapshot,
  waitFor = waitMs,
  now = Date.now,
  timeoutMs = LAYER_CAROUSEL_REACQUIRE_TIMEOUT_MS,
  pollIntervalMs = LAYER_CAROUSEL_REACQUIRE_POLL_MS,
}) {
  if (typeof readSnapshot !== 'function'
    || typeof waitFor !== 'function'
    || typeof now !== 'function'
    || !Number.isFinite(timeoutMs)
    || !Number.isFinite(pollIntervalMs)
    || timeoutMs <= 0
    || pollIntervalMs <= 0) {
    throw new MemoryGateError('layer_carousel_reacquire_contract_invalid');
  }

  const deadline = now() + timeoutMs;
  while (true) {
    assertNotCancelled();
    const snapshot = await readSnapshot();
    if (!snapshot || !Array.isArray(snapshot.nodes) || !('carousel' in snapshot)) {
      throw new MemoryGateError('layer_carousel_reacquire_contract_invalid');
    }
    if (snapshot.carousel) return snapshot;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await waitFor(Math.min(pollIntervalMs, remaining));
  }
  throw new MemoryGateError('layer_carousel_unavailable');
}

async function readLayerCarouselSnapshot(adb, serial, packageName) {
  return awaitLayerCarouselSnapshot({
    readSnapshot: async () => {
      const nodes = parseUiNodes(captureUiXml(adb, serial));
      return {
        nodes,
        carousel: nodeForTestId(nodes, 'map.layers.toggle-carousel', packageName, true),
      };
    },
  });
}

async function seekLayerNode(adb, serial, packageName, key, direction) {
  const testId = `map.layers.toggle.${key}`;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const { nodes, carousel } = await readLayerCarouselSnapshot(adb, serial, packageName);
    const target = nodes.find(node => nodeMatchesTestId(node, testId, packageName) && nodeVisibleWithin(node, carousel));
    if (target) return target;
    swipeWithin(adb, serial, carousel.bounds, direction);
    await waitMs(250);
  }
  throw new MemoryGateError(`layer_selector_unavailable_${key}`);
}

async function moveCarouselToStart(adb, serial, packageName) {
  for (let index = 0; index < 24; index += 1) {
    const { nodes, carousel } = await readLayerCarouselSnapshot(adb, serial, packageName);
    const first = nodes.find(node => (
      nodeMatchesTestId(node, 'map.layers.toggle.3d', packageName)
      && nodeVisibleWithin(node, carousel)
    ));
    if (first) return;
    swipeWithin(adb, serial, carousel.bounds, 'reverse');
    await waitMs(180);
  }
  throw new MemoryGateError('layer_carousel_start_unavailable');
}

async function visitLayerStates(adb, serial, packageName, order, desiredState = null, directionOverride = null) {
  const result = {};
  const direction = directionOverride
    ?? (order[0] === HEAVY_MAP_LAYER_KEYS[0] ? 'forward' : 'reverse');
  for (const key of order) {
    assertNotCancelled();
    let node = await seekLayerNode(adb, serial, packageName, key, direction);
    let checked = checkedStateFromNode(node);
    result[key] = checked;
    if (desiredState != null && checked !== desiredState) {
      checked = await convergeLayerState({
        initialState: checked,
        desiredState,
        tapOnce: () => tapNode(adb, serial, node),
        readState: async () => {
          node = await seekLayerNode(adb, serial, packageName, key, direction);
          return checkedStateFromNode(node);
        },
        failureCode: `layer_toggle_failed_${key}`,
      });
      result[key] = checked;
    }
  }
  return result;
}

async function setLayerSubsetStates(adb, serial, packageName, keys, desiredState) {
  if (!Array.isArray(keys) || keys.some(key => !HEAVY_MAP_LAYER_KEYS.includes(key))) {
    throw new MemoryGateError('layer_restore_subset_invalid');
  }
  if (keys.length === 0) return {};
  await ensureLayerSheet(adb, serial, packageName);
  await moveCarouselToStart(adb, serial, packageName);
  return visitLayerStates(
    adb,
    serial,
    packageName,
    keys,
    desiredState,
    'forward',
  );
}

async function captureCurrentLayerStates(adb, serial, packageName) {
  await ensureLayerSheet(adb, serial, packageName);
  await moveCarouselToStart(adb, serial, packageName);
  return visitLayerStates(
    adb,
    serial,
    packageName,
    HEAVY_MAP_LAYER_KEYS,
    null,
    'forward',
  );
}

async function relaunchForLayerRecovery(adb, serial, packageName, launchComponent) {
  forceStopApp(adb, serial, packageName);
  await waitMs(800);
  launchApp(adb, serial, launchComponent);
  // Recovery must tolerate a cold preview launch. A fixed short delay can
  // inspect the splash screen and falsely report that restoration failed.
  await waitForTestId(adb, serial, packageName, 'app.tab.map', 30_000);
}

function meminfoProcessId(text, packageName) {
  const match = String(text).match(/\*\* MEMINFO in pid (\d+) \[([^\]]+)\] \*\*/);
  if (!match || match[2] !== packageName) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function recordAndVerifyProcessIdentity(processState, processId) {
  if (!processState || typeof processState !== 'object') {
    throw new MemoryGateError('memory_process_state_unavailable');
  }
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    processState.alive = false;
    throw new MemoryGateError('memory_process_not_alive');
  }
  if (processState.internalProcessId == null) processState.internalProcessId = processId;
  else if (processState.internalProcessId !== processId) {
    processState.alive = false;
    processState.instanceChanged = true;
    throw new MemoryGateError('memory_process_instance_changed');
  }
  processState.alive = true;
  return true;
}

function sampleMemoryV3(adb, serial, packageName, processState) {
  const dump = runAdb(adb, deviceArgs(serial, ['shell', 'dumpsys', 'meminfo', packageName]), {
    allowFailure: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const processId = meminfoProcessId(dump, packageName);
  recordAndVerifyProcessIdentity(processState, processId);
  try {
    return parseAndroidMeminfoV3(dump);
  } catch {
    throw new MemoryGateError('memory_sample_unavailable');
  }
}

function exitInfoSnapshot(adb, serial, packageName) {
  const dump = runAdb(adb, deviceArgs(serial, [
    'shell', 'dumpsys', 'activity', 'exit-info', packageName,
  ]), {
    failureCode: 'exit_info_query_failed',
    maxBuffer: 16 * 1024 * 1024,
  });
  return parseRecognizedExitInfoDump(dump, packageName);
}

function lastAnrSnapshot(adb, serial) {
  const dump = runAdb(adb, deviceArgs(serial, [
    'shell', 'dumpsys', 'activity', 'lastanr',
  ]), {
    failureCode: 'last_anr_query_failed',
    maxBuffer: 2 * 1024 * 1024,
  });
  return parseRecognizedLastAnrDump(dump);
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

async function collectSamples(
  adb,
  serial,
  packageName,
  processState,
  count = 3,
  proveReady = null,
) {
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    if (proveReady) await proveReady();
    samples.push(sampleMemoryV3(adb, serial, packageName, processState));
    if (index < count - 1) await waitMs(SAMPLE_GAP_MS);
  }
  return samples;
}

const MEMORY_WINDOW_OPTIONAL_METRICS = Object.freeze([
  'nativeHeapPssKb', 'nativeHeapRssKb', 'graphicsPssKb', 'graphicsRssKb',
  'glMtrackPssKb', 'glMtrackRssKb', 'unknownPssKb', 'unknownRssKb',
]);
const MEMORY_WINDOW_OBJECT_COUNT_METRICS = Object.freeze([
  'viewCount', 'activityCount', 'appContextCount', 'webViewCount',
]);

function summarizedMetric(samples, metric, mode) {
  const values = samples.map(sample => sample[metric]).filter(Number.isFinite);
  if (values.length === 0) return null;
  return mode === 'peak' ? Math.max(...values) : Math.min(...values);
}

export function summarizeMemoryWindow(samples, budget, mode) {
  if (!Array.isArray(samples) || samples.length !== 3) {
    throw new MemoryGateError('memory_window_must_have_three_samples');
  }
  if (!budget || !Number.isFinite(budget.maxTotalPssKb) || !Number.isFinite(budget.maxTotalRssKb)) {
    throw new MemoryGateError('memory_window_budget_invalid');
  }
  if (mode !== 'peak' && mode !== 'valley') {
    throw new MemoryGateError('memory_window_mode_invalid');
  }
  // Reuse the policy parser so a malformed or incomplete sample cannot take
  // part in the deterministic summary.
  evaluatePhaseBudgetV3(samples, budget);
  const totalPssKb = summarizedMetric(samples, 'totalPssKb', mode);
  const totalSwapPssKb = summarizedMetric(samples, 'totalSwapPssKb', mode);
  const summary = {
    totalPssKb,
    totalSwapPssKb,
    pssMinusSwapDiagnosticKb: Math.max(0, totalPssKb - totalSwapPssKb),
    // PSS and RSS are summarized independently. A high-RSS sample cannot be
    // hidden merely because another sample had the higher normalized PSS.
    totalRssKb: summarizedMetric(samples, 'totalRssKb', mode),
  };
  for (const metric of MEMORY_WINDOW_OPTIONAL_METRICS) {
    summary[metric] = summarizedMetric(samples, metric, mode);
  }
  // Object counts remain conservative in both windows so retained-tree
  // ratchet detection cannot be weakened by selecting a low-count valley.
  for (const metric of MEMORY_WINDOW_OBJECT_COUNT_METRICS) {
    summary[metric] = summarizedMetric(samples, metric, 'peak');
  }
  return summary;
}

export function assertPssAndRssPhaseSafety(samples, safetyBudget, phase) {
  const evaluation = evaluatePhaseBudgetV3(samples, safetyBudget);
  if (evaluation.checks.totalPssWithinBudget === false) {
    throw new MemoryGateError(`${phase}_total_pss_safety_cap_failed`);
  }
  if (evaluation.checks.totalRssWithinBudget === false) {
    throw new MemoryGateError(`${phase}_rss_safety_cap_failed`);
  }
  return evaluation;
}

const MEMORY_GATE_REPORT_TOP_LEVEL_KEYS = Object.freeze([
  'schema_version', 'started_at', 'completed_at', 'candidate', 'device', 'app', 'safety', 'layers',
  'memory', 'process', 'result', 'failure_code', 'execution_failure_codes', 'terminal_evidence_failure_code',
  'restoration_failure_code', 'privacy',
]);

const MEMORY_GATE_REPORT_ALLOWED_KEYS = new Set([
  ...MEMORY_GATE_REPORT_TOP_LEVEL_KEYS,
  'ota_source_git_sha', 'harness_git_sha', 'binary_build_git_sha', 'runtime', 'build_id', 'update_id',
  'build_evidence_verified', 'device_identity_verified', 'harness_provenance',
  'candidate_is_ancestor', 'approved_candidate_delta', 'harness_file_sha256',
  'role', 'android_sdk', 'android_release_major', 'package_name', 'version_name', 'version_code',
  'exact_device_required', 'app_data_cleared', 'permissions_changed', 'active_navigation_or_tour',
  'duplicate_renderer_check_completed', 'duplicate_renderer_observed',
  'layer_state_retention_check_completed', 'layer_state_loss_observed', 'raw_ui_or_logs_stored',
  'stress_keys', 'purpose', 'functional_regression_tested', 'initial', 'baseline', 'restored', 'recovery',
  'explore_idle_settle_ms', 'map_idle_settle_ms', 'cycle_phase_settle_ms', 'post_map_settle_ms',
  'explore_recovery_settle_ms', 'sample_gap_ms', 'cycle_count', 'cycle_attempt_count',
  'explore_idle_samples', 'map_idle_samples', 'cycles', 'incomplete_cycles', 'partial_cycle',
  'post_map_recovery_samples', 'explore_recovery_samples',
  'active_samples', 'active_phase_status', 'object_count_ratchet', 'evaluation', 'policy', 'device_role',
  'navigation', 'preview3d', 'originals', 'alive', 'instance_changed', 'exit_evidence_checked',
  'foreground_proof_count', 'foreground_proof_completed',
  'terminal_identity_checked', 'exit_evidence', 'live_anr_evidence',
  'baseline_captured', 'observation_count', 'new_anr_count',
  'reportVersion', 'requiredCycleCount', 'cycleEdgeWindow', 'phaseBudgetsKb',
  'exploreIdle', 'exploreRecovery', 'mapIdle', 'heavyPeak', 'activeExperience', 'maxTotalPssKb',
  'referencePssMinusSwapDiagnosticKb', 'maxTotalRssKb', 'postMapRecovery', 'disabledRecovery',
  'exploreReturn', 'maxPercentExclusive', 'maxAbsoluteKbExclusive', 'maxPercentInclusive',
  'maxAbsoluteKbInclusive', 'maxRetainedSlopeKbPerCycleInclusive',
  'totalPssKb', 'totalSwapPssKb', 'pssMinusSwapDiagnosticKb', 'totalRssKb',
  'nativeHeapPssKb', 'nativeHeapRssKb', 'graphicsPssKb', 'graphicsRssKb',
  'glMtrackPssKb', 'glMtrackRssKb', 'unknownPssKb', 'unknownRssKb',
  'viewCount', 'activityCount', 'appContextCount', 'webViewCount',
  'cycle', 'heavyPeakWindow', 'disabledRecoveryWindow', 'heavyLayerStateVerified',
  'disabledLayerStateVerified', 'enable_failure_code', 'disable_failure_code',
  'version', 'budgetPassed', 'growthPassed', 'cycleCountPassed',
  'observedCycleCount', 'phaseBudgets', 'growth', 'heavyPeaks', 'disabledRecoveries', 'retainedSlope',
  'stability', 'cycleCurve', 'evaluated', 'required', 'passed', 'sampleCount', 'limits',
  'checks', 'observed', 'count', 'median', 'maximum', 'totalPss', 'totalRss',
  'baselineMedianKb', 'comparisonMedianKb', 'deltaKb', 'growthPercent', 'maxPercent',
  'maxAbsoluteKb', 'percentPassed', 'absolutePassed', 'totalPssKbPerCycle',
  'totalRssKbPerCycle', 'maxKbPerCycle', 'totalPssPassed', 'totalRssPassed',
  'processAlive', 'exitEvidenceChecked', 'cancelled', 'layerStateRestored',
  'duplicateRendererEvidenceComplete', 'stateLossEvidenceComplete',
  'objectCountEvidenceAvailable', 'objectCountEvidenceComplete', 'objectCountRatchetDetected',
  'lowMemoryKillCount', 'oomCount', 'anrCount', 'processDeathCount',
  'duplicateRendererCount', 'stateLossCount', 'notCancelled', 'noObjectCountRatchet',
  'noLowMemoryKill', 'noOom', 'noAnr', 'noProcessDeath', 'noDuplicateRenderer', 'noStateLoss',
  'available', 'complete', 'requiredSampleCount', 'observedSampleCount', 'detected', 'metrics',
  'earlyMedian', 'precedingLateMedian', 'lateMedian', 'earlyFloor', 'lateFloor',
  'slopePerCycle', 'positiveTransitionCount', 'latePositiveTransitionCount', 'newRecordCount',
  'failureCount', 'forceStopCount', 'unclassifiedReasonCount', 'failureReasonCounts',
  'failureRecords', 'timestampKeyMs', 'reason', 'subreason', 'status', 'importance', 'pssKb', 'rssKb',
  'reason2Count', 'reason3Count', 'reason4Count', 'reason5Count', 'reason6Count', 'reason7Count',
  'reason9Count', 'reason17Count', 'target', 'attempted', 'target_false_keys', 'target_true_keys',
  'pre_restore_relaunch_completed', 'relaunch_before_restore_completed', 'persistence_wait_ms',
  'target_false_observed', 'target_true_observed', 'verified_before_relaunch',
  'persistence_wait_completed', 'post_restore_relaunch_completed', 'verified_after_relaunch',
  'failure_observed_state', 'attempt_count', 'max_attempts', 'retry_reason', 'recovered_after_retry',
  'attempts', 'attempt', 'totalPssWithinBudget', 'totalRssWithinBudget',
  'pssMinusSwapDiagnosticWithinReference', 'm1Passed',
  'activeExperienceEvidenceComplete', 'activeExperienceMemoryPassed',
  'completeMemoryEvidencePassed',
  ...HEAVY_MAP_LAYER_KEYS,
]);

const MEMORY_GATE_STRING_IDENTIFIER_KEYS = new Set([
  'runtime', 'build_id', 'update_id', 'version_name', 'version_code',
]);
const MEMORY_GATE_STRING_FAILURE_KEYS = new Set([
  'failure_code', 'terminal_evidence_failure_code', 'restoration_failure_code', 'retry_reason',
  'enable_failure_code', 'disable_failure_code', 'execution_failure_codes',
]);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SAFE_FAILURE_CODE = /^[a-z][a-z0-9_.-]{0,95}$/;
const SHA_40 = /^[a-f0-9]{40}$/;
const SHA_64 = /^[a-f0-9]{64}$/;

function assertExactObjectKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MemoryGateError(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new MemoryGateError(code);
  }
}

function assertMemoryGateReportString(key, value) {
  if (key === 'started_at' || key === 'completed_at') {
    if (!ISO_INSTANT.test(value)) throw new MemoryGateError('report_privacy_invalid_timestamp');
    return;
  }
  if (['ota_source_git_sha', 'harness_git_sha', 'binary_build_git_sha'].includes(key)) {
    if (!SHA_40.test(value)) throw new MemoryGateError('report_privacy_invalid_hash');
    return;
  }
  if (MEMORY_GATE_STRING_IDENTIFIER_KEYS.has(key)) {
    if (!SAFE_IDENTIFIER.test(value)) throw new MemoryGateError('report_privacy_invalid_identifier');
    return;
  }
  if (MEMORY_GATE_STRING_FAILURE_KEYS.has(key)) {
    if (!SAFE_FAILURE_CODE.test(value)) throw new MemoryGateError('report_privacy_invalid_failure_code');
    return;
  }
  if (key === 'package_name' && APPROVED_TRAILHEAD_ANDROID_PACKAGES.includes(value)) return;
  if (key === 'role' && value === 'stress_reference_4gb') return;
  if (key === 'active_navigation_or_tour' && ['not_checked', 'absent'].includes(value)) return;
  if (key === 'purpose' && value === 'deterministic_memory_load') return;
  if (key === 'device_role' && value === 'stress_reference_4gb') return;
  if (['navigation', 'preview3d', 'originals'].includes(key)
    && value === 'not_run_by_non_destructive_map_gate') return;
  if (key === 'result' && ['running', 'passed', 'failed'].includes(value)) return;
  if (key === 'privacy' && value === MEMORY_GATE_REPORT_PRIVACY_STATEMENT) return;
  if (['stress_keys', 'target_false_keys', 'target_true_keys'].includes(key)
    && HEAVY_MAP_LAYER_KEYS.includes(value)) return;
  if (key === 'approved_candidate_delta' && MEMORY_GATE_HARNESS_ALLOWED_CHANGED_PATHS.includes(value)) return;
  throw new MemoryGateError('report_privacy_arbitrary_string');
}

function assertMemoryGateReportValue(value, key = null, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean') return;
  if (value === undefined) throw new MemoryGateError('report_privacy_invalid_value');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MemoryGateError('report_privacy_non_finite_number');
    return;
  }
  if (typeof value === 'string') {
    assertMemoryGateReportString(key, value);
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw new MemoryGateError('report_privacy_invalid_value');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) assertMemoryGateReportValue(child, key, seen);
  } else if (key === 'harness_file_sha256') {
    assertExactObjectKeys(value, MEMORY_GATE_HARNESS_REQUIRED_PATHS, 'report_privacy_invalid_harness_hashes');
    for (const hash of Object.values(value)) {
      if (!SHA_64.test(hash)) throw new MemoryGateError('report_privacy_invalid_hash');
    }
  } else {
    for (const [childKey, child] of Object.entries(value)) {
      if (!MEMORY_GATE_REPORT_ALLOWED_KEYS.has(childKey)) {
        throw new MemoryGateError('report_privacy_unexpected_key');
      }
      assertMemoryGateReportValue(child, childKey, seen);
    }
  }
  seen.delete(value);
}

export function assertAndroidMemoryGateReportV3Privacy(report) {
  assertExactObjectKeys(report, MEMORY_GATE_REPORT_TOP_LEVEL_KEYS, 'report_privacy_invalid_schema');
  if (report.schema_version !== 3) throw new MemoryGateError('report_privacy_invalid_schema');
  assertExactObjectKeys(report.candidate, [
    'ota_source_git_sha', 'harness_git_sha', 'binary_build_git_sha', 'runtime', 'build_id', 'update_id',
    'build_evidence_verified', 'device_identity_verified', 'harness_provenance',
  ], 'report_privacy_invalid_candidate_schema');
  if (report.candidate.harness_provenance != null) {
    assertExactObjectKeys(report.candidate.harness_provenance, [
      'candidate_is_ancestor', 'approved_candidate_delta', 'harness_file_sha256',
    ], 'report_privacy_invalid_harness_schema');
  }
  if (report.device != null) {
    assertExactObjectKeys(report.device, ['role', 'android_sdk', 'android_release_major'], 'report_privacy_invalid_device_schema');
  }
  assertExactObjectKeys(report.app, ['package_name', 'version_name', 'version_code'], 'report_privacy_invalid_app_schema');
  assertExactObjectKeys(report.safety, [
    'exact_device_required', 'app_data_cleared', 'permissions_changed', 'active_navigation_or_tour',
    'duplicate_renderer_check_completed', 'duplicate_renderer_observed',
    'layer_state_retention_check_completed', 'layer_state_loss_observed', 'raw_ui_or_logs_stored',
  ], 'report_privacy_invalid_safety_schema');
  assertExactObjectKeys(report.layers, [
    'stress_keys', 'purpose', 'functional_regression_tested', 'initial', 'baseline', 'restored', 'recovery',
  ], 'report_privacy_invalid_layers_schema');
  assertExactObjectKeys(report.memory, [
    'policy', 'device_role', 'explore_idle_settle_ms', 'map_idle_settle_ms', 'cycle_phase_settle_ms',
    'post_map_settle_ms', 'explore_recovery_settle_ms', 'sample_gap_ms', 'cycle_count',
    'cycle_attempt_count', 'explore_idle_samples', 'map_idle_samples', 'cycles', 'incomplete_cycles',
    'partial_cycle', 'post_map_recovery_samples', 'explore_recovery_samples', 'active_samples',
    'active_phase_status', 'object_count_ratchet', 'evaluation',
  ], 'report_privacy_invalid_memory_schema');
  assertExactObjectKeys(report.process, [
    'alive', 'instance_changed', 'foreground_proof_count', 'foreground_proof_completed',
    'exit_evidence_checked', 'terminal_identity_checked', 'exit_evidence', 'live_anr_evidence',
  ], 'report_privacy_invalid_process_schema');
  assertExactObjectKeys(report.process.live_anr_evidence, [
    'baseline_captured', 'observation_count', 'new_anr_count',
  ], 'report_privacy_invalid_live_anr_schema');
  assertMemoryGateReportValue(report);
  return true;
}

export function writeAndroidMemoryGateReportV3Atomically(directory, report, operations = {}) {
  assertAndroidMemoryGateReportV3Privacy(report);
  const makeDirectory = operations.mkdirSync ?? mkdirSync;
  const writeFile = operations.writeFileSync ?? writeFileSync;
  const renameFile = operations.renameSync ?? renameSync;
  const unlinkFile = operations.unlinkSync ?? unlinkSync;
  makeDirectory(directory, { recursive: true });
  const finalPath = join(directory, 'report.json');
  const temporaryPath = join(
    directory,
    `.report.json.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'wx',
      flush: true,
    });
    renameFile(temporaryPath, finalPath);
  } catch (error) {
    try {
      unlinkFile(temporaryPath);
    } catch {
      // The primary write/rename error remains authoritative. A missing temp
      // file is expected when creation itself failed.
    }
    throw error;
  }
  return finalPath;
}

function safeFailureCode(error) {
  if (error instanceof MemoryGateError && /^[a-z0-9_.-]{1,96}$/.test(error.code)) return error.code;
  return 'unexpected_gate_failure';
}

function recordExecutionFailure(report, failureCode) {
  const code = SAFE_FAILURE_CODE.test(String(failureCode || ''))
    ? String(failureCode)
    : 'unexpected_gate_failure';
  if (!report.failure_code) {
    report.failure_code = code;
    return;
  }
  if (!Array.isArray(report.execution_failure_codes)) report.execution_failure_codes = [];
  if (report.execution_failure_codes.length < 32) report.execution_failure_codes.push(code);
}

function createLayerCycleAttempt(cycle) {
  return {
    cycle,
    heavyPeak: null,
    heavyPeakWindow: [],
    heavyLayerStateVerified: false,
    enable_failure_code: null,
    disabledRecovery: null,
    disabledRecoveryWindow: [],
    disabledLayerStateVerified: false,
    disable_failure_code: null,
  };
}

function completeLayerCycleFromAttempt(attempt) {
  return {
    cycle: attempt.cycle,
    heavyPeak: attempt.heavyPeak,
    heavyPeakWindow: attempt.heavyPeakWindow,
    heavyLayerStateVerified: true,
    disabledRecovery: attempt.disabledRecovery,
    disabledRecoveryWindow: attempt.disabledRecoveryWindow,
    disabledLayerStateVerified: true,
  };
}

export function isContinuableLayerWorkloadFailureCode(code) {
  const value = String(code || '');
  return /^layer_toggle_failed_(?:3d|lands|usgs|pois|trails|fire|ava|radar|mvum)$/.test(value)
    || /^layer_selector_unavailable_(?:3d|lands|usgs|pois|trails|fire|ava|radar|mvum)$/.test(value)
    || /^layer_cycle_(?:enable|disable)_not_confirmed(?:_(?:3d|lands|usgs|pois|trails|fire|ava|radar|mvum))?$/.test(value)
    || /^layer_state_snapshot_incomplete(?:_(?:3d|lands|usgs|pois|trails|fire|ava|radar|mvum))?$/.test(value)
    || value === 'layer_accessibility_state_missing'
    || value === 'layer_carousel_unavailable'
    || value === 'layer_carousel_start_unavailable';
}

/**
 * Run every requested layer workload attempt while keeping invalid phases out
 * of the authoritative memory curve. A layer transition failure is
 * continuable only after the caller independently proves that the same process
 * is alive, foreground-ready, and below the phase safety cap. Measurement,
 * process, foreground, ADB, safety-cap, and cancellation failures are never
 * caught here.
 */
export async function executeLayerDiagnosticCycles({
  cycleCount,
  memory,
  enableTransition,
  measureHeavyPeak,
  disableTransition,
  measureDisabledRecovery,
  assertContinuationSafe,
  recordWorkloadFailure,
  requirePostCycleBaseline,
}) {
  if (!Number.isInteger(cycleCount) || cycleCount <= 0
    || !memory || !Array.isArray(memory.cycles) || !Array.isArray(memory.incomplete_cycles)
    || typeof enableTransition !== 'function' || typeof measureHeavyPeak !== 'function'
    || typeof disableTransition !== 'function' || typeof measureDisabledRecovery !== 'function'
    || typeof assertContinuationSafe !== 'function' || typeof recordWorkloadFailure !== 'function'
    || typeof requirePostCycleBaseline !== 'function') {
    throw new MemoryGateError('layer_cycle_execution_contract_invalid');
  }

  const attemptTransition = async ({ cycle, attempt, phase, transition, verified }) => {
    try {
      await transition(cycle, attempt);
      if (!verified(attempt)) {
        throw new MemoryGateError(`layer_cycle_${phase}_not_confirmed`);
      }
      return true;
    } catch (error) {
      const failureCode = safeFailureCode(error);
      if (failureCode === 'cancelled' || !isContinuableLayerWorkloadFailureCode(failureCode)) {
        throw error;
      }
      if (phase === 'enable') attempt.enable_failure_code = failureCode;
      else attempt.disable_failure_code = failureCode;

      // The workload error is recorded as primary only after the independent
      // continuation proof succeeds. If that proof finds process death,
      // foreground loss, ADB loss, or a safety-cap breach, its stop-the-line
      // error remains authoritative while the partial attempt retains this
      // sanitized transition failure.
      await assertContinuationSafe({ cycle, phase, failureCode });
      await recordWorkloadFailure({ cycle, phase, failureCode });
      return false;
    }
  };

  for (let cycle = 1; cycle <= cycleCount; cycle += 1) {
    const attempt = createLayerCycleAttempt(cycle);
    memory.cycle_attempt_count = cycle;
    memory.partial_cycle = attempt;

    const enableVerified = await attemptTransition({
      cycle,
      attempt,
      phase: 'enable',
      transition: enableTransition,
      verified: current => current.heavyLayerStateVerified === true,
    });
    if (enableVerified) await measureHeavyPeak(cycle, attempt);

    const disableVerified = await attemptTransition({
      cycle,
      attempt,
      phase: 'disable',
      transition: disableTransition,
      verified: current => current.disabledLayerStateVerified === true,
    });
    if (disableVerified) await measureDisabledRecovery(cycle, attempt);

    const complete = enableVerified
      && disableVerified
      && attempt.heavyPeak != null
      && attempt.disabledRecovery != null;
    if (complete) memory.cycles.push(completeLayerCycleFromAttempt(attempt));
    else memory.incomplete_cycles.push(attempt);
    memory.partial_cycle = null;
  }

  // A failed final disable cannot make post-Map recovery look artificially
  // high or low. All ten attempts finish first, then the caller must establish
  // and verify the exact all-disabled baseline before any recovery sample.
  await requirePostCycleBaseline();
  return {
    attemptedCycleCount: memory.cycle_attempt_count,
    completedCycleCount: memory.cycles.length,
    incompleteCycleCount: memory.incomplete_cycles.length,
  };
}

/**
 * Own the gate's catch/finally contract independently from ADB so failure-path
 * behavior can be proven deterministically. Once layer state has been captured,
 * every measurement failure must collect terminal process evidence before any
 * restoration force-stop, then restore and write the completed report while
 * keeping primary, terminal-evidence, and restoration failures separate.
 */
export async function executeMemoryGateLifecycle({
  report,
  executeGate,
  getInitialStates,
  collectTerminalEvidence = async () => {},
  restoreLayers,
  finalizeReport,
  completedAt = () => new Date().toISOString(),
}) {
  try {
    await executeGate();
  } catch (error) {
    report.result = 'failed';
    recordExecutionFailure(report, safeFailureCode(error));
  } finally {
    try {
      await collectTerminalEvidence(report);
    } catch (error) {
      report.result = 'failed';
      report.terminal_evidence_failure_code = safeFailureCode(error);
    }
    const initialStates = getInitialStates();
    if (initialStates) {
      let restoration;
      try {
        restoration = await restoreLayers(initialStates);
      } catch (error) {
        restoration = {
          restored: false,
          failureCode: safeFailureCode(error),
          recovery: null,
        };
      }
      applyLayerRestorationOutcome(report, restoration);
    }
    report.completed_at = completedAt();
    await finalizeReport(report);
  }
  return report;
}

async function runGate(options) {
  assertEvidenceDirectoryIgnored();
  mkdirSync(evidenceRoot, { recursive: true });
  const output = join(evidenceRoot, timestamp());
  const report = {
    schema_version: 3,
    started_at: new Date().toISOString(),
    completed_at: null,
    candidate: {
      ota_source_git_sha: options.expectedCommitSha,
      harness_git_sha: null,
      harness_provenance: null,
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
      duplicate_renderer_check_completed: false,
      duplicate_renderer_observed: null,
      layer_state_retention_check_completed: false,
      layer_state_loss_observed: null,
      raw_ui_or_logs_stored: false,
    },
    layers: {
      stress_keys: [...HEAVY_MAP_LAYER_KEYS],
      purpose: 'deterministic_memory_load',
      functional_regression_tested: false,
      initial: null,
      baseline: null,
      restored: false,
      recovery: null,
    },
    memory: {
      policy: ANDROID_MEMORY_GATE_V3_POLICY,
      device_role: 'stress_reference_4gb',
      explore_idle_settle_ms: BASELINE_SETTLE_MS,
      map_idle_settle_ms: BASELINE_SETTLE_MS,
      cycle_phase_settle_ms: CYCLE_PHASE_SETTLE_MS,
      post_map_settle_ms: POST_MAP_SETTLE_MS,
      explore_recovery_settle_ms: EXPLORE_RECOVERY_SETTLE_MS,
      sample_gap_ms: SAMPLE_GAP_MS,
      cycle_count: MAP_LAYER_CYCLE_COUNT,
      cycle_attempt_count: 0,
      explore_idle_samples: [],
      map_idle_samples: [],
      cycles: [],
      incomplete_cycles: [],
      partial_cycle: null,
      post_map_recovery_samples: [],
      explore_recovery_samples: [],
      active_samples: {
        navigation: [],
        preview3d: [],
        originals: [],
      },
      active_phase_status: {
        navigation: 'not_run_by_non_destructive_map_gate',
        preview3d: 'not_run_by_non_destructive_map_gate',
        originals: 'not_run_by_non_destructive_map_gate',
      },
      object_count_ratchet: null,
      evaluation: null,
    },
    process: {
      alive: true,
      instance_changed: false,
      foreground_proof_count: 0,
      foreground_proof_completed: false,
      terminal_identity_checked: false,
      exit_evidence_checked: false,
      exit_evidence: null,
      live_anr_evidence: {
        baseline_captured: false,
        observation_count: 0,
        new_anr_count: 0,
      },
    },
    result: 'running',
    failure_code: null,
    execution_failure_codes: [],
    terminal_evidence_failure_code: null,
    restoration_failure_code: null,
    privacy: MEMORY_GATE_REPORT_PRIVACY_STATEMENT,
  };

  const adb = findAdb(options.adb);
  let initialStates = null;
  let launchComponent = null;
  let serial = options.serial;
  let exitBaseline = null;
  let liveAnrMonitor = null;
  const processState = {
    alive: true,
    instanceChanged: false,
    internalProcessId: null,
  };
  const phaseSafetyCap = ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.activeExperience;
  let mapForegroundProofCount = 0;
  const observeLiveAnr = () => {
    if (!liveAnrMonitor) throw new MemoryGateError('last_anr_baseline_unavailable');
    const observation = liveAnrMonitor.observe(lastAnrSnapshot(adb, serial));
    report.process.live_anr_evidence = {
      baseline_captured: observation.baseline_captured,
      observation_count: observation.observation_count,
      new_anr_count: observation.new_anr_count,
    };
    return observation;
  };
  const proveMeasurementState = async rootTestId => {
    try {
      const readiness = proveForegroundMeasurementState(
        adb,
        serial,
        options.packageName,
        rootTestId,
      );
      report.process.foreground_proof_count += 1;
      if (rootTestId === 'map.screen') mapForegroundProofCount += 1;
      return readiness;
    } catch (error) {
      if (error instanceof MemoryGateError && error.code === 'duplicate_map_renderer_observed') {
        report.safety.duplicate_renderer_check_completed = true;
        report.safety.duplicate_renderer_observed = true;
      }
      if (liveAnrMonitor && observeLiveAnr().new_anr_count > 0) {
        throw new MemoryGateError('live_process_anr_observed');
      }
      throw error;
    }
  };
  const settleWithProof = (durationMs, label, rootTestId) => waitWithContinuousProof({
    durationMs,
    label,
    prove: () => proveMeasurementState(rootTestId),
  });
  await executeMemoryGateLifecycle({
    report,
    executeGate: async () => {
    const harnessProvenance = collectMemoryGateHarnessProvenance(options.expectedCommitSha);
    report.candidate.harness_git_sha = harnessProvenance.harnessGitSha;
    report.candidate.harness_provenance = {
      candidate_is_ancestor: harnessProvenance.candidate_is_ancestor,
      approved_candidate_delta: harnessProvenance.approved_candidate_delta,
      harness_file_sha256: harnessProvenance.harness_file_sha256,
    };
    fetchAndValidatePreviewBuild(options);
    report.candidate.build_evidence_verified = true;
    const devices = parseDevices(runAdb(adb, ['devices', '-l']));
    const target = devices.find(device => device.serial === serial && device.state === 'device');
    if (!target) throw new MemoryGateError('device_not_authorized');
    const sdk = Number(getProp(adb, serial, 'ro.build.version.sdk'));
    const androidReleaseMajor = Number(
      getProp(adb, serial, 'ro.build.version.release').match(/^\d+/)?.[0],
    );
    if (!Number.isSafeInteger(sdk) || sdk <= 0
      || !Number.isSafeInteger(androidReleaseMajor) || androidReleaseMajor <= 0) {
      throw new MemoryGateError('device_platform_metadata_unavailable');
    }
    report.device = {
      role: 'stress_reference_4gb',
      android_sdk: sdk,
      android_release_major: androidReleaseMajor,
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
    liveAnrMonitor = createLiveAnrMonitorV3({
      baseline: lastAnrSnapshot(adb, serial),
      packageName: options.packageName,
    });
    report.process.live_anr_evidence.baseline_captured = true;
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
    await waitForTestId(adb, serial, options.packageName, 'app.tab.map', 30_000);
    exitBaseline = exitInfoSnapshot(adb, serial, options.packageName);
    // Pin the process instance before the first long settle. The terminal
    // sample must observe this exact PID; a transparent restart is a failure.
    sampleMemoryV3(adb, serial, options.packageName, processState);

    await navigateToTab(adb, serial, options.packageName, 'guide');
    await settleWithProof(BASELINE_SETTLE_MS, 'Settling signed-in Explore', 'explore.screen');
    report.memory.explore_idle_samples = await collectSamples(
      adb,
      serial,
      options.packageName,
      processState,
      3,
      () => proveMeasurementState('explore.screen'),
    );
    assertPssAndRssPhaseSafety(
      report.memory.explore_idle_samples,
      phaseSafetyCap,
      'explore_idle',
    );

    await navigateToTab(adb, serial, options.packageName, 'map');
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
    report.layers.baseline = {
      ...assertExactLayerState(
        await captureCurrentLayerStates(adb, serial, options.packageName),
        Object.fromEntries(HEAVY_MAP_LAYER_KEYS.map(key => [key, false])),
        'layer_baseline_not_confirmed',
      ),
    };
    assertExactLayerState(
      preparedLayers.baselineStates,
      report.layers.baseline,
      'layer_baseline_transition_mismatch',
    );
    await closeLayerSheet(adb, serial, options.packageName);
    await settleWithProof(
      BASELINE_SETTLE_MS,
      'Settling the map with heavy layers disabled',
      'map.screen',
    );
    report.memory.map_idle_samples = await collectSamples(
      adb,
      serial,
      options.packageName,
      processState,
      3,
      () => proveMeasurementState('map.screen'),
    );
    assertPssAndRssPhaseSafety(
      report.memory.map_idle_samples,
      phaseSafetyCap,
      'map_idle',
    );

    const allHeavyLayersEnabled = Object.fromEntries(
      HEAVY_MAP_LAYER_KEYS.map(key => [key, true]),
    );
    const allHeavyLayersDisabled = Object.fromEntries(
      HEAVY_MAP_LAYER_KEYS.map(key => [key, false]),
    );
    await executeLayerDiagnosticCycles({
      cycleCount: MAP_LAYER_CYCLE_COUNT,
      memory: report.memory,
      enableTransition: async (cycle, attempt) => {
        console.log(`Layer cycle ${cycle}/${MAP_LAYER_CYCLE_COUNT}: enable`);
        await ensureLayerSheet(adb, serial, options.packageName);
        await moveCarouselToStart(adb, serial, options.packageName);
        await visitLayerStates(
          adb,
          serial,
          options.packageName,
          HEAVY_MAP_LAYER_KEYS,
          true,
          'forward',
        );
        const states = assertExactLayerState(
          await captureCurrentLayerStates(adb, serial, options.packageName),
          allHeavyLayersEnabled,
          'layer_cycle_enable_not_confirmed',
        );
        attempt.heavyLayerStateVerified = Object.values(states).every(Boolean);
      },
      measureHeavyPeak: async (_cycle, attempt) => {
        await closeLayerSheet(adb, serial, options.packageName);
        await waitMs(CYCLE_PHASE_SETTLE_MS);
        attempt.heavyPeakWindow = await collectSamples(
          adb,
          serial,
          options.packageName,
          processState,
          3,
          () => proveMeasurementState('map.screen'),
        );
        attempt.heavyPeak = summarizeMemoryWindow(
          attempt.heavyPeakWindow,
          ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.heavyPeak,
          'peak',
        );
        assertPssAndRssPhaseSafety(
          attempt.heavyPeakWindow,
          phaseSafetyCap,
          'heavy_peak',
        );
      },
      disableTransition: async (cycle, attempt) => {
        console.log(`Layer cycle ${cycle}/${MAP_LAYER_CYCLE_COUNT}: disable`);
        await ensureLayerSheet(adb, serial, options.packageName);
        await moveCarouselToStart(adb, serial, options.packageName);
        await visitLayerStates(
          adb,
          serial,
          options.packageName,
          HEAVY_MAP_LAYER_KEYS,
          false,
          'forward',
        );
        const states = assertExactLayerState(
          await captureCurrentLayerStates(adb, serial, options.packageName),
          allHeavyLayersDisabled,
          'layer_cycle_disable_not_confirmed',
        );
        attempt.disabledLayerStateVerified = Object.values(states)
          .every(value => value === false);
      },
      measureDisabledRecovery: async (_cycle, attempt) => {
        await closeLayerSheet(adb, serial, options.packageName);
        await waitMs(CYCLE_PHASE_SETTLE_MS);
        attempt.disabledRecoveryWindow = await collectSamples(
          adb,
          serial,
          options.packageName,
          processState,
          3,
          () => proveMeasurementState('map.screen'),
        );
        attempt.disabledRecovery = summarizeMemoryWindow(
          attempt.disabledRecoveryWindow,
          ANDROID_MEMORY_GATE_V3_POLICY.phaseBudgetsKb.mapIdle,
          'valley',
        );
        assertPssAndRssPhaseSafety(
          attempt.disabledRecoveryWindow,
          phaseSafetyCap,
          'disabled_recovery',
        );
      },
      assertContinuationSafe: async () => {
        // A failed transition leaves the sheet open. Close it without changing
        // any layer value, then require the same strict foreground/renderer,
        // process-instance, and safety-cap evidence used by valid samples.
        await closeLayerSheet(adb, serial, options.packageName);
        await proveMeasurementState('map.screen');
        const continuationSample = sampleMemoryV3(
          adb,
          serial,
          options.packageName,
          processState,
        );
        assertPssAndRssPhaseSafety(
          [continuationSample],
          phaseSafetyCap,
          'layer_workload_continuation',
        );
      },
      recordWorkloadFailure: async ({ cycle, phase, failureCode }) => {
        console.warn(
          `Layer cycle ${cycle}/${MAP_LAYER_CYCLE_COUNT}: ${phase} workload invalid (${failureCode}); continuing diagnostics.`,
        );
        report.result = 'failed';
        recordExecutionFailure(report, failureCode);
      },
      requirePostCycleBaseline: async () => {
        await ensureLayerSheet(adb, serial, options.packageName);
        await moveCarouselToStart(adb, serial, options.packageName);
        await visitLayerStates(
          adb,
          serial,
          options.packageName,
          HEAVY_MAP_LAYER_KEYS,
          false,
          'forward',
        );
        assertExactLayerState(
          await captureCurrentLayerStates(adb, serial, options.packageName),
          allHeavyLayersDisabled,
          'layer_post_cycle_baseline_not_confirmed',
        );
      },
    });
    await closeLayerSheet(adb, serial, options.packageName);

    await settleWithProof(
      POST_MAP_SETTLE_MS,
      'Settling the map after layer cycles',
      'map.screen',
    );
    report.memory.post_map_recovery_samples = await collectSamples(
      adb,
      serial,
      options.packageName,
      processState,
      3,
      () => proveMeasurementState('map.screen'),
    );
    assertPssAndRssPhaseSafety(
      report.memory.post_map_recovery_samples,
      phaseSafetyCap,
      'post_map_recovery',
    );

    await navigateToTab(adb, serial, options.packageName, 'guide');
    await settleWithProof(
      EXPLORE_RECOVERY_SETTLE_MS,
      'Settling Explore after Map',
      'explore.screen',
    );
    report.memory.explore_recovery_samples = await collectSamples(
      adb,
      serial,
      options.packageName,
      processState,
      3,
      () => proveMeasurementState('explore.screen'),
    );
    assertPssAndRssPhaseSafety(
      report.memory.explore_recovery_samples,
      phaseSafetyCap,
      'explore_recovery',
    );
    report.process.foreground_proof_completed = true;
    if (mapForegroundProofCount <= 0) {
      throw new MemoryGateError('duplicate_renderer_evidence_unavailable');
    }
    report.safety.duplicate_renderer_check_completed = true;
    report.safety.duplicate_renderer_observed = false;
    },
    getInitialStates: () => initialStates,
    collectTerminalEvidence: () => {
      let liveAnrFailure = null;
      if (liveAnrMonitor) {
        try {
          if (observeLiveAnr().new_anr_count > 0) {
            liveAnrFailure = new MemoryGateError('live_process_anr_observed');
          }
        } catch (error) {
          liveAnrFailure = error;
        }
      }
      let identityFailure = null;
      if (exitBaseline) {
        try {
          sampleMemoryV3(adb, serial, options.packageName, processState);
          report.process.terminal_identity_checked = true;
        } catch (error) {
          identityFailure = error;
        }
      }
      report.process.alive = processState.alive;
      report.process.instance_changed = processState.instanceChanged;
      if (!exitBaseline) {
        if (liveAnrFailure) throw liveAnrFailure;
        if (identityFailure) throw identityFailure;
        return;
      }
      const evaluation = evaluateExitInfoDiffV3(
        exitBaseline,
        exitInfoSnapshot(adb, serial, options.packageName),
      );
      report.process.exit_evidence_checked = true;
      report.process.exit_evidence = evaluation;
      if (!evaluation.passed) throw new MemoryGateError('process_exit_evidence_failed');
      if (liveAnrFailure) throw liveAnrFailure;
      if (identityFailure) throw identityFailure;
    },
    restoreLayers: states => {
      cancellationSignal = null;
      return durablyRestoreCapturedHeavyLayers({
        initialStates: states,
        relaunch: () => relaunchForLayerRecovery(
          adb,
          serial,
          options.packageName,
          launchComponent,
        ),
        setLayers: (keys, desiredState) => setLayerSubsetStates(
          adb,
          serial,
          options.packageName,
          keys,
          desiredState,
        ),
        captureStates: () => captureCurrentLayerStates(
          adb,
          serial,
          options.packageName,
        ),
        waitForPersistence: durationMs => waitMs(durationMs),
      });
    },
    finalizeReport: finalizedReport => {
      const disabledRecoverySamples = finalizedReport.memory.cycles
        .map(cycle => cycle.disabledRecovery);
      finalizedReport.memory.object_count_ratchet = evaluateObjectCountRatchetV3(
        disabledRecoverySamples,
      );
      const exitEvaluation = finalizedReport.process.exit_evidence;
      const reasonCounts = exitEvaluation?.failureReasonCounts ?? {};
      const liveAnrCount = finalizedReport.process.live_anr_evidence.new_anr_count;
      const evaluation = evaluateAndroidMemoryGateV3({
        exploreIdleSamples: finalizedReport.memory.explore_idle_samples,
        mapIdleSamples: finalizedReport.memory.map_idle_samples,
        cycles: finalizedReport.memory.cycles,
        postMapRecoverySamples: finalizedReport.memory.post_map_recovery_samples,
        exploreRecoverySamples: finalizedReport.memory.explore_recovery_samples,
        activeSamples: finalizedReport.memory.active_samples,
        stability: {
          processAlive: finalizedReport.process.alive && !finalizedReport.process.instance_changed,
          exitEvidenceChecked: finalizedReport.process.exit_evidence_checked,
          cancelled: finalizedReport.failure_code === 'cancelled',
          layerStateRestored: initialStates == null || finalizedReport.layers.restored,
          objectCountRatchetDetected: finalizedReport.memory.object_count_ratchet.detected,
          lowMemoryKillCount: (reasonCounts.reason2Count ?? 0)
            + (reasonCounts.reason3Count ?? 0)
            + (reasonCounts.reason17Count ?? 0),
          oomCount: 0,
          anrCount: combineAnrCountV3(reasonCounts.reason6Count ?? 0, liveAnrCount),
          processDeathCount: exitEvaluation?.newRecordCount ?? 0,
          duplicateRendererEvidenceComplete:
            finalizedReport.safety.duplicate_renderer_check_completed,
          duplicateRendererCount:
            finalizedReport.safety.duplicate_renderer_observed === true ? 1 : 0,
          stateLossEvidenceComplete:
            finalizedReport.safety.layer_state_retention_check_completed,
          stateLossCount:
            finalizedReport.safety.layer_state_loss_observed === true ? 1 : 0,
        },
      });
      finalizedReport.memory.evaluation = evaluation;
      promoteLiveAnrFailureV3(finalizedReport);
      if (!evaluation.passed) {
        finalizedReport.result = 'failed';
        finalizedReport.failure_code ||= 'memory_gate_v3_failed';
      } else if (
        !finalizedReport.failure_code
        && !finalizedReport.terminal_evidence_failure_code
        && !finalizedReport.restoration_failure_code
      ) {
        finalizedReport.result = 'passed';
      }
      writeAndroidMemoryGateReportV3Atomically(output, finalizedReport);
    },
  });

  console.log(`Privacy-minimal evidence: ${output}`);
  if (report.result !== 'passed') {
    throw new MemoryGateError(
      report.failure_code
      || report.terminal_evidence_failure_code
      || report.restoration_failure_code
      || 'memory_gate_failed',
    );
  }
  console.log('PASS: AndroidMemoryGateReportV3 phase budgets, retention, recovery, and process checks satisfied.');
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
