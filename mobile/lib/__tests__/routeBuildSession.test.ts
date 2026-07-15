import assert from 'node:assert/strict';
import {
  cancelRouteBuildActivitySearch,
  cancelRouteBuildSessionState,
  closeRouteBuildRequest,
  createRouteBuildSession,
  openRouteBuildRequest,
  openRouteBuildActivitySearch,
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

const stoppedBuildSignal = openRouteBuildRequest('request-stopped');
assert.equal(stoppedBuildSignal?.aborted, false);
closeRouteBuildRequest('request-stopped', true);
assert.equal(stoppedBuildSignal?.aborted, true);

async function testActivityChoiceResume() {
  openRouteBuildRequest('request-2');
  const choice = waitForRouteBuildActivityChoice('request-2');
  assert.equal(resolveRouteBuildActivityChoice('request-2', 'browse'), true);
  assert.equal(await choice, 'browse');
  closeRouteBuildRequest('request-2');

  openRouteBuildRequest('request-3');
  const skipped = waitForRouteBuildActivityChoice('request-3');
  assert.equal(resolveRouteBuildActivityChoice('request-3', 'skip'), true);
  assert.equal(await skipped, 'skip');
  closeRouteBuildRequest('request-3');
}

testActivityChoiceResume()
  .then(() => console.log('routeBuildSession tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });

const activitySignal = openRouteBuildActivitySearch('request-activity');
assert.equal(activitySignal?.aborted, false);
cancelRouteBuildActivitySearch('request-activity');
assert.equal(activitySignal?.aborted, true);
