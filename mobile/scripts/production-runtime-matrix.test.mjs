import assert from 'node:assert/strict';
import {
  branchRuntimeKeys,
  productionRuntimeSnapshot,
  productionRuntimeSnapshotFromListing,
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
  name: 'production-old',
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
const completeSnapshot = productionRuntimeSnapshotFromListing(payload, {
  name: 'production-old',
  currentPage: [
    { group: 'legacy-shared', runtimeVersion: 'legacy', platforms: 'android, ios' },
    { group: 'android-1.0.9', runtimeVersion: 'native-1.0.9-car', platforms: 'android' },
    { group: 'ios-1.0.9', runtimeVersion: 'native-1.0.9', platforms: 'ios' },
    { group: 'current-android', runtimeVersion: 'current-android', platforms: 'android' },
  ],
}, ['current-android']);
assert.deepEqual(completeSnapshot.keys, [
  'legacy::android',
  'legacy::ios',
  'native-1.0.9-car::android',
  'native-1.0.9::ios',
]);
assert.deepEqual(completeSnapshot.groups.sort(), ['android-1.0.9', 'ios-1.0.9', 'legacy-shared'].sort());
assert.throws(
  () => productionRuntimeSnapshotFromListing(payload, {
    name: 'another-branch',
    currentPage: [],
  }),
  /branch mismatch/,
);
assert.throws(
  () => branchRuntimeKeys({
    currentPage: [
      { runtimeVersion: 'legacy', platforms: 'android' },
      { runtimeVersion: 'legacy', platforms: 'android' },
    ],
  }),
  /duplicate runtime\/platform coverage/,
);
assert.throws(
  () => branchRuntimeKeys({
    currentPage: Array.from({ length: 50 }, (_, index) => ({
      runtimeVersion: `runtime-${index}`,
      platforms: 'android',
    })),
  }),
  /may be truncated/,
);

console.log('Production runtime-matrix tests passed.');
