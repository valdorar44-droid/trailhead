import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BROWSE_MAP_CAMERA_OWNERSHIP,
  cancelMapCameraClaimForGesture,
  consumeMapCameraClaim,
  createMapCameraOwnership,
  initialMapCameraClaimState,
  mapCameraOwnerPriority,
} from '../mapCameraOwnership';

test('camera owner priority keeps safety-sensitive experiences in front', () => {
  assert.ok(mapCameraOwnerPriority('navigation') > mapCameraOwnerPriority('originals'));
  assert.ok(mapCameraOwnerPriority('originals') > mapCameraOwnerPriority('route_review'));
  assert.ok(mapCameraOwnerPriority('route_review') > mapCameraOwnerPriority('route_build'));
  assert.equal(mapCameraOwnerPriority('route_build'), mapCameraOwnerPriority('trace'));
  assert.ok(mapCameraOwnerPriority('trace') > mapCameraOwnerPriority('browse'));
});

test('only browse may restore and persist the recent viewport', () => {
  assert.equal(BROWSE_MAP_CAMERA_OWNERSHIP.blocksRecentViewport, false);
  const original = createMapCameraOwnership('originals', 'originals:moab:1');
  assert.equal(original.blocksRecentViewport, true);
  assert.equal(original.restoreBrowseCameraOnRelease, true);
  assert.equal(createMapCameraOwnership('navigation', 'navigation:trip-1').restoreBrowseCameraOnRelease, false);
});

test('a camera application is idempotent for one experience and style generation', () => {
  const ownership = createMapCameraOwnership('originals', 'originals:moab:1');
  let state = initialMapCameraClaimState();

  const first = consumeMapCameraClaim(state, ownership, 'style:1:route:1');
  state = first.state;
  assert.equal(first.apply, true);

  const duplicate = consumeMapCameraClaim(state, ownership, 'style:1:route:1');
  state = duplicate.state;
  assert.equal(duplicate.apply, false);

  const nextStyle = consumeMapCameraClaim(state, ownership, 'style:2:route:1');
  assert.equal(nextStyle.apply, true);
});

test('a user gesture cancels automatic reapplication until the experience changes', () => {
  const firstOwnership = createMapCameraOwnership('originals', 'originals:moab:1');
  let state = consumeMapCameraClaim(
    initialMapCameraClaimState(),
    firstOwnership,
    'style:1:route:1',
  ).state;
  state = cancelMapCameraClaimForGesture(state, firstOwnership);

  const cancelled = consumeMapCameraClaim(state, firstOwnership, 'style:2:route:1');
  assert.equal(cancelled.apply, false);

  const nextOwnership = createMapCameraOwnership('originals', 'originals:moab:2');
  const nextVersion = consumeMapCameraClaim(cancelled.state, nextOwnership, 'style:1:route:2');
  assert.equal(nextVersion.apply, true);
});

test('browse never consumes an automatic camera claim', () => {
  const decision = consumeMapCameraClaim(
    initialMapCameraClaimState(),
    BROWSE_MAP_CAMERA_OWNERSHIP,
    'browse:ignored',
  );
  assert.equal(decision.apply, false);
});
