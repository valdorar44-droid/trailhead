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
import { buildMapStyle } from './mapStyle';

// Bounds format: [[westLng, southLat], [eastLng, northLat]]
export type PackBounds = [[number, number], [number, number]];

export interface PackProgress {
  percentage:         number;   // 0–100
  completedTiles:     number;
  expectedTiles:      number;
  completedResources: number;
  expectedResources:  number;
  sizeMb:             number;
}

export interface InstalledPack {
  name:       string;
  percentage: number;
  complete:   boolean;
  sizeMb:     number;
}

// Increase well above the default 5,000 tile limit.
// CONUS at z3-z12 is ~285K tiles; z3-z10 is ~18K tiles.
const MAX_TILE_COUNT = 1_000_000;

// ── Build style URI for offline packs ────────────────────────────────────────
// Data URI is self-contained — no network needed to load the style definition.
// Tiles still come from the URL in the source; those are what gets downloaded.
function packStyleURI(mapboxToken: string): string {
  const style = buildMapStyle('topo', mapboxToken);
  return `data:application/json,${encodeURIComponent(JSON.stringify(style))}`;
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
): Promise<void> {
  // Set tile limit before creating the pack
  await MapLibreGL.offlineManager.setTileCountLimit(MAX_TILE_COUNT);

  // Delete any existing pack with the same name so we can restart cleanly
  try { await MapLibreGL.offlineManager.deletePack(name); } catch { /* didn't exist */ }

  const styleURL = packStyleURI(mapboxToken);

  MapLibreGL.offlineManager.createPack(
    { name, styleURL, bounds, minZoom, maxZoom },
    (_pack: any, status: any) => {
      const pct = status.percentage ?? 0;
      const cr  = status.completedResourceCount ?? 0;
      const er  = status.expectedResourceCount  ?? 1;
      const sz  = Math.round((status.completedResourceSize ?? 0) / 1_048_576 * 10) / 10;
      onProgress({ percentage: pct, completedTiles: cr, expectedTiles: er, completedResources: cr, expectedResources: er, sizeMb: sz });
      if (pct >= 100) onComplete();
    },
    (_pack: any, err: any) => {
      onError(err?.message ?? 'Download failed');
    },
  );
}

// ── Pause / resume (via OfflinePack object) ───────────────────────────────────
export async function pausePack(name: string): Promise<void> {
  try {
    const packs = await MapLibreGL.offlineManager.getPacks();
    const pack = packs?.find((p: any) => p.name === name);
    if (pack) await (pack as any).pause();
  } catch {}
}
export async function resumePack(name: string): Promise<void> {
  try {
    const packs = await MapLibreGL.offlineManager.getPacks();
    const pack = packs?.find((p: any) => p.name === name);
    if (pack) await (pack as any).resume();
  } catch {}
}

// ── Delete a pack ─────────────────────────────────────────────────────────────
export async function deletePack(name: string): Promise<void> {
  await MapLibreGL.offlineManager.deletePack(name);
}

// ── List installed packs ──────────────────────────────────────────────────────
export async function getInstalledPacks(): Promise<InstalledPack[]> {
  try {
    const packs = await MapLibreGL.offlineManager.getPacks();
    return (packs || []).map((p: any) => {
      const status = p.status;
      return {
        name:       p.name ?? 'unknown',
        percentage: status?.percentage ?? 100,
        complete:   (status?.percentage ?? 100) >= 100,
        sizeMb:     Math.round((status?.completedResourceSize ?? 0) / 1_048_576 * 10) / 10,
      };
    });
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
  name: string; bounds: PackBounds; emoji: string;
}> = {
  AK: { name: 'Alaska',          bounds: [[-168.0, 54.6], [-130.0, 71.4]], emoji: '🐻' },
  AZ: { name: 'Arizona',         bounds: [[-114.8, 31.3], [-109.0, 37.0]], emoji: '🏜️' },
  CA: { name: 'California',      bounds: [[-124.4, 32.5], [-114.1, 42.0]], emoji: '🌴' },
  CO: { name: 'Colorado',        bounds: [[-109.1, 37.0], [-102.0, 41.0]], emoji: '🏔️' },
  HI: { name: 'Hawaii',          bounds: [[-160.2, 18.9], [-154.8, 22.2]], emoji: '🌺' },
  ID: { name: 'Idaho',           bounds: [[-117.2, 42.0], [-111.0, 49.0]], emoji: '🏔️' },
  MT: { name: 'Montana',         bounds: [[-116.0, 44.4], [-104.0, 49.0]], emoji: '🦬' },
  NM: { name: 'New Mexico',      bounds: [[-109.1, 31.3], [-103.0, 37.0]], emoji: '🌵' },
  NV: { name: 'Nevada',          bounds: [[-120.0, 35.0], [-114.0, 42.0]], emoji: '🎰' },
  OR: { name: 'Oregon',          bounds: [[-124.6, 41.9], [-116.5, 46.3]], emoji: '🌲' },
  UT: { name: 'Utah',            bounds: [[-114.1, 36.9], [-109.0, 42.0]], emoji: '🏜️' },
  WA: { name: 'Washington',      bounds: [[-124.7, 45.5], [-116.9, 49.0]], emoji: '☁️' },
  WY: { name: 'Wyoming',         bounds: [[-111.1, 41.0], [-104.1, 45.0]], emoji: '🦅' },
  KS: { name: 'Kansas',          bounds: [[-102.1, 36.9], [ -94.6, 40.0]], emoji: '🌾' },
  MN: { name: 'Minnesota',       bounds: [[ -97.2, 43.5], [ -89.5, 49.4]], emoji: '🦅' },
  MO: { name: 'Missouri',        bounds: [[ -95.8, 35.9], [ -89.1, 40.6]], emoji: '🌉' },
  ND: { name: 'North Dakota',    bounds: [[-104.1, 45.9], [ -96.6, 49.0]], emoji: '🌾' },
  NE: { name: 'Nebraska',        bounds: [[-104.1, 40.0], [ -95.3, 43.0]], emoji: '🌽' },
  OK: { name: 'Oklahoma',        bounds: [[-103.0, 33.6], [ -94.4, 37.0]], emoji: '🤠' },
  SD: { name: 'South Dakota',    bounds: [[-104.1, 42.5], [ -96.4, 45.9]], emoji: '🦬' },
  TX: { name: 'Texas',           bounds: [[-106.6, 25.8], [ -93.5, 36.5]], emoji: '🤠' },
  AL: { name: 'Alabama',         bounds: [[ -88.5, 30.2], [ -84.9, 35.0]], emoji: '🌿' },
  AR: { name: 'Arkansas',        bounds: [[ -94.6, 33.0], [ -89.6, 36.5]], emoji: '🏞️' },
  FL: { name: 'Florida',         bounds: [[ -87.6, 24.5], [ -80.0, 31.0]], emoji: '🌊' },
  GA: { name: 'Georgia',         bounds: [[ -85.6, 30.4], [ -80.8, 35.0]], emoji: '🍑' },
  KY: { name: 'Kentucky',        bounds: [[ -89.6, 36.5], [ -81.9, 39.1]], emoji: '🐎' },
  LA: { name: 'Louisiana',       bounds: [[ -94.0, 28.9], [ -88.8, 33.0]], emoji: '🎷' },
  MS: { name: 'Mississippi',     bounds: [[ -91.7, 30.2], [ -88.1, 35.0]], emoji: '🌊' },
  NC: { name: 'North Carolina',  bounds: [[ -84.3, 33.8], [ -75.5, 36.6]], emoji: '🏔️' },
  SC: { name: 'South Carolina',  bounds: [[ -83.4, 32.0], [ -78.5, 35.2]], emoji: '🌴' },
  TN: { name: 'Tennessee',       bounds: [[ -90.3, 35.0], [ -81.6, 36.7]], emoji: '🎵' },
  VA: { name: 'Virginia',        bounds: [[ -83.7, 36.5], [ -75.2, 39.5]], emoji: '🏛️' },
  WV: { name: 'West Virginia',   bounds: [[ -82.6, 37.2], [ -77.7, 40.6]], emoji: '⛏️' },
  CT: { name: 'Connecticut',     bounds: [[ -73.7, 41.0], [ -71.8, 42.1]], emoji: '🍂' },
  DE: { name: 'Delaware',        bounds: [[ -75.8, 38.4], [ -75.0, 39.8]], emoji: '🏖️' },
  MA: { name: 'Massachusetts',   bounds: [[ -73.5, 41.2], [ -69.9, 42.9]], emoji: '🦞' },
  MD: { name: 'Maryland',        bounds: [[ -79.5, 37.9], [ -75.0, 39.7]], emoji: '🦀' },
  ME: { name: 'Maine',           bounds: [[ -71.1, 43.1], [ -66.9, 47.5]], emoji: '🦌' },
  NH: { name: 'New Hampshire',   bounds: [[ -72.6, 42.7], [ -70.6, 45.3]], emoji: '🍁' },
  NJ: { name: 'New Jersey',      bounds: [[ -75.6, 38.9], [ -73.9, 41.4]], emoji: '🏙️' },
  NY: { name: 'New York',        bounds: [[ -79.8, 40.5], [ -71.8, 45.0]], emoji: '🗽' },
  PA: { name: 'Pennsylvania',    bounds: [[ -80.5, 39.7], [ -74.7, 42.3]], emoji: '🔔' },
  RI: { name: 'Rhode Island',    bounds: [[ -71.9, 41.1], [ -71.1, 42.0]], emoji: '⚓' },
  VT: { name: 'Vermont',         bounds: [[ -73.4, 42.7], [ -71.5, 45.0]], emoji: '🍁' },
  IA: { name: 'Iowa',            bounds: [[ -96.6, 40.4], [ -90.1, 43.5]], emoji: '🌽' },
  IL: { name: 'Illinois',        bounds: [[ -91.5, 36.9], [ -87.0, 42.5]], emoji: '🏙️' },
  IN: { name: 'Indiana',         bounds: [[ -88.1, 37.8], [ -84.8, 41.8]], emoji: '🏎️' },
  MI: { name: 'Michigan',        bounds: [[ -90.4, 41.7], [ -82.4, 48.3]], emoji: '🚗' },
  OH: { name: 'Ohio',            bounds: [[ -84.8, 38.4], [ -80.5, 42.0]], emoji: '🌻' },
  WI: { name: 'Wisconsin',       bounds: [[ -92.9, 42.5], [ -86.2, 47.1]], emoji: '🧀' },
};

// ── Build route-corridor bounds ───────────────────────────────────────────────
/** Expand waypoints into a bounding box with a buffer (default 0.3° ≈ 20km). */
export function routeCorriderBounds(
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
