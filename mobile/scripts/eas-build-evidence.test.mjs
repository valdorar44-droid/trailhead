import assert from 'node:assert/strict';
import { validateProductionBuild } from './eas-build-evidence.mjs';

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

console.log('EAS paired production-build evidence tests passed.');
