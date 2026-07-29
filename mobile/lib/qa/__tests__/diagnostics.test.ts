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
  offlinePlacePacksV1: {
    packCount: 3,
    pointCount: 48_240,
    pointCountUnknownPackCount: 1,
    storageBytes: 81_345_771,
    packIds: ['private-pack-id'],
    names: ['Private campsite pack'],
  },
  offlineRendererLifecycle: {
    terminal_code: 'rnmapbox_other_pack_stalled',
    events: [
      { phase: 'waiting_for_pack', elapsed_ms: 0 },
      { phase: 'native_error_other', elapsed_ms: 100, progress_bucket: 17 },
      { phase: 'pack_stalled', elapsed_ms: 8_200, progress_bucket: 17 },
      { phase: 'unknown_private_phase', elapsed_ms: 8_300, progress_bucket: 17, rawMessage: 'private native message' },
    ],
    rawMessage: 'private native message',
    packName: 'private pack name',
  },
  runtimeMemory: {
    jsHeapTotalBytes: 120_000_000,
    jsHeapUsedBytes: 80_000_000,
    heapObjectNames: ['private-coordinate-cache'],
  },
  tripRepository: {
    stateFileBytes: 44_000_000,
    tripCount: 52,
    savedEntityCount: 9_200,
    outboxCount: 4,
    hydration: { pages: 95, items: 9_252, applied: 9_000, skipped: 252 },
    persist: { count: 9_010, totalSerializedBytes: 380_000_000_000, maxSerializedBytes: 44_000_000 },
    ownerScope: 'account:private-user',
    tripIds: ['private-trip-id'],
  },
  activeTrip: {
    serializedBytes: 18_000_000,
    audioGuideEntryCount: 3,
    routeCoordinateCount: 18_240,
    routeStepCount: 210,
    routeLegCount: 7,
    waypointCount: 8,
    routeCoordinates: [[-109.5, 38.5]],
  },
  original: { packId: 'moab-canyons', version: 2 },
  coordinates: [51.0447, -114.0719],
  searchText: 'camping near Moab',
  userId: 'private-user',
} as any);

assert.equal(snapshot.schema, 'qa_diagnostics_v1');
assert.equal(snapshot.offlineBundles[0].placeRecords, 120);
assert.deepEqual(snapshot.offlinePlacePacksV1, {
  packCount: 3,
  pointCount: 48_240,
  pointCountUnknownPackCount: 1,
  storageBytes: 81_345_771,
});
assert.deepEqual(snapshot.runtimeMemory, {
  jsHeapTotalBytes: 120_000_000,
  jsHeapUsedBytes: 80_000_000,
});
assert.deepEqual(snapshot.offlineRendererLifecycle, {
  terminalCode: 'rnmapbox_other_pack_stalled',
  events: [
    { phase: 'waiting_for_pack', elapsedMs: 0 },
    { phase: 'native_error_other', elapsedMs: 100, progressBucket: 10 },
    { phase: 'pack_stalled', elapsedMs: 8_200, progressBucket: 10 },
  ],
});
assert.deepEqual(snapshot.tripRepository, {
  stateFileBytes: 44_000_000,
  tripCount: 52,
  savedEntityCount: 9_200,
  outboxCount: 4,
  hydration: { pages: 95, items: 9_252, applied: 9_000, skipped: 252 },
  persist: { count: 9_010, totalSerializedBytes: 380_000_000_000, maxSerializedBytes: 44_000_000 },
});
assert.deepEqual(snapshot.activeTrip, {
  serializedBytes: 18_000_000,
  audioGuideEntryCount: 3,
  routeCoordinateCount: 18_240,
  routeStepCount: 210,
  routeLegCount: 7,
  waypointCount: 8,
});
assert.equal(snapshot.features.configured.searchV2, 'off');
assert.equal(snapshot.features.effectiveAccess.searchV2, true);
const serialized = JSON.stringify(snapshot);
for (const forbidden of [
  'coordinates',
  '51.0447',
  'searchText',
  'camping near Moab',
  'userId',
  'privatePath',
  'packIds',
  'private-pack-id',
  'names',
  'Private campsite pack',
  'heapObjectNames',
  'private-coordinate-cache',
  'ownerScope',
  'account:private-user',
  'tripIds',
  'private-trip-id',
  'routeCoordinates',
  '-109.5',
  'rawMessage',
  'private native message',
  'packName',
  'private pack name',
]) {
  assert.equal(serialized.includes(forbidden), false, `diagnostics retained ${forbidden}`);
}

const invalidLegacyCounts = buildQaDiagnosticsSnapshotV1({
  ...snapshot,
  offlinePlacePacksV1: {
    packCount: -1,
    pointCount: Number.NaN,
    pointCountUnknownPackCount: Number.POSITIVE_INFINITY,
    storageBytes: Number.POSITIVE_INFINITY,
  },
} as any);
assert.deepEqual(invalidLegacyCounts.offlinePlacePacksV1, {
  packCount: 0,
  pointCount: 0,
  pointCountUnknownPackCount: 0,
  storageBytes: 0,
});

const invalidRuntimeCounts = buildQaDiagnosticsSnapshotV1({
  ...snapshot,
  runtimeMemory: {
    jsHeapTotalBytes: Number.POSITIVE_INFINITY,
    jsHeapUsedBytes: -1,
  },
  activeTrip: {
    serializedBytes: -10,
    audioGuideEntryCount: Number.NaN,
    routeCoordinateCount: -10,
    routeStepCount: Number.NaN,
    routeLegCount: Number.POSITIVE_INFINITY,
    waypointCount: Number.POSITIVE_INFINITY,
  },
  tripRepository: {
    stateFileBytes: Number.POSITIVE_INFINITY,
    tripCount: -1,
    savedEntityCount: Number.NaN,
    outboxCount: Number.POSITIVE_INFINITY,
    hydration: {
      pages: -1,
      items: Number.NaN,
      applied: Number.POSITIVE_INFINITY,
      skipped: -1,
    },
    persist: {
      count: Number.NaN,
      totalSerializedBytes: Number.POSITIVE_INFINITY,
      maxSerializedBytes: -1,
    },
  },
} as any);
assert.deepEqual(invalidRuntimeCounts.runtimeMemory, {
  jsHeapTotalBytes: 0,
  jsHeapUsedBytes: 0,
});
assert.deepEqual(invalidRuntimeCounts.activeTrip, {
  serializedBytes: 0,
  audioGuideEntryCount: 0,
  routeCoordinateCount: 0,
  routeStepCount: 0,
  routeLegCount: 0,
  waypointCount: 0,
});
assert.deepEqual(invalidRuntimeCounts.tripRepository, {
  stateFileBytes: 0,
  tripCount: 0,
  savedEntityCount: 0,
  outboxCount: 0,
  hydration: { pages: 0, items: 0, applied: 0, skipped: 0 },
  persist: { count: 0, totalSerializedBytes: 0, maxSerializedBytes: 0 },
});

console.log('QA diagnostics allowlist tests passed.');
