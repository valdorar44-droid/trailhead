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
const androidMainApplication = source('android/app/src/main/java/com/trailhead/app/MainApplication.kt');
const androidMainActivity = source('android/app/src/main/java/com/trailhead/app/MainActivity.kt');
const iosInfo = source('ios/Trailhead/Info.plist');
const iosProject = source('ios/Trailhead.xcodeproj/project.pbxproj');
const iosEntitlements = source('ios/Trailhead/Trailhead.entitlements');
const iosAppDelegate = source('ios/Trailhead/AppDelegate.swift');
const branchAndroidApplicationAdapter = source('node_modules/@config-plugins/react-native-branch/android/src/main/java/expo/modules/adapters/branch/BranchApplicationLifecycleListener.kt');
const branchAndroidActivityAdapter = source('node_modules/@config-plugins/react-native-branch/android/src/main/java/expo/modules/adapters/branch/BranchReactActivityLifecycleListener.kt');
const branchIosAppDelegateAdapter = source('node_modules/@config-plugins/react-native-branch/ios/ExpoAdapterBranch/BranchAppDelegate.swift');
const otaPublisher = source('scripts/publish-eas-update.mjs');
const prePreviewCheck = source('scripts/pre-preview-check.mjs');
const otaWorkflow = repoSource('.github/workflows/mobile-ota.yml');
const ciWorkflow = repoSource('.github/workflows/ci.yml');
const easConfig = JSON.parse(source('eas.json'));

function workflowJobSource(workflow, jobName) {
  const escapedJobName = jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = workflow.match(
    new RegExp(
      `^  ${escapedJobName}:\\s*\\r?\\n[\\s\\S]*?(?=^  [A-Za-z0-9_-]+:\\s*\\r?\\n|(?![\\s\\S]))`,
      'm',
    ),
  );
  return match?.[0] ?? '';
}

const ciTriggerSource = ciWorkflow.slice(0, ciWorkflow.indexOf('\npermissions:'));
const mobileCiJob = workflowJobSource(ciWorkflow, 'mobile');
const androidNativeCiJob = workflowJobSource(ciWorkflow, 'android-native');

expect(pkg.version === '1.0.10', 'package.json must use marketing version 1.0.10.');
expect(lockRoot?.version === '1.0.10', 'package-lock.json root version must use 1.0.10.');
expect(config.version === '1.0.10', 'app.config.js must use marketing version 1.0.10.');
expect(config.ios.runtimeVersion === 'native-1.0.10-ios.3', 'iOS runtime is not native-1.0.10-ios.3.');
expect(config.android.runtimeVersion === 'native-1.0.10-android.3', 'Android runtime is not native-1.0.10-android.3.');
expect(pkg.dependencies.expo === '~54.0.36', 'Expo must remain pinned to ~54.0.36.');
expect(pkg.dependencies['expo-updates'] === '~29.0.19', 'Expo Updates must remain pinned to ~29.0.19.');
expect(pkg.dependencies['expo-sqlite'] === '~16.0.10', 'Expo SQLite must remain pinned to ~16.0.10.');
expect(pkg.dependencies['@sentry/react-native'] === '~7.2.0', 'Sentry must remain pinned to ~7.2.0.');
expect(pkg.dependencies['@config-plugins/react-native-branch'] === '11.0.0', 'Branch Expo adapter must remain pinned to 11.0.0.');
expect(pkg.dependencies['react-native-branch'] === '6.10.0', 'Branch must remain pinned to 6.10.0.');
expect(
  !pkg.expo?.autolinking?.exclude?.includes('@config-plugins/react-native-branch'),
  'ExpoAdapterBranch must remain in the native autolinking graph.',
);
expect(!pkg.dependencies['expo-modules-core'], 'Do not restore direct expo-modules-core dependency.');
expect(!lockRoot?.dependencies?.['expo-modules-core'], 'package-lock.json restored direct expo-modules-core dependency.');
expect(
  prePreviewCheck.includes("join(homedir(), 'android-sdk')")
    && prePreviewCheck.includes('ANDROID_HOME: androidHome')
    && prePreviewCheck.includes('ANDROID_SDK_ROOT: androidHome'),
  'The clean-worktree pre-preview gate must discover and export the Android SDK.',
);
expect(
  prePreviewCheck.includes("label: 'Isolated backend schema'")
    && prePreviewCheck.includes('TRAILHEAD_DB_PATH: prepreviewDbPath')
    && prePreviewCheck.includes('from db.store import init_db; init_db()'),
  'The clean-worktree pre-preview gate must initialize an isolated backend schema.',
);

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
expect(
  branchAndroidApplicationAdapter.includes('RNBranchModule.getAutoInstance(this.context)'),
  'Android Branch Expo adapter application initialization is missing.',
);
expect(
  branchAndroidActivityAdapter.includes('RNBranchModule.initSession(activity.getIntent().getData(), activity)')
    && branchAndroidActivityAdapter.includes('RNBranchModule.onNewIntent(intent)'),
  'Android Branch Expo adapter activity forwarding is incomplete.',
);
expect(
  !androidMainApplication.includes('RNBranchModule') && !androidMainActivity.includes('RNBranchModule'),
  'Do not duplicate Branch Expo adapter callbacks in Android app classes.',
);
contains('android/app/src/main/res/values/strings.xml', 'native-1.0.10-android.3', 'Android native runtime resource is stale.');

expect(iosInfo.includes('<string>1.0.10</string>'), 'iOS Info.plist marketing version is stale.');
expect(iosInfo.includes('<string>Automatic</string>'), 'iOS appearance must follow the app theme.');
expect(iosInfo.includes('BarlowCondensed-SemiBold.ttf') && iosInfo.includes('BarlowCondensed-Bold.ttf'), 'iOS font registration is incomplete.');
expect(iosInfo.includes('branch_key_not_configured'), 'Tracked iOS Branch key must remain an explicit non-secret placeholder.');
expect(iosProject.match(/MARKETING_VERSION = 1\.0\.10;/g)?.length === 2, 'Xcode marketing versions are not both 1.0.10.');
expect(iosProject.includes('Branch.json in Resources'), 'Branch NativeLink configuration is not bundled.');
expect(
  branchIosAppDelegateAdapter.includes('RNBranch.initSession(launchOptions: launchOptions, isReferrable: true)')
    && branchIosAppDelegateAdapter.includes('RNBranch.application(application, open:url, options:options)')
    && branchIosAppDelegateAdapter.includes('RNBranch.continue(userActivity)'),
  'iOS Expo AppDelegateSubscriber Branch forwarding is incomplete.',
);
expect(!iosAppDelegate.includes('import RNBranch'), 'Do not duplicate Expo AppDelegateSubscriber Branch callbacks.');
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
contains('ios/Trailhead/Supporting/Expo.plist', 'native-1.0.10-ios.3', 'iOS native runtime resource is stale.');
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
contains('lib/telemetry/sentry.ts', 'maxBreadcrumbs: 0', 'Sentry breadcrumbs must remain disabled.');
contains('lib/telemetry/sentry.ts', 'enableNative: false', 'Native Sentry delivery must remain disabled until native allowlisting exists.');
contains('lib/telemetry/sentry.ts', 'tracesSampler:', 'Telemetry must use the deterministic QA-aware trace sampler.');
contains('lib/telemetry/sampling.ts', "transactionName === QA_PERFORMANCE_TRANSACTION ? 1", 'The fixed QA performance transaction must be sampled at 100%.');
contains('lib/telemetry/sanitize.ts', 'Construct a new event from a narrow allowlist', 'Sentry must use the reviewed payload allowlist.');
expect(!source('lib/telemetry/sentry.ts').includes('replayIntegration('), 'Sentry Session Replay must not be enabled.');
contains('lib/telemetry/qaPolicy.ts', "facts.channel !== 'preview'", 'Telemetry QA must fail closed outside preview.');
contains('lib/telemetry/qaPolicy.ts', '!facts.isAdmin', 'Telemetry QA must require admin authorization.');
contains('lib/telemetry/qaPolicy.ts', '!facts.isAndroidEmulator', 'Native-crash QA must remain emulator-only.');
expect(
  easConfig.build?.preview?.env?.EXPO_PUBLIC_TELEMETRY_QA_ENABLED === 'true'
    && easConfig.build?.production?.env?.EXPO_PUBLIC_TELEMETRY_QA_ENABLED === 'false',
  'Telemetry QA must be enabled only in preview builds.',
);
expect(
  otaWorkflow.includes('EXPO_PUBLIC_TELEMETRY_QA_ENABLED: "true"')
    && otaWorkflow.includes('EXPO_PUBLIC_TELEMETRY_QA_ENABLED: "false"'),
  'Telemetry QA must be enabled only in preview updates.',
);
const branchAttribution = source('lib/referrals/branchAttribution.ts');
expect(!branchAttribution.includes('.setIdentity('), 'Branch must not receive Trailhead account identity.');
expect(!branchAttribution.includes('.logEvent('), 'Branch purchase or behavioral events must not be emitted.');
expect(!branchAttribution.includes('.userCompletedAction('), 'Branch custom behavioral events must not be emitted.');
contains('lib/referrals/referralLinks.ts', 'TRAILHEAD_HTTPS_HOSTS', 'Referral URL parsing must enforce trusted Trailhead hosts.');
contains('lib/referrals/referralLinks.ts', 'APPROVED_CUSTOM_ROUTES', 'Referral URL parsing must enforce approved custom routes.');
expect(
  repoSource('config/settings.py').includes('"BRANCH_REFERRAL_HANDOFF_ENABLED", "false"'),
  'Branch server handoff must remain disabled by default.',
);
expect(
  repoSource('.env.example').includes('BRANCH_REFERRAL_HANDOFF_ENABLED=false'),
  'Example configuration must keep Branch handoff disabled.',
);
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
expect(
  pkg.scripts.ota.includes('publish-eas-update.mjs preview'),
  'Preview OTA must use the guarded publisher.',
);
expect(
  pkg.scripts['ota:production'].includes('publish-eas-update.mjs production'),
  'Production OTA must use the guarded publisher.',
);
contains('app.config.js', 'resolveReleaseCommitSha(process.env)', 'App config must use the reviewed release identity resolver.');
contains('scripts/release-identity.cjs', 'EAS_BUILD_GIT_COMMIT_HASH', 'Release identity must prefer the EAS source SHA.');
contains('scripts/release-identity.test.mjs', 'must outrank', 'Release identity precedence must be regression tested.');
  expect(
    otaPublisher.includes("['scripts/upload-sentry-update-sourcemaps.mjs', '--check-env']"),
    'Guarded publisher must validate Sentry credentials before publishing.',
  );
expect(
  otaPublisher.includes("'--skip-bundler'")
    && otaPublisher.includes("'--input-dir', 'dist'")
    && otaPublisher.includes("'--source-maps'")
    && otaPublisher.includes("'--max-workers', '2'"),
  'OTA publisher must publish the exact source-mapped export.',
);
expect(
  otaPublisher.lastIndexOf("['scripts/upload-sentry-update-sourcemaps.mjs']")
    < otaPublisher.lastIndexOf("run('npx', updateArgs, { capture: true })"),
  'Sentry source maps must upload successfully before OTA publication.',
);
  expect(
    otaPublisher.includes('assertCommittedReleaseSource()'),
    'Guarded publisher must reject uncommitted release source.',
  );
for (const evidence of [
  'TRAILHEAD_ALLOW_PRODUCTION_OTA',
  'TRAILHEAD_ANDROID_PRODUCTION_BUILD_SHA',
  'TRAILHEAD_IOS_PRODUCTION_BUILD_SHA',
  'TRAILHEAD_ANDROID_PRODUCTION_RUNTIME',
  'TRAILHEAD_IOS_PRODUCTION_RUNTIME',
]) {
  expect(otaPublisher.includes(evidence), `Guarded publisher is missing production evidence: ${evidence}`);
}
contains('scripts/publish-eas-update.mjs', 'verify-eas-build-evidence.mjs', 'Production publisher must query EAS build evidence.');
contains('scripts/eas-build-evidence.mjs', "build?.status === 'FINISHED'", 'Production build evidence must require completed builds.');
contains('scripts/eas-build-evidence.mjs', "build?.distribution === 'STORE'", 'Production build evidence must require store distributions.');
contains('scripts/eas-build-evidence.mjs', "build?.buildProfile === 'production'", 'Production build evidence must require the production profile.');
contains('scripts/publish-eas-update.mjs', 'validatePairedUpdatePublication', 'OTA publication must validate paired update evidence.');
contains('scripts/publish-eas-update.mjs', 'validateChannelPromotion', 'OTA publication must verify candidate-channel promotion.');
contains('scripts/publish-eas-update.mjs', "'--branch', candidateBranch", 'OTA publication must publish to a SHA candidate branch before promotion.');
contains('scripts/publish-eas-update.mjs', "'update:list'", 'OTA publication must query the server-owned candidate branch after publishing.');
contains('scripts/publish-eas-update.mjs', "'update:view'", 'OTA publication must verify server-owned update IDs before promotion.');
contains('scripts/publish-eas-update.mjs', 'randomBytes(12)', 'Each OTA attempt must use a unique immutable candidate branch.');
contains('scripts/eas-update-evidence.mjs', 'ambiguous ${platform}', 'OTA evidence must reject multiple matching candidate groups.');
contains('scripts/publish-eas-update.mjs', 'queryJsonWithRetry', 'OTA evidence reads must tolerate bounded EAS consistency delays.');
contains('scripts/publish-eas-update.mjs', 'record?.group === group', 'OTA group views must bind records to the selected candidate groups.');
contains('scripts/publish-eas-update.mjs', "'channel:edit', target", 'OTA publication must promote only after paired validation.');
contains('scripts/eas-update-evidence.mjs', "relevant.length !== 2", 'Paired OTA evidence must require Android and iOS records.');
contains('scripts/publish-eas-update.mjs', 'validateReleaseEnvironment(process.env,', 'OTA publication must require the complete release environment.');
contains('scripts/publish-eas-update.mjs', "requirePreviewQa: target === 'preview'", 'Preview OTA publication must require protected QA diagnostics.');
contains('scripts/upload-sentry-update-sourcemaps.mjs', 'EXPO_PUBLIC_SENTRY_DSN', 'Sentry delivery must require an application DSN.');
expect(!otaWorkflow.includes('- both'), 'OTA workflow must not offer a combined preview/production target.');
expect(
  otaWorkflow.includes('environment: mobile-preview') && otaWorkflow.includes('environment: mobile-production'),
  'OTA workflow must use separate preview and production environments.',
);
expect(
  otaWorkflow.includes('env:exec preview') && otaWorkflow.includes('env:exec production'),
  'OTA jobs must execute with their matching EAS environment.',
);
expect(
  (otaWorkflow.match(/EXPO_PUBLIC_BRANCH_CONFIGURED: "true"/g) || []).length === 2,
  'Both OTA jobs must preserve the native Branch capability bit.',
);
expect(
  (otaWorkflow.match(/RNMAPBOX_MAPS_DOWNLOAD_TOKEN:/g) || []).length === 4
    && (otaWorkflow.match(/Missing RNMAPBOX_MAPS_DOWNLOAD_TOKEN/g) || []).length === 2,
  'Both OTA jobs must provide and validate the Mapbox downloads token used by the Android pre-preview gate.',
);
expect(
  (otaWorkflow.match(/^          RNMAPBOX_MAPS_DOWNLOAD_TOKEN:/gm) || []).length === 4
    && !/^      RNMAPBOX_MAPS_DOWNLOAD_TOKEN:/m.test(otaWorkflow)
    && (otaWorkflow.match(/^          EXPO_TOKEN:/gm) || []).length === 4
    && !/^      EXPO_TOKEN:/m.test(otaWorkflow),
  'OTA credentials must be scoped to the protected publication step rather than the whole job.',
);
expect(
  (otaWorkflow.match(/publish-eas-update\.mjs/g) || []).length === 2,
  'Both OTA workflow jobs must use the guarded publisher.',
);
expect(
  otaWorkflow.includes('gh run list --workflow ci.yml') && otaWorkflow.includes('--commit "$GITHUB_SHA"'),
  'Production OTA must require successful CI for the exact release SHA.',
);
expect(
  /^  pull_request:\s*$/m.test(ciTriggerSource),
  'Normal CI must run for pull requests.',
);
expect(
  mobileCiJob.includes('npm run test:telemetry')
    && mobileCiJob.includes('npm run test:referrals')
    && mobileCiJob.includes('npm run test:app-links')
    && mobileCiJob.includes('npm run audit:native-drift'),
  'The normal mobile CI job must cover telemetry, referrals, app links, and native drift.',
);
expect(
  androidNativeCiJob.includes('./gradlew :app:testDebugUnitTest --no-daemon'),
  'The normal Android native CI job must run Android and Android Auto unit tests.',
);
expect(
  !/^    if:.*(?:github\.event_name|github\.ref|push)/m.test(androidNativeCiJob),
  'Android and Android Auto unit tests must not be restricted to push-only CI.',
);
expect(
  !ciTriggerSource.includes('pull_request_target:'),
  'CI must not expose repository secrets to fork code through pull_request_target.',
);
expect(
  androidNativeCiJob.includes(
    'RNMAPBOX_MAPS_DOWNLOAD_TOKEN: ${{ secrets.RNMAPBOX_MAPS_DOWNLOAD_TOKEN || secrets.MAPBOX_DOWNLOADS_TOKEN }}',
  )
    && !mobileCiJob.includes('RNMAPBOX_MAPS_DOWNLOAD_TOKEN:'),
  'The read-only Mapbox Maven credential must be scoped to the Android native job.',
);
const forkNativeBlock = androidNativeCiJob.indexOf('Enforce trusted-branch native test policy');
const nativeCheckout = androidNativeCiJob.indexOf('actions/checkout@v4');
expect(
  forkNativeBlock >= 0
    && androidNativeCiJob.includes("github.event_name == 'pull_request'")
    && androidNativeCiJob.includes('github.event.pull_request.head.repo.full_name != github.repository')
    && androidNativeCiJob.includes('Fork pull requests cannot receive repository secrets')
    && androidNativeCiJob.includes('exit 1')
    && forkNativeBlock < nativeCheckout,
  'Fork pull requests must fail explicitly before checkout and require a trusted-branch rerun.',
);
expect(
  androidNativeCiJob.includes('Validate Mapbox Maven credential')
    && androidNativeCiJob.includes('Configure RNMAPBOX_MAPS_DOWNLOAD_TOKEN or MAPBOX_DOWNLOADS_TOKEN')
    && androidNativeCiJob.includes('DOWNLOADS:READ'),
  'Trusted native CI must fail clearly when its read-only Mapbox Maven credential is missing.',
);
expect(
  source('app.config.js').includes('EXPO_PUBLIC_BRANCH_CONFIGURED'),
  'OTA configuration must use a non-secret Branch capability flag.',
);
expect(
  pkg.scripts['test:referrals'].includes('branch-native-lifecycle.test.mjs'),
  'Referral tests must cover native Branch lifecycle wiring.',
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
