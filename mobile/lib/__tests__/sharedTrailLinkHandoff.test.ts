import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearSharedTrailRecipientRoute,
  clearSharedTrailTokenHandoff,
  consumeSharedTrailToken,
  handoffSharedTrailToken,
  readSharedTrailRecipientRoute,
  rememberSharedTrailRecipientRoute,
  subscribeSharedTrailToken,
} from '../sharedTrailLinkHandoff';
import type { SharedTrailRouteV1 } from '../trailRouteSharing';

const route = (): SharedTrailRouteV1 => ({
  version: 1,
  shared_route_id: 'route-1',
  route_revision: 1,
  share_revision: 1,
  origin: 'builder',
  title: 'Shared route',
  geometry: { type: 'LineString', coordinates: [[-109.6, 38.5], [-109.59, 38.51]] },
  geometry_revision: 1,
  geometry_sha256: 'abc',
});

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

test('resolved route remains in memory for Map return and clears for a new token or exit', () => {
  clearSharedTrailTokenHandoff();
  rememberSharedTrailRecipientRoute(route());
  assert.equal(readSharedTrailRecipientRoute()?.shared_route_id, 'route-1');
  assert.equal(handoffSharedTrailToken('F'.repeat(43)), true);
  assert.equal(readSharedTrailRecipientRoute(), null);
  rememberSharedTrailRecipientRoute(route());
  clearSharedTrailRecipientRoute();
  assert.equal(readSharedTrailRecipientRoute(), null);
});
