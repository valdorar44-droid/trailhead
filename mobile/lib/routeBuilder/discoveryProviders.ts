import type { OsmPoi } from '@/lib/api';

export type RouteBuilderDiscoveryPoint = { lat: number; lng: number };
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
