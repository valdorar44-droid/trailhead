import assert from 'node:assert/strict';
import test from 'node:test';
import type { RouteBuildResult } from '../api';
import {
  coalesceAdjacentRoutableStops,
  providerGeometryFromRoute,
  routeDayNeedsDefaultOvernight,
  routeTargetMileForDay,
} from '../routeBuilder/geometry';

function encodePolyline6(coords: [number, number][]) {
  let previousLat = 0;
  let previousLng = 0;
  let result = '';
  const encodeValue = (value: number) => {
    let encoded = value < 0 ? ~(value << 1) : value << 1;
    while (encoded >= 0x20) {
      result += String.fromCharCode((0x20 | (encoded & 0x1f)) + 63);
      encoded >>= 5;
    }
    result += String.fromCharCode(encoded + 63);
  };
  for (const [lng, lat] of coords) {
    const nextLat = Math.round(lat * 1e6);
    const nextLng = Math.round(lng * 1e6);
    encodeValue(nextLat - previousLat);
    encodeValue(nextLng - previousLng);
    previousLat = nextLat;
    previousLng = nextLng;
  }
  return result;
}

test('provider geometry retains maneuver steps and per-leg navigation', () => {
  const firstLeg: [number, number][] = [[-109.55, 38.57], [-109.54, 38.58], [-109.53, 38.59]];
  const secondLeg: [number, number][] = [[-109.53, 38.59], [-109.52, 38.60]];
  const result: RouteBuildResult = {
    trip: {
      status: 0,
      units: 'miles',
      summary: { length: 2.5, time: 420 },
      legs: [
        {
          shape: encodePolyline6(firstLeg),
          maneuvers: [
            {
              type: 1,
              instruction: 'Head north',
              street_names: ['Main Street'],
              length: 0.5,
              time: 90,
              begin_shape_index: 0,
            },
            {
              type: 10,
              instruction: 'Turn right onto Canyon Road',
              verbal_pre_transition_instruction: 'Turn right onto Canyon Road',
              street_names: ['Canyon Road'],
              length: 1,
              time: 180,
              begin_shape_index: 1,
            },
          ],
        },
        {
          shape: encodePolyline6(secondLeg),
          maneuvers: [{
            type: 4,
            instruction: 'Arrive at destination',
            length: 1,
            time: 150,
            begin_shape_index: 1,
            roundabout_exit_count: null,
          }],
        },
      ],
    },
    _trailhead: { engine: 'valhalla' },
  };

  const geometry = providerGeometryFromRoute(result, 'miles');

  assert.equal(geometry.coords.length, 4, 'shared leg endpoint is deduplicated');
  assert.equal(geometry.legs?.length, 2);
  assert.equal(geometry.steps?.length, 3);
  assert.equal(geometry.steps?.[0].type, 'depart');
  assert.equal(geometry.steps?.[1].modifier, 'right');
  assert.equal(geometry.steps?.[1].name, 'Canyon Road');
  assert.equal(geometry.steps?.[1].lat, firstLeg[1][1]);
  assert.equal(geometry.steps?.[1].lng, firstLeg[1][0]);
  assert.ok(Math.abs((geometry.steps?.[1].distance ?? 0) - 1609.344) < 0.001);
  assert.equal(geometry.steps?.[2].type, 'arrive');
  assert.equal(geometry.steps?.[2].roundaboutExit, null);
});

test('provider geometry maps Valhalla maneuver types to navigation steps', () => {
  const cases = [
    { code: 1, type: 'depart', modifier: '' },
    { code: 2, type: 'depart', modifier: 'right' },
    { code: 3, type: 'depart', modifier: 'left' },
    { code: 4, type: 'arrive', modifier: '' },
    { code: 5, type: 'arrive', modifier: 'right' },
    { code: 6, type: 'arrive', modifier: 'left' },
    { code: 9, type: 'turn', modifier: 'slight right' },
    { code: 10, type: 'turn', modifier: 'right' },
    { code: 11, type: 'turn', modifier: 'sharp right' },
    { code: 12, type: 'turn', modifier: 'uturn' },
    { code: 13, type: 'turn', modifier: 'uturn' },
    { code: 14, type: 'turn', modifier: 'sharp left' },
    { code: 15, type: 'turn', modifier: 'left' },
    { code: 16, type: 'turn', modifier: 'slight left' },
    { code: 26, type: 'roundabout', modifier: '' },
    { code: 27, type: 'exit roundabout', modifier: '' },
  ];
  const coords: [number, number][] = cases.map((_, index) => [
    -109.55 + index * 0.001,
    38.57 + index * 0.001,
  ]);
  const geometry = providerGeometryFromRoute({
    trip: {
      status: 0,
      units: 'miles',
      summary: { length: 4, time: 600 },
      legs: [{
        shape: encodePolyline6(coords),
        maneuvers: cases.map((item, index) => ({
          type: item.code,
          instruction: `Maneuver ${item.code}`,
          begin_shape_index: index,
          roundabout_exit_count: item.code === 26 ? 3 : undefined,
        })),
      }],
    },
    _trailhead: { engine: 'valhalla' },
  });

  assert.deepEqual(
    geometry.steps?.map(step => ({ type: step.type, modifier: step.modifier })),
    cases.map(({ type, modifier }) => ({ type, modifier })),
  );
  assert.equal(geometry.steps?.find(step => step.type === 'roundabout')?.roundaboutExit, 3);
});

test('provider geometry converts kilometer maneuver lengths to meters', () => {
  const coords: [number, number][] = [[-105, 39], [-104.99, 39.01]];
  const geometry = providerGeometryFromRoute({
    trip: {
      status: 0,
      units: 'kilometers',
      summary: { length: 1.6, time: 120 },
      legs: [{
        shape: encodePolyline6(coords),
        maneuvers: [{ type: 1, length: 1.6, time: 120, begin_shape_index: 0 }],
      }],
    },
  }, 'kilometers');

  assert.equal(geometry.steps?.[0].distance, 1600);
  assert.ok(Math.abs(geometry.totalDistanceMi - 0.9941936) < 0.000001);
});

test('short routes keep every daily target inside the route distance', () => {
  const totalMi = 10.57;
  const firstDay = routeTargetMileForDay(1, 2, totalMi, 'balanced');

  assert.ok(firstDay > 0 && firstDay < totalMi);
  assert.ok(Math.abs(firstDay - totalMi * 0.42) < 0.000001);
  assert.equal(routeTargetMileForDay(2, 2, totalMi, 'balanced'), totalMi);
});

test('the final travel day is not treated as another overnight by default', () => {
  assert.equal(routeDayNeedsDefaultOvernight({
    shape: 'there_and_back',
    day: 2,
    days: [1, 2],
  }), false);
  assert.equal(routeDayNeedsDefaultOvernight({
    shape: 'loop',
    day: 2,
    days: [1, 2],
    hasExplicitFinalNight: true,
  }), true);
  assert.equal(routeDayNeedsDefaultOvernight({
    shape: 'one_way',
    day: 2,
    days: [1, 2],
  }), false);
  assert.equal(routeDayNeedsDefaultOvernight({
    shape: 'one_way',
    day: 1,
    days: [1, 2],
  }), true);
});

test('adjacent duplicate provider stops are coalesced without changing the itinerary', () => {
  const itinerary = [
    { id: 'start', lat: 38.5733, lng: -109.5498 },
    { id: 'destination', lat: 38.7331, lng: -109.5925 },
    { id: 'camp', lat: 38.552, lng: -109.514 },
    { id: 'camp-overnight-entry', lat: 38.552, lng: -109.514 },
    { id: 'return', lat: 38.5733, lng: -109.5498 },
  ];

  const providerStops = coalesceAdjacentRoutableStops(itinerary);

  assert.deepEqual(providerStops.map(stop => stop.id), ['start', 'destination', 'camp', 'return']);
  assert.equal(itinerary.length, 5);
});
