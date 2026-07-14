import type { FileDownloadState } from '@/lib/useOfflineFiles';

export type OfflineRegionSummary = {
  hasContent: boolean;
  ready: boolean;
  active: boolean;
  paused: boolean;
  incomplete: boolean;
  progress: number;
  storedBytes: number;
  status: string;
};

type RegionArtifactInput = {
  map: FileDownloadState;
  routing?: FileDownloadState;
  contour?: FileDownloadState;
  trails?: FileDownloadState;
  placeCount?: number;
  requiresRouting?: boolean;
};

const hasStarted = (state?: FileDownloadState) => !!state && state.status !== 'idle';

const stateBytes = (state?: FileDownloadState) => {
  if (!state || state.status === 'idle') return 0;
  if (state.fileSizeMb > 0) return state.fileSizeMb * 1_048_576;
  if (state.downloadedBytes > 0) return state.downloadedBytes;
  if (state.status === 'complete' && state.totalBytes > 0) return state.totalBytes;
  return 0;
};

export function summarizeOfflineRegion({
  map,
  routing,
  contour,
  trails,
  placeCount = 0,
  requiresRouting = true,
}: RegionArtifactInput): OfflineRegionSummary {
  const artifacts = [map, routing, contour, trails].filter(Boolean) as FileDownloadState[];
  const started = artifacts.filter(hasStarted);
  const activeArtifacts = started.filter(state => state.status === 'downloading');
  const paused = started.some(state => state.status === 'paused');
  const incomplete = started.some(state => state.status === 'error');
  const ready = map.status === 'complete' && (!requiresRouting || routing?.status === 'complete');
  const hasContent = started.length > 0 || placeCount > 0;
  const storedBytes = artifacts.reduce((total, state) => total + stateBytes(state), 0);

  let progress = 0;
  if (activeArtifacts.length > 0) {
    const weighted = activeArtifacts.reduce((total, state) => {
      const weight = state.totalBytes || state.downloadedBytes || 1;
      return { done: total.done + weight * state.progress, total: total.total + weight };
    }, { done: 0, total: 0 });
    progress = weighted.total > 0 ? weighted.done / weighted.total : 0;
  }

  let status = '';
  if (activeArtifacts.length > 0) status = `Downloading ${Math.round(progress)}%`;
  else if (paused) status = 'Paused';
  else if (incomplete) status = 'Download incomplete';
  else if (ready) status = 'Ready offline';
  else if (map.status === 'complete') status = 'Map saved';
  else if (routing?.status === 'complete') status = 'Directions saved';
  else if (placeCount > 0) status = `${placeCount.toLocaleString()} places saved`;

  return {
    hasContent,
    ready,
    active: activeArtifacts.length > 0,
    paused,
    incomplete,
    progress,
    storedBytes,
    status,
  };
}

type OfflineRegionBounds = {
  bounds: { n: number; s: number; e: number; w: number };
};

export function offlineRegionIdsForPoints(
  points: Array<{ lat: number; lng: number }>,
  regions: Record<string, OfflineRegionBounds>,
) {
  const candidates = Object.entries(regions)
    .filter(([id]) => id !== 'conus')
    .sort(([a], [b]) => Number(b.length === 2) - Number(a.length === 2));
  const matches: string[] = [];

  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const match = candidates.find(([, region]) => (
      point.lat >= region.bounds.s
      && point.lat <= region.bounds.n
      && point.lng >= region.bounds.w
      && point.lng <= region.bounds.e
    ));
    if (match && !matches.includes(match[0])) matches.push(match[0]);
  }

  return matches;
}

export function displayOfflineDownloadName(name: string) {
  return name
    .replace(/-corridor\b/i, '')
    .replace(/\bcorridor\b/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'Downloaded area';
}

export function offlineStateStoredBytes(state: FileDownloadState) {
  return stateBytes(state);
}
