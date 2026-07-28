import { XMLParser } from 'fast-xml-parser';

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

export type GpxWaypoint = GpxPoint & { type: 'waypoint' };

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

export function gpxTrackDistanceMiles(coords: readonly [number, number][]) {
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

export function parseGpx(content: string, fileName = 'Imported GPX'): ParsedGpx {
  const parsed = parser.parse(content);
  const gpx = parsed?.gpx;
  if (!gpx) throw new Error('This file is not a valid GPX document.');
  const name = cleanGpxName(gpx?.metadata?.name || gpx?.name || fileName);
  const waypoints = asArray(gpx.wpt)
    .map(pointFromNode)
    .filter((point): point is GpxPoint => Boolean(point))
    .map(point => ({ ...point, type: 'waypoint' as const }));
  const routePoints = asArray(gpx.rte)
    .flatMap((route: any) => asArray(route?.rtept))
    .map(pointFromNode)
    .filter((point): point is GpxPoint => Boolean(point));
  const tracks: GpxTrack[] = [];
  for (const [trackIndex, track] of asArray(gpx.trk).entries()) {
    const points = asArray(track?.trkseg)
      .flatMap((segment: any) => asArray(segment?.trkpt))
      .map(pointFromNode)
      .filter((point): point is GpxPoint => Boolean(point));
    const coords = points.map(point => [point.lng, point.lat] as [number, number]);
    if (coords.length < 2) continue;
    const trackName = cleanGpxName(track?.name || `${name} Track ${trackIndex + 1}`, `${name} Track ${trackIndex + 1}`);
    tracks.push({
      name: trackName,
      coords,
      rawPointCount: coords.length,
      distanceMiles: gpxTrackDistanceMiles(coords),
    });
  }
  if (tracks.length === 0 && routePoints.length >= 2) {
    const coords = routePoints.map(point => [point.lng, point.lat] as [number, number]);
    tracks.push({ name, coords, rawPointCount: coords.length, distanceMiles: gpxTrackDistanceMiles(coords) });
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
