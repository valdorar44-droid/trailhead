import assert from 'node:assert/strict';

import {
  dayDriveMinutes,
  driveTimeLabel,
  forecastDateLabel,
  forecastIndexForTripDay,
  tripDepartureDate,
  tripRouteDurationSeconds,
} from '../tripTimelinePresentation';

const trip = {
  builder_state: {
    schedule: { departure_date: '2026-08-10' },
  },
  route_geometry: {
    total_duration: 18_000,
  },
} as any;

assert.equal(tripDepartureDate(trip), '2026-08-10');
assert.equal(tripRouteDurationSeconds(trip), 18_000);
assert.equal(
  forecastIndexForTripDay(
    ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12'],
    2,
    tripDepartureDate(trip),
  ),
  2,
);
assert.equal(forecastIndexForTripDay(['2026-08-09', '2026-08-10'], 8, null), 1);
assert.match(forecastDateLabel('2026-08-10'), /Aug 10/);
assert.equal(dayDriveMinutes({ dayMiles: 100, tripMiles: 250, routeDurationSeconds: 18_000 }), 120);
assert.equal(dayDriveMinutes({ dayMiles: 100, tripMiles: 0, routeDurationSeconds: 18_000 }), null);
assert.equal(driveTimeLabel(120), '2 hr');
assert.equal(driveTimeLabel(145), '2 hr 25 min');
assert.equal(driveTimeLabel(null), '');

console.log('trip timeline presentation tests passed');
