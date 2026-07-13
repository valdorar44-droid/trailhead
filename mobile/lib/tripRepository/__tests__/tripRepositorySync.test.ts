import assert from 'node:assert/strict';
import { deleteRemoteTripWithRevisionRebase } from '../deleteSync';

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

async function run() {
  await conflictRebasesAgainstTheLiveDraft();
  await missingOrAlreadyDeletedTripsSucceed();
  await rebaseIsBoundedAndNeverDeletesANonDraft();
  await explicitSingleDeleteRebasesSavedAndArchivedTrips();
  console.log('trip repository sync deletion contracts passed');
}

void run();
