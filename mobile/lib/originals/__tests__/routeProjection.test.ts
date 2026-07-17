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

console.log('Originals route projection tests passed.');
