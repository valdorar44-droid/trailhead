import assert from 'node:assert/strict';
import test from 'node:test';

import {
  legacyTripSaveContextIsCoherent,
  legacyTripSaveContextIsCurrent,
  reconcileLegacyTripSaveResponse,
  resolveLegacyTripSaveToken,
  type LegacyTripSaveContext,
} from '../legacyTripSaveContext';

const requestContext: LegacyTripSaveContext = {
  accountEpoch: 8,
  accountId: '77',
  ownerScope: 'account:77',
  repositoryInitialized: true,
};

test('accepts a response only for the request account and repository scope', () => {
  assert.equal(legacyTripSaveContextIsCurrent(requestContext, { ...requestContext }), true);
});

test('rejects an old response after an account or scope switch', () => {
  assert.equal(legacyTripSaveContextIsCurrent(requestContext, {
    ...requestContext,
    accountEpoch: 9,
  }), false);
  assert.equal(legacyTripSaveContextIsCurrent(requestContext, {
    accountEpoch: 9,
    accountId: '88',
    ownerScope: 'account:88',
    repositoryInitialized: true,
  }), false);
  assert.equal(legacyTripSaveContextIsCurrent(requestContext, {
    ...requestContext,
    ownerScope: 'anonymous',
  }), false);
});

test('rejects mixed account and repository identities during a scope transition', () => {
  assert.equal(legacyTripSaveContextIsCoherent({
    ...requestContext,
    accountId: '88',
    ownerScope: 'account:77',
  }), false);
  assert.equal(legacyTripSaveContextIsCoherent({
    ...requestContext,
    accountId: '88',
    ownerScope: 'anonymous',
  }), false);
  assert.equal(legacyTripSaveContextIsCoherent({
    ...requestContext,
    repositoryInitialized: false,
  }), false);
  assert.equal(legacyTripSaveContextIsCoherent({
    ...requestContext,
    accountId: null,
    ownerScope: 'anonymous',
  }), true);
});

test('does not use a token resolved after the request account changes', async () => {
  let current = true;
  let finishRead: ((token: string | null) => void) | undefined;
  const tokenRead = new Promise<string | null>(resolve => { finishRead = resolve; });
  const pending = resolveLegacyTripSaveToken(
    undefined,
    () => tokenRead,
    () => current,
  );

  current = false;
  finishRead?.('new-account-token');

  assert.equal(await pending, undefined);
});

test('passes one captured token explicitly when the request account remains current', async () => {
  let reads = 0;
  const token = await resolveLegacyTripSaveToken(
    undefined,
    async () => {
      reads += 1;
      return 'captured-token';
    },
    () => true,
  );

  assert.equal(token, 'captured-token');
  assert.equal(reads, 1);
  assert.equal(await resolveLegacyTripSaveToken(null, async () => 'unused', () => true), null);
});

test('does not acknowledge or return a response after an account switch while mirrors drain', async () => {
  let current = true;
  let acknowledged = false;
  const result = await reconcileLegacyTripSaveResponse(
    () => current,
    async () => { current = false; },
    async () => {
      acknowledged = true;
      return 'saved';
    },
  );

  assert.equal(result, undefined);
  assert.equal(acknowledged, false);
});

test('does not return an acknowledged response after the account changes during reconciliation', async () => {
  let current = true;
  const result = await reconcileLegacyTripSaveResponse(
    () => current,
    async () => {},
    async () => {
      current = false;
      return 'saved';
    },
  );

  assert.equal(result, undefined);
});
