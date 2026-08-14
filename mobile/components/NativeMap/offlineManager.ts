/**
 * Native offline tile pack management via @maplibre/maplibre-react-native.
 *
 * Replaces the WebView Cache API approach with native MLNOfflineStorage
 * (iOS) / OfflineRegionManager (Android). Packs are downloaded once and
 * stored on-device — no connection needed to view cached areas.
 *
 * Key difference from the WebView approach: tile management is handled by
 * the native SDK. No manual Cache API writes, no manifest tracking,
 * no per-tile download loop. The SDK handles resume on failure, quota, etc.
 */
import MapLibreGL from '@maplibre/maplibre-react-native';
import MapboxGL from '@rnmapbox/maps';
import {
  installedOfflinePackStatusStrict,
  installedOfflinePackStatuses,
  mapLibreOfflinePackBounds,
  offlineStyleCoversBounds,
} from './offlinePackStatus';

// Internal bounds format: [[westLng, southLat], [eastLng, northLat]].
// Convert at the MapLibre boundary; its createPack API expects [NE, SW].
export type PackBounds = [[number, number], [number, number]];

export interface PackProgress {
  percentage:         number;   // 0–100
  completedTiles:     number;
  expectedTiles:      number;
  completedResources: number;
  expectedResources:  number;
  completedResourceSize: number;
  sizeMb:             number;
}

export interface InstalledPack {
  name:       string;
  percentage: number;
  complete:   boolean;
  completedResourceSize: number;
  sizeMb:     number;
  renderer:   NativeOfflineRenderer;
}

export type NativeOfflineRenderer = 'maplibre' | 'rnmapbox';

// Increase well above the default 5,000 tile limit.
// CONUS at z3-z12 is ~285K tiles; z3-z10 is ~18K tiles.
const MAX_TILE_COUNT = 1_000_000;

// ── Build style URI for offline packs ────────────────────────────────────────
// MLN iOS requires a real https:// URL — data: URIs cause MLNErrorDomain Code=-1.
// The CF Worker at tiles.gettrailhead.app/api/style.json serves the topo style.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function packStyleURI(_mapboxToken: string): string {
  return 'https://tiles.gettrailhead.app/api/style.json';
}

const RNMAPBOX_LEGACY_PREFIX = 'trailhead-legacy-rnmapbox-';

function physicalPackName(name: string, renderer: NativeOfflineRenderer) {
  return renderer === 'rnmapbox' ? `${RNMAPBOX_LEGACY_PREFIX}${name}` : name;
}

function logicalPackName(name: string, renderer: NativeOfflineRenderer) {
  return renderer === 'rnmapbox' && name.startsWith(RNMAPBOX_LEGACY_PREFIX)
    ? name.slice(RNMAPBOX_LEGACY_PREFIX.length)
    : name;
}

function offlineManager(renderer: NativeOfflineRenderer): any {
  return renderer === 'rnmapbox' ? MapboxGL.offlineManager : MapLibreGL.offlineManager;
}

// ── Download a pack ───────────────────────────────────────────────────────────
export async function downloadPack(
  name: string,
  bounds: PackBounds,
  minZoom: number,
  maxZoom: number,
  mapboxToken: string,
  onProgress: (progress: PackProgress) => void,
  onComplete: () => void,
  onError: (msg: string) => void,
  renderer: NativeOfflineRenderer = 'maplibre',
  styleURLOverride?: string,
): Promise<void> {
  const manager = offlineManager(renderer);
  const nativeName = physicalPackName(name, renderer);
  // MapLibre enforces its own region tile cap. RNMapbox manages this through
  // the v10 tile store and does not expose the same setting.
  if (renderer === 'maplibre') {
    await MapLibreGL.offlineManager.setTileCountLimit(MAX_TILE_COUNT);
  }

  const styleURL = styleURLOverride || packStyleURI(mapboxToken);
  if (!styleURLOverride) {
    const styleResponse = await fetch(styleURL, { headers: { Accept: 'application/json' } });
    if (!styleResponse.ok) {
      throw new Error('Trailhead could not verify offline map coverage. Try again.');
    }
    const style = await styleResponse.json().catch(() => null);
    if (!offlineStyleCoversBounds(style, bounds)) {
      throw new Error('Offline map coverage is not available for this area yet.');
    }
  }
  if (renderer === 'rnmapbox' && mapboxToken) {
    await MapboxGL.setAccessToken(mapboxToken);
  }

  // Coverage must be proven before replacing an existing native pack. A
  // temporary network/style outage must never remove the last usable copy.
  try { await manager.deletePack(nativeName); } catch { /* didn't exist */ }
  let completed = false;

  await manager.createPack(
    { name: nativeName, styleURL, bounds: mapLibreOfflinePackBounds(bounds), minZoom, maxZoom },
    (_pack: any, status: any) => {
      const pct = status.percentage ?? 0;
      const cr  = status.completedResourceCount ?? 0;
      const er  = status.requiredResourceCount  ?? 1;
      const completedResourceSize = typeof status.completedResourceSize === 'number'
        ? status.completedResourceSize
        : 0;
      const sz = Math.round(completedResourceSize / 1_048_576 * 10) / 10;
      onProgress({
        percentage: pct,
        completedTiles: cr,
        expectedTiles: er,
        completedResources: cr,
        expectedResources: er,
        completedResourceSize,
        sizeMb: sz,
      });
      if (pct >= 100 && !completed) {
        completed = true;
        onComplete();
      }
    },
    (_pack: any, err: any) => {
      onError(err?.message ?? 'Download failed');
    },
  );
}

// ── Pause / resume (via OfflinePack object) ───────────────────────────────────
export async function pausePack(name: string, renderer: NativeOfflineRenderer = 'maplibre'): Promise<void> {
  try {
    const packs = await offlineManager(renderer).getPacks();
    const nativeName = physicalPackName(name, renderer);
    const pack = packs?.find((p: any) => p.name === nativeName);
    if (pack) await (pack as any).pause();
  } catch {}
}
export async function resumePack(name: string, renderer: NativeOfflineRenderer = 'maplibre'): Promise<void> {
  try {
    const packs = await offlineManager(renderer).getPacks();
    const nativeName = physicalPackName(name, renderer);
    const pack = packs?.find((p: any) => p.name === nativeName);
    if (pack) await (pack as any).resume();
  } catch {}
}

// ── Delete a pack ─────────────────────────────────────────────────────────────
export async function deletePack(name: string, renderer: NativeOfflineRenderer = 'maplibre'): Promise<void> {
  await offlineManager(renderer).deletePack(physicalPackName(name, renderer));
}

/** Strict presence check for privacy-sensitive, identity-bound removal. */
export async function hasInstalledPackStrict(
  name: string,
  renderer: NativeOfflineRenderer = 'maplibre',
): Promise<boolean> {
  const packs = await offlineManager(renderer).getPacks();
  const nativeName = physicalPackName(name, renderer);
  return Boolean(packs?.some((pack: any) => pack?.name === nativeName));
}

/** Strict, renderer-bound inspection for one exact physical native pack. */
export async function inspectInstalledPackStrict(
  name: string,
  renderer: NativeOfflineRenderer,
): Promise<InstalledPack & { complete: true }> {
  const packs = await offlineManager(renderer).getPacks();
  const nativeName = physicalPackName(name, renderer);
  const status = await installedOfflinePackStatusStrict(packs ?? [], nativeName);
  return {
    ...status,
    name: logicalPackName(status.name, renderer),
    renderer,
  };
}

// ── List installed packs ──────────────────────────────────────────────────────
export async function getInstalledPacks(renderer: NativeOfflineRenderer = 'maplibre'): Promise<InstalledPack[]> {
  try {
    const packs = await offlineManager(renderer).getPacks();
    const scoped = renderer === 'rnmapbox'
      ? (packs || []).filter((pack: any) => String(pack?.name || '').startsWith(RNMAPBOX_LEGACY_PREFIX))
      : packs || [];
    const statuses = await installedOfflinePackStatuses(scoped);
    return statuses.map(pack => ({
      ...pack,
      name: logicalPackName(pack.name, renderer),
      renderer,
    }));
  } catch {
    return [];
  }
}

// ── Pre-defined area bounds ───────────────────────────────────────────────────
/** Continental US bounding box — covers z3-z12 for full road + trail network. */
export const CONUS_PACK = {
  name:    'Continental US',
  bounds:  [[-125.0, 24.5], [-66.5, 49.5]] as PackBounds,
  minZoom: 3,
  maxZoom: 12,
};

/** Per-state bounds (west, south, east, north → converted to PackBounds). */
export const US_STATE_PACKS: Record<string, {
  name: string; bounds: PackBounds; icon: string;
}> = {
  AK: { name: 'Alaska',          bounds: [[-168.0, 54.6], [-130.0, 71.4]], icon: 'map-outline' },
  AZ: { name: 'Arizona',         bounds: [[-114.8, 31.3], [-109.0, 37.0]], icon: 'map-outline' },
  CA: { name: 'California',      bounds: [[-124.4, 32.5], [-114.1, 42.0]], icon: 'map-outline' },
  CO: { name: 'Colorado',        bounds: [[-109.1, 37.0], [-102.0, 41.0]], icon: 'map-outline' },
  HI: { name: 'Hawaii',          bounds: [[-160.2, 18.9], [-154.8, 22.2]], icon: 'map-outline' },
  ID: { name: 'Idaho',           bounds: [[-117.2, 42.0], [-111.0, 49.0]], icon: 'map-outline' },
  MT: { name: 'Montana',         bounds: [[-116.0, 44.4], [-104.0, 49.0]], icon: 'map-outline' },
  NM: { name: 'New Mexico',      bounds: [[-109.1, 31.3], [-103.0, 37.0]], icon: 'map-outline' },
  NV: { name: 'Nevada',          bounds: [[-120.0, 35.0], [-114.0, 42.0]], icon: 'map-outline' },
  OR: { name: 'Oregon',          bounds: [[-124.6, 41.9], [-116.5, 46.3]], icon: 'map-outline' },
  UT: { name: 'Utah',            bounds: [[-114.1, 36.9], [-109.0, 42.0]], icon: 'map-outline' },
  WA: { name: 'Washington',      bounds: [[-124.7, 45.5], [-116.9, 49.0]], icon: 'map-outline' },
  WY: { name: 'Wyoming',         bounds: [[-111.1, 41.0], [-104.1, 45.0]], icon: 'map-outline' },
  KS: { name: 'Kansas',          bounds: [[-102.1, 36.9], [ -94.6, 40.0]], icon: 'map-outline' },
  MN: { name: 'Minnesota',       bounds: [[ -97.2, 43.5], [ -89.5, 49.4]], icon: 'map-outline' },
  MO: { name: 'Missouri',        bounds: [[ -95.8, 35.9], [ -89.1, 40.6]], icon: 'map-outline' },
  ND: { name: 'North Dakota',    bounds: [[-104.1, 45.9], [ -96.6, 49.0]], icon: 'map-outline' },
  NE: { name: 'Nebraska',        bounds: [[-104.1, 40.0], [ -95.3, 43.0]], icon: 'map-outline' },
  OK: { name: 'Oklahoma',        bounds: [[-103.0, 33.6], [ -94.4, 37.0]], icon: 'map-outline' },
  SD: { name: 'South Dakota',    bounds: [[-104.1, 42.5], [ -96.4, 45.9]], icon: 'map-outline' },
  TX: { name: 'Texas',           bounds: [[-106.6, 25.8], [ -93.5, 36.5]], icon: 'map-outline' },
  AL: { name: 'Alabama',         bounds: [[ -88.5, 30.2], [ -84.9, 35.0]], icon: 'map-outline' },
  AR: { name: 'Arkansas',        bounds: [[ -94.6, 33.0], [ -89.6, 36.5]], icon: 'map-outline' },
  FL: { name: 'Florida',         bounds: [[ -87.6, 24.5], [ -80.0, 31.0]], icon: 'map-outline' },
  GA: { name: 'Georgia',         bounds: [[ -85.6, 30.4], [ -80.8, 35.0]], icon: 'map-outline' },
  KY: { name: 'Kentucky',        bounds: [[ -89.6, 36.5], [ -81.9, 39.1]], icon: 'map-outline' },
  LA: { name: 'Louisiana',       bounds: [[ -94.0, 28.9], [ -88.8, 33.0]], icon: 'map-outline' },
  MS: { name: 'Mississippi',     bounds: [[ -91.7, 30.2], [ -88.1, 35.0]], icon: 'map-outline' },
  NC: { name: 'North Carolina',  bounds: [[ -84.3, 33.8], [ -75.5, 36.6]], icon: 'map-outline' },
  SC: { name: 'South Carolina',  bounds: [[ -83.4, 32.0], [ -78.5, 35.2]], icon: 'map-outline' },
  TN: { name: 'Tennessee',       bounds: [[ -90.3, 35.0], [ -81.6, 36.7]], icon: 'map-outline' },
  VA: { name: 'Virginia',        bounds: [[ -83.7, 36.5], [ -75.2, 39.5]], icon: 'map-outline' },
  WV: { name: 'West Virginia',   bounds: [[ -82.6, 37.2], [ -77.7, 40.6]], icon: 'map-outline' },
  CT: { name: 'Connecticut',     bounds: [[ -73.7, 41.0], [ -71.8, 42.1]], icon: 'map-outline' },
  DE: { name: 'Delaware',        bounds: [[ -75.8, 38.4], [ -75.0, 39.8]], icon: 'map-outline' },
  MA: { name: 'Massachusetts',   bounds: [[ -73.5, 41.2], [ -69.9, 42.9]], icon: 'map-outline' },
  MD: { name: 'Maryland',        bounds: [[ -79.5, 37.9], [ -75.0, 39.7]], icon: 'map-outline' },
  ME: { name: 'Maine',           bounds: [[ -71.1, 43.1], [ -66.9, 47.5]], icon: 'map-outline' },
  NH: { name: 'New Hampshire',   bounds: [[ -72.6, 42.7], [ -70.6, 45.3]], icon: 'map-outline' },
  NJ: { name: 'New Jersey',      bounds: [[ -75.6, 38.9], [ -73.9, 41.4]], icon: 'map-outline' },
  NY: { name: 'New York',        bounds: [[ -79.8, 40.5], [ -71.8, 45.0]], icon: 'map-outline' },
  PA: { name: 'Pennsylvania',    bounds: [[ -80.5, 39.7], [ -74.7, 42.3]], icon: 'map-outline' },
  RI: { name: 'Rhode Island',    bounds: [[ -71.9, 41.1], [ -71.1, 42.0]], icon: 'map-outline' },
  VT: { name: 'Vermont',         bounds: [[ -73.4, 42.7], [ -71.5, 45.0]], icon: 'map-outline' },
  IA: { name: 'Iowa',            bounds: [[ -96.6, 40.4], [ -90.1, 43.5]], icon: 'map-outline' },
  IL: { name: 'Illinois',        bounds: [[ -91.5, 36.9], [ -87.0, 42.5]], icon: 'map-outline' },
  IN: { name: 'Indiana',         bounds: [[ -88.1, 37.8], [ -84.8, 41.8]], icon: 'map-outline' },
  MI: { name: 'Michigan',        bounds: [[ -90.4, 41.7], [ -82.4, 48.3]], icon: 'map-outline' },
  OH: { name: 'Ohio',            bounds: [[ -84.8, 38.4], [ -80.5, 42.0]], icon: 'map-outline' },
  WI: { name: 'Wisconsin',       bounds: [[ -92.9, 42.5], [ -86.2, 47.1]], icon: 'map-outline' },
};

// ── Build route-corridor bounds ───────────────────────────────────────────────
/** Expand route points into a bounding box with a buffer (default 0.3° ≈ 20km). */
export function routeCorridorBounds(
  waypoints: { lat: number; lng: number }[],
  bufferDeg = 0.3,
): PackBounds | null {
  if (waypoints.length < 2) return null;
  const lats = waypoints.map(w => w.lat);
  const lngs = waypoints.map(w => w.lng);
  return [
    [Math.min(...lngs) - bufferDeg, Math.min(...lats) - bufferDeg],
    [Math.max(...lngs) + bufferDeg, Math.max(...lats) + bufferDeg],
  ];
}

export const routeCorriderBounds = routeCorridorBounds;
