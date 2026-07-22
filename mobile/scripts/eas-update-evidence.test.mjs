import assert from 'node:assert/strict';
import {
  combineUpdateViewPayloads,
  selectPairedUpdateGroups,
  validateChannelPromotion,
  validatePairedUpdatePublication,
} from './eas-update-evidence.mjs';

const expected = {
  branch: 'preview',
  commitSha: 'a'.repeat(40),
  androidRuntime: 'native-1.0.10-android.1',
  iosRuntime: 'native-1.0.10-ios.1',
};
const updates = [
  { id: 'android-id', group: 'group-android', branch: 'preview', message: 'Candidate aaaaaaaa', platform: 'android', runtimeVersion: expected.androidRuntime },
  { id: 'ios-id', group: 'group-ios', branch: 'preview', message: 'Candidate aaaaaaaa', platform: 'ios', runtimeVersion: expected.iosRuntime },
];

const branchListing = {
  name: expected.branch,
  currentPage: [
    {
      branch: expected.branch,
      message: '"Candidate aaaaaaaa" (seconds ago by QA)',
      runtimeVersion: expected.iosRuntime,
      group: 'group-ios',
      platforms: 'ios',
    },
    {
      branch: expected.branch,
      message: '"Candidate aaaaaaaa" (seconds ago by QA)',
      runtimeVersion: expected.androidRuntime,
      group: 'group-android',
      platforms: 'android',
    },
  ],
};
assert.deepEqual(selectPairedUpdateGroups(branchListing, expected), {
  androidGroup: 'group-android',
  iosGroup: 'group-ios',
});
assert.throws(() => selectPairedUpdateGroups({ currentPage: branchListing.currentPage.slice(0, 1) }, expected), /android candidate/);
assert.throws(() => selectPairedUpdateGroups({
  currentPage: [branchListing.currentPage[0], branchListing.currentPage[1], {
    ...branchListing.currentPage[1],
    group: 'stale-android-group',
  }],
}, expected), /ambiguous android/);

const sharedRuntimeListing = {
  currentPage: [{
    branch: expected.branch,
    message: 'Candidate aaaaaaaa',
    runtimeVersion: expected.androidRuntime,
    group: 'shared-group',
    platforms: 'android, ios',
  }],
};
assert.deepEqual(selectPairedUpdateGroups(sharedRuntimeListing, {
  ...expected,
  iosRuntime: expected.androidRuntime,
}), {
  androidGroup: 'shared-group',
  iosGroup: 'shared-group',
});
assert.deepEqual(combineUpdateViewPayloads([[updates[0]], [updates[1], updates[1]]]), updates);
assert.throws(() => combineUpdateViewPayloads([{ currentPage: [] }]), /did not contain update records/);

assert.deepEqual(validatePairedUpdatePublication(updates, expected), {
  android: { group: 'group-android', id: 'android-id', runtimeVersion: expected.androidRuntime },
  ios: { group: 'group-ios', id: 'ios-id', runtimeVersion: expected.iosRuntime },
});
assert.throws(() => validatePairedUpdatePublication(updates.slice(0, 1), expected), /exactly one Android and one iOS/);
assert.throws(() => validatePairedUpdatePublication([
  updates[0], { ...updates[1], group: '' },
], expected), /group evidence is missing/);
assert.throws(() => validatePairedUpdatePublication([
  updates[0], { ...updates[1], runtimeVersion: 'wrong' },
], expected), /iOS OTA runtime mismatch/);
assert.throws(() => validatePairedUpdatePublication([
  updates[0], { ...updates[1], message: 'Candidate wrong-sha' },
], expected), /release SHA/);
assert.throws(() => validatePairedUpdatePublication(updates, {
  ...expected,
  androidGroup: 'wrong-android-group',
  iosGroup: 'group-ios',
}), /Android OTA group/);
assert.throws(() => validatePairedUpdatePublication(updates, {
  ...expected,
  androidGroup: 'group-android',
  iosGroup: 'wrong-ios-group',
}), /iOS OTA group/);

const sharedRuntimeExpected = { ...expected, iosRuntime: expected.androidRuntime };
assert.throws(() => validatePairedUpdatePublication([
  updates[0], { ...updates[1], runtimeVersion: expected.androidRuntime },
], sharedRuntimeExpected), /same runtime must share/);

const channelPayload = {
  currentPage: {
    id: 'channel-id',
    name: 'preview',
    branchMapping: JSON.stringify({
      data: [{ branchId: 'candidate-id', branchMappingLogic: 'true' }],
      version: 0,
    }),
    updateBranches: [{ id: 'candidate-id', name: 'preview-candidate-aaaaaaaa' }],
  },
};
assert.deepEqual(validateChannelPromotion(channelPayload, {
  branch: 'preview-candidate-aaaaaaaa',
  channel: 'preview',
}), {
  branchId: 'candidate-id',
  branch: 'preview-candidate-aaaaaaaa',
  channel: 'preview',
  channelId: 'channel-id',
});
assert.throws(() => validateChannelPromotion(channelPayload, {
  branch: 'wrong-branch',
  channel: 'preview',
}), /not pointing/);
assert.throws(() => validateChannelPromotion({
  currentPage: { ...channelPayload.currentPage, branchMapping: '{' },
}, {
  branch: 'preview-candidate-aaaaaaaa',
  channel: 'preview',
}), /mapping evidence is invalid/);

console.log('Paired EAS update evidence tests passed.');
