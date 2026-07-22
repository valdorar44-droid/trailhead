import type { SearchIntentV2, SearchResultV2 } from './types';

export function exploreSearchIntentForCategory(category: string): SearchIntentV2 {
  if (category === 'camp' || category === 'glamping' || category === 'huts') return 'camp';
  if (category === 'trails' || category === 'trailheads') return 'trail';
  if (category === 'fuel' || category === 'resupply') return 'service';
  if (category === 'parks' || category === 'nearby') return 'destination';
  return 'any';
}

export function exploreSearchCategoriesForCategory(category: string): string[] | undefined {
  if (category === 'all' || category === 'guided' || category === 'tours' || category === 'nearby') return undefined;
  // These values deliberately mirror the generated Explore catalog's raw
  // category/group facets. UI labels such as "Cabins" and "Views" must not
  // be sent to Search V2 as invented facets that match no real records.
  if (category === 'camp') {
    return ['camping', 'campground', 'rv_park', 'dispersed_camp', 'overnight_parking', 'private_camp'];
  }
  if (category === 'glamping') return ['glamping'];
  if (category === 'huts') return ['lodging'];
  if (category === 'trails') return ['trails', 'trail', 'offroad_route', 'forest_road'];
  if (category === 'trailheads') return ['trailhead'];
  if (category === 'views') return ['viewpoint', 'peak', 'waterfall', 'scenic_drive'];
  if (category === 'peaks') return ['peak'];
  if (category === 'waterfalls') return ['waterfall'];
  if (category === 'springs') return ['hot_spring'];
  if (category === 'climb') return ['climbing', 'climbing_area'];
  if (category === 'water') return ['water', 'lake', 'waterfall', 'hot_spring', 'glacier'];
  if (category === 'scenic') return ['drives', 'scenic_drive', 'historic', 'viewpoint'];
  if (category === 'parks') return ['parks', 'park'];
  if (category === 'land') return ['public_land'];
  if (category === 'fuel') return ['fuel', 'gas_station', 'service_station'];
  if (category === 'resupply') return ['grocery', 'market', 'repair', 'supplies'];
  if (category === 'things') {
    return ['things', 'activity', 'historic', 'visitor_center', 'permit_required', 'scenic_drive', 'park', 'trail', 'viewpoint', 'peak', 'waterfall', 'climbing_area'];
  }
  return [category];
}

export function canonicalSearchResultIdV2(
  result: Pick<SearchResultV2, 'canonical_place_id' | 'persistence_policy' | 'provenance'>,
) {
  if (result.persistence_policy !== 'canonical' || result.provenance.temporary_use_only) return '';
  return String(result.canonical_place_id || '').trim();
}

export function isTemporarySearchResultV2(
  result: Pick<SearchResultV2, 'persistence_policy' | 'provenance'>,
) {
  return result.persistence_policy === 'temporary' || result.provenance.temporary_use_only;
}

export function formatSearchDistanceV2(
  distanceMeters: number | null | undefined,
  unitMode: 'auto' | 'imperial' | 'metric' = 'auto',
) {
  if (!Number.isFinite(distanceMeters) || distanceMeters == null || distanceMeters < 0) return '';
  if (unitMode === 'metric') {
    if (distanceMeters < 1000) return `${Math.max(1, Math.round(distanceMeters / 10) * 10)} m`;
    const km = distanceMeters / 1000;
    return `${km >= 10 ? km.toFixed(0) : km.toFixed(1)} km`;
  }
  const miles = distanceMeters / 1609.344;
  if (miles < 0.1) return `${Math.max(50, Math.round((distanceMeters * 3.28084) / 50) * 50)} ft`;
  return `${miles >= 10 ? miles.toFixed(0) : miles.toFixed(1)} mi`;
}
