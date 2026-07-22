const ALLOWED_DIRTY_PATHS = new Set([
  'dashboard/explore_serving_index_v2.json',
]);

const ALLOWED_DIRTY_PREFIXES = [
  '.cursor/',
];

function normalizedPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

export function porcelainV1ZChanges(value) {
  const records = String(value || '').split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    const path = normalizedPath(record.slice(3));
    changes.push({ status, path });
    if (status.includes('R') || status.includes('C')) {
      const sourcePath = normalizedPath(records[index + 1]);
      index += 1;
      if (sourcePath) changes.push({ status: `${status}:source`, path: sourcePath });
    }
  }
  return changes;
}

export function unauthorizedReleaseChanges(value) {
  return porcelainV1ZChanges(value).filter(({ path }) => (
    !ALLOWED_DIRTY_PATHS.has(path)
    && !ALLOWED_DIRTY_PREFIXES.some(prefix => path.startsWith(prefix))
  ));
}

export function assertAuthoritativeWorktreeClean(statusOutput) {
  const blocked = unauthorizedReleaseChanges(statusOutput);
  if (!blocked.length) return;
  const paths = blocked.slice(0, 12).map(change => `${change.status} ${change.path}`).join(', ');
  const remainder = blocked.length > 12 ? ` (+${blocked.length - 12} more)` : '';
  throw new Error(
    `Release publication requires committed source files. Commit or remove: ${paths}${remainder}`,
  );
}
