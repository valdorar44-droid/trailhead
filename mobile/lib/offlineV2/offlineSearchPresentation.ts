import type { OsmPoi } from '../api';
import {
  offlineSearchPlaceMatchV2,
  offlineSearchRequestBoundsV2,
  type SearchablePlaceV2,
} from '../searchV2/presentation';
import type {
  SearchBoundsV2,
  SearchRequestV2,
  SearchResultV2,
  SearchSurfaceV2,
} from '../searchV2/types';
import type { OfflineSearchIndexResultV2 } from './sqliteIndex';
import type { OfflineBundleInstallationV2 } from './types';

export type DownloadedOfflineEntityKindV2 = 'place' | 'trail_profile';
export type DownloadedSearchResultPoiV2 = OsmPoi & Readonly<{
  offline_entity_kind?: DownloadedOfflineEntityKindV2;
}>;

export type OfflineSearchIndexDescriptorV2 = Readonly<{
  path: string;
  bounds?: SearchBoundsV2;
}>;
export type OfflineSearchIndexQueryV2 = (input: Readonly<{
  path: string;
  query: string;
  bounds?: SearchBoundsV2;
  limit: number;
  offset: number;
}>) => Promise<readonly OfflineSearchIndexResultV2[]>;

export const OFFLINE_SEARCH_INDEX_PAGE_SIZE_V2 = 50;
export const OFFLINE_SEARCH_INDEX_SCAN_CAP_V2 = 5_000;

/** Convert trusted SQLite FTS rows to the shared Search V2 presentation. */
export function offlineSearchIndexRowsToResults(
  groups: readonly (readonly OfflineSearchIndexResultV2[])[],
  surface: SearchSurfaceV2,
  limit: number,
  maximum = 30,
): SearchResultV2[] {
  const cappedMaximum = Math.max(1, Math.min(1_000, Math.trunc(maximum || 30)));
  const cappedLimit = Math.max(1, Math.min(cappedMaximum, Math.trunc(limit || 10)));
  const seen = new Set<string>();
  const results: SearchResultV2[] = [];
  for (const rows of groups) {
    for (const row of rows) {
      const id = row.canonical_place_id || row.result_id;
      if (seen.has(id)) continue;
      seen.add(id);
      results.push({
        result_id: `offline-v2:${id}`,
        canonical_place_id: row.canonical_place_id || null,
        title: row.title,
        subtitle: row.subtitle || null,
        kind: row.kind || 'place',
        categories: [row.kind || 'place'],
        coordinates: { lat: row.lat, lng: row.lng },
        parent: row.parent_destination || null,
        distance_meters: null,
        provenance: {
          provider: 'trailhead_offline_v2',
          source_label: 'Downloaded',
          provider_result_id: null,
          temporary_use_only: false,
        },
        persistence_policy: 'canonical',
        detail_ref: row.canonical_place_id ? `${surface}:${row.canonical_place_id}` : null,
        score: 1000 - results.length,
        match_reason: 'offline_index_match',
      });
      if (results.length >= cappedLimit) return results;
    }
  }
  return results;
}

/**
 * Join a thin FTS row back to the installed immutable place document before a
 * sheet opens. The canonical catalog wins; legacy inventory is fallback only.
 */
export function resolveDownloadedSearchResultPoi(
  result: Pick<SearchResultV2, 'result_id' | 'canonical_place_id'>,
  canonical: readonly OsmPoi[],
  fallback: readonly OsmPoi[] = [],
): DownloadedSearchResultPoiV2 | null {
  const ids = new Set<string>();
  if (result.canonical_place_id) ids.add(String(result.canonical_place_id));
  if (result.result_id.startsWith('offline-v2:')) {
    ids.add(result.result_id.slice('offline-v2:'.length));
  } else if (result.result_id.startsWith('offline:')) {
    ids.add(result.result_id.slice('offline:'.length));
  }
  if (!ids.size) return null;
  const canonicalMatch = canonical.find(place => ids.has(String(place.id || ''))) || null;
  const fallbackMatch = fallback.find(place => ids.has(String(place.id || ''))) || null;
  const merged = mergeDownloadedSearchResultPoi(canonicalMatch, fallbackMatch);
  if (!merged) return null;
  const canonicalTrailId = [...ids].find(id => id.startsWith('trail:'));
  const isTrail = merged.offline_entity_kind === 'trail_profile'
    || merged.type === 'trail'
    || merged.type === 'trailhead';
  if (!canonicalTrailId || !isTrail) return merged;
  return {
    ...merged,
    profile_id: merged.profile_id || canonicalTrailId,
    system_v2_id: merged.system_v2_id || canonicalTrailId,
  };
}

/**
 * The immutable V2 document owns canonical identity and verified fields. A
 * matching legacy download remains an additive source for durable detail that
 * was already stored on the device (for example campground site and rig
 * fields) while the migration is in progress.
 */
export function mergeDownloadedSearchResultPoi(
  canonical: OsmPoi | null | undefined,
  legacy: OsmPoi | null | undefined,
): DownloadedSearchResultPoiV2 | null {
  if (!canonical) return (legacy as DownloadedSearchResultPoiV2 | undefined) || null;
  if (!legacy || legacy === canonical) return canonical as DownloadedSearchResultPoiV2;
  const legacyRaw = recordValue(legacy.raw);
  const canonicalRaw = recordValue(canonical.raw);
  const canonicalDefined = Object.fromEntries(
    Object.entries(canonical).filter(([, value]) => value !== undefined),
  );
  return {
    ...legacy,
    ...canonicalDefined,
    raw: {
      ...legacyRaw,
      ...canonicalRaw,
    },
  } as DownloadedSearchResultPoiV2;
}

/** Apply full Search V2 intent/facet/spatial rules to thin installed FTS rows. */
export function filterDownloadedSearchResultsV2(
  request: SearchRequestV2,
  results: readonly SearchResultV2[],
  canonical: readonly OsmPoi[],
  fallback: readonly OsmPoi[] = [],
  limit = request.limit ?? 10,
  maximum = 30,
) {
  const cappedMaximum = Math.max(1, Math.min(1_000, Math.trunc(maximum || 30)));
  const cappedLimit = Math.max(1, Math.min(cappedMaximum, Math.trunc(limit || 10)));
  const filtered: SearchResultV2[] = [];
  for (const result of results) {
    const downloaded = resolveDownloadedSearchResultPoi(result, canonical, fallback);
    const searchable: SearchablePlaceV2 = downloaded
      ? { ...downloaded, type: result.kind || downloaded.type, kind: result.kind }
      : {
        id: result.canonical_place_id || result.result_id,
        name: result.title,
        lat: result.coordinates?.lat,
        lng: result.coordinates?.lng,
        kind: result.kind,
        categories: result.categories,
        address: result.parent || result.subtitle,
        source: result.provenance.provider,
        source_label: result.provenance.source_label,
      };
    const match = offlineSearchPlaceMatchV2(request, searchable);
    if (!match.matches) continue;
    filtered.push({
      ...result,
      kind: match.kind,
      categories: [...match.categories],
      coordinates: downloaded && Number.isFinite(downloaded.lat) && Number.isFinite(downloaded.lng)
        ? { lat: downloaded.lat, lng: downloaded.lng }
        : result.coordinates,
      distance_meters: match.distance_meters,
    });
    if (filtered.length >= cappedLimit) break;
  }
  return filtered;
}

/**
 * Page every spatially eligible index/partition, then globally rank the
 * post-filtered rows. Wrapped bounds are queried as two rectangles so dense
 * matches elsewhere cannot starve either side of the antimeridian.
 */
export async function searchDownloadedOfflineIndexesV2(input: Readonly<{
  request: SearchRequestV2;
  surface: SearchSurfaceV2;
  indexes: readonly OfflineSearchIndexDescriptorV2[];
  canonical: readonly OsmPoi[];
  fallback?: readonly OsmPoi[];
  queryIndex: OfflineSearchIndexQueryV2;
  page_size?: number;
  scan_cap_per_partition?: number;
}>): Promise<SearchResultV2[]> {
  const resultLimit = Math.max(1, Math.min(30, Math.trunc(input.request.limit ?? 10)));
  const pageSize = Math.max(1, Math.min(
    OFFLINE_SEARCH_INDEX_PAGE_SIZE_V2,
    Math.trunc(input.page_size ?? OFFLINE_SEARCH_INDEX_PAGE_SIZE_V2),
  ));
  const requestedScanCap = Math.max(pageSize, Math.min(
    OFFLINE_SEARCH_INDEX_SCAN_CAP_V2,
    Math.trunc(input.scan_cap_per_partition ?? OFFLINE_SEARCH_INDEX_SCAN_CAP_V2),
  ));
  const scanCap = Math.max(pageSize, Math.floor(requestedScanCap / pageSize) * pageSize);
  const partitions = offlineSearchBoundsPartitionsV2(input.request);
  const fallback = input.fallback || [];
  const ranked = new Map<string, RankedOfflineSearchCandidateV2>();

  for (const index of input.indexes) {
    for (const bounds of partitions) {
      if (bounds && index.bounds && !searchBoundsIntersectV2(bounds, index.bounds)) continue;
      for (let offset = 0; offset < scanCap; offset += pageSize) {
        let page: readonly OfflineSearchIndexResultV2[];
        try {
          page = await input.queryIndex({
            path: index.path,
            query: input.request.query,
            bounds,
            limit: pageSize,
            offset,
          });
        } catch {
          break;
        }
        const pageResults = offlineSearchIndexRowsToResults([page], input.surface, page.length || 1, pageSize);
        const pageMatches = filterDownloadedSearchResultsV2(
          input.request,
          pageResults,
          input.canonical,
          fallback,
          pageSize,
          pageSize,
        );
        const rowsById = new Map(page.map(row => [row.canonical_place_id || row.result_id, row]));
        for (const result of pageMatches) {
          const id = result.canonical_place_id || result.result_id;
          const row = rowsById.get(id);
          const candidate = rankedOfflineSearchCandidateV2(input.request.query, result, row);
          const current = ranked.get(id);
          if (!current || compareRankedOfflineSearchCandidatesV2(candidate, current) < 0) {
            ranked.set(id, candidate);
          }
        }
        if (page.length < pageSize) break;
      }
    }
  }
  return [...ranked.values()]
    .sort(compareRankedOfflineSearchCandidatesV2)
    .slice(0, resultLimit)
    .map((candidate, index) => ({
      ...candidate.result,
      score: 1000 - index,
    }));
}

type RankedOfflineSearchCandidateV2 = Readonly<{
  result: SearchResultV2;
  title_tier: 0 | 1 | 2;
  distance_meters: number;
  bm25_rank: number;
  stable_id: string;
}>;

function rankedOfflineSearchCandidateV2(
  query: string,
  result: SearchResultV2,
  row?: OfflineSearchIndexResultV2,
): RankedOfflineSearchCandidateV2 {
  const normalizedQuery = normalizeOfflineSearchRankingTextV2(query);
  const normalizedTitle = normalizeOfflineSearchRankingTextV2(result.title);
  const titleTier = normalizedQuery && normalizedTitle === normalizedQuery
    ? 0
    : normalizedQuery && normalizedTitle.startsWith(normalizedQuery) ? 1 : 2;
  const distance = typeof result.distance_meters === 'number'
    ? result.distance_meters
    : Number.POSITIVE_INFINITY;
  const bm25 = Number(row?.rank);
  return Object.freeze({
    result,
    title_tier: titleTier,
    distance_meters: Number.isFinite(distance) && distance >= 0 ? distance : Number.POSITIVE_INFINITY,
    bm25_rank: Number.isFinite(bm25) ? bm25 : Number.POSITIVE_INFINITY,
    stable_id: result.canonical_place_id || result.result_id,
  });
}

function compareRankedOfflineSearchCandidatesV2(
  left: RankedOfflineSearchCandidateV2,
  right: RankedOfflineSearchCandidateV2,
) {
  return left.title_tier - right.title_tier
    || left.distance_meters - right.distance_meters
    || left.bm25_rank - right.bm25_rank
    || left.stable_id.localeCompare(right.stable_id);
}

function normalizeOfflineSearchRankingTextV2(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function offlineSearchBoundsPartitionsV2(request: SearchRequestV2): readonly (SearchBoundsV2 | undefined)[] {
  const bounds = offlineSearchRequestBoundsV2(request);
  if (!bounds) return [undefined];
  if (bounds.west <= bounds.east) return [bounds];
  return [
    { ...bounds, east: 180 },
    { ...bounds, west: -180 },
  ];
}

function searchBoundsIntersectV2(left: SearchBoundsV2, right: SearchBoundsV2) {
  if (left.north < right.south || left.south > right.north) return false;
  const longitudeParts = (bounds: SearchBoundsV2): Array<[number, number]> => (
    bounds.west <= bounds.east
      ? [[bounds.west, bounds.east]]
      : [[bounds.west, 180], [-180, bounds.east]]
  );
  return longitudeParts(left).some(([leftWest, leftEast]) => (
    longitudeParts(right).some(([rightWest, rightEast]) => (
      leftEast >= rightWest && leftWest <= rightEast
    ))
  ));
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Pure installed-content fingerprint; the Expo catalog re-exports it. */
export function offlineInstallationRevisionV2(
  installations: readonly Pick<
    OfflineBundleInstallationV2,
    'bundle_id' | 'revision' | 'manifest_sha256' | 'installed_at_ms' | 'verified_at_ms'
  >[],
) {
  if (!installations.length) return 'empty';
  return installations
    .map(installation => [
      installation.bundle_id,
      installation.revision,
      installation.manifest_sha256.toLowerCase(),
      installation.installed_at_ms,
      installation.verified_at_ms || 0,
    ].map(value => encodeURIComponent(String(value))).join(':'))
    .sort()
    .join('|');
}
