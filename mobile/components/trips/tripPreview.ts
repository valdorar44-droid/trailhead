import type { SavedEntityV1, TripDocumentV2 } from '@/lib/tripRepository';

export type TripPreviewPin = {
  id: string;
  title: string;
  lat: number;
  lng: number;
  kind?: string;
  active?: boolean;
};

export type TripPreviewMedia = {
  imageUrl?: string;
  pins: TripPreviewPin[];
};

const IMAGE_KEYS = [
  'hero_image_url',
  'heroImageUrl',
  'hero_photo_url',
  'heroPhotoUrl',
  'image_url',
  'imageUrl',
  'thumbnail_url',
  'thumbnailUrl',
  'photo_url',
  'photoUrl',
  'primary_image',
  'primaryImage',
  'cover_image',
  'coverImage',
] as const;

const IMAGE_COLLECTION_KEYS = ['media', 'images', 'photos', 'photo_candidates', 'photoCandidates'] as const;
const LEGACY_WRAPPER_KEYS = ['payload', 'legacy_v1', 'legacyV1', 'trip', 'result', 'data'] as const;
const LEGACY_PLACE_KEYS = [
  'campsites',
  'route_pois',
  'routePois',
  'gas_stations',
  'gasStations',
  'waypoints',
  'places',
  'stops',
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mediaUrl(value: unknown): string | undefined {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^(https?:\/\/|file:\/\/|content:\/\/|data:image\/)/i.test(clean) ? clean : undefined;
}

function imageFromRecord(value: unknown): string | undefined {
  const source = record(value);
  if (!source) return undefined;
  for (const key of IMAGE_KEYS) {
    const url = mediaUrl(source[key]);
    if (url) return url;
  }
  for (const key of IMAGE_COLLECTION_KEYS) {
    const collection = source[key];
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      const url = mediaUrl(item) || mediaUrl(record(item)?.url) || imageFromRecord(item);
      if (url) return url;
    }
  }
  return undefined;
}

function legacyPayloadRecords(value: unknown) {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    const source = record(current?.value);
    if (!source || seen.has(source)) continue;
    seen.add(source);
    records.push(source);
    if ((current?.depth ?? 0) >= 4) continue;
    for (const key of LEGACY_WRAPPER_KEYS) {
      if (source[key]) queue.push({ value: source[key], depth: (current?.depth ?? 0) + 1 });
    }
  }
  return records;
}

function legacyPlaces(sources: Record<string, unknown>[]) {
  return sources.flatMap(source => {
    const plan = record(source.plan);
    return [
      ...LEGACY_PLACE_KEYS.map(key => source[key]),
      ...LEGACY_PLACE_KEYS.map(key => plan?.[key]),
    ].flatMap(value => Array.isArray(value) ? value : []);
  });
}

function coordinates(value: unknown): { lat: number; lng: number } | null {
  const source = record(value);
  if (!source) return null;
  const nested = record(source.coordinates) || record(source.coordinate) || record(source.location);
  const lat = Number(source.lat ?? source.latitude ?? nested?.lat ?? nested?.latitude);
  const lng = Number(source.lng ?? source.lon ?? source.longitude ?? nested?.lng ?? nested?.lon ?? nested?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
}

function routeCoordinates(route: unknown): Array<{ lat: number; lng: number }> {
  const source = record(route);
  if (!source) return [];
  const nested = record(source.route_geometry) || record(source.routeGeometry) || record(source.geometry) || record(source.payload);
  const raw = source.coords || source.coordinates || nested?.coords || nested?.coordinates;
  if (!Array.isArray(raw)) return [];
  const valid = raw.flatMap(value => {
    if (!Array.isArray(value) || value.length < 2) return [];
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? [{ lat, lng }]
      : [];
  });
  if (valid.length <= 6) return valid;
  const indexes = [0, 0.2, 0.4, 0.6, 0.8, 1].map(position => Math.round((valid.length - 1) * position));
  return [...new Set(indexes)].map(index => valid[index]);
}

function pushPin(pins: TripPreviewPin[], seen: Set<string>, pin: TripPreviewPin) {
  const key = `${pin.lat.toFixed(4)},${pin.lng.toFixed(4)}`;
  if (seen.has(key) || pins.length >= 12) return;
  seen.add(key);
  pins.push(pin);
}

export function tripPreviewMedia(
  document: TripDocumentV2,
  savedEntitiesById: ReadonlyMap<string, SavedEntityV1>,
): TripPreviewMedia {
  const linkedEntities = document.items.flatMap(item => {
    const entity = item.entityId ? savedEntitiesById.get(item.entityId) : undefined;
    return entity ? [entity] : [];
  });
  const legacySources = legacyPayloadRecords(document.legacy?.payload);
  const legacyGroups = legacyPlaces(legacySources);
  const imageUrl = linkedEntities
    .flatMap(entity => entity.media
      .filter(media => media.kind !== 'video')
      .map(media => mediaUrl(media.url)))
    .find(Boolean)
    || document.items.map(item => imageFromRecord(item.facts)).find(Boolean)
    || document.bookings.map(imageFromRecord).find(Boolean)
    || legacySources.map(imageFromRecord).find(Boolean)
    || legacyGroups.map(imageFromRecord).find(Boolean);

  const pins: TripPreviewPin[] = [];
  const seen = new Set<string>();
  document.items.forEach((item, index) => {
    const linked = item.entityId ? savedEntitiesById.get(item.entityId) : undefined;
    const point = item.coordinates || linked?.coordinates;
    if (!point) return;
    pushPin(pins, seen, {
      id: item.id || `item-${index}`,
      title: item.title,
      lat: point.lat,
      lng: point.lng,
      kind: item.kind,
      active: index === 0,
    });
  });
  legacyGroups.forEach((value, index) => {
    const point = coordinates(value);
    if (!point) return;
    const source = record(value);
    pushPin(pins, seen, {
      id: String(source?.id || `legacy-${index}`),
      title: String(source?.name || source?.title || document.title),
      lat: point.lat,
      lng: point.lng,
      kind: String(source?.type || source?.kind || ''),
      active: pins.length === 0,
    });
  });
  const legacyRoutes = legacySources.flatMap(source => [
    source.route_geometry,
    source.routeGeometry,
    source.route,
    record(source.plan)?.route_geometry,
    record(source.plan)?.routeGeometry,
    record(source.plan)?.route,
  ]);
  [document.route, ...legacyRoutes].forEach((route, routeIndex) => {
    routeCoordinates(route).forEach((point, index) => {
      pushPin(pins, seen, {
        id: `route-${routeIndex}-${index}`,
        title: document.title,
        lat: point.lat,
        lng: point.lng,
        kind: 'route',
        active: pins.length === 0,
      });
    });
  });

  return { imageUrl, pins };
}
