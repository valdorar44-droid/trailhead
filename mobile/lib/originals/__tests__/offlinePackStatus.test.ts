import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  installedOfflinePackStatus,
  installedOfflinePackStatusStrict,
  installedOfflinePackStatuses,
  mapLibreOfflinePackBounds,
  offlineStyleCoversBounds,
} from '../../../components/NativeMap/offlinePackStatus';

async function main() {
  let receiver: unknown = null;
  const nativePack = {
    name: 'trailhead-original:moab:1000000001',
    async status() {
      receiver = this;
      return {
        percentage: 100,
        completedResourceSize: 2_569_012,
      };
    },
  };

  assert.deepEqual(await installedOfflinePackStatus(nativePack), {
    name: 'trailhead-original:moab:1000000001',
    percentage: 100,
    complete: true,
    completedResourceSize: 2_569_012,
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
    completedResourceSize: 1_048_576,
    sizeMb: 1,
  });

  const isolated = await installedOfflinePackStatuses([
    { name: 'stale', status: async () => { throw new Error('native pack is stale'); } },
    nativePack,
  ]);
  assert.deepEqual(isolated.map(pack => pack.name), ['trailhead-original:moab:1000000001']);

  const physicalName = 'trailhead-legacy-rnmapbox-trailhead-original:moab:1000000001';
  const exactBytes = 213_073_997;
  assert.deepEqual(await installedOfflinePackStatusStrict([
    { name: 'trailhead-original:moab:1000000001', status: { percentage: 100, completedResourceSize: 1 } },
    { name: physicalName, status: { percentage: 100, completedResourceSize: exactBytes } },
  ], physicalName), {
    name: physicalName,
    percentage: 100,
    complete: true,
    completedResourceSize: exactBytes,
    sizeMb: 203.2,
  }, 'strict inspection preserves the raw native integer instead of reconstructing rounded MB');
  await assert.rejects(
    installedOfflinePackStatusStrict([], physicalName),
    /missing/,
  );
  await assert.rejects(
    installedOfflinePackStatusStrict([
      { name: physicalName, status: { percentage: 100, completedResourceSize: exactBytes } },
      { name: physicalName, status: { percentage: 100, completedResourceSize: exactBytes } },
    ], physicalName),
    /duplicated/,
  );
  await assert.rejects(
    installedOfflinePackStatusStrict([
      { name: physicalName, status: { percentage: 99.9, completedResourceSize: exactBytes } },
    ], physicalName),
    /incomplete/,
  );
  await assert.rejects(
    installedOfflinePackStatusStrict([
      { name: physicalName, status: { percentage: 100, completedResourceSize: exactBytes + 0.5 } },
    ], physicalName),
    /safe integer/,
  );
  await assert.rejects(
    installedOfflinePackStatusStrict([{
      name: physicalName,
      status: async () => { throw new Error('native strict status failed'); },
    }], physicalName),
    /native strict status failed/,
    'strict inspection propagates native status errors',
  );

  assert.deepEqual(
    mapLibreOfflinePackBounds([[-110.95, 38.3], [-109.7, 38.75]]),
    [[-109.7, 38.75], [-110.95, 38.3]],
    'MapLibre must receive north-east before south-west',
  );

  const globalStyle = {
    sources: { pm: { tiles: ['https://tiles.gettrailhead.app/api/tiles/{z}/{x}/{y}.pbf'] } },
  };
  const oldConusStyle = {
    sources: {
      pm: {
        tiles: ['https://tiles.gettrailhead.app/api/tiles/{z}/{x}/{y}.pbf'],
        bounds: [-125, 24.5, -66.5, 49.5],
      },
    },
  };
  const alaska: [[number, number], [number, number]] = [[-168, 54.6], [-130, 71.4]];
  const canada: [[number, number], [number, number]] = [[-141, 41.7], [-52.6, 83.2]];
  const finland: [[number, number], [number, number]] = [[19.1, 59.4], [31.6, 70.2]];
  assert.equal(offlineStyleCoversBounds(globalStyle, alaska), true);
  assert.equal(offlineStyleCoversBounds(globalStyle, canada), true);
  assert.equal(offlineStyleCoversBounds(globalStyle, finland), true);
  assert.equal(offlineStyleCoversBounds(oldConusStyle, alaska), false);
  assert.equal(offlineStyleCoversBounds(oldConusStyle, canada), false);
  assert.equal(offlineStyleCoversBounds(oldConusStyle, finland), false);

  const adapterSource = readFileSync('components/NativeMap/offlineManager.ts', 'utf8');
  const workerSource = readFileSync('../cloudflare/wrangler-worker/src/worker.js', 'utf8');
  const offlineStyleStart = workerSource.indexOf('if (path === "/api/style.json")');
  const offlineStyleEnd = workerSource.indexOf('return Response.json(style', offlineStyleStart);
  assert.ok(offlineStyleStart >= 0 && offlineStyleEnd > offlineStyleStart);
  assert.doesNotMatch(
    workerSource.slice(offlineStyleStart, offlineStyleEnd),
    /bounds:\s*\[-125\.0,\s*24\.5,\s*-66\.5,\s*49\.5\]/,
    'the offline style must not constrain a global tile endpoint to CONUS',
  );
  assert.match(
    adapterSource,
    /renderer === 'rnmapbox' \? MapboxGL\.offlineManager : MapLibreGL\.offlineManager/,
  );
  assert.match(adapterSource, /renderer: NativeOfflineRenderer = 'maplibre'/);
  assert.match(adapterSource, /styleURLOverride\?: string/);
  assert.match(adapterSource, /const styleURL = styleURLOverride \|\| packStyleURI\(mapboxToken\)/);
  assert.match(
    adapterSource,
    /if \(!styleURLOverride\) \{[\s\S]*offlineStyleCoversBounds\(style, bounds\)/,
    'Trailhead custom styles retain their coverage verification',
  );
  assert.match(
    adapterSource,
    /renderer === 'rnmapbox' && mapboxToken[\s\S]*MapboxGL\.setAccessToken\(mapboxToken\)/,
    'RNMapbox pack creation receives the server-provided access token',
  );
  assert.match(adapterSource, /await manager\.createPack\(/);
  assert.match(adapterSource, /bounds: mapLibreOfflinePackBounds\(bounds\)/);
  const coverageCheckIndex = adapterSource.indexOf('offlineStyleCoversBounds(style, bounds)');
  const destructiveRestartIndex = adapterSource.indexOf('manager.deletePack(nativeName)');
  assert.ok(coverageCheckIndex >= 0 && destructiveRestartIndex > coverageCheckIndex,
    'style coverage must be proven before an existing native pack is replaced');

  console.log('Originals native offline-pack status tests passed.');
}

void main();
