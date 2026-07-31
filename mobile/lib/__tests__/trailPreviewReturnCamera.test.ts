import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelMapCameraClaimForGesture,
  consumeMapCameraClaim,
  createMapCameraOwnership,
  initialMapCameraClaimState,
  mapCameraOwnershipKey,
} from '../mapCameraOwnership';
import {
  captureTrailPreviewReturnCamera,
  resolveTrailPreviewReturnCamera,
} from '../trailPreviewReturnCamera';

const viewport = { n: 37.8, s: 37.7, e: -119.5, w: -119.7, zoom: 12 };
const review = createMapCameraOwnership('route_review', 'trail:yosemite:rev-1');

test('an automatically framed trail returns through one fresh route claim', () => {
  const claimState = consumeMapCameraClaim(
    initialMapCameraClaimState(),
    review,
    'style:1:route:rev-1',
  ).state;
  const snapshot = captureTrailPreviewReturnCamera({
    trailIdentity: 'trail:yosemite',
    geometryRevision: 'rev-1',
    ownership: review,
    claimState,
    viewport,
    styleGeneration: 4,
    generation: 2,
  });

  assert.equal(snapshot.mode, 'route_claim');
  assert.equal(snapshot.viewport, null);
  assert.deepEqual(resolveTrailPreviewReturnCamera(snapshot, {
    trailIdentity: 'trail:yosemite',
    geometryRevision: 'rev-1',
    ownerKey: mapCameraOwnershipKey(review),
    styleGeneration: 4,
    generation: 2,
  }), { action: 'route_claim', reason: 'route_owner' });
});

test('a user-adjusted trail view restores its validated viewport', () => {
  const applied = consumeMapCameraClaim(
    initialMapCameraClaimState(),
    review,
    'style:1:route:rev-1',
  ).state;
  const claimState = cancelMapCameraClaimForGesture(applied, review);
  const snapshot = captureTrailPreviewReturnCamera({
    trailIdentity: 'trail:yosemite',
    geometryRevision: 'rev-1',
    ownership: review,
    claimState,
    viewport,
    styleGeneration: 4,
    generation: 2,
  });

  assert.equal(snapshot.mode, 'user_viewport');
  assert.deepEqual(snapshot.viewport, viewport);
  assert.deepEqual(resolveTrailPreviewReturnCamera(snapshot, {
    trailIdentity: 'trail:yosemite',
    geometryRevision: 'rev-1',
    ownerKey: mapCameraOwnershipKey(review),
    styleGeneration: 4,
    generation: 2,
  }), { action: 'restore_viewport', reason: 'user_viewport' });
});

test('stale trail, geometry, owner, style, and generation snapshots are rejected', () => {
  const snapshot = captureTrailPreviewReturnCamera({
    trailIdentity: 'trail:yosemite',
    geometryRevision: 'rev-1',
    ownership: review,
    claimState: initialMapCameraClaimState(),
    viewport: null,
    styleGeneration: 4,
    generation: 2,
  });
  const current = {
    trailIdentity: 'trail:yosemite',
    geometryRevision: 'rev-1',
    ownerKey: mapCameraOwnershipKey(review),
    styleGeneration: 4,
    generation: 2,
  };

  assert.equal(resolveTrailPreviewReturnCamera(snapshot, { ...current, generation: 3 }).reason, 'stale_generation');
  assert.equal(resolveTrailPreviewReturnCamera(snapshot, { ...current, trailIdentity: 'trail:zion' }).reason, 'stale_trail');
  assert.equal(resolveTrailPreviewReturnCamera(snapshot, { ...current, geometryRevision: 'rev-2' }).reason, 'stale_geometry');
  assert.equal(resolveTrailPreviewReturnCamera(snapshot, { ...current, ownerKey: 'browse:none' }).reason, 'stale_owner');
  assert.equal(resolveTrailPreviewReturnCamera(snapshot, { ...current, styleGeneration: 5 }).reason, 'stale_style');
});

test('a missing manual viewport safely falls back to a fresh route claim', () => {
  const applied = consumeMapCameraClaim(
    initialMapCameraClaimState(),
    review,
    'style:1:route:rev-1',
  ).state;
  const snapshot = captureTrailPreviewReturnCamera({
    trailIdentity: 'trail:yosemite',
    geometryRevision: 'rev-1',
    ownership: review,
    claimState: cancelMapCameraClaimForGesture(applied, review),
    viewport: null,
    styleGeneration: 4,
    generation: 2,
  });
  assert.equal(snapshot.mode, 'route_claim');
  assert.deepEqual(resolveTrailPreviewReturnCamera(snapshot, {
    trailIdentity: 'trail:yosemite',
    geometryRevision: 'rev-1',
    ownerKey: mapCameraOwnershipKey(review),
    styleGeneration: 4,
    generation: 2,
  }), { action: 'route_claim', reason: 'route_owner' });
});
