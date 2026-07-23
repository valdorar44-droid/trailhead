import type { OsmPoi } from '../api';

const OFFLINE_V2_POI_TYPES = new Set<OsmPoi['type']>([
  'camp', 'camping', 'campground', 'campsite', 'rv', 'rv_park', 'dispersed_camp',
  'overnight_parking', 'informal_camp', 'wild_camp',
  'water', 'trail', 'trailhead', 'viewpoint', 'peak', 'pass', 'glacier', 'bridge',
  'checkpost', 'settlement', 'hot_spring', 'fuel', 'propane', 'dump', 'shower', 'laundromat',
  'lodging', 'private_stay', 'farm_stay', 'ranch', 'winery', 'glamping', 'private_camp',
  'food', 'grocery', 'mechanic', 'parking', 'attraction', 'hardware', 'medical',
  'parts', 'wifi', 'poi',
]);

const OFFLINE_V2_CAMP_PLACE_TYPES = new Set<OsmPoi['type']>([
  'camp', 'camping', 'campground', 'campsite', 'rv', 'rv_park',
  'dispersed_camp', 'overnight_parking', 'informal_camp', 'wild_camp',
  'private_stay', 'farm_stay', 'ranch', 'winery', 'glamping', 'private_camp',
]);

function normalizedPlaceType(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function normalizeOfflineV2PoiType(value: unknown): OsmPoi['type'] {
  const clean = normalizedPlaceType(value) as OsmPoi['type'];
  return OFFLINE_V2_POI_TYPES.has(clean) ? clean : 'poi';
}

export function isOfflineV2CampPlaceType(value: unknown): boolean {
  return OFFLINE_V2_CAMP_PLACE_TYPES.has(normalizedPlaceType(value) as OsmPoi['type']);
}
