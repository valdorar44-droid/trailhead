import * as SQLite from 'expo-sqlite';
import type { OfflineBoundsV2 } from './types';
import { offlineFtsPrefixQuery } from './offlineSearchQuery';

export type OfflineSearchIndexResultV2 = Readonly<{
  result_id: string;
  canonical_place_id?: string;
  title: string;
  subtitle?: string;
  kind: string;
  lat: number;
  lng: number;
  parent_destination?: string;
  /** SQLite FTS5 bm25 rank; lower values are more relevant. */
  rank?: number;
}>;

function pathParts(path: string) {
  const clean = path.replace(/\/+$/, '');
  const slash = clean.lastIndexOf('/');
  if (slash < 0) throw new Error('The offline search database path is invalid.');
  return { directory: clean.slice(0, slash), name: clean.slice(slash + 1) };
}

async function openIndex(path: string) {
  const { directory, name } = pathParts(path);
  const database = await SQLite.openDatabaseAsync(name, {
    useNewConnection: true,
    // FTS5 owns internal statements that Expo must not finalize a second time
    // while closeAsync tears down this short-lived verification/search handle.
    finalizeUnusedStatementsBeforeClosing: false,
  }, directory);
  await database.execAsync('PRAGMA query_only = ON;');
  return database;
}

/**
 * Validates the generated artifact before its bundle can be promoted. The
 * table names are the V2 compatibility boundary shared with the materializer.
 */
export async function validateExpoOfflineSearchIndex(
  path: string,
  expectedRecords?: number,
) {
  const database = await openIndex(path);
  try {
    const quick = await database.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check;');
    if (String(quick?.quick_check || '').toLowerCase() !== 'ok') {
      throw new Error('The offline search database failed its integrity check.');
    }
    const schema = await database.getAllAsync<{ name: string; sql: string | null }>(
      `SELECT name, sql FROM sqlite_master
       WHERE name IN ('offline_search_documents', 'offline_search_fts', 'offline_search_spatial')`,
    );
    const byName = new Map(schema.map(row => [row.name, String(row.sql || '')]));
    if (!byName.has('offline_search_documents')) {
      throw new Error('The offline search document table is missing.');
    }
    if (!/using\s+fts5/i.test(byName.get('offline_search_fts') || '')) {
      throw new Error('The offline FTS5 index is missing.');
    }
    if (!/using\s+rtree/i.test(byName.get('offline_search_spatial') || '')) {
      throw new Error('The offline spatial index is missing.');
    }
    const count = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM offline_search_documents',
    );
    if (expectedRecords != null && Number(count?.count) !== expectedRecords) {
      throw new Error(`The offline search index contains ${Number(count?.count || 0)} of ${expectedRecords} records.`);
    }
  } finally {
    await database.closeAsync();
  }
}

export async function searchExpoOfflineIndex(input: Readonly<{
  path: string;
  query: string;
  bounds?: OfflineBoundsV2;
  limit?: number;
  offset?: number;
}>): Promise<readonly OfflineSearchIndexResultV2[]> {
  const query = offlineFtsPrefixQuery(input.query);
  if (!query) return Object.freeze([]);
  const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20)));
  const offset = Math.max(0, Math.min(10_000, Math.trunc(input.offset ?? 0)));
  const database = await openIndex(input.path);
  try {
    const rows = input.bounds
      ? await database.getAllAsync<OfflineSearchIndexResultV2>(
        `SELECT d.result_id, d.canonical_place_id, d.title, d.subtitle, d.kind,
                d.lat, d.lng, d.parent_destination, bm25(offline_search_fts) AS rank
           FROM offline_search_fts f
           JOIN offline_search_documents d ON d.rowid = f.rowid
           JOIN offline_search_spatial s ON s.id = d.rowid
          WHERE offline_search_fts MATCH ?
            AND s.min_lng <= ? AND s.max_lng >= ?
            AND s.min_lat <= ? AND s.max_lat >= ?
          ORDER BY bm25(offline_search_fts), d.title, d.result_id
          LIMIT ? OFFSET ?`,
        query, input.bounds.east, input.bounds.west,
        input.bounds.north, input.bounds.south, limit, offset,
      )
      : await database.getAllAsync<OfflineSearchIndexResultV2>(
        `SELECT d.result_id, d.canonical_place_id, d.title, d.subtitle, d.kind,
                d.lat, d.lng, d.parent_destination, bm25(offline_search_fts) AS rank
           FROM offline_search_fts f
           JOIN offline_search_documents d ON d.rowid = f.rowid
          WHERE offline_search_fts MATCH ?
          ORDER BY bm25(offline_search_fts), d.title, d.result_id
          LIMIT ? OFFSET ?`,
        query, limit, offset,
      );
    return Object.freeze(rows.map(row => Object.freeze({
      ...row,
      lat: Number(row.lat),
      lng: Number(row.lng),
      rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : undefined,
    })));
  } finally {
    await database.closeAsync();
  }
}
