import assert from 'node:assert/strict';
import { deleteRemoteTripWithRevisionRebase } from '../deleteSync';
import {
  canonicalTripRouteForWrite,
  compactTripListPath,
  normalizeTripLegacyV1,
  OMITTED_SERVER_LEGACY_SOURCE,
  preserveOmittedServerLegacy,
  requireMatchingTripDetailRevision,
  TripDetailResolutionError,
  tripLegacyV1ForWrite,
} from '../compactSync';

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

async function conflictRebasesAgainstTheLiveDraft() {
  const calls: Array<{ path: string; method: string; key?: string }> = [];
  let deleteCount = 0;
  const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const method = options.method ?? 'GET';
    const headers = options.headers as Record<string, string> | undefined;
    calls.push({ path, method, key: headers?.['Idempotency-Key'] });
    if (method === 'DELETE') {
      deleteCount += 1;
      if (deleteCount === 1) throw httpError(409);
      return undefined as T;
    }
    return { trip_id: 'draft-a', status: 'draft', revision: 7 } as T;
  };

  await deleteRemoteTripWithRevisionRebase('draft-a', 2, 'delete-key', request);
  assert.deepEqual(calls.map(call => [call.method, call.path]), [
    ['DELETE', '/api/trips/v2/draft-a?expected_revision=2'],
    ['GET', '/api/trips/v2/draft-a?include_deleted=true'],
    ['DELETE', '/api/trips/v2/draft-a?expected_revision=7'],
  ]);
  assert.equal(calls[0]?.key, 'delete-key');
  assert.match(calls[2]?.key ?? '', /^delete-key:rebase:1:7$/);

  const longKeys: string[] = [];
  let longDeleteCount = 0;
  await deleteRemoteTripWithRevisionRebase('long-key', 1, 'k'.repeat(240), async <T>(_path: string, options: RequestInit = {}) => {
    const headers = options.headers as Record<string, string> | undefined;
    if (headers?.['Idempotency-Key']) longKeys.push(headers['Idempotency-Key']);
    if ((options.method ?? 'GET') === 'DELETE') {
      longDeleteCount += 1;
      if (longDeleteCount === 1) throw httpError(409);
      return undefined as T;
    }
    return { trip_id: 'long-key', status: 'draft', revision: 9 } as T;
  });
  assert.ok(longKeys.every(key => key.length <= 160));
  assert.match(longKeys[1] ?? '', /:rebase:1:9$/);
}

async function missingOrAlreadyDeletedTripsSucceed() {
  let missingCalls = 0;
  await deleteRemoteTripWithRevisionRebase('missing', 3, 'missing-key', async <T>() => {
    missingCalls += 1;
    throw httpError(404);
  });
  assert.equal(missingCalls, 1);

  const methods: string[] = [];
  await deleteRemoteTripWithRevisionRebase('gone', 4, 'gone-key', async <T>(_path: string, options: RequestInit = {}) => {
    const method = options.method ?? 'GET';
    methods.push(method);
    if (method === 'DELETE') throw httpError(409);
    return { trip_id: 'gone', status: 'deleted', revision: 5 } as T;
  });
  assert.deepEqual(methods, ['DELETE', 'GET']);
}

async function rebaseIsBoundedAndNeverDeletesANonDraft() {
  let deleteCount = 0;
  let getCount = 0;
  await assert.rejects(
    deleteRemoteTripWithRevisionRebase('moving', 1, 'moving-key', async <T>(_path: string, options: RequestInit = {}) => {
      if ((options.method ?? 'GET') === 'DELETE') {
        deleteCount += 1;
        throw httpError(409);
      }
      getCount += 1;
      return { trip_id: 'moving', status: 'draft', revision: getCount + 1 } as T;
    }, { maxRebases: 2 }),
    (error: unknown) => error instanceof Error && (error as Error & { status?: number }).status === 409,
  );
  assert.equal(deleteCount, 3, 'the initial delete plus two rebases are attempted');
  assert.equal(getCount, 2);

  let completedDeleteCount = 0;
  await assert.rejects(
    deleteRemoteTripWithRevisionRebase('completed', 2, 'completed-key', async <T>(_path: string, options: RequestInit = {}) => {
      if ((options.method ?? 'GET') === 'DELETE') {
        completedDeleteCount += 1;
        throw httpError(409);
      }
      return { trip_id: 'completed', status: 'completed', revision: 8 } as T;
    }),
    (error: unknown) => error instanceof Error && (error as Error & { status?: number }).status === 409,
  );
  assert.equal(completedDeleteCount, 1, 'a non-draft server row is never deleted by a draft cleanup');
}

async function explicitSingleDeleteRebasesSavedAndArchivedTrips() {
  for (const status of ['completed', 'archived'] as const) {
    const calls: Array<[string, string]> = [];
    let deleteCount = 0;
    await deleteRemoteTripWithRevisionRebase(
      `${status}-trip`,
      2,
      `${status}-key`,
      async <T>(path: string, options: RequestInit = {}) => {
        const method = options.method ?? 'GET';
        calls.push([method, path]);
        if (method === 'DELETE') {
          deleteCount += 1;
          if (deleteCount === 1) throw httpError(409);
          return undefined as T;
        }
        return { trip_id: `${status}-trip`, status, revision: 8 } as T;
      },
      { mode: 'explicit' },
    );
    assert.deepEqual(calls, [
      ['DELETE', `/api/trips/v2/${status}-trip?expected_revision=2`],
      ['GET', `/api/trips/v2/${status}-trip?include_deleted=true`],
      ['DELETE', `/api/trips/v2/${status}-trip?expected_revision=8`],
    ]);
  }
}

function compactListAndLegacyRoundTripAreStable() {
  assert.equal(
    compactTripListPath(),
    '/api/trips/v2?limit=100&include_archived=true&include_deleted=true&include_legacy_v1=false',
  );
  assert.equal(
    compactTripListPath('next page'),
    '/api/trips/v2?limit=100&include_archived=true&include_deleted=true&include_legacy_v1=false&cursor=next+page',
  );

  const raw = {
    request: 'Denver to Moab',
    trip: { plan: { trip_name: 'Desert route' } },
    route_geometry: { coordinates: [[-109.5, 38.5], [-108.5, 39]] },
  };
  assert.deepEqual(normalizeTripLegacyV1(raw), raw);
  assert.deepEqual(normalizeTripLegacyV1({ source: 'server_legacy_v1', payload: raw }), raw);
  assert.deepEqual(normalizeTripLegacyV1({
    source: 'server_legacy_v1',
    payload: { source: 'server_legacy_v1', payload: raw },
  }), raw, 'old nested sync envelopes are flattened at the boundary');
  assert.deepEqual(
    normalizeTripLegacyV1({ source: 'real-source', payload: raw, note: 'domain data' }),
    { source: 'real-source', payload: raw, note: 'domain data' },
    'objects with domain fields are not mistaken for sync envelopes',
  );
  assert.deepEqual(tripLegacyV1ForWrite({ source: 'server_legacy_v1', payload: raw }), raw);
  assert.equal(
    tripLegacyV1ForWrite({ source: OMITTED_SERVER_LEGACY_SOURCE, payload: {} }),
    undefined,
    'a compact-list marker is omitted so the server keeps its authoritative legacy payload',
  );
  const omitted = { source: OMITTED_SERVER_LEGACY_SOURCE, payload: {} };
  const reconstructed = { source: 'trip_result', payload: { plan: { trip_name: 'Fallback' } } };
  assert.equal(
    preserveOmittedServerLegacy(omitted, reconstructed),
    omitted,
    'active-trip mirroring keeps the omission marker instead of replacing authoritative server legacy',
  );
  assert.equal(
    preserveOmittedServerLegacy(undefined, reconstructed),
    reconstructed,
  );
  const mergedAuthoritative = preserveOmittedServerLegacy({
    source: 'server_legacy_v1',
    payload: {
      request: 'Keep this request',
      trip: { plan: { trip_name: 'Old route' }, licensed_note: 'Keep this note' },
      builder_state: { mode: 'manual', private_option: 'keep' },
      unknown_server_field: { keep: true },
    },
  }, {
    source: 'trip_result',
    payload: {
      plan: { trip_name: 'Edited route' },
      route_geometry: { coords: [[-109.5, 38.5], [-109.4, 38.6]] },
      builder_state: { mode: 'manual', private_option: 'keep', snap: true },
    },
  });
  const mergedPayload = mergedAuthoritative?.payload as Record<string, unknown>;
  assert.equal(mergedPayload.request, 'Keep this request');
  assert.equal(
    (mergedPayload.trip as { licensed_note?: string })?.licensed_note,
    'Keep this note',
  );
  assert.deepEqual(
    (mergedPayload.trip as { plan?: unknown })?.plan,
    { trip_name: 'Edited route' },
  );
  assert.deepEqual(mergedPayload.unknown_server_field, { keep: true });
  assert.deepEqual(mergedPayload.route_geometry, {
    coords: [[-109.5, 38.5], [-109.4, 38.6]],
  });
}

function compactDetailRevisionMustMatch() {
  const full = { revision: 7, title: 'Current trip' };
  assert.equal(requireMatchingTripDetailRevision({ revision: 7 }, full), full);
  assert.throws(
    () => requireMatchingTripDetailRevision({ revision: 6 }, full),
    (error: unknown) => error instanceof TripDetailResolutionError
      && error.code === 'revision_changed'
      && error.message === 'This trip changed while you were viewing it. Refresh and try again.',
  );
}

function clearedCanonicalRouteIsExplicitInWrites() {
  const route = canonicalTripRouteForWrite(undefined);
  assert.deepEqual(route, {});
  assert.deepEqual(
    JSON.parse(JSON.stringify({ route })).route,
    {},
    'JSON serialization retains the canonical empty-route marker',
  );
}

async function run() {
  await conflictRebasesAgainstTheLiveDraft();
  await missingOrAlreadyDeletedTripsSucceed();
  await rebaseIsBoundedAndNeverDeletesANonDraft();
  await explicitSingleDeleteRebasesSavedAndArchivedTrips();
  compactListAndLegacyRoundTripAreStable();
  compactDetailRevisionMustMatch();
  clearedCanonicalRouteIsExplicitInWrites();
  console.log('trip repository sync deletion contracts passed');
}

void run();
