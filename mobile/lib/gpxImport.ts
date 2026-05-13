import * as FileSystem from 'expo-file-system';
import { XMLParser } from 'fast-xml-parser';
import type { TripResult, Waypoint } from './api';

export type GpxPoint = {
  lat: number;
  lng: number;
  ele?: number;
  time?: string;
  name?: string;
  desc?: string;
};

export type GpxTrack = {
  name: string;
  coords: [number, number][];
  rawPointCount: number;
  distanceMiles: number;
};

export type GpxWaypoint = GpxPoint & {
  type: 'waypoint';
};

export type ParsedGpx = {
  name: string;
  tracks: GpxTrack[];
  waypoints: GpxWaypoint[];
  routePoints: GpxPoint[];
  sourceStats: {
    trackCount: number;
    routeCount: number;
    waypointCount: number;
    trackPointCount: number;
  };
};

export type GpxImportBatch = {
  id: string;
  fileName: string;
  routeTripId?: string;
  routeTripIds?: string[];
  routeName?: string;
  importedAt: number;
  trackCount: number;
  routeCount: number;
  waypointCount: number;
  importedPins: number;
  skippedPins: number;
  pinLimit: number;
  routePointCount: number;
  distanceMiles: number;
  status: 'review' | 'trusted';
};

const BATCH_INDEX_PATH = `${FileSystem.documentDirectory}gpx_import_batches.json`;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function decodeXmlText(value?: unknown) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

export function cleanGpxName(fileName: string, fallback = 'Imported GPX Route') {
  return decodeXmlText(fileName)
    .replace(/\.(gpx|xml)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || fallback;
}

function readNum(value: unknown) {
  const num = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(num) ? num : null;
}

function pointFromNode(node: any): GpxPoint | null {
  const lat = readNum(node?.['@_lat']);
  const lng = readNum(node?.['@_lon']);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const ele = readNum(node?.ele);
  return {
    lat,
    lng,
    ...(ele != null ? { ele } : {}),
    ...(node?.time ? { time: decodeXmlText(node.time) } : {}),
    ...(node?.name ? { name: decodeXmlText(node.name) } : {}),
    ...(node?.desc ? { desc: decodeXmlText(node.desc) } : {}),
  };
}

function trackDistanceMiles(coords: [number, number][]) {
  let miles = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const radiusMi = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    miles += 2 * radiusMi * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return miles;
}

export function thinTrackCoords(coords: [number, number][], maxPoints = 1800) {
  if (coords.length <= maxPoints) return coords;
  const step = Math.ceil(coords.length / maxPoints);
  const thinned = coords.filter((_, idx) => idx % step === 0);
  const last = coords[coords.length - 1];
  if (last && thinned[thinned.length - 1] !== last) thinned.push(last);
  return thinned;
}

function routePointSamples(coords: [number, number][], name: string): Waypoint[] {
  const count = Math.min(10, Math.max(2, Math.ceil(coords.length / 220)));
  return Array.from({ length: count }).map((_, idx) => {
    const coordIndex = Math.round((coords.length - 1) * (idx / Math.max(1, count - 1)));
    const [lng, lat] = coords[coordIndex];
    const label = idx === 0 ? 'Start' : idx === count - 1 ? 'Finish' : `Track point ${idx + 1}`;
    return {
      day: 1,
      name: `${name} ${label}`,
      type: idx === 0 ? 'start' : 'waypoint',
      description: 'Imported from GPX track',
      land_type: 'Imported GPX',
      notes: 'Track-derived route point',
      lat,
      lng,
    };
  });
}

export function parseGpx(content: string, fileName = 'Imported GPX'): ParsedGpx {
  const parsed = parser.parse(content);
  const gpx = parsed?.gpx;
  if (!gpx) throw new Error('This file is not a valid GPX document.');
  const name = cleanGpxName(gpx?.metadata?.name || gpx?.name || fileName);
  const waypoints = asArray(gpx.wpt)
    .map(pointFromNode)
    .filter((p): p is GpxPoint => !!p)
    .map(p => ({ ...p, type: 'waypoint' as const }));
  const routePoints = asArray(gpx.rte)
    .flatMap((route: any) => asArray(route?.rtept))
    .map(pointFromNode)
    .filter((p): p is GpxPoint => !!p);
  const tracks: GpxTrack[] = [];
  for (const [trackIndex, track] of asArray(gpx.trk).entries()) {
    const points = asArray(track?.trkseg)
      .flatMap((seg: any) => asArray(seg?.trkpt))
      .map(pointFromNode)
      .filter((p): p is GpxPoint => !!p);
    const coords = points.map(p => [p.lng, p.lat] as [number, number]);
    if (coords.length < 2) continue;
    const trackName = cleanGpxName(track?.name || `${name} Track ${trackIndex + 1}`, `${name} Track ${trackIndex + 1}`);
    tracks.push({
      name: trackName,
      coords,
      rawPointCount: coords.length,
      distanceMiles: trackDistanceMiles(coords),
    });
  }
  if (tracks.length === 0 && routePoints.length >= 2) {
    const coords = routePoints.map(p => [p.lng, p.lat] as [number, number]);
    tracks.push({
      name,
      coords,
      rawPointCount: coords.length,
      distanceMiles: trackDistanceMiles(coords),
    });
  }
  return {
    name,
    tracks,
    waypoints,
    routePoints,
    sourceStats: {
      trackCount: asArray(gpx.trk).length,
      routeCount: asArray(gpx.rte).length,
      waypointCount: waypoints.length,
      trackPointCount: tracks.reduce((sum, track) => sum + track.rawPointCount, 0),
    },
  };
}

export function buildTripFromGpxTrack(track: GpxTrack, tripId = `gpx_${Date.now()}`): TripResult {
  const coords = thinTrackCoords(track.coords);
  const miles = trackDistanceMiles(coords);
  return {
    trip_id: tripId,
    plan: {
      trip_name: track.name,
      overview: `Imported GPX track with ${track.rawPointCount.toLocaleString()} source points. Review access, closures, vehicle fit, and the route line before navigating.`,
      duration_days: 1,
      states: [],
      total_est_miles: Math.round(miles),
      waypoints: routePointSamples(coords, track.name),
      daily_itinerary: [{
        day: 1,
        title: 'Imported GPX Track',
        description: 'Follow the imported track preview. Distance is estimated from GPX geometry.',
        est_miles: Math.round(miles),
        road_type: 'Imported GPX',
        highlights: ['Imported route line', 'Review camps, fuel, water, and access before departure'],
      }],
      logistics: {
        vehicle_recommendation: 'Verify the GPX route matches your vehicle and current trail access.',
        fuel_strategy: 'Check fuel range against the imported track distance.',
        water_strategy: 'Add water stops or download local essentials before leaving signal.',
        permits_needed: 'Check land manager rules for the imported route.',
        best_season: 'Confirm seasonal closures and weather before departure.',
      },
    },
    campsites: [],
    gas_stations: [],
    route_pois: [],
  };
}

export async function loadGpxImportBatches(): Promise<GpxImportBatch[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(BATCH_INDEX_PATH);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveGpxImportBatch(batch: GpxImportBatch) {
  const current = await loadGpxImportBatches();
  const next = [batch, ...current.filter(item => item.id !== batch.id)].slice(0, 25);
  await FileSystem.writeAsStringAsync(BATCH_INDEX_PATH, JSON.stringify(next));
  return next;
}

export async function removeGpxImportBatch(batchId: string) {
  const current = await loadGpxImportBatches();
  const next = current.filter(item => item.id !== batchId);
  await FileSystem.writeAsStringAsync(BATCH_INDEX_PATH, JSON.stringify(next));
  return next;
}

export const gpxTrackDistanceMiles = trackDistanceMiles;
