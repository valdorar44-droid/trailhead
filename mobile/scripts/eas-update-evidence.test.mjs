import assert from 'node:assert/strict';
import { validateChannelPromotion, validatePairedUpdatePublication } from './eas-update-evidence.mjs';

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
