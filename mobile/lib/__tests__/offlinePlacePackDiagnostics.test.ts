import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  collectOfflinePlacePackDiagnosticsV1,
  nextOfflinePlacePackPointMetadataV1,
  parseOfflinePlacePackPointMetadataV1,
} from '../offlinePlacePackDiagnostics';

void (async () => {
  const pointMetadata = parseOfflinePlacePackPointMetadataV1({
    schema: 'offline_place_pack_point_metadata_v1',
    packs: [
      { pack_id: 'pack-a', point_count: 120 },
      { pack_id: 'pack-a', point_count: 999 },
      { pack_id: 'invalid-negative', point_count: -1 },
      { pack_id: 'pack-c', point_count: 30 },
    ],
  });
  assert.deepEqual(pointMetadata, [
    { pack_id: 'pack-a', point_count: 120 },
    { pack_id: 'pack-c', point_count: 30 },
  ]);

  const statCalls: string[] = [];
  const inventory = await collectOfflinePlacePackDiagnosticsV1({
    packIds: ['pack-a', 'pack-b', 'pack-c', 'pack-a'],
    pointMetadata,
    getFileSize: async packId => {
      statCalls.push(packId);
      return { 'pack-a': 1_024, 'pack-b': 2_048, 'pack-c': 4_096 }[packId] || 0;
    },
  });
  assert.deepEqual(inventory, {
    packCount: 3,
    pointCount: 150,
    pointCountUnknownPackCount: 1,
    storageBytes: 7_168,
  });
  assert.deepEqual(statCalls, ['pack-a', 'pack-b', 'pack-c']);

  assert.deepEqual(
    nextOfflinePlacePackPointMetadataV1(pointMetadata, 'pack-a', 125),
    [
      { pack_id: 'pack-a', point_count: 125 },
      { pack_id: 'pack-c', point_count: 30 },
    ],
  );

  const qaScreenSource = readFileSync('app/qa/telemetry.tsx', 'utf8');
  assert.match(qaScreenSource, /getOfflinePlacePackDiagnosticsInventory\(\)/);
  assert.doesNotMatch(
    qaScreenSource,
    /listOfflinePlacePacks|getOfflinePlacePackStorageBytes|loadOfflinePlacePack/,
    'QA diagnostics must not load or parse full offline place-pack payloads',
  );

  console.log('Offline place-pack metadata-only diagnostics tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
