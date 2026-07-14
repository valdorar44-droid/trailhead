import assert from 'node:assert/strict';
import test from 'node:test';
import { accountRecoveryContext } from '../accountRecovery';

test('does not classify restored account data as signed-out data', () => {
  const context = accountRecoveryContext({
    accountId: 41,
    anonymousRevision: 0,
    anonymousCount: 0,
    legacyCount: 2,
    startedInAnonymousScope: false,
  });

  assert.equal(context.count, 0);
  assert.equal(context.legacyCount, 0);
});

test('retains genuine anonymous repository items on an authenticated launch', () => {
  const context = accountRecoveryContext({
    accountId: 41,
    anonymousRevision: 7,
    anonymousCount: 3,
    legacyCount: 2,
    startedInAnonymousScope: false,
  });

  assert.equal(context.count, 3);
  assert.equal(context.legacyCount, 0);
});

test('includes legacy saves when signing in from an anonymous session', () => {
  const context = accountRecoveryContext({
    accountId: 41,
    anonymousRevision: 7,
    anonymousCount: 1,
    legacyCount: 4,
    startedInAnonymousScope: true,
  });

  assert.equal(context.count, 4);
  assert.equal(context.legacyCount, 4);
});

test('uses a stable SecureStore-compatible decision key', () => {
  const input = {
    accountId: 41,
    anonymousRevision: 7,
    anonymousCount: 1,
    legacyCount: 4,
    startedInAnonymousScope: true,
  } as const;
  const first = accountRecoveryContext(input);
  const second = accountRecoveryContext(input);

  assert.equal(first.decisionKey, second.decisionKey);
  assert.match(first.decisionKey, /^[A-Za-z0-9._-]+$/);
  assert.equal(first.decisionKey.includes(':'), false);
});

test('keeps an anonymous repository decision stable after account startup', () => {
  const signedIn = accountRecoveryContext({
    accountId: 41,
    anonymousRevision: 7,
    anonymousCount: 3,
    legacyCount: 2,
    startedInAnonymousScope: true,
  });
  const nextLaunch = accountRecoveryContext({
    accountId: 41,
    anonymousRevision: 7,
    anonymousCount: 3,
    legacyCount: 5,
    startedInAnonymousScope: false,
  });

  assert.equal(signedIn.decisionKey, nextLaunch.decisionKey);
});
