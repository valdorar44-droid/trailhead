import type { OsmPoi } from '../api';
import type { SearchResultV2, SearchSurfaceV2 } from '../searchV2/types';
import type { OfflineSearchIndexResultV2 } from './sqliteIndex';

/** Convert trusted SQLite FTS rows to the shared Search V2 presentation. */
export function offlineSearchIndexRowsToResults(
  groups: readonly (readonly OfflineSearchIndexResultV2[])[],
  surface: SearchSurfaceV2,
  limit: number,
): SearchResultV2[] {
  const cappedLimit = Math.max(1, Math.min(30, Math.trunc(limit || 10)));
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
) {
  const ids = new Set<string>();
  if (result.canonical_place_id) ids.add(String(result.canonical_place_id));
  if (result.result_id.startsWith('offline-v2:')) {
    ids.add(result.result_id.slice('offline-v2:'.length));
  } else if (result.result_id.startsWith('offline:')) {
    ids.add(result.result_id.slice('offline:'.length));
  }
  if (!ids.size) return null;
  for (const inventory of [canonical, fallback]) {
    const match = inventory.find(place => ids.has(String(place.id || '')));
    if (match) return match;
  }
  return null;
}
