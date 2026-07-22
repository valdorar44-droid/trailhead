#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const required = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];
const missing = required.filter(name => !String(process.env[name] || '').trim());
if (missing.length) {
  throw new Error(`Cannot upload OTA source maps. Missing: ${missing.join(', ')}`);
}
if (process.argv.includes('--check-env')) {
  console.log('Sentry release environment is ready.');
  process.exit(0);
}
if (!existsSync(join(mobileRoot, 'dist'))) {
  throw new Error('Cannot upload OTA source maps because the Expo dist directory is missing.');
}

const cli = join(mobileRoot, 'node_modules', '.bin', process.platform === 'win32'
  ? 'sentry-expo-upload-sourcemaps.cmd'
  : 'sentry-expo-upload-sourcemaps');
const result = spawnSync(cli, ['dist'], {
  cwd: mobileRoot,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.status !== 0) process.exit(result.status || 1);
