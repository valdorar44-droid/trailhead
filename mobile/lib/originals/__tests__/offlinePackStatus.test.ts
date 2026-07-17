import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  installedOfflinePackStatus,
  installedOfflinePackStatuses,
  mapLibreOfflinePackBounds,
} from '../../../components/NativeMap/offlinePackStatus';

async function main() {
  let receiver: unknown = null;
  const nativePack = {
    name: 'trailhead-original:moab:1000000001',
    async status() {
      receiver = this;
      return {
        percentage: 100,
        completedResourceSize: 2.45 * 1_048_576,
      };
    },
  };

  assert.deepEqual(await installedOfflinePackStatus(nativePack), {
    name: 'trailhead-original:moab:1000000001',
    percentage: 100,
    complete: true,
    sizeMb: 2.5,
  });
  assert.equal(receiver, nativePack, 'MapLibre status() must retain its OfflinePack receiver');

  assert.deepEqual(await installedOfflinePackStatus({
    name: 'in-progress',
    status: { percentage: 72.4, completedResourceSize: 1_048_576 },
  }), {
    name: 'in-progress',
    percentage: 72.4,
    complete: false,
    sizeMb: 1,
  });

  const isolated = await installedOfflinePackStatuses([
    { name: 'stale', status: async () => { throw new Error('native pack is stale'); } },
    nativePack,
  ]);
  assert.deepEqual(isolated.map(pack => pack.name), ['trailhead-original:moab:1000000001']);

  assert.deepEqual(
    mapLibreOfflinePackBounds([[-110.95, 38.3], [-109.7, 38.75]]),
    [[-109.7, 38.75], [-110.95, 38.3]],
    'MapLibre must receive north-east before south-west',
  );

  const adapterSource = readFileSync('components/NativeMap/offlineManager.ts', 'utf8');
  assert.match(adapterSource, /await MapLibreGL\.offlineManager\.createPack\(/);
  assert.match(adapterSource, /bounds: mapLibreOfflinePackBounds\(bounds\)/);

  console.log('Originals native offline-pack status tests passed.');
}

void main();
