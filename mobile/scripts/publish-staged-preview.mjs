import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assertAuthoritativeWorktreeClean } from './release-worktree.mjs';
import { validateReleaseEnvironment } from './release-environment.mjs';
import { combineUpdateViewPayloads } from './eas-update-evidence.mjs';
import {
  latestPlatformUpdate,
  resolveChannelBranch,
  validateCounterpartUnchanged,
  validateStagedPreviewPublication,
} from './staged-preview-evidence.mjs';

const platform = String(process.argv[2] || '').trim().toLowerCase();
const dryRun = process.argv.includes('--dry-run');
if (!['android', 'ios'].includes(platform)) {
  console.error('Usage: node scripts/publish-staged-preview.mjs <android|ios> [--dry-run]');
  process.exit(2);
}

function commandName(name) {
  return process.platform === 'win32' && name === 'npx' ? 'npx.cmd' : name;
}

function execute(command, args, { capture = false, tolerateFailure = false } = {}) {
  const result = spawnSync(commandName(command), args, {
    cwd: new URL('..', import.meta.url),
    env: process.env,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: capture ? 'utf8' : undefined,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !tolerateFailure) process.exit(result.status || 1);
  return String(result.stdout || '').trim();
}

function jsonCommand(args, label, attempts = 8) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const output = execute('npx', args, { capture: true });
      return JSON.parse(output);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
    }
  }
  throw new Error(`${label} did not stabilize: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
}

function assertClean() {
  const status = execute('git', ['-C', '..', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { capture: true });
  assertAuthoritativeWorktreeClean(status);
}

const fullSha = execute('git', ['-C', '..', 'rev-parse', 'HEAD'], { capture: true });
const shortSha = fullSha.slice(0, 8);
process.env.EXPO_PUBLIC_RELEASE_COMMIT_SHA = fullSha;

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const appConfig = require('../app.config.js').expo;
const runtimeVersion = appConfig[platform].runtimeVersion;
const counterpart = platform === 'android' ? 'ios' : 'android';
const counterpartRuntime = appConfig[counterpart].runtimeVersion;
const message = `Trailhead ${packageJson.version} preview ${shortSha} ${platform}`;

if (!dryRun) {
  assertClean();
  validateReleaseEnvironment(process.env, { requirePreviewQa: true });
}

const channelPayload = dryRun ? null : jsonCommand([
  '--yes', 'eas-cli@21.0.2', 'channel:view', 'preview', '--json', '--non-interactive',
], 'Preview channel');
const channel = dryRun
  ? { channelId: 'dry-run', branchId: 'dry-run', branch: 'preview-current-branch' }
  : resolveChannelBranch(channelPayload, 'preview');

if (dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    platform,
    branch: channel.branch,
    repositorySha: fullSha,
    runtimeVersion,
    sourceMaps: true,
  }));
  process.exit(0);
}

const beforeListing = jsonCommand([
  '--yes', 'eas-cli@21.0.2', 'update:list', '--branch', channel.branch,
  '--limit', '50', '--json', '--non-interactive',
], 'Preview branch before publication');
const counterpartBefore = latestPlatformUpdate(beforeListing, {
  branch: channel.branch,
  platform: counterpart,
  runtimeVersion: counterpartRuntime,
});

execute(process.execPath, ['scripts/local-expo-module-resolution.test.mjs']);
execute(process.execPath, ['scripts/upload-sentry-update-sourcemaps.mjs', '--check-env']);
execute('npx', [
  '--yes', 'expo', 'export', '--platform', platform, '--output-dir', 'dist',
  // Keep preview exports within the same bounded-memory envelope as the
  // production publisher. Parallel Metro workers can exhaust the WSL release
  // runner when a stale native build process is still winding down.
  '--source-maps', '--clear', '--max-workers', '1',
]);
execute(process.execPath, ['scripts/upload-sentry-update-sourcemaps.mjs']);
execute('npx', [
  '--yes', 'eas-cli@21.0.2', 'update', '--branch', channel.branch,
  '--platform', platform, '--message', message, '--environment', 'preview',
  '--input-dir', 'dist', '--skip-bundler', '--emit-metadata', '--json', '--non-interactive',
], { capture: true });

const afterListing = jsonCommand([
  '--yes', 'eas-cli@21.0.2', 'update:list', '--branch', channel.branch,
  '--limit', '50', '--json', '--non-interactive',
], 'Preview branch after publication');
const published = latestPlatformUpdate(afterListing, {
  branch: channel.branch,
  platform,
  runtimeVersion,
});
if (!published.message.includes(shortSha)) {
  throw new Error(`${platform} preview listing is not bound to ${shortSha}.`);
}
const counterpartAfter = latestPlatformUpdate(afterListing, {
  branch: channel.branch,
  platform: counterpart,
  runtimeVersion: counterpartRuntime,
});
const unchanged = validateCounterpartUnchanged(counterpartBefore, counterpartAfter, counterpart);

const viewPayload = jsonCommand([
  '--yes', 'eas-cli@21.0.2', 'update:view', published.group, '--json',
], `${platform} staged preview update`);
const updateEvidence = validateStagedPreviewPublication(combineUpdateViewPayloads([viewPayload]), {
  branch: channel.branch,
  platform,
  runtimeVersion,
  group: published.group,
  commitSha: fullSha,
});
if (platform === 'ios' && !counterpartAfter.message.includes(shortSha)) {
  throw new Error('iOS preview publication blocked because Android has not accepted this source SHA.');
}

console.log(JSON.stringify({
  published: true,
  repositorySha: fullSha,
  channel,
  update: updateEvidence,
  counterpart: unchanged,
}));
