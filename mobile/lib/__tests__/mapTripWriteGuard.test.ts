import assert from 'node:assert/strict';
import test from 'node:test';
import { mapTripWriteCanReconcile, type MapTripWriteSnapshot } from '../mapTripWriteGuard';

const snapshot: MapTripWriteSnapshot = {
  operationId: 8,
  accountEpoch: 3,
  accountId: '42',
  tripId: 'trip-1',
  expectedVersion: 5,
  waypointSignature: 'waypoints-a',
};

test('reconciles only the exact account-bound map trip write', () => {
  const current = {
    operationId: 8,
    accountEpoch: 3,
    accountId: '42',
    tripId: 'trip-1',
    version: 5,
    waypointSignature: 'waypoints-a',
  };

  assert.equal(mapTripWriteCanReconcile(snapshot, current), true);
  assert.equal(mapTripWriteCanReconcile(snapshot, { ...current, operationId: 9 }), false);
  assert.equal(mapTripWriteCanReconcile(snapshot, { ...current, accountEpoch: 4 }), false);
  assert.equal(mapTripWriteCanReconcile(snapshot, { ...current, accountId: '77' }), false);
  assert.equal(mapTripWriteCanReconcile(snapshot, { ...current, tripId: 'trip-2' }), false);
  assert.equal(mapTripWriteCanReconcile(snapshot, { ...current, version: 6 }), false);
  assert.equal(mapTripWriteCanReconcile(snapshot, { ...current, waypointSignature: 'waypoints-b' }), false);
});
