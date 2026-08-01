function nonempty(value) {
  return String(value || '').trim();
}

function listedPlatforms(value) {
  return nonempty(value)
    .split(',')
    .map(platform => platform.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveChannelBranch(payload, channelName = 'preview') {
  const channel = payload?.currentPage || payload;
  if (!channel || channel.name !== channelName) {
    throw new Error(`EAS channel evidence does not match ${channelName}.`);
  }
  let mapping;
  try {
    mapping = JSON.parse(String(channel.branchMapping || ''));
  } catch {
    throw new Error('EAS channel branch mapping evidence is invalid.');
  }
  const mapped = Array.isArray(mapping?.data)
    ? mapping.data.find(entry => entry?.branchMappingLogic === 'true')
    : null;
  const branch = (Array.isArray(channel.updateBranches) ? channel.updateBranches : [])
    .find(candidate => candidate?.id === mapped?.branchId);
  if (!branch || !nonempty(branch.name)) {
    throw new Error('EAS channel does not resolve to one active branch.');
  }
  return { channelId: channel.id, branchId: branch.id, branch: branch.name };
}

export function latestPlatformUpdate(payload, expected) {
  const rows = Array.isArray(payload?.currentPage) ? payload.currentPage : payload;
  if (!Array.isArray(rows)) throw new Error('EAS branch listing did not contain update groups.');
  const candidate = rows.find(row => row?.branch === expected.branch
    && row?.runtimeVersion === expected.runtimeVersion
    && listedPlatforms(row?.platforms).includes(expected.platform));
  if (!candidate || !nonempty(candidate.group)) {
    throw new Error(`EAS branch listing is missing the ${expected.platform} update.`);
  }
  return {
    group: nonempty(candidate.group),
    message: nonempty(candidate.message),
    runtimeVersion: nonempty(candidate.runtimeVersion),
  };
}

export function validateStagedPreviewPublication(updatePayload, expected) {
  const updates = Array.isArray(updatePayload)
    ? updatePayload
    : Array.isArray(updatePayload?.updates) ? updatePayload.updates : null;
  if (!updates) throw new Error('EAS update view did not contain update records.');
  const matches = updates.filter(update => update?.platform === expected.platform);
  if (matches.length !== 1) {
    throw new Error(`Staged preview must contain exactly one ${expected.platform} update.`);
  }
  const update = matches[0];
  if (nonempty(update.group) !== expected.group) throw new Error('Staged preview group mismatch.');
  if (update.branch !== expected.branch) throw new Error('Staged preview branch mismatch.');
  if (update.runtimeVersion !== expected.runtimeVersion) throw new Error('Staged preview runtime mismatch.');
  if (!nonempty(update.message).includes(expected.commitSha.slice(0, 8))) {
    throw new Error('Staged preview message is not bound to the source SHA.');
  }
  if (!nonempty(update.id)) throw new Error('Staged preview update ID is missing.');
  return {
    id: nonempty(update.id),
    group: nonempty(update.group),
    platform: expected.platform,
    runtimeVersion: expected.runtimeVersion,
  };
}

export function validateCounterpartUnchanged(before, after, platform) {
  if (!before?.group || !after?.group || before.group !== after.group) {
    throw new Error(`${platform} preview changed during the other platform's staged publication.`);
  }
  return { platform, group: before.group, runtimeVersion: after.runtimeVersion };
}
