import assert from 'node:assert/strict';
import {
  cancelRouteBuildSessionState,
  closeRouteBuildRequest,
  createRouteBuildSession,
  openRouteBuildRequest,
  resolveRouteBuildActivityChoice,
  routeBuildSessionIsRunning,
  updateRouteBuildSessionState,
  waitForRouteBuildActivityChoice,
} from '../routeBuildSession';

const session = createRouteBuildSession({
  requestId: 'request-1',
  tripId: 'trip-1',
  routeName: 'Moab weekend',
  tripShape: 'loop',
}, 100);

assert.equal(session.phase, 'routing');
assert.equal(session.status, 'running');
assert.deepEqual(session.camps, { completed: 0, total: 0 });
assert.deepEqual(session.routeCoords, []);
assert.equal(session.activityChoice, 'pending');

const routed = updateRouteBuildSessionState(session, 'request-1', {
  phase: 'camps',
  message: 'Finding overnight stops',
  routeCoords: [[-109.55, 38.57], [-109.4, 38.7]],
  camps: { completed: 0, total: 2 },
}, 200);

assert.equal(routed?.phase, 'camps');
assert.equal(routed?.updatedAt, 200);
assert.equal(routed?.routeCoords.length, 2);
assert.equal(routeBuildSessionIsRunning(routed, 'request-1'), true);

assert.equal(updateRouteBuildSessionState(routed, 'stale-request', { phase: 'fuel' }, 300), routed);

const cancelled = cancelRouteBuildSessionState(routed, 'request-1', 400);
assert.equal(cancelled?.phase, 'cancelled');
assert.equal(cancelled?.status, 'cancelled');
assert.equal(routeBuildSessionIsRunning(cancelled, 'request-1'), false);
assert.equal(updateRouteBuildSessionState(cancelled, 'request-1', { phase: 'complete' }, 500), cancelled);

async function testActivityChoiceResume() {
  openRouteBuildRequest('request-2');
  const choice = waitForRouteBuildActivityChoice('request-2');
  assert.equal(resolveRouteBuildActivityChoice('request-2', 'browse'), true);
  assert.equal(await choice, 'browse');
  closeRouteBuildRequest('request-2');
}

testActivityChoiceResume()
  .then(() => console.log('routeBuildSession tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
