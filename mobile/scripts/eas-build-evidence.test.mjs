import assert from 'node:assert/strict';
import { validateProductionBuild, verifyPairedProductionBuilds } from './eas-build-evidence.mjs';

const sha = 'a'.repeat(40);
const base = {
  id: 'build-android',
  status: 'FINISHED',
  platform: 'ANDROID',
  distribution: 'STORE',
  buildProfile: 'production',
  channel: 'production',
  gitCommitHash: sha,
  runtimeVersion: 'native-1.0.10-android.1',
  appVersion: '1.0.10',
  appBuildVersion: '60',
  project: { id: 'project-1' },
  artifacts: { applicationArchiveUrl: 'https://example.test/app.aab' },
  fingerprint: { hash: 'native-fingerprint' },
};
const expected = {
  id: 'build-android',
  platform: 'ANDROID',
  commitSha: sha,
  runtimeVersion: 'native-1.0.10-android.1',
  appVersion: '1.0.10',
  projectId: 'project-1',
};

assert.equal(validateProductionBuild(base, expected).buildNumber, '60');
for (const [field, value, message] of [
  ['status', 'IN_QUEUE', /FINISHED/],
  ['distribution', 'INTERNAL', /store distribution/],
  ['buildProfile', 'preview', /profile/],
  ['channel', 'preview', /channel/],
  ['gitCommitHash', 'b'.repeat(40), /SHA/],
  ['runtimeVersion', 'wrong-runtime', /runtime/],
]) {
  assert.throws(() => validateProductionBuild({ ...base, [field]: value }, expected), message);
}

assert.throws(() => verifyPairedProductionBuilds({
  appConfig: {
    extra: { eas: { projectId: 'project-1' } },
    android: { runtimeVersion: 'native-1.0.10-android.1' },
    ios: { runtimeVersion: 'native-1.0.10-ios.1' },
  },
  packageJson: { version: '1.0.10' },
  environment: {
    EXPO_PUBLIC_RELEASE_COMMIT_SHA: 'b'.repeat(40),
    TRAILHEAD_ANDROID_PRODUCTION_BUILD_SHA: sha,
    TRAILHEAD_IOS_PRODUCTION_BUILD_SHA: 'c'.repeat(40),
    TRAILHEAD_ANDROID_PRODUCTION_BUILD_ID: 'android',
    TRAILHEAD_IOS_PRODUCTION_BUILD_ID: 'ios',
  },
}), /share one source SHA/);

console.log('EAS paired production-build evidence tests passed.');
