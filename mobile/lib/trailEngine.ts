import type { CampsitePin, OsmPoi, Pin, Report } from './api';

export type TrailFeatureType = 'trailhead' | 'viewpoint' | 'peak' | 'hot_spring' | 'trail' | 'road';

export type TrailSupport = {
  campsNearby: number;
  fuelNearby: number;
  waterNearby: number;
  reportsNearby: number;
  offlineReady: boolean;
  readinessLabel: string;
  nearestCampName?: string;
  nearestCampDistanceMi?: number;
  nearestFuelDistanceMi?: number;
  nearestWaterDistanceMi?: number;
};

export type TrailFeature = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: TrailFeatureType;
  source: 'osm' | 'offline_places' | 'map_tile' | 'mvum' | 'community' | 'trip' | 'trailhead';
  subtitle: string;
  score: number;
  support: TrailSupport;
  elevation?: string;
  distanceMi?: number;
  profile_id?: string;
  source_label?: string;
  photo_url?: string | null;
  length_mi?: number | null;
  activities?: string[];
  last_checked?: number;
  summary?: string;
  difficulty?: string;
};

type Point = { lat: number; lng: number };
const MAX_DISCOVERY_SOURCE_SCAN = 800;
const MAX_DISCOVERY_CANDIDATES = 80;
const MAX_DISCOVERIES = 60;
const MAX_SUPPORT_POINTS = 200;

function isValidPoint(point: Partial<Point> | null | undefined): point is Point {
  return point != null
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && Math.abs(point.lat as number) <= 90
    && Math.abs(point.lng as number) <= 180;
}

function haversineMiles(a: Point, b: Point): number {
  const radiusMi = 3958.8;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180;
  const la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusMi * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function titleFor(type: TrailFeatureType): string {
  switch (type) {
    case 'trailhead': return 'Trailhead';
    case 'viewpoint': return 'Viewpoint';
    case 'peak': return 'Peak';
    case 'hot_spring': return 'Hot Spring';
    case 'road': return 'Forest Road';
    default: return 'Trail';
  }
}

function isInsideApproxRadius(center: Point, point: Point, radiusMi: number): boolean {
  const latDelta = radiusMi / 69;
  const lngScale = Math.max(0.2, Math.cos(center.lat * Math.PI / 180));
  const lngDelta = radiusMi / (69 * lngScale);
  return Math.abs(point.lat - center.lat) <= latDelta && Math.abs(point.lng - center.lng) <= lngDelta;
}

function countNearby<T extends Partial<Point>>(
  center: Point,
  points: T[],
  radiusMi: number,
  predicate?: (point: T) => boolean,
  max = 99,
): number {
  if (!isValidPoint(center)) return 0;
  let count = 0;
  for (const point of points) {
    if (!isValidPoint(point) || (predicate && !predicate(point))) continue;
    if (!isInsideApproxRadius(center, point, radiusMi)) continue;
    if (haversineMiles(center, point) <= radiusMi) {
      count += 1;
      if (count >= max) break;
    }
  }
  return count;
}

function nearestPoint<T extends Partial<Point>>(
  center: Point,
  points: T[],
  radiusMi: number,
  predicate?: (point: T) => boolean,
): { point: T; distanceMi: number } | null {
  if (!isValidPoint(center)) return null;
  let best: { point: T; distanceMi: number } | null = null;
  for (const point of points) {
    if (!isValidPoint(point) || (predicate && !predicate(point))) continue;
    if (!isInsideApproxRadius(center, point, radiusMi)) continue;
    const distanceMi = haversineMiles(center, point);
    if (distanceMi > radiusMi) continue;
    if (!best || distanceMi < best.distanceMi) best = { point, distanceMi };
  }
  return best;
}

export function trailTypeFromPoi(type?: string): TrailFeatureType | null {
  if (type === 'trail' || type === 'trailhead' || type === 'viewpoint' || type === 'peak' || type === 'hot_spring') return type;
  return null;
}

export function buildTrailSupport(
  center: Point,
  camps: Array<Pick<CampsitePin, 'lat' | 'lng' | 'name'>>,
  gas: Array<Point>,
  pois: Array<Pick<OsmPoi, 'lat' | 'lng' | 'type'>>,
  reports: Array<Pick<Report, 'lat' | 'lng'>>,
  offlineReady: boolean,
): TrailSupport {
  const readinessLabel = offlineReady ? 'Offline map ready' : 'Download map/routing before leaving signal';
  if (!isValidPoint(center)) {
    return { campsNearby: 0, fuelNearby: 0, waterNearby: 0, reportsNearby: 0, offlineReady, readinessLabel };
  }
  const campsNearby = countNearby(center, camps, 12);
  const fuelNearby = countNearby(center, gas, 20);
  const waterNearby = countNearby(center, pois, 8, p => p.type === 'water');
  const reportsNearby = countNearby(center, reports, 8);
  const nearestCamp = nearestPoint(center, camps, 12);
  const nearestFuel = nearestPoint(center, gas, 20);
  const nearestWater = nearestPoint(center, pois, 8, p => p.type === 'water');
  return {
    campsNearby,
    fuelNearby,
    waterNearby,
    reportsNearby,
    offlineReady,
    readinessLabel,
    nearestCampName: nearestCamp?.point?.name,
    nearestCampDistanceMi: nearestCamp?.distanceMi,
    nearestFuelDistanceMi: nearestFuel?.distanceMi,
    nearestWaterDistanceMi: nearestWater?.distanceMi,
  };
}

export function featureFromPoi(
  poi: OsmPoi,
  support: TrailSupport,
  source: TrailFeature['source'] = 'osm',
): TrailFeature | null {
  const type = trailTypeFromPoi(poi.type);
  if (!type || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return null;
  const name = poi.name || titleFor(type);
  const score = support.campsNearby * 3 + support.waterNearby * 2 + support.fuelNearby + support.reportsNearby;
  return {
    id: poi.id || `${source}:${type}:${poi.lat.toFixed(5)}:${poi.lng.toFixed(5)}`,
    name,
    lat: poi.lat,
    lng: poi.lng,
    type,
    source,
    subtitle: poi.length_mi != null && Number.isFinite(poi.length_mi)
      ? `${poi.length_mi.toFixed(poi.length_mi >= 10 ? 0 : 1)} mi · ${poi.source_label || titleFor(type)}`
      : poi.elevation ? `${titleFor(type)} · ${poi.elevation}` : (poi.source_label || titleFor(type)),
    score,
    support,
    elevation: poi.elevation,
    profile_id: poi.profile_id,
    source_label: poi.source_label,
    photo_url: poi.photo_url,
    length_mi: poi.length_mi,
    activities: poi.activities,
    last_checked: poi.last_checked,
  };
}

export function featureFromMapTrail(
  name: string,
  lat: number,
  lng: number,
  cls: string,
  support: TrailSupport,
): TrailFeature {
  const type: TrailFeatureType = cls === 'track' ? 'road' : 'trail';
  const label = titleFor(type);
  return {
    id: `map:${type}:${lat.toFixed(5)}:${lng.toFixed(5)}:${name || label}`,
    name: name && name !== 'Trail' ? name : label,
    lat,
    lng,
    type,
    source: cls === 'track' ? 'mvum' : 'map_tile',
    subtitle: cls === 'track' ? 'Dirt track / forest road' : 'Trail / path',
    score: support.campsNearby * 3 + support.waterNearby * 2 + support.reportsNearby,
    support,
  };
}

export function buildTrailDiscoveries(
  pois: OsmPoi[],
  camps: Array<Pick<CampsitePin, 'lat' | 'lng' | 'name'>>,
  gas: Array<Point>,
  reports: Array<Pick<Report, 'lat' | 'lng'>>,
  offlineReady: boolean,
  origin?: Point | null,
  sortMode: 'score' | 'distance' = 'score',
): TrailFeature[] {
  const seen = new Set<string>();
  const supportCamps = camps.filter(isValidPoint).slice(0, MAX_SUPPORT_POINTS);
  const supportGas = gas.filter(isValidPoint).slice(0, MAX_SUPPORT_POINTS);
  const supportWater = pois.filter(poi => poi.type === 'water' && isValidPoint(poi)).slice(0, MAX_SUPPORT_POINTS);
  const supportReports = reports.filter(isValidPoint).slice(0, MAX_SUPPORT_POINTS);
  const candidates: OsmPoi[] = [];
  let scanned = 0;
  for (const poi of pois) {
    scanned += 1;
    if (candidates.length >= MAX_DISCOVERY_CANDIDATES) break;
    if (scanned >= MAX_DISCOVERY_SOURCE_SCAN) break;
    if (!trailTypeFromPoi(poi.type) || !isValidPoint(poi)) continue;
    const key = `${poi.type}:${(poi.name || '').toLowerCase()}:${poi.lat.toFixed(4)}:${poi.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(poi);
  }
  seen.clear();
  return candidates
    .map(poi => {
      const support = buildTrailSupport(poi, supportCamps, supportGas, supportWater, supportReports, offlineReady);
      const feature = featureFromPoi(
        poi,
        support,
        poi.source === 'offline' ? 'offline_places' : poi.source === 'trailhead' ? 'trailhead' : 'osm',
      );
      if (feature && origin && isValidPoint(origin)) feature.distanceMi = haversineMiles(origin, feature);
      return feature;
    })
    .filter((feature): feature is TrailFeature => !!feature)
    .filter(feature => {
      const key = `${feature.type}:${feature.name.toLowerCase()}:${feature.lat.toFixed(4)}:${feature.lng.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (sortMode === 'distance') {
        const da = a.distanceMi ?? Number.POSITIVE_INFINITY;
        const db = b.distanceMi ?? Number.POSITIVE_INFINITY;
        return da - db || b.score - a.score || a.name.localeCompare(b.name);
      }
      return b.score - a.score || (a.distanceMi ?? 9999) - (b.distanceMi ?? 9999) || a.name.localeCompare(b.name);
    })
    .slice(0, MAX_DISCOVERIES);
}

export function trailIcon(type: TrailFeatureType): string {
  switch (type) {
    case 'trailhead': return 'trail-sign-outline';
    case 'viewpoint': return 'flag-outline';
    case 'peak': return 'triangle-outline';
    case 'hot_spring': return 'flame-outline';
    case 'road': return 'car-outline';
    default: return 'walk-outline';
  }
}

export function trailColor(type: TrailFeatureType): string {
  switch (type) {
    case 'trailhead': return '#22c55e';
    case 'viewpoint': return '#a855f7';
    case 'peak': return '#92400e';
    case 'hot_spring': return '#f97316';
    case 'road': return '#eab308';
    default: return '#16a34a';
  }
}
