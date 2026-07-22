import type { CampsiteDetail, CampsitePin, OsmPoi } from '../api';

const CAMP_PLACE_TYPES = new Set([
  'camp', 'camping', 'informal_camp', 'wild_camp', 'private_stay',
  'farm_stay', 'ranch', 'winery', 'glamping', 'private_camp',
]);

const DURABLE_CAMPSITE_KEYS = new Set([
  'id', 'name', 'type', 'loop', 'map_card_id', 'facility_id', 'lat', 'lng',
  'max_people', 'equipment_length', 'driveway', 'surface', 'accessible',
  'shade', 'fire', 'pets', 'hookups', 'check_in', 'check_out', 'reserve_type',
]);

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : [];
}

function optionalString(value: unknown) {
  const clean = String(value || '').trim();
  return clean || undefined;
}

function optionalCount(value: unknown) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function durableCampsites(value: unknown): NonNullable<CampsiteDetail['campsites']> {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const site = Object.fromEntries(Object.entries(candidate).filter(([key, item]) => (
      DURABLE_CAMPSITE_KEYS.has(key)
      && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
    )));
    return Object.keys(site).length ? [site] : [];
  }) as NonNullable<CampsiteDetail['campsites']>;
}

function durableReservations(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const result: Record<string, string | boolean> = {};
  for (const key of ['reservation_url', 'reservable', 'required']) {
    const item = source[key];
    if (typeof item === 'string' || typeof item === 'boolean') result[key] = item;
  }
  return Object.keys(result).length ? result : undefined;
}

/**
 * Adapt the immutable V2 place document to the existing campground sheet.
 * The whitelist intentionally excludes live weather, reports, closures,
 * reservation availability, and current inventory.
 */
export function offlineV2PlaceToCampPin(place: OsmPoi): CampsitePin | null {
  if (
    !CAMP_PLACE_TYPES.has(String(place.type || ''))
    || !Number.isFinite(place.lat)
    || !Number.isFinite(place.lng)
  ) return null;
  const source = place as OsmPoi & Record<string, unknown>;
  const sourceLabel = optionalString(source.source_badge)
    || optionalString(place.source_label)
    || 'Downloaded';
  const bookingUrl = optionalString(source.booking_url) || '';
  const officialUrl = optionalString(source.official_url || source.website) || '';
  const siteTypes = strings(source.site_types);
  const campTypes = strings(source.camp_types);
  const activities = strings(source.activities);
  const campsites = durableCampsites(source.campsites);
  const campsiteCount = optionalCount(source.campsites_count)
    ?? optionalCount(source.campsite_count)
    ?? campsites.length;
  const subtype = optionalString(place.subtype);
  const notes = [
    subtype,
    optionalString(place.address),
    optionalString(source.source_freshness),
    officialUrl ? 'Official listing.' : '',
    bookingUrl ? 'Booking details.' : '',
  ].filter(Boolean).join(' ');
  const reservations = durableReservations(source.reservations);

  return {
    id: String(place.id || `offline:camp:${place.lat.toFixed(5)}:${place.lng.toFixed(5)}`),
    name: place.name || 'Saved camp',
    lat: place.lat,
    lng: place.lng,
    tags: [...new Set([...strings(source.tags), ...siteTypes, ...campTypes, 'saved'])],
    land_type: optionalString(source.land_type) || sourceLabel,
    description: optionalString(source.description || source.summary) || notes || 'Saved camp details.',
    amenities: strings(source.amenities),
    site_types: siteTypes,
    reservable: Boolean(source.reservable || bookingUrl),
    cost: optionalString(source.cost),
    url: bookingUrl || officialUrl,
    official_url: officialUrl,
    booking_url: bookingUrl,
    ada: Boolean(source.ada),
    source: 'trailhead_offline_v2',
    verified_source: sourceLabel,
    source_badge: sourceLabel,
    source_freshness: optionalString(source.source_freshness),
    last_checked: source.last_checked as number | string | undefined,
    phone: optionalString(source.phone),
    address: optionalString(source.address),
    route_distance_mi: place.route_distance_mi,
    route_fit: place.route_fit,
    route_progress: place.route_progress,
    route_progress_mi: place.route_progress_mi,
    route_segment_index: place.route_segment_index,
    activities,
    camp_types: campTypes,
    campsite_count: campsiteCount,
    campsites_count: campsiteCount,
    campsites,
    max_rig_length: optionalString(source.max_rig_length),
    max_vehicle_length: optionalString(source.max_vehicle_length),
    max_trailer_length: optionalString(source.max_trailer_length),
    max_rv_length: optionalString(source.max_rv_length),
    rig_suitability: optionalString(source.rig_suitability),
    vehicle_suitability: optionalString(source.vehicle_suitability),
    rig_types: strings(source.rig_types),
    vehicle_types: strings(source.vehicle_types),
    access_notes: optionalString(source.access_notes),
    bail_out_notes: optionalString(source.bail_out_notes),
    stay_limit: optionalString(source.stay_limit),
    reservation_notes: optionalString(source.reservation_notes),
    source_confidence_notes: optionalString(source.source_confidence_notes),
    reservations,
  } as CampsitePin;
}

export function isOfflineV2CampPin(camp: CampsitePin) {
  return String(camp.source || '') === 'trailhead_offline_v2';
}

/** Preserve downloaded sheet detail without introducing volatile live fields. */
export function offlineV2CampPinToDetail(camp: CampsitePin): CampsiteDetail {
  const source = camp as CampsitePin & Record<string, unknown>;
  const campsites = durableCampsites(source.campsites);
  const count = optionalCount(source.campsites_count)
    ?? optionalCount(source.campsite_count)
    ?? campsites.length;
  return {
    id: camp.id,
    name: camp.name,
    lat: camp.lat,
    lng: camp.lng,
    tags: strings(camp.tags),
    land_type: camp.land_type || '',
    description: camp.description || '',
    amenities: strings(camp.amenities),
    site_types: strings(camp.site_types),
    photos: [],
    activities: strings(source.activities),
    campsites_count: count,
    campsites,
    reservable: Boolean(camp.reservable),
    cost: camp.cost || '',
    url: camp.url || '',
    official_url: camp.official_url,
    booking_url: camp.booking_url,
    ada: Boolean(camp.ada),
    source: 'trailhead_offline_v2',
    verified_source: camp.source_badge || camp.verified_source,
    source_badge: camp.source_badge,
    source_freshness: camp.source_freshness,
    source_confidence_notes: optionalString(source.source_confidence_notes || source.source_freshness),
    last_checked: camp.last_checked,
    phone: camp.phone,
    address: camp.address,
    access_notes: optionalString(source.access_notes),
    bail_out_notes: optionalString(source.bail_out_notes),
    stay_limit: optionalString(source.stay_limit),
    reservation_notes: optionalString(source.reservation_notes),
    max_rig_length: optionalString(source.max_rig_length),
    camp_types: strings(source.camp_types),
    campsite_count: count,
    max_vehicle_length: optionalString(source.max_vehicle_length),
    max_trailer_length: optionalString(source.max_trailer_length),
    max_rv_length: optionalString(source.max_rv_length),
    rig_suitability: optionalString(source.rig_suitability),
    vehicle_suitability: optionalString(source.vehicle_suitability),
    rig_types: strings(source.rig_types),
    vehicle_types: strings(source.vehicle_types),
    reservations: durableReservations(source.reservations),
  } as CampsiteDetail;
}
