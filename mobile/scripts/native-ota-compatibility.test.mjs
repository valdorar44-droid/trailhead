import assert from 'node:assert/strict';
import {
  assertAllowedFingerprintDifferences,
  dependencyDifferences,
  fingerprintSourceDifferences,
  nativeImpactingPaths,
  parseFingerprintComparison,
  validateJsOnlySourceDiff,
} from './native-ota-compatibility.mjs';

const comparison = parseFingerprintComparison(`Environment loaded.\n${JSON.stringify({
  fingerprint1: {
    hash: 'build',
    sources: [
      { type: 'contents', id: 'expoConfig', hash: 'a' },
      { type: 'contents', id: 'packageJson:scripts', hash: 'b' },
      { type: 'dir', filePath: 'android', hash: 'c' },
      { type: 'file', filePath: 'eas.json', hash: 'same' },
    ],
  },
  fingerprint2: {
    hash: 'local',
    sources: [
      { type: 'contents', id: 'expoConfig', hash: 'd' },
      { type: 'contents', id: 'packageJson:scripts', hash: 'e' },
      { type: 'dir', filePath: 'android', hash: 'f' },
      { type: 'file', filePath: 'eas.json', hash: 'same' },
    ],
  },
})}`);
const differences = fingerprintSourceDifferences(comparison);
assert.deepEqual(differences.map(item => item.source), [
  'contents:expoConfig',
  'contents:packageJson:scripts',
  'dir:android',
]);
assert.doesNotThrow(() => assertAllowedFingerprintDifferences(differences, 'android'));
assert.throws(
  () => assertAllowedFingerprintDifferences([...differences, { source: 'file:eas.json' }], 'android'),
  /Unexplained android/,
);
assert.throws(() => parseFingerprintComparison('not json'), /did not return JSON/);

assert.deepEqual(nativeImpactingPaths([
  'mobile/app/(tabs)/map.tsx',
  'dashboard/server.py',
  'mobile/android/app/src/main/AndroidManifest.xml',
  'mobile/app.config.js',
  'mobile/plugins/withExample.js',
  'mobile/assets/fonts/Barlow.ttf',
]), [
  'mobile/android/app/src/main/AndroidManifest.xml',
  'mobile/app.config.js',
  'mobile/plugins/withExample.js',
  'mobile/assets/fonts/Barlow.ttf',
]);

const before = { scripts: { test: 'old' }, dependencies: { expo: '1' }, devDependencies: { tsx: '1' } };
const scriptsOnly = { ...before, scripts: { test: 'new' } };
assert.deepEqual(dependencyDifferences(before, scriptsOnly), []);
assert.equal(validateJsOnlySourceDiff({
  changedPaths: ['mobile/scripts/publish-eas-update.mjs', 'mobile/app/(tabs)/map.tsx'],
  buildPackage: before,
  releasePackage: scriptsOnly,
}).packageScriptsChanged, true);
assert.throws(() => validateJsOnlySourceDiff({
  changedPaths: ['mobile/ios/Trailhead/AppDelegate.swift'],
  buildPackage: before,
  releasePackage: scriptsOnly,
}), /native inputs/);
assert.throws(() => validateJsOnlySourceDiff({
  changedPaths: ['mobile/package.json'],
  buildPackage: before,
  releasePackage: { ...scriptsOnly, dependencies: { expo: '2' } },
}), /dependency fields/);

console.log('Native-compatible production OTA tests passed.');
