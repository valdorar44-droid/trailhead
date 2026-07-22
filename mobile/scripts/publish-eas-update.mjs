import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const target = String(process.argv[2] || '').trim().toLowerCase();
const dryRun = process.argv.includes('--dry-run');

if (!['preview', 'production'].includes(target)) {
  console.error('Usage: node scripts/publish-eas-update.mjs <preview|production> [--dry-run]');
  process.exit(2);
}

if (target === 'production' && !dryRun && process.env.TRAILHEAD_ALLOW_PRODUCTION_OTA !== 'YES') {
  console.error('Production OTA blocked. Set TRAILHEAD_ALLOW_PRODUCTION_OTA=YES only after paired production approval.');
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
  return options.capture ? String(result.stdout || '').trim() : '';
}

// `mobile/` contains Expo's local metadata repository without a commit. Bind
// release evidence to the authoritative Trailhead repository one level up.
const shortSha = run('git', ['-C', '..', 'rev-parse', '--short=8', 'HEAD'], { capture: true });
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const defaultMessage = `Trailhead ${packageJson.version} ${target} ${shortSha}`;
const message = String(process.env.EAS_UPDATE_MESSAGE || defaultMessage).trim();

const updateArgs = [
  '--yes', 'eas-cli@21.0.2', 'update',
  '--channel', target,
  '--platform', 'all',
  '--message', message,
  '--non-interactive',
];

if (dryRun) {
  console.log(JSON.stringify({ target, message, platform: 'all', source_maps: true }));
  process.exit(0);
}

run(process.execPath, ['scripts/upload-sentry-update-sourcemaps.mjs', '--check-env']);
run('npx', updateArgs);
run(process.execPath, ['scripts/upload-sentry-update-sourcemaps.mjs']);
