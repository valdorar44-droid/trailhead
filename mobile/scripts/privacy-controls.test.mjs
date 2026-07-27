#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(mobileRoot, path), 'utf8');

const appConfig = read('app.config.js');
const easConfig = JSON.parse(read('eas.json'));
const rootLayout = read('app/_layout.tsx');
const store = read('lib/store.ts');
const mapboxPrivacy = read('lib/privacy/mapboxTelemetry.native.ts');
const mapboxPrivacyWeb = read('lib/privacy/mapboxTelemetry.web.ts');
const branchAttribution = read('lib/referrals/branchAttribution.ts');
const profile = read('app/(tabs)/profile.tsx');

assert.match(
  appConfig,
  /EXPO_PUBLIC_BRANCH_ATTRIBUTION_ENABLED \|\| 'false'/,
  'Third-party deferred referral attribution must remain disabled by default.',
);
assert.equal(
  easConfig.build.preview.env.EXPO_PUBLIC_BRANCH_ATTRIBUTION_ENABLED,
  'false',
  'Preview builds must not override Branch attribution back on.',
);
assert.equal(
  easConfig.build.production.env.EXPO_PUBLIC_BRANCH_ATTRIBUTION_ENABLED,
  'false',
  'Production builds must not override Branch attribution back on.',
);
assert.match(branchAttribution, /const effectiveEnabled = enabled && branchConfig\(\)\.enabled/);
assert.match(branchAttribution, /branch\?\.disableTracking\(!effectiveEnabled\)/);
assert.match(profile, /referralAttributionIsAvailable\(\) &&/);

assert.match(mapboxPrivacy, /setTelemetryEnabled\(false\)/);
assert.doesNotMatch(mapboxPrivacy, /setTelemetryEnabled\(true\)/);
assert.doesNotMatch(rootLayout, /disableNonessentialMapboxTelemetry\(/);
assert.match(store, /disableNonessentialMapboxTelemetry\(token\)/);
assert.match(mapboxPrivacy, /setAccessToken\(token\)[\s\S]*setTelemetryEnabled\(false\)/);
assert.doesNotMatch(mapboxPrivacyWeb, /@rnmapbox\/maps/);

console.log('Nonessential third-party collection controls passed.');
