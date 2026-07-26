function nonempty(value) {
  return String(value || '').trim();
}

function platforms(value) {
  if (Array.isArray(value)) return value.map(item => nonempty(item).toLowerCase()).filter(Boolean);
  return nonempty(value).split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

function mappedBranch(channel) {
  let mapping;
  try {
    mapping = JSON.parse(String(channel?.branchMapping || ''));
  } catch {
    throw new Error('Production channel mapping is invalid.');
  }
  const branchId = mapping?.data?.find(entry => entry?.branchMappingLogic === 'true')?.branchId;
  const branch = (channel?.updateBranches || []).find(candidate => candidate?.id === branchId);
  if (!branch?.id || !branch?.name) throw new Error('Production channel has no authoritative mapped branch.');
  return branch;
}

function updateRecords(branch) {
  return (branch?.updateGroups || []).flatMap(group => Array.isArray(group) ? group : []);
}

export function runtimePlatformKey(runtimeVersion, platform) {
  return `${nonempty(runtimeVersion)}::${nonempty(platform).toLowerCase()}`;
}

export function productionRuntimeSnapshot(payload, excludedRuntimes = []) {
  const channel = payload?.currentPage || payload;
  if (!channel?.name) throw new Error('Production channel evidence is missing.');
  const branch = mappedBranch(channel);
  const excluded = new Set(excludedRuntimes.map(nonempty));
  const newest = new Map();
  for (const record of updateRecords(branch)) {
    const runtime = nonempty(record?.runtimeVersion);
    const platform = nonempty(record?.platform).toLowerCase();
    const group = nonempty(record?.group);
    if (!runtime || !['android', 'ios'].includes(platform) || !group || excluded.has(runtime)) continue;
    const key = runtimePlatformKey(runtime, platform);
    const prior = newest.get(key);
    if (!prior || Date.parse(record.createdAt || 0) > Date.parse(prior.createdAt || 0)) {
      newest.set(key, { key, runtimeVersion: runtime, platform, group, createdAt: record.createdAt || '' });
    }
  }
  const records = [...newest.values()].sort((a, b) => a.key.localeCompare(b.key));
  const groups = [...new Set(records.map(record => record.group))];
  return {
    channel: channel.name,
    channelId: channel.id,
    branch: branch.name,
    branchId: branch.id,
    records,
    groups,
    keys: records.map(record => record.key),
  };
}

export function branchRuntimeKeys(payload) {
  const rows = Array.isArray(payload?.currentPage) ? payload.currentPage : payload;
  if (!Array.isArray(rows)) throw new Error('Candidate branch listing is missing.');
  const keys = new Set();
  for (const row of rows) {
    const runtime = nonempty(row?.runtimeVersion);
    for (const platform of platforms(row?.platforms || row?.platform)) {
      if (runtime && ['android', 'ios'].includes(platform)) keys.add(runtimePlatformKey(runtime, platform));
    }
  }
  return [...keys].sort();
}

export function validateRuntimeMatrixCoverage(payload, expectedKeys) {
  const actual = branchRuntimeKeys(payload);
  const missing = [...new Set(expectedKeys)].filter(key => !actual.includes(key));
  if (missing.length) throw new Error(`Candidate branch is missing production runtime coverage: ${missing.join(', ')}`);
  return { actual, expected: [...new Set(expectedKeys)].sort() };
}
