import { CONTOUR_REGIONS, FILE_REGIONS, ROUTING_REGIONS, TRAIL_REGIONS } from './useOfflineFiles';

type Bounds = { n: number; s: number; e: number; w: number };
type Point = { lat: number; lng: number };
type PackState = 'idle' | 'downloading' | 'paused' | 'complete' | 'error';

export type OfflineReadinessInput = {
  coords?: [number, number][];
  points?: Point[];
  getMapState?: (id: string) => { status: PackState } | null | undefined;
  getRoutingState?: (id: string) => { status: PackState } | null | undefined;
  getContourState?: (id: string) => { status: PackState } | null | undefined;
  getTrailState?: (id: string) => { status: PackState } | null | undefined;
  placesReady?: boolean;
};

export type OfflineReadinessRow = {
  key: 'map' | 'navigation' | 'trails' | 'topo' | 'places';
  label: string;
  ready: boolean;
  needed: boolean;
  text: string;
};

export type OfflineReadinessSummary = {
  regionIds: string[];
  regionNames: string[];
  ready: boolean;
  rows: OfflineReadinessRow[];
  message: string;
};

function pointInBounds(point: Point, bounds: Bounds) {
  return point.lat <= bounds.n && point.lat >= bounds.s && point.lng <= bounds.e && point.lng >= bounds.w;
}

function samplePoints(input: OfflineReadinessInput): Point[] {
  const fromCoords = (input.coords ?? []).map(([lng, lat]) => ({ lat, lng }));
  const points = [...fromCoords, ...(input.points ?? [])].filter(point =>
    Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
  );
  if (points.length <= 28) return points;
  const step = Math.max(1, Math.floor(points.length / 28));
  const sampled = points.filter((_, idx) => idx % step === 0);
  const last = points[points.length - 1];
  if (last && sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

export function routeOfflineRegionIds(input: Pick<OfflineReadinessInput, 'coords' | 'points'>) {
  const points = samplePoints(input);
  if (!points.length) return [];
  const ids = new Set<string>();
  for (const point of points) {
    for (const [id, region] of Object.entries(FILE_REGIONS)) {
      if (id === 'conus') continue;
      if (pointInBounds(point, region.bounds)) ids.add(id);
    }
  }
  return [...ids].sort();
}

function rowStatus(ids: string[], getState: OfflineReadinessInput['getMapState']) {
  if (!ids.length || !getState) return false;
  return ids.every(id => getState(id)?.status === 'complete');
}

export function computeOfflineReadiness(input: OfflineReadinessInput): OfflineReadinessSummary {
  const regionIds = routeOfflineRegionIds(input);
  const regionNames = regionIds
    .map(id => FILE_REGIONS[id as keyof typeof FILE_REGIONS]?.name)
    .filter(Boolean) as string[];
  const mapReady = rowStatus(regionIds, input.getMapState);
  const routeReady = rowStatus(regionIds.filter(id => ROUTING_REGIONS[id as keyof typeof ROUTING_REGIONS]), input.getRoutingState);
  const trailIds = regionIds.filter(id => TRAIL_REGIONS[id]);
  const contourIds = regionIds.filter(id => CONTOUR_REGIONS[id as keyof typeof CONTOUR_REGIONS]);
  const trailReady = trailIds.length > 0 && rowStatus(trailIds, input.getTrailState);
  const contourReady = contourIds.length > 0 && rowStatus(contourIds, input.getContourState);
  const placesReady = Boolean(input.placesReady);

  const rows: OfflineReadinessRow[] = [
    {
      key: 'map',
      label: 'Map',
      ready: mapReady,
      needed: regionIds.length > 0,
      text: mapReady ? 'Saved for the route area.' : regionIds.length ? 'Download the route area.' : 'Build a route first.',
    },
    {
      key: 'navigation',
      label: 'Navigation',
      ready: routeReady,
      needed: regionIds.length > 0,
      text: routeReady ? 'Saved for offline turns.' : regionIds.length ? 'Download driving data for the route area.' : 'Build a route first.',
    },
    {
      key: 'trails',
      label: 'Trails',
      ready: trailReady,
      needed: trailIds.length > 0,
      text: trailReady ? 'Trail lines saved.' : trailIds.length ? 'Optional trail pack is missing.' : 'No trail pack for this area yet.',
    },
    {
      key: 'topo',
      label: 'Topo',
      ready: contourReady,
      needed: contourIds.length > 0,
      text: contourReady ? 'Topo lines saved.' : contourIds.length ? 'Optional topo pack is missing.' : 'No topo pack for this area yet.',
    },
    {
      key: 'places',
      label: 'Places',
      ready: placesReady,
      needed: true,
      text: placesReady ? 'Selected places are saved with the trip.' : 'Save camps, fuel, and places before leaving signal.',
    },
  ];
  const required = rows.filter(row => row.key === 'map' || row.key === 'navigation' || row.key === 'places');
  const ready = required.every(row => !row.needed || row.ready);
  return {
    regionIds,
    regionNames,
    rows,
    ready,
    message: ready
      ? 'Offline basics are ready for this trip.'
      : regionNames.length
      ? `Missing downloads for ${regionNames.slice(0, 3).join(', ')}${regionNames.length > 3 ? ` +${regionNames.length - 3}` : ''}.`
      : 'Build a route before checking downloads.',
  };
}
