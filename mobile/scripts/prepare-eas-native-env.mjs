#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const platform = String(process.env.EAS_BUILD_PLATFORM || '').toLowerCase();

if (platform !== 'android' && platform !== 'ios') {
  console.log('Native build environment preparation skipped outside EAS.');
  process.exit(0);
}

const required = [
  'BRANCH_API_KEY',
  'EXPO_PUBLIC_SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  ...(platform === 'android' ? ['GOOGLE_MAPS_API_KEY'] : []),
];
const missing = required.filter(name => !String(process.env[name] || '').trim());
if (missing.length) {
  throw new Error(`Missing EAS environment values for ${platform}: ${missing.join(', ')}`);
}

const branchKey = String(process.env.BRANCH_API_KEY).trim();
if (!/^key_(?:live|test)_[a-z0-9]+$/i.test(branchKey)) {
  throw new Error('BRANCH_API_KEY is not a valid Branch client key.');
}

if (platform === 'ios') {
  const infoPlistPath = join(mobileRoot, 'ios', 'Trailhead', 'Info.plist');
  const source = readFileSync(infoPlistPath, 'utf8');
  const branchKeyPattern = /(<key>live<\/key>\s*<string>)[^<]*(<\/string>)/;
  if (!branchKeyPattern.test(source)) {
    throw new Error('iOS Info.plist does not contain the expected Branch live-key entry.');
  }
  const escapedBranchKey = branchKey
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  writeFileSync(infoPlistPath, source.replace(branchKeyPattern, `$1${escapedBranchKey}$2`));
  console.log('Injected the Branch client key into the ephemeral iOS build workspace.');
}

console.log(`Native ${platform} build environment is complete.`);
