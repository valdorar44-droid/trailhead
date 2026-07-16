import assert from 'node:assert/strict';
import { originalRouteDisplayModel } from '../routeDisplay';

const route: [number, number][] = [
  [-109.6, 38.5],
  [-109.5, 38.5],
  [-109.4, 38.5],
];

const halfway = originalRouteDisplayModel(route, 20_000, 10_000);
assert.equal(halfway.progress_ratio, 0.5);
assert.equal(halfway.progress_m, 10_000);
assert.equal(halfway.remaining_m, 10_000);
assert.ok(halfway.marker, 'projected progress produces a route marker');
assert.ok(Math.abs((halfway.marker?.[0] ?? 0) - -109.5) < 0.0001);
assert.ok(halfway.completed.length >= 2);
assert.ok(halfway.remaining.length >= 2);

const beforeStart = originalRouteDisplayModel(route, 20_000, -10);
assert.equal(beforeStart.progress_ratio, 0);
assert.deepEqual(beforeStart.marker, route[0]);

const locating = originalRouteDisplayModel(route, 20_000, null);
assert.equal(locating.progress_known, false);
assert.equal(locating.marker, null, 'unknown progress does not pretend the vehicle is at route start');
assert.deepEqual(locating.remaining, route);
assert.deepEqual(locating.completed, []);

const afterEnd = originalRouteDisplayModel(route, 20_000, 30_000);
assert.equal(afterEnd.progress_ratio, 1);
assert.deepEqual(afterEnd.marker, route.at(-1));

const invalid = originalRouteDisplayModel([[999, 999], [Number.NaN, 0]], 0, null);
assert.equal(invalid.coordinates.length, 0);
assert.equal(invalid.marker, null);

console.log('Originals authored route display tests passed.');
