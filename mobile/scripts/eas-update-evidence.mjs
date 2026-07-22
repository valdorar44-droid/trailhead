function nonempty(value) {
  return String(value || '').trim();
}

function listedPlatforms(value) {
  return nonempty(value)
    .split(',')
    .map(platform => platform.trim().toLowerCase())
    .filter(Boolean);
}

export function selectPairedUpdateGroups(payload, expected) {
  const rows = Array.isArray(payload?.currentPage) ? payload.currentPage : payload;
  if (!Array.isArray(rows)) throw new Error('EAS branch listing did not contain update groups.');
  const shortSha = nonempty(expected.commitSha).slice(0, 8);
  const matching = rows.filter(row => row?.branch === expected.branch
    && nonempty(row?.message).includes(shortSha));

  function groupFor(platform, runtimeVersion) {
    const candidates = matching.filter(candidate => listedPlatforms(candidate?.platforms).includes(platform)
      && candidate?.runtimeVersion === runtimeVersion
      && nonempty(candidate?.group));
    if (candidates.length === 0) {
      throw new Error(`EAS branch listing is missing the ${platform} candidate update group.`);
    }
    if (candidates.length !== 1) {
      throw new Error(`EAS branch listing contains ambiguous ${platform} candidate update groups.`);
    }
    return nonempty(candidates[0].group);
  }

  return {
    androidGroup: groupFor('android', expected.androidRuntime),
    iosGroup: groupFor('ios', expected.iosRuntime),
  };
}

export function combineUpdateViewPayloads(payloads) {
  if (!Array.isArray(payloads)) throw new Error('EAS update view evidence is missing.');
  const updates = payloads.flatMap(payload => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.updates)) return payload.updates;
    throw new Error('EAS update view did not contain update records.');
  });
  const byId = new Map();
  for (const update of updates) {
    const id = nonempty(update?.id);
    if (id) byId.set(id, update);
  }
  return [...byId.values()];
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
  if (expected.androidGroup && androidGroup !== expected.androidGroup) {
    throw new Error('Android OTA group does not match the selected candidate group.');
  }
  if (expected.iosGroup && iosGroup !== expected.iosGroup) {
    throw new Error('iOS OTA group does not match the selected candidate group.');
  }
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
