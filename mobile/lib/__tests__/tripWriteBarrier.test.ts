import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginTripWriteBarrier,
  clearTripWriteBarrier,
  tripWriteBlockedByOutbox,
  tripWriteBarrierPending,
} from '../tripWriteBarrier';

test('keeps a newer same-trip barrier when an older operation finishes', () => {
  const first = beginTripWriteBarrier('trip-1');
  const second = beginTripWriteBarrier('trip-1');
  assert.equal(tripWriteBarrierPending('trip-1'), true);
  assert.equal(clearTripWriteBarrier('trip-1', first), false);
  assert.equal(tripWriteBarrierPending('trip-1'), true);
  assert.equal(clearTripWriteBarrier('trip-1', second), true);
  assert.equal(tripWriteBarrierPending('trip-1'), false);
});

test('tracks barriers independently by trip', () => {
  const first = beginTripWriteBarrier('trip-a');
  const second = beginTripWriteBarrier('trip-b');
  assert.equal(clearTripWriteBarrier('trip-a', first), true);
  assert.equal(tripWriteBarrierPending('trip-a'), false);
  assert.equal(tripWriteBarrierPending('trip-b'), true);
  assert.equal(clearTripWriteBarrier('trip-b', second), true);
});

test('blocks a newer persisted trip write after an app restart', () => {
  const restoredOutbox = [{ entityType: 'trip', entityId: 'trip-1', revision: 5 }];
  assert.equal(tripWriteBarrierPending('trip-1'), false);
  assert.equal(tripWriteBlockedByOutbox('trip-1', 4, restoredOutbox), true);
  assert.equal(tripWriteBlockedByOutbox('trip-1', 5, restoredOutbox), false);
  assert.equal(tripWriteBlockedByOutbox('trip-2', 4, restoredOutbox), false);
  assert.equal(tripWriteBlockedByOutbox('trip-1', 5, [{ entityType: 'trip', entityId: 'trip-1' }]), true);
});
