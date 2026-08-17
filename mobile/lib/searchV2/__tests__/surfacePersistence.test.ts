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
const inlineMapSearchFieldSource = readFileSync(resolve(testDirectory, '../../../components/map/MapInlineSearchField.tsx'), 'utf8');
const mapSearchSheetSource = readFileSync(resolve(testDirectory, '../../../components/map/MapSearchSheet.tsx'), 'utf8');
const premiumPlaceSheetSource = readFileSync(resolve(testDirectory, '../../../components/PremiumPlaceSheet.tsx'), 'utf8');
const nativeMapSource = readFileSync(resolve(testDirectory, '../../../components/NativeMap/index.tsx'), 'utf8');
const routeReadySource = readFileSync(resolve(testDirectory, '../../../components/map/RouteBuildProgressSheet.tsx'), 'utf8');
const routeBuilderSearchSource = readFileSync(resolve(testDirectory, '../../../components/routeBuilder/RouteBuilderSearchSurface.tsx'), 'utf8');
const searchResultRowSource = readFileSync(resolve(testDirectory, '../../../components/search/SearchResultRowV2.tsx'), 'utf8');
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
  assert.match(inlineMapSearchFieldSource, /searching && !hasResults/);
  assert.match(mapSearchSheetSource, /searching && \(usingSearchV2 \? activeResults\.length === 0 : usableResults\.length === 0\)/);
  assert.match(searchSheetSource, /searchV2ShouldShowEmptyState\(\{[\s\S]*displayedQuery: query,[\s\S]*settledQuery,/);
  assert.match(exploreSource, /exploreSearchV2\.setQuery\(value\);/);
  assert.match(exploreSource, /settledQuery=\{exploreSearchV2\.state\.query\}/);
  assert.match(routeBuilderSource, /function updateRouteSearchQuery\(value: string\)[\s\S]*routeSearchV2\.setQuery\(value\);/);
  assert.match(routeBuilderSource, /emptyStateReady=\{routeSearchEmptyStateReady\}/);
  assert.doesNotMatch(searchSheetSource, /No matches yet/);
});

test('Map and Route Editor render server-ranked Search V2 rows until an explicit press', () => {
  assert.match(mapSource, /const mapSearchV2RenderResults = useMemo<SearchResultV2\[\]>/);
  assert.match(mapSource, /searchV2Results=\{searchV2Enabled \? mapSearchV2RenderResults : undefined\}/);
  assert.match(mapSearchSheetSource, /activeResults\.map\(result => \(/);
  assert.match(mapSearchSheetSource, /<SearchResultRowV2/);
  assert.match(routeBuilderSource, /searchV2Results=\{searchV2Enabled \? routeSearchV2RenderResults : undefined\}/);
  assert.match(routeBuilderSearchSource, /searchV2Results\.map\(result => \(/);
  assert.match(routeBuilderSearchSource, /onPress=\{\(\) => onSelectSearchV2\?\.\(result\)\}/);
  assert.match(searchResultRowSource, /Surfaces pass SearchResultV2 through/);
  assert.doesNotMatch(searchResultRowSource, /\.sort\(/);
  assert.doesNotMatch(searchResultRowSource, /Newer typing/);
});

test('Map routes durable search results to complete type-specific sheets', () => {
  assert.match(mapSource, /else if \(!searchPlaceIsTemporary\(basePlace\)\) \{[\s\S]{0,700}openPoiFeature\(/);
  assert.match(mapSource, /as unknown as OsmPoi, undefined, 'search'\);/);
  assert.match(mapSource, /mapTapToolOwnsFeatureSelection && selectionOrigin === 'map'/);
  assert.match(mapSource, /const canonicalTrail = poi\.type === 'trailhead'[\s\S]{0,320}poiSource === 'trailhead_search'/);
  assert.match(mapSource, /featureFromPoi\(poi, support, canonicalTrail \? 'trailhead' : 'osm'\)/);
  assert.match(premiumPlaceSheetSource, /isTransientMapboxPlace\(place\)/);
  assert.match(mapSource, /selectedCampRef\.current = downloadedCamp;/);
  assert.match(mapSource, /setCampDetail\(offlineV2CampPinToDetail\(downloadedCamp\)\)/);
  assert.match(mapSource, /else \{\s*selectedCampRef\.current = null;/);
  assert.match(mapSource, /setSelectedCommunityPin\(null\);\s*setSelectedPlace\(\{/);
  assert.match(mapSource, /function loadSelectedCampAmbient\(camp:[\s\S]{0,700}selectedCampRef\.current\?\.id === campId/);
  assert.doesNotMatch(mapSource, /then\(r => setCampFullness\(r\)\)/);
  assert.doesNotMatch(mapSource, /then\(r => setCampWeather\(r\)\)/);
});

test('Map search changes viewport scope only through the explicit Search this area action', () => {
  assert.match(mapSource, /function searchCurrentMapArea\(\)/);
  assert.match(mapSource, /setMapSearchViewportScope\(\{[\s\S]*north: bounds\.n,[\s\S]*west: bounds\.w,/);
  assert.match(mapSource, /scope: activeMapSearchQuickScope[\s\S]{0,140}mapSearchViewportScope \? 'viewport' as const : 'global' as const/);
  assert.match(mapSource, /testID="map\.search\.this-area"/);
  assert.match(mapSource, /onPress=\{searchCurrentMapArea\}/);
  assert.doesNotMatch(mapSource, /onBoundsChange=\{[\s\S]{0,900}searchCurrentMapArea\(/);
});

test('Map full search and nearby quick actions retain their requested mode and scope', () => {
  assert.match(mapSource, /mapSearchV2\.state\.query === normalizedQuery\) return;/);
  assert.match(mapSource, /<MapInlineSearchField[\s\S]{0,1200}onQueryChange=\{text =>/);
  assert.match(mapSource, /openOnPress=\{Platform\.OS === 'android'\}/);
  assert.match(mapSource, /onOpen=\{Platform\.OS === 'android' \? openFullMapSearch : focusInlineMapSearch\}/);
  assert.match(mapSource, /if \(!screenActivity\.isActive \|\| \(!inlineSearchOpen && !showFullMapSearch\) \|\| navMode\)/);
  assert.match(mapSource, /androidMapSearchKeyboardActive = androidMapSearchKeyboardCoversVisualWork\([\s\S]{0,160}showFullMapSearch/);
  assert.match(mapSource, /mapVisualTreeShouldRemainMounted\([\s\S]{0,100}mapVisuallyCovered/);
  assert.match(inlineMapSearchFieldSource, /const \[draftQuery, setDraftQuery\] = useState\(query\);/);
  assert.match(inlineMapSearchFieldSource, /openOnPress \? \(/);
  assert.match(inlineMapSearchFieldSource, /onPress=\{onOpen\}/);
  assert.match(inlineMapSearchFieldSource, /testID="map\.search\.inline\.input"/);
  assert.match(inlineMapSearchFieldSource, /accessibilityRole="button"/);
  assert.match(inlineMapSearchFieldSource, /accessibilityLabel="Search places or services"/);
  assert.match(inlineMapSearchFieldSource, /accessible=\{false\}/);
  assert.match(inlineMapSearchFieldSource, /importantForAccessibility="no"/);
  assert.match(inlineMapSearchFieldSource, /pointerEvents="none"/);
  assert.match(inlineMapSearchFieldSource, /onChangeText=\{updateDraft\}/);
  assert.match(inlineMapSearchFieldSource, /onSubmitEditing=\{submitDraft\}/);
  assert.match(inlineMapSearchFieldSource, /cancelPendingCommitRef\.current = scheduleMapSearchV2Query/);
  assert.match(inlineMapSearchFieldSource, /observedExternalQueryRef\.current = nextQuery;/);
  assert.match(inlineMapSearchFieldSource, /commitMapSearchV2QueryNow\(draftQuery,[\s\S]{0,260}onSubmitRef\.current\(nextQuery\);/);
  assert.match(mapSearchSheetSource, /const \[draftQuery, setDraftQuery\] = useState\(query\);/);
  assert.match(mapSearchSheetSource, /observedExternalQueryRef\.current = nextQuery;/);
  assert.match(mapSearchSheetSource, /commitMapSearchV2QueryNow\(draftQuery,[\s\S]{0,260}onSubmit\(nextQuery\);/);
  assert.match(mapSearchSheetSource, /onPress=\{\(\) => runQuickAction\(action\)\}/);
  assert.match(mapSearchSheetSource, /onPress=\{\(\) => submitRecent\(item\.name\)\}/);
  assert.match(mapSource, /function runMapQuickActionSearch\(action: MapSearchQuickAction\)/);
  assert.match(mapSource, /scope: 'nearby' as const,[\s\S]{0,260}radius_meters: quickScope\.radius_meters/);
  assert.match(mapSource, /mapSearchV2\.setContext\(nextContext, false\);[\s\S]{0,100}mapSearchV2\.search\(action\.query\)/);
  assert.match(mapSearchSheetSource, /const showFieldSpinner = searching && !hasUsefulRows;/);
  assert.match(mapSearchSheetSource, /testID="map\.search\.enriching"/);
  assert.match(mapSource, /categories: \['camp', 'camping', 'campground', 'campsite', 'rv', 'rv_park', 'dispersed_camp', 'overnight_parking'/);
});

test('Search surfaces prefer the offline FTS index and clear stale place modules', () => {
  for (const source of [mapSource, exploreSource, routeBuilderSource]) {
    assert.match(source, /searchExpoOfflineV2CatalogWithFallback\(/);
    assert.doesNotMatch(source, /if \(fallback\.length > 0\) return fallback;/);
  }
  assert.match(mapSource, /setSearchRouteCard\(null\);\s*setSelectedPlaceContext\(null\);\s*setSelectedPlaceTripContext/);
  const reloadOfflineInventory = mapSource.match(
    /const reloadOfflinePlacePois = useCallback\([\s\S]*?\n\s*useEffect\(\(\) => \{/,
  )?.[0] ?? '';
  assert.match(reloadOfflineInventory, /await mapSearchV2\.refreshOffline\(\);/);
  assert.doesNotMatch(reloadOfflineInventory, /inlineSearchOpen|showFullMapSearch/);
  assert.match(mapSource, /onOfflinePlacesChanged=\{reloadOfflinePlacePois\}/);
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

test('Search V2 place sheets keep a bounded, visible result body', () => {
  assert.match(premiumPlaceSheetSource, /sheetContent:\s*\{\s*padding:\s*0,\s*flex:\s*1,\s*minHeight:\s*0\s*\}/);
  assert.match(premiumPlaceSheetSource, /contentScroll:\s*\{\s*flex:\s*1,\s*minHeight:\s*0\s*\}/);
  assert.match(premiumPlaceSheetSource, /style=\{s\.contentScroll\}[\s\S]{0,360}testID=\{`\$\{sheetModel\.testID\}-content`\}/);
  assert.match(premiumPlaceSheetSource, /testID=\{sheetActionTestIDV1\(sheetModel\.testID, 'navigate'\)\}/);
  assert.match(premiumPlaceSheetSource, /label=\{sheetAction\('navigate'\)\?\.label \|\| 'Navigate'\}/);
  assert.match(premiumPlaceSheetSource, /onPress=\{\(\) => onNavigate\(place\)\}/);
  assert.match(premiumPlaceSheetSource, /testID=\{railTestID\}/);
  assert.match(premiumPlaceSheetSource, /testID=\{`\$\{railTestID\}\.item\.\$\{relatedTestIDPart\(item\.id \|\| item\.name \|\| idx\)\}`\}/);
  assert.match(premiumPlaceSheetSource, /accessibilityLabel=\{item\.name \|\| titleCase\(item\.type\)\}/);
  assert.match(premiumPlaceSheetSource, /onBack=\{onBack\}/);
  assert.match(mapSource, /const \[relatedPlaceReturnStack, setRelatedPlaceReturnStack\] = useState<RelatedPlaceReturnEntry\[\]>/);
  assert.match(mapSource, /function rememberRelatedPlaceParent\(\)/);
  assert.match(mapSource, /function restoreRelatedPlaceParent\(\)/);
  assert.match(mapSource, /onBack=\{relatedPlaceReturnStack\.length \? restoreRelatedPlaceParent : undefined\}/);
  assert.match(mapSource, /rememberRelatedPlaceParent\(\);[\s\S]{0,240}openNearbyPlace\(/);
});

test('temporary provider rows are not written to Map history or persisted by Route Builder', () => {
  const guardedHistoryWrites = mapSource.match(/if \(!searchPlaceIsTemporary\([^)]*\)\) \{\s*addSearchHistory/g) || [];
  assert.equal(guardedHistoryWrites.length, 3);
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

test('hidden Native Map pauses renderer work without erasing route or selection semantics', () => {
  assert.match(mapSource, /visualWorkActive=\{mapVisualWorkActive\}/);
  assert.match(mapSource, /visualTreeMounted=\{mapVisualTreeMounted\}/);
  assert.match(mapSource, /waypoints=\{waypoints\}/);
  assert.match(mapSource, /searchMarker=\{!mapMissionVisible && !trailPreviewOpen && searchRouteCard/);
  assert.match(mapSource, /routeBuildCoords=\{routeBuildSession\?\.routeCoords \?\? \[\]\}/);
  assert.match(mapSource, /originalsRouteCoords=\{originalsMapExperience\.routeCoords\}/);
  assert.doesNotMatch(mapSource, /waypoints=\{mapVisualWorkActive \? waypoints : \[\]\}/);
  assert.doesNotMatch(mapSource, /searchMarker=\{mapVisualWorkActive/);

  assert.match(nativeMapSource, /visualWorkActive\?: boolean;/);
  assert.match(nativeMapSource, /visualTreeMounted\?: boolean;/);
  assert.match(nativeMapSource, /preferredFramesPerSecond=\{visualWorkActive \? 60 : 1\}/);
  assert.match(nativeMapSource, /\{visualTreeMounted \? \(\s*<>[\s\S]*id="camps"/);
  assert.match(nativeMapSource, /if \(!visualWorkActiveRef\.current \|\| !feat\?\.properties \|\| !mapRef\.current\) return;/);
  assert.match(nativeMapSource, /tileProbeSeqRef\.current \+= 1;/);
  assert.match(nativeMapSource, /mvumFetchAbortRef\.current\?\.abort\(\);/);
  assert.match(nativeMapSource, /avaFetchAbortRef\.current\?\.abort\(\);/);
  assert.match(nativeMapSource, /radarFetchAbortRef\.current\?\.abort\(\);/);
  assert.match(nativeMapSource, /onBoundsChange\(\{ \.\.\.bounds, zoom: boundsZoomRef\.current \}\);/);
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
  assert.match(inlineMapSearchFieldSource, /testID="map\.search\.inline\.input"/);
  assert.match(mapSource, /testID="map\.compass"/);
  assert.match(mapSource, /testID="map\.navigation\.end"/);
  assert.match(mapSource, /testID="map\.navigation\.recenter"/);
  assert.match(searchSheetSource, /testID="search-v2\.input"/);
  assert.match(searchResultRowSource, /testID = `search-v2\.result\.\$\{result\.result_id\}`/);
  assert.match(mapSearchSheetSource, /testID="map\.search\.input"/);
  assert.match(routeBuilderSearchSource, /testID="route-builder\.search\.input"/);
  assert.match(routeBuilderSearchSource, /testID="route-builder\.search\.submit"/);
  assert.match(routeReadySource, /testID="map\.route-ready\.review-trip"/);
  assert.match(routeReadySource, /testID=\{`map\.route-ready\.\$\{action\.id\}`\}/);
});

test('Map downsamples every remote place, camp, optional trail photo, site, and gallery image before decode', () => {
  const imageTags = mapSource.match(/<Image\b[\s\S]*?\/>/g) || [];
  const remoteImageTags = imageTags.filter(tag => /source=\{\{\s*uri:/.test(tag));
  assert.ok(remoteImageTags.length >= 10, 'the Map surface still has representative remote image coverage');
  for (const tag of remoteImageTags) assert.match(tag, /resizeMethod="resize"/);
  assert.match(mapSource, /source=\{\{ uri: profilePhoto\.url \}\}[\s\S]*?resizeMethod="resize"/);
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
