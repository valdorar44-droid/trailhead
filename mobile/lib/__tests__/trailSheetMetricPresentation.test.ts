import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trailSheetMetricDisplayValue } from '../trailSheetMetricPresentation';

assert.equal(trailSheetMetricDisplayValue('SURFACE', 'Natural surface'), 'Natural');
assert.equal(trailSheetMetricDisplayValue('Surface', 'Paved Surface'), 'Paved');
assert.equal(trailSheetMetricDisplayValue('ROUTE', 'Out and back'), 'Out and back');
assert.equal(trailSheetMetricDisplayValue('SURFACE', ''), '');

const componentSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../components/map/TrailPlaceSheet.tsx'),
  'utf8',
);
const metricValue = componentSource.match(/<Text style=\{s\.metricValue\}[^>]*>/)?.[0] ?? '';
assert.ok(metricValue, 'trail metric value renderer exists');
assert.doesNotMatch(metricValue, /numberOfLines/, 'trail metric values wrap instead of truncating');

console.log('trail sheet metric presentation tests passed');
