import type { SearchRequestV2, SearchResultV2, SearchSurfaceV2 } from './types';
import type { SearchV2SessionStatus } from './session';
import { normalizeSearchV2Query } from './cache';

export type SearchV2EmptyStateInput = Readonly<{
  displayedQuery: string;
  settledQuery: string;
  status: SearchV2SessionStatus;
  isEnriching: boolean;
  resultCount: number;
  minimumQueryLength?: number;
}>;

/**
 * Empty copy is a terminal search result, not a placeholder between keystrokes.
 * Requiring the displayed and controller queries to match prevents a stale
 * `ready` state from flashing while React forwards the latest input.
 */
export function searchV2ShouldShowEmptyState({
  displayedQuery,
  settledQuery,
  status,
  isEnriching,
  resultCount,
  minimumQueryLength = 2,
}: SearchV2EmptyStateInput): boolean {
  const displayed = normalizeSearchV2Query(displayedQuery);
  const settled = normalizeSearchV2Query(settledQuery);
  return displayed.length >= minimumQueryLength
    && displayed === settled
    && (status === 'ready' || status === 'offline')
    && !isEnriching
    && resultCount === 0;
}

export type SearchablePlaceV2 = {
  id?: string | number | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  kind?: string | null;
  type?: string | null;
  subtype?: string | null;
  category?: string | null;
  categories?: readonly unknown[] | null;
  mapbox_categories?: readonly unknown[] | null;
  difficulty?: string | readonly unknown[] | null;
  surface?: string | readonly unknown[] | null;
  activity?: string | readonly unknown[] | null;
  activities?: readonly unknown[] | null;
  aliases?: readonly unknown[] | null;
  search_terms?: readonly unknown[] | null;
  local_terms?: readonly unknown[] | null;
  tags?: readonly unknown[] | null;
  provider?: string | null;
  verified?: boolean | null;
  address?: string | null;
  source?: string | null;
  source_label?: string | null;
  raw?: unknown;
};

export type OfflineSearchPlaceMatchV2 = Readonly<{
  matches: boolean;
  kind: string;
  categories: readonly string[];
  distance_meters: number | null;
}>;

const DEFAULT_NEARBY_RADIUS_METERS = 50_000;

const INTENT_FACETS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  destination: new Set([
    'destination', 'address', 'street', 'postcode', 'city', 'locality',
    'neighborhood', 'district', 'region', 'country', 'park', 'parks', 'public_land',
  ]),
  trail: new Set(['trail', 'trails', 'trailhead', 'hike', 'hiking', 'offroad_route', 'forest_road']),
  camp: new Set([
    'camp', 'camping', 'campground', 'campsite', 'rv', 'rv_park',
    'private_stay', 'private_camp', 'glamping', 'lodging', 'farm_stay',
    'ranch', 'winery', 'dispersed_camp', 'overnight_parking',
    'informal_camp', 'wild_camp',
  ]),
  service: new Set([
    'service', 'fuel', 'gas_station', 'service_station', 'resupply', 'grocery', 'market',
    'mechanic', 'repair', 'supplies', 'water', 'propane', 'dump', 'hardware', 'parts',
  ]),
});

const CATEGORY_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  camp: ['camping', 'campground', 'campsite'],
  camping: ['camp', 'campground', 'campsite'],
  campground: ['camp', 'camping', 'campsite'],
  private_camp: ['camp', 'camping', 'campground'],
  private_stay: ['camp', 'camping'],
  trail: ['trails', 'hike', 'hiking'],
  trails: ['trail', 'hike', 'hiking'],
  trailhead: ['trail', 'trails', 'hiking'],
  fuel: ['gas_station', 'service_station', 'service'],
  gas_station: ['fuel', 'service_station', 'service'],
  mechanic: ['repair', 'service'],
  grocery: ['market', 'supplies', 'service'],
  park: ['parks', 'destination'],
  parks: ['park', 'destination'],
});

export type SearchV2LegacyPlace = {
  name: string;
  lat: number;
  lng: number;
  id?: string;
  result_id: string;
  place_id?: string;
  source: string;
  source_label: string;
  type: string;
  subtype?: string;
  category?: string;
  feature_type?: string;
  address?: string;
  summary?: string;
  distance_meters?: number | null;
  persistence_policy: SearchResultV2['persistence_policy'];
  temporary_use_only: boolean;
  provider_result_id?: string;
  source_attribution?: string;
  detail_ref?: string;
  profile_id?: string;
};

export type SearchV2DisplayPlace = Omit<SearchV2LegacyPlace, 'lat' | 'lng'> & {
  lat?: number;
  lng?: number;
  /** True when this provider row must be resolved after the user presses it. */
  resolution_required: boolean;
};

function escapeSearchDisplayPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanSearchDisplayCandidate(value: unknown, title: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const escapedTitle = escapeSearchDisplayPattern(title.trim());
  const withoutRepeatedTitle = escapedTitle
    ? raw.replace(
      new RegExp(`(?:\\s*[,·|]\\s*|\\s+-\\s+)?${escapedTitle}\\s*$`, 'i'),
      '',
    )
    : raw;
  return withoutRepeatedTitle
    .replace(/\b(mapbox|geoapify|nominatim|openstreetmap)\b/gi, '')
    .replace(/_/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*·\s*·\s*/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,·|]+|[\s,·|]+$/g, '')
    .trim();
}

/**
 * Cleans provider display context without changing server order, result kind,
 * identity, or selection behavior. The subtitle is preferred, with parent as
 * a fallback only when the subtitle contains no useful context after cleanup.
 */
export function cleanSearchResultContextV2(result: SearchResultV2): string {
  for (const candidate of [result.subtitle, result.parent]) {
    const cleaned = cleanSearchDisplayCandidate(candidate, result.title);
    if (cleaned) return cleaned;
  }
  return '';
}

export function searchResultV2ToDisplayPlace(result: SearchResultV2): SearchV2DisplayPlace {
  const lat = typeof result.coordinates?.lat === 'number' && Number.isFinite(result.coordinates.lat)
    ? result.coordinates.lat
    : undefined;
  const lng = typeof result.coordinates?.lng === 'number' && Number.isFinite(result.coordinates.lng)
    ? result.coordinates.lng
    : undefined;
  const sourceLabel = cleanLabel(result.provenance?.source_label) || cleanLabel(result.kind) || 'Place';
  const normalizedKind = cleanKind(result.kind || result.categories?.[0] || 'place');
  const displayContext = cleanSearchResultContextV2(result);
  return {
    name: result.title,
    lat,
    lng,
    id: result.canonical_place_id || result.result_id,
    result_id: result.result_id,
    place_id: result.canonical_place_id || undefined,
    source: result.persistence_policy === 'canonical' ? 'trailhead_search' : result.provenance.provider || 'search',
    source_label: sourceLabel,
    type: result.kind || result.categories?.[0] || 'place',
    subtype: result.categories?.[0] || undefined,
    category: result.categories?.[0] || undefined,
    feature_type: result.kind || undefined,
    address: displayContext || undefined,
    summary: displayContext || undefined,
    distance_meters: result.distance_meters,
    persistence_policy: result.persistence_policy,
    temporary_use_only: result.persistence_policy === 'temporary'
      || result.provenance.temporary_use_only === true,
    provider_result_id: result.provenance.provider_result_id || undefined,
    source_attribution: result.provenance.attribution || undefined,
    detail_ref: result.detail_ref || undefined,
    profile_id: normalizedKind === 'trail' || normalizedKind === 'trailhead'
      ? result.canonical_place_id || result.detail_ref || undefined
      : undefined,
    resolution_required: lat == null || lng == null,
  };
}

export function searchPlaceIsTemporary(
  place: unknown,
) {
  if (!place || typeof place !== 'object') return false;
  const candidate = place as { persistence_policy?: unknown; temporary_use_only?: unknown };
  return candidate.persistence_policy === 'temporary' || candidate.temporary_use_only === true;
}

export function searchResultV2ToLegacyPlace(result: SearchResultV2): SearchV2LegacyPlace | null {
  const display = searchResultV2ToDisplayPlace(result);
  if (display.lat == null || display.lng == null) return null;
  const { resolution_required: _resolutionRequired, ...place } = display;
  return {
    ...place,
    lat: display.lat,
    lng: display.lng,
  };
}

export function offlineSearchResultsV2(
  request: SearchRequestV2,
  places: readonly SearchablePlaceV2[],
  surface: SearchSurfaceV2,
): SearchResultV2[] {
  const query = normalize(request.query);
  if (!query) return [];
  const tokens = query.split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.min(30, Math.round(request.limit ?? 10)));
  return places
    .map((place, index) => {
      const name = String(place.name || '').trim();
      const normalizedName = normalize(name);
      const subtitle = [place.subtype, place.address].map(cleanLabel).filter(Boolean).join(' · ');
      const haystack = normalize([
        name, place.type, place.subtype, place.category, place.address, place.source_label,
        ...(place.categories || []), ...(place.activities || []), ...(place.aliases || []),
        ...(place.search_terms || []), ...(place.local_terms || []), ...(place.tags || []),
        place.difficulty, place.surface, place.activity,
      ].filter(Boolean).join(' '));
      let score = 0;
      if (normalizedName === query) score += 120;
      if (normalizedName.startsWith(query)) score += 80;
      else if (normalizedName.includes(query)) score += 60;
      if (haystack.includes(query)) score += 30;
      for (const token of tokens) {
        if (normalizedName.includes(token)) score += 12;
        else if (haystack.includes(token)) score += 6;
      }
      const match = offlineSearchPlaceMatchV2(request, place);
      return { place, index, name, subtitle, score, match };
    })
    .filter(row => (
      row.name
      && row.score > 0
      && row.match.matches
      && Number.isFinite(Number(row.place.lat))
      && Number.isFinite(Number(row.place.lng))
    ))
    .sort((left, right) => (
      right.score - left.score
      || compareOptionalDistance(left.match.distance_meters, right.match.distance_meters)
      || left.index - right.index
    ))
    .slice(0, limit)
    .map(({ place, name, subtitle, score, index, match }) => {
      const stableId = String(place.id ?? `${Number(place.lat).toFixed(5)}:${Number(place.lng).toFixed(5)}:${index}`);
      return {
        result_id: `offline:${stableId}`,
        canonical_place_id: place.id == null ? null : String(place.id),
        title: name,
        subtitle: subtitle || null,
        kind: match.kind,
        categories: [...match.categories],
        coordinates: { lat: Number(place.lat), lng: Number(place.lng) },
        parent: place.address || null,
        distance_meters: match.distance_meters,
        provenance: {
          provider: 'trailhead_offline',
          source_label: cleanLabel(place.source_label) || 'Downloaded',
          provider_result_id: null,
          temporary_use_only: false,
        },
        persistence_policy: 'canonical',
        detail_ref: place.id == null ? null : `${surface}:${place.id}`,
        score,
        match_reason: 'offline_match',
      };
    });
}

/**
 * Applies the same intent, facet, and spatial contract to downloaded place
 * documents that the server applies to canonical Search V2 rows. Unknown
 * facet data never becomes a positive match for an explicit filter.
 */
export function offlineSearchPlaceMatchV2(
  request: SearchRequestV2,
  place: SearchablePlaceV2,
): OfflineSearchPlaceMatchV2 {
  const lat = finiteCoordinate(place.lat, -90, 90);
  const lng = finiteCoordinate(place.lng, -180, 180);
  const kind = cleanKind(place.type || place.kind || place.subtype || place.category || 'place') || 'place';
  const categories = offlineSearchPlaceCategoriesV2(place, kind);
  const values = new Set([kind, ...categories]);
  const intent = request.intent || 'any';
  let matches = lat != null && lng != null;

  if (matches && intent !== 'any') {
    if (intent === 'place') {
      matches = !['destination', 'city', 'locality', 'region', 'country'].includes(kind);
    } else {
      const accepted = INTENT_FACETS[intent];
      matches = Boolean(accepted && [...values].some(value => accepted.has(value)));
    }
  }

  const requestedCategories = normalizedValues(request.categories);
  if (matches && requestedCategories.size) {
    matches = [...values].some(value => requestedCategories.has(value));
  }

  if (matches && request.bounds && lat != null && lng != null) {
    matches = coordinateInBounds(lat, lng, request.bounds);
  }

  const centerLat = finiteCoordinate(request.center?.lat, -90, 90);
  const centerLng = finiteCoordinate(request.center?.lng, -180, 180);
  const distance = centerLat != null && centerLng != null && lat != null && lng != null
    ? searchDistanceMetersV2(centerLat, centerLng, lat, lng)
    : null;
  const radius = request.radius_meters != null
    ? Number(request.radius_meters)
    : request.scope === 'nearby' ? DEFAULT_NEARBY_RADIUS_METERS : null;
  if (matches && radius != null) {
    matches = Number.isFinite(radius) && radius > 0 && distance != null && distance <= radius;
  }

  if (matches && request.scope === 'route') {
    // Downloaded place rows do not currently contain a distance-to-route
    // projection. Returning them as on-route would be an unsupported claim.
    matches = false;
  }
  if (matches && request.scope === 'viewport' && !request.bounds) matches = false;

  if (matches) matches = offlineFiltersMatchV2(request.filters || {}, place, kind, categories);

  return Object.freeze({
    matches,
    kind,
    categories: Object.freeze(categories),
    distance_meters: distance == null ? null : Math.round(distance * 10) / 10,
  });
}

/** Bounding-box prefilter for nearby SQLite indexes; exact radius follows. */
export function offlineSearchRequestBoundsV2(request: SearchRequestV2) {
  if (request.bounds) return request.bounds;
  const radius = request.radius_meters != null
    ? Number(request.radius_meters)
    : request.scope === 'nearby' ? DEFAULT_NEARBY_RADIUS_METERS : null;
  const centerLat = finiteCoordinate(request.center?.lat, -90, 90);
  const centerLng = finiteCoordinate(request.center?.lng, -180, 180);
  if (centerLat == null || centerLng == null || radius == null || !Number.isFinite(radius) || radius <= 0) {
    return undefined;
  }
  const latitudeDelta = radius / 111_320;
  const longitudeScale = Math.max(0.000001, Math.abs(Math.cos(centerLat * Math.PI / 180)));
  const longitudeDelta = Math.min(180, radius / (111_320 * longitudeScale));
  const rawWest = centerLng - longitudeDelta;
  const rawEast = centerLng + longitudeDelta;
  return {
    west: longitudeDelta >= 180 ? -180 : wrapLongitude(rawWest),
    south: Math.max(-90, centerLat - latitudeDelta),
    east: longitudeDelta >= 180 ? 180 : wrapLongitude(rawEast),
    north: Math.min(90, centerLat + latitudeDelta),
  };
}

export function searchDistanceMetersV2(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const latDelta = toRadians(toLat - fromLat);
  const lngDelta = toRadians(toLng - fromLng);
  const rawA = Math.sin(latDelta / 2) ** 2
    + Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(lngDelta / 2) ** 2;
  const a = Math.max(0, Math.min(1, rawA));
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function offlineSearchPlaceCategoriesV2(place: SearchablePlaceV2, kind: string) {
  const raw = place.raw && typeof place.raw === 'object' && !Array.isArray(place.raw)
    ? place.raw as Record<string, unknown>
    : {};
  const categories = normalizedValues([
    kind,
    place.type,
    place.subtype,
    place.category,
    ...(place.categories || []),
    ...(place.mapbox_categories || []),
    raw.kind,
    raw.type,
    raw.subtype,
    raw.category,
    ...(Array.isArray(raw.categories) ? raw.categories : []),
    ...(Array.isArray(raw.subcategories) ? raw.subcategories : []),
    place.difficulty,
    place.surface,
    place.activity,
    ...(place.activities || []),
    raw.difficulty,
    raw.surface,
    raw.activity,
    ...(Array.isArray(raw.activities) ? raw.activities : []),
    ...(Array.isArray(raw.allowed_uses) ? raw.allowed_uses : []),
  ]);
  for (const category of [...categories]) {
    for (const alias of CATEGORY_ALIASES[category] || []) categories.add(alias);
  }
  return [...categories];
}

function offlineFiltersMatchV2(
  filters: NonNullable<SearchRequestV2['filters']>,
  place: SearchablePlaceV2,
  kind: string,
  categories: readonly string[],
) {
  const raw = place.raw && typeof place.raw === 'object' && !Array.isArray(place.raw)
    ? place.raw as Record<string, unknown>
    : {};
  const providers = normalizedValues([
    'trailhead',
    place.provider,
    raw.provider,
    place.source && String(place.source).startsWith('trailhead_') ? place.source : null,
  ]);
  const difficulties = normalizedValues([place.difficulty, raw.difficulty]);
  const surfaces = normalizedValues([place.surface, raw.surface]);
  const activities = normalizedValues([
    place.activity,
    ...(place.activities || []),
    raw.activity,
    ...(Array.isArray(raw.activities) ? raw.activities : []),
  ]);
  const categorySet = new Set(categories);
  for (const [key, value] of Object.entries(filters)) {
    const requested = normalizedValues(value);
    if (key === 'kind' || key === 'kinds') {
      if (!requested.has(kind)) return false;
    } else if (key === 'category' || key === 'categories') {
      if (![...requested].some(item => categorySet.has(item))) return false;
    } else if (key === 'difficulty') {
      if (![...requested].some(item => difficulties.has(item))) return false;
    } else if (key === 'surface') {
      if (![...requested].some(item => surfaces.has(item))) return false;
    } else if (key === 'activity') {
      if (![...requested].some(item => activities.has(item))) return false;
    } else if (key === 'provider' || key === 'providers') {
      if (![...requested].some(item => providers.has(item))) return false;
    } else if (key === 'verified') {
      const expected = booleanFilter(value);
      const actual = typeof place.verified === 'boolean'
        ? place.verified
        : typeof raw.verified === 'boolean' ? raw.verified : false;
      if (expected == null || expected !== actual) return false;
    } else if (key === 'has_coordinates') {
      const expected = booleanFilter(value);
      if (expected == null || expected !== true) return false;
    }
  }
  return true;
}

function normalizedValues(value: unknown): Set<string> {
  const output = new Set<string>();
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (item == null || typeof item === 'object') return;
    const normalized = cleanKind(item);
    if (normalized) output.add(normalized);
  };
  visit(value);
  return output;
}

function booleanFilter(value: unknown): boolean | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate === 'boolean') return candidate;
  if (candidate === 1 || candidate === '1' || String(candidate).toLowerCase() === 'true') return true;
  if (candidate === 0 || candidate === '0' || String(candidate).toLowerCase() === 'false') return false;
  return null;
}

function finiteCoordinate(value: unknown, low: number, high: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= low && number <= high ? number : null;
}

function coordinateInBounds(
  lat: number,
  lng: number,
  bounds: NonNullable<SearchRequestV2['bounds']>,
) {
  const withinLng = bounds.west <= bounds.east
    ? lng >= bounds.west && lng <= bounds.east
    : lng >= bounds.west || lng <= bounds.east;
  return withinLng && lat >= bounds.south && lat <= bounds.north;
}

function wrapLongitude(value: number) {
  if (value < -180) return value + 360;
  if (value > 180) return value - 360;
  return value;
}

function compareOptionalDistance(left: number | null, right: number | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function cleanLabel(value: unknown): string {
  const raw = String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!raw) return '';
  return raw.replace(/\b\w/g, character => character.toUpperCase());
}

function cleanKind(value: unknown): string {
  return normalize(value).replace(/\s+/g, '_');
}
