import type { CampsiteDetail, OsmPoi } from '@/lib/api';

const TRIP_SERVICE_PLACE_TYPES = new Set(['fuel', 'propane', 'water', 'dump', 'parking', 'mechanic', 'grocery', 'food', 'hardware', 'parts']);
const VISITOR_CENTER_PLACE_TYPES = new Set(['visitor_center', 'visitor center', 'ranger_station', 'visitor']);
const THINGS_TO_SEE_PLACE_TYPES = new Set(['viewpoint', 'overlook', 'vista', 'peak', 'park', 'historic', 'attraction', 'monument', 'museum']);

function nearbyType(place: Partial<OsmPoi> | null | undefined) {
  return String(place?.type || (place as { category?: string | null } | null)?.category || '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function isTripServicePlace(place: Partial<OsmPoi> | null | undefined) {
  return TRIP_SERVICE_PLACE_TYPES.has(nearbyType(place));
}

export function isVisitorCenterPlace(place: Partial<OsmPoi> | null | undefined) {
  const type = nearbyType(place);
  const name = String(place?.name || '').toLowerCase();
  return VISITOR_CENTER_PLACE_TYPES.has(type) || /visitor\s+center|ranger\s+station/.test(name);
}

export function isSightPlace(place: Partial<OsmPoi> | null | undefined) {
  return THINGS_TO_SEE_PLACE_TYPES.has(nearbyType(place));
}

function hasNearbyPhoto(place: Partial<OsmPoi> | null | undefined) {
  const photos = (place as { photos?: Array<string | { url?: string | null }> } | null)?.photos;
  const first = Array.isArray(photos) ? photos[0] : null;
  const firstUrl = typeof first === 'string' ? first : first?.url;
  return !!((place as { photo_url?: string | null } | null)?.photo_url || firstUrl);
}

function photoBackedNearbyPlace(place: Partial<OsmPoi> | null | undefined) {
  const photoStatus = String((place as { photo_status?: string | null } | null)?.photo_status || '').toLowerCase();
  return hasNearbyPhoto(place) && photoStatus !== 'placeholder';
}

export function isLowValueGenericBlmPlace(place: Partial<OsmPoi> | null | undefined, keepServices = false) {
  if (!place) return false;
  const type = nearbyType(place);
  if (keepServices && TRIP_SERVICE_PLACE_TYPES.has(type)) return false;
  const name = String(place.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const source = String(
    (place as { source?: string; source_label?: string; source_badge?: string; attribution?: string }).source ||
    (place as { source_label?: string }).source_label ||
    (place as { source_badge?: string }).source_badge ||
    (place as { attribution?: string }).attribution ||
    ''
  ).toLowerCase();
  const lowName = !name || ['blm recreation site', 'recreation site', 'trailhead', 'viewpoint', 'parking', 'campground', 'campsite'].includes(name);
  return source.includes('blm') && lowName && !hasNearbyPhoto(place);
}

export function qualityGuideRail(items: OsmPoi[], options: { photoFirst?: boolean; keepServices?: boolean } = {}) {
  const cleaned = items.filter(item => !isLowValueGenericBlmPlace(item, !!options.keepServices));
  if (!options.photoFirst) return cleaned;
  const photoBacked = cleaned.filter(photoBackedNearbyPlace);
  const named = cleaned.filter(item => !photoBackedNearbyPlace(item) && !['trailhead', 'viewpoint', 'parking', 'campground', 'campsite'].includes(String(item.name || '').toLowerCase().trim()));
  return photoBacked.length ? [...photoBacked, ...named].slice(0, Math.max(photoBacked.length, 4)) : named;
}

export function normalizeCampDetailArrays(detail: CampsiteDetail): CampsiteDetail {
  const usefulRail = (items: OsmPoi[] | undefined, keepServices = false) =>
    (Array.isArray(items) ? items : []).filter(item => !isLowValueGenericBlmPlace(item, keepServices));
  return {
    ...detail,
    tags: Array.isArray(detail.tags) ? detail.tags : [],
    photos: Array.isArray(detail.photos) ? detail.photos : [],
    amenities: Array.isArray(detail.amenities) ? detail.amenities : [],
    site_types: Array.isArray(detail.site_types) ? detail.site_types : [],
    activities: Array.isArray(detail.activities) ? detail.activities : [],
    campsites: Array.isArray(detail.campsites) ? detail.campsites : [],
    reviews: Array.isArray((detail as { reviews?: unknown[] }).reviews) ? ((detail as { reviews?: unknown[] }).reviews as CampsiteDetail['reviews']) : [],
    things_to_do: usefulRail(detail.things_to_do),
    things_to_see: usefulRail(detail.things_to_see),
    visitor_centers: Array.isArray(detail.visitor_centers) ? detail.visitor_centers : [],
    campgrounds_nearby: Array.isArray(detail.campgrounds_nearby) ? detail.campgrounds_nearby : [],
    trip_services: usefulRail(detail.trip_services, true),
  } as CampsiteDetail;
}

export function buildCampNearbyGroups(places: OsmPoi[]) {
  const feedPlaces = places.filter(place => !isLowValueGenericBlmPlace(place, isTripServicePlace(place)));
  return {
    feedPlaces,
    visitorCenters: qualityGuideRail(feedPlaces.filter(isVisitorCenterPlace), { photoFirst: true }),
    tripServices: qualityGuideRail(feedPlaces.filter(isTripServicePlace), { keepServices: true }),
    sights: qualityGuideRail(feedPlaces.filter(place => !isTripServicePlace(place) && !isVisitorCenterPlace(place) && isSightPlace(place)), { photoFirst: true }),
    things: qualityGuideRail(feedPlaces.filter(place => !isTripServicePlace(place) && !isVisitorCenterPlace(place) && !isSightPlace(place)), { photoFirst: true }),
  };
}
