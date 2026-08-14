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
  assert.match(adapter, /scheduleVerification\(\)/);
  assert.match(adapter, /observation\.complete && pack/);
  assert.match(adapter, /Offline map download paused\. Check your connection and retry\./);
  assert.doesNotMatch(
    adapter,
    /onComplete[\s\S]{0,160}ready:\s*true/,
    'a native completion callback alone must not mark an Original map ready',
  );
  assert.match(adapter, /pausePack\(name, renderer\)/);
  assert.match(
    adapter,
    /message => finish[\s\S]*renderer,\s*\n\s*originalOfflineStyleURI\(renderer\),\s*\n\s*\)/,
    'the Original pack binds RNMapbox to its approved offline style',
  );
  assert.match(adapter, /pack_id: mapPackReference\(renderer, name\)/);
  assert.match(adapter, /bytes: exact\.completedResourceSize/);
  assert.doesNotMatch(
    adapter,
    /Math\.round\((?:ready|pack|progress)\.sizeMb \* 1_048_576\)/,
    'exact native bytes are never reconstructed from display megabytes',
  );
  assert.match(adapter, /reference\.renderer && reference\.renderer !== activeRenderer/);
  assert.match(adapter, /pack\.renderer === renderer/);
  assert.match(adapter, /async inspectStrict\(packId\)/);
  assert.match(adapter, /mapPackReference\(reference\.renderer, reference\.name\) !== packId/);
  assert.match(
    adapter,
    /inspectInstalledPackStrict\(\s*reference\.name,\s*reference\.renderer,\s*\)/,
    'strict inspection remains bound to the persisted renderer and logical name',
  );
  assert.match(adapter, /installed\.completedResourceSize <= 0/);
  assert.match(adapter, /deletePack\(name, 'maplibre'\)/);
  assert.match(adapter, /deletePack\(name, 'rnmapbox'\)/);

  const manager = readFileSync('components/NativeMap/offlineManager.ts', 'utf8');
  assert.match(manager, /async function inspectInstalledPackStrict/);
  assert.match(manager, /const nativeName = physicalPackName\(name, renderer\)/);
  assert.match(manager, /installedOfflinePackStatusStrict\(packs \?\? \[\], nativeName\)/);
  assert.match(manager, /completedResourceSize,/);

  const map = readFileSync('app/(tabs)/map.tsx', 'utf8');
  assert.match(map, /setActiveNativeMapRenderer\(renderer\)/);
  assert.match(map, /resolveOriginalMainMapPresentation/);
  assert.match(map, /originalMapPresentation\.rendererMode === 'mapbox' \? 'rnmapbox' : 'maplibre'/);
  assert.match(map, /mapLayer=\{originalMapPresentation\.mapLayer\}/);
  assert.match(map, /premiumMapStyle=\{originalMapPresentation\.premiumMapStyle\}/);
  assert.match(map, /rendererMode=\{originalMapPresentation\.rendererMode \?\? 'maplibre'\}/);
  assert.match(map, /cameraOwnership=\{mapCameraOwnership\}/);
  assert.match(map, /consumeMapCameraClaim\(/);
  assert.match(map, /setMapStyleGeneration\(generation => generation \+ 1\)/);
  assert.match(map, /mapCameraOwnership\.owner === 'originals'/);
  assert.doesNotMatch(map, /setTimeout\(fitOriginalsRoute,\s*180\)/);

  const nativeMap = readFileSync('components/NativeMap/index.tsx', 'utf8');
  assert.match(nativeMap, /onMapStyleLoaded\?: \(\) => void/);
  assert.match(nativeMap, /cameraOwnership\?: MapCameraOwnership/);
  assert.match(nativeMap, /initialCameraBounds\?: \{/);
  assert.match(nativeMap, /cameraOwnershipRef\.current\.blocksRecentViewport/);
  assert.match(nativeMap, /camera:restore-browse-owner/);
  assert.match(nativeMap, /pendingBrowseCameraRestoreRef\.current/);
  assert.match(nativeMap, /onDidFinishLoadingStyle=\{\(\) => \{[\s\S]*onMapStyleLoaded\?\.\(\)/);

  const routeMap = readFileSync('components/originals/OriginalRouteMap.tsx', 'utf8');
  assert.match(routeMap, /createMapCameraOwnership\('originals', `original-route-preview:\$\{routeSignature\}`\)/);
  assert.match(routeMap, /cameraOwnership=\{routeCameraOwnership\}/);
  assert.match(routeMap, /initialCameraBounds=\{initialCameraBounds\}/);
  assert.match(routeMap, /ne: \[Math\.max\(\.\.\.lngs\), Math\.max\(\.\.\.lats\)\]/);
  assert.match(routeMap, /sw: \[Math\.min\(\.\.\.lngs\), Math\.min\(\.\.\.lats\)\]/);
  assert.match(routeMap, /mapLayer="extreme"/);
  assert.match(routeMap, /premiumMapStyle="outdoors"/);
  assert.match(routeMap, /rendererMode="mapbox"/);
  assert.match(routeMap, /storage\.get\('trailhead_mapbox_token'\)/);
  assert.match(routeMap, /api\.getConfig\(\)/);
  assert.match(routeMap, /prepareNativeMapboxRenderer\(token\)/);
  assert.match(routeMap, /mapCredentialState !== 'ready'/);
  assert.match(routeMap, /Preparing route preview/);
  assert.match(
    routeMap,
    /if \(mapCredentialState !== 'ready'\)[\s\S]*return \([\s\S]*Preparing route preview[\s\S]*<NativeMap/,
    'the cold-link preview must not mount RNMapbox before its token is installed',
  );
  assert.match(routeMap, /onLayout=\{\(event\) => \{/);
  assert.match(routeMap, /onMapStyleLoaded=\{\(\) => setStyleGeneration/);
  assert.match(routeMap, /if \(!mapReadyRef\.current \|\| !layoutReadyRef\.current \|\| styleGeneration <= 0\) return/);
  assert.match(routeMap, /const fitKey = `\$\{routeSignature\}:\$\{styleGeneration\}`/);
  assert.doesNotMatch(routeMap, /setTimeout\(fitAuthoredRoute/);
  assert.match(
    nativeMap,
    /defaultSettings=\{initialBoundsCameraDefaultRef\.current \?\? freeCameraDefaultRef\.current\}/,
  );

  console.log('Originals/main-map renderer binding tests passed.');
}

void main();
