import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearSharedTrailTokenHandoff,
  consumeSharedTrailToken,
  handoffSharedTrailToken,
  subscribeSharedTrailToken,
} from '../sharedTrailLinkHandoff';

test('bearer handoff is in-memory, consume-once, validated, and duplicate guarded', () => {
  clearSharedTrailTokenHandoff();
  const token = 'C'.repeat(43);
  let notifications = 0;
  const unsubscribe = subscribeSharedTrailToken(() => { notifications += 1; });
  assert.equal(handoffSharedTrailToken('invalid'), false);
  assert.equal(handoffSharedTrailToken(token), true);
  assert.equal(notifications, 1);
  assert.equal(consumeSharedTrailToken(), token);
  assert.equal(consumeSharedTrailToken(), '');
  assert.equal(handoffSharedTrailToken(token), false);
  assert.equal(notifications, 1);
  unsubscribe();
});

test('a newer valid link replaces an unconsumed older handoff', () => {
  clearSharedTrailTokenHandoff();
  const first = 'D'.repeat(43);
  const second = 'E'.repeat(43);
  assert.equal(handoffSharedTrailToken(first), true);
  assert.equal(handoffSharedTrailToken(second), true);
  assert.equal(consumeSharedTrailToken(), second);
});
