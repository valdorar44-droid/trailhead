// Web test shim for the native MapLibre offline manager.
// Native builds use offlineManager.ts; this file keeps Expo web from importing
// @maplibre/maplibre-react-native while rendering the Map tab in Playwright.

export type PackBounds = [[number, number], [number, number]];

export interface PackProgress {
  percentage: number;
  completedTiles: number;
  expectedTiles: number;
  completedResources: number;
  expectedResources: number;
  sizeMb: number;
}

export interface InstalledPack {
  name: string;
  percentage: number;
  complete: boolean;
  sizeMb: number;
}

export const US_STATE_PACKS: Record<string, { name: string; bounds: PackBounds; emoji: string }> = {};

export async function downloadPack(
  _name: string,
  _bounds: PackBounds,
  _minZoom: number,
  _maxZoom: number,
  _mapboxToken: string,
  _onProgress: (progress: PackProgress) => void,
  _onComplete: () => void,
  onError: (msg: string) => void,
): Promise<void> {
  onError('Native offline map packs are not available in the web preview.');
}

export async function pausePack(_name: string): Promise<void> {}

export async function resumePack(_name: string): Promise<void> {}

export async function deletePack(_name: string): Promise<void> {}

export async function getInstalledPacks(): Promise<InstalledPack[]> {
  return [];
}

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
