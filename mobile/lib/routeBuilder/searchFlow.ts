import type { OsmPoi } from '@/lib/api';

const DEFAULT_OFFLINE_SEARCH_LIMIT = 10;
const DEFAULT_ROUTE_BUILDER_SEARCH_LIMIT = 12;

export type RouteBuilderStopType = 'start' | 'fuel' | 'waypoint' | 'camp' | 'motel';

export type RouteBuilderSearchPlace = {
  name: string;
  lat: number;
  lng: number;
  source?: string;
  source_label?: string;
  feature_type?: string;
  place_types?: string[];
  category?: string;
  type?: string;
  subtype?: string;
  address?: string;
};

export type RouteBuilderSearchStopDraft = {
  name: string;
  lat: number;
  lng: number;
  type: RouteBuilderStopType;
  description: string;
  land_type: string;
  source: 'search';
};

export type ResolveRouteBuilderSearchResultsInput = {
  query: string;
  offlinePlaces: OsmPoi[];
  searchOnline: (query: string) => Promise<RouteBuilderSearchPlace[]>;
  limit?: number;
  offlineLimit?: number;
  catalogFirst?: boolean;
};

export async function resolveRouteBuilderSearchResults({
  query,
  offlinePlaces,
  searchOnline,
  limit = DEFAULT_ROUTE_BUILDER_SEARCH_LIMIT,
  offlineLimit = DEFAULT_OFFLINE_SEARCH_LIMIT,
  catalogFirst = true,
}: ResolveRouteBuilderSearchResultsInput): Promise<RouteBuilderSearchPlace[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];
  const offlineMatches = searchOfflineRouteBuilderPlaces(offlinePlaces, cleanQuery, offlineLimit);
  const onlineMatches = await searchOnline(cleanQuery).catch(() => [] as RouteBuilderSearchPlace[]);
  return dedupeRouteBuilderSearchPlaces(catalogFirst ? [...offlineMatches, ...onlineMatches] : [...onlineMatches, ...offlineMatches], limit);
}

export function searchOfflineRouteBuilderPlaces(points: OsmPoi[], query: string, limit = DEFAULT_OFFLINE_SEARCH_LIMIT): RouteBuilderSearchPlace[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  return points
    .map(place => {
      const name = place.name.toLowerCase();
      const text = offlineRouteBuilderPlaceSearchText(place);
      let score = 0;
      if (name === q) score += 120;
      if (name.includes(q)) score += 70;
      if (text.includes(q)) score += 45;
      for (const token of tokens) {
        if (name.includes(token)) score += 16;
        else if (text.includes(token)) score += 8;
      }
      if (place.source?.includes('pakistan') || text.includes('pakistan') || text.includes('karakoram')) score += 4;
      return { place, score };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name))
    .slice(0, limit)
    .map(({ place }) => ({
      name: `${place.name}${place.subtype ? ` · ${String(place.subtype).replace(/_/g, ' ')}` : ''}`,
      lat: place.lat,
      lng: place.lng,
      source: 'search',
      source_label: place.source_label,
      type: place.type,
      subtype: place.subtype,
      address: place.address,
    }));
}

export function dedupeRouteBuilderSearchPlaces<T extends RouteBuilderSearchPlace>(items: T[], limit = DEFAULT_ROUTE_BUILDER_SEARCH_LIMIT): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
    const key = `${item.name.toLowerCase()}:${item.lat.toFixed(4)}:${item.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildRouteBuilderSearchStop(place: RouteBuilderSearchPlace, type: RouteBuilderStopType): RouteBuilderSearchStopDraft {
  return {
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    type,
    description: type === 'start' ? 'Manual route start.' : 'Manual route stop.',
    land_type: type === 'fuel' || type === 'motel' ? 'town' : 'route',
    source: 'search',
  };
}

function offlineRouteBuilderPlaceSearchText(place: OsmPoi) {
  const extra = place as unknown as Record<string, unknown>;
  return [
    place.name,
    place.type,
    place.subtype,
    place.source_label,
    place.address,
    place.trek_name,
    place.stage_name,
    ...arrayField(extra, 'aliases'),
    ...arrayField(extra, 'search_terms'),
    ...arrayField(extra, 'local_terms'),
    ...arrayField(extra, 'tags'),
    ...arrayField(extra, 'site_types'),
  ].filter(Boolean).join(' ').toLowerCase();
}

function arrayField(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return Array.isArray(value) ? value : [];
}
