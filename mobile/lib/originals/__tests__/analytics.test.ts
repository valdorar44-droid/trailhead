import assert from 'node:assert/strict';
import {
  ORIGINALS_ANALYTICS_EVENTS,
  ORIGINALS_ANALYTICS_RELEASE_COHORT,
  sanitizeOriginalsAnalyticsPayload,
} from '../analyticsPayload';

function main() {
  const clean = sanitizeOriginalsAnalyticsPayload(ORIGINALS_ANALYTICS_EVENTS.stopOutcome, {
    pack_id: 'moab-canyons-to-sky',
    version: 3,
    session_id: 'session:3',
    stop_id: 'dead-horse-point',
    outcome: 'missed',
    release_cohort: 'precise-user-bucket',
    lat: 38.5733,
    lng: -109.5498,
    coordinates: [-109.5498, 38.5733],
    route_geometry: { type: 'LineString', coordinates: [[-109.5, 38.5]] },
    traveled_route: [[-109.5, 38.5]],
  });
  assert.deepEqual(clean, {
    sessionId: '',
    eventData: {
      release_cohort: ORIGINALS_ANALYTICS_RELEASE_COHORT,
      pack_id: 'moab-canyons-to-sky',
      version: 3,
      stop_id: 'dead-horse-point',
      outcome: 'missed',
    },
  });
  const serialized = JSON.stringify(clean);
  assert(!serialized.includes('38.5733'));
  assert(!serialized.includes('-109.5498'));
  assert(!serialized.includes('route_geometry'));
  assert(!serialized.includes('precise-user-bucket'));

  assert.equal(sanitizeOriginalsAnalyticsPayload('originals_location', {
    pack_id: 'moab',
    version: 1,
  }), null);
  assert.equal(sanitizeOriginalsAnalyticsPayload('originals_route_state', {
    pack_id: 'moab',
    version: 1,
    state: 'near_38.57_-109.54',
  }), null);
  assert.equal(sanitizeOriginalsAnalyticsPayload(ORIGINALS_ANALYTICS_EVENTS.downloadResult, {
    pack_id: 'moab',
    version: 0,
    result: 'ready',
  }), null);

  const completion = sanitizeOriginalsAnalyticsPayload('originals_session_completed', {
    pack_id: 'moab',
    version: 2,
    completed_count: 8,
    skipped_count: 2,
    missed_count: 1,
    stop_count: 11,
    samples: [{ lat: 1, lng: 2 }],
  });
  assert.equal(completion, null);
}

main();
