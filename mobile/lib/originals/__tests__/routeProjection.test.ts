import assert from 'node:assert/strict';
import type { LngLat } from '../../routeProjection';
import { projectPointToOriginalRoute } from '../routeProjection';

const backtrackRoute: LngLat[] = [
  [0, 0],
  [0.02, 0],
  [0, 0],
  [0, 0.02],
];

const legacy = projectPointToOriginalRoute(backtrackRoute, [0.01, 0]);
assert.equal(legacy?.segment_index, 0, 'a no-hint projection preserves the earliest nearest-segment tie');

const outbound = projectPointToOriginalRoute(backtrackRoute, [0.01, 0], {
  previous_route_ratio: 0.15,
  heading_deg: 90,
  speed_mps: 12,
  accuracy_m: 10,
});
assert.equal(outbound?.segment_index, 0, 'prior outbound progress selects the outbound occurrence');

const returning = projectPointToOriginalRoute(backtrackRoute, [0.01, 0], {
  previous_route_ratio: 0.48,
  heading_deg: 270,
  speed_mps: 12,
  accuracy_m: 10,
});
assert.equal(returning?.segment_index, 1, 'prior return progress selects the return occurrence');

const afterTurnaround = projectPointToOriginalRoute(backtrackRoute.slice(0, 3), [0.0199, 0], {
  previous_route_ratio: 0.5,
  heading_deg: 270,
  speed_mps: 12,
  accuracy_m: 10,
});
assert.equal(afterTurnaround?.segment_index, 1, 'heading resolves the progress near-tie immediately after a turnaround');

const afterTurnaroundWithoutHeading = projectPointToOriginalRoute(backtrackRoute.slice(0, 3), [0.0199, 0], {
  previous_route_ratio: 0.5,
  accuracy_m: 10,
});
assert.equal(
  afterTurnaroundWithoutHeading?.segment_index,
  1,
  'forward progress resolves an exact turnaround tie while heading is unavailable',
);

const northSouthTurnaroundRoute: LngLat[] = [
  [0, 0],
  [0, 0.02],
  [0, 0],
];
const northSouthWithoutHeading = projectPointToOriginalRoute(
  northSouthTurnaroundRoute,
  [0, 0.0199],
  {
    previous_route_ratio: 0.5,
    heading_deg: null,
    speed_mps: 12,
    accuracy_m: 10,
  },
);
assert.equal(
  northSouthWithoutHeading?.segment_index,
  1,
  'a null heading cannot override continuity at a north-south turnaround',
);

const reverseBeforeTurnaround = projectPointToOriginalRoute(backtrackRoute.slice(0, 3), [0.01, 0], {
  previous_route_ratio: 0.27,
  heading_deg: 270,
  speed_mps: 12,
  accuracy_m: 10,
});
assert.equal(
  reverseBeforeTurnaround?.segment_index,
  0,
  'continuity outranks heading when a driver reverses before the authored turnaround',
);

const parallelRoute: LngLat[] = [
  [0, 0],
  [0.02, 0],
  [0.02, 0.0001],
  [0, 0.0001],
];
const parallel = projectPointToOriginalRoute(parallelRoute, [0.01, 0], {
  previous_route_ratio: 0.8,
  heading_deg: null,
  speed_mps: 0,
  accuracy_m: 20,
});
assert.equal(
  parallel?.segment_index,
  0,
  'a stale progress hint cannot snap to a separate parallel road about 11 metres away',
);

const closeParallelRoute: LngLat[] = [
  [0, 0],
  [0.02, 0],
  [0.02, 0.000036],
  [0, 0.000036],
];
const closeParallel = projectPointToOriginalRoute(closeParallelRoute, [0.01, 0], {
  previous_route_ratio: 0.8,
  heading_deg: null,
  speed_mps: 0,
  accuracy_m: 20,
});
assert.equal(
  closeParallel?.segment_index,
  0,
  'a stale progress hint cannot snap to a separate parallel road about 4 metres away',
);

const opposingJitterRoute: LngLat[] = [
  [0, 0],
  [0.02, 0],
  [0.02, 0.0001],
  [0, 0.0001],
];
const recoveredOutbound = projectPointToOriginalRoute(opposingJitterRoute, [0.01, 0.00007], {
  previous_route_ratio: 0.2,
  heading_deg: 90,
  speed_mps: 16,
  accuracy_m: 20,
});
assert.equal(
  recoveredOutbound?.segment_index,
  0,
  'bounded jitter nearer an opposing return leg preserves the prior headed occurrence',
);

const acceptedAccuracyRoute: LngLat[] = [
  [0, 0],
  [0.02, 0],
  [0.02, 0.001],
  [0, 0.001],
];
const recoveredAcrossNinetyMetreAccuracy = projectPointToOriginalRoute(
  acceptedAccuracyRoute,
  [0.01, 0.00055],
  {
    previous_route_ratio: 0.2,
    heading_deg: 90,
    speed_mps: 16,
    accuracy_m: 90,
  },
);
assert.equal(
  recoveredAcrossNinetyMetreAccuracy?.segment_index,
  0,
  'a 90 metre fix error cannot jump from the prior outbound leg to a return leg 111 metres away',
);
const recoveredInitialHeading = projectPointToOriginalRoute(
  acceptedAccuracyRoute,
  [0.01, 0.00055],
  {
    heading_deg: 90,
    speed_mps: 16,
    accuracy_m: 90,
  },
);
assert.equal(
  recoveredInitialHeading?.segment_index,
  0,
  'a usable initial heading disambiguates the first fix before progress history exists',
);

const twoAccuracyEnvelopeRoute: LngLat[] = [
  [0, 0],
  [0.02, 0],
  [0.02, 0.00165],
  [0, 0.00165],
];
const recoveredAcrossTwoAccuracyEnvelope = projectPointToOriginalRoute(
  twoAccuracyEnvelopeRoute,
  [0.01, 0.0009],
  {
    previous_route_ratio: 0.2,
    heading_deg: 90,
    speed_mps: 16,
    accuracy_m: 100,
  },
);
assert.equal(
  recoveredAcrossTwoAccuracyEnvelope?.segment_index,
  0,
  'continuity and heading recover the authored leg across the full 200 metre ambiguity envelope',
);

const physicalNearestWithoutHeading = projectPointToOriginalRoute(
  opposingJitterRoute,
  [0.01, 0.00007],
  {
    previous_route_ratio: 0.2,
    heading_deg: null,
    speed_mps: 16,
    accuracy_m: 20,
  },
);
assert.equal(
  physicalNearestWithoutHeading?.segment_index,
  2,
  'accuracy never widens nearby-road matching without a usable directionally distinct heading',
);

console.log('Originals route projection tests passed.');
