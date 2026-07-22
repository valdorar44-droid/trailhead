#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const requireExternal = process.argv.includes('--require-external-config');
const failures = [];
const warnings = [];

function source(path) {
  return readFileSync(join(mobileRoot, path), 'utf8');
}

function repoSource(path) {
  return readFileSync(join(mobileRoot, '..', path), 'utf8');
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function contains(path, value, message) {
  expect(source(path).includes(value), message);
}

const pkg = JSON.parse(source('package.json'));
const lockRoot = JSON.parse(source('package-lock.json')).packages?.[''];
const config = require(join(mobileRoot, 'app.config.js')).expo;
const androidManifest = source('android/app/src/main/AndroidManifest.xml');
const androidGradle = source('android/app/build.gradle');
const iosInfo = source('ios/Trailhead/Info.plist');
const iosProject = source('ios/Trailhead.xcodeproj/project.pbxproj');
const iosEntitlements = source('ios/Trailhead/Trailhead.entitlements');

expect(pkg.version === '1.0.10', 'package.json must use marketing version 1.0.10.');
expect(lockRoot?.version === '1.0.10', 'package-lock.json root version must use 1.0.10.');
expect(config.version === '1.0.10', 'app.config.js must use marketing version 1.0.10.');
expect(config.ios.runtimeVersion === 'native-1.0.10-ios.1', 'iOS runtime is not native-1.0.10-ios.1.');
expect(config.android.runtimeVersion === 'native-1.0.10-android.1', 'Android runtime is not native-1.0.10-android.1.');
expect(pkg.dependencies.expo === '~54.0.36', 'Expo must remain pinned to ~54.0.36.');
expect(pkg.dependencies['expo-updates'] === '~29.0.19', 'Expo Updates must remain pinned to ~29.0.19.');
expect(pkg.dependencies['expo-sqlite'] === '~16.0.10', 'Expo SQLite must remain pinned to ~16.0.10.');
expect(pkg.dependencies['@sentry/react-native'] === '~7.2.0', 'Sentry must remain pinned to ~7.2.0.');
expect(pkg.dependencies['react-native-branch'] === '6.10.0', 'Branch must remain pinned to 6.10.0.');
expect(!pkg.dependencies['expo-modules-core'], 'Do not restore direct expo-modules-core dependency.');
expect(!lockRoot?.dependencies?.['expo-modules-core'], 'package-lock.json restored direct expo-modules-core dependency.');

expect(!/LocationTaskService[^>]*tools:node="remove"/.test(androidManifest), 'Android removes Expo LocationTaskService.');
expect(/ACCESS_BACKGROUND_LOCATION" tools:node="remove"/.test(androidManifest), 'Android must continue blocking ACCESS_BACKGROUND_LOCATION.');
expect(androidManifest.includes('.car.TrailheadCarAppService'), 'Android Auto CarAppService is missing.');
expect(androidManifest.includes('androidx.car.app.category.NAVIGATION'), 'Android Auto navigation category is missing.');
expect(androidManifest.includes('com.android.vending.INSTALL_REFERRER'), 'Play Install Referrer permission is missing.');
expect(!androidManifest.includes('com.google.android.gms.permission.AD_ID'), 'Advertising ID permission must not be present.');
expect(androidManifest.includes('${googleMapsApiKey}'), 'Google Maps key must use an environment-backed manifest placeholder.');
expect(!/AIza[0-9A-Za-z_-]{20,}/.test(androidManifest), 'A Google API key is committed in AndroidManifest.xml.');
for (const pathPrefix of ['/originals', '/app', '/r', '/support', '/trips', '/prizes', '/verify-email']) {
  expect(androidManifest.includes(`android:pathPrefix="${pathPrefix}"`), `Android app-link path is missing: ${pathPrefix}`);
}
expect(!androidManifest.includes('android:pathPrefix="/reset-password"'), 'Password-reset web forms must not be captured by Android.');
expect(androidGradle.includes('versionName "1.0.10"'), 'Android versionName is not 1.0.10.');
expect(androidGradle.includes('androidx.car.app:app-projected:1.7.0'), 'Android Auto projected dependency changed or is missing.');
expect(androidGradle.includes('@sentry/react-native/package.json'), 'Android Sentry source-map wiring is missing.');
contains('android/app/src/main/res/values/strings.xml', 'native-1.0.10-android.1', 'Android native runtime resource is stale.');

expect(iosInfo.includes('<string>1.0.10</string>'), 'iOS Info.plist marketing version is stale.');
expect(iosInfo.includes('<string>Automatic</string>'), 'iOS appearance must follow the app theme.');
expect(iosInfo.includes('BarlowCondensed-SemiBold.ttf') && iosInfo.includes('BarlowCondensed-Bold.ttf'), 'iOS font registration is incomplete.');
expect(iosInfo.includes('branch_key_not_configured'), 'Tracked iOS Branch key must remain an explicit non-secret placeholder.');
expect(iosProject.match(/MARKETING_VERSION = 1\.0\.10;/g)?.length === 2, 'Xcode marketing versions are not both 1.0.10.');
expect(iosProject.includes('Branch.json in Resources'), 'Branch NativeLink configuration is not bundled.');
expect(iosEntitlements.includes('applinks:gettrailhead.app'), 'iOS gettrailhead.app associated domain is missing.');
expect(iosEntitlements.includes('applinks:go.gettrailhead.app'), 'iOS Branch associated domain is missing.');
for (const domain of ['zswub.app.link', 'zswub-alternate.app.link']) {
  expect(
    iosEntitlements.includes(`applinks:${domain}`),
    `iOS Branch-provided associated domain is missing: ${domain}`,
  );
  expect(
    androidManifest.includes(`android:host="${domain}"`),
    `Android Branch-provided App Link domain is missing: ${domain}`,
  );
}
expect(!iosEntitlements.includes('com.apple.developer.carplay'), 'Do not claim CarPlay without an approved entitlement.');
const appleAssociation = JSON.parse(repoSource('dashboard/site/public/.well-known/apple-app-site-association'));
const applePaths = appleAssociation?.applinks?.details?.[0]?.paths ?? [];
const siteProxyWorker = repoSource('cloudflare/site-proxy-worker/src/worker.js');
for (const pathPattern of ['/originals/*', '/app/*', '/r/*', '/support/*', '/trips/*', '/prizes/*', '/verify-email*']) {
  expect(applePaths.includes(pathPattern), `Apple association path is missing: ${pathPattern}`);
  expect(siteProxyWorker.includes(`'${pathPattern}'`), `Cloudflare association path is missing: ${pathPattern}`);
}
expect(!applePaths.some(path => String(path).startsWith('/reset-password')), 'Password-reset web forms must not be captured by iOS.');
contains('ios/Trailhead/Supporting/Expo.plist', 'native-1.0.10-ios.1', 'iOS native runtime resource is stale.');
contains('ios/Trailhead/Branch.json', '"checkPasteboardOnInstall": true', 'Branch NativeLink pasteboard setting is missing.');
contains('.gitignore', '*.mobileprovision', 'Mobile provisioning profiles must stay ignored.');
expect(!source('.gitignore').split(/\r?\n/).includes('/ios/'), 'The authoritative iOS project is still ignored.');

for (const font of ['assets/fonts/BarlowCondensed-SemiBold.ttf', 'assets/fonts/BarlowCondensed-Bold.ttf']) {
  expect(statSync(join(mobileRoot, font)).size > 10_000, `${font} is missing or truncated.`);
}
contains('assets/fonts/OFL.txt', 'SIL OPEN FONT LICENSE', 'Barlow Condensed OFL license is missing.');
contains('metro.config.js', 'includeWebReplay: false', 'Sentry Metro config must exclude Session Replay.');
contains('lib/telemetry/sentry.ts', 'sendDefaultPii: false', 'Sentry must keep default PII collection disabled.');
contains('lib/telemetry/sentry.ts', 'beforeSendTransaction:', 'Sentry performance transactions must pass the privacy scrubber.');
expect(!source('lib/telemetry/sentry.ts').includes('replayIntegration('), 'Sentry Session Replay must not be enabled.');
const branchAttribution = source('lib/referrals/branchAttribution.ts');
expect(!branchAttribution.includes('.setIdentity('), 'Branch must not receive Trailhead account identity.');
expect(!branchAttribution.includes('.logEvent('), 'Branch purchase or behavioral events must not be emitted.');
expect(!branchAttribution.includes('.userCompletedAction('), 'Branch custom behavioral events must not be emitted.');
contains('scripts/prepare-eas-native-env.mjs', 'BRANCH_API_KEY', 'EAS native environment validation is missing.');
for (const path of ['app/(tabs)/plan.tsx', 'lib/connectivitySync.ts']) {
  const weatherWriter = source(path);
  expect(
    weatherWriter.includes('routeWeatherCacheFileName')
      && weatherWriter.includes('routeWeatherCacheEnvelope'),
    `${path} must write the route-weather cache format consumed by Map.`,
  );
  expect(!weatherWriter.includes('weather_${'), `${path} restored the unread legacy weather cache.`);
}
expect(
  source('lib/store.ts').includes('route_weather_v2_'),
  'Account cleanup must remove route-weather cache envelopes.',
);
expect(pkg.scripts['build:all'].includes('eas-cli@21.0.2'), 'Paired preview builds must pin EAS CLI 21.0.2.');
expect(pkg.scripts.ota.includes('--check-env'), 'Preview OTA must validate Sentry credentials before publishing.');
expect(
  source('app.config.js').includes('EXPO_PUBLIC_BRANCH_CONFIGURED'),
  'OTA configuration must use a non-secret Branch capability flag.',
);

const external = [
  'BRANCH_API_KEY',
  'EXPO_PUBLIC_SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'GOOGLE_MAPS_API_KEY',
];
for (const name of external) {
  if (!String(process.env[name] || '').trim()) warnings.push(`Missing external build value: ${name}`);
}

if (warnings.length) {
  console.warn(warnings.map(message => `WARN: ${message}`).join('\n'));
  if (requireExternal) failures.push('Required EAS build values are not configured.');
}
if (failures.length) {
  console.error(failures.map(message => `FAIL: ${message}`).join('\n'));
  process.exit(1);
}
console.log('Native/config drift checks passed.');
