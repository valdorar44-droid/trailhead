import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assertAuthoritativeWorktreeClean } from './release-worktree.mjs';
import { validateReleaseEnvironment } from './release-environment.mjs';
import { validateChannelPromotion, validatePairedUpdatePublication } from './eas-update-evidence.mjs';

const target = String(process.argv[2] || '').trim().toLowerCase();
const dryRun = process.argv.includes('--dry-run');

if (!['preview', 'production'].includes(target)) {
  console.error('Usage: node scripts/publish-eas-update.mjs <preview|production> [--dry-run]');
  process.exit(2);
}

function commandName(name) {
  return process.platform === 'win32' && name === 'npx' ? 'npx.cmd' : name;
}

function run(command, args, options = {}) {
  const result = spawnSync(commandName(command), args, {
    cwd: new URL('..', import.meta.url),
    env: process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  if (!options.capture) return '';
  const output = String(result.stdout || '');
  return options.raw ? output : output.trim();
}

function assertCommittedReleaseSource() {
  const status = run('git', [
    '-C', '..',
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ], { capture: true, raw: true });
  try {
    assertAuthoritativeWorktreeClean(status);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

// `mobile/` contains Expo's local metadata repository without a commit. Bind
// release evidence to the authoritative Trailhead repository one level up.
const shortSha = run('git', ['-C', '..', 'rev-parse', '--short=8', 'HEAD'], { capture: true });
const fullSha = run('git', ['-C', '..', 'rev-parse', 'HEAD'], { capture: true });
// Embed the exact authoritative source revision in the update manifest so the
// on-device QA snapshot can be matched to release evidence without user data.
process.env.EXPO_PUBLIC_RELEASE_COMMIT_SHA = fullSha;
if (!String(process.env.EXPO_PUBLIC_BRANCH_CONFIGURED || '').trim()) {
  process.env.EXPO_PUBLIC_BRANCH_CONFIGURED = 'true';
}
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const appConfig = require('../app.config.js').expo;
const defaultMessage = `Trailhead ${packageJson.version} ${target} ${shortSha}`;
const requestedMessage = String(process.env.EAS_UPDATE_MESSAGE || defaultMessage).trim();
const message = requestedMessage.includes(shortSha) ? requestedMessage : `${requestedMessage} (${shortSha})`;
const candidateBranch = `${target}-candidate-${fullSha}`;

function requiredProductionValue(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    console.error(`Production OTA blocked. Missing paired-build evidence: ${name}.`);
    process.exit(2);
  }
  return value;
}

function assertProductionApproval() {
  if (process.env.TRAILHEAD_ALLOW_PRODUCTION_OTA !== 'YES') {
    console.error('Production OTA blocked. Set TRAILHEAD_ALLOW_PRODUCTION_OTA=YES only in the protected production environment.');
    process.exit(2);
  }
  const githubRef = String(process.env.GITHUB_REF || '').trim();
  const localBranch = githubRef ? '' : run('git', ['-C', '..', 'branch', '--show-current'], { capture: true });
  const tagsAtHead = githubRef || localBranch
    ? ''
    : run('git', ['-C', '..', 'tag', '--points-at', 'HEAD'], { capture: true });
  const approvedRef = githubRef === 'refs/heads/main'
    || githubRef.startsWith('refs/tags/')
    || localBranch === 'main'
    || Boolean(tagsAtHead);
  if (!approvedRef) {
    console.error('Production OTA blocked. Publish only from main or an immutable tag.');
    process.exit(2);
  }

  const androidSha = requiredProductionValue('TRAILHEAD_ANDROID_PRODUCTION_BUILD_SHA');
  const iosSha = requiredProductionValue('TRAILHEAD_IOS_PRODUCTION_BUILD_SHA');
  if (androidSha !== fullSha || iosSha !== fullSha) {
    console.error(`Production OTA blocked. Both production build SHAs must equal ${fullSha}.`);
    process.exit(2);
  }
  requiredProductionValue('TRAILHEAD_ANDROID_PRODUCTION_BUILD_ID');
  requiredProductionValue('TRAILHEAD_IOS_PRODUCTION_BUILD_ID');

  const androidRuntime = requiredProductionValue('TRAILHEAD_ANDROID_PRODUCTION_RUNTIME');
  const iosRuntime = requiredProductionValue('TRAILHEAD_IOS_PRODUCTION_RUNTIME');
  if (androidRuntime !== appConfig.android.runtimeVersion || iosRuntime !== appConfig.ios.runtimeVersion) {
    console.error('Production OTA blocked. Paired build runtime evidence does not match app.config.js.');
    process.exit(2);
  }
  run(process.execPath, ['scripts/verify-eas-build-evidence.mjs']);
}

if (!dryRun) assertCommittedReleaseSource();
if (!dryRun) validateReleaseEnvironment(process.env);
if (target === 'production' && !dryRun) assertProductionApproval();

const updateArgs = [
  '--yes', 'eas-cli@21.0.2', 'update',
  '--branch', candidateBranch,
  '--platform', 'all',
  '--message', message,
  '--environment', target,
  '--input-dir', 'dist',
  '--skip-bundler',
  '--emit-metadata',
  '--json',
  '--non-interactive',
];

if (dryRun) {
  console.log(JSON.stringify({
    target,
    candidateBranch,
    channel: target,
    message,
    platform: 'all',
    repository_sha: fullSha,
    source_maps: true,
  }));
  process.exit(0);
}

run(process.execPath, ['scripts/upload-sentry-update-sourcemaps.mjs', '--check-env']);
run('npx', [
  '--yes', 'expo', 'export',
  '--platform', 'all',
  '--output-dir', 'dist',
  '--source-maps',
  '--clear',
  '--max-workers', '2',
]);
// Upload the exact exported artifacts first. If Sentry rejects any map, no OTA
// has been published and the current candidate remains untouched.
run(process.execPath, ['scripts/upload-sentry-update-sourcemaps.mjs']);
const updateOutput = run('npx', updateArgs, { capture: true });
let updatePayload;
try {
  updatePayload = JSON.parse(updateOutput);
} catch {
  throw new Error('EAS update publication returned invalid JSON evidence.');
}
const updateEvidence = validatePairedUpdatePublication(updatePayload, {
  branch: candidateBranch,
  commitSha: fullSha,
  androidRuntime: appConfig.android.runtimeVersion,
  iosRuntime: appConfig.ios.runtimeVersion,
});
// Candidate updates are invisible to the installed-app channel until both
// platform records pass the SHA/runtime evidence checks above. Promotion is a
// single channel-pointer change, so a partial update can never become live.
run('npx', [
  '--yes', 'eas-cli@21.0.2', 'channel:edit', target,
  '--branch', candidateBranch,
  '--json',
  '--non-interactive',
], { capture: true });
const channelViewOutput = run('npx', [
  '--yes', 'eas-cli@21.0.2', 'channel:view', target,
  '--json',
  '--non-interactive',
], { capture: true });
let channelViewPayload;
try {
  channelViewPayload = JSON.parse(channelViewOutput);
} catch {
  throw new Error('EAS channel promotion returned invalid JSON evidence.');
}
const promotionEvidence = validateChannelPromotion(channelViewPayload, {
  branch: candidateBranch,
  channel: target,
});
console.log(JSON.stringify({
  published: true,
  repositorySha: fullSha,
  target,
  candidateBranch,
  promotion: promotionEvidence,
  ...updateEvidence,
}));
