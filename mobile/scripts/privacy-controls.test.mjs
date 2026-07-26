#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(mobileRoot, path), 'utf8');

const appConfig = read('app.config.js');
const rootLayout = read('app/_layout.tsx');
const mapboxPrivacy = read('lib/privacy/mapboxTelemetry.ts');
const branchAttribution = read('lib/referrals/branchAttribution.ts');
const profile = read('app/(tabs)/profile.tsx');

assert.match(
  appConfig,
  /EXPO_PUBLIC_BRANCH_ATTRIBUTION_ENABLED \|\| 'false'/,
  'Third-party deferred referral attribution must remain disabled by default.',
);
assert.match(branchAttribution, /const effectiveEnabled = enabled && branchConfig\(\)\.enabled/);
assert.match(branchAttribution, /branch\?\.disableTracking\(!effectiveEnabled\)/);
assert.match(profile, /referralAttributionIsAvailable\(\) &&/);

assert.match(mapboxPrivacy, /setTelemetryEnabled\(false\)/);
assert.doesNotMatch(mapboxPrivacy, /setTelemetryEnabled\(true\)/);
assert.match(rootLayout, /disableNonessentialMapboxTelemetry\(\)/);

console.log('Nonessential third-party collection controls passed.');
