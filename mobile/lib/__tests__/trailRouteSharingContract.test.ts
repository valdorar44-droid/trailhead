import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAccountStorageLifecycle } from '../accountStorageLifecycle';

test('private preview renders route locally and never encodes geometry in a Static Images URL', () => {
  const flow = readFileSync('components/trails/TrailRouteSharingFlow.tsx', 'utf8');
  const preview = readFileSync('components/trails/PrivateTrailRouteMap.tsx', 'utf8');
  const staticPreview = readFileSync('components/explore/StaticMapboxPreview.tsx', 'utf8');
  assert.match(flow, /<PrivateTrailRouteMap[\s\S]*coordinates=\{previewCoordinates\}/);
  assert.match(preview, /routeBuildCoords=\{route\}/);
  assert.match(preview, /suppressFeatureTaps/);
  assert.doesNotMatch(preview, /api\.mapbox\.com\/styles\/v1/);
  assert.doesNotMatch(staticPreview, /geojson\(/);
  assert.doesNotMatch(staticPreview, /route\?: readonly/);
});

test('shared bearer token remains transient and anonymous resolution strips account auth', () => {
  const api = readFileSync('lib/api.ts', 'utf8');
  const layout = readFileSync('app/_layout.tsx', 'utf8');
  const store = readFileSync('lib/store.ts', 'utf8');
  const recipient = readFileSync('app/shared-trails.tsx', 'utf8');
  assert.match(api, /reqWithToken<SharedTrailRouteV1>[\s\S]*trail-routes\/shared\/resolve[\s\S]*}, null\)/);
  assert.match(layout, /handoffSharedTrailToken\(appLink\.shareToken\)[\s\S]*router\.push\('\/shared-trails'/);
  assert.doesNotMatch(layout, /pathname:\s*'\/shared-trails'[\s\S]*token/);
  assert.doesNotMatch(store, /shareToken:\s*string/);
  assert.match(recipient, /consumeSharedTrailToken\(\)/);
  assert.doesNotMatch(recipient, /useLocalSearchParams/);
});

test('recording path reaches privacy review through a coordinate-only conversion', () => {
  const map = readFileSync('app/(tabs)/map.tsx', 'utf8');
  assert.match(map, /listTrailRecordingPoints\(completed\.id\)/);
  assert.match(map, /offlineTrailFromRecordingForPrivacyReview/);
  assert.match(map, /text: 'Review & share'/);
  assert.match(map, /<TrailRouteSharingFlow[\s\S]*trail=\{recordingTrailToShare\}/);
});

test('Plan Saved items expose owner-route sharing without restoring the retired Route Builder hub', () => {
  const trips = readFileSync('app/(tabs)/trips.tsx', 'utf8');
  const savedItems = readFileSync('components/trips/SavedItemsSection.tsx', 'utf8');
  const routeBuilder = readFileSync('app/(tabs)/route-builder.tsx', 'utf8');
  assert.match(trips, /features\?\.private_trail_routes/);
  assert.match(trips, /ownerTrailRoutesBySavedEntityId/);
  assert.match(trips, /<SavedItemsSection[\s\S]*shareableItemIds=\{shareableSavedItemIds\}[\s\S]*onShare=/);
  assert.match(trips, /<TrailRouteSharingFlow[\s\S]*trail=\{trailRouteToShare\}/);
  assert.match(savedItems, /testID=\{`plan\.saved\.share\.\$\{item\.id\}`\}/);
  assert.doesNotMatch(routeBuilder, /setRouteTabMode\('hub'\)/);
});

test('recipient opens the immutable shared revision without exposing Trail Builder', () => {
  const map = readFileSync('app/(tabs)/map.tsx', 'utf8');
  const handoff = map.slice(map.indexOf('if (!pendingSharedTrailRoute'), map.indexOf('if (!pendingMapSelection'));
  assert.match(handoff, /setTrailRouteBuilderOpen\(false\)/);
  assert.doesNotMatch(handoff, /setTrailRouteBuilderOpen\(true\)/);
  assert.doesNotMatch(handoff, /setTrailBuilderDirty\(true\)/);
});

test('shared route Map return restores the view-only recipient without retaining the bearer token', () => {
  const map = readFileSync('app/(tabs)/map.tsx', 'utf8');
  const recipient = readFileSync('app/shared-trails.tsx', 'utf8');
  const handoff = readFileSync('lib/sharedTrailLinkHandoff.ts', 'utf8');
  assert.match(map, /sharedTrailMapReturnRef\.current[\s\S]*router\.back\(\)/);
  assert.match(recipient, /rememberSharedTrailRecipientRoute\(route\)[\s\S]*setPendingSharedTrailRoute\(route\)/);
  assert.match(recipient, /readSharedTrailRecipientRoute\(\)/);
  assert.doesNotMatch(handoff, /recipientRoute[\s\S]*AsyncStorage|recipientRoute[\s\S]*SecureStore/);
});

test('queued Account A write cannot start after Account B cleanup advances the epoch', async () => {
  const lifecycle = createAccountStorageLifecycle({
    get: async () => null,
    set: async () => {},
    del: async () => {},
  });
  let release!: () => void;
  const blocker = new Promise<void>(resolve => { release = resolve; });
  const first = lifecycle.run(async () => { await blocker; return true; }, lifecycle.epoch());
  let staleWriteRan = false;
  const oldEpoch = lifecycle.epoch();
  const stale = lifecycle.run(async () => { staleWriteRan = true; return true; }, oldEpoch);
  const cleanup = lifecycle.beginCleanup();
  release();
  await Promise.all([first, stale, cleanup]);
  assert.equal(staleWriteRan, false);
});

test('every private-route local save uses an expected account epoch and owner guard', () => {
  const offline = readFileSync('lib/offlineTrails.ts', 'utf8');
  const map = readFileSync('app/(tabs)/map.tsx', 'utf8');
  const builder = readFileSync('app/(tabs)/route-builder.tsx', 'utf8');
  const recipient = readFileSync('app/shared-trails.tsx', 'utf8');
  assert.match(offline, /saveOfflineTrailForAccountScope[\s\S]*expectedEpoch[\s\S]*ownerScopeIsCurrent/);
  assert.match(map, /saveOfflineTrailForAccountScope/);
  assert.match(builder, /saveOfflineTrailForAccountScope/);
  assert.match(recipient, /saveOfflineTrailForAccountScope/);
});

test('sharing copy stays free of mojibake and implementation labels', () => {
  const files = [
    'components/trails/TrailRouteSharingFlow.tsx',
    'components/trails/PrivateTrailRouteMap.tsx',
    'app/shared-trails.tsx',
    'lib/trailRouteSharing.ts',
  ];
  const source = files.map(file => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /Ã|Â|â€™|â€“|provider slug|artificial intelligence|AI[- ]/i);
});
