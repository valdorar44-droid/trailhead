import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve('components/NativeMap/OfflineModal.tsx'), 'utf8');
const mapSource = fs.readFileSync(path.resolve('app/(tabs)/map.tsx'), 'utf8');
const nativeManagerSource = fs.readFileSync(path.resolve('components/NativeMap/offlineManager.ts'), 'utf8');
const tripsSource = fs.readFileSync(path.resolve('app/(tabs)/trips.tsx'), 'utf8');
const trailPackSource = fs.readFileSync(path.resolve('lib/offlineV2/trailPack.ts'), 'utf8');

const tripV2Start = source.indexOf('if (v2BoundsSupported) {');
const tripV2End = source.indexOf('const key = tripPackKey(target);', tripV2Start);
assert.ok(tripV2Start >= 0 && tripV2End > tripV2Start, 'V2 trip branch exists');
const tripV2Block = source.slice(tripV2Start, tripV2End);
assert.match(
  tripV2Block,
  /void downloadTripPlaces\(target\);/,
  'V2 trip downloads preserve the existing camps/essentials place pack',
);
assert.doesNotMatch(
  tripV2Block,
  /routing:\s*true/,
  'V2 routing is not requested until navigation consumes and verifies the artifact',
);

const regionPlacesStart = source.indexOf('const downloadRegionPlaces = useCallback');
const regionPlacesEnd = source.indexOf('const downloadRegionBundle = useCallback', regionPlacesStart);
const regionPlacesBlock = source.slice(regionPlacesStart, regionPlacesEnd);
assert.match(regionPlacesBlock, /missingRegionPlacePackEntries\(/);

const regionBundleStart = regionPlacesEnd;
const regionBundleEnd = source.indexOf('const regionSummaries = useMemo', regionBundleStart);
const regionBundleBlock = source.slice(regionBundleStart, regionBundleEnd);
assert.match(regionBundleBlock, /void downloadRegionPlaces\(regionId\);/);
assert.match(regionBundleBlock, /startRoutingDownload\(regionId\)/);
assert.match(regionBundleBlock, /startTrailDownload\(regionId\)/);
assert.doesNotMatch(
  regionBundleBlock,
  /startContourDownload\(regionId\)/,
  'topographic lines remain a separate user-selected artifact',
);

assert.match(source, /v2ConsumerKindsReady\(v2Job, offlineV2OwnerScope, \['search_index'\]\)/);
assert.match(source, /job\.manifest\.renderer\.style_id === activeRendererStyleId/);
assert.match(source, /renderer_style_id: activeRendererStyleId!/);
assert.match(source, /isTrailPackClientRefV2\(job\.client_ref\)/);
assert.match(source, /id: `trailpack:\$\{job\.job_id\}`/);
assert.match(source, /job\.manifest\) await runtime\.remove\(job\.manifest\.bundle_id\)/);
assert.match(source, /getInstalledPacks\(activeNativeRenderer\)/);
assert.doesNotMatch(
  source,
  /Promise\.all\(\[\s*getInstalledPacks\('maplibre'\)[\s\S]*getInstalledPacks\('rnmapbox'\)/,
  'opening Downloads must not initialize the inactive native renderer just to inventory its packs',
);
assert.match(source, /!pack\.name\.startsWith\('trailhead-original:'\)/);
assert.match(source, /activeNativeRenderer,\s*\n\s*\);/);
assert.match(mapSource, /activeNativeRenderer=\{mapRendererMode === 'mapbox' \? 'rnmapbox' : 'maplibre'\}/);
assert.match(mapSource, /legacyNativePackCompatible=\{[\s\S]*mapLayer !== 'satellite'[\s\S]*mapLayer !== 'hybrid'[\s\S]*mapLayer !== 'extreme'[\s\S]*!map3dEnabled/);
assert.match(nativeManagerSource, /renderer === 'rnmapbox' \? MapboxGL\.offlineManager : MapLibreGL\.offlineManager/);
assert.match(nativeManagerSource, /mapLibreOfflinePackBounds\(bounds\)/);
assert.doesNotMatch(
  source,
  /directionsReady = Boolean\(v2Job\?\.manifest\?\.capabilities\.routing/,
  'V2 routing is not advertised until navigation has a real artifact consumer',
);
assert.doesNotMatch(source, /C\.green/, 'offline success and selection treatments use Trailhead orange');
assert.match(
  source,
  /const PLACE_PACK_ORDER = \['essentials', 'services', 'outdoors', 'camps', 'water', 'trek_places'\];/,
  'all six existing place-pack families remain in the offline inventory',
);
for (const existingArtifact of [
  'getInstalledPacks',
  'getOfflineTripSummaries',
  'getRoutingState',
  'getTrailState',
  'getContourState',
  'listOfflinePlacePacks',
  'offlineV2Jobs',
]) {
  assert.match(source, new RegExp(`\\b${existingArtifact}\\b`), `offline manager preserves ${existingArtifact}`);
}
assert.match(tripsSource, /setPendingOfflineReturnContext\(\{[\s\S]*source: 'plan',[\s\S]*section: 'downloads',[\s\S]*scrollY: planScrollYRef\.current,/);
assert.match(mapSource, /planDownloadsReturnRequest\(pendingOfflineReturnContext, reason\)/);
assert.match(mapSource, /return_scroll_y: String\(destination\.scrollY\)/);
assert.match(mapSource, /createTrailPackRequestV2\(\{/);
assert.match(trailPackSource, /renderer_style_id:\s*TRAIL_PACK_STYLE_ID/);
assert.match(trailPackSource, /routing:\s*false,\s*contours:\s*false/);
assert.match(mapSource, /api\.authorizeOfflineDownload\(assetType, id, label\)/);
assert.match(mapSource, /trailOfflineFiles\.startRoutingDownload/);
assert.match(mapSource, /trailOfflineFiles\.startContourDownload/);
assert.match(mapSource, /trailOfflineFiles\.startTrailDownload/);
assert.match(source, /Finishing routing and terrain/);
assert.match(source, /onClose\('dismiss'\)/, 'dismissing the manager can restore its Plan origin');
assert.match(source, /onClose\('open_map'\)/, 'opening downloaded content intentionally remains on Map');

const selectedAreaStart = source.indexOf('const downloadSelectedArea = useCallback');
const selectedAreaEnd = source.indexOf('const downloadRegionPlaces = useCallback', selectedAreaStart);
const selectedAreaBlock = source.slice(selectedAreaStart, selectedAreaEnd);
assert.ok(selectedAreaStart >= 0 && selectedAreaEnd > selectedAreaStart, 'selected-area download branch exists');
assert.ok(
  selectedAreaBlock.indexOf('onSaveArea?.(selectedArea);')
    < selectedAreaBlock.indexOf('await runtime.create({'),
  'selected-area identity is durable before asynchronous V2 preparation begins',
);
assert.match(
  selectedAreaBlock,
  /if \(useNativeMap && \(activeRendererStyleId \|\| !legacyNativePackCompatible\)\)/,
  'an exact Mapbox style never falls back to a mismatched legacy Trailhead pack',
);
assert.match(source, /const v2Ready = v2MapReady && v2ConsumersReady;/);
assert.match(source, /ready: v2Ready,\s*\n\s*mapReady,/);
assert.match(source, /item\.mapReady \? 'Map saved' : 'Download incomplete'/);
const areaDetailStart = source.indexOf('const renderAreaDetail = () =>');
const areaDetailEnd = source.indexOf('const renderTripDetail = () =>', areaDetailStart);
const areaDetailBlock = source.slice(areaDetailStart, areaDetailEnd);
assert.match(
  areaDetailBlock,
  /const showPlaceTrailRow = v2Job\?\.manifest[\s\S]*: offlineV2DownloadEnabled;/,
  'places and trails are advertised only for a compatible or installed V2 bundle',
);
assert.match(
  areaDetailBlock,
  /const showSearchRow = v2Job\?\.manifest[\s\S]*: offlineV2DownloadEnabled;/,
  'offline search is advertised only for a compatible or installed V2 bundle',
);
assert.match(
  areaDetailBlock,
  /v2Job\?\.manifest \|\| offlineV2DownloadEnabled \? 'Map & terrain' : 'Map only'/,
  'legacy selected-area downloads are labelled Map only',
);

const removeAreaStart = source.indexOf('const removeAreaDownloadNow = useCallback');
const removeAreaEnd = source.indexOf('const removeDeviceItem = useCallback', removeAreaStart);
const removeAreaBlock = source.slice(removeAreaStart, removeAreaEnd);
assert.match(
  removeAreaBlock,
  /if \(v2Job\.manifest\) await runtime\.remove\(v2Job\.manifest\.bundle_id\);/,
);
assert.match(removeAreaBlock, /else await runtime\.cancel\(v2Job\.job_id\);/);
assert.match(
  removeAreaBlock,
  /await removeAreaNow\(area\);/,
  'explicit selected-area removal clears any coexisting legacy pack after V2 removal',
);
const removeDeviceStart = removeAreaEnd;
const removeDeviceEnd = source.indexOf('const removeConfirmedItems = useCallback', removeDeviceStart);
const removeDeviceBlock = source.slice(removeDeviceStart, removeDeviceEnd);
assert.match(
  removeDeviceBlock,
  /if \(area\) return removeAreaDownloadNow\(area\);/,
  'bulk storage removal uses the same aggregated V2 and legacy cleanup path',
);
assert.match(source, /The downloaded offline content is removed from this device\./);

console.log('Offline modal parity tests passed.');
