import type { RouteBuildResult, RouteStyleMode, TripShapeMode } from '@/lib/api';
import type { DayRouteSegment, ProviderRouteGeometry, RouteBuilderStopLike, RouteShapeDayRole } from './model';

const MI_PER_METER = 1 / 1609.344;

export function haversineMi(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function coordsToPoints(coords: [number, number][]) {
  return coords.map(([lng, lat]) => ({ lat, lng }));
}

export function pointsToCoords(points: Array<{ lat: number; lng: number }>): [number, number][] {
  return points.map(point => [point.lng, point.lat]);
}

export function routeDistanceMi(points: Array<{ lat: number; lng: number }>) {
  let miles = 0;
  for (let i = 1; i < points.length; i += 1) miles += haversineMi(points[i - 1], points[i]);
  return miles;
}

export function pointAtRouteMile(points: Array<{ lat: number; lng: number }>, targetMi: number) {
  if (points.length === 0) return null;
  if (points.length === 1 || targetMi <= 0) return points[0];
  let traveled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const seg = haversineMi(from, to);
    if (traveled + seg >= targetMi) {
      const t = seg > 0 ? (targetMi - traveled) / seg : 0;
      return {
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
      };
    }
    traveled += seg;
  }
  return points[points.length - 1];
}

export function scenicPoint(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  progress: number,
  offsetMi: number,
) {
  const t = Math.max(0, Math.min(1, progress));
  const base = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
  if (!offsetMi || t <= 0 || t >= 1) return base;
  const avgLat = ((from.lat + to.lat) / 2) * Math.PI / 180;
  const milesPerLng = Math.max(8, 69 * Math.cos(avgLat));
  const dx = (to.lng - from.lng) * milesPerLng;
  const dy = (to.lat - from.lat) * 69;
  const len = Math.hypot(dx, dy);
  if (!len) return base;
  const bow = Math.sin(Math.PI * t) * offsetMi;
  const perpLngMi = -dy / len * bow;
  const perpLatMi = dx / len * bow;
  return {
    lat: base.lat + perpLatMi / 69,
    lng: base.lng + perpLngMi / milesPerLng,
  };
}

export function buildRouteLocationsForShape(input: {
  shape: TripShapeMode;
  start: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  routeStyle?: RouteStyleMode;
}) {
  const directMi = haversineMi(input.start, input.destination);
  const offset = Math.max(22, Math.min(120, directMi * 0.14));
  if (input.shape === 'loop') {
    return [
      { lat: input.start.lat, lng: input.start.lng, type: 'break' as const, role: 'start' as const },
      { ...scenicPoint(input.start, input.destination, 0.48, offset), type: 'through' as const, role: 'outbound_anchor' as const },
      { lat: input.destination.lat, lng: input.destination.lng, type: 'break' as const, role: 'destination' as const },
      { ...scenicPoint(input.destination, input.start, 0.48, offset), type: 'through' as const, role: 'return_anchor' as const },
      { lat: input.start.lat, lng: input.start.lng, type: 'break' as const, role: 'return_anchor' as const },
    ];
  }
  if (input.shape === 'there_and_back') {
    return [
      { lat: input.start.lat, lng: input.start.lng, type: 'break' as const, role: 'start' as const },
      { lat: input.destination.lat, lng: input.destination.lng, type: 'break' as const, role: 'destination' as const },
      { lat: input.start.lat, lng: input.start.lng, type: 'break' as const, role: 'return_anchor' as const },
    ];
  }
  return [
    { lat: input.start.lat, lng: input.start.lng, type: 'break' as const, role: 'start' as const },
    { lat: input.destination.lat, lng: input.destination.lng, type: 'break' as const, role: 'destination' as const },
  ];
}

export function decodePolyline6(shape: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < shape.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = shape.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= shape.length);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0;
    result = 0;
    do {
      byte = shape.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= shape.length);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    const coord: [number, number] = [lng / 1e6, lat / 1e6];
    if (Number.isFinite(coord[0]) && Number.isFinite(coord[1])) coords.push(coord);
  }
  return coords;
}

export function providerGeometryFromRoute(result: RouteBuildResult | null | undefined, units: 'miles' | 'kilometers' = 'miles'): ProviderRouteGeometry {
  const coords = (result?.trip?.legs ?? []).flatMap(leg => typeof leg.shape === 'string' ? decodePolyline6(leg.shape) : []);
  const summaryLength = Number(result?.trip?.summary?.length);
  const summaryTime = Number(result?.trip?.summary?.time);
  const engine = result?._trailhead?.engine;
  const fallbackEngine = engine === 'osrm-fallback' || (result as any)?._fallback?.engine === 'osrm';
  const totalDistanceMi = Number.isFinite(summaryLength) && summaryLength > 0
    ? summaryLength * (units === 'kilometers' ? 0.621371 : 1)
    : routeDistanceMi(coordsToPoints(coords));
  return {
    coords,
    totalDistanceMi,
    totalDurationHours: Number.isFinite(summaryTime) && summaryTime > 0 ? summaryTime / 3600 : Math.max(0, totalDistanceMi / 42),
    source: coords.length >= 2 ? 'provider' : 'none',
    confidence: coords.length >= 2 ? (fallbackEngine ? 'medium' : 'high') : 'none',
    engine,
  };
}

export function routeShapeDayRole(shape: TripShapeMode, day: number, days: number[]): RouteShapeDayRole {
  if (shape === 'one_way') return 'one_way';
  const ordered = days.length ? [...days].sort((a, b) => a - b) : [day];
  const lastDay = ordered[ordered.length - 1] ?? day;
  const midpoint = Math.max(1, Math.min(lastDay, Math.ceil(lastDay / 2)));
  if (shape === 'there_and_back' || shape === 'loop') {
    if (day < midpoint) return 'outbound';
    if (day === midpoint) return 'turnaround';
    return 'return';
  }
  return 'one_way';
}

export function savedGeometryFromCoords(
  coords: [number, number][] | undefined,
  totalDistanceMeters?: number,
  totalDurationSeconds?: number,
): ProviderRouteGeometry {
  const points = coordsToPoints(coords ?? []);
  const calculatedMi = routeDistanceMi(points);
  const meters = Number(totalDistanceMeters);
  const seconds = Number(totalDurationSeconds);
  return {
    coords: coords ?? [],
    totalDistanceMi: Number.isFinite(meters) && meters > 0 ? meters * MI_PER_METER : calculatedMi,
    totalDurationHours: Number.isFinite(seconds) && seconds > 0 ? seconds / 3600 : Math.max(0, calculatedMi / 42),
    source: coords && coords.length >= 2 ? 'saved' : 'none',
    confidence: coords && coords.length >= 2 ? 'high' : 'none',
  };
}

export function computeDaySegmentsFromRouteGeometry(input: {
  geometry: ProviderRouteGeometry;
  days: number[];
  maxDriveHoursByDay?: Record<number, number | undefined>;
  defaultMaxDriveHours?: number | null;
  campWindowForDay?: (day: number) => { start: number; end: number; label: string };
  shape?: TripShapeMode;
}): DayRouteSegment[] {
  const days = input.days.length ? input.days : [1];
  const points = coordsToPoints(input.geometry.coords);
  const totalMi = input.geometry.totalDistanceMi || routeDistanceMi(points);
  const totalHours = input.geometry.totalDurationHours || Math.max(0, totalMi / 42);
  return days.map((day, idx) => {
    const startMi = totalMi * (idx / days.length);
    const endMi = totalMi * ((idx + 1) / days.length);
    const distance = Math.max(0, endMi - startMi);
    const hours = totalMi > 0 ? totalHours * (distance / totalMi) : 0;
    const maxHours = input.maxDriveHoursByDay?.[day] ?? input.defaultMaxDriveHours ?? 5;
    const window = input.campWindowForDay?.(day) ?? { start: day, end: day, label: `Day ${day}` };
    return {
      day,
      startPoint: pointAtRouteMile(points, startMi) ?? points[0] ?? { lat: 0, lng: 0 },
      endPoint: pointAtRouteMile(points, endMi) ?? points[points.length - 1] ?? { lat: 0, lng: 0 },
      targetRouteMile: endMi,
      providerDistanceMi: distance,
      providerDurationHours: hours,
      campWindowStart: window.start,
      campWindowEnd: window.end,
      campWindowLabel: window.label,
      overDailyMax: hours > maxHours + 0.05,
      routeSource: input.geometry.source,
      confidence: input.geometry.confidence,
      routeShapeRole: input.shape ? routeShapeDayRole(input.shape, day, days) : undefined,
    };
  });
}

export function isTemporaryRouteAnchor(stop: RouteBuilderStopLike) {
  if (stop.routePointType === 'side_stop' || stop.routeShapeRole === 'side_stop') return false;
  if (stop.routeShapeRole === 'outbound_anchor' && stop.source === 'map') return true;
  if (/target area|camp search area|overnight area|route sketch/i.test(`${stop.name} ${stop.description ?? ''}`)) return true;
  return false;
}

export function filterDurableNavigationStops<T extends RouteBuilderStopLike>(stops: T[]) {
  return stops.filter(stop => {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return false;
    if (isTemporaryRouteAnchor(stop)) return false;
    if (stop.routePointType === 'side_stop') return false;
    return true;
  });
}

export function rebalanceAfterCampSelection<T extends RouteBuilderStopLike>(input: {
  stops: T[];
  selectedCamp: T;
  selectedDay: number;
  finalStop?: T | null;
}) {
  const sorted = [...input.stops].sort((a, b) => a.day - b.day);
  const final = input.finalStop ?? sorted[sorted.length - 1] ?? null;
  if (!final || final.day <= input.selectedDay) return input.stops;
  return input.stops.map(stop => {
    if (stop.day <= input.selectedDay || stop.day >= final.day || !isTemporaryRouteAnchor(stop)) return stop;
    const t = (stop.day - input.selectedDay) / (final.day - input.selectedDay);
    return {
      ...stop,
      lat: input.selectedCamp.lat + (final.lat - input.selectedCamp.lat) * t,
      lng: input.selectedCamp.lng + (final.lng - input.selectedCamp.lng) * t,
      name: `Day ${stop.day} overnight area`,
      description: `Updated after selecting ${input.selectedCamp.name.split(',')[0]}. Choose a camp before navigation.`,
      camp: undefined,
      gas: undefined,
      poi: undefined,
      source: 'map',
    };
  });
}
