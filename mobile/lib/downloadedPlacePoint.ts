import type { OsmPoi, PlacePackPoint } from './api';

export type DownloadedPlacePointRecord = PlacePackPoint & Record<string, unknown>;
export type DownloadedPlacePoi = OsmPoi & DownloadedPlacePointRecord;

export type DownloadedPlacePointOptions = Readonly<{
  normalizeSubtype?: (value: string) => string;
  sourceFallback?: string;
  sourceLabelFallback?: string;
  websitePreference?: 'booking_first' | 'official_first';
  amenitiesAsActivities?: boolean;
  markDownloaded?: boolean;
  normalizeNullPhoto?: boolean;
}>;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Adapts a legacy downloaded place-pack record for existing map/search UI.
 *
 * The spread is intentional: place packs have gained durable campground,
 * routing, alias, and specialist fields over time. Reconstructing records
 * field-by-field silently discarded those additions. Explicit assignments
 * below are limited to identity and the legacy presentation fallbacks.
 */
export function downloadedPlacePointToPoi(
  point: PlacePackPoint,
  options: DownloadedPlacePointOptions = {},
): DownloadedPlacePoi {
  const record = point as DownloadedPlacePointRecord & Partial<OsmPoi>;
  const originalSource = text(record.source);
  const source = originalSource || options.sourceFallback || 'offline';
  const sourceLabel = text(record.source_label)
    || text(record.source_badge)
    || originalSource
    || options.sourceLabelFallback;
  const subtypeSource = text(record.subtype);
  const subtype = options.normalizeSubtype
    ? options.normalizeSubtype(subtypeSource)
    : subtypeSource;
  const firstWebsite = options.websitePreference === 'official_first'
    ? text(record.official_url) || text(record.booking_url)
    : text(record.booking_url) || text(record.official_url);
  const website = text(record.website) || firstWebsite || undefined;
  const activities = Array.isArray(record.activities)
    ? record.activities
    : options.amenitiesAsActivities && Array.isArray(record.amenities)
      ? record.amenities
      : undefined;

  return {
    ...record,
    id: String(record.id),
    name: String(record.name),
    lat: Number(record.lat),
    lng: Number(record.lng),
    type: (record.type || 'poi') as OsmPoi['type'],
    subtype,
    source,
    source_label: sourceLabel,
    website,
    ...(activities ? { activities } : {}),
    ...(options.normalizeNullPhoto && !record.photo_url ? { photo_url: undefined } : {}),
    ...(options.markDownloaded ? { cache_status: 'downloaded' } : {}),
  } as DownloadedPlacePoi;
}
