#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkFilesOnly = process.argv.includes('--check-files');
const inputDirIndex = process.argv.indexOf('--input-dir');
if (inputDirIndex >= 0 && !String(process.argv[inputDirIndex + 1] || '').trim()) {
  throw new Error('Cannot upload OTA source maps. --input-dir requires a directory.');
}
const inputDirArgument = inputDirIndex >= 0
  ? String(process.argv[inputDirIndex + 1]).trim()
  : 'dist';
const inputDir = resolve(mobileRoot, inputDirArgument);
const relativeInputDir = relative(mobileRoot, inputDir);
if (!relativeInputDir || relativeInputDir === '..' || relativeInputDir.startsWith(`..${sep}`) || isAbsolute(relativeInputDir)) {
  throw new Error('Cannot upload OTA source maps outside the mobile project.');
}
const required = ['EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];
const missing = checkFilesOnly ? [] : required.filter(name => !String(process.env[name] || '').trim());
if (missing.length) {
  throw new Error(`Cannot upload OTA source maps. Missing: ${missing.join(', ')}`);
}
if (process.argv.includes('--check-env')) {
  console.log('Sentry release environment is ready.');
  process.exit(0);
}
if (!existsSync(inputDir)) {
  throw new Error(`Cannot upload OTA source maps because ${relativeInputDir} is missing.`);
}

function assetGroups(directory, groups = new Map()) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      assetGroups(path, groups);
      continue;
    }
    if (!entry.isFile() || !/\.(?:js|hbc|map)$/.test(entry.name)) continue;
    const key = path.endsWith('.map') ? path.slice(0, -4) : path;
    const group = groups.get(key) || { bundle: false, map: false };
    if (path.endsWith('.map')) group.map = true;
    else group.bundle = true;
    groups.set(key, group);
  }
  return groups;
}

const groups = assetGroups(inputDir);
const incomplete = [...groups.entries()].filter(([, files]) => files.bundle && !files.map);
if (!groups.size || incomplete.length) {
  throw new Error(`Cannot upload OTA source maps: ${incomplete.length || 'no'} bundle group(s) lack a source map.`);
}
if (checkFilesOnly) {
  console.log(`Expo source-map export is complete (${groups.size} bundle groups).`);
  process.exit(0);
}

const cli = join(mobileRoot, 'node_modules', '.bin', process.platform === 'win32'
  ? 'sentry-expo-upload-sourcemaps.cmd'
  : 'sentry-expo-upload-sourcemaps');
const result = spawnSync(cli, [relativeInputDir], {
  cwd: mobileRoot,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.status !== 0) process.exit(result.status || 1);
