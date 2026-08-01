import assert from 'node:assert/strict';
import {
  latestPlatformUpdate,
  resolveChannelBranch,
  validateCounterpartUnchanged,
  validateStagedPreviewPublication,
} from './staged-preview-evidence.mjs';

const branch = 'preview-current';
const channel = {
  currentPage: {
    id: 'channel-id',
    name: 'preview',
    branchMapping: JSON.stringify({ data: [{ branchId: 'branch-id', branchMappingLogic: 'true' }] }),
    updateBranches: [{ id: 'branch-id', name: branch }],
  },
};
assert.deepEqual(resolveChannelBranch(channel), {
  channelId: 'channel-id', branchId: 'branch-id', branch,
});

const listing = {
  currentPage: [
    { branch, group: 'android-new', message: 'Trailhead preview abcdef12 android', runtimeVersion: 'android-runtime', platforms: 'android' },
    { branch, group: 'ios-old', message: 'Trailhead preview 11111111 ios', runtimeVersion: 'ios-runtime', platforms: 'ios' },
  ],
};
assert.equal(latestPlatformUpdate(listing, {
  branch, platform: 'android', runtimeVersion: 'android-runtime',
}).group, 'android-new');
assert.deepEqual(validateCounterpartUnchanged(
  { group: 'ios-old' }, { group: 'ios-old', runtimeVersion: 'ios-runtime' }, 'ios',
), { platform: 'ios', group: 'ios-old', runtimeVersion: 'ios-runtime' });
assert.throws(() => validateCounterpartUnchanged(
  { group: 'ios-old' }, { group: 'ios-new' }, 'ios',
), /iOS preview changed/i);

assert.deepEqual(validateStagedPreviewPublication([{
  id: 'android-id',
  group: 'android-new',
  platform: 'android',
  runtimeVersion: 'android-runtime',
  branch,
  message: 'Trailhead preview abcdef12 android',
}], {
  group: 'android-new', platform: 'android', runtimeVersion: 'android-runtime',
  branch, commitSha: 'abcdef1234567890',
}), {
  id: 'android-id', group: 'android-new', platform: 'android', runtimeVersion: 'android-runtime',
});
assert.throws(() => validateStagedPreviewPublication([], {
  group: 'android-new', platform: 'android', runtimeVersion: 'android-runtime',
  branch, commitSha: 'abcdef1234567890',
}), /exactly one android/i);

console.log('Staged preview evidence tests passed.');
