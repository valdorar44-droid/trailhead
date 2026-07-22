import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resetActiveNativeMapRendererForTests,
  resolveActiveNativeMapRenderer,
  setActiveNativeMapRenderer,
} from '../../nativeMapRendererState';
import { mapPackReference, parseMapPackReference } from '../mapAdapter';

async function main() {
  resetActiveNativeMapRendererForTests();
  assert.equal(
    await resolveActiveNativeMapRenderer(async () => 'pk.cached-token'),
    'rnmapbox',
  );

  resetActiveNativeMapRendererForTests();
  assert.equal(
    await resolveActiveNativeMapRenderer(async () => null),
    'maplibre',
  );

  setActiveNativeMapRenderer('rnmapbox');
  assert.equal(
    await resolveActiveNativeMapRenderer(async () => null),
    'rnmapbox',
    'the renderer locked by the main map wins over cold-start fallback data',
  );

  const logicalName = 'trailhead-original:moab:1:island-in-the-sky';
  const persistentReference = mapPackReference('rnmapbox', logicalName);
  assert.deepEqual(parseMapPackReference(persistentReference), {
    renderer: 'rnmapbox',
    name: logicalName,
  });
  assert.deepEqual(parseMapPackReference(logicalName), {
    renderer: null,
    name: logicalName,
  }, 'pre-1.0.10 records remain readable and are verified against the active renderer');

  const adapter = readFileSync('lib/originals/mapAdapter.ts', 'utf8');
  assert.match(adapter, /getInstalledPacks\(renderer\)/);
  assert.match(adapter, /pausePack\(name, renderer\)/);
  assert.match(adapter, /message => finish[\s\S]*renderer,\s*\n\s*\)/);
  assert.match(adapter, /pack_id: mapPackReference\(renderer, name\)/);
  assert.match(adapter, /reference\.renderer && reference\.renderer !== activeRenderer/);
  assert.match(adapter, /pack\.renderer === renderer/);
  assert.match(adapter, /deletePack\(name, 'maplibre'\)/);
  assert.match(adapter, /deletePack\(name, 'rnmapbox'\)/);

  const map = readFileSync('app/(tabs)/map.tsx', 'utf8');
  assert.match(map, /setActiveNativeMapRenderer\(renderer\)/);
  assert.match(map, /mapRendererMode === 'mapbox' \? 'rnmapbox' : 'maplibre'/);

  console.log('Originals/main-map renderer binding tests passed.');
}

void main();
