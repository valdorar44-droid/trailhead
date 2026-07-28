import type { OfflineBundlePrepareRequestV2 } from './preparation';

export const TRAIL_PACK_CORRIDOR_M = 1200;
export const TRAIL_PACK_STYLE_ID = 'outdoors';

export function trailPackClientRefV2(trailId: string) {
  return `trail:${trailId}`;
}

function coordinateBounds(
  coords: readonly (readonly [number, number])[],
  corridorM: number,
) {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  for (const pair of coords) {
    const lng = Number(pair?.[0]);
    const lat = Number(pair?.[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)
      || lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  }
  if (west > east || south > north) {
    throw new Error('A complete verified trail route is required for this download.');
  }
  const middleLat = (south + north) / 2;
  const latDelta = corridorM / 110_540;
  const lngDelta = corridorM / Math.max(
    30_000,
    111_320 * Math.cos(middleLat * Math.PI / 180),
  );
  return Object.freeze({
    west: Math.max(-180, west - lngDelta),
    south: Math.max(-90, south - latDelta),
    east: Math.min(180, east + lngDelta),
    north: Math.min(90, north + latDelta),
  });
}

export function createTrailPackRequestV2(input: Readonly<{
  trailId: string;
  geometryRevision: string;
  coords: readonly (readonly [number, number])[];
  corridorM?: number;
}>): OfflineBundlePrepareRequestV2 {
  const trailId = input.trailId.trim();
  const geometryRevision = input.geometryRevision.trim();
  const corridorM = Math.round(input.corridorM ?? TRAIL_PACK_CORRIDOR_M);
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{2,239}$/.test(trailId)) {
    throw new Error('This trail does not have a stable offline identity.');
  }
  if (geometryRevision.length < 3 || geometryRevision.length > 240) {
    throw new Error('Refresh this trail before downloading it.');
  }
  if (corridorM < 250 || corridorM > 5000) {
    throw new Error('The trail download corridor is invalid.');
  }
  return Object.freeze({
    // The server re-derives these bounds from the exact versioned route. This
    // local box gives older compatible servers a bounded, honest fallback.
    bounds: coordinateBounds(input.coords, corridorM),
    min_zoom: 8,
    max_zoom: 15,
    renderer_style_id: TRAIL_PACK_STYLE_ID,
    scope: Object.freeze({
      kind: 'trail',
      trail_id: trailId,
      geometry_revision: geometryRevision,
      corridor_m: corridorM,
    }),
    // Routing, contours, and regional trail graphs continue through the
    // existing verified V1 repositories. The trail-scoped V2 manifest owns
    // the Outdoors corridor, canonical trail, nearby places, and local search.
    options: Object.freeze({ routing: false, contours: false, extended_media: false }),
  });
}

export function isTrailPackClientRefV2(value: string | null | undefined) {
  return typeof value === 'string' && value.startsWith('trail:') && value.length > 6;
}
