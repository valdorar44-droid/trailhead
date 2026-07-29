import assert from 'node:assert/strict';
import test from 'node:test';
import {
  trailFollowCameraAction,
  transitionTrailFollowCamera,
} from '../trailFollowCameraOwnership';

test('Route detaches live follow and the same action becomes Recenter', () => {
  const overview = transitionTrailFollowCamera('follow', 'route_button');
  assert.equal(overview, 'route_overview');
  assert.deepEqual(trailFollowCameraAction(overview), {
    label: 'Recenter',
    icon: 'locate-outline',
  });
  assert.equal(transitionTrailFollowCamera(overview, 'route_button'), 'follow');
});

test('a user gesture releases route overview without silently resuming follow', () => {
  assert.equal(transitionTrailFollowCamera('route_overview', 'gesture'), 'free');
  assert.deepEqual(trailFollowCameraAction('free'), {
    label: 'Recenter',
    icon: 'locate-outline',
  });
  assert.equal(transitionTrailFollowCamera('free', 'route_button'), 'follow');
});

test('a new or recovered Follow session resets camera ownership', () => {
  assert.equal(transitionTrailFollowCamera('free', 'reset'), 'follow');
  assert.equal(transitionTrailFollowCamera('route_overview', 'reset'), 'follow');
});
