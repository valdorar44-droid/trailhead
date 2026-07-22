import assert from 'node:assert/strict';
import { buildQaDiagnosticsSnapshotV1 } from '../diagnostics';

const snapshot = buildQaDiagnosticsSnapshotV1({
  release: {
    appVersion: '1.0.10',
    buildNumber: '59',
    channel: 'preview',
    commitSha: '12fc263',
    platform: 'android',
    runtimeVersion: 'native-1.0.10-android.1',
    updateId: '019f7932-c916-7e2b-96b5-0cedf4ffc458',
  },
  accountRole: 'admin',
  features: {
    configured: { offlineV2: 'off', originals: 'internal', searchV2: 'off', uiSystemV2: 'public' },
    effectiveAccess: { offlineV2: true, originals: true, searchV2: true, uiSystemV2: true },
  },
  offlineBundles: [{
    placeRecords: 120,
    revision: 'bundle.7',
    searchRecords: 140,
    state: 'ready',
    trailRecords: 20,
    privatePath: '/accounts/private/offline.db',
  }],
  original: { packId: 'moab-canyons', version: 2 },
  coordinates: [51.0447, -114.0719],
  searchText: 'camping near Moab',
  userId: 'private-user',
} as any);

assert.equal(snapshot.schema, 'qa_diagnostics_v1');
assert.equal(snapshot.offlineBundles[0].placeRecords, 120);
assert.equal(snapshot.features.configured.searchV2, 'off');
assert.equal(snapshot.features.effectiveAccess.searchV2, true);
const serialized = JSON.stringify(snapshot);
for (const forbidden of ['coordinates', '51.0447', 'searchText', 'camping near Moab', 'userId', 'privatePath']) {
  assert.equal(serialized.includes(forbidden), false, `diagnostics retained ${forbidden}`);
}

console.log('QA diagnostics allowlist tests passed.');
