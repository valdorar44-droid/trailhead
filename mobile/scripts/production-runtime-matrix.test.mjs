import assert from 'node:assert/strict';
import {
  branchRuntimeKeys,
  productionRuntimeSnapshot,
  runtimePlatformKey,
  validateRuntimeMatrixCoverage,
} from './production-runtime-matrix.mjs';

const payload = {
  currentPage: {
    id: 'channel',
    name: 'production',
    branchMapping: JSON.stringify({ data: [{ branchId: 'branch-id', branchMappingLogic: 'true' }] }),
    updateBranches: [{
      id: 'branch-id',
      name: 'production-old',
      updateGroups: [
        [
          { group: 'legacy-shared', runtimeVersion: 'legacy', platform: 'android', createdAt: '2026-01-01T00:00:00Z' },
          { group: 'legacy-shared', runtimeVersion: 'legacy', platform: 'ios', createdAt: '2026-01-01T00:00:00Z' },
        ],
        [{ group: 'old-current', runtimeVersion: 'current-android', platform: 'android', createdAt: '2026-02-01T00:00:00Z' }],
        [{ group: 'newer-legacy', runtimeVersion: 'legacy', platform: 'android', createdAt: '2026-03-01T00:00:00Z' }],
      ],
    }],
  },
};
const snapshot = productionRuntimeSnapshot(payload, ['current-android']);
assert.equal(snapshot.branch, 'production-old');
assert.deepEqual(snapshot.keys, ['legacy::android', 'legacy::ios']);
assert.deepEqual(snapshot.groups.sort(), ['legacy-shared', 'newer-legacy'].sort());
assert.equal(runtimePlatformKey('runtime', 'IOS'), 'runtime::ios');

const listing = {
  currentPage: [
    { runtimeVersion: 'legacy', platforms: 'android, ios' },
    { runtimeVersion: 'current-android', platforms: 'android' },
    { runtimeVersion: 'current-ios', platforms: 'ios' },
  ],
};
assert.deepEqual(branchRuntimeKeys(listing), [
  'current-android::android',
  'current-ios::ios',
  'legacy::android',
  'legacy::ios',
]);
assert.doesNotThrow(() => validateRuntimeMatrixCoverage(listing, [
  ...snapshot.keys,
  'current-android::android',
  'current-ios::ios',
]));
assert.throws(
  () => validateRuntimeMatrixCoverage({ currentPage: listing.currentPage.slice(1) }, snapshot.keys),
  /missing production runtime coverage/,
);
assert.throws(
  () => productionRuntimeSnapshot({ currentPage: { ...payload.currentPage, branchMapping: '{' } }),
  /mapping is invalid/,
);

console.log('Production runtime-matrix tests passed.');
