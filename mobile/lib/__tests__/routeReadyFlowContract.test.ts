import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const planSource = readFileSync(resolve(here, '../../app/(tabs)/plan.tsx'), 'utf8');
const mapSource = readFileSync(resolve(here, '../../app/(tabs)/map.tsx'), 'utf8');

test('assisted planning enters the same durable main-map route-ready flow', () => {
  assert.match(planSource, /source:\s*'assisted_trip_planner'/);
  assert.match(planSource, /status:\s*'complete'/);
  assert.match(planSource, /router\.replace\('\/\(tabs\)\/map'\)/);
});

test('route review is explicit and camera timing is owned by the shared controller', () => {
  assert.match(mapSource, /testID="map\.trip-overview"/);
  assert.match(mapSource, /onReviewTrip=\{\(\) => \{/);
  assert.doesNotMatch(mapSource, /requestAnimationFrame\(\(\) => focusTripOverviewCamera\(\)\)/);
  assert.doesNotMatch(mapSource, /setTimeout\(\(\) => focusTripOverviewCamera\(\),\s*180\)/);
});
