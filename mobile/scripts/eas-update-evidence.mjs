function nonempty(value) {
  return String(value || '').trim();
}

export function validatePairedUpdatePublication(payload, expected) {
  const updates = Array.isArray(payload) ? payload : payload?.updates;
  if (!Array.isArray(updates)) throw new Error('EAS update response did not contain update records.');
  const relevant = updates.filter(update => update?.platform === 'android' || update?.platform === 'ios');
  if (relevant.length !== 2) throw new Error('Paired OTA must publish exactly one Android and one iOS update.');

  const byPlatform = new Map(relevant.map(update => [update.platform, update]));
  if (!byPlatform.has('android') || !byPlatform.has('ios')) {
    throw new Error('Paired OTA is missing Android or iOS.');
  }
  const android = byPlatform.get('android');
  const ios = byPlatform.get('ios');
  const androidGroup = nonempty(android.group);
  const iosGroup = nonempty(ios.group);
  if (!androidGroup || !iosGroup) throw new Error('Paired OTA update group evidence is missing.');
  if (expected.androidRuntime === expected.iosRuntime && androidGroup !== iosGroup) {
    throw new Error('Updates with the same runtime must share one update group.');
  }
  if (android.runtimeVersion !== expected.androidRuntime) throw new Error('Android OTA runtime mismatch.');
  if (ios.runtimeVersion !== expected.iosRuntime) throw new Error('iOS OTA runtime mismatch.');
  for (const update of relevant) {
    if (!nonempty(update.id)) throw new Error(`${update.platform} OTA update ID is missing.`);
    if (update.branch !== expected.branch) throw new Error(`${update.platform} OTA branch mismatch.`);
    if (!nonempty(update.message).includes(expected.commitSha.slice(0, 8))) {
      throw new Error(`${update.platform} OTA message is not bound to the release SHA.`);
    }
  }
  return {
    android: { group: androidGroup, id: android.id, runtimeVersion: android.runtimeVersion },
    ios: { group: iosGroup, id: ios.id, runtimeVersion: ios.runtimeVersion },
  };
}

export function validateChannelPromotion(payload, expected) {
  const channel = payload?.currentPage || payload;
  if (!channel || channel.name !== expected.channel) {
    throw new Error('EAS channel evidence does not match the requested channel.');
  }
  const branches = Array.isArray(channel.updateBranches) ? channel.updateBranches : [];
  const branch = branches.find(candidate => candidate?.name === expected.branch);
  if (!branch || !nonempty(branch.id)) {
    throw new Error('EAS channel is not pointing at the validated candidate branch.');
  }
  let mapping;
  try {
    mapping = JSON.parse(String(channel.branchMapping || ''));
  } catch {
    throw new Error('EAS channel branch mapping evidence is invalid.');
  }
  const mapped = Array.isArray(mapping?.data)
    && mapping.data.some(entry => entry?.branchId === branch.id && entry?.branchMappingLogic === 'true');
  if (!mapped) throw new Error('EAS channel mapping does not select the validated candidate branch.');
  return { branchId: branch.id, branch: branch.name, channel: channel.name, channelId: channel.id };
}
