import assert from 'node:assert/strict';
import test from 'node:test';
import type { Report, TripResult, Waypoint } from '../api';
import {
  localRouteBrief,
  normalizeRouteBrief,
  routeBriefTextHasUnsupportedAssertion,
} from '../routeBrief';

function trip(waypoints: Partial<Waypoint>[], totalMiles = 0): TripResult {
  return {
    trip_id: 'route-brief-test',
    plan: {
      trip_name: 'Test route',
      overview: '',
      duration_days: 2,
      states: [],
      total_est_miles: totalMiles,
      waypoints: waypoints as Waypoint[],
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
  };
}

test('route length never fabricates readiness, fuel, water, signal, fire, or exit guidance', () => {
  const brief = localRouteBrief(trip([
    { day: 1, name: 'Start', type: 'start' },
    { day: 2, name: 'Finish', type: 'waypoint' },
  ], 2_500));

  assert.equal(brief.planning_status, 'Review required');
  assert.equal(brief.fuel_status, 'Not checked');
  assert.equal(brief.water_status, 'Not checked');
  assert.equal(brief.signal_status, 'Not checked');
  assert.equal(brief.fire_status, 'Not checked');
  assert.equal(brief.exit_options_status, 'Not checked');
  assert.equal('readiness_score' in brief, false);
  assert.equal('estimated_fuel_stops' in brief, false);
  assert.equal('water_carry_gallons' in brief, false);
});

test('normalization discards malformed and fabricated legacy model evidence', () => {
  const normalized = normalizeRouteBrief({
    readiness_score: 10,
    estimated_fuel_stops: 5,
    water_carry_gallons: 10,
    signal_dead_zones: ['Three dead zones'],
    fire_restriction_likelihood: 'low',
    emergency_bailout: 'Use Highway 9',
    briefing_summary: 'This route is usable, safe, and ready.',
    must_do_before_leaving: [
      'Pack 10 gallons per person.',
      'Confirm the route is safe and open.',
      'Download offline maps from your Download List in the app.',
      42,
    ],
  }, trip([{ day: 1, name: 'Moab', type: 'start' }], 900));

  const rendered = JSON.stringify(normalized).toLocaleLowerCase();
  assert.doesNotMatch(rendered, /route is usable|10 gallons|dead zones|highway 9/);
  assert.equal(normalized.fuel_status, 'Not checked');
  assert.equal(normalized.water_status, 'Not checked');
  assert.ok(normalized.must_do_before_leaving.some(item => item.startsWith('Download offline maps')));
  assert.ok(normalized.must_do_before_leaving.every(item => !routeBriefTextHasUnsupportedAssertion(item)));
});

test('only explicit mapped stops and supplied reports produce evidence-aware status', () => {
  const reports = [
    { type: 'cellular', subtype: '', description: 'Coverage report', waypoint_day: 1 },
    { type: 'fire', subtype: 'burn_restriction', description: 'Fire report', waypoint_day: 2 },
  ] as Report[];
  const brief = localRouteBrief(trip([
    { day: 1, name: 'Moab', type: 'start' },
    { day: 1, name: 'Mapped Fuel', type: 'fuel' },
    { day: 2, name: 'Mapped Water', type: 'water' },
  ]), reports);

  assert.equal(brief.fuel_status, '1 mapped fuel stop; availability is not checked.');
  assert.equal(brief.water_status, '1 mapped water-related stop; availability is not checked.');
  assert.equal(brief.signal_status, 'Review 1 supplied signal report; current conditions are not verified.');
  assert.equal(brief.fire_status, 'Review 1 supplied fire report; current conditions are not verified.');
  assert.equal(brief.exit_options_status, 'Not checked');
  assert.equal(brief.top_concerns.length, 2);
});

test('missing or non-object model payload stays honest', () => {
  const activeTrip = trip([{ day: 1, name: 'Moab', type: 'start' }]);
  for (const payload of [null, undefined, [], 'bad payload', 7]) {
    const brief = normalizeRouteBrief(payload, activeTrip);
    assert.equal(brief.planning_status, 'Review required');
    assert.equal(brief.fuel_status, 'Not checked');
    assert.equal(brief.signal_status, 'Not checked');
    assert.match(brief.briefing_summary, /have not been checked/i);
  }
});
