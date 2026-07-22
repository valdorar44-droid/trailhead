import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const mapSource = readFileSync(resolve(testDirectory, '../../../app/(tabs)/map.tsx'), 'utf8');
const exploreSource = readFileSync(resolve(testDirectory, '../../../app/(tabs)/guide.tsx'), 'utf8');
const routeBuilderSource = readFileSync(resolve(testDirectory, '../../../app/(tabs)/route-builder.tsx'), 'utf8');
const searchSheetSource = readFileSync(resolve(testDirectory, '../../../components/search/SearchV2Sheet.tsx'), 'utf8');
const mapSearchSheetSource = readFileSync(resolve(testDirectory, '../../../components/map/MapSearchSheet.tsx'), 'utf8');
const premiumPlaceSheetSource = readFileSync(resolve(testDirectory, '../../../components/PremiumPlaceSheet.tsx'), 'utf8');
const nativeMapSource = readFileSync(resolve(testDirectory, '../../../components/NativeMap/index.tsx'), 'utf8');
const routeReadySource = readFileSync(resolve(testDirectory, '../../../components/map/RouteBuildProgressSheet.tsx'), 'utf8');
const routeBuilderSearchSource = readFileSync(resolve(testDirectory, '../../../components/routeBuilder/RouteBuilderSearchSurface.tsx'), 'utf8');
const mapDrawerSource = readFileSync(resolve(testDirectory, '../../../components/map/MapDrawerSheet.tsx'), 'utf8');
const mapFilterSource = readFileSync(resolve(testDirectory, '../../../components/map/MapFilterSheet.tsx'), 'utf8');
const mapLayerSource = readFileSync(resolve(testDirectory, '../../../components/map/MapLayerSheetContent.tsx'), 'utf8');
const mapLegendSource = readFileSync(resolve(testDirectory, '../../../components/map/MapLegendSheet.tsx'), 'utf8');
const mapStyleSource = readFileSync(resolve(testDirectory, '../../../components/map/MapStyleSheet.tsx'), 'utf8');

test('Map keeps account-owned offline inventory scoped and refreshes open Search V2 sessions', () => {
  assert.match(mapSource, /accountInventoryIsVisible\(/);
  assert.match(mapSource, /accountInventoryRequestIsCurrent\(/);
  assert.match(mapSource, /accountStorage\.isCleaning\(\) \|\| mapAccountTransitionBlocked/);
  assert.match(mapSource, /offlinePlaceInventoryRef\.current = nextInventory;/);
  assert.match(mapSource, /await mapSearchV2\.refreshOffline\(\);/);
});

test('Route Builder scopes places and trails, then refreshes Search V2 from the committed inventory refs', () => {
  assert.match(routeBuilderSource, /accountStorage\.isCleaning\(\) \|\| routeAccountTransitionBlocked/);
  assert.match(routeBuilderSource, /offlinePlaceInventoryRef\.current = nextInventory;/);
  assert.match(routeBuilderSource, /await routeSearchV2\.refreshOffline\(\);/);
  assert.match(routeBuilderSource, /setSavedTrailInventory\(\{[\s\S]*scope_key: requestScope\.key,/);
  assert.match(routeBuilderSource, /surface: 'route_editor' as const,[\s\S]*intent: 'any' as const,/);
  const directProviderHost = /nominatim[.]openstreetmap[.]org/i;
  assert.doesNotMatch(routeBuilderSource, directProviderHost);
  assert.doesNotMatch(mapSource, directProviderHost);
  assert.match(mapSource, /api\.geocodePlaces\(wp\.name, 1, \{ prefer: 'locality' \}\)/);
});

test('Explore hides account-owned rows during cleanup and rejects stale selections and offline commits', () => {
  assert.match(exploreSource, /accountInventoryRequiresCleanup\(/);
  assert.match(exploreSource, /accountInventoryIsVisible\(/);
  assert.match(exploreSource, /accountInventoryRequestIsCurrent\(/);
  assert.match(exploreSource, /exploreSearchOwnerIsCurrent = !exploreAccountLifecycle\.cleaning/);
  assert.match(exploreSource, /results=\{exploreSearchOwnerIsCurrent/);
  assert.match(exploreSource, /exploreOfflineInventoryRef\.current = emptyInventory;/);
  assert.match(exploreSource, /exploreSearchSelectionSeq\.current \+= 1;/);
});

test('Map and Explore retain useful rows while provider completion is still running', () => {
  assert.match(mapSource, /isSearching && mapSearchDisplayResults\.length === 0/);
  assert.match(mapSearchSheetSource, /searching && usableResults\.length === 0/);
  assert.match(searchSheetSource, /searchV2ShouldShowEmptyState\(\{[\s\S]*displayedQuery: query,[\s\S]*settledQuery,/);
  assert.match(exploreSource, /exploreSearchV2\.setQuery\(value\);/);
  assert.match(exploreSource, /settledQuery=\{exploreSearchV2\.state\.query\}/);
  assert.match(routeBuilderSource, /function updateRouteSearchQuery\(value: string\)[\s\S]*routeSearchV2\.setQuery\(value\);/);
  assert.match(routeBuilderSource, /emptyStateReady=\{routeSearchEmptyStateReady\}/);
  assert.doesNotMatch(searchSheetSource, /No matches yet/);
});

test('temporary place sheets expose session-safe actions only', () => {
  assert.match(premiumPlaceSheetSource, /const transientPlace = place \? isTransientMapboxPlace\(place\) : false;/);
  assert.match(premiumPlaceSheetSource, /!!onSave && !transientPlace/);
  assert.match(premiumPlaceSheetSource, /addToRoutePrimary && !!onAddToRoute && !transientPlace/);
  assert.match(premiumPlaceSheetSource, /!!onAddToRoute && !addToRoutePrimary && !transientPlace/);
  assert.match(premiumPlaceSheetSource, /!!onReport && !transientPlace/);
  const guardedCommunityBlocks = premiumPlaceSheetSource.match(/stage === 'full' && !transientPlace && \(/g) || [];
  assert.equal(guardedCommunityBlocks.length, 2);
});

test('temporary provider rows are not written to Map history or persisted by Route Builder', () => {
  const guardedHistoryWrites = mapSource.match(/if \(!searchPlaceIsTemporary\([^)]*\)\) \{\s*addSearchHistory/g) || [];
  assert.equal(guardedHistoryWrites.length, 2);
  assert.match(routeBuilderSource, /const temporaryProviderStop = inputStops\.find\(stop => searchPlaceIsTemporary\(stop\)\);/);
  assert.match(routeBuilderSource, /temporaryProviderStop[\s\S]*cannot be saved/);
});

test('Route Builder persists only resolved durable external destinations and keeps attribution', () => {
  assert.match(routeBuilderSource, /persistence_policy: wp\.search_source \? 'durable_external'/);
  assert.match(routeBuilderSource, /st\.persistence_policy === 'durable_external'/);
  assert.match(routeBuilderSource, /attribution: st\.source_attribution \|\| 'OpenStreetMap contributors'/);
  assert.match(routeBuilderSource, /That place is no longer available\. Search again or drop a pin\./);
});

test('Map lazy-loads the renderer once and keeps the mounted presentation on warm returns', () => {
  assert.match(mapSource, /import type \{ NativeMapDebugEvent, NativeMapHandle \} from '@\/components\/NativeMap';/);
  assert.match(mapSource, /const \[mapRendererHasMounted, setMapRendererHasMounted\] = useState\(screenActivity\.isActive\);/);
  assert.match(mapSource, /const mapRendererPresentationMounted = mapRendererHasMounted \|\| screenActivity\.isActive;/);
  assert.match(mapSource, /mapRendererPresentationMounted && useNativeMapSurface \? getNativeMapComponent\(\) : null/);
  assert.match(mapSource, /mapRendererPresentationMounted && !useNativeMapSurface \? getFallbackWebViewComponent\(\) : null/);
  assert.match(mapSource, /if \(screenActivity\.isActive\) setMapRendererHasMounted\(true\);/);
  assert.match(mapSource, /showOfflineModal \|\| offlineModalComponent/);
  assert.match(mapSource, /require\('\.\.\/\.\.\/components\/NativeMap\/OfflineModal'\)/);
  assert.doesNotMatch(mapSource, /testID="map\.renderer-suspended"/);
  assert.doesNotMatch(mapSource, /if \(!mapRendererPresentationMounted\) \{\s*return/);
  assert.doesNotMatch(mapSource, /if \(!screenActivity\.isActive\) setMapSurfaceReady\(false\)/);
  assert.match(mapSource, /const \[selectedPlace, setSelectedPlace\] = useState/);
  assert.match(mapSource, /const routeBuildSession = useStore\(st => st\.routeBuildSession\);/);
  assert.doesNotMatch(mapSource, /^import NativeMap,/m);
  assert.doesNotMatch(mapSource, /^import OfflineModal,/m);
  assert.doesNotMatch(mapSource, /const WebView: any =/);
});

test('Native Map initializes only the selected renderer and keeps POI taps in native style layers', () => {
  assert.doesNotMatch(nativeMapSource, /^import MapboxGL from/m);
  assert.doesNotMatch(nativeMapSource, /^import MapLibreGL from/m);
  assert.match(nativeMapSource, /require\('@rnmapbox\/maps'\)/);
  assert.match(nativeMapSource, /require\('@maplibre\/maplibre-react-native'\)/);
  assert.match(nativeMapSource, /const MapGL: any = useMemo/);
  assert.match(nativeMapSource, /<MapGL\.ShapeSource\s+id="gas"[\s\S]*onGasTap/);
  assert.match(nativeMapSource, /<MapGL\.ShapeSource\s+id="pois"[\s\S]*onPoiTap/);
  assert.doesNotMatch(nativeMapSource, /gas\.slice\(0, 60\)\.map/);
  assert.doesNotMatch(nativeMapSource, /pois\.slice\(0, 70\)\.map/);
});

test('Map, Search V2, Route Editor, and route-ready actions expose stable automation IDs', () => {
  assert.match(mapSource, /testID="map\.screen"/);
  assert.match(mapSource, /testID="map\.search\.inline\.input"/);
  assert.match(mapSource, /testID="map\.compass"/);
  assert.match(mapSource, /testID="map\.navigation\.end"/);
  assert.match(mapSource, /testID="map\.navigation\.recenter"/);
  assert.match(searchSheetSource, /testID="search-v2\.input"/);
  assert.match(searchSheetSource, /testID=\{`search-v2\.result\.\$\{result\.result_id\}`\}/);
  assert.match(mapSearchSheetSource, /testID="map\.search\.input"/);
  assert.match(routeBuilderSearchSource, /testID="route-builder\.search\.input"/);
  assert.match(routeBuilderSearchSource, /testID="route-builder\.search\.submit"/);
  assert.match(routeReadySource, /testID="map\.route-ready\.review-trip"/);
  assert.match(routeReadySource, /testID=\{`map\.route-ready\.\$\{action\.id\}`\}/);
});

test('Map downsamples every remote place, camp, trail, site, and gallery image before decode', () => {
  const imageTags = mapSource.match(/<Image\b[\s\S]*?\/>/g) || [];
  const remoteImageTags = imageTags.filter(tag => /source=\{\{\s*uri:/.test(tag));
  assert.ok(remoteImageTags.length >= 10, 'the Map surface still has representative remote image coverage');
  for (const tag of remoteImageTags) assert.match(tag, /resizeMethod="resize"/);
  assert.match(mapSource, /resizeMethod=\{heroUri \? 'resize' : undefined\}/);
});

test('Map drawer, filters, layers, styles, and legend expose stable automation IDs', () => {
  assert.match(mapDrawerSource, /testID="map\.drawer\.sheet"/);
  assert.match(mapDrawerSource, /testID=\{`map\.drawer\.\$\{action\.id\}`\}/);
  assert.match(mapFilterSource, /testID="map\.filters\.sheet"/);
  assert.match(mapFilterSource, /testID=\{`map\.filters\.section\.\$\{id\}`\}/);
  assert.match(mapFilterSource, /testID=\{`map\.filters\.option\.\$\{item\.id\}`\}/);
  assert.match(mapLayerSource, /testID="map\.layers\.content"/);
  assert.match(mapLayerSource, /testID=\{`map\.layers\.toggle\.\$\{layer\.key\}`\}/);
  assert.match(mapStyleSource, /testID="map\.styles\.sheet"/);
  assert.match(mapLegendSource, /testID="map\.legend\.sheet"/);
  assert.match(mapLegendSource, /testID=\{`map\.legend\.category\.\$\{category\.id\}`\}/);
});
