import type { RouteWeatherResult, WeatherForecast } from './api';

export const ROUTE_WEATHER_FALLBACK_MAX_MILES = 20;

export type RouteWeatherWaypoint = {
  name: string;
  lat?: number;
  lng?: number;
  day?: number;
  type?: string;
};

export type RouteWeatherCacheEnvelope = {
  schema_version: 2;
  units: string;
  waypoint_signature: string;
  result: RouteWeatherResult;
};

const EARTH_RADIUS_MILES = 3_958.8;

type Coordinate = { lat?: number; lng?: number };

function validCoordinate(coordinate: Coordinate): coordinate is { lat: number; lng: number } {
  return Number.isFinite(coordinate.lat)
    && Number.isFinite(coordinate.lng)
    && (coordinate.lat as number) >= -90
    && (coordinate.lat as number) <= 90
    && (coordinate.lng as number) >= -180
    && (coordinate.lng as number) <= 180;
}

/**
 * Route weather is only requested and cached for waypoints the weather
 * endpoint can resolve. Keep this normalization shared by every producer and
 * reader so itinerary-only rows (for example, a note without coordinates) do
 * not create a different cache identity.
 */
export function routeWeatherEligibleWaypoints<T extends RouteWeatherWaypoint>(
  waypoints: readonly T[],
): T[] {
  return waypoints.filter(waypoint => validCoordinate({
    lat: waypoint.lat,
    lng: waypoint.lng,
  }));
}

function distanceMiles(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(to.lat - from.lat);
  const longitudeDelta = toRadians(to.lng - from.lng);
  const fromLatitude = toRadians(from.lat);
  const toLatitude = toRadians(to.lat);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function routeWeatherWaypointSignature(waypoints: readonly RouteWeatherWaypoint[]) {
  return JSON.stringify(routeWeatherEligibleWaypoints(waypoints).map(waypoint => ({
    name: String(waypoint.name || '').trim().toLowerCase(),
    day: Number.isFinite(waypoint.day) ? waypoint.day : null,
    type: String(waypoint.type || '').trim().toLowerCase(),
    lat: Number.isFinite(waypoint.lat) ? Number(waypoint.lat!.toFixed(4)) : null,
    lng: Number.isFinite(waypoint.lng) ? Number(waypoint.lng!.toFixed(4)) : null,
  })));
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function routeWeatherCacheFileName(
  tripId: string,
  units: string,
  waypointSignature: string,
) {
  const safeTripId = String(tripId || 'trip').replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
  const safeUnits = String(units || 'auto').replace(/[^a-z0-9_-]/gi, '_').slice(0, 20);
  return `route_weather_v2_${safeTripId}_${safeUnits}_${stableHash(`${safeUnits}|${waypointSignature}`)}.json`;
}

export function routeWeatherCacheEnvelope(
  result: RouteWeatherResult,
  units: string,
  waypointSignature: string,
): RouteWeatherCacheEnvelope {
  return {
    schema_version: 2,
    units,
    waypoint_signature: waypointSignature,
    result,
  };
}

export function routeWeatherForecastForWaypoint(
  result: RouteWeatherResult | null | undefined,
  waypoint: RouteWeatherWaypoint,
  maxDistanceMiles = ROUTE_WEATHER_FALLBACK_MAX_MILES,
): WeatherForecast | null {
  const forecasts = result?.forecasts;
  if (!forecasts) return null;

  const exact = forecasts[waypoint.name];
  if (exact) return exact;
  const waypointCoordinate = { lat: waypoint.lat, lng: waypoint.lng };
  if (!validCoordinate(waypointCoordinate)) return null;

  let nearest: WeatherForecast | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const forecast of Object.values(forecasts)) {
    const forecastCoordinate = { lat: forecast.latitude, lng: forecast.longitude };
    if (!validCoordinate(forecastCoordinate)) continue;
    const distance = distanceMiles(waypointCoordinate, forecastCoordinate);
    if (distance < nearestDistance) {
      nearest = forecast;
      nearestDistance = distance;
    }
  }

  return nearestDistance <= maxDistanceMiles ? nearest : null;
}

export function routeWeatherResultFromCache(
  value: unknown,
  units: string,
  waypointSignature: string,
  waypoints: readonly RouteWeatherWaypoint[],
): RouteWeatherResult | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as Partial<RouteWeatherCacheEnvelope>;
  if (
    envelope.schema_version !== 2
    || envelope.units !== units
    || envelope.waypoint_signature !== waypointSignature
    || !envelope.result?.forecasts
    || Object.keys(envelope.result.forecasts).length === 0
  ) return null;

  const eligibleWaypoints = routeWeatherEligibleWaypoints(waypoints);
  const camps = eligibleWaypoints.filter(waypoint => waypoint.type === 'camp');
  const requiredWaypoints = camps.length > 0 ? camps : eligibleWaypoints.slice(0, 1);
  if (!requiredWaypoints.length) return null;
  return requiredWaypoints.every(waypoint => (
    !!routeWeatherForecastForWaypoint(envelope.result, waypoint)?.daily?.time?.length
  )) ? envelope.result : null;
}
