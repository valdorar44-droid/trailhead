import assert from 'node:assert/strict';
import {
  cancelRouteBuildActivitySearch,
  cancelRouteBuildSessionState,
  closeRouteBuildRequest,
  createRouteBuildSession,
  openRouteBuildRequest,
  openRouteBuildActivitySearch,
  resolveRouteBuildActivityChoice,
  routeBuildCoordsFromTrip,
  routeBuildPreviewStopsFromTrip,
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
assert.equal(session.source, 'manual_route_builder');

const assisted = createRouteBuildSession({
  requestId: 'request-assisted',
  tripId: 'trip-assisted',
  routeName: 'Moab to Canyonlands',
  tripShape: 'one_way',
  source: 'assisted_trip_planner',
}, 101);
assert.equal(assisted.source, 'assisted_trip_planner');

const assistedTrip = {
  trip_id: 'trip-assisted',
  plan: {
    trip_name: 'Moab to Canyonlands',
    overview: '',
    duration_days: 2,
    states: ['UT'],
    total_est_miles: 42,
    waypoints: [
      { day: 1, name: 'Moab', type: 'start', description: '', land_type: 'town', lat: 38.5733, lng: -109.5498 },
      { day: 1, name: 'Camp', type: 'camp', description: '', land_type: 'camp', lat: 38.61, lng: -109.7 },
      { day: 2, name: 'Island in the Sky', type: 'waypoint', description: '', land_type: 'park', lat: 38.459, lng: -109.821 },
    ],
    daily_itinerary: [],
    logistics: {
      vehicle_recommendation: '',
      fuel_strategy: '',
      water_strategy: '',
      permits_needed: '',
      best_season: '',
    },
  },
  campsites: [],
  gas_stations: [],
  route_geometry: {
    coords: [[-109.5498, 38.5733], [-109.65, 38.6], [-109.821, 38.459]],
  },
} as any;
const assistedStops = routeBuildPreviewStopsFromTrip(assistedTrip);
assert.deepEqual(assistedStops.map(stop => stop.type), ['start', 'camp', 'destination']);
assert.deepEqual(routeBuildCoordsFromTrip(assistedTrip), assistedTrip.route_geometry.coords);
assert.deepEqual(
  routeBuildCoordsFromTrip({ ...assistedTrip, route_geometry: undefined }),
  assistedStops.map(stop => [stop.lng, stop.lat]),
);

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
