import assert from 'node:assert/strict';
import test from 'node:test';

import type { TrailSubmissionV1 } from '../trailContributions';
import {
  StaleTrailContributionRequestError,
  TrailContributionRepositoryV1,
  type TrailContributionClientV1,
} from '../trailContributionRepository';

function submission(id = 'submission-1'): TrailSubmissionV1 {
  return {
    id,
    route_id: 'route-1',
    route_revision: 1,
    geometry_sha256: 'sha256:route',
    status: 'submitted',
    updated_at: 10,
  };
}

function client(overrides: Partial<TrailContributionClientV1> = {}): TrailContributionClientV1 {
  return {
    createTrailSubmission: async () => submission(),
    listMyTrailSubmissions: async () => ({ version: 1, submissions: [submission()] }),
    withdrawTrailSubmission: async id => submission(id),
    resubmitTrailSubmission: async id => submission(`${id}-next`),
    ...overrides,
  };
}

test('repository uses the captured owner token for every contribution action', async () => {
  const tokens: Array<string | null> = [];
  const repository = new TrailContributionRepositoryV1(client({
    createTrailSubmission: async (_routeId, _data, token) => { tokens.push(token); return submission(); },
    listMyTrailSubmissions: async token => { tokens.push(token); return { version: 1, submissions: [submission()] }; },
    withdrawTrailSubmission: async (id, token) => { tokens.push(token); return submission(id); },
    resubmitTrailSubmission: async (id, _data, token) => { tokens.push(token); return submission(`${id}-next`); },
  }), () => true, async () => 'account-token');
  const attestation = { contributor_attested: true, photo_rights_confirmed: false };
  await repository.list('1:account:a');
  await repository.submit('1:account:a', 'route-1', attestation);
  await repository.resubmit('1:account:a', 'submission-1', attestation);
  await repository.withdraw('1:account:a', 'submission-1');
  assert.deepEqual(tokens, ['account-token', 'account-token', 'account-token', 'account-token']);
});

test('account switch while auth is loading prevents a contribution mutation', async () => {
  let scope = '1:account:a';
  let resolveToken!: (value: string | null) => void;
  let mutations = 0;
  const pendingToken = new Promise<string | null>(resolve => { resolveToken = resolve; });
  const repository = new TrailContributionRepositoryV1(client({
    createTrailSubmission: async () => { mutations += 1; return submission(); },
  }), candidate => candidate === scope, async () => pendingToken);
  const pending = repository.submit('1:account:a', 'route-1', {
    contributor_attested: true,
    photo_rights_confirmed: false,
  });
  scope = '2:account:b';
  resolveToken('account-b-token');
  await assert.rejects(pending, StaleTrailContributionRequestError);
  assert.equal(mutations, 0);
});

test('a newer request invalidates a slower response from the same owner scope', async () => {
  let resolveFirst!: (value: TrailSubmissionV1) => void;
  let markFirstStarted!: () => void;
  const first = new Promise<TrailSubmissionV1>(resolve => { resolveFirst = resolve; });
  const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });
  let calls = 0;
  const repository = new TrailContributionRepositoryV1(client({
    createTrailSubmission: async () => {
      calls += 1;
      if (calls === 1) {
        markFirstStarted();
        return first;
      }
      return submission('submission-2');
    },
  }), () => true, async () => 'account-token');
  const attestations = { contributor_attested: true, photo_rights_confirmed: false };
  const slow = repository.submit('1:account:a', 'route-1', attestations);
  await firstStarted;
  const slowRejection = assert.rejects(slow, StaleTrailContributionRequestError);
  const fast = repository.submit('1:account:a', 'route-2', attestations);
  assert.equal((await fast).id, 'submission-2');
  resolveFirst(submission('submission-1'));
  await slowRejection;
});

test('missing authentication stops before the client mutation', async () => {
  let mutations = 0;
  const repository = new TrailContributionRepositoryV1(client({
    createTrailSubmission: async () => { mutations += 1; return submission(); },
  }), () => true, async () => null);
  await assert.rejects(repository.submit('1:account:a', 'route-1', {
    contributor_attested: true,
    photo_rights_confirmed: false,
  }), /sign in again/i);
  assert.equal(mutations, 0);
});
