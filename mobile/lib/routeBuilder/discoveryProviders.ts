import type { OsmPoi } from '@/lib/api';

export type RouteBuilderDiscoveryPoint = { lat: number; lng: number };
export type RouteBuilderPointProvider<T extends RouteBuilderDiscoveryPoint> = (
  point: RouteBuilderDiscoveryPoint,
) => Promise<T[]>;
export type RouteBuilderPoiFallbackQuery = readonly [query: string, type: OsmPoi['type']];
export type RouteBuilderPoiFallbackProvider = (
  query: string,
  center: RouteBuilderDiscoveryPoint,
  radiusMi: number,
  type: OsmPoi['type'],
  limit: number,
) => Promise<OsmPoi[]>;

export const ROUTE_BUILDER_POI_FALLBACK_QUERIES: RouteBuilderPoiFallbackQuery[] = [
  ['trailhead', 'trailhead'],
  ['viewpoint', 'viewpoint'],
  ['water', 'water'],
  ['grocery', 'grocery'],
];

export type SearchRouteBuilderFallbackPoisInput = {
  points: RouteBuilderDiscoveryPoint[];
  radiusMi: number;
  limitPerQuery: number;
  provider: RouteBuilderPoiFallbackProvider;
  queries?: RouteBuilderPoiFallbackQuery[];
};

export async function searchRouteBuilderFallbackPois({
  points,
  radiusMi,
  limitPerQuery,
  provider,
  queries = ROUTE_BUILDER_POI_FALLBACK_QUERIES,
}: SearchRouteBuilderFallbackPoisInput): Promise<OsmPoi[]> {
  const batches = await Promise.all(points.flatMap(point =>
    queries.map(([query, type]) => provider(query, point, radiusMi, type, limitPerQuery).catch(() => [] as OsmPoi[]))
  ));
  return batches.flat();
}

export type SearchRouteBuilderProviderAtPointsInput<T extends RouteBuilderDiscoveryPoint> = {
  points: RouteBuilderDiscoveryPoint[];
  provider: RouteBuilderPointProvider<T>;
  dedupe?: (items: T[]) => T[];
};

export async function searchRouteBuilderProviderAtPoints<T extends RouteBuilderDiscoveryPoint>({
  points,
  provider,
  dedupe,
}: SearchRouteBuilderProviderAtPointsInput<T>): Promise<T[]> {
  const batches = await Promise.all(points.map(point => provider(point).catch(() => [] as T[])));
  const items = batches.flat();
  return dedupe ? dedupe(items) : items;
}
